-- Extend RPC payload to support leader detection
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
  v_my_count int := 0;
  v_leader_id uuid;
  v_leader_count int := 0;
  v_leader_name text := 'Sem nome';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT COUNT(*)::int
    INTO v_my_count
  FROM public.services s
  WHERE s.user_id = v_uid
    AND (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date = target_date;

  SELECT t.user_id, t.c
    INTO v_leader_id, v_leader_count
  FROM (
    SELECT s.user_id, COUNT(*)::int AS c
    FROM public.services s
    WHERE (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date = target_date
    GROUP BY s.user_id
    ORDER BY COUNT(*) DESC, s.user_id ASC
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
    'is_leader', (v_leader_id IS NOT NULL AND v_leader_id = v_uid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_daily_metrics(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_daily_metrics(date) TO authenticated;
