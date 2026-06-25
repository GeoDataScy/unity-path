-- Pedidos em Espera — gestão pelo AGENTE: status de 3 estados + histórico (timeline).
--
-- Até aqui o agente só CONFIRMAVA um pedido (status 'pending' -> 'confirmed').
-- Passamos a permitir que ele gerencie cada pedido com 3 estados próprios e registre
-- o que foi feito, com data/hora — muito parecido com os tickets de atendimento
-- (ver service_follow_ups / StatusTrackingDialog).
--
-- Decisões (confirmadas com o usuário):
--   * O agente usa um status próprio: 'novo' | 'em_andamento' | 'concluido'.
--   * "Concluído" conta para a meta diária (sucessor do antigo 'confirmed').
--   * A visão do MANAGER permanece como está: continua lendo held_orders.status
--     ('pending'/'confirmed'). Por isso NÃO mexemos no significado de `status`; em vez
--     disso adicionamos `agent_status` e mantemos `status` sincronizado por baixo:
--       agent_status 'concluido' -> status 'confirmed' (+ confirmed_at/by)
--       agent_status 'novo'|'em_andamento' -> status 'pending'
--
-- Convenções (ver 20260617000000_create_held_orders.sql):
--   * ids de agente são TEXT, comparados com auth.uid()::text.
--   * Escritas só via RPC SECURITY DEFINER; nenhuma policy de INSERT/UPDATE direta.

-- ============================================================================
-- 1) Coluna agent_status + backfill a partir do status atual
-- ============================================================================
ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS agent_status text NOT NULL DEFAULT 'novo';

DO $$ BEGIN
  ALTER TABLE public.held_orders
    ADD CONSTRAINT held_orders_agent_status_chk
    CHECK (agent_status IN ('novo', 'em_andamento', 'concluido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pedidos já confirmados viram 'concluido'; os demais ficam 'novo'.
UPDATE public.held_orders
SET agent_status = CASE WHEN status = 'confirmed' THEN 'concluido' ELSE 'novo' END
WHERE agent_status IS NULL OR agent_status = 'novo';

CREATE INDEX IF NOT EXISTS idx_held_orders_agent_status
  ON public.held_orders (assigned_to, agent_status);

-- ============================================================================
-- 2) Tabela held_order_events — histórico append-only (timeline)
--    Cada linha = uma interação do agente (status escolhido + anotação).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.held_order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.held_orders(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      text NOT NULL,                 -- agent_status definido neste evento
  note        text DEFAULT '',               -- o que foi feito
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT held_order_events_status_chk
    CHECK (status IN ('novo', 'em_andamento', 'concluido'))
);

CREATE INDEX IF NOT EXISTS idx_held_order_events_order
  ON public.held_order_events (order_id, recorded_at);

ALTER TABLE public.held_order_events ENABLE ROW LEVEL SECURITY;

-- Manager vê tudo; agente vê os eventos dos pedidos atribuídos a ele.
-- (Escrita é exclusivamente via RPC SECURITY DEFINER — sem policy de write.)
DROP POLICY IF EXISTS held_order_events_select ON public.held_order_events;
CREATE POLICY held_order_events_select ON public.held_order_events
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.is_manager()
      OR EXISTS (
        SELECT 1 FROM public.held_orders o
        WHERE o.id = held_order_events.order_id
          AND o.assigned_to = auth.uid()::text
      )
    )
  );

GRANT SELECT ON public.held_order_events TO authenticated;

-- ============================================================================
-- 3) set_held_order_status(p_order_id, p_status, p_note)
--    Muda o agent_status do pedido (deve estar atribuído ao chamador), registra
--    um evento no histórico e mantém status/confirmed_at sincronizados.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_held_order_status(
  p_order_id uuid,
  p_status   text,
  p_note     text DEFAULT ''
)
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

  IF p_status NOT IN ('novo', 'em_andamento', 'concluido') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  -- Trava a linha e garante que o pedido é do chamador.
  SELECT agent_status INTO v_current
  FROM public.held_orders
  WHERE id = p_order_id AND assigned_to = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or not assigned to you';
  END IF;

  UPDATE public.held_orders
  SET
    agent_status = p_status,
    -- Espelha no status legado lido pelo manager. confirmed_at só é (re)gravado
    -- ao ENTRAR em 'concluido', para a meta diária contar a data certa; ao sair
    -- de 'concluido' (reabertura) limpamos a confirmação.
    status = CASE WHEN p_status = 'concluido' THEN 'confirmed' ELSE 'pending' END,
    confirmed_at = CASE
      WHEN p_status = 'concluido' AND v_current <> 'concluido' THEN now()
      WHEN p_status = 'concluido' THEN confirmed_at
      ELSE NULL
    END,
    confirmed_by = CASE
      WHEN p_status = 'concluido' THEN v_uid
      ELSE NULL
    END
  WHERE id = p_order_id;

  INSERT INTO public.held_order_events (order_id, user_id, status, note, recorded_at)
  VALUES (p_order_id, v_uid, p_status, COALESCE(NULLIF(trim(p_note), ''), ''), now());
END;
$$;

REVOKE ALL ON FUNCTION public.set_held_order_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_held_order_status(uuid, text, text) TO authenticated;

-- ============================================================================
-- 4) held_order_events_for(p_order_id) -> jsonb array (timeline de um pedido)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.held_order_events_for(p_order_id uuid)
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

  -- Só o dono do pedido (ou manager) enxerga o histórico.
  IF NOT public.is_manager()
     AND NOT EXISTS (
       SELECT 1 FROM public.held_orders o
       WHERE o.id = p_order_id AND o.assigned_to = v_uid
     ) THEN
    RAISE EXCEPTION 'order not found or not assigned to you';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.recorded_at ASC, t.id), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      e.id::text  AS id,
      e.status,
      e.note,
      e.recorded_at,
      p.full_name AS user_name
    FROM public.held_order_events e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    WHERE e.order_id = p_order_id
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.held_order_events_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.held_order_events_for(uuid) TO authenticated;

-- ============================================================================
-- 5) my_held_orders(p_status) — agora filtra por agent_status e devolve
--    agent_status + event_count. p_status passa a aceitar os 3 estados + 'all'.
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
      o.confirmed_at,
      (SELECT count(*)::int FROM public.held_order_events e WHERE e.order_id = o.id) AS event_count
    FROM public.held_orders o
    WHERE o.assigned_to = v_uid
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
-- 6) my_held_orders_daily_metrics() — "pendentes" passa a ser != concluido.
--    confirmed_today continua medindo conclusões de hoje (confirmed_at).
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
    AND (o.confirmed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT count(*)::int INTO v_pending
  FROM public.held_orders o
  WHERE o.assigned_to = v_uid
    AND o.agent_status <> 'concluido';

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
