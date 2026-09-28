-- Adiciona 'Golden Nerves' ao catálogo e recria services_product_check.
--
-- Pedido de 28/09/2026. Era o único item da lista de 23/09 que ainda faltava
-- (os outros já tinham entrado em 20260923120000).
--
-- Lembrete (ver 20260826140000): services.product NÃO é text livre. Toda inclusão
-- no catálogo do client exige recriar esta constraint aqui, senão o INSERT do
-- agente morre com 23514 (check_violation).

INSERT INTO public.products (id, name, updated_at)
VALUES
  (gen_random_uuid()::text, 'Golden Nerves', now())
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
      'Clear Gaze',
      'PagAmerican',
      'Jellyrock',
      'Blue Horse',
      'Nail Defender',
      'Mind Honey Trick',
      'Nerve Relief Protocol',
      'Lean Leg',
      'Soda Burn',
      'Nerve Stride',
      'Honey Vital',
      'Cardio Honey',
      'Gut Active',
      'Military Honey',
      'Golden Nerves'
    )
  );
