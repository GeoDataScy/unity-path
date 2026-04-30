-- Redefine dashboard_follow_up_detail per-agent breakdown:
--
-- Old semantics (status-based):
--   open_count        = services with NO follow-up in range
--   in_progress_count = services with follow-up but not concluded in range
--   done_count        = services concluded in range
--
-- New semantics (activity-based, matching user's "Tickets por Agente" request):
--   new_tickets_count  = COUNT of services with service_date in range (all, regardless of status)
--   interactions_count = COUNT of follow-up entries recorded in range for the agent's services
--                        (includes follow-ups on services opened BEFORE the range)
--   done_count         = stays: services with service_date in range that are concluded
--
-- This lets the chart show: Tickets Novos + Interações = total activities
-- e.g. Aguida 28/04: 70 new tickets + 30 interactions (19 on same-day + 11 on previous-day) = 100

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
  )
  SELECT jsonb_build_object(
    'total_services',     COUNT(*),
    'new_tickets_count',  COUNT(*),
    'interactions_count', (
      SELECT COUNT(*)
      FROM public.service_follow_ups f2
      JOIN public.services s2 ON s2.id = f2.service_id
      WHERE (f2.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
    ),
    'done_count',         COUNT(*) FILTER (WHERE ticket_status = 'concluido'),
    'total_interactions', (
      SELECT COUNT(*)
      FROM public.service_follow_ups f2
      JOIN public.services s2 ON s2.id = f2.service_id
      WHERE (f2.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
    )
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
  agent_stats AS (
    SELECT
      p.id::text                                                           AS agent_id,
      COALESCE(p.full_name, 'Sem nome')                                   AS agent_name,
      -- new_tickets_count: all services opened in range by this agent
      COUNT(DISTINCT c.service_id)::int                                   AS new_tickets_count,
      -- done_count: concluded services (opened in range)
      COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido')::int AS done_count,
      -- interactions_count: raw follow-up entries recorded in range for agent's services
      -- (includes services opened BEFORE the range)
      COALESCE((
        SELECT COUNT(*)::int
        FROM public.service_follow_ups f3
        JOIN public.services s3 ON s3.id = f3.service_id
        WHERE (f3.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
          AND s3.user_id = p.id
          AND f3.user_id = p.id::text
      ), 0) AS interactions_count,
      COALESCE((
        SELECT ROUND(AVG(sub.cnt), 1)
        FROM (
          SELECT COUNT(*) AS cnt
          FROM public.service_follow_ups f4
          JOIN filtered_services fs4 ON fs4.id = f4.service_id
          WHERE fs4.user_id = p.id
            AND EXISTS (
              SELECT 1 FROM classified cc
              WHERE cc.service_id = f4.service_id AND cc.ticket_status = 'concluido'
            )
          GROUP BY f4.service_id
        ) sub
      ), 0) AS avg_interactions_to_close
    FROM public.profiles p
    LEFT JOIN classified c ON c.user_id::text = p.id::text
    WHERE p.role = 'agent'
    GROUP BY p.id, p.full_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'agent_id',                a.agent_id,
      'agent_name',              a.agent_name,
      'total_tickets',           a.new_tickets_count,
      'new_tickets_count',       a.new_tickets_count,
      'interactions_count',      a.interactions_count,
      'done_count',              a.done_count,
      'total_interactions',      a.interactions_count,
      'avg_interactions_to_close', a.avg_interactions_to_close,
      'completion_rate', CASE
        WHEN a.new_tickets_count > 0
        THEN ROUND((a.done_count::numeric / a.new_tickets_count) * 100, 1)
        ELSE 0
      END
    ) ORDER BY a.agent_name
  ), '[]'::jsonb) INTO v_by_agent
  FROM agent_stats a;

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
      AND s.user_id = p.id
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
