-- Rewrite agent_daily_metrics and agent_my_metrics with the "cada interação = 1"
-- rule. Both now go through _interaction_events so they share the exact same
-- counting logic as dashboard_metrics.
--
-- Guarantees after this migration:
--   * For the same agent and same day:
--       agent_daily_metrics(d).my_count == dashboard_metrics(d, d, uid).total_count
--   * For the same agent and same range:
--       agent_my_metrics(from, to).total_count == dashboard_metrics(from, to, uid).total_count
--   * SUM(by_day[*].value) == total_count   in both RPCs
--
-- Each service creation is 1 event on its service_date.
-- Each follow-up is 1 event on its recorded_at.

-- ============================================================================
-- agent_daily_metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_daily_metrics(
  target_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid          uuid;
  v_uid_text     text;
  v_my_count     int := 0;
  v_leader_id    text;
  v_leader_count int := 0;
  v_leader_name  text := 'Sem nome';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  v_uid_text := v_uid::text;

  -- Events authored by the current agent on target_date
  SELECT COUNT(*)::int INTO v_my_count
  FROM public._interaction_events(target_date, target_date, v_uid_text);

  -- Leader board: best agent across the whole team on target_date
  SELECT t.user_id, t.c
    INTO v_leader_id, v_leader_count
  FROM (
    SELECT e.user_id, COUNT(*)::int AS c
    FROM public._interaction_events(target_date, target_date, NULL) e
    GROUP BY e.user_id
    ORDER BY COUNT(*) DESC, e.user_id ASC
    LIMIT 1
  ) t;

  IF v_leader_id IS NOT NULL THEN
    SELECT COALESCE(p.full_name, 'Sem nome')
      INTO v_leader_name
    FROM public.profiles p
    WHERE p.id::text = v_leader_id;
  END IF;

  RETURN jsonb_build_object(
    'my_count',     COALESCE(v_my_count, 0),
    'leader_count', COALESCE(v_leader_count, 0),
    'leader_name',  COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'leader_id',    v_leader_id,
    'is_leader',    (v_leader_id IS NOT NULL AND v_leader_id = v_uid_text)
  );
END;
$$;

-- ============================================================================
-- agent_my_metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_my_metrics(from_date date, to_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               text;
  v_days              int;
  v_total             int     := 0;
  v_new_services      int     := 0;
  v_follow_ups        int     := 0;
  v_avg_daily         numeric := 0;
  v_best_day          text    := NULL;
  v_best_day_count    int     := 0;
  v_mid               date;
  v_first_sum         numeric := 0;
  v_second_sum        numeric := 0;
  v_first_days        int     := 0;
  v_second_days       int     := 0;
  v_first_avg         numeric := 0;
  v_second_avg        numeric := 0;
  v_trend_pct         numeric := 0;
  v_trend_label       text    := 'Estável';
  v_by_day            jsonb;
  v_by_channel        jsonb;
  v_by_platform       jsonb;
  v_by_product        jsonb;
  v_refunds_open      int    := 0;
  v_refunds_done      int    := 0;
  v_refunds_value     numeric := 0;
  v_team_avg          numeric := 0;
  v_leader_uid        text;
  v_leader_count      int    := 0;
  v_leader_name       text   := '';
  v_is_leader         boolean := false;
  v_gap_pct           numeric := 0;
  v_is_below_20       boolean := false;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  v_days := (to_date - from_date)::int + 1;

  -- ── Totals ────────────────────────────────────────────────────────────────
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE kind = 'service')::int,
    COUNT(*) FILTER (WHERE kind = 'follow_up')::int
  INTO v_total, v_new_services, v_follow_ups
  FROM public._interaction_events(from_date, to_date, v_uid);

  v_avg_daily := CASE WHEN v_days > 0 THEN ROUND(v_total::numeric / v_days, 2) ELSE 0 END;

  -- ── By day ────────────────────────────────────────────────────────────────
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  ev AS (
    SELECT day, kind FROM public._interaction_events(from_date, to_date, v_uid)
  ),
  per_day AS (
    SELECT
      day,
      COUNT(*)::int                                            AS total,
      COUNT(*) FILTER (WHERE kind = 'service')::int            AS services,
      COUNT(*) FILTER (WHERE kind = 'follow_up')::int          AS followups
    FROM ev
    GROUP BY day
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',       to_char(ds.day, 'YYYY-MM-DD'),
        'value',     COALESCE(per_day.total, 0),
        'services',  COALESCE(per_day.services, 0),
        'followups', COALESCE(per_day.followups, 0)
      ) ORDER BY ds.day
    ),
    '[]'::jsonb
  )
  INTO v_by_day
  FROM ds
  LEFT JOIN per_day ON per_day.day = ds.day;

  -- ── Best day ──────────────────────────────────────────────────────────────
  SELECT d->>'day', (d->>'value')::int
  INTO v_best_day, v_best_day_count
  FROM jsonb_array_elements(v_by_day) AS d
  WHERE (d->>'value')::int > 0
  ORDER BY (d->>'value')::int DESC, d->>'day' ASC
  LIMIT 1;

  -- ── Trend (2nd half vs 1st half daily average) ────────────────────────────
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

  -- ── By channel / platform / product (events of the agent) ─────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
           ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT COALESCE(channel, 'Não informado') AS name, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, v_uid)
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
           ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(platform, 'Não informado') AS name, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, v_uid)
    GROUP BY 1
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', value)
           ORDER BY value DESC, name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT COALESCE(product, 'Não informado') AS name, COUNT(*)::int AS value
    FROM public._interaction_events(from_date, to_date, v_uid)
    GROUP BY 1
  ) t;

  -- ── Refunds (own only) — unchanged ────────────────────────────────────────
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

  -- ── Team benchmark: events per agent across the whole team in range ───────
  WITH per_agent AS (
    SELECT e.user_id, COUNT(*)::int AS total
    FROM public._interaction_events(from_date, to_date, NULL) e
    GROUP BY e.user_id
  )
  SELECT
    COALESCE(ROUND(AVG(total) FILTER (WHERE user_id <> v_uid)::numeric, 2), 0),
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
    'total_interactions',      v_total,  -- legacy alias
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
    'team_average',            v_team_avg,
    'team_leader_name',        COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'team_leader_count',       v_leader_count,
    'is_leader',               v_is_leader,
    'gap_to_avg_pct',          v_gap_pct,
    'is_below_team_avg_20pct', v_is_below_20,
    'benchmark_name',          COALESCE(NULLIF(v_leader_name, ''), 'Sem nome'),
    'benchmark_count',         v_leader_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_my_metrics(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_my_metrics(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
