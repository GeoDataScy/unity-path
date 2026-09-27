# Backend dos modelos — a planta do servidor (Lya e Daniel)

> **Como usar este arquivo.** Depois de ler `01-ORIENTACOES-DE-ARQUITETURA.md`
> e de ter em mãos: (a) a lista de tabelas de dados do cliente com o catálogo
> escrito à mão, (b) a tabela "tela → função → parâmetros", (c) o glossário
> do negócio e (d) os papéis. Este arquivo traz o código de referência
> completo, com nomes genéricos (`agente_*`). Troque `agente` pelo nome do
> agente do cliente em todo lugar (na Lya é `lya_*`, no Daniel é `brain_*`,
> `daniel_*`, `exec_sql_leitura`).
>
> Onde aparece `<<...>>` você preenche com o domínio do cliente. Onde aparece
> `// XMX:` ou `# CBIE:` é um exemplo real de como ficou lá.
>
> A referência principal é a **variante A (Supabase Edge Function em Deno)**,
> que é a Lya. A **variante B (route handler Next.js + FastAPI)**, que é o
> Daniel, está na Parte III com as diferenças e os módulos extras.

---

## Estrutura de arquivos (variante A)

```
supabase/
├── migrations/
│   ├── <ts>_agente_ia.sql          memórias + recall, chats, sandbox (Parte I)
│   └── <ts>_agente_seed_cerebro.sql seed de exemplos + RPC de remoção (Parte I.4)
└── functions/agente/
    ├── index.ts        porteiro + loop do turno + stream (II.6)
    ├── prompt.ts       persona, regras duras, glossário, catálogo, modo treino, blocos (II.2)
    ├── tools.ts        registry de tools (II.3)
    ├── anthropic.ts    cliente da API e os três modelos (II.1)
    ├── verificador.ts  a segunda IA (II.4)
    └── treinador.ts    a IA que organiza memórias (II.5)
```

Na Lya isso dá ~1.650 linhas de TypeScript e ~620 de SQL. Não é um projeto
grande. O que dá trabalho é o catálogo e o glossário, que são do domínio.

---

# Parte I — O banco (migrations)

Convenções que valem para tudo abaixo: idempotente (pode rodar duas vezes),
RPCs `SECURITY DEFINER` com guard explícito no corpo, `SET search_path TO
'public'`, `REVOKE ALL ... FROM PUBLIC` seguido de `GRANT EXECUTE ... TO
authenticated, service_role`, `NOTIFY pgrst, 'reload schema'` no fim.

Antes de escrever, descubra no banco do cliente:

- o tipo de `profiles.id` (na XMX é `text`, na CBIE é `uuid`; o código
  abaixo usa `text` e compara com `auth.uid()::text`; se for `uuid`, remova
  os casts);
- os nomes dos guards existentes (`is_manager()`, `can_view_analytics()`)
  ou crie-os:

```sql
-- Exemplo de guards, se o cliente não tiver. Ajuste os papéis.
CREATE OR REPLACE FUNCTION public.agente_pode_conversar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()::text AND p.is_active
      AND p.role::text IN (<<'manager', 'copy_grup'>>)
  );
$$;

CREATE OR REPLACE FUNCTION public.agente_pode_treinar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()::text AND p.is_active AND p.role::text = <<'manager'>>
  );
$$;
```

## I.0 Utilitários

```sql
-- Slug estável para o nome da memória. TEM de espelhar o slugify do front e
-- da função (minúsculas, sem acento, [^a-z0-9]+ -> '-', 60 chars). Sem unaccent.
CREATE OR REPLACE FUNCTION public.agente_slugify(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(
    btrim(
      regexp_replace(
        translate(lower(coalesce(p_text, '')),
                  'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
                  'aaaaaaeeeeiiiiooooouuuucnyy'),
        '[^a-z0-9]+', '-', 'g'),
      '-'),
    60);
$$;

CREATE OR REPLACE FUNCTION public.agente_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
```

## I.1 O cérebro — `agente_memories` e o recall

```sql
-- Uma linha por memória. O cérebro é UM só (da equipe): o que qualquer
-- administrador ensina vale para todas as conversas. author_id é só autoria.
CREATE TABLE IF NOT EXISTS public.agente_memories (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL UNIQUE,            -- slug: corrigir = sobrescrever
  description text NOT NULL DEFAULT '',        -- título curto (rótulo do nó)
  type        text NOT NULL DEFAULT 'nota'
              CHECK (type IN ('user', 'feedback', 'project', 'reference', 'nota')),
  tags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  body        text NOT NULL DEFAULT '',        -- markdown; [[wikilinks]] ligam memórias
  author_id   text REFERENCES public.profiles(id) ON DELETE SET NULL,
  seed        boolean NOT NULL DEFAULT false,  -- exemplo removível em bloco
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_memories_tags_chk CHECK (jsonb_typeof(tags) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_agente_memories_type ON public.agente_memories (type);
CREATE INDEX IF NOT EXISTS idx_agente_memories_tags ON public.agente_memories USING GIN (tags);

-- A expressão do índice TEM de ser IDÊNTICA à usada no recall, senão o planner
-- o ignora. E as tags TÊM de entrar: o treinador as gera para o recall.
CREATE INDEX IF NOT EXISTS idx_agente_memories_fts
  ON public.agente_memories
  USING GIN (to_tsvector('portuguese',
    coalesce(description, '') || ' ' || coalesce(body, '') || ' ' || coalesce(tags::text, '')));

DROP TRIGGER IF EXISTS trg_agente_memories_touch ON public.agente_memories;
CREATE TRIGGER trg_agente_memories_touch
  BEFORE UPDATE ON public.agente_memories
  FOR EACH ROW EXECUTE FUNCTION public.agente_touch();

ALTER TABLE public.agente_memories ENABLE ROW LEVEL SECURITY;

-- Leitura direta: quem conversa. Escrita: só pelas RPCs (não há policy de escrita).
DROP POLICY IF EXISTS "agente_memories_read" ON public.agente_memories;
CREATE POLICY "agente_memories_read" ON public.agente_memories
  FOR SELECT TO authenticated USING (public.agente_pode_conversar());

-- Lista crua (tela do cérebro).
CREATE OR REPLACE FUNCTION public.agente_list_memories()
RETURNS SETOF public.agente_memories
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.* FROM public.agente_memories m
  WHERE public.agente_pode_conversar()
  ORDER BY m.updated_at DESC;
$$;

-- Cria ou atualiza pelo slug. p_name vazio => deriva de p_description.
CREATE OR REPLACE FUNCTION public.agente_upsert_memory(
  p_name text, p_description text, p_type text DEFAULT 'nota',
  p_tags jsonb DEFAULT '[]'::jsonb, p_body text DEFAULT ''
) RETURNS public.agente_memories
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_name text; v_row public.agente_memories;
BEGIN
  IF NOT public.agente_pode_treinar() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_name := public.agente_slugify(coalesce(nullif(btrim(p_name), ''), p_description));
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Informe o titulo da memoria.' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('user','feedback','project','reference','nota') THEN p_type := 'nota'; END IF;
  IF p_tags IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN p_tags := '[]'::jsonb; END IF;

  INSERT INTO public.agente_memories (name, description, type, tags, body, author_id)
  VALUES (v_name, btrim(coalesce(p_description, '')), p_type, p_tags, coalesce(p_body, ''), auth.uid()::text)
  ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description, type = EXCLUDED.type, tags = EXCLUDED.tags,
        body = EXCLUDED.body, author_id = EXCLUDED.author_id, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.agente_delete_memory(p_name text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_deleted integer;
BEGIN
  IF NOT public.agente_pode_treinar() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.agente_memories WHERE name = public.agente_slugify(p_name);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END; $$;

-- RECALL para UMA pergunta — é o que o orquestrador injeta no prompt.
--   comportamento: feedback + user, TODAS (cap 50), sem busca;
--   conhecimento : FTS português com termos em OR, ts_rank, top p_limit;
--   wikilinks    : 1 salto a partir das selecionadas (cap 8).
-- Devolve jsonb {comportamento: [...], conhecimento: [...]}.
CREATE OR REPLACE FUNCTION public.agente_recall_memories(p_query text, p_limit integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tsq tsquery; v_comp jsonb; v_conh jsonb;
        v_limit integer := LEAST(GREATEST(coalesce(p_limit, 12), 1), 30);
BEGIN
  IF NOT public.agente_pode_conversar() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  -- ' & ' -> ' | ' no TEXTO do tsquery: preserva frases ("<->") e negação ("!").
  -- Pergunta só de stopwords vira tsquery vazio => NULL => sem conhecimento.
  BEGIN
    v_tsq := nullif(regexp_replace(websearch_to_tsquery('portuguese', coalesce(p_query, ''))::text, ' & ', ' | ', 'g'), '')::tsquery;
  EXCEPTION WHEN OTHERS THEN v_tsq := NULL; END;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.type, m.name), '[]'::jsonb) INTO v_comp
  FROM (SELECT * FROM public.agente_memories WHERE type IN ('feedback','user') ORDER BY type, name LIMIT 50) m;

  WITH ranked AS (
    SELECT m.*, ts_rank(to_tsvector('portuguese',
             coalesce(m.description,'') || ' ' || coalesce(m.body,'') || ' ' || coalesce(m.tags::text,'')), v_tsq) AS rank
    FROM public.agente_memories m
    WHERE v_tsq IS NOT NULL AND m.type NOT IN ('feedback','user')
      AND to_tsvector('portuguese',
            coalesce(m.description,'') || ' ' || coalesce(m.body,'') || ' ' || coalesce(m.tags::text,'')) @@ v_tsq
    ORDER BY rank DESC, m.name
    LIMIT v_limit
  ),
  links AS (
    SELECT DISTINCT public.agente_slugify(l[1]) AS alvo
    FROM ranked r, regexp_matches(r.body, '\[\[([^\]]+)\]\]', 'g') AS l
  ),
  linked AS (
    SELECT m.*, 0::real AS rank FROM public.agente_memories m
    WHERE m.name IN (SELECT alvo FROM links) AND m.type NOT IN ('feedback','user')
      AND m.name NOT IN (SELECT name FROM ranked)
    ORDER BY m.name LIMIT 8
  ),
  todas AS (
    SELECT id, name, description, type, tags, body, updated_at, rank, 0 AS ordem FROM ranked
    UNION ALL
    SELECT id, name, description, type, tags, body, updated_at, rank, 1 AS ordem FROM linked
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'description', t.description, 'type', t.type,
           'tags', t.tags, 'body', t.body, 'updated_at', t.updated_at)
         ORDER BY t.ordem, t.rank DESC, t.name), '[]'::jsonb)
    INTO v_conh FROM todas t;

  RETURN jsonb_build_object('comportamento', v_comp, 'conhecimento', coalesce(v_conh, '[]'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION public.agente_list_memories() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_upsert_memory(text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_delete_memory(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_recall_memories(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_list_memories() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agente_upsert_memory(text, text, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agente_delete_memory(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agente_recall_memories(text, integer) TO authenticated, service_role;
```

**Limite conhecido do FTS**: o stemmer português não unifica `leilão`/`leilões`
(`'leilã'` vs `'leilõ'`), e remover acento não resolve. Plurais regulares
funcionam. Se o domínio do cliente tiver muitas palavras nessa classe, o
próximo passo é uma coluna `embedding vector(1536)` (pgvector) preenchida no
mesmo ponto em que o treinador roda, com recall por similaridade + regra de
comportamento fixa. Deixe como evolução; comece pelo FTS.

## I.2 Histórico — `agente_chats` e `agente_chat_messages`

```sql
-- O id da conversa nasce no CLIENTE (uuid v4) para ela aparecer na lista no
-- instante do envio; a linha nasce no primeiro save. O salvamento é por
-- SUBSTITUIÇÃO: o array do navegador é a fonte da verdade.
CREATE TABLE IF NOT EXISTS public.agente_chats (
  id          uuid PRIMARY KEY,
  user_id     text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo      text NOT NULL DEFAULT 'Nova conversa',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agente_chat_messages (
  id          bigserial PRIMARY KEY,
  chat_id     uuid NOT NULL REFERENCES public.agente_chats(id) ON DELETE CASCADE,
  ordem       integer NOT NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL DEFAULT '',
  -- blocos ricos que a UI redesenha (formato definido pelo front)
  tools       jsonb NOT NULL DEFAULT '[]'::jsonb,
  charts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  memorias    jsonb NOT NULL DEFAULT '[]'::jsonb,
  revisao     jsonb,
  -- Daniel tem ainda: sources jsonb, attachments jsonb (só metadados), pdfs jsonb (data URL inteiro)
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agente_chat_messages_ordem UNIQUE (chat_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_agente_chats_user ON public.agente_chats (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agente_chat_messages_chat ON public.agente_chat_messages (chat_id, ordem);

ALTER TABLE public.agente_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agente_chats_own" ON public.agente_chats;
CREATE POLICY "agente_chats_own" ON public.agente_chats FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text) WITH CHECK (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "agente_chat_messages_own" ON public.agente_chat_messages;
CREATE POLICY "agente_chat_messages_own" ON public.agente_chat_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agente_chats c WHERE c.id = agente_chat_messages.chat_id AND c.user_id = (SELECT auth.uid())::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agente_chats c WHERE c.id = agente_chat_messages.chat_id AND c.user_id = (SELECT auth.uid())::text));

-- Lista da barra lateral (sem as mensagens: carregar tudo seria megabytes à toa).
CREATE OR REPLACE FUNCTION public.agente_list_chats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'titulo', c.titulo,
    'total_mensagens', (SELECT count(*) FROM public.agente_chat_messages m WHERE m.chat_id = c.id),
    'created_at', c.created_at, 'updated_at', c.updated_at) ORDER BY c.updated_at DESC), '[]'::jsonb)
  FROM public.agente_chats c WHERE c.user_id = auth.uid()::text;
$$;

-- Uma conversa com as mensagens em ordem. NULL quando não é do usuário.
CREATE OR REPLACE FUNCTION public.agente_get_chat(p_chat_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'titulo', c.titulo, 'created_at', c.created_at, 'updated_at', c.updated_at,
    'mensagens', coalesce((
      SELECT jsonb_agg(jsonb_build_object('ordem', m.ordem, 'role', m.role, 'content', m.content,
        'tools', m.tools, 'charts', m.charts, 'memorias', m.memorias, 'revisao', m.revisao) ORDER BY m.ordem)
      FROM public.agente_chat_messages m WHERE m.chat_id = c.id), '[]'::jsonb))
  FROM public.agente_chats c WHERE c.id = p_chat_id AND c.user_id = auth.uid()::text;
$$;

-- Salva a conversa inteira (cria na 1ª gravação). Título derivado AQUI da
-- primeira pergunta, para ser igual em qualquer navegador.
CREATE OR REPLACE FUNCTION public.agente_save_chat(p_chat_id uuid, p_mensagens jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid text := auth.uid()::text; v_dono text; v_titulo text;
BEGIN
  IF v_uid IS NULL OR NOT public.agente_pode_conversar() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_mensagens IS NULL OR jsonb_typeof(p_mensagens) <> 'array' THEN p_mensagens := '[]'::jsonb; END IF;

  SELECT left(regexp_replace(btrim(m.item->>'content'), '\s+', ' ', 'g'), 42) INTO v_titulo
  FROM jsonb_array_elements(p_mensagens) WITH ORDINALITY AS m(item, ord)
  WHERE m.item->>'role' = 'user' AND btrim(coalesce(m.item->>'content', '')) <> ''
  ORDER BY m.ord LIMIT 1;

  -- on conflict do nothing: a pergunta e a resposta chegam quase juntas na
  -- primeira gravação; "checa e insere" estouraria a chave primária.
  INSERT INTO public.agente_chats (id, user_id, titulo)
  VALUES (p_chat_id, v_uid, coalesce(v_titulo, 'Nova conversa'))
  ON CONFLICT (id) DO NOTHING;

  SELECT c.user_id INTO v_dono FROM public.agente_chats c WHERE c.id = p_chat_id;
  IF v_dono IS NULL OR v_dono <> v_uid THEN
    RAISE EXCEPTION 'Conversa nao encontrada para este usuario.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.agente_chats SET titulo = coalesce(v_titulo, titulo), updated_at = now() WHERE id = p_chat_id;
  DELETE FROM public.agente_chat_messages WHERE chat_id = p_chat_id;

  INSERT INTO public.agente_chat_messages (chat_id, ordem, role, content, tools, charts, memorias, revisao)
  SELECT p_chat_id, (m.ord - 1)::int, m.item->>'role', coalesce(m.item->>'content', ''),
    CASE WHEN jsonb_typeof(m.item->'tools')    = 'array'  THEN m.item->'tools'    ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(m.item->'charts')   = 'array'  THEN m.item->'charts'   ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(m.item->'memorias') = 'array'  THEN m.item->'memorias' ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(m.item->'revisao')  = 'object' THEN m.item->'revisao'  ELSE NULL END
  FROM jsonb_array_elements(p_mensagens) WITH ORDINALITY AS m(item, ord)
  WHERE m.item->>'role' IN ('user', 'assistant');

  RETURN (SELECT jsonb_build_object('id', c.id, 'titulo', c.titulo,
    'total_mensagens', (SELECT count(*) FROM public.agente_chat_messages x WHERE x.chat_id = c.id),
    'created_at', c.created_at, 'updated_at', c.updated_at) FROM public.agente_chats c WHERE c.id = p_chat_id);
END; $$;

CREATE OR REPLACE FUNCTION public.agente_delete_chat(p_chat_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.agente_chats WHERE id = p_chat_id AND user_id = auth.uid()::text;
  GET DIAGNOSTICS v_deleted = ROW_COUNT; RETURN v_deleted;
END; $$;

REVOKE ALL ON FUNCTION public.agente_list_chats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_get_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_save_chat(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_delete_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_list_chats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agente_get_chat(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agente_save_chat(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agente_delete_chat(uuid) TO authenticated, service_role;
```

Nota do Daniel sobre `created_at` das mensagens: como o save é por
substituição, `created_at` da mensagem é a hora do **último save**, não da
pergunta. Se algum relatório precisar da hora real (o radar precisa), carimbe
em outra tabela na primeira vez que vir a mensagem.

## I.3 O sandbox de SQL (text-to-SQL)

```sql
-- Camadas: (1) role NOLOGIN dedicada com GRANT SELECT só nas tabelas de dados;
-- (2) função SECURITY DEFINER que PERTENCE à role; (3) só SELECT/WITH, uma
-- instrução; (4) read-only + statement_timeout; (5) LIMIT imposto por fora;
-- (0) guard de negócio na entrada.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agente_sql_ro') THEN
    CREATE ROLE agente_sql_ro NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO agente_sql_ro;
GRANT agente_sql_ro TO postgres;   -- o dono atual precisa assumir a role para o ALTER OWNER

-- Pessoas sem PII de login: o agente conhece o time por nome e papel, nunca por e-mail.
CREATE OR REPLACE VIEW public.agente_pessoas AS
  SELECT p.id, p.full_name, p.role::text AS role, p.is_active <<, p.support_channel, p.is_available>>, p.created_at
  FROM public.profiles p;

-- Libere UMA A UMA as tabelas de dados. A lista TEM de ser a mesma do catálogo.
DO $$
DECLARE t text;
  tabelas text[] := ARRAY[
    <<'services', 'service_follow_ups', 'refunds', 'products', 'goals'>>   -- XMX: 15 tabelas de dados
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'agente_sql_ro: tabela % nao existe, pulando', t; CONTINUE;
    END IF;
    EXECUTE format('GRANT SELECT ON public.%I TO agente_sql_ro', t);
    -- Tabela com RLS ligada: a role não está em nenhuma policy → precisa da sua.
    -- Ela só é alcançável por dentro da função guardada.
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'agente_sql_ro read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO agente_sql_ro USING (true)', 'agente_sql_ro read', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT ON public.agente_pessoas TO agente_sql_ro;
-- O guard é SECURITY DEFINER, mas o EXECUTE nele pode ter sido revogado de PUBLIC.
GRANT EXECUTE ON FUNCTION public.agente_pode_conversar() TO agente_sql_ro;

CREATE OR REPLACE FUNCTION public.agente_exec_sql(p_sql text, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sql text := btrim(coalesce(p_sql, ''));
        v_limit integer := LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
        v_out jsonb;
BEGIN
  IF NOT public.agente_pode_conversar() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  -- \y = fronteira de palavra no regex do Postgres (\b seria backspace)
  IF v_sql !~* '^\s*(select|with)\y' THEN RAISE EXCEPTION 'Apenas consultas SELECT/WITH sao permitidas.'; END IF;
  IF position(';' IN v_sql) > 0 THEN RAISE EXCEPTION 'Instrucao unica: remova o(s) ";" da consulta.'; END IF;

  PERFORM set_config('statement_timeout', '8000', true);
  PERFORM set_config('transaction_read_only', 'on', true);

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) q LIMIT %s) t', v_sql, v_limit)
    INTO v_out;
  RETURN v_out;
END; $$;

-- A troca de dono é o que fecha o cerco. O ALTER OWNER exige CREATE no schema
-- para a nova dona — concede só pelo instante da troca e revoga.
GRANT CREATE ON SCHEMA public TO agente_sql_ro;
ALTER FUNCTION public.agente_exec_sql(text, integer) OWNER TO agente_sql_ro;
REVOKE CREATE ON SCHEMA public FROM agente_sql_ro;

REVOKE ALL ON FUNCTION public.agente_exec_sql(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agente_exec_sql(text, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
```

**Cliente multi-tenant (várias empresas/contas no mesmo banco).** A policy
`USING (true)` acima faz a role enxergar TODAS as linhas da tabela. Isso é
correto quando quem conversa já vê tudo (analytics de um time único, como na
XMX). Se o cliente separa dados por tenant com RLS, troque o predicado pelo
**mesmo** que ele já usa nas policies de `authenticated`. Dentro da função,
`auth.uid()` e `request.jwt.claims` continuam sendo os do usuário que
perguntou, então o predicado funciona:

```sql
-- exemplo: a tabela do cliente já tem policy "tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())"
EXECUTE format(
  'CREATE POLICY %I ON public.%I FOR SELECT TO agente_sql_ro USING (tenant_id = <<mesmo predicado do cliente>>)',
  'agente_sql_ro read', t);
```

Se não der para reproduzir o predicado com segurança, **não exponha a tabela
ao sandbox**: deixe só as tools de painel (que chamam as funções do cliente
com o JWT do usuário e herdam a RLS dele).

Variante do Daniel para o `GRANT`: em vez de array, varre `pg_class` por
prefixo (`se_%`, `pg_%`, `opr_%`, `bc_%`, `vw_%`). A migration 16 dele também
tenta `ALTER ROLE ... BYPASSRLS`; **não replique isso**. Funcionou lá porque
todas as tabelas de dados eram de leitura pública; em qualquer outro cenário
é um vazamento entre tenants. A policy por tabela é explícita e auditável.
Use prefixos só se o cliente já nomeia as tabelas de dados assim; senão, a
lista explícita é mais segura.

**Mascarar PII.** Se uma tabela tem colunas que a tela não precisa (e-mail
do cliente final, CPF, telefone, endereço), não conceda a tabela: crie uma
view sem essas colunas, conceda a view e catalogue a view. O modelo não
recebe o que a role não enxerga.

```sql
CREATE OR REPLACE VIEW public.agente_<<pedidos>> AS
  SELECT id, created_at, status, product, channel, <<...sem email/cpf/endereco>> FROM public.<<pedidos>>;
GRANT SELECT ON public.agente_<<pedidos>> TO agente_sql_ro;
```

## I.4 Seed de exemplos + remoção em bloco

Um cérebro vazio não ensina nada. Semeie 30–50 memórias do domínio do
cliente, ligadas por `[[wikilinks]]` e tags, com `seed = true`. Estrutura que
funcionou na Lya (45 memórias): 2 `user`, 6 `feedback`, ~20 `nota` (as regras
do glossário, uma por memória), ~8 `reference` (uma por tela), 3 `project`
"hubs" que listam as notas de um assunto, 5 `project` "Treinamento: …"
marcados como exemplo.

**Atenção**: `feedback` e `user` do seed entram em TODA resposta desde o
primeiro dia. Escreva-as alinhadas ao prompt do sistema, ou o agente nasce se
contradizendo.

```sql
CREATE OR REPLACE FUNCTION public.agente_delete_seed_memories()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_deleted integer;
BEGIN
  IF NOT public.agente_pode_treinar() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.agente_memories WHERE seed = true;
  GET DIAGNOSTICS v_deleted = ROW_COUNT; RETURN v_deleted;
END; $$;
REVOKE ALL ON FUNCTION public.agente_delete_seed_memories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_delete_seed_memories() TO authenticated, service_role;

INSERT INTO public.agente_memories (name, description, type, tags, body, seed)
SELECT v.name, v.description, v.type, v.tags, v.body, true
FROM (VALUES
  -- XMX (exemplos reais; substitua pelo domínio do cliente):
  ('quem-e-a-lya', 'Quem é a Lya', 'user', '["lya","perfil"]'::jsonb,
   'A Lya é a assistente do Painel da Gestora. Responde só com o que está no painel, no banco e na Base de Suporte, e diz de onde tirou cada número. Ver [[Para quem a Lya responde]].'),
  ('comecar-pela-resposta', 'Começar pela resposta', 'feedback', '["formato","concisao"]'::jsonb,
   'Em toda resposta, a conclusão vem na primeira frase. Depois os números de apoio, em tabela curta quando forem mais de três. Sem preâmbulo.'),
  ('status-do-ticket', 'Status do ticket', 'nota', '["status","ticket","follow-up"]'::jsonb,
   'O status vivo é o do último follow-up: sem follow-up = Novo; último concluído = Concluído; senão = Em andamento. Ver [[Contagem de atendimentos]].'),
  ('tela-atendimentos', 'Tela Atendimentos', 'reference', '["painel","atendimentos","tela"]'::jsonb,
   '/dashboard: total do período, por agente, por produto, por dia. Ver [[Contagem de atendimentos]].'),
  ('hub-atendimentos', 'Hub: atendimentos', 'project', '["hub","atendimentos"]'::jsonb,
   'Tudo sobre atendimentos: [[Contagem de atendimentos]], [[Status do ticket]], [[Tela Atendimentos]].'),
  ('treinamento-resumo-diario', 'Treinamento: resumo diário', 'project', '["treinamento","resumo","exemplo"]'::jsonb,
   'Exemplo de treinamento. Ao pedir o resumo do dia, trazer: total e comparação com o dia anterior, os 3 agentes mais ativos, reembolsos em atraso. Apague ou edite para virar a regra real.')
  <<-- ... até 30–50 linhas>>
) AS v(name, description, type, tags, body)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```

O nome dentro de `[[...]]` passa por `agente_slugify` no recall e no grafo;
por isso `[[Status do ticket]]` acha `status-do-ticket`.

## I.5 Verificação (rode depois de aplicar)

```sql
-- simula um usuário da área (pegue um id real de profiles)
SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);

SELECT public.agente_exec_sql('SELECT count(*) AS total FROM <<services>>');   -- linhas > 0
SELECT public.agente_exec_sql('SELECT * FROM profiles');                       -- ERRO de permissão (esperado)
SELECT public.agente_exec_sql('DELETE FROM <<services>>');                     -- ERRO "Apenas SELECT/WITH"
SELECT public.agente_recall_memories('<<pergunta típica do domínio>>');        -- comportamento + conhecimento
SELECT jsonb_array_length(public.agente_recall_memories('x')->'comportamento'); -- = nº de feedback+user

-- conferir dono e policies
SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'agente_exec_sql'; -- agente_sql_ro
SELECT count(*) FROM pg_policies WHERE policyname = 'agente_sql_ro read';

-- o índice FTS é usado?
EXPLAIN SELECT * FROM public.agente_memories m
WHERE to_tsvector('portuguese', coalesce(m.description,'')||' '||coalesce(m.body,'')||' '||coalesce(m.tags::text,''))
      @@ websearch_to_tsquery('portuguese','reembolso');   -- Bitmap Index Scan
```

Antes de ir para produção, valide a migration num Postgres local com stubs
de `auth.uid()`, `profiles` e dos guards. Foi assim que a da Lya foi testada.

## I.6 Reversão (o que a migration criou, e só isso)

Faça snapshot do banco antes de aplicar. Se precisar desfazer, este script
remove **somente** os objetos do agente. Nenhuma tabela, função, policy ou
role pré-existente do cliente é tocada.

```sql
-- policies da role do sandbox nas tabelas do cliente (só as com este nome)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'agente_sql_ro read' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'agente_sql_ro read', r.schemaname, r.tablename);
  END LOOP; END $$;

DROP FUNCTION IF EXISTS public.agente_exec_sql(text, integer);
DROP VIEW IF EXISTS public.agente_pessoas;
-- views de mascaramento que você tenha criado (agente_<<...>>)

DROP FUNCTION IF EXISTS public.agente_delete_seed_memories();
DROP FUNCTION IF EXISTS public.agente_list_chats(), public.agente_get_chat(uuid), public.agente_save_chat(uuid, jsonb), public.agente_delete_chat(uuid);
DROP FUNCTION IF EXISTS public.agente_list_memories(), public.agente_upsert_memory(text, text, text, jsonb, text),
                        public.agente_delete_memory(text), public.agente_recall_memories(text, integer);
DROP TABLE IF EXISTS public.agente_chat_messages, public.agente_chats, public.agente_memories;
DROP FUNCTION IF EXISTS public.agente_touch(), public.agente_slugify(text);
-- guards, só se foram criados por você (não se o cliente já os tinha)
DROP FUNCTION IF EXISTS public.agente_pode_conversar(), public.agente_pode_treinar();

REVOKE ALL ON SCHEMA public FROM agente_sql_ro;
REVOKE agente_sql_ro FROM postgres;
DROP ROLE IF EXISTS agente_sql_ro;   -- falha se sobrar algum grant: rode REASSIGN/REVOKE antes
NOTIFY pgrst, 'reload schema';
```

## I.7 Auditoria de segurança antes de abrir para usuários

```sql
-- 1) Colisão de nomes: nada com o prefixo do agente pode existir antes da migration.
SELECT 'func' AS tipo, proname AS nome FROM pg_proc WHERE proname LIKE 'agente\_%'
UNION ALL SELECT 'rel', relname FROM pg_class WHERE relname LIKE 'agente\_%' ORDER BY 1, 2;

-- 2) O que a role do sandbox enxerga (tem de ser SÓ as tabelas/views do catálogo).
SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'agente_sql_ro' ORDER BY 2;

-- 3) A role não pode ter atributos perigosos.
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = 'agente_sql_ro';
-- esperado: tudo false

-- 4) Funções SECURITY DEFINER do schema public abertas a PUBLIC: o SQL do modelo
--    pode chamá-las e elas rodam como o dono. Cada uma precisa de guard interno
--    (como as RPCs das telas) ou de REVOKE EXECUTE ... FROM PUBLIC.
SELECT p.proname, pg_get_userbyid(p.proowner) AS dono,
       has_function_privilege('agente_sql_ro', p.oid, 'EXECUTE') AS sandbox_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
ORDER BY sandbox_executa DESC, p.proname;
-- A exposição é a mesma que o usuário já tem pelo PostgREST (as funções abertas a
-- PUBLIC/authenticated já são chamáveis por ele). Mesmo assim, funções sem guard
-- e sem propósito de API devem receber: REVOKE EXECUTE ON FUNCTION public.<f>(...) FROM PUBLIC;

-- 5) Colunas de PII nas tabelas concedidas (ajuste a lista de nomes ao cliente).
SELECT c.table_name, c.column_name FROM information_schema.columns c
JOIN information_schema.role_table_grants g ON g.table_name = c.table_name AND g.grantee = 'agente_sql_ro'
WHERE c.table_schema = 'public' AND c.column_name ~* '(email|e_mail|cpf|cnpj|phone|telefone|celular|address|endereco|rg|passaporte|senha|password|token|secret)'
ORDER BY 1, 2;
-- Cada linha aqui é uma decisão: precisa mesmo sair para o modelo? Se não, view sem a coluna.

-- 6) Teste de escrita pelo sandbox (todos devem FALHAR).
SELECT public.agente_exec_sql('UPDATE <<tabela>> SET id = id');
SELECT public.agente_exec_sql('SELECT pg_sleep(30)');           -- cai no statement_timeout de 8 s
SELECT public.agente_exec_sql('COPY (SELECT 1) TO ''/tmp/x''');  -- recusado (não é SELECT/WITH)

-- 7) Teste de tenant (se houver): como usuário do tenant A, o sandbox NÃO devolve linhas do tenant B.
```

Sobre `GRANT agente_sql_ro TO postgres` na migration: é só a filiação que
permite ao dono atual executar o `ALTER FUNCTION ... OWNER TO`. Não dá
poder novo à role do sandbox; pode ser revogado depois com
`REVOKE agente_sql_ro FROM postgres` sem afetar a função.

---

# Parte II — A função (variante A, Deno)

## II.1 `anthropic.ts` — cliente e modelos

```ts
import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";

// Três modelos, três papéis. Trocar um não muda os outros.
export const CHAT_MODEL = Deno.env.get("AGENTE_MODEL") || "claude-opus-5";
export const TRAINER_MODEL = Deno.env.get("AGENTE_TRAINER_MODEL") || "claude-opus-5";
export const VERIFIER_MODEL = Deno.env.get("AGENTE_VERIFIER_MODEL") || "claude-haiku-4-5";
// medium segura o custo de thinking; suba para high se pular etapas de coleta.
export const CHAT_EFFORT = (Deno.env.get("AGENTE_EFFORT") || "medium") as "low" | "medium" | "high";
// Teto de saída por etapa. É um CAP, não um gasto.
export const MAX_TOKENS = 16000;

let _client: Anthropic | null = null;
let _clientKey: string | null = null;

export function apiKeyConfigurada(): boolean {
  return Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
}

export function anthropic(): Anthropic {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY não configurada nos secrets do projeto — o agente não consegue responder.");
  // Caractere fora do ASCII visível derruba o turno com "Argument 2 is not a
  // valid ByteString". Aqui vira uma mensagem que diz ONDE, sem expor a chave.
  const invalidos: string[] = [];
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) invalidos.push(`posição ${i + 1} (código U+${c.toString(16).toUpperCase().padStart(4, "0")})`);
  }
  if (invalidos.length) {
    throw new Error(`O secret ANTHROPIC_API_KEY contém caractere inválido em ${invalidos.slice(0, 3).join(", ")} — regrave a chave limpa (sem aspas, espaços ou quebra de linha).`);
  }
  // Cache amarrado ao VALOR da chave: instância quente pega a chave nova na hora.
  if (!_client || _clientKey !== key) {
    _client = new Anthropic({ apiKey: key });
    _clientKey = key;
  }
  return _client;
}

export type { Anthropic };
```

## II.2 `prompt.ts` — persona, regras, glossário, catálogo, modo treino

```ts
// ── Glossário de regras de negócio ──────────────────────────────────────────
// Vai no system E como evidência "regras" para o verificador.
export const REGRAS_DO_SISTEMA = `REGRAS DO SISTEMA <<NOME DO SISTEMA>> (fatos fixos — pode citar como "regra do sistema"):
- <<O que é a unidade básica ("Atendimento" = uma linha em services...).>>
- <<Como cada tela conta: "A tela X conta EVENTOS no período: cada ... vale 1. O dia é o de <fuso>.">>
- <<Como cada status é derivado: "Status vivo = o do último follow-up: sem follow-up = Novo; ...">>
- <<Metas: "Meta diária: 100 tickets DISTINTOS por dia (150 quando ...)">>
- <<Regras temporais: "Follow-up fica BLOQUEADO até as 18h do dia da interação anterior">>
- <<Enumerações com os valores EXATOS: canais, plataformas, motivos, papéis>>
- <<Datas em texto: "services.service_date é TEXT — em SQL use ::timestamptz antes de comparar">>`;

// ── Catálogo do sandbox de SQL ──────────────────────────────────────────────
// Descrito por humano, não introspectado. Mantenha em sincronia com o array
// de tabelas da migration.
export const CATALOGO_SQL = `TABELAS DISPONÍVEIS (schema public, somente-leitura):

<<ÁREA 1>>
- <<tabela(col tipo [observação], col2, ...)>> — <<o que é uma linha>>
  XMX: services(id text, user_id text [agente que ABRIU], status ['novo'|'em_andamento'|'concluido' — NÃO confie só
  nele: o status vivo é o do último follow-up], service_date TEXT [cast ::timestamptz; dia em São Paulo], ...)
- agente_pessoas(id text, full_name, role, is_active, ...) — pessoas do time (sem e-mail). Use para traduzir nome <-> id.

CONVENÇÕES:
- Dia local: (col AT TIME ZONE '<<America/Sao_Paulo>>')::date para timestamptz; para datas em TEXT, cast antes.
- Para reproduzir os números da tela X, <<a regra exata de contagem>>.
- Faça TODO cálculo no SQL (percentual, média, variação, ranking) — nunca "de cabeça".
- Máx. 200 linhas por consulta (LIMIT imposto). Agregue em vez de listar tudo. Descubra valores com SELECT DISTINCT
  antes de filtrar por texto.
- Nunca consulte tabelas fora desta lista (profiles, auth, agente_*, logs não são acessíveis).`;

// ── Persona e regras ────────────────────────────────────────────────────────
export const SYSTEM = `Você é <<NOME>>, <<a assistente de inteligência do <área/painel> da <empresa>>>. Você é especialista nos
dados que aparecem nas telas <<liste as telas>> e nas regras de negócio por trás de cada número. Quando perguntarem seu
nome, diga que se chama <<NOME>>. Você conversa com <<quem>>.

Você tem QUATRO tipos de ferramenta (tools):
1. Tools de PAINEL ("painel_*" e "listar_*") → chamam EXATAMENTE as mesmas funções que alimentam as telas. O número que
   elas devolvem é o número que o usuário vê na tela. PREFIRA-AS sempre que a pergunta for sobre um card, gráfico ou
   tabela do painel.
2. "consultar_banco" → SELECT livre (sandbox somente-leitura). Use para o que o painel NÃO responde: recortes por
   cliente/pedido, cruzamentos, comparação entre períodos, séries por semana/mês. Faça os cálculos DENTRO do SQL.
3. "buscar_<<base>>" → conteúdo editorial <<descreva>>. Use para <<exemplos>>.
4. "gerar_grafico" → renderiza um gráfico na conversa. Seja PROATIVA: sempre que a resposta tiver números comparáveis
   (por pessoa, produto, canal, dia, motivo), gere um gráfico além do texto — não espere pedirem. Use SOMENTE números
   devolvidos pelas tools. Linha/área para evolução no tempo, barras para comparar categorias, pizza para participação
   em um total (uma série só).

Regras:
- Use "listar_pessoas" quando precisar traduzir o nome de alguém em id (as tools de painel filtram por id).
- PROIBIDO fazer aritmética "de cabeça" sobre os dados (percentual, média, variação, acumulado): peça o número pronto ao
  painel ou escreva a conta dentro do SQL. Duas execuções da mesma pergunta DEVEM dar os mesmos números.
- Baseie a resposta SOMENTE no que as ferramentas retornarem e nas REGRAS DO SISTEMA abaixo. Nunca invente números,
  nomes, datas ou fatos.
- PROIBIDO responder com base no seu conhecimento próprio/treinamento. Se a informação não veio de uma ferramenta nem
  das regras do sistema, você NÃO a possui. Nunca use expressões como "com base no conhecimento consolidado" ou "é
  sabido que".
- Se nenhuma ferramenta trouxer a informação, diga apenas: "Não encontrei isso nos dados disponíveis." e pare. Não
  complemente com suposições.
- Afirmação de AUSÊNCIA ("não há registro de X", "ninguém fez Y") só depois de CONSULTAR a fonte que teria X — nunca
  deduza ausência do que não foi consultado.
- Se uma ferramenta falhar ou vier vazia, TENTE outra (ex.: painel vazio → consultar_banco com SELECT DISTINCT para
  conferir a grafia do filtro) antes de dizer que não existe.
- Diga sempre de onde veio cada número: "tela X (painel)", "banco de dados (SQL)", "<<base>>" — e o período/recorte
  usado (datas, filtros).
- Date os dados de operação. Quando a pergunta não definir período, use o PERÍODO E OS FILTROS SELECIONADOS NA TELA
  (contexto abaixo) e diga que usou.
- NUNCA pergunte se pode consultar ("Deseja que eu consulte?" é PROIBIDO) — se a resposta exigir dados, consulte
  imediatamente e responda.
- Dados de cliente (e-mail, nº de pedido) só quando a pergunta pedir esse detalhe; em respostas agregadas, não liste.
- Responda em português do Brasil, de forma direta e objetiva, começando pela resposta. Use tabelas curtas quando
  ajudar a ler números; evite repetir no texto todos os números que já estão no gráfico — comente os destaques.

${REGRAS_DO_SISTEMA}`;

// ── System do MODO TREINO (só quem pode treinar) ────────────────────────────
export const SYSTEM_TREINO = `Você é <<NOME>>, agora em MODO TREINO com <<o administrador>>. Neste modo você NÃO responde
perguntas nem consulta dados: você APRENDE. Cada mensagem é um ensinamento, uma correção de algo que você respondeu
errado, ou uma preferência de como você deve responder — sempre em linguagem natural.

O que fazer a cada mensagem:
1. Entenda o que querem te ensinar/corrigir. Se estiver claro o bastante para virar uma memória útil, chame a tool
   "salvar_memoria" com uma 'descricao' curta (título) e um 'corpo' completo (a regra/correção/fato, com o porquê e
   como aplicar). Não invente nada além do que foi dito — se faltar um detalhe essencial, faça UMA pergunta curta.
2. Se uma mensagem contiver vários aprendizados distintos, chame salvar_memoria uma vez para cada.
3. Depois de gravar, confirme em 1–2 frases o que você aprendeu — sem repetir o corpo. Se corrigiu algo, diga o que
   passa a valer.

Regras:
- Use SOMENTE o que foi dito. Nunca complemente com conhecimento próprio.
- Não use nenhuma outra ferramenta além de salvar_memoria.
- Seja concisa e colaborativa — você está sendo treinada, não avaliando.`;

// ── Memória treinada ────────────────────────────────────────────────────────
export interface AgentMemory { name: string; description?: string; type: string; tags?: string[] | null; body?: string }
export interface Recall { comportamento: AgentMemory[]; conhecimento: AgentMemory[]; falha?: string }

function linhasMemoria(memorias: AgentMemory[], comSlug = false): string {
  return memorias.map((m) => {
    const body = (m.body || "").trim();
    const slug = comSlug ? `(slug: ${m.name}) ` : "";
    return `- ${slug}[${m.type || "nota"}] ${m.description || m.name}${body ? `: ${body}` : ""}`;
  }).join("\n");
}

// Bloco de memórias do chat. Vai num bloco de system SEPARADO do estático
// para não invalidar o cache do prefixo a cada pergunta.
export function blocoMemorias(recall: Recall): string {
  const todas = [...recall.comportamento, ...recall.conhecimento];
  if (todas.length === 0) return "";
  return `MEMÓRIA TREINADA (cérebro de <<NOME>> — regras, correções e contexto cadastrados na tela "Cérebro"):\n` +
    `Obedeça-as: siga o estilo, a concisão e as interpretações pedidas; têm prioridade sobre o padrão. ` +
    `Mas NÃO substituem o painel/banco para os números — os valores continuam vindo das tools.\n` +
    linhasMemoria(todas);
}

// Contexto da tela: o que o navegador manda com cada pergunta.
export interface ContextoTela {
  de?: string; ate?: string;
  filtro_id?: string | null; filtro_nome?: string | null;   // XMX: agente_id / agente_nome
  usuario_nome?: string | null; usuario_role?: string | null;
  tela?: string | null;
}

export function blocoContexto(ctx: ContextoTela | undefined, hojeISO: string): string {
  const linhas = [`CONTEXTO DA TELA (agora):`, `- Data de hoje (<<fuso>>): ${hojeISO}`];
  if (ctx?.usuario_nome) linhas.push(`- Quem está falando: ${ctx.usuario_nome} (${ctx.usuario_role ?? "usuário"})`);
  if (ctx?.de && ctx?.ate) linhas.push(`- Período selecionado na barra lateral: ${ctx.de} a ${ctx.ate}`);
  if (ctx?.filtro_id && ctx.filtro_id !== "all") linhas.push(`- <<Filtro>> selecionado: ${ctx.filtro_nome || ctx.filtro_id} (id ${ctx.filtro_id})`);
  else linhas.push(`- <<Filtro>> selecionado: Todos`);
  if (ctx?.tela) linhas.push(`- Tela aberta: ${ctx.tela}`);
  // XMX: para o perfil só-leitura, avisa que tools de gestão podem devolver "forbidden".
  return linhas.join("\n");
}

// MODO TREINO: as memórias que o agente JÁ TEM sobre o assunto, com slug.
// É o que permite CORRIGIR em vez de duplicar: o upsert é por slug.
export function systemTreinoComMemorias(recall: Recall): string {
  const todas = [...recall.comportamento, ...recall.conhecimento];
  if (todas.length === 0) return SYSTEM_TREINO;
  return SYSTEM_TREINO +
    `\n\nMEMÓRIAS QUE VOCÊ JÁ TEM sobre este assunto (pode ser uma correção de uma delas):\n` + linhasMemoria(todas, true) +
    `\n\nAo gravar com salvar_memoria: se a mensagem CORRIGE, ajusta ou refina uma das memórias acima, passe o slug ` +
    `EXATO dela no campo 'name' — assim você ATUALIZA a memória certa em vez de criar uma duplicada, e diga na ` +
    `confirmação o que passa a valer. Se for conhecimento realmente NOVO, NÃO passe 'name'.`;
}
```

## II.3 `tools.ts` — o registry

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { CATALOGO_SQL } from "./prompt.ts";
import { refinarMemoria, TIPOS_VALIDOS } from "./treinador.ts";
import type { Evidencia } from "./verificador.ts";

const MAX_RESULT_CHARS = 36_000;

export interface ChartSeries { nome: string; valores: number[] }
export interface ChartSpec {
  tipo: "barras" | "linha" | "area" | "pizza"; titulo: string; subtitulo?: string;
  eixoX?: string; eixoY?: string; categorias: string[]; series: ChartSeries[];
}
export interface MemoriaArtifact { name: string; description: string; type: string; tags: string[] }

export interface ToolContext {
  supabase: SupabaseClient;                       // client com o JWT do usuário
  onChart?: (chart: ChartSpec) => void;           // artefato para a UI
  onMemory?: (memoria: MemoriaArtifact) => void;  // idem
  signal?: AbortSignal;
}

export interface AgentTool {
  name: string;
  description: string;   // é ISTO que o modelo lê para decidir quando usar
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  origem: Evidencia["origem"] | null;   // null = tool de ENTREGA (não é fonte de fato)
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

// ── Utilitários ─────────────────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function dataISO(v: unknown, campo: string): string {
  const s = String(v ?? "").trim();
  if (!ISO_DATE.test(s)) throw new Error(`'${campo}' precisa estar no formato YYYY-MM-DD (recebi "${s}").`);
  return s;
}
function filtroId(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s !== "all" && s.toLowerCase() !== "todos" ? s : null;
}
function texto(v: unknown, fallback = ""): string { const s = String(v ?? "").trim(); return s || fallback; }

// Serializa e trunca com aviso para o modelo refinar o recorte.
export function clip(data: unknown, max = MAX_RESULT_CHARS): string {
  let json = JSON.stringify(data);
  if (json.length <= max) return json;
  if (Array.isArray(data)) {
    let kept = data as unknown[];
    while (kept.length > 1 && JSON.stringify(kept).length > max) kept = kept.slice(0, Math.floor(kept.length * 0.7));
    return JSON.stringify({ _aviso: `Resultado truncado: mostrando ${kept.length} de ${data.length} registros. Refine o recorte ou agregue no SQL.`, registros: kept });
  }
  return json.slice(0, max) + "…(truncado — refine o recorte)";
}

// Erro de guard/negócio volta como MENSAGEM para o modelo se adaptar.
async function rpc(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) {
    const msg = String(error.message || "");
    if (/forbidden|permission denied|42501/i.test(msg)) throw new Error(`Acesso negado a ${fn}: este conteúdo é restrito (o perfil atual não pode vê-lo).`);
    throw new Error(`${fn} falhou: ${msg.slice(0, 300)}`);
  }
  return data;
}

// O cabeçalho diz a fonte e o recorte; o modelo repete isso na resposta.
function cabecalho(fonte: string, recorte: Record<string, unknown>): string {
  const partes = Object.entries(recorte).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${v}`);
  return `Fonte: ${fonte}${partes.length ? ` (${partes.join(", ")})` : ""}\n`;
}

const P_DE = { type: "string", description: "Início do período, YYYY-MM-DD (use o período da tela se a pergunta não definir)." };
const P_ATE = { type: "string", description: "Fim do período, YYYY-MM-DD." };
const P_FILTRO = { type: "string", description: "Opcional. Id <<da pessoa>> para filtrar; omita ou passe 'all' para todos. Use listar_pessoas para achar o id pelo nome." };

// ── Tools de PAINEL (uma por tela; mesma função da tela) ────────────────────
// MOLDE. Repita para cada linha da tabela "tela → função → parâmetros".
const painelExemplo: AgentTool = {
  name: "painel_<<tela>>",
  origem: "painel",
  description:
    "Tela <<NOME DA TELA>> (função <<nome_da_rpc>>): <<o que devolve, campo a campo, em palavras>>. " +
    "É o número dos cards e gráficos da tela. Use para '<<pergunta típica 1>>', '<<pergunta típica 2>>'.",
  input_schema: { type: "object", properties: { de: P_DE, ate: P_ATE, filtro_id: P_FILTRO }, required: ["de", "ate"] },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de"), ate = dataISO(input.ate, "ate"), f = filtroId(input.filtro_id);
    const data = await rpc(ctx, "<<nome_da_rpc>>", { <<from_date>>: de, <<to_date>>: ate, <<agent_id>>: f });
    // Enxugue payloads grandes ANTES do clip (a Lya corta recent_follow_ups em 20, held_orders em 60, remove endereço).
    return cabecalho("tela <<NOME>> — <<nome_da_rpc>>", { de, ate, filtro_id: f }) + clip(data);
  },
};
// XMX teve 11 painel_* + 2 listar_* (auditorias paginadas com page_size 50).

// ── Sandbox de SQL ──────────────────────────────────────────────────────────
const consultarBanco: AgentTool = {
  name: "consultar_banco",
  origem: "banco",
  description:
    "Executa um SELECT (PostgreSQL) no banco do <<sistema>> e devolve as linhas em JSON. Use para o que as tools de painel " +
    "não respondem (cliente/pedido específico, cruzamentos, comparação entre períodos, séries por semana/mês) e para CALCULAR " +
    "no banco (percentual, média, ranking, variação). Sandbox somente-leitura: apenas SELECT/WITH, uma instrução sem ';', " +
    "timeout curto, máx. 200 linhas.\n\n" + CATALOGO_SQL,
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A consulta SELECT/WITH (dialeto PostgreSQL), sem ';'." },
      limite: { type: "integer", description: "Máximo de linhas (default 200, teto 500)." },
    },
    required: ["sql"],
  },
  async execute(input, ctx) {
    const sql = texto(input.sql);
    if (!sql) throw new Error("Consulta vazia.");
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error("Apenas consultas SELECT/WITH são permitidas.");
    if (sql.includes(";")) throw new Error("Envie UMA instrução, sem ';'.");
    if (/\b(profiles|agente_memories|agente_chats|agente_chat_messages|<<auth_events|agent_heartbeats>>|auth\.|storage\.|vault\.|pg_catalog|information_schema)\b/i.test(sql)) {
      throw new Error("A consulta referencia uma tabela fora do catálogo liberado. Use apenas as tabelas listadas (para pessoas, use agente_pessoas).");
    }
    const limite = Math.min(500, Math.max(1, Number(input.limite ?? 200) || 200));
    const { data, error } = await ctx.supabase.rpc("agente_exec_sql", { p_sql: sql, p_limit: limite });
    if (error) {
      const msg = String(error.message || "").slice(0, 400);
      if (/forbidden|42501/i.test(msg)) throw new Error("Acesso negado ao sandbox de SQL para este perfil.");
      // Erro de SQL volta como TEXTO (não is_error): o modelo corrige e tenta de novo.
      return `Fonte: banco de dados (SQL) — a consulta FALHOU. Corrija e tente de novo.\nSQL:\n${sql}\nErro: ${msg}`;
    }
    const rows = Array.isArray(data) ? data : [];
    const corpo = rows.length === 0 ? "[] (sem linhas para esse filtro — confira valores com SELECT DISTINCT)" : clip(rows);
    // Ecoa o SQL: auditoria na conversa + contexto para o modelo.
    return `Fonte: banco de dados <<sistema>> — SQL executado:\n${sql}\n\nResultado (${rows.length} linha(s)):\n${corpo}`;
  },
};

const listarPessoas: AgentTool = {
  name: "listar_pessoas",
  origem: "banco",
  description: "Lista as pessoas do time (id, nome, papel, ativo). Use para traduzir nome -> id antes de filtrar as tools de painel.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx) {
    const sql = "SELECT id, full_name, role, is_active FROM agente_pessoas ORDER BY is_active DESC, full_name";
    const { data, error } = await ctx.supabase.rpc("agente_exec_sql", { p_sql: sql, p_limit: 300 });
    if (error) throw new Error(`Não consegui listar as pessoas: ${String(error.message || "").slice(0, 200)}`);
    return `Fonte: banco de dados (agente_pessoas)\n${clip(data ?? [])}`;
  },
};

// ── Conteúdo editorial (a "base" que o cliente edita) ───────────────────────
const buscarBase: AgentTool = {
  name: "buscar_<<base>>",
  origem: "base",
  description: "Busca na <<BASE>> (conteúdo editado pelo cliente): <<o que tem>>. Passe um termo. Até 10 itens por bloco.",
  input_schema: { type: "object", properties: { termo: { type: "string", description: "Termo de busca." } }, required: ["termo"] },
  async execute(input, ctx) {
    const termo = texto(input.termo).replace(/[%,()]/g, " ").trim();
    if (!termo) throw new Error("'termo' é obrigatório.");
    const like = `%${termo}%`;
    // Leitura direta com o client do usuário: a RLS da tabela decide o que ele vê.
    const r = await ctx.supabase.from("<<tabela_editorial>>").select("<<colunas>>")
      .or(`<<col1>>.ilike.${like},<<col2>>.ilike.${like}`).order("<<col1>>").limit(10);
    if (r.error) throw new Error(`<<Base>> indisponível: ${String(r.error.message || "").slice(0, 200)}`);
    if (!r.data?.length) return `Fonte: <<Base>> — nenhum item contém "${termo}". Tente um termo mais curto ou outra grafia.`;
    return `Fonte: <<Base>> (busca por "${termo}")\n` + clip(r.data);
  },
};

// ── Gráfico (artefato para a UI; não volta ao modelo) ───────────────────────
const CHART_PROPERTIES = {
  tipo: { type: "string", enum: ["barras", "linha", "area", "pizza"], description: "'linha'/'area' para evolução no tempo, 'barras' para comparar categorias, 'pizza' para participação em um total (UMA série)." },
  titulo: { type: "string", description: "Título do gráfico." },
  subtitulo: { type: "string", description: "Opcional. Período/recorte/unidade abaixo do título." },
  eixo_x: { type: "string", description: "Opcional. Rótulo do eixo X." },
  eixo_y: { type: "string", description: "Opcional. Rótulo/unidade do eixo Y." },
  categorias: { type: "array", items: { type: "string" }, description: "Rótulos do eixo X em ordem. Para pizza, as fatias." },
  series: {
    type: "array", description: "Uma ou mais séries; cada 'valores' com o mesmo tamanho e ordem de 'categorias'. Pizza: exatamente UMA série.",
    items: { type: "object", properties: { nome: { type: "string" }, valores: { type: "array", items: { type: "number" } } }, required: ["nome", "valores"] },
  },
};

// Um gráfico malformado é pior que nenhum gráfico: normalize no servidor.
export function normalizeChart(raw: unknown): ChartSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tipo = String(o.tipo || "").trim();
  if (!["barras", "linha", "area", "pizza"].includes(tipo)) throw new Error(`tipo inválido: "${tipo}". Use barras, linha, area ou pizza.`);
  const titulo = String(o.titulo || "").trim();
  if (!titulo) throw new Error("'titulo' é obrigatório.");
  const categorias = Array.isArray(o.categorias) ? o.categorias.map((c) => String(c)) : [];
  if (categorias.length === 0) throw new Error("'categorias' não pode ser vazio.");
  const series = (Array.isArray(o.series) ? o.series : []).map((s) => {
    const so = (s ?? {}) as Record<string, unknown>;
    const valores = (Array.isArray(so.valores) ? so.valores : []).map((v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; });
    return { nome: String(so.nome || "Série").trim(), valores: categorias.map((_, i) => valores[i] ?? 0) };
  }).filter((s) => s.nome);
  if (series.length === 0) throw new Error("'series' precisa de ao menos uma série com valores.");
  return {
    tipo: tipo as ChartSpec["tipo"], titulo,
    subtitulo: o.subtitulo ? String(o.subtitulo).trim() : undefined,
    eixoX: o.eixo_x ? String(o.eixo_x).trim() : undefined, eixoY: o.eixo_y ? String(o.eixo_y).trim() : undefined,
    categorias, series: tipo === "pizza" ? series.slice(0, 1) : series,
  };
}

const gerarGrafico: AgentTool = {
  name: "gerar_grafico",
  origem: null,
  description:
    "Renderiza um gráfico (barras, linha, área ou pizza) na conversa a partir de séries numéricas. Seja PROATIVA: use sempre que a " +
    "resposta tiver números comparáveis, mesmo sem pedirem. Primeiro obtenha os valores com as tools de painel/banco (nunca invente) " +
    "e então chame esta tool. Continue explicando em texto — comente só os destaques.",
  input_schema: { type: "object", properties: CHART_PROPERTIES, required: ["tipo", "titulo", "categorias", "series"] },
  async execute(input, ctx) {
    let chart: ChartSpec;
    try { chart = normalizeChart(input); } catch (err) { return `Erro ao montar o gráfico: ${err instanceof Error ? err.message : "dados inválidos"}.`; }
    ctx.onChart?.(chart);
    return `Gráfico "${chart.titulo}" (${chart.tipo}) renderizado na conversa. Comente os destaques em texto.`;
  },
};

// ── Modo treino: gravar memória ─────────────────────────────────────────────
// Vocabulário do usuário (enum da tool) -> taxonomia do cérebro. Correção e
// preferência são REGRA de comportamento → feedback (entra em toda resposta).
const TIPO_MEMORIA: Record<string, string | undefined> = { correcao: "feedback", preferencia: "feedback", fato: "nota", nota: "nota" };

export function slugify(s: string, n = 60): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n);
}

// Refina (treinador) e grava pelo RPC — usado pela tool e pela ação `memoria_salvar`.
export async function salvarMemoriaNoCerebro(
  ctx: ToolContext,
  entrada: { name?: string; description: string; body: string; tags?: string[]; type?: string | null; refinar?: boolean },
): Promise<MemoriaArtifact & { body: string }> {
  let type = entrada.type && (TIPOS_VALIDOS as readonly string[]).includes(entrada.type) ? entrada.type : null;
  let description = entrada.description.trim();
  let body = (entrada.body || "").trim();
  let tags = (entrada.tags || []).map((t) => String(t).trim()).filter(Boolean);

  if (entrada.refinar !== false || !type) {
    const refinada = await refinarMemoria(description, body, tags, type, ctx.signal);
    if (refinada) { type = refinada.type; description = refinada.description; body = refinada.body; tags = refinada.tags; }
  }
  const { data, error } = await ctx.supabase.rpc("agente_upsert_memory", {
    p_name: entrada.name ? slugify(entrada.name) : "", p_description: description, p_type: type || "nota", p_tags: tags, p_body: body,
  });
  if (error) {
    const msg = String(error.message || "");
    if (/forbidden|42501/i.test(msg)) throw new Error("Só <<o administrador>> pode treinar <<NOME>>.");
    throw new Error(`Falha ao gravar a memória: ${msg.slice(0, 200)}`);
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    name: String(row.name ?? ""), description: String(row.description ?? description), type: String(row.type ?? type ?? "nota"),
    tags: Array.isArray(row.tags) ? (row.tags as unknown[]).map(String) : tags, body: String(row.body ?? body),
  };
}

const salvarMemoria: AgentTool = {
  name: "salvar_memoria",
  origem: null,
  description:
    "MODO TREINO: grava um ensinamento, correção ou preferência no cérebro de <<NOME>>, para lembrar em conversas futuras. " +
    "Extraia da mensagem uma 'descricao' curta (título) e o 'corpo' completo (a regra/correção/fato, com o porquê e como aplicar). " +
    "Não invente além do que foi dito. Depois de salvar, confirme em 1 frase o que foi aprendido.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Opcional. Slug EXATO de uma memória existente que esta mensagem corrige/refina (veja 'MEMÓRIAS QUE VOCÊ JÁ TEM'). Omita para conhecimento novo." },
      descricao: { type: "string", description: "Resumo em uma linha do que aprender (vira o título)." },
      corpo: { type: "string", description: "Conteúdo completo: a regra/correção/fato, com contexto, o porquê e como aplicar." },
      tipo: { type: "string", enum: ["correcao", "preferencia", "fato", "nota"], description: "Opcional. correcao=corrige um erro; preferencia=regra de como responder (inclui formato de relatório); fato=informação do domínio; nota=avulso." },
      tags: { type: "array", items: { type: "string" }, description: "Opcional. Palavras-chave para recuperar a memória depois." },
    },
    required: ["descricao", "corpo"],
  },
  async execute(input, ctx) {
    const descricao = texto(input.descricao), corpo = texto(input.corpo);
    if (!descricao || !corpo) return "Erro: 'descricao' e 'corpo' são obrigatórios para gravar a memória.";
    const row = await salvarMemoriaNoCerebro(ctx, {
      name: input.name ? String(input.name) : undefined, description: descricao, body: corpo,
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [], type: TIPO_MEMORIA[String(input.tipo ?? "")] ?? null, refinar: true,
    });
    ctx.onMemory?.({ name: row.name, description: row.description, type: row.type, tags: row.tags });
    return `Memória "${row.name}" (tipo: ${row.type}) gravada no cérebro. Confirme em uma frase curta o que foi aprendido.`;
  },
};

// ── Exports ─────────────────────────────────────────────────────────────────
export const TOOLS: AgentTool[] = [painelExemplo, /* ...as demais painel_* e listar_* */, listarPessoas, consultarBanco, buscarBase, gerarGrafico];
const TOOL_MAP = new Map([...TOOLS, salvarMemoria].map((t) => [t.name, t]));
export function getTool(name: string): AgentTool | undefined { return TOOL_MAP.get(name); }
export function anthropicToolDefs() { return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })); }
export function anthropicTrainingToolDefs() { return [salvarMemoria].map(({ name, description, input_schema }) => ({ name, description, input_schema })); }
```

Três hábitos que valem para toda tool: **valide a entrada** antes de passá-la
ao banco; **comece o retorno com o cabeçalho** de fonte e recorte; **corte o
resultado** com aviso. Erro de permissão é mensagem, não exceção que derruba
o turno. Erro de SQL volta como texto para o modelo corrigir.

## II.4 `verificador.ts` — a segunda IA

```ts
import { anthropic, VERIFIER_MODEL } from "./anthropic.ts";

export interface Evidencia { origem: "painel" | "banco" | "base" | "regras"; titulo: string; conteudo: string }
// Daniel: origem também "documentos" | "web"
export interface Revisao {
  aprovado: boolean;
  ressalvas: { afirmacao: string; motivo: string; gravidade: "alta" | "media" | "baixa" }[];
  divergencias: string[];
}

const MAX_CHARS_EVIDENCIA = 2500;

const TOOL = {
  name: "emitir_revisao",
  description: "Emite o veredito da revisão anti-fakenews: se o rascunho está sustentado, as ressalvas e as divergências entre fontes.",
  input_schema: {
    type: "object" as const,
    properties: {
      aprovado: { type: "boolean", description: "true se o rascunho está sustentado pelas evidências; false se depende centralmente de afirmações sem base." },
      ressalvas: {
        type: "array", description: "Afirmações problemáticas encontradas no rascunho.",
        items: { type: "object", properties: {
          afirmacao: { type: "string", description: "A afirmação do rascunho em questão (curta)." },
          motivo: { type: "string", description: "Por que é problemática." },
          gravidade: { type: "string", enum: ["alta", "media", "baixa"], description: "alta = factual sem nenhuma base; media = base parcial/dúvida; baixa = detalhe menor (ex.: falta de data)." },
        }, required: ["afirmacao", "motivo", "gravidade"] },
      },
      divergencias: { type: "array", items: { type: "string" }, description: "Conflitos entre fontes (uma string por conflito). Vazio se não houver." },
    },
    required: ["aprovado", "ressalvas", "divergencias"],
  },
};

const SYSTEM = `Você é o revisor anti-fakenews de <<NOME>>. Você recebe a pergunta do usuário, o RASCUNHO de resposta e as
EVIDÊNCIAS coletadas pelas ferramentas durante a geração (painel = funções das telas, banco = SQL, base = conteúdo
editorial, regras = regras fixas do sistema). Verifique o rascunho afirmação por afirmação e emita a revisão pela
ferramenta emitir_revisao.

REGRAS DE VERIFICAÇÃO:
1. Toda afirmação factual (números, percentuais, datas, nomes, status) precisa estar sustentada por alguma evidência OU
   ser uma regra do sistema listada nas evidências de origem "regras".
2. Hierarquia de confiança: painel (é o número da tela) > banco (SQL) > regras > base. Use-a para pesar evidências que
   apontem em direções diferentes.
3. Conflito entre fontes: reporte em divergencias, identificando cada fonte. Nunca escolha uma em silêncio.
4. Afirmação de AUSÊNCIA ("não há X", "ninguém fez Y") só é sustentada se alguma evidência consultou a fonte que teria X
   e voltou vazia. Ausência de evidência NÃO é evidência de ausência — registre ressalva "alta".
5. Dados de operação devem estar datados/recortados no texto. Se o rascunho traz um número sem período e a evidência
   permite datá-lo, registre ressalva "baixa".
6. Aritmética derivada no texto (percentual, média, diferença) que NÃO apareça pronta em nenhuma evidência é ressalva
   "media" — a regra é calcular no SQL/painel, não na resposta.
7. Na dúvida (evidência parcial, ambígua, indireta), registre ressalva "media".
8. Se NÃO houver evidência de dados e o rascunho tiver números ou fatos, seja conservador: ressalvas "alta" para as
   afirmações factuais não notórias. Nunca invente evidência nem valide sem base.
9. Respostas puramente conversacionais (saudação, explicação de uma regra do sistema, "não encontrei isso nos dados
   disponíveis") são aprovadas sem ressalvas.
10. aprovado = true quando o rascunho está sustentado (ressalvas baixas/médias não o reprovam); false quando depende de
    forma central de afirmações sem base.

Responda SEMPRE chamando emitir_revisao. Textos em PT-BR, curtos.`;

function truncar(t: string): string { t = t || ""; return t.length <= MAX_CHARS_EVIDENCIA ? t : t.slice(0, MAX_CHARS_EVIDENCIA) + "\n[... evidência truncada pelo verificador ...]"; }
function formatarEvidencias(ev: Evidencia[]): string {
  if (!ev.length) return "(nenhuma evidência foi coletada pelas ferramentas)";
  return ev.map((e, i) => `[evidência ${i + 1} | origem: ${e.origem}] ${e.titulo}\n${truncar(e.conteudo)}`).join("\n\n");
}
// FAIL-OPEN: o verificador é camada de qualidade, nunca ponto de falha.
function failOpen(motivo: string): Revisao {
  return { aprovado: true, ressalvas: [{ afirmacao: "(verificador indisponível)", motivo, gravidade: "baixa" }], divergencias: [] };
}
const GRAVIDADES = new Set(["alta", "media", "baixa"]);
function sanear(saida: Record<string, unknown>): Revisao {
  const ressalvas: Revisao["ressalvas"] = [];
  for (const r of (saida.ressalvas as unknown[]) || []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    ressalvas.push({ afirmacao: String(o.afirmacao ?? "").trim(), motivo: String(o.motivo ?? "").trim(),
      gravidade: GRAVIDADES.has(String(o.gravidade)) ? (String(o.gravidade) as Revisao["ressalvas"][number]["gravidade"]) : "media" });
  }
  const divergencias = ((saida.divergencias as unknown[]) || []).map((d) => String(d).trim()).filter(Boolean);
  return { aprovado: saida.aprovado !== false, ressalvas, divergencias };
}

export async function revisar(pergunta: string, rascunho: string, evidencias: Evidencia[], signal?: AbortSignal): Promise<Revisao> {
  try {
    const entrada = `PERGUNTA DO USUÁRIO:\n${pergunta}\n\nRASCUNHO (a revisar):\n${rascunho}\n\nEVIDÊNCIAS COLETADAS PELAS FERRAMENTAS:\n${formatarEvidencias(evidencias)}`;
    const resp = await anthropic().messages.create({
      model: VERIFIER_MODEL,
      max_tokens: 4096,
      temperature: 0,   // Haiku aceita; NÃO portar para Opus 5/Fable (400)
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "emitir_revisao" },   // saída estruturada garantida
      messages: [{ role: "user", content: entrada }],
    }, { signal });
    const bloco = resp.content.find((b) => b.type === "tool_use");
    if (!bloco || bloco.type !== "tool_use") return failOpen("O verificador não devolveu um veredito.");
    return sanear(bloco.input as Record<string, unknown>);
  } catch (err) {
    return failOpen(`Falha ao executar o verificador (${err instanceof Error ? err.name : "erro"}); a resposta foi entregue sem revisão.`);
  }
}
```

Diferença do Daniel: o veredito dele tem também `texto_revisado`, em que o
verificador remove ou marca "não confirmado nas fontes consultadas". No fluxo
com stream isso não é aplicável (o texto já saiu), então a Lya removeu o
campo. Mantenha só se houver um caminho sem stream (o `/agente/consulta` do
FastAPI usa).

## II.5 `treinador.ts` — a IA que organiza memórias

```ts
import { anthropic, TRAINER_MODEL } from "./anthropic.ts";

export const TIPOS_VALIDOS = ["user", "feedback", "project", "reference", "nota"] as const;
export type TipoMemoria = (typeof TIPOS_VALIDOS)[number];
export interface MemoriaRefinada { type: TipoMemoria; description: string; body: string; tags: string[] }

const TOOL = {
  name: "salvar_memoria",
  description: "Salva a memória classificada e enriquecida no cérebro.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: { type: "string", enum: [...TIPOS_VALIDOS], description: "Tipo da memória segundo a taxonomia do cérebro." },
      description: { type: "string", description: "Título curto e claro, em PT-BR (rótulo do nó no grafo)." },
      body: { type: "string", description: "Corpo enriquecido da memória. Preserva [[wikilinks]] do original." },
      tags: { type: "array", items: { type: "string" }, description: "3 a 6 tags minúsculas, sem acento, estilo slug." },
    },
    required: ["type", "description", "body", "tags"],
  },
};

const SYSTEM = `Você é o agente treinador do cérebro de <<NOME>>. <<O administrador>> cadastra memórias numa tela de treino, muitas
vezes escrevendo pouco e sem escolher o tipo. Seu trabalho: classificar a memória no tipo certo e melhorar o texto para
que ela funcione de verdade quando <<NOME>> for responder.

TAXONOMIA (campo type):
- feedback → COMO <<NOME>> deve agir: saudações, tom, estilo, formato de resposta, o que evitar, correções de
  comportamento. Inclui TAMBÉM o formato/estrutura de um ENTREGÁVEL recorrente — resumo diário, relatório semanal,
  ranking: quais blocos tem, em que ordem, quais gráficos gerar, o que nunca incluir. Regra de COMO montar algo é
  feedback, mesmo quando fala de um assunto específico.
- user → QUEM é <<NOME>> / para quem responde: papel, perfil, preferências estáveis.
- project → trabalho em andamento, metas do time, contexto de um projeto.
- reference → link, planilha, painel externo, onde encontrar algo.
- nota → fato ou anotação solta de conhecimento do domínio. Só o CONTEÚDO em si — nunca a regra de como apresentá-lo.

COMO O RECALL FUNCIONA (isso muda como você escreve):
- Memórias feedback e user entram em TODAS as respostas. Toda regra de comportamento precisa ser um desses dois tipos,
  senão nunca é aplicada.
- Memórias nota/project/reference só são recuperadas se palavras da pergunta aparecerem na description, nas tags ou no
  body (busca textual em português). Então escreva description/body/tags com as palavras que o usuário provavelmente
  usaria ao perguntar (inclua sinônimos e variações: <<"reembolso", "estorno", "devolução"; nome com e sem sobrenome>>).
- Na dúvida entre feedback e nota para uma REGRA, escolha feedback.

COMO ENRIQUECER:
- Reescreva a description como uma frase curta e inequívoca.
- No body, torne a instrução acionável: para feedback/user, deixe explícito quando e como aplicar. Para conhecimento,
  complete o contexto com o porquê quando estiver implícito.
- NÃO invente fatos, números ou nomes que não estejam no texto original. Enriquecer é explicitar a intenção, não criar
  conteúdo novo.
- Preserve intactos os [[wikilinks]] presentes no original.
- Gere 3 a 6 tags minúsculas, sem acento, estilo slug.
- Escreva em PT-BR.

Se o tipo já foi escolhido, respeite-o (apenas enriqueça o texto) — a menos que seja claramente um erro que impediria a
memória de funcionar (ex.: regra de comportamento salva como nota); nesse caso corrija o tipo.`;

export async function refinarMemoria(description: string, body = "", tags: string[] = [], typeHint?: string | null, signal?: AbortSignal): Promise<MemoriaRefinada | null> {
  const entrada = { description, body: body || "", tags: tags || [], tipo_escolhido: typeHint || "(nenhum — classifique você)" };
  try {
    const resp = await anthropic().messages.create({
      model: TRAINER_MODEL, max_tokens: 2048, output_config: { effort: "low" }, system: SYSTEM,
      tools: [TOOL], tool_choice: { type: "tool", name: "salvar_memoria" },
      messages: [{ role: "user", content: "Memória cadastrada na tela do cérebro:\n" + JSON.stringify(entrada, null, 2) }],
    }, { signal });
    const bloco = resp.content.find((b) => b.type === "tool_use");
    if (!bloco || bloco.type !== "tool_use") return null;
    const saida = bloco.input as Record<string, unknown>;
    const type = String(saida.type ?? ""), desc = String(saida.description ?? "").trim();
    if (!(TIPOS_VALIDOS as readonly string[]).includes(type) || !desc) return null;
    return { type: type as TipoMemoria, description: desc, body: String(saida.body ?? "").trim(),
      tags: (Array.isArray(saida.tags) ? saida.tags : []).map((t) => String(t).trim()).filter(Boolean) };
  } catch { return null; }   // quem chama salva o original
}
```

## II.6 `index.ts` — porteiro, loop e stream

```ts
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anthropic, apiKeyConfigurada, CHAT_EFFORT, CHAT_MODEL, MAX_TOKENS, type Anthropic } from "./anthropic.ts";
import { blocoContexto, blocoMemorias, type ContextoTela, type Recall, REGRAS_DO_SISTEMA, SYSTEM, systemTreinoComMemorias } from "./prompt.ts";
import { anthropicToolDefs, anthropicTrainingToolDefs, getTool, salvarMemoriaNoCerebro, type ToolContext } from "./tools.ts";
import { type Evidencia, revisar } from "./verificador.ts";

// Restrinja ao domínio do app do cliente. "*" funciona (a autenticação é pelo JWT),
// mas é superfície a mais. Aceite mais de uma origem lendo o header Origin e comparando com uma lista.
const ORIGENS_PERMITIDAS = [<<"https://app.cliente.com", "http://localhost:8080">>];
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENS_PERMITIDAS.includes(origin) ? origin : ORIGENS_PERMITIDAS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}
// Nos trechos abaixo, CORS_HEADERS = corsHeaders(req) calculado no início do handler.
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }; // <- substitua por corsHeaders(req)

const MAX_STEPS = 10;                 // trava anti-loop; na última rodada tool_choice: none
const TURN_BUDGET_MS = 95_000;        // orçamento de parede (Edge Function tem teto de duração)
const VERIFIER_SKIP_AFTER_MS = 115_000; // perto do teto, pula o verificador para GARANTIR o done
const VERIFIER_TIMEOUT_MS = 25_000;

const PAPEIS_QUE_CONVERSAM = [<<"manager", "copy_grup">>];
const PAPEIS_QUE_TREINAM = [<<"manager">>];

interface ChatMessage { role: "user" | "assistant"; content: string }
interface ChatBody { action?: string; messages?: ChatMessage[]; modoTreino?: boolean; contexto?: ContextoTela }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
function hojeLocal(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "<<America/Sao_Paulo>>" }); }

// Falha no recall nunca derruba o chat — mas o usuário precisa saber (evento aviso).
async function recallMemorias(supabase: SupabaseClient, pergunta: string): Promise<Recall> {
  try {
    const { data, error } = await supabase.rpc("agente_recall_memories", { p_query: pergunta, p_limit: 12 });
    if (error) return { comportamento: [], conhecimento: [], falha: String(error.message || "erro no recall") };
    const d = (data ?? {}) as Record<string, unknown>;
    return { comportamento: Array.isArray(d.comportamento) ? (d.comportamento as Recall["comportamento"]) : [],
             conhecimento: Array.isArray(d.conhecimento) ? (d.conhecimento as Recall["conhecimento"]) : [] };
  } catch (err) { return { comportamento: [], conhecimento: [], falha: err instanceof Error ? err.message : "rede" }; }
}

function streamChat(supabase: SupabaseClient, body: ChatBody, role: string): Response {
  const history = Array.isArray(body.messages) ? body.messages.filter((m) => m && (m.role === "user" || m.role === "assistant")) : [];
  const modoTreino = body.modoTreino === true && PAPEIS_QUE_TREINAM.includes(role);
  const pergunta = ([...history].reverse().find((m) => m.role === "user")?.content ?? "").trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fechado = false;
      const sse = (obj: unknown) => {
        if (fechado) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { fechado = true; }
      };
      const fechar = () => { if (fechado) return; fechado = true; try { controller.close(); } catch { /* já fechado */ } };

      const ctx: ToolContext = { supabase, onChart: (chart) => sse({ type: "chart", chart }), onMemory: (memoria) => sse({ type: "memoria", memoria }) };
      const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

      try {
        const client = anthropic();
        const recall = await recallMemorias(supabase, pergunta);
        if (recall.falha) sse({ type: "aviso", codigo: "memoria_indisponivel", message: "Não foi possível carregar as memórias treinadas. Esta resposta ignora o treino — tente de novo em instantes." });

        let tools: Anthropic.Tool[]; let system: Anthropic.TextBlockParam[];
        if (modoTreino) {
          tools = anthropicTrainingToolDefs() as Anthropic.Tool[];
          system = [{ type: "text", text: systemTreinoComMemorias(recall) }];
        } else {
          tools = anthropicToolDefs() as Anthropic.Tool[];
          const dinamico = [blocoContexto(body.contexto, hojeLocal()), blocoMemorias(recall)].filter(Boolean).join("\n\n");
          system = [
            { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },  // estático, cacheado
            { type: "text", text: dinamico },                                        // por turno
          ];
        }

        let emittedText = false, pendingBreak = false;   // separa preâmbulo do texto final
        let fullText = "", completed = false;
        const evidencias: Evidencia[] = [{ origem: "regras", titulo: "Regras fixas do sistema", conteudo: REGRAS_DO_SISTEMA }];
        const turnStartedAt = Date.now();

        for (let step = 0; step < MAX_STEPS; step++) {
          const estourou = Date.now() - turnStartedAt > TURN_BUDGET_MS;
          const ultimaRodada = step === MAX_STEPS - 1 || estourou;

          const ai = client.messages.stream({
            model: CHAT_MODEL, max_tokens: MAX_TOKENS,
            thinking: { type: "adaptive" }, output_config: { effort: CHAT_EFFORT },
            system, tools,
            ...(ultimaRodada ? { tool_choice: { type: "none" as const } } : {}),
            messages,
          });

          ai.on("text", (t) => {
            if (pendingBreak) { sse({ type: "token", text: "\n\n" }); fullText += "\n\n"; pendingBreak = false; }
            emittedText = true; fullText += t; sse({ type: "token", text: t });
          });

          const final = await ai.finalMessage();

          if (final.stop_reason === "tool_use") {
            if (emittedText) pendingBreak = true;
            const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
            messages.push({ role: "assistant", content: final.content });   // inteira: blocos de thinking voltam intactos
            for (const tu of toolUses) sse({ type: "tool", name: tu.name, input: tu.input });

            const results: Anthropic.ToolResultBlockParam[] = await Promise.all(toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
              const tool = getTool(tu.name);
              if (!tool) return { type: "tool_result", tool_use_id: tu.id, content: `Ferramenta desconhecida: ${tu.name}`, is_error: true };
              try {
                const out = await tool.execute((tu.input ?? {}) as Record<string, unknown>, ctx);
                if (tool.origem) evidencias.push({ origem: tool.origem, titulo: tu.name, conteudo: out.slice(0, 5000) });
                return { type: "tool_result", tool_use_id: tu.id, content: out };
              } catch (err) {
                return { type: "tool_result", tool_use_id: tu.id, content: err instanceof Error ? err.message : "erro na ferramenta", is_error: true };
              }
            }));
            messages.push({ role: "user", content: results });
            continue;
          }
          if (final.stop_reason === "max_tokens") { sse({ type: "error", message: "A resposta excedeu o teto de tokens antes de concluir. Peça o conteúdo por partes ou um recorte mais enxuto." }); break; }
          if (final.stop_reason === "refusal") { sse({ type: "error", message: "<<NOME>> não pôde responder a esta pergunta. Reformule ou peça de outra forma." }); break; }
          completed = true; break;
        }

        if (!completed && !fullText.trim()) sse({ type: "error", message: "A resposta atingiu o limite de etapas de coleta antes de ser concluída. Tente de novo ou peça por partes." });

        // ── Passe anti-fakenews ──────────────────────────────────────────
        if (!modoTreino && completed && fullText.trim() && Date.now() - turnStartedAt < VERIFIER_SKIP_AFTER_MS) {
          const revisao = await revisar(pergunta, fullText, evidencias, AbortSignal.timeout(VERIFIER_TIMEOUT_MS));
          sse({ type: "revisao", revisao });
          const notas = [
            ...revisao.divergencias.map((d) => `- Fontes divergem: ${d}`),
            ...revisao.ressalvas.filter((r) => r.gravidade === "alta").map((r) => `- ${r.afirmacao}: ${r.motivo}`),
          ];
          if (notas.length) sse({ type: "token", text: `\n\n⚠️ **Revisão automática**\n${notas.join("\n")}` });
        }
        sse({ type: "done" });
      } catch (err) {
        sse({ type: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
      } finally {
        fechar();
      }
    },
  });

  return new Response(stream, { headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Não autenticado." }, 401);

  // Client com o JWT do usuário: RLS e guards das RPCs valem como na tela. NUNCA service_role aqui.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Não autenticado." }, 401);

  const { data: profile } = await supabase.from("profiles").select("role, full_name, is_active").eq("id", user.id).maybeSingle();
  const role = String(profile?.role ?? "");
  if (profile?.is_active === false) return json({ error: "Conta desativada." }, 403);
  if (!PAPEIS_QUE_CONVERSAM.includes(role)) return json({ error: "<<NOME>> atende só <<a área X>>." }, 403);

  let body: ChatBody & Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "chat");

  // ping: descobrir pela interface se a chave está configurada, sem abrir log.
  if (action === "ping") return json({ ok: true, chave_configurada: apiKeyConfigurada(), modelo: CHAT_MODEL, role });

  if (!apiKeyConfigurada()) return json({ error: "A chave da Anthropic (ANTHROPIC_API_KEY) não está configurada nos secrets do projeto. <<NOME>> ainda não consegue responder." }, 503);

  if (action === "memoria_salvar") {
    if (!PAPEIS_QUE_TREINAM.includes(role)) return json({ error: "Só <<o administrador>> pode treinar <<NOME>>." }, 403);
    const description = String(body.description ?? "").trim();
    if (!description) return json({ error: "Informe o título da memória." }, 400);
    try {
      const row = await salvarMemoriaNoCerebro({ supabase }, {
        name: body.name ? String(body.name) : undefined, description, body: String(body.body ?? ""),
        tags: Array.isArray(body.tags) ? (body.tags as unknown[]).map(String) : [],
        type: body.type ? String(body.type) : null, refinar: body.refinar !== false,
      });
      return json(row, 201);
    } catch (err) { return json({ error: err instanceof Error ? err.message : "Falha ao salvar a memória." }, 400); }
  }

  if (action === "chat") {
    const history = Array.isArray(body.messages) ? body.messages : [];
    const last = [...history].reverse().find((m) => m?.role === "user");
    if (!last?.content?.trim()) return json({ error: "Nenhuma pergunta do usuário." }, 400);
    return streamChat(supabase, body, role);
  }
  return json({ error: `Ação desconhecida: ${action}` }, 400);
});
```

---

# Parte III — Variante B (Daniel): route handler + FastAPI

Use quando o cliente já tem Next.js e/ou um backend Python. O núcleo é o
mesmo; o que muda:

## III.1 Onde cada peça fica

| peça | Daniel |
| --- | --- |
| Loop do turno | `src/app/api/chat/route.ts` (Next.js, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`) |
| Tools | `src/lib/rag/tools.ts` — fábrica `backendTool({name, description, path, params})` que vira GET autenticado no FastAPI (uma tool por rota de leitura) |
| System/prompt | `src/lib/rag/core.ts` (`SYSTEM`, `SYSTEM_TREINO`, `systemWithHierarchy`, `systemWithMemories`, `systemTreinoComMemorias`) |
| Recall | `POST /api/v1/brain/recall` → `services/brain_recall.py` (camadas: RPC FTS → fallback local com IDF → 1 salto wikilinks) |
| Treinador | `POST /api/v1/brain/memories` (`require_role("admin","analista")`) → `services/brain_trainer.py` |
| Verificador | `POST /api/v1/agente/verificar` → `services/verificador.py` (timeout 20 s no cliente; fail-open) |
| Sandbox SQL | `POST /api/v1/agente/sql` → `services/sql_tool.py` (blocklist + RPC `exec_sql_leitura` com `service_role`) |
| Histórico | `/api/v1/daniel/chats/*` → RPCs `save_daniel_chat` etc. (todas recebem `p_user_id` do JWT validado) |
| Token do usuário | vai no **corpo** do POST (`token`) porque o route handler é server-side e repassa ao FastAPI como `Authorization: Bearer` |
| Modelos | `settings.CHAT_MODEL` (backend) e `process.env.CHAT_MODEL` (front); `TEMPERATURE_ZERO` calculado por regex do nome do modelo |

Diferença de segurança: o FastAPI usa `service_role` (`get_supabase_admin()`)
depois de validar o JWT com `get_current_user`/`require_role`. Funciona, mas
a RLS não protege mais nada por dentro; cada rota precisa filtrar por
`current_user["id"]` e checar o papel. Na variante A isso é automático.

## III.2 Recall em camadas (`brain_recall.py`), para quando a RPC não basta

Fluxo de `selecionar_memorias(memorias, pergunta)`:

1. separa comportamento (`feedback`/`user`, cap 50) de conhecimento;
2. tenta a RPC `search_brain_memories(p_query, p_limit=12)` (FTS OR + tags);
3. se falhar ou voltar vazia, **fallback local**: normaliza acentos, tokeniza
   em palavras de 2+ chars (siglas contam), casa por prefixo comum ≥ 4 (stem
   pobre: `leiloes` casa `leilao`), peso por campo (description ×3, tags ×2,
   body ×1), **peso IDF por termo** calculado da própria base (termo em mais
   da metade da base vale 0 — substitui lista de stopwords), desempate por
   `name`; se nenhum termo tem poder de separação, devolve vazio (melhor
   nenhuma do que as 12 mais recentes disfarçadas de relevantes);
4. expande 1 salto por `[[wikilinks]]` (cap total 20).

Vale replicar o fallback só se o cliente não puder rodar a RPC (banco fora
do Supabase, sem `websearch_to_tsquery` em português).

## III.3 Módulos extras do Daniel

**Busca web server-side com cascata.** Tool `{ type: "web_search_20250305", name: "web_search", max_uses: 5, allowed_domains? }`. O system define a **hierarquia**: 1º interno (banco/documentos/memória) → 2º domínios cadastrados pelo cliente (tabela `client_web_sources`, com rótulo) → 3º web aberta como último recurso, sinalizando a origem. Exceção: fonte citada pelo nome vai direto ao `web_search` nela. `stop_reason === "pause_turn"` reenvia o conteúdo e continua o loop. Trechos citados (`citations[].cited_text`) viram evidência `web`. No backend Python, há ainda uma 2ª passada com web aberta se o rascunho contém "não encontrei".

**Documentos (RAG de PDFs).** Tool `buscar_documentos(pergunta)`: embeda a pergunta (Gemini `gemini-embedding-001`, 1536 dims), consulta Pinecone (`topK 8`), devolve trechos `[i] Fonte: arquivo\ntexto`; emite evento `sources` com as fontes únicas e melhor score. Upload pela tela (`POST /brain/pdfs`, até 50 MB) indexa no mesmo namespace do CLI. Evidência `documentos`.

**Busca em legislação.** Tool que baixa listas do backend e filtra por tokens normalizados, devolvendo só os itens que casam (evita despejar JSON gigante no contexto). Padrão útil para qualquer "achar um item específico numa lista grande".

**Anexos do usuário.** Imagens (`image/png|jpeg|gif|webp`) e PDF viram blocos `image`/`document` base64 antes do texto da pergunta. O histórico guarda só o metadado do chip; o base64 existe só na sessão. Limite 15 MB por arquivo.

**Geração de PDF.** Tool `gerar_pdf(titulo, subtitulo?, conteudo_markdown, graficos?)`, só quando o usuário pede explicitamente; marcadores `[[grafico:N]]` posicionam os gráficos; o binário vai como data URL no evento `pdf` (não volta ao modelo). Por isso o `MAX_TOKENS` do Daniel é 64 k: o relatório inteiro vai no input da tool.

**Config de modelos separada por trabalho.** `CHAT_MODEL`, `TRAINER_MODEL`, `VERIFIER_MODEL`, `RADAR_MODEL` (volume, barato), `INGEST_MODEL` e até uma `INGEST_ANTHROPIC_API_KEY` separada para a equipe que sobe planilhas ter faturamento e revogação próprios.

---

# Parte IV — Radar de demanda (opcional, do Daniel)

Fecha o ciclo do treino: mostra ao administrador o que os usuários
perguntaram, onde o agente falhou, e sugere por onde começar.

**Privacidade.** O radar lê o histórico de **todos** os usuários com
`service_role` e guarda pergunta, resposta, nome e grupo em tabelas que só o
administrador acessa. Isso muda o contrato do histórico (que até então só o
dono lê). Só implemente com o cliente ciente e com aviso aos usuários na
tela do chat ("suas perguntas podem ser revisadas pela equipe para melhorar
o agente"). As tabelas ficam com RLS ligada e sem policy; a rota exige papel
de administrador; o texto da resposta é cortado (4.000 chars no grão, 1.200
no relatório).

## IV.1 Tabelas

```sql
-- O grão: uma pergunta de usuário, classificada. Acumula, é reprocessável.
create table if not exists public.agente_radar_perguntas (
  id             bigserial primary key,
  chat_id        uuid not null references public.agente_chats(id) on delete cascade,
  ordem          integer not null,
  user_id        text references public.profiles(id) on delete set null,
  usuario_nome   text not null default '',      -- CONGELADO na linha
  grupo_id       text, grupo_nome text not null default 'Sem grupo',   -- Daniel: empresa
  pergunta       text not null,
  resposta       text not null default '',      -- até 4000 chars; guardada aqui para o relatório não mudar se a conversa for apagada
  setor          text not null default 'outros' check (setor in (<<'eletrico','petroleo','bio','legislacao','macro','plataforma','outros'>>)),
  subtema        text not null default '',
  classificada   boolean not null default false,
  sem_fonte      boolean not null default false,  -- respondeu sem citar fonte
  sem_resposta   boolean not null default false,  -- conversa morreu na pergunta
  refeita        boolean not null default false,  -- mesma dúvida reformulada (Jaccard >= 0.6)
  perguntada_em  timestamptz not null,            -- carimbado UMA vez na primeira coleta
  created_at     timestamptz not null default now(),
  constraint uq_agente_radar_pergunta unique (chat_id, ordem)   -- idempotência
);
create index if not exists idx_radar_perguntas_pendentes on public.agente_radar_perguntas(perguntada_em desc) where not classificada;

-- O entregável: recorte do dia/semana, congelado em jsonb.
create table if not exists public.agente_radar_relatorios (
  id bigserial primary key,
  periodo text not null check (periodo in ('diario','semanal')),
  inicio date not null, fim date not null,
  total_perguntas int not null default 0, total_usuarios int not null default 0,
  total_conversas int not null default 0, total_grupos int not null default 0,
  temas jsonb not null default '[]'::jsonb,      -- [{setor, subtema, total, usuarios, grupos[], exemplos[]}]
  grupos jsonb not null default '[]'::jsonb,
  lacunas jsonb not null default '{}'::jsonb,    -- {sem_fonte, entre_grupos, sem_resposta, refeitas}
  resumo text not null default '',
  sugestoes jsonb not null default '[]'::jsonb,  -- [{titulo, motivo, prioridade}]
  gerado_em timestamptz not null default now(),
  constraint uq_agente_radar_relatorio unique (periodo, inicio, fim)
);
-- RLS ligada e SEM policy: só o backend (service_role) lê, em rota de administrador.
alter table public.agente_radar_perguntas enable row level security;
alter table public.agente_radar_relatorios enable row level security;
```

## IV.2 Os três passos (cada um reexecutável sozinho)

1. **Coletar** (sem IA): varre conversas com `updated_at` nos últimos 45 dias,
   grava cada pergunta nova com `upsert ... on_conflict (chat_id, ordem)
   ignore_duplicates`, calcula os sinais, ignora perguntas < 8 chars,
   `perguntada_em` = `created_at` do chat para `ordem 0`, senão `updated_at`.
2. **Classificar** (modelo barato, `temperature 0`, tool forçada
   `classificar_perguntas`, lotes de 25, teto 400 por rodada): setor da
   taxonomia fixa + subtema livre em 2–5 palavras. Manda junto os 80 rótulos
   de subtema já em uso para o modelo **reaproveitar** em vez de inventar
   sinônimos. Lote que falha continua pendente.
3. **Relatório**: agrega por (setor, subtema) e por grupo, monta os quatro
   blocos de lacuna, pede ao modelo a leitura (`emitir_leitura`: resumo de
   2–4 frases + até 5 sugestões com prioridade), fail-open, `upsert` por
   `(periodo, inicio, fim)`. Corte do dia é **meia-noite no fuso do
   cliente**, não UTC.

Agendamento: `pg_cron` + `pg_net` chamando `POST /api/v1/agente/radar/cron`
com header `X-Cron-Secret`, às 05:10 local. A tela tem "Atualizar agora" e o
botão "Treinar" de cada tema abre o compositor de memória com
`{description, body, tags}` pré-preenchidos.

---

# Parte V — Deploy e operação

```bash
# Secrets (Edge Function)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
# NUNCA copie a chave de um chat que mascara caracteres (•). Cole de um editor de texto puro.

# Deploy da função
supabase functions deploy agente --project-ref <ref> --use-api

# Conferir
curl -s -X OPTIONS https://<ref>.supabase.co/functions/v1/agente -i | head -1      # 200
curl -s -X POST https://<ref>.supabase.co/functions/v1/agente -d '{"action":"ping"}' # 401 sem JWT
# com JWT de um usuário da área: {"ok":true,"chave_configurada":true,"modelo":"claude-opus-5","role":"..."}
```

Migration: aplique pela ferramenta do cliente (Supabase CLI, Management API,
SQL Editor). Rode as verificações de I.5 antes de abrir para usuários.

Rotação de chave: regrave o secret; a função pega o valor novo sem redeploy
(cliente amarrado ao valor). Se o `ping` disser `chave_configurada: true` e
o chat der 401 da Anthropic, a chave está errada ou com caractere inválido
(a mensagem de erro aponta a posição).

Logs: a Edge Function loga stack traces no dashboard do Supabase; nada de
dado de usuário deve ir para log.

Estender depois:

| você quer | onde mexer |
| --- | --- |
| Tela nova no agente | uma tool `painel_*` chamando a função dela + citar a tela na persona |
| Tabela nova no SQL | adicionar ao array da migration (GRANT + policy) **e** ao `CATALOGO_SQL` |
| Regra de negócio nova | uma linha no `REGRAS_DO_SISTEMA` (vale para prompt e verificador) |
| Comportamento novo, sem deploy | o usuário cadastra uma memória `feedback` |
| Trocar de modelo | só a variável de ambiente; os três papéis são independentes |

---

# Parte VI — Testes

## VI.1 Unitários do backend (Deno)

Cubra `normalizeChart` (pizza corta para 1 série; valores alinhados às
categorias; tipo inválido lança), `slugify` (igual ao SQL), `clip` (array
truncado com `_aviso`) e o filtro do `consultar_banco` (recusa `;`, `DELETE`,
`profiles`).

## VI.2 Eval de regressão do treino (do Daniel)

```python
# scripts/eval_agente.py — casos-ouro do recall. Exit != 0 se algum falhar (CI).
GOLDEN = [
    {"pergunta": "<<Como funcionam os leilões de energia?>>", "deve_conter": ["<<A-5>>"], "nao_deve_conter": []},
]
# Modo --so-recall: chama a RPC agente_recall_memories(pergunta) e checa se os
# termos-ouro aparecem no bloco de memórias (normalizando acento/caixa). Barato.
# Modo padrão: roda o turno inteiro (custa tokens) e checa a resposta final.
```

Rode o `--so-recall` sempre que mexer no recall, no treinador ou no índice.

## VI.3 Testes de aceitação (manuais, antes de entregar)

Os oito da seção 8.7 do arquivo 01. Registre o resultado no documento de
entrega.

---

## Checklist final do backend

- [ ] Snapshot do banco feito; script de reversão (I.6) revisado; nenhuma colisão de nome `agente_*` (I.7 item 1).
- [ ] Nenhum `DROP`/`DELETE`/`UPDATE`/`ALTER` sobre objetos pré-existentes do cliente em nenhuma migration.
- [ ] Predicado das policies do sandbox decidido conscientemente (`USING (true)` só em dado que todos da área veem; tenant-aware ou tabela fora do sandbox nos demais).
- [ ] Colunas de PII revisadas (I.7 item 5); views de mascaramento onde a tela não precisa do dado.
- [ ] Cliente informado por escrito de que pergunta, resultados de tools e memórias vão para a API do modelo; política de retenção conferida.
- [ ] CORS restrito ao domínio do app.
- [ ] Guards de "conversar" e "treinar" existem e são usados em TODAS as RPCs do agente.
- [ ] Array de tabelas do sandbox = tabelas do catálogo; nenhuma tabela sensível.
- [ ] `agente_exec_sql` pertence a `agente_sql_ro`; policies `agente_sql_ro read` nas tabelas com RLS.
- [ ] Índice FTS com a expressão idêntica à do recall, incluindo tags.
- [ ] `feedback`/`user` do seed alinhadas ao `SYSTEM`.
- [ ] Porteiro recusa sem JWT (401), papel errado (403), conta inativa (403); `ping` funciona.
- [ ] Cada tela tem uma tool `painel_*` que chama a mesma função; cabeçalho de fonte em toda tool.
- [ ] `consultar_banco` filtra SELECT/WITH, `;`, blocklist; erro de SQL volta como texto.
- [ ] `gerar_grafico` normaliza no servidor.
- [ ] Verificador com `temperature 0`, tool forçada, fail-open, timeout; só divergências e altas no texto.
- [ ] Treinador força `feedback` para regras; modo treino lista slugs.
- [ ] `MAX_STEPS`, orçamento de tempo, `tool_choice: none` na última rodada, `done` no `finally`.
- [ ] Chave validada por posição; cliente amarrado ao valor da chave.
- [ ] Verificações de I.5 passam em produção.
