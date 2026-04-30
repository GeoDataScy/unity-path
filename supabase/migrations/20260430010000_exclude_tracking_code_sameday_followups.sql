-- Rule: if a service has has_tracking_code = true and a follow-up was recorded on
-- the SAME SP calendar date the service was opened (service_date), that follow-up
-- must NOT be counted as +1 attendance. It can remain in history, but it does not
-- increment the agent's daily total or any metric bar.
--
-- Affected functions: agent_my_metrics, dashboard_metrics

-- ── Helper macro (used in both functions) ────────────────────────────────────
-- A follow-up is a "same-day tracking code interaction" when:
--   s.has_tracking_code = true
--   AND SP-date(s.service_date) = SP-date(f.recorded_at)
-- We add  AND NOT (...)  to every follow-up sub-query.

-- ── agent_my_metrics ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agent_my_metrics(from_date date, to_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid          text;
  v_days         int;
  v_new_services int     := 0;
  v_follow_ups   int     := 0;
  v_total        int     := 0;
  v_avg_daily    numeric := 0;
  v_best_day     text    := NULL;
  v_best_day_count int   := 0;
  v_mid          date;
  v_first_sum    numeric := 0;
  v_second_sum   numeric := 0;
  v_first_days   int     := 0;
  v_second_days  int     := 0;
  v_first_avg    numeric := 0;
  v_second_avg   numeric := 0;
  v_trend_pct    numeric := 0;
  v_trend_label  text    := 'Estável';
  v_by_day       jsonb;
  v_by_channel   jsonb;
  v_by_platform  jsonb;
  v_by_product   jsonb;
  v_bench_name   text    := '';
  v_bench_count  int     := 0;
  v_bench_uid    text;
  v_is_leader    boolean := false;
  v_refunds_open  int    := 0;
  v_refunds_done  int    := 0;
  v_refunds_value numeric := 0;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  v_days := (to_date - from_date)::int + 1;

  -- ── New service registrations ───────────────────────────────────────────────
  SELECT COUNT(*)::int INTO v_new_services
  FROM public.services s
  WHERE s.user_id = v_uid
    AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date;

  -- ── Follow-ups (excluding same-day interactions on tracking-code tickets) ───
  SELECT COUNT(*)::int INTO v_follow_ups
  FROM public.service_follow_ups f
  JOIN public.services s ON s.id = f.service_id
  WHERE f.user_id = v_uid
    AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    AND NOT (
      s.has_tracking_code = true
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
    );

  v_total     := v_new_services + v_follow_ups;
  v_avg_daily := CASE WHEN v_days > 0 THEN ROUND(v_total::numeric / v_days, 2) ELSE 0 END;

  -- ── By day (zero-filled, same exclusion) ────────────────────────────────────
  WITH svc AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.services s
    WHERE s.user_id = v_uid
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    GROUP BY 1
  ),
  fup AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE f.user_id = v_uid
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND NOT (
        s.has_tracking_code = true
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
    GROUP BY 1
  ),
  ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',       to_char(ds.day, 'YYYY-MM-DD'),
        'value',     COALESCE(svc.cnt, 0) + COALESCE(fup.cnt, 0),
        'services',  COALESCE(svc.cnt, 0),
        'followups', COALESCE(fup.cnt, 0)
      ) ORDER BY ds.day
    ), '[]'::jsonb
  )
  INTO v_by_day
  FROM ds
  LEFT JOIN svc ON svc.day = ds.day
  LEFT JOIN fup ON fup.day = ds.day;

  -- ── Best day ────────────────────────────────────────────────────────────────
  SELECT d->>'day', (d->>'value')::int
  INTO v_best_day, v_best_day_count
  FROM jsonb_array_elements(v_by_day) AS d
  WHERE (d->>'value')::int > 0
  ORDER BY (d->>'value')::int DESC, d->>'day' ASC
  LIMIT 1;

  -- ── Trend ───────────────────────────────────────────────────────────────────
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

  IF v_first_avg > 0 THEN
    v_trend_pct := ROUND(((v_second_avg - v_first_avg) / v_first_avg) * 100, 1);
  END IF;
  v_trend_label := CASE
    WHEN v_trend_pct >=  5 THEN 'Evoluindo'
    WHEN v_trend_pct <= -5 THEN 'Regredindo'
    ELSE 'Estável'
  END;

  -- ── By channel ──────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT ch AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.channel, 'Não informado') AS ch, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE s.user_id = v_uid
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      GROUP BY 1
      UNION ALL
      SELECT COALESCE(s.channel, 'Não informado') AS ch, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE f.user_id = v_uid
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
      GROUP BY 1
    ) u
    GROUP BY ch
  ) t;

  -- ── By platform ─────────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT pl AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.platform, 'Não informado') AS pl, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE s.user_id = v_uid
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      GROUP BY 1
      UNION ALL
      SELECT COALESCE(s.platform, 'Não informado') AS pl, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE f.user_id = v_uid
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
      GROUP BY 1
    ) u
    GROUP BY pl
  ) t;

  -- ── By product (services only) ──────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT s.product AS name, COUNT(*)::int AS value
    FROM public.services s
    WHERE s.user_id = v_uid
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    GROUP BY s.product
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  -- ── Benchmark ───────────────────────────────────────────────────────────────
  WITH sc AS (
    SELECT s.user_id::text AS uid, COUNT(*)::int AS cnt
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
    GROUP BY s.user_id::text
  ),
  fc AS (
    SELECT f.user_id AS uid, COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND NOT (
        s.has_tracking_code = true
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
    GROUP BY f.user_id
  ),
  all_ag AS (SELECT uid FROM sc UNION SELECT uid FROM fc),
  ranked AS (
    SELECT aa.uid, COALESCE(sc.cnt, 0) + COALESCE(fc.cnt, 0) AS total
    FROM all_ag aa
    LEFT JOIN sc ON sc.uid = aa.uid
    LEFT JOIN fc ON fc.uid = aa.uid
    ORDER BY total DESC, aa.uid ASC
    LIMIT 1
  )
  SELECT r.uid, r.total, COALESCE(p.full_name, 'Sem nome')
  INTO v_bench_uid, v_bench_count, v_bench_name
  FROM ranked r
  LEFT JOIN public.profiles p ON p.id::text = r.uid;

  v_is_leader := (v_bench_uid IS NOT NULL AND v_bench_uid = v_uid);

  -- ── Refunds ─────────────────────────────────────────────────────────────────
  SELECT COUNT(*)::int INTO v_refunds_open
  FROM public.refunds r
  WHERE r.user_id = auth.uid()
    AND r.completion_date IS NULL
    AND r.request_date BETWEEN from_date AND to_date;

  SELECT COUNT(*)::int, COALESCE(SUM(r.refund_value), 0)
  INTO v_refunds_done, v_refunds_value
  FROM public.refunds r
  WHERE r.user_id = auth.uid()
    AND r.completion_date IS NOT NULL
    AND r.completion_date BETWEEN from_date AND to_date;

  RETURN jsonb_build_object(
    'new_services',        v_new_services,
    'follow_ups',          v_follow_ups,
    'total_interactions',  v_total,
    'avg_daily',           v_avg_daily,
    'best_day',            v_best_day,
    'best_day_count',      v_best_day_count,
    'trend_pct',           v_trend_pct,
    'trend_label',         v_trend_label,
    'by_day',              v_by_day,
    'by_channel',          v_by_channel,
    'by_platform',         v_by_platform,
    'by_product',          v_by_product,
    'benchmark_name',      v_bench_name,
    'benchmark_count',     v_bench_count,
    'is_leader',           v_is_leader,
    'refunds_open',        v_refunds_open,
    'refunds_done',        v_refunds_done,
    'refunds_total_value', v_refunds_value
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_my_metrics(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_my_metrics(date, date) TO authenticated;

-- ── dashboard_metrics ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_metrics(from_date date, to_date date, agent_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Total: services + follow-ups (excluding same-day tracking-code interactions)
  SELECT
    (
      SELECT COUNT(*) FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
    ) + (
      SELECT COUNT(*) FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
    )
  INTO v_total;

  -- Per-agent
  WITH service_counts AS (
    SELECT s.user_id::text AS uid, COUNT(*)::int AS cnt
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY s.user_id::text
  ),
  followup_counts AS (
    SELECT f.user_id AS uid, COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND NOT (
        s.has_tracking_code = true
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
    GROUP BY f.user_id
  ),
  all_active AS (
    SELECT uid FROM service_counts
    UNION
    SELECT uid FROM followup_counts
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.full_name, 'Sem nome') AS name,
      COALESCE(sc.cnt, 0) + COALESCE(fc.cnt, 0) AS value,
      aa.uid AS user_id
    FROM all_active aa
    LEFT JOIN public.profiles p ON p.id::text = aa.uid
    LEFT JOIN service_counts  sc ON sc.uid = aa.uid
    LEFT JOIN followup_counts fc ON fc.uid = aa.uid
  ) t;

  -- By product (services only, unchanged)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT s.product AS name, COUNT(*)::int AS value
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY s.product
    ORDER BY COUNT(*) DESC, s.product ASC
    LIMIT 10
  ) t;

  -- By day
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  svc_day AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY 1
  ),
  fup_day AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND NOT (
        s.has_tracking_code = true
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      to_char(ds.day, 'YYYY-MM-DD') AS day,
      COALESCE(svc_day.cnt, 0) + COALESCE(fup_day.cnt, 0) AS value
    FROM ds
    LEFT JOIN svc_day ON svc_day.day = ds.day
    LEFT JOIN fup_day ON fup_day.day = ds.day
  ) t;

  -- By platform
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT platform_name AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.platform, 'Nao informado') AS platform_name, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      GROUP BY COALESCE(s.platform, 'Nao informado')
      UNION ALL
      SELECT COALESCE(s.platform, 'Nao informado') AS platform_name, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
      GROUP BY COALESCE(s.platform, 'Nao informado')
    ) combined
    GROUP BY platform_name
  ) t;

  -- By channel
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT channel_name AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.channel, 'Nao informado') AS channel_name, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      GROUP BY COALESCE(s.channel, 'Nao informado')
      UNION ALL
      SELECT COALESCE(s.channel, 'Nao informado') AS channel_name, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
      GROUP BY COALESCE(s.channel, 'Nao informado')
    ) combined
    GROUP BY channel_name
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

NOTIFY pgrst, 'reload schema';
