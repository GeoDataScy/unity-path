-- Pedidos em Espera — suporte ao formato de DEVOLUÇÕES (Returned Shipments).
--
-- Além do CSV "On Holds Details" (com dyna_code/loja), o manager passa a importar o
-- arquivo de devoluções (presgera-...-returns.xls), cujas colunas são:
--   Order Number | Return Date | RMA # | Ship Name | Email |
--   Returned Items | Restocked Items | Damaged | Reason | Comments
--
-- Mapeamento (feito no cliente, em parseHeldOrdersCsv.ts):
--   Order Number    -> order_number
--   Return Date     -> order_date
--   RMA #           -> rma            (coluna nova)
--   Ship Name       -> customer_name
--   Email           -> email
--   Returned Items  -> items
--   Restocked Items -> restocked_items (coluna nova)
--   Damaged         -> damaged_items   (coluna nova)
--   Reason          -> reason
--   Comments        -> comments        (coluna nova)
--
-- Devoluções não têm "loja"; o cliente preenche dyna_code = 'RETURNS' (constante) para
-- preservar a identidade/deduplicação por (dyna_code, order_number) já existente.
-- Nenhuma alteração de chave/constraint é necessária.

-- ============================================================================
-- 1) Novas colunas
-- ============================================================================
ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS rma             text,
  ADD COLUMN IF NOT EXISTS restocked_items text,
  ADD COLUMN IF NOT EXISTS damaged_items   text,
  ADD COLUMN IF NOT EXISTS comments        text;

-- ============================================================================
-- 2) manager_import_held_orders(p_rows jsonb) -> {inserted, skipped}
--    Reescrito para gravar os campos novos. Mantém ON CONFLICT DO NOTHING.
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
      NULLIF(r->>'rma', '')                AS rma,
      NULLIF(r->>'restocked_items', '')    AS restocked_items,
      NULLIF(r->>'damaged_items', '')      AS damaged_items,
      NULLIF(r->>'comments', '')           AS comments,
      NULLIF(r->>'source_file', '')        AS source_file
    FROM jsonb_array_elements(p_rows) AS r
    WHERE NULLIF(trim(r->>'dyna_code'), '') IS NOT NULL
      AND NULLIF(trim(r->>'order_number'), '') IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.held_orders (
      dyna_code, order_number, merged_orders, reason, order_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, rma, restocked_items, damaged_items, comments,
      source_file, imported_by
    )
    SELECT
      dyna_code, order_number, merged_orders, reason, order_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, rma, restocked_items, damaged_items, comments,
      source_file, v_manager
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
-- 3) manager_list_held_orders(...) -> inclui campos novos nas rows
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
      o.rma,
      o.restocked_items,
      o.damaged_items,
      o.comments,
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
-- 4) my_held_orders(p_status text) -> inclui campos novos
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
      o.rma,
      o.restocked_items,
      o.damaged_items,
      o.comments,
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

NOTIFY pgrst, 'reload schema';
