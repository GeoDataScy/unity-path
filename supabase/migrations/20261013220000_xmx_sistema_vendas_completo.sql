-- Página "Sistema XMX": vendas, reembolsos e chargebacks do banco MySQL de
-- VENDAS da XMX (homosistemaxmx), copiados pela Edge Function xmx-refunds-sync.
--
-- O que esta migration acrescenta (tudo aditivo: a função antiga continua
-- funcionando até a nova ser publicada):
--   * xmx_refunds ganha país, motivo, valor do pedido e valor reembolsado em US$;
--   * xmx_chargebacks: uma linha por pedido que já esteve em chargeback;
--   * xmx_sales_daily: vendas agregadas por dia × plataforma × país (a tabela
--     de pedidos tem 540 mil linhas; para os gráficos basta o agregado);
--   * xmx_orders_apply / xmx_sales_apply: escrita (service_role);
--   * dashboard_xmx_sistema: leitura, um jsonb com todas as seções da página.
--
-- Valores em US$: total_price_real_brazil ÷ cotacao_dolar (o MySQL guarda o
-- valor em R$ e o câmbio do dia; conferido: Cartpanda dá US$ 312,71 contra
-- US$ 312,24 nos pedidos já em dólar). DigiStore não tem valor nenhum.
-- País: normalizado na Edge Function ('US' e 'United States' viram o mesmo) e
-- dobrado em 5 países + 'Outros'.

-- ─── Reembolsos: colunas novas ──────────────────────────────────────────────
ALTER TABLE public.xmx_refunds
  ADD COLUMN IF NOT EXISTS country           text,
  ADD COLUMN IF NOT EXISTS reason            text,     -- categoria do motivo (só onde há anotação)
  ADD COLUMN IF NOT EXISTS order_amount_usd  numeric,
  ADD COLUMN IF NOT EXISTS refund_amount_usd numeric;  -- NULL quando o sistema de vendas não informa

CREATE INDEX IF NOT EXISTS xmx_refunds_purchase_at_idx
  ON public.xmx_refunds (purchase_at) WHERE is_refunded;

-- ─── Chargebacks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xmx_chargebacks (
  external_order_id bigint      PRIMARY KEY,               -- orders.id
  platform_id       int         NOT NULL,
  platform_name     text,
  order_code        text,
  status_raw        text,
  chargeback_at     timestamptz,                           -- orders.date_chargeback (horário de SP)
  purchase_at       timestamptz,
  country           text,
  amount_usd        numeric,                               -- valor do pedido contestado
  is_chargeback     boolean     NOT NULL DEFAULT true,
  source_updated_at timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.xmx_chargebacks IS
  'Chargebacks do banco de vendas da XMX. Escrita só pela Edge Function xmx-refunds-sync; leitura só pela RPC dashboard_xmx_sistema.';
CREATE INDEX IF NOT EXISTS xmx_chargebacks_chargeback_at_idx ON public.xmx_chargebacks (chargeback_at) WHERE is_chargeback;
CREATE INDEX IF NOT EXISTS xmx_chargebacks_purchase_at_idx ON public.xmx_chargebacks (purchase_at) WHERE is_chargeback;
ALTER TABLE public.xmx_chargebacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xmx_chargebacks FROM anon, authenticated;

-- ─── Vendas por dia ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xmx_sales_daily (
  day         date    NOT NULL,     -- DATE(purchase_date), horário de SP
  platform_id int     NOT NULL,
  country     text    NOT NULL,     -- 5 países principais ou 'Outros'
  orders      int     NOT NULL,     -- pedidos distintos (order_id_cartpanda)
  lines       int     NOT NULL,     -- linhas de orders (BuyGoods 2 tem front + upsells em linhas separadas)
  gross_usd   numeric NOT NULL DEFAULT 0,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, platform_id, country)
);
COMMENT ON TABLE public.xmx_sales_daily IS
  'Vendas do banco de vendas da XMX agregadas por dia × plataforma × país. Recalculada por janela de dias pela Edge Function xmx-refunds-sync.';
ALTER TABLE public.xmx_sales_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xmx_sales_daily FROM anon, authenticated;

-- ─── Estado: cargas iniciais novas ──────────────────────────────────────────
-- v2_backfill: repassa os pedidos reembolsados (para preencher as colunas novas)
-- e traz os chargebacks. sales_backfill: mês a mês desde jan/2025.
ALTER TABLE public.xmx_sync_state
  ADD COLUMN IF NOT EXISTS v2_backfill_cursor_id bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS v2_backfill_done      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_backfill_month  date    NOT NULL DEFAULT '2025-01-01',
  ADD COLUMN IF NOT EXISTS sales_backfill_done   boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Escrita de pedidos (reembolso e chargeback). Idempotente.
-- p_rows: [{ id, platform_id, platform_name, order_code, status, updated_at (ISO UTC),
--            purchase_at, country, order_usd,
--            refund_kind ('total'|'parcial'|null), refund_at, refund_amount, refund_currency,
--            refund_usd, reason,
--            is_chargeback (bool), chargeback_at }]
--   refund_kind null → se o pedido estava em xmx_refunds, vira is_refunded = false.
--   is_chargeback false → se estava em xmx_chargebacks, vira is_chargeback = false.
-- p_state: campos de xmx_sync_state a gravar no fim.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xmx_orders_apply(p_rows jsonb, p_state jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_refunds     int := 0;
  v_unrefunded  int := 0;
  v_cbs         int := 0;
  v_uncb        int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_xmx_src (
    id bigint, platform_id int, platform_name text, order_code text, status text,
    updated_at timestamptz, purchase_at text, country text, order_usd numeric,
    refund_kind text, refund_at text, refund_amount numeric, refund_currency text,
    refund_usd numeric, reason text, is_chargeback boolean, chargeback_at text
  ) ON COMMIT DROP;
  TRUNCATE tmp_xmx_src;
  INSERT INTO tmp_xmx_src
  SELECT * FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(
    id bigint, platform_id int, platform_name text, order_code text, status text,
    updated_at timestamptz, purchase_at text, country text, order_usd numeric,
    refund_kind text, refund_at text, refund_amount numeric, refund_currency text,
    refund_usd numeric, reason text, is_chargeback boolean, chargeback_at text
  );

  -- Reembolsos
  WITH up AS (
    INSERT INTO public.xmx_refunds AS t (
      external_order_id, platform_id, platform_name, order_code, refund_kind, status_raw,
      refund_at, purchase_at, refund_amount, refund_currency, country, reason,
      order_amount_usd, refund_amount_usd, is_refunded, source_updated_at, synced_at
    )
    SELECT id, platform_id, platform_name, order_code, refund_kind, status,
           nullif(refund_at, '')::timestamp AT TIME ZONE 'America/Sao_Paulo',
           nullif(purchase_at, '')::timestamp AT TIME ZONE 'America/Sao_Paulo',
           refund_amount, refund_currency, country, reason, order_usd, refund_usd,
           true, updated_at, now()
    FROM tmp_xmx_src
    WHERE refund_kind IN ('total', 'parcial')
    ON CONFLICT (external_order_id) DO UPDATE SET
      platform_id       = EXCLUDED.platform_id,
      platform_name     = EXCLUDED.platform_name,
      order_code        = EXCLUDED.order_code,
      refund_kind       = EXCLUDED.refund_kind,
      status_raw        = EXCLUDED.status_raw,
      refund_at         = EXCLUDED.refund_at,
      purchase_at       = EXCLUDED.purchase_at,
      refund_amount     = EXCLUDED.refund_amount,
      refund_currency   = EXCLUDED.refund_currency,
      country           = EXCLUDED.country,
      reason            = EXCLUDED.reason,
      order_amount_usd  = EXCLUDED.order_amount_usd,
      refund_amount_usd = EXCLUDED.refund_amount_usd,
      is_refunded       = true,
      source_updated_at = EXCLUDED.source_updated_at,
      synced_at         = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_refunds FROM up;

  WITH down AS (
    UPDATE public.xmx_refunds t
       SET is_refunded = false, status_raw = s.status, source_updated_at = s.updated_at, synced_at = now()
      FROM tmp_xmx_src s
     WHERE s.refund_kind IS NULL AND t.external_order_id = s.id AND t.is_refunded
    RETURNING 1
  )
  SELECT count(*) INTO v_unrefunded FROM down;

  -- Chargebacks
  WITH up AS (
    INSERT INTO public.xmx_chargebacks AS t (
      external_order_id, platform_id, platform_name, order_code, status_raw,
      chargeback_at, purchase_at, country, amount_usd, is_chargeback, source_updated_at, synced_at
    )
    SELECT id, platform_id, platform_name, order_code, status,
           nullif(chargeback_at, '')::timestamp AT TIME ZONE 'America/Sao_Paulo',
           nullif(purchase_at, '')::timestamp AT TIME ZONE 'America/Sao_Paulo',
           country, order_usd, true, updated_at, now()
    FROM tmp_xmx_src
    WHERE is_chargeback
    ON CONFLICT (external_order_id) DO UPDATE SET
      platform_id       = EXCLUDED.platform_id,
      platform_name     = EXCLUDED.platform_name,
      order_code        = EXCLUDED.order_code,
      status_raw        = EXCLUDED.status_raw,
      chargeback_at     = EXCLUDED.chargeback_at,
      purchase_at       = EXCLUDED.purchase_at,
      country           = EXCLUDED.country,
      amount_usd        = EXCLUDED.amount_usd,
      is_chargeback     = true,
      source_updated_at = EXCLUDED.source_updated_at,
      synced_at         = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_cbs FROM up;

  WITH down AS (
    UPDATE public.xmx_chargebacks t
       SET is_chargeback = false, status_raw = s.status, source_updated_at = s.updated_at, synced_at = now()
      FROM tmp_xmx_src s
     WHERE NOT coalesce(s.is_chargeback, false) AND t.external_order_id = s.id AND t.is_chargeback
    RETURNING 1
  )
  SELECT count(*) INTO v_uncb FROM down;

  UPDATE public.xmx_sync_state SET
    cursor_updated_at     = coalesce((p_state->>'cursor_updated_at')::timestamptz, cursor_updated_at),
    v2_backfill_cursor_id = coalesce((p_state->>'v2_backfill_cursor_id')::bigint, v2_backfill_cursor_id),
    v2_backfill_done      = coalesce((p_state->>'v2_backfill_done')::boolean, v2_backfill_done)
  WHERE id = 1;

  RETURN jsonb_build_object('upserted', v_refunds, 'unrefunded', v_unrefunded,
                            'chargebacks', v_cbs, 'unchargebacked', v_uncb);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Escrita das vendas: substitui a janela [p_from, p_to] inteira (o MySQL é a
-- verdade; pedidos chegam com atraso de horas a dias, então a janela recente é
-- recalculada a cada execução). Idempotente.
-- p_rows: [{ day 'YYYY-MM-DD', platform_id, country, orders, lines, gross_usd }]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xmx_sales_apply(p_from date, p_to date, p_rows jsonb, p_state jsonb DEFAULT '{}'::jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.xmx_sales_daily WHERE day BETWEEN p_from AND p_to;

  INSERT INTO public.xmx_sales_daily (day, platform_id, country, orders, lines, gross_usd, synced_at)
  SELECT day, platform_id, country, sum(orders)::int, sum(lines)::int, coalesce(sum(gross_usd), 0), now()
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(
    day date, platform_id int, country text, orders int, lines int, gross_usd numeric)
  WHERE day BETWEEN p_from AND p_to
  GROUP BY day, platform_id, country;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.xmx_sync_state SET
    sales_backfill_month = coalesce((p_state->>'sales_backfill_month')::date, sales_backfill_month),
    sales_backfill_done  = coalesce((p_state->>'sales_backfill_done')::boolean, sales_backfill_done)
  WHERE id = 1;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.xmx_orders_apply(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xmx_sales_apply(date, date, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xmx_orders_apply(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.xmx_sales_apply(date, date, jsonb, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Leitura: página "Sistema XMX".
--
-- Pedido = (plataforma, order_code): no BuyGoods 2 um pedido tem várias linhas.
-- Datas no fuso de São Paulo:
--   vendas      → dia da compra;
--   reembolsos  → dia do reembolso (refund_at);
--   chargebacks → dia do chargeback (chargeback_at).
-- Taxas (por safra de compra): dos pedidos COMPRADOS no período, quantos já
-- foram reembolsados / contestados até agora. Períodos recentes ainda sobem.
-- group_by: 'day' | 'week' | 'month'. platform_filter: família ou 'all'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_xmx_sistema(
  from_date       date,
  to_date         date,
  group_by        text DEFAULT 'day',
  platform_filter text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unit     text;
  v_platform text;
  v_from     timestamptz;
  v_to       timestamptz;
  v_result   jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_unit := CASE group_by WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' ELSE 'day' END;
  v_platform := NULLIF(NULLIF(platform_filter, 'all'), '');
  v_from := from_date::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_to   := (to_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';

  WITH
  -- Vendas no período (por dia da compra)
  vendas AS (
    SELECT s.day, public.xmx_platform_family(s.platform_id) AS family, s.country,
           s.orders, s.gross_usd
    FROM public.xmx_sales_daily s
    WHERE s.day BETWEEN from_date AND to_date
      AND (v_platform IS NULL OR public.xmx_platform_family(s.platform_id) = v_platform)
  ),
  -- Reembolsos: um pedido conta uma vez; total vence parcial.
  reemb_base AS (
    SELECT public.xmx_platform_family(r.platform_id) AS family,
           r.platform_id || ':' || coalesce(nullif(r.order_code, ''), r.external_order_id::text) AS order_key,
           r.refund_kind, r.refund_at, r.purchase_at, r.country, r.reason,
           r.refund_amount_usd
    FROM public.xmx_refunds r
    WHERE r.is_refunded
      AND (v_platform IS NULL OR public.xmx_platform_family(r.platform_id) = v_platform)
  ),
  reemb_pedidos AS (
    SELECT family, order_key,
           min(refund_at) AS refund_at, min(purchase_at) AS purchase_at,
           CASE WHEN bool_or(refund_kind = 'total') THEN 'total' ELSE 'parcial' END AS kind,
           max(country) AS country, max(reason) AS reason,
           sum(refund_amount_usd) AS amount_usd
    FROM reemb_base GROUP BY family, order_key
  ),
  reemb AS (
    SELECT *, (refund_at AT TIME ZONE 'America/Sao_Paulo') AS local_at
    FROM reemb_pedidos WHERE refund_at >= v_from AND refund_at < v_to
  ),
  -- Chargebacks: idem
  cb_pedidos AS (
    SELECT public.xmx_platform_family(c.platform_id) AS family,
           c.platform_id || ':' || coalesce(nullif(c.order_code, ''), c.external_order_id::text) AS order_key,
           min(c.chargeback_at) AS chargeback_at, min(c.purchase_at) AS purchase_at,
           max(c.country) AS country, sum(c.amount_usd) AS amount_usd
    FROM public.xmx_chargebacks c
    WHERE c.is_chargeback
      AND (v_platform IS NULL OR public.xmx_platform_family(c.platform_id) = v_platform)
    GROUP BY 1, 2
  ),
  cb AS (
    SELECT *, (chargeback_at AT TIME ZONE 'America/Sao_Paulo') AS local_at
    FROM cb_pedidos WHERE chargeback_at >= v_from AND chargeback_at < v_to
  ),
  -- Safra: pedidos comprados no período que já viraram reembolso/chargeback
  reemb_safra AS (
    SELECT family, country, (purchase_at AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM reemb_pedidos WHERE purchase_at >= v_from AND purchase_at < v_to
  ),
  cb_safra AS (
    SELECT family, country, (purchase_at AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM cb_pedidos WHERE purchase_at >= v_from AND purchase_at < v_to
  ),
  tot AS (
    SELECT
      (SELECT coalesce(sum(orders), 0) FROM vendas)::int                AS orders,
      (SELECT coalesce(sum(gross_usd), 0) FROM vendas)                  AS gross_usd,
      (SELECT count(*) FROM reemb)::int                                 AS refunds,
      (SELECT count(*) FROM reemb WHERE kind = 'total')::int            AS refunds_total,
      (SELECT count(*) FROM reemb WHERE kind = 'parcial')::int          AS refunds_parcial,
      (SELECT coalesce(sum(amount_usd), 0) FROM reemb)                  AS refunds_usd,
      (SELECT count(*) FROM reemb WHERE amount_usd IS NOT NULL)::int    AS refunds_with_amount,
      (SELECT count(*) FROM cb)::int                                    AS chargebacks,
      (SELECT coalesce(sum(amount_usd), 0) FROM cb)                     AS chargebacks_usd,
      (SELECT count(*) FROM reemb_safra)::int                           AS refunds_safra,
      (SELECT count(*) FROM cb_safra)::int                              AS chargebacks_safra
  ),
  -- Por família de plataforma (tabela da visão geral)
  por_plataforma AS (
    SELECT f.family,
           coalesce(v.orders, 0)::int AS orders, coalesce(v.gross_usd, 0) AS gross_usd,
           coalesce(r.n, 0)::int AS refunds, coalesce(c.n, 0)::int AS chargebacks,
           coalesce(rs.n, 0)::int AS refunds_safra, coalesce(cs.n, 0)::int AS chargebacks_safra
    FROM (SELECT family FROM vendas UNION SELECT family FROM reemb UNION SELECT family FROM cb) f
    LEFT JOIN (SELECT family, sum(orders) AS orders, sum(gross_usd) AS gross_usd FROM vendas GROUP BY 1) v USING (family)
    LEFT JOIN (SELECT family, count(*) AS n FROM reemb GROUP BY 1) r USING (family)
    LEFT JOIN (SELECT family, count(*) AS n FROM cb GROUP BY 1) c USING (family)
    LEFT JOIN (SELECT family, count(*) AS n FROM reemb_safra GROUP BY 1) rs USING (family)
    LEFT JOIN (SELECT family, count(*) AS n FROM cb_safra GROUP BY 1) cs USING (family)
  ),
  -- Países (país NULL conta como 'Outros')
  paises AS (
    SELECT p.country,
           coalesce(v.orders, 0)::int AS orders, coalesce(v.gross_usd, 0) AS gross_usd,
           coalesce(r.n, 0)::int AS refunds, coalesce(c.n, 0)::int AS chargebacks,
           coalesce(rs.n, 0)::int AS refunds_safra, coalesce(cs.n, 0)::int AS chargebacks_safra
    FROM (SELECT country FROM vendas
          UNION SELECT coalesce(country, 'Outros') FROM reemb
          UNION SELECT coalesce(country, 'Outros') FROM cb) p
    LEFT JOIN (SELECT country, sum(orders) AS orders, sum(gross_usd) AS gross_usd FROM vendas GROUP BY 1) v USING (country)
    LEFT JOIN (SELECT coalesce(country, 'Outros') AS country, count(*) AS n FROM reemb GROUP BY 1) r USING (country)
    LEFT JOIN (SELECT coalesce(country, 'Outros') AS country, count(*) AS n FROM cb GROUP BY 1) c USING (country)
    LEFT JOIN (SELECT coalesce(country, 'Outros') AS country, count(*) AS n FROM reemb_safra GROUP BY 1) rs USING (country)
    LEFT JOIN (SELECT coalesce(country, 'Outros') AS country, count(*) AS n FROM cb_safra GROUP BY 1) cs USING (country)
  ),
  -- Séries
  s_vendas AS (
    SELECT date_trunc(v_unit, day)::date AS bucket, family, sum(orders)::int AS orders, sum(gross_usd) AS gross_usd
    FROM vendas GROUP BY 1, 2
  ),
  s_reemb AS (
    SELECT date_trunc(v_unit, local_at)::date AS bucket, family, count(*)::int AS n FROM reemb GROUP BY 1, 2
  ),
  s_cb AS (
    SELECT date_trunc(v_unit, local_at)::date AS bucket, family, count(*)::int AS n FROM cb GROUP BY 1, 2
  ),
  -- Taxas por período de compra (safra)
  s_taxas AS (
    SELECT v.bucket, v.orders::int AS orders, coalesce(r.n, 0)::int AS refunds, coalesce(c.n, 0)::int AS chargebacks
    FROM (SELECT date_trunc(v_unit, day)::date AS bucket, sum(orders) AS orders FROM vendas GROUP BY 1) v
    LEFT JOIN (SELECT date_trunc(v_unit, day)::date AS bucket, count(*) AS n FROM reemb_safra GROUP BY 1) r USING (bucket)
    LEFT JOIN (SELECT date_trunc(v_unit, day)::date AS bucket, count(*) AS n FROM cb_safra GROUP BY 1) c USING (bucket)
  ),
  -- Dias entre a compra e o reembolso
  dias AS (
    SELECT CASE
             WHEN d <= 7  THEN '0–7 dias'
             WHEN d <= 14 THEN '8–14 dias'
             WHEN d <= 30 THEN '15–30 dias'
             WHEN d <= 60 THEN '31–60 dias'
             ELSE 'Mais de 60 dias'
           END AS faixa,
           CASE WHEN d <= 7 THEN 1 WHEN d <= 14 THEN 2 WHEN d <= 30 THEN 3 WHEN d <= 60 THEN 4 ELSE 5 END AS ordem
    FROM (SELECT greatest(0, extract(epoch FROM (refund_at - purchase_at)) / 86400)::int AS d
          FROM reemb WHERE purchase_at IS NOT NULL AND refund_at IS NOT NULL) x
  )
  SELECT jsonb_build_object(
    'kpis', (SELECT jsonb_build_object(
        'orders', t.orders, 'gross_usd', round(t.gross_usd, 2),
        'ticket_usd', round(t.gross_usd / nullif(t.orders, 0), 2),
        'refunds', t.refunds, 'refunds_total', t.refunds_total, 'refunds_parcial', t.refunds_parcial,
        'refunds_usd', round(t.refunds_usd, 2), 'refunds_with_amount', t.refunds_with_amount,
        'refund_rate', round(100.0 * t.refunds_safra / nullif(t.orders, 0), 1),
        'chargebacks', t.chargebacks, 'chargebacks_usd', round(t.chargebacks_usd, 2),
        'chargeback_rate', round(100.0 * t.chargebacks_safra / nullif(t.orders, 0), 2))
      FROM tot t),
    'by_platform', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'key', p.family, 'orders', p.orders, 'gross_usd', round(p.gross_usd, 2),
               'refunds', p.refunds, 'chargebacks', p.chargebacks,
               'refund_rate', round(100.0 * p.refunds_safra / nullif(p.orders, 0), 1),
               'chargeback_rate', round(100.0 * p.chargebacks_safra / nullif(p.orders, 0), 2))
             ORDER BY p.orders DESC, p.refunds DESC, p.family)
      FROM por_plataforma p), '[]'::jsonb),
    'countries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'country', c.country, 'orders', c.orders, 'gross_usd', round(c.gross_usd, 2),
               'refunds', c.refunds, 'chargebacks', c.chargebacks,
               'refund_rate', round(100.0 * c.refunds_safra / nullif(c.orders, 0), 1),
               'chargeback_rate', round(100.0 * c.chargebacks_safra / nullif(c.orders, 0), 2))
             ORDER BY (c.country = 'Outros'), c.orders DESC, c.country)
      FROM paises c), '[]'::jsonb),
    'sales_series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('bucket', s.bucket, 'key', s.family, 'orders', s.orders,
                                          'gross_usd', round(s.gross_usd, 2)) ORDER BY s.bucket, s.family)
      FROM s_vendas s), '[]'::jsonb),
    'refunds_series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('bucket', s.bucket, 'key', s.family, 'count', s.n) ORDER BY s.bucket, s.family)
      FROM s_reemb s), '[]'::jsonb),
    'chargebacks_series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('bucket', s.bucket, 'key', s.family, 'count', s.n) ORDER BY s.bucket, s.family)
      FROM s_cb s), '[]'::jsonb),
    'rates_series', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'bucket', s.bucket, 'orders', s.orders,
               'refund_rate', round(100.0 * s.refunds / nullif(s.orders, 0), 1),
               'chargeback_rate', round(100.0 * s.chargebacks / nullif(s.orders, 0), 2))
             ORDER BY s.bucket)
      FROM s_taxas s), '[]'::jsonb),
    'refund_reasons', coalesce((
      SELECT jsonb_agg(jsonb_build_object('reason', x.reason, 'count', x.n,
                                          'pct', round(100.0 * x.n / nullif(x.total, 0), 1))
             ORDER BY x.n DESC)
      FROM (SELECT reason, count(*)::int AS n, sum(count(*)) OVER () AS total
            FROM reemb WHERE reason IS NOT NULL GROUP BY reason) x), '[]'::jsonb),
    'refunds_without_reason', (SELECT count(*) FROM reemb WHERE reason IS NULL),
    'refund_days', coalesce((
      SELECT jsonb_agg(jsonb_build_object('bucket', x.faixa, 'count', x.n) ORDER BY x.ordem)
      FROM (SELECT faixa, ordem, count(*)::int AS n FROM dias GROUP BY faixa, ordem) x), '[]'::jsonb),
    'refund_days_median', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (refund_at - purchase_at)) / 86400)
      FROM reemb WHERE purchase_at IS NOT NULL AND refund_at >= purchase_at),
    -- Opções do filtro: todas as famílias com dado, independente do filtro.
    'platforms', coalesce((
      SELECT jsonb_agg(DISTINCT public.xmx_platform_family(platform_id))
      FROM (SELECT DISTINCT platform_id FROM public.xmx_sales_daily
            UNION SELECT DISTINCT platform_id FROM public.xmx_refunds) p), '[]'::jsonb),
    'group_by', v_unit,
    'sync', (SELECT jsonb_build_object(
        'last_sync_at', last_success_at, 'last_status', last_status,
        'ready', backfill_done AND v2_backfill_done AND sales_backfill_done)
      FROM public.xmx_sync_state WHERE id = 1)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_xmx_sistema(date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_xmx_sistema(date, date, text, text) TO authenticated;
