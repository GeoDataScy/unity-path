-- Ensure shared updated_at trigger function exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Products master table
CREATE TABLE IF NOT EXISTS public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep timestamps updated (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_products_updated_at'
  ) THEN
    CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users
DROP POLICY IF EXISTS "Products are readable by authenticated users" ON public.products;
CREATE POLICY "Products are readable by authenticated users"
ON public.products
FOR SELECT
TO authenticated
USING (true);

-- Seed: new active product list
INSERT INTO public.products (name, is_active)
VALUES
  ('Biografa', true),
  ('Cetacondor', true),
  ('Cetadusse', true),
  ('Feilaira', true),
  ('Arialief', true),
  ('Alphacur', true),
  ('Sciatilief', true),
  ('Presgera', true),
  ('Goldenfrib', true),
  ('Blinzador', true),
  ('Laellium', true),
  ('Felaromi', true),
  ('Tenurima', true),
  ('Ariovira', true),
  ('CucuDrops', true),
  ('Zalovira', true),
  ('Xelovita', true),
  ('Kymezol', true),
  ('Cerami', true),
  ('Garaherb', true),
  ('NATHUREX', true),
  ('Mahgryn', true),
  ('Levhyn', true),
  ('Ariomyx', true),
  ('Memyts', true),
  ('Alitoryn', true),
  ('Karylief', true),
  ('Athentys', true),
  ('Velynivo', true),
  ('Mioralab', true),
  ('Jertaris', true),
  ('Vergolief', true),
  ('Olisteren', true),
  ('Halegryn', true),
  ('Danmyts', true),
  ('Maizkidor', true),
  ('Basmontex', true),
  ('Fraganief', true),
  ('Ceramiri', true),
  ('Shapeon', true),
  ('Nexburn', true),
  ('Memoryon', true),
  ('Korvizol', true),
  ('Erectozyn', true),
  ('Thewellnesswize', true)
ON CONFLICT (name) DO UPDATE SET is_active = EXCLUDED.is_active;

-- Seed: legacy products as inactive to avoid breaking old records
INSERT INTO public.products (name, is_active)
VALUES
  ('VIP.Shipping', false)
ON CONFLICT (name) DO UPDATE SET is_active = EXCLUDED.is_active;

-- Replace old CHECK constraint with FK to products(name)
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_product_check;

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_product_fkey;

ALTER TABLE public.services
  ADD CONSTRAINT services_product_fkey
  FOREIGN KEY (product)
  REFERENCES public.products(name)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_products_is_active_name ON public.products (is_active, name);
CREATE INDEX IF NOT EXISTS idx_services_product ON public.services (product);
