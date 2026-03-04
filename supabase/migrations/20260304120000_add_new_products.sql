-- Add new products: Shaapeon, VisualEase, NerveEase, Steelpower
-- Drop and re-create the services_product_check constraint with the full product list

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_product_check;

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
      'Biografa',
      'Cetacondor',
      'Cetadusse',
      'Sciatilief',
      'Goldenfrib',
      'Felaromi',
      'Tenurima',
      'Ariovira',
      'CucuDrops',
      'Zalovira',
      'Xelovita',
      'Cerami',
      'NATHUREX',
      'Mahgryn',
      'Levhyn',
      'Ariomyx',
      'Alitoryn',
      'Athentys',
      'Velynivo',
      'Mioralab',
      'Vergolief',
      'Olisteren',
      'Halegryn',
      'Danmyts',
      'Maizkidor',
      'Basmontex',
      'Fraganief',
      'Ceramiri',
      'Shapeon',
      'Nexburn',
      'Memoryon',
      'Korvizol',
      'Erectozyn',
      'Thewellnesswize',
      'VIP.Shipping',
      'VisualEase',
      'NerveEase',
      'Steelpower'
    )
  );
