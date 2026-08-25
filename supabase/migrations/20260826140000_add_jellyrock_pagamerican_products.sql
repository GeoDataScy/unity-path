-- Adiciona 'Jellyrock' e 'PagAmerican' à tabela products e à constraint
-- services_product_check.
--
-- Motivo: os dois já estavam nos selects do agente (PRODUCTS/REFUND_PRODUCTS),
-- mas nunca entraram na constraint. Resultado: escolher Jellyrock em
-- /workspace derrubava o INSERT em services com 23514 (check_violation) e o
-- agente só via o toast genérico "Erro ao registrar". Reembolso funcionava
-- porque refunds.product não tem CHECK — só services tem.
--
-- Confirmado em prod antes desta migration: 0 tickets e 0 reembolsos com
-- 'Jellyrock' ou 'PagAmerican' — nenhum registro ficou perdido, o insert
-- sempre falhou.
--
-- ATENÇÃO para o próximo produto novo: services.product NÃO é text livre.
-- Toda inclusão no catálogo do client exige recriar esta constraint aqui.

INSERT INTO public.products (id, name, updated_at)
VALUES
  (gen_random_uuid()::text, 'PagAmerican', now()),
  (gen_random_uuid()::text, 'Jellyrock', now())
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
      'Jellyrock'
    )
  );
