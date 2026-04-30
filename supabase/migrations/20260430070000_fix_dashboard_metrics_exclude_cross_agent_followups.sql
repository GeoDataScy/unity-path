-- Fix dashboard_metrics: exclude cross-agent follow-ups from by_agent and v_total.
--
-- Root cause (migration 060000 still wrong):
--   The follow-up UNION included rows where f.user_id = Aguida but s.user_id ≠ Aguida.
--   That is, services OWNED by other agents that Aguida happened to follow up on.
--   The agent screen is restricted by RLS: services JOIN follow_ups only returns rows
--   where s.user_id = auth.uid(), so Aguida never sees other agents' services.
--   Manager had no such restriction → counted 81 (own) + 19 (cross-agent) = 100.
--
-- Fix: add AND s.user_id::text = f.user_id to BOTH follow-up UNION legs
--      in v_total and by_agent, mirroring the RLS constraint.
--
-- by_product, by_day, by_platform, by_channel are intentionally left unchanged.

CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  from_date date,
  to_date   date,
  agent_id  text DEFAULT NULL::text
)
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

  -- ── Total: unique services with any activity in the period ──────────────────
  -- Only follow-ups on services owned by that same agent (mirrors RLS on agent screen).
  SELECT COUNT(DISTINCT src.service_id)::bigint
  INTO v_total
  FROM (
    SELECT s.id AS service_id
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)

    UNION ALL

    SELECT f.service_id
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND s.user_id::text = f.user_id   -- exclude cross-agent follow-ups
      AND NOT (
        s.has_tracking_code = true
        AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
  ) src;

  -- ── Per-agent: unique services each agent was active on ─────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_agent
  FROM (
    SELECT
      src.uid                                  AS user_id,
      COALESCE(MAX(p.full_name), 'Sem nome')   AS name,
      COUNT(DISTINCT src.service_id)::int      AS value
    FROM (
      SELECT s.user_id::text AS uid, s.id AS service_id
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)

      UNION ALL

      SELECT f.user_id AS uid, f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND s.user_id::text = f.user_id   -- exclude cross-agent follow-ups
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
    ) src
    LEFT JOIN public.profiles p ON p.id::text = src.uid
    GROUP BY src.uid
  ) t;

  -- ── By product (services only — unchanged) ──────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT s.product AS name, COUNT(*)::int AS value
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY s.product
    ORDER BY COUNT(*) DESC, s.product ASC
    LIMIT 10
  ) t;

  -- ── By day (service_date based — unchanged) ──────────────────────────────────
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  svc_day AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
    GROUP BY 1
  ),
  fup_day AS (
    SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           COUNT(*)::int AS cnt
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
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

  -- ── By platform (unchanged) ──────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT platform_name AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.platform, 'Nao informado') AS platform_name, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      GROUP BY 1
      UNION ALL
      SELECT COALESCE(s.platform, 'Nao informado') AS platform_name, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
      GROUP BY 1
    ) combined
    GROUP BY platform_name
  ) t;

  -- ── By channel (unchanged) ───────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT channel_name AS name, SUM(cnt)::int AS value
    FROM (
      SELECT COALESCE(s.channel, 'Nao informado') AS channel_name, COUNT(*)::int AS cnt
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)
      GROUP BY 1
      UNION ALL
      SELECT COALESCE(s.channel, 'Nao informado') AS channel_name, COUNT(*)::int AS cnt
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND NOT (
          s.has_tracking_code = true
          AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              = (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
        )
      GROUP BY 1
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
