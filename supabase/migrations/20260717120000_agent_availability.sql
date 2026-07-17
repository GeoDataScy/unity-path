-- Disponibilidade de agente ("de folga / indisponível") + flag do aprovador.
--
-- Contexto: quando um cliente volta a escrever e o ticket em aberto pertence a
-- um agente que está DE FOLGA, o colega que pegou o atendimento não tem a quem
-- encaminhar (o dono não responde). A saída é pedir aprovação da gestora
-- responsável. Esta migration cria as duas primitivas que faltavam:
--
--   1. profiles.is_available  — false = de folga/indisponível. A gestora marca
--      isso na aba Usuários (RPC manager_set_agent_availability). Não existe
--      conceito de folga hoje; is_active é bloqueio de login (coisa diferente).
--
--   2. profiles.can_approve_takeovers — quem recebe os pedidos de aprovação.
--      Ligado só para a gestora responsável (hoje, Jessica Machado). Segue a
--      convenção do projeto: uma capacidade = um boolean. Trocar o aprovador no
--      futuro é só ligar o flag em outro perfil, sem mexer no código.
--
-- Também estende find_ticket_by_email para informar se o dono operacional do
-- ticket está disponível, de modo que a tela do agente saiba se deve oferecer
-- "Encaminhar" (dono disponível) ou "Solicitar aprovação da gestora" (de folga).

-- ============================================================================
-- 1) Colunas em profiles
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_available          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_approve_takeovers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_available IS
  'false = agente de folga/indisponível. Marcado pela gestora na aba Usuários. Não confundir com is_active (bloqueio de login).';
COMMENT ON COLUMN public.profiles.can_approve_takeovers IS
  'true = recebe e aprova os pedidos de tomada de ticket de agentes de folga. Ligado só para a gestora responsável.';

-- Liga o flag para a gestora responsável atual (Jessica). Idempotente.
UPDATE public.profiles
  SET can_approve_takeovers = true
  WHERE lower(email) = 'jessicamachado@suportexmx.com';

-- ============================================================================
-- 2) manager_set_agent_availability — a gestora marca folga/disponível
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_set_agent_availability(
  p_target_user_id text,
  p_available       boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_target_user_id IS NULL OR length(p_target_user_id) = 0 THEN
    RAISE EXCEPTION 'p_target_user_id is required';
  END IF;

  UPDATE public.profiles
    SET is_available = COALESCE(p_available, true)
    WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found: %', p_target_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manager_set_agent_availability(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_set_agent_availability(text, boolean) TO authenticated;

-- ============================================================================
-- 3) find_ticket_by_email — informa a disponibilidade do dono operacional
-- ============================================================================
-- DROP + CREATE porque o RETURNS TABLE muda de forma (nova coluna).
DROP FUNCTION IF EXISTS public.find_ticket_by_email(text);

CREATE OR REPLACE FUNCTION public.find_ticket_by_email(p_email text)
RETURNS TABLE(
  id text,
  user_id text,
  current_owner_id text,
  agent_name text,
  current_owner_name text,
  current_owner_is_available boolean,
  client_email text,
  product text,
  platform text,
  channel text,
  status text,
  service_date timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.id::text,
    s.user_id::text,
    s.current_owner_id::text,
    p.full_name           AS agent_name,
    pc.full_name          AS current_owner_name,
    -- Disponibilidade do dono OPERACIONAL (current_owner). Se não houver
    -- current_owner, cai no criador (p). Default true por segurança.
    COALESCE(pc.is_available, p.is_available, true) AS current_owner_is_available,
    s.client_email,
    s.product,
    s.platform,
    s.channel,
    s.status,
    s.service_date::timestamptz,
    s.created_at::timestamptz
  FROM public.services s
  LEFT JOIN public.profiles p  ON p.id::text  = s.user_id::text
  LEFT JOIN public.profiles pc ON pc.id::text = s.current_owner_id::text
  WHERE LOWER(TRIM(s.client_email)) = LOWER(TRIM(p_email))
    AND s.status <> 'concluido'
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_ticket_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_ticket_by_email(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
