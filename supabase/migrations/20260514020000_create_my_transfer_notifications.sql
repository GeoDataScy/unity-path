-- Returns both inbox (pending transfers TO me) and unseen responses
-- (transfers I sent that have been answered but I haven't acknowledged yet).
-- SECURITY DEFINER is required because the requester does not have RLS
-- access to the recipient's service row.

CREATE OR REPLACE FUNCTION public.my_transfer_notifications()
RETURNS TABLE (
  role             text,  -- 'inbox' (received pending) or 'response' (my accepted/declined)
  transfer_id      uuid,
  service_id       text,
  client_email     text,
  product          text,
  service_status   text,  -- service status (e.g. 'registered','em_andamento'), NOT the transfer status
  transfer_status  text,  -- 'pending' | 'accepted' | 'declined' | 'cancelled'
  message          text,
  response_note    text,
  other_agent_id   text,  -- the other party (sender for inbox, recipient for response)
  other_agent_name text,
  created_at       timestamptz,
  responded_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Inbox: pending transfers TO me
  SELECT
    'inbox'::text,
    t.id,
    t.service_id,
    s.client_email,
    s.product,
    s.status,
    t.status,
    t.message,
    t.response_note,
    t.from_user_id,
    pf.full_name,
    t.created_at,
    t.responded_at
  FROM public.ticket_transfers t
  JOIN public.services s ON s.id = t.service_id
  LEFT JOIN public.profiles pf ON pf.id = t.from_user_id
  WHERE t.to_user_id = auth.uid()::text
    AND t.status = 'pending'

  UNION ALL

  -- Responses: accepted/declined transfers I sent that I haven't acknowledged yet
  SELECT
    'response'::text,
    t.id,
    t.service_id,
    s.client_email,
    s.product,
    s.status,
    t.status,
    t.message,
    t.response_note,
    t.to_user_id,
    pt.full_name,
    t.created_at,
    t.responded_at
  FROM public.ticket_transfers t
  JOIN public.services s ON s.id = t.service_id
  LEFT JOIN public.profiles pt ON pt.id = t.to_user_id
  WHERE t.from_user_id = auth.uid()::text
    AND t.status IN ('accepted','declined')
    AND t.requester_seen_at IS NULL

  ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.my_transfer_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_transfer_notifications() TO authenticated;

NOTIFY pgrst, 'reload schema';
