-- Returns the tickets that should appear in the agent's "Meus Atendimentos
-- Recentes" table. Replaces the previous client-side query which filtered
-- only by services.service_date >= cutoff.
--
-- The old rule hid a real scenario introduced by manager_reassign_tickets:
-- ticket created 60 days ago by agent A, redistributed today to agent B,
-- B registers a follow-up — but service_date is still 60 days ago, so the
-- row never showed up in B's recent list. The 30-day window must consider
-- the latest *interaction* on the ticket (last follow-up OR creation),
-- not the creation alone.
--
-- Supervisors / managers see across agents; everyone else sees only their
-- own current ownership.

CREATE OR REPLACE FUNCTION public.my_recent_services(p_days_back int DEFAULT 30)
RETURNS TABLE(
  id                text,
  client_email      text,
  service_date      text,
  product           text,
  platform          text,
  channel           text,
  status            text,
  created_at        timestamptz,
  has_tracking_code boolean,
  contact_reason    text,
  user_id           text,
  current_owner_id  text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid      text;
  v_cutoff   date;
  v_view_all boolean;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_view_all := public.is_manager() OR public.can_view_all_tickets();
  v_cutoff   := (now() AT TIME ZONE 'America/Sao_Paulo')::date - p_days_back;

  RETURN QUERY
  SELECT
    s.id,
    s.client_email,
    s.service_date,
    s.product,
    s.platform,
    s.channel,
    s.status,
    s.created_at::timestamptz,
    s.has_tracking_code,
    s.contact_reason,
    s.user_id,
    s.current_owner_id
  FROM public.services s
  WHERE (v_view_all OR s.current_owner_id = v_uid)
    AND (
      -- Created within the window (cheap path; uses lexicographic compare on text)
      s.service_date >= to_char(v_cutoff, 'YYYY-MM-DD')
      -- Or has a follow-up within the window (catches redistributed-old tickets)
      OR EXISTS (
        SELECT 1
        FROM public.service_follow_ups f
        WHERE f.service_id = s.id
          AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date >= v_cutoff
      )
    )
  ORDER BY s.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.my_recent_services(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_recent_services(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
