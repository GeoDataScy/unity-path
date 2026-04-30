-- Align dashboard_follow_up_detail semantics with dashboard_metrics so that
-- "Tickets por Agente" totals match "Atendimentos por Agente" exactly.
--
-- dashboard_metrics counts (per agent):
--   Set A: services with service_date IN range
--   Set B: DISTINCT services where the agent recorded a follow-up IN range
--          AND service_date < from_date  (previous-day tickets)
--   Total = COUNT(DISTINCT A ∪ B) = |A| + |B|  (mutually exclusive sets)
--
-- The three stacked-bar segments must be mutually exclusive and sum to Total:
--   Tickets Novos  = services in Set A that are NOT concluded  (open new tickets)
--   Concluído      = services in Set A that ARE concluded
--   Interações     = DISTINCT services in Set B (previous-day tickets touched in range)
--
-- interactions_count was previously counting raw follow-up rows on ALL services,
-- which double-counted same-day services already in Set A and broke agents like
-- Eduarda who record follow-ups on same-day services.

CREATE OR REPLACE FUNCTION public.dashboard_follow_up_detail(
  p_from_date date DEFAULT NULL,
  p_to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- ── KPIs ─────────────────────────────────────────────────────────────────────
  WITH filtered_services AS (
    SELECT s.id, s.user_id, s.status AS svc_status
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  ),
  last_fup AS (
    SELECT DISTINCT ON (fs.id)
      fs.id          AS service_id,
      fs.svc_status,
      f.status       AS fup_status
    FROM filtered_services fs
    LEFT JOIN public.service_follow_ups f ON f.service_id = fs.id
    ORDER BY fs.id, f.follow_up_number DESC NULLS LAST
  ),
  classified AS (
    SELECT
      service_id,
      CASE
        WHEN svc_status = 'concluido' OR fup_status = 'concluido' THEN 'concluido'
        WHEN fup_status IS NOT NULL                                THEN 'em_andamento'
        ELSE 'open'
      END AS ticket_status
    FROM last_fup
  ),
  -- Set B: distinct previous-day services that received a follow-up in range
  -- (mirrors dashboard_metrics logic exactly — requires s.user_id = f.user_id)
  prev_day_interactions AS (
    SELECT COUNT(DISTINCT f.service_id)::bigint AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND s.user_id::text = f.user_id
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date < v_from
  )
  SELECT jsonb_build_object(
    -- total_services = |Set A| + |Set B| = matches Atendimentos por Agente total
    'total_services',     COUNT(*) + (SELECT cnt FROM prev_day_interactions),
    'new_tickets_count',  COUNT(*),
    'interactions_count', (SELECT cnt FROM prev_day_interactions),
    'done_count',         COUNT(*) FILTER (WHERE ticket_status = 'concluido'),
    'total_interactions', (SELECT cnt FROM prev_day_interactions)
  ) INTO v_kpi
  FROM classified;

  -- ── Per-agent breakdown ──────────────────────────────────────────────────────
  WITH filtered_services AS (
    SELECT s.id, s.user_id, s.status AS svc_status
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  ),
  last_fup AS (
    SELECT DISTINCT ON (fs.id)
      fs.id          AS service_id,
      fs.user_id,
      fs.svc_status,
      f.status       AS fup_status
    FROM filtered_services fs
    LEFT JOIN public.service_follow_ups f ON f.service_id = fs.id
    ORDER BY fs.id, f.follow_up_number DESC NULLS LAST
  ),
  classified AS (
    SELECT
      service_id,
      user_id,
      CASE
        WHEN svc_status = 'concluido' OR fup_status = 'concluido' THEN 'concluido'
        WHEN fup_status IS NOT NULL                                THEN 'em_andamento'
        ELSE 'open'
      END AS ticket_status
    FROM last_fup
  ),
  -- Set B per agent: DISTINCT previous-day services with a follow-up in range
  -- Exactly mirrors dashboard_metrics per-agent Set B logic
  agent_interactions AS (
    SELECT
      f.user_id                            AS uid,
      COUNT(DISTINCT f.service_id)::int    AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND s.user_id::text = f.user_id
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date < v_from
    GROUP BY f.user_id
  ),
  avg_to_close AS (
    SELECT
      s2.user_id::text        AS uid,
      ROUND(AVG(sub.cnt), 1) AS avg_cnt
    FROM (
      SELECT f.service_id, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN filtered_services fs ON fs.id = f.service_id
      WHERE EXISTS (
        SELECT 1 FROM classified cc
        WHERE cc.service_id = f.service_id AND cc.ticket_status = 'concluido'
      )
      GROUP BY f.service_id
    ) sub
    JOIN public.services s2 ON s2.id = sub.service_id
    GROUP BY s2.user_id
  ),
  -- One row per agent — no nested aggregates
  agent_summary AS (
    SELECT
      p.id::text                                                                AS agent_id,
      COALESCE(p.full_name, 'Sem nome')                                        AS agent_name,
      -- Set A: all services in range owned by agent
      COUNT(DISTINCT c.service_id)::int                                        AS new_tickets_count,
      -- Subset of Set A that is concluded
      COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido')::int AS done_count,
      -- Set B: distinct previous-day services with follow-up in range
      COALESCE(ai.cnt, 0)                                                      AS interactions_count,
      COALESCE(atc.avg_cnt, 0)                                                 AS avg_interactions_to_close,
      CASE
        WHEN COUNT(DISTINCT c.service_id) > 0
        THEN ROUND(
          COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido')::numeric
          / COUNT(DISTINCT c.service_id) * 100, 1)
        ELSE 0
      END                                                                       AS completion_rate
    FROM public.profiles p
    LEFT JOIN classified       c   ON c.user_id::text  = p.id::text
    LEFT JOIN agent_interactions ai ON ai.uid           = p.id::text
    LEFT JOIN avg_to_close     atc ON atc.uid           = p.id::text
    WHERE p.role = 'agent'
    GROUP BY p.id, p.full_name, ai.cnt, atc.avg_cnt
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'agent_id',                  a.agent_id,
      'agent_name',                a.agent_name,
      -- total_tickets = |Set A| + |Set B| = matches Atendimentos por Agente per-agent value
      'total_tickets',             a.new_tickets_count + a.interactions_count,
      'new_tickets_count',         a.new_tickets_count,
      'interactions_count',        a.interactions_count,
      'done_count',                a.done_count,
      'total_interactions',        a.interactions_count,
      'avg_interactions_to_close', a.avg_interactions_to_close,
      'completion_rate',           a.completion_rate
    ) ORDER BY a.agent_name
  ), '[]'::jsonb) INTO v_by_agent
  FROM agent_summary a;

  -- ── Recent follow-ups: last 80 recorded within the period ────────────────────
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

  -- ── Insights ──────────────────────────────────────────────────────────────────
  WITH filtered_services AS (
    SELECT s.id, s.user_id, s.status AS svc_status
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  ),
  last_fup AS (
    SELECT DISTINCT ON (fs.id)
      fs.id       AS service_id,
      fs.user_id,
      fs.svc_status,
      f.status    AS fup_status
    FROM filtered_services fs
    LEFT JOIN public.service_follow_ups f ON f.service_id = fs.id
    ORDER BY fs.id, f.follow_up_number DESC NULLS LAST
  ),
  classified AS (
    SELECT
      service_id,
      user_id,
      CASE
        WHEN svc_status = 'concluido' OR fup_status = 'concluido' THEN 'concluido'
        WHEN fup_status IS NOT NULL                                THEN 'em_andamento'
        ELSE 'open'
      END AS ticket_status
    FROM last_fup
  ),
  agent_done AS (
    SELECT
      p.id::text  AS agent_id,
      COALESCE(p.full_name, 'Sem nome') AS agent_name,
      COUNT(DISTINCT c.service_id)                                            AS total,
      COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido') AS done
    FROM public.profiles p
    JOIN classified c ON c.user_id::text = p.id::text
    WHERE p.role = 'agent'
    GROUP BY p.id, p.full_name
    HAVING COUNT(DISTINCT c.service_id) > 0
  ),
  top_performer AS (
    SELECT agent_id, agent_name, done, total,
           ROUND((done::numeric / total) * 100, 1) AS rate
    FROM agent_done
    ORDER BY rate DESC, done DESC
    LIMIT 1
  ),
  most_open AS (
    SELECT
      p.id::text  AS agent_id,
      COALESCE(p.full_name, 'Sem nome') AS agent_name,
      COUNT(DISTINCT c.service_id) AS open_count
    FROM public.profiles p
    JOIN classified c ON c.user_id::text = p.id::text
    WHERE p.role = 'agent'
      AND c.ticket_status = 'open'
    GROUP BY p.id, p.full_name
    ORDER BY open_count DESC
    LIMIT 1
  ),
  most_productive AS (
    SELECT
      p.id::text  AS agent_id,
      COALESCE(p.full_name, 'Sem nome') AS agent_name,
      COUNT(*) AS interaction_count
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    LEFT JOIN public.profiles p ON p.id::text = f.user_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND s.user_id::text = f.user_id
    GROUP BY p.id, p.full_name
    ORDER BY interaction_count DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'top_performer', (SELECT row_to_json(tp) FROM top_performer tp),
    'most_open',     (SELECT row_to_json(mo) FROM most_open mo),
    'most_productive',(SELECT row_to_json(mp) FROM most_productive mp)
  ) INTO v_insights;

  RETURN jsonb_build_object(
    'kpi',              COALESCE(v_kpi, '{}'::jsonb),
    'by_agent',         v_by_agent,
    'recent_follow_ups',v_recent,
    'insights',         COALESCE(v_insights, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_follow_up_detail(date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
