-- =====================================================================
-- 0002_catalogos.sql — catálogo único de plataformas e canais.
--
-- Decisão do dono (28/09/2026):
--   1. Catálogo único no banco, servindo as duas telas.
--   2. "Nenhum" passa a ser valor nomeado.
--   3. A regra nova vale DAQUI PARA A FRENTE. O passado segue inalterado,
--      e nenhum dado pode ser perdido na travessia.
--
-- O princípio que faz as três conviverem:
--
--   O CATÁLOGO É ABERTO PARA LER O PASSADO E FECHADO PARA ESCREVER O FUTURO.
--
--   Todo valor que existe no legado ganha uma linha, inclusive erro de
--   digitação e uso fora de lugar. Nenhum atendimento é rejeitado por
--   ter um valor "estranho". Mas só linhas marcadas como selecionáveis
--   podem ser usadas por escrita nova.
--
-- Nada no schema `public` legado é alterado por este arquivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O texto original nunca se perde
--
-- Mesmo com o catálogo, o texto exato que estava na linha do legado é
-- guardado. É o que garante "o passado segue inalterado" de forma
-- literal: se um dia a interpretação do catálogo for questionada, a
-- origem está aqui, caractere por caractere.
-- ---------------------------------------------------------------------

ALTER TABLE core.tickets
  ADD COLUMN IF NOT EXISTS legacy_platform text,
  ADD COLUMN IF NOT EXISTS legacy_channel  text;

COMMENT ON COLUMN core.tickets.legacy_platform IS
  'Texto cru de services.platform. Preservado mesmo quando platform_id resolve, '
  'para que nenhuma variação de grafia se perca na travessia.';
COMMENT ON COLUMN core.tickets.legacy_channel IS
  'Texto cru de services.channel. Mesmo motivo.';

-- ---------------------------------------------------------------------
-- 2. Apelidos: variações de grafia que apontam para a mesma coisa
--
-- `code` é citext, então 'LogiCall' e 'Logicall' colidiriam. Em vez de
-- escolher uma e perder a outra, a variante vira apelido e o texto
-- original continua na linha do ticket.
-- ---------------------------------------------------------------------

CREATE TABLE core.sales_platform_aliases (
  alias       citext PRIMARY KEY,
  platform_id smallint NOT NULL REFERENCES core.sales_platforms(id),
  note        text
);

CREATE TABLE core.channel_aliases (
  alias      citext PRIMARY KEY,
  channel_id smallint NOT NULL REFERENCES core.channels(id),
  note       text
);

-- ---------------------------------------------------------------------
-- 3. Carga: TODOS os valores que existem em produção
--
-- Medido em 28/09/2026, união de services.platform e refunds.sales_platform.
-- A contagem está no comentário para que uma futura divergência seja
-- detectável.
-- ---------------------------------------------------------------------

INSERT INTO core.sales_platforms (code, label, kind, is_selectable, sort_order) VALUES
  ('Cartpanda',   'Cartpanda',    'value',          true,  1),  -- 31.565 atend. + 2.400 reemb.
  ('Buygoods',    'Buygoods',     'value',          true,  2),  -- 15.792 + 1.452
  ('ClickBank',   'ClickBank',    'value',          true,  3),  -- 13.299 + 1.414
  ('PagAmerican', 'PagAmerican',  'value',          true,  4),  --  2.834 +   139
  ('LogiCall',    'LogiCall',     'value',          true,  5),  --    997 +    59
  ('Digistore24', 'Digistore24',  'value',          true,  6),  --    817 +     4
  ('SalesBound',  'SalesBound',   'value',          true,  7),  --    163 +    45
  ('CartCandy',   'CartCandy',    'value',          true,  8),  --    141 +    22
  ('Hotmart',     'Hotmart',      'value',          true,  9),  --      0 +   143  (só em reembolsos)
  ('Nenhum',      'Não se aplica','not_applicable', true, 99);  -- 10.686 +    36

-- A lista da tela de atendimento tinha 9 valores e a de reembolso 8, sem
-- PagAmerican. Por isso o agente conseguia registrar o atendimento e não
-- o reembolso do mesmo pedido. Hotmart existia só no dado, em tela nenhuma.
-- Com um catálogo só, a divergência deixa de ser possível.

INSERT INTO core.sales_platform_aliases (alias, platform_id, note)
SELECT 'Logicall', id, 'Erro de digitação: 1 linha em services.platform contra 997 de LogiCall (medido 28/09/2026). O texto original fica em tickets.legacy_platform.'
  FROM core.sales_platforms WHERE code = 'LogiCall';

INSERT INTO core.channels (code, label, kind, is_selectable, sort_order) VALUES
  ('Email',     'E-mail',        'value',          true,  1),  -- 30.887 atend. + 2.680 reemb.
  ('SMS',       'SMS',           'value',          true,  2),  -- 36.081 + 1.445
  ('Clickbank', 'Clickbank',     'value',          true,  3),  --  3.710 +   865  — ver nota
  ('Nenhum',    'Não se aplica', 'not_applicable', true, 98);  --  1.128 +     0

-- NOTA sobre 'Clickbank' como canal (4.575 linhas somando as duas tabelas).
--
-- O desenho anterior o tratava como dado fora de lugar, não selecionável,
-- na hipótese de ser engano. O levantamento completo mostrou que ele
-- aparece de forma consistente nas DUAS tabelas, ao longo do tempo — o
-- que parece uso deliberado, não engano: provavelmente "o contato veio
-- pelo sistema da ClickBank", e não por e-mail nem SMS.
--
-- Por isso entra como canal legítimo e selecionável. Se a gestora
-- confirmar que é engano, basta `UPDATE ... SET is_selectable = false`:
-- nenhuma linha é perdida nos dois sentidos. Marcá-lo como erro agora
-- seria a decisão irreversível.

-- ---------------------------------------------------------------------
-- 4. Resolver texto legado para linha de catálogo, SEM PERDER NADA
--
-- Ordem: código exato → apelido → cria linha nova não selecionável.
--
-- O último passo é o que cumpre "nenhum dado é perdido": um valor que
-- ninguém previu não derruba o backfill nem vira rejeito. Ele ganha uma
-- linha, marcada como não selecionável, e fica visível para decisão.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.resolve_sales_platform(p_text text)
RETURNS smallint
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
DECLARE v_id smallint; v_clean text := btrim(coalesce(p_text, ''));
BEGIN
  -- Vazio é "ninguém preencheu": continua sendo NULL, distinto de "Nenhum".
  IF v_clean = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM core.sales_platforms WHERE code = v_clean::citext;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT platform_id INTO v_id FROM core.sales_platform_aliases WHERE alias = v_clean::citext;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO core.sales_platforms (code, label, kind, is_selectable, sort_order)
  VALUES (v_clean, v_clean, 'misfiled', false, 900)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION core.resolve_channel(p_text text)
RETURNS smallint
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
DECLARE v_id smallint; v_clean text := btrim(coalesce(p_text, ''));
BEGIN
  IF v_clean = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM core.channels WHERE code = v_clean::citext;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT channel_id INTO v_id FROM core.channel_aliases WHERE alias = v_clean::citext;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO core.channels (code, label, kind, is_selectable, sort_order)
  VALUES (v_clean, v_clean, 'misfiled', false, 900)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. A regra nova vale só para a frente
--
-- Escrita NOVA (sem `legacy_id`) só aceita linha selecionável.
-- Linha vinda do backfill (com `legacy_id`) aceita qualquer coisa,
-- porque o passado entra como está.
--
-- O critério é a própria coluna `legacy_id`, não um sinalizador de
-- sessão: nada a configurar, nada a esquecer de desligar.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.enforce_selectable_catalog()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, public, pg_catalog
AS $$
DECLARE v_ok boolean;
BEGIN
  IF NEW.legacy_id IS NOT NULL THEN
    RETURN NEW;  -- travessia: o passado entra como está
  END IF;

  IF NEW.platform_id IS NOT NULL THEN
    SELECT is_selectable INTO v_ok FROM core.sales_platforms WHERE id = NEW.platform_id;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'plataforma % nao e selecionavel para registro novo', NEW.platform_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.channel_id IS NOT NULL THEN
    SELECT is_selectable INTO v_ok FROM core.channels WHERE id = NEW.channel_id;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'canal % nao e selecionavel para registro novo', NEW.channel_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Reembolso exige numero do pedido. Hoje so a interface exige, e ha
  -- 4.985 tickets antigos sem ele — que entram pela travessia acima.
  IF NEW.contact_reason = 'reembolso' AND nullif(btrim(coalesce(NEW.order_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reembolso exige numero do pedido'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tickets_enforce_selectable_catalog
BEFORE INSERT OR UPDATE OF platform_id, channel_id, contact_reason, order_id ON core.tickets
FOR EACH ROW EXECUTE FUNCTION core.enforce_selectable_catalog();

-- ---------------------------------------------------------------------
-- 6. O que as telas leem
--
-- Uma fonte só. A lista deixa de existir em três arquivos do front com
-- dois conteúdos diferentes.
-- ---------------------------------------------------------------------

CREATE VIEW core.selectable_sales_platforms
WITH (security_invoker = true) AS
SELECT id, code, label, kind FROM core.sales_platforms
 WHERE is_selectable ORDER BY sort_order, label;

CREATE VIEW core.selectable_channels
WITH (security_invoker = true) AS
SELECT id, code, label, kind FROM core.channels
 WHERE is_selectable ORDER BY sort_order, label;

GRANT SELECT ON core.selectable_sales_platforms, core.selectable_channels TO api_request;
