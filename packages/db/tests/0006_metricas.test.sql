-- REQUIRES: legado
-- =====================================================================
-- Garantias das métricas.
--
-- A que mais importa: os números da tabela de fatos têm de bater, linha a
-- linha, com o que `public._interaction_events` produziria. Se não
-- baterem, os painéis da gestora mudam de valor na virada — e ela vai
-- perceber antes de nós.
-- =====================================================================
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_det text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_label;
  ELSE RAISE EXCEPTION 'FALHOU: % %', p_label, coalesce('— ' || p_det, ''); END IF;
END; $$;

-- Réplica fiel de public._interaction_events sobre o legado da fixture.
CREATE OR REPLACE FUNCTION pg_temp.eventos_legado()
RETURNS TABLE(day date, user_id text, service_id text, kind text)
LANGUAGE sql STABLE AS $$
  SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
         s.user_id, s.id, 'service'
    FROM public.services s
   WHERE s.service_date ~ '^\d{4}'
  UNION ALL
  SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
         f.user_id, s.id, 'follow_up'
    FROM public.service_follow_ups f JOIN public.services s ON s.id = f.service_id;
$$;

-- ---------------------------------------------------------------------
-- Cada ticket e cada interação viram exatamente um fato
-- ---------------------------------------------------------------------
DO $$
DECLARE a int; b int;
BEGIN
  SELECT count(*) INTO a FROM core.tickets;
  SELECT count(*) INTO b FROM core.interaction_facts WHERE kind = 'ticket';
  PERFORM pg_temp.expect(format('um fato por ticket (%s = %s)', a, b), a = b);

  SELECT count(*) INTO a FROM core.interactions;
  SELECT count(*) INTO b FROM core.interaction_facts WHERE kind = 'interaction';
  PERFORM pg_temp.expect(format('um fato por interacao (%s = %s)', a, b), a = b);
END $$;

-- ---------------------------------------------------------------------
-- O DIA vem da fonte certa em cada caso
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  -- Abertura: o dia é o que o agente escolheu, não o instante de criação.
  SELECT count(*) INTO n
    FROM core.interaction_facts f JOIN core.tickets t ON t.id = f.ticket_id
   WHERE f.kind = 'ticket' AND f.day IS DISTINCT FROM t.business_day;
  PERFORM pg_temp.expect('dia da abertura = business_day do ticket', n = 0, format('%s divergem', n));

  -- Interação: o dia é o instante real convertido para São Paulo.
  SELECT count(*) INTO n
    FROM core.interaction_facts f JOIN core.interactions i ON i.id = f.interaction_id
   WHERE f.kind = 'interaction'
     AND f.day IS DISTINCT FROM (i.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date;
  PERFORM pg_temp.expect('dia da interacao = recorded_at em Sao Paulo', n = 0, format('%s divergem', n));
END $$;

-- ---------------------------------------------------------------------
-- O AGENTE do fato é quem FEZ, não o dono do ticket
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM core.interaction_facts f JOIN core.interactions i ON i.id = f.interaction_id
   WHERE f.kind = 'interaction' AND f.agent_id IS DISTINCT FROM i.author_id;
  PERFORM pg_temp.expect('agente da interacao = autor dela', n = 0);
END $$;

-- ---------------------------------------------------------------------
-- OS NUMEROS BATEM COM O LEGADO — a verificação que decide
-- ---------------------------------------------------------------------
DO $$
DECLARE dif int;
BEGIN
  -- Compara contagem por (dia, agente) dos dois lados, ignorando os
  -- tickets que viraram rejeito (que nao existem em core, por desenho).
  WITH legado AS (
    SELECT e.day, u.id AS agent_id, count(*) n
      FROM pg_temp.eventos_legado() e
      JOIN core.users u ON u.legacy_id = e.user_id
     WHERE EXISTS (SELECT 1 FROM core.tickets t WHERE t.legacy_id = e.service_id)
     GROUP BY 1,2
  ), novo AS (
    SELECT day, agent_id, count(*) n FROM core.interaction_facts GROUP BY 1,2
  )
  SELECT count(*) INTO dif FROM (
    SELECT day, agent_id, n FROM legado
    EXCEPT SELECT day, agent_id, n FROM novo
    UNION ALL
    SELECT day, agent_id, n FROM novo
    EXCEPT SELECT day, agent_id, n FROM legado) d;
  PERFORM pg_temp.expect('contagem por dia e agente IDENTICA ao legado', dif = 0,
                         format('%s combinacoes divergem', dif));
END $$;

-- ---------------------------------------------------------------------
-- O gatilho mantém o fato quando o ticket muda
-- ---------------------------------------------------------------------
DO $$
DECLARE v_t uuid; v_prod uuid; v_novo uuid; n int;
BEGIN
  SELECT id INTO v_t FROM core.tickets WHERE legacy_id = '11111111-0000-4000-8000-000000000001';
  SELECT product_id INTO v_prod FROM core.tickets WHERE id = v_t;
  -- A fixture tem um produto só; criamos o segundo para ter para onde trocar.
  INSERT INTO core.products (name) VALUES ('Produto Para Troca')
  ON CONFLICT (name_normalized) DO NOTHING;
  SELECT id INTO v_novo FROM core.products WHERE id <> v_prod LIMIT 1;

  UPDATE core.tickets SET product_id = v_novo WHERE id = v_t;

  SELECT count(*) INTO n FROM core.interaction_facts
   WHERE ticket_id = v_t AND product_id IS DISTINCT FROM v_novo;
  PERFORM pg_temp.expect('trocar o produto do ticket reescreve TODOS os fatos dele', n = 0,
                         format('%s ficaram com o produto antigo', n));
END $$;

-- ---------------------------------------------------------------------
-- Nova interação gera fato sozinha, sem a API pedir
-- ---------------------------------------------------------------------
DO $$
DECLARE v_t uuid; v_a uuid; antes int; depois int;
BEGIN
  SELECT id, current_owner_id INTO v_t, v_a FROM core.tickets
   WHERE legacy_id = '11111111-0000-4000-8000-000000000001';
  SELECT count(*) INTO antes FROM core.interaction_facts WHERE kind = 'interaction';

  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 99, 'em_andamento', v_a);

  SELECT count(*) INTO depois FROM core.interaction_facts WHERE kind = 'interaction';
  PERFORM pg_temp.expect('interacao nova cria fato pelo gatilho', depois = antes + 1);
END $$;

SELECT '=== METRICAS: TODAS AS GARANTIAS PASSARAM ===' AS resultado;
