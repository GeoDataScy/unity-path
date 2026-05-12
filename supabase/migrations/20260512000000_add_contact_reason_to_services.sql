-- Add contact_reason to services for tagging the purpose of each ticket.
-- Nullable so existing rows keep working unchanged; new tickets are validated
-- against a fixed catalog. New values require a follow-up migration so the
-- manager dashboards stay aligned with the agent UI.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS contact_reason text;

DO $$ BEGIN
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
      'duvidas_geral'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_services_contact_reason
  ON public.services(contact_reason);

NOTIFY pgrst, 'reload schema';
