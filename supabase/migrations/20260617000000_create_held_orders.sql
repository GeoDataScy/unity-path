-- Pedidos em Espera (On-Hold Orders) — nova fonte de atendimentos.
--
-- Pedidos retidos chegam em CSVs (LSD###_AAAA-MM-DD_On_Holds_Details.csv), um por
-- dyna_code (loja) por data. O manager faz upload na aba "Pedidos em Espera" da tela
-- de Usuários, distribui manualmente a agentes, e cada agente apenas CONFIRMA o
-- atendimento. A confirmação alimenta uma meta diária PRÓPRIA, separada da meta de
-- "Meus Atendimentos" — esta feature não toca em nada de services/refunds.
--
-- Convenções seguidas (ver 20260528000400_manager_ticket_reassign_rpcs.sql):
--   * profiles.id é TEXT -> colunas de id de agente são TEXT, comparadas com auth.uid()::text.
--   * RPCs SECURITY DEFINER + SET search_path TO 'public' + guard is_manager().
--   * Escritas só via RPC; nenhuma policy de INSERT/UPDATE direta.

-- ============================================================================
-- 1) Tabela held_orders
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.held_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dyna_code     text NOT NULL,
  order_number  text NOT NULL,
  merged_orders text,
  reason        text,
  order_date    date,
  email         text,
  customer_name text,
  city          text,
  street1       text,
  street2       text,
  street3       text,
  state         text,
  country       text,
  postal_code   text,
  age           text,                       -- mantém cru ("5 day(s)")
  items         text,
  source_file   text,                       -- nome do CSV de origem
  assigned_to   text REFERENCES public.profiles(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed'
  confirmed_at  timestamptz,
  confirmed_by  text REFERENCES public.profiles(id) ON DELETE SET NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  imported_by   text REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT held_orders_status_chk CHECK (status IN ('pending', 'confirmed')),
  CONSTRAINT held_orders_dyna_order_uniq UNIQUE (dyna_code, order_number)
);

CREATE INDEX IF NOT EXISTS idx_held_orders_assigned_to
  ON public.held_orders (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_held_orders_status
  ON public.held_orders (status);
CREATE INDEX IF NOT EXISTS idx_held_orders_confirmed_by_at
  ON public.held_orders (confirmed_by, confirmed_at) WHERE confirmed_at IS NOT NULL;

-- ============================================================================
-- 2) RLS — managers veem tudo; agente vê só o que está atribuído a ele.
--    Escritas são exclusivamente via RPCs SECURITY DEFINER (sem policy de write).
-- ============================================================================
ALTER TABLE public.held_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS held_orders_select ON public.held_orders;
CREATE POLICY held_orders_select ON public.held_orders
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (public.is_manager() OR assigned_to = auth.uid()::text)
  );

-- ============================================================================
-- 3) manager_import_held_orders(p_rows jsonb) -> {inserted, skipped}
--    Upsert ON CONFLICT (dyna_code, order_number) DO NOTHING: re-importar o mesmo
--    arquivo não duplica nem sobrescreve atribuição/confirmação já feitas.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_import_held_orders(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manager  text;
  v_total    int := 0;
  v_inserted int := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_manager := auth.uid()::text;
  v_total := jsonb_array_length(p_rows);

  WITH src AS (
    SELECT
      NULLIF(trim(r->>'dyna_code'), '')    AS dyna_code,
      NULLIF(trim(r->>'order_number'), '') AS order_number,
      NULLIF(r->>'merged_orders', '')      AS merged_orders,
      NULLIF(r->>'reason', '')             AS reason,
      -- order_date pode vir vazio ou em formato inesperado; ignora se não casar.
      CASE WHEN (r->>'order_date') ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (r->>'order_date')::date END AS order_date,
      NULLIF(r->>'email', '')              AS email,
      NULLIF(r->>'name', '')               AS customer_name,
      NULLIF(r->>'city', '')               AS city,
      NULLIF(r->>'street1', '')            AS street1,
      NULLIF(r->>'street2', '')            AS street2,
      NULLIF(r->>'street3', '')            AS street3,
      NULLIF(r->>'state', '')              AS state,
      NULLIF(r->>'country', '')            AS country,
      NULLIF(r->>'postal_code', '')        AS postal_code,
      NULLIF(r->>'age', '')                AS age,
      NULLIF(r->>'items', '')              AS items,
      NULLIF(r->>'source_file', '')        AS source_file
    FROM jsonb_array_elements(p_rows) AS r
    WHERE NULLIF(trim(r->>'dyna_code'), '') IS NOT NULL
      AND NULLIF(trim(r->>'order_number'), '') IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.held_orders (
      dyna_code, order_number, merged_orders, reason, order_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, source_file, imported_by
    )
    SELECT
      dyna_code, order_number, merged_orders, reason, order_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, source_file, v_manager
    FROM src
    ON CONFLICT (dyna_code, order_number) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_total - v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_import_held_orders(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_import_held_orders(jsonb) TO authenticated;

-- ============================================================================
-- 4) manager_list_held_orders(...) -> {total, rows, summary_by_agent}
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_list_held_orders(
  from_date     date    DEFAULT NULL,
  to_date       date    DEFAULT NULL,
  agent_id      text    DEFAULT NULL,
  status_filter text    DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows    jsonb;
  v_total   bigint;
  v_summary jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.held_orders o
  WHERE (from_date IS NULL OR o.order_date >= from_date)
    AND (to_date   IS NULL OR o.order_date <= to_date)
    AND (agent_id  IS NULL OR o.assigned_to = agent_id)
    AND (status_filter = 'all' OR status_filter IS NULL OR o.status = status_filter);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.order_date DESC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      o.id::text          AS id,
      o.dyna_code,
      o.order_number,
      o.merged_orders,
      o.reason,
      o.order_date,
      o.email,
      o.customer_name,
      o.city, o.state, o.country, o.postal_code,
      o.street1, o.street2, o.street3,
      o.age,
      o.items,
      o.source_file,
      o.status,
      o.assigned_to,
      pa.full_name        AS assigned_to_name,
      o.confirmed_at,
      o.imported_at
    FROM public.held_orders o
    LEFT JOIN public.profiles pa ON pa.id = o.assigned_to
    WHERE (from_date IS NULL OR o.order_date >= from_date)
      AND (to_date   IS NULL OR o.order_date <= to_date)
      AND (agent_id  IS NULL OR o.assigned_to = agent_id)
      AND (status_filter = 'all' OR status_filter IS NULL OR o.status = status_filter)
  ) t;

  -- Resumo por agente (apenas dos atribuídos), independente dos filtros de status.
  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.full_name), '[]'::jsonb)
    INTO v_summary
  FROM (
    SELECT
      o.assigned_to                                                   AS agent_id,
      p.full_name,
      count(*) FILTER (WHERE o.status = 'pending')::int               AS pending,
      count(*) FILTER (WHERE o.status = 'confirmed')::int             AS confirmed
    FROM public.held_orders o
    JOIN public.profiles p ON p.id = o.assigned_to
    WHERE o.assigned_to IS NOT NULL
    GROUP BY o.assigned_to, p.full_name
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows, 'summary_by_agent', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_list_held_orders(date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_list_held_orders(date, date, text, text) TO authenticated;

-- ============================================================================
-- 5) manager_assign_held_orders(p_order_ids uuid[], p_agent_id text) -> int
--    Atribui (ou reatribui) os pedidos ao agente. Só altera pedidos ainda
--    'pending' — confirmados não são remexidos. Destino deve ser ativo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_assign_held_orders(
  p_order_ids uuid[],
  p_agent_id  text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active  boolean;
  v_count   int := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_agent_id IS NULL OR length(p_agent_id) = 0 THEN
    RAISE EXCEPTION 'p_agent_id is required';
  END IF;
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids is required';
  END IF;

  SELECT is_active INTO v_active FROM public.profiles WHERE id = p_agent_id;
  IF v_active IS NULL THEN
    RAISE EXCEPTION 'destination user not found: %', p_agent_id;
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'destination user is inactive: %', p_agent_id;
  END IF;

  UPDATE public.held_orders
  SET assigned_to = p_agent_id
  WHERE id = ANY(p_order_ids)
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_assign_held_orders(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_assign_held_orders(uuid[], text) TO authenticated;

-- ============================================================================
-- 6) my_held_orders(p_status text) -> jsonb array (pedidos do agente logado)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_held_orders(p_status text DEFAULT 'pending')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    text;
  v_result jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.order_date ASC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      o.id::text   AS id,
      o.dyna_code,
      o.order_number,
      o.merged_orders,
      o.reason,
      o.order_date,
      o.email,
      o.customer_name,
      o.city, o.state, o.country, o.postal_code,
      o.street1, o.street2, o.street3,
      o.age,
      o.items,
      o.status,
      o.confirmed_at
    FROM public.held_orders o
    WHERE o.assigned_to = v_uid
      AND (p_status = 'all' OR p_status IS NULL OR o.status = p_status)
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.my_held_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_held_orders(text) TO authenticated;

-- ============================================================================
-- 7) confirm_held_order(p_order_id uuid) -> void
--    Só confirma se o pedido está atribuído ao chamador e ainda 'pending'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_held_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     text;
  v_updated int;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.held_orders
  SET status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = v_uid
  WHERE id = p_order_id
    AND assigned_to = v_uid
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'order not found, not assigned to you, or already confirmed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_held_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_held_order(uuid) TO authenticated;

-- ============================================================================
-- 8) my_held_orders_daily_metrics() -> {confirmed_today, pending, goal}
--    "Hoje" no fuso America/Sao_Paulo. Meta diária fixa (DEFAULT 30) — ajustável.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_held_orders_daily_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid             text;
  v_confirmed_today int;
  v_pending         int;
  v_goal            int := 30;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT count(*)::int INTO v_confirmed_today
  FROM public.held_orders o
  WHERE o.confirmed_by = v_uid
    AND (o.confirmed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT count(*)::int INTO v_pending
  FROM public.held_orders o
  WHERE o.assigned_to = v_uid
    AND o.status = 'pending';

  RETURN jsonb_build_object(
    'confirmed_today', v_confirmed_today,
    'pending', v_pending,
    'goal', v_goal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_held_orders_daily_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_held_orders_daily_metrics() TO authenticated;

NOTIFY pgrst, 'reload schema';
