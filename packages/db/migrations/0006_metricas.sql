-- =====================================================================
-- 0006_metricas.sql — a tabela de fatos que substitui `_interaction_events`.
--
-- Hoje as métricas derivam de uma FUNÇÃO que une `services` e
-- `service_follow_ups` convertendo `service_date` (texto) com fuso, por
-- linha. O predicado é não indexável, e `dashboard_metrics` chama essa
-- função SEIS vezes numa requisição. A tela de acompanhamento dispara
-- oito dessas em paralelo. Foi o que derrubou o banco em 24/07/2026.
--
-- Aqui vira TABELA, mantida por gatilho no mesmo commit da escrita.
-- A pergunta "quantos atendimentos a Ana fez em agosto" passa a ser uma
-- varredura de índice sobre algumas dezenas de milhares de linhas.
--
-- SEMÂNTICA — cópia fiel de `public._interaction_events`, senão os
-- números da v2 não batem com os de hoje:
--
--   evento de ABERTURA  dia = `business_day` (a data que o agente escolheu)
--                       agente = o criador do ticket
--   evento de INTERAÇÃO dia = `recorded_at` convertido para São Paulo
--                       agente = o AUTOR da interação, que pode ser outro
--
-- Essa diferença é real e não é descuido: um agente pode interagir no
-- ticket de outro, e a produtividade conta para quem fez.
-- =====================================================================

CREATE TYPE core.fact_kind AS ENUM ('ticket', 'interaction');

CREATE TABLE core.interaction_facts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  day                date NOT NULL,
  agent_id           uuid NOT NULL REFERENCES core.users(id),
  kind               core.fact_kind NOT NULL,

  ticket_id          uuid NOT NULL REFERENCES core.tickets(id) ON DELETE CASCADE,
  interaction_id     uuid REFERENCES core.interactions(id) ON DELETE CASCADE,

  -- Dimensões copiadas do ticket, para o dashboard agrupar sem juntar
  -- tabela. Se o ticket mudar de produto, o gatilho reescreve os fatos.
  product_id         uuid NOT NULL REFERENCES core.products(id),
  platform_id        smallint REFERENCES core.sales_platforms(id),
  channel_id         smallint REFERENCES core.channels(id),
  contact_reason     core.contact_reason,

  is_same_day_repeat boolean NOT NULL DEFAULT false,
  has_tracking_code  boolean NOT NULL DEFAULT false,

  CONSTRAINT facts_interaction_matches_kind
    CHECK ((kind = 'ticket' AND interaction_id IS NULL)
        OR (kind = 'interaction' AND interaction_id IS NOT NULL))
);

-- Um fato por ticket e um por interação. É o que impede contagem dobrada.
CREATE UNIQUE INDEX facts_one_per_ticket
  ON core.interaction_facts (ticket_id) WHERE kind = 'ticket';
CREATE UNIQUE INDEX facts_one_per_interaction
  ON core.interaction_facts (interaction_id) WHERE kind = 'interaction';

-- O recorte de todo dashboard: período, e opcionalmente um agente.
CREATE INDEX facts_day_agent_idx ON core.interaction_facts (day, agent_id);
CREATE INDEX facts_agent_day_idx ON core.interaction_facts (agent_id, day);
CREATE INDEX facts_ticket_idx    ON core.interaction_facts (ticket_id);

COMMENT ON TABLE core.interaction_facts IS
  'Uma linha por evento contável: a abertura do ticket e cada interação. '
  'Substitui a função public._interaction_events, que varria duas tabelas '
  'com predicado não indexável e era chamada 6 a 9 vezes por requisição.';

-- ---------------------------------------------------------------------
-- Manutenção por gatilho
--
-- No mesmo commit da escrita (G1.1). Não é a API que alimenta: se algum
-- script gravar direto, a métrica continua certa.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.sync_ticket_fact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;  -- ON DELETE CASCADE cuida
  END IF;

  INSERT INTO core.interaction_facts
    (day, agent_id, kind, ticket_id, product_id, platform_id, channel_id,
     contact_reason, has_tracking_code)
  VALUES
    (NEW.business_day, NEW.creator_id, 'ticket', NEW.id, NEW.product_id,
     NEW.platform_id, NEW.channel_id, NEW.contact_reason, NEW.has_tracking_code)
  ON CONFLICT (ticket_id) WHERE kind = 'ticket' DO UPDATE
    SET day = EXCLUDED.day, agent_id = EXCLUDED.agent_id,
        product_id = EXCLUDED.product_id, platform_id = EXCLUDED.platform_id,
        channel_id = EXCLUDED.channel_id, contact_reason = EXCLUDED.contact_reason,
        has_tracking_code = EXCLUDED.has_tracking_code;

  -- O ticket mudou de dimensão: os fatos das interações dele acompanham.
  IF TG_OP = 'UPDATE' THEN
    UPDATE core.interaction_facts f
       SET product_id = NEW.product_id, platform_id = NEW.platform_id,
           channel_id = NEW.channel_id, contact_reason = NEW.contact_reason,
           has_tracking_code = NEW.has_tracking_code
     WHERE f.ticket_id = NEW.id AND f.kind = 'interaction';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tickets_sync_fact
AFTER INSERT OR UPDATE OF business_day, creator_id, product_id, platform_id,
                          channel_id, contact_reason, has_tracking_code
ON core.tickets
FOR EACH ROW EXECUTE FUNCTION core.sync_ticket_fact();

CREATE OR REPLACE FUNCTION core.sync_interaction_fact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
DECLARE t core.tickets%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT * INTO t FROM core.tickets WHERE id = NEW.ticket_id;

  INSERT INTO core.interaction_facts
    (day, agent_id, kind, ticket_id, interaction_id, product_id, platform_id,
     channel_id, contact_reason, is_same_day_repeat, has_tracking_code)
  VALUES
    -- O dia da interação é o INSTANTE REAL convertido para São Paulo,
    -- não a data escolhida pelo agente no ticket.
    ((NEW.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
     NEW.author_id,   -- quem FEZ, que pode não ser o dono do ticket
     'interaction', NEW.ticket_id, NEW.id,
     t.product_id, t.platform_id, t.channel_id, t.contact_reason,
     NEW.is_same_day_repeat, t.has_tracking_code)
  ON CONFLICT (interaction_id) WHERE kind = 'interaction' DO UPDATE
    SET day = EXCLUDED.day, agent_id = EXCLUDED.agent_id,
        is_same_day_repeat = EXCLUDED.is_same_day_repeat;

  RETURN NEW;
END;
$$;

CREATE TRIGGER interactions_sync_fact
AFTER INSERT OR UPDATE OF recorded_at, author_id, is_same_day_repeat
ON core.interactions
FOR EACH ROW EXECUTE FUNCTION core.sync_interaction_fact();

GRANT SELECT, INSERT, UPDATE, DELETE ON core.interaction_facts TO api_request;
GRANT USAGE, SELECT ON SEQUENCE core.interaction_facts_id_seq TO api_request;
