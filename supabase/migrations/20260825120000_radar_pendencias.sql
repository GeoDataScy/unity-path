-- Radar — registro e acompanhamento de clientes com ação pendente.
--
-- Problema que resolve: hoje não existe padrão de organização para o cliente que
-- fica "no meio do caminho" (devolução em trânsito, RMA aberto, reenvio pedido,
-- endereço a corrigir, retorno da logística...). Cada agente controla como quer —
-- planilha, bloco de notas, memória — e acompanhamento esquecido é a regra, não a
-- exceção. O Radar torna esse controle obrigatório e auditável dentro do sistema:
-- todo caso pendente tem dono, ação necessária e DATA do próximo acompanhamento.
--
-- Duas tabelas:
--   radar_items  — o caso em si (1 linha por pendência), com o estado ATUAL
--   radar_events — histórico append-only: cada vez que o agente registra uma ação
--
-- O que é "puxado do sistema" (pedido explícito da task):
--   * Data de criação          -> radar_items.created_at (default now())
--   * Agente responsável       -> radar_items.user_id = auth.uid() na criação
--   * Status                   -> radar_items.status, escrito só via RPC junto com
--                                 o evento correspondente; nunca editado "solto"
--   * Data do próximo acomp.   -> gravada a cada ação registrada (radar_events),
--                                 e espelhada em radar_items.next_follow_up_date
--
-- Regra central (é ela que impede o esquecimento): enquanto o caso NÃO estiver
-- resolvido/cancelado, next_follow_up_date é OBRIGATÓRIA; quando fecha, é limpa.
-- Ver constraint radar_items_next_date_chk.
--
-- Convenções seguidas (ver CLAUDE.md e 20260617000000_create_held_orders.sql):
--   * profiles.id é TEXT -> user_id é TEXT comparado com auth.uid()::text.
--   * Escrita SOMENTE via RPC SECURITY DEFINER (aqui há regra de negócio real:
--     derivação de status/closed_at, obrigatoriedade da data, escrita do evento).
--     Nenhuma policy de INSERT/UPDATE/DELETE direta.
--   * Leitura por RLS: o agente vê o que é dele; a gestora vê tudo (a TELA dela
--     fica para uma próxima entrega, mas o dado já nasce visível para ela).
--   * Nenhum FK com ON DELETE em profiles: neste sistema perfil é DESATIVADO,
--     nunca apagado, e histórico de acompanhamento não pode sumir junto.

-- ============================================================================
-- 1) radar_items — o caso pendente
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.radar_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Agente responsável. Vem de auth.uid() na criação; não é escolhido no form.
  user_id             text NOT NULL REFERENCES public.profiles(id),
  client_email        text NOT NULL,
  -- Nulo só para pendências sem pedido associado (kind = 'outros').
  order_number        text,
  -- Texto livre, igual a services.product (não há tabela de produtos).
  product             text,
  kind                text NOT NULL,
  action_needed       text NOT NULL,
  status              text NOT NULL DEFAULT 'aberto',
  next_follow_up_date date,
  notes               text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Preenchido ao entrar em 'resolvido'/'cancelado'; limpo na reabertura.
  closed_at           timestamptz,

  CONSTRAINT radar_items_kind_chk CHECK (kind IN (
    'devolucao',         -- Devolução de produto
    'rma',               -- Envio/acompanhamento de RMA
    'reenvio',           -- Reenvio de produto
    'reenvio_endereco',  -- Reenvio por endereço incorreto ou incompleto
    'correcao_endereco', -- Alteração/correção de endereço
    'novo_rastreio',     -- Acompanhamento de novo código de rastreio
    'on_hold',           -- Cliente da lista de On Hold
    'logistica',         -- Aguardando retorno da logística/parceiros
    'outros'             -- Outras pendências que precisem de acompanhamento
  )),
  CONSTRAINT radar_items_status_chk CHECK (status IN (
    'aberto',
    'em_andamento',
    'aguardando_cliente',
    'aguardando_logistica',
    'resolvido',
    'cancelado'
  )),
  CONSTRAINT radar_items_email_chk  CHECK (btrim(client_email) <> ''),
  CONSTRAINT radar_items_action_chk CHECK (btrim(action_needed) <> ''),
  -- Caso EM ABERTO tem data de próximo acompanhamento; caso FECHADO não tem.
  -- (o `=` entre dois booleanos amarra os dois sentidos de uma vez)
  CONSTRAINT radar_items_next_date_chk CHECK (
    (status IN ('resolvido', 'cancelado')) = (next_follow_up_date IS NULL)
  ),
  CONSTRAINT radar_items_closed_at_chk CHECK (
    (status IN ('resolvido', 'cancelado')) = (closed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.radar_items IS
  'Radar: clientes com ação pendente sob acompanhamento de um agente.';

-- Índice da consulta quente: "meus casos em aberto, do mais atrasado ao mais
-- distante". Parcial porque caso fechado nunca entra nessa lista.
CREATE INDEX IF NOT EXISTS idx_radar_items_open
  ON public.radar_items (user_id, next_follow_up_date)
  WHERE status NOT IN ('resolvido', 'cancelado');

-- Índice do histórico recente (aba "Resolvidos").
CREATE INDEX IF NOT EXISTS idx_radar_items_closed
  ON public.radar_items (user_id, closed_at DESC)
  WHERE status IN ('resolvido', 'cancelado');

-- Guarda contra registro duplicado: o mesmo agente não abre dois casos iguais
-- (mesmo e-mail + pedido + tipo) ao mesmo tempo. Fechado não conta, então o
-- cliente pode voltar com o MESMO problema depois. O RPC traduz a violação para
-- uma mensagem em português (ver radar_create_item).
CREATE UNIQUE INDEX IF NOT EXISTS radar_items_open_uniq
  ON public.radar_items (user_id, lower(btrim(client_email)), COALESCE(btrim(order_number), ''), kind)
  WHERE status NOT IN ('resolvido', 'cancelado');

-- ============================================================================
-- 2) radar_events — histórico append-only (uma linha por ação registrada)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.radar_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             uuid NOT NULL REFERENCES public.radar_items(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES public.profiles(id),
  -- Status definido NESTE evento (é daqui que sai radar_items.status).
  status              text NOT NULL,
  action              text NOT NULL DEFAULT '',
  -- Data de próximo acompanhamento definida neste evento; nula quando o evento
  -- fechou o caso.
  next_follow_up_date date,
  recorded_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT radar_events_status_chk CHECK (status IN (
    'aberto',
    'em_andamento',
    'aguardando_cliente',
    'aguardando_logistica',
    'resolvido',
    'cancelado'
  ))
);

COMMENT ON TABLE public.radar_events IS
  'Radar: histórico append-only das ações registradas em cada caso.';

CREATE INDEX IF NOT EXISTS idx_radar_events_item
  ON public.radar_events (item_id, recorded_at DESC);

-- ============================================================================
-- 3) RLS — leitura; escrita é exclusivamente por RPC
-- ============================================================================
ALTER TABLE public.radar_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_events ENABLE ROW LEVEL SECURITY;

-- (SELECT ...) em volta das funções: mantém o InitPlan e evita reavaliar a
-- checagem linha a linha (ver 20260724... / incidente de sobrecarga de 24/07).
DROP POLICY IF EXISTS radar_items_select ON public.radar_items;
CREATE POLICY radar_items_select ON public.radar_items
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid()::text)
    OR (SELECT public.is_manager())
  );

DROP POLICY IF EXISTS radar_events_select ON public.radar_events;
CREATE POLICY radar_events_select ON public.radar_events
  FOR SELECT
  USING (
    (SELECT public.is_manager())
    OR EXISTS (
      SELECT 1 FROM public.radar_items i
      WHERE i.id = radar_events.item_id
        AND i.user_id = (SELECT auth.uid()::text)
    )
  );

GRANT SELECT ON public.radar_items  TO authenticated;
GRANT SELECT ON public.radar_events TO authenticated;

-- ============================================================================
-- 4) Helpers internos
-- ============================================================================

-- "Hoje" do Radar é o dia em São Paulo, não o dia UTC: às 21h de SP já é o dia
-- seguinte em UTC, e um caso para amanhã apareceria como "para hoje".
CREATE OR REPLACE FUNCTION public.radar_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = 'public'
AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

-- Usado só na LÓGICA (radar_register_action), nunca em WHERE/FILTER.
-- Motivo medido: o índice parcial idx_radar_items_open tem como predicado
-- `status NOT IN ('resolvido','cancelado')`, e o planner não consegue provar que
-- `NOT radar_is_closed(status)` é a mesma coisa — com 24k linhas o EXPLAIN caía
-- em Seq Scan (493 buffers) em vez de Index Scan. Por isso todas as consultas
-- abaixo repetem a lista literal, feias mas indexáveis.
CREATE OR REPLACE FUNCTION public.radar_is_closed(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = 'public'
AS $$
  SELECT p_status IN ('resolvido', 'cancelado');
$$;

-- ============================================================================
-- 5) radar_create_item — abre um caso e grava o primeiro evento
-- ============================================================================
CREATE OR REPLACE FUNCTION public.radar_create_item(
  p_client_email        text,
  p_kind                text,
  p_action_needed       text,
  p_next_follow_up_date date,
  p_order_number        text DEFAULT NULL,
  p_product             text DEFAULT NULL,
  p_notes               text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid   text;
  v_id    uuid;
  v_email text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente para registrar no Radar.';
  END IF;

  v_email := lower(btrim(COALESCE(p_client_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'Informe o e-mail do cliente.';
  END IF;
  IF btrim(COALESCE(p_action_needed, '')) = '' THEN
    RAISE EXCEPTION 'Descreva a ação necessária.';
  END IF;
  IF p_next_follow_up_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data do próximo acompanhamento.';
  END IF;
  -- Data no passado seria um caso que já nasce atrasado: quase sempre é erro de
  -- digitação, e o agente perde a confiança na coluna "Atrasados".
  IF p_next_follow_up_date < public.radar_today() THEN
    RAISE EXCEPTION 'A data do próximo acompanhamento não pode estar no passado.';
  END IF;

  BEGIN
    INSERT INTO public.radar_items (
      user_id, client_email, order_number, product, kind,
      action_needed, status, next_follow_up_date, notes
    )
    VALUES (
      v_uid,
      v_email,
      NULLIF(btrim(COALESCE(p_order_number, '')), ''),
      NULLIF(btrim(COALESCE(p_product, '')), ''),
      p_kind,
      btrim(p_action_needed),
      'aberto',
      p_next_follow_up_date,
      COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), '')
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Você já tem um caso em aberto no Radar para este e-mail, pedido e tipo de acompanhamento.';
    WHEN check_violation THEN
      RAISE EXCEPTION 'Tipo de acompanhamento inválido: %', p_kind;
  END;

  INSERT INTO public.radar_events (item_id, user_id, status, action, next_follow_up_date)
  VALUES (v_id, v_uid, 'aberto', 'Caso registrado no Radar.', p_next_follow_up_date);

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 6) radar_update_item — corrige o CADASTRO do caso
--    Não mexe em status nem em data: isso só muda registrando uma ação (7).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.radar_update_item(
  p_item_id       uuid,
  p_client_email  text,
  p_kind          text,
  p_action_needed text,
  p_order_number  text DEFAULT NULL,
  p_product       text DEFAULT NULL,
  p_notes         text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid   text;
  v_email text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente para editar o Radar.';
  END IF;

  v_email := lower(btrim(COALESCE(p_client_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'Informe o e-mail do cliente.';
  END IF;
  IF btrim(COALESCE(p_action_needed, '')) = '' THEN
    RAISE EXCEPTION 'Descreva a ação necessária.';
  END IF;

  PERFORM 1 FROM public.radar_items
   WHERE id = p_item_id AND user_id = v_uid
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado no seu Radar.';
  END IF;

  BEGIN
    UPDATE public.radar_items
       SET client_email  = v_email,
           order_number  = NULLIF(btrim(COALESCE(p_order_number, '')), ''),
           product       = NULLIF(btrim(COALESCE(p_product, '')), ''),
           kind          = p_kind,
           action_needed = btrim(p_action_needed),
           notes         = COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), ''),
           updated_at    = now()
     WHERE id = p_item_id AND user_id = v_uid;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Você já tem outro caso em aberto no Radar para este e-mail, pedido e tipo de acompanhamento.';
    WHEN check_violation THEN
      RAISE EXCEPTION 'Tipo de acompanhamento inválido: %', p_kind;
  END;
END;
$$;

-- ============================================================================
-- 7) radar_register_action — o coração da ferramenta
--    Registra o que foi feito, muda o status e (re)define a data do próximo
--    acompanhamento. É esta chamada que "puxa do sistema" a data e o status.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.radar_register_action(
  p_item_id             uuid,
  p_status              text,
  p_action              text,
  p_next_follow_up_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid    text;
  v_closed boolean;
  v_date   date;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente para registrar a ação.';
  END IF;

  IF p_status NOT IN ('aberto', 'em_andamento', 'aguardando_cliente',
                      'aguardando_logistica', 'resolvido', 'cancelado') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;

  IF btrim(COALESCE(p_action, '')) = '' THEN
    RAISE EXCEPTION 'Descreva a ação realizada.';
  END IF;

  v_closed := public.radar_is_closed(p_status);

  IF v_closed THEN
    -- Caso fechado não fica no radar esperando data.
    v_date := NULL;
  ELSE
    IF p_next_follow_up_date IS NULL THEN
      RAISE EXCEPTION 'Informe a data do próximo acompanhamento (obrigatória enquanto o caso não for resolvido).';
    END IF;
    IF p_next_follow_up_date < public.radar_today() THEN
      RAISE EXCEPTION 'A data do próximo acompanhamento não pode estar no passado.';
    END IF;
    v_date := p_next_follow_up_date;
  END IF;

  PERFORM 1 FROM public.radar_items
   WHERE id = p_item_id AND user_id = v_uid
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado no seu Radar.';
  END IF;

  BEGIN
    UPDATE public.radar_items
       SET status              = p_status,
           next_follow_up_date = v_date,
           -- Reabrir um caso fechado limpa closed_at e ele volta para o radar.
           closed_at           = CASE WHEN v_closed THEN now() ELSE NULL END,
           updated_at          = now()
     WHERE id = p_item_id AND user_id = v_uid;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Reabrir este caso criaria duplicata com outro caso em aberto (mesmo e-mail, pedido e tipo).';
  END;

  INSERT INTO public.radar_events (item_id, user_id, status, action, next_follow_up_date)
  VALUES (p_item_id, v_uid, p_status, btrim(p_action), v_date);
END;
$$;

-- ============================================================================
-- 8) radar_delete_item — só o dono, e o histórico vai com ele (CASCADE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.radar_delete_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente para excluir o caso.';
  END IF;

  DELETE FROM public.radar_items
   WHERE id = p_item_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado no seu Radar.';
  END IF;
END;
$$;

-- ============================================================================
-- 9) my_radar_items — a tela inteira numa chamada
--
--    Um único jsonb (padrão de my_follow_ups): o PostgREST corta respostas em
--    ~1000 linhas e paginação sobre RLS foi exatamente o que derrubou a lista de
--    atendimentos em julho. Aqui também vêm PRONTOS os números dos cartões
--    (atrasados / hoje / próximos 7 dias) — métrica não se calcula no cliente.
--
--    Casos FECHADOS entram só se fecharam nos últimos 30 dias: o histórico antigo
--    não serve para organizar o dia e cresceria sem limite no payload. O RESUMO é
--    calculado sobre esse mesmo conjunto, de propósito — assim os cartões e a
--    lista nunca discordam, e não há uma segunda varredura do histórico inteiro
--    (não existe índice cobrindo todos os status, e medindo com 24k linhas essa
--    varredura extra era o que sobrava de custo na chamada).
--    Consequência a ter em mente: `resolved`/`cancelled` do resumo são "nos
--    últimos 30 dias", não totais de vida.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_radar_items()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid    text;
  v_today  date;
  v_result jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_today := public.radar_today();

  -- UNION ALL de dois ramos disjuntos em vez de um OR: cada ramo casa exatamente
  -- com um dos índices parciais (aberto -> idx_radar_items_open, fechado ->
  -- idx_radar_items_closed). Medido com 24k linhas: o OR dava Seq Scan da tabela
  -- inteira (490 buffers); assim são dois Index Scans (~97 buffers). Não há
  -- interseção entre os ramos, então UNION ALL (sem dedup) é o correto.
  WITH mine AS (
    SELECT i.*
      FROM public.radar_items i
     WHERE i.user_id = v_uid
       AND i.status NOT IN ('resolvido', 'cancelado')
    UNION ALL
    SELECT i.*
      FROM public.radar_items i
     WHERE i.user_id = v_uid
       AND i.status IN ('resolvido', 'cancelado')
       AND i.closed_at >= now() - interval '30 days'
  ),
  ev AS (
    SELECT e.item_id,
           count(*)::int AS event_count,
           max(e.recorded_at) AS last_action_at,
           (array_agg(e.action ORDER BY e.recorded_at DESC, e.id DESC))[1] AS last_action
      FROM public.radar_events e
     WHERE e.item_id IN (SELECT id FROM mine)
     GROUP BY e.item_id
  ),
  built AS (
    SELECT
      CASE WHEN m.status IN ('resolvido', 'cancelado') THEN 1 ELSE 0 END AS sort_closed,
      -- Em aberto: data crescente (mais atrasado primeiro).
      -- Fechado: closed_at decrescente (o epoch negativo inverte a ordem).
      CASE
        WHEN m.status IN ('resolvido', 'cancelado')
          THEN -extract(epoch FROM m.closed_at)
        ELSE extract(epoch FROM m.next_follow_up_date)
      END AS sort_key,
      jsonb_build_object(
        'id',                  m.id,
        'client_email',        m.client_email,
        'order_number',        m.order_number,
        'product',             m.product,
        'kind',                m.kind,
        'action_needed',       m.action_needed,
        'status',              m.status,
        'next_follow_up_date', m.next_follow_up_date,
        'notes',               m.notes,
        'created_at',          m.created_at,
        'updated_at',          m.updated_at,
        'closed_at',           m.closed_at,
        'agent_name',          p.full_name,
        'event_count',         COALESCE(ev.event_count, 0),
        'last_action',         ev.last_action,
        'last_action_at',      ev.last_action_at,
        -- Derivados prontos: a tela só pinta.
        'days_overdue',        CASE
                                 WHEN m.next_follow_up_date IS NULL THEN NULL
                                 ELSE (v_today - m.next_follow_up_date)
                               END,
        'is_overdue',          m.next_follow_up_date IS NOT NULL
                                 AND m.next_follow_up_date < v_today,
        -- COALESCE para casar com o tipo `boolean` do cliente: caso fechado tem
        -- next_follow_up_date nulo, e sem isso o campo viria como null.
        'is_due_today',        COALESCE(m.next_follow_up_date = v_today, false)
      ) AS item,
      m.status              AS status,
      m.next_follow_up_date AS next_follow_up_date
    FROM mine m
    JOIN public.profiles p ON p.id = m.user_id
    LEFT JOIN ev ON ev.item_id = m.id
  )
  SELECT jsonb_build_object(
           'today', v_today,
           'items', COALESCE(jsonb_agg(b.item ORDER BY b.sort_closed, b.sort_key), '[]'::jsonb),
           -- Buckets DISJUNTOS: atrasado, hoje e "próximos 7 dias" nunca contam o
           -- mesmo caso duas vezes (a tela soma três cartões que precisam fechar).
           'summary', jsonb_build_object(
             'open',      count(*) FILTER (WHERE b.status NOT IN ('resolvido', 'cancelado')),
             'overdue',   count(*) FILTER (WHERE b.status NOT IN ('resolvido', 'cancelado')
                                             AND b.next_follow_up_date < v_today),
             'due_today', count(*) FILTER (WHERE b.status NOT IN ('resolvido', 'cancelado')
                                             AND b.next_follow_up_date = v_today),
             'due_week',  count(*) FILTER (WHERE b.status NOT IN ('resolvido', 'cancelado')
                                             AND b.next_follow_up_date > v_today
                                             AND b.next_follow_up_date <= v_today + 7),
             'resolved',  count(*) FILTER (WHERE b.status = 'resolvido'),
             'cancelled', count(*) FILTER (WHERE b.status = 'cancelado')
           )
         )
    INTO v_result
    FROM built b;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 10) my_radar_summary — só os contadores, para o badge da sidebar
--     Separado de my_radar_items porque a sidebar vive montada em toda a área do
--     agente: precisa ser barato (índice parcial + count) e não arrastar payload.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_radar_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid   text;
  v_today date;
  v_out   jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_today := public.radar_today();

  SELECT jsonb_build_object(
           'open',      count(*),
           'overdue',   count(*) FILTER (WHERE i.next_follow_up_date < v_today),
           'due_today', count(*) FILTER (WHERE i.next_follow_up_date = v_today)
         )
    INTO v_out
    FROM public.radar_items i
   WHERE i.user_id = v_uid
     -- Lista literal (e não radar_is_closed) para casar com o predicado de
     -- idx_radar_items_open: é o que transforma Seq Scan em Index Scan aqui.
     AND i.status NOT IN ('resolvido', 'cancelado');

  RETURN v_out;
END;
$$;

-- ============================================================================
-- 11) radar_item_events — timeline de um caso (carregada ao abrir o detalhe)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.radar_item_events(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid text;
  v_out jsonb;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Mesma visibilidade da policy de SELECT: dono ou gestora.
  PERFORM 1 FROM public.radar_items i
   WHERE i.id = p_item_id
     AND (i.user_id = v_uid OR public.is_manager());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado.';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',                  e.id,
             'status',              e.status,
             'action',              e.action,
             'next_follow_up_date', e.next_follow_up_date,
             'recorded_at',         e.recorded_at,
             'user_name',           p.full_name
           ) ORDER BY e.recorded_at DESC, e.id DESC
         ), '[]'::jsonb)
    INTO v_out
    FROM public.radar_events e
    LEFT JOIN public.profiles p ON p.id = e.user_id
   WHERE e.item_id = p_item_id;

  RETURN v_out;
END;
$$;

-- ============================================================================
-- 12) Grants — nada para anon
-- ============================================================================
REVOKE ALL ON FUNCTION public.radar_today()                                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.radar_is_closed(text)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.radar_create_item(text, text, text, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.radar_update_item(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.radar_register_action(uuid, text, text, date)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.radar_delete_item(uuid)                            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_radar_items()                                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_radar_summary()                                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.radar_item_events(uuid)                            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.radar_today()                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_is_closed(text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_create_item(text, text, text, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_update_item(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_register_action(uuid, text, text, date)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_delete_item(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_radar_items()                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_radar_summary()                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_item_events(uuid)                            TO authenticated;

NOTIFY pgrst, 'reload schema';
