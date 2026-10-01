-- =====================================================================
-- 0009_marca_repeticao.sql — o banco volta a marcar a repetição do dia.
--
-- A decisão D1 removeu o bloqueio das 18h e se apoiou numa frase:
-- "`is_same_day_repeat` continua sendo marcado — a marcação é o que evita
-- contar a mesma conversa duas vezes". Conferido em 01/10/2026: nada em
-- `core` marcava. A coluna nasceu com DEFAULT false, nenhum gatilho a
-- calculava e a API só a devolvia. As 1.720 marcações que o `core` tinha
-- vieram copiadas do legado na travessia. No dia em que a tela do agente
-- virasse, toda interação nova entraria como `false`, e a seção
-- "Interações repetidas no mesmo dia" da gestora ficaria cega. (B26)
--
-- A REGRA é a do legado, sem adaptação — `public._tg_follow_up_mark_
-- same_day_repeat`, de 27/07/2026:
--
--   ticket com código de rastreio      → nunca é repetição
--   primeira interação do ticket       → nunca é repetição
--                                        (a criação do ticket não conta)
--   senão                              → é repetição se registrada antes
--                                        das 18:00 de São Paulo do DIA da
--                                        interação anterior
--
-- Validada contra o histórico inteiro do legado ANTES de ser escrita:
-- aplicada às 62.037 interações de `public.service_follow_ups`, concorda
-- com a marca gravada em 62.037. As 1.741 marcadas pelo legado são as
-- mesmas 1.741 marcadas por esta regra.
--
-- MARCA, NÃO BLOQUEIA. Como no legado. Bloquear foi o que D1 removeu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A regra como função pura.
--
-- Separada do gatilho por um motivo prático: ela depende do relógio, e
-- um teste que dependa da hora em que roda só cobre um lado das 18h. Com
-- a regra recebendo o instante como argumento, a suíte testa os dois
-- lados, a fronteira exata e a virada de fuso, sempre — e o árbitro de
-- produção chama a MESMA função que o gatilho chama.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.same_day_repeat(
  p_previous_at  timestamptz,  -- instante da interação anterior; NULL se não há
  p_at           timestamptz,  -- instante desta interação
  p_has_tracking boolean       -- o ticket tem código de rastreio
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN coalesce(p_has_tracking, false) THEN false
    WHEN p_previous_at IS NULL           THEN false
    -- O DIA é o de São Paulo, não o de UTC: uma interação às 23h de SP já
    -- é o dia seguinte em UTC, e usar o dia errado deslocaria o limite.
    ELSE p_at < (((p_previous_at AT TIME ZONE 'America/Sao_Paulo')::date
                  + time '18:00') AT TIME ZONE 'America/Sao_Paulo')
  END
$$;

COMMENT ON FUNCTION core.same_day_repeat(timestamptz, timestamptz, boolean) IS
  'Regra das 18h, idêntica a public._tg_follow_up_mark_same_day_repeat. '
  'Marca, não bloqueia. Validada contra 62.037 interações do legado em '
  '01/10/2026: concordância total.';

-- ---------------------------------------------------------------------
-- O gatilho.
--
-- `now()` e não `NEW.recorded_at`, como no legado: a marca diz quando o
-- SERVIDOR recebeu a interação. Pela API os dois são o mesmo instante —
-- `recorded_at` nasce de `now()` —, mas assim a marca não depende de
-- nada que o chamador mande.
--
-- Linha com `legacy_id` sai intocada: é o passado chegando pela
-- travessia ou pela sincronização, e a marca dela é a que o legado
-- gravou no instante real. Recalcular agora usaria o relógio de hoje
-- contra um registro de meses atrás. É o mesmo princípio do catálogo:
-- aberto para ler o passado, fechado para escrever o futuro.
--
-- Para linha nova, o valor enviado é ignorado: quem marca é o servidor.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.mark_same_day_repeat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, pg_catalog
AS $$
DECLARE
  v_has_tracking boolean;
  v_previous_at  timestamptz;
BEGIN
  IF NEW.legacy_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.has_tracking_code INTO v_has_tracking
    FROM core.tickets t WHERE t.id = NEW.ticket_id;

  -- Servido pelo índice (ticket_id, recorded_at DESC, seq DESC).
  SELECT max(i.recorded_at) INTO v_previous_at
    FROM core.interactions i WHERE i.ticket_id = NEW.ticket_id;

  NEW.is_same_day_repeat := core.same_day_repeat(v_previous_at, now(), v_has_tracking);
  RETURN NEW;
END;
$$;

-- Reexecutável: aplicar duas vezes não quebra nem duplica.
DROP TRIGGER IF EXISTS interactions_mark_same_day_repeat ON core.interactions;
CREATE TRIGGER interactions_mark_same_day_repeat
BEFORE INSERT ON core.interactions
FOR EACH ROW EXECUTE FUNCTION core.mark_same_day_repeat();

-- Nada a preencher: as 61.144 interações que estão em `core` vieram todas
-- do legado, com a marca dele, conferida acima. Nenhuma nasceu pela API.
