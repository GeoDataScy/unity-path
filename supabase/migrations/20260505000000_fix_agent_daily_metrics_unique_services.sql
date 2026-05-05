-- Fix agent_daily_metrics: count unique service tickets with activity on target_date
-- instead of summing services + each follow-up individually.
-- "Total de atendimentos hoje" must match the table row count: each ticket = 1,
-- regardless of how many follow-ups it received that day.
-- A ticket counts if: opened on target_date OR had at least one follow-up on target_date.
CREATE OR REPLACE FUNCTION public.agent_daily_metrics(
  target_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid         uuid;
  v_my_count    int  := 0;
  v_leader_id   text;
  v_leader_count int := 0;
  v_leader_name text := 'Sem nome';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Unique tickets with activity on target_date for the current agent
  SELECT COUNT(DISTINCT s.id)::int
    INTO v_my_count
  FROM public.services s
  WHERE s.user_id = v_uid::text
    AND (
      (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = target_date
      OR EXISTS (
        SELECT 1
        FROM public.service_follow_ups f
        WHERE f.service_id = s.id
          AND f.user_id = v_uid::text
          AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date = target_date
      )
    );

  -- Leader board: same counting method applied team-wide
  SELECT t.user_id, t.c
    INTO v_leader_id, v_leader_count
  FROM (
    SELECT s.user_id, COUNT(DISTINCT s.id)::int AS c
    FROM public.services s
    WHERE (
      (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = target_date
      OR EXISTS (
        SELECT 1
        FROM public.service_follow_ups f
        WHERE f.service_id = s.id
          AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date = target_date
      )
    )
    GROUP BY s.user_id
    ORDER BY COUNT(DISTINCT s.id) DESC, s.user_id ASC
    LIMIT 1
  ) t;

  IF v_leader_id IS NOT NULL THEN
    SELECT COALESCE(p.full_name, 'Sem nome')
      INTO v_leader_name
    FROM public.profiles p
    WHERE p.id = v_leader_id;
  END IF;

  RETURN jsonb_build_object(
    'my_count',     COALESCE(v_my_count, 0),
    'leader_count', COALESCE(v_leader_count, 0),
    'leader_name',  COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'leader_id',    v_leader_id,
    'is_leader',    (v_leader_id IS NOT NULL AND v_leader_id = v_uid::text)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
