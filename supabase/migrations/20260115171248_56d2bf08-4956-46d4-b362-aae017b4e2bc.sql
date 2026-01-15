-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('agent', 'manager');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'agent',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies: users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Managers can view all profiles
CREATE POLICY "Managers can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Create services table
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_email TEXT NOT NULL,
  service_date TIMESTAMP WITH TIME ZONE NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('Produto A', 'Produto B')),
  status TEXT NOT NULL DEFAULT 'pending'
);

-- Enable RLS on services
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Agents can only see their own services
CREATE POLICY "Agents view own services"
  ON public.services FOR SELECT
  USING (
    user_id = auth.uid()
  );

-- Managers can view all services
CREATE POLICY "Managers view all services"
  ON public.services FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Agents can insert their own services
CREATE POLICY "Agents insert own services"
  ON public.services FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Agents can update their own services
CREATE POLICY "Agents update own services"
  ON public.services FOR UPDATE
  USING (user_id = auth.uid());

-- Managers can insert any service
CREATE POLICY "Managers insert services"
  ON public.services FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Managers can update any service
CREATE POLICY "Managers update services"
  ON public.services FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- Function to automatically create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'agent')
  );
  RETURN NEW;
END;
$$;

-- Trigger to create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();