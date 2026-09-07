-- ============================================================================
-- 20260907120000_lya_agente_ia.sql
-- Lya — agente de IA do Painel da Gestora (Data Analytics do Suporte).
--
-- A Lya é a versão XMX do "Daniel" da CBIE: um agente Claude que responde em
-- linguagem natural sobre os dados que aparecem nas telas da gestora
-- (atendimentos, interações, reembolsos, pedidos em espera, alertas, usuários,
-- Base de Suporte). O motor roda na Edge Function `lya`; o que vive no banco
-- são as três peças que o agente precisa e que exigem regra de acesso:
--
--   1) lya_memories        — o "cérebro" treinado pela gestora (regras de
--                            comportamento + conhecimento), com recall por
--                            full-text search em português;
--   2) lya_chats/_messages — histórico de conversas, por usuário;
--   3) lya_exec_sql        — sandbox de SELECT somente-leitura sobre as
--                            tabelas de dados, para perguntas que os RPCs
--                            das telas não respondem.
--
-- Quem usa: quem entra na área de analytics (can_view_support_analytics():
-- gestora e time de copy). Quem TREINA (escreve no cérebro): só is_manager().
--
-- Convenções deste repo respeitadas: profiles.id é TEXT (compara com
-- auth.uid()::text); RPCs SECURITY DEFINER com guard explícito no corpo;
-- migration idempotente (pode rodar mais de uma vez).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Utilitários
-- ─────────────────────────────────────────────────────────────────────────────

-- Slug estável para o nome da memória (espelha o slugify do front/Edge Function:
-- minúsculas, sem acento, [^a-z0-9] -> '-', 60 chars). Sem depender de unaccent.
CREATE OR REPLACE FUNCTION public.lya_slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT left(
    btrim(
      regexp_replace(
        translate(
          lower(coalesce(p_text, '')),
          'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
          'aaaaaaeeeeiiiiooooouuuucnyy'
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    ),
    60
  );
$$;

CREATE OR REPLACE FUNCTION public.lya_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cérebro da Lya — memórias treinadas (global, da equipe)
-- ─────────────────────────────────────────────────────────────────────────────
-- Uma linha por memória. O cérebro é UM só: o que qualquer gestora ensina vale
-- para todas as conversas (author_id é só autoria).
--   name        slug único (chave do upsert — corrigir uma memória é sobrescrever)
--   description título curto
--   type        user | feedback | project | reference | nota
--                 feedback/user = COMPORTAMENTO (entra em toda resposta)
--                 nota/project/reference = CONHECIMENTO (entra por relevância)
--   tags        jsonb de strings (alimenta o recall)
--   body        corpo em markdown; [[wikilinks]] ligam memórias entre si
CREATE TABLE IF NOT EXISTS public.lya_memories (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  type        text NOT NULL DEFAULT 'nota'
              CHECK (type IN ('user', 'feedback', 'project', 'reference', 'nota')),
  tags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  body        text NOT NULL DEFAULT '',
  author_id   text REFERENCES public.profiles(id) ON DELETE SET NULL,
  seed        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lya_memories_tags_chk CHECK (jsonb_typeof(tags) = 'array')
);

COMMENT ON TABLE public.lya_memories IS
  'Cérebro da Lya: memórias treinadas pela gestora. feedback/user = comportamento (sempre no prompt); nota/project/reference = conhecimento (recall por FTS).';

CREATE INDEX IF NOT EXISTS idx_lya_memories_type ON public.lya_memories (type);
CREATE INDEX IF NOT EXISTS idx_lya_memories_tags ON public.lya_memories USING GIN (tags);

-- FTS em português sobre description + body + tags. A expressão do índice tem
-- que ser IDÊNTICA à usada em lya_recall_memories, senão o planner o ignora.
-- (Lição do Daniel: as tags são geradas pelo treinador justamente para o
-- recall — deixá-las fora do índice matava o recall.)
CREATE INDEX IF NOT EXISTS idx_lya_memories_fts
  ON public.lya_memories
  USING GIN (
    to_tsvector(
      'portuguese',
      coalesce(description, '') || ' ' || coalesce(body, '') || ' ' || coalesce(tags::text, '')
    )
  );

DROP TRIGGER IF EXISTS trg_lya_memories_touch ON public.lya_memories;
CREATE TRIGGER trg_lya_memories_touch
  BEFORE UPDATE ON public.lya_memories
  FOR EACH ROW EXECUTE FUNCTION public.lya_touch();

ALTER TABLE public.lya_memories ENABLE ROW LEVEL SECURITY;

-- Leitura direta: quem vê a área de analytics. Escrita: só pelas RPCs abaixo
-- (SECURITY DEFINER com is_manager()); não há policy de INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "lya_memories_read_analytics" ON public.lya_memories;
CREATE POLICY "lya_memories_read_analytics"
  ON public.lya_memories FOR SELECT
  TO authenticated
  USING (public.can_view_support_analytics());

-- Lista crua (tela "Cérebro da Lya").
CREATE OR REPLACE FUNCTION public.lya_list_memories()
RETURNS SETOF public.lya_memories
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.*
  FROM public.lya_memories m
  WHERE public.can_view_support_analytics()
  ORDER BY m.updated_at DESC;
$$;

-- Cria ou atualiza pelo slug. `p_name` vazio => deriva de p_description.
-- Quem salva por último sobrescreve, independente de quem criou.
CREATE OR REPLACE FUNCTION public.lya_upsert_memory(
  p_name        text,
  p_description text,
  p_type        text DEFAULT 'nota',
  p_tags        jsonb DEFAULT '[]'::jsonb,
  p_body        text DEFAULT ''
)
RETURNS public.lya_memories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_row  public.lya_memories;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_name := public.lya_slugify(coalesce(nullif(btrim(p_name), ''), p_description));
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Informe o titulo da memoria.' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('user', 'feedback', 'project', 'reference', 'nota') THEN
    p_type := 'nota';
  END IF;
  IF p_tags IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
    p_tags := '[]'::jsonb;
  END IF;

  INSERT INTO public.lya_memories (name, description, type, tags, body, author_id)
  VALUES (v_name, btrim(coalesce(p_description, '')), p_type, p_tags, coalesce(p_body, ''), auth.uid()::text)
  ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        type        = EXCLUDED.type,
        tags        = EXCLUDED.tags,
        body        = EXCLUDED.body,
        author_id   = EXCLUDED.author_id,
        updated_at  = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lya_delete_memory(p_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.lya_memories WHERE name = public.lya_slugify(p_name);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Recall para UMA pergunta — é o que a Edge Function injeta no prompt.
--   comportamento: feedback + user, TODAS (cap 50), sem busca;
--   conhecimento : FTS português com os termos em OR (o AND do
--                  websearch_to_tsquery exigia todos os termos na mesma
--                  memória e devolvia zero na maioria das perguntas reais),
--                  ranqueado por ts_rank, top p_limit;
--   wikilinks    : 1 salto — memórias citadas como [[nome]] no corpo das
--                  selecionadas entram junto (cap 8).
-- Devolve jsonb {comportamento: [...], conhecimento: [...]}.
CREATE OR REPLACE FUNCTION public.lya_recall_memories(p_query text, p_limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tsq   tsquery;
  v_comp  jsonb;
  v_conh  jsonb;
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 12), 1), 30);
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ' & ' -> ' | ' no texto do tsquery preserva frases ("<->") e negação ("!").
  -- Pergunta só de stopwords vira tsquery vazio => NULL => sem conhecimento.
  BEGIN
    v_tsq := nullif(
      regexp_replace(websearch_to_tsquery('portuguese', coalesce(p_query, ''))::text, ' & ', ' | ', 'g'),
      ''
    )::tsquery;
  EXCEPTION WHEN OTHERS THEN
    v_tsq := NULL;
  END;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.type, m.name), '[]'::jsonb)
    INTO v_comp
  FROM (
    SELECT * FROM public.lya_memories
    WHERE type IN ('feedback', 'user')
    ORDER BY type, name
    LIMIT 50
  ) m;

  WITH ranked AS (
    SELECT m.*,
           ts_rank(
             to_tsvector(
               'portuguese',
               coalesce(m.description, '') || ' ' || coalesce(m.body, '') || ' ' || coalesce(m.tags::text, '')
             ),
             v_tsq
           ) AS rank
    FROM public.lya_memories m
    WHERE v_tsq IS NOT NULL
      AND m.type NOT IN ('feedback', 'user')
      AND to_tsvector(
            'portuguese',
            coalesce(m.description, '') || ' ' || coalesce(m.body, '') || ' ' || coalesce(m.tags::text, '')
          ) @@ v_tsq
    ORDER BY rank DESC, m.name
    LIMIT v_limit
  ),
  links AS (
    SELECT DISTINCT public.lya_slugify(l[1]) AS alvo
    FROM ranked r, regexp_matches(r.body, '\[\[([^\]]+)\]\]', 'g') AS l
  ),
  linked AS (
    SELECT m.*, 0::real AS rank
    FROM public.lya_memories m
    WHERE m.name IN (SELECT alvo FROM links)
      AND m.type NOT IN ('feedback', 'user')
      AND m.name NOT IN (SELECT name FROM ranked)
    ORDER BY m.name
    LIMIT 8
  ),
  todas AS (
    SELECT id, name, description, type, tags, body, author_id, seed, created_at, updated_at, rank, 0 AS ordem FROM ranked
    UNION ALL
    SELECT id, name, description, type, tags, body, author_id, seed, created_at, updated_at, rank, 1 AS ordem FROM linked
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', t.id, 'name', t.name, 'description', t.description, 'type', t.type,
             'tags', t.tags, 'body', t.body, 'updated_at', t.updated_at
           ) ORDER BY t.ordem, t.rank DESC, t.name
         ), '[]'::jsonb)
    INTO v_conh
  FROM todas t;

  RETURN jsonb_build_object('comportamento', v_comp, 'conhecimento', coalesce(v_conh, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.lya_list_memories() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_upsert_memory(text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_delete_memory(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_recall_memories(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lya_list_memories() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_upsert_memory(text, text, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_delete_memory(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_recall_memories(text, integer) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Histórico de conversas — por usuário
-- ─────────────────────────────────────────────────────────────────────────────
-- O id da conversa nasce no CLIENTE (uuid v4) para ela aparecer na lista no
-- instante do envio; a linha nasce no primeiro save. O salvamento é por
-- SUBSTITUIÇÃO (apaga e reinsere as mensagens): o array do navegador é a fonte
-- da verdade, então um save perdido se conserta sozinho no seguinte.
CREATE TABLE IF NOT EXISTS public.lya_chats (
  id          uuid PRIMARY KEY,
  user_id     text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo      text NOT NULL DEFAULT 'Nova conversa',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lya_chat_messages (
  id          bigserial PRIMARY KEY,
  chat_id     uuid NOT NULL REFERENCES public.lya_chats(id) ON DELETE CASCADE,
  ordem       integer NOT NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL DEFAULT '',
  -- blocos ricos que a UI redesenha (formato definido pelo front)
  tools       jsonb NOT NULL DEFAULT '[]'::jsonb,
  charts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  memorias    jsonb NOT NULL DEFAULT '[]'::jsonb,
  revisao     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lya_chat_messages_ordem UNIQUE (chat_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_lya_chats_user ON public.lya_chats (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lya_chat_messages_chat ON public.lya_chat_messages (chat_id, ordem);

ALTER TABLE public.lya_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lya_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lya_chats_own" ON public.lya_chats;
CREATE POLICY "lya_chats_own"
  ON public.lya_chats FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "lya_chat_messages_own" ON public.lya_chat_messages;
CREATE POLICY "lya_chat_messages_own"
  ON public.lya_chat_messages FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lya_chats c WHERE c.id = lya_chat_messages.chat_id AND c.user_id = (SELECT auth.uid())::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lya_chats c WHERE c.id = lya_chat_messages.chat_id AND c.user_id = (SELECT auth.uid())::text));

-- Lista da barra lateral (sem as mensagens).
CREATE OR REPLACE FUNCTION public.lya_list_chats()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'titulo', c.titulo,
      'total_mensagens', (SELECT count(*) FROM public.lya_chat_messages m WHERE m.chat_id = c.id),
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ) ORDER BY c.updated_at DESC
  ), '[]'::jsonb)
  FROM public.lya_chats c
  WHERE c.user_id = auth.uid()::text;
$$;

-- Uma conversa com as mensagens em ordem. NULL quando não é do usuário.
CREATE OR REPLACE FUNCTION public.lya_get_chat(p_chat_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'titulo', c.titulo,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'mensagens', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ordem', m.ordem, 'role', m.role, 'content', m.content,
          'tools', m.tools, 'charts', m.charts, 'memorias', m.memorias, 'revisao', m.revisao
        ) ORDER BY m.ordem
      )
      FROM public.lya_chat_messages m WHERE m.chat_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.lya_chats c
  WHERE c.id = p_chat_id AND c.user_id = auth.uid()::text;
$$;

-- Salva a conversa inteira (cria na 1ª gravação). Título derivado da primeira
-- pergunta do usuário, aqui e não no cliente, para ser igual em todo lugar.
CREATE OR REPLACE FUNCTION public.lya_save_chat(p_chat_id uuid, p_mensagens jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    text := auth.uid()::text;
  v_dono   text;
  v_titulo text;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_mensagens IS NULL OR jsonb_typeof(p_mensagens) <> 'array' THEN
    p_mensagens := '[]'::jsonb;
  END IF;

  SELECT left(regexp_replace(btrim(m.item->>'content'), '\s+', ' ', 'g'), 42)
    INTO v_titulo
  FROM jsonb_array_elements(p_mensagens) WITH ORDINALITY AS m(item, ord)
  WHERE m.item->>'role' = 'user' AND btrim(coalesce(m.item->>'content', '')) <> ''
  ORDER BY m.ord
  LIMIT 1;

  -- on conflict do nothing: a pergunta e a resposta chegam quase juntas na
  -- primeira gravação; "checa e insere" estouraria a chave primária.
  INSERT INTO public.lya_chats (id, user_id, titulo)
  VALUES (p_chat_id, v_uid, coalesce(v_titulo, 'Nova conversa'))
  ON CONFLICT (id) DO NOTHING;

  SELECT c.user_id INTO v_dono FROM public.lya_chats c WHERE c.id = p_chat_id;
  IF v_dono IS NULL OR v_dono <> v_uid THEN
    RAISE EXCEPTION 'Conversa nao encontrada para este usuario.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.lya_chats
     SET titulo = coalesce(v_titulo, titulo),
         updated_at = now()
   WHERE id = p_chat_id;

  DELETE FROM public.lya_chat_messages WHERE chat_id = p_chat_id;

  INSERT INTO public.lya_chat_messages (chat_id, ordem, role, content, tools, charts, memorias, revisao)
  SELECT
    p_chat_id,
    (m.ord - 1)::int,
    m.item->>'role',
    coalesce(m.item->>'content', ''),
    CASE WHEN jsonb_typeof(m.item->'tools')    = 'array' THEN m.item->'tools'    ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(m.item->'charts')   = 'array' THEN m.item->'charts'   ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(m.item->'memorias') = 'array' THEN m.item->'memorias' ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(m.item->'revisao')  = 'object' THEN m.item->'revisao' ELSE NULL END
  FROM jsonb_array_elements(p_mensagens) WITH ORDINALITY AS m(item, ord)
  WHERE m.item->>'role' IN ('user', 'assistant');

  RETURN (
    SELECT jsonb_build_object(
      'id', c.id, 'titulo', c.titulo,
      'total_mensagens', (SELECT count(*) FROM public.lya_chat_messages x WHERE x.chat_id = c.id),
      'created_at', c.created_at, 'updated_at', c.updated_at
    )
    FROM public.lya_chats c WHERE c.id = p_chat_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lya_delete_chat(p_chat_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.lya_chats WHERE id = p_chat_id AND user_id = auth.uid()::text;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.lya_list_chats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_get_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_save_chat(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_delete_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lya_list_chats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_get_chat(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_save_chat(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_delete_chat(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Sandbox de SQL somente-leitura (text-to-SQL)
-- ─────────────────────────────────────────────────────────────────────────────
-- O modelo escreve um SELECT e o Postgres calcula — percentuais, médias e
-- comparações saem determinísticos do banco, nunca "de cabeça" do LLM.
-- Camadas de proteção:
--   1. role dedicada `lya_sql_ro` (NOLOGIN) com GRANT SELECT SÓ nas tabelas de
--      dados do suporte — nunca profiles inteiro, auth, logs de sessão,
--      memórias ou chats;
--   2. a função é SECURITY DEFINER e PERTENCE a lya_sql_ro: tudo que executa
--      dentro dela enxerga só o que a role enxerga;
--   3. só SELECT/WITH, instrução única (sem ';'), transação somente-leitura;
--   4. LIMIT imposto por fora (teto 500) + statement_timeout curto;
--   5. guard de negócio na entrada: can_view_support_analytics().
-- As tabelas de dados têm RLS ligada com policies para authenticated; a role
-- nova não está em nenhuma delas, então recebe uma policy de SELECT própria
-- (USING true) — ela só é alcançável por dentro da função guardada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lya_sql_ro') THEN
    CREATE ROLE lya_sql_ro NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO lya_sql_ro;
-- O owner da função (postgres) precisa poder assumir a role para o ALTER OWNER.
GRANT lya_sql_ro TO postgres;

-- Agentes sem PII de login: o que a Lya pode saber sobre pessoas do time.
CREATE OR REPLACE VIEW public.lya_agentes AS
  SELECT p.id, p.full_name, p.role::text AS role, p.support_channel, p.is_active, p.is_available, p.created_at
  FROM public.profiles p;

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'services', 'service_follow_ups', 'service_date_corrections',
    'refunds', 'refund_reason_classifications',
    'held_orders', 'held_order_events',
    'products', 'goals', 'agent_daily_service_counts',
    'ticket_transfers', 'ticket_takeover_requests',
    'support_products', 'support_sms_brands', 'support_sms_replies'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'lya_sql_ro: tabela % nao existe, pulando', t;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT SELECT ON public.%I TO lya_sql_ro', t);
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lya_sql_ro read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO lya_sql_ro USING (true)', 'lya_sql_ro read', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT ON public.lya_agentes TO lya_sql_ro;
-- O guard é SECURITY DEFINER (roda como postgres) mas o EXECUTE nele foi
-- revogado de PUBLIC na migration das áreas; a role nova precisa do grant.
GRANT EXECUTE ON FUNCTION public.can_view_support_analytics() TO lya_sql_ro;

CREATE OR REPLACE FUNCTION public.lya_exec_sql(p_sql text, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
  v_out   jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- \y = fronteira de palavra no regex do Postgres (\b seria backspace)
  IF v_sql !~* '^\s*(select|with)\y' THEN
    RAISE EXCEPTION 'Apenas consultas SELECT/WITH sao permitidas.';
  END IF;
  IF position(';' IN v_sql) > 0 THEN
    RAISE EXCEPTION 'Instrucao unica: remova o(s) ";" da consulta.';
  END IF;

  PERFORM set_config('statement_timeout', '8000', true);
  PERFORM set_config('transaction_read_only', 'on', true);

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) q LIMIT %s) t',
    v_sql, v_limit
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- Tornar lya_sql_ro dona: o ALTER OWNER exige CREATE no schema para a nova
-- dona — concede só pelo instante da troca e revoga em seguida.
GRANT CREATE ON SCHEMA public TO lya_sql_ro;
ALTER FUNCTION public.lya_exec_sql(text, integer) OWNER TO lya_sql_ro;
REVOKE CREATE ON SCHEMA public FROM lya_sql_ro;

REVOKE ALL ON FUNCTION public.lya_exec_sql(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lya_exec_sql(text, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verificação (rode depois de aplicar):
--   SELECT set_config('request.jwt.claims','{"sub":"<uuid de uma gestora>","role":"authenticated"}', true);
--   SELECT public.lya_exec_sql('SELECT count(*) AS total FROM services');
--   SELECT public.lya_recall_memories('quantos atendimentos a Ana fez');
--   SELECT public.lya_exec_sql('SELECT * FROM profiles');   -- esperado: erro de permissao
-- ============================================================================
