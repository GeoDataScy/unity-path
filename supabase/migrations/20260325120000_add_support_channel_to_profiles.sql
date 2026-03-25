-- Add support_channel to profiles: defines whether agent works on 'email' or 'sms'
-- Default is 'email' since most agents are on that channel

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS support_channel text NOT NULL DEFAULT 'email'
  CHECK (support_channel IN ('email', 'sms'));
