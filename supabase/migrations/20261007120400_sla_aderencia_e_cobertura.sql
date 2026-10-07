-- Aderência à Base de Suporte e propostas de cobertura (doc XMX-2026/IMP-SUP-01-A v2).
--
-- sla_aderencia_mensal: a Imperium apura e a gestora lança; a plataforma só exibe.
--   Meta contratual: 95%.
-- sla_cobertura_propostas: só registro de proposta aceita. Não gera alerta nem meta.
--
-- TODO(v2): portar para o core na virada da arquitetura v2.

CREATE TABLE IF NOT EXISTS public.sla_aderencia_mensal (
  user_id     text    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mes         date    NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  pct         numeric NOT NULL CHECK (pct >= 0 AND pct <= 100),
  lancado_por text,
  lancado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mes)
);

ALTER TABLE public.sla_aderencia_mensal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_aderencia_select ON public.sla_aderencia_mensal;
CREATE POLICY sla_aderencia_select ON public.sla_aderencia_mensal
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())::text OR (SELECT public.is_manager()));

DROP POLICY IF EXISTS sla_aderencia_manager_write ON public.sla_aderencia_mensal;
CREATE POLICY sla_aderencia_manager_write ON public.sla_aderencia_mensal
  FOR ALL TO authenticated
  USING ((SELECT public.is_manager()))
  WITH CHECK ((SELECT public.is_manager()));

CREATE OR REPLACE FUNCTION public.sla_aderencia_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.lancado_em  := now();
  NEW.lancado_por := auth.uid()::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sla_aderencia_touch ON public.sla_aderencia_mensal;
CREATE TRIGGER trg_sla_aderencia_touch
  BEFORE INSERT OR UPDATE ON public.sla_aderencia_mensal
  FOR EACH ROW EXECUTE FUNCTION public.sla_aderencia_touch();

CREATE TABLE IF NOT EXISTS public.sla_cobertura_propostas (
  user_id       text    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dia           date    NOT NULL,
  multiplicador numeric NOT NULL DEFAULT 1.5 CHECK (multiplicador > 0),
  aceita_por    text,
  aceita_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dia)
);

ALTER TABLE public.sla_cobertura_propostas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_cobertura_select ON public.sla_cobertura_propostas;
CREATE POLICY sla_cobertura_select ON public.sla_cobertura_propostas
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())::text OR (SELECT public.is_manager()));

DROP POLICY IF EXISTS sla_cobertura_manager_write ON public.sla_cobertura_propostas;
CREATE POLICY sla_cobertura_manager_write ON public.sla_cobertura_propostas
  FOR ALL TO authenticated
  USING ((SELECT public.is_manager()))
  WITH CHECK ((SELECT public.is_manager()));
