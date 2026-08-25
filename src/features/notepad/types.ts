// Bloco de notas do agente — tipos do domínio.
//
// Espelha public.agent_notes (20260826120000_agent_notepad.sql). Como as tabelas
// novas ainda não estão nos tipos gerados do Supabase, é ESTE arquivo que serve
// de contrato para as queries — mantenha em sincronia com a migration.

/** 'nota' = anotação/lembrete livre; 'tarefa' = pendência com caixinha. */
export type NoteKind = "nota" | "tarefa";

export type AgentNote = {
  id: string;
  /** Dia a que a anotação pertence, 'YYYY-MM-DD' (America/Sao_Paulo). */
  note_date: string;
  body: string;
  kind: NoteKind;
  done: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

/** Recorte do caderno. A anotação continua presa ao dia nos três. */
export type NotepadScope = "dia" | "semana" | "mes";

export const NOTEPAD_SCOPES: { value: NotepadScope; label: string }[] = [
  { value: "dia", label: "Dia" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
];

/** Colunas lidas em toda query — evita `select("*")` divergir entre telas. */
export const NOTE_COLUMNS =
  "id, note_date, body, kind, done, pinned, created_at, updated_at";
