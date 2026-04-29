-- Fix dashboard_metrics: align service date filtering to São Paulo timezone.
-- Previously services used UTC boundaries (from_date::timestamptz) while
-- follow-ups used AT TIME ZONE 'America/Sao_Paulo'. This mismatch caused
-- services recorded with real SP evening timestamps to appear under the
-- wrong UTC date, inflating counts vs. the agent's own attendance page.
-- All service filters now use (service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
-- matching agent_my_metrics and the client-side slice(0,10) filter on the agent page.
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

  -- Total = new services in SP date range + follow-ups in SP date range
  SELECT
    (
      SELECT COUNT(*) FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
    ) + (
      SELECT COUNT(*) FROM public.service_follow_ups f
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
    )
  INTO v_total;

  -- Per-agent: new services + follow-ups
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
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
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

  -- By product: services only
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

  -- By day: services + follow-ups combined, grouped by SP date
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
    SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
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

  -- By platform: services + follow-ups (follow-ups inherit platform from parent service)
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
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
      GROUP BY COALESCE(s.platform, 'Nao informado')
    ) combined
    GROUP BY platform_name
  ) t;

  -- By channel: services + follow-ups (follow-ups inherit channel from parent service)
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
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
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
