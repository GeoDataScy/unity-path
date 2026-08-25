-- Bloco de notas do agente — anotações rápidas, lembretes e pendências da rotina.
--
-- Problema que resolve: o agente hoje anota no papel, no Notepad do Windows ou no
-- WhatsApp dele. Some quando troca de máquina, e nada disso sobrevive ao fim do
-- turno. Aqui a anotação vive na CONTA do agente: ele abre o caderno em qualquer
-- máquina e está tudo lá.
--
-- Uma tabela só: agent_notes. Cada linha é uma anotação PRESA A UM DIA
-- (note_date) — é isso que faz o caderno virar caderno, com página por dia e os
-- recortes "semana" e "mês" saindo de um range de note_date. Mudar a data de uma
-- anotação é uma ação explícita do agente ("trazer para hoje" na tela), nunca
-- automática: uma pendência que se move sozinha de dia deixa de ser histórico.
--
-- PRIVACIDADE (decisão de produto, não descuido): a gestora NÃO lê este dado.
-- Diferente do Radar (20260825120000), que existe para dar visibilidade do
-- acompanhamento ao gestor, o caderno é rascunho pessoal do agente — se ele
-- souber que a gestora lê, volta a anotar no papel e a feature morre. Por isso a
-- policy é única e simétrica: dono lê, dono escreve, mais ninguém.
--
-- Convenções seguidas (ver CLAUDE.md):
--   * profiles.id é TEXT -> user_id é TEXT comparado com auth.uid()::text.
--   * Sem RPC: aqui não há regra de negócio (nenhum status derivado, nenhuma
--     validação cruzada) — é CRUD puro de um dono sobre as próprias linhas.
--     Mesmo caminho da Base de Suporte (20260817180000); quem garante é a RLS.
--   * `(SELECT auth.uid())` dentro da policy para manter o InitPlan e não
--     reavaliar a checagem linha a linha (incidente de sobrecarga de 24/07).
--   * Sem ON DELETE em profiles: perfil aqui é DESATIVADO, nunca apagado.

-- ============================================================================
-- 1) agent_notes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- DEFAULT auth.uid()::text para o cliente não precisar mandar o dono; a policy
  -- de WITH CHECK barra qualquer tentativa de gravar na conta de outro agente.
  user_id    text NOT NULL DEFAULT (auth.uid()::text) REFERENCES public.profiles(id),

  -- O "dia da página". Default é HOJE EM SÃO PAULO, não o dia UTC: às 21h de SP
  -- já é o dia seguinte em UTC, e a anotação da noite cairia na página de amanhã.
  note_date  date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),

  body       text NOT NULL,

  -- 'nota'   -> anotação/lembrete livre, não tem o que concluir
  -- 'tarefa' -> pendência da rotina, tem caixinha para marcar
  kind       text NOT NULL DEFAULT 'nota',

  done       boolean NOT NULL DEFAULT false,
  -- Fixado no topo da página (o lembrete que não pode passar batido).
  pinned     boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at    timestamptz,

  CONSTRAINT agent_notes_body_chk CHECK (btrim(body) <> '' AND length(body) <= 4000),
  CONSTRAINT agent_notes_kind_chk CHECK (kind IN ('nota', 'tarefa')),
  -- Só pendência conclui. Nota marcada como concluída não significaria nada e
  -- deixaria o contador de pendentes mentindo.
  CONSTRAINT agent_notes_done_kind_chk CHECK (kind = 'tarefa' OR done = false),
  -- done e done_at andam juntos; quem preenche/limpa é o trigger abaixo.
  CONSTRAINT agent_notes_done_at_chk CHECK (done = (done_at IS NOT NULL))
);

COMMENT ON TABLE public.agent_notes IS
  'Bloco de notas privado do agente: uma anotação por linha, presa a um dia (note_date). Só o dono lê e escreve.';
COMMENT ON COLUMN public.agent_notes.note_date IS
  'Dia (America/Sao_Paulo) a que a anotação pertence. Muda só por ação explícita do agente.';

-- Consulta quente: "a página do dia X" e os recortes semana/mês, que são o mesmo
-- índice com range em note_date. created_at ordena dentro da página (o caderno é
-- lido de cima para baixo, na ordem em que foi escrito).
CREATE INDEX IF NOT EXISTS idx_agent_notes_pagina
  ON public.agent_notes (user_id, note_date, created_at);

-- Pendências em aberto (badge do atalho + faixa "vindas de dias anteriores").
-- Parcial porque tarefa concluída e nota nunca entram nessa lista.
CREATE INDEX IF NOT EXISTS idx_agent_notes_pendentes
  ON public.agent_notes (user_id, note_date)
  WHERE kind = 'tarefa' AND done = false;

-- Busca é ILIKE sem índice de propósito: o volume aqui é o caderno de UM agente
-- (centenas de linhas), e pg_trgm custaria uma extensão + índice para ganhar
-- milissegundos. Se um dia virar milhares, o índice trigram entra aqui.

-- ============================================================================
-- 2) Trigger — updated_at e done_at derivados no banco
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_notes_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();

  -- done_at é consequência de done, então o cliente manda só o booleano.
  IF NEW.done AND NEW.done_at IS NULL THEN
    NEW.done_at := now();
  ELSIF NOT NEW.done THEN
    NEW.done_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_notes_touch ON public.agent_notes;
CREATE TRIGGER trg_agent_notes_touch
  BEFORE INSERT OR UPDATE ON public.agent_notes
  FOR EACH ROW EXECUTE FUNCTION public.agent_notes_touch();

-- ============================================================================
-- 3) RLS — dono lê, dono escreve, ninguém mais (nem a gestora)
-- ============================================================================
ALTER TABLE public.agent_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_notes_own ON public.agent_notes;
CREATE POLICY agent_notes_own ON public.agent_notes
  FOR ALL
  USING (user_id = (SELECT auth.uid()::text))
  WITH CHECK (user_id = (SELECT auth.uid()::text));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_notes TO authenticated;
