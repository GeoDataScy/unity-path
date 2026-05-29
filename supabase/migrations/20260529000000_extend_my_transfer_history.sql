-- Extends my_transfer_history to surface what the agent needs to resolve a
-- received ticket directly from the Transferências page:
--   * service_date          — required by the "18:00 SP rule" the dialog
--                             checks before allowing a new follow-up.
--   * has_tracking_code     — also feeds the dialog's interaction-block
--                             check (tracking-code tickets bypass the 18h
--                             rule).
--   * assigned_by_manager_id — lets the UI tell apart a peer-to-peer
--                              transfer from a manager-driven reassign
--                              ("Redistribuído pelo gestor").
--
-- DROP + CREATE is required because RETURNS TABLE shape changed.

DROP FUNCTION IF EXISTS public.my_transfer_history();

CREATE OR REPLACE FUNCTION public.my_transfer_history()
RETURNS TABLE (
  role                    text,
  transfer_id             uuid,
  service_id              text,
  client_email            text,
  product                 text,
  service_status          text,
  service_date            timestamptz,
  has_tracking_code       boolean,
  transfer_status         text,
  message                 text,
  response_note           text,
  other_agent_id          text,
  other_agent_name        text,
  assigned_by_manager_id  text,
  created_at              timestamptz,
  responded_at            timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN t.from_user_id = auth.uid()::text THEN 'sent' ELSE 'received' END,
    t.id,
    t.service_id,
    s.client_email,
    s.product,
    s.status,
    s.service_date::timestamptz,
    s.has_tracking_code,
    t.status,
    t.message,
    t.response_note,
    CASE WHEN t.from_user_id = auth.uid()::text THEN t.to_user_id ELSE t.from_user_id END,
    CASE WHEN t.from_user_id = auth.uid()::text THEN pt.full_name ELSE pf.full_name END,
    t.assigned_by_manager_id,
    t.created_at,
    t.responded_at
  FROM public.ticket_transfers t
  JOIN public.services s ON s.id = t.service_id
  LEFT JOIN public.profiles pf ON pf.id = t.from_user_id
  LEFT JOIN public.profiles pt ON pt.id = t.to_user_id
  WHERE t.from_user_id = auth.uid()::text OR t.to_user_id = auth.uid()::text
  ORDER BY t.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.my_transfer_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_transfer_history() TO authenticated;

NOTIFY pgrst, 'reload schema';
