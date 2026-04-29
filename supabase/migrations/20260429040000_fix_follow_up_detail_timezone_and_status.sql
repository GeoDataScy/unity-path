-- Fix dashboard_follow_up_detail:
-- 1. Use SP timezone for service_date filtering (same as dashboard_metrics/agent_my_metrics).
-- 2. Include services.status = 'concluido' in classification (handles "Registrar e Concluir"
--    which sets status directly without inserting a follow-up).
-- 3. Define "Em Andamento" as: services with at least one follow-up, not yet concluded.
--    Previously last_status = 'em_andamento' was used, which missed services concluded
--    via services.status and double-counted via UTC boundary.
-- 4. total_interactions = follow-up count only (not + service count), matching
--    what agents record as explicit interactions.
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
    'open_count',         COUNT(*) FILTER (WHERE ticket_status = 'open'),
    'in_progress_count',  COUNT(*) FILTER (WHERE ticket_status = 'em_andamento'),
    'done_count',         COUNT(*) FILTER (WHERE ticket_status = 'concluido'),
    'total_interactions', (
      SELECT COUNT(*)
      FROM public.service_follow_ups f2
      WHERE f2.service_id IN (SELECT id FROM filtered_services)
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
      COUNT(DISTINCT c.service_id)::int                                   AS total_tickets,
      COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'open')::int         AS open_count,
      COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'em_andamento')::int AS in_progress_count,
      COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido')::int    AS done_count,
      COALESCE((
        SELECT COUNT(*)::int
        FROM public.service_follow_ups f3
        JOIN filtered_services fs3 ON fs3.id = f3.service_id
        WHERE fs3.user_id = p.id
      ), 0) AS total_interactions,
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
      'total_tickets',           a.total_tickets,
      'open_count',              a.open_count,
      'in_progress_count',       a.in_progress_count,
      'done_count',              a.done_count,
      'total_interactions',      a.total_interactions,
      'avg_interactions_to_close', a.avg_interactions_to_close,
      'completion_rate', CASE
        WHEN a.total_tickets > 0
        THEN ROUND((a.done_count::numeric / a.total_tickets) * 100, 1)
        ELSE 0
      END
    ) ORDER BY a.agent_name
  ), '[]'::jsonb) INTO v_by_agent
  FROM agent_stats a;

  -- ── Recent follow-ups: last 80 recorded within the period's services ─────────
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
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
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
    JOIN filtered_services fs ON fs.id = f.service_id
    LEFT JOIN public.profiles p ON p.id::text = f.user_id
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
