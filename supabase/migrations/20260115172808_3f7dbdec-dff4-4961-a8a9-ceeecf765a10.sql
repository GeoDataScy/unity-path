-- Helper: avoid RLS recursion by encapsulating manager check in a SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'manager'::public.app_role
  );
$$;

-- Fix profiles policies (remove recursive self-join)
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles"
ON public.profiles
FOR SELECT
USING (public.is_manager());

-- Fix services manager policies to avoid querying profiles inside policy
DROP POLICY IF EXISTS "Managers view all services" ON public.services;
CREATE POLICY "Managers view all services"
ON public.services
FOR SELECT
USING (public.is_manager());

DROP POLICY IF EXISTS "Managers insert services" ON public.services;
CREATE POLICY "Managers insert services"
ON public.services
FOR INSERT
WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "Managers update services" ON public.services;
CREATE POLICY "Managers update services"
ON public.services
FOR UPDATE
USING (public.is_manager());

-- Add missing DELETE policies for UI 'Excluir'
DROP POLICY IF EXISTS "Agents delete own services" ON public.services;
CREATE POLICY "Agents delete own services"
ON public.services
FOR DELETE
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Managers delete services" ON public.services;
CREATE POLICY "Managers delete services"
ON public.services
FOR DELETE
USING (public.is_manager());
