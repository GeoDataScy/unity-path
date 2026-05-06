-- Align dashboard_metrics with the agent screen "Meus Atendimentos Recentes".
--
-- Previous version (20260430080000) excluded follow-ups whose service_date was
-- inside the filter range (i.e. it kept only follow-ups where service_date <
-- from_date). That was inconsistent with the agent screen, which counts ANY
-- service the agent had activity on in the range — opening or interacting —
-- regardless of where service_date falls.
--
-- Source-of-truth rule (mirrors filteredServices in Atendimentos.tsx):
--   service appears if (service_date IN range) OR (follow-up recorded IN range)
--
-- Counted with COUNT(DISTINCT service_id) so multiple follow-ups on the same
-- ticket on the same day still count as 1 attendance.
--
-- RLS-equivalent constraint preserved: only follow-ups on services owned by
-- the same agent (s.user_id = f.user_id), to avoid cross-agent inflation.

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

  -- ── Total: unique services with activity in the period ─────────────────────
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
      AND s.user_id::text = f.user_id
  ) src;

  -- ── Per-agent breakdown ─────────────────────────────────────────────────────
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
        AND s.user_id::text = f.user_id
    ) src
    LEFT JOIN public.profiles p ON p.id::text = src.uid
    GROUP BY src.uid
  ) t;

  -- ── By product (services only — matches table column) ──────────────────────
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

  -- ── By day: same rule, applied per SP calendar day ─────────────────────────
  WITH ds AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  per_day AS (
    SELECT day, COUNT(DISTINCT service_id)::int AS value
    FROM (
      SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             s.id AS service_id
      FROM public.services s
      WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR s.user_id::text = agent_id)

      UNION ALL

      SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             f.service_id
      FROM public.service_follow_ups f
      JOIN public.services s ON s.id = f.service_id
      WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN from_date AND to_date
        AND (agent_id IS NULL OR f.user_id = agent_id)
        AND s.user_id::text = f.user_id
    ) u
    GROUP BY day
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT to_char(ds.day, 'YYYY-MM-DD') AS day,
           COALESCE(per_day.value, 0)    AS value
    FROM ds
    LEFT JOIN per_day ON per_day.day = ds.day
  ) t;

  -- ── By platform: distinct services per platform ────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT COALESCE(s.platform, 'Nao informado') AS name,
           COUNT(DISTINCT u.service_id)::int     AS value
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
        AND s.user_id::text = f.user_id
    ) u
    JOIN public.services s ON s.id = u.service_id
    GROUP BY 1
  ) t;

  -- ── By channel: distinct services per channel ──────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT COALESCE(s.channel, 'Nao informado') AS name,
           COUNT(DISTINCT u.service_id)::int    AS value
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
        AND s.user_id::text = f.user_id
    ) u
    JOIN public.services s ON s.id = u.service_id
    GROUP BY 1
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
