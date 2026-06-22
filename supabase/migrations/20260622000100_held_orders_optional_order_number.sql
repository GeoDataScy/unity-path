-- Pedidos em Espera — importar QUALQUER linha que tenha algum dado.
--
-- Antes: só entravam linhas com order_number (e a dedupe era por (dyna_code, order_number)).
-- Agora: qualquer linha com pelo menos um campo preenchido é importada; colunas vazias
-- ficam NULL. order_number deixa de ser obrigatório.
--
-- Dedupe: como nem toda linha tem order_number, a chave passa a ser uma `import_key`:
--   * order_number quando presente (mantém o comportamento anterior);
--   * senão, um md5 do conteúdo da linha (reimportar o mesmo arquivo não duplica).
-- A unicidade continua escopada por dyna_code (loja / "RETURNS").

-- 1) order_number opcional + nova coluna de chave de importação
ALTER TABLE public.held_orders
  ALTER COLUMN order_number DROP NOT NULL;

ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS import_key text;

-- Backfill: linhas existentes usavam order_number (era NOT NULL) como identidade.
UPDATE public.held_orders SET import_key = order_number WHERE import_key IS NULL;

-- Troca a constraint única (dyna_code, order_number) -> (dyna_code, import_key).
ALTER TABLE public.held_orders DROP CONSTRAINT IF EXISTS held_orders_dyna_order_uniq;
ALTER TABLE public.held_orders
  ADD CONSTRAINT held_orders_dyna_key_uniq UNIQUE (dyna_code, import_key);

-- 2) manager_import_held_orders: aceita linhas sem order_number; calcula import_key.
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
      COALESCE(NULLIF(trim(r->>'dyna_code'), ''), 'RETURNS') AS dyna_code,
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
      NULLIF(r->>'source_file', '')        AS source_file,
      -- A linha tem algum dado real? (ignora dyna_code/source_file)
      NULLIF(trim(concat_ws('',
        r->>'order_number', r->>'merged_orders', r->>'reason', r->>'order_date',
        r->>'email', r->>'name', r->>'city', r->>'street1', r->>'street2',
        r->>'street3', r->>'state', r->>'country', r->>'postal_code', r->>'age',
        r->>'items', r->>'rma', r->>'restocked_items', r->>'damaged_items',
        r->>'comments')), '') IS NOT NULL AS has_data,
      -- Chave de dedupe: order_number se houver, senão hash do conteúdo da linha.
      COALESCE(
        NULLIF(trim(r->>'order_number'), ''),
        md5(concat_ws('|',
          r->>'order_date', r->>'email', r->>'name', r->>'reason', r->>'items',
          r->>'merged_orders', r->>'rma', r->>'restocked_items', r->>'damaged_items',
          r->>'comments', r->>'city', r->>'state', r->>'country', r->>'postal_code',
          r->>'street1', r->>'street2', r->>'street3', r->>'age'))
      ) AS import_key
    FROM jsonb_array_elements(p_rows) AS r
  ),
  ins AS (
    INSERT INTO public.held_orders (
      dyna_code, order_number, merged_orders, reason, order_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, rma, restocked_items, damaged_items, comments,
      source_file, import_key, imported_by
    )
    SELECT
      dyna_code, order_number, merged_orders, reason, order_date, email,
      customer_name, city, street1, street2, street3, state, country,
      postal_code, age, items, rma, restocked_items, damaged_items, comments,
      source_file, import_key, v_manager
    FROM src
    WHERE has_data
    ON CONFLICT (dyna_code, import_key) DO NOTHING
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

NOTIFY pgrst, 'reload schema';
