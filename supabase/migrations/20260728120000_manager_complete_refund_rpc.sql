-- Baixa de reembolso pela gestora direto da aba Alertas.
--
-- A RLS de `refunds` dá ao manager apenas SELECT (UPDATE é restrito ao dono),
-- então a baixa passa por RPC SECURITY DEFINER com guard is_manager().
-- Toda baixa feita pelo manager fica registrada em refund_manager_completions
-- (mesmo padrão de auditoria de manager_correct_service_date).
--
-- Os campos exigidos são os mesmos do fluxo do agente (CompleteRefundDialog):
-- data de conclusão, valor, tipo (percentual), motivo e itens devolvidos —
-- assim dashboard_refund_metrics continua íntegro (valor/tipo/motivo alimentam
-- by_refund_type, by_reason e a eficiência por canal).

-- ── Auditoria ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refund_manager_completions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id       text        NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  refund_owner_id text        NOT NULL,
  completed_by    uuid        NOT NULL REFERENCES auth.users(id),
  completion_date text        NOT NULL,
  refund_value    double precision,
  refund_type     text,
  reason          text,
  items_returned  boolean     NOT NULL DEFAULT false,
  days_overdue    integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_manager_completions_refund
  ON public.refund_manager_completions(refund_id);
CREATE INDEX IF NOT EXISTS idx_refund_manager_completions_created_at
  ON public.refund_manager_completions(created_at DESC);

ALTER TABLE public.refund_manager_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read refund completions"   ON public.refund_manager_completions;
DROP POLICY IF EXISTS "Managers insert refund completions" ON public.refund_manager_completions;

CREATE POLICY "Managers read refund completions"
  ON public.refund_manager_completions
  FOR SELECT
  USING ((SELECT public.is_manager()));

CREATE POLICY "Managers insert refund completions"
  ON public.refund_manager_completions
  FOR INSERT
  WITH CHECK ((SELECT public.is_manager()));

-- ── RPC ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_complete_refund(
  p_refund_id       text,
  p_completion_date date,
  p_refund_value    numeric,
  p_refund_type     text,
  p_reason          text,
  p_items_returned  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid           uuid;
  v_owner_id      text;
  v_request_date  text;
  v_completion    text;
  v_today         date;
  v_new_date_text text;
  v_days_overdue  integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden: apenas gestores podem dar baixa em reembolso de outro agente';
  END IF;

  SELECT r.user_id, r.request_date, r.completion_date
    INTO v_owner_id, v_request_date, v_completion
  FROM public.refunds r
  WHERE r.id = p_refund_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'reembolso nao encontrado: %', p_refund_id;
  END IF;

  IF v_completion IS NOT NULL THEN
    RAISE EXCEPTION 'reembolso ja concluido em %', v_completion;
  END IF;

  -- Validações espelham o schema do CompleteRefundDialog no cliente
  IF p_completion_date IS NULL THEN
    RAISE EXCEPTION 'data de conclusao e obrigatoria';
  END IF;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF p_completion_date > v_today THEN
    RAISE EXCEPTION 'data de conclusao no futuro nao e permitida';
  END IF;

  IF p_completion_date < v_request_date::date THEN
    RAISE EXCEPTION 'data de conclusao anterior a solicitacao (%)', v_request_date;
  END IF;

  IF p_refund_value IS NULL OR p_refund_value < 0 THEN
    RAISE EXCEPTION 'valor do reembolso e obrigatorio e nao pode ser negativo';
  END IF;

  IF p_refund_type IS NULL
     OR p_refund_type !~ '^(05|10|15|20|25|30|35|40|45|50|55|60|65|70|75|80|85|90|95|100)%$' THEN
    RAISE EXCEPTION 'tipo de reembolso invalido: %', COALESCE(p_refund_type, 'nulo');
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'motivo e obrigatorio';
  END IF;

  v_new_date_text := to_char(p_completion_date, 'YYYY-MM-DD');
  v_days_overdue  := v_today - v_request_date::date;

  UPDATE public.refunds
  SET completion_date = v_new_date_text,
      refund_value    = p_refund_value,
      refund_type     = p_refund_type,
      reason          = trim(p_reason),
      items_returned  = COALESCE(p_items_returned, false)
  WHERE id = p_refund_id;

  INSERT INTO public.refund_manager_completions(
    refund_id, refund_owner_id, completed_by, completion_date,
    refund_value, refund_type, reason, items_returned, days_overdue
  ) VALUES (
    p_refund_id, v_owner_id, v_uid, v_new_date_text,
    p_refund_value, p_refund_type, trim(p_reason),
    COALESCE(p_items_returned, false), v_days_overdue
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'refund_id',       p_refund_id,
    'agent_id',        v_owner_id,
    'completion_date', v_new_date_text,
    'days_overdue',    v_days_overdue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_complete_refund(text, date, numeric, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_complete_refund(text, date, numeric, text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
