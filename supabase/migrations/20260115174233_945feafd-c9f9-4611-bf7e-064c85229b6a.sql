-- Fix security issue: Block anonymous access to profiles table
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL AND auth.uid() = id);

DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL AND public.is_manager());

-- Fix security issue: Block anonymous access to services table
DROP POLICY IF EXISTS "Agents view own services" ON public.services;
CREATE POLICY "Agents view own services"
ON public.services
FOR SELECT
USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS "Managers view all services" ON public.services;
CREATE POLICY "Managers view all services"
ON public.services
FOR SELECT
USING (auth.uid() IS NOT NULL AND public.is_manager());