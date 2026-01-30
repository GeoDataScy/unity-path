-- Add refund_value to refunds (nullable for backward compatibility)
ALTER TABLE public.refunds
ADD COLUMN IF NOT EXISTS refund_value numeric(10,2);

-- Prevent negative values (allows NULL for open/legacy rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'refunds_refund_value_non_negative'
  ) THEN
    ALTER TABLE public.refunds
    ADD CONSTRAINT refunds_refund_value_non_negative
    CHECK (refund_value IS NULL OR refund_value >= 0);
  END IF;
END $$;
