-- Returns the complete history of transfers I'm involved in (sent + received).
-- SECURITY DEFINER is required because the requester does not have RLS
-- access to the recipient's service row.

CREATE OR REPLACE FUNCTION public.my_transfer_history()
RETURNS TABLE (
  role             text,   -- 'sent' (I'm the requester) or 'received' (I'm the recipient)
  transfer_id      uuid,
  service_id       text,
  client_email     text,
  product          text,
  service_status   text,
  transfer_status  text,
  message          text,
  response_note    text,
  other_agent_id   text,   -- the other party
  other_agent_name text,
  created_at       timestamptz,
  responded_at     timestamptz
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
    t.status,
    t.message,
    t.response_note,
    CASE WHEN t.from_user_id = auth.uid()::text THEN t.to_user_id ELSE t.from_user_id END,
    CASE WHEN t.from_user_id = auth.uid()::text THEN pt.full_name ELSE pf.full_name END,
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
