-- Manager-only escape hatch to correct a wrong service_date.
--
-- The freeze triggers from 20260525000300 block any change to service_date.
-- This RPC is the *only* legitimate way to bypass that lock: it checks the
-- caller is a manager (the trigger also re-checks), records before/after in
-- an audit table, and then performs the UPDATE.

-- ── Audit table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_date_corrections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   text        NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  corrected_by uuid        NOT NULL REFERENCES auth.users(id),
  previous_date text       NOT NULL,
  new_date      text       NOT NULL,
  reason        text       NOT NULL,
  corrected_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_date_corrections_service
  ON public.service_date_corrections(service_id);
CREATE INDEX IF NOT EXISTS idx_service_date_corrections_corrected_at
  ON public.service_date_corrections(corrected_at DESC);

ALTER TABLE public.service_date_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read corrections"   ON public.service_date_corrections;
DROP POLICY IF EXISTS "Managers insert corrections" ON public.service_date_corrections;

CREATE POLICY "Managers read corrections"
  ON public.service_date_corrections
  FOR SELECT
  USING (public.is_manager());

CREATE POLICY "Managers insert corrections"
  ON public.service_date_corrections
  FOR INSERT
  WITH CHECK (public.is_manager());

-- ── RPC ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_correct_service_date(
  p_service_id text,
  p_new_date   date,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid;
  v_old_date  text;
  v_new_date_text text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden: only managers can correct service_date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason is required (at least 3 characters)';
  END IF;

  SELECT s.service_date INTO v_old_date
  FROM public.services s
  WHERE s.id = p_service_id;

  IF v_old_date IS NULL THEN
    RAISE EXCEPTION 'service not found: %', p_service_id;
  END IF;

  -- Preserve the SP-midnight convention
  v_new_date_text := to_char(p_new_date, 'YYYY-MM-DD') || 'T00:00:00-03:00';

  INSERT INTO public.service_date_corrections(
    service_id, corrected_by, previous_date, new_date, reason
  ) VALUES (
    p_service_id, v_uid, v_old_date, v_new_date_text, trim(p_reason)
  );

  UPDATE public.services
  SET service_date = v_new_date_text
  WHERE id = p_service_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'service_id',    p_service_id,
    'previous_date', v_old_date,
    'new_date',      v_new_date_text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_correct_service_date(text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_correct_service_date(text, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
