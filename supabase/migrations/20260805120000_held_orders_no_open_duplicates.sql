-- Pedidos em Espera — um pedido EM ABERTO por vez (fim da duplicação na caixa do agente).
--
-- Problema relatado (05/08/2026): os agentes veem o mesmo cliente/e-mail repetido
-- várias vezes em /workspace/pedidos-espera.
--
-- Causa: a migração 20260623000100_held_orders_store_all.sql removeu TODA a
-- deduplicação do import (nenhum ON CONFLICT, constraint única dropada), então:
--   * o relatório diário de On Holds ainda lista o pedido que continua retido de
--     ontem -> cada import cria uma linha nova (id uuid novo) do mesmo pedido;
--   * reenviar o mesmo arquivo duplica tudo, sem aviso nenhum.
-- Aquela migração corrigia o problema OPOSTO (20260623000000): a dedupe global
-- descartava um arquivo inteiro em silêncio ("coloquei ontem e não consigo colocar
-- mais hoje"). O que faltava não era guardar tudo — era a gestora SABER o que foi
-- ignorado.
--
-- Regra de negócio nova (confirmada com o usuário em 05/08/2026):
--   * Identidade do pedido = (dyna_code, import_key). import_key já é
--     order_number quando existe, senão o hash do conteúdo da linha
--     (ver 20260622000100). Mesmo e-mail com pedidos DIFERENTES continua gerando
--     dois cards — são dois atendimentos de verdade.
--   * Exceção necessária nas DEVOLUÇÕES: dyna_code é a constante 'RETURNS' para
--     todas as lojas, e um mesmo pedido pode voltar em mais de um RMA (devolução
--     parcial). Só order_number engoliria o 2º RMA como se fosse repetição, o que
--     seria PERDER linha legítima. Então o RMA, quando existe, entra na identidade.
--     Para On Holds nada muda (rma é sempre nulo lá).
--   * Só é repetição se JÁ EXISTE uma linha daquele pedido ainda em aberto
--     (agent_status <> 'concluido'). Se a anterior foi concluída e o pedido voltou
--     a ficar retido, é trabalho novo e entra normalmente.
--   * O corte é no IMPORT, e o retorno passa a dizer quantas linhas foram ignoradas
--     e quais pedidos eram (nunca mais silêncio).
--
-- Nada é apagado: o histórico de linhas já duplicadas é preservado e apenas
-- MARCADO via duplicate_of, saindo da lista do agente e das contagens de carga de
-- trabalho, mas continuando visível para a gestora.
--
-- Convenções (ver 20260617000000_create_held_orders.sql):
--   * ids de agente são TEXT, comparados com auth.uid()::text.
--   * Escritas só via RPC SECURITY DEFINER.

-- ============================================================================
-- 1) Coluna duplicate_of — aponta para a linha "boa" (keeper) daquele pedido.
--    NULL = linha própria/original. NOT NULL = repetição consolidada.
-- ============================================================================
ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS duplicate_of uuid
    REFERENCES public.held_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_held_orders_duplicate_of
  ON public.held_orders (duplicate_of) WHERE duplicate_of IS NOT NULL;

-- ============================================================================
-- 1b) Alinha a identidade das devoluções já importadas: onde há RMA, ele passa a
--     fazer parte da import_key, igual ao que o import passa a calcular. Sem isso
--     as linhas antigas (import_key = order_number) não casariam com as novas e a
--     devolução voltaria a duplicar. Só mexe em linha de devolução com RMA cuja
--     import_key ainda é o número do pedido puro.
-- ============================================================================
UPDATE public.held_orders
SET import_key = order_number || '#' || rma
WHERE rma IS NOT NULL
  AND order_number IS NOT NULL
  AND import_key = order_number;

-- ============================================================================
-- 2) Consolidação do que já está duplicado em produção.
--    Por grupo (dyna_code, import_key) das linhas EM ABERTO, mantém uma e marca
--    as outras. Fica a linha mais adiantada, para não jogar fora trabalho já feito:
--      em_andamento > já atribuída > com pendência marcada > mais eventos >
--      importada primeiro > id (desempate estável).
--    Linhas concluídas não são tocadas — são histórico.
-- ============================================================================
DO $$
DECLARE
  v_marked int;
BEGIN
  WITH open_rows AS (
    SELECT
      o.id, o.dyna_code, o.import_key, o.agent_status, o.assigned_to,
      o.pending_tag, o.imported_at,
      (SELECT count(*) FROM public.held_order_events e WHERE e.order_id = o.id) AS events
    FROM public.held_orders o
    WHERE o.agent_status <> 'concluido'
      AND o.duplicate_of IS NULL
      AND o.import_key IS NOT NULL
  ),
  ranked AS (
    SELECT
      id,
      first_value(id) OVER (
        PARTITION BY dyna_code, import_key
        ORDER BY
          (agent_status = 'em_andamento') DESC,
          (assigned_to IS NOT NULL) DESC,
          (pending_tag IS NOT NULL) DESC,
          events DESC,
          imported_at ASC,
          id ASC
      ) AS keeper_id
    FROM open_rows
  ),
  upd AS (
    UPDATE public.held_orders o
    SET duplicate_of = r.keeper_id
    FROM ranked r
    WHERE o.id = r.id
      AND r.keeper_id <> r.id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_marked FROM upd;

  RAISE NOTICE 'held_orders: % linha(s) repetida(s) em aberto consolidadas', v_marked;
END $$;

-- Invariante daqui para frente: no máximo UMA linha em aberto por pedido.
-- Também serve de índice para a checagem de repetição do import e é o árbitro do
-- ON CONFLICT (protege contra dois imports simultâneos do mesmo arquivo).
CREATE UNIQUE INDEX IF NOT EXISTS held_orders_one_open_per_identity_uniq
  ON public.held_orders (dyna_code, import_key)
  WHERE agent_status <> 'concluido' AND duplicate_of IS NULL;

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

-- ============================================================================
-- 4) my_held_orders — a caixa do agente ignora linhas marcadas como repetição.
--    (mesma projeção/ordenação de 20260729120000; só acrescenta o filtro)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_held_orders(p_status text DEFAULT 'all')
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)
           ORDER BY
             CASE t.agent_status WHEN 'novo' THEN 0 WHEN 'em_andamento' THEN 1 ELSE 2 END,
             CASE WHEN t.pending_tag IS NOT NULL THEN 0 ELSE 1 END,
             t.order_date ASC NULLS LAST, t.id), '[]'::jsonb)
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
      o.agent_status,
      o.pending_tag,
      o.confirmed_at,
      (SELECT count(*)::int FROM public.held_order_events e WHERE e.order_id = o.id) AS event_count
    FROM public.held_orders o
    WHERE o.assigned_to = v_uid
      AND o.duplicate_of IS NULL
      AND (
        p_status = 'all' OR p_status IS NULL OR o.agent_status = p_status
        -- compatibilidade: chamadas antigas pediam 'pending'/'confirmed'
        OR (p_status = 'pending'   AND o.agent_status <> 'concluido')
        OR (p_status = 'confirmed' AND o.agent_status =  'concluido')
      )
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.my_held_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_held_orders(text) TO authenticated;

-- ============================================================================
-- 5) my_held_orders_daily_metrics — meta e pendentes também ignoram repetições.
--    O filtro em confirmed_today existe porque set_held_order_status continua
--    aceitando escrita em linha marcada (uma aba velha do agente pode concluir uma
--    repetição). A escrita não quebra, mas não infla a meta do dia.
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
    AND o.agent_status = 'concluido'
    AND o.duplicate_of IS NULL
    AND (o.confirmed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT count(*)::int INTO v_pending
  FROM public.held_orders o
  WHERE o.assigned_to = v_uid
    AND o.agent_status <> 'concluido'
    AND o.duplicate_of IS NULL;

  RETURN jsonb_build_object(
    'confirmed_today', v_confirmed_today,
    'pending', v_pending,
    'goal', v_goal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_held_orders_daily_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_held_orders_daily_metrics() TO authenticated;

-- ============================================================================
-- 6) manager_distribute_held_orders — nunca manda uma repetição para o agente.
--    (mesma lógica round-robin de 20260629000000; só acrescenta o filtro)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_distribute_held_orders(
  p_order_ids uuid[],
  p_agent_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agents   text[];
  v_n        int;
  v_moved    int := 0;
  v_by_agent jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids is required';
  END IF;

  -- Normaliza a lista de agentes: remove nulos/vazios e duplicados, ordena estável.
  SELECT array_agg(a ORDER BY a) INTO v_agents
  FROM (SELECT DISTINCT unnest(p_agent_ids) AS a) s
  WHERE a IS NOT NULL AND length(a) > 0;

  v_n := COALESCE(array_length(v_agents, 1), 0);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'at least one destination agent is required';
  END IF;

  -- Todos os agentes destino precisam existir e estar ativos.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_agents) x(id)
    LEFT JOIN public.profiles p ON p.id = x.id
    WHERE p.id IS NULL OR p.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'one or more destination agents not found or inactive';
  END IF;

  WITH ordered AS (
    SELECT o.id,
           (row_number() OVER (ORDER BY o.order_date DESC NULLS LAST, o.id)) - 1 AS rn
    FROM public.held_orders o
    WHERE o.id = ANY(p_order_ids)
      AND o.agent_status <> 'concluido'
      AND o.duplicate_of IS NULL
  ),
  upd AS (
    UPDATE public.held_orders o
    SET assigned_to  = v_agents[(ord.rn % v_n) + 1],
        assign_count = o.assign_count + 1
    FROM ordered ord
    WHERE o.id = ord.id
    RETURNING o.assigned_to AS agent_id
  ),
  agg AS (
    SELECT u.agent_id, count(*)::int AS cnt
    FROM upd u
    GROUP BY u.agent_id
  )
  SELECT
    COALESCE(sum(a.cnt), 0)::int,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('agent_id', a.agent_id, 'full_name', p.full_name, 'count', a.cnt)
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
  INTO v_moved, v_by_agent
  FROM agg a
  LEFT JOIN public.profiles p ON p.id = a.agent_id;

  RETURN jsonb_build_object('moved', v_moved, 'by_agent', v_by_agent);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_distribute_held_orders(uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_distribute_held_orders(uuid[], text[]) TO authenticated;

-- ============================================================================
-- 7) manager_list_held_orders — expõe duplicate_of + contagem de repetições.
--    As linhas repetidas continuam na listagem (auditoria, com badge na UI), mas
--    saem do resumo por agente: aquele número é carga de trabalho real.
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
  v_rows       jsonb;
  v_total      bigint;
  v_duplicates bigint;
  v_summary    jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE o.duplicate_of IS NOT NULL)
  INTO v_total, v_duplicates
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
      o.agent_status,
      o.pending_tag,
      o.assign_count,
      o.assigned_to,
      pa.full_name        AS assigned_to_name,
      o.confirmed_at,
      o.imported_at,
      o.duplicate_of::text AS duplicate_of
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
      AND o.duplicate_of IS NULL
    GROUP BY o.assigned_to, p.full_name
  ) s;

  RETURN jsonb_build_object(
    'total', v_total,
    'duplicates', v_duplicates,
    'rows', v_rows,
    'summary_by_agent', v_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_list_held_orders(date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_list_held_orders(date, date, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
