-- Comparativo sistema XMX: reembolsos vindos do banco MySQL de VENDAS da XMX
-- (homosistemaxmx, do dev do sistema de vendas), copiados para cá pela Edge
-- Function `xmx-refunds-sync`.
--
-- Por que por PLATAFORMA e não por produto: `orders` não tem produto nem
-- variante, e a tabela de itens do pedido não está liberada para o nosso
-- usuário (SHOW GRANTS conferido em 10/10/2026). As colunas product_* já
-- existem e ficam NULL até o dev liberar a ligação pedido → produto; aí a
-- sincronização passa a preenchê-las e a chave natural ganha o produto.
--
-- Granularidade: uma linha por linha de `orders` (orders.id) que já esteve em
-- status de reembolso. Pedido que sai do reembolso vira is_refunded = false
-- (não apagamos). Sem nome nem e-mail de cliente (LGPD) — o gráfico não usa.
--
-- Leitura só pela RPC dashboard_xmx_refunds (RLS ligada e sem policy);
-- escrita só por xmx_refunds_apply (service_role, chamada pela Edge Function).

CREATE TABLE IF NOT EXISTS public.xmx_refunds (
  external_order_id bigint      PRIMARY KEY,               -- orders.id
  platform_id       int         NOT NULL,
  platform_name     text,
  order_code        text,                                  -- orders.order_id_cartpanda
  refund_kind       text        NOT NULL CHECK (refund_kind IN ('total', 'parcial')),
  status_raw        text,                                  -- orders.status_id como veio
  refund_at         timestamptz,                           -- orders.date_refund (horário de SP)
  purchase_at       timestamptz,                           -- orders.purchase_date (horário de SP)
  refund_amount     numeric,                               -- soma deduplicada de refunds_orders
  refund_currency   text        CHECK (refund_currency IN ('BRL', 'USD')),
  product_id        int,                                   -- reservado: falta a tabela de itens
  product_name      text,
  product_color     text,
  is_refunded       boolean     NOT NULL DEFAULT true,
  source_updated_at timestamptz,                           -- orders.updated_at
  synced_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.xmx_refunds IS
  'Reembolsos do banco de vendas da XMX (MySQL homosistemaxmx). Escrita só pela Edge Function xmx-refunds-sync; leitura só pela RPC dashboard_xmx_refunds.';

CREATE INDEX IF NOT EXISTS xmx_refunds_refund_at_idx
  ON public.xmx_refunds (refund_at) WHERE is_refunded;

ALTER TABLE public.xmx_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xmx_refunds FROM anon, authenticated;

-- Estado da sincronização: uma linha só (id = 1).
CREATE TABLE IF NOT EXISTS public.xmx_sync_state (
  id                 int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor_updated_at  timestamptz,          -- maior orders.updated_at já processado
  backfill_cursor_id bigint      NOT NULL DEFAULT 0,  -- carga inicial paginada por orders.id
  backfill_done      boolean     NOT NULL DEFAULT false,
  last_run_at        timestamptz,
  last_success_at    timestamptz,
  last_status        text,                 -- 'ok' | 'erro'
  rows_upserted      int,
  rows_unrefunded    int,
  error              text
);
INSERT INTO public.xmx_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.xmx_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xmx_sync_state FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Escrita: aplica um lote vindo do MySQL. Idempotente (rodar 2x dá o mesmo).
--
-- p_rows: [{ id, platform_id, platform_name, order_code, kind ('total'|'parcial'|null),
--            status, refund_at, purchase_at ('YYYY-MM-DD HH:MM:SS', horário de SP),
--            amount, currency, updated_at (ISO UTC) }]
--   kind null = o pedido NÃO está em reembolso agora: se já estava aqui, vira
--   is_refunded = false; se não estava, é ignorado.
-- p_state: campos de xmx_sync_state a gravar no fim (cursor, backfill, status).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xmx_refunds_apply(p_rows jsonb, p_state jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_upserted   int := 0;
  v_unrefunded int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH src AS (
    SELECT *
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(
      id bigint, platform_id int, platform_name text, order_code text, kind text,
      status text, refund_at text, purchase_at text, amount numeric, currency text,
      updated_at timestamptz
    )
  ),
  up AS (
    INSERT INTO public.xmx_refunds AS t (
      external_order_id, platform_id, platform_name, order_code, refund_kind, status_raw,
      refund_at, purchase_at, refund_amount, refund_currency, is_refunded,
      source_updated_at, synced_at
    )
    SELECT id, platform_id, platform_name, order_code, kind, status,
           nullif(refund_at, '')::timestamp AT TIME ZONE 'America/Sao_Paulo',
           nullif(purchase_at, '')::timestamp AT TIME ZONE 'America/Sao_Paulo',
           amount, currency, true, updated_at, now()
    FROM src
    WHERE kind IN ('total', 'parcial')
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
      is_refunded       = true,
      source_updated_at = EXCLUDED.source_updated_at,
      synced_at         = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_upserted FROM up;

  WITH src AS (
    SELECT * FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(id bigint, kind text, status text, updated_at timestamptz)
  ),
  down AS (
    UPDATE public.xmx_refunds t
       SET is_refunded = false, status_raw = s.status, source_updated_at = s.updated_at, synced_at = now()
      FROM src s
     WHERE s.kind IS NULL AND t.external_order_id = s.id AND t.is_refunded
    RETURNING 1
  )
  SELECT count(*) INTO v_unrefunded FROM down;

  UPDATE public.xmx_sync_state SET
    cursor_updated_at  = coalesce((p_state->>'cursor_updated_at')::timestamptz, cursor_updated_at),
    backfill_cursor_id = coalesce((p_state->>'backfill_cursor_id')::bigint, backfill_cursor_id),
    backfill_done      = coalesce((p_state->>'backfill_done')::boolean, backfill_done)
  WHERE id = 1;

  RETURN jsonb_build_object('upserted', v_upserted, 'unrefunded', v_unrefunded);
END;
$function$;

-- Registra o fim de uma execução (sucesso ou erro) para diagnóstico.
CREATE OR REPLACE FUNCTION public.xmx_sync_finish(p_status text, p_upserted int, p_unrefunded int, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.xmx_sync_state SET
    last_run_at     = now(),
    last_success_at = CASE WHEN p_status = 'ok' THEN now() ELSE last_success_at END,
    last_status     = p_status,
    rows_upserted   = p_upserted,
    rows_unrefunded = p_unrefunded,
    error           = left(p_error, 2000)
  WHERE id = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.xmx_refunds_apply(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xmx_sync_finish(text, int, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xmx_refunds_apply(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.xmx_sync_finish(text, int, int, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Leitura: gráficos da aba "Comparativo sistema XMX".
--
-- Agrupa por FAMÍLIA de checkout: a "Nova Estrutura" (mai/2026) é a migração
-- do mesmo checkout, então Cartpanda (1) + Cartpanda Nova Estrutura (6) viram
-- "Cartpanda", BuyGoods (3) + (7) viram "BuyGoods". A cor de cada família é
-- fixa no front (a cor segue a plataforma, nunca o ranking).
--
-- Métrica: pedidos distintos com reembolso (total + parcial), datados por
-- refund_at no fuso de São Paulo. Fuso: date_refund é gravado como horário de
-- SP e lido assim, então o dia daqui = DATE(date_refund) no MySQL (conferido:
-- 08/10/2026 e set/2026 batem 100%). Atenção: em BuyGoods (3, 7), PagAmerican
-- (8) e HelpGrid (9) o valor parece estar em UTC (há date_refund até 3 h à
-- frente do NOW() do servidor) — mantemos o valor cru, como o sistema de vendas. Pedido = (plataforma, order_code): no
-- BuyGoods Nova Estrutura um pedido tem várias linhas (front + upsells).
-- group_by: 'day' | 'week' | 'month'. platform_filter: chave da família ou 'all'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xmx_platform_family(p_platform_id int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_platform_id
    WHEN 1 THEN 'cartpanda'   WHEN 6 THEN 'cartpanda'
    WHEN 3 THEN 'buygoods'    WHEN 7 THEN 'buygoods'
    WHEN 8 THEN 'pagamerican'
    WHEN 9 THEN 'helpgrid'
    WHEN 2 THEN 'clickbank'
    WHEN 4 THEN 'digistore'
    WHEN 5 THEN 'cartcandy'
    ELSE 'outras'
  END
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_xmx_refunds(
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
  v_result   jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_unit := CASE group_by WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' ELSE 'day' END;
  v_platform := NULLIF(NULLIF(platform_filter, 'all'), '');

  WITH base AS (
    SELECT public.xmx_platform_family(r.platform_id) AS family,
           r.platform_id,
           coalesce(nullif(r.order_code, ''), r.external_order_id::text) AS order_key,
           r.refund_kind,
           (r.refund_at AT TIME ZONE 'America/Sao_Paulo') AS refund_local
    FROM public.xmx_refunds r
    WHERE r.is_refunded
      AND r.refund_at >= (from_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND r.refund_at <  ((to_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
  ),
  -- Um pedido conta uma vez; se tiver linhas total e parcial, vale 'total'.
  pedidos AS (
    SELECT family, platform_id, order_key,
           min(refund_local) AS refund_local,
           CASE WHEN bool_or(refund_kind = 'total') THEN 'total' ELSE 'parcial' END AS kind
    FROM base
    GROUP BY family, platform_id, order_key
  ),
  filtrados AS (
    SELECT * FROM pedidos WHERE v_platform IS NULL OR family = v_platform
  ),
  total AS (SELECT count(*)::int AS n FROM filtrados),
  dist AS (
    SELECT family, count(*)::int AS n,
           count(*) FILTER (WHERE kind = 'total')::int AS n_total,
           count(*) FILTER (WHERE kind = 'parcial')::int AS n_parcial
    FROM filtrados GROUP BY family
  ),
  serie AS (
    SELECT date_trunc(v_unit, refund_local)::date AS bucket, family, count(*)::int AS n
    FROM filtrados GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'distribution', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'key', d.family, 'count', d.n, 'total', d.n_total, 'parcial', d.n_parcial,
               'pct', round(100.0 * d.n / nullif((SELECT n FROM total), 0), 1))
             ORDER BY d.n DESC, d.family)
      FROM dist d), '[]'::jsonb),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('bucket', s.bucket, 'key', s.family, 'count', s.n)
             ORDER BY s.bucket, s.family)
      FROM serie s), '[]'::jsonb),
    'total', (SELECT n FROM total),
    'kinds', jsonb_build_object(
      'total',   (SELECT count(*) FROM filtrados WHERE kind = 'total'),
      'parcial', (SELECT count(*) FROM filtrados WHERE kind = 'parcial')),
    -- Opções do filtro: dependem só do período, nunca do próprio filtro.
    'platforms', coalesce((SELECT jsonb_agg(DISTINCT family) FROM pedidos), '[]'::jsonb),
    'group_by', v_unit,
    'last_sync_at', (SELECT last_success_at FROM public.xmx_sync_state WHERE id = 1),
    'last_status',  (SELECT last_status FROM public.xmx_sync_state WHERE id = 1),
    'backfill_done', (SELECT backfill_done FROM public.xmx_sync_state WHERE id = 1)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_xmx_refunds(date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_xmx_refunds(date, date, text, text) TO authenticated;
