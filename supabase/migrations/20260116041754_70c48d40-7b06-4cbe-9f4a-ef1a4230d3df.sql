-- Update allowed product values for services
-- IMPORTANT: drop the existing constraint first so we can update rows safely

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_product_check;

-- Migrate any existing rows using old placeholder products
UPDATE public.services
SET product = 'Arialief'
WHERE product IN ('Produto A', 'Produto B', 'Produto C');

-- Add the new check constraint with the new global product list
ALTER TABLE public.services
  ADD CONSTRAINT services_product_check
  CHECK (
    product IN (
      'Arialief',
      'Alphacur',
      'Blinzador',
      'Feilaira',
      'Garaherb',
      'Karylief',
      'Kymezol',
      'Jertaris',
      'Laellium',
      'Memyts',
      'Presgera',
      'VIP.Shipping'
    )
  );
