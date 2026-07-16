-- Adiciona 5 novos produtos à tabela products e à constraint services_product_check:
-- Youth Within, Thermo Ignite, Glyco Barrier, Gluco Mild, Horsefil
-- (Joint Mend, Mind Wake e Quiet Nerves já existiam — adicionados em junho.)
-- Nomes padronizados em Title Case, seguindo a convenção do catálogo.
--
-- Também remove a duplicata 'Nathurex' da tabela products (mantém 'NATHUREX',
-- que é a variante usada em services/refunds e na constraint).

-- Remove duplicata de casing (nenhum service/refund usa a variante minúscula)
DELETE FROM public.products
WHERE name = 'Nathurex';

INSERT INTO public.products (id, name, updated_at)
VALUES
  (gen_random_uuid()::text, 'Youth Within', now()),
  (gen_random_uuid()::text, 'Thermo Ignite', now()),
  (gen_random_uuid()::text, 'Glyco Barrier', now()),
  (gen_random_uuid()::text, 'Gluco Mild', now()),
  (gen_random_uuid()::text, 'Horsefil', now())
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
      'Horsefil'
    )
  );
