-- =====================================================================
-- 0004_reembolsos.sql — reembolsos e o log de quem mexeu neles.
--
-- Três correções que o levantamento pediu, cada uma por um número medido:
--
-- 1. `refund_value` era `double precision`. Dinheiro em ponto flutuante
--    soma errado: 0.1 + 0.2 não dá 0.3. Vira `numeric(12,2)`.
-- 2. `refund_type` era texto de percentual com 21 variantes, sendo
--    `05%` com zero à esquerda e os demais sem, o que quebra ordenação.
--    Vira número inteiro; o rótulo é formatado na tela.
-- 3. `request_date` e `completion_date` eram texto. Viram `date`.
--
-- Mais: a categoria do motivo, hoje numa tabela à parte alimentada por
-- gatilho, passa a ser coluna com catálogo. E a baixa, que hoje o agente
-- faz sem validação e a gestora faz com, passa a ser uma rota só.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo de categorias de motivo
--
-- Mesmo princípio dos outros catálogos: aberto para ler o passado,
-- fechado para escrever o futuro.
-- ---------------------------------------------------------------------

CREATE TABLE core.refund_reason_categories (
  id            smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  code          citext NOT NULL UNIQUE,
  label         text NOT NULL,
  kind          core.catalog_kind NOT NULL DEFAULT 'value',
  is_selectable boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION core.resolve_refund_category(p_text text)
RETURNS smallint
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
DECLARE v_id smallint; v_clean text := btrim(coalesce(p_text, ''));
BEGIN
  IF v_clean = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM core.refund_reason_categories WHERE code = v_clean::citext;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO core.refund_reason_categories (code, label, kind, is_selectable, sort_order)
  VALUES (v_clean, v_clean, 'misfiled', false, 900) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- Reembolsos
-- ---------------------------------------------------------------------

CREATE TABLE core.refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id           uuid REFERENCES core.tickets(id),
  agent_id            uuid NOT NULL REFERENCES core.users(id),

  order_id            text NOT NULL,
  customer_email      text NOT NULL,
  customer_email_normalized citext GENERATED ALWAYS AS (lower(btrim(customer_email))) STORED,

  platform_id         smallint REFERENCES core.sales_platforms(id),
  channel_id          smallint REFERENCES core.channels(id),
  product_id          uuid REFERENCES core.products(id),

  request_date        date NOT NULL,
  completion_date     date,

  -- Dinheiro em decimal exato, nunca em ponto flutuante.
  -- A moeda é dólar em todo o sistema (decisão D4). A coluna existe para
  -- que o rótulo não possa divergir do dado, como aconteceu até 26/09.
  refund_value        numeric(12,2),
  currency            char(3) NOT NULL DEFAULT 'USD',

  -- Percentual como NÚMERO. `05%` e `5%` deixam de ser coisas diferentes.
  refund_percent      smallint,

  reason              text,
  reason_category_id  smallint REFERENCES core.refund_reason_categories(id),

  items_returned      boolean NOT NULL DEFAULT false,
  created_from_ticket boolean NOT NULL DEFAULT false,

  picked_up_at        timestamptz,
  picked_up_by        uuid REFERENCES core.users(id),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  legacy_id           text UNIQUE,
  legacy_refund_type  text,      -- o texto original do percentual
  legacy_platform     text,
  legacy_channel      text,

  CONSTRAINT refunds_percent_range CHECK (refund_percent IS NULL
                                          OR refund_percent BETWEEN 0 AND 100),
  CONSTRAINT refunds_value_not_negative CHECK (refund_value IS NULL OR refund_value >= 0)
);

-- Um reembolso por ticket. Hoje é índice único parcial no legado.
CREATE UNIQUE INDEX refunds_one_per_ticket
  ON core.refunds (ticket_id) WHERE ticket_id IS NOT NULL;

CREATE INDEX refunds_agent_request_idx  ON core.refunds (agent_id, request_date DESC);
CREATE INDEX refunds_open_idx           ON core.refunds (agent_id, request_date DESC)
                                        WHERE completion_date IS NULL;
CREATE INDEX refunds_open_by_email_idx  ON core.refunds (customer_email_normalized)
                                        WHERE completion_date IS NULL;
CREATE INDEX refunds_completion_idx     ON core.refunds (completion_date)
                                        WHERE completion_date IS NOT NULL;

-- ---------------------------------------------------------------------
-- Log de eventos
--
-- Hoje só a baixa feita pela gestora é auditada, numa tabela à parte. O
-- agente dá baixa com um UPDATE direto, sem registro e sem validação.
-- Aqui toda ação que mexe em dinheiro ou em dono deixa rastro (G8.3).
-- ---------------------------------------------------------------------

CREATE TYPE core.refund_event_kind AS ENUM (
  'created', 'picked_up', 'completed', 'reopened', 'edited', 'deleted'
);

CREATE TABLE core.refund_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  refund_id   uuid NOT NULL REFERENCES core.refunds(id) ON DELETE CASCADE,
  kind        core.refund_event_kind NOT NULL,
  actor_id    uuid NOT NULL REFERENCES core.users(id),
  /* estado relevante no momento do evento, para auditoria não depender
     de reconstruir a linha a partir do histórico */
  snapshot    jsonb,
  note        text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  legacy_id   text UNIQUE
);

CREATE INDEX refund_events_refund_idx ON core.refund_events (refund_id, recorded_at DESC);
CREATE INDEX refund_events_actor_idx  ON core.refund_events (actor_id, recorded_at DESC);

-- ---------------------------------------------------------------------
-- Regras que valem só para escrita nova
--
-- Mesmo critério do catálogo: linha com `legacy_id` é travessia e entra
-- como está. O histórico tem 39 baixas anteriores à solicitação e 1.242
-- reembolsos sem percentual — eles atravessam, e a regra passa a valer
-- daqui para a frente.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.enforce_refund_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
BEGIN
  IF NEW.legacy_id IS NOT NULL THEN
    RETURN NEW;  -- travessia
  END IF;

  IF NEW.completion_date IS NOT NULL AND NEW.completion_date < NEW.request_date THEN
    RAISE EXCEPTION 'baixa (%) anterior a solicitacao (%)', NEW.completion_date, NEW.request_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- Baixa completa exige valor, percentual e motivo. Hoje só a gestora
  -- passa por essa validação; o agente escreve direto na tabela.
  IF NEW.completion_date IS NOT NULL
     AND (NEW.refund_value IS NULL OR NEW.refund_percent IS NULL
          OR nullif(btrim(coalesce(NEW.reason, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'baixa exige valor, percentual e motivo'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_enforce_rules
BEFORE INSERT OR UPDATE ON core.refunds
FOR EACH ROW EXECUTE FUNCTION core.enforce_refund_rules();

GRANT SELECT, INSERT, UPDATE, DELETE
  ON core.refunds, core.refund_events, core.refund_reason_categories TO api_request;
