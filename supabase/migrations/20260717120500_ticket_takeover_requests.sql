-- Pedidos de tomada de ticket com aprovação da gestora.
--
-- Fluxo: um cliente volta a escrever, o agente A pega o atendimento, mas o
-- ticket em aberto pertence ao agente B que está DE FOLGA (profiles.is_available
-- = false). Em vez de encaminhar para o B (que não responde), o A cria um
-- PEDIDO. Só a gestora responsável (can_approve_takeovers) vê o pedido no seu
-- sino e aprova/rejeita. Ao aprovar, o ticket passa a ser do A (muda o
-- current_owner) e fica MARCADO como autorizado, visível na aba Usuários.
--
-- Tabela dedicada (separada de ticket_transfers) de propósito: a semântica é
-- diferente (o destinatário é a gestora, não um colega) e misturar quebraria o
-- sino dos agentes. Reaproveitamos, porém, o padrão: RPCs SECURITY DEFINER para
-- leitura/escrita cruzando RLS, e uma linha 'accepted' em ticket_transfers para
-- manter o histórico consistente quando o ticket muda de dono.

-- ============================================================================
-- 1) Marcador de "autorizado" no próprio ticket
-- ============================================================================
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS takeover_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS takeover_approved_by text;

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_takeover_approved_by_fkey;
ALTER TABLE public.services
  ADD CONSTRAINT services_takeover_approved_by_fkey
  FOREIGN KEY (takeover_approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.services.takeover_approved_at IS
  'Carimbo de quando a gestora autorizou a tomada deste ticket (agente de folga). NULL = fluxo normal.';

-- ============================================================================
-- 2) Tabela ticket_takeover_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ticket_takeover_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    text NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  requester_id  text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_id      text REFERENCES public.profiles(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  responded_by  text REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ticket_takeover_distinct_parties CHECK (requester_id <> owner_id)
);

CREATE INDEX IF NOT EXISTS idx_takeover_requests_status
  ON public.ticket_takeover_requests (status);
CREATE INDEX IF NOT EXISTS idx_takeover_requests_requester
  ON public.ticket_takeover_requests (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_takeover_requests_service
  ON public.ticket_takeover_requests (service_id);

-- Um único pedido pendente por (ticket, agente) — evita duplicar solicitações.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_takeover
  ON public.ticket_takeover_requests (service_id, requester_id)
  WHERE status = 'pending';

ALTER TABLE public.ticket_takeover_requests ENABLE ROW LEVEL SECURITY;

-- O agente vê os próprios pedidos; a gestora (is_manager) vê todos.
DROP POLICY IF EXISTS takeover_select ON public.ticket_takeover_requests;
CREATE POLICY takeover_select ON public.ticket_takeover_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid()::text OR public.is_manager());

GRANT SELECT ON public.ticket_takeover_requests TO authenticated;
-- INSERT/UPDATE só via RPCs SECURITY DEFINER abaixo (sem policy de escrita).

-- ============================================================================
-- 3) request_ticket_takeover — agente solicita a tomada
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_ticket_takeover(
  p_service_id text,
  p_note       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid          text;
  v_current      text;
  v_creator      text;
  v_status       text;
  v_owner        text;
  v_available    boolean;
  v_request_id   uuid;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT s.current_owner_id, s.user_id, s.status
    INTO v_current, v_creator, v_status
  FROM public.services s
  WHERE s.id = p_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket não encontrado';
  END IF;
  IF v_status = 'concluido' THEN
    RAISE EXCEPTION 'Ticket já concluído — não é possível solicitar.';
  END IF;

  -- Dono operacional efetivo: current_owner, ou o criador se não houver.
  v_owner := COALESCE(v_current, v_creator);

  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'Você já é o responsável por este ticket.';
  END IF;

  SELECT is_available INTO v_available FROM public.profiles WHERE id = v_owner;
  -- Só faz sentido pedir aprovação quando o dono está DE FOLGA. Se está
  -- disponível, o caminho é o encaminhamento normal (regra reforçada aqui
  -- para o RPC não ser usado indevidamente).
  IF COALESCE(v_available, true) THEN
    RAISE EXCEPTION 'O responsável está disponível — use o encaminhamento normal.';
  END IF;

  BEGIN
    INSERT INTO public.ticket_takeover_requests (service_id, requester_id, owner_id, note)
    VALUES (p_service_id, v_uid, v_owner, NULLIF(TRIM(p_note), ''))
    RETURNING id INTO v_request_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Você já tem um pedido pendente para esse ticket.';
  END;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_ticket_takeover(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_ticket_takeover(text, text) TO authenticated;

-- ============================================================================
-- 4) manager_takeover_notifications — sino da gestora (só quem aprova)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_takeover_notifications()
RETURNS TABLE(
  request_id      uuid,
  service_id      text,
  client_email    text,
  product         text,
  service_status  text,
  requester_id    text,
  requester_name  text,
  owner_id        text,
  owner_name      text,
  note            text,
  created_at      timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id,
    r.service_id,
    s.client_email,
    s.product,
    s.status,
    r.requester_id,
    pr.full_name,
    r.owner_id,
    po.full_name,
    r.note,
    r.created_at
  FROM public.ticket_takeover_requests r
  JOIN public.services s   ON s.id = r.service_id
  LEFT JOIN public.profiles pr ON pr.id = r.requester_id
  LEFT JOIN public.profiles po ON po.id = r.owner_id
  WHERE r.status = 'pending'
    -- Só o(s) aprovador(es) designado(s) enxergam a fila.
    AND EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()::text
        AND me.role = 'manager'
        AND me.can_approve_takeovers = true
    )
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.manager_takeover_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_takeover_notifications() TO authenticated;

-- ============================================================================
-- 5) approve_ticket_takeover — aprova e move o ticket para quem pediu
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_ticket_takeover(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manager    text;
  v_service    text;
  v_requester  text;
  v_owner      text;
  v_req_status text;
  v_current    text;
  v_svc_status text;
BEGIN
  v_manager := auth.uid()::text;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_manager AND role = 'manager' AND can_approve_takeovers = true
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT service_id, requester_id, owner_id, status
    INTO v_service, v_requester, v_owner, v_req_status
  FROM public.ticket_takeover_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;
  IF v_req_status <> 'pending' THEN
    RAISE EXCEPTION 'Pedido já foi respondido';
  END IF;

  SELECT current_owner_id, status INTO v_current, v_svc_status
  FROM public.services WHERE id = v_service FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket não encontrado';
  END IF;
  IF v_svc_status = 'concluido' THEN
    RAISE EXCEPTION 'Ticket já concluído';
  END IF;

  -- Move a titularidade para quem pediu e marca como autorizado.
  -- O trigger de freeze permite a troca de current_owner_id porque quem chama
  -- é gestor (is_manager). takeover_approved_* não são campos congelados.
  UPDATE public.services
    SET current_owner_id     = v_requester,
        takeover_approved_at = now(),
        takeover_approved_by = v_manager
    WHERE id = v_service;

  UPDATE public.ticket_takeover_requests
    SET status = 'approved', responded_at = now(), responded_by = v_manager
    WHERE id = p_request_id;

  -- Histórico: registra como transferência aceita (dono anterior -> requester),
  -- assinada pela gestora. seen_at preenchidos para não gerar ruído nos sinos.
  INSERT INTO public.ticket_transfers (
    service_id, from_user_id, to_user_id, status, message,
    responded_at, recipient_seen_at, requester_seen_at, assigned_by_manager_id
  ) VALUES (
    v_service, COALESCE(v_owner, v_current, v_requester), v_requester, 'accepted',
    'Tomada autorizada pela gestora', now(), now(), now(), v_manager
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_ticket_takeover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_ticket_takeover(uuid) TO authenticated;

-- ============================================================================
-- 6) reject_ticket_takeover — recusa o pedido
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reject_ticket_takeover(
  p_request_id uuid,
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manager    text;
  v_req_status text;
BEGIN
  v_manager := auth.uid()::text;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_manager AND role = 'manager' AND can_approve_takeovers = true
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT status INTO v_req_status
  FROM public.ticket_takeover_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;
  IF v_req_status <> 'pending' THEN
    RAISE EXCEPTION 'Pedido já foi respondido';
  END IF;

  UPDATE public.ticket_takeover_requests
    SET status = 'rejected', responded_at = now(), responded_by = v_manager,
        note = COALESCE(NULLIF(TRIM(p_note), ''), note)
    WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_ticket_takeover(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_ticket_takeover(uuid, text) TO authenticated;

-- ============================================================================
-- 7) manager_list_users — adiciona is_available e authorized_open_count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_list_users()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH open_counts AS (
    SELECT
      s.current_owner_id AS user_id,
      COUNT(*)::int      AS total,
      -- Quantos dos tickets em aberto foram autorizados pela gestora.
      COUNT(*) FILTER (WHERE s.takeover_approved_at IS NOT NULL)::int AS authorized
    FROM public.services s
    LEFT JOIN LATERAL (
      SELECT f.status
      FROM public.service_follow_ups f
      WHERE f.service_id = s.id
      ORDER BY f.recorded_at DESC
      LIMIT 1
    ) latest ON true
    WHERE COALESCE(latest.status, s.status) <> 'concluido'
    GROUP BY s.current_owner_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.is_active DESC, t.full_name ASC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      p.id,
      p.email,
      p.full_name,
      p.role::text AS role,
      p.support_channel,
      p.is_active,
      p.is_available,
      p.deactivated_at,
      p.deactivated_by,
      (SELECT email FROM public.profiles WHERE id = p.deactivated_by) AS deactivated_by_email,
      p.created_at,
      u.last_sign_in_at,
      u.banned_until,
      u.deleted_at AS auth_deleted_at,
      (u.id IS NULL) AS auth_account_deleted,
      h.last_seen_at,
      (h.last_seen_at IS NOT NULL AND h.last_seen_at > now() - interval '90 seconds') AS is_online,
      (
        SELECT occurred_at
        FROM public.auth_events e
        WHERE e.user_id = p.id AND e.event_type IN ('logout', 'force_logout')
        ORDER BY occurred_at DESC
        LIMIT 1
      ) AS last_logout_at,
      COALESCE(oc.total, 0)      AS open_tickets_count,
      COALESCE(oc.authorized, 0) AS authorized_open_count
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id::text = p.id
    LEFT JOIN public.agent_heartbeats h ON h.user_id = p.id
    LEFT JOIN open_counts oc ON oc.user_id = p.id
  ) t;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 8) manager_list_open_tickets_by_agent — expõe o marcador de autorizado
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_list_open_tickets_by_agent(p_agent_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_agent_id IS NULL OR length(p_agent_id) = 0 THEN
    RAISE EXCEPTION 'p_agent_id is required';
  END IF;

  WITH latest_followup AS (
    SELECT DISTINCT ON (f.service_id)
      f.service_id,
      f.status,
      f.recorded_at
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE s.current_owner_id = p_agent_id
    ORDER BY f.service_id, f.recorded_at DESC
  ),
  followup_counts AS (
    SELECT f.service_id, COUNT(*)::int AS total
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE s.current_owner_id = p_agent_id
    GROUP BY f.service_id
  ),
  rows AS (
    SELECT
      s.id                                          AS service_id,
      s.client_email,
      s.product,
      s.platform,
      s.channel,
      s.service_date,
      s.has_tracking_code,
      s.contact_reason,
      COALESCE(lf.status, s.status)                 AS effective_status,
      lf.recorded_at                                AS last_followup_at,
      COALESCE(fc.total, 0)                         AS follow_up_count,
      s.user_id                                     AS creator_id,
      pc.full_name                                  AS creator_name,
      pc.email                                      AS creator_email,
      s.takeover_approved_at                        AS takeover_approved_at
    FROM public.services s
    LEFT JOIN latest_followup lf  ON lf.service_id = s.id
    LEFT JOIN followup_counts  fc ON fc.service_id = s.id
    LEFT JOIN public.profiles  pc ON pc.id = s.user_id
    WHERE s.current_owner_id = p_agent_id
      AND COALESCE(lf.status, s.status) <> 'concluido'
  )
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.service_date DESC, r.service_id), '[]'::jsonb)
    INTO v_result
  FROM rows r;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
