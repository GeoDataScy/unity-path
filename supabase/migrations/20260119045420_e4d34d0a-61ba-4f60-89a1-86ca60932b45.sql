-- Allow services.product to accept any existing product from public.products (FK already enforces validity)
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_product_check;