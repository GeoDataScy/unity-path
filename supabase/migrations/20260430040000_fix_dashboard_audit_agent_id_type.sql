-- dashboard_audit existed with agent_id uuid (from migrations) AND agent_id text
-- (created outside migrations), causing "could not choose best candidate function".
-- Drop both overloads then recreate once with agent_id text, matching dashboard_metrics.
-- No logic changes — only parameter type unified to text.

DROP FUNCTION IF EXISTS public.dashboard_audit(date, date, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.dashboard_audit(date, date, text, integer, integer);

CREATE FUNCTION public.dashboard_audit(
  from_date    date,
  to_date      date,
  agent_id     text    DEFAULT NULL,
  page_size    integer DEFAULT 25,
  page_offset  integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_rows  jsonb;
BEGIN
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF page_size  IS NULL OR page_size  < 1 THEN page_size  := 25;  END IF;
  IF page_size  > 200                      THEN page_size  := 200; END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN page_offset := 0; END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.services s
  WHERE s.service_date::timestamptz >= from_date::timestamptz
    AND s.service_date::timestamptz  < (to_date::timestamptz + interval '1 day')
    AND (agent_id IS NULL OR s.user_id = agent_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      s.id, s.created_at, s.service_date, s.client_email,
      s.product, s.platform, s.channel, s.status, s.user_id,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.services s
    LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.service_date::timestamptz >= from_date::timestamptz
      AND s.service_date::timestamptz  < (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    ORDER BY s.service_date::timestamptz DESC
    LIMIT page_size OFFSET page_offset
  ) t;

  RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$$;

NOTIFY pgrst, 'reload schema';
