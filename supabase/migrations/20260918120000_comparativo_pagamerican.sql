-- Reembolso externo da PagAmerican: catálogo, tipo "não informado" e import.
--
-- A planilha da PagAmerican tem layout próprio (12 colunas, uma linha por
-- pedido) e nada em comum com o orders_export da Cartpanda. A decisão de
-- arquitetura é que a diferença morre na PORTA DE ENTRADA: o leitor do front
-- normaliza os dois formatos para as mesmas colunas de external_refunds, e
-- dashboard_external_refund_comparison NÃO MUDA. É isso que garante que
-- % interno, % externo, casamento e agregado sejam idênticos nas duas
-- plataformas — é literalmente a mesma função sobre a mesma tabela.
--
-- Esta migration só mexe no que fica ANTES da tabela.
--
-- ---------------------------------------------------------------------------
-- 1. Blue Horse no catálogo de produtos do agente
-- ---------------------------------------------------------------------------
-- Produto novo, que aparece na planilha da PagAmerican com 9 reembolsos.
-- Sem entrar no CHECK, o agente não consegue selecioná-lo num atendimento e a
-- linha do comparativo ficaria presa em 0% interno para sempre.
--
-- DROP + ADD NOT VALID + VALIDATE em vez de DROP + ADD: services tem 98.995
-- linhas / 49 MB, e ADD direto pega ACCESS EXCLUSIVE durante o scan inteiro.
-- Como a lista nova é superconjunto da antiga, nenhuma linha existente falha.
--
-- ---------------------------------------------------------------------------
-- 2. Tipo de reembolso "não informado"
-- ---------------------------------------------------------------------------
-- A Cartpanda diz em Payment status se o reembolso foi integral ou parcial.
-- A PagAmerican diz no Order Status, mas em 126 dos 622 reembolsos o status é
-- 'completed': o pedido tem valor e data de reembolso (então é reembolso de
-- verdade e precisa contar), só não diz de que tipo.
--
-- Tentou-se inferir pelo valor e NÃO dá: os valores de 'completed' se sobrepõem
-- aos de integral E aos de parcial, que já se sobrepõem entre si (Honeyfil:
-- parcial mediana 231, completed 316, integral 405). Regra por valor seria
-- chute com aparência de cálculo.
--
-- Então entra um terceiro valor, 'Refunded (unspecified)'. Ele NÃO afeta conta
-- nenhuma: % interno e % externo saem de external_count (todas as linhas) e do
-- interno, e nunca olham o tipo. O tipo só alimenta a coluna
-- "Integral / parcial" e a marca de divergência de tipo. Na Cartpanda o terceiro
-- valor nunca aparece e a tela fica idêntica.
--
-- Pendência para a PagAmerican: "'completed' com valor de reembolso é parcial ou
-- integral?". Se responderem, é um UPDATE e uma linha no leitor.
--
-- ---------------------------------------------------------------------------
-- 3. manager_import_external_refunds aceita o terceiro tipo
-- ---------------------------------------------------------------------------
-- Hoje a função DESCARTA (conta em skipped) qualquer linha cujo payment_status
-- não seja um dos dois. Sem esta mudança, os 126 sumiriam na importação.
-- É a única alteração na função; o resto é o texto de produção, idêntico.

BEGIN;

-- 1 -------------------------------------------------------------------------
ALTER TABLE public.services DROP CONSTRAINT services_product_check;

ALTER TABLE public.services ADD CONSTRAINT services_product_check
  CHECK (product = ANY (ARRAY[
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
    'Blue Horse'
  ]::text[])) NOT VALID;

ALTER TABLE public.services VALIDATE CONSTRAINT services_product_check;

-- 2 -------------------------------------------------------------------------
ALTER TABLE public.external_refunds DROP CONSTRAINT external_refunds_payment_status_check;

ALTER TABLE public.external_refunds ADD CONSTRAINT external_refunds_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'Refunded'::text,
    'Partially refunded'::text,
    'Refunded (unspecified)'::text
  ]));

COMMENT ON COLUMN public.external_refunds.payment_status IS
  'Tipo do reembolso na plataforma: Refunded (integral), Partially refunded (parcial) ou '
  'Refunded (unspecified) quando o arquivo confirma o reembolso mas não diz o tipo '
  '(PagAmerican, Order Status = completed). Não entra em nenhum cálculo de percentual.';

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manager_import_external_refunds(p_product text, p_month_ref date, p_source_file text, p_rows jsonb, p_platform text DEFAULT 'Cartpanda'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_manager  text;
  v_total    int := 0;
  v_valid    int := 0;
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_product IS NULL OR btrim(p_product) = '' THEN
    RAISE EXCEPTION 'p_product is required';
  END IF;
  IF p_month_ref IS NULL THEN
    RAISE EXCEPTION 'p_month_ref is required';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('Cartpanda', 'Buygoods', 'PagAmerican') THEN
    RAISE EXCEPTION 'p_platform must be Cartpanda, Buygoods or PagAmerican';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_manager := auth.uid()::text;
  v_total := jsonb_array_length(p_rows);

  DROP TABLE IF EXISTS tmp_ext_rows;
  CREATE TEMP TABLE tmp_ext_rows ON COMMIT DROP AS
  SELECT
    NULLIF(btrim(r->>'order_name'), '')                                   AS order_name,
    CASE WHEN (r->>'order_date') ~ '^\d{4}-\d{2}-\d{2}$'
         THEN (r->>'order_date')::date END                                AS order_date,
    NULLIF(btrim(r->>'address'), '')                                      AS address,
    NULLIF(btrim(r->>'address2'), '')                                     AS address2,
    NULLIF(btrim(r->>'zip'), '')                                          AS zip,
    NULLIF(btrim(r->>'city'), '')                                         AS city,
    NULLIF(btrim(r->>'province'), '')                                     AS province,
    COALESCE(NULLIF(btrim(r->>'product_count'), '')::smallint, 1)         AS product_count,
    CASE WHEN (r->>'product_id') ~ '^\d+$' THEN (r->>'product_id')::bigint END AS product_id,
    CASE WHEN (r->>'variant_id') ~ '^\d+$' THEN (r->>'variant_id')::bigint ELSE 0 END AS variant_id,
    NULLIF(btrim(r->>'full_name'), '')                                    AS full_name,
    NULLIF(regexp_replace(COALESCE(r->>'mobile_no', ''), '\s', '', 'g'), '') AS mobile_no,
    NULLIF(btrim(r->>'shipping_method'), '')                              AS shipping_method,
    NULLIF(btrim(r->>'status'), '')                                       AS status,
    CASE WHEN (r->>'refund_amount') ~ '^-?\d+(\.\d+)?$'
         THEN round((r->>'refund_amount')::numeric, 2) ELSE 0 END         AS refund_amount,
    NULLIF(btrim(r->>'payment_status'), '')                               AS payment_status,
    NULLIF(btrim(r->>'tracking_code'), '')                                AS tracking_code,
    COALESCE(NULLIF(btrim(r->>'product_name'), ''), '(sem nome)')         AS product_name,
    NULLIF(btrim(r->>'variant_name'), '')                                 AS variant_name,
    NULLIF(btrim(r->>'raw_date'), '')                                     AS raw_date
  FROM jsonb_array_elements(p_rows) AS r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_name', order_name, 'order_date', raw_date, 'payment_status', payment_status
         )) FILTER (WHERE rn <= 5), '[]'::jsonb)
    INTO v_skipped
    FROM (
      SELECT *, row_number() OVER () AS rn
      FROM tmp_ext_rows
      WHERE order_name IS NULL
         OR order_date IS NULL
         OR payment_status IS NULL
         OR payment_status NOT IN ('Refunded', 'Partially refunded', 'Refunded (unspecified)')
    ) s;

  -- Dentro do mesmo lote, a mesma chave natural só entra uma vez (última vence).
  WITH valid AS (
    SELECT DISTINCT ON (order_name, variant_id) *
    FROM tmp_ext_rows
    WHERE order_name IS NOT NULL
      AND order_date IS NOT NULL
      AND payment_status IN ('Refunded', 'Partially refunded', 'Refunded (unspecified)')
    ORDER BY order_name, variant_id
  ),
  up AS (
    INSERT INTO public.external_refunds (
      platform, product, month_ref, source_file, order_date, order_name,
      address, address2, zip, city, province, product_count, product_id, variant_id,
      full_name, mobile_no, shipping_method, status, refund_amount, payment_status,
      tracking_code, product_name, variant_name, raw_date, imported_by
    )
    SELECT
      p_platform, btrim(p_product), p_month_ref, COALESCE(NULLIF(btrim(p_source_file), ''), 'sem-nome.csv'),
      order_date, order_name,
      address, address2, zip, city, province, product_count, product_id, variant_id,
      full_name, mobile_no, shipping_method, status, refund_amount, payment_status,
      tracking_code, product_name, variant_name, raw_date, v_manager
    FROM valid
    ON CONFLICT (platform, product, order_name, variant_id) DO UPDATE SET
      month_ref       = EXCLUDED.month_ref,
      source_file     = EXCLUDED.source_file,
      order_date      = EXCLUDED.order_date,
      address         = EXCLUDED.address,
      address2        = EXCLUDED.address2,
      zip             = EXCLUDED.zip,
      city            = EXCLUDED.city,
      province        = EXCLUDED.province,
      product_count   = EXCLUDED.product_count,
      product_id      = EXCLUDED.product_id,
      full_name       = EXCLUDED.full_name,
      mobile_no       = EXCLUDED.mobile_no,
      shipping_method = EXCLUDED.shipping_method,
      status          = EXCLUDED.status,
      refund_amount   = EXCLUDED.refund_amount,
      payment_status  = EXCLUDED.payment_status,
      tracking_code   = EXCLUDED.tracking_code,
      product_name    = EXCLUDED.product_name,
      variant_name    = EXCLUDED.variant_name,
      raw_date        = EXCLUDED.raw_date,
      imported_by     = EXCLUDED.imported_by,
      imported_at     = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted), count(*)
    INTO v_inserted, v_updated, v_valid
    FROM up;

  RETURN jsonb_build_object(
    'total',           v_total,
    'valid',           v_valid,
    'inserted',        v_inserted,
    'updated',         v_updated,
    'skipped',         v_total - v_valid,
    'skipped_samples', v_skipped,
    'orders',          (SELECT count(DISTINCT order_name) FROM tmp_ext_rows WHERE order_name IS NOT NULL)
  );
END;
$function$;

COMMIT;
