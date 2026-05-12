-- Status summary for the manager Excel report.
-- Classifies each service with activity in [from_date, to_date] (opening OR
-- follow-up) into one of three buckets, mirroring useStatusTracking.ts:
--   * novo          — no follow-ups AND services.status != 'concluido'
--   * em_andamento  — has follow-ups, last one != 'concluido'
--   * concluido     — services.status = 'concluido' OR last follow-up = 'concluido'
--
-- RLS-equivalent constraint preserved: only counts follow-ups by the same
-- agent who owns the service (avoid cross-agent inflation).

CREATE OR REPLACE FUNCTION public.dashboard_status_summary(
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
  v_novo         int;
  v_em_andamento int;
  v_concluido    int;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH services_in_range AS (
    SELECT DISTINCT s.id, s.status
    FROM public.services s
    WHERE (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)

    UNION

    SELECT DISTINCT s.id, s.status
    FROM public.service_follow_ups f
    JOIN public.services s ON s.id = f.service_id
    WHERE (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR f.user_id = agent_id)
      AND s.user_id::text = f.user_id
  ),
  last_followup AS (
    SELECT DISTINCT ON (service_id) service_id, status
    FROM public.service_follow_ups
    ORDER BY service_id, follow_up_number DESC
  ),
  classified AS (
    SELECT
      s.id,
      CASE
        WHEN lf.status = 'concluido' THEN 'concluido'
        WHEN s.status = 'concluido' AND lf.service_id IS NULL THEN 'concluido'
        WHEN lf.service_id IS NULL THEN 'novo'
        ELSE 'em_andamento'
      END AS status_label
    FROM services_in_range s
    LEFT JOIN last_followup lf ON lf.service_id = s.id
  )
  SELECT
    COUNT(*) FILTER (WHERE status_label = 'novo')::int,
    COUNT(*) FILTER (WHERE status_label = 'em_andamento')::int,
    COUNT(*) FILTER (WHERE status_label = 'concluido')::int
  INTO v_novo, v_em_andamento, v_concluido
  FROM classified;

  RETURN jsonb_build_object(
    'novo',         COALESCE(v_novo, 0),
    'em_andamento', COALESCE(v_em_andamento, 0),
    'concluido',    COALESCE(v_concluido, 0)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
