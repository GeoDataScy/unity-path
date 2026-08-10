-- Reescreve dashboard_channel_detail com a regra "cada interação = 1 evento".
--
-- PROBLEMA (auditado em 27/07/2026, janela 28/06→27/07)
-- O modal "Atendimentos por Canal — Detalhamento" somava 10.428 enquanto o
-- gráfico "Atendimentos por canal" (dashboard_metrics.by_channel) somava
-- 20.116 (~52%). Causa: em 25/05 a regra oficial mudou para "cada interação
-- = 1 evento" via _interaction_events (20260525000100), mas esta RPC ficou
-- na regra antiga de 30/04 (tickets distintos, Set A + Set B). Gap medido:
--     6.594 follow-ups em tickets abertos dentro do próprio período
--           (Set B exigia service_date < from — sumiam do modal)
--     1.578 follow-ups repetidos no mesmo ticket antigo (COUNT DISTINCT)
--     1.516 follow-ups cross-agent (guard s.user_id = f.user_id, removido de
--           _interaction_events em 28/05 mas mantido aqui)
-- Extras: canal NULL virava 'Nao informado' (sem til) — bucket separado do
-- 'Não informado' do gráfico; e o filtro p.role = 'agent' descartava eventos
-- de não-agentes (o gráfico não filtra).
--
-- NOVA REGRA (idêntica a dashboard_metrics.by_channel):
--   * new_tickets  = eventos kind='service'  (ticket aberto no período,
--                    creditado ao criador s.user_id)
--   * interactions = eventos kind='follow_up' (cada follow-up registrado no
--                    período, creditado a quem escreveu f.user_id; canal
--                    herdado do ticket)
--   * total        = new_tickets + interactions
--   → por canal, Σ total = dashboard_metrics.by_channel exatamente;
--   → por agente, Σ total = dashboard_metrics.by_agent exatamente.
--
-- done_count segue sendo conceito de STATUS (não de volume): dos tickets
-- ABERTOS no período por (agente, canal), quantos estão concluídos hoje
-- (status do service ou do último follow-up) — mesma classificação usada em
-- dashboard_follow_up_detail. done_count ≤ new_tickets, e o front continua
-- calculando % conclusão = done/new.
--
-- Contrato de retorno inalterado ({by_channel_agent: [...]}) — nenhuma
-- mudança no front. Reverter = reaplicar o corpo de 20260430160000.

CREATE OR REPLACE FUNCTION public.dashboard_channel_detail(
  p_from_date date DEFAULT NULL,
  p_to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from   date;
  v_to     date;
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_from := COALESCE(p_from_date, CURRENT_DATE);
  v_to   := COALESCE(p_to_date,   CURRENT_DATE);

  WITH
  events AS (
    SELECT
      e.user_id,
      COALESCE(e.channel, 'Não informado') AS channel,
      e.service_id,
      e.kind
    FROM public._interaction_events(v_from, v_to, NULL) e
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

REVOKE ALL ON FUNCTION public.dashboard_channel_detail(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_channel_detail(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
