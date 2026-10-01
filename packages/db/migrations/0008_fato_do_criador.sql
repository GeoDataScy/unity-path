-- =====================================================================
-- 0008_fato_do_criador.sql — o último join sai do caminho quente.
--
-- MEDIDO EM PRODUÇÃO, não suposto. Com 0007 aplicada, a consulta de
-- padrão por horário ficou assim:
--
--   varredura do índice de instante   1,6 ms,    19.451 linhas
--   join com core.tickets            66,0 ms,   104.567 linhas na hash
--   -------------------------------------------------------------
--   total                           105,6 ms,    11.777 páginas
--
-- O legado faz a mesma pergunta em 110,6 ms. Ou seja: o índice resolveu,
-- e o join devolveu o problema inteiro.
--
-- O join existia por UMA condição: o legado só conta, no padrão de
-- horário, a interação feita pelo próprio CRIADOR do ticket
-- (`s.user_id = f.user_id`). Não dá para largar a condição — ela corta
-- 7.114 das 61.144 interações, 11,6%.
--
-- Então a condição vira coluna. Sem o join, a mesma consulta custa
-- 29,4 ms e 241 páginas — contra 45.378 páginas do legado.
--
-- `creator_id` não muda na vida de um ticket, então a coluna não precisa
-- ser reescrita no caminho normal. Mesmo assim o gatilho a refaz se
-- alguém mudar o criador, porque garantia que depende de ninguém mexer
-- não é garantia.
-- =====================================================================

ALTER TABLE core.interaction_facts
  ADD COLUMN by_ticket_creator boolean;

COMMENT ON COLUMN core.interaction_facts.by_ticket_creator IS
  'O autor deste evento é o criador do ticket. Na abertura é sempre '
  'verdadeiro. Materializa a condição `s.user_id = f.user_id` que o '
  'legado resolve com join a cada requisição.';

UPDATE core.interaction_facts f
   SET by_ticket_creator = (f.agent_id = t.creator_id)
  FROM core.tickets t
 WHERE f.ticket_id = t.id;

ALTER TABLE core.interaction_facts
  ALTER COLUMN by_ticket_creator SET NOT NULL;

-- Índice parcial com o recorte exato da pergunta: faixa de instante,
-- entre os eventos do criador.
CREATE INDEX facts_relogio_criador_idx
  ON core.interaction_facts (occurred_at)
  WHERE by_ticket_creator;

-- ---------------------------------------------------------------------
-- Gatilhos
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
    (day, occurred_at, agent_id, kind, ticket_id, product_id, platform_id,
     channel_id, contact_reason, has_tracking_code, by_ticket_creator)
  VALUES
    (NEW.business_day, NEW.created_at, NEW.creator_id, 'ticket', NEW.id,
     NEW.product_id, NEW.platform_id, NEW.channel_id, NEW.contact_reason,
     NEW.has_tracking_code, true)   -- a abertura é sempre do criador
  ON CONFLICT (ticket_id) WHERE kind = 'ticket' DO UPDATE
    SET day = EXCLUDED.day, occurred_at = EXCLUDED.occurred_at,
        agent_id = EXCLUDED.agent_id,
        product_id = EXCLUDED.product_id, platform_id = EXCLUDED.platform_id,
        channel_id = EXCLUDED.channel_id, contact_reason = EXCLUDED.contact_reason,
        has_tracking_code = EXCLUDED.has_tracking_code,
        by_ticket_creator = true;

  -- O ticket mudou de dimensão: os fatos das interações dele acompanham.
  IF TG_OP = 'UPDATE' THEN
    UPDATE core.interaction_facts f
       SET product_id = NEW.product_id, platform_id = NEW.platform_id,
           channel_id = NEW.channel_id, contact_reason = NEW.contact_reason,
           has_tracking_code = NEW.has_tracking_code,
           by_ticket_creator = (f.agent_id = NEW.creator_id)
     WHERE f.ticket_id = NEW.id AND f.kind = 'interaction';
  END IF;

  RETURN NEW;
END;
$$;

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
    (day, occurred_at, agent_id, kind, ticket_id, interaction_id, product_id,
     platform_id, channel_id, contact_reason, is_same_day_repeat,
     has_tracking_code, by_ticket_creator)
  VALUES
    -- O dia da interação é o INSTANTE REAL convertido para São Paulo,
    -- não a data escolhida pelo agente no ticket. Aqui os dois eixos
    -- coincidem na origem; na abertura não coincidem.
    ((NEW.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
     NEW.recorded_at,
     NEW.author_id,   -- quem FEZ, que pode não ser o dono do ticket
     'interaction', NEW.ticket_id, NEW.id,
     t.product_id, t.platform_id, t.channel_id, t.contact_reason,
     NEW.is_same_day_repeat, t.has_tracking_code,
     NEW.author_id = t.creator_id)
  ON CONFLICT (interaction_id) WHERE kind = 'interaction' DO UPDATE
    SET day = EXCLUDED.day, occurred_at = EXCLUDED.occurred_at,
        agent_id = EXCLUDED.agent_id,
        is_same_day_repeat = EXCLUDED.is_same_day_repeat,
        by_ticket_creator = EXCLUDED.by_ticket_creator;

  RETURN NEW;
END;
$$;

ANALYZE core.interaction_facts;
