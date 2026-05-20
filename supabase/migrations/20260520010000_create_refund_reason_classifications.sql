-- Refund reason normalization.
--
-- Refunds.reason is preserved as-is (free text history). A separate table holds
-- the normalized category that powers analytics, so historical text is never
-- mutated.

CREATE TABLE IF NOT EXISTS public.refund_reason_classifications (
  refund_id text PRIMARY KEY REFERENCES public.refunds(id) ON DELETE CASCADE,
  original_reason text,
  category text NOT NULL,
  classification_method text NOT NULL DEFAULT 'auto' CHECK (classification_method IN ('auto', 'manual')),
  classified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_reason_classifications_category
  ON public.refund_reason_classifications (category);

ALTER TABLE public.refund_reason_classifications ENABLE ROW LEVEL SECURITY;

-- Only managers can read this analytics-facing table. Inserts/updates go
-- through the trigger using SECURITY DEFINER, so no policy is needed for write.
DROP POLICY IF EXISTS "managers can read refund reason classifications"
  ON public.refund_reason_classifications;

CREATE POLICY "managers can read refund reason classifications"
  ON public.refund_reason_classifications
  FOR SELECT
  USING (public.is_manager());

-- ─────────────────────────────────────────────────────────────────────────────
-- Classifier function. Maps a free-text reason into one of the 15 canonical
-- categories. Order matters: more specific patterns (medical, chargeback) run
-- before generic ones (insatisfação) so a refund mentioning both lands in the
-- more actionable bucket.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.classify_refund_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  r text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN 'Outros';
  END IF;

  r := lower(p_reason);

  -- Specific business categories first (high signal, narrow patterns).
  IF r ~ '(m[eé]dico|prescri|intera[cç][aã]o medic|efeito colateral|efeitos colaterais|rea[cç][aã]o al[eé]rgica|alergia|al[eé]rgic|contraindica|contra-indica|n[aã]o podia fazer o uso)' THEN
    RETURN 'Indicação médica / efeitos colaterais';
  END IF;

  IF r ~ 'chargeback' THEN
    RETURN 'Risco de chargeback';
  END IF;

  IF r ~ '(vsl|propaganda enganosa|reclama[cç][aã]o vsl)' THEN
    RETURN 'Reclamação VSL / Propaganda';
  END IF;

  IF r ~ '(follow.?up|aguardando retorno)' THEN
    RETURN 'Follow up (sem motivo declarado)';
  END IF;

  -- Canonical 11 categories.
  IF r ~ '(n[aã]o reconhece|n[aã]o comprou|alega n[aã]o ter comprado|n[aã]o foi eu|fraude)' THEN
    RETURN 'Não reconhece a compra';
  END IF;

  IF r ~ '(duplicad|em dobro|duas vezes)' THEN
    RETURN 'Compra duplicada';
  END IF;

  IF r ~ '(recorrente|recorr[eê]ncia|assinatura cobrada|cobran[cç]a recorrente)' THEN
    RETURN 'Cobrança recorrente';
  END IF;

  IF r ~ '(atraso|demora|n[aã]o chegou|n[aã]o recebeu|n[aã]o entregue|sem entrega|n[aã]o foi entregue|pedido n[aã]o entreg|sem acesso|n[aã]o recebi acesso|n[aã]o recebido|devolvido ao remetente)' THEN
    RETURN 'Atraso na entrega/acesso';
  END IF;

  IF r ~ '(excesso|upsell|upssel|comprou demais|excesso de compra|excesso de upsell)' THEN
    RETURN 'Compra em excesso';
  END IF;

  IF r ~ '(arrependimento|arrependeu|desisti|desist[eê]ncia|engano|n[aã]o quer mais|sem interesse|n[aã]o tem mais interesse|aceitou oferta parcial|aceitou oferta sem devolu|aceitou a oferta|aceitou os \d+%|n[aã]o queria mais o produto|cliente devolveu)' THEN
    RETURN 'Arrependimento de compra';
  END IF;

  IF r ~ '(dificuldade|n[aã]o consegue usar|complicad|n[aã]o sei usar|n[aã]o consigo usar)' THEN
    RETURN 'Dificuldade de uso';
  END IF;

  IF r ~ '(t[eé]cnic|erro|bug|n[aã]o instala|defeito|quebrad|n[aã]o abre|link n[aã]o funciona)' THEN
    RETURN 'Problemas técnicos';
  END IF;

  IF r ~ '(n[aã]o funcionou|sem resultad|n[aã]o obteve|sem efeito|n[aã]o teve resultad|esperava mais|esperad|n[aã]o sentiu diferen[cç]a|falta de resultad|n[aã]o ter tido resultad|n[aã]o ter obtido resultad)' THEN
    RETURN 'Produto não funcionou como esperado';
  END IF;

  -- Most generic — must come last so it doesn't swallow specific cases.
  IF r ~ '(insatisf|n[aã]o gost|n[aã]o curti|n[aã]o atendeu|cliente insatisf|n[aã]o estava satisf)' THEN
    RETURN 'Insatisfação com o produto';
  END IF;

  RETURN 'Outros';
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: keep classification in sync with refunds.reason.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_refund_reason_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.refund_reason_classifications (
    refund_id, original_reason, category, classification_method, classified_at, updated_at
  )
  VALUES (
    NEW.id, NEW.reason, public.classify_refund_reason(NEW.reason), 'auto', now(), now()
  )
  ON CONFLICT (refund_id) DO UPDATE
  SET
    original_reason = EXCLUDED.original_reason,
    -- Don't overwrite manual classifications.
    category = CASE
      WHEN public.refund_reason_classifications.classification_method = 'manual'
        THEN public.refund_reason_classifications.category
      ELSE EXCLUDED.category
    END,
    updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_refund_reason_classification ON public.refunds;

CREATE TRIGGER trg_sync_refund_reason_classification
  AFTER INSERT OR UPDATE OF reason ON public.refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_refund_reason_classification();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill existing refunds.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.refund_reason_classifications (
  refund_id, original_reason, category, classification_method, classified_at, updated_at
)
SELECT
  r.id,
  r.reason,
  public.classify_refund_reason(r.reason),
  'auto',
  now(),
  now()
FROM public.refunds r
ON CONFLICT (refund_id) DO NOTHING;
