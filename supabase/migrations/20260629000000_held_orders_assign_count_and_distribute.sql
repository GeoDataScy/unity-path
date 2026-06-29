-- Pedidos em Espera — distribuição em LOTE (round-robin) + contador de distribuições.
--
-- Necessidades (confirmadas com o usuário):
--   1) A manager precisa distribuir vários pedidos de uma vez, dividindo-os entre
--      VÁRIOS agentes automaticamente (round-robin), em vez de um por um.
--   2) Precisa saber, pelo status, QUANTAS VEZES um pedido já foi distribuído. Se o
--      agente não deu aceite na "pendência 1" e a manager redistribuiu, o pedido vira
--      "pendência 2", e assim por diante. Mapeamento do badge no manager:
--        * nunca distribuído (assign_count = 0)            -> "Novo"
--        * distribuído N vezes, ainda não concluído         -> "Pendente N"
--        * concluído (agent_status = 'concluido')           -> "Confirmado"
--
-- Convenções (ver 20260617000000 / 20260625000000 / 20260627000000): ids de agente
-- são TEXT comparados com auth.uid()::text; escrita só via RPC SECURITY DEFINER.

-- ============================================================================
-- 1) Coluna assign_count + backfill
-- ============================================================================
ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS assign_count int NOT NULL DEFAULT 0;

-- Pedidos que já estão atribuídos foram distribuídos pelo menos uma vez. Sem este
-- backfill eles apareceriam como "Novo" (count 0) mesmo já tendo agente.
UPDATE public.held_orders
SET assign_count = 1
WHERE assigned_to IS NOT NULL
  AND assign_count = 0;

-- ============================================================================
-- 2) manager_distribute_held_orders — distribuição em lote round-robin
--    Divide p_order_ids entre p_agent_ids ciclicamente e incrementa assign_count.
--    Só move pedidos ainda não concluídos (agent_status <> 'concluido').
--    Retorna { moved, by_agent: [{agent_id, full_name, count}] }.
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

  -- Round-robin: ordena os pedidos de forma determinística (mesma ordem da listagem),
  -- numera de 0..k-1 e mapeia para v_agents[(rn % n) + 1] (arrays são 1-indexed).
  -- assign_count incrementa em toda distribuição -> "pendência N".
  WITH ordered AS (
    SELECT o.id,
           (row_number() OVER (ORDER BY o.order_date DESC NULLS LAST, o.id)) - 1 AS rn
    FROM public.held_orders o
    WHERE o.id = ANY(p_order_ids)
      AND o.agent_status <> 'concluido'
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
-- 3) manager_assign_held_orders — agora delega para o distribuidor (1 agente).
--    Mantém a assinatura (uuid[], text) -> int para o cliente v1 ainda cacheado e
--    para a mutation atual. Assim o caminho de 1 agente também conta assign_count.
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
  v_result jsonb;
BEGIN
  IF p_agent_id IS NULL OR length(p_agent_id) = 0 THEN
    RAISE EXCEPTION 'p_agent_id is required';
  END IF;

  v_result := public.manager_distribute_held_orders(p_order_ids, ARRAY[p_agent_id]);
  RETURN COALESCE((v_result->>'moved')::int, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_assign_held_orders(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_assign_held_orders(uuid[], text) TO authenticated;

-- ============================================================================
-- 4) manager_list_held_orders — passa a devolver agent_status e assign_count
--    (necessários para o badge Novo / Pendente N / Confirmado).
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
      o.agent_status,
      o.assign_count,
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

NOTIFY pgrst, 'reload schema';
