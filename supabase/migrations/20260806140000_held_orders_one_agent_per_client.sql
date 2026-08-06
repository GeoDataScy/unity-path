-- Pedidos em Espera — um cliente, um agente.
--
-- Problema relatado (06/08/2026): depois da importação, o mesmo cliente aparece
-- para agentes diferentes. Dois agentes acabam falando com a mesma pessoa.
--
-- Causa: `manager_distribute_held_orders` faz round-robin POR LINHA. Como a regra de
-- dedupe (20260805120000) mantém pedidos DIFERENTES do mesmo cliente como linhas
-- separadas — e isso está certo, são dois atendimentos de verdade — o round-robin
-- espalha essas linhas entre agentes. Hoje são 8 clientes divididos em 2 agentes
-- (16 linhas em aberto).
--
-- Regra nova: a unidade de distribuição passa a ser o CLIENTE, não a linha.
--   * Identidade do cliente = e-mail normalizado; sem e-mail, o nome; sem nome, a
--     própria linha (não há como agrupar, então cada uma é "um cliente").
--   * Se o cliente JÁ tem pedido em aberto com um agente ativo, todo pedido novo dele
--     vai para esse MESMO agente (mesmo que ele não esteja na seleção do round-robin).
--   * Se não tem dono, o cliente inteiro (todas as linhas em aberto dele) vai para um
--     único agente do round-robin.
--   * Linhas do mesmo cliente que estavam com OUTRO agente vão junto — é o que evita
--     o conflito. O retorno informa quantas foram, para a gestora saber.
--   * Pedido concluído é histórico: não entra na conta nem é movido.
--
-- A invariante é garantida por trigger (não só pela RPC): nenhuma escrita pode deixar
-- um cliente com dois agentes em aberto. A validação olha apenas linhas cujo
-- `assigned_to` mudou naquela instrução, para não travar atualização de status.

-- ============================================================================
-- 1) Identidade do cliente (IMMUTABLE p/ poder indexar).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.held_order_client_key(
  p_email         text,
  p_customer_name text,
  p_id            uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(lower(btrim(p_email)), ''),
    'nome:' || NULLIF(lower(btrim(p_customer_name)), ''),
    'linha:' || p_id::text
  );
$$;

COMMENT ON FUNCTION public.held_order_client_key(text, text, uuid) IS
  'Identidade do cliente de um pedido em espera: e-mail; sem e-mail, o nome; sem nome, a própria linha.';

CREATE INDEX IF NOT EXISTS idx_held_orders_client_key_open
  ON public.held_orders (public.held_order_client_key(email, customer_name, id))
  WHERE duplicate_of IS NULL AND agent_status <> 'concluido';

-- ============================================================================
-- 2) Consolidação do que já está dividido entre agentes.
--    Por cliente, escolhe o agente que fica: agente ativo, depois quem já está
--    em_andamento, depois quem tem mais histórico registrado, depois o pedido mais
--    antigo (desempate por id).
--    Não incrementa assign_count — é correção, não uma nova distribuição.
--    Idempotente: sem cliente dividido, não faz nada.
-- ============================================================================
DO $$
DECLARE
  v_clients int := 0;
  v_rows    int := 0;
BEGIN
  WITH open_rows AS (
    SELECT o.id,
           o.assigned_to,
           public.held_order_client_key(o.email, o.customer_name, o.id) AS client_key,
           COALESCE(p.is_active, false) AS agent_active,
           (o.agent_status = 'em_andamento') AS working,
           o.imported_at,
           (SELECT count(*) FROM public.held_order_events e WHERE e.order_id = o.id) AS events
    FROM public.held_orders o
    LEFT JOIN public.profiles p ON p.id = o.assigned_to
    WHERE o.duplicate_of IS NULL
      AND o.agent_status <> 'concluido'
      AND o.assigned_to IS NOT NULL
  ),
  conflicted AS (
    SELECT client_key
    FROM open_rows
    GROUP BY client_key
    HAVING count(DISTINCT assigned_to) > 1
  ),
  keeper AS (
    SELECT DISTINCT ON (r.client_key) r.client_key, r.assigned_to AS agent_id
    FROM open_rows r
    JOIN conflicted c ON c.client_key = r.client_key
    ORDER BY r.client_key, r.agent_active DESC, r.working DESC, r.events DESC, r.imported_at, r.id
  ),
  upd AS (
    UPDATE public.held_orders o
    SET assigned_to = k.agent_id
    FROM open_rows r
    JOIN keeper k ON k.client_key = r.client_key
    WHERE o.id = r.id
      AND o.assigned_to <> k.agent_id
    RETURNING 1
  )
  SELECT (SELECT count(*)::int FROM conflicted), (SELECT count(*)::int FROM upd)
  INTO v_clients, v_rows;

  RAISE NOTICE 'held_orders: % cliente(s) dividido(s) entre agentes, % linha(s) remanejada(s)',
    v_clients, v_rows;
END $$;

-- ============================================================================
-- 3) Distribuição em lote — round-robin por CLIENTE, com dono preservado.
--    Retorno: { moved, by_agent, kept_with_owner, pulled_siblings }
--      moved           — linhas do lote atribuídas
--      kept_with_owner — linhas do lote que foram para o agente que já atendia o
--                        cliente, em vez do round-robin
--      pulled_siblings — linhas fora do lote movidas para manter o cliente com um
--                        único agente
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
  v_sticky   int := 0;
  v_siblings int := 0;
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

  WITH batch AS (
    SELECT o.id,
           public.held_order_client_key(o.email, o.customer_name, o.id) AS client_key,
           o.order_date
    FROM public.held_orders o
    WHERE o.id = ANY(p_order_ids)
      AND o.agent_status <> 'concluido'
      AND o.duplicate_of IS NULL
  ),
  -- Todas as linhas em aberto dos clientes envolvidos (inclui as de fora do lote:
  -- é o que garante o cliente inteiro num só agente).
  affected AS (
    SELECT o.id,
           public.held_order_client_key(o.email, o.customer_name, o.id) AS client_key,
           o.assigned_to,
           o.agent_status,
           o.imported_at,
           o.order_date,
           (o.id = ANY(p_order_ids)) AS in_batch
    FROM public.held_orders o
    WHERE o.duplicate_of IS NULL
      AND o.agent_status <> 'concluido'
      AND public.held_order_client_key(o.email, o.customer_name, o.id)
          IN (SELECT client_key FROM batch)
  ),
  -- Dono atual do cliente: agente ATIVO com linha em aberto fora do lote. Agente
  -- inativo não conta — a linha dele é remanejada junto.
  owner AS (
    SELECT DISTINCT ON (a.client_key) a.client_key, a.assigned_to AS agent_id
    FROM affected a
    JOIN public.profiles p ON p.id = a.assigned_to AND p.is_active
    WHERE a.assigned_to IS NOT NULL
      AND NOT a.in_batch
    ORDER BY a.client_key, (a.agent_status = 'em_andamento') DESC, a.imported_at, a.id
  ),
  -- Clientes sem dono ativo entram no round-robin — um agente por cliente.
  groups AS (
    SELECT b.client_key,
           (row_number() OVER (ORDER BY max(b.order_date) DESC NULLS LAST, b.client_key)) - 1 AS gn
    FROM batch b
    WHERE NOT EXISTS (SELECT 1 FROM owner o WHERE o.client_key = b.client_key)
    GROUP BY b.client_key
  ),
  plan AS (
    SELECT a.id, a.in_batch, a.assigned_to AS was, o.agent_id, true AS sticky
    FROM affected a
    JOIN owner o ON o.client_key = a.client_key
    UNION ALL
    SELECT a.id, a.in_batch, a.assigned_to, v_agents[(g.gn % v_n) + 1], false
    FROM affected a
    JOIN groups g ON g.client_key = a.client_key
  ),
  upd AS (
    UPDATE public.held_orders o
    SET assigned_to  = pl.agent_id,
        -- Só conta como nova distribuição quando o agente realmente muda.
        assign_count = o.assign_count
                       + CASE WHEN o.assigned_to IS DISTINCT FROM pl.agent_id THEN 1 ELSE 0 END
    FROM plan pl
    WHERE o.id = pl.id
    RETURNING pl.agent_id AS agent_id, pl.in_batch, pl.sticky,
              (pl.was IS DISTINCT FROM pl.agent_id) AS changed
  ),
  agg AS (
    SELECT u.agent_id,
           -- Só o que esta operação de fato fez: linha do lote ou irmã remanejada.
           -- Linha do mesmo cliente que já estava com o agente certo não entra na conta.
           count(*) FILTER (WHERE u.in_batch OR u.changed)::int        AS cnt,
           count(*) FILTER (WHERE u.in_batch)::int                    AS in_batch,
           count(*) FILTER (WHERE u.in_batch AND u.sticky)::int       AS sticky,
           count(*) FILTER (WHERE NOT u.in_batch AND u.changed)::int  AS siblings
    FROM upd u
    GROUP BY u.agent_id
  )
  SELECT
    COALESCE(sum(a.in_batch), 0)::int,
    COALESCE(sum(a.sticky), 0)::int,
    COALESCE(sum(a.siblings), 0)::int,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('agent_id', a.agent_id, 'full_name', p.full_name, 'count', a.cnt)
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
  INTO v_moved, v_sticky, v_siblings, v_by_agent
  FROM agg a
  LEFT JOIN public.profiles p ON p.id = a.agent_id;

  RETURN jsonb_build_object(
    'moved', v_moved,
    'by_agent', v_by_agent,
    'kept_with_owner', v_sticky,
    'pulled_siblings', v_siblings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_distribute_held_orders(uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_distribute_held_orders(uuid[], text[]) TO authenticated;

-- ============================================================================
-- 4) Atribuição direta a um agente — leva os outros pedidos em aberto do mesmo
--    cliente junto, senão criaria o conflito que esta migração elimina.
--    Retorna o total de linhas atribuídas (lote + linhas do mesmo cliente).
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
  v_active boolean;
  v_count  int := 0;
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

  WITH batch AS (
    SELECT public.held_order_client_key(o.email, o.customer_name, o.id) AS client_key
    FROM public.held_orders o
    WHERE o.id = ANY(p_order_ids)
      AND o.agent_status <> 'concluido'
      AND o.duplicate_of IS NULL
  ),
  upd AS (
    UPDATE public.held_orders o
    SET assigned_to  = p_agent_id,
        assign_count = o.assign_count
                       + CASE WHEN o.assigned_to IS DISTINCT FROM p_agent_id THEN 1 ELSE 0 END
    WHERE o.duplicate_of IS NULL
      AND o.agent_status <> 'concluido'
      AND public.held_order_client_key(o.email, o.customer_name, o.id)
          IN (SELECT client_key FROM batch)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_assign_held_orders(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_assign_held_orders(uuid[], text) TO authenticated;

-- ============================================================================
-- 5) Garantia no banco: nenhuma escrita deixa um cliente com dois agentes.
--    Só valida clientes cujas linhas tiveram `assigned_to` alterado na instrução,
--    para não travar mudança de status/pendência do agente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.held_orders_client_conflicts(p_keys text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(ck ORDER BY ck), '{}'::text[])
  FROM (
    SELECT public.held_order_client_key(o.email, o.customer_name, o.id) AS ck
    FROM public.held_orders o
    WHERE o.duplicate_of IS NULL
      AND o.agent_status <> 'concluido'
      AND o.assigned_to IS NOT NULL
      AND public.held_order_client_key(o.email, o.customer_name, o.id) = ANY(p_keys)
    GROUP BY 1
    HAVING count(DISTINCT o.assigned_to) > 1
  ) x;
$$;

CREATE OR REPLACE FUNCTION public.held_orders_client_single_agent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_keys text[];
  v_bad  text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT public.held_order_client_key(n.email, n.customer_name, n.id))
      INTO v_keys
    FROM newrows n
    WHERE n.assigned_to IS NOT NULL
      AND n.duplicate_of IS NULL
      AND n.agent_status <> 'concluido';
  ELSE
    SELECT array_agg(DISTINCT public.held_order_client_key(n.email, n.customer_name, n.id))
      INTO v_keys
    FROM newrows n
    JOIN oldrows o ON o.id = n.id
    WHERE n.assigned_to IS NOT NULL
      AND n.assigned_to IS DISTINCT FROM o.assigned_to
      AND n.duplicate_of IS NULL
      AND n.agent_status <> 'concluido';
  END IF;

  IF v_keys IS NULL OR array_length(v_keys, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  v_bad := public.held_orders_client_conflicts(v_keys);

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'cliente com pedidos em aberto para mais de um agente: %',
      array_to_string(v_bad, ', ')
      USING HINT = 'Atribua todos os pedidos em aberto do mesmo cliente ao mesmo agente';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_held_orders_client_single_agent_ins ON public.held_orders;
CREATE TRIGGER trg_held_orders_client_single_agent_ins
  AFTER INSERT ON public.held_orders
  REFERENCING NEW TABLE AS newrows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.held_orders_client_single_agent();

DROP TRIGGER IF EXISTS trg_held_orders_client_single_agent_upd ON public.held_orders;
CREATE TRIGGER trg_held_orders_client_single_agent_upd
  AFTER UPDATE ON public.held_orders
  REFERENCING NEW TABLE AS newrows OLD TABLE AS oldrows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.held_orders_client_single_agent();

NOTIFY pgrst, 'reload schema';
