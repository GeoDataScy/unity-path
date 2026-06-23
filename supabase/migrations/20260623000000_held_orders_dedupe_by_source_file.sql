-- Pedidos em Espera — deduplicação por ARQUIVO (source_file), não global.
--
-- Problema: a chave única era (dyna_code, import_key). Como `dyna_code` é a
-- constante 'RETURNS' para todas as lojas/dias (e os On-Holds reaparecem no
-- relatório diário com o mesmo order_number), reimportar um arquivo novo cujos
-- números já existiam descartava TUDO silenciosamente (ON CONFLICT DO NOTHING).
-- Sintoma: "coloquei ontem e não consigo colocar mais hoje".
--
-- Correção: a chave passa a ser (source_file, import_key). Os nomes de arquivo já
-- trazem loja + data (ex.: steel-power-2026-06-22-...returns.xls,
-- LSD007_2026-06-07_On_Holds_Details.csv), então:
--   * reenviar o MESMO arquivo continua idempotente (não duplica);
--   * qualquer arquivo NOVO (outra loja / outro dia) importa todas as linhas,
--     mesmo que o order_number se repita.
--
-- Decisão de negócio confirmada: dedupe por arquivo; manter todos os dados atuais.

-- 1) Troca a constraint única (dyna_code, import_key) -> (source_file, import_key).
--    Linhas atuais já têm source_file + import_key preenchidos (sem nulos/colisões).
ALTER TABLE public.held_orders DROP CONSTRAINT IF EXISTS held_orders_dyna_key_uniq;
ALTER TABLE public.held_orders DROP CONSTRAINT IF EXISTS held_orders_file_key_uniq;
ALTER TABLE public.held_orders
  ADD CONSTRAINT held_orders_file_key_uniq UNIQUE (source_file, import_key);

-- 2) manager_import_held_orders: dedupe por (source_file, import_key) e também
--    dentro do próprio lote (DISTINCT ON), evitando violação de unicidade quando
--    um mesmo arquivo traz linhas idênticas repetidas.
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
  -- Colapsa linhas idênticas dentro do mesmo arquivo antes de inserir.
  dedup AS (
    SELECT DISTINCT ON (source_file, import_key) *
    FROM src
    WHERE has_data
    ORDER BY source_file, import_key
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
    FROM dedup
    ON CONFLICT (source_file, import_key) DO NOTHING
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
