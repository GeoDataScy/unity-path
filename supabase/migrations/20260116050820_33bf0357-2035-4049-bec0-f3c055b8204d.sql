-- Create goals table to store monthly targets
CREATE TABLE IF NOT EXISTS public.goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month DATE NOT NULL,
  target_value INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goals_month_unique UNIQUE (month)
);

-- Enable Row Level Security
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

-- Policies: managers manage goals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goals' AND policyname = 'Managers view goals'
  ) THEN
    CREATE POLICY "Managers view goals"
    ON public.goals
    FOR SELECT
    USING ((auth.uid() IS NOT NULL) AND is_manager());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goals' AND policyname = 'Managers insert goals'
  ) THEN
    CREATE POLICY "Managers insert goals"
    ON public.goals
    FOR INSERT
    WITH CHECK (is_manager());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goals' AND policyname = 'Managers update goals'
  ) THEN
    CREATE POLICY "Managers update goals"
    ON public.goals
    FOR UPDATE
    USING (is_manager());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goals' AND policyname = 'Managers delete goals'
  ) THEN
    CREATE POLICY "Managers delete goals"
    ON public.goals
    FOR DELETE
    USING (is_manager());
  END IF;
END $$;

-- Update timestamps trigger function (create if missing)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_goals_updated_at ON public.goals;
CREATE TRIGGER set_goals_updated_at
BEFORE UPDATE ON public.goals
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Insert default goal for the current month (day 01), upsert to avoid duplicates
INSERT INTO public.goals (month, target_value)
VALUES (date_trunc('month', now())::date, 500)
ON CONFLICT (month) DO UPDATE
SET target_value = EXCLUDED.target_value;