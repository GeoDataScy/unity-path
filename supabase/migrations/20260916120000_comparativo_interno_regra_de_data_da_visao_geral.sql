-- Comparativo: o lado interno passa a contar com a MESMA regra de data da
-- Visão geral de Reembolsos.
--
-- Sintoma relatado pela gestora: filtrando Alpharock em agosto/2026, a Visão
-- geral mostra 13 reembolsos na Cartpanda e o comparativo mostra 19 no interno.
-- Os dois números estavam certos pela sua própria regra — e as regras eram
-- diferentes:
--
--   Visão geral (dashboard_refund_metrics, desde 20260430090000, e a Auditoria
--   desde 20260827120000): reembolso EM ABERTO conta pela request_date;
--   reembolso CONCLUÍDO conta pela completion_date.
--
--   Comparativo (até aqui): contava sempre pela request_date.
--
--   Alpharock/Cartpanda/ago 2026: 19 pela request_date; desses, 7 só receberam
--   baixa em setembro (a Visão geral joga para setembro) e 1 pedido de julho
--   recebeu baixa em agosto (a Visão geral traz para agosto): 19 - 7 + 1 = 13.
--
-- A Visão geral é a fonte de verdade do interno, então quem muda é o
-- comparativo. Introduz-se ref_date = COALESCE(completion_date, request_date),
-- usada para o recorte do período e para o bucket de mês em "Produto × mês".
--
-- O que NÃO muda: o casamento pedido a pedido (sempre olhou a base inteira, sem
-- filtro de data), a contagem do lado externo (data do pedido no arquivo) e os
-- filtros de produto e plataforma. Consequência assumida: como o externo é
-- datado pela data do pedido na loja, um reembolso pedido em julho e concluído
-- em setembro passa a ser contado em setembro no interno e continua em julho no
-- externo. Os totais do período fecham; a linha do mês não é uma régua comum.
--
-- Só a função de comparação muda; import e exclusão ficam como estão.

CREATE OR REPLACE FUNCTION public.dashboard_external_refund_comparison(
  from_date         date,
  to_date           date,
  product_filter    text DEFAULT NULL,
  divergence_filter text DEFAULT 'all',
  page_size         int  DEFAULT 50,
  page_offset       int  DEFAULT 0,
  platform_filter   text DEFAULT 'Cartpanda'
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
  v_platform text := NULLIF(NULLIF(lower(btrim(COALESCE(platform_filter, ''))), ''), 'all');
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
     AND (v_platform IS NULL OR lower(e.platform) = v_platform)
   ORDER BY e.product, e.order_number, e.imported_at DESC;

  -- Universo interno: só os produtos que existem na base externa, sem filtro de
  -- data, e só a plataforma do export (Cartpanda por padrão): o arquivo externo é
  -- de UMA plataforma e o interno registra todas — sem isso "só interno" incha
  -- com Buygoods, LogiCall etc. que nunca poderiam casar.
  --
  -- ref_date é a data que decide o período E o mês do lado interno, com a MESMA
  -- regra da Visão geral (dashboard_refund_metrics): em aberto conta pela data em
  -- que o cliente pediu; concluído conta pela data da baixa.
  CREATE TEMP TABLE tmp_int_all ON COMMIT DROP AS
  SELECT s.*, to_char(s.ref_date, 'YYYY-MM') AS month
    FROM (
  SELECT r.id,
         r.product,
         public.normalize_order_number(r.order_id) AS order_number,
         r.order_id,
         r.request_date::date AS request_date,
         CASE WHEN r.completion_date ~ '^\d{4}-\d{2}-\d{2}' THEN r.completion_date::date END AS completion_date,
         COALESCE(
           CASE WHEN r.completion_date ~ '^\d{4}-\d{2}-\d{2}' THEN r.completion_date::date END,
           r.request_date::date
         ) AS ref_date,
         r.refund_type,
         r.refund_value,
         r.sales_platform,
         r.channel,
         r.customer_email,
         p.full_name AS agent_name
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE r.request_date ~ '^\d{4}-\d{2}-\d{2}'
     AND r.product IN (SELECT DISTINCT product FROM public.external_refunds
                        WHERE v_platform IS NULL OR lower(platform) = v_platform)
     AND (v_product IS NULL OR r.product = v_product)
     AND (v_platform IS NULL OR lower(btrim(COALESCE(r.sales_platform, ''))) = v_platform)
    ) s;

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
  SELECT * FROM tmp_int_all WHERE ref_date BETWEEN from_date AND to_date;

  -- Produtos disponíveis para o filtro (toda a base externa, com contagem no período).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product', p.product,
           'external_orders', COALESCE(c.n, 0)
         ) ORDER BY p.product), '[]'::jsonb)
    INTO v_products
    FROM (SELECT DISTINCT product FROM public.external_refunds
           WHERE v_platform IS NULL OR lower(platform) = v_platform) p
    LEFT JOIN (
      SELECT product, count(*) AS n FROM tmp_ext GROUP BY product
    ) c ON c.product = p.product;

  -- Lotes importados (para a tela mostrar o que já entrou).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'platform', platform, 'product', product, 'month_ref', month_ref, 'source_file', source_file,
           'rows', n_rows, 'orders', n_orders, 'imported_at', imported_at
         ) ORDER BY platform, product, month_ref), '[]'::jsonb)
    INTO v_imports
    FROM (
      SELECT platform, product, month_ref, source_file,
             count(*) AS n_rows, count(DISTINCT order_number) AS n_orders, max(imported_at) AS imported_at
        FROM public.external_refunds
       WHERE v_platform IS NULL OR lower(platform) = v_platform
       GROUP BY platform, product, month_ref, source_file
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
           'platform_filter',        v_platform,
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
         ref_date
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

REVOKE ALL ON FUNCTION public.dashboard_external_refund_comparison(date, date, text, text, int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_external_refund_comparison(date, date, text, text, int, int, text) TO authenticated;
