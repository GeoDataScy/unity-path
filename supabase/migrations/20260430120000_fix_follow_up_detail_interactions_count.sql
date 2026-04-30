-- Fix interactions_count calculation in dashboard_follow_up_detail.
-- The correlated subquery in 110000 was unreliable for some agents.
-- Replace with a pre-aggregated CTE (agent_interactions) that is simpler
-- and avoids any correlated subquery type issues.

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
  all_interactions AS (
    SELECT COUNT(*)::bigint AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
  )
  SELECT jsonb_build_object(
    'total_services',     COUNT(*),
    'new_tickets_count',  COUNT(*),
    'interactions_count', (SELECT cnt FROM all_interactions),
    'done_count',         COUNT(*) FILTER (WHERE ticket_status = 'concluido'),
    'total_interactions', (SELECT cnt FROM all_interactions)
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
  -- Pre-aggregate interactions per agent in range
  -- Includes follow-ups on services opened BEFORE the range (previous-day tickets)
  agent_interactions AS (
    SELECT
      f.user_id                 AS uid,
      COUNT(*)::int             AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_from AND v_to
      AND s.user_id::text = f.user_id
    GROUP BY f.user_id
  ),
  -- Pre-aggregate avg interactions to close per agent
  avg_to_close AS (
    SELECT
      s.user_id::text AS uid,
      ROUND(AVG(sub.cnt), 1) AS avg_cnt
    FROM (
      SELECT f.service_id, s2.user_id, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN filtered_services fs ON fs.id = f.service_id
      JOIN public.services s2 ON s2.id = f.service_id
      WHERE EXISTS (
        SELECT 1 FROM classified cc
        WHERE cc.service_id = f.service_id AND cc.ticket_status = 'concluido'
      )
      GROUP BY f.service_id, s2.user_id
    ) sub
    JOIN public.services s ON s.id = sub.service_id
    GROUP BY s.user_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'agent_id',                  p.id::text,
      'agent_name',                COALESCE(p.full_name, 'Sem nome'),
      'total_tickets',             COUNT(DISTINCT c.service_id)::int,
      'new_tickets_count',         COUNT(DISTINCT c.service_id)::int,
      'interactions_count',        COALESCE(ai.cnt, 0),
      'done_count',                COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido')::int,
      'total_interactions',        COALESCE(ai.cnt, 0),
      'avg_interactions_to_close', COALESCE(atc.avg_cnt, 0),
      'completion_rate',           CASE
        WHEN COUNT(DISTINCT c.service_id) > 0
        THEN ROUND((COUNT(DISTINCT c.service_id) FILTER (WHERE c.ticket_status = 'concluido')::numeric / COUNT(DISTINCT c.service_id)) * 100, 1)
        ELSE 0
      END
    ) ORDER BY COALESCE(p.full_name, 'Sem nome')
  ), '[]'::jsonb) INTO v_by_agent
  FROM public.profiles p
  LEFT JOIN classified c ON c.user_id::text = p.id::text
  LEFT JOIN agent_interactions ai ON ai.uid = p.id::text
  LEFT JOIN avg_to_close atc ON atc.uid = p.id::text
  WHERE p.role = 'agent'
  GROUP BY p.id, p.full_name, ai.cnt, atc.avg_cnt;

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
