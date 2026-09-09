-- Pedidos em Espera — "Concluídos hoje" passa a contar REGISTROS do dia.
--
-- Sintoma (09/09/2026): o agente registra "Concluído" e o card não anda.
--
-- Causa: a métrica lia o ESTADO da linha (agent_status = 'concluido' + confirmed_at
-- de hoje), e confirmed_at só é gravado ao ENTRAR em 'concluido'
-- (set_held_order_status, ver 20260729120000). Consequências:
--   * re-conclusão (pedido já concluído que o agente registra de novo hoje) mantém a
--     data antiga -> o registro de hoje não aparece no card. Em 60 dias: 15 de 608
--     conclusões (2,5%). Casos reais: Isabelle 08/09 (14 no card x 15 registros),
--     Gabrielle 03/09 (1 x 2), Ana Carolina 25/08 (26 x 28);
--   * concluir e reabrir no mesmo dia zera confirmed_at -> o card VOLTA ATRÁS.
--
-- Correção: contar em held_order_events, que é o log imutável do que o agente
-- registrou — a mesma fonte do histórico que ele vê no diálogo do pedido. Pedidos
-- distintos, então registrar duas vezes o mesmo pedido no dia continua contando 1.
-- 'duplicate_of IS NULL' fica: repetição marcada não infla a meta (ver 20260805120000).
--
-- 'pending' não muda (carteira do agente por assigned_to).
--
-- Convenções (ver 20260617000000): ids de agente são TEXT comparados com
-- auth.uid()::text; leitura só via RPC SECURITY DEFINER.

-- Índice para a contagem do dia: o card passa a ser consultado a cada 60s por agente
-- com a aba em foco, então a varredura precisa ser por (user_id, recorded_at).
-- Predicado literal em status para o índice parcial continuar sendo escolhido.
CREATE INDEX IF NOT EXISTS idx_held_order_events_user_concluido
  ON public.held_order_events (user_id, recorded_at)
  WHERE status = 'concluido';

CREATE OR REPLACE FUNCTION public.my_held_orders_daily_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid             text;
  v_day_start       timestamptz;
  v_confirmed_today int;
  v_pending         int;
  v_goal            int := 30;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Início do dia em São Paulo como timestamptz: comparar recorded_at direto
  -- preserva o índice (converter a coluna com AT TIME ZONE não preservaria).
  v_day_start := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                 AT TIME ZONE 'America/Sao_Paulo';

  SELECT count(DISTINCT e.order_id)::int INTO v_confirmed_today
  FROM public.held_order_events e
  JOIN public.held_orders o ON o.id = e.order_id
  WHERE e.user_id = v_uid
    AND e.status = 'concluido'
    AND e.recorded_at >= v_day_start
    AND e.recorded_at <  v_day_start + interval '1 day'
    AND o.duplicate_of IS NULL;

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

NOTIFY pgrst, 'reload schema';
