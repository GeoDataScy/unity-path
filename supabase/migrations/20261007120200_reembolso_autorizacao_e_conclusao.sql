-- Prazo de conclusão do reembolso: até 48h úteis após a autorização da
-- plataforma de venda (doc XMX-2026/IMP-SUP-01-A v2, seção 4).
--
-- authorized_at: quando a plataforma autorizou (informado pelo prestador ao concluir).
-- completed_at:  instante real da conclusão. completion_date é text só com a data
--                e não serve para contar horas.
--
-- Sem backfill: linhas antigas ficam com as duas colunas nulas e fora do cálculo.
--
-- TODO(v2): portar para o core na virada da arquitetura v2.

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz NULL;

CREATE OR REPLACE FUNCTION public.refunds_set_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.completion_date IS NOT NULL
     AND btrim(NEW.completion_date) <> ''
     AND (TG_OP = 'INSERT' OR OLD.completion_date IS NULL OR btrim(OLD.completion_date) = '')
     AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refunds_set_completed_at ON public.refunds;
CREATE TRIGGER trg_refunds_set_completed_at
  BEFORE INSERT OR UPDATE OF completion_date ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.refunds_set_completed_at();
