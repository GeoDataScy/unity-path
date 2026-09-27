-- =====================================================================
-- Testes das garantias do schema core.
--
-- Cada bloco prova UMA garantia de docs/arquitetura-v2/01-GARANTIAS.md.
-- Uma garantia que só existe na revisão humana não é garantia: aqui ela
-- falha o script.
-- =====================================================================
\set ON_ERROR_STOP on
\timing off

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_ok boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN
    RAISE NOTICE 'ok    %', p_label;
  ELSE
    RAISE EXCEPTION 'FALHOU: %', p_label;
  END IF;
END; $$;

-- Espera que o bloco levante exceção. Se não levantar, a garantia não existe.
CREATE OR REPLACE FUNCTION pg_temp.expect_rejects(p_label text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'ok    % (recusado: %)', p_label, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU: % — a escrita foi ACEITA e deveria ter sido recusada', p_label;
END; $$;

-- ---------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------
INSERT INTO core.users (id, email, full_name, role, legacy_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ana@xmx.test',  'Ana',  'agent',   'u-ana'),
  ('22222222-2222-2222-2222-222222222222', 'jess@xmx.test', 'Jess', 'manager', 'u-jess');

INSERT INTO core.products (name) VALUES ('Arialief'), ('Jellyrock');

INSERT INTO core.sales_platforms (code, label, kind, is_selectable, sort_order) VALUES
  ('Cartpanda',   'Cartpanda',      'value',          true,  1),
  ('PagAmerican', 'PagAmerican',    'value',          true,  2),
  ('Nenhum',      'Não se aplica',  'not_applicable', true, 99);

INSERT INTO core.channels (code, label, kind, is_selectable, sort_order) VALUES
  ('Email',     'E-mail',                  'value',          true,  1),
  ('SMS',       'SMS',                     'value',          true,  2),
  ('Nenhum',    'Não se aplica',           'not_applicable', true, 98),
  ('Clickbank', 'Clickbank (fora de lugar)','misfiled',      false, 99);

-- =====================================================================
-- G9.3 — "não se aplica" e "não preenchido" são coisas diferentes
-- =====================================================================
DO $$
DECLARE v_na smallint; v_null_ok boolean;
BEGIN
  SELECT id INTO v_na FROM core.sales_platforms WHERE kind = 'not_applicable';

  INSERT INTO core.tickets (client_email, business_day, product_id, platform_id,
                            contact_reason, creator_id, current_owner_id)
  SELECT 'na@x.test', current_date, p.id, v_na, 'duvida_de_uso',
         '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
    FROM core.products p WHERE p.name = 'Arialief';

  INSERT INTO core.tickets (client_email, business_day, product_id, platform_id,
                            contact_reason, creator_id, current_owner_id)
  SELECT 'vazio@x.test', current_date, p.id, NULL, 'duvida_de_uso',
         '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
    FROM core.products p WHERE p.name = 'Arialief';

  SELECT count(DISTINCT coalesce(platform_id::text,'NULO')) = 2 INTO v_null_ok
    FROM core.tickets WHERE client_email IN ('na@x.test','vazio@x.test');
  PERFORM pg_temp.expect('G9.3 not_applicable e NULL permanecem distintos', v_null_ok);
END $$;

-- Catálogo misfiled nunca pode ser marcado como selecionável.
SELECT pg_temp.expect_rejects(
  'G9.3 catálogo misfiled não pode ser selecionável',
  $$UPDATE core.channels SET is_selectable = true WHERE kind = 'misfiled'$$);

-- =====================================================================
-- G1.1 — estado derivado muda na MESMA transação da interação
-- =====================================================================
DO $$
DECLARE v_t uuid; v_ds text; v_cnt int; v_at timestamptz;
BEGIN
  INSERT INTO core.tickets (client_email, business_day, product_id, contact_reason,
                            creator_id, current_owner_id)
  SELECT 'fluxo@x.test', current_date, p.id, 'duvida_de_uso',
         '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
    FROM core.products p WHERE p.name = 'Arialief'
  RETURNING id INTO v_t;

  SELECT derived_status::text, interaction_count INTO v_ds, v_cnt
    FROM core.tickets WHERE id = v_t;
  PERFORM pg_temp.expect('G1.1 ticket nasce novo com contagem 1', v_ds = 'novo' AND v_cnt = 1);

  INSERT INTO core.interactions (ticket_id, seq, status, observation, author_id)
  VALUES (v_t, 1, 'em_andamento', 'primeiro contato', '11111111-1111-1111-1111-111111111111');

  SELECT derived_status::text, interaction_count, last_interaction_at
    INTO v_ds, v_cnt, v_at FROM core.tickets WHERE id = v_t;
  PERFORM pg_temp.expect('G1.1 interação move para em_andamento sem a API pedir',
                         v_ds = 'em_andamento' AND v_cnt = 1 AND v_at IS NOT NULL);

  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 2, 'concluido', '11111111-1111-1111-1111-111111111111');

  SELECT derived_status::text, interaction_count
    INTO v_ds, v_cnt FROM core.tickets WHERE id = v_t;
  PERFORM pg_temp.expect('G1.1 conclusão materializa nas duas colunas', v_ds = 'concluido' AND v_cnt = 2);

  -- A coluna gravada e o estado exibido não podem divergir: é o bug dos
  -- 10.115 tickets fantasma.
  PERFORM pg_temp.expect('G1.1 status e derived_status concordam',
    (SELECT status::text = 'concluido' AND derived_status::text = 'concluido'
       FROM core.tickets WHERE id = v_t));
END $$;

-- =====================================================================
-- G1.2 — seq duplicado é impossível
-- =====================================================================
DO $$
DECLARE v_t uuid;
BEGIN
  SELECT id INTO v_t FROM core.tickets WHERE client_email = 'fluxo@x.test';
  PERFORM pg_temp.expect_rejects(
    'G1.2 seq duplicado no mesmo ticket',
    format($q$INSERT INTO core.interactions (ticket_id, seq, status, author_id)
             VALUES (%L, 2, 'em_andamento', '11111111-1111-1111-1111-111111111111')$q$, v_t));
END $$;

-- =====================================================================
-- C8 — o fallback em legacy_status (os 1.220 que reabririam)
-- =====================================================================
DO $$
DECLARE v_t uuid; v_ds text;
BEGIN
  INSERT INTO core.tickets (client_email, business_day, product_id, contact_reason,
                            creator_id, current_owner_id, legacy_status, derived_status)
  SELECT 'legado@x.test', current_date, p.id, 'duvida_de_uso',
         '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
         'concluido', 'concluido'
    FROM core.products p WHERE p.name = 'Arialief'
  RETURNING id INTO v_t;

  -- Sem interação nenhuma, como os 1.220 do legado. Forçamos o recálculo
  -- inserindo e removendo uma interação: o estado tem de VOLTAR a concluído,
  -- não a "novo".
  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 1, 'em_andamento', '11111111-1111-1111-1111-111111111111');
  DELETE FROM core.interactions WHERE ticket_id = v_t;

  SELECT derived_status::text INTO v_ds FROM core.tickets WHERE id = v_t;
  PERFORM pg_temp.expect('C8 concluído sem interação NÃO reabre', v_ds = 'concluido');
END $$;

-- =====================================================================
-- Regras de nota do motivo de contato (cópia fiel do legado)
-- =====================================================================
SELECT pg_temp.expect_rejects(
  'motivo "outro" sem nota',
  $$INSERT INTO core.tickets (client_email, business_day, product_id, contact_reason,
                              creator_id, current_owner_id)
    SELECT 'sem-nota@x.test', current_date, p.id, 'outro',
           '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
      FROM core.products p WHERE p.name = 'Arialief'$$);

SELECT pg_temp.expect_rejects(
  'nota em motivo que não a admite',
  $$INSERT INTO core.tickets (client_email, business_day, product_id, contact_reason,
                              contact_reason_note, creator_id, current_owner_id)
    SELECT 'nota-indevida@x.test', current_date, p.id, 'duvida_de_uso', 'blah',
           '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
      FROM core.products p WHERE p.name = 'Arialief'$$);

-- Reembolso sem número de pedido: hoje só a interface exige.
SELECT pg_temp.expect_rejects(
  'reembolso sem número de pedido',
  $$INSERT INTO core.tickets (client_email, business_day, product_id, contact_reason,
                              creator_id, current_owner_id)
    SELECT 'reemb@x.test', current_date, p.id, 'reembolso',
           '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
      FROM core.products p WHERE p.name = 'Arialief'$$);

-- =====================================================================
-- recorded_at é do servidor e imutável
-- =====================================================================
DO $$
DECLARE v_t uuid;
BEGIN
  SELECT id INTO v_t FROM core.tickets WHERE client_email = 'na@x.test';
  INSERT INTO core.interactions (ticket_id, seq, status, author_id)
  VALUES (v_t, 1, 'em_andamento', '11111111-1111-1111-1111-111111111111');

  PERFORM pg_temp.expect_rejects(
    'recorded_at imutável após insert',
    format($q$UPDATE core.interactions SET recorded_at = now() - interval '5 days'
              WHERE ticket_id = %L$q$, v_t));
END $$;

-- =====================================================================
-- G2.4 — nenhum instante sem fuso, nenhum id em texto
-- =====================================================================
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM information_schema.columns
   WHERE table_schema = 'core' AND data_type = 'timestamp without time zone';
  PERFORM pg_temp.expect('G2.4 zero colunas de instante sem fuso', v_bad = 0);

  SELECT count(*) INTO v_bad
    FROM information_schema.columns
   WHERE table_schema = 'core' AND data_type = 'text'
     AND (column_name = 'id' OR column_name LIKE '%\_id' ESCAPE '\')
     AND column_name NOT LIKE 'legacy%' AND column_name <> 'order_id';
  PERFORM pg_temp.expect('G2.4 nenhum identificador em texto', v_bad = 0);
END $$;

-- =====================================================================
-- G7.1/G7.2 — nenhum privilégio para papel anônimo ou de usuário final
-- =====================================================================
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'core' AND grantee IN ('PUBLIC', 'anon', 'authenticated');
  PERFORM pg_temp.expect('G7.1 zero privilégios para anon/authenticated/PUBLIC', v_bad = 0);
END $$;

SELECT '=== TODAS AS GARANTIAS PASSARAM ===' AS resultado;
