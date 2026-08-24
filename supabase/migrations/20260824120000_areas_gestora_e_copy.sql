-- Duas áreas por perfil: gestora e copy podem circular entre "Data Analytics do
-- Suporte" (/dashboard) e "Área de Copy" (/copy). O front pergunta a área no
-- login (tela /areas); aqui abrimos no banco o lado que faltava.
--
-- O que muda de acesso:
--
--   * O time de copy passa a LER os agregados das quatro telas de analytics
--     (Atendimentos, Reembolsos, Acompanhamento, Interações). Só leitura.
--   * A gestora não perde nada: o guard novo é `is_manager() OR is_copy_team()`.
--   * NADA de gestão foi aberto. Continuam guardadas por is_manager() puro:
--     manager_complete_refund, manager_refund_alerts, manager_set_user_active,
--     manager_delete_auth_user, manager_reassign_tickets,
--     manager_set_agent_availability, os RPCs de held_orders, o export de
--     relatório (dashboard_export_extras / export_agent_services /
--     dashboard_status_summary) e a escrita na Base de Suporte.
--     O front também esconde essas rotas de quem não é gestora.
--
-- Por que trocar o guard dentro de cada RPC em vez de mexer em is_manager():
-- is_manager() é usada em ~157 pontos, muitos deles de ESCRITA. Alargá-la daria
-- ao copy o poder de desativar usuário e dar baixa em reembolso. Então o que
-- muda é só o guard das funções de leitura, uma por uma.
--
-- ATENÇÃO para quem for editar essas funções depois: o corpo abaixo é cópia
-- fiel do que estava em produção, com uma única substituição — a linha do
-- guard. Ao regravar uma delas, mantenha `can_view_support_analytics()`, senão
-- o copy perde a tela sem ninguém perceber.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard de leitura das telas de analytics
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_support_analytics()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_manager() OR public.is_copy_team();
$$;

REVOKE ALL ON FUNCTION public.can_view_support_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_support_analytics() TO authenticated;

-- can_read_refund_analytics (telas do copy) já era exatamente esta regra;
-- passa a delegar para não existirem duas definições da mesma coisa.
CREATE OR REPLACE FUNCTION public.can_read_refund_analytics()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_support_analytics();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs de leitura das telas de analytics (corpo idêntico ao de produção)
-- ─────────────────────────────────────────────────────────────────────────────
-- dashboard_audit: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_audit(from_date date, to_date date, agent_id text DEFAULT NULL::text, page_size integer DEFAULT 25, page_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_rows  jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF page_size  IS NULL OR page_size  < 1 THEN page_size  := 25;  END IF;
  IF page_size  > 200                      THEN page_size  := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.services s
  WHERE s.service_date::timestamptz >= from_date::timestamptz
    AND s.service_date::timestamptz  < (to_date::timestamptz + interval '1 day')
    AND (agent_id IS NULL OR s.user_id = agent_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      s.id, s.created_at, s.service_date, s.client_email,
      s.product, s.platform, s.channel, s.status, s.user_id,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.services s
    LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz  < (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    ORDER BY s.service_date::timestamptz DESC
    LIMIT page_size OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$function$;

-- dashboard_channel_detail: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_channel_detail(p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_agent_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from   date;
  v_to     date;
  v_agent  text;
  v_result jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
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
$function$;

-- dashboard_follow_up_detail: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_follow_up_detail(p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
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
  IF NOT public.can_view_support_analytics() THEN
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

-- dashboard_hourly_pattern: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_hourly_pattern(from_date date, to_date date, agent_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total            int     := 0;
  v_active_days      int     := 0;
  v_by_dow_hour      jsonb;
  v_peak_hour        int;
  v_peak_count       int;
  v_peak_dow         int;
  v_peak_dow_name    text;
  v_start_hour       numeric;
  v_end_hour         numeric;
  v_share_morning    numeric := 0;
  v_share_afternoon  numeric := 0;
  v_share_evening    numeric := 0;
  v_share_night      numeric := 0;
  v_goal_hour        numeric;
  v_goal_days_hit    int     := 0;
  v_goal_total_days  int     := 0;
  v_goal_threshold   int     := 100; -- representative; per-agent below
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- ── All activity in the range, in São Paulo time ─────────────────────────
  WITH all_activity AS (
    SELECT
      s.user_id::text AS uid,
      s.id            AS service_id,
      (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo') AS ts_sp
    FROM public.services s
    WHERE (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)

    UNION ALL

    SELECT
      f.user_id,
      f.service_id,
      (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND s.user_id::text = f.user_id
  ),
  bucketed AS (
    SELECT
      EXTRACT(DOW  FROM ts_sp)::int AS dow,
      EXTRACT(HOUR FROM ts_sp)::int AS hour
    FROM all_activity
  ),
  agg AS (
    SELECT dow, hour, COUNT(*)::int AS cnt
    FROM bucketed
    GROUP BY dow, hour
  ),
  ds AS (
    SELECT d AS dow, h AS hour
    FROM generate_series(0, 6) d
    CROSS JOIN generate_series(0, 23) h
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('dow', ds.dow, 'hour', ds.hour, 'count', COALESCE(agg.cnt, 0)) ORDER BY ds.dow, ds.hour), '[]'::jsonb)
  INTO v_by_dow_hour
  FROM ds
  LEFT JOIN agg ON agg.dow = ds.dow AND agg.hour = ds.hour;

  -- Total activity count and number of distinct active days
  WITH all_activity AS (
    SELECT (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS d
    FROM public.services s
    WHERE (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    UNION ALL
    SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND s.user_id::text = f.user_id
  )
  SELECT COUNT(*)::int, COUNT(DISTINCT d)::int
  INTO v_total, v_active_days
  FROM all_activity;

  -- ── Peak hour / DOW ──────────────────────────────────────────────────────
  SELECT (h->>'dow')::int, (h->>'hour')::int, (h->>'count')::int
  INTO v_peak_dow, v_peak_hour, v_peak_count
  FROM jsonb_array_elements(v_by_dow_hour) h
  ORDER BY (h->>'count')::int DESC, (h->>'dow')::int ASC, (h->>'hour')::int ASC
  LIMIT 1;

  IF v_peak_dow IS NOT NULL THEN
    v_peak_dow_name := CASE v_peak_dow
      WHEN 0 THEN 'Domingo' WHEN 1 THEN 'Segunda-feira' WHEN 2 THEN 'Terça-feira'
      WHEN 3 THEN 'Quarta-feira' WHEN 4 THEN 'Quinta-feira' WHEN 5 THEN 'Sexta-feira'
      WHEN 6 THEN 'Sábado' ELSE '—'
    END;
  END IF;

  -- ── Median first / last activity hour-of-day per day ─────────────────────
  WITH per_day_extremes AS (
    SELECT
      d,
      EXTRACT(EPOCH FROM (MIN(ts_sp) - date_trunc('day', MIN(ts_sp)))) / 3600.0 AS first_hour,
      EXTRACT(EPOCH FROM (MAX(ts_sp) - date_trunc('day', MAX(ts_sp)))) / 3600.0 AS last_hour
    FROM (
      SELECT
        (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo') AS ts_sp,
        (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS d
      FROM public.services s
      WHERE (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      UNION ALL
      SELECT
        (f.recorded_at AT TIME ZONE 'America/Sao_Paulo'),
        (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND s.user_id::text = f.user_id
    ) act
    GROUP BY d
  )
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY first_hour),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY last_hour)
  INTO v_start_hour, v_end_hour
  FROM per_day_extremes;

  -- ── Shift share (% of activities by time bucket) ─────────────────────────
  IF v_total > 0 THEN
    WITH all_activity AS (
      SELECT EXTRACT(HOUR FROM (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo'))::int AS h
      FROM public.services s
      WHERE (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      UNION ALL
      SELECT EXTRACT(HOUR FROM (f.recorded_at AT TIME ZONE 'America/Sao_Paulo'))::int
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND s.user_id::text = f.user_id
    )
    SELECT
      ROUND(SUM(CASE WHEN h >= 5  AND h < 12 THEN 1 ELSE 0 END)::numeric / v_total, 4),
      ROUND(SUM(CASE WHEN h >= 12 AND h < 18 THEN 1 ELSE 0 END)::numeric / v_total, 4),
      ROUND(SUM(CASE WHEN h >= 18 AND h < 22 THEN 1 ELSE 0 END)::numeric / v_total, 4),
      ROUND(SUM(CASE WHEN h >= 22 OR  h < 5  THEN 1 ELSE 0 END)::numeric / v_total, 4)
    INTO v_share_morning, v_share_afternoon, v_share_evening, v_share_night
    FROM all_activity;
  END IF;

  -- ── Goal hit: median hour at which an agent's daily DISTINCT count
  --    crosses their goal (150 if SMS-majority that period, else 100).
  --    For "todos", we compute per-agent and take the cross-agent median.
  WITH per_agent_channel AS (
    -- Determine each agent's "majority channel" within the range — proxy for
    -- daily goal threshold. Looks at services in range only.
    SELECT
      s.user_id::text AS uid,
      CASE
        WHEN COUNT(*) FILTER (WHERE s.channel = 'SMS') >
             COUNT(*) FILTER (WHERE s.channel IS DISTINCT FROM 'SMS')
        THEN 150 ELSE 100
      END AS goal
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY s.user_id
  ),
  ordered_activity AS (
    SELECT
      uid,
      d,
      ts_sp,
      service_id,
      ROW_NUMBER() OVER (PARTITION BY uid, d, service_id ORDER BY ts_sp ASC) AS rn_per_ticket
    FROM (
      SELECT s.user_id::text AS uid, s.id AS service_id,
             (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo') AS ts_sp,
             (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS d
      FROM public.services s
      WHERE (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      UNION ALL
      SELECT f.user_id, f.service_id,
             (f.recorded_at AT TIME ZONE 'America/Sao_Paulo'),
             (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND s.user_id::text = f.user_id
    ) raw
  ),
  -- Keep only the FIRST occurrence per (agent, day, ticket) — that's when the
  -- ticket "started counting" toward the daily goal (DISTINCT semantics).
  first_touch AS (
    SELECT uid, d, service_id, ts_sp
    FROM ordered_activity
    WHERE rn_per_ticket = 1
  ),
  ranked AS (
    SELECT
      uid,
      d,
      ts_sp,
      ROW_NUMBER() OVER (PARTITION BY uid, d ORDER BY ts_sp ASC) AS distinct_idx
    FROM first_touch
  ),
  with_goal AS (
    SELECT r.*, COALESCE(g.goal, 100) AS goal
    FROM ranked r
    LEFT JOIN per_agent_channel g ON g.uid = r.uid
  ),
  -- For each (agent, day): the row whose distinct_idx == goal is the moment
  -- the goal was hit. If no such row exists, the goal wasn't hit that day.
  goal_hits AS (
    SELECT
      uid, d,
      MIN(ts_sp) FILTER (WHERE distinct_idx = goal) AS hit_ts
    FROM with_goal
    GROUP BY uid, d
  ),
  hit_hours AS (
    SELECT
      EXTRACT(EPOCH FROM (hit_ts - date_trunc('day', hit_ts))) / 3600.0 AS hit_hour
    FROM goal_hits
    WHERE hit_ts IS NOT NULL
  )
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hit_hour),
    COUNT(*)::int
  INTO v_goal_hour, v_goal_days_hit
  FROM hit_hours;

  -- Total possible (agent, day) pairs that had ANY activity — denominator
  WITH active_pairs AS (
    SELECT DISTINCT s.user_id::text AS uid,
           (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS d
    FROM public.services s
    WHERE (s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    UNION
    SELECT DISTINCT f.user_id,
           (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND s.user_id::text = f.user_id
  )
  SELECT COUNT(*)::int INTO v_goal_total_days FROM active_pairs;

  -- For the "single agent" filter, surface the agent's own goal threshold;
  -- for "all", surface the most common goal among agents in the period.
  IF agent_id IS NOT NULL THEN
    SELECT COALESCE(goal, 100) INTO v_goal_threshold
    FROM (
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE s.channel = 'SMS') >
               COUNT(*) FILTER (WHERE s.channel IS DISTINCT FROM 'SMS')
          THEN 150 ELSE 100
        END AS goal
      FROM public.services s
      WHERE s.user_id::text = agent_id
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
    ) t;
  ELSE
    SELECT COALESCE((
      SELECT goal FROM (
        SELECT
          CASE
            WHEN COUNT(*) FILTER (WHERE s.channel = 'SMS') >
                 COUNT(*) FILTER (WHERE s.channel IS DISTINCT FROM 'SMS')
            THEN 150 ELSE 100
          END AS goal,
          COUNT(*) AS c
        FROM public.services s
        WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              BETWEEN from_date AND to_date
        GROUP BY s.user_id
      ) g
      GROUP BY goal
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ), 100) INTO v_goal_threshold;
  END IF;

  RETURN jsonb_build_object(
    'by_dow_hour',     v_by_dow_hour,
    'total',           COALESCE(v_total, 0),
    'active_days',     COALESCE(v_active_days, 0),
    'peak', jsonb_build_object(
      'hour',     v_peak_hour,
      'count',    COALESCE(v_peak_count, 0),
      'dow',      v_peak_dow,
      'dow_name', v_peak_dow_name
    ),
    'shift', jsonb_build_object(
      'start_hour', v_start_hour,
      'end_hour',   v_end_hour
    ),
    'shifts_share', jsonb_build_object(
      'morning',   COALESCE(v_share_morning,   0),
      'afternoon', COALESCE(v_share_afternoon, 0),
      'evening',   COALESCE(v_share_evening,   0),
      'night',     COALESCE(v_share_night,     0)
    ),
    'goal_hit', jsonb_build_object(
      'hour',             v_goal_hour,
      'days_hit',         COALESCE(v_goal_days_hit, 0),
      'total_active_days', COALESCE(v_goal_total_days, 0),
      'threshold',        v_goal_threshold
    )
  );
END;
$function$;

-- dashboard_metrics: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_metrics(from_date date, to_date date, agent_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total       bigint;
  v_by_agent    jsonb;
  v_by_product  jsonb;
  v_by_day      jsonb;
  v_by_platform jsonb;
  v_by_channel  jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*)::bigint INTO v_total
  FROM public._interaction_events(from_date, to_date, agent_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_agent
  FROM (
    SELECT
      e.user_id,
      COALESCE(MAX(p.full_name), 'Sem nome') AS name,
      COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    LEFT JOIN public.profiles p ON p.id::text = e.user_id
    GROUP BY e.user_id
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT COALESCE(e.product, 'Não informado') AS name,
           COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT 10
  ) t;

  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  per_day AS (
    SELECT day, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id)
    GROUP BY day
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT to_char(ds.day, 'YYYY-MM-DD') AS day,
           COALESCE(per_day.value, 0)    AS value
    FROM ds
    LEFT JOIN per_day ON per_day.day = ds.day
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(e.platform, 'Não informado') AS name,
           COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT COALESCE(e.channel, 'Não informado') AS name,
           COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'total_count',  COALESCE(v_total, 0),
    'by_agent',     v_by_agent,
    'by_product',   v_by_product,
    'by_day',       v_by_day,
    'by_platform',  v_by_platform,
    'by_channel',   v_by_channel
  );
END;
$function$;

-- dashboard_refund_audit: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_refund_audit(from_date date, to_date date, agent_id text DEFAULT NULL::text, status_filter text DEFAULT NULL::text, refund_type_filter text DEFAULT NULL::text, product_filter text DEFAULT NULL::text, page_size integer DEFAULT 25, page_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      v_uid text;
      v_total bigint;
      v_rows jsonb;
    BEGIN
      IF NOT public.can_view_support_analytics() THEN
        RAISE EXCEPTION 'forbidden';
      END IF;

      IF agent_id IS NOT NULL AND agent_id != '' THEN
        v_uid := agent_id;
      END IF;

      IF page_size IS NULL OR page_size < 1 THEN page_size := 25; END IF;
      IF page_size > 200 THEN page_size := 200; END IF;
      IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

      SELECT COUNT(*) INTO v_total
      FROM public.refunds r
      WHERE r.request_date::date >= from_date AND r.request_date::date <= to_date
        AND (v_uid IS NULL OR r.user_id = v_uid)
        AND (status_filter IS NULL OR status_filter = 'all'
          OR (status_filter = 'open' AND r.completion_date IS NULL)
          OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
        AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
          OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
          OR r.refund_type = refund_type_filter)
        AND (product_filter IS NULL OR product_filter = 'all'
          OR (product_filter = 'null' AND r.product IS NULL)
          OR r.product = product_filter);

      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT r.id, r.created_at, r.user_id, r.customer_email, r.request_date,
          r.completion_date, r.sales_platform, r.order_id, r.refund_type,
          r.reason, r.items_returned, r.product, r.channel,
          jsonb_build_object('full_name', p.full_name) AS profiles
        FROM public.refunds r LEFT JOIN public.profiles p ON p.id = r.user_id
        WHERE r.request_date::date >= from_date AND r.request_date::date <= to_date
          AND (v_uid IS NULL OR r.user_id = v_uid)
          AND (status_filter IS NULL OR status_filter = 'all'
            OR (status_filter = 'open' AND r.completion_date IS NULL)
            OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
          AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
            OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
            OR r.refund_type = refund_type_filter)
          AND (product_filter IS NULL OR product_filter = 'all'
            OR (product_filter = 'null' AND r.product IS NULL)
            OR r.product = product_filter)
        ORDER BY r.request_date DESC, r.created_at DESC
        LIMIT page_size OFFSET page_offset
      ) t;

      RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
    END;
    $function$;

-- dashboard_refund_metrics: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_refund_metrics(from_date date, to_date date, agent_id text DEFAULT NULL::text, status_filter text DEFAULT NULL::text, refund_type_filter text DEFAULT NULL::text, product_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_open bigint;
  v_done bigint;
  v_by_agent jsonb;
  v_by_status jsonb;
  v_by_refund_type jsonb;
  v_by_product jsonb;
  v_by_channel jsonb;
  v_by_channel_efficiency jsonb;
  v_by_platform jsonb;
  v_by_reason jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    COUNT(*)::bigint,
    SUM(CASE WHEN r.completion_date IS NULL     THEN 1 ELSE 0 END)::bigint,
    SUM(CASE WHEN r.completion_date IS NOT NULL THEN 1 ELSE 0 END)::bigint
  INTO v_total, v_open, v_done
  FROM public.refunds r
  WHERE (
    (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
    OR
    (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
  )
    AND (agent_id IS NULL OR r.user_id::text = agent_id)
    AND (status_filter IS NULL OR status_filter = 'all'
      OR (status_filter = 'open' AND r.completion_date IS NULL)
      OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
    AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
      OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
      OR r.refund_type = refund_type_filter)
    AND (product_filter IS NULL OR product_filter = 'all'
      OR (product_filter = 'null' AND r.product IS NULL)
      OR r.product = product_filter);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.full_name, 'Sem nome') AS name,
      COUNT(*)::int AS value,
      r.user_id
    FROM public.refunds r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY r.user_id, p.full_name
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC), '[]'::jsonb)
    INTO v_by_status
  FROM (
    SELECT
      CASE WHEN r.completion_date IS NULL THEN 'Em aberto' ELSE 'Concluído' END AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_refund_type
  FROM (
    SELECT
      COALESCE(r.refund_type, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all' OR status_filter = 'done')
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.refund_type, 'Não informado')
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_product
  FROM (
    SELECT
      COALESCE(r.product, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.product, 'Não informado')
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_channel
  FROM (
    SELECT
      COALESCE(r.channel, 'Não informado') AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.channel, 'Não informado')
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_platform
  FROM (
    SELECT
      r.sales_platform AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY r.sales_platform
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_reason
  FROM (
    SELECT
      c.category AS name,
      COUNT(*)::int AS value
    FROM public.refunds r
    JOIN public.refund_reason_classifications c ON c.refund_id = r.id
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY c.category
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.efficiency_score DESC, t.channel ASC), '[]'::jsonb)
    INTO v_by_channel_efficiency
  FROM (
    SELECT
      COALESCE(r.channel, 'Não informado') AS channel,
      COUNT(*)::int AS total_done,
      COUNT(*) FILTER (WHERE r.refund_type IS NOT NULL AND r.refund_type != '100%')::int AS partial_count,
      COUNT(*) FILTER (WHERE r.refund_type = '100%')::int AS full_count,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE r.refund_type IS NOT NULL AND r.refund_type != '100%')::numeric / COUNT(*)) * 100, 1)
        ELSE 0
      END AS efficiency_score
    FROM public.refunds r
    WHERE r.completion_date IS NOT NULL
      AND r.completion_date::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    GROUP BY COALESCE(r.channel, 'Não informado')
  ) t;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total, 0),
    'open_count',  COALESCE(v_open, 0),
    'done_count',  COALESCE(v_done, 0),
    'by_agent',              v_by_agent,
    'by_status',             v_by_status,
    'by_refund_type',        v_by_refund_type,
    'by_product',            v_by_product,
    'by_channel',            v_by_channel,
    'by_platform',           v_by_platform,
    'by_reason',             v_by_reason,
    'by_channel_efficiency', v_by_channel_efficiency
  );
END;
$function$;

-- dashboard_refund_reason_detail: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_refund_reason_detail(from_date date, to_date date, reason_category text, agent_id text DEFAULT NULL::text, status_filter text DEFAULT NULL::text, refund_type_filter text DEFAULT NULL::text, product_filter text DEFAULT NULL::text, page_size integer DEFAULT 50, page_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF page_size IS NULL OR page_size < 1 THEN page_size := 50; END IF;
  IF page_size > 200 THEN page_size := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

  SELECT COUNT(*)
    INTO v_total
  FROM public.refunds r
  JOIN public.refund_reason_classifications c
    ON c.refund_id = r.id AND c.category = reason_category
  WHERE (
    (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
    OR
    (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
  )
    AND (agent_id IS NULL OR r.user_id::text = agent_id)
    AND (status_filter IS NULL OR status_filter = 'all'
      OR (status_filter = 'open' AND r.completion_date IS NULL)
      OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
    AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
      OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
      OR r.refund_type = refund_type_filter)
    AND (product_filter IS NULL OR product_filter = 'all'
      OR (product_filter = 'null' AND r.product IS NULL)
      OR r.product = product_filter);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id, r.created_at, r.user_id, r.customer_email, r.request_date,
      r.completion_date, r.sales_platform, r.order_id, r.refund_type,
      r.refund_value, r.reason, r.items_returned, r.product, r.channel,
      c.original_reason,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.refunds r
    JOIN public.refund_reason_classifications c
      ON c.refund_id = r.id AND c.category = reason_category
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE (
      (r.completion_date IS NULL     AND r.request_date::date    BETWEEN from_date AND to_date)
      OR
      (r.completion_date IS NOT NULL AND r.completion_date::date BETWEEN from_date AND to_date)
    )
      AND (agent_id IS NULL OR r.user_id::text = agent_id)
      AND (status_filter IS NULL OR status_filter = 'all'
        OR (status_filter = 'open' AND r.completion_date IS NULL)
        OR (status_filter = 'done' AND r.completion_date IS NOT NULL))
      AND (refund_type_filter IS NULL OR refund_type_filter = 'all'
        OR (refund_type_filter = 'null' AND r.refund_type IS NULL)
        OR r.refund_type = refund_type_filter)
      AND (product_filter IS NULL OR product_filter = 'all'
        OR (product_filter = 'null' AND r.product IS NULL)
        OR r.product = product_filter)
    ORDER BY r.request_date DESC, r.created_at DESC
    LIMIT page_size
    OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$function$;

-- dashboard_same_day_repeats: mesma definição de produção, só o guard mudou.
CREATE OR REPLACE FUNCTION public.dashboard_same_day_repeats(from_date date, to_date date, agent_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_violations int := 0;
  v_same_day   int := 0;
  v_by_agent   jsonb;
  v_detail     jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*)::int INTO v_violations
  FROM public.service_follow_ups f
  WHERE f.is_same_day_repeat
    AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    AND (agent_id IS NULL OR f.user_id = agent_id);

  SELECT COALESCE(sum(n - 1), 0)::int INTO v_same_day
  FROM (
    SELECT count(*) AS n
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND NOT COALESCE(s.has_tracking_code, false)
      AND (agent_id IS NULL OR f.user_id = agent_id)
    GROUP BY f.service_id, (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
    HAVING count(*) > 1
  ) t;

  WITH repeats AS (
    SELECT f.user_id, count(*)::int AS n
    FROM public.service_follow_ups f
    WHERE f.is_same_day_repeat
      AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
    GROUP BY f.user_id
  ),
  totais AS (
    SELECT e.user_id, count(*)::int AS total
    FROM public._interaction_events(from_date, to_date, agent_id) e
    GROUP BY e.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_id',     r.user_id,
           'agent_name',   COALESCE(p.full_name, 'Sem nome'),
           'repeat_count', r.n,
           'total_count',  COALESCE(t.total, 0),
           'pct',          CASE WHEN COALESCE(t.total,0) > 0
                                THEN ROUND(100.0 * r.n / t.total, 1) ELSE 0 END
         ) ORDER BY r.n DESC, COALESCE(p.full_name,'')), '[]'::jsonb)
    INTO v_by_agent
  FROM repeats r
  LEFT JOIN totais t   ON t.user_id = r.user_id
  LEFT JOIN public.profiles p ON p.id = r.user_id;

  WITH marcados AS (
    SELECT f.id, f.service_id, f.user_id, f.recorded_at, f.observation,
           lag(f.recorded_at) OVER (PARTITION BY f.service_id
                                    ORDER BY f.recorded_at, f.id) AS anterior_at,
           f.is_same_day_repeat
    FROM public.service_follow_ups f
    WHERE f.service_id IN (
      SELECT service_id FROM public.service_follow_ups
      WHERE is_same_day_repeat
        AND (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR user_id = agent_id)
    )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'service_id',   m.service_id,
           'client_email', s.client_email,
           'product',      s.product,
           'agent_name',   COALESCE(p.full_name, 'Sem nome'),
           'recorded_at',  m.recorded_at,
           'previous_at',  m.anterior_at,
           'hours_apart',  ROUND((EXTRACT(epoch FROM m.recorded_at - m.anterior_at)/3600)::numeric, 1),
           'observation',  NULLIF(m.observation, '')
         ) ORDER BY m.recorded_at DESC), '[]'::jsonb)
    INTO v_detail
  FROM marcados m
  JOIN public.services s ON s.id = m.service_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.is_same_day_repeat
    AND (m.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    AND (agent_id IS NULL OR m.user_id = agent_id);

  RETURN jsonb_build_object(
    'same_day_extra',  v_same_day,
    'rule_violations', v_violations,
    'by_agent',        v_by_agent,
    'detail',          v_detail
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: o que as telas de analytics leem direto da tabela
-- ─────────────────────────────────────────────────────────────────────────────

-- O filtro "Agente" da sidebar lê profiles direto (useAgentsQuery). Sem policy,
-- o combo apareceria vazio para o copy.
DROP POLICY IF EXISTS "Copy team can view all profiles" ON public.profiles;
CREATE POLICY "Copy team can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_copy_team()));

-- Acompanhamento deriva o canal de cada agente lendo services (useAgentChannelsQuery).
DROP POLICY IF EXISTS "Copy team can view all services" ON public.services;
CREATE POLICY "Copy team can view all services"
  ON public.services
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_copy_team()));
