-- Reescreve dashboard_follow_up_detail (tela "Interacoes") sobre
-- _interaction_events — a última RPC que ainda estava na regra antiga.
--
-- PROBLEMA
-- A tela Interações contava interação assim:
--   COUNT(DISTINCT f.service_id) de follow-ups registrados no período
--   WHERE s.user_id = f.user_id                      -- guard de dono
--     AND service_date < from_date                   -- só tickets ANTIGOS
-- Ou seja, três descartes de uma vez. Medido em produção para 01→10/08/2026:
--
--   tela Interacoes  : Total Tickets 3.121 (2.554 novos + 567 interações)
--   tela Atendimentos: 4.890 eventos    (2.554 novos + 2.336 interações)
--
--   gap de 1.769 interações =
--     1.050 follow-ups em tickets abertos DENTRO do período (barrados por
--             service_date < from_date)
--       369 follow-ups repetidos no mesmo ticket, colapsados pelo DISTINCT
--       409 follow-ups feitos por agente diferente do dono (guard removido de
--             _interaction_events em 20260528000300, mantido aqui)
--   (as três categorias se sobrepõem; juntas fecham o gap)
--
-- Além disso o breakdown por agente filtrava `p.role = 'agent'`, escondendo
-- quem registra atendimento sem ser 'agent' (gestora), enquanto
-- dashboard_metrics.by_agent nunca filtrou por cargo.
--
-- REGRA NOVA (mesma de dashboard_metrics / dashboard_channel_detail):
--   * abertura de ticket = 1 evento, creditado a services.user_id
--   * cada follow-up     = 1 evento, creditado a service_follow_ups.user_id
--   * done_count         = tickets ABERTOS no período que estão concluídos,
--                          classificados pelo último follow-up
--
-- KPI e insights passam a ser derivados do MESMO breakdown por agente, então o
-- card, o gráfico e a tabela da tela não podem mais divergir entre si.
--
-- Contrato jsonb inalterado (kpi / by_agent / recent_follow_ups / insights com
-- as mesmas chaves) — a tela só muda de número, não de forma.
--
-- Reverter: reaplicar 20260430150000_fix_follow_up_detail_insights.

CREATE OR REPLACE FUNCTION public.dashboard_follow_up_detail(
  p_from_date date DEFAULT NULL::date,
  p_to_date   date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from date;
  v_to   date;
  v_kpi       jsonb;
  v_by_agent  jsonb;
  v_recent    jsonb;
  v_insights  jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_from := COALESCE(p_from_date, CURRENT_DATE);
  v_to   := COALESCE(p_to_date,   CURRENT_DATE);

  -- ── Breakdown por agente (fonte única de kpi, gráfico, tabela e insights) ──
  WITH events AS (
    SELECT e.user_id, e.service_id, e.kind
    FROM public._interaction_events(v_from, v_to, NULL) e
  ),
  -- Volume por agente: cada evento vale 1.
  ev_by_agent AS (
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE kind = 'service')::int   AS new_tickets_count,
      COUNT(*) FILTER (WHERE kind = 'follow_up')::int AS interactions_count
    FROM events
    GROUP BY user_id
  ),
  -- Status dos tickets ABERTOS no período, creditado a quem abriu o ticket.
  -- Mesma classificação de dashboard_channel_detail (último follow-up).
  opened AS (
    SELECT DISTINCT ON (ev.service_id)
      ev.service_id,
      ev.user_id,
      (s.status = 'concluido' OR f.status = 'concluido') AS is_done
    FROM events ev
    JOIN public.services s ON s.id = ev.service_id
    LEFT JOIN public.service_follow_ups f ON f.service_id = ev.service_id
    WHERE ev.kind = 'service'
    ORDER BY ev.service_id, f.follow_up_number DESC NULLS LAST
  ),
  done_by_agent AS (
    SELECT user_id, COUNT(*)::int AS done_count
    FROM opened
    WHERE is_done
    GROUP BY user_id
  ),
  -- Média de interações por ticket concluído aberto no período, creditada a
  -- quem abriu o ticket (é o dono da conversa).
  fup_count AS (
    SELECT o.user_id, o.service_id, COUNT(f.id)::int AS cnt
    FROM opened o
    LEFT JOIN public.service_follow_ups f ON f.service_id = o.service_id
    WHERE o.is_done
    GROUP BY o.user_id, o.service_id
  ),
  avg_to_close AS (
    SELECT user_id, ROUND(AVG(cnt), 1) AS avg_cnt
    FROM fup_count
    GROUP BY user_id
  ),
  -- Universo de linhas da tabela: quem registrou atendimento no período (com
  -- qualquer cargo, como dashboard_metrics.by_agent) MAIS os agentes sem
  -- nenhum atendimento — a tela sempre mostrou quem ficou zerado e isso
  -- continua valendo.
  base_agents AS (
    SELECT user_id FROM ev_by_agent
    UNION
    SELECT p.id::text FROM public.profiles p WHERE p.role = 'agent'
  ),
  agent_summary AS (
    SELECT
      b.user_id                                            AS agent_id,
      COALESCE(p.full_name, 'Sem nome')                    AS agent_name,
      COALESCE(ev.new_tickets_count, 0)                    AS new_tickets_count,
      COALESCE(ev.interactions_count, 0)                   AS interactions_count,
      COALESCE(d.done_count, 0)                            AS done_count,
      COALESCE(ev.new_tickets_count, 0)
        + COALESCE(ev.interactions_count, 0)               AS total_tickets,
      COALESCE(a.avg_cnt, 0)                               AS avg_interactions_to_close,
      CASE
        WHEN COALESCE(ev.new_tickets_count, 0) > 0
        THEN ROUND(COALESCE(d.done_count, 0)::numeric / ev.new_tickets_count * 100, 1)
        ELSE 0
      END                                                  AS completion_rate
    FROM base_agents b
    LEFT JOIN ev_by_agent    ev ON ev.user_id = b.user_id
    LEFT JOIN public.profiles p ON p.id::text = b.user_id
    LEFT JOIN done_by_agent   d ON d.user_id  = b.user_id
    LEFT JOIN avg_to_close    a ON a.user_id  = b.user_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'agent_id',                  s.agent_id,
      'agent_name',                s.agent_name,
      'total_tickets',             s.total_tickets,
      'new_tickets_count',         s.new_tickets_count,
      'interactions_count',        s.interactions_count,
      'done_count',                s.done_count,
      'total_interactions',        s.interactions_count,
      'avg_interactions_to_close', s.avg_interactions_to_close,
      'completion_rate',           s.completion_rate
    ) ORDER BY s.agent_name
  ), '[]'::jsonb) INTO v_by_agent
  FROM agent_summary s;

  -- ── KPIs ────────────────────────────────────────────────────────────────
  -- total_services = todos os eventos do período — bate com "Total de
  -- atendimentos" da tela Atendimentos e com o total do modal de canal.
  -- total_interactions é mantido por compatibilidade de contrato e vale o mesmo
  -- que interactions_count: os dois cards leem "follow-ups do período".
  SELECT jsonb_build_object(
    'total_services',     COALESCE(SUM((x->>'total_tickets')::int), 0),
    'new_tickets_count',  COALESCE(SUM((x->>'new_tickets_count')::int), 0),
    'interactions_count', COALESCE(SUM((x->>'interactions_count')::int), 0),
    'done_count',         COALESCE(SUM((x->>'done_count')::int), 0),
    'total_interactions', COALESCE(SUM((x->>'interactions_count')::int), 0)
  ) INTO v_kpi
  FROM jsonb_array_elements(v_by_agent) x;

  -- ── Atividade recente: últimos 80 follow-ups registrados no período ─────
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT
      f.id,
      f.service_id,
      f.follow_up_number,
      f.status,
      f.recorded_at,
      f.observation,
      f.created_at,
      s.client_email,
      s.product,
      s.platform,
      s.channel,
      COALESCE(p.full_name, 'Sem nome') AS agent_name
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    LEFT JOIN public.profiles p ON p.id::text = f.user_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
    ORDER BY f.created_at DESC
    LIMIT 80
  ) t;

  -- ── Insights ────────────────────────────────────────────────────────────
  -- Derivados de v_by_agent, para os três cards baterem exatamente com o
  -- gráfico "Tickets por Agente" e com a tabela abaixo dele.
  WITH ativos AS (
    SELECT
      x->>'agent_id'                     AS agent_id,
      x->>'agent_name'                   AS agent_name,
      (x->>'new_tickets_count')::int     AS new_tickets_count,
      (x->>'interactions_count')::int    AS interactions_count,
      (x->>'done_count')::int            AS done_count,
      (x->>'total_tickets')::int         AS total_tickets,
      (x->>'completion_rate')::numeric   AS completion_rate
    FROM jsonb_array_elements(v_by_agent) x
    WHERE (x->>'total_tickets')::int > 0
  ),
  top_performer AS (
    SELECT agent_id, agent_name, done_count AS done, new_tickets_count AS total, completion_rate AS rate
    FROM ativos
    WHERE new_tickets_count > 0
    ORDER BY completion_rate DESC, done_count DESC
    LIMIT 1
  ),
  most_new_tickets AS (
    SELECT agent_id, agent_name, new_tickets_count AS open_count
    FROM ativos
    ORDER BY new_tickets_count DESC, agent_name ASC
    LIMIT 1
  ),
  most_productive AS (
    SELECT agent_id, agent_name, interactions_count AS interaction_count
    FROM ativos
    ORDER BY interactions_count DESC, agent_name ASC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'top_performer',   (SELECT row_to_json(tp) FROM top_performer tp),
    'most_open',       (SELECT row_to_json(mo) FROM most_new_tickets mo),
    'most_productive', (SELECT row_to_json(mp) FROM most_productive mp)
  ) INTO v_insights;

  RETURN jsonb_build_object(
    'kpi',               COALESCE(v_kpi, '{}'::jsonb),
    'by_agent',          v_by_agent,
    'recent_follow_ups', v_recent,
    'insights',          COALESCE(v_insights, '{}'::jsonb)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
