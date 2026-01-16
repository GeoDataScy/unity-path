-- Ensure RLS is enabled on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Remove existing restrictive SELECT policies so the new rule is the single source of truth
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Allow SELECT only for authenticated users (any logged-in user)
CREATE POLICY "Require authentication"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL);
