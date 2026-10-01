-- =====================================================================
-- Garantias da marca de repetição do dia (B26).
--
-- Duas camadas, de propósito:
--
--   1. A REGRA, como função pura, testada com instantes escolhidos. Assim
--      os dois lados das 18h, a fronteira exata e a virada de fuso são
--      cobertos em toda execução — não só quando a suíte roda de manhã.
--
--   2. O GATILHO, testado no que não depende do relógio: primeira
--      interação, rastreio, dia anterior, linha do legado intocada, valor
--      enviado ignorado, e a marca chegando à tabela de fatos.
-- =====================================================================
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_det text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_label;
  ELSE RAISE EXCEPTION 'FALHOU: % %', p_label, coalesce('— ' || p_det, ''); END IF;
END; $$;

-- Instante em São Paulo, para os testes lerem como a gestora lê.
CREATE OR REPLACE FUNCTION pg_temp.sp(p text) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT p::timestamp AT TIME ZONE 'America/Sao_Paulo' $$;

-- ---------------------------------------------------------------------
-- 1. A regra
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect('primeira interacao nunca e repeticao',
    core.same_day_repeat(NULL, pg_temp.sp('2026-03-10 10:00'), false) = false);

  PERFORM pg_temp.expect('mesmo dia, antes das 18h: repeticao',
    core.same_day_repeat(pg_temp.sp('2026-03-10 10:00'), pg_temp.sp('2026-03-10 17:59'), false));

  -- A fronteira é estrita, como no legado: `now() < 18:00`.
  PERFORM pg_temp.expect('exatamente 18:00 ja nao e repeticao',
    core.same_day_repeat(pg_temp.sp('2026-03-10 10:00'), pg_temp.sp('2026-03-10 18:00'), false) = false);

  PERFORM pg_temp.expect('mesmo dia, depois das 18h: nao e repeticao',
    core.same_day_repeat(pg_temp.sp('2026-03-10 10:00'), pg_temp.sp('2026-03-10 18:01'), false) = false);

  PERFORM pg_temp.expect('anterior depois das 18h libera o resto do dia',
    core.same_day_repeat(pg_temp.sp('2026-03-10 19:00'), pg_temp.sp('2026-03-10 20:00'), false) = false);

  PERFORM pg_temp.expect('dia seguinte nunca e repeticao',
    core.same_day_repeat(pg_temp.sp('2026-03-10 17:00'), pg_temp.sp('2026-03-11 09:00'), false) = false);

  PERFORM pg_temp.expect('virar a meia-noite libera',
    core.same_day_repeat(pg_temp.sp('2026-03-10 23:30'), pg_temp.sp('2026-03-11 00:30'), false) = false);

  -- A armadilha do fuso. 23:00 em SP é 02:00 do dia SEGUINTE em UTC. Se a
  -- regra usasse o dia de UTC, o limite iria para as 18h do dia 11 e a
  -- interação das 12h do dia 11 seria marcada — errado.
  PERFORM pg_temp.expect('o dia e o de Sao Paulo, nao o de UTC',
    core.same_day_repeat(pg_temp.sp('2026-03-10 23:00'), pg_temp.sp('2026-03-11 12:00'), false) = false,
    'a regra usou o dia de UTC');

  PERFORM pg_temp.expect('codigo de rastreio isenta, mesmo antes das 18h',
    core.same_day_repeat(pg_temp.sp('2026-03-10 10:00'), pg_temp.sp('2026-03-10 11:00'), true) = false);

  PERFORM pg_temp.expect('rastreio desconhecido conta como sem rastreio',
    core.same_day_repeat(pg_temp.sp('2026-03-10 10:00'), pg_temp.sp('2026-03-10 11:00'), NULL));
END $$;

-- ---------------------------------------------------------------------
-- 2. O gatilho
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_u uuid; v_p uuid; v_t uuid; v_trk uuid; v_i uuid; v_marca boolean; v_fato boolean;
  v_esperado boolean;
BEGIN
  INSERT INTO core.users (id, email, full_name, role, legacy_id)
  SELECT u, 'marca@xmx.test', 'Marca', 'agent', u::text
    FROM (SELECT gen_random_uuid() AS u) g RETURNING id INTO v_u;
  INSERT INTO core.products (name) VALUES ('Produto Marca') RETURNING id INTO v_p;

  INSERT INTO core.tickets (client_email, business_day, product_id, creator_id, current_owner_id)
  VALUES ('m@x.test', current_date, v_p, v_u, v_u) RETURNING id INTO v_t;

  -- A criação do ticket não conta: a primeira interação nunca é repetição.
  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 1, 'em_andamento', v_u) RETURNING id, is_same_day_repeat INTO v_i, v_marca;
  PERFORM pg_temp.expect('gatilho: primeira interacao do ticket nao e marcada', NOT v_marca);

  -- A segunda, agora. O resultado depende da hora — então o teste calcula o
  -- esperado com a MESMA regra e o mesmo relógio, e confere que o gatilho
  -- chamou a regra. Os dois lados das 18h já foram provados na parte 1.
  v_esperado := now() < (((now() AT TIME ZONE 'America/Sao_Paulo')::date + time '18:00')
                         AT TIME ZONE 'America/Sao_Paulo');
  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 2, 'concluido', v_u) RETURNING id, is_same_day_repeat INTO v_i, v_marca;
  PERFORM pg_temp.expect(
    format('gatilho: segunda do dia segue a regra (%s antes das 18h de SP)',
           CASE WHEN v_esperado THEN 'rodando' ELSE 'rodando depois' END),
    v_marca = v_esperado, format('esperado %s, veio %s', v_esperado, v_marca));

  -- A marca chega à tabela de fatos: é ela que a métrica lê.
  SELECT is_same_day_repeat INTO v_fato FROM core.interaction_facts WHERE interaction_id = v_i;
  PERFORM pg_temp.expect('a marca chega a tabela de fatos', v_fato = v_marca,
    format('interacao=%s, fato=%s', v_marca, v_fato));

  -- Rastreio isenta no gatilho também.
  INSERT INTO core.tickets (client_email, business_day, product_id, creator_id, current_owner_id,
                            has_tracking_code)
  VALUES ('trk@x.test', current_date, v_p, v_u, v_u, true) RETURNING id INTO v_trk;
  INSERT INTO core.interactions (ticket_id, seq, status, author_id) VALUES (v_trk, 1, 'em_andamento', v_u);
  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_trk, 2, 'em_andamento', v_u) RETURNING is_same_day_repeat INTO v_marca;
  PERFORM pg_temp.expect('gatilho: ticket com rastreio nunca e marcado', NOT v_marca);
END $$;

DO $$
DECLARE v_u uuid; v_p uuid; v_t uuid; v_marca boolean;
BEGIN
  SELECT id INTO v_u FROM core.users WHERE email = 'marca@xmx.test';
  SELECT id INTO v_p FROM core.products WHERE name = 'Produto Marca';
  INSERT INTO core.tickets (client_email, business_day, product_id, creator_id, current_owner_id)
  VALUES ('ontem@x.test', current_date - 1, v_p, v_u, v_u) RETURNING id INTO v_t;

  -- A anterior foi ONTEM: a de hoje nunca é repetição, a qualquer hora.
  -- Entra como linha do legado para poder carregar um instante passado.
  INSERT INTO core.interactions (ticket_id, seq, status, author_id, recorded_at, legacy_id)
  VALUES (v_t, 1, 'em_andamento', v_u,
          ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 + time '10:00') AT TIME ZONE 'America/Sao_Paulo',
          'leg-ontem-1');
  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 2, 'em_andamento', v_u) RETURNING is_same_day_repeat INTO v_marca;
  PERFORM pg_temp.expect('gatilho: anterior de ontem, a de hoje nao e marcada', NOT v_marca);

  -- O cliente não escolhe a marca: para linha nova, o valor enviado é
  -- ignorado e o servidor decide.
  INSERT INTO core.tickets (client_email, business_day, product_id, creator_id, current_owner_id)
  VALUES ('forjado@x.test', current_date, v_p, v_u, v_u) RETURNING id INTO v_t;
  INSERT INTO core.interactions (ticket_id, seq, status, author_id, is_same_day_repeat)
  VALUES (v_t, 1, 'em_andamento', v_u, true) RETURNING is_same_day_repeat INTO v_marca;
  PERFORM pg_temp.expect('o valor enviado e ignorado: quem marca e o servidor', NOT v_marca,
    'uma primeira interacao saiu marcada porque o chamador mandou true');
END $$;

DO $$
DECLARE v_u uuid; v_p uuid; v_t uuid; v_marca boolean;
BEGIN
  SELECT id INTO v_u FROM core.users WHERE email = 'marca@xmx.test';
  SELECT id INTO v_p FROM core.products WHERE name = 'Produto Marca';
  INSERT INTO core.tickets (client_email, business_day, product_id, creator_id, current_owner_id)
  VALUES ('legado@x.test', current_date, v_p, v_u, v_u) RETURNING id INTO v_t;

  -- O passado chega com a marca que o legado gravou NO INSTANTE REAL, e
  -- sai como chegou. Recalcular usaria o relógio de hoje contra um
  -- registro antigo. Os dois sentidos: uma primeira interação que o
  -- legado marcou true continua true, e uma repetição que ele marcou
  -- false continua false.
  INSERT INTO core.interactions (ticket_id, seq, status, author_id, recorded_at, legacy_id, is_same_day_repeat)
  VALUES (v_t, 1, 'em_andamento', v_u, now() - interval '200 days', 'leg-a', true)
  RETURNING is_same_day_repeat INTO v_marca;
  PERFORM pg_temp.expect('linha do legado marcada chega marcada', v_marca);

  INSERT INTO core.interactions (ticket_id, seq, status, author_id, recorded_at, legacy_id, is_same_day_repeat)
  VALUES (v_t, 2, 'em_andamento', v_u, now() - interval '200 days' + interval '1 minute', 'leg-b', false)
  RETURNING is_same_day_repeat INTO v_marca;
  PERFORM pg_temp.expect('linha do legado nao marcada chega nao marcada', NOT v_marca);
END $$;

-- O gatilho existe com o nome e o momento certos.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relname = 'interactions'
     AND t.tgname = 'interactions_mark_same_day_repeat';
  PERFORM pg_temp.expect('o gatilho e BEFORE INSERT em core.interactions',
    v_def LIKE '%BEFORE INSERT ON core.interactions%', coalesce(v_def, 'gatilho ausente'));
END $$;

SELECT '=== MARCA DE REPETICAO: TODAS AS GARANTIAS PASSARAM ===' AS resultado;
