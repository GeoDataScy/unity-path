-- Update by_channel in dashboard_metrics to include follow-up interactions.
-- Follow-ups inherit the channel from their parent service via JOIN.
-- Previously only new ticket registrations were counted per channel.
CREATE OR REPLACE FUNCTION public.dashboard_metrics(from_date date, to_date date, agent_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_total    bigint;
  v_by_agent jsonb;
  v_by_product jsonb;
  v_by_day   jsonb;
  v_by_platform jsonb;
  v_by_channel  jsonb;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Total = new services in range + follow-ups recorded in range
  SELECT
    (
      SELECT COUNT(*) FROM public.services s
      WHERE s.service_date::timestamptz >= from_date::timestamptz
        AND s.service_date::timestamptz <  (to_date::timestamptz + interval '1 day')
        AND (agent_id IS NULL OR s.user_id = agent_id)
    ) + (
      SELECT COUNT(*) FROM public.service_follow_ups f
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date >= from_date
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date <= to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
    )
  INTO v_total;

  -- Per-agent: new services + follow-ups
  WITH service_counts AS (
    SELECT s.user_id, COUNT(*)::int AS cnt
    FROM public.services s
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz <  (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    GROUP BY s.user_id
  ),
  followup_counts AS (
    SELECT f.user_id, COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date >= from_date
      AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date <= to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
    GROUP BY f.user_id
  ),
  all_active AS (
    SELECT user_id FROM service_counts
    UNION
    SELECT user_id FROM followup_counts
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.full_name, 'Sem nome') AS name,
      COALESCE(sc.cnt, 0) + COALESCE(fc.cnt, 0) AS value,
      aa.user_id
    FROM all_active aa
    LEFT JOIN public.profiles p ON p.id = aa.user_id
    LEFT JOIN service_counts  sc ON sc.user_id = aa.user_id
    LEFT JOIN followup_counts fc ON fc.user_id = aa.user_id
  ) t;

  -- By product: services only
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT s.product AS name, COUNT(*)::int AS value
    FROM public.services s
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz <  (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    GROUP BY s.product
    ORDER BY COUNT(*) DESC, s.product ASC
    LIMIT 10
  ) t;

  -- By day: services + follow-ups combined
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT day, SUM(cnt)::int AS value
    FROM (
      SELECT
        to_char(date_trunc('day', s.service_date::timestamptz), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS cnt
      FROM public.services s
      WHERE s.service_date::timestamptz >= from_date::timestamptz
        AND s.service_date::timestamptz <  (to_date::timestamptz + interval '1 day')
        AND (agent_id IS NULL OR s.user_id = agent_id)
      GROUP BY date_trunc('day', s.service_date::timestamptz)
      UNION ALL
      SELECT
        to_char((f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date >= from_date
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date <= to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
      GROUP BY (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
    ) combined
    GROUP BY day
  ) t;

  -- By platform: services only
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(s.platform, 'Nao informado') AS name, COUNT(*)::int AS value
    FROM public.services s
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz <  (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    GROUP BY COALESCE(s.platform, 'Nao informado')
  ) t;

  -- By channel: services + follow-ups (follow-ups inherit channel from parent service)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT channel_name AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.channel, 'Nao informado') AS channel_name, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE s.service_date::timestamptz >= from_date::timestamptz
        AND s.service_date::timestamptz <  (to_date::timestamptz + interval '1 day')
        AND (agent_id IS NULL OR s.user_id = agent_id)
      GROUP BY COALESCE(s.channel, 'Nao informado')
      UNION ALL
      SELECT COALESCE(s.channel, 'Nao informado') AS channel_name, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date >= from_date
        AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date <= to_date
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
