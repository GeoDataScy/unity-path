-- Comparativo: o casamento passa a contar também o reembolso interno EM ABERTO.
--
-- Consequência da mudança de pergunta feita em 20260916200000. Enquanto o
-- percentual era "volume interno ÷ total da loja", excluir reembolso em aberto
-- fazia sentido e foi o que 20260916140000 decidiu, com esta justificativa:
-- "reembolso em aberto ainda não aconteceu em nenhum dos dois lados".
--
-- Ela não vale mais, por dois motivos:
--
--   1. A premissa é falsa do lado externo. Se o pedido está no arquivo, a
--      plataforma JÁ reembolsou. Aconteceu de um lado, sim.
--   2. A pergunta virou "dos pedidos que a loja reembolsou, quantos passaram
--      pelo time". Um pedido com reembolso interno em aberto passou pelo time:
--      o cliente procurou, o agente registrou, o atendimento existe.
--
-- Medido (Cartpanda, base inteira, 847 pedidos no arquivo):
--   casados só com concluído .... 74  →  8,7%
--   casados incluindo em aberto . 94  → 11,1%
--
-- Os 20 de diferença são exatamente os que 20260916140000 tirou ("casamento na
-- base inteira: 94 → 74 pedidos"), agora de volta e com o sinal certo.
--
-- ---------------------------------------------------------------------------
-- O que continua só com concluído
-- ---------------------------------------------------------------------------
-- O VOLUME (`internal_count`, o card "Interno") — que é o número que bate com a
-- Visão geral filtrada em Status = "Concluídos". A separação sai de graça:
-- ref_date é a data da baixa, então reembolso em aberto tem ref_date nulo e o
-- BETWEEN de tmp_int_period já o descarta. Só o casamento enxerga os dois.
--
-- ---------------------------------------------------------------------------
-- matched_open_only: fila de trabalho, não cobertura
-- ---------------------------------------------------------------------------
-- Pedido que a loja já reembolsou e cujo único registro interno segue em aberto
-- é pendência do time, e agora tem número próprio no jsonb para a tela mostrar.
--
-- Efeito colateral coerente na lista pedido a pedido: esses 20 saem de "só
-- externo" e entram como "nos dois", com a data de conclusão vazia — que é
-- exatamente o que eles são.

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
  v_missing jsonb;
  v_by_pm jsonb;
  v_by_p jsonb;
  v_div_total bigint;
  v_div_rows jsonb;
  v_tot bigint;   -- total da loja no período (pedidos distintos do arquivo)
  v_int bigint;   -- interno concluído no período, dentro do comparativo (volume)
  v_mat bigint;   -- pedidos do arquivo com reembolso interno (numerador do %)
  v_mat_open bigint; -- destes, os que só têm reembolso interno EM ABERTO
  v_out bigint;   -- interno concluído no período, sem arquivo do mês
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Chamadas repetidas na mesma transação (ex.: testes) não podem colidir.
  DROP TABLE IF EXISTS tmp_ext_all, tmp_int_all, tmp_match, tmp_ext, tmp_ext_months,
                       tmp_match_done, tmp_int_period, tmp_int, tmp_int_out, tmp_div;

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

  -- Universo interno para CASAMENTO: só a plataforma do export e só reembolso
  -- concluído, sem filtro de data (o par pode estar fora do período — é assim
  -- desde a primeira versão e continua sendo).
  --
  -- Aqui o escopo segue sendo por produto, não por produto × mês: tmp_match
  -- existe para a lista pedido a pedido, que de propósito atravessa meses. Quem
  -- ganha o recorte por mês é tmp_int, logo abaixo, que é o que alimenta as
  -- contagens e os percentuais.
  CREATE TEMP TABLE tmp_int_all ON COMMIT DROP AS
  SELECT s.*, to_char(s.ref_date, 'YYYY-MM') AS month
    FROM (
  SELECT r.id,
         r.product,
         public.normalize_order_number(r.order_id) AS order_number,
         r.order_id,
         r.request_date::date AS request_date,
         CASE WHEN r.completion_date ~ '^\d{4}-\d{2}-\d{2}'
              THEN r.completion_date::date END AS completion_date,
         -- ref_date nulo = reembolso em aberto. Ele casa (o pedido passou pelo
         -- time), mas não tem data de baixa, então o BETWEEN de tmp_int_period o
         -- descarta sozinho e o VOLUME segue só com concluído.
         CASE WHEN r.completion_date ~ '^\d{4}-\d{2}-\d{2}'
              THEN r.completion_date::date END AS ref_date,
         r.refund_type,
         r.refund_value,
         r.sales_platform,
         r.channel,
         r.customer_email,
         p.full_name AS agent_name
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE (r.completion_date IS NULL OR r.completion_date ~ '^\d{4}-\d{2}-\d{2}')
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

  -- Recorte do casamento só por reembolso concluído: a diferença para tmp_match
  -- são os pedidos que a loja já reembolsou e cujo único registro interno segue
  -- em aberto — fila de trabalho, não cobertura a menos.
  CREATE TEMP TABLE tmp_match_done ON COMMIT DROP AS
  SELECT DISTINCT e.product, e.order_number
    FROM tmp_ext_all e
    JOIN tmp_int_all i ON i.product = e.product AND i.order_number = e.order_number
   WHERE e.order_number IS NOT NULL AND i.ref_date IS NOT NULL;

  -- Recorte do período no lado externo (o que a tela conta como "total da loja").
  CREATE TEMP TABLE tmp_ext ON COMMIT DROP AS
  SELECT * FROM tmp_ext_all
   WHERE month_ref BETWEEN date_trunc('month', from_date)::date AND to_date;

  -- Os (produto, mês) que têm arquivo no período. É a régua do comparativo:
  -- sem arquivo do mês não há denominador, então não há o que comparar.
  CREATE TEMP TABLE tmp_ext_months ON COMMIT DROP AS
  SELECT DISTINCT product, month FROM tmp_ext;

  -- Interno do período, antes do recorte por arquivo.
  CREATE TEMP TABLE tmp_int_period ON COMMIT DROP AS
  SELECT * FROM tmp_int_all WHERE ref_date BETWEEN from_date AND to_date;

  -- Interno que entra no comparativo: tem arquivo do próprio mês.
  CREATE TEMP TABLE tmp_int ON COMMIT DROP AS
  SELECT i.*
    FROM tmp_int_period i
    JOIN tmp_ext_months em ON em.product = i.product AND em.month = i.month;

  -- Interno que FICA DE FORA por falta de arquivo. Lido direto de refunds, não de
  -- tmp_int_period: produto sem nenhuma importação nunca chega em tmp_int_all, e é
  -- justamente ele o grosso do buraco (14 dos 18 produtos em agosto/2026).
  CREATE TEMP TABLE tmp_int_out ON COMMIT DROP AS
  SELECT r.product,
         to_char(r.completion_date::date, 'YYYY-MM') AS month
    FROM public.refunds r
   WHERE r.completion_date ~ '^\d{4}-\d{2}-\d{2}'
     AND r.completion_date::date BETWEEN from_date AND to_date
     AND (v_product IS NULL OR r.product = v_product)
     AND (v_platform IS NULL OR lower(btrim(COALESCE(r.sales_platform, ''))) = v_platform)
     AND NOT EXISTS (
           SELECT 1 FROM tmp_ext_months em
            WHERE em.product = r.product
              AND em.month = to_char(r.completion_date::date, 'YYYY-MM')
         );

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

  -- Arquivos que faltam, na ordem do que mais pesa.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product',        product,
           'internal_count', n,
           'months',         months
         ) ORDER BY n DESC, product), '[]'::jsonb)
    INTO v_missing
    FROM (
      SELECT product,
             count(*) AS n,
             to_jsonb(array_agg(DISTINCT month ORDER BY month)) AS months
        FROM tmp_int_out
       GROUP BY product
    ) f;

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
           'external_diff',          COALESCE(ext.external_count, 0) - COALESCE(ext.matched_count, 0),
           'internal_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN round(100.0 * COALESCE(ext.matched_count, 0) / ext.external_count, 1)
                                          ELSE NULL END,
           -- derivado do interno já arredondado: garante soma exata de 100%
           'external_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN 100.0 - round(100.0 * COALESCE(ext.matched_count, 0) / ext.external_count, 1)
                                          ELSE NULL END,
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
           0::bigint AS internal_open,
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
           'external_diff',          COALESCE(ext.external_count, 0) - COALESCE(ext.matched_count, 0),
           'internal_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN round(100.0 * COALESCE(ext.matched_count, 0) / ext.external_count, 1)
                                          ELSE NULL END,
           'external_pct',           CASE WHEN COALESCE(ext.external_count, 0) > 0
                                          THEN 100.0 - round(100.0 * COALESCE(ext.matched_count, 0) / ext.external_count, 1)
                                          ELSE NULL END,
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
  SELECT count(*) INTO v_mat FROM tmp_ext e
    JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number;
  SELECT count(*) INTO v_mat_open FROM tmp_ext e
    JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number
    LEFT JOIN tmp_match_done d ON d.product = e.product AND d.order_number = e.order_number
   WHERE d.order_number IS NULL;
  SELECT count(*) INTO v_out FROM tmp_int_out;

  SELECT jsonb_build_object(
           'from_date',              from_date,
           'to_date',                to_date,
           'product_filter',         v_product,
           'platform_filter',        v_platform,
           'internal_count',         v_int,
           'internal_only',          (SELECT count(*) FROM tmp_int i
                                       LEFT JOIN tmp_match m ON m.product = i.product AND m.order_number = i.order_number
                                       WHERE m.order_number IS NULL),
           'internal_without_order', (SELECT count(*) FROM tmp_int WHERE order_number IS NULL),
           -- Reembolso concluído da plataforma que o comparativo não cobre por
           -- falta de arquivo do mês. Não entra em nenhum outro número da tela.
           'internal_not_compared',  v_out,
           'external_count',         v_tot,
           'external_only',          (SELECT count(*) FROM tmp_ext e
                                       LEFT JOIN tmp_match m ON m.product = e.product AND m.order_number = e.order_number
                                       WHERE m.order_number IS NULL),
           'matched_count',          v_mat,
           -- Loja já reembolsou e o registro interno continua em aberto.
           'matched_open_only',      v_mat_open,
           'external_full',          (SELECT count(*) FROM tmp_ext WHERE payment_status = 'Refunded'),
           'external_partial',       (SELECT count(*) FROM tmp_ext WHERE payment_status = 'Partially refunded'),
           'external_amount',        (SELECT COALESCE(sum(refund_amount), 0) FROM tmp_ext),
           'external_diff',          v_tot - v_mat,
           'internal_pct',           CASE WHEN v_tot > 0 THEN round(100.0 * v_mat / v_tot, 1) ELSE NULL END,
           'external_pct',           CASE WHEN v_tot > 0 THEN 100.0 - round(100.0 * v_mat / v_tot, 1) ELSE NULL END,
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
    'missing_imports',  v_missing,
    'by_product_month', v_by_pm,
    'by_product',       v_by_p,
    'divergences',      jsonb_build_object('total_count', v_div_total, 'rows', v_div_rows)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_external_refund_comparison(date, date, text, text, int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_external_refund_comparison(date, date, text, text, int, int, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
