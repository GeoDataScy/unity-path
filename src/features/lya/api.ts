// Ponte do browser com a Lya: a Edge Function `lya` (chat em SSE + treino) e
// os RPCs do histórico/cérebro (chamados direto no Supabase, com o JWT do
// usuário — os guards ficam no banco).
import { supabase } from "@/integrations/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import type {
  LyaChatDetail,
  LyaChatSummary,
  LyaContexto,
  LyaEvent,
  LyaMemory,
  LyaMemoryInput,
  LyaMessage,
} from "./types";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lya`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// As RPCs da Lya ainda não estão nos tipos gerados do Supabase (mesmo
// expediente de held-orders): chamada sem tipagem, com o retorno tipado aqui.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

async function accessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Sessão inválida. Entre de novo.");
  return session.access_token;
}

async function callFunction(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const token = await accessToken();
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: JSON.stringify(body),
    signal,
  });
}

async function erroDaResposta(res: Response, fallback: string): Promise<Error> {
  const payload = await res.json().catch(() => null);
  const msg = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : "";
  return new Error(msg || `${fallback} (HTTP ${res.status})`);
}

/**
 * Quebra o buffer do SSE em eventos completos. Exportado para teste: é a
 * única parte do transporte com lógica própria (um chunk pode chegar com meio
 * evento, ou com vários).
 */
export function parseSseBuffer(buffer: string): { events: LyaEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: LyaEvent[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as LyaEvent);
    } catch {
      // linha malformada: ignora e segue
    }
  }
  return { events, rest };
}

export interface StreamParams {
  messages: LyaMessage[];
  modoTreino?: boolean;
  contexto?: LyaContexto;
  onEvent: (evt: LyaEvent) => void;
  signal?: AbortSignal;
}

/** Um turno do chat. Resolve quando o stream termina (com `done` ou não). */
export async function streamLyaChat({ messages, modoTreino, contexto, onEvent, signal }: StreamParams): Promise<void> {
  const res = await callFunction(
    {
      action: "chat",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      modoTreino: modoTreino === true,
      contexto,
    },
    signal,
  );
  if (!res.ok) throw await erroDaResposta(res, "A Lya não respondeu");
  if (!res.body) throw new Error("Sem resposta do servidor.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const evt of parsed.events) onEvent(evt);
  }
  // resto sem \n\n final (raro): tenta fechar
  const tail = parseSseBuffer(buffer + "\n\n");
  for (const evt of tail.events) onEvent(evt);
}

export async function lyaPing(): Promise<{ ok: boolean; chave_configurada: boolean; modelo: string; role: string }> {
  const res = await callFunction({ action: "ping" });
  if (!res.ok) throw await erroDaResposta(res, "A Lya está indisponível");
  return res.json();
}

/** Grava uma memória passando pelo treinador (classifica e enriquece). Só gestora. */
export async function lyaSalvarMemoria(input: LyaMemoryInput): Promise<LyaMemory> {
  const res = await callFunction({ action: "memoria_salvar", ...input });
  if (!res.ok) throw await erroDaResposta(res, "Não foi possível salvar a memória");
  return res.json();
}

// ── Histórico (RPCs) ────────────────────────────────────────────────────────

export async function lyaListChats(): Promise<LyaChatSummary[]> {
  const { data, error } = await rpc("lya_list_chats");
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível carregar as conversas."));
  return Array.isArray(data) ? (data as LyaChatSummary[]) : [];
}

export async function lyaGetChat(id: string): Promise<LyaChatDetail | null> {
  const { data, error } = await rpc("lya_get_chat", { p_chat_id: id });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível abrir a conversa."));
  return (data as LyaChatDetail | null) ?? null;
}

export async function lyaSaveChat(id: string, mensagens: LyaMessage[]): Promise<LyaChatSummary> {
  const { data, error } = await rpc("lya_save_chat", {
    p_chat_id: id,
    p_mensagens: mensagens.map((m) => ({
      role: m.role,
      content: m.content,
      tools: m.tools ?? [],
      charts: m.charts ?? [],
      memorias: m.memorias ?? [],
      revisao: m.revisao ?? null,
    })),
  });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível salvar a conversa."));
  return data as LyaChatSummary;
}

export async function lyaDeleteChat(id: string): Promise<void> {
  const { error } = await rpc("lya_delete_chat", { p_chat_id: id });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível apagar a conversa."));
}

// ── Cérebro (RPCs de leitura/remoção; a gravação passa pela função) ─────────

export async function lyaListMemories(): Promise<LyaMemory[]> {
  const { data, error } = await rpc("lya_list_memories");
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível carregar o cérebro."));
  return (Array.isArray(data) ? data : []).map((m) => {
    const row = m as LyaMemory & { tags: unknown };
    return { ...row, tags: Array.isArray(row.tags) ? row.tags.map(String) : [] };
  });
}

export async function lyaDeleteMemory(name: string): Promise<void> {
  const { error } = await rpc("lya_delete_memory", { p_name: name });
  if (error) throw new Error(supabaseErrorMessage(error, "Não foi possível apagar a memória."));
}
