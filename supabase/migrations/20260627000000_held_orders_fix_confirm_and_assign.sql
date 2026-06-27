-- Pedidos em Espera — correção do fluxo de aceite (split-brain entre v1 e v2).
--
-- Contexto (auditoria 2026-06-27):
--   A migração 20260625000000 introduziu o modelo de 3 estados do agente
--   (agent_status: 'novo' | 'em_andamento' | 'concluido') via set_held_order_status,
--   com histórico em held_order_events. Porém a RPC ANTIGA confirm_held_order
--   continuou viva e ainda é chamada pelo bundle v1 cacheado nos navegadores dos
--   agentes. Ela seta apenas status='confirmed' SEM tocar em agent_status e SEM
--   gravar evento, produzindo dois defeitos observados em produção:
--
--     1. Estado inconsistente: pedidos com status='confirmed' mas agent_status='novo'
--        (76 linhas em 27/06). O manager vê "concluído", o agente vê "novo" e o
--        pedido NÃO conta na meta diária (a métrica exige agent_status='concluido').
--     2. Erro "order not found, not assigned to you, or already confirmed": o
--        UPDATE ... WHERE status='pending' casava 0 linhas (duplo clique / pedido
--        já confirmado), e o RAISE EXCEPTION aparecia para o agente como
--        "não consigo aceitar".
--
-- Esta migração:
--   1) Reescreve confirm_held_order como um ALIAS SEGURO de "concluir" — espelha
--      a lógica de set_held_order_status('concluido'): sincroniza agent_status,
--      grava evento no histórico e é IDEMPOTENTE (não falha se já concluído).
--      Assim, qualquer cliente v1 ainda em cache passa a gerar dados consistentes
--      em vez de split-brain, e o aceite para de quebrar mesmo antes do refresh.
--   2) Corrige manager_assign_held_orders para gatilhar por agent_status<>'concluido'
--      (a verdade do agente) em vez do legado status='pending'.
--   3) Backfill: reconcilia os pedidos confirmed/novo para 'concluido' e cria o
--      evento de histórico correspondente, atribuído a quem confirmou.
--
-- Convenções (ver 20260617000000 / 20260625000000): ids de agente são TEXT
-- comparados com auth.uid()::text; escrita só via RPC SECURITY DEFINER.

-- ============================================================================
-- 1) confirm_held_order — alias seguro e idempotente de "concluir"
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_held_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     text;
  v_current text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Trava a linha e garante que o pedido é do chamador.
  SELECT agent_status INTO v_current
  FROM public.held_orders
  WHERE id = p_order_id AND assigned_to = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or not assigned to you';
  END IF;

  -- Idempotente: já concluído -> nada a fazer (evita o erro de duplo clique
  -- "already confirmed" que o cliente v1 disparava).
  IF v_current = 'concluido' THEN
    RETURN;
  END IF;

  UPDATE public.held_orders
  SET agent_status = 'concluido',
      status       = 'confirmed',
      confirmed_at = now(),
      confirmed_by = v_uid
  WHERE id = p_order_id;

  INSERT INTO public.held_order_events (order_id, user_id, status, note, recorded_at)
  VALUES (p_order_id, v_uid, 'concluido', '', now());
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_held_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_held_order(uuid) TO authenticated;

-- ============================================================================
-- 2) manager_assign_held_orders — gatilho por agent_status, não pelo legado status
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

  -- Move apenas pedidos ainda não concluídos (novo/em_andamento). Usa a verdade
  -- do agente (agent_status), não o status legado: assim pedidos corrigidos pelo
  -- backfill e pedidos em andamento são tratados corretamente.
  UPDATE public.held_orders
  SET assigned_to = p_agent_id
  WHERE id = ANY(p_order_ids)
    AND agent_status <> 'concluido';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_assign_held_orders(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_assign_held_orders(uuid[], text) TO authenticated;

-- ============================================================================
-- 3) Backfill: reconciliar confirmed/novo -> concluido + criar evento
-- ============================================================================
-- Pedidos confirmados pelo fluxo antigo (status='confirmed') que ficaram com
-- agent_status='novo'. Foram efetivamente concluídos pelo agente; alinhamos o
-- agent_status para que contem na meta e apareçam corretamente nas duas visões.
WITH fixed AS (
  UPDATE public.held_orders
  SET agent_status = 'concluido'
  WHERE status = 'confirmed'
    AND agent_status <> 'concluido'
  RETURNING id, confirmed_by, confirmed_at
)
INSERT INTO public.held_order_events (order_id, user_id, status, note, recorded_at)
SELECT
  f.id,
  COALESCE(f.confirmed_by, o.assigned_to),
  'concluido',
  'Conclusão reconciliada (fluxo antigo)',
  COALESCE(f.confirmed_at, now())
FROM fixed f
JOIN public.held_orders o ON o.id = f.id
-- Só insere se houver um user_id válido (NOT NULL na tabela de eventos).
WHERE COALESCE(f.confirmed_by, o.assigned_to) IS NOT NULL;

NOTIFY pgrst, 'reload schema';
