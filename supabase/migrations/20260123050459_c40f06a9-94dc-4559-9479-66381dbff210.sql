-- Create refunds table
CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  request_date date NOT NULL,
  completion_date date NULL,
  reason text NOT NULL,
  items_returned boolean NOT NULL DEFAULT false,
  sales_platform text NOT NULL,
  order_id text NOT NULL,
  refund_type text NOT NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_refunds_user_request_date
  ON public.refunds (user_id, request_date DESC);

CREATE INDEX IF NOT EXISTS idx_refunds_user_completion_date
  ON public.refunds (user_id, completion_date);

-- Enable Row Level Security
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- RLS policies: agents can only access their own refunds
DROP POLICY IF EXISTS "Agents view own refunds" ON public.refunds;
CREATE POLICY "Agents view own refunds"
ON public.refunds
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Agents insert own refunds" ON public.refunds;
CREATE POLICY "Agents insert own refunds"
ON public.refunds
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Agents update own refunds" ON public.refunds;
CREATE POLICY "Agents update own refunds"
ON public.refunds
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Agents delete own refunds" ON public.refunds;
CREATE POLICY "Agents delete own refunds"
ON public.refunds
FOR DELETE
USING (auth.uid() = user_id);
