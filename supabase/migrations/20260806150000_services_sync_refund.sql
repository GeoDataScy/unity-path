-- Atendimento com motivo "Reembolso" cria o registro em Reembolsos.
--
-- Hoje o agente digita a mesma coisa duas vezes: registra o atendimento e depois
-- cadastra o reembolso à mão na outra aba. Só faltava um dado para o sistema fazer
-- isso sozinho: o NÚMERO DO PEDIDO, que existe no formulário de reembolso e não no
-- de atendimento. Ele passa a ser pedido no atendimento quando o motivo é
-- "Reembolso" (services.order_id) e o reembolso nasce completo.
--
-- A sincronia fica em TRIGGER, não no front: assim vale para qualquer caminho de
-- escrita (tela do agente, edição do atendimento, correção da gestora, importação)
-- e o reembolso é criado na MESMA transação do atendimento — ou entram os dois, ou
-- não entra nenhum.
--
-- Regras:
--   * motivo = 'reembolso' -> cria o reembolso vinculado (refunds.service_id).
--   * já existe reembolso EM ABERTO do mesmo agente para aquele cliente+pedido,
--     cadastrado à mão? Vincula em vez de duplicar (é o retrabalho de hoje).
--   * enquanto o reembolso estiver em aberto, editar o atendimento atualiza os
--     campos compartilhados (e-mail, pedido, produto, plataforma, canal, data) e
--     acompanha a troca de dono do ticket. Campos do fluxo de reembolso — motivo,
--     tipo, valor, itens devolvidos, baixa — nunca são tocados.
--   * reembolso com baixa dada (completion_date) é histórico: não é alterado nem
--     apagado, nem que o atendimento mude.
--   * tirar o motivo "reembolso" (ou apagar o atendimento) só remove o reembolso se
--     ele tiver nascido da automação, ninguém tiver assumido e nada tiver sido
--     preenchido — ninguém perde trabalho já feito, nem reembolso cadastrado à mão.
--
-- Sem backfill: atendimentos antigos com motivo reembolso não geram registro
-- retroativo (criaria uma enxurrada de reembolsos que a operação já tratou fora).

-- ============================================================================
-- 1) Número do pedido no atendimento + vínculo do reembolso com o atendimento.
-- ============================================================================
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS order_id text;

COMMENT ON COLUMN public.services.order_id IS
  'Número do pedido. Obrigatório na UI quando contact_reason = reembolso; alimenta o registro em refunds.';

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS service_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refunds_service_id_fkey'
  ) THEN
    ALTER TABLE public.refunds
      ADD CONSTRAINT refunds_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.refunds.service_id IS
  'Atendimento que originou o reembolso (NULL = cadastrado direto na aba Reembolsos).';

-- Só o reembolso CRIADO pela sincronização pode ser desfeito automaticamente.
-- Reembolso que o agente cadastrou à mão e a sincronização apenas vinculou nunca é
-- apagado por conta do atendimento.
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS created_from_service boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.refunds.created_from_service IS
  'true = criado automaticamente pelo atendimento (pode ser desfeito enquanto intocado).';

-- Reembolso que nasceu do atendimento entra "apagado" na aba do agente: ninguém
-- pegou ainda. Assumir acende a linha e registra quem pegou e quando.
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refunds_picked_up_by_fkey'
  ) THEN
    ALTER TABLE public.refunds
      ADD CONSTRAINT refunds_picked_up_by_fkey
      FOREIGN KEY (picked_up_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.refunds.picked_up_at IS
  'Quando o agente assumiu o reembolso criado pelo atendimento. NULL + service_id = ainda apagado na lista.';

-- Um reembolso por atendimento.
CREATE UNIQUE INDEX IF NOT EXISTS refunds_service_id_uniq
  ON public.refunds (service_id) WHERE service_id IS NOT NULL;

-- Usado pela busca de reembolso em aberto equivalente (evita duplicar).
CREATE INDEX IF NOT EXISTS idx_refunds_open_by_email
  ON public.refunds (lower(btrim(customer_email))) WHERE completion_date IS NULL;

-- ============================================================================
-- 2) Sincronização atendimento -> reembolso.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_refund_from_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_refund_id    text;
  v_order_id     text;
  v_request_date text;
  v_owner        text;
BEGIN
  -- Motivo deixou de ser reembolso: o registro automático só some se ninguém
  -- tiver mexido nele ainda.
  IF TG_OP = 'UPDATE'
     AND OLD.contact_reason = 'reembolso'
     AND NEW.contact_reason IS DISTINCT FROM 'reembolso' THEN
    DELETE FROM public.refunds r
    WHERE r.service_id = NEW.id
      AND r.created_from_service
      AND r.picked_up_at IS NULL
      AND r.completion_date IS NULL
      AND r.reason IS NULL
      AND r.refund_type IS NULL
      AND r.refund_value IS NULL
      AND r.items_returned = false;
    RETURN NULL;
  END IF;

  IF NEW.contact_reason IS DISTINCT FROM 'reembolso' THEN
    RETURN NULL;
  END IF;

  v_owner    := COALESCE(NEW.current_owner_id, NEW.user_id);
  v_order_id := COALESCE(NULLIF(btrim(NEW.order_id), ''), '');
  -- service_date é texto ISO com fuso; a data da solicitação é a data em SP.
  v_request_date := to_char(
    (NEW.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD');

  SELECT r.id INTO v_refund_id FROM public.refunds r WHERE r.service_id = NEW.id;

  -- Sem vínculo ainda: aproveita o reembolso que o agente já tenha cadastrado à
  -- mão para o mesmo cliente + pedido, em vez de criar um segundo.
  IF v_refund_id IS NULL AND v_order_id <> '' THEN
    SELECT r.id INTO v_refund_id
    FROM public.refunds r
    WHERE r.service_id IS NULL
      AND r.user_id = v_owner
      AND r.completion_date IS NULL
      AND lower(btrim(r.customer_email)) = lower(btrim(NEW.client_email))
      AND btrim(r.order_id) = v_order_id
    ORDER BY r.created_at
    LIMIT 1;

    IF v_refund_id IS NOT NULL THEN
      UPDATE public.refunds SET service_id = NEW.id WHERE id = v_refund_id;
    END IF;
  END IF;

  IF v_refund_id IS NULL THEN
    INSERT INTO public.refunds (
      user_id, order_id, customer_email, sales_platform, request_date,
      product, channel, service_id, created_from_service
    )
    VALUES (
      v_owner,
      v_order_id,
      btrim(NEW.client_email),
      COALESCE(NULLIF(btrim(NEW.platform), ''), 'Nenhum'),
      v_request_date,
      NEW.product,
      COALESCE(NULLIF(btrim(NEW.channel), ''), 'Nenhum'),
      NEW.id,
      true
    );
    RETURN NULL;
  END IF;

  -- Vínculo existente: mantém em dia enquanto o reembolso estiver em aberto.
  UPDATE public.refunds r
  SET user_id        = v_owner,
      customer_email = btrim(NEW.client_email),
      order_id       = CASE WHEN v_order_id <> '' THEN v_order_id ELSE r.order_id END,
      sales_platform = COALESCE(NULLIF(btrim(NEW.platform), ''), r.sales_platform),
      product        = NEW.product,
      channel        = COALESCE(NULLIF(btrim(NEW.channel), ''), r.channel),
      request_date   = v_request_date
  WHERE r.id = v_refund_id
    AND r.completion_date IS NULL;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_refund_from_service() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_service_sync_refund_ins ON public.services;
CREATE TRIGGER trg_service_sync_refund_ins
  AFTER INSERT ON public.services
  FOR EACH ROW
  WHEN (NEW.contact_reason = 'reembolso')
  EXECUTE FUNCTION public.sync_refund_from_service();

-- Só dispara quando algo que interessa ao reembolso muda — atualização de status
-- do ticket não mexe em nada.
DROP TRIGGER IF EXISTS trg_service_sync_refund_upd ON public.services;
CREATE TRIGGER trg_service_sync_refund_upd
  AFTER UPDATE ON public.services
  FOR EACH ROW
  WHEN (
    NEW.contact_reason IS DISTINCT FROM OLD.contact_reason
    OR (NEW.contact_reason = 'reembolso' AND (
         NEW.client_email     IS DISTINCT FROM OLD.client_email
      OR NEW.product          IS DISTINCT FROM OLD.product
      OR NEW.platform         IS DISTINCT FROM OLD.platform
      OR NEW.channel          IS DISTINCT FROM OLD.channel
      OR NEW.order_id         IS DISTINCT FROM OLD.order_id
      OR NEW.service_date     IS DISTINCT FROM OLD.service_date
      OR NEW.current_owner_id IS DISTINCT FROM OLD.current_owner_id
    ))
  )
  EXECUTE FUNCTION public.sync_refund_from_service();

-- ============================================================================
-- 3) Atendimento apagado: leva junto o reembolso automático ainda intocado.
--    (A FK é ON DELETE SET NULL, então o que já tem trabalho vira registro solto
--    em Reembolsos, sem sumir.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_refund_of_deleted_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.refunds r
  WHERE r.service_id = OLD.id
    AND r.created_from_service
    AND r.picked_up_at IS NULL
    AND r.completion_date IS NULL
    AND r.reason IS NULL
    AND r.refund_type IS NULL
    AND r.refund_value IS NULL
    AND r.items_returned = false;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_refund_of_deleted_service() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_service_cleanup_refund_del ON public.services;
CREATE TRIGGER trg_service_cleanup_refund_del
  BEFORE DELETE ON public.services
  FOR EACH ROW
  WHEN (OLD.contact_reason = 'reembolso')
  EXECUTE FUNCTION public.cleanup_refund_of_deleted_service();

-- ============================================================================
-- 4) Assumir o reembolso: acende a linha apagada.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pick_up_refund(p_refund_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     text;
  v_updated int;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.refunds r
  SET picked_up_at = now(),
      picked_up_by = v_uid
  WHERE r.id = p_refund_id
    AND r.picked_up_at IS NULL
    AND r.completion_date IS NULL
    AND (r.user_id = v_uid OR public.is_manager());

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'refund not found, not yours, already picked up or already completed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_up_refund(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_up_refund(text) TO authenticated;

-- ============================================================================
-- 5) my_refunds_with_refunded_value passa a devolver service_id e picked_up_at,
--    para a aba Reembolsos marcar o que veio do atendimento e o que ainda está
--    apagado. (DROP + CREATE: mudar a lista de colunas de retorno não é possível
--    com CREATE OR REPLACE.)
-- ============================================================================
DROP FUNCTION IF EXISTS public.my_refunds_with_refunded_value();

CREATE FUNCTION public.my_refunds_with_refunded_value()
RETURNS TABLE(
  id uuid,
  created_at timestamp with time zone,
  user_id uuid,
  customer_email text,
  request_date date,
  completion_date date,
  reason text,
  items_returned boolean,
  sales_platform text,
  order_id text,
  refund_type text,
  refund_value numeric,
  refunded_value numeric,
  product text,
  channel text,
  service_id text,
  picked_up_at timestamp with time zone
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    r.id::uuid,
    r.created_at::timestamptz,
    r.user_id::uuid,
    r.customer_email::text,
    r.request_date::date,
    r.completion_date::date,
    r.reason::text,
    r.items_returned::boolean,
    r.sales_platform::text,
    r.order_id::text,
    r.refund_type::text,
    r.refund_value::numeric,
    CASE
      WHEN r.refund_value IS NULL THEN NULL
      WHEN r.refund_type IS NULL THEN NULL
      WHEN r.refund_type !~ '^\d{1,3}%$' THEN NULL
      ELSE
        CASE
          WHEN (replace(r.refund_type, '%', '')::numeric) < 0 THEN NULL
          WHEN (replace(r.refund_type, '%', '')::numeric) > 100 THEN NULL
          ELSE round((r.refund_value * (replace(r.refund_type, '%', '')::numeric / 100))::numeric, 2)
        END
    END AS refunded_value,
    r.product::text,
    r.channel::text,
    r.service_id::text,
    r.picked_up_at::timestamptz
  FROM public.refunds r
  WHERE r.user_id::uuid = auth.uid()
  ORDER BY r.request_date DESC;
$function$;

REVOKE ALL ON FUNCTION public.my_refunds_with_refunded_value() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_refunds_with_refunded_value() TO authenticated;

NOTIFY pgrst, 'reload schema';
