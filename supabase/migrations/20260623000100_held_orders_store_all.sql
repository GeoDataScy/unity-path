-- Pedidos em Espera — armazenar ABSOLUTAMENTE TUDO (sem deduplicação).
--
-- Decisão de negócio atualizada: o manager precisa que toda linha das planilhas
-- (CSV / XLS / XLSX) apareça, esteja repetida ou não. Isso substitui a regra
-- anterior de dedupe por arquivo (20260623000000) e a dedupe global original.
--
-- Mudanças:
--   1) Remove a constraint única (source_file, import_key) — nada mais é descartado
--      por já existir.
--   2) Reescreve manager_import_held_orders: insere todas as linhas que tenham
--      algum dado, sem ON CONFLICT e sem DISTINCT ON. Linhas 100% vazias continuam
--      ignoradas (o parser do front já as remove; isto é só uma rede de segurança).
--
-- A coluna import_key é mantida (preenchida para referência), mas não é mais chave.
-- A identidade de cada registro passa a ser apenas a PK `id` (uuid gerado por linha).

-- 1) Sem unicidade: cada linha importada é um registro novo.
ALTER TABLE public.held_orders DROP CONSTRAINT IF EXISTS held_orders_file_key_uniq;
ALTER TABLE public.held_orders DROP CONSTRAINT IF EXISTS held_orders_dyna_key_uniq;

-- 2) Import sem deduplicação alguma.
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
      -- import_key: mantido só como referência (order_number quando houver,
      -- senão um hash do conteúdo). NÃO é mais chave de unicidade.
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
    RETURNING 1
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_total - v_inserted  -- agora só conta linhas 100% vazias
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_import_held_orders(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_import_held_orders(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
