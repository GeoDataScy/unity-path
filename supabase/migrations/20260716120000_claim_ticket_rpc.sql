-- "Assumir atendimento": permite que um agente que recebeu o e-mail de um
-- cliente assuma a titularidade de um ticket aberto que hoje pertence a outro
-- agente, para então registrar a interação.
--
-- Contexto do problema: current_owner_id só podia ser alterado por gestor
-- (trigger _tg_service_block_freeze_fields). Quando o gestor redistribui em
-- massa os tickets criados por um agente, esse agente fica travado sempre que o
-- cliente volta a escrever — só conseguia "Encaminhar" de volta pro dono, nunca
-- assumir. Este RPC dá essa saída, de forma controlada.
--
-- Mecanismo da carve-out (sem afrouxar a regra do gestor):
--   * claim_ticket seta um GUC transacional app.claim_owner = auth.uid().
--   * O trigger passa a aceitar a troca de current_owner_id quando o novo dono
--     for EXATAMENTE esse valor. Ou seja: o agente só pode assumir para SI
--     mesmo, e só através deste RPC (PostgREST não deixa o cliente setar GUCs
--     arbitrários; RLS impede UPDATE direto em ticket alheio). O caminho de
--     gestor (is_manager) e as regras de user_id/service_date ficam inalterados.

-- ============================================================================
-- 1) Estende o trigger de freeze para reconhecer a carve-out de "assumir"
-- ============================================================================
CREATE OR REPLACE FUNCTION public._tg_service_block_freeze_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- user_id é o criador. Sempre imutável, sem override de gestor.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable (creator is frozen)';
  END IF;

  -- service_date: carve-out só de gestor (manager_correct_service_date RPC).
  IF NEW.service_date IS DISTINCT FROM OLD.service_date THEN
    IF NOT public.is_manager() THEN
      RAISE EXCEPTION 'service_date is immutable (use manager_correct_service_date)';
    END IF;
  END IF;

  -- current_owner_id: gestor (manager_reassign_tickets) OU auto-claim do agente
  -- (claim_ticket), identificado quando o novo dono == app.claim_owner setado
  -- na transação pelo RPC.
  IF NEW.current_owner_id IS DISTINCT FROM OLD.current_owner_id THEN
    IF NOT public.is_manager()
       AND current_setting('app.claim_owner', true) IS DISTINCT FROM NEW.current_owner_id THEN
      RAISE EXCEPTION 'current_owner_id can only be changed by a manager';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2) claim_ticket(p_service_id) — agente assume o ticket para si
-- ============================================================================
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

  -- Trava a linha e lê o estado atual.
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

  -- Já sou o dono → nada a fazer, apenas retorna a linha.
  IF v_current_owner <> v_uid THEN
    -- Autoriza a carve-out do trigger só para este UPDATE, para este dono.
    PERFORM set_config('app.claim_owner', v_uid, true);

    -- Alias explícito: as colunas OUT do RETURNS TABLE (id, ...) sombreiam os
    -- nomes de coluna da tabela, então um WHERE id = ... seria ambíguo.
    UPDATE public.services AS svc
    SET current_owner_id = v_uid
    WHERE svc.id = p_service_id;

    -- Registra a tomada como transferência aceita (histórico/auditoria).
    -- assigned_by_manager_id = NULL → é uma ação de agente, não do gestor.
    -- requester_seen_at = now() evita notificação enganosa ao dono anterior.
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

REVOKE ALL ON FUNCTION public.claim_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ticket(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
