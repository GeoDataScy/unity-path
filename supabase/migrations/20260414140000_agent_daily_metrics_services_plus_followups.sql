-- agent_daily_metrics: daily count = services by service_date + follow-ups by recorded_at
-- Counts by the date the agent chose, not when they saved in the DB.
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
  v_uid uuid;
  v_my_services int := 0;
  v_my_follow_ups int := 0;
  v_my_count int := 0;
  v_leader_id text;
  v_leader_count int := 0;
  v_leader_name text := 'Sem nome';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Services: conta pela data que o agente escolheu (service_date)
  SELECT COUNT(*)::int
    INTO v_my_services
  FROM public.services s
  WHERE s.user_id = v_uid::text
    AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = target_date;

  -- Follow-ups: conta pela data que o agente registrou (recorded_at)
  SELECT COUNT(*)::int
    INTO v_my_follow_ups
  FROM public.service_follow_ups f
  WHERE f.user_id = v_uid::text
    AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date = target_date;

  v_my_count := COALESCE(v_my_services, 0) + COALESCE(v_my_follow_ups, 0);

  -- Líder: mesma lógica (service_date + recorded_at)
  SELECT t.user_id, t.c
    INTO v_leader_id, v_leader_count
  FROM (
    SELECT user_id, SUM(c)::int AS c
    FROM (
      SELECT s.user_id, COUNT(*)::int AS c
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = target_date
      GROUP BY s.user_id
      UNION ALL
      SELECT f.user_id, COUNT(*)::int AS c
      FROM public.service_follow_ups f
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date = target_date
      GROUP BY f.user_id
    ) u
    GROUP BY user_id
    ORDER BY SUM(c) DESC, user_id ASC
    LIMIT 1
  ) t;

  IF v_leader_id IS NOT NULL THEN
    SELECT COALESCE(p.full_name, 'Sem nome')
      INTO v_leader_name
    FROM public.profiles p
    WHERE p.id = v_leader_id;
  END IF;

  RETURN jsonb_build_object(
    'my_count', COALESCE(v_my_count, 0),
    'leader_count', COALESCE(v_leader_count, 0),
    'leader_name', COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'leader_id', v_leader_id,
    'is_leader', (v_leader_id IS NOT NULL AND v_leader_id = v_uid::text)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
