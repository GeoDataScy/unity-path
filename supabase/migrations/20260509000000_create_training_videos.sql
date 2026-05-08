-- Onboarding/Training videos for agents — "Comece por aqui" screen.
--
-- Two tables:
--   * training_videos       — catalog of video cards (one row per card)
--   * training_video_views  — per-agent watch progress (Netflix-style bar)
--
-- Plus a private Storage bucket "training-videos" for hosting the .mp4/.webm
-- files (read access via signed URL from the client).
--
-- Conventions:
--   * section: stable identifier ("welcome", "atendimentos", "reembolsos",
--     "metricas", "rotinas") — used to group cards into rows on the screen.
--   * video_url: nullable. While null, the card renders as "Em breve" (no play).
--   * thumbnail_url: nullable. Falls back to a gradient placeholder.

-- ---------------------------------------------------------------------------
-- training_videos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section          text NOT NULL,
  title            text NOT NULL,
  description      text,
  video_url        text,
  thumbnail_url    text,
  duration_seconds integer,
  display_order    integer NOT NULL DEFAULT 0,
  is_published     boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_videos_section_order
  ON public.training_videos(section, display_order);

ALTER TABLE public.training_videos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated can read published training videos"
    ON public.training_videos
    FOR SELECT
    USING (is_published = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage training videos"
    ON public.training_videos
    FOR ALL
    USING (public.is_manager())
    WITH CHECK (public.is_manager());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.training_videos TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.training_videos TO authenticated;

-- ---------------------------------------------------------------------------
-- training_video_views — per-user progress
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_video_views (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id          uuid NOT NULL REFERENCES public.training_videos(id) ON DELETE CASCADE,
  watched_seconds   integer NOT NULL DEFAULT 0,
  completed         boolean NOT NULL DEFAULT false,
  last_watched_at   timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_training_video_views_user
  ON public.training_video_views(user_id);

ALTER TABLE public.training_video_views ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Agents can read own training views"
    ON public.training_video_views
    FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Agents can insert own training views"
    ON public.training_video_views
    FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Agents can update own training views"
    ON public.training_video_views
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can read all training views"
    ON public.training_video_views
    FOR SELECT
    USING (public.is_manager());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.training_video_views TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket — private, signed URLs from the client
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-videos', 'training-videos', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can read objects (front-end requests a signed URL).
DO $$ BEGIN
  CREATE POLICY "Authenticated can read training-videos bucket"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'training-videos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only managers can upload/replace/delete training videos.
DO $$ BEGIN
  CREATE POLICY "Managers can write training-videos bucket"
    ON storage.objects
    FOR ALL
    TO authenticated
    USING (bucket_id = 'training-videos' AND public.is_manager())
    WITH CHECK (bucket_id = 'training-videos' AND public.is_manager());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Seed — initial card catalog. video_url is left NULL on purpose so each card
-- renders as "Em breve" until the corresponding .mp4 is uploaded and the row
-- is updated. Display order is incremented in steps of 10 for easy reordering.
-- ---------------------------------------------------------------------------
INSERT INTO public.training_videos (section, title, description, display_order) VALUES
  ('welcome', 'Bem-vindo à XMX',
   'Mensagem de boas-vindas e o que você vai aprender por aqui.', 10),
  ('welcome', 'Visão geral da plataforma',
   'Um tour rápido pelos três pilares do agente: Atendimentos, Reembolsos e Minhas métricas.', 20),
  ('welcome', 'Como pedir ajuda',
   'Para onde olhar quando algo travar — quem chamar, onde reportar.', 30),

  ('atendimentos', 'Registrar um novo atendimento',
   'Como abrir um ticket: e-mail, telefone, produto, plataforma.', 10),
  ('atendimentos', 'Canal e código de rastreio',
   'Quando usar Email, SMS ou Clickbank, e quando ligar o toggle de rastreio.', 20),
  ('atendimentos', 'Buscar e filtrar atendimentos',
   'Filtros de e-mail, intervalo de datas, atalho "Hoje" e busca rápida.', 30),
  ('atendimentos', 'Microgerenciador de status',
   'Como adicionar follow-ups, mudar status e registrar observações.', 40),
  ('atendimentos', 'Editar, concluir e excluir',
   'As três ações da linha do atendimento — quando usar cada uma.', 50),
  ('atendimentos', 'E quando o atendimento já existe?',
   'O que acontece quando o e-mail já tem ticket e como continuar a tratativa.', 60),

  ('reembolsos', 'Abrir um novo reembolso',
   'Cadastro inicial: e-mail, data do pedido, order ID, produto, plataforma.', 10),
  ('reembolsos', 'Em aberto vs Histórico',
   'A diferença entre as duas abas e quando cada reembolso aparece em cada uma.', 20),
  ('reembolsos', 'Concluir um reembolso',
   'Valor, tipo, motivo e o checkbox de itens devolvidos.', 30),
  ('reembolsos', 'Editar reembolso concluído',
   'Como ajustar um reembolso já finalizado quando precisar corrigir algo.', 40),
  ('reembolsos', 'Filtros e busca em reembolsos',
   'Como achar rápido um reembolso específico em meio ao histórico.', 50),

  ('metricas', 'Tour do painel',
   'Visão geral da tela "Minhas métricas" — o que cada bloco te mostra.', 10),
  ('metricas', 'Cartão de motivação e comparação com o time',
   'O que significa estar acima/abaixo da média e como o líder é calculado.', 20),
  ('metricas', 'KPIs principais',
   'Total, novos, follow-ups, média diária e tendência — explicados com exemplo.', 30),
  ('metricas', 'Reembolsos no período',
   'Os três cards: em aberto, concluídos e valor reembolsado.', 40),
  ('metricas', 'Evolução diária (gráfico)',
   'Como ler o gráfico de linha com sua média e a média do time.', 50),
  ('metricas', 'Por canal e por plataforma',
   'Como interpretar a distribuição entre Email, SMS, Clickbank e plataformas de venda.', 60),
  ('metricas', 'Detalhamento por dia',
   'A tabela diária com leitura de performance (acima / abaixo / na média).', 70),

  ('rotinas', 'Check-in do agente',
   'O pop-up que aparece de tempos em tempos — o que ele mostra e por quê.', 10),
  ('rotinas', 'Padrão de horários',
   'Como o sistema enxerga os horários em que você costuma trabalhar.', 20)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
