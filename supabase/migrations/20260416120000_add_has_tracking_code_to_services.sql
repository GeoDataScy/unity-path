ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS has_tracking_code boolean NOT NULL DEFAULT false;
