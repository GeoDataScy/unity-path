-- Rewrite agent_my_metrics with the unified counting rule that matches:
--   * Atendimentos.tsx (filteredServices)
--   * agent_daily_metrics (the "Total de atendimentos hoje" card)
--   * dashboard_metrics (manager dashboards)
--
-- Old rule (incorrect, drifted):
--   v_total = COUNT(services in range) + COUNT(follow_ups joined to services
--              where service_date in range, excluding tracking-code same-day)
--   → multiple follow-ups on the same ticket inflated the total
--   → follow-ups on previous-day tickets were silently dropped (filtered by
--     service_date instead of recorded_at)
--   → tracking-code same-day exclusion was a relic of a deleted rule
--
-- New rule:
--   total_count = COUNT(DISTINCT service_id) where the agent either
--     (a) opened the service in the range (service_date in range), OR
--     (b) recorded a follow-up in the range (recorded_at in range), on a
--         service that belongs to the same agent (RLS-equivalent constraint).
--   Each ticket counts at most once per day, regardless of how many follow-ups.
--
-- NEW fields for team comparison:
--   team_average           — average total_count across OTHER agents in range
--   team_leader_name       — name of the agent with the highest total in range
--   team_leader_count      — that agent's total
--   is_leader              — own total >= team_leader_count (and > 0)
--   gap_to_avg_pct         — how many % the team average is ABOVE own count.
--                            (team_average / own_total - 1) * 100, clamped to
--                            >= 0. Zero when own >= team_average or own = 0.
--   is_below_team_avg_20pct — own_total < team_average * 0.8 AND own_total > 0.
--                              Triggers the "Hora de acelerar" message.

CREATE OR REPLACE FUNCTION public.agent_my_metrics(from_date date, to_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              text;
  v_days             int;
  v_total            int     := 0;
  v_new_services     int     := 0;
  v_follow_ups       int     := 0;
  v_avg_daily        numeric := 0;
  v_best_day         text    := NULL;
  v_best_day_count   int     := 0;
  v_mid              date;
  v_first_sum        numeric := 0;
  v_second_sum       numeric := 0;
  v_first_days       int     := 0;
  v_second_days      int     := 0;
  v_first_avg        numeric := 0;
  v_second_avg       numeric := 0;
  v_trend_pct        numeric := 0;
  v_trend_label      text    := 'Estável';
  v_by_day           jsonb;
  v_by_channel       jsonb;
  v_by_platform      jsonb;
  v_by_product       jsonb;
  v_refunds_open     int    := 0;
  v_refunds_done     int    := 0;
  v_refunds_value    numeric := 0;
  v_team_avg         numeric := 0;
  v_leader_uid       text;
  v_leader_count     int    := 0;
  v_leader_name      text   := '';
  v_is_leader        boolean := false;
  v_gap_pct          numeric := 0;
  v_is_below_20      boolean := false;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  v_days := (to_date - from_date)::int + 1;

  -- ── Total: DISTINCT services with activity in range (own ticket only) ──────
  WITH own_activity AS (
    SELECT s.id AS service_id
    FROM public.services s
    WHERE s.user_id = v_uid
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date

    UNION

    SELECT f.service_id
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE f.user_id = v_uid
      AND s.user_id = v_uid
      AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
  )
  SELECT COUNT(*)::int INTO v_total FROM own_activity;

  -- ── Sub-metrics: separate counts of new tickets vs follow-ups ──────────────
  -- These are auxiliary; total_count is the primary number and is DISTINCT.
  SELECT COUNT(*)::int INTO v_new_services
  FROM public.services s
  WHERE s.user_id = v_uid
    AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
        BETWEEN from_date AND to_date;

  SELECT COUNT(*)::int INTO v_follow_ups
  FROM public.service_follow_ups f
  JOIN public.services s ON s.id = f.service_id
  WHERE f.user_id = v_uid
    AND s.user_id = v_uid
    AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        BETWEEN from_date AND to_date;

  v_avg_daily := CASE WHEN v_days > 0 THEN ROUND(v_total::numeric / v_days, 2) ELSE 0 END;

  -- ── By day: DISTINCT services per SP calendar day ──────────────────────────
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  per_day AS (
    SELECT day, COUNT(DISTINCT service_id)::int AS cnt
    FROM (
      SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             s.id AS service_id
      FROM public.services s
      WHERE s.user_id = v_uid
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date

      UNION ALL

      SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE f.user_id = v_uid
        AND s.user_id = v_uid
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
    ) u
    GROUP BY day
  ),
  svc_only AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.services s
    WHERE s.user_id = v_uid
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
    GROUP BY 1
  ),
  fup_only AS (
    SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE f.user_id = v_uid
      AND s.user_id = v_uid
      AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',       to_char(ds.day, 'YYYY-MM-DD'),
        'value',     COALESCE(per_day.cnt, 0),
        'services',  COALESCE(svc_only.cnt, 0),
        'followups', COALESCE(fup_only.cnt, 0)
      ) ORDER BY ds.day
    ),
    '[]'::jsonb
  )
  INTO v_by_day
  FROM ds
  LEFT JOIN per_day  ON per_day.day  = ds.day
  LEFT JOIN svc_only ON svc_only.day = ds.day
  LEFT JOIN fup_only ON fup_only.day = ds.day;

  -- ── Best day ────────────────────────────────────────────────────────────────
  SELECT d->>'day', (d->>'value')::int
  INTO v_best_day, v_best_day_count
  FROM jsonb_array_elements(v_by_day) AS d
  WHERE (d->>'value')::int > 0
  ORDER BY (d->>'value')::int DESC, d->>'day' ASC
  LIMIT 1;

  -- ── Trend (2nd half vs 1st half daily average) ─────────────────────────────
  v_mid         := from_date + ((to_date - from_date) / 2)::int;
  v_first_days  := (v_mid - from_date)::int + 1;
  v_second_days := GREATEST((to_date - v_mid)::int, 0);

  SELECT COALESCE(SUM((d->>'value')::int), 0) INTO v_first_sum
  FROM jsonb_array_elements(v_by_day) AS d
  WHERE (d->>'day')::date <= v_mid;

  SELECT COALESCE(SUM((d->>'value')::int), 0) INTO v_second_sum
  FROM jsonb_array_elements(v_by_day) AS d
  WHERE (d->>'day')::date > v_mid;

  v_first_avg  := CASE WHEN v_first_days  > 0 THEN v_first_sum  / v_first_days  ELSE 0 END;
  v_second_avg := CASE WHEN v_second_days > 0 THEN v_second_sum / v_second_days ELSE 0 END;

  IF v_first_avg = 0 AND v_second_avg = 0 THEN
    v_trend_pct := 0; v_trend_label := 'Estável';
  ELSIF v_first_avg = 0 THEN
    v_trend_pct := 100; v_trend_label := 'Evoluindo';
  ELSE
    v_trend_pct := ROUND(((v_second_avg - v_first_avg) / v_first_avg) * 100, 0);
    v_trend_label := CASE
      WHEN v_trend_pct >=  5 THEN 'Evoluindo'
      WHEN v_trend_pct <= -5 THEN 'Regredindo'
      ELSE 'Estável'
    END;
  END IF;

  -- ── By channel / platform / product (DISTINCT services) ────────────────────
  WITH own_activity AS (
    SELECT s.id AS service_id, s.channel, s.platform, s.product
    FROM public.services s
    WHERE s.id IN (
      SELECT id FROM public.services s2
      WHERE s2.user_id = v_uid
        AND (s2.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
      UNION
      SELECT f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s2 ON s2.id = f.service_id
      WHERE f.user_id = v_uid
        AND s2.user_id = v_uid
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
    )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
             ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT COALESCE(channel, 'Não informado') AS name,
           COUNT(DISTINCT service_id)::int AS value
    FROM own_activity GROUP BY 1
  ) t;

  WITH own_activity AS (
    SELECT s.id AS service_id, s.platform
    FROM public.services s
    WHERE s.id IN (
      SELECT id FROM public.services s2
      WHERE s2.user_id = v_uid
        AND (s2.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
      UNION
      SELECT f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s2 ON s2.id = f.service_id
      WHERE f.user_id = v_uid
        AND s2.user_id = v_uid
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
    )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
             ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(platform, 'Não informado') AS name,
           COUNT(DISTINCT service_id)::int AS value
    FROM own_activity GROUP BY 1
  ) t;

  WITH own_activity AS (
    SELECT s.id AS service_id, s.product
    FROM public.services s
    WHERE s.id IN (
      SELECT id FROM public.services s2
      WHERE s2.user_id = v_uid
        AND (s2.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
      UNION
      SELECT f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s2 ON s2.id = f.service_id
      WHERE f.user_id = v_uid
        AND s2.user_id = v_uid
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
    )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
             ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT COALESCE(product, 'Não informado') AS name,
           COUNT(DISTINCT service_id)::int AS value
    FROM own_activity GROUP BY 1
  ) t;

  -- ── Refunds (own only) — request_date in range, completion_date in range ──
  SELECT COUNT(*)::int INTO v_refunds_open
  FROM public.refunds r
  WHERE r.user_id = v_uid
    AND r.completion_date IS NULL
    AND r.request_date::date BETWEEN from_date AND to_date;

  SELECT COUNT(*)::int, COALESCE(SUM(r.refund_value), 0)
  INTO v_refunds_done, v_refunds_value
  FROM public.refunds r
  WHERE r.user_id = v_uid
    AND r.completion_date IS NOT NULL
    AND r.completion_date::date BETWEEN from_date AND to_date;

  -- ── Team benchmark: average across OTHER agents (excluding self) ───────────
  WITH per_agent AS (
    SELECT u.uid AS user_id, COUNT(DISTINCT u.service_id)::int AS total
    FROM (
      SELECT s.user_id::text AS uid, s.id AS service_id
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date

      UNION ALL

      SELECT f.user_id AS uid, f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE s.user_id::text = f.user_id
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
    ) u
    GROUP BY u.uid
  )
  SELECT
    COALESCE(ROUND(AVG(total) FILTER (WHERE user_id <> v_uid)::numeric, 2), 0),
    -- leader (single best across all agents, including self)
    (SELECT user_id FROM per_agent ORDER BY total DESC, user_id ASC LIMIT 1),
    COALESCE((SELECT total FROM per_agent ORDER BY total DESC, user_id ASC LIMIT 1), 0)
  INTO v_team_avg, v_leader_uid, v_leader_count
  FROM per_agent;

  IF v_leader_uid IS NOT NULL THEN
    SELECT COALESCE(p.full_name, 'Sem nome') INTO v_leader_name
    FROM public.profiles p WHERE p.id::text = v_leader_uid;
  END IF;

  v_is_leader   := (v_total > 0 AND v_total >= v_leader_count);
  v_is_below_20 := (v_total > 0 AND v_team_avg > 0 AND v_total::numeric < v_team_avg * 0.8);
  v_gap_pct     := CASE
    WHEN v_total = 0 OR v_team_avg <= v_total THEN 0
    ELSE ROUND((v_team_avg / v_total::numeric - 1) * 100, 0)
  END;

  RETURN jsonb_build_object(
    'total_count',             v_total,
    'new_services',            v_new_services,
    'follow_ups',              v_follow_ups,
    -- legacy field preserved for backward-compatibility while frontend transitions:
    'total_interactions',      v_total,
    'avg_daily',               v_avg_daily,
    'best_day',                v_best_day,
    'best_day_count',          v_best_day_count,
    'trend_pct',               v_trend_pct,
    'trend_label',             v_trend_label,
    'by_day',                  v_by_day,
    'by_channel',              v_by_channel,
    'by_platform',             v_by_platform,
    'by_product',              v_by_product,
    'refunds_open',            v_refunds_open,
    'refunds_done',            v_refunds_done,
    'refunds_total_value',     v_refunds_value,
    -- team comparison
    'team_average',            v_team_avg,
    'team_leader_name',        COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'team_leader_count',       v_leader_count,
    'is_leader',               v_is_leader,
    'gap_to_avg_pct',          v_gap_pct,
    'is_below_team_avg_20pct', v_is_below_20,
    -- legacy benchmark fields preserved (point to leader, as before)
    'benchmark_name',          COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'benchmark_count',         v_leader_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_my_metrics(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_my_metrics(date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
