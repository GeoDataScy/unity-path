-- Helper internal function that materializes the "interaction event log"
-- used by dashboard_metrics, agent_daily_metrics and agent_my_metrics.
--
-- Rule of truth (cada interação = 1):
--   * Service creation = 1 event on services.service_date (SP calendar date),
--     attributed to services.user_id.
--   * Each follow-up   = 1 event on service_follow_ups.recorded_at (SP date),
--     attributed to service_follow_ups.user_id.
--
-- We keep the RLS-equivalent constraint s.user_id = f.user_id for follow-up
-- rows: in practice every follow-up belongs to the service owner, but we are
-- defensive against ghost cross-agent rows.
--
-- This function is the single source of truth for "what counts as 1
-- interaction in the period". Every metrics RPC must call it instead of
-- recomputing the join — otherwise the agent screen will drift from the
-- manager screen again.

CREATE OR REPLACE FUNCTION public._interaction_events(
  from_date date,
  to_date   date,
  agent_id  text DEFAULT NULL
)
RETURNS TABLE (
  day        date,
  user_id    text,
  service_id text,
  product    text,
  platform   text,
  channel    text,
  kind       text   -- 'service' | 'follow_up'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    s.user_id::text AS user_id,
    s.id            AS service_id,
    s.product,
    s.platform,
    s.channel,
    'service'::text AS kind
  FROM public.services s
  WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
        BETWEEN from_date AND to_date
    AND (agent_id IS NULL OR s.user_id::text = agent_id)

  UNION ALL

  SELECT
    (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    f.user_id,
    s.id,
    s.product,
    s.platform,
    s.channel,
    'follow_up'::text AS kind
  FROM public.service_follow_ups f
  JOIN public.services s ON s.id = f.service_id
  WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        BETWEEN from_date AND to_date
    AND s.user_id::text = f.user_id
    AND (agent_id IS NULL OR f.user_id = agent_id);
$$;

REVOKE ALL ON FUNCTION public._interaction_events(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._interaction_events(date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
