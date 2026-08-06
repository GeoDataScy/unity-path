-- Pedidos em Espera — a regra que VALE é "uma linha em aberto por pedido POR LOJA".
--
-- Contexto (06/08/2026): duas migrações resolveram o mesmo problema em paralelo.
--   * 20260805120000_held_orders_no_open_duplicates.sql (PR #6): identidade
--     (dyna_code, import_key), bloqueia só quando já existe linha EM ABERTO, deixa
--     recorrência entrar como trabalho novo, trata devolução parcial (RMA na
--     identidade) e marca as repetições antigas via duplicate_of.
--   * 20260806120000_held_orders_dedupe_by_order_number.sql (PR #7): bloqueio
--     GLOBAL por Order ID, em qualquer loja e qualquer status.
--
-- A regra global se mostrou ERRADA nos dados reais: Order IDs curtos se repetem
-- entre lojas para clientes DIFERENTES (ex.: pedido "1066" é Kevin Silva na DSA023 e
-- Lee Warth na DSA024) — bloquear por Order ID global descartaria atendimento
-- legítimo. Também recusaria recorrência (pedido concluído que volta a ficar retido,
-- que é trabalho novo) e o 2º RMA de uma devolução parcial.
--
-- Como 20260806120000 tem timestamp POSTERIOR, num replay do zero ela sobrescreveria
-- a versão boa. Esta migração fecha isso: reinstala manager_import_held_orders na
-- versão do PR #6 (definição idêntica à de 20260805120000) e remove os índices que
-- só serviam à regra global.

DROP INDEX IF EXISTS public.idx_held_orders_order_key;
DROP INDEX IF EXISTS public.idx_held_orders_file_import_key;

-- ============================================================================
-- 3) manager_import_held_orders — ignora repetições e RELATA o que ignorou.
--    Retorno: { total, inserted, duplicates, empty_rows, duplicate_orders, skipped }
--      duplicates       — linhas do arquivo que já tinham pedido em aberto (ou que
--                         se repetiam dentro do próprio lote)
--      empty_rows       — linhas sem nenhum dado aproveitável
--      duplicate_orders — amostra (até 20) dos pedidos ignorados, para a gestora
--                         conferir na hora
--      skipped          — duplicates + empty_rows; mantido porque o bundle antigo
--                         ainda cacheado nos navegadores lê esse campo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_import_held_orders(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manager    text;
  v_total      int := 0;
  v_with_data  int := 0;
  v_inserted   int := 0;
  v_duplicates int := 0;
  v_dup_orders jsonb := '[]'::jsonb;
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
      -- Identidade do pedido: order_number (+ RMA nas devoluções parciais) quando
      -- houver; senão hash do conteúdo da linha.
      COALESCE(
        NULLIF(trim(r->>'order_number'), '')
          || COALESCE('#' || NULLIF(trim(r->>'rma'), ''), ''),
        md5(concat_ws('|',
          r->>'order_date', r->>'email', r->>'name', r->>'reason', r->>'items',
          r->>'merged_orders', r->>'rma', r->>'restocked_items', r->>'damaged_items',
          r->>'comments', r->>'city', r->>'state', r->>'country', r->>'postal_code',
          r->>'street1', r->>'street2', r->>'street3', r->>'age'))
      ) AS import_key,
      ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, ord)
  ),
  -- Colapsa repetições DENTRO do próprio lote (o mesmo pedido em dois arquivos
  -- selecionados juntos, ou a mesma linha repetida no arquivo). Fica a primeira
  -- ocorrência na ordem do arquivo (ord) — desempate determinístico.
  dedup AS (
    SELECT DISTINCT ON (dyna_code, import_key) *
    FROM src
    WHERE has_data
    ORDER BY dyna_code, import_key, ord
  ),
  -- Repetição de pedido que JÁ está em aberto no banco: não entra.
  fresh AS (
    SELECT d.*
    FROM dedup d
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.held_orders o
      WHERE o.dyna_code = d.dyna_code
        AND o.import_key = d.import_key
        AND o.agent_status <> 'concluido'
        AND o.duplicate_of IS NULL
    )
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
    FROM fresh
    -- Backstop de corrida: dois imports simultâneos do mesmo arquivo não veem as
    -- linhas não commitadas do outro; o índice parcial único resolve.
    ON CONFLICT (dyna_code, import_key)
      WHERE agent_status <> 'concluido' AND duplicate_of IS NULL
      DO NOTHING
    RETURNING 1
  ),
  -- Amostra dos pedidos ignorados, pelos DOIS motivos: já estava em aberto no
  -- banco, ou se repetia dentro do próprio lote.
  dup_labels AS (
    SELECT COALESCE(d.order_number, '(sem número)') AS label
    FROM dedup d
    WHERE EXISTS (
      SELECT 1
      FROM public.held_orders o
      WHERE o.dyna_code = d.dyna_code
        AND o.import_key = d.import_key
        AND o.agent_status <> 'concluido'
        AND o.duplicate_of IS NULL
    )
    UNION
    SELECT COALESCE(s.order_number, '(sem número)')
    FROM (
      SELECT order_number,
             row_number() OVER (PARTITION BY dyna_code, import_key ORDER BY ord) AS rn
      FROM src
      WHERE has_data
    ) s
    WHERE s.rn > 1
  ),
  dup_sample AS (
    SELECT label FROM dup_labels ORDER BY label LIMIT 20
  )
  SELECT
    (SELECT count(*)::int FROM src WHERE has_data),
    (SELECT count(*)::int FROM ins),
    (SELECT COALESCE(jsonb_agg(label), '[]'::jsonb) FROM dup_sample)
  INTO v_with_data, v_inserted, v_dup_orders;

  v_duplicates := v_with_data - v_inserted;

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'empty_rows', v_total - v_with_data,
    'duplicate_orders', v_dup_orders,
    -- compatibilidade com o bundle antigo (lê apenas inserted/skipped)
    'skipped', v_total - v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_import_held_orders(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_import_held_orders(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
