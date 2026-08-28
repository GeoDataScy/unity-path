-- "Reclamação VSL" também pede a descrição livre do agente.
--
-- Problema: o código 'reclamacao_vsl' só conta QUANTAS reclamações de anúncio
-- houve. Qual promessa o cliente cobrou ("prometia resultado em 7 dias",
-- "dizia que era aprovado pela FDA") ficava fora do banco — e é exatamente o
-- que o time de copy precisa para corrigir o anúncio.
--
-- Solução: reusar services.contact_reason_note (criada em
-- 20260818140000_contact_reason_outro_note.sql) no motivo 'reclamacao_vsl'. É o
-- mesmo campo, com o mesmo teto de 200 caracteres.
--
-- Obrigatoriedade: a UI exige o texto para registrar/editar um ticket VSL. O
-- CHECK aqui é deliberadamente mais frouxo — apenas PERMITE a nota — porque os
-- tickets VSL antigos têm nota NULL, e um CHECK obrigatório quebraria qualquer
-- UPDATE neles (concluir o atendimento, marcar código de rastreio). Para
-- 'outro' a nota continua obrigatória: lá nunca existiu linha sem nota.

-- ── 1) CHECK: nota permitida no VSL, obrigatória no 'outro' ────────────────
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
      WHEN contact_reason = 'reclamacao_vsl' THEN
        contact_reason_note IS NULL
        OR (
          btrim(contact_reason_note) <> ''
          AND char_length(btrim(contact_reason_note)) <= 200
        )
      ELSE contact_reason_note IS NULL
    END
  );

COMMENT ON COLUMN public.services.contact_reason_note IS
  'Descrição livre do motivo quando contact_reason = ''outro'' (obrigatória) ou ''reclamacao_vsl'' (obrigatória na UI, opcional no banco por causa dos tickets antigos). NULL nos demais motivos.';

-- ── 2) dashboard_contact_reason_notes: VSL entra na mesma aba ──────────────
-- Corpo idêntico a 20260818140000, com duas mudanças: o filtro passa a aceitar
-- os dois motivos que carregam nota (só linhas COM texto — os VSL antigos, sem
-- nota, não têm o que mostrar) e a linha devolve o código do motivo para o
-- Excel conseguir separar "Outro" de "Reclamação VSL".
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
      s.contact_reason AS reason,
      btrim(s.contact_reason_note) AS note,
      COALESCE(p.full_name, '—') AS agent_name
    FROM public.services s
    LEFT JOIN public.profiles p ON p.id::text = s.user_id
    WHERE s.contact_reason IN ('outro', 'reclamacao_vsl')
      AND s.contact_reason_note IS NOT NULL
      AND btrim(s.contact_reason_note) <> ''
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
