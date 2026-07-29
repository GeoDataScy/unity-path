-- Pedidos em Espera — tag de pendência.
--
-- Problema: o agente marca um pedido como "Em Andamento" e ele some no meio da
-- lista. Não dá para saber POR QUE ele ainda não foi concluído (esperando o
-- cliente? a transportadora? não achou o pedido?), então casos ficam esquecidos.
--
-- Solução: uma tag opcional por pedido (`pending_tag`), escolhida pelo agente no
-- mesmo diálogo em que ele muda o status, e filtrável na lista.
--
-- Valores (fechados, ver held_orders_pending_tag_chk):
--   pedido_nao_encontrado   — agente não encontrou o pedido do cliente
--   aguardando_cliente      — cliente ainda não respondeu à confirmação de endereço
--   aguardando_transportadora — aguardando retorno da transportadora
--   outra                   — outra pendência operacional (detalhar na observação)
--   NULL                    — sem pendência
--
-- Regra: concluir um pedido limpa a pendência (não há o que acompanhar depois).
--
-- Convenções (ver 20260617000000_create_held_orders.sql):
--   * ids de agente são TEXT, comparados com auth.uid()::text.
--   * Escritas só via RPC SECURITY DEFINER.

-- ============================================================================
-- 1) Coluna pending_tag em held_orders + em held_order_events (histórico)
-- ============================================================================
ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS pending_tag text;

DO $$ BEGIN
  ALTER TABLE public.held_orders
    ADD CONSTRAINT held_orders_pending_tag_chk
    CHECK (pending_tag IS NULL OR pending_tag IN (
      'pedido_nao_encontrado',
      'aguardando_cliente',
      'aguardando_transportadora',
      'outra'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Só interessa filtrar pedidos QUE TÊM pendência — índice parcial.
CREATE INDEX IF NOT EXISTS idx_held_orders_pending_tag
  ON public.held_orders (assigned_to, pending_tag)
  WHERE pending_tag IS NOT NULL;

ALTER TABLE public.held_order_events
  ADD COLUMN IF NOT EXISTS pending_tag text;

DO $$ BEGIN
  ALTER TABLE public.held_order_events
    ADD CONSTRAINT held_order_events_pending_tag_chk
    CHECK (pending_tag IS NULL OR pending_tag IN (
      'pedido_nao_encontrado',
      'aguardando_cliente',
      'aguardando_transportadora',
      'outra'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2) set_held_order_status ganha p_pending_tag
--    A versão de 3 argumentos é REMOVIDA para não criar ambiguidade de overload
--    no PostgREST — o cliente sempre envia os 4 argumentos.
--    Semântica: o valor enviado SEMPRE sobrescreve a tag ('' / NULL = sem
--    pendência). Concluir o pedido zera a tag.
-- ============================================================================
DROP FUNCTION IF EXISTS public.set_held_order_status(uuid, text, text);

CREATE OR REPLACE FUNCTION public.set_held_order_status(
  p_order_id    uuid,
  p_status      text,
  p_note        text DEFAULT '',
  p_pending_tag text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     text;
  v_current text;
  v_tag     text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_status NOT IN ('novo', 'em_andamento', 'concluido') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  v_tag := NULLIF(trim(COALESCE(p_pending_tag, '')), '');
  IF v_tag IS NOT NULL AND v_tag NOT IN (
    'pedido_nao_encontrado', 'aguardando_cliente', 'aguardando_transportadora', 'outra'
  ) THEN
    RAISE EXCEPTION 'invalid pending tag: %', v_tag;
  END IF;

  -- Pedido concluído não tem o que acompanhar.
  IF p_status = 'concluido' THEN
    v_tag := NULL;
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
    pending_tag  = v_tag,
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

  INSERT INTO public.held_order_events (order_id, user_id, status, note, pending_tag, recorded_at)
  VALUES (p_order_id, v_uid, p_status, COALESCE(NULLIF(trim(p_note), ''), ''), v_tag, now());
END;
$$;

REVOKE ALL ON FUNCTION public.set_held_order_status(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_held_order_status(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 3) held_order_events_for — devolve a tag registrada em cada evento
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
      e.pending_tag,
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
-- 4) my_held_orders — devolve pending_tag e ordena pendências primeiro dentro
--    de cada status (o que precisa de acompanhamento sobe na lista).
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
-- 5) manager_list_held_orders — expõe pending_tag para a aba do manager
--    (mesma assinatura e mesmos filtros; só acrescenta a coluna).
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
      o.pending_tag,
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

  -- (summary inalterado em relação a 20260629000000 — só as linhas ganharam pending_tag)
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
