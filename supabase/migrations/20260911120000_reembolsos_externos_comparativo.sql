-- Comparativo de reembolsos: base interna (refunds, registrada pelos agentes)
-- × exports das lojas (CSV "orders_export" das plataformas de venda).
--
-- Contexto: a gestora recebe, por loja/produto e por mês, um CSV com os pedidos
-- reembolsados na plataforma (uma linha por item do pedido; o valor "Refund" é
-- do pedido e se repete em cada linha). Esses arquivos NÃO trazem o total de
-- pedidos vendidos — só os reembolsados — então o que dá para comparar é o
-- volume de reembolsos dos dois lados, pedido a pedido, pelo número do pedido
-- (interno `1896` na Cartpanda = externo `#1896`).
--
-- Peças:
--   1. public.normalize_order_number(text) — chave de junção dos dois lados.
--   2. public.external_refunds — uma linha por linha do CSV, com o produto já
--      no nome do catálogo interno (a gestora escolhe o produto ao importar).
--      UNIQUE (product, order_name, variant_id) impede duplicar o mesmo pedido;
--      reimportar o mesmo arquivo só atualiza a linha.
--   3. manager_import_external_refunds(...) — upsert em lote, só gestora.
--   4. dashboard_external_refund_comparison(...) — números da tela, jsonb.
--
-- Regras de data: interno conta pela request_date (data em que o cliente pediu),
-- externo pela coluna Date do export (data do pedido). O casamento é feito no
-- período inteiro selecionado; o par casado é bucketado no mês do pedido externo
-- e o "só interno" no mês da request_date. Por isso, dentro de UM mês,
-- interno pode ser ≠ casados + só interno (pedido de julho, reembolso pedido em
-- agosto). Nos totais do período as contas fecham.

-- ---------------------------------------------------------------------------
-- 1. Normalização do número do pedido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_order_number(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT NULLIF(upper(ltrim(btrim(COALESCE(p, '')), '#')), '');
$$;

COMMENT ON FUNCTION public.normalize_order_number(text) IS
  'Chave de junção pedido interno × externo: tira espaços e o # inicial, deixa maiúsculo; vazio vira NULL.';

-- ---------------------------------------------------------------------------
-- 2. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_refunds (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product          text        NOT NULL,             -- nome do catálogo interno (ex.: 'Honeyfil')
  month_ref        date        NOT NULL,             -- 1º dia do mês do arquivo
  source_file      text        NOT NULL,             -- nome do CSV importado
  order_date       date        NOT NULL,             -- coluna Date do export (YYYY/DD/MM no arquivo)
  order_name       text        NOT NULL,             -- '#1896'
  order_number     text        GENERATED ALWAYS AS (public.normalize_order_number(order_name)) STORED,
  address          text,
  address2         text,
  zip              text,
  city             text,
  province         text,
  product_count    smallint    NOT NULL DEFAULT 1,
  product_id       bigint,
  variant_id       bigint      NOT NULL DEFAULT 0,
  full_name        text,
  mobile_no        text,
  shipping_method  text,
  status           text,                             -- 'Fulfilled' | 'Open'
  refund_amount    numeric(12,2) NOT NULL DEFAULT 0, -- valor do PEDIDO, repetido em cada item
  payment_status   text        NOT NULL,             -- 'Refunded' | 'Partially refunded'
  tracking_code    text,
  product_name     text        NOT NULL,             -- nome do item na loja (upsell incluso)
  variant_name     text,
  raw_date         text,                             -- valor original da coluna Date, para auditoria
  imported_by      text,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_refunds_natural_key UNIQUE (product, order_name, variant_id),
  CONSTRAINT external_refunds_payment_status_check
    CHECK (payment_status IN ('Refunded', 'Partially refunded'))
);

COMMENT ON TABLE public.external_refunds IS
  'Pedidos reembolsados segundo o export da loja (uma linha por item). Comparado com public.refunds na aba Reembolsos da gestora.';

CREATE INDEX IF NOT EXISTS idx_external_refunds_product_date
  ON public.external_refunds (product, order_date);
CREATE INDEX IF NOT EXISTS idx_external_refunds_product_order
  ON public.external_refunds (product, order_number);
CREATE INDEX IF NOT EXISTS idx_external_refunds_source_file
  ON public.external_refunds (source_file);

-- Lado interno da junção (refunds não tinha índice em order_id nem product).
CREATE INDEX IF NOT EXISTS idx_refunds_product_order_number
  ON public.refunds (product, public.normalize_order_number(order_id));

ALTER TABLE public.external_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_refunds_manager_all" ON public.external_refunds;
CREATE POLICY "external_refunds_manager_all"
  ON public.external_refunds
  FOR ALL
  USING ((SELECT public.is_manager()))
  WITH CHECK ((SELECT public.is_manager()));

-- A Lya (sandbox SQL só-leitura) enxerga as outras tabelas de reembolso; esta
-- segue o mesmo padrão.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lya_sql_ro') THEN
    EXECUTE 'GRANT SELECT ON public.external_refunds TO lya_sql_ro';
    EXECUTE 'DROP POLICY IF EXISTS "lya_sql_ro read" ON public.external_refunds';
    EXECUTE 'CREATE POLICY "lya_sql_ro read" ON public.external_refunds FOR SELECT TO lya_sql_ro USING (true)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Import em lote (gestora)
-- ---------------------------------------------------------------------------
-- p_rows: array JSON com as colunas do CSV já normalizadas pelo cliente:
--   order_date (YYYY-MM-DD), order_name, address, address2, zip, city, province,
--   product_count, product_id, variant_id, full_name, mobile_no, shipping_method,
--   status, refund_amount, payment_status, tracking_code, product_name,
--   variant_name, raw_date.
-- Linha sem order_name, sem data válida ou com payment_status desconhecido é
-- ignorada e contada em `skipped` (com amostra em `skipped_samples`).
CREATE OR REPLACE FUNCTION public.manager_import_external_refunds(
  p_product     text,
  p_month_ref   date,
  p_source_file text,
  p_rows        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
         OR payment_status NOT IN ('Refunded', 'Partially refunded')
    ) s;

  -- Dentro do mesmo lote, a mesma chave natural só entra uma vez (última vence).
  WITH valid AS (
    SELECT DISTINCT ON (order_name, variant_id) *
    FROM tmp_ext_rows
    WHERE order_name IS NOT NULL
      AND order_date IS NOT NULL
      AND payment_status IN ('Refunded', 'Partially refunded')
    ORDER BY order_name, variant_id
  ),
  up AS (
    INSERT INTO public.external_refunds (
      product, month_ref, source_file, order_date, order_name,
      address, address2, zip, city, province, product_count, product_id, variant_id,
      full_name, mobile_no, shipping_method, status, refund_amount, payment_status,
      tracking_code, product_name, variant_name, raw_date, imported_by
    )
    SELECT
      btrim(p_product), p_month_ref, COALESCE(NULLIF(btrim(p_source_file), ''), 'sem-nome.csv'),
      order_date, order_name,
      address, address2, zip, city, province, product_count, product_id, variant_id,
      full_name, mobile_no, shipping_method, status, refund_amount, payment_status,
      tracking_code, product_name, variant_name, raw_date, v_manager
    FROM valid
    ON CONFLICT (product, order_name, variant_id) DO UPDATE SET
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
$$;

REVOKE ALL ON FUNCTION public.manager_import_external_refunds(text, date, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_import_external_refunds(text, date, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Comparativo (tela da gestora)
-- ---------------------------------------------------------------------------
-- Retorna:
--   summary            — totais do período (interno, externo, casados, só um lado, valor externo)
--   products           — produtos que existem na base externa (com contagem no período)
--   by_product_month[] — uma linha por produto × mês
--   by_product[]       — uma linha por produto (totais do período)
--   divergences        — { total_count, rows[] } paginado; kind ∈ interno|externo|ambos
--
-- Só entram no interno os produtos que existem em external_refunds (a base
-- interna é mais completa que os arquivos; o comparativo é restrito ao que dá
-- para comparar).
CREATE OR REPLACE FUNCTION public.dashboard_external_refund_comparison(
  from_date         date,
  to_date           date,
  product_filter    text DEFAULT NULL,
  divergence_filter text DEFAULT 'all',
  page_size         int  DEFAULT 50,
  page_offset       int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
-- Sem STABLE de propósito: a função usa tabelas temporárias (CREATE TABLE AS
-- não é permitido em função não volátil). Não escreve nada permanente.
DECLARE
  v_size int := LEAST(GREATEST(COALESCE(page_size, 50), 1), 200);
  v_off  int := GREATEST(COALESCE(page_offset, 0), 0);
  v_product text := NULLIF(NULLIF(btrim(COALESCE(product_filter, '')), ''), 'all');
  v_kind text := COALESCE(NULLIF(btrim(divergence_filter), ''), 'all');
  v_summary jsonb;
  v_products jsonb;
  v_imports jsonb;
  v_by_pm jsonb;
  v_by_p jsonb;
  v_div_total bigint;
  v_div_rows jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Chamadas repetidas na mesma transação (ex.: testes) não podem colidir.
  DROP TABLE IF EXISTS tmp_ext_all, tmp_int_all, tmp_match, tmp_ext, tmp_int, tmp_div;

  -- Universo externo: uma linha por pedido (o CSV repete o pedido por item e
  -- refund_amount é do pedido). Sem filtro de data: o casamento olha a base
  -- inteira, porque o pedido pode ser de um mês e o reembolso interno de outro.
  CREATE TEMP TABLE tmp_ext_all ON COMMIT DROP AS
  SELECT DISTINCT ON (e.product, e.order_number)
         e.product,
         e.order_number,
         e.order_name,
         e.order_date,
         to_char(e.order_date, 'YYYY-MM') AS month,
         e.refund_amount,
         e.payment_status,
         e.status,
         e.full_name
    FROM public.external_refunds e
   WHERE (v_product IS NULL OR e.product = v_product)
   ORDER BY e.product, e.order_number, e.imported_at DESC;

  -- Universo interno: só os produtos que existem na base externa, sem filtro de data.
  CREATE TEMP TABLE tmp_int_all ON COMMIT DROP AS
  SELECT r.id,
         r.product,
         public.normalize_order_number(r.order_id) AS order_number,
         r.order_id,
         r.request_date::date AS request_date,
         to_char(r.request_date::date, 'YYYY-MM') AS month,
         CASE WHEN r.completion_date ~ '^\d{4}-\d{2}-\d{2}' THEN r.completion_date::date END AS completion_date,
         r.refund_type,
         r.refund_value,
         r.sales_platform,
         r.channel,
         r.customer_email,
         p.full_name AS agent_name
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE r.request_date ~ '^\d{4}-\d{2}-\d{2}'
     AND r.product IN (SELECT DISTINCT product FROM public.external_refunds)
     AND (v_product IS NULL OR r.product = v_product);

  -- Casamento: mesmo produto + mesmo número de pedido, na base inteira.
  CREATE TEMP TABLE tmp_match ON COMMIT DROP AS
  SELECT DISTINCT e.product, e.order_number
    FROM tmp_ext_all e
    JOIN tmp_int_all i ON i.product = e.product AND i.order_number = e.order_number
   WHERE e.order_number IS NOT NULL;

  -- Recortes do período (o que a tela conta).
  CREATE TEMP TABLE tmp_ext ON COMMIT DROP AS
  SELECT * FROM tmp_ext_all WHERE order_date BETWEEN from_date AND to_date;

  CREATE TEMP TABLE tmp_int ON COMMIT DROP AS
  SELECT * FROM tmp_int_all WHERE request_date BETWEEN from_date AND to_date;

  -- Produtos disponíveis para o filtro (toda a base externa, com contagem no período).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product', p.product,
           'external_orders', COALESCE(c.n, 0)
         ) ORDER BY p.product), '[]'::jsonb)
    INTO v_products
    FROM (SELECT DISTINCT product FROM public.external_refunds) p
    LEFT JOIN (
      SELECT product, count(*) AS n FROM tmp_ext GROUP BY product
    ) c ON c.product = p.product;

  -- Lotes importados (para a tela mostrar o que já entrou).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product', product, 'month_ref', month_ref, 'source_file', source_file,
           'rows', n_rows, 'orders', n_orders, 'imported_at', imported_at
         ) ORDER BY product, month_ref), '[]'::jsonb)
    INTO v_imports
    FROM (
      SELECT product, month_ref, source_file,
             count(*) AS n_rows, count(DISTINCT order_number) AS n_orders, max(imported_at) AS imported_at
        FROM public.external_refunds
       GROUP BY product, month_ref, source_file
    ) b;

  -- Produto × mês.
  WITH months AS (
    SELECT product, month FROM tmp_ext
    UNION
    SELECT product, month FROM tmp_int
  ),
  ext AS (
    SELECT e.product, e.month,
           count(*) AS external_count,
           count(*) FILTER (WHERE m.order_number IS NOT NULL) AS matched_count,
           count(*) FILTER (WHERE e.payment_status = 'Refunded') AS external_full,
           count(*) FILTER (WHERE e.payment_status = 'Partially refunded') AS external_partial,
           COALESCE(sum(e.refund_amount), 0) AS external_amount
      FROM tmp_ext e
      LEFT JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number
     GROUP BY e.product, e.month
  ),
  intr AS (
    SELECT i.product, i.month,
           count(*) AS internal_count,
           count(*) FILTER (WHERE m.order_number IS NULL) AS internal_only,
           count(*) FILTER (WHERE i.completion_date IS NULL) AS internal_open,
           count(*) FILTER (WHERE i.order_number IS NULL) AS internal_without_order
      FROM tmp_int i
      LEFT JOIN tmp_match m ON m.product = i.product AND m.order_number = i.order_number
     GROUP BY i.product, i.month
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product',                mo.product,
           'month',                  mo.month,
           'internal_count',         COALESCE(intr.internal_count, 0),
           'internal_only',          COALESCE(intr.internal_only, 0),
           'internal_open',          COALESCE(intr.internal_open, 0),
           'internal_without_order', COALESCE(intr.internal_without_order, 0),
           'external_count',         COALESCE(ext.external_count, 0),
           'external_only',          COALESCE(ext.external_count, 0) - COALESCE(ext.matched_count, 0),
           'matched_count',          COALESCE(ext.matched_count, 0),
           'external_full',          COALESCE(ext.external_full, 0),
           'external_partial',       COALESCE(ext.external_partial, 0),
           'external_amount',        COALESCE(ext.external_amount, 0),
           'coverage_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN round(100.0 * COALESCE(ext.matched_count, 0) / ext.external_count, 1)
                                          ELSE NULL END
         ) ORDER BY mo.product, mo.month), '[]'::jsonb)
    INTO v_by_pm
    FROM months mo
    LEFT JOIN ext  ON ext.product = mo.product AND ext.month = mo.month
    LEFT JOIN intr ON intr.product = mo.product AND intr.month = mo.month;

  -- Por produto (período inteiro).
  WITH prods AS (
    SELECT product FROM tmp_ext UNION SELECT product FROM tmp_int
  ),
  ext AS (
    SELECT e.product,
           count(*) AS external_count,
           count(*) FILTER (WHERE m.order_number IS NOT NULL) AS matched_count,
           count(*) FILTER (WHERE e.payment_status = 'Refunded') AS external_full,
           count(*) FILTER (WHERE e.payment_status = 'Partially refunded') AS external_partial,
           COALESCE(sum(e.refund_amount), 0) AS external_amount
      FROM tmp_ext e
      LEFT JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number
     GROUP BY e.product
  ),
  intr AS (
    SELECT i.product,
           count(*) AS internal_count,
           count(*) FILTER (WHERE m.order_number IS NULL) AS internal_only,
           count(*) FILTER (WHERE i.completion_date IS NULL) AS internal_open,
           count(*) FILTER (WHERE i.order_number IS NULL) AS internal_without_order
      FROM tmp_int i
      LEFT JOIN tmp_match m ON m.product = i.product AND m.order_number = i.order_number
     GROUP BY i.product
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product',                p.product,
           'internal_count',         COALESCE(intr.internal_count, 0),
           'internal_only',          COALESCE(intr.internal_only, 0),
           'internal_open',          COALESCE(intr.internal_open, 0),
           'internal_without_order', COALESCE(intr.internal_without_order, 0),
           'external_count',         COALESCE(ext.external_count, 0),
           'external_only',          COALESCE(ext.external_count, 0) - COALESCE(ext.matched_count, 0),
           'matched_count',          COALESCE(ext.matched_count, 0),
           'external_full',          COALESCE(ext.external_full, 0),
           'external_partial',       COALESCE(ext.external_partial, 0),
           'external_amount',        COALESCE(ext.external_amount, 0),
           'coverage_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN round(100.0 * COALESCE(ext.matched_count, 0) / ext.external_count, 1)
                                          ELSE NULL END
         ) ORDER BY p.product), '[]'::jsonb)
    INTO v_by_p
    FROM prods p
    LEFT JOIN ext  ON ext.product = p.product
    LEFT JOIN intr ON intr.product = p.product;

  -- Totais do período.
  SELECT jsonb_build_object(
           'from_date',              from_date,
           'to_date',                to_date,
           'product_filter',         v_product,
           'internal_count',         (SELECT count(*) FROM tmp_int),
           'internal_only',          (SELECT count(*) FROM tmp_int i
                                       LEFT JOIN tmp_match m ON m.product = i.product AND m.order_number = i.order_number
                                       WHERE m.order_number IS NULL),
           'internal_without_order', (SELECT count(*) FROM tmp_int WHERE order_number IS NULL),
           'external_count',         (SELECT count(*) FROM tmp_ext),
           'external_only',          (SELECT count(*) FROM tmp_ext e
                                       LEFT JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number
                                       WHERE m.order_number IS NULL),
           'matched_count',          (SELECT count(*) FROM tmp_ext e
                                       JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number),
           'external_full',          (SELECT count(*) FROM tmp_ext WHERE payment_status = 'Refunded'),
           'external_partial',       (SELECT count(*) FROM tmp_ext WHERE payment_status = 'Partially refunded'),
           'external_amount',        (SELECT COALESCE(sum(refund_amount), 0) FROM tmp_ext),
           'coverage_pct',           CASE WHEN (SELECT count(*) FROM tmp_ext) > 0
                                          THEN round(100.0 * (SELECT count(*) FROM tmp_ext e JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number) / (SELECT count(*) FROM tmp_ext), 1)
                                          ELSE NULL END
         )
    INTO v_summary;

  -- Divergências pedido a pedido (paginado).
  -- Externo do período × qualquer interno do mesmo pedido (mesmo fora do
  -- período); interno do período sem par externo entra como "interno".
  CREATE TEMP TABLE tmp_div ON COMMIT DROP AS
  WITH int_one AS (
    -- Um pedido pode ter mais de um reembolso interno; mostra um por pedido
    -- (o mais recente) para a lista não repetir a linha externa.
    SELECT DISTINCT ON (product, order_number) *
      FROM tmp_int_all
     WHERE order_number IS NOT NULL
     ORDER BY product, order_number, request_date DESC, id
  ),
  paired AS (
    SELECT e.*, i.id AS internal_id, i.order_id AS internal_order_id, i.request_date, i.completion_date,
           i.refund_type, i.refund_value, i.sales_platform, i.channel, i.customer_email, i.agent_name
      FROM tmp_ext e
      LEFT JOIN int_one i ON i.product = e.product AND i.order_number = e.order_number
  ),
  internal_only AS (
    SELECT i.*
      FROM tmp_int i
      LEFT JOIN tmp_match m ON m.product = i.product AND m.order_number = i.order_number
     WHERE m.order_number IS NULL
  )
  SELECT
    CASE WHEN internal_id IS NOT NULL THEN 'ambos' ELSE 'externo' END AS kind,
    product, order_number, order_name, internal_order_id,
    order_date AS external_date,
    request_date AS internal_request_date,
    completion_date AS internal_completion_date,
    payment_status, status AS external_status, refund_amount,
    refund_type, refund_value, sales_platform, channel,
    full_name AS customer_name, customer_email, agent_name,
    (internal_id IS NOT NULL AND refund_type IS NOT NULL AND (
       (payment_status = 'Refunded' AND refund_type <> '100%') OR
       (payment_status = 'Partially refunded' AND refund_type = '100%')
    )) AS type_mismatch,
    order_date AS sort_date
  FROM paired
  UNION ALL
  SELECT 'interno', product, order_number, NULL, order_id,
         NULL, request_date, completion_date,
         NULL, NULL, NULL,
         refund_type, refund_value, sales_platform, channel,
         NULL, customer_email, agent_name,
         false,
         request_date
    FROM internal_only;

  SELECT count(*) INTO v_div_total
    FROM tmp_div
   WHERE v_kind = 'all' OR kind = v_kind OR (v_kind = 'tipo' AND type_mismatch);

  SELECT COALESCE(jsonb_agg(to_jsonb(d) - 'sort_date'), '[]'::jsonb)
    INTO v_div_rows
    FROM (
      SELECT *
        FROM tmp_div
       WHERE v_kind = 'all' OR kind = v_kind OR (v_kind = 'tipo' AND type_mismatch)
       ORDER BY sort_date DESC, product, order_number NULLS LAST
       LIMIT v_size OFFSET v_off
    ) d;

  v_summary := v_summary || jsonb_build_object(
    'type_mismatch_count', (SELECT count(*) FROM tmp_div WHERE type_mismatch)
  );

  RETURN jsonb_build_object(
    'summary',          v_summary,
    'products',         v_products,
    'imports',          v_imports,
    'by_product_month', v_by_pm,
    'by_product',       v_by_p,
    'divergences',      jsonb_build_object('total_count', v_div_total, 'rows', v_div_rows)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_external_refund_comparison(date, date, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_external_refund_comparison(date, date, text, text, int, int) TO authenticated;
