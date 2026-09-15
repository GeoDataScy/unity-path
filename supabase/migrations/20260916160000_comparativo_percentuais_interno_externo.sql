-- Colunas % interno / % externo, e o externo bucketado pelo mês da importação.
--
-- Regra definida pelo Webert (call de 11/09/2026), na linguagem dele: "o total é
-- o que a gente puxa direto das planilhas, o interno é o que pega da sua
-- plataforma, o externo é a diferença."
--
--   total   = pedidos distintos do arquivo importado  (external_count)
--   interno = reembolsos concluídos da plataforma filtrada, pela data da baixa
--   externo = GREATEST(total - interno, 0)            (external_diff)
--
--   internal_pct = interno / total
--   external_pct = 100 - internal_pct, com piso em 0
--
-- Os percentuais somam exatamente 100 por construção: external_pct é derivado do
-- internal_pct JÁ ARREDONDADO, senão dois arredondamentos independentes podem dar
-- 100,1%. Serve de teste de regressão.
--
-- NÃO é "casados ÷ total": o casamento por número de pedido perde quem não casa
-- por ruído (reembolso sem nº de pedido, normalização, janela de data) e
-- subestimaria o interno. matched_count e as colunas "só interno"/"só externo"
-- continuam existindo para a lista pedido a pedido, mas não entram na conta.
--
-- coverage_pct sai da RPC: a "cobertura" que o Webert descreveu ("quanto que a
-- gente tá conseguindo cobrir dos reembolsos") É o internal_pct.
--
-- ---------------------------------------------------------------------------
-- Mês do lado externo: month_ref, não order_date.
-- ---------------------------------------------------------------------------
-- order_date é a data da COMPRA, não do reembolso. Verificado no export de
-- Horsefil/agosto contra a base interna: em 29 pedidos casados, NENHUM tem a data
-- do arquivo igual à data do pedido de reembolso, nenhum reembolso é anterior a
-- ela, e o intervalo médio é de 12,2 dias (até 33). Um pedido comprado em junho e
-- reembolsado em agosto cairia em junho no externo e em agosto no interno — e
-- agora essa data vai dentro de uma divisão.
--
-- month_ref é o mês que a gestora escolhe no diálogo de importação, o mesmo
-- recorte que ela usou no painel da plataforma para extrair o CSV. É ele que casa
-- com o denominador. Hoje month_ref e o mês do order_date coincidem em 100% das
-- linhas, então a troca não muda número nenhum — corrige a semântica.
--
-- ---------------------------------------------------------------------------
-- Sobre o denominador (reconciliação 235 × 245, Horsefil/agosto)
-- ---------------------------------------------------------------------------
-- O arquivo tem 235 pedidos distintos e é internamente consistente: um status, um
-- valor e uma data por pedido, zero linha descartada no import, zero colisão de
-- normalização. Nenhuma leitura do arquivo produz 245. Os 10 de diferença são
-- defasagem de retrato: os 10 exports foram gerados em 10/09/2026 e cada um lista
-- "pedidos comprados no mês M já reembolsados até 10/09"; o painel é ao vivo.
-- Horsefil/agosto para em 30/08 porque nada comprado em 31/08 tinha sido
-- reembolsado ainda (Honeyfil/agosto, com mais volume, chega ao dia 31). O
-- denominador é o import, porque é ele que a lista pedido a pedido consegue
-- explicar linha a linha; defasagem se resolve reimportando.

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
  v_tot bigint;   -- total da loja no período (pedidos distintos do arquivo)
  v_int bigint;   -- interno concluído no período
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Chamadas repetidas na mesma transação (ex.: testes) não podem colidir.
  DROP TABLE IF EXISTS tmp_ext_all, tmp_int_all, tmp_match, tmp_ext, tmp_int, tmp_div;

  -- Universo externo: uma linha por pedido (o CSV repete o pedido por item e
  -- refund_amount é do pedido). Sem filtro de data: o casamento olha a base
  -- inteira, porque o pedido pode ser de um mês e o reembolso interno de outro.
  -- O mês é o que a gestora informou na importação (month_ref), NÃO a data do
  -- pedido: order_date é a data da COMPRA, e um pedido comprado em junho pode ter
  -- sido reembolsado em agosto. month_ref é o recorte que ela usou no painel da
  -- plataforma para extrair o CSV, então é ele que casa com o denominador.
  CREATE TEMP TABLE tmp_ext_all ON COMMIT DROP AS
  SELECT DISTINCT ON (e.product, e.order_number)
         e.product,
         e.order_number,
         e.order_name,
         e.order_date,
         e.month_ref,
         to_char(e.month_ref, 'YYYY-MM') AS month,
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
  -- SÓ REEMBOLSO CONCLUÍDO entra no lado interno: o arquivo da plataforma lista o
  -- que ela efetivamente reembolsou, então o par honesto é o reembolso que o time
  -- também já baixou. Reembolso em aberto fica fora de todos os números da tela,
  -- inclusive do casamento.
  --
  -- Como só entra concluído, ref_date (a data que decide período e mês) é sempre a
  -- data da baixa — a mesma régua da Visão geral filtrada em "Concluídos".
  CREATE TEMP TABLE tmp_int_all ON COMMIT DROP AS
  SELECT s.*, to_char(s.ref_date, 'YYYY-MM') AS month
    FROM (
  SELECT r.id,
         r.product,
         public.normalize_order_number(r.order_id) AS order_number,
         r.order_id,
         r.request_date::date AS request_date,
         r.completion_date::date AS completion_date,
         r.completion_date::date AS ref_date,
         r.refund_type,
         r.refund_value,
         r.sales_platform,
         r.channel,
         r.customer_email,
         p.full_name AS agent_name
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE r.completion_date ~ '^\d{4}-\d{2}-\d{2}'
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
  SELECT * FROM tmp_ext_all
   WHERE month_ref BETWEEN date_trunc('month', from_date)::date AND to_date;

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
           0::bigint AS internal_open, -- só entra concluído: sempre 0, mantido pelo contrato do jsonb
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
           -- Regra das colunas: total = pedidos distintos do arquivo,
           -- interno = concluídos da plataforma filtrada, externo = total - interno.
           -- Sem casamento por ID: quem não casa por ruído subestimaria o interno.
           'external_diff',          GREATEST(COALESCE(ext.external_count, 0) - COALESCE(intr.internal_count, 0), 0),
           'internal_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN round(100.0 * COALESCE(intr.internal_count, 0) / ext.external_count, 1)
                                          ELSE NULL END,
           -- derivado do interno já arredondado: garante soma exata de 100%
           'external_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN GREATEST(100.0 - round(100.0 * COALESCE(intr.internal_count, 0) / ext.external_count, 1), 0)
                                          ELSE NULL END,
           -- só é incoerência quando existe total para comparar; total = 0 é
           -- "sem import no período", e a tela já mostra "—" nesse caso.
           'inconsistent',           COALESCE(ext.external_count, 0) > 0
                                       AND COALESCE(intr.internal_count, 0) > ext.external_count
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
           0::bigint AS internal_open, -- só entra concluído: sempre 0, mantido pelo contrato do jsonb
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
           'external_diff',          GREATEST(COALESCE(ext.external_count, 0) - COALESCE(intr.internal_count, 0), 0),
           'internal_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN round(100.0 * COALESCE(intr.internal_count, 0) / ext.external_count, 1)
                                          ELSE NULL END,
           'external_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN GREATEST(100.0 - round(100.0 * COALESCE(intr.internal_count, 0) / ext.external_count, 1), 0)
                                          ELSE NULL END,
           -- só é incoerência quando existe total para comparar; total = 0 é
           -- "sem import no período", e a tela já mostra "—" nesse caso.
           'inconsistent',           COALESCE(ext.external_count, 0) > 0
                                       AND COALESCE(intr.internal_count, 0) > ext.external_count
         ) ORDER BY p.product), '[]'::jsonb)
    INTO v_by_p
    FROM prods p
    LEFT JOIN ext  ON ext.product = p.product
    LEFT JOIN intr ON intr.product = p.product;

  -- Totais do período.
  SELECT count(*) INTO v_tot FROM tmp_ext;
  SELECT count(*) INTO v_int FROM tmp_int;

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
           'external_diff',          GREATEST(v_tot - v_int, 0),
           'internal_pct',           CASE WHEN v_tot > 0 THEN round(100.0 * v_int / v_tot, 1) ELSE NULL END,
           'external_pct',           CASE WHEN v_tot > 0 THEN GREATEST(100.0 - round(100.0 * v_int / v_tot, 1), 0) ELSE NULL END,
           'inconsistent',           v_tot > 0 AND v_int > v_tot
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
