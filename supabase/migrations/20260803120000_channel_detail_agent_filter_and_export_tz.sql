-- Alinha o relatório em Excel da gestora com o modal "Atendimentos por Canal —
-- Detalhamento" da tela.
--
-- PROBLEMA (03/08/2026)
-- A gestora extrai o Excel e os números não batem com o que ela vê no modal.
-- Três causas:
--
--   1) O Excel não tinha nenhuma aba equivalente ao modal. A aba mais próxima
--      ("Atendimentos por Canal") traz só Canal + Quantidade, sem a quebra por
--      agente nem as colunas Tickets Novos / Interações / Concluídos / %.
--      → resolvido no front (src/lib/reportExport.ts): nova aba
--        "Canal — Detalhamento" alimentada por esta mesma RPC.
--
--   2) dashboard_channel_detail não aceitava filtro de agente — passava NULL
--      fixo para _interaction_events. O resto do relatório respeita o filtro do
--      cabeçalho, então a aba nova ficaria divergindo das demais sempre que a
--      gestora selecionasse um agente.
--      → resolvido aqui: novo parâmetro p_agent_id (default NULL = todos).
--        A tela continua chamando com 2 argumentos nomeados e segue mostrando
--        o time inteiro — comportamento atual preservado de propósito.
--
--   3) dashboard_export_extras.contact_reasons_by_channel usava
--      s.service_date::timestamptz::date, ou seja, o dia no fuso da SESSÃO
--      (UTC no PostgREST) — enquanto _interaction_events usa o dia em
--      America/Sao_Paulo. Tickets abertos entre 21h e meia-noite caíam no dia
--      seguinte só no Excel, deslocando a contagem nas bordas do período.
--      → resolvido aqui: mesmo AT TIME ZONE 'America/Sao_Paulo' das demais.
--
-- Reverter: reaplicar 20260727150000 (channel_detail) e 20260520030000
-- (export_extras).

-- ── 1) dashboard_channel_detail ganha filtro de agente ──────────────────────
-- Precisa de DROP antes: acrescentar um parâmetro com DEFAULT criaria uma
-- SEGUNDA sobrecarga e o PostgREST passaria a responder 300 (ambíguo).
DROP FUNCTION IF EXISTS public.dashboard_channel_detail(date, date);

CREATE OR REPLACE FUNCTION public.dashboard_channel_detail(
  p_from_date date DEFAULT NULL,
  p_to_date   date DEFAULT NULL,
  p_agent_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from   date;
  v_to     date;
  v_agent  text;
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_from  := COALESCE(p_from_date, CURRENT_DATE);
  v_to    := COALESCE(p_to_date,   CURRENT_DATE);
  -- O front manda 'all' quando o filtro está em "Todos os agentes".
  v_agent := NULLIF(NULLIF(p_agent_id, 'all'), '');

  WITH
  events AS (
    SELECT
      e.user_id,
      COALESCE(e.channel, 'Não informado') AS channel,
      e.service_id,
      e.kind
    FROM public._interaction_events(v_from, v_to, v_agent) e
  ),
  -- Volume por (agente, canal): cada evento vale 1, como no gráfico.
  ev_by_agent AS (
    SELECT
      e.user_id,
      e.channel,
      COUNT(*) FILTER (WHERE e.kind = 'service')::int   AS new_tickets,
      COUNT(*) FILTER (WHERE e.kind = 'follow_up')::int AS interactions,
      COUNT(*)::int                                     AS total
    FROM events e
    GROUP BY e.user_id, e.channel
  ),
  -- Status dos tickets abertos no período (classificação pelo último follow-up).
  last_fup AS (
    SELECT DISTINCT ON (ev.service_id)
      ev.service_id,
      ev.user_id,
      ev.channel,
      s.status AS svc_status,
      f.status AS fup_status
    FROM events ev
    JOIN public.services s ON s.id = ev.service_id
    LEFT JOIN public.service_follow_ups f ON f.service_id = ev.service_id
    WHERE ev.kind = 'service'
    ORDER BY ev.service_id, f.follow_up_number DESC NULLS LAST
  ),
  done_by_agent AS (
    SELECT
      user_id,
      channel,
      COUNT(*)::int AS done_count
    FROM last_fup
    WHERE svc_status = 'concluido' OR fup_status = 'concluido'
    GROUP BY user_id, channel
  ),
  agent_channel AS (
    SELECT
      ev.user_id                        AS agent_id,
      COALESCE(p.full_name, 'Sem nome') AS agent_name,
      ev.channel,
      ev.new_tickets,
      COALESCE(d.done_count, 0)         AS done_count,
      ev.interactions,
      ev.total
    FROM ev_by_agent ev
    LEFT JOIN public.profiles p ON p.id::text = ev.user_id
    LEFT JOIN done_by_agent d
           ON d.user_id = ev.user_id AND d.channel = ev.channel
  )
  SELECT jsonb_build_object(
    'by_channel_agent',
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'channel',      ac.channel,
          'agent_id',     ac.agent_id,
          'agent_name',   ac.agent_name,
          'new_tickets',  ac.new_tickets,
          'done_count',   ac.done_count,
          'interactions', ac.interactions,
          'total',        ac.total
        ) ORDER BY ac.channel, ac.total DESC, ac.agent_name
      ),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM agent_channel ac;

  RETURN COALESCE(v_result, jsonb_build_object('by_channel_agent', '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_channel_detail(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_channel_detail(date, date, text) TO authenticated;

-- ── 2) dashboard_export_extras: dia do ticket em São Paulo ──────────────────
-- Corpo idêntico a 20260520030000, mudando APENAS o recorte de data de
-- contact_reasons_by_channel para o fuso de São Paulo.
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
  -- services.service_date é text; converte para timestamptz e pega o dia em
  -- America/Sao_Paulo — mesmo recorte de _interaction_events. Antes usava
  -- ::timestamptz::date (fuso da sessão = UTC), o que jogava atendimentos da
  -- noite para o dia seguinte.
  -- Conta apenas ABERTURAS de ticket (1 linha de services = 1 motivo). Não é
  -- volume de atendimento: follow-ups não têm motivo de contato próprio.
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.channel ASC, t.qty DESC), '[]'::jsonb)
    INTO v_contact_reasons_by_channel
  FROM (
    SELECT
      COALESCE(s.channel, 'Não informado') AS channel,
      COALESCE(s.contact_reason, 'nao_informado') AS reason_code,
      COUNT(*)::int AS qty
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
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

NOTIFY pgrst, 'reload schema';
