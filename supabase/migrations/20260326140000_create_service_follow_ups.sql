-- Table to track every status change / follow-up on a service (ticket)
-- Each row = one agent interaction (status change + observation)
CREATE TABLE IF NOT EXISTS public.service_follow_ups (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  service_id  text NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  follow_up_number integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'em_andamento',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  observation text DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by service
CREATE INDEX IF NOT EXISTS idx_service_follow_ups_service_id
  ON public.service_follow_ups(service_id);

-- Index for lookups by agent
CREATE INDEX IF NOT EXISTS idx_service_follow_ups_user_id
  ON public.service_follow_ups(user_id);

-- RLS: agents can only see/insert their own follow-ups
ALTER TABLE public.service_follow_ups ENABLE ROW LEVEL SECURITY;

-- Policy: agents can read their own follow-ups
DO $$ BEGIN
  CREATE POLICY "Agents can read own follow-ups"
    ON public.service_follow_ups
    FOR SELECT
    USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Policy: agents can insert their own follow-ups
DO $$ BEGIN
  CREATE POLICY "Agents can insert own follow-ups"
    ON public.service_follow_ups
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Policy: managers can read all follow-ups (for dashboard/reports)
DO $$ BEGIN
  CREATE POLICY "Managers can read all follow-ups"
    ON public.service_follow_ups
    FOR SELECT
    USING (public.is_manager());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grant table access to authenticated users
GRANT SELECT, INSERT ON public.service_follow_ups TO authenticated;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
