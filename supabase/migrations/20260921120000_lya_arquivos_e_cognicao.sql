-- ============================================================================
-- 20260921120000_lya_arquivos_e_cognicao.sql
-- Lya — arquivos ingeridos pela gestora e a cognição deles no cérebro.
--
-- Continuação direta de 20260907120000_lya_agente_ia.sql. Até aqui a Lya só
-- alcançava o que já estava no banco (tabelas do suporte) e o que a gestora
-- tinha ensinado à mão (lya_memories). Falta a terceira fonte: planilha e
-- documento que chegam de fora (relatório da plataforma, lista de pedidos,
-- procedimento em markdown).
--
-- A decisão que molda tudo aqui: a linha do CSV vira `lya_file_rows(data jsonb)`
-- e não um anexo opaco. Guardar como texto faria a Lya "ler" o arquivo dentro do
-- prompt — caro, truncado e sem conta confiável. Como linha consultável, ela
-- CRUZA o arquivo com services/refunds/held_orders pelo mesmo sandbox de SELECT
-- que já usa, e o Postgres é quem calcula.
--
-- Três peças:
--   1) lya_files / lya_file_rows — o acervo (permanente, gerido pela gestora);
--   2) lya_memories ganha `origem` e `file_id` — o arquivo vira NÓ do cérebro,
--      com a interpretação que a Lya escreveu sobre ele;
--   3) lya_sistema_nos() — catálogo escrito à mão do que a Lya alcança de
--      verdade (tabelas, telas, Base de Suporte, arquivos), com número vivo.
--
-- Quem sobe arquivo: só is_manager(). Quem lê e consulta: quem vê a área de
-- analytics (can_view_support_analytics() = gestora + time de copy).
--
-- Convenções do repo respeitadas: profiles.id é TEXT (compara com
-- auth.uid()::text); RPC SECURITY DEFINER com guard explícito no corpo;
-- migration idempotente (pode rodar mais de uma vez).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Acervo — lya_files e lya_file_rows
-- ─────────────────────────────────────────────────────────────────────────────
-- O parse acontece no NAVEGADOR (a gestora escolhe o arquivo, o cliente lê,
-- normaliza e manda em lotes). Por isso `colunas` e `total_linhas` chegam
-- prontos: o banco guarda o perfil, não o recalcula.
--   nome         nome amigável, editável depois pela gestora
--   arquivo      nome original do que ela escolheu no disco (rastreabilidade)
--   tipo         csv (inclui planilha convertida) | markdown
--   status       processando -> pronto | erro (a tela mostra o andamento)
--   colunas      [{nome, tipo, preenchidas, distintos, exemplos[]}] — perfil
--   conteudo     markdown: o corpo inteiro. csv: vazio (as linhas vão na outra
--                tabela; deixar o CSV cru aqui dobraria o armazenamento)
--   resumo/tags  interpretação escrita pela Lya na ingestão — é o que alimenta
--                o recall e o que a gestora lê na tela de acervo
CREATE TABLE IF NOT EXISTS public.lya_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  arquivo       text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('csv', 'markdown')),
  status        text NOT NULL DEFAULT 'processando'
                CHECK (status IN ('processando', 'pronto', 'erro')),
  colunas       jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_linhas  integer NOT NULL DEFAULT 0,
  conteudo      text NOT NULL DEFAULT '',
  resumo        text NOT NULL DEFAULT '',
  tags          jsonb NOT NULL DEFAULT '[]'::jsonb,
  erro          text,
  bytes         integer NOT NULL DEFAULT 0,
  uploaded_by   text REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lya_files_colunas_chk CHECK (jsonb_typeof(colunas) = 'array'),
  CONSTRAINT lya_files_tags_chk CHECK (jsonb_typeof(tags) = 'array')
);

COMMENT ON TABLE public.lya_files IS
  'Acervo da Lya: planilhas e documentos que a gestora ingere. Uma linha por arquivo, com o perfil das colunas e a interpretação (resumo/tags) escrita pela Lya. As linhas do CSV ficam em lya_file_rows.';

-- Uma linha do arquivo por registro, com as células num jsonb de chaves em
-- snake_case (o cliente normaliza o cabeçalho). `linha` é 1-based e preserva a
-- ordem original — a Lya cita "arquivo X, linha N" e a gestora acha no Excel.
CREATE TABLE IF NOT EXISTS public.lya_file_rows (
  file_id  uuid NOT NULL REFERENCES public.lya_files(id) ON DELETE CASCADE,
  linha    integer NOT NULL,
  data     jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (file_id, linha)
);

COMMENT ON TABLE public.lya_file_rows IS
  'Linhas dos arquivos da Lya como jsonb consultável (data->>''coluna''). É o que permite CRUZAR um arquivo com services/refunds/held_orders por SQL, em vez de despejar o arquivo no prompt.';

-- jsonb_path_ops em vez do GIN padrão: metade do tamanho e mais rápido para o
-- que a Lya faz de fato (contains / @>), ao custo de não indexar "existe a
-- chave X" — que ninguém pergunta.
CREATE INDEX IF NOT EXISTS idx_lya_file_rows_data
  ON public.lya_file_rows USING GIN (data jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_lya_files_status ON public.lya_files (status);
CREATE INDEX IF NOT EXISTS idx_lya_files_criado ON public.lya_files (created_at DESC);

DROP TRIGGER IF EXISTS trg_lya_files_touch ON public.lya_files;
CREATE TRIGGER trg_lya_files_touch
  BEFORE UPDATE ON public.lya_files
  FOR EACH ROW EXECUTE FUNCTION public.lya_touch();

ALTER TABLE public.lya_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lya_file_rows ENABLE ROW LEVEL SECURITY;

-- Leitura direta: quem vê a área de analytics. Escrita: só pelas RPCs abaixo
-- (SECURITY DEFINER com is_manager()); não há policy de INSERT/UPDATE/DELETE,
-- mesmo padrão de lya_memories.
DROP POLICY IF EXISTS "lya_files_read_analytics" ON public.lya_files;
CREATE POLICY "lya_files_read_analytics"
  ON public.lya_files FOR SELECT
  TO authenticated
  USING (public.can_view_support_analytics());

DROP POLICY IF EXISTS "lya_file_rows_read_analytics" ON public.lya_file_rows;
CREATE POLICY "lya_file_rows_read_analytics"
  ON public.lya_file_rows FOR SELECT
  TO authenticated
  USING (public.can_view_support_analytics());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Cognição — o arquivo vira nó do cérebro
-- ─────────────────────────────────────────────────────────────────────────────
-- Uma memória de origem 'arquivo' é a interpretação da Lya sobre um arquivo
-- (o que ele é, o que cada coluna significa no vocabulário do XMX, como cruzar
-- com o banco). Ela entra no recall como qualquer outra memória — é assim que
-- a Lya "lembra" que aquele arquivo existe quando a pergunta encosta no tema.
-- ON DELETE CASCADE: apagar o arquivo apaga o nó, senão o cérebro passaria a
-- citar um arquivo que não existe mais.
ALTER TABLE public.lya_memories
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'treino';

ALTER TABLE public.lya_memories
  ADD COLUMN IF NOT EXISTS file_id uuid REFERENCES public.lya_files(id) ON DELETE CASCADE;

-- ADD COLUMN IF NOT EXISTS não cobre o CHECK: numa segunda execução a coluna
-- já existe e o ADD CONSTRAINT estouraria com duplicate_object.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lya_memories'::regclass
      AND conname = 'lya_memories_origem_chk'
  ) THEN
    ALTER TABLE public.lya_memories
      ADD CONSTRAINT lya_memories_origem_chk
      CHECK (origem IN ('treino', 'arquivo', 'sistema'));
  END IF;
END $$;

-- O CASCADE do FK varre lya_memories a cada arquivo apagado; sem índice isso é
-- seq scan no cérebro inteiro.
CREATE INDEX IF NOT EXISTS idx_lya_memories_file ON public.lya_memories (file_id)
  WHERE file_id IS NOT NULL;

-- lya_upsert_memory ganha p_origem e p_file_id NO FIM. Acrescentar parâmetros
-- com DEFAULT cria uma função NOVA e deixa a antiga viva: duas sobrecargas com
-- os mesmos nomes de argumento deixam a chamada por argumento nomeado da Edge
-- Function ambígua (PGRST203). Por isso o DROP explícito da assinatura antiga
-- antes do CREATE — e os GRANTs precisam ser re-emitidos, porque o DROP leva
-- junto os da função que deixou de existir.
DROP FUNCTION IF EXISTS public.lya_upsert_memory(text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.lya_upsert_memory(
  p_name        text,
  p_description text,
  p_type        text DEFAULT 'nota',
  p_tags        jsonb DEFAULT '[]'::jsonb,
  p_body        text DEFAULT '',
  p_origem      text DEFAULT 'treino',
  p_file_id     uuid DEFAULT NULL
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
  IF p_origem IS NULL OR p_origem NOT IN ('treino', 'arquivo', 'sistema') THEN
    p_origem := 'treino';
  END IF;

  INSERT INTO public.lya_memories (name, description, type, tags, body, author_id, origem, file_id)
  VALUES (v_name, btrim(coalesce(p_description, '')), p_type, p_tags, coalesce(p_body, ''), auth.uid()::text, p_origem, p_file_id)
  ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        type        = EXCLUDED.type,
        tags        = EXCLUDED.tags,
        body        = EXCLUDED.body,
        author_id   = EXCLUDED.author_id,
        origem      = EXCLUDED.origem,
        file_id     = EXCLUDED.file_id,
        updated_at  = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.lya_upsert_memory(text, text, text, jsonb, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lya_upsert_memory(text, text, text, jsonb, text, text, uuid) TO authenticated, service_role;

-- Recall: mesma função de 20260907120000, com UMA diferença — cada item de
-- `conhecimento` passa a trazer `origem`, para a Lya saber se aquilo veio de
-- treino ou de um arquivo ingerido (e citar a fonte certa). O resto do formato
-- fica idêntico: a Edge Function depende dele chave por chave.
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
    SELECT id, name, description, type, tags, body, author_id, seed, origem, created_at, updated_at, rank, 0 AS ordem FROM ranked
    UNION ALL
    SELECT id, name, description, type, tags, body, author_id, seed, origem, created_at, updated_at, rank, 1 AS ordem FROM linked
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', t.id, 'name', t.name, 'description', t.description, 'type', t.type,
             'tags', t.tags, 'body', t.body, 'origem', t.origem, 'updated_at', t.updated_at
           ) ORDER BY t.ordem, t.rank DESC, t.name
         ), '[]'::jsonb)
    INTO v_conh
  FROM todas t;

  RETURN jsonb_build_object('comportamento', v_comp, 'conhecimento', coalesce(v_conh, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.lya_recall_memories(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lya_recall_memories(text, integer) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Ingestão — criar, encher e finalizar um arquivo
-- ─────────────────────────────────────────────────────────────────────────────
-- Três passos porque o envio é em lotes: o cliente cria a linha (status
-- 'processando'), manda as linhas de 500 em 500 mostrando progresso, e só então
-- fecha o arquivo com o perfil e a interpretação. Se o navegador cair no meio,
-- o arquivo fica visível como 'processando' em vez de sumir.

CREATE OR REPLACE FUNCTION public.lya_criar_arquivo(
  p_nome     text,
  p_arquivo  text,
  p_tipo     text,
  p_bytes    integer DEFAULT 0,
  p_conteudo text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id   uuid;
  v_nome text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_tipo IS NULL OR p_tipo NOT IN ('csv', 'markdown') THEN
    RAISE EXCEPTION 'Tipo de arquivo invalido: use csv ou markdown.' USING ERRCODE = '22023';
  END IF;
  IF p_arquivo IS NULL OR btrim(p_arquivo) = '' THEN
    RAISE EXCEPTION 'Informe o nome do arquivo enviado.' USING ERRCODE = '22023';
  END IF;

  -- Nome amigável em branco cai para o nome do arquivo: a tela nunca mostra
  -- uma linha sem título, e a gestora renomeia depois se quiser.
  v_nome := coalesce(nullif(btrim(p_nome), ''), btrim(p_arquivo));

  INSERT INTO public.lya_files (nome, arquivo, tipo, bytes, conteudo, uploaded_by)
  VALUES (v_nome, btrim(p_arquivo), p_tipo, GREATEST(coalesce(p_bytes, 0), 0), coalesce(p_conteudo, ''), auth.uid()::text)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- `linha` = p_offset + ordinality: o cliente manda o lote e o deslocamento, e a
-- numeração continua a do arquivo original.
-- ON CONFLICT DO UPDATE porque um lote pode ser reenviado depois de um timeout
-- de rede — reenviar tem que ser inofensivo, não estourar a chave primária.
CREATE OR REPLACE FUNCTION public.lya_inserir_linhas(
  p_file_id uuid,
  p_linhas  jsonb,
  p_offset  integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dono  text;
  v_count integer;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT f.uploaded_by INTO v_dono FROM public.lya_files f WHERE f.id = p_file_id;
  IF v_dono IS NULL OR v_dono <> auth.uid()::text THEN
    RAISE EXCEPTION 'Arquivo nao encontrado para este usuario.' USING ERRCODE = '42501';
  END IF;

  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.lya_file_rows (file_id, linha, data)
  SELECT
    p_file_id,
    GREATEST(coalesce(p_offset, 0), 0) + e.ord::integer,
    CASE WHEN jsonb_typeof(e.item) = 'object' THEN e.item ELSE jsonb_build_object('valor', e.item) END
  FROM jsonb_array_elements(p_linhas) WITH ORDINALITY AS e(item, ord)
  ON CONFLICT (file_id, linha) DO UPDATE SET data = EXCLUDED.data;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Fecha o arquivo: perfil das colunas, interpretação da Lya e status final.
-- p_erro preenchido => status 'erro' (a tela mostra o motivo e o arquivo
-- continua listado, em vez de sumir sem explicação).
CREATE OR REPLACE FUNCTION public.lya_finalizar_arquivo(
  p_file_id uuid,
  p_colunas jsonb   DEFAULT '[]'::jsonb,
  p_total   integer DEFAULT 0,
  p_resumo  text    DEFAULT '',
  p_tags    jsonb   DEFAULT '[]'::jsonb,
  p_erro    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row   public.lya_files;
  v_erro  text := nullif(btrim(coalesce(p_erro, '')), '');
  v_total integer;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_colunas IS NULL OR jsonb_typeof(p_colunas) <> 'array' THEN
    p_colunas := '[]'::jsonb;
  END IF;
  IF p_tags IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
    p_tags := '[]'::jsonb;
  END IF;

  -- Total ausente (caminho de fallback da Edge Function) é contado aqui pela
  -- chave primária: um arquivo com linhas no banco e total_linhas = 0 faria a
  -- tela e o grafo mentirem.
  v_total := coalesce(nullif(GREATEST(coalesce(p_total, 0), 0), 0),
                      (SELECT count(*)::integer FROM public.lya_file_rows r WHERE r.file_id = p_file_id));

  UPDATE public.lya_files f
     SET colunas      = p_colunas,
         total_linhas = v_total,
         resumo       = coalesce(nullif(btrim(coalesce(p_resumo, '')), ''), f.resumo),
         tags         = p_tags,
         erro         = v_erro,
         status       = CASE WHEN v_erro IS NULL THEN 'pronto' ELSE 'erro' END
   WHERE f.id = p_file_id
  RETURNING f.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Arquivo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Leitura e gestão do acervo
-- ─────────────────────────────────────────────────────────────────────────────

-- Lista para a tela de acervo e para a tool "listar_arquivos". Sem `conteudo`:
-- um markdown grande multiplicado por N arquivos torraria a listagem inteira.
CREATE OR REPLACE FUNCTION public.lya_list_files()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', f.id,
             'nome', f.nome,
             'arquivo', f.arquivo,
             'tipo', f.tipo,
             'status', f.status,
             'colunas', f.colunas,
             'total_linhas', f.total_linhas,
             'resumo', f.resumo,
             'tags', f.tags,
             'erro', f.erro,
             'bytes', f.bytes,
             'uploaded_by', f.uploaded_by,
             'uploaded_by_nome', p.full_name,
             'created_at', f.created_at,
             'updated_at', f.updated_at
           ) ORDER BY f.created_at DESC
         ), '[]'::jsonb)
    INTO v_out
  FROM public.lya_files f
  LEFT JOIN public.profiles p ON p.id = f.uploaded_by;

  RETURN v_out;
END;
$$;

-- Um arquivo com o conteúdo e uma AMOSTRA das primeiras linhas. Amostra, não o
-- arquivo inteiro: quem precisa de todas as linhas usa SQL (consultar_banco),
-- que agrega no banco em vez de trazer 50 mil objetos para o prompt.
CREATE OR REPLACE FUNCTION public.lya_get_file(p_file_id uuid, p_amostra integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row  public.lya_files;
  v_n    integer := LEAST(GREATEST(coalesce(p_amostra, 20), 1), 200);
  v_amos jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT f.* INTO v_row FROM public.lya_files f WHERE f.id = p_file_id;
  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('linha', r.linha, 'data', r.data) ORDER BY r.linha), '[]'::jsonb)
    INTO v_amos
  FROM (
    SELECT x.linha, x.data
    FROM public.lya_file_rows x
    WHERE x.file_id = p_file_id
    ORDER BY x.linha
    LIMIT v_n
  ) r;

  RETURN to_jsonb(v_row) || jsonb_build_object('amostra', v_amos);
END;
$$;

-- Renomear / reescrever resumo / retaguear. NULL = não mexe no campo (a tela
-- manda só o que mudou; um '' explícito apaga o resumo de propósito).
CREATE OR REPLACE FUNCTION public.lya_atualizar_arquivo(
  p_file_id uuid,
  p_nome    text  DEFAULT NULL,
  p_resumo  text  DEFAULT NULL,
  p_tags    jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.lya_files;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_tags IS NOT NULL AND jsonb_typeof(p_tags) <> 'array' THEN
    RAISE EXCEPTION 'As tags precisam ser uma lista.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.lya_files f
     SET nome   = coalesce(nullif(btrim(coalesce(p_nome, '')), ''), f.nome),
         resumo = coalesce(p_resumo, f.resumo),
         tags   = coalesce(p_tags, f.tags)
   WHERE f.id = p_file_id
  RETURNING f.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Arquivo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- Apagar o arquivo leva junto, por CASCADE, as linhas (lya_file_rows) e o nó de
-- cognição no cérebro (lya_memories.file_id).
CREATE OR REPLACE FUNCTION public.lya_delete_file(p_file_id uuid)
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

  DELETE FROM public.lya_files WHERE id = p_file_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) lya_sistema_nos() — o alcance real da Lya, com número vivo
-- ─────────────────────────────────────────────────────────────────────────────
-- Camada de SISTEMA do grafo do Cérebro: o que a Lya consegue consultar HOJE.
-- É catálogo escrito à mão de propósito — introspectar o schema listaria
-- tabela de migração, fila e lixo histórico, e o desenho viraria um mapa do
-- banco em vez de um mapa do que ela alcança. Quando uma tabela ou tela entrar
-- no alcance dela (tool nova em tools.ts, tabela nova no CATALOGO_SQL e no
-- GRANT do sandbox), acrescente o nó aqui na mesma migration.
--   camada 'tabela' — dado bruto que ela lê pelo sandbox (consultar_banco)
--   camada 'tela'   — RPC de painel (o número que a gestora vê na tela)
--   camada 'base'   — Base de Suporte (conteúdo editorial)
--   liga            — vizinhos no grafo; o agente do cérebro desenha as arestas
-- `total` é count(*) ao vivo onde o número significa alguma coisa, e null nas
-- telas (RPC não tem "quantidade"). Um SELECT só, com subconsultas escalares.
CREATE OR REPLACE FUNCTION public.lya_sistema_nos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.can_view_support_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'gerado_em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'nos', coalesce(jsonb_agg(
             jsonb_build_object(
               'id', n.id,
               'label', n.label,
               'camada', n.camada,
               'detalhe', n.detalhe,
               'total', n.total,
               'liga', n.liga
             )
             ORDER BY CASE n.camada WHEN 'tabela' THEN 0 WHEN 'tela' THEN 1 ELSE 2 END, n.id
           ), '[]'::jsonb)
         )
    INTO v_out
  FROM (
    VALUES
      -- ── Dado bruto (sandbox de SELECT) ──────────────────────────────────
      ('tabela:services', 'Atendimentos', 'tabela',
       'services — um ticket por linha: agente, cliente, produto, plataforma, canal, motivo, service_date',
       (SELECT count(*) FROM public.services),
       '["tabela:service_follow_ups","tabela:refunds","tela:atendimentos","tela:auditoria"]'::jsonb),

      ('tabela:service_follow_ups', 'Interações', 'tabela',
       'service_follow_ups — cada retorno registrado num ticket (é daqui que sai o status vivo)',
       (SELECT count(*) FROM public.service_follow_ups),
       '["tabela:services","tela:interacoes","tela:repeticoes"]'::jsonb),

      ('tabela:service_date_corrections', 'Correções de data', 'tabela',
       'service_date_corrections — quando a gestora corrige a data de um atendimento',
       (SELECT count(*) FROM public.service_date_corrections),
       '["tabela:services"]'::jsonb),

      ('tabela:agent_daily_service_counts', 'Contagem diária por agente', 'tabela',
       'agent_daily_service_counts — cache de tickets distintos por agente e dia (a barra de meta lê daqui)',
       (SELECT count(*) FROM public.agent_daily_service_counts),
       '["tabela:services","tabela:goals"]'::jsonb),

      ('tabela:refunds', 'Reembolsos', 'tabela',
       'refunds — pedido de reembolso: valor, tipo (integral/parcial), datas de solicitação e conclusão',
       (SELECT count(*) FROM public.refunds),
       '["tabela:refund_reason_classifications","tabela:services","tela:reembolsos","tela:alertas_reembolso"]'::jsonb),

      ('tabela:refund_reason_classifications', 'Motivos de reembolso', 'tabela',
       'refund_reason_classifications — uma linha por reembolso com a categoria do motivo',
       (SELECT count(*) FROM public.refund_reason_classifications),
       '["tabela:refunds","tela:reembolsos_motivo"]'::jsonb),

      ('tabela:held_orders', 'Pedidos em espera', 'tabela',
       'held_orders — pedidos importados por CSV que o time precisa confirmar',
       (SELECT count(*) FROM public.held_orders),
       '["tabela:held_order_events","tela:pedidos_espera"]'::jsonb),

      ('tabela:held_order_events', 'Andamento dos pedidos em espera', 'tabela',
       'held_order_events — trilha do que o agente fez em cada pedido em espera',
       (SELECT count(*) FROM public.held_order_events),
       '["tabela:held_orders"]'::jsonb),

      ('tabela:ticket_transfers', 'Transferências de ticket', 'tabela',
       'ticket_transfers — pedidos de repasse de atendimento entre agentes',
       (SELECT count(*) FROM public.ticket_transfers),
       '["tabela:services","tabela:lya_agentes"]'::jsonb),

      ('tabela:ticket_takeover_requests', 'Tomadas de ticket', 'tabela',
       'ticket_takeover_requests — pedidos de assumir o ticket de quem está de folga',
       (SELECT count(*) FROM public.ticket_takeover_requests),
       '["tabela:services","tabela:lya_agentes"]'::jsonb),

      ('tabela:products', 'Catálogo de produtos', 'tabela',
       'products — produtos que o agente pode escolher no formulário',
       (SELECT count(*) FROM public.products),
       '["tabela:services"]'::jsonb),

      ('tabela:goals', 'Metas mensais', 'tabela',
       'goals — meta de atendimentos por mês',
       (SELECT count(*) FROM public.goals),
       '["tabela:agent_daily_service_counts","tela:atendimentos"]'::jsonb),

      ('tabela:lya_agentes', 'Time de suporte', 'tabela',
       'lya_agentes — visão de profiles sem PII de login: nome, papel, canal, ativo, disponível',
       (SELECT count(*) FROM public.lya_agentes),
       '["tela:usuarios","tabela:services"]'::jsonb),

      -- O nó dos arquivos fica na camada 'tabela' porque é dado consultável por
      -- SQL como qualquer outro; o que muda é a origem (veio de fora).
      ('arquivo', 'Arquivos da Lya', 'tabela',
       'lya_files — planilhas e documentos ingeridos pela gestora (linhas em lya_file_rows, uma coluna por chave do jsonb)',
       (SELECT count(*) FROM public.lya_files),
       '[]'::jsonb),

      -- ── Telas do painel (RPC) ───────────────────────────────────────────
      ('tela:atendimentos', 'Tela Atendimentos', 'tela',
       'dashboard_metrics — cards e série de atendimentos do período',
       NULL::bigint, '["tabela:services"]'::jsonb),

      ('tela:status_tickets', 'Status dos tickets', 'tela',
       'dashboard_status_summary — novo / em andamento / concluído',
       NULL::bigint, '["tabela:services","tabela:service_follow_ups"]'::jsonb),

      ('tela:canais', 'Eficiência por canal', 'tela',
       'dashboard_channel_detail — volume e resolução por canal de contato',
       NULL::bigint, '["tabela:services"]'::jsonb),

      ('tela:interacoes', 'Interações', 'tela',
       'dashboard_follow_up_detail — interações por agente e por dia',
       NULL::bigint, '["tabela:service_follow_ups"]'::jsonb),

      ('tela:repeticoes', 'Repetições no mesmo dia', 'tela',
       'dashboard_same_day_repeats — cliente que voltou no mesmo dia',
       NULL::bigint, '["tabela:service_follow_ups"]'::jsonb),

      ('tela:padrao_horarios', 'Padrão de horários', 'tela',
       'dashboard_hourly_pattern — distribuição por hora do dia',
       NULL::bigint, '["tabela:services"]'::jsonb),

      ('tela:reembolsos', 'Tela Reembolsos', 'tela',
       'dashboard_refund_metrics — cards, valores e prazos de reembolso',
       NULL::bigint, '["tabela:refunds"]'::jsonb),

      ('tela:reembolsos_motivo', 'Reembolsos por motivo', 'tela',
       'dashboard_refund_reason_detail — categorias de motivo de reembolso',
       NULL::bigint, '["tabela:refund_reason_classifications"]'::jsonb),

      ('tela:alertas_reembolso', 'Alertas de reembolso', 'tela',
       'manager_refund_alerts — reembolsos em atraso ou sem conclusão',
       NULL::bigint, '["tabela:refunds"]'::jsonb),

      ('tela:usuarios', 'Usuários', 'tela',
       'manager_list_users — time, papéis, permissões e quem está online',
       NULL::bigint, '["tabela:lya_agentes"]'::jsonb),

      ('tela:pedidos_espera', 'Pedidos em espera', 'tela',
       'manager_list_held_orders — acompanhamento dos pedidos importados',
       NULL::bigint, '["tabela:held_orders"]'::jsonb),

      ('tela:auditoria', 'Auditoria de atendimentos', 'tela',
       'dashboard_audit — lista de interações, espelho dos gráficos',
       NULL::bigint, '["tabela:services","tabela:service_follow_ups"]'::jsonb),

      ('tela:auditoria_reembolsos', 'Auditoria de reembolsos', 'tela',
       'dashboard_refund_audit — lista de reembolsos do período',
       NULL::bigint, '["tabela:refunds"]'::jsonb),

      -- ── Base de Suporte ─────────────────────────────────────────────────
      -- Um nó só para as três tabelas: para a Lya (e para a gestora) a Base é
      -- uma superfície única, que a tool buscar_base_suporte consulta junta.
      ('base:suporte', 'Base de Suporte', 'base',
       'support_products + support_sms_brands + support_sms_replies — produtos, brands de SMS e respostas prontas',
       (SELECT (SELECT count(*) FROM public.support_products)
             + (SELECT count(*) FROM public.support_sms_brands)
             + (SELECT count(*) FROM public.support_sms_replies)),
       '[]'::jsonb)
  ) AS n(id, label, camada, detalhe, total, liga);

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.lya_criar_arquivo(text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_inserir_linhas(uuid, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_finalizar_arquivo(uuid, jsonb, integer, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_list_files() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_get_file(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_atualizar_arquivo(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_delete_file(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lya_sistema_nos() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lya_criar_arquivo(text, text, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_inserir_linhas(uuid, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_finalizar_arquivo(uuid, jsonb, integer, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_list_files() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_get_file(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_atualizar_arquivo(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_delete_file(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lya_sistema_nos() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Os arquivos entram no sandbox de SQL
-- ─────────────────────────────────────────────────────────────────────────────
-- Sem isto o arquivo seria só uma ficha bonita na tela. Com o GRANT e a policy
-- da role `lya_sql_ro`, a Lya faz JOIN entre lya_file_rows e services/refunds/
-- held_orders dentro do lya_exec_sql — que é o ponto inteiro de guardar linha a
-- linha. Mesmo bloco de 20260907120000: a role não está nas policies de
-- authenticated, então recebe uma policy de SELECT própria (USING true), e ela
-- só é alcançável por dentro da função guardada.
-- Fora do sandbox continuam lya_memories e lya_chats — o cérebro e as conversas
-- não são dado de consulta.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['lya_files', 'lya_file_rows'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO lya_sql_ro', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lya_sql_ro read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO lya_sql_ro USING (true)', 'lya_sql_ro read', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verificação (rode depois de aplicar):
--
--   -- 1) sobrecarga única de lya_upsert_memory (2 linhas = Edge Function quebrada)
--   SELECT p.oid::regprocedure
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'lya_upsert_memory';
--
--   -- 2) catálogo do grafo e o tempo dele (alvo < 300 ms)
--   SELECT set_config('request.jwt.claims','{"sub":"<uuid de uma gestora>","role":"authenticated"}', true);
--   \timing on
--   SELECT jsonb_pretty(public.lya_sistema_nos());
--
--   -- 3) toda referência em "liga" tem que apontar para um nó existente (0 linhas)
--   WITH g AS (SELECT public.lya_sistema_nos() AS j),
--        nos AS (SELECT x->>'id' AS id, x->'liga' AS liga FROM g, jsonb_array_elements(g.j->'nos') x)
--   SELECT DISTINCT l.alvo FROM nos, jsonb_array_elements_text(nos.liga) AS l(alvo)
--   WHERE l.alvo NOT IN (SELECT id FROM nos);
--
--   -- 4) recall devolve origem em cada item de conhecimento
--   SELECT jsonb_pretty(public.lya_recall_memories('reembolso'));
--
--   -- 5) o sandbox enxerga os arquivos e continua cego para o cérebro
--   SELECT public.lya_exec_sql('SELECT count(*) AS total FROM lya_files');
--   SELECT public.lya_exec_sql('SELECT * FROM lya_memories');   -- esperado: erro de permissao
-- ============================================================================
