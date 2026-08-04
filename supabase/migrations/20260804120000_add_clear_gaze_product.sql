-- Adiciona o produto Clear Gaze à tabela products e à constraint services_product_check.
-- Nome padronizado em Title Case, seguindo a convenção do catálogo (ver Gluco Mild, Honeyfil).

INSERT INTO public.products (id, name, updated_at)
VALUES (gen_random_uuid()::text, 'Clear Gaze', now())
ON CONFLICT (name) DO NOTHING;

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
      'Steelpower',
      'Gluco Off',
      'Cognivex',
      'Nad Dermal+',
      'Alpharock',
      'Hair Bloom',
      'Guardon',
      'Joint Mend',
      'Keskara',
      'Lipolegs',
      'LipoShape',
      'Mind Recall',
      'Mind Wake',
      'Prostate Vital',
      'Quiet Nerves',
      'Quiet Rest',
      'RingSilence',
      'FlowStrong',
      'Youth Within',
      'Thermo Ignite',
      'Glyco Barrier',
      'Gluco Mild',
      'Horsefil',
      'Honeyfil',
      'Clear Gaze'
    )
  );
