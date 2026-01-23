-- Allow creating 'open' refunds with minimal fields
-- (reason and refund_type will be provided later when concluding)
ALTER TABLE public.refunds
  ALTER COLUMN reason DROP NOT NULL;

ALTER TABLE public.refunds
  ALTER COLUMN refund_type DROP NOT NULL;
