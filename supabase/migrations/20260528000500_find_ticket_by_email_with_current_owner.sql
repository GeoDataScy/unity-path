-- find_ticket_by_email is used by the agent's "new ticket" flow to detect
-- duplicates by client_email across agents (the RPC is SECURITY DEFINER, so
-- it bypasses RLS).
--
-- Before this migration the function returned user_id (creator). After the
-- manager-driven reassignment feature lands, the creator is no longer enough:
-- if a ticket was redistributed from A to B, and B opens a new ticket for the
-- same client, the lookup returns user_id=A and the UI mistakenly flags the
-- ticket as "owned by another agent" — but it's actually B's now.
--
-- Adding current_owner_id to the return lets the client compare against the
-- actual handler. DROP + CREATE is required because RETURNS TABLE shape
-- changed; CREATE OR REPLACE FUNCTION cannot alter the column list.

DROP FUNCTION IF EXISTS public.find_ticket_by_email(text);

CREATE OR REPLACE FUNCTION public.find_ticket_by_email(p_email text)
RETURNS TABLE(
  id text,
  user_id text,
  current_owner_id text,
  agent_name text,
  current_owner_name text,
  client_email text,
  product text,
  platform text,
  channel text,
  status text,
  service_date timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.id::text,
    s.user_id::text,
    s.current_owner_id::text,
    p.full_name           AS agent_name,
    pc.full_name          AS current_owner_name,
    s.client_email,
    s.product,
    s.platform,
    s.channel,
    s.status,
    s.service_date::timestamptz,
    s.created_at::timestamptz
  FROM public.services s
  LEFT JOIN public.profiles p  ON p.id::text  = s.user_id::text
  LEFT JOIN public.profiles pc ON pc.id::text = s.current_owner_id::text
  WHERE LOWER(TRIM(s.client_email)) = LOWER(TRIM(p_email))
    AND s.status <> 'concluido'
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_ticket_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_ticket_by_email(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
