-- Adiciona 10 produtos novos ao catálogo e recria services_product_check.
--
-- Produtos novos (pedido de 23/09/2026):
--   Nail Defender, Mind Honey Trick, Nerve Relief Protocol, Lean Leg, Soda Burn,
--   Nerve Stride, Honey Vital, Cardio Honey, Gut Active, Military Honey
--
-- 'Joit Mend' veio no pedido original, mas era erro de digitação de 'Joint Mend',
-- que já está no catálogo desde 20260716140000 — nada foi adicionado por ele.
--
-- Lembrete (ver 20260826140000): services.product NÃO é text livre. Toda inclusão
-- no catálogo do client exige recriar esta constraint aqui, senão o INSERT do
-- agente morre com 23514 (check_violation) e ele só vê o toast genérico.
-- refunds.product e radar_items.product continuam sem CHECK.
--
-- O segundo INSERT corrige uma defasagem antiga da tabela de registro
-- public.products (nenhuma tela lê essa tabela): VisualEase, NerveEase,
-- Steelpower e Blue Horse estão na constraint e nos selects, mas nunca foram
-- inseridos ali.

INSERT INTO public.products (id, name, updated_at)
VALUES
  (gen_random_uuid()::text, 'Nail Defender', now()),
  (gen_random_uuid()::text, 'Mind Honey Trick', now()),
  (gen_random_uuid()::text, 'Nerve Relief Protocol', now()),
  (gen_random_uuid()::text, 'Lean Leg', now()),
  (gen_random_uuid()::text, 'Soda Burn', now()),
  (gen_random_uuid()::text, 'Nerve Stride', now()),
  (gen_random_uuid()::text, 'Honey Vital', now()),
  (gen_random_uuid()::text, 'Cardio Honey', now()),
  (gen_random_uuid()::text, 'Gut Active', now()),
  (gen_random_uuid()::text, 'Military Honey', now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.products (id, name, updated_at)
VALUES
  (gen_random_uuid()::text, 'VisualEase', now()),
  (gen_random_uuid()::text, 'NerveEase', now()),
  (gen_random_uuid()::text, 'Steelpower', now()),
  (gen_random_uuid()::text, 'Blue Horse', now())
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
      'Military Honey'
    )
  );
