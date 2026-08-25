// Bloco de notas — estado do servidor (TanStack Query).
//
// Escrita vai direto na tabela (RLS de dono, sem RPC — ver a migration
// 20260826120000_agent_notepad.sql). Três queries, todas do próprio agente:
//
//   useNotesRangeQuery  -> as anotações do recorte aberto (dia/semana/mês)
//   useOpenTasksQuery   -> pendências em aberto até hoje: alimenta o badge do
//                          atalho E a faixa "vindas de dias anteriores"
//   useNotesSearchQuery -> busca no caderno inteiro, ignorando o recorte
//
// Sem polling: o único cliente que escreve neste dado é o próprio agente, então
// invalidação explícita já mantém tudo coerente (ver o incidente de sobrecarga
// de 24/07 comentado em App.tsx). O staleTime é maior que o default de 30s pelo
// mesmo motivo.

import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/supabaseError";
import { todayInSaoPaulo } from "./notepadDates";
import { NOTE_COLUMNS, type AgentNote, type NoteKind } from "./types";

// agent_notes ainda não está nos tipos gerados do Supabase (types.ts é gerado
// pela CLI). Mesmo caminho da Base de Suporte: cliente sem schema tipado, tipos
// vindos de ./types.
const db = supabase as unknown as SupabaseClient;

const TABLE = "agent_notes";

export const NOTES_KEY = ["agent-notes"] as const;
const RANGE_KEY = [...NOTES_KEY, "range"] as const;
const OPEN_TASKS_KEY = [...NOTES_KEY, "pendentes"] as const;
const SEARCH_KEY = [...NOTES_KEY, "busca"] as const;

const NOTES_STALE_TIME = 2 * 60_000;

/** Teto de linhas por consulta — caderno de um agente não chega perto disso. */
const PAGE_LIMIT = 500;
const SEARCH_LIMIT = 60;

/**
 * Anotações de um intervalo de dias (inclusive as duas pontas).
 *
 * Ordem da página: dia, depois fixados no topo, depois na ordem em que foram
 * escritos — o caderno é lido de cima para baixo.
 */
export function useNotesRangeQuery(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: [...RANGE_KEY, from, to],
    enabled: enabled && Boolean(from) && Boolean(to),
    staleTime: NOTES_STALE_TIME,
    queryFn: async (): Promise<AgentNote[]> => {
      const { data, error } = await db
        .from(TABLE)
        .select(NOTE_COLUMNS)
        .gte("note_date", from)
        .lte("note_date", to)
        .order("note_date", { ascending: true })
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(PAGE_LIMIT);
      if (error) throw toError(error, "Não foi possível carregar as anotações.");
      return (data ?? []) as AgentNote[];
    },
  });
}

/**
 * Pendências não concluídas com data até hoje. O componente separa o que é de
 * hoje do que ficou para trás — uma consulta só serve os dois usos e não gera
 * uma segunda ida ao banco a cada abertura do caderno.
 */
export function useOpenTasksQuery(enabled: boolean) {
  const today = todayInSaoPaulo();
  return useQuery({
    queryKey: [...OPEN_TASKS_KEY, today],
    enabled,
    staleTime: NOTES_STALE_TIME,
    queryFn: async (): Promise<AgentNote[]> => {
      const { data, error } = await db
        .from(TABLE)
        .select(NOTE_COLUMNS)
        .eq("kind", "tarefa")
        .eq("done", false)
        .lte("note_date", today)
        .order("note_date", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(PAGE_LIMIT);
      if (error) throw toError(error, "Não foi possível carregar as pendências.");
      return (data ?? []) as AgentNote[];
    },
  });
}

/** Busca no caderno inteiro. Só dispara com 2+ caracteres (ver o componente). */
export function useNotesSearchQuery(term: string, enabled: boolean) {
  const query = term.trim();
  return useQuery({
    queryKey: [...SEARCH_KEY, query],
    enabled: enabled && query.length >= 2,
    staleTime: NOTES_STALE_TIME,
    queryFn: async (): Promise<AgentNote[]> => {
      // Escapa os curingas do LIKE: quem digita "100%" quer o texto, não o padrão.
      const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const { data, error } = await db
        .from(TABLE)
        .select(NOTE_COLUMNS)
        .ilike("body", pattern)
        .order("note_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(SEARCH_LIMIT);
      if (error) throw toError(error, "Não foi possível buscar no caderno.");
      return (data ?? []) as AgentNote[];
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────────────

function useInvalidateNotes() {
  const qc = useQueryClient();
  // Invalida a raiz: a mesma anotação aparece no recorte, no badge e na busca.
  return () => qc.invalidateQueries({ queryKey: NOTES_KEY });
}

/**
 * O id é gerado no cliente para que a escrita possa ser otimista: a linha
 * aparece na página no mesmo frame do Enter, com a identidade definitiva.
 * `crypto.randomUUID` só existe em contexto seguro (https/localhost), que é
 * onde o app roda — o fallback cobre o caso de um navegador antigo.
 */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}

export type CreateNoteInput = {
  body: string;
  kind: NoteKind;
  /** Dia da página em que está sendo escrita, 'YYYY-MM-DD'. */
  noteDate: string;
};

export function useCreateNoteMutation() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (input: CreateNoteInput): Promise<AgentNote> => {
      const row = {
        id: newId(),
        body: input.body.trim(),
        kind: input.kind,
        note_date: input.noteDate,
      };
      const { data, error } = await db.from(TABLE).insert(row).select(NOTE_COLUMNS).single();
      if (error) throw toError(error, "Não foi possível salvar a anotação.");
      return data as AgentNote;
    },
    // Sem update otimista aqui: é o servidor que devolve created_at, e created_at
    // é o que ordena a página. Inventar o horário no cliente faria a linha pular
    // de lugar quando a resposta chegasse. O composer limpa na hora, então a
    // sensação de imediato se mantém.
    onSuccess: () => invalidate(),
  });
}

export type UpdateNotePatch = Partial<{
  body: string;
  kind: NoteKind;
  done: boolean;
  pinned: boolean;
  /** Mover a anotação para outro dia (ação explícita: "trazer para hoje"). */
  note_date: string;
}>;

/**
 * Update otimista: marcar uma pendência é o gesto mais repetido do caderno e
 * precisa responder na hora. Em caso de erro, o cache anterior volta inteiro.
 */
export function useUpdateNoteMutation() {
  const qc = useQueryClient();
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateNotePatch }) => {
      const payload: UpdateNotePatch = { ...patch };
      if (typeof payload.body === "string") payload.body = payload.body.trim();

      const { error } = await db.from(TABLE).update(payload).eq("id", id);
      if (error) throw toError(error, "Não foi possível salvar a alteração.");
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const snapshot = qc.getQueriesData<AgentNote[]>({ queryKey: NOTES_KEY });

      for (const [key, notes] of snapshot) {
        if (!Array.isArray(notes)) continue;
        qc.setQueryData<AgentNote[]>(
          key,
          notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        );
      }
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      for (const [key, notes] of context?.snapshot ?? []) {
        qc.setQueryData(key, notes);
      }
    },
    onSettled: () => invalidate(),
  });
}

/**
 * Apaga sem diálogo de confirmação: para uma anotação de uma linha, confirmar
 * custa mais do que errar. O desfazer fica com quem chama (toast do sonner),
 * usando `useRestoreNoteMutation` — por isso a mutação devolve a linha inteira.
 */
export function useDeleteNoteMutation() {
  const qc = useQueryClient();
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (note: AgentNote) => {
      const { error } = await db.from(TABLE).delete().eq("id", note.id);
      if (error) throw toError(error, "Não foi possível apagar a anotação.");
      return note;
    },
    onMutate: async (note) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const snapshot = qc.getQueriesData<AgentNote[]>({ queryKey: NOTES_KEY });
      for (const [key, notes] of snapshot) {
        if (!Array.isArray(notes)) continue;
        qc.setQueryData<AgentNote[]>(
          key,
          notes.filter((n) => n.id !== note.id),
        );
      }
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      for (const [key, notes] of context?.snapshot ?? []) {
        qc.setQueryData(key, notes);
      }
    },
    onSettled: () => invalidate(),
  });
}

/**
 * Desfazer do apagar: reinsere com o MESMO id e o created_at original, para a
 * anotação voltar exatamente para o lugar de onde saiu na página.
 */
export function useRestoreNoteMutation() {
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (note: AgentNote) => {
      const { error } = await db.from(TABLE).insert({
        id: note.id,
        note_date: note.note_date,
        body: note.body,
        kind: note.kind,
        done: note.done,
        pinned: note.pinned,
        created_at: note.created_at,
      });
      if (error) throw toError(error, "Não foi possível restaurar a anotação.");
    },
    onSettled: () => invalidate(),
  });
}
