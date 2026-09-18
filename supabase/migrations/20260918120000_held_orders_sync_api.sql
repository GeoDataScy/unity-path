-- API Pedidos em Espera — ingestão do Wall-E (substitui o import manual de planilhas).
--
-- Contexto (especificação "API Pedidos em Espera", 17/09/2026): a ShipOffers manda
-- por e-mail, todo dia, um CSV de on-holds por dyna code. Hoje alguém baixa dezenas
-- de anexos, consolida e importa na tela (manager_import_held_orders). O Wall-E
-- passa a ler esses e-mails, consolidar o dia inteiro num lote e POSTar aqui.
--
-- A especificação define três regras. Esta migração implementa as três, com duas
-- divergências deliberadas que estão documentadas abaixo e em docs/api-pedidos-em-espera.md.
--
--   1) Chave natural (loja, pedido) com upsert.
--      JÁ é a identidade do painel: (dyna_code, import_key) com import_key =
--      order_number, garantida pelo índice parcial held_orders_one_open_per_identity_uniq
--      (ver 20260805120000 / 20260806130000). O sync reusa exatamente essa chave —
--      não inventa outra, senão as duas entradas divergiriam.
--
--   2) `agente` e `status` são intocáveis pelo sync.
--      Nenhum UPDATE daqui escreve em assigned_to, agent_status, status, pending_tag,
--      assign_count, confirmed_at ou confirmed_by. Só campos factuais da ShipOffers.
--
--   3) `completo: true` encerra o que sumiu do relatório.
--      Encerramento é um estado NOVO (closed_at/closed_reason), ortogonal ao
--      agent_status. Não apaga linha nem trabalho de agente, e é reversível: se o
--      pedido voltar ao on-hold, o próximo lote reabre a mesma linha.
--
-- DIVERGÊNCIA A — "existe e está encerrada -> reabre".
--   A spec trata "encerrado" e "concluído" como a mesma coisa. Aqui não são:
--     * encerrado pelo sync (closed_at) -> reabre a MESMA linha (reopen_count += 1),
--       preservando o histórico, exatamente como a spec pede;
--     * concluído por um agente (agent_status = 'concluido') -> NÃO reabre. Reabrir
--       reescreveria trabalho já entregue e violaria a regra 2. O pedido voltar ao
--       on-hold depois de atendido é trabalho NOVO e entra como linha nova — regra
--       de negócio já estabelecida em 20260805120000 e confirmada nos dados reais.
--   O índice parcial já expressa isso: linha concluída sai da chave de unicidade.
--
-- DIVERGÊNCIA B — o que a regra 3 pode encerrar.
--   O painel tem hoje ~3.3 mil linhas abertas vindas do import manual, muitas
--   provavelmente já resolvidas fora do sistema. Se o primeiro lote `completo: true`
--   encerrasse "toda linha aberta que não veio no lote", ele fecharia a base inteira
--   de uma vez — inclusive o que agentes estão tratando agora. Então a regra 3 só
--   alcança linha que o sync JÁ reconheceu ao menos uma vez (synced_at IS NOT NULL).
--   O legado entra no universo do sync no dia em que aparecer num lote. O que nunca
--   aparecer continua aberto e visível: a RPC de analytics expõe esse resíduo em
--   `legado_fora_do_sync`, para o time decidir o que fazer com ele — em vez de o
--   sistema apagar em silêncio um número que ninguém conferiu.
--
-- Convenções (ver 20260617000000_create_held_orders.sql):
--   * ids de agente são TEXT, comparados com auth.uid()::text;
--   * escrita só via RPC SECURITY DEFINER;
--   * esta RPC NÃO é para usuário logado: só o service_role (Edge Function
--     pedidos-espera-sync, que valida o Bearer token do Wall-E) pode executá-la.

-- ============================================================================
-- 1) Colunas do ciclo de vida do sync
-- ============================================================================
ALTER TABLE public.held_orders
  -- Nome do produto ("Feilaira"), que o Wall-E extrai do assunto do e-mail. O CSV
  -- não tem esse campo; a tela mostrava só o dyna code.
  ADD COLUMN IF NOT EXISTS store_name   text,
  -- Dias em hold já calculados pela ShipOffers. `age` continua guardando o texto
  -- cru ("66 day(s)") para não quebrar quem já lê; aqui fica o número, que é o que
  -- serve para priorizar fila e calcular distribuição de idade.
  ADD COLUMN IF NOT EXISTS days_held    int,
  -- Quando o pedido entrou na fila. Sem isso não existe análise de fluxo: imported_at
  -- é a data da PLANILHA, não a do pedido.
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  -- Última vez que o Wall-E confirmou este pedido como ainda em on-hold.
  ADD COLUMN IF NOT EXISTS synced_at    timestamptz,
  -- `referencia` do último lote que trouxe este pedido. É o que faz a regra 3
  -- funcionar com lote paginado sem tabela temporária.
  ADD COLUMN IF NOT EXISTS sync_ref     date,
  -- Encerramento (regra 3). NULL = linha aberta.
  ADD COLUMN IF NOT EXISTS closed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text,
  -- Quantas vezes o pedido saiu e voltou ao on-hold. Sinal de qualidade do
  -- fulfillment: reabrir muito é problema na origem, não na fila.
  ADD COLUMN IF NOT EXISTS reopen_count int NOT NULL DEFAULT 0,
  -- 'import' (planilha, como sempre foi) | 'walle' (esta API).
  ADD COLUMN IF NOT EXISTS source       text NOT NULL DEFAULT 'import';

DO $$ BEGIN
  ALTER TABLE public.held_orders
    ADD CONSTRAINT held_orders_closed_reason_chk
    CHECK (closed_reason IS NULL OR closed_reason IN ('resolvido-automaticamente'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.held_orders
    ADD CONSTRAINT held_orders_source_chk
    CHECK (source IN ('import', 'walle'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: para o histórico, "entrou na fila" = quando a planilha o trouxe.
UPDATE public.held_orders SET first_seen_at = imported_at WHERE first_seen_at IS NULL;

-- Backfill de days_held a partir do texto cru ("66 day(s)" -> 66). O que não casar
-- fica NULL e a análise cai no order_date.
UPDATE public.held_orders
SET days_held = (regexp_match(age, '(\d+)'))[1]::int
WHERE days_held IS NULL
  AND age ~ '\d';

-- Fila aberta é sempre lida por estes recortes.
CREATE INDEX IF NOT EXISTS idx_held_orders_open_sync
  ON public.held_orders (sync_ref, synced_at)
  WHERE closed_at IS NULL AND agent_status <> 'concluido' AND duplicate_of IS NULL;
CREATE INDEX IF NOT EXISTS idx_held_orders_first_seen
  ON public.held_orders (first_seen_at);
CREATE INDEX IF NOT EXISTS idx_held_orders_closed_at
  ON public.held_orders (closed_at) WHERE closed_at IS NOT NULL;

-- ============================================================================
-- 2) held_order_sync_batches — log de lote (idempotência + observabilidade)
--
-- Serve a três coisas: devolver 409 num reenvio já processado, dar ao Wall-E o
-- mesmo retorno de novo, e deixar a integração auditável na tela de produtos
-- (o time vê se o sync rodou hoje e o que ele fez).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.held_order_sync_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte         text NOT NULL,
  referencia    date NOT NULL,
  pagina        int  NOT NULL DEFAULT 1,
  total_paginas int  NOT NULL DEFAULT 1,
  completo      boolean NOT NULL,
  gerado_em     timestamptz,
  recebidos     int NOT NULL DEFAULT 0,
  criados       int NOT NULL DEFAULT 0,
  atualizados   int NOT NULL DEFAULT 0,
  reabertos     int NOT NULL DEFAULT 0,
  inalterados   int NOT NULL DEFAULT 0,
  encerrados    int NOT NULL DEFAULT 0,
  repetidos     int NOT NULL DEFAULT 0,
  rejeitados    jsonb NOT NULL DEFAULT '[]'::jsonb,
  processado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT held_order_sync_batches_uniq UNIQUE (fonte, referencia, pagina)
);

CREATE INDEX IF NOT EXISTS idx_sync_batches_referencia
  ON public.held_order_sync_batches (referencia DESC, pagina);

ALTER TABLE public.held_order_sync_batches ENABLE ROW LEVEL SECURITY;

-- Leitura: gestora e time de produtos (é o painel de saúde da integração).
DROP POLICY IF EXISTS held_order_sync_batches_select ON public.held_order_sync_batches;
CREATE POLICY held_order_sync_batches_select ON public.held_order_sync_batches
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND (public.is_manager() OR public.is_produtos_team()));

GRANT SELECT ON public.held_order_sync_batches TO authenticated;

-- ============================================================================
-- 3) sync_held_orders(p_payload jsonb) — o endpoint, do lado do banco.
--
-- Recebe o envelope inteiro da spec e devolve exatamente o corpo de resposta que
-- o Wall-E espera. Roda numa transação só: ou o lote inteiro entra, ou nada entra
-- (o Wall-E faz retry com backoff em 5xx, e retry parcial produziria contagem
-- errada e encerramento indevido).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_held_orders(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fonte       text;
  v_referencia  date;
  v_gerado_em   timestamptz;
  v_completo    boolean;
  v_pagina      int;
  v_total_pag   int;
  v_itens       jsonb;
  v_recebidos   int := 0;
  v_criados     int := 0;
  v_atualizados int := 0;
  v_reabertos   int := 0;
  v_inalterados int := 0;
  v_repetidos   int := 0;
  v_encerrados  int := 0;
  v_rejeitados  jsonb := '[]'::jsonb;
  v_ja          public.held_order_sync_batches%ROWTYPE;
  v_ref_futura  date;
BEGIN
  -- ---- Envelope -----------------------------------------------------------
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload invalido: esperado objeto JSON' USING ERRCODE = '22023';
  END IF;

  v_fonte := NULLIF(btrim(p_payload->>'fonte'), '');
  IF v_fonte IS NULL THEN
    RAISE EXCEPTION 'envelope invalido: fonte obrigatoria' USING ERRCODE = '22023';
  END IF;

  IF (p_payload->>'referencia') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'envelope invalido: referencia deve ser AAAA-MM-DD' USING ERRCODE = '22023';
  END IF;
  v_referencia := (p_payload->>'referencia')::date;

  v_gerado_em := NULLIF(p_payload->>'geradoEm', '')::timestamptz;

  IF jsonb_typeof(p_payload->'completo') <> 'boolean' THEN
    RAISE EXCEPTION 'envelope invalido: completo deve ser booleano' USING ERRCODE = '22023';
  END IF;
  v_completo := (p_payload->>'completo')::boolean;

  v_itens := p_payload->'itens';
  IF jsonb_typeof(v_itens) <> 'array' THEN
    RAISE EXCEPTION 'envelope invalido: itens deve ser array' USING ERRCODE = '22023';
  END IF;

  -- Paginação é opcional; ausente = lote de página única.
  v_pagina    := GREATEST(COALESCE((p_payload->>'pagina')::int, 1), 1);
  v_total_pag := GREATEST(COALESCE((p_payload->>'totalPaginas')::int, 1), v_pagina);

  v_recebidos := jsonb_array_length(v_itens);

  -- ---- Idempotência: lote já processado devolve o mesmo resultado ----------
  SELECT * INTO v_ja
  FROM public.held_order_sync_batches
  WHERE fonte = v_fonte AND referencia = v_referencia AND pagina = v_pagina;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'jaProcessado', true,
      'recebidos',   v_ja.recebidos,
      'criados',     v_ja.criados,
      'atualizados', v_ja.atualizados,
      'reabertos',   v_ja.reabertos,
      'inalterados', v_ja.inalterados,
      'encerrados',  v_ja.encerrados,
      'repetidos',   v_ja.repetidos,
      'rejeitados',  v_ja.rejeitados,
      'processadoEm', v_ja.processado_em
    );
  END IF;

  -- ---- Upsert (regras 1 e 2) ----------------------------------------------
  WITH bruto AS (
    SELECT x.item, x.ord
    FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS x(item, ord)
  ),
  norm AS (
    SELECT
      ord,
      NULLIF(btrim(item->>'pedido'), '')                AS order_number,
      NULLIF(btrim(item->>'loja'), '')                  AS dyna_code,
      NULLIF(btrim(item->>'lojaNome'), '')              AS store_name,
      NULLIF(btrim(item->>'motivo'), '')                AS reason,
      NULLIF(btrim(item->>'clienteNome'), '')           AS customer_name,
      lower(NULLIF(btrim(item->>'clienteEmail'), ''))   AS email,
      CASE WHEN (item->>'data') ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (item->>'data')::date END               AS order_date,
      CASE WHEN jsonb_typeof(item->'diasEmEspera') = 'number'
           THEN (item->>'diasEmEspera')::int END        AS days_held,
      NULLIF(btrim(item->>'itens'), '')                 AS items,
      NULLIF(btrim(item->'endereco'->>'logradouro'), '')  AS street1,
      NULLIF(btrim(item->'endereco'->>'complemento'), '') AS street2,
      NULLIF(btrim(item->'endereco'->>'cidade'), '')      AS city,
      NULLIF(btrim(item->'endereco'->>'estado'), '')      AS state,
      NULLIF(btrim(item->'endereco'->>'pais'), '')        AS country,
      NULLIF(btrim(item->'endereco'->>'cep'), '')         AS postal_code
    FROM bruto
  ),
  -- Rejeição individual: derruba o item, nunca o lote. Só recusamos o que impede
  -- identificar ou trabalhar o pedido. Cliente e data ausentes entram como NULL —
  -- perder um on-hold real porque o CSV veio sem e-mail seria pior que a lacuna.
  classificado AS (
    SELECT
      n.*,
      CASE
        WHEN n.order_number IS NULL THEN 'pedido obrigatorio'
        WHEN n.dyna_code    IS NULL THEN 'loja obrigatoria'
        WHEN n.reason       IS NULL THEN 'motivo obrigatorio'
      END AS rejeicao
    FROM norm n
  ),
  -- O mesmo pedido duas vezes no mesmo lote: fica a primeira ocorrência.
  validos AS (
    SELECT DISTINCT ON (dyna_code, order_number) *
    FROM classificado
    WHERE rejeicao IS NULL
    ORDER BY dyna_code, order_number, ord
  ),
  -- Estado ANTES do upsert: esta CTE e as de escrita leem o mesmo snapshot, então
  -- dá para classificar criado/atualizado/reaberto/inalterado sem ler duas vezes.
  -- O índice parcial garante no máximo uma linha aberta por identidade.
  casado AS (
    SELECT
      v.*,
      o.id AS existing_id,
      (o.closed_at IS NOT NULL) AS estava_encerrado,
      (
        o.reason        IS DISTINCT FROM v.reason        OR
        o.customer_name IS DISTINCT FROM v.customer_name OR
        o.email         IS DISTINCT FROM v.email         OR
        o.order_date    IS DISTINCT FROM v.order_date    OR
        o.days_held     IS DISTINCT FROM v.days_held     OR
        o.items         IS DISTINCT FROM v.items         OR
        o.store_name    IS DISTINCT FROM COALESCE(v.store_name, o.store_name) OR
        o.street1       IS DISTINCT FROM v.street1       OR
        o.street2       IS DISTINCT FROM v.street2       OR
        o.city          IS DISTINCT FROM v.city          OR
        o.state         IS DISTINCT FROM v.state         OR
        o.country       IS DISTINCT FROM v.country       OR
        o.postal_code   IS DISTINCT FROM v.postal_code
      ) AS mudou
    FROM validos v
    JOIN public.held_orders o
      ON o.dyna_code = v.dyna_code
     AND o.import_key = v.order_number
     AND o.agent_status <> 'concluido'
     AND o.duplicate_of IS NULL
  ),
  -- Só campos factuais. assigned_to / agent_status / status / pending_tag /
  -- assign_count / confirmed_* NÃO aparecem aqui — é a regra 2, por construção.
  atualizadas AS (
    UPDATE public.held_orders o SET
      reason        = c.reason,
      customer_name = c.customer_name,
      email         = c.email,
      order_date    = c.order_date,
      days_held     = c.days_held,
      age           = COALESCE(c.days_held || ' day(s)', o.age),
      items         = c.items,
      -- store_name é atributo da LOJA, não fato diário do pedido: o Wall-E o extrai
      -- do assunto do e-mail e nem todo lote o traz. Sobrescrever com NULL apagaria
      -- um nome já conhecido. Os demais campos acima são fatos do dia e o sync é
      -- dono deles — ausente no CSV significa ausente mesmo.
      store_name    = COALESCE(c.store_name, o.store_name),
      street1       = c.street1,
      street2       = c.street2,
      city          = c.city,
      state         = c.state,
      country       = c.country,
      postal_code   = c.postal_code,
      source        = 'walle',
      synced_at     = now(),
      sync_ref      = v_referencia,
      -- Reabertura (regra 1 + regra 3 ao contrário): o pedido voltou ao on-hold.
      closed_at     = NULL,
      closed_reason = NULL,
      reopen_count  = o.reopen_count + CASE WHEN c.estava_encerrado THEN 1 ELSE 0 END
    FROM casado c
    WHERE o.id = c.existing_id
    RETURNING 1
  ),
  novas AS (
    INSERT INTO public.held_orders (
      dyna_code, order_number, import_key, store_name, reason, order_date,
      email, customer_name, city, street1, street2, state, country, postal_code,
      age, days_held, items, source, first_seen_at, synced_at, sync_ref, source_file
    )
    SELECT
      v.dyna_code, v.order_number, v.order_number, v.store_name, v.reason, v.order_date,
      v.email, v.customer_name, v.city, v.street1, v.street2, v.state, v.country, v.postal_code,
      v.days_held || ' day(s)', v.days_held, v.items, 'walle', now(), now(), v_referencia,
      'walle:' || v_referencia::text
    FROM validos v
    WHERE NOT EXISTS (SELECT 1 FROM casado c WHERE c.ord = v.ord)
    -- Backstop de corrida (dois lotes simultâneos não veem as linhas não commitadas
    -- um do outro); o índice parcial resolve.
    ON CONFLICT (dyna_code, import_key)
      WHERE agent_status <> 'concluido' AND duplicate_of IS NULL
      DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM novas),
    (SELECT count(*) FROM casado WHERE NOT estava_encerrado AND mudou),
    (SELECT count(*) FROM casado WHERE estava_encerrado),
    (SELECT count(*) FROM casado WHERE NOT estava_encerrado AND NOT mudou),
    (SELECT count(*) FROM classificado WHERE rejeicao IS NULL)
      - (SELECT count(*) FROM validos),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'pedido', order_number, 'loja', dyna_code, 'erro', rejeicao))
       FROM classificado WHERE rejeicao IS NOT NULL),
      '[]'::jsonb)
  INTO v_criados, v_atualizados, v_reabertos, v_inalterados, v_repetidos, v_rejeitados;

  -- ---- Regra 3: encerra o que sumiu do relatório --------------------------
  -- Só na última página de um lote `completo`. Um lote parcial (completo: false)
  -- nunca encerra nada — é literalmente o que a spec pede.
  IF v_completo AND v_pagina = v_total_pag THEN
    -- Guarda de ordem: um lote atrasado (referência anterior à última já
    -- processada) chegando depois encerraria pedidos que o lote mais novo acabou
    -- de confirmar. Nesse caso o upsert vale, o encerramento não.
    SELECT max(referencia) INTO v_ref_futura
    FROM public.held_order_sync_batches
    WHERE fonte = v_fonte AND completo;

    IF v_ref_futura IS NULL OR v_referencia >= v_ref_futura THEN
      WITH encerradas AS (
        UPDATE public.held_orders
        SET closed_at     = now(),
            closed_reason = 'resolvido-automaticamente'
        WHERE closed_at IS NULL
          AND agent_status <> 'concluido'
          AND duplicate_of IS NULL
          -- Divergência B: só o que o sync já reconheceu alguma vez.
          AND synced_at IS NOT NULL
          AND (sync_ref IS NULL OR sync_ref <> v_referencia)
          -- Item que veio no lote mas foi rejeitado por dado faltando continua em
          -- on-hold na origem: encerrá-lo seria apagar trabalho real por causa de
          -- um CSV torto.
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_rejeitados) AS r(item)
            WHERE r.item->>'loja'   = public.held_orders.dyna_code
              AND r.item->>'pedido' = public.held_orders.import_key
          )
        RETURNING 1
      )
      SELECT count(*) INTO v_encerrados FROM encerradas;
    END IF;
  END IF;

  -- ---- Log do lote --------------------------------------------------------
  INSERT INTO public.held_order_sync_batches (
    fonte, referencia, pagina, total_paginas, completo, gerado_em,
    recebidos, criados, atualizados, reabertos, inalterados, encerrados,
    repetidos, rejeitados
  ) VALUES (
    v_fonte, v_referencia, v_pagina, v_total_pag, v_completo, v_gerado_em,
    v_recebidos, v_criados, v_atualizados, v_reabertos, v_inalterados, v_encerrados,
    v_repetidos, v_rejeitados
  );

  RETURN jsonb_build_object(
    'recebidos',   v_recebidos,
    'criados',     v_criados,
    'atualizados', v_atualizados,
    'reabertos',   v_reabertos,
    'inalterados', v_inalterados,
    'encerrados',  v_encerrados,
    'repetidos',   v_repetidos,
    'rejeitados',  v_rejeitados
  );
END;
$$;

-- Esta RPC não é para usuário logado. Quem chama é a Edge Function
-- pedidos-espera-sync com a service role, depois de validar o Bearer do Wall-E.
REVOKE ALL ON FUNCTION public.sync_held_orders(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_held_orders(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_held_orders(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
