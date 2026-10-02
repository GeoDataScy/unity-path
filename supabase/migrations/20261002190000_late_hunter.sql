-- Late Hunter — integração com a automação de fulfillment (o "Wall-E" da
-- especificação "API Pedidos em Espera", 17/09/2026).
--
-- O Late Hunter lê os e-mails diários de on-holds da ShipOffers, consolida os
-- CSVs de todos os dyna codes e chama a Edge Function `late-hunter-sync` 1x por
-- dia com o lote. Aqui guardamos esse lote numa base PRÓPRIA, separada de
-- held_orders: os Pedidos em Espera dos agentes continuam vindo da planilha e
-- nada aqui os toca (decisão do dono, 02/10/2026).
--
-- As três regras da especificação:
--   1. Chave natural (ambiente, loja, pedido) com upsert. Número de pedido
--      sozinho não é único — há lojas que recomeçam do 1 (ver o caso 1066 em
--      held_orders).
--   2. O sync é dono só dos FATOS do pedido. O que o painel acrescenta (aqui, o
--      ciclo de vida) não é sobrescrito por ele.
--   3. `completo: true` é a fotografia integral dos on-holds abertos: o que
--      está aberto e não veio é encerrado como `resolvido-automaticamente`.
--      Encerrar é mudança de estado, reversível: se o pedido volta, reabre.
--
-- Cuidados que a especificação deixa implícitos e que estão garantidos aqui:
--   * Idempotência: reenviar o mesmo lote dá o mesmo estado final.
--   * Lote ANTIGO chegando depois de um novo (retry atrasado, recuperação de
--     atraso fora de ordem) não sobrescreve fatos mais novos nem reabre o que
--     um lote mais novo encerrou, e não dispara encerramento.
--   * Lote paginado só encerra quando TODAS as páginas da referência chegaram —
--     uma página perdida não pode virar centenas de encerramentos falsos.
--   * Homologação e produção convivem no mesmo banco (`ambiente`) e nunca se
--     misturam: cada token grava só no seu ambiente.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabelas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.late_hunter_orders (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiente             text        NOT NULL CHECK (ambiente IN ('producao', 'homologacao')),
  pedido               text        NOT NULL,
  loja                 text        NOT NULL,
  loja_nome            text,
  -- Motivo exatamente como a ShipOffers manda ("address-verification-failed,
  -- Held for Bad Address") e quebrado em lista, para filtrar por motivo.
  motivo               text        NOT NULL,
  motivos              text[]      NOT NULL DEFAULT '{}',
  cliente_nome         text        NOT NULL,
  -- Nem sempre é um e-mail válido (a ShipOffers às vezes manda vazio/sujo).
  cliente_email        text        NOT NULL,
  data_pedido          date        NOT NULL,
  dias_em_espera       integer     CHECK (dias_em_espera IS NULL OR dias_em_espera >= 0),
  itens                text,
  endereco             jsonb,
  pais                 text,
  -- Ciclo de vida (do painel; o sync só muda pelas regras 1 e 3).
  situacao             text        NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'encerrado')),
  motivo_encerramento  text,
  encerrado_em         timestamptz,
  encerrado_referencia date,
  primeira_referencia  date        NOT NULL,
  ultima_referencia    date        NOT NULL,
  vezes_reaberto       integer     NOT NULL DEFAULT 0,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT late_hunter_orders_chave UNIQUE (ambiente, loja, pedido)
);

COMMENT ON TABLE public.late_hunter_orders IS
  'Pedidos em on-hold recebidos do Late Hunter (sync diário). Separada de held_orders.';

-- A fila padrão da tela: abertos do ambiente, mais antigos primeiro.
CREATE INDEX IF NOT EXISTS late_hunter_orders_fila_idx
  ON public.late_hunter_orders (ambiente, situacao, dias_em_espera DESC NULLS LAST);
-- Encerramento da regra 3: abertos do ambiente que não vieram no lote.
CREATE INDEX IF NOT EXISTS late_hunter_orders_ultima_ref_idx
  ON public.late_hunter_orders (ambiente, ultima_referencia) WHERE situacao = 'aberto';

CREATE TABLE IF NOT EXISTS public.late_hunter_order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint      NOT NULL REFERENCES public.late_hunter_orders(id) ON DELETE CASCADE,
  ambiente    text        NOT NULL,
  evento      text        NOT NULL CHECK (evento IN ('criado', 'reaberto', 'encerrado')),
  referencia  date        NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS late_hunter_order_events_order_idx
  ON public.late_hunter_order_events (order_id, ocorrido_em);
-- Fluxo diário (entraram/saíram por referência).
CREATE INDEX IF NOT EXISTS late_hunter_order_events_fluxo_idx
  ON public.late_hunter_order_events (ambiente, referencia, evento);

-- Uma linha por chamada recebida (cada página de um lote paginado é uma linha).
CREATE TABLE IF NOT EXISTS public.late_hunter_syncs (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiente                text        NOT NULL CHECK (ambiente IN ('producao', 'homologacao')),
  fonte                   text        NOT NULL,
  referencia              date        NOT NULL,
  gerado_em               timestamptz,
  completo                boolean     NOT NULL,
  pagina                  integer     NOT NULL DEFAULT 1,
  total_paginas           integer     NOT NULL DEFAULT 1,
  recebidos               integer     NOT NULL DEFAULT 0,
  criados                 integer     NOT NULL DEFAULT 0,
  atualizados             integer     NOT NULL DEFAULT 0,
  reabertos               integer     NOT NULL DEFAULT 0,
  inalterados             integer     NOT NULL DEFAULT 0,
  encerrados              integer     NOT NULL DEFAULT 0,
  rejeitados              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Por que o encerramento rodou ou não (a regra 3 tem três portões).
  encerramento            text        NOT NULL CHECK (encerramento IN
                            ('aplicado', 'lote_incompleto', 'paginas_pendentes', 'lote_antigo')),
  abertos_apos            integer     NOT NULL DEFAULT 0,
  recebido_em             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS late_hunter_syncs_ref_idx
  ON public.late_hunter_syncs (ambiente, referencia, recebido_em DESC);

-- Leitura só por RPC (abaixo). Sem policy = ninguém lê direto pela API REST.
ALTER TABLE public.late_hunter_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.late_hunter_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.late_hunter_syncs        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.late_hunter_orders, public.late_hunter_order_events, public.late_hunter_syncs
  FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────
-- "address-verification-failed, Held for Bad Address" -> lista sem vazios nem
-- repetidos, na ordem em que vieram.
CREATE OR REPLACE FUNCTION public.late_hunter_split_motivos(p_motivo text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(m ORDER BY primeira), '{}')
  FROM (
    SELECT btrim(part) AS m, min(ord) AS primeira
    FROM unnest(string_to_array(COALESCE(p_motivo, ''), ',')) WITH ORDINALITY AS t(part, ord)
    WHERE btrim(part) <> ''
    GROUP BY btrim(part)
  ) s;
$$;

-- texto 'AAAA-MM-DD' que é uma data de verdade (2026-02-30 não passa).
CREATE OR REPLACE FUNCTION public.late_hunter_valid_date(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
  RETURN to_char(p::date, 'YYYY-MM-DD') = p;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ingestão: chamada só pela Edge Function (service_role)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.late_hunter_sync(p_ambiente text, p_lote jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref           date;
  v_gerado        timestamptz;
  v_completo      boolean;
  v_fonte         text;
  v_pagina        integer;
  v_total_pag     integer;
  v_ultima_ref    date;
  v_antigo        boolean;
  v_item          jsonb;
  v_pedido        text;
  v_loja          text;
  v_erro          text;
  v_vistos        text[] := '{}';
  v_row           public.late_hunter_orders%ROWTYPE;
  v_new_id        bigint;
  v_end           jsonb;
  v_dias          integer;
  v_recebidos     integer := 0;
  v_criados       integer := 0;
  v_atualizados   integer := 0;
  v_reabertos     integer := 0;
  v_inalterados   integer := 0;
  v_encerrados    integer := 0;
  v_rejeitados    jsonb := '[]'::jsonb;
  v_encerramento  text;
  v_paginas_ok    boolean;
  v_abertos       integer;
BEGIN
  IF p_ambiente NOT IN ('producao', 'homologacao') THEN
    RAISE EXCEPTION 'ambiente invalido' USING ERRCODE = '22023';
  END IF;
  -- O envelope já foi validado na Edge Function; aqui é a rede de segurança.
  IF jsonb_typeof(p_lote) <> 'object'
     OR NOT public.late_hunter_valid_date(p_lote->>'referencia')
     OR jsonb_typeof(p_lote->'completo') <> 'boolean'
     OR jsonb_typeof(p_lote->'itens') <> 'array' THEN
    RAISE EXCEPTION 'envelope invalido' USING ERRCODE = '22023';
  END IF;

  v_ref       := (p_lote->>'referencia')::date;
  v_gerado    := NULLIF(p_lote->>'geradoEm', '')::timestamptz;
  v_completo  := (p_lote->>'completo')::boolean;
  v_fonte     := COALESCE(NULLIF(btrim(p_lote->>'fonte'), ''), 'walle');
  v_pagina    := COALESCE((p_lote->>'pagina')::integer, 1);
  v_total_pag := COALESCE((p_lote->>'totalPaginas')::integer, 1);
  IF v_pagina < 1 OR v_total_pag < 1 OR v_pagina > v_total_pag THEN
    RAISE EXCEPTION 'paginacao invalida' USING ERRCODE = '22023';
  END IF;

  -- Um sync por ambiente de cada vez: dois retries simultâneos do mesmo lote não
  -- podem disputar o mesmo pedido.
  PERFORM pg_advisory_xact_lock(hashtext('late_hunter_sync:' || p_ambiente));

  SELECT max(referencia) INTO v_ultima_ref FROM public.late_hunter_syncs WHERE ambiente = p_ambiente;
  v_antigo := v_ultima_ref IS NOT NULL AND v_ref < v_ultima_ref;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lote->'itens') LOOP
    v_recebidos := v_recebidos + 1;
    v_pedido := NULLIF(btrim(v_item->>'pedido'), '');
    v_loja   := NULLIF(btrim(v_item->>'loja'), '');
    v_erro   := NULL;

    IF jsonb_typeof(v_item) <> 'object' THEN
      v_erro := 'item nao e objeto';
    ELSIF v_pedido IS NULL THEN
      v_erro := 'pedido obrigatorio';
    ELSIF v_loja IS NULL THEN
      v_erro := 'loja obrigatoria';
    ELSIF NULLIF(btrim(v_item->>'motivo'), '') IS NULL THEN
      v_erro := 'motivo obrigatorio';
    ELSIF jsonb_typeof(v_item->'clienteNome') IS DISTINCT FROM 'string' THEN
      v_erro := 'clienteNome obrigatorio';
    ELSIF jsonb_typeof(v_item->'clienteEmail') IS DISTINCT FROM 'string' THEN
      -- Vazio ou sujo passa (a especificação pede para não rejeitar); ausente não.
      v_erro := 'clienteEmail obrigatorio';
    ELSIF NOT public.late_hunter_valid_date(v_item->>'data') THEN
      v_erro := 'data invalida (AAAA-MM-DD)';
    ELSIF v_item ? 'diasEmEspera' AND jsonb_typeof(v_item->'diasEmEspera') NOT IN ('number', 'null') THEN
      v_erro := 'diasEmEspera invalido';
    ELSIF jsonb_typeof(v_item->'diasEmEspera') = 'number'
          AND ((v_item->>'diasEmEspera')::numeric < 0
               OR (v_item->>'diasEmEspera')::numeric <> trunc((v_item->>'diasEmEspera')::numeric)) THEN
      v_erro := 'diasEmEspera invalido';
    ELSIF v_item ? 'endereco' AND jsonb_typeof(v_item->'endereco') NOT IN ('object', 'null') THEN
      v_erro := 'endereco invalido';
    ELSIF (v_loja || chr(31) || v_pedido) = ANY (v_vistos) THEN
      v_erro := 'pedido+loja repetido no lote';
    END IF;

    IF v_erro IS NOT NULL THEN
      v_rejeitados := v_rejeitados || jsonb_build_object('pedido', v_pedido, 'loja', v_loja, 'erro', v_erro);
      CONTINUE;
    END IF;
    v_vistos := v_vistos || (v_loja || chr(31) || v_pedido);

    v_dias := CASE WHEN jsonb_typeof(v_item->'diasEmEspera') = 'number'
                   THEN (v_item->>'diasEmEspera')::integer END;
    v_end  := CASE WHEN jsonb_typeof(v_item->'endereco') = 'object' THEN v_item->'endereco' END;

    SELECT * INTO v_row
    FROM public.late_hunter_orders
    WHERE ambiente = p_ambiente AND loja = v_loja AND pedido = v_pedido
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.late_hunter_orders (
        ambiente, pedido, loja, loja_nome, motivo, motivos, cliente_nome, cliente_email,
        data_pedido, dias_em_espera, itens, endereco, pais,
        primeira_referencia, ultima_referencia
      ) VALUES (
        p_ambiente, v_pedido, v_loja, NULLIF(btrim(v_item->>'lojaNome'), ''),
        btrim(v_item->>'motivo'), public.late_hunter_split_motivos(v_item->>'motivo'),
        v_item->>'clienteNome', lower(btrim(v_item->>'clienteEmail')),
        (v_item->>'data')::date, v_dias, NULLIF(v_item->>'itens', ''), v_end,
        NULLIF(upper(btrim(v_end->>'pais')), ''),
        v_ref, v_ref
      )
      RETURNING id INTO v_new_id;
      INSERT INTO public.late_hunter_order_events (order_id, ambiente, evento, referencia)
      VALUES (v_new_id, p_ambiente, 'criado', v_ref);
      v_criados := v_criados + 1;
      CONTINUE;
    END IF;

    -- Lote mais antigo que o que este pedido já viu (ou que o encerrou): os
    -- fatos dele são velhos. Não sobrescreve, não reabre.
    IF v_ref < v_row.ultima_referencia
       OR (v_row.situacao = 'encerrado' AND v_ref <= v_row.encerrado_referencia) THEN
      v_inalterados := v_inalterados + 1;
      CONTINUE;
    END IF;

    IF v_row.situacao = 'encerrado' THEN
      UPDATE public.late_hunter_orders SET
        situacao = 'aberto', motivo_encerramento = NULL, encerrado_em = NULL, encerrado_referencia = NULL,
        vezes_reaberto = vezes_reaberto + 1
      WHERE id = v_row.id;
      INSERT INTO public.late_hunter_order_events (order_id, ambiente, evento, referencia)
      VALUES (v_row.id, p_ambiente, 'reaberto', v_ref);
      v_reabertos := v_reabertos + 1;
    END IF;

    -- Fatos: o sync sobrescreve. "atualizados" só conta mudança real.
    UPDATE public.late_hunter_orders SET
      loja_nome      = NULLIF(btrim(v_item->>'lojaNome'), ''),
      motivo         = btrim(v_item->>'motivo'),
      motivos        = public.late_hunter_split_motivos(v_item->>'motivo'),
      cliente_nome   = v_item->>'clienteNome',
      cliente_email  = lower(btrim(v_item->>'clienteEmail')),
      data_pedido    = (v_item->>'data')::date,
      dias_em_espera = v_dias,
      itens          = NULLIF(v_item->>'itens', ''),
      endereco       = v_end,
      pais           = NULLIF(upper(btrim(v_end->>'pais')), ''),
      ultima_referencia = v_ref,
      atualizado_em  = now()
    WHERE id = v_row.id;

    IF v_row.situacao = 'encerrado' THEN
      NULL; -- já contado como reaberto
    ELSIF (v_row.loja_nome, v_row.motivo, v_row.cliente_nome, v_row.cliente_email, v_row.data_pedido,
           v_row.dias_em_espera, v_row.itens, v_row.endereco)
          IS DISTINCT FROM
          (NULLIF(btrim(v_item->>'lojaNome'), ''), btrim(v_item->>'motivo'), v_item->>'clienteNome',
           lower(btrim(v_item->>'clienteEmail')), (v_item->>'data')::date, v_dias,
           NULLIF(v_item->>'itens', ''), v_end) THEN
      v_atualizados := v_atualizados + 1;
    ELSE
      v_inalterados := v_inalterados + 1;
    END IF;
  END LOOP;

  -- Regra 3, com os três portões.
  IF NOT v_completo THEN
    v_encerramento := 'lote_incompleto';
  ELSIF v_antigo THEN
    v_encerramento := 'lote_antigo';
  ELSE
    -- Todas as páginas desta referência chegaram (contando a atual)?
    SELECT count(DISTINCT p) = v_total_pag INTO v_paginas_ok
    FROM (
      SELECT pagina AS p FROM public.late_hunter_syncs
      WHERE ambiente = p_ambiente AND referencia = v_ref AND total_paginas = v_total_pag
      UNION SELECT v_pagina
    ) s;

    IF NOT v_paginas_ok THEN
      v_encerramento := 'paginas_pendentes';
    ELSE
      v_encerramento := 'aplicado';
      WITH fechados AS (
        UPDATE public.late_hunter_orders SET
          situacao = 'encerrado',
          motivo_encerramento = 'resolvido-automaticamente',
          encerrado_em = now(),
          encerrado_referencia = v_ref,
          atualizado_em = now()
        WHERE ambiente = p_ambiente AND situacao = 'aberto' AND ultima_referencia < v_ref
        RETURNING id
      ), ev AS (
        INSERT INTO public.late_hunter_order_events (order_id, ambiente, evento, referencia)
        SELECT id, p_ambiente, 'encerrado', v_ref FROM fechados
        RETURNING 1
      )
      SELECT count(*) INTO v_encerrados FROM ev;
    END IF;
  END IF;

  SELECT count(*) INTO v_abertos
  FROM public.late_hunter_orders WHERE ambiente = p_ambiente AND situacao = 'aberto';

  INSERT INTO public.late_hunter_syncs (
    ambiente, fonte, referencia, gerado_em, completo, pagina, total_paginas,
    recebidos, criados, atualizados, reabertos, inalterados, encerrados, rejeitados,
    encerramento, abertos_apos
  ) VALUES (
    p_ambiente, v_fonte, v_ref, v_gerado, v_completo, v_pagina, v_total_pag,
    v_recebidos, v_criados, v_atualizados, v_reabertos, v_inalterados, v_encerrados, v_rejeitados,
    v_encerramento, v_abertos
  );

  RETURN jsonb_build_object(
    'recebidos',   v_recebidos,
    'criados',     v_criados,
    'atualizados', v_atualizados,
    'reabertos',   v_reabertos,
    'inalterados', v_inalterados,
    'encerrados',  v_encerrados,
    'rejeitados',  v_rejeitados,
    'encerramento', v_encerramento
  );
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_sync(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.late_hunter_sync(text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Leitura: só o time de produtos (is_produtos_team, de 20260916120000)
-- ─────────────────────────────────────────────────────────────────────────────

-- Visão geral: saúde do último sync, KPIs, envelhecimento, fluxo diário e as
-- quebras que alimentam gráficos e opções de filtro.
CREATE OR REPLACE FUNCTION public.late_hunter_overview(p_ambiente text DEFAULT 'producao')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_produtos_team() THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH abertos AS (
    SELECT * FROM public.late_hunter_orders WHERE ambiente = p_ambiente AND situacao = 'aberto'
  ),
  ultimo AS (
    SELECT * FROM public.late_hunter_syncs WHERE ambiente = p_ambiente
    ORDER BY recebido_em DESC LIMIT 1
  ),
  ultima_ref AS (
    SELECT max(referencia) AS ref FROM public.late_hunter_syncs WHERE ambiente = p_ambiente
  ),
  -- Últimas 30 referências: estoque aberto ao fim do dia + entradas/saídas.
  refs AS (
    SELECT DISTINCT referencia FROM public.late_hunter_syncs
    WHERE ambiente = p_ambiente ORDER BY referencia DESC LIMIT 30
  ),
  fluxo AS (
    SELECT r.referencia,
      -- Lote antigo reprocessado depois não descreve o dia dele: o estoque
      -- daquela hora já é o de um dia mais novo.
      (SELECT s.abertos_apos FROM public.late_hunter_syncs s
        WHERE s.ambiente = p_ambiente AND s.referencia = r.referencia AND s.encerramento <> 'lote_antigo'
        ORDER BY s.recebido_em DESC LIMIT 1) AS abertos,
      (SELECT count(*) FROM public.late_hunter_order_events e
        WHERE e.ambiente = p_ambiente AND e.referencia = r.referencia AND e.evento IN ('criado', 'reaberto')) AS entraram,
      (SELECT count(*) FROM public.late_hunter_order_events e
        WHERE e.ambiente = p_ambiente AND e.referencia = r.referencia AND e.evento = 'encerrado') AS sairam
    FROM refs r
  ),
  faixas AS (
    SELECT
      CASE
        WHEN dias_em_espera IS NULL THEN 'sem_dado'
        WHEN dias_em_espera <= 3  THEN '0-3'
        WHEN dias_em_espera <= 7  THEN '4-7'
        WHEN dias_em_espera <= 14 THEN '8-14'
        WHEN dias_em_espera <= 30 THEN '15-30'
        WHEN dias_em_espera <= 60 THEN '31-60'
        ELSE '60+'
      END AS faixa,
      count(*) AS n
    FROM abertos GROUP BY 1
  ),
  todos AS (
    SELECT * FROM public.late_hunter_orders WHERE ambiente = p_ambiente
  )
  SELECT jsonb_build_object(
    'ultimo_sync', (SELECT to_jsonb(u) - 'id' FROM ultimo u),
    'kpis', jsonb_build_object(
      'abertos',          (SELECT count(*) FROM abertos),
      'encerrados',       (SELECT count(*) FROM todos WHERE situacao = 'encerrado'),
      'mais_30_dias',     (SELECT count(*) FROM abertos WHERE dias_em_espera > 30),
      'reabertos_abertos',(SELECT count(*) FROM abertos WHERE vezes_reaberto > 0),
      'mediana_dias',     (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_em_espera) FROM abertos),
      'p90_dias',         (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY dias_em_espera) FROM abertos),
      'entraram_ultimo',  (SELECT count(*) FROM public.late_hunter_order_events e, ultima_ref u
                            WHERE e.ambiente = p_ambiente AND e.referencia = u.ref AND e.evento IN ('criado', 'reaberto')),
      'sairam_ultimo',    (SELECT count(*) FROM public.late_hunter_order_events e, ultima_ref u
                            WHERE e.ambiente = p_ambiente AND e.referencia = u.ref AND e.evento = 'encerrado'),
      'clientes_abertos', (SELECT count(DISTINCT NULLIF(cliente_email, '')) FROM abertos)
    ),
    'envelhecimento', COALESCE((SELECT jsonb_object_agg(faixa, n) FROM faixas), '{}'::jsonb),
    'fluxo', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.referencia) FROM fluxo f), '[]'::jsonb),
    'motivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('motivo', m, 'abertos', ab, 'total', tt) ORDER BY ab DESC, tt DESC, m)
      FROM (
        SELECT m, count(*) FILTER (WHERE t.situacao = 'aberto') AS ab, count(*) AS tt
        FROM todos t, unnest(t.motivos) AS m GROUP BY m
      ) x), '[]'::jsonb),
    'lojas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('loja', loja, 'loja_nome', nome, 'abertos', ab, 'total', tt,
                                          'mais_30_dias', velhos) ORDER BY ab DESC, tt DESC, loja)
      FROM (
        SELECT loja, max(loja_nome) AS nome,
               count(*) FILTER (WHERE situacao = 'aberto') AS ab, count(*) AS tt,
               count(*) FILTER (WHERE situacao = 'aberto' AND dias_em_espera > 30) AS velhos
        FROM todos GROUP BY loja
      ) x), '[]'::jsonb),
    'paises', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pais', pais, 'abertos', ab, 'total', tt) ORDER BY ab DESC, tt DESC, pais)
      FROM (
        SELECT COALESCE(pais, '') AS pais, count(*) FILTER (WHERE situacao = 'aberto') AS ab, count(*) AS tt
        FROM todos GROUP BY 1
      ) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_overview(text) TO authenticated;

-- Lista filtrada e paginada. Paginação numerada (OFFSET) de propósito: a base é
-- pequena (centenas a poucos milhares de linhas por ambiente) e a tela tem
-- números de página como o resto do app.
CREATE OR REPLACE FUNCTION public.late_hunter_list(
  p_ambiente  text    DEFAULT 'producao',
  p_situacao  text    DEFAULT 'aberto',   -- aberto | encerrado | todos
  p_motivos   text[]  DEFAULT NULL,       -- pedido entra se tiver QUALQUER um
  p_lojas     text[]  DEFAULT NULL,
  p_paises    text[]  DEFAULT NULL,       -- '' = sem país
  p_dias_min  integer DEFAULT NULL,
  p_dias_max  integer DEFAULT NULL,
  p_data_de   date    DEFAULT NULL,
  p_data_ate  date    DEFAULT NULL,
  p_reabertos boolean DEFAULT false,
  p_busca     text    DEFAULT NULL,
  p_ordem     text    DEFAULT 'dias_desc',
  p_limite    integer DEFAULT 50,
  p_offset    integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_total bigint;
  v_rows  jsonb;
BEGIN
  IF NOT public.is_produtos_team() THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Limite alto só para a exportação (planilha com todos os filtrados).
  p_limite := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 10000);
  p_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH f AS (
    SELECT o.* FROM public.late_hunter_orders o
    WHERE o.ambiente = p_ambiente
      AND (p_situacao = 'todos' OR o.situacao = p_situacao)
      AND (p_motivos IS NULL OR cardinality(p_motivos) = 0 OR o.motivos && p_motivos)
      AND (p_lojas   IS NULL OR cardinality(p_lojas)   = 0 OR o.loja = ANY (p_lojas))
      AND (p_paises  IS NULL OR cardinality(p_paises)  = 0 OR COALESCE(o.pais, '') = ANY (p_paises))
      AND (p_dias_min IS NULL OR o.dias_em_espera >= p_dias_min)
      AND (p_dias_max IS NULL OR o.dias_em_espera <= p_dias_max)
      AND (p_data_de  IS NULL OR o.data_pedido >= p_data_de)
      AND (p_data_ate IS NULL OR o.data_pedido <= p_data_ate)
      AND (NOT COALESCE(p_reabertos, false) OR o.vezes_reaberto > 0)
      AND (v_busca IS NULL OR (
            o.pedido ILIKE '%' || v_busca || '%'
         OR o.cliente_email ILIKE '%' || v_busca || '%'
         OR o.cliente_nome ILIKE '%' || v_busca || '%'
         OR o.loja ILIKE '%' || v_busca || '%'
         OR COALESCE(o.loja_nome, '') ILIKE '%' || v_busca || '%'
         OR COALESCE(o.itens, '') ILIKE '%' || v_busca || '%'))
  ),
  pg AS (
    SELECT f.*, row_number() OVER (ORDER BY
        CASE WHEN p_ordem = 'dias_desc'  THEN dias_em_espera END DESC NULLS LAST,
        CASE WHEN p_ordem = 'dias_asc'   THEN dias_em_espera END ASC NULLS LAST,
        CASE WHEN p_ordem = 'data_desc'  THEN data_pedido END DESC,
        CASE WHEN p_ordem = 'data_asc'   THEN data_pedido END ASC,
        CASE WHEN p_ordem = 'recentes'   THEN primeira_referencia END DESC,
        CASE WHEN p_ordem = 'encerrados' THEN encerrado_em END DESC NULLS LAST,
        loja, pedido) AS rn
    FROM f
  )
  SELECT (SELECT count(*) FROM f),
         COALESCE((
           SELECT jsonb_agg(to_jsonb(x) - 'ambiente' - 'criado_em' - 'rn' ORDER BY x.rn)
           FROM (SELECT * FROM pg WHERE rn > p_offset ORDER BY rn LIMIT p_limite) x
         ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_list(text, text, text[], text[], text[], integer, integer, date, date, boolean, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_list(text, text, text[], text[], text[], integer, integer, date, date, boolean, text, text, integer, integer) TO authenticated;

-- Linha do tempo de um pedido (entrou, saiu, voltou).
CREATE OR REPLACE FUNCTION public.late_hunter_order_history(p_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_produtos_team() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('evento', evento, 'referencia', referencia, 'ocorrido_em', ocorrido_em)
                     ORDER BY ocorrido_em, id)
    FROM public.late_hunter_order_events WHERE order_id = p_order_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_order_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_order_history(bigint) TO authenticated;
