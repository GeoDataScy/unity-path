-- Removes the "s.user_id = f.user_id" guard from _interaction_events.
--
-- Originally this guard was a defense against ghost rows — follow-ups whose
-- user_id didn't match the parent service. In practice every such row in
-- production is legitimate cross-agent work: supervisors (Ana, Giovanna) who
-- continued tickets created by other agents. With the manager-driven ticket
-- redistribution feature landing in this migration set, cross-agent
-- follow-ups become a first-class scenario, so the guard now hides real work.
--
-- After this migration:
--   * Service-creation events are still credited to services.user_id
--     (the creator — immutable, historical attribution preserved).
--   * Follow-up events are credited to service_follow_ups.user_id (whoever
--     wrote the follow-up — also immutable).
--   * A follow-up written by agent B on a ticket created by agent A counts
--     once for B, regardless of who currently owns the ticket.
--
-- This keeps the dual-source-of-truth model intact:
--   * "I created X tickets in the period" -> services.user_id
--   * "I had X interactions in the period" -> services.user_id (for creates)
--                                             + service_follow_ups.user_id
--                                               (for follow-ups, no cross-
--                                                agent filtering)

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
    AND (agent_id IS NULL OR f.user_id = agent_id);
  -- Note: previously had "AND s.user_id::text = f.user_id" here.
  -- See migration header for why it was removed.
$$;

REVOKE ALL ON FUNCTION public._interaction_events(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._interaction_events(date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
