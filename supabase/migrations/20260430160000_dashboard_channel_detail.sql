-- New RPC: dashboard_channel_detail
-- Returns per-channel, per-agent breakdown using the same Set A + Set B semantics
-- as dashboard_metrics.by_channel so numbers always match the summary chart.
--
--   Set A: services with service_date IN range   → new_tickets, done_count
--   Set B: DISTINCT previous-day services where the owner recorded a follow-up IN range
--          (service_date < from_date)             → interactions
--   total = new_tickets + interactions  (mutually exclusive)

CREATE OR REPLACE FUNCTION public.dashboard_channel_detail(
  p_from_date date DEFAULT NULL,
  p_to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from   date;
  v_to     date;
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_from := COALESCE(p_from_date, CURRENT_DATE);
  v_to   := COALESCE(p_to_date,   CURRENT_DATE);

  WITH
  -- Set A: new services opened in range
  set_a AS (
    SELECT
      s.id                                        AS service_id,
      s.user_id::text                             AS agent_id,
      COALESCE(s.channel, 'Nao informado')        AS channel,
      s.status                                    AS svc_status
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN v_from AND v_to
  ),
  -- Classify Set A tickets by last follow-up status (same logic as dashboard_follow_up_detail)
  last_fup AS (
    SELECT DISTINCT ON (sa.service_id)
      sa.service_id,
      sa.agent_id,
      sa.channel,
      sa.svc_status,
      f.status AS fup_status
    FROM set_a sa
    LEFT JOIN public.service_follow_ups f ON f.service_id = sa.service_id
    ORDER BY sa.service_id, f.follow_up_number DESC NULLS LAST
  ),
  classified AS (
    SELECT
      service_id,
      agent_id,
      channel,
      CASE
        WHEN svc_status = 'concluido' OR fup_status = 'concluido' THEN 'concluido'
        WHEN fup_status IS NOT NULL                                THEN 'em_andamento'
        ELSE 'open'
      END AS ticket_status
    FROM last_fup
  ),
  -- Aggregate Set A per agent per channel
  a_by_agent AS (
    SELECT
      agent_id,
      channel,
      COUNT(DISTINCT service_id)::int                                            AS new_tickets,
      COUNT(DISTINCT service_id) FILTER (WHERE ticket_status = 'concluido')::int AS done_count
    FROM classified
    GROUP BY agent_id, channel
  ),
  -- Set B: DISTINCT previous-day services with owner follow-up recorded in range
  set_b AS (
    SELECT DISTINCT
      f.user_id                                   AS agent_id,
      COALESCE(s.channel, 'Nao informado')        AS channel,
      f.service_id
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND s.user_id::text = f.user_id
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date < v_from
  ),
  -- Aggregate Set B per agent per channel
  b_by_agent AS (
    SELECT
      agent_id,
      channel,
      COUNT(DISTINCT service_id)::int AS interactions
    FROM set_b
    GROUP BY agent_id, channel
  ),
  -- All (agent, channel) pairs that appear in either set
  all_pairs AS (
    SELECT agent_id, channel FROM a_by_agent
    UNION
    SELECT agent_id, channel FROM b_by_agent
  ),
  -- Final agent × channel aggregation joined to profiles
  agent_channel AS (
    SELECT
      p.id::text                            AS agent_id,
      COALESCE(p.full_name, 'Sem nome')    AS agent_name,
      ap.channel,
      COALESCE(a.new_tickets,  0)          AS new_tickets,
      COALESCE(a.done_count,   0)          AS done_count,
      COALESCE(b.interactions, 0)          AS interactions,
      COALESCE(a.new_tickets,  0) + COALESCE(b.interactions, 0) AS total
    FROM all_pairs ap
    JOIN  public.profiles p  ON p.id::text = ap.agent_id
    LEFT JOIN a_by_agent  a  ON a.agent_id = ap.agent_id AND a.channel = ap.channel
    LEFT JOIN b_by_agent  b  ON b.agent_id = ap.agent_id AND b.channel = ap.channel
    WHERE p.role = 'agent'
  )
  SELECT jsonb_build_object(
    'by_channel_agent',
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'channel',      ac.channel,
          'agent_id',     ac.agent_id,
          'agent_name',   ac.agent_name,
          'new_tickets',  ac.new_tickets,
          'done_count',   ac.done_count,
          'interactions', ac.interactions,
          'total',        ac.total
        ) ORDER BY ac.channel, ac.total DESC, ac.agent_name
      ),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM agent_channel ac
  WHERE ac.total > 0;

  RETURN COALESCE(v_result, jsonb_build_object('by_channel_agent', '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_channel_detail(date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
