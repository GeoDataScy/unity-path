-- Supervisor precisa ler outros profiles pra exibir nome do agente dono do ticket
DROP POLICY IF EXISTS "Supervisors can view all profiles" ON public.profiles;
CREATE POLICY "Supervisors can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_supervisor());
