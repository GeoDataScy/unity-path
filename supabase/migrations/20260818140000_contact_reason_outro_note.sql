-- Motivo de contato "Outro (descrever)": casos excepcionais em texto livre.
--
-- Problema: o catálogo fixo de contact_reason obriga a criar um código novo para
-- cada situação pontual (ex.: "cliente confundiu cápsula x gummy"). Ou o agente
-- força o caso dentro de "Dúvidas geral" — e a métrica mente — ou o catálogo
-- vira uma lista infinita de motivos com 1 ocorrência cada.
--
-- Solução: um único código 'outro' + a coluna contact_reason_note com a
-- descrição escrita pelo agente. Os motivos recorrentes continuam no dropdown
-- (métrica agregada continua limpa) e o excepcional fica legível no relatório.
--
-- A nota é acoplada ao código: obrigatória quando contact_reason = 'outro',
-- proibida nos demais motivos. Sem isso a nota viraria um campo de observação
-- paralelo, colado em qualquer motivo, e o objetivo de "dados mais assertivos"
-- se perderia. A UI limpa a nota ao trocar o motivo.

-- ── 1) Coluna + constraints ────────────────────────────────────────────────
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS contact_reason_note text;

COMMENT ON COLUMN public.services.contact_reason_note IS
  'Descrição livre do motivo quando contact_reason = ''outro''. NULL nos demais motivos.';

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_contact_reason_check;

ALTER TABLE public.services
  ADD CONSTRAINT services_contact_reason_check
  CHECK (contact_reason IS NULL OR contact_reason IN (
    'duvida_de_uso',
    'reembolso',
    'cancelamento_de_compra',
    'cancelamento_de_assinatura',
    'reclamacao_vsl',
    'troca_de_endereco',
    'embalagem_danificada',
    'duvida_de_envio',
    'ingredientes',
    'duvidas_geral',
    'outro'
  ));

-- Linhas existentes têm note NULL e motivo <> 'outro', então a constraint entra
-- validada sem backfill.
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_contact_reason_note_check;

ALTER TABLE public.services
  ADD CONSTRAINT services_contact_reason_note_check
  CHECK (
    CASE
      WHEN contact_reason = 'outro' THEN
        contact_reason_note IS NOT NULL
        AND btrim(contact_reason_note) <> ''
        AND char_length(btrim(contact_reason_note)) <= 200
      ELSE contact_reason_note IS NULL
    END
  );

-- ── 2) my_recent_services: devolve a nota junto do ticket ──────────────────
-- RETURNS TABLE ganhou coluna nova → CREATE OR REPLACE não basta.
DROP FUNCTION IF EXISTS public.my_recent_services(int);

CREATE FUNCTION public.my_recent_services(p_days_back int DEFAULT 30)
RETURNS TABLE(
  id                  text,
  client_email        text,
  service_date        text,
  product             text,
  platform            text,
  channel             text,
  status              text,
  created_at          timestamptz,
  has_tracking_code   boolean,
  contact_reason      text,
  contact_reason_note text,
  user_id             text,
  current_owner_id    text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid      text;
  v_cutoff   date;
  v_view_all boolean;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_view_all := public.is_manager() OR public.can_view_all_tickets();
  v_cutoff   := (now() AT TIME ZONE 'America/Sao_Paulo')::date - p_days_back;

  RETURN QUERY
  SELECT
    s.id,
    s.client_email,
    s.service_date,
    s.product,
    s.platform,
    s.channel,
    s.status,
    s.created_at::timestamptz,
    s.has_tracking_code,
    s.contact_reason,
    s.contact_reason_note,
    s.user_id,
    s.current_owner_id
  FROM public.services s
  WHERE (v_view_all OR s.current_owner_id = v_uid)
    AND (
      -- Created within the window (cheap path; uses lexicographic compare on text)
      s.service_date >= to_char(v_cutoff, 'YYYY-MM-DD')
      -- Or has a follow-up within the window (catches redistributed-old tickets)
      OR EXISTS (
        SELECT 1
        FROM public.service_follow_ups f
        WHERE f.service_id = s.id
          AND (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date >= v_cutoff
      )
    )
  ORDER BY s.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.my_recent_services(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_recent_services(int) TO authenticated;

-- ── 3) claim_ticket: mesma linha de ticket devolvida à tabela do agente ────
DROP FUNCTION IF EXISTS public.claim_ticket(text);

CREATE FUNCTION public.claim_ticket(p_service_id text)
RETURNS TABLE(
  id                  text,
  client_email        text,
  service_date        text,
  product             text,
  platform            text,
  channel             text,
  status              text,
  created_at          timestamptz,
  has_tracking_code   boolean,
  contact_reason      text,
  contact_reason_note text,
  user_id             text,
  current_owner_id    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid           text;
  v_current_owner text;
  v_status        text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT (public.can_claim_tickets() OR public.is_manager()) THEN
    RAISE EXCEPTION 'forbidden: sem permissão para assumir atendimentos';
  END IF;

  SELECT s.current_owner_id, s.status
    INTO v_current_owner, v_status
  FROM public.services s
  WHERE s.id = p_service_id
  FOR UPDATE;

  IF v_current_owner IS NULL THEN
    RAISE EXCEPTION 'Ticket não encontrado';
  END IF;
  IF v_status = 'concluido' THEN
    RAISE EXCEPTION 'Ticket já concluído — não é possível assumir';
  END IF;

  IF v_current_owner <> v_uid THEN
    -- Autoriza a carve-out do trigger só para este UPDATE, para este dono.
    PERFORM set_config('app.claim_owner', v_uid, true);

    -- Alias explícito: as colunas OUT do RETURNS TABLE sombreiam os nomes das
    -- colunas da tabela, então um WHERE id = ... seria ambíguo.
    UPDATE public.services AS svc
    SET current_owner_id = v_uid
    WHERE svc.id = p_service_id;

    INSERT INTO public.ticket_transfers (
      service_id, from_user_id, to_user_id, status, message,
      responded_at, recipient_seen_at, requester_seen_at, assigned_by_manager_id
    ) VALUES (
      p_service_id, v_current_owner, v_uid, 'accepted', 'Atendimento assumido',
      now(), now(), now(), NULL
    );
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.client_email, s.service_date, s.product, s.platform, s.channel,
    s.status, s.created_at::timestamptz, s.has_tracking_code, s.contact_reason,
    s.contact_reason_note, s.user_id, s.current_owner_id
  FROM public.services s
  WHERE s.id = p_service_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ticket(text) TO authenticated;

-- ── 4) export_agent_services: nota vai junto no relatório do agente ────────
-- Corpo idêntico a 20260715120000, somando s.contact_reason_note em ticket_rows
-- (o to_jsonb(t) leva a coluna nova para o JSON sem mais nenhuma mudança).
CREATE OR REPLACE FUNCTION public.export_agent_services(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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

  RETURN v_result;
END;
$$;

-- ── 5) dashboard_contact_reason_notes: a lista de casos excepcionais ───────
-- O relatório da gestora agrega motivo por código (contact_reasons_by_channel):
-- 'outro' apareceria como um balde opaco. Esta RPC devolve a descrição de cada
-- ticket 'outro' do período para virar uma aba própria no Excel — é onde o
-- texto livre vira dado lido. Mesmo recorte de data e filtro de agente da
-- dashboard_export_extras (dia do ticket em São Paulo, s.user_id = criador).
CREATE OR REPLACE FUNCTION public.dashboard_contact_reason_notes(
  from_date date,
  to_date date,
  agent_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.service_day DESC, t.client_email ASC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS service_day,
      COALESCE(s.channel, 'Não informado') AS channel,
      COALESCE(s.product, 'Não informado') AS product,
      s.client_email,
      btrim(s.contact_reason_note) AS note,
      COALESCE(p.full_name, '—') AS agent_name
    FROM public.services s
    LEFT JOIN public.profiles p ON p.id::text = s.user_id
    WHERE s.contact_reason = 'outro'
      AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          BETWEEN from_date AND to_date
      AND (agent_id IS NULL OR s.user_id::text = agent_id)
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_contact_reason_notes(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_contact_reason_notes(date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
