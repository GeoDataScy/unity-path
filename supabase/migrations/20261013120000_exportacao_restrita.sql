-- Ajuste 6 do Jurídico (IMP-SUP-01-A v2): exportação de dados de clientes
-- conforme o perfil.
--
-- • O prestador passa a exportar só um RESUMO sem dados pessoais: data e hora,
--   canal, produto, plataforma, motivo, status e ID interno. Fica de fora
--   e-mail, nome, telefone, endereço, order ID e todo texto livre (observação,
--   descrição do motivo "Outro"), que pode conter dado pessoal.
-- • A exportação COMPLETA exige a capacidade can_export_full_client_data (uma
--   boolean por capacidade, mesmo vocabulário de can_view_all_tickets) e deixa
--   registro de quem exportou, quando e qual período.
--
-- A trava fica no banco: o payload da RPC aparece no DevTools, então esconder o
-- botão não bastaria.

-- ── 1) Capacidade ──────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_export_full_client_data boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_export_full_client_data()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.can_export_full_client_data FROM public.profiles p WHERE p.id = (auth.uid())::text),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.can_export_full_client_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_export_full_client_data() TO authenticated;

-- ── 2) Registro das exportações completas ──────────────────────────────────
-- Só se grava por RPC SECURITY DEFINER; ninguém insere, altera ou apaga direto.
-- A gestora lê.
CREATE TABLE IF NOT EXISTS public.client_data_export_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     text        NOT NULL,
  screen      text        NOT NULL CHECK (screen IN ('atendimentos', 'radar')),
  period_from date,
  period_to   date,
  filters     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  row_count   integer     NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_data_export_log_exported_at_idx
  ON public.client_data_export_log (exported_at DESC);

ALTER TABLE public.client_data_export_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_data_export_log FROM anon, authenticated;
GRANT SELECT ON public.client_data_export_log TO authenticated;

DROP POLICY IF EXISTS "Managers read export log" ON public.client_data_export_log;
CREATE POLICY "Managers read export log" ON public.client_data_export_log
  FOR SELECT USING ((SELECT public.is_manager()));

-- Registro da exportação completa do Radar. A planilha do Radar é montada no
-- navegador com as linhas que a tela já mostra; o registro vem antes do
-- download, e sem a capacidade a chamada falha.
CREATE OR REPLACE FUNCTION public.log_client_data_export(
  p_screen    text,
  p_row_count integer,
  p_filters   jsonb DEFAULT '{}'::jsonb,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.can_export_full_client_data() THEN
    RAISE EXCEPTION 'forbidden: exportação completa indisponível neste perfil';
  END IF;

  INSERT INTO public.client_data_export_log (user_id, screen, period_from, period_to, filters, row_count)
  VALUES (v_uid, p_screen, p_from, p_to, COALESCE(p_filters, '{}'::jsonb), COALESCE(p_row_count, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.log_client_data_export(text, integer, jsonb, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_client_data_export(text, integer, jsonb, date, date) TO authenticated;

-- ── 3) Resumo sem dados pessoais (Atendimentos) ────────────────────────────
-- Mesmo recorte e mesma visibilidade de export_agent_services, só com as
-- colunas que o Jurídico liberou.
CREATE OR REPLACE FUNCTION public.export_agent_services_summary(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      text;
  v_view_all boolean;
  v_result   jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_view_all := public.is_manager() OR public.can_view_all_tickets();

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      s.id,
      s.service_date,
      s.created_at,
      s.channel,
      s.product,
      s.platform,
      s.contact_reason,
      s.status,
      (SELECT count(*)
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id) AS follow_up_count,
      (SELECT f.status
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id
        ORDER BY f.recorded_at DESC, f.id DESC
        LIMIT 1) AS last_follow_up_status
    FROM public.services s
    WHERE (v_view_all OR s.current_owner_id = v_uid)
      AND (
        left(s.service_date, 10) BETWEEN to_char(p_from, 'YYYY-MM-DD') AND to_char(p_to, 'YYYY-MM-DD')
        OR EXISTS (
          SELECT 1
          FROM public.service_follow_ups f
          WHERE f.service_id = s.id
            AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to
        )
      )
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.export_agent_services_summary(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_agent_services_summary(date, date) TO authenticated;

-- ── 4) Exportação completa (Atendimentos) passa a exigir a capacidade ──────
-- Corpo igual ao de 20260818140000_contact_reason_outro_note.sql, com a trava
-- no início e o registro no fim. Deixa de ser STABLE porque grava o registro.
CREATE OR REPLACE FUNCTION public.export_agent_services(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid      text;
  v_view_all boolean;
  v_result   jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.can_export_full_client_data() THEN
    RAISE EXCEPTION 'forbidden: exportação completa indisponível neste perfil';
  END IF;

  v_view_all := public.is_manager() OR public.can_view_all_tickets();

  WITH visible AS (
    SELECT s.*
    FROM public.services s
    WHERE (v_view_all OR s.current_owner_id = v_uid)
      AND (
        left(s.service_date, 10) BETWEEN to_char(p_from, 'YYYY-MM-DD') AND to_char(p_to, 'YYYY-MM-DD')
        OR EXISTS (
          SELECT 1
          FROM public.service_follow_ups f
          WHERE f.service_id = s.id
            AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to
        )
      )
  ),
  ticket_rows AS (
    SELECT
      s.id,
      s.client_email,
      s.service_date,
      s.product,
      s.platform,
      s.channel,
      s.status,
      s.created_at,
      s.has_tracking_code,
      s.contact_reason,
      s.contact_reason_note,
      s.user_id,
      s.current_owner_id,
      creator.full_name AS creator_name,
      owner.full_name   AS owner_name,
      (SELECT count(*)
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id) AS follow_up_count,
      (SELECT max(f.recorded_at)
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id) AS last_interaction_at,
      (SELECT f.status
         FROM public.service_follow_ups f
        WHERE f.service_id = s.id
        ORDER BY f.recorded_at DESC, f.id DESC
        LIMIT 1) AS last_follow_up_status
    FROM visible s
    LEFT JOIN public.profiles creator ON creator.id::text = s.user_id
    LEFT JOIN public.profiles owner   ON owner.id::text   = s.current_owner_id
  )
  SELECT jsonb_build_object(
    'tickets', COALESCE(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC NULLS LAST)
         FROM ticket_rows t),
      '[]'::jsonb
    ),
    'follow_ups', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'service_id',       f.service_id,
                  'client_email',     v.client_email,
                  'follow_up_number', f.follow_up_number,
                  'status',           f.status,
                  'observation',      f.observation,
                  'recorded_at',      f.recorded_at,
                  'user_id',          f.user_id,
                  'agent_name',       p.full_name
                )
                ORDER BY v.client_email, f.recorded_at, f.id
              )
         FROM public.service_follow_ups f
         JOIN visible v ON v.id = f.service_id
         LEFT JOIN public.profiles p ON p.id::text = f.user_id),
      '[]'::jsonb
    )
  )
  INTO v_result;

  INSERT INTO public.client_data_export_log (user_id, screen, period_from, period_to, row_count)
  VALUES (v_uid, 'atendimentos', p_from, p_to, jsonb_array_length(v_result -> 'tickets'));

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
