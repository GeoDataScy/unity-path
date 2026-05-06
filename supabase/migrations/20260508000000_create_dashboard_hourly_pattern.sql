-- dashboard_hourly_pattern — analyze WHEN agents work, not just how much.
--
-- Returns the data needed for the manager's "Padrão de horários" panel:
--   * 7×24 heatmap (day-of-week × hour-of-day) of all activity in SP timezone
--   * Peak hour / DOW
--   * Median shift start / end (median hour-of-day of first / last activity per day)
--   * Median hour at which the daily goal is reached (per-agent goal: 150 if
--     SMS-majority, else 100; "todos" filter takes the cross-agent median)
--   * Share of activity per shift (manhã / tarde / noite / madrugada)
--
-- Activity = service creation OR follow-up registration, both timestamped in SP.
-- Range filter is applied to the actual event timestamp (created_at /
-- recorded_at), not to service_date — these are the real working hours.

CREATE OR REPLACE FUNCTION public.dashboard_hourly_pattern(
  from_date date,
  to_date   date,
  agent_id  text DEFAULT NULL
)
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
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

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

REVOKE ALL ON FUNCTION public.dashboard_hourly_pattern(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_hourly_pattern(date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
