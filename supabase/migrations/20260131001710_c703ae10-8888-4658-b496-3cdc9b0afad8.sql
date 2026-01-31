-- 1) Daily aggregate table (São Paulo day)
CREATE TABLE IF NOT EXISTS public.agent_daily_service_counts (
  user_id uuid NOT NULL,
  day date NOT NULL,
  service_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_agent_daily_service_counts_user_day
  ON public.agent_daily_service_counts (user_id, day);

-- 2) RLS
ALTER TABLE public.agent_daily_service_counts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_daily_service_counts'
      AND policyname = 'Agents view own daily service counts'
  ) THEN
    CREATE POLICY "Agents view own daily service counts"
    ON public.agent_daily_service_counts
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_daily_service_counts'
      AND policyname = 'Managers view all daily service counts'
  ) THEN
    CREATE POLICY "Managers view all daily service counts"
    ON public.agent_daily_service_counts
    FOR SELECT
    USING ((auth.uid() IS NOT NULL) AND public.is_manager());
  END IF;
END $$;

-- 3) Refresh helper (recompute count from services for a given (user, day))
CREATE OR REPLACE FUNCTION public.refresh_agent_daily_service_count(p_user_id uuid, p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_user_id IS NULL OR p_day IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::int
    INTO v_count
  FROM public.services s
  WHERE s.user_id = p_user_id
    AND (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date = p_day;

  INSERT INTO public.agent_daily_service_counts (user_id, day, service_count, updated_at)
  VALUES (p_user_id, p_day, COALESCE(v_count, 0), now())
  ON CONFLICT (user_id, day)
  DO UPDATE SET
    service_count = EXCLUDED.service_count,
    updated_at = now();
END;
$$;

-- 4) Trigger to keep aggregates in sync
CREATE OR REPLACE FUNCTION public.trg_services_refresh_agent_daily_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_day date;
  new_day date;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    new_day := (NEW.service_date AT TIME ZONE 'America/Sao_Paulo')::date;
    PERFORM public.refresh_agent_daily_service_count(NEW.user_id, new_day);
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    old_day := (OLD.service_date AT TIME ZONE 'America/Sao_Paulo')::date;
    PERFORM public.refresh_agent_daily_service_count(OLD.user_id, old_day);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_day := (OLD.service_date AT TIME ZONE 'America/Sao_Paulo')::date;
    new_day := (NEW.service_date AT TIME ZONE 'America/Sao_Paulo')::date;

    -- Recompute old bucket when either day or user changed
    IF (OLD.user_id IS DISTINCT FROM NEW.user_id) OR (old_day IS DISTINCT FROM new_day) THEN
      PERFORM public.refresh_agent_daily_service_count(OLD.user_id, old_day);
    END IF;

    -- Always recompute new bucket (covers edits that don't change day/user as well)
    PERFORM public.refresh_agent_daily_service_count(NEW.user_id, new_day);

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'services_refresh_agent_daily_counts'
  ) THEN
    CREATE TRIGGER services_refresh_agent_daily_counts
    AFTER INSERT OR UPDATE OR DELETE ON public.services
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_services_refresh_agent_daily_counts();
  END IF;
END $$;

-- 5) Backfill aggregates from existing services
INSERT INTO public.agent_daily_service_counts (user_id, day, service_count, updated_at)
SELECT
  s.user_id,
  (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  COUNT(*)::int AS service_count,
  now() AS updated_at
FROM public.services s
GROUP BY s.user_id, (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date
ON CONFLICT (user_id, day)
DO UPDATE SET
  service_count = EXCLUDED.service_count,
  updated_at = now();

-- 6) RPC: agent_metrics_range(from_date, to_date)
CREATE OR REPLACE FUNCTION public.agent_metrics_range(from_date date, to_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_from date;
  v_to date;
  v_days int;
  v_total int;
  v_avg numeric;
  v_best_day date;
  v_best_day_count int;
  v_by_day jsonb;
  v_trend_pct numeric;
  v_trend_label text;
  v_first_half_avg numeric;
  v_second_half_avg numeric;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_from := LEAST(from_date, to_date);
  v_to := GREATEST(from_date, to_date);
  v_days := GREATEST(1, (v_to - v_from) + 1);

  -- Total
  SELECT COALESCE(SUM(ad.service_count), 0)
    INTO v_total
  FROM public.agent_daily_service_counts ad
  WHERE ad.user_id = v_uid
    AND ad.day BETWEEN v_from AND v_to;

  v_avg := (v_total::numeric / v_days::numeric);

  -- Best day
  SELECT ad.day, ad.service_count
    INTO v_best_day, v_best_day_count
  FROM public.agent_daily_service_counts ad
  WHERE ad.user_id = v_uid
    AND ad.day BETWEEN v_from AND v_to
  ORDER BY ad.service_count DESC, ad.day ASC
  LIMIT 1;

  v_best_day_count := COALESCE(v_best_day_count, 0);

  -- By day series (fill missing days with 0)
  WITH series AS (
    SELECT gs::date AS day
    FROM generate_series(v_from, v_to, interval '1 day') gs
  ), counts AS (
    SELECT ad.day, ad.service_count
    FROM public.agent_daily_service_counts ad
    WHERE ad.user_id = v_uid
      AND ad.day BETWEEN v_from AND v_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'day', to_char(s.day, 'YYYY-MM-DD'),
    'value', COALESCE(c.service_count, 0)
  ) ORDER BY s.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM series s
  LEFT JOIN counts c ON c.day = s.day;

  -- Trend: compare first half avg vs second half avg
  WITH series AS (
    SELECT
      gs::date AS day,
      row_number() OVER (ORDER BY gs) AS rn
    FROM generate_series(v_from, v_to, interval '1 day') gs
  ), joined AS (
    SELECT s.rn, s.day, COALESCE(ad.service_count, 0) AS value
    FROM series s
    LEFT JOIN public.agent_daily_service_counts ad
      ON ad.user_id = v_uid
     AND ad.day = s.day
  ), halves AS (
    SELECT
      AVG(CASE WHEN rn <= CEIL(v_days / 2.0) THEN value END)::numeric AS first_avg,
      AVG(CASE WHEN rn > CEIL(v_days / 2.0) THEN value END)::numeric AS second_avg
    FROM joined
  )
  SELECT first_avg, second_avg
    INTO v_first_half_avg, v_second_half_avg
  FROM halves;

  v_first_half_avg := COALESCE(v_first_half_avg, 0);
  v_second_half_avg := COALESCE(v_second_half_avg, 0);

  IF v_first_half_avg = 0 THEN
    v_trend_pct := CASE WHEN v_second_half_avg = 0 THEN 0 ELSE 100 END;
  ELSE
    v_trend_pct := ((v_second_half_avg - v_first_half_avg) / v_first_half_avg) * 100;
  END IF;

  IF v_trend_pct >= 5 THEN
    v_trend_label := 'Evoluindo';
  ELSIF v_trend_pct <= -5 THEN
    v_trend_label := 'Regredindo';
  ELSE
    v_trend_label := 'Estável';
  END IF;

  RETURN jsonb_build_object(
    'from_date', to_char(v_from, 'YYYY-MM-DD'),
    'to_date', to_char(v_to, 'YYYY-MM-DD'),
    'days', v_days,
    'total_count', COALESCE(v_total, 0),
    'avg_daily', COALESCE(v_avg, 0),
    'best_day', CASE WHEN v_best_day IS NULL THEN NULL ELSE to_char(v_best_day, 'YYYY-MM-DD') END,
    'best_day_count', COALESCE(v_best_day_count, 0),
    'trend_pct', COALESCE(v_trend_pct, 0),
    'trend_label', v_trend_label,
    'by_day', v_by_day
  );
END;
$$;

-- 7) RPC: agent_product_mix(from_date, to_date, top_n)
CREATE OR REPLACE FUNCTION public.agent_product_mix(from_date date, to_date date, top_n int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_from date;
  v_to date;
  v_top int;
  v_rows jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_from := LEAST(from_date, to_date);
  v_to := GREATEST(from_date, to_date);
  v_top := COALESCE(top_n, 10);
  IF v_top < 1 THEN v_top := 10; END IF;
  IF v_top > 50 THEN v_top := 50; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.value DESC, t.name ASC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.product AS name,
      COUNT(*)::int AS value
    FROM public.services s
    WHERE s.user_id = v_uid
      AND (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date >= v_from
      AND (s.service_date AT TIME ZONE 'America/Sao_Paulo')::date <= v_to
    GROUP BY s.product
    ORDER BY COUNT(*) DESC, s.product ASC
    LIMIT v_top
  ) t;

  RETURN v_rows;
END;
$$;