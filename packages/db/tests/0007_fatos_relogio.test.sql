-- =====================================================================
-- Garantias do eixo do relógio.
--
-- A tabela de fatos tem dois eixos de tempo de propósito:
--
--   `day`         o dia que o agente declarou  → volume, metas, ritmo
--   `occurred_at` o instante real do registro  → hora do dia, turno, pico
--
-- O erro que estas garantias impedem é o mais fácil de cometer: usar um
-- eixo no lugar do outro. Um agente que registra à meia-noite o
-- atendimento de ontem tem de aparecer no dia de ontem no primeiro e na
-- madrugada no segundo. Se os dois eixos colapsarem num só, o painel de
-- volume ou o mapa de horário passa a mentir, e ninguém percebe olhando.
-- =====================================================================
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_det text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_label;
  ELSE RAISE EXCEPTION 'FALHOU: % %', p_label, coalesce('— ' || p_det, ''); END IF;
END; $$;

-- Semeia o mínimo: um usuário, um produto, e um ticket cuja data declarada
-- é DIFERENTE do instante de criação. É o caso que separa os dois eixos.
DO $$
DECLARE
  v_u uuid; v_p uuid; v_t uuid; v_i uuid;
  v_dia date; v_inst timestamptz; v_occ timestamptz;
  v_declarado date := date '2026-03-10';
BEGIN
  -- `core.users.id` não tem padrão de propósito: é o id do Supabase Auth,
  -- vindo de fora. E `legacy_id` é NOT NULL, então um usuário novo carrega
  -- o próprio id ali. Está anotado no backlog como aspereza a resolver no
  -- módulo de usuários.
  INSERT INTO core.users (id, email, full_name, role, legacy_id)
  SELECT u, 'relogio@xmx.test', 'Relógio', 'agent', u::text
    FROM (SELECT gen_random_uuid() AS u) g
  RETURNING id INTO v_u;
  INSERT INTO core.products (name) VALUES ('Produto Relógio') RETURNING id INTO v_p;

  -- Criado às 00:30 de São Paulo do DIA SEGUINTE ao declarado.
  v_inst := (v_declarado + 1 + time '00:30') AT TIME ZONE 'America/Sao_Paulo';

  INSERT INTO core.tickets
    (client_email, business_day, product_id, creator_id, current_owner_id, created_at)
  VALUES ('cliente@x.test', v_declarado, v_p, v_u, v_u, v_inst)
  RETURNING id INTO v_t;

  SELECT day, occurred_at INTO v_dia, v_occ
    FROM core.interaction_facts WHERE ticket_id = v_t AND kind = 'ticket';

  PERFORM pg_temp.expect(
    format('o fato nasce com os dois eixos (dia=%s, instante=%s)', v_dia, v_occ),
    v_dia IS NOT NULL AND v_occ IS NOT NULL);

  PERFORM pg_temp.expect(
    'o eixo do calendario e a data declarada pelo agente',
    v_dia = v_declarado, format('esperado %s, veio %s', v_declarado, v_dia));

  PERFORM pg_temp.expect(
    'o eixo do relogio e o instante real da criacao',
    v_occ = v_inst, format('esperado %s, veio %s', v_inst, v_occ));

  -- O ponto da garantia: registrado depois da meia-noite, o dia declarado e
  -- o dia do relógio NÃO são o mesmo. Se fossem, um dos eixos seria inútil.
  PERFORM pg_temp.expect(
    'os dois eixos divergem quando o registro atravessa a meia-noite',
    (v_occ AT TIME ZONE 'America/Sao_Paulo')::date <> v_dia,
    format('relogio=%s, declarado=%s',
           (v_occ AT TIME ZONE 'America/Sao_Paulo')::date, v_dia));

  -- Interação: ali os dois eixos coincidem na origem, porque os dois saem
  -- de `recorded_at`.
  INSERT INTO core.interactions (ticket_id, seq, status, author_id, recorded_at)
  VALUES (v_t, 2, 'concluido', v_u, v_inst + interval '3 hours')
  RETURNING id INTO v_i;

  SELECT day, occurred_at INTO v_dia, v_occ
    FROM core.interaction_facts WHERE interaction_id = v_i;

  PERFORM pg_temp.expect(
    'na interacao o instante e o recorded_at',
    v_occ = v_inst + interval '3 hours', v_occ::text);
  PERFORM pg_temp.expect(
    'na interacao os dois eixos concordam',
    v_dia = (v_occ AT TIME ZONE 'America/Sao_Paulo')::date,
    format('dia=%s, relogio=%s', v_dia, (v_occ AT TIME ZONE 'America/Sao_Paulo')::date));

  -- O eixo do relógio não pode ser reescrito, e isso é garantia e não
  -- limitação: `recorded_at` é imutável por gatilho (0001). Então
  -- `occurred_at` da interação nunca deriva depois de gravado — o mapa de
  -- horário não muda de forma retroativamente.
  BEGIN
    UPDATE core.interactions SET recorded_at = v_inst + interval '9 hours'
     WHERE id = v_i;
    PERFORM pg_temp.expect('o instante da interacao e imutavel', false,
                           'o UPDATE passou, e nao devia');
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect('o instante da interacao e imutavel', true);
  END;

  SELECT occurred_at INTO v_occ FROM core.interaction_facts WHERE interaction_id = v_i;
  PERFORM pg_temp.expect(
    'depois da tentativa recusada, o fato segue no instante original',
    v_occ = v_inst + interval '3 hours', v_occ::text);

  -- E mudar a data declarada do ticket move o eixo do calendário sem tocar
  -- no do relógio: são independentes.
  UPDATE core.tickets SET business_day = v_declarado - 1 WHERE id = v_t;
  SELECT day, occurred_at INTO v_dia, v_occ
    FROM core.interaction_facts WHERE ticket_id = v_t AND kind = 'ticket';
  PERFORM pg_temp.expect(
    'mudar a data declarada move so o eixo do calendario',
    v_dia = v_declarado - 1 AND v_occ = v_inst,
    format('dia=%s, instante=%s', v_dia, v_occ));
END $$;

-- A coluna é obrigatória: fato sem instante não existe.
DO $$
DECLARE v_nulo boolean;
BEGIN
  SELECT is_nullable = 'NO' INTO v_nulo FROM information_schema.columns
   WHERE table_schema = 'core' AND table_name = 'interaction_facts'
     AND column_name = 'occurred_at';
  PERFORM pg_temp.expect('occurred_at e obrigatorio', v_nulo);
END $$;

-- O recorte por instante tem índice. É a diferença entre varrer a tabela e
-- percorrer uma faixa — o motivo de a tabela de fatos existir.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'core' AND tablename = 'interaction_facts'
     AND indexdef LIKE '%occurred_at%';
  PERFORM pg_temp.expect(
    format('o eixo do relogio tem indice (%s)', v_n), v_n >= 2);
END $$;

SELECT '=== RELOGIO: TODAS AS GARANTIAS PASSARAM ===' AS resultado;
