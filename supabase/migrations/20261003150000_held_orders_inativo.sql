-- Pedidos em Espera: status "Inativo".
--
-- Cliente que não responde: o agente marca Inativo quando quiser (observação
-- obrigatória). O pedido sai da fila de trabalho e vai para a lista de Inativos
-- do agente e da gestora; o agente pode reabrir se o cliente responder.
--
-- Regras:
-- * Conta na meta de Pedidos em Espera do dia como o Concluído (um pedido conta
--   uma vez por dia, mesmo marcado/reaberto/remarcado).
-- * Para import e para "um cliente, um agente", Inativo continua EM ABERTO
--   (agent_status <> 'concluido'): o relatório diário repete os pedidos ainda
--   retidos, e se Inativo encerrasse, o mesmo pedido voltaria como novo no dia
--   seguinte. Por isso nenhuma regra de identidade/rateio muda aqui.
-- * Marcação antecipada: menos de 14 dias desde o último contato (último registro
--   no pedido; sem registro, a entrada no sistema) gera um alerta para a gestora,
--   que confirma ("correto") ou devolve o pedido ao agente ("devolvido").

ALTER TABLE public.held_orders DROP CONSTRAINT held_orders_agent_status_chk;
ALTER TABLE public.held_orders ADD CONSTRAINT held_orders_agent_status_chk
  CHECK (agent_status IN ('novo', 'em_andamento', 'concluido', 'inativo'));

ALTER TABLE public.held_order_events DROP CONSTRAINT held_order_events_status_chk;
ALTER TABLE public.held_order_events ADD CONSTRAINT held_order_events_status_chk
  CHECK (status IN ('novo', 'em_andamento', 'concluido', 'inativo'));

-- Alertas de marcação antecipada. Escrita e leitura só pelas RPCs abaixo.
CREATE TABLE IF NOT EXISTS public.held_order_inactive_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES public.held_orders(id) ON DELETE CASCADE,
  event_id           uuid NOT NULL REFERENCES public.held_order_events(id) ON DELETE CASCADE,
  agent_id           text REFERENCES public.profiles(id) ON DELETE SET NULL,
  marked_at          timestamptz NOT NULL DEFAULT now(),
  last_contact_at    timestamptz NOT NULL,
  days_since_contact int NOT NULL,
  decision           text CHECK (decision IS NULL OR decision IN ('correto', 'devolvido')),
  reviewed_by        text REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  review_note        text
);

COMMENT ON TABLE public.held_order_inactive_alerts IS
  'Pedido marcado Inativo com menos de 14 dias desde o último contato. decision NULL = aguardando revisão da gestora.';

CREATE INDEX IF NOT EXISTS idx_held_order_inactive_alerts_open
  ON public.held_order_inactive_alerts (marked_at)
  WHERE decision IS NULL;

ALTER TABLE public.held_order_inactive_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.held_order_inactive_alerts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_held_order_status(p_order_id uuid, p_status text, p_note text DEFAULT ''::text, p_pending_tag text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          text;
  v_current      text;
  v_tag          text;
  v_note         text;
  v_last_contact timestamptz;
  v_event_id     uuid;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_status NOT IN ('novo', 'em_andamento', 'concluido', 'inativo') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  v_note := COALESCE(NULLIF(trim(p_note), ''), '');
  IF p_status = 'inativo' AND v_note = '' THEN
    RAISE EXCEPTION 'Informe na observação por que o pedido ficou inativo (ex.: tentativas de contato sem resposta).';
  END IF;

  v_tag := NULLIF(trim(COALESCE(p_pending_tag, '')), '');
  IF v_tag IS NOT NULL AND v_tag NOT IN (
    'pedido_nao_encontrado', 'aguardando_cliente', 'aguardando_transportadora', 'outra'
  ) THEN
    RAISE EXCEPTION 'invalid pending tag: %', v_tag;
  END IF;

  -- Concluir e inativar tiram o pedido da fila: a pendência deixa de fazer sentido.
  IF p_status IN ('concluido', 'inativo') THEN
    v_tag := NULL;
  END IF;

  SELECT agent_status INTO v_current
  FROM public.held_orders
  WHERE id = p_order_id AND assigned_to = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or not assigned to you';
  END IF;

  -- Último contato ANTES deste registro: base da regra dos 14 dias.
  IF p_status = 'inativo' AND v_current <> 'inativo' THEN
    SELECT COALESCE(
             (SELECT max(e.recorded_at) FROM public.held_order_events e WHERE e.order_id = p_order_id),
             o.imported_at)
      INTO v_last_contact
    FROM public.held_orders o
    WHERE o.id = p_order_id;
  END IF;

  UPDATE public.held_orders
  SET
    agent_status = p_status,
    pending_tag  = v_tag,
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
  VALUES (p_order_id, v_uid, p_status, v_note, v_tag, now())
  RETURNING id INTO v_event_id;

  IF v_last_contact IS NOT NULL AND now() - v_last_contact < interval '14 days' THEN
    INSERT INTO public.held_order_inactive_alerts
      (order_id, event_id, agent_id, marked_at, last_contact_at, days_since_contact)
    VALUES
      (p_order_id, v_event_id, v_uid, now(), v_last_contact,
       floor(extract(epoch FROM now() - v_last_contact) / 86400)::int);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_held_orders_daily_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             text;
  v_day_start       timestamptz;
  v_confirmed_today int;
  v_pending         int;
  v_inactive        int;
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

  -- Meta de Pedidos em Espera: concluído OU inativo, cada pedido uma vez por dia.
  SELECT count(DISTINCT e.order_id)::int INTO v_confirmed_today
  FROM public.held_order_events e
  JOIN public.held_orders o ON o.id = e.order_id
  WHERE e.user_id = v_uid
    AND e.status IN ('concluido', 'inativo')
    AND e.recorded_at >= v_day_start
    AND e.recorded_at <  v_day_start + interval '1 day'
    AND o.duplicate_of IS NULL;

  SELECT
    count(*) FILTER (WHERE o.agent_status NOT IN ('concluido', 'inativo'))::int,
    count(*) FILTER (WHERE o.agent_status = 'inativo')::int
    INTO v_pending, v_inactive
  FROM public.held_orders o
  WHERE o.assigned_to = v_uid
    AND o.duplicate_of IS NULL;

  RETURN jsonb_build_object(
    'confirmed_today', v_confirmed_today,
    'pending', v_pending,
    'inactive', v_inactive,
    'goal', v_goal
  );
END;
$function$;

-- O índice parcial da meta só cobria 'concluido'; com o Inativo contando junto,
-- passa a cobrir os dois.
DROP INDEX IF EXISTS public.idx_held_order_events_user_concluido;
CREATE INDEX IF NOT EXISTS idx_held_order_events_user_meta
  ON public.held_order_events (user_id, recorded_at)
  WHERE status IN ('concluido', 'inativo');

CREATE OR REPLACE FUNCTION public.my_held_orders(p_status text DEFAULT 'all'::text)
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
      (SELECT count(*)::int FROM public.held_order_events e WHERE e.order_id = o.id) AS event_count
    FROM public.held_orders o
    WHERE o.assigned_to = v_uid
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

CREATE OR REPLACE FUNCTION public.manager_list_held_orders(from_date date DEFAULT NULL::date, to_date date DEFAULT NULL::date, agent_id text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows       jsonb;
  v_total      bigint;
  v_duplicates bigint;
  v_summary    jsonb;
BEGIN
  -- Gestora (Data Analytics) e time de produtos (/produtos) leem a MESMA lista.
  -- Quem escreve (importar planilha, distribuir) continua só a gestora: essas
  -- RPCs são outras e seguem com guarda is_manager().
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE o.duplicate_of IS NOT NULL)
  INTO v_total, v_duplicates
  FROM public.held_orders o
  WHERE (from_date IS NULL OR COALESCE(o.order_date, o.return_date) >= from_date)
    AND (to_date   IS NULL OR COALESCE(o.order_date, o.return_date) <= to_date)
    AND (agent_id  IS NULL OR o.assigned_to = agent_id)
    AND (
      status_filter IS NULL
      OR status_filter = 'all'
      -- legado: 'pending' engloba aguardando + em andamento.
      OR (status_filter = 'pending'      AND o.status = 'pending')
      OR (status_filter = 'confirmed'    AND o.status = 'confirmed')
      OR (status_filter = 'aguardando'   AND o.status = 'pending' AND o.agent_status NOT IN ('em_andamento', 'inativo'))
      OR (status_filter = 'em_andamento' AND o.agent_status = 'em_andamento')
      OR (status_filter = 'inativo'      AND o.agent_status = 'inativo')
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY COALESCE(t.order_date, t.return_date) DESC NULLS LAST, t.id), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      o.id::text          AS id,
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
      o.source_file,
      o.status,
      o.agent_status,
      o.pending_tag,
      o.assign_count,
      o.assigned_to,
      pa.full_name        AS assigned_to_name,
      o.confirmed_at,
      o.imported_at,
      (SELECT max(e.recorded_at) FROM public.held_order_events e WHERE e.order_id = o.id) AS status_changed_at,
      o.duplicate_of::text AS duplicate_of
    FROM public.held_orders o
    LEFT JOIN public.profiles pa ON pa.id = o.assigned_to
    WHERE (from_date IS NULL OR COALESCE(o.order_date, o.return_date) >= from_date)
      AND (to_date   IS NULL OR COALESCE(o.order_date, o.return_date) <= to_date)
      AND (agent_id  IS NULL OR o.assigned_to = agent_id)
      AND (
        status_filter IS NULL
        OR status_filter = 'all'
        OR (status_filter = 'pending'      AND o.status = 'pending')
        OR (status_filter = 'confirmed'    AND o.status = 'confirmed')
        OR (status_filter = 'aguardando'   AND o.status = 'pending' AND o.agent_status NOT IN ('em_andamento', 'inativo'))
        OR (status_filter = 'em_andamento' AND o.agent_status = 'em_andamento')
        OR (status_filter = 'inativo'      AND o.agent_status = 'inativo')
      )
  ) t;

  -- Resumo por agente (sempre global, sem as linhas repetidas: aquele número é
  -- carga de trabalho real). pending continua sendo "tudo que não está concluído";
  -- in_progress é o subconjunto já em atendimento, para a ADM ver quem começou.
  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.full_name), '[]'::jsonb)
    INTO v_summary
  FROM (
    SELECT
      o.assigned_to                                                   AS agent_id,
      p.full_name,
      count(*) FILTER (WHERE o.status = 'pending' AND o.agent_status <> 'inativo')::int AS pending,
      count(*) FILTER (WHERE o.agent_status = 'em_andamento')::int    AS in_progress,
      count(*) FILTER (WHERE o.status = 'confirmed')::int             AS confirmed,
      count(*) FILTER (WHERE o.agent_status = 'inativo')::int         AS inactive
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
$function$;

CREATE OR REPLACE FUNCTION public.manager_inactive_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.marked_at DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      a.id::text           AS alert_id,
      a.order_id::text     AS order_id,
      o.order_number,
      o.dyna_code,
      o.customer_name,
      o.email,
      o.agent_status,
      a.agent_id,
      p.full_name          AS agent_name,
      a.marked_at,
      a.last_contact_at,
      a.days_since_contact,
      e.note
    FROM public.held_order_inactive_alerts a
    JOIN public.held_orders o       ON o.id = a.order_id
    JOIN public.held_order_events e ON e.id = a.event_id
    LEFT JOIN public.profiles p     ON p.id = a.agent_id
    WHERE a.decision IS NULL
  ) t;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.manager_review_inactive_alert(p_alert_id uuid, p_decision text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text;
  v_order uuid;
  v_note  text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_uid := auth.uid()::text;

  IF p_decision NOT IN ('correto', 'devolvido') THEN
    RAISE EXCEPTION 'invalid decision: %', p_decision;
  END IF;
  v_note := COALESCE(NULLIF(trim(p_note), ''), '');

  UPDATE public.held_order_inactive_alerts
  SET decision = p_decision, reviewed_by = v_uid, reviewed_at = now(), review_note = NULLIF(v_note, '')
  WHERE id = p_alert_id AND decision IS NULL
  RETURNING order_id INTO v_order;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Este alerta já foi revisado ou não existe.';
  END IF;

  -- Devolver: o pedido volta para a fila do agente (se ainda estiver inativo —
  -- o agente pode já ter reaberto). Fica registrado no histórico em nome da gestora.
  IF p_decision = 'devolvido' THEN
    UPDATE public.held_orders
    SET agent_status = 'em_andamento', status = 'pending', pending_tag = NULL
    WHERE id = v_order AND agent_status = 'inativo';

    IF FOUND THEN
      INSERT INTO public.held_order_events (order_id, user_id, status, note, pending_tag, recorded_at)
      VALUES (v_order, v_uid, 'em_andamento',
              'Devolvido pela gestão: inativo marcado antes de 14 dias sem contato.'
                || CASE WHEN v_note <> '' THEN ' ' || v_note ELSE '' END,
              NULL, now());
    END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_inactive_alerts() FROM anon;
REVOKE ALL ON FUNCTION public.manager_review_inactive_alert(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.manager_inactive_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_review_inactive_alert(uuid, text, text) TO authenticated;
