-- 1) Roles table (separate from profiles)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can view their own roles (optional but helpful for debugging)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'Users can view own roles'
  ) THEN
    CREATE POLICY "Users can view own roles"
    ON public.user_roles
    FOR SELECT
    USING (auth.uid() IS NOT NULL AND user_id = auth.uid());
  END IF;
END $$;

-- 2) Security definer role checker
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
  );
$$;

-- 3) Update existing is_manager() to rely on user_roles
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'manager'::public.app_role);
$$;

-- 4) Dashboard aggregated metrics (no 1000-row limit)
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  from_date date,
  to_date date,
  agent_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_by_agent jsonb;
  v_by_product jsonb;
  v_by_day jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Total
  SELECT COUNT(*)
    INTO v_total
  FROM public.services s
  WHERE s.service_date >= from_date::timestamptz
    AND s.service_date < (to_date::timestamptz + interval '1 day')
    AND (agent_id IS NULL OR s.user_id = agent_id);

  -- By agent (ranking)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.full_name, 'Sem nome') AS name,
      COUNT(*)::int AS value,
      s.user_id
    FROM public.services s
    LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.service_date >= from_date::timestamptz
      AND s.service_date < (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    GROUP BY s.user_id, p.full_name
  ) t;

  -- By product (top 10)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_by_product
  FROM (
    SELECT
      s.product AS name,
      COUNT(*)::int AS value
    FROM public.services s
    WHERE s.service_date >= from_date::timestamptz
      AND s.service_date < (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    GROUP BY s.product
    ORDER BY COUNT(*) DESC, s.product ASC
    LIMIT 10
  ) t;

  -- By day
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
    INTO v_by_day
  FROM (
    SELECT
      to_char(date_trunc('day', s.service_date), 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS value
    FROM public.services s
    WHERE s.service_date >= from_date::timestamptz
      AND s.service_date < (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    GROUP BY date_trunc('day', s.service_date)
  ) t;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'by_agent', v_by_agent,
    'by_product', v_by_product,
    'by_day', v_by_day
  );
END;
$$;

-- 5) Dashboard audit paginated (server-side pagination)
CREATE OR REPLACE FUNCTION public.dashboard_audit(
  from_date date,
  to_date date,
  agent_id uuid DEFAULT NULL,
  page_size integer DEFAULT 25,
  page_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF page_size IS NULL OR page_size < 1 THEN
    page_size := 25;
  END IF;
  IF page_size > 200 THEN
    page_size := 200;
  END IF;
  IF page_offset IS NULL OR page_offset < 0 THEN
    page_offset := 0;
  END IF;

  SELECT COUNT(*)
    INTO v_total
  FROM public.services s
  WHERE s.service_date >= from_date::timestamptz
    AND s.service_date < (to_date::timestamptz + interval '1 day')
    AND (agent_id IS NULL OR s.user_id = agent_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id,
      s.created_at,
      s.service_date,
      s.client_email,
      s.product,
      s.status,
      s.user_id,
      jsonb_build_object('full_name', p.full_name) AS profiles
    FROM public.services s
    LEFT JOIN public.profiles p ON p.id = s.user_id
    WHERE s.service_date >= from_date::timestamptz
      AND s.service_date < (to_date::timestamptz + interval '1 day')
      AND (agent_id IS NULL OR s.user_id = agent_id)
    ORDER BY s.service_date DESC
    LIMIT page_size
    OFFSET page_offset
  ) t;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'rows', v_rows
  );
END;
$$;
