# Análises Geovani — arquitetura de banco

Área nova do app (`/analises`) com 3 abas: **Banco de dados** (mapeamento do banco
de vendas da XMX, tabela a tabela), **Dúvidas** (perguntas do Geovani, respondidas
pelo Webert e pelo Maialle no próprio item) e **Análises/Relatórios** (upload de
notebooks Jupyter `.ipynb` que o app renderiza).

## Estado em 19/10/2026

| Fase | O que existe | Onde |
|---|---|---|
| 1 (agora) | Flag `profiles.can_view_geovani_analyses` + helper `public.can_view_geovani_analyses()`. A tela fica "Em construção", sem dado. | `supabase/migrations/20261019120000_analises_geovani_acesso.sql` |
| 2 (próxima) | Tabelas, bucket e policies descritos abaixo. **Rascunho, não aplicado.** | este documento |

Quem liga a flag: `docs/analises-geovani/LIBERAR-ACESSO.sql` (rodado à parte, por SQL).

---

## 1. Quem pode o quê

Duas capacidades, no vocabulário do repo (uma boolean por capacidade, nomeada
pelo que ela permite — nada de cargo):

| Flag em `profiles` | Permite | Quem recebe |
|---|---|---|
| `can_view_geovani_analyses` (fase 1) | Entrar em `/analises`, ler relatórios **publicados**, ler o mapeamento, abrir dúvidas e responder. | Geovani, Webert, Maialle |
| `can_publish_geovani_analyses` (fase 2) | Subir notebooks, ver/editar rascunhos, publicar/arquivar, editar o mapeamento do banco, moderar dúvidas. | Geovani |

Por que duas flags e não "autor = id fixo do Geovani": id fixo em policy é
invisível na tela de Usuários e exige migration para trocar de pessoa. A flag
segue o padrão de `can_access_analytics` / `can_claim_tickets` e é trocada com
um `UPDATE`. O helper de publicação **também exige** a de leitura, para que
"desligar a área" de alguém seja um único `UPDATE`.

Gestora (`role = manager`) **não** entra automaticamente: a área é pessoal do
Geovani. Se um dia precisar, liga-se a flag nela como em qualquer outra pessoa.

### Por que ninguém consegue ligar a própria flag

Nenhuma migration do repo cria policy de `UPDATE` (ou `ALL`) em `public.profiles`.
Com RLS ligada, isso quer dizer que **nenhum usuário autenticado consegue dar
UPDATE em linha nenhuma de profiles**, nem na própria. É assim que
`can_view_all_tickets`, `can_access_analytics` e `role` já ficam protegidas hoje,
e as flags só mudam por SQL (Management API) ou por RPC `SECURITY DEFINER` com
guarda de gestora (`manager_set_user_active`, `manager_set_agent_availability`).

A migration da fase 1 termina com um bloco `DO` que procura policy de
`UPDATE`/`ALL` em `profiles` no banco em que roda e solta um `WARNING` se achar
uma (por exemplo, criada pelo painel do Supabase/Lovable, fora do repo). Ela só
avisa e não altera nada.

O que **não** foi feito, e por quê:

- `REVOKE UPDATE (coluna) ON profiles FROM authenticated` não protege: o
  Supabase concede `UPDATE` na **tabela inteira** para `authenticated`, e o
  privilégio de tabela vale por cima do de coluna. Para funcionar, seria preciso
  revogar o `UPDATE` da tabela e re-conceder coluna a coluna, o que mexe em
  todas as telas que um dia gravarem em profiles. Fica fora do escopo.
- Trigger `BEFORE UPDATE` barrando a coluna: não existe esse padrão no repo e,
  sem policy de UPDATE, ele não teria o que barrar. Se o `WARNING` aparecer,
  quem resolve é corrigir a policy, porque ela também deixaria o usuário se dar
  `role = 'manager'`, e esse buraco é bem maior que esta flag.

---

## 2. Tabelas da fase 2

Convenções (as mesmas do resto do banco):

- Ids de usuário são `text` e referenciam `profiles(id)` (`profiles.id` é text).
  Comparar com `(SELECT auth.uid())::text`.
- Toda policy chama o helper **embrulhado em `SELECT`**:
  `USING ((SELECT public.can_view_geovani_analyses()))`. Chamado "nu", ele é
  reavaliado por linha, e foi isso que causou os bilhões de scans do incidente
  de 24/07/2026 (ver `20260727120000_rls_initplan_optimization.sql`). Com
  `SELECT`, vira InitPlan: uma chamada por query.
- Nomes de tabela em inglês com prefixo `analysis_`, para agrupar no painel.
  Os valores de status ficam em pt-BR (`rascunho`, `publicado`, …), como em
  `lya_files.status`, porque aparecem em filtros e logs que o Geovani lê.
- CRUD direto com RLS, sem RPC (mesmo modelo da Base de Suporte e do Caderno do
  agente). A única regra que precisa de privilégio extra, que é a dúvida virar
  "respondida" quando chega resposta, fica num trigger `SECURITY DEFINER`.

### 2.1 Visão geral

```
analysis_reports 1─N analysis_report_versions ──► storage: analysis-notebooks/<report_id>/v<n>.ipynb
        ▲                                   
        │ (opcional)                        
analysis_questions 1─N analysis_answers     
        │ (opcional)                        
        ▼                                   
analysis_db_sources 1─N analysis_db_tables 1─N analysis_db_columns
                              │                      │
                              └─ analysis_db_notes ──┘   analysis_db_relationships (coluna ↔ coluna)
```

### 2.2 SQL rascunho (NÃO aplicado)

Pré-requisito: a migration `20261019120000_analises_geovani_acesso.sql` já
aplicada. Nome sugerido para a próxima:
`supabase/migrations/2026MMDDHHMMSS_analises_geovani_tabelas.sql`.

```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- 0) Capacidade de publicar + helpers
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_publish_geovani_analyses boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_publish_geovani_analyses IS
  'Pode subir/publicar notebooks e editar o mapeamento do banco na área Análises Geovani. Só vale junto com can_view_geovani_analyses e conta ativa.';

CREATE OR REPLACE FUNCTION public.can_publish_geovani_analyses()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())::text
      AND p.can_view_geovani_analyses
      AND p.can_publish_geovani_analyses
      AND p.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.can_publish_geovani_analyses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_publish_geovani_analyses() TO authenticated;

-- updated_at próprio da área (não depende de helper antigo do Lovable).
CREATE OR REPLACE FUNCTION public.analysis_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1) Relatórios (notebooks)
-- ═════════════════════════════════════════════════════════════════════════════
-- Um relatório é o "card" estável; cada upload de .ipynb vira uma versão nova,
-- imutável. O relatório aponta para a versão que está no ar.
CREATE TABLE IF NOT EXISTS public.analysis_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE
                      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title               text NOT NULL CHECK (length(btrim(title)) > 0),
  summary             text NOT NULL DEFAULT '',
  tags                text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'rascunho'
                      CHECK (status IN ('rascunho', 'publicado', 'arquivado')),
  current_version_id  uuid,                       -- FK abaixo (ciclo com versions)
  author_id           text NOT NULL DEFAULT (auth.uid())::text
                      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- publicado sem versão = card quebrado na tela; o banco não deixa.
  CONSTRAINT analysis_reports_published_chk
    CHECK (status <> 'publicado' OR (current_version_id IS NOT NULL AND published_at IS NOT NULL))
);

COMMENT ON TABLE public.analysis_reports IS
  'Relatórios da área Análises Geovani. Cada upload de .ipynb é uma linha em analysis_report_versions; current_version_id é a que aparece.';

CREATE TABLE IF NOT EXISTS public.analysis_report_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        uuid NOT NULL REFERENCES public.analysis_reports(id) ON DELETE CASCADE,
  version          integer NOT NULL CHECK (version > 0),
  storage_path     text NOT NULL UNIQUE,          -- '<report_id>/v<version>.ipynb'
  file_name        text NOT NULL,                 -- nome original do upload
  size_bytes       integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20 * 1024 * 1024),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  nbformat         integer,                       -- 4 na prática; 3 renderiza diferente
  kernel_name      text,                          -- ex. 'python3'
  -- Extraído no upload (o front já parseia o JSON para validar):
  cell_count       integer NOT NULL DEFAULT 0,
  queried_tables   text[] NOT NULL DEFAULT '{}',  -- 'schema.tabela' lidos nas células SQL/pandas
  changelog        text NOT NULL DEFAULT '',
  uploaded_by      text NOT NULL DEFAULT (auth.uid())::text
                   REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_report_versions_uniq UNIQUE (report_id, version),
  CONSTRAINT analysis_report_versions_path_chk
    CHECK (storage_path = report_id::text || '/v' || version::text || '.ipynb')
);

ALTER TABLE public.analysis_reports
  DROP CONSTRAINT IF EXISTS analysis_reports_current_version_fk;
-- A FK composta garante que a versão "no ar" é DESTE relatório.
ALTER TABLE public.analysis_report_versions
  DROP CONSTRAINT IF EXISTS analysis_report_versions_id_report_uniq;
ALTER TABLE public.analysis_report_versions
  ADD CONSTRAINT analysis_report_versions_id_report_uniq UNIQUE (id, report_id);
ALTER TABLE public.analysis_reports
  ADD CONSTRAINT analysis_reports_current_version_fk
  FOREIGN KEY (current_version_id, id)
  REFERENCES public.analysis_report_versions (id, report_id)
  ON DELETE SET NULL (current_version_id)          -- PG15+; Supabase está em 15/17
  DEFERRABLE INITIALLY DEFERRED;

-- Lista da aba: publicados mais recentes primeiro.
CREATE INDEX IF NOT EXISTS idx_analysis_reports_status_published
  ON public.analysis_reports (status, published_at DESC);
-- "Quais relatórios leem a tabela X?" (link da aba Banco de dados → Relatórios).
CREATE INDEX IF NOT EXISTS idx_analysis_report_versions_queried_tables
  ON public.analysis_report_versions USING gin (queried_tables);
-- report_id já é coberto pelo UNIQUE (report_id, version).

DROP TRIGGER IF EXISTS trg_analysis_reports_touch ON public.analysis_reports;
CREATE TRIGGER trg_analysis_reports_touch
  BEFORE UPDATE ON public.analysis_reports
  FOR EACH ROW EXECUTE FUNCTION public.analysis_touch_updated_at();

ALTER TABLE public.analysis_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_report_versions ENABLE ROW LEVEL SECURITY;

-- Leitor vê só publicado; quem publica vê tudo (inclusive rascunho/arquivado).
DROP POLICY IF EXISTS "analysis_reports leitura" ON public.analysis_reports;
CREATE POLICY "analysis_reports leitura" ON public.analysis_reports
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_publish_geovani_analyses())
    OR (status = 'publicado' AND (SELECT public.can_view_geovani_analyses()))
  );

DROP POLICY IF EXISTS "analysis_reports escrita" ON public.analysis_reports;
CREATE POLICY "analysis_reports escrita" ON public.analysis_reports
  FOR ALL TO authenticated
  USING ((SELECT public.can_publish_geovani_analyses()))
  WITH CHECK ((SELECT public.can_publish_geovani_analyses()));

DROP POLICY IF EXISTS "analysis_report_versions leitura" ON public.analysis_report_versions;
CREATE POLICY "analysis_report_versions leitura" ON public.analysis_report_versions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_publish_geovani_analyses())
    OR (
      (SELECT public.can_view_geovani_analyses())
      AND EXISTS (
        SELECT 1 FROM public.analysis_reports r
        WHERE r.id = analysis_report_versions.report_id
          AND r.status = 'publicado'
      )
    )
  );

-- Versão é imutável: só INSERT (e DELETE para limpar upload errado). Sem UPDATE.
DROP POLICY IF EXISTS "analysis_report_versions insert" ON public.analysis_report_versions;
CREATE POLICY "analysis_report_versions insert" ON public.analysis_report_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.can_publish_geovani_analyses())
    AND uploaded_by = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "analysis_report_versions delete" ON public.analysis_report_versions;
CREATE POLICY "analysis_report_versions delete" ON public.analysis_report_versions
  FOR DELETE TO authenticated
  USING ((SELECT public.can_publish_geovani_analyses()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_reports TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.analysis_report_versions TO authenticated;

-- ── Storage: bucket privado para os .ipynb ──────────────────────────────────
-- Leitura pelo front via createSignedUrl (60 s) ou download() autenticado:
-- as policies abaixo decidem quem consegue gerar/baixar.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'analysis-notebooks', 'analysis-notebooks', false,
  20 * 1024 * 1024,
  ARRAY['application/x-ipynb+json', 'application/json']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "analysis-notebooks leitura" ON storage.objects;
CREATE POLICY "analysis-notebooks leitura" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'analysis-notebooks'
    AND (
      (SELECT public.can_publish_geovani_analyses())
      OR (
        (SELECT public.can_view_geovani_analyses())
        AND EXISTS (
          SELECT 1
          FROM public.analysis_report_versions v
          JOIN public.analysis_reports r ON r.id = v.report_id
          WHERE v.storage_path = storage.objects.name
            AND r.status = 'publicado'
        )
      )
    )
  );

DROP POLICY IF EXISTS "analysis-notebooks upload" ON storage.objects;
CREATE POLICY "analysis-notebooks upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'analysis-notebooks'
    AND (SELECT public.can_publish_geovani_analyses())
    AND name ~ '^[0-9a-f-]{36}/v[0-9]+\.ipynb$'
  );

-- Sem UPDATE (upsert) de propósito: versão nova = arquivo novo.
DROP POLICY IF EXISTS "analysis-notebooks delete" ON storage.objects;
CREATE POLICY "analysis-notebooks delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'analysis-notebooks'
    AND (SELECT public.can_publish_geovani_analyses())
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 2) Mapeamento do banco XMX
-- ═════════════════════════════════════════════════════════════════════════════
-- Catálogo descritivo, NÃO uma réplica: nenhuma linha de venda vem para cá e
-- nenhuma credencial é guardada (a conexão com o MySQL continua só nos
-- notebooks/Edge Functions, fora deste schema).
CREATE TABLE IF NOT EXISTS public.analysis_db_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]+$'),  -- 'homosistemaxmx'
  label        text NOT NULL,                                      -- 'Banco de vendas XMX'
  engine       text NOT NULL CHECK (engine IN ('mysql', 'postgres', 'outro')),
  access_mode  text NOT NULL DEFAULT 'somente_leitura'
               CHECK (access_mode IN ('somente_leitura', 'leitura_escrita')),
  description  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.analysis_db_tables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES public.analysis_db_sources(id) ON DELETE CASCADE,
  schema_name     text NOT NULL,          -- no MySQL, schema = database
  table_name      text NOT NULL,
  kind            text NOT NULL DEFAULT 'table' CHECK (kind IN ('table', 'view')),
  description     text NOT NULL DEFAULT '',
  grain           text NOT NULL DEFAULT '',     -- "uma linha por pedido", etc.
  approx_rows     bigint,
  has_read_access boolean NOT NULL DEFAULT false, -- o usuário só-leitura enxerga?
  last_seen_at    timestamptz,                  -- última introspecção que a encontrou
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_db_tables_uniq UNIQUE (source_id, schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS public.analysis_db_columns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id        uuid NOT NULL REFERENCES public.analysis_db_tables(id) ON DELETE CASCADE,
  column_name     text NOT NULL,
  ordinal         integer NOT NULL DEFAULT 0,
  data_type       text NOT NULL,          -- texto cru do MySQL: 'decimal(10,2)', 'enum(...)'
  is_nullable     boolean NOT NULL DEFAULT true,
  is_primary_key  boolean NOT NULL DEFAULT false,
  description     text NOT NULL DEFAULT '',
  example_value   text,                   -- NUNCA dado pessoal real; exemplo inventado
  is_pii          boolean NOT NULL DEFAULT false,
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_db_columns_uniq UNIQUE (table_id, column_name)
);

-- Relacionamento coluna→coluna. O banco de vendas quase não tem FK declarada,
-- então a maioria é inferida; `confidence` deixa isso explícito na tela.
CREATE TABLE IF NOT EXISTS public.analysis_db_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_column_id  uuid NOT NULL REFERENCES public.analysis_db_columns(id) ON DELETE CASCADE,
  to_column_id    uuid NOT NULL REFERENCES public.analysis_db_columns(id) ON DELETE CASCADE,
  cardinality     text NOT NULL DEFAULT 'N:1' CHECK (cardinality IN ('1:1', 'N:1', '1:N', 'N:N')),
  confidence      text NOT NULL DEFAULT 'inferido'
                  CHECK (confidence IN ('fk_declarada', 'confirmado', 'inferido')),
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_db_relationships_uniq UNIQUE (from_column_id, to_column_id),
  CONSTRAINT analysis_db_relationships_self_chk CHECK (from_column_id <> to_column_id)
);

-- Anotações livres (armadilhas, regras de negócio). Presas à tabela e,
-- opcionalmente, a uma coluna dela.
CREATE TABLE IF NOT EXISTS public.analysis_db_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id    uuid NOT NULL REFERENCES public.analysis_db_tables(id) ON DELETE CASCADE,
  column_id   uuid REFERENCES public.analysis_db_columns(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'observacao'
              CHECK (kind IN ('observacao', 'armadilha', 'regra_de_negocio')),
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  author_id   text NOT NULL DEFAULT (auth.uid())::text
              REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- FKs sem índice automático: cobrir as que a tela navega.
CREATE INDEX IF NOT EXISTS idx_analysis_db_columns_table_ordinal
  ON public.analysis_db_columns (table_id, ordinal);           -- (UNIQUE já cobre table_id, mas não a ordem)
CREATE INDEX IF NOT EXISTS idx_analysis_db_relationships_to
  ON public.analysis_db_relationships (to_column_id);           -- from_ já coberto pelo UNIQUE
CREATE INDEX IF NOT EXISTS idx_analysis_db_notes_table
  ON public.analysis_db_notes (table_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_db_notes_column
  ON public.analysis_db_notes (column_id) WHERE column_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_analysis_db_sources_touch ON public.analysis_db_sources;
CREATE TRIGGER trg_analysis_db_sources_touch BEFORE UPDATE ON public.analysis_db_sources
  FOR EACH ROW EXECUTE FUNCTION public.analysis_touch_updated_at();
DROP TRIGGER IF EXISTS trg_analysis_db_tables_touch ON public.analysis_db_tables;
CREATE TRIGGER trg_analysis_db_tables_touch BEFORE UPDATE ON public.analysis_db_tables
  FOR EACH ROW EXECUTE FUNCTION public.analysis_touch_updated_at();
DROP TRIGGER IF EXISTS trg_analysis_db_columns_touch ON public.analysis_db_columns;
CREATE TRIGGER trg_analysis_db_columns_touch BEFORE UPDATE ON public.analysis_db_columns
  FOR EACH ROW EXECUTE FUNCTION public.analysis_touch_updated_at();
DROP TRIGGER IF EXISTS trg_analysis_db_notes_touch ON public.analysis_db_notes;
CREATE TRIGGER trg_analysis_db_notes_touch BEFORE UPDATE ON public.analysis_db_notes
  FOR EACH ROW EXECUTE FUNCTION public.analysis_touch_updated_at();

ALTER TABLE public.analysis_db_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_db_tables        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_db_columns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_db_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_db_notes         ENABLE ROW LEVEL SECURITY;

-- Catálogo (fontes/tabelas/colunas/relacionamentos): todo leitor lê, só quem
-- publica escreve.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['analysis_db_sources', 'analysis_db_tables',
                           'analysis_db_columns', 'analysis_db_relationships']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s leitura" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s leitura" ON public.%1$I FOR SELECT TO authenticated
         USING ((SELECT public.can_view_geovani_analyses()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s escrita" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s escrita" ON public.%1$I FOR ALL TO authenticated
         USING ((SELECT public.can_publish_geovani_analyses()))
         WITH CHECK ((SELECT public.can_publish_geovani_analyses()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Anotações: Webert/Maialle também anotam (são eles que conhecem o banco).
-- Cada um edita/apaga a própria; quem publica modera todas.
DROP POLICY IF EXISTS "analysis_db_notes leitura" ON public.analysis_db_notes;
CREATE POLICY "analysis_db_notes leitura" ON public.analysis_db_notes
  FOR SELECT TO authenticated
  USING ((SELECT public.can_view_geovani_analyses()));

DROP POLICY IF EXISTS "analysis_db_notes insert" ON public.analysis_db_notes;
CREATE POLICY "analysis_db_notes insert" ON public.analysis_db_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.can_view_geovani_analyses())
    AND author_id = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "analysis_db_notes update" ON public.analysis_db_notes;
CREATE POLICY "analysis_db_notes update" ON public.analysis_db_notes
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.can_view_geovani_analyses())
    AND (author_id = (SELECT auth.uid())::text OR (SELECT public.can_publish_geovani_analyses()))
  )
  WITH CHECK (
    (SELECT public.can_view_geovani_analyses())
    AND (author_id = (SELECT auth.uid())::text OR (SELECT public.can_publish_geovani_analyses()))
  );

DROP POLICY IF EXISTS "analysis_db_notes delete" ON public.analysis_db_notes;
CREATE POLICY "analysis_db_notes delete" ON public.analysis_db_notes
  FOR DELETE TO authenticated
  USING (
    (SELECT public.can_view_geovani_analyses())
    AND (author_id = (SELECT auth.uid())::text OR (SELECT public.can_publish_geovani_analyses()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_db_notes TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3) Dúvidas + respostas
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.analysis_questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL CHECK (length(btrim(title)) > 0),
  body             text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'aberta'
                   CHECK (status IN ('aberta', 'respondida', 'fechada')),
  author_id        text NOT NULL DEFAULT (auth.uid())::text
                   REFERENCES public.profiles(id) ON DELETE RESTRICT,
  -- Contexto opcional: a dúvida pode ser sobre uma tabela do mapeamento ou
  -- sobre um relatório. SET NULL para a dúvida sobreviver à limpeza do catálogo.
  db_table_id      uuid REFERENCES public.analysis_db_tables(id) ON DELETE SET NULL,
  report_id        uuid REFERENCES public.analysis_reports(id) ON DELETE SET NULL,
  answered_at      timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.analysis_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES public.analysis_questions(id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (length(btrim(body)) > 0),
  author_id    text NOT NULL DEFAULT (auth.uid())::text
               REFERENCES public.profiles(id) ON DELETE RESTRICT,
  edited_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Aba Dúvidas: "abertas primeiro, mais mexidas no topo".
CREATE INDEX IF NOT EXISTS idx_analysis_questions_status_activity
  ON public.analysis_questions (status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_questions_db_table
  ON public.analysis_questions (db_table_id) WHERE db_table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_questions_report
  ON public.analysis_questions (report_id) WHERE report_id IS NOT NULL;
-- Thread da dúvida em ordem cronológica.
CREATE INDEX IF NOT EXISTS idx_analysis_answers_question_created
  ON public.analysis_answers (question_id, created_at);

DROP TRIGGER IF EXISTS trg_analysis_questions_touch ON public.analysis_questions;
CREATE TRIGGER trg_analysis_questions_touch BEFORE UPDATE ON public.analysis_questions
  FOR EACH ROW EXECUTE FUNCTION public.analysis_touch_updated_at();

-- Resposta nova mexe na dúvida. Quem responde (Webert/Maialle) NÃO tem UPDATE
-- na dúvida do Geovani, por isso o trigger é SECURITY DEFINER e mexe só nestas
-- três colunas. Resposta do próprio autor (réplica) não marca como respondida.
CREATE OR REPLACE FUNCTION public.analysis_answers_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.analysis_questions q
     SET last_activity_at = NEW.created_at,
         status = CASE
                    WHEN q.status = 'aberta' AND q.author_id <> NEW.author_id THEN 'respondida'
                    ELSE q.status
                  END,
         answered_at = CASE
                         WHEN q.answered_at IS NULL AND q.author_id <> NEW.author_id THEN NEW.created_at
                         ELSE q.answered_at
                       END
   WHERE q.id = NEW.question_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.analysis_answers_after_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_analysis_answers_after_insert ON public.analysis_answers;
CREATE TRIGGER trg_analysis_answers_after_insert
  AFTER INSERT ON public.analysis_answers
  FOR EACH ROW EXECUTE FUNCTION public.analysis_answers_after_insert();

ALTER TABLE public.analysis_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_answers   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analysis_questions leitura" ON public.analysis_questions;
CREATE POLICY "analysis_questions leitura" ON public.analysis_questions
  FOR SELECT TO authenticated
  USING ((SELECT public.can_view_geovani_analyses()));

DROP POLICY IF EXISTS "analysis_questions insert" ON public.analysis_questions;
CREATE POLICY "analysis_questions insert" ON public.analysis_questions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.can_view_geovani_analyses())
    AND author_id = (SELECT auth.uid())::text
  );

-- Autor edita a própria (inclusive reabrir/fechar); quem publica modera todas.
DROP POLICY IF EXISTS "analysis_questions update" ON public.analysis_questions;
CREATE POLICY "analysis_questions update" ON public.analysis_questions
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.can_view_geovani_analyses())
    AND (author_id = (SELECT auth.uid())::text OR (SELECT public.can_publish_geovani_analyses()))
  )
  WITH CHECK (
    (SELECT public.can_view_geovani_analyses())
    AND (author_id = (SELECT auth.uid())::text OR (SELECT public.can_publish_geovani_analyses()))
  );

DROP POLICY IF EXISTS "analysis_questions delete" ON public.analysis_questions;
CREATE POLICY "analysis_questions delete" ON public.analysis_questions
  FOR DELETE TO authenticated
  USING ((SELECT public.can_publish_geovani_analyses()));

DROP POLICY IF EXISTS "analysis_answers leitura" ON public.analysis_answers;
CREATE POLICY "analysis_answers leitura" ON public.analysis_answers
  FOR SELECT TO authenticated
  USING ((SELECT public.can_view_geovani_analyses()));

DROP POLICY IF EXISTS "analysis_answers insert" ON public.analysis_answers;
CREATE POLICY "analysis_answers insert" ON public.analysis_answers
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.can_view_geovani_analyses())
    AND author_id = (SELECT auth.uid())::text
  );

-- Resposta: só o autor edita/apaga (histórico da conversa é de quem escreveu).
DROP POLICY IF EXISTS "analysis_answers update" ON public.analysis_answers;
CREATE POLICY "analysis_answers update" ON public.analysis_answers
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.can_view_geovani_analyses())
    AND author_id = (SELECT auth.uid())::text
  )
  WITH CHECK (
    (SELECT public.can_view_geovani_analyses())
    AND author_id = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "analysis_answers delete" ON public.analysis_answers;
CREATE POLICY "analysis_answers delete" ON public.analysis_answers
  FOR DELETE TO authenticated
  USING (
    (SELECT public.can_view_geovani_analyses())
    AND (author_id = (SELECT auth.uid())::text OR (SELECT public.can_publish_geovani_analyses()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_answers   TO authenticated;
```

---

## 3. Por que cada escolha

**Relatório × versão.** O card que o Webert/Maialle abrem (título, resumo,
status) não muda a cada reupload. A versão é imutável (sem policy de UPDATE e
sem upsert no Storage), então dá para ver "o que mudou da v2 para a v3" e
nenhum link antigo quebra. `current_version_id` com FK composta
`(current_version_id, id)` impede apontar para versão de outro relatório.

**Arquivo no Storage, não no banco.** Notebook com saída de gráfico chega fácil
a 5–15 MB (PNG em base64). Guardar isso em `jsonb` incharia a tabela e cada
`select *` da lista. No banco ficam só os metadados extraídos (`cell_count`,
`queried_tables`, `kernel_name`), e o front baixa o `.ipynb` por URL assinada
só quando o relatório é aberto. O teto de 20 MB está no bucket e também no
CHECK (`size_bytes`).

**Caminho determinístico** (`<report_id>/v<n>.ipynb`, conferido por CHECK). Assim
a policy de leitura do Storage consegue achar a versão pelo `name` do objeto e
liberar o arquivo só se o relatório estiver **publicado**. Rascunho não vaza
nem por URL assinada.

**`queried_tables text[]` + GIN.** Liga as abas: na tela de uma tabela do
mapeamento, mostra "relatórios que leem esta tabela" (`queried_tables @> '{vendas.orders}'`).
O front extrai os nomes das células no upload. É melhor que uma tabela de junção
porque a lista é derivada do arquivo, imutável junto com a versão.

**Mapeamento como catálogo, sem réplica e sem credencial.** O banco de vendas
(`homosistemaxmx`, MySQL externo, usuário só-leitura em 5 tabelas) continua
sendo lido só pelos notebooks. Aqui fica a descrição. `data_type` é `text` cru
porque os tipos do MySQL (`enum(...)`, `decimal(10,2)`, `tinyint(1)`) não
cabem num enum do Postgres. As chaves naturais `UNIQUE (source_id, schema_name, table_name)`
e `UNIQUE (table_id, column_name)` existem para um script de introspecção
(`information_schema` do MySQL, rodado num notebook) poder fazer
`INSERT … ON CONFLICT DO UPDATE` sem duplicar e sem apagar descrição escrita à
mão. `last_seen_at` mostra o que sumiu do banco de origem. `has_read_access`
separa as tabelas que o usuário só-leitura enxerga das que só existem no
dicionário. `is_pii` + "exemplo inventado" evitam que dado de cliente venha
parar no catálogo.

**Relacionamentos com `confidence`.** O banco de vendas não declara FK em quase
nada. Marcar `inferido` × `confirmado` × `fk_declarada` impede que uma suposição
vire verdade na tela.

**Dúvidas: status por trigger.** Quem responde não pode editar a dúvida dos
outros (RLS), mas a dúvida precisa virar "respondida". O trigger
`SECURITY DEFINER` mexe só em `status`, `answered_at` e `last_activity_at`. Uma
resposta do próprio autor da dúvida, que é uma réplica, não fecha nada.
"Respondida → fechada" é decisão do autor, feita com UPDATE dele mesmo.

**Policies.** Todas usam `TO authenticated` e helper dentro de `(SELECT …)`
(InitPlan). As tabelas são minúsculas (dezenas a poucas centenas de linhas),
então o custo real está em não repetir a leitura de `profiles` por linha, e
o InitPlan resolve isso. Em `analysis_report_versions` e `storage.objects`, o
`EXISTS` correlacionado usa os índices `UNIQUE (storage_path)` e a PK de
`analysis_reports`.

**Sem RPC.** É CRUD simples de poucos usuários, e o repo já faz assim na Base de
Suporte e no Caderno. RPC só se surgir agregação para dashboard.

### Riscos para o front levar em conta

- **XSS no render do notebook.** Saídas `text/html` e
  `application/javascript` de um `.ipynb` são código. O renderer **não pode**
  injetar HTML cru nem executar JS: deve renderizar `image/png`, `text/plain`,
  `text/markdown` (sanitizado) e tabelas de `text/html` passando por um
  sanitizador (ex. DOMPurify), ou dentro de um `<iframe sandbox>` sem
  `allow-scripts`. Plotly/Bokeh interativos ficam como imagem ou como aviso
  de "saída não suportada".
- **Notebook com credencial.** Notebook de análise costuma ter string de conexão
  do MySQL numa célula. O upload deveria procurar padrões (`mysql://`,
  `password=`, `PASS`) e bloquear ou avisar antes de subir.
- **Dado pessoal nas saídas.** Um `df.head()` de `orders` mostra e-mail de
  cliente. Isso vale para os 3 leitores, e o mesmo cuidado da exportação
  restrita (PR #155) se aplica a eles.

---

## 4. Ordem de deploy

Produção é o projeto **cggigwessiododyjbegp** (o `.env`/CLI local ainda aponta
para o antigo). SQL roda pela Management API, nunca com `supabase db push`.

**Fase 1 (agora)**

1. Aplicar `20261019120000_analises_geovani_acesso.sql` no banco de produção e
   conferir se saiu algum `WARNING` (policy de UPDATE em profiles).
2. Rodar `docs/analises-geovani/LIBERAR-ACESSO.sql`: primeiro os SELECTs de
   conferência e, depois, os UPDATEs.
3. Só então mergear o front que lê `profiles.can_view_geovani_analyses`.
   Se o front for antes, o `select` com a coluna inexistente dá erro 400 no
   layout e derruba o login de todo mundo (foi o que aconteceu no risco
   anotado em `can_access_analytics`).

**Fase 2 (tabelas)**

1. Migration nova com o SQL da seção 2.2 (já com `can_publish_geovani_analyses`).
2. `UPDATE profiles SET can_publish_geovani_analyses = true` no Geovani.
3. Regenerar `src/integrations/supabase/types.ts`.
4. Front das abas.
5. Seed do mapeamento: inserir a fonte `homosistemaxmx` e rodar a introspecção.

Rollback da fase 1: `ALTER TABLE profiles DROP COLUMN can_view_geovani_analyses`
e `DROP FUNCTION public.can_view_geovani_analyses()`, **depois** de tirar do ar o
front que lê a coluna.
