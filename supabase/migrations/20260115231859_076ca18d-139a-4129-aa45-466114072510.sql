-- Fix constraint mismatch for product values used in the app
-- Ensure the allowed product values match the UI options (Produto A/B/C)

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_product_check;

ALTER TABLE public.services
  ADD CONSTRAINT services_product_check
  CHECK (product IN ('Produto A', 'Produto B', 'Produto C'));
