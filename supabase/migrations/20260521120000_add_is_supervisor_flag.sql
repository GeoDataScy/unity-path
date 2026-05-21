-- Supervisor agents: agentes específicos que enxergam e tratam tickets de outros agentes
-- sem virar manager. Bloqueio de duplicado no cadastro continua valendo pra eles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_supervisor boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_supervisor()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.is_supervisor FROM public.profiles p WHERE p.id = (auth.uid())::text),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_supervisor() TO authenticated;

-- services: supervisor lê e atualiza tudo (delete continua só manager)
DROP POLICY IF EXISTS "Supervisors view all services" ON public.services;
CREATE POLICY "Supervisors view all services"
  ON public.services
  FOR SELECT
  USING (public.is_supervisor());

DROP POLICY IF EXISTS "Supervisors update services" ON public.services;
CREATE POLICY "Supervisors update services"
  ON public.services
  FOR UPDATE
  USING (public.is_supervisor());

-- service_follow_ups: supervisor lê tudo. INSERT continua scoped a user_id=auth.uid()
-- (o follow-up fica registrado em nome do supervisor que atendeu)
DROP POLICY IF EXISTS "Supervisors read all follow-ups" ON public.service_follow_ups;
CREATE POLICY "Supervisors read all follow-ups"
  ON public.service_follow_ups
  FOR SELECT
  USING (public.is_supervisor());

-- Marca Ana Vidotti e Giovanna Godoy como supervisor
UPDATE public.profiles
SET is_supervisor = true
WHERE id IN (
  'feb03c22-2eb5-49d8-8d4b-ac57f4ff744d',
  'db70f80f-ff4c-4763-9ebd-0f08c36c1835'
);
