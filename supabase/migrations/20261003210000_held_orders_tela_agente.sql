-- Pedidos em Espera: tela nova do agente.
--
-- my_held_orders devolvia todo o histórico do agente (~400-490 KB; num caso 97%
-- concluídos). Com p_concluded_days, os concluídos mais antigos que a janela
-- ficam fora — a aba Concluídos mostra os últimos 30 dias e a lista pode se
-- atualizar sozinha sem pesar. Sem o parâmetro, o comportamento é o de antes
-- (bundle antigo continua funcionando).
--
-- Também devolve quem fez o último registro (last_event_user_id e se era da
-- gestão), para o card avisar "Devolvido pela gestão" / "Veio de outro agente".
--
-- A assinatura muda (novo parâmetro), então a função antiga é removida: duas
-- versões com p_status deixariam a chamada por nome ambígua no PostgREST.

DROP FUNCTION IF EXISTS public.my_held_orders(text);

CREATE FUNCTION public.my_held_orders(p_status text DEFAULT 'all'::text, p_concluded_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             CASE t.agent_status WHEN 'novo' THEN 0 WHEN 'em_andamento' THEN 1 WHEN 'concluido' THEN 2 ELSE 3 END,
             CASE WHEN t.pending_tag IS NOT NULL THEN 0 ELSE 1 END,
             COALESCE(t.order_date, t.return_date) ASC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      o.id::text   AS id,
      o.dyna_code,
      o.order_number,
      o.merged_orders,
      o.reason,
      o.order_date,
      o.return_date,
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
      o.imported_at,
      (SELECT max(e.recorded_at) FROM public.held_order_events e WHERE e.order_id = o.id) AS status_changed_at,
      (SELECT e.note FROM public.held_order_events e WHERE e.order_id = o.id
        ORDER BY e.recorded_at DESC, e.id DESC LIMIT 1) AS last_note,
      (SELECT count(*)::int FROM public.held_order_events e WHERE e.order_id = o.id) AS event_count,
      -- Quem fez o último registro: se não foi o próprio agente, o pedido voltou
      -- para ele pela gestão (devolução) ou veio de outro agente (reatribuição).
      le.user_id AS last_event_user_id,
      COALESCE(lp.role::text = 'manager', false) AS last_event_by_manager
    FROM public.held_orders o
    LEFT JOIN LATERAL (
      SELECT e.user_id FROM public.held_order_events e
      WHERE e.order_id = o.id
      ORDER BY e.recorded_at DESC, e.id DESC
      LIMIT 1
    ) le ON true
    LEFT JOIN public.profiles lp ON lp.id = le.user_id
    WHERE o.assigned_to = v_uid
      -- Concluídos antigos ficam fora quando a tela pede uma janela (a aba
      -- Concluídos do agente mostra os últimos 30 dias); o resto vem sempre.
      AND (p_concluded_days IS NULL
           OR o.agent_status <> 'concluido'
           OR COALESCE(o.confirmed_at, o.imported_at) >= now() - make_interval(days => p_concluded_days))
      AND o.duplicate_of IS NULL
      AND (
        p_status = 'all' OR p_status IS NULL OR o.agent_status = p_status
        -- compatibilidade: chamadas antigas pediam 'pending'/'confirmed'
        OR (p_status = 'pending'   AND o.agent_status NOT IN ('concluido', 'inativo'))
        OR (p_status = 'confirmed' AND o.agent_status =  'concluido')
      )
  ) t;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.my_held_orders(text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.my_held_orders(text, integer) FROM anon;
