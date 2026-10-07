-- Contrato de cada prestador (doc XMX-2026/IMP-SUP-01-A v2): base da capacidade
-- do pacote e, nas próximas tasks, do cabeçalho com CNPJ e da exportação.
--
-- Prestador sem linha aqui usa capacidade 100 por dia útil (padrão do contrato).
--
-- TODO(v2): portar para o core na virada da arquitetura v2.

CREATE TABLE IF NOT EXISTS public.provider_contracts (
  user_id             text PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  razao_social        text,
  cnpj                text,
  contrato_numero     text,
  pacote_nome         text,
  capacidade_dia_util int  NOT NULL DEFAULT 100 CHECK (capacidade_dia_util > 0),
  vigencia_inicio     date,
  vigencia_fim        date,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  CONSTRAINT provider_contracts_vigencia_chk
    CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio)
);

ALTER TABLE public.provider_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_contracts_select ON public.provider_contracts;
CREATE POLICY provider_contracts_select ON public.provider_contracts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())::text OR (SELECT public.is_manager()));

DROP POLICY IF EXISTS provider_contracts_manager_write ON public.provider_contracts;
CREATE POLICY provider_contracts_manager_write ON public.provider_contracts
  FOR ALL TO authenticated
  USING ((SELECT public.is_manager()))
  WITH CHECK ((SELECT public.is_manager()));

-- updated_at / updated_by preenchidos no banco, não no cliente.
CREATE OR REPLACE FUNCTION public.provider_contracts_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid()::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provider_contracts_touch ON public.provider_contracts;
CREATE TRIGGER trg_provider_contracts_touch
  BEFORE INSERT OR UPDATE ON public.provider_contracts
  FOR EACH ROW EXECUTE FUNCTION public.provider_contracts_touch();

-- Capacidade por dia útil de um prestador (100 se não houver contrato).
CREATE OR REPLACE FUNCTION public.provider_capacity_per_business_day(p_user_id text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT c.capacidade_dia_util FROM public.provider_contracts c WHERE c.user_id = p_user_id),
    100
  );
$$;

REVOKE EXECUTE ON FUNCTION public.provider_capacity_per_business_day(text) FROM PUBLIC, anon, authenticated;
