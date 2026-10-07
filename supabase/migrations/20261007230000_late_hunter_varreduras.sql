-- Late Hunter — várias varreduras por dia (aviso do Bruno, 07/10/2026).
--
-- O Late Hunter não roda mais 1x por dia: ele varre a ShipOffers 7x por dia
-- (04:15, 07:15, 10:15, 13:15, 16:15, 19:15 e 22:15 UTC) e chama a Edge
-- Function a cada varredura. A gente não agenda nada — só precisa estar no ar
-- para receber.
--
-- Até aqui o LOTE era identificado pelo dia (`referencia`). Com 7 lotes no mesmo
-- dia isso quebra a regra 3: quem saiu do hold entre a varredura das 10:15 e a
-- das 13:15 tem `ultima_referencia` = hoje = referência do lote novo, e não era
-- encerrado até o dia seguinte. O mesmo valia para "lote antigo" e para o
-- portão das páginas.
--
-- Agora o lote é identificado por `geradoEm` (o instante da varredura, que o
-- Late Hunter já manda e a Edge Function já exige). `referencia` continua no
-- contrato e segue agrupando o gráfico de fluxo por dia.
--
-- Contrato com o Late Hunter: todas as páginas de uma mesma varredura levam o
-- MESMO `geradoEm`.
--
-- Produção ainda não tinha recebido nenhum lote (só o exemplo de homologação),
-- então o preenchimento abaixo é só para o exemplo continuar coerente.

-- ─────────────────────────────────────────────────────────────────────────────
-- Colunas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.late_hunter_orders
  ADD COLUMN IF NOT EXISTS primeiro_lote  timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_lote    timestamptz,
  ADD COLUMN IF NOT EXISTS encerrado_lote timestamptz;

ALTER TABLE public.late_hunter_order_events
  ADD COLUMN IF NOT EXISTS lote timestamptz;

UPDATE public.late_hunter_syncs
SET gerado_em = referencia::timestamptz
WHERE gerado_em IS NULL;

-- Lote de cada pedido = a varredura mais recente da referência que ele já viu.
UPDATE public.late_hunter_orders o SET
  primeiro_lote = COALESCE((SELECT max(s.gerado_em) FROM public.late_hunter_syncs s
                            WHERE s.ambiente = o.ambiente AND s.referencia = o.primeira_referencia),
                           o.primeira_referencia::timestamptz),
  ultimo_lote   = COALESCE((SELECT max(s.gerado_em) FROM public.late_hunter_syncs s
                            WHERE s.ambiente = o.ambiente AND s.referencia = o.ultima_referencia),
                           o.ultima_referencia::timestamptz),
  encerrado_lote = CASE WHEN o.encerrado_referencia IS NOT NULL THEN
                     COALESCE((SELECT max(s.gerado_em) FROM public.late_hunter_syncs s
                               WHERE s.ambiente = o.ambiente AND s.referencia = o.encerrado_referencia),
                              o.encerrado_referencia::timestamptz)
                   END
WHERE o.ultimo_lote IS NULL;

UPDATE public.late_hunter_order_events e
SET lote = COALESCE((SELECT max(s.gerado_em) FROM public.late_hunter_syncs s
                     WHERE s.ambiente = e.ambiente AND s.referencia = e.referencia),
                    e.referencia::timestamptz)
WHERE e.lote IS NULL;

ALTER TABLE public.late_hunter_syncs        ALTER COLUMN gerado_em     SET NOT NULL;
ALTER TABLE public.late_hunter_orders       ALTER COLUMN primeiro_lote SET NOT NULL;
ALTER TABLE public.late_hunter_orders       ALTER COLUMN ultimo_lote   SET NOT NULL;
ALTER TABLE public.late_hunter_order_events ALTER COLUMN lote          SET NOT NULL;

-- Encerramento da regra 3 agora compara a varredura, não o dia.
DROP INDEX IF EXISTS public.late_hunter_orders_ultima_ref_idx;
CREATE INDEX IF NOT EXISTS late_hunter_orders_ultimo_lote_idx
  ON public.late_hunter_orders (ambiente, ultimo_lote) WHERE situacao = 'aberto';
-- "Entraram/saíram no último lote".
CREATE INDEX IF NOT EXISTS late_hunter_order_events_lote_idx
  ON public.late_hunter_order_events (ambiente, lote, evento);
-- Lote antigo e portão das páginas.
CREATE INDEX IF NOT EXISTS late_hunter_syncs_lote_idx
  ON public.late_hunter_syncs (ambiente, gerado_em);

COMMENT ON TABLE public.late_hunter_orders IS
  'Pedidos em on-hold recebidos do Late Hunter (varreduras ao longo do dia). Separada de held_orders.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Ingestão (corpo de 20261002190000, com o lote identificado por geradoEm)
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
     OR NULLIF(p_lote->>'geradoEm', '') IS NULL
     OR jsonb_typeof(p_lote->'completo') <> 'boolean'
     OR jsonb_typeof(p_lote->'itens') <> 'array' THEN
    RAISE EXCEPTION 'envelope invalido' USING ERRCODE = '22023';
  END IF;

  v_ref       := (p_lote->>'referencia')::date;
  BEGIN
    v_gerado  := (p_lote->>'geradoEm')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'geradoEm invalido' USING ERRCODE = '22023';
  END;
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

  -- Já chegou uma varredura mais nova que esta?
  SELECT EXISTS (
    SELECT 1 FROM public.late_hunter_syncs WHERE ambiente = p_ambiente AND gerado_em > v_gerado
  ) INTO v_antigo;

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
        primeira_referencia, ultima_referencia, primeiro_lote, ultimo_lote
      ) VALUES (
        p_ambiente, v_pedido, v_loja, NULLIF(btrim(v_item->>'lojaNome'), ''),
        btrim(v_item->>'motivo'), public.late_hunter_split_motivos(v_item->>'motivo'),
        v_item->>'clienteNome', lower(btrim(v_item->>'clienteEmail')),
        (v_item->>'data')::date, v_dias, NULLIF(v_item->>'itens', ''), v_end,
        NULLIF(upper(btrim(v_end->>'pais')), ''),
        v_ref, v_ref, v_gerado, v_gerado
      )
      RETURNING id INTO v_new_id;
      INSERT INTO public.late_hunter_order_events (order_id, ambiente, evento, referencia, lote)
      VALUES (v_new_id, p_ambiente, 'criado', v_ref, v_gerado);
      v_criados := v_criados + 1;
      CONTINUE;
    END IF;

    -- Varredura mais antiga que a que este pedido já viu (ou que o encerrou): os
    -- fatos dela são velhos. Não sobrescreve, não reabre.
    IF v_gerado < v_row.ultimo_lote
       OR (v_row.situacao = 'encerrado' AND v_gerado <= v_row.encerrado_lote) THEN
      v_inalterados := v_inalterados + 1;
      CONTINUE;
    END IF;

    IF v_row.situacao = 'encerrado' THEN
      UPDATE public.late_hunter_orders SET
        situacao = 'aberto', motivo_encerramento = NULL, encerrado_em = NULL,
        encerrado_referencia = NULL, encerrado_lote = NULL,
        vezes_reaberto = vezes_reaberto + 1
      WHERE id = v_row.id;
      INSERT INTO public.late_hunter_order_events (order_id, ambiente, evento, referencia, lote)
      VALUES (v_row.id, p_ambiente, 'reaberto', v_ref, v_gerado);
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
      ultima_referencia = GREATEST(ultima_referencia, v_ref),
      ultimo_lote    = v_gerado,
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
    -- Todas as páginas desta varredura chegaram (contando a atual)?
    SELECT count(DISTINCT p) = v_total_pag INTO v_paginas_ok
    FROM (
      SELECT pagina AS p FROM public.late_hunter_syncs
      WHERE ambiente = p_ambiente AND gerado_em = v_gerado AND total_paginas = v_total_pag
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
          encerrado_lote = v_gerado,
          atualizado_em = now()
        WHERE ambiente = p_ambiente AND situacao = 'aberto' AND ultimo_lote < v_gerado
        RETURNING id
      ), ev AS (
        INSERT INTO public.late_hunter_order_events (order_id, ambiente, evento, referencia, lote)
        SELECT id, p_ambiente, 'encerrado', v_ref, v_gerado FROM fechados
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
-- Visão geral (corpo de 20261002210000). Mudam três coisas:
--   * "último lote" dos cartões = a última VARREDURA, não o último dia;
--   * o fluxo continua por dia, com o estoque da última varredura do dia;
--   * a ordem das varreduras é gerado_em (recebido_em só desempata).
-- ─────────────────────────────────────────────────────────────────────────────
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
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH abertos AS (
    SELECT * FROM public.late_hunter_orders WHERE ambiente = p_ambiente AND situacao = 'aberto'
  ),
  ultimo AS (
    SELECT * FROM public.late_hunter_syncs WHERE ambiente = p_ambiente
    ORDER BY recebido_em DESC LIMIT 1
  ),
  ultimo_lote AS (
    SELECT max(gerado_em) AS lote FROM public.late_hunter_syncs WHERE ambiente = p_ambiente
  ),
  -- Últimos 30 dias com varredura: estoque aberto ao fim do dia + entradas/saídas do dia.
  refs AS (
    SELECT DISTINCT referencia FROM public.late_hunter_syncs
    WHERE ambiente = p_ambiente ORDER BY referencia DESC LIMIT 30
  ),
  fluxo AS (
    SELECT r.referencia,
      -- Lote antigo reprocessado depois não descreve o dia dele: o estoque
      -- daquela hora já é o de uma varredura mais nova.
      (SELECT s.abertos_apos FROM public.late_hunter_syncs s
        WHERE s.ambiente = p_ambiente AND s.referencia = r.referencia AND s.encerramento <> 'lote_antigo'
        ORDER BY s.gerado_em DESC, s.recebido_em DESC LIMIT 1) AS abertos,
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
      'entraram_ultimo',  (SELECT count(*) FROM public.late_hunter_order_events e, ultimo_lote u
                            WHERE e.ambiente = p_ambiente AND e.lote = u.lote AND e.evento IN ('criado', 'reaberto')),
      'sairam_ultimo',    (SELECT count(*) FROM public.late_hunter_order_events e, ultimo_lote u
                            WHERE e.ambiente = p_ambiente AND e.lote = u.lote AND e.evento = 'encerrado'),
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

-- Linha do tempo de um pedido: agora com o instante da varredura (`lote`).
CREATE OR REPLACE FUNCTION public.late_hunter_order_history(p_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_manager() OR public.is_produtos_team()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('evento', evento, 'referencia', referencia, 'lote', lote,
                                        'ocorrido_em', ocorrido_em)
                     ORDER BY ocorrido_em, id)
    FROM public.late_hunter_order_events WHERE order_id = p_order_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.late_hunter_order_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.late_hunter_order_history(bigint) TO authenticated;
