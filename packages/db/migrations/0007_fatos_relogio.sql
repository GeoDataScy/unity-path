-- =====================================================================
-- 0007_fatos_relogio.sql — o eixo do RELÓGIO na tabela de fatos.
--
-- 0006 deu à tabela de fatos o eixo do CALENDÁRIO: `day`, que para a
-- abertura é a data escolhida pelo agente (`business_day`). É o eixo que
-- todos os painéis de volume usam, e está certo para eles.
--
-- Mas `dashboard_hourly_pattern` pergunta outra coisa: a que HORA o
-- trabalho aconteceu. Para isso ela usa `services.created_at`, o instante
-- real, **não** `service_date`. E paga caro: varre as duas tabelas
-- SETE vezes, cada vez convertendo fuso por linha.
--
-- Os dois eixos são diferentes de propósito e os dois são necessários:
--
--   `day`         o dia que o agente declarou  → volume, metas, ritmo
--   `occurred_at` o instante real do registro  → hora do dia, turno, pico
--
-- Um agente que registra à meia-noite o atendimento de ontem aparece no
-- dia de ontem no primeiro eixo e na madrugada no segundo. É isso que o
-- legado faz hoje, e é o que a gestora espera ver.
--
-- O recorte por data vira comparação de FAIXA em timestamptz, convertida
-- na borda — não por linha. Assim o índice serve a consulta, que é a
-- diferença entre 151 ms e 4 ms.
-- =====================================================================

ALTER TABLE core.interaction_facts
  ADD COLUMN occurred_at timestamptz;

COMMENT ON COLUMN core.interaction_facts.occurred_at IS
  'O instante real do registro: created_at do ticket na abertura, '
  'recorded_at na interação. Eixo do relógio, distinto de `day`, que é o '
  'eixo do calendário declarado pelo agente.';

-- Preenche o que já existe. No mesmo arquivo da adição de propósito:
-- assim não há janela em que a coluna exista pela metade.
UPDATE core.interaction_facts f
   SET occurred_at = t.created_at
  FROM core.tickets t
 WHERE f.kind = 'ticket' AND f.ticket_id = t.id;

UPDATE core.interaction_facts f
   SET occurred_at = i.recorded_at
  FROM core.interactions i
 WHERE f.kind = 'interaction' AND f.interaction_id = i.id;

ALTER TABLE core.interaction_facts
  ALTER COLUMN occurred_at SET NOT NULL;

-- Recorte por faixa de instante, com e sem filtro de agente.
CREATE INDEX facts_occurred_idx       ON core.interaction_facts (occurred_at);
CREATE INDEX facts_agent_occurred_idx ON core.interaction_facts (agent_id, occurred_at);

-- ---------------------------------------------------------------------
-- Os gatilhos passam a manter o eixo novo.
--
-- `CREATE OR REPLACE` nas duas funções: os gatilhos em si não mudam, só
-- o corpo. Quem grava direto no banco continua gerando fato correto.
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
     channel_id, contact_reason, has_tracking_code)
  VALUES
    (NEW.business_day, NEW.created_at, NEW.creator_id, 'ticket', NEW.id,
     NEW.product_id, NEW.platform_id, NEW.channel_id, NEW.contact_reason,
     NEW.has_tracking_code)
  ON CONFLICT (ticket_id) WHERE kind = 'ticket' DO UPDATE
    SET day = EXCLUDED.day, occurred_at = EXCLUDED.occurred_at,
        agent_id = EXCLUDED.agent_id,
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
     has_tracking_code)
  VALUES
    -- O dia da interação é o INSTANTE REAL convertido para São Paulo,
    -- não a data escolhida pelo agente no ticket. Aqui os dois eixos
    -- coincidem na origem; na abertura não coincidem.
    ((NEW.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
     NEW.recorded_at,
     NEW.author_id,   -- quem FEZ, que pode não ser o dono do ticket
     'interaction', NEW.ticket_id, NEW.id,
     t.product_id, t.platform_id, t.channel_id, t.contact_reason,
     NEW.is_same_day_repeat, t.has_tracking_code)
  ON CONFLICT (interaction_id) WHERE kind = 'interaction' DO UPDATE
    SET day = EXCLUDED.day, occurred_at = EXCLUDED.occurred_at,
        agent_id = EXCLUDED.agent_id,
        is_same_day_repeat = EXCLUDED.is_same_day_repeat;

  RETURN NEW;
END;
$$;

ANALYZE core.interaction_facts;
