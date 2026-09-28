-- =====================================================================
-- Testes do catálogo único.
--
-- O que precisa ser provado, nas palavras do dono:
--   "não pode acontecer com o Nenhum é perdermos dados no banco"
--   "a regra nova vale para a nova arquitetura, o passado se mantém"
-- =====================================================================
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_ok boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_label;
  ELSE RAISE EXCEPTION 'FALHOU: %', p_label; END IF;
END; $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_rejects(p_label text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'ok    % (recusado: %)', p_label, left(SQLERRM, 55); RETURN;
  END;
  RAISE EXCEPTION 'FALHOU: % — ACEITO e deveria ter sido recusado', p_label;
END; $$;

INSERT INTO core.users (id, email, role, legacy_id)
VALUES ('11111111-1111-1111-1111-111111111111','ana@x.test','agent','u-ana');
INSERT INTO core.products (name) VALUES ('Arialief');

-- =====================================================================
-- Nenhum valor do legado se perde
-- =====================================================================
DO $$
DECLARE v_id smallint; v_n int;
BEGIN
  -- Os 10 valores reais de plataforma medidos em produção resolvem.
  SELECT count(*) INTO v_n FROM (VALUES
    ('Cartpanda'),('Buygoods'),('ClickBank'),('PagAmerican'),('LogiCall'),
    ('Digistore24'),('SalesBound'),('CartCandy'),('Hotmart'),('Nenhum')
  ) t(v) WHERE core.resolve_sales_platform(t.v) IS NOT NULL;
  PERFORM pg_temp.expect('os 10 valores de plataforma de producao resolvem', v_n = 10);

  -- Os 4 de canal.
  SELECT count(*) INTO v_n FROM (VALUES ('Email'),('SMS'),('Clickbank'),('Nenhum')) t(v)
   WHERE core.resolve_channel(t.v) IS NOT NULL;
  PERFORM pg_temp.expect('os 4 valores de canal de producao resolvem', v_n = 4);

  -- O erro de digitação vai para a mesma linha do valor correto.
  PERFORM pg_temp.expect('Logicall (1 linha) resolve para LogiCall (997)',
    core.resolve_sales_platform('Logicall') = core.resolve_sales_platform('LogiCall'));

  -- Valor nunca visto NÃO derruba e NÃO é descartado: ganha linha própria.
  v_id := core.resolve_sales_platform('PlataformaQueNinguemPreviu');
  PERFORM pg_temp.expect('valor imprevisto ganha linha em vez de ser rejeitado', v_id IS NOT NULL);
  PERFORM pg_temp.expect('e nasce nao selecionavel, visivel para decisao',
    (SELECT NOT is_selectable AND kind = 'misfiled' FROM core.sales_platforms WHERE id = v_id));
END $$;

-- =====================================================================
-- "Nenhum" e vazio continuam sendo coisas diferentes
-- =====================================================================
DO $$
BEGIN
  PERFORM pg_temp.expect('"Nenhum" resolve para linha nomeada',
    core.resolve_sales_platform('Nenhum') IS NOT NULL);
  PERFORM pg_temp.expect('vazio continua NULO, nao vira "Nenhum"',
    core.resolve_sales_platform('') IS NULL AND core.resolve_sales_platform(NULL) IS NULL);
  PERFORM pg_temp.expect('espaco em branco conta como vazio',
    core.resolve_sales_platform('   ') IS NULL);

  -- Era a inconsistência M7: o atendimento gravava "Nenhum" literal e o
  -- reembolso convertia para vazio. Agora as duas telas resolvem igual.
  PERFORM pg_temp.expect('as duas telas resolvem "Nenhum" para a MESMA linha',
    core.resolve_sales_platform('Nenhum') = core.resolve_sales_platform('nenhum'));
END $$;

-- =====================================================================
-- A regra nova vale só para a frente
-- =====================================================================
DO $$
DECLARE v_prod uuid; v_misfiled smallint;
BEGIN
  SELECT id INTO v_prod FROM core.products LIMIT 1;
  v_misfiled := core.resolve_sales_platform('PlataformaQueNinguemPreviu');

  -- Passado: entra como está, mesmo com valor não selecionável.
  INSERT INTO core.tickets (client_email, business_day, product_id, platform_id,
                            contact_reason, creator_id, current_owner_id,
                            legacy_id, legacy_platform)
  VALUES ('passado@x.test', current_date, v_prod, v_misfiled, 'duvida_de_uso',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',
          'svc-legado-1', 'PlataformaQueNinguemPreviu');
  PERFORM pg_temp.expect('linha do passado entra com valor nao selecionavel',
    (SELECT count(*) = 1 FROM core.tickets WHERE legacy_id = 'svc-legado-1'));

  -- E o texto original fica guardado, caractere por caractere.
  PERFORM pg_temp.expect('texto original do legado preservado na linha',
    (SELECT legacy_platform = 'PlataformaQueNinguemPreviu'
       FROM core.tickets WHERE legacy_id = 'svc-legado-1'));
END $$;

-- Futuro: escrita nova com valor não selecionável é recusada.
SELECT pg_temp.expect_rejects(
  'registro NOVO com plataforma nao selecionavel',
  $q$INSERT INTO core.tickets (client_email, business_day, product_id, platform_id,
                               contact_reason, creator_id, current_owner_id)
     SELECT 'novo@x.test', current_date, p.id,
            core.resolve_sales_platform('PlataformaQueNinguemPreviu'), 'duvida_de_uso',
            '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'
       FROM core.products p LIMIT 1$q$);

DO $$
DECLARE v_prod uuid;
BEGIN
  SELECT id INTO v_prod FROM core.products LIMIT 1;
  -- Futuro com valor selecionável passa normalmente.
  INSERT INTO core.tickets (client_email, business_day, product_id, platform_id, channel_id,
                            contact_reason, creator_id, current_owner_id)
  VALUES ('novo-ok@x.test', current_date, v_prod,
          core.resolve_sales_platform('Cartpanda'), core.resolve_channel('Email'),
          'duvida_de_uso','11111111-1111-1111-1111-111111111111',
          '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.expect('registro NOVO com plataforma selecionavel passa',
    (SELECT count(*) = 1 FROM core.tickets WHERE client_email = 'novo-ok@x.test'));

  -- "Nenhum" é selecionável: o agente PODE dizer "verifiquei, não há".
  INSERT INTO core.tickets (client_email, business_day, product_id, platform_id,
                            contact_reason, creator_id, current_owner_id)
  VALUES ('novo-nenhum@x.test', current_date, v_prod,
          core.resolve_sales_platform('Nenhum'), 'duvida_de_uso',
          '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.expect('"Nenhum" e escolha valida em registro novo',
    (SELECT count(*) = 1 FROM core.tickets WHERE client_email = 'novo-nenhum@x.test'));
END $$;

-- =====================================================================
-- Uma lista só para as duas telas
-- =====================================================================
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM core.selectable_sales_platforms;
  PERFORM pg_temp.expect('a tela ve 10 plataformas (9 reais + Nenhum), nao 8 nem 9', v_n = 10);

  PERFORM pg_temp.expect('PagAmerican esta na lista — faltava na tela de reembolso',
    EXISTS (SELECT 1 FROM core.selectable_sales_platforms WHERE code = 'PagAmerican'));
  PERFORM pg_temp.expect('Hotmart esta na lista — nao existia em tela nenhuma',
    EXISTS (SELECT 1 FROM core.selectable_sales_platforms WHERE code = 'Hotmart'));
  PERFORM pg_temp.expect('valor imprevisto NAO aparece para escolha',
    NOT EXISTS (SELECT 1 FROM core.selectable_sales_platforms
                 WHERE code = 'PlataformaQueNinguemPreviu'));
END $$;

-- Uma linha marcada como fora de lugar nunca pode virar selecionavel.
SELECT pg_temp.expect_rejects(
  'linha "misfiled" nao pode ser marcada como selecionavel',
  $q$UPDATE core.sales_platforms SET is_selectable = true WHERE kind = 'misfiled'$q$);

SELECT '=== CATALOGO: TODAS AS GARANTIAS PASSARAM ===' AS resultado;
