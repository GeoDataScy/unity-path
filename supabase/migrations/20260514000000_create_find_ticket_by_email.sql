-- RPC to detect duplicate tickets across agents (bypasses RLS via SECURITY DEFINER).
-- Returns the most recent NON-concluded ticket for the given client_email, or no row.
--
-- Note: services.service_date is stored as TEXT in this project (known quirk).
-- We cast to timestamptz so the frontend gets a real ISO timestamp.

DROP FUNCTION IF EXISTS public.find_ticket_by_email(text);

CREATE FUNCTION public.find_ticket_by_email(p_email text)
RETURNS TABLE (
  id            text,
  user_id       text,
  agent_name    text,
  client_email  text,
  product       text,
  platform      text,
  channel       text,
  status        text,
  service_date  timestamptz,
  created_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id::text,
    s.user_id::text,
    p.full_name AS agent_name,
    s.client_email,
    s.product,
    s.platform,
    s.channel,
    s.status,
    s.service_date::timestamptz,
    s.created_at::timestamptz
  FROM public.services s
  LEFT JOIN public.profiles p ON p.id::text = s.user_id::text
  WHERE LOWER(TRIM(s.client_email)) = LOWER(TRIM(p_email))
    AND s.status <> 'concluido'
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_ticket_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_ticket_by_email(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
