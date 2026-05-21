-- Renomeia profiles.is_supervisor → can_view_all_tickets
-- Motivação: "supervisor" sugeria um cargo separado. São agentes comuns com permissão
-- técnica de enxergar tickets registrados por outros agentes.

ALTER TABLE public.profiles RENAME COLUMN is_supervisor TO can_view_all_tickets;

DROP POLICY IF EXISTS "Supervisors view all services" ON public.services;
DROP POLICY IF EXISTS "Supervisors update services" ON public.services;
DROP POLICY IF EXISTS "Supervisors read all follow-ups" ON public.service_follow_ups;
DROP POLICY IF EXISTS "Supervisors can view all profiles" ON public.profiles;
DROP FUNCTION IF EXISTS public.is_supervisor();

CREATE OR REPLACE FUNCTION public.can_view_all_tickets()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.can_view_all_tickets FROM public.profiles p WHERE p.id = (auth.uid())::text),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_all_tickets() TO authenticated;

CREATE POLICY "Cross-agent view all services"
  ON public.services
  FOR SELECT
  USING (public.can_view_all_tickets());

CREATE POLICY "Cross-agent update services"
  ON public.services
  FOR UPDATE
  USING (public.can_view_all_tickets());

CREATE POLICY "Cross-agent read all follow-ups"
  ON public.service_follow_ups
  FOR SELECT
  USING (public.can_view_all_tickets());

CREATE POLICY "Cross-agent view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.can_view_all_tickets());
