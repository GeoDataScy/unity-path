-- Restringe "Assumir atendimento" a agentes com permissão explícita.
--
-- Segue o vocabulário de capacidades do projeto (uma boolean por capacidade,
-- nomeada pelo que ela permite): can_view_all_tickets, can_register_duplicate_emails.
-- Aqui: can_claim_tickets — o agente pode assumir para si um ticket aberto que
-- hoje pertence a outro agente (via RPC claim_ticket).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_claim_tickets boolean NOT NULL DEFAULT false;

-- Helper lido server-side (mesmo padrão de can_view_all_tickets()).
CREATE OR REPLACE FUNCTION public.can_claim_tickets()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.can_claim_tickets FROM public.profiles p WHERE p.id = (auth.uid())::text),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_claim_tickets() TO authenticated;

-- claim_ticket passa a exigir a permissão (gestor também pode).
CREATE OR REPLACE FUNCTION public.claim_ticket(p_service_id text)
RETURNS TABLE(
  id                text,
  client_email      text,
  service_date      text,
  product           text,
  platform          text,
  channel           text,
  status            text,
  created_at        timestamptz,
  has_tracking_code boolean,
  contact_reason    text,
  user_id           text,
  current_owner_id  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid           text;
  v_current_owner text;
  v_status        text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT (public.can_claim_tickets() OR public.is_manager()) THEN
    RAISE EXCEPTION 'forbidden: sem permissão para assumir atendimentos';
  END IF;

  SELECT s.current_owner_id, s.status
    INTO v_current_owner, v_status
  FROM public.services s
  WHERE s.id = p_service_id
  FOR UPDATE;

  IF v_current_owner IS NULL THEN
    RAISE EXCEPTION 'Ticket não encontrado';
  END IF;
  IF v_status = 'concluido' THEN
    RAISE EXCEPTION 'Ticket já concluído — não é possível assumir';
  END IF;

  IF v_current_owner <> v_uid THEN
    -- Autoriza a carve-out do trigger só para este UPDATE, para este dono.
    PERFORM set_config('app.claim_owner', v_uid, true);

    -- Alias explícito: as colunas OUT do RETURNS TABLE sombreiam os nomes das
    -- colunas da tabela, então um WHERE id = ... seria ambíguo.
    UPDATE public.services AS svc
    SET current_owner_id = v_uid
    WHERE svc.id = p_service_id;

    INSERT INTO public.ticket_transfers (
      service_id, from_user_id, to_user_id, status, message,
      responded_at, recipient_seen_at, requester_seen_at, assigned_by_manager_id
    ) VALUES (
      p_service_id, v_current_owner, v_uid, 'accepted', 'Atendimento assumido',
      now(), now(), now(), NULL
    );
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.client_email, s.service_date, s.product, s.platform, s.channel,
    s.status, s.created_at::timestamptz, s.has_tracking_code, s.contact_reason,
    s.user_id, s.current_owner_id
  FROM public.services s
  WHERE s.id = p_service_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
