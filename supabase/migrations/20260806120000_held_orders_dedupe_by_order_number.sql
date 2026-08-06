-- Pedidos em Espera — um pedido só entra na lista UMA vez (dedupe por Order ID).
--
-- Regra de negócio nova (substitui 20260623000100 "armazenar tudo"): ao importar a
-- planilha de On Holds / devoluções, o sistema valida se o Order ID já existe em
-- held_orders. Se já existir, a linha NÃO é importada — evita registros duplicados
-- e a inconsistência de o mesmo pedido cair para dois agentes.
--
-- Escopo da validação:
--   * global (não por loja/dyna_code, não por arquivo) e sobre TODOS os status
--     (pending/confirmed) — "já está na lista" basta para ignorar;
--   * comparação normalizada: btrim + lower (protege de "AB123 " vs "ab123");
--   * dedupe também DENTRO do lote: se o mesmo Order ID aparece em dois arquivos
--     selecionados de uma vez, entra só a primeira ocorrência;
--   * linhas SEM Order ID (planilhas de devolução às vezes vêm sem) não podem ser
--     identificadas por pedido; para elas vale só idempotência de arquivo — a mesma
--     linha do MESMO arquivo (source_file + import_key) não entra duas vezes, mas uma
--     linha idêntica vinda de outro arquivo continua entrando (não se descarta dado
--     legítimo por falta de identificador). Linhas 100% vazias seguem ignoradas.
--
-- Por que a checagem fica na RPC e não em UNIQUE constraint: a base já tem 706
-- linhas excedentes com Order ID repetido (herança do período "armazenar tudo"),
-- 415 delas com agente/status divergentes. Criar UNIQUE exigiria apagar trabalho já
-- atribuído/confirmado — decisão de negócio separada. A partir daqui nada novo
-- duplica; a limpeza do histórico pode ser feita depois.

-- 1) Índices p/ as checagens de existência (expressões idênticas às usadas na RPC).
CREATE INDEX IF NOT EXISTS idx_held_orders_order_key
  ON public.held_orders (lower(btrim(order_number)));
CREATE INDEX IF NOT EXISTS idx_held_orders_file_import_key
  ON public.held_orders (source_file, import_key);

-- 2) manager_import_held_orders: ignora Order IDs já cadastrados.
--    Retorno: {inserted, skipped, duplicates, empty, duplicate_samples}
--      inserted   -> linhas gravadas
--      duplicates -> linhas ignoradas por Order ID já existente (ou repetido no lote)
--      empty      -> linhas sem nenhum dado
--      skipped    -> duplicates + empty (mantido p/ compatibilidade)
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
  v_dup        int := 0;
  v_dup_sample jsonb := '[]'::jsonb;
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
      row_number() OVER () AS rn,
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
      -- Chave normalizada do pedido; NULL quando a linha não traz Order ID.
      lower(btrim(NULLIF(trim(r->>'order_number'), ''))) AS order_key,
      -- import_key: referência (order_number ou hash do conteúdo). Não é chave única.
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
  rows_with_data AS (
    SELECT * FROM src WHERE has_data
  ),
  -- Colapsa repetições dentro do próprio lote: por Order ID quando existe,
  -- senão por (arquivo + conteúdo).
  batch_unique AS (
    SELECT * FROM (
      SELECT s.*,
             CASE WHEN s.order_key IS NOT NULL
                  THEN row_number() OVER (PARTITION BY s.order_key ORDER BY s.rn)
                  ELSE row_number() OVER (PARTITION BY s.source_file, s.import_key ORDER BY s.rn)
             END AS dup_rank
      FROM rows_with_data s
    ) x
    WHERE dup_rank = 1
  ),
  -- Descarta o que já está cadastrado: Order ID em qualquer status/loja/arquivo;
  -- sem Order ID, apenas a mesma linha do mesmo arquivo.
  to_insert AS (
    SELECT b.*
    FROM batch_unique b
    WHERE CASE
      WHEN b.order_key IS NOT NULL THEN NOT EXISTS (
        SELECT 1 FROM public.held_orders h
        WHERE lower(btrim(h.order_number)) = b.order_key
      )
      ELSE NOT EXISTS (
        SELECT 1 FROM public.held_orders h
        WHERE h.source_file IS NOT DISTINCT FROM b.source_file
          AND h.import_key  IS NOT DISTINCT FROM b.import_key
      )
    END
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
    FROM to_insert
    RETURNING 1
  )
  SELECT
    (SELECT count(*)::int FROM ins),
    (SELECT count(*)::int FROM rows_with_data),
    (SELECT count(*)::int FROM rows_with_data) - (SELECT count(*)::int FROM to_insert),
    COALESCE((
      SELECT jsonb_agg(o.order_number)
      FROM (
        SELECT DISTINCT ON (r.order_key) r.order_number, r.order_key
        FROM rows_with_data r
        WHERE r.order_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM to_insert t WHERE t.rn = r.rn)
        ORDER BY r.order_key, r.rn
        LIMIT 10
      ) o
    ), '[]'::jsonb)
  INTO v_inserted, v_with_data, v_dup, v_dup_sample;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'duplicates', v_dup,
    'empty', v_total - v_with_data,
    'skipped', v_dup + (v_total - v_with_data),
    'duplicate_samples', v_dup_sample
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_import_held_orders(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_import_held_orders(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
