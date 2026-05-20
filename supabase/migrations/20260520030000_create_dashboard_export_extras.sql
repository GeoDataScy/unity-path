-- One-shot RPC that returns every aggregate the manager export needs that is
-- NOT already available from dashboard_metrics / dashboard_status_summary /
-- dashboard_refund_metrics. Single call keeps the export endpoint fast.
--
-- Honors the same filter shape as the rest of the dashboard: period + agent.

CREATE OR REPLACE FUNCTION public.dashboard_export_extras(
  from_date date,
  to_date date,
  agent_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_reasons_by_channel jsonb;
  v_refund_summary jsonb;
  v_refund_partial_ranking jsonb;
  v_refund_values_summary jsonb;
  v_refund_values_by_channel jsonb;
  v_refund_values_by_product jsonb;
  v_refund_reasons_by_product jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- ── Motivos de contato (canal × motivo × qty) ─────────────────────────────
  -- services.service_date is text; cast to timestamptz then to date.
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.channel ASC, t.qty DESC), '[]'::jsonb)
    INTO v_contact_reasons_by_channel
  FROM (
    SELECT
      COALESCE(s.channel, 'Não informado') AS channel,
      COALESCE(s.contact_reason, 'nao_informado') AS reason_code,
      COUNT(*)::int AS qty
    FROM public.services s
    WHERE s.service_date::timestamptz::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY 1, 2
  ) t;

  -- ── Reembolsos - resumo ───────────────────────────────────────────────────
  -- Period rule: same as dashboard_refund_metrics — open by request_date,
  -- closed by completion_date.
  SELECT jsonb_build_object(
    'total_count',   COUNT(*)::int,
    'open_count',    COUNT(*) FILTER (WHERE r.completion_date IS NULL)::int,
    'done_count',    COUNT(*) FILTER (WHERE r.completion_date IS NOT NULL)::int,
    'partial_count', COUNT(*) FILTER (WHERE r.completion_date IS NOT NULL AND r.refund_type IS NOT NULL AND r.refund_type <> '100%')::int,
    'full_count',    COUNT(*) FILTER (WHERE r.completion_date IS NOT NULL AND r.refund_type = '100%')::int
  )
    INTO v_refund_summary
  FROM public.refunds r
  WHERE (
    (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
    OR
    (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
  )
    AND (agent_id IS NULL OR r.user_id::text = agent_id);

  -- ── Ranking de % parcial mais aceito (exclui 100%) ────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.qty DESC, t.refund_type ASC), '[]'::jsonb)
    INTO v_refund_partial_ranking
  FROM (
    SELECT
      r.refund_type,
      COUNT(*)::int AS qty
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND r.refund_type IS NOT NULL
      AND r.refund_type <> '100%'
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
    GROUP BY r.refund_type
  ) t;

  -- ── Valores financeiros - resumo (R$) ─────────────────────────────────────
  SELECT jsonb_build_object(
    'partial_value_sum', COALESCE(ROUND(SUM(refund_value) FILTER (WHERE refund_type IS NOT NULL AND refund_type <> '100%')::numeric, 2), 0),
    'full_value_sum',    COALESCE(ROUND(SUM(refund_value) FILTER (WHERE refund_type = '100%')::numeric, 2), 0),
    'total_value_sum',   COALESCE(ROUND(SUM(refund_value)::numeric, 2), 0)
  )
    INTO v_refund_values_summary
  FROM public.refunds r
  WHERE r.completion_date IS NOT NULL
    AND r.completion_date::date BETWEEN from_date AND to_date
    AND r.refund_value IS NOT NULL
    AND (agent_id IS NULL OR r.user_id::text = agent_id);

  -- ── Valores por canal de atendimento ──────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.channel ASC), '[]'::jsonb)
    INTO v_refund_values_by_channel
  FROM (
    SELECT
      COALESCE(r.channel, 'Não informado') AS channel,
      COALESCE(ROUND(SUM(r.refund_value)::numeric, 2), 0) AS value
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND r.refund_value IS NOT NULL
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
    GROUP BY 1
  ) t;

  -- ── Valores por produto ───────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.product ASC), '[]'::jsonb)
    INTO v_refund_values_by_product
  FROM (
    SELECT
      COALESCE(r.product, 'Não informado') AS product,
      COALESCE(ROUND(SUM(r.refund_value)::numeric, 2), 0) AS value
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND r.refund_value IS NOT NULL
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
    GROUP BY 1
  ) t;

  -- ── Motivos de reembolso por produto (produto × categoria normalizada) ────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.product ASC, t.qty DESC), '[]'::jsonb)
    INTO v_refund_reasons_by_product
  FROM (
    SELECT
      COALESCE(r.product, 'Não informado') AS product,
      c.category AS reason,
      COUNT(*)::int AS qty
    FROM public.refunds r
    JOIN public.refund_reason_classifications c ON c.refund_id = r.id
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
    GROUP BY 1, 2
  ) t;

  RETURN jsonb_build_object(
    'contact_reasons_by_channel', v_contact_reasons_by_channel,
    'refund_summary',             v_refund_summary,
    'refund_partial_ranking',     v_refund_partial_ranking,
    'refund_values_summary',      v_refund_values_summary,
    'refund_values_by_channel',   v_refund_values_by_channel,
    'refund_values_by_product',   v_refund_values_by_product,
    'refund_reasons_by_product',  v_refund_reasons_by_product
  );
END;
$function$;
