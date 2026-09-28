# Front-end dos modelos — a planta da interface (Lya e Daniel) + skill do cérebro em grafo

> **Como usar este arquivo.** Depois do `01` e do `02`. Ele descreve as três
> superfícies do agente (tela cheia, balão, tela do cérebro), o transporte do
> stream, o estado da conversa, o histórico, e traz na **Parte B** a skill
> `cerebro-grafo` completa: a tela do "segundo cérebro" como um grafo ao vivo
> no estilo Obsidian, com o código de referência inteiro. Copie a Parte B para
> `.claude/skills/cerebro-grafo/SKILL.md` no projeto do cliente para que a
> IA de programação a use como skill; ela também funciona lida em linha.
>
> Pilha da referência: React 18 + TypeScript + Vite + TanStack Query +
> Tailwind + shadcn/ui + react-router (Lya). A Parte C lista as diferenças
> para Next.js App Router + zustand (Daniel). Nomes genéricos: `features/agente/`.

---

# Parte A — O chat

## A.0 Estrutura de arquivos

```
src/features/agente/
├── api.ts                    fala com a função (stream) e com as RPCs (histórico, cérebro)
├── types.ts                  eventos, mensagens, memórias — o contrato
├── useAgentConversation.ts   o estado de UMA conversa (tela cheia e balão)
├── useAgentChats.ts          histórico (TanStack Query) + fila de saves
├── useAgentMemories.ts       o cérebro (TanStack Query)
├── graph.ts                  monta o grafo a partir das memórias (Parte B)
├── graph.test.ts · api.test.ts
└── components/
    ├── AgentChat.tsx         tela cheia: lista de conversas + conversa
    ├── AgentWidget.tsx       o balão flutuante
    ├── AgentMessages.tsx     a lista de mensagens
    ├── AgentComposer.tsx     a caixa de envio (com o botão Treinar)
    ├── ChatActivity.tsx      chips de ferramenta, "pensando", card de memória, notas da revisão
    ├── ChartCard.tsx         o gráfico que o agente pede (Recharts)
    ├── Markdown.tsx          react-markdown + remark-gfm com os tokens do tema
    ├── BrainGraph.tsx        o grafo (Parte B)
    ├── CerebroTicker.tsx     a faixa de métricas (Parte B)
    └── Treinar.tsx           o console de treino + guia (Parte B)
src/pages/
├── DashboardAgente.tsx       rota /dashboard/agente
└── DashboardAgenteCerebro.tsx rota /dashboard/agente/cerebro (só quem treina)
```

Dependências: `react-markdown`, `remark-gfm`, `recharts`,
`react-force-graph-2d@1.29.1`, `@tanstack/react-query`, `lucide-react`.

## A.1 `types.ts` — o contrato

```ts
export type AgentRole = "user" | "assistant";
export interface AgentToolCall { name: string }
export interface AgentChartSeries { nome: string; valores: number[] }
export interface AgentChart {
  tipo: "barras" | "linha" | "area" | "pizza"; titulo: string; subtitulo?: string;
  eixoX?: string; eixoY?: string; categorias: string[]; series: AgentChartSeries[];
}
export interface MemoriaSalva { name: string; description: string; type: string; tags: string[] }
export interface Revisao {
  aprovado: boolean;
  ressalvas: { afirmacao: string; motivo: string; gravidade: "alta" | "media" | "baixa" }[];
  divergencias: string[];
}

// Uma mensagem do agente não é uma string: é texto MAIS os blocos ricos.
// O histórico guarda exatamente isto, para a conversa reabrir igual.
export interface AgentMessage {
  role: AgentRole; content: string;
  tools?: AgentToolCall[]; charts?: AgentChart[]; memorias?: MemoriaSalva[]; revisao?: Revisao | null;
}

export interface AgentChatSummary { id: string; titulo: string; total_mensagens: number; created_at: string; updated_at: string }
export interface AgentChatDetail extends Omit<AgentChatSummary, "total_mensagens"> { mensagens: (AgentMessage & { ordem: number })[] }

// O que a tela manda junto com a pergunta.
export interface AgentContexto {
  de?: string; ate?: string;
  filtro_id?: string | null; filtro_nome?: string | null;
  usuario_nome?: string | null; usuario_role?: string | null;
  tela?: string | null;
}

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "chart"; chart: AgentChart }
  | { type: "memoria"; memoria: MemoriaSalva }
  | { type: "aviso"; codigo?: string; message?: string }
  | { type: "revisao"; revisao: Revisao }
  | { type: "error"; message?: string }
  | { type: "done" };

// ── Cérebro ─────────────────────────────────────────────────────────────────
export type MemoryType = "user" | "feedback" | "project" | "reference" | "nota";
export interface Memory {
  id: number; name: string; description: string; type: MemoryType; tags: string[]; body: string;
  author_id: string | null; seed: boolean; created_at: string; updated_at: string;
}
export interface MemoryInput {
  name?: string; description: string; body?: string; tags?: string[];
  type?: MemoryType | null;   // null = o treinador classifica
  refinar?: boolean;          // false = grava como está (edição manual com tipo explícito)
}

export const TIPOS_MEMORIA: { value: MemoryType; label: string; hint: string; className: string }[] = [
  { value: "feedback",  label: "Preferência",  hint: "Como responder (estilo, formato, o que evitar). Vale em toda resposta.", className: "text-amber-600 dark:text-amber-400 border-amber-500/40" },
  { value: "user",      label: "Sobre <<NOME>>", hint: "Quem é e para quem responde. Vale em toda resposta.",                className: "text-blue-600 dark:text-blue-400 border-blue-500/40" },
  { value: "project",   label: "Projeto",      hint: "Trabalho em andamento, metas, contexto de campanha.",                  className: "text-primary border-primary/40" },
  { value: "reference", label: "Referência",   hint: "Link, planilha ou painel externo de confiança.",                       className: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  { value: "nota",      label: "Nota",         hint: "Um fato do domínio; entra quando tem a ver com a pergunta.",           className: "text-muted-foreground border-border" },
];
export const TIPO_MEMORIA_MAP = Object.fromEntries(TIPOS_MEMORIA.map((t) => [t.value, t])) as Record<MemoryType, (typeof TIPOS_MEMORIA)[number]>;
```

## A.2 `api.ts` — o stream e as RPCs

Não use `EventSource`: só faz GET e não manda `Authorization`. Use `fetch` e
leia o corpo.

```ts
import { supabase } from "@/integrations/supabase/client";
import type { AgentChatDetail, AgentChatSummary, AgentContexto, AgentEvent, Memory, MemoryInput, AgentMessage } from "./types";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agente`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// RPCs novas ainda fora dos tipos gerados: chamada sem tipagem, retorno tipado aqui.
const rpc = supabase.rpc.bind(supabase) as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

async function accessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Sessão inválida. Entre de novo.");
  return session.access_token;
}
async function callFunction(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const token = await accessToken();
  return fetch(FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: ANON_KEY }, body: JSON.stringify(body), signal });
}
// Erro do servidor vira FRASE, não código: o backend já escreve para o usuário.
async function erroDaResposta(res: Response, fallback: string): Promise<Error> {
  const payload = await res.json().catch(() => null);
  const msg = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : "";
  return new Error(msg || `${fallback} (HTTP ${res.status})`);
}

/** Quebra o buffer em eventos completos e devolve o resto. Exportado para teste:
 *  é a única parte do transporte com lógica própria. */
export function parseSseBuffer(buffer: string): { events: AgentEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    try { events.push(JSON.parse(line.slice(5).trim()) as AgentEvent); } catch { /* linha malformada: ignora */ }
  }
  return { events, rest };
}

export interface StreamParams { messages: AgentMessage[]; modoTreino?: boolean; contexto?: AgentContexto; onEvent: (evt: AgentEvent) => void; signal?: AbortSignal }

export async function streamAgentChat({ messages, modoTreino, contexto, onEvent, signal }: StreamParams): Promise<void> {
  const res = await callFunction({ action: "chat", messages: messages.map((m) => ({ role: m.role, content: m.content })), modoTreino: modoTreino === true, contexto }, signal);
  if (!res.ok) throw await erroDaResposta(res, "<<NOME>> não respondeu");
  if (!res.body) throw new Error("Sem resposta do servidor.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });   // stream: true — sem isso acentos quebram entre chunks
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const evt of parsed.events) onEvent(evt);
  }
  for (const evt of parseSseBuffer(buffer + "\n\n").events) onEvent(evt);   // resto sem \n\n final (raro)
}

export async function agentPing() { const res = await callFunction({ action: "ping" }); if (!res.ok) throw await erroDaResposta(res, "<<NOME>> está indisponível"); return res.json(); }
export async function agentSalvarMemoria(input: MemoryInput): Promise<Memory> { const res = await callFunction({ action: "memoria_salvar", ...input }); if (!res.ok) throw await erroDaResposta(res, "Não foi possível salvar a memória"); return res.json(); }

// ── Histórico e cérebro (RPCs direto no Supabase; guards e RLS ficam no banco) ──
export async function agentListChats(): Promise<AgentChatSummary[]> { const { data, error } = await rpc("agente_list_chats"); if (error) throw new Error("Não foi possível carregar as conversas."); return Array.isArray(data) ? (data as AgentChatSummary[]) : []; }
export async function agentGetChat(id: string): Promise<AgentChatDetail | null> { const { data, error } = await rpc("agente_get_chat", { p_chat_id: id }); if (error) throw new Error("Não foi possível abrir a conversa."); return (data as AgentChatDetail | null) ?? null; }
export async function agentSaveChat(id: string, mensagens: AgentMessage[]): Promise<AgentChatSummary> {
  const { data, error } = await rpc("agente_save_chat", { p_chat_id: id, p_mensagens: mensagens.map((m) => ({ role: m.role, content: m.content, tools: m.tools ?? [], charts: m.charts ?? [], memorias: m.memorias ?? [], revisao: m.revisao ?? null })) });
  if (error) throw new Error("Não foi possível salvar a conversa."); return data as AgentChatSummary;
}
export async function agentDeleteChat(id: string): Promise<void> { const { error } = await rpc("agente_delete_chat", { p_chat_id: id }); if (error) throw new Error("Não foi possível apagar a conversa."); }
export async function agentListMemories(): Promise<Memory[]> {
  const { data, error } = await rpc("agente_list_memories"); if (error) throw new Error("Não foi possível carregar o cérebro.");
  return (Array.isArray(data) ? data : []).map((m) => { const row = m as Memory & { tags: unknown }; return { ...row, tags: Array.isArray(row.tags) ? row.tags.map(String) : [] }; });
}
export async function agentDeleteMemory(name: string): Promise<void> { const { error } = await rpc("agente_delete_memory", { p_name: name }); if (error) throw new Error("Não foi possível apagar a memória."); }
export async function agentDeleteSeedMemories(): Promise<number> { const { data, error } = await rpc("agente_delete_seed_memories"); if (error) throw new Error("Não foi possível remover os exemplos."); return Number(data ?? 0); }
```

Teste obrigatório de `parseSseBuffer`: chunk partido no meio de um evento,
linha `: comentario`, JSON quebrado ignorado, resto que se junta ao chunk
seguinte.

## A.3 `useAgentConversation.ts` — o estado de uma conversa

O ponto difícil: **a resposta em voo não pode viver só no estado do React**.
Se o usuário troca de conversa no meio da resposta e o save lê o estado da
tela, você grava a pergunta sem a resposta. Solução: espelhar o turno numa
cópia própria, fora do React, indexada pela conversa dona; um `Symbol` por
turno decide de quem é cada evento.

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgentChat } from "./api";
import type { AgentContexto, AgentMessage } from "./types";
import { useAgentChatQuery, useSaveAgentChat } from "./useAgentChats";

interface Options { chatId?: string | null; persist?: boolean; onNeedChatId?: () => string; contexto?: AgentContexto; modoTreino?: boolean }

export function useAgentConversation({ chatId = null, persist = false, onNeedChatId, contexto, modoTreino }: Options) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const saveChat = useSaveAgentChat();

  const hydratedRef = useRef<string | null | undefined>(undefined);
  const turnoNaTelaRef = useRef<symbol | null>(null);
  const emVooRef = useRef(new Map<string, { token: symbol; turno: AgentMessage[] }>());   // conversa → turno em voo

  const chatQuery = useAgentChatQuery(persist ? chatId : null);
  const loadingHistory = persist && Boolean(chatId) && chatQuery.isLoading;
  const historyError = persist && Boolean(chatId) && chatQuery.isError;

  // Troca de conversa: limpa a tela; se houver turno em voo para a conversa aberta, reata a ele.
  useEffect(() => {
    if (!persist || hydratedRef.current === chatId) return;
    hydratedRef.current = chatId; turnoNaTelaRef.current = null; setLoading(false); setAviso(null);
    if (!chatId) { setMessages([]); return; }
    const emVoo = emVooRef.current.get(chatId);
    if (emVoo) { turnoNaTelaRef.current = emVoo.token; setMessages(emVoo.turno.slice()); setLoading(true); return; }
    setMessages([]);
  }, [chatId, persist]);

  // Hidrata do banco só quando não há turno em voo para aquela conversa.
  useEffect(() => {
    if (!persist || !chatId || !chatQuery.data) return;
    if (emVooRef.current.get(chatId) || hydratedRef.current !== chatId) return;
    setMessages(chatQuery.data.mensagens.map(({ ordem: _o, ...m }) => m));
  }, [persist, chatId, chatQuery.data]);

  const send = useCallback(async (question: string) => {
    const text = question.trim();
    // loadingHistory/historyError travam o envio: sem as mensagens anteriores o save por substituição apagaria a conversa.
    if (!text || loading || loadingHistory || historyError) return;

    let id: string | null = chatId;
    if (persist && !id) { id = onNeedChatId?.() ?? null; if (id) hydratedRef.current = id; }
    const turnoToken = Symbol("turno");
    turnoNaTelaRef.current = turnoToken; setAviso(null);

    const userMsg: AgentMessage = { role: "user", content: text };
    const history = [...messages, userMsg];
    const turno: AgentMessage[] = [...history, { role: "assistant", content: "" }];
    if (id) emVooRef.current.set(id, { token: turnoToken, turno });
    setMessages(turno.slice());
    if (persist && id) void saveChat(id, history);   // aparece na lista com o título na hora
    setLoading(true);

    // Aplica o pedaço na cópia do turno e espelha na tela SÓ se a tela ainda for deste turno.
    const aplicar = (patch: (m: AgentMessage) => AgentMessage) => {
      const atualizado = patch(turno[turno.length - 1]);
      turno[turno.length - 1] = atualizado;
      if (turnoNaTelaRef.current !== turnoToken) return;
      setMessages((prev) => { const next = [...prev]; next[next.length - 1] = atualizado; return next; });
    };

    // Grava o parcial durante o stream (rede caindo no meio não perde tudo).
    let ultimoParcial = Date.now();
    const salvarParcial = (agora = false) => {
      if (!persist || !id) return;
      if (!agora && Date.now() - ultimoParcial < 8_000) return;
      ultimoParcial = Date.now(); void saveChat(id, turno);
    };
    const aoEsconder = () => { if (document.visibilityState === "hidden") salvarParcial(true); };
    document.addEventListener("visibilitychange", aoEsconder);

    try {
      await streamAgentChat({
        messages: history, modoTreino, contexto,
        onEvent: (evt) => {
          if (evt.type === "token") aplicar((c) => ({ ...c, content: c.content + evt.text }));
          else if (evt.type === "tool") aplicar((c) => ({ ...c, tools: [...(c.tools || []), { name: evt.name }] }));
          else if (evt.type === "chart") aplicar((c) => ({ ...c, charts: [...(c.charts || []), evt.chart] }));
          else if (evt.type === "memoria") aplicar((c) => ({ ...c, memorias: [...(c.memorias || []), evt.memoria] }));
          else if (evt.type === "revisao") aplicar((c) => ({ ...c, revisao: evt.revisao }));
          else if (evt.type === "aviso") setAviso(evt.message || "Esta resposta saiu sem as memórias treinadas.");
          else if (evt.type === "error") aplicar((c) => ({ ...c, content: `${c.content}${c.content ? "\n\n" : ""}⚠️ ${evt.message || "Falha ao responder."}` }));
          salvarParcial();
        },
      });
    } catch (err) {
      aplicar((c) => ({ ...c, content: `${c.content}${c.content ? "\n\n" : ""}⚠️ ${err instanceof Error ? err.message : "falha de rede"}` }));
    } finally {
      document.removeEventListener("visibilitychange", aoEsconder);
      if (id && emVooRef.current.get(id)?.token === turnoToken) emVooRef.current.delete(id);
      if (turnoNaTelaRef.current === turnoToken) setLoading(false);
      if (persist && id) { const ok = await saveChat(id, turno); if (!ok && turnoNaTelaRef.current === turnoToken) setSaveError(true); }
    }
  }, [chatId, contexto, historyError, loading, loadingHistory, messages, modoTreino, onNeedChatId, persist, saveChat]);

  const reset = useCallback(() => { turnoNaTelaRef.current = null; setMessages([]); setLoading(false); setAviso(null); }, []);

  return { messages, loading, loadingHistory, historyError, aviso, dismissAviso: () => setAviso(null), saveError, dismissSaveError: () => setSaveError(false), send, reset };
}
```

## A.4 `useAgentChats.ts` — histórico com fila por conversa

Três decisões herdadas do Daniel: o **id nasce no cliente** (uuid v4, para a
conversa entrar na lista no mesmo frame); o **save é por substituição** (a
lista inteira, não append); e **uma fila por conversa** (dois saves do mesmo
turno saem em ordem; o mais novo já cobre o antigo).

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentDeleteChat, agentGetChat, agentListChats, agentSaveChat } from "./api";
import type { AgentChatSummary, AgentMessage } from "./types";

export const CHATS_KEY = ["agente", "chats"] as const;
export const chatKey = (id: string) => ["agente", "chat", id] as const;

export function newChatId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });
}
export function titleFrom(messages: AgentMessage[]): string {
  const raw = (messages.find((m) => m.role === "user")?.content || "").trim().replace(/\s+/g, " ");
  return !raw ? "Nova conversa" : raw.length > 42 ? `${raw.slice(0, 42)}…` : raw;
}

const filaPorChat = new Map<string, Promise<void>>();
const ultimoPayload = new Map<string, AgentMessage[]>();
function enfileirar(id: string, tarefa: () => Promise<void>): Promise<void> {
  const anterior = filaPorChat.get(id) ?? Promise.resolve();
  const proxima = anterior.then(tarefa, tarefa);
  filaPorChat.set(id, proxima);
  void proxima.then(() => { if (filaPorChat.get(id) === proxima) filaPorChat.delete(id); });
  return proxima;
}
async function salvarComRetry(id: string, messages: AgentMessage[]) {
  let ultimoErro: unknown;
  for (let t = 0; t < 3; t++) {
    try { return await agentSaveChat(id, messages); }
    catch (err) {
      ultimoErro = err;
      if (/42501|PGRST301|Sessão inválida/i.test(err instanceof Error ? err.message : "")) throw err;   // não melhora insistindo
      if (t < 2) await new Promise((r) => setTimeout(r, 600 * 2 ** t));
    }
  }
  throw ultimoErro;
}

export function useAgentChatsQuery(enabled = true) { return useQuery({ queryKey: CHATS_KEY, queryFn: agentListChats, enabled, staleTime: 60_000 }); }
export function useAgentChatQuery(id: string | null) { return useQuery({ queryKey: chatKey(id ?? "none"), queryFn: () => agentGetChat(id as string), enabled: Boolean(id), staleTime: Infinity }); }

/** Salva (na fila da conversa) e mantém a lista da barra lateral atualizada no mesmo frame. */
export function useSaveAgentChat() {
  const qc = useQueryClient();
  return async (id: string, messages: AgentMessage[]): Promise<boolean> => {
    const title = titleFrom(messages);
    qc.setQueryData<AgentChatSummary[]>(CHATS_KEY, (prev) => {
      const lista = prev ?? []; const atual = lista.find((c) => c.id === id); const agora = new Date().toISOString();
      return [{ id, titulo: title, total_mensagens: messages.length, created_at: atual?.created_at ?? agora, updated_at: agora }, ...lista.filter((c) => c.id !== id)];
    });
    ultimoPayload.set(id, messages);
    let ok = true;
    await enfileirar(id, async () => {
      if (ultimoPayload.get(id) !== messages) return;   // um save mais novo já cobre este
      try {
        const salvo = await salvarComRetry(id, messages);
        qc.setQueryData<AgentChatSummary[]>(CHATS_KEY, (prev) => (prev ?? []).map((c) => (c.id === id ? { ...c, titulo: salvo.titulo, updated_at: salvo.updated_at } : c)));
        qc.setQueryData(chatKey(id), (prev: unknown) => prev && typeof prev === "object" ? { ...(prev as object), mensagens: messages.map((m, i) => ({ ...m, ordem: i })) } : prev);
      } catch (err) { console.error("[agente] falha ao salvar a conversa", err); ok = false; }
    });
    return ok;
  };
}

export function useDeleteAgentChat() {
  const qc = useQueryClient();
  return useMutation({
    // Na mesma fila dos saves: apagar antes de um save pendente faria o save recriar a conversa.
    mutationFn: async (id: string) => { ultimoPayload.delete(id); await enfileirar(id, async () => { await agentDeleteChat(id); }); },
    onMutate: async (id) => { const anterior = qc.getQueryData<AgentChatSummary[]>(CHATS_KEY); qc.setQueryData<AgentChatSummary[]>(CHATS_KEY, (prev) => (prev ?? []).filter((c) => c.id !== id)); return { anterior }; },
    onError: (_e, _id, ctx) => { if (ctx?.anterior) qc.setQueryData(CHATS_KEY, ctx.anterior); },
    onSettled: (_d, _e, id) => { qc.removeQueries({ queryKey: chatKey(id) }); },
  });
}
```

## A.5 `useAgentMemories.ts`

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentDeleteMemory, agentDeleteSeedMemories, agentListMemories, agentSalvarMemoria } from "./api";
import type { MemoryInput } from "./types";

export const MEMORIES_KEY = ["agente", "memories"] as const;
/** refetchInterval curto é o "ao vivo" do grafo; false desliga o polling. */
export function useMemoriesQuery(enabled = true, refetchInterval: number | false = false) {
  return useQuery({ queryKey: MEMORIES_KEY, queryFn: agentListMemories, enabled, staleTime: 30_000, refetchInterval, refetchIntervalInBackground: false });
}
export function useSaveMemory() { const qc = useQueryClient(); return useMutation({ mutationFn: (i: MemoryInput) => agentSalvarMemoria(i), onSuccess: () => qc.invalidateQueries({ queryKey: MEMORIES_KEY }) }); }
export function useDeleteMemory() { const qc = useQueryClient(); return useMutation({ mutationFn: (n: string) => agentDeleteMemory(n), onSuccess: () => qc.invalidateQueries({ queryKey: MEMORIES_KEY }) }); }
export function useDeleteSeedMemories() { const qc = useQueryClient(); return useMutation({ mutationFn: () => agentDeleteSeedMemories(), onSuccess: () => qc.invalidateQueries({ queryKey: MEMORIES_KEY }) }); }
```

## A.6 Componentes do chat

### `AgentComposer.tsx`

Textarea que cresce até 200 px (112 no balão); Enter envia, Shift+Enter
quebra linha; botão **Treinar** (`role="switch"`, só para quem pode treinar)
que muda a borda para a cor primária e o placeholder para "Ensine, corrija ou
explique algo…"; botão de enviar redondo com `Loader2` girando enquanto
carrega; `disabled` quando o histórico está carregando ou falhou.

### `AgentMessages.tsx`

Lista rolável que vai ao fim a cada mudança. Mensagem do usuário: balão à
direita. Mensagem do agente: avatar + (chips de ferramenta) + Markdown +
`ThinkingDots` enquanto a última ainda chega + gráficos + cards de memória +
notas médias da revisão (só quando não está mais carregando). Enquanto não há
texto: "Analisando os dados…" se já houve tool, senão "Pensando…".

### `ChatActivity.tsx` — chips de ferramenta em linguagem de gente

```ts
// Mapeie CADA tool para área + detalhe + ícone + cor. O identificador nunca aparece.
const TOOL_INFO: Record<string, { area: string; detail: string; icon: LucideIcon; tone: string }> = {
  painel_<<tela>>:     { area: "<<Tela>>",          detail: "Cards e gráficos da tela",   icon: BarChart3, tone: "text-primary bg-primary/10" },
  listar_pessoas:      { area: "Time",              detail: "Lista de pessoas",           icon: Users,     tone: "text-amber-600 bg-amber-500/10" },
  consultar_banco:     { area: "Banco de dados",    detail: "Consulta SQL",               icon: Database,  tone: "text-muted-foreground bg-muted" },
  "buscar_<<base>>":   { area: "<<Base>>",          detail: "<<o que tem>>",              icon: BookOpen,  tone: "text-emerald-600 bg-emerald-500/10" },
  gerar_grafico:       { area: "Gráfico",           detail: "Montando a visualização",    icon: BarChart3, tone: "text-primary bg-primary/10" },
  salvar_memoria:      { area: "Cérebro",           detail: "Gravando o aprendizado",     icon: Brain,     tone: "text-primary bg-primary/10" },
};
// ToolActivity agrupa chamadas consecutivas da mesma tool ("· 3 consultas"), mostra
// "Consultando <área>" com spinner na última enquanto ativa e "Consultou" com check depois.
// MemoryCard: "Aprendido · <tipo>" + descrição + tags.
// RevisaoNotas: <details> com as ressalvas de gravidade "media" (as altas já entraram no texto;
// as baixas e a "(verificador indisponível)" não aparecem).
```

### `Markdown.tsx`

`react-markdown` + `remark-gfm` com componentes estilizados pelos tokens do
tema (tabela com `overflow-x-auto`, `code` inline com borda, `blockquote` com
barra primária). Suporte a tabela GFM não é opcional: o agente é instruído a
usar tabelas curtas.

### `ChartCard.tsx`

Recharts: `PieChart` (uma série, `Cell` por fatia), `BarChart`, `AreaChart`
(`fillOpacity 0.18`), `LineChart` (`dot={false}`). Paleta pelos tokens
`--chart-1..8` do tema, eixos com `--chart-axis`, grade `--chart-grid`,
tooltip com `--card`/`--border`. Altura 260. Formata números em `pt-BR`.
A spec já vem normalizada do servidor; não valide de novo.

### `AgentChat.tsx` — tela cheia

Duas colunas: `aside` com "Nova conversa" e a lista (título, data curta,
lixeira no hover); `section` com o estado vazio (avatar + "Bom dia, Nome" +
composer + 6 chips de sugestão que representam o que o agente faz de melhor +
uma linha explicando de onde vêm os números) ou a conversa (mensagens +
composer + "pode cometer erros. Confira na tela correspondente."). Avisos
(`saveError`, `aviso`) aparecem acima do composer com botão "Entendi".
`modoTreino` só com `canTrain`.

### `AgentWidget.tsx` — o balão

Botão fixo no canto inferior direito (`aria-label` que muda com o estado);
painel de 420 px × 640 px com cabeçalho em gradiente, link "abrir em tela
cheia", 3 sugestões quando vazio, mensagens em modo `compact`, composer
compacto. **Some na rota da tela cheia.** A conversa é da sessão
(`persist: false`).

## A.7 Contexto da tela e montagem no layout

```tsx
// No layout que já tem período/filtros na barra lateral:
const agenteContexto = useMemo<AgentContexto>(() => ({
  de: dateRange.from, ate: dateRange.to,
  filtro_id: agentFilter, filtro_nome: agentName,
  usuario_nome: fullName, usuario_role: role,
  tela: pathname,
}), [dateRange, agentFilter, agentName, fullName, role, pathname]);
// ...
<AgentWidget contexto={agenteContexto} />

// Rotas (lazy): /dashboard/agente → DashboardAgente; /dashboard/agente/cerebro → DashboardAgenteCerebro
// A rota do cérebro entra na lista de rotas só-administrador do layout.
// Sidebar: item "<<NOME>>" para todos da área; "Cérebro de <<NOME>>" só para quem treina.
```

Custa quase nada e muda a experiência: sem isso toda pergunta precisa
carregar as datas dentro dela.

## A.8 Erros que só aparecem depois

| sintoma | causa | conserto |
| --- | --- | --- |
| Preâmbulo colado na resposta | tool-use no meio do turno | o backend injeta `\n\n`; não conserte no front |
| "Carregando" para sempre | stream morreu sem `done` | orçamento de tempo no backend; `finally` no hook |
| Duas respostas se misturam | falta de token por turno | `Symbol` por envio comparado antes de aplicar |
| Conversa reabre sem gráficos | save guardou só o texto | persistir os blocos ricos |
| Resposta parece destreinada | recall falhou em silêncio | evento `aviso` visível |
| Acentos errados | decode por chunk sem `stream: true` | `decoder.decode(value, { stream: true })` |
| Conversa gravada só com a pergunta | save leu o estado da tela | turno em voo fora do React |
| Conversa apagada voltou | save pendente depois do delete | delete na mesma fila dos saves |
| Enviar com histórico carregando apagou a conversa | save por substituição sem as mensagens antigas | travar o envio enquanto `loadingHistory`/`historyError` |

---

# Parte B — Skill `cerebro-grafo` (a tela do segundo cérebro, estilo Obsidian)

Copie o bloco abaixo, do `---` inicial ao fim, para
`.claude/skills/cerebro-grafo/SKILL.md` no projeto do cliente.

---
name: cerebro-grafo
description: Constrói a tela "cérebro" de um agente de IA como um grafo ao vivo no estilo Obsidian — cada memória é um nó, ligações por wikilinks e tags, nós arrastáveis, painel de forças, filtro por tipo, busca, faixa de métricas, console de treino e memórias novas que nascem animadas. Use quando alguém pedir para visualizar a memória de um agente, um grafo de conhecimento, um "Obsidian graph view" em React, ou a tela de treino de um agente.
---

# Cérebro em grafo (estilo Obsidian)

Esta skill constrói a tela onde o usuário **vê e treina** a memória de um
agente de IA: um grafo ao vivo em canvas, cada bolinha é uma memória, cada
linha uma relação. Vem do `LyaBrainGraph` (XMX, em produção desde
07/09/2026), herdeiro do `BrainGraph` "constelação" do Daniel (CBIE).

O ponto da tela não é ser bonita: é o usuário **enxergar o que o agente já
sabe** — o que está denso, o que está solto, o que ninguém ensinou ainda. Mas
ela precisa ser bonita para o usuário querer abrir. As duas coisas.

## Quando usar

- "quero ver a memória do meu agente" · "faz um grafo tipo Obsidian"
- "a tela de treino do agente" · "grafo de conhecimento em React"

## Pré-requisitos

- Uma tabela de memórias com `name` (slug), `description`, `type`
  (`user | feedback | project | reference | nota`), `tags` (array), `body`
  (markdown com `[[wikilinks]]`), `seed`, `created_at`, `updated_at`, e uma
  forma de listar/gravar/apagar (RPCs ou endpoints). Ver `02-BACKEND` Parte I.
- Um hook de query que aceite `refetchInterval` (é o "ao vivo").

## O que construir

Uma página com três partes:

1. **Faixa de métricas** (ticker) no topo: memórias, treinadas hoje,
   conexões, mais conectada, contagem por tipo, tags, último treino.
2. **Aba Grafo**: o canvas em fundo escuro, legenda com filtro por tipo,
   busca, painel de ajustes, painel lateral do nó ou "últimos treinos", botão
   "Ensinar algo novo", botão "Remover exemplos" (quando há seed).
3. **Aba Treinar**: guia recolhível + compositor (título, tipo com opção
   "Automático", detalhe, tags) + biblioteca com busca, filtro por tipo,
   editar e apagar.

As duas abas leem a **mesma query**: treinar na segunda faz o nó nascer na
primeira.

---

## Passo 1 — Dependência e montagem

```bash
npm i react-force-graph-2d@1.29.1
```

Importe **preguiçosamente**. A biblioteca é pesada e toca `window` no topo do
módulo: importada direto, quebra SSR e pesa no bundle de quem nunca abre a
tela.

```tsx
// Vite/React Router
const ForceGraph2D = lazy(() => import("react-force-graph-2d"));
// Next.js
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });
```

O canvas precisa de largura e altura em número. Meça com `ResizeObserver`.

## Passo 2 — Montar o grafo a partir das memórias (`graph.ts`)

**Não crie tabela de arestas.** As relações são derivadas da própria memória,
no navegador (o Daniel fazia isso no backend, em `/brain/graph`; tanto faz,
a lógica é a mesma). Duas fontes: `[[wikilinks]]` no corpo (relação
explícita) e tags em comum (relação implícita, **em cadeia**).

```ts
import type { Memory, MemoryType } from "./types";

export interface GraphNode { id: string; label: string; type: MemoryType; tags: string[]; val: number; updated_at: string; created_at: string }
export interface GraphLink { source: string; target: string; kind: "link" | "tag" }
export interface BrainGraph { nodes: GraphNode[]; links: GraphLink[] }

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** TEM de ser idêntico ao slugify do backend e do banco. */
export function slugify(s: string, n = 60): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n);
}

export function buildGraph(memorias: Memory[]): BrainGraph {
  const nomes = new Set(memorias.map((m) => m.name));
  const nodes = new Map<string, GraphNode>();
  for (const m of memorias) nodes.set(m.name, { id: m.name, label: m.description || m.name, type: m.type, tags: m.tags ?? [], val: 1, updated_at: m.updated_at, created_at: m.created_at });

  const links: GraphLink[] = [];
  const vistos = new Set<string>();
  const addLink = (a: string, b: string, kind: GraphLink["kind"]) => {
    if (a === b) return;                                   // sem laço
    const key = [a, b].sort().join("|") + kind;            // sem duplicata
    if (vistos.has(key)) return;
    vistos.add(key); links.push({ source: a, target: b, kind });
  };
  // 1) wikilinks explícitos (ignora link para memória inexistente)
  for (const m of memorias) for (const match of (m.body || "").matchAll(WIKILINK)) { const alvo = slugify(match[1]); if (nomes.has(alvo)) addLink(m.name, alvo, "link"); }
  // 2) tags em comum → CADEIA por tag (a → b → c), nunca todos com todos
  const porTag = new Map<string, string[]>();
  for (const m of memorias) for (const t of m.tags ?? []) { const l = porTag.get(t) ?? []; l.push(m.name); porTag.set(t, l); }
  for (const arr of porTag.values()) for (let i = 0; i < arr.length - 1; i++) addLink(arr[i], arr[i + 1], "tag");
  // val = 1 + grau
  const grau = new Map<string, number>();
  for (const l of links) { grau.set(l.source, (grau.get(l.source) ?? 0) + 1); grau.set(l.target, (grau.get(l.target) ?? 0) + 1); }
  for (const [id, n] of nodes) n.val = 1 + (grau.get(id) ?? 0);
  return { nodes: [...nodes.values()], links };
}

/** "agora", "há 2 min", "há 3 h", "há 4 d", "há 2 m" */
export function desde(iso: string, agora = Date.now()): string {
  const ms = agora - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60_000); if (min < 1) return "agora"; if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60); if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24); return d < 30 ? `há ${d} d` : `há ${Math.floor(d / 30)} m`;
}
```

> **A regra da cadeia é obrigatória.** Ligar todas as memórias que compartilham
> uma tag umas às outras cresce ao quadrado: 20 memórias com a mesma tag viram
> 190 arestas e o grafo vira um novelo. A cadeia dá 19 e lê igual.

Teste (`graph.test.ts`): wikilink resolvendo slug com acento e maiúscula;
cadeia por tag; `val` = 1 + grau; sem duplicata nem laço; wikilink para
memória inexistente ignorado; `slugify` igual ao SQL; `desde`.

## Passo 3 — O componente `BrainGraph.tsx` (código de referência completo)

```tsx
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import { Brain, Eraser, Maximize2, Pencil, RotateCcw, Search, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { buildGraph, desde, type BrainGraph as Graph, type GraphLink, type GraphNode } from "../graph";
import { TIPO_MEMORIA_MAP, TIPOS_MEMORIA, type Memory, type MemoryType } from "../types";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

const NASC_MS = 2400;                       // duração do nascimento
const AJUSTES_KEY = "agente-grafo-ajustes";  // localStorage

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Cores dos "groups" (Obsidian-like), legíveis sobre o fundo escuro.
const COR_TIPO: Record<MemoryType, string> = {
  feedback: "#fbbf24",   // âmbar — preferências
  user: "#60a5fa",       // azul — sobre o agente
  project: "#a78bfa",    // roxo — projetos/hubs
  reference: "#34d399",  // verde — referências
  nota: "#cbd5e1",       // cinza claro — notas
};
const HALO = "#a78bfa";

type NodeExtra = GraphNode & { _born?: number };
type NodeRuntime = NodeObject<NodeExtra>;
type LinkRuntime = LinkObject<NodeExtra, GraphLink>;
type FgRef = ForceGraphMethods<NodeRuntime, LinkRuntime>;
type Endpoint = string | number | NodeRuntime | undefined;
// A biblioteca MUTA source/target: começam string e viram o objeto do nó.
const idOf = (v: Endpoint) => (typeof v === "object" && v ? String(v.id ?? "") : String(v ?? ""));
function hexToRgba(hex: string, a: number) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

// ── Ajustes (as "Forces" e "Display" do Obsidian) ───────────────────────────
interface Ajustes {
  repulsao: number; distancia: number; centro: number; tamanho: number; espessura: number;
  rotulos: "auto" | "sempre" | "nunca"; fixar: boolean; orfaos: boolean; tipos: Record<MemoryType, boolean>;
}
const AJUSTES_PADRAO: Ajustes = {
  repulsao: 170, distancia: 60, centro: 0.06, tamanho: 1, espessura: 1, rotulos: "auto", fixar: true, orfaos: true,
  tipos: { feedback: true, user: true, project: true, reference: true, nota: true },
};
function lerAjustes(): Ajustes {
  try { const raw = window.localStorage.getItem(AJUSTES_KEY); if (!raw) return AJUSTES_PADRAO; const p = JSON.parse(raw) as Partial<Ajustes>; return { ...AJUSTES_PADRAO, ...p, tipos: { ...AJUSTES_PADRAO.tipos, ...(p.tipos ?? {}) } }; }
  catch { return AJUSTES_PADRAO; }
}

export function BrainGraph({ memorias, carregando, treinando, onEditar, onApagar, onEnsinar, onRemoverExemplos }: {
  memorias: Memory[]; carregando: boolean;
  treinando: boolean;                        // true enquanto o treinador classifica
  onEditar: (m: Memory) => void; onApagar: (name: string) => void; onEnsinar: () => void;
  onRemoverExemplos?: () => void;            // só aparece quando há seed
}) {
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [] });
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [novaMemoria, setNovaMemoria] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [ajustes, setAjustes] = useState<Ajustes>(lerAjustes);
  const [painelAjustes, setPainelAjustes] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FgRef | undefined>(undefined);
  const graphRef = useRef<Graph>({ nodes: [], links: [] });
  const fitDoneRef = useRef(false);
  const primeiraRef = useRef(true);

  const porNome = useMemo(() => new Map(memorias.map((m) => [m.name, m])), [memorias]);
  const temExemplos = useMemo(() => memorias.some((m) => m.seed), [memorias]);

  useEffect(() => { graphRef.current = graph; }, [graph]);
  useEffect(() => { try { window.localStorage.setItem(AJUSTES_KEY, JSON.stringify(ajustes)); } catch { /* noop */ } }, [ajustes]);
  const setAjuste = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => setAjustes((a) => ({ ...a, [k]: v }));

  // ── AO VIVO: funde o grafo fresco no atual PRESERVANDO as posições ────────
  // setGraph(buildGraph(...)) a cada volta reiniciaria a simulação e todos os nós
  // saltariam. Aqui só nós/arestas realmente novos entram (novos ganham _born).
  useEffect(() => {
    if (carregando && memorias.length === 0) return;
    const fresh = buildGraph(memorias);
    const prev = graphRef.current;
    if (primeiraRef.current || prev.nodes.length === 0) { primeiraRef.current = false; setGraph(fresh); return; }
    const conhecidos = new Map((prev.nodes as NodeRuntime[]).map((n) => [n.id, n]));
    const freshIds = new Set(fresh.nodes.map((n) => n.id));
    const nodes: NodeRuntime[] = (prev.nodes as NodeRuntime[]).filter((n) => freshIds.has(n.id));   // some quem foi apagado
    const nascidos: GraphNode[] = [];
    const agora = performance.now();
    for (const fn of fresh.nodes) {
      const velho = conhecidos.get(fn.id);
      if (velho) { velho.val = fn.val; velho.label = fn.label; velho.tags = fn.tags; velho.type = fn.type; velho.updated_at = fn.updated_at; }  // mesmo objeto: x,y,vx,vy preservados
      else { nodes.push({ ...fn, _born: agora }); nascidos.push(fn); }
    }
    const chave = (l: LinkRuntime) => [idOf(l.source), idOf(l.target)].sort().join("|") + l.kind;
    const frescas = new Set(fresh.links.map((l) => chave(l as LinkRuntime)));
    const links = (prev.links as LinkRuntime[]).filter((l) => frescas.has(chave(l)));
    const conhecidas = new Set(links.map(chave));
    for (const l of fresh.links) if (!conhecidas.has(chave(l as LinkRuntime))) links.push(l);
    const mudou = nascidos.length > 0 || links.length !== prev.links.length || nodes.length !== prev.nodes.length;
    if (!mudou) return;
    setGraph({ nodes, links });
    if (nascidos.length) { setNovaMemoria(nascidos[nascidos.length - 1].label); try { fgRef.current?.d3ReheatSimulation(); } catch { /* noop */ } }
  }, [memorias, carregando]);

  useEffect(() => { if (!novaMemoria) return; const t = setTimeout(() => setNovaMemoria(null), 4200); return () => clearTimeout(t); }, [novaMemoria]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current); return () => ro.disconnect();
  }, []);

  // O canvas nasce com tamanho padrão e só depois recebe o real: reenquadra quando as dimensões mudam.
  useEffect(() => { if (!fitDoneRef.current) return; const t = window.setTimeout(() => fgRef.current?.zoomToFit(400, 90), 50); return () => window.clearTimeout(t); }, [dims]);

  // ── Filtro por tipo / órfãos: MESMOS objetos de nó (posições preservadas) ──
  const visivel = useMemo<Graph>(() => {
    const ok = new Set((graph.nodes as NodeRuntime[]).filter((n) => ajustes.tipos[n.type]).map((n) => String(n.id)));
    const links = (graph.links as LinkRuntime[]).filter((l) => ok.has(idOf(l.source)) && ok.has(idOf(l.target)));
    let nodes = (graph.nodes as NodeRuntime[]).filter((n) => ok.has(String(n.id)));
    if (!ajustes.orfaos) { const com = new Set<string>(); for (const l of links) { com.add(idOf(l.source)); com.add(idOf(l.target)); } nodes = nodes.filter((n) => com.has(String(n.id))); }
    return { nodes, links };
  }, [graph, ajustes.tipos, ajustes.orfaos]);

  // ── Forças ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current; if (!fg || !visivel.nodes.length) return;
    try {
      const charge = fg.d3Force("charge") as { strength?: (v: number) => unknown; distanceMax?: (v: number) => unknown } | undefined;
      charge?.strength?.(-ajustes.repulsao); charge?.distanceMax?.(800);   // sem teto, grafo grande fica lento
      const link = fg.d3Force("link") as { distance?: (fn: (l: LinkRuntime) => number) => unknown } | undefined;
      link?.distance?.((l) => (l.kind === "link" ? ajustes.distancia * 1.15 : ajustes.distancia * 0.7));   // wikilink é relação forte
      (fg.d3Force("center") as { strength?: (v: number) => unknown } | undefined)?.strength?.(ajustes.centro);
      fg.d3ReheatSimulation();
    } catch { /* noop */ }
  }, [visivel, ajustes.repulsao, ajustes.distancia, ajustes.centro]);

  const focoId = sel ?? hover;
  const vizinhos = useMemo(() => {
    if (!focoId) return new Set<string>();
    const s = new Set<string>([focoId]);
    for (const l of visivel.links as LinkRuntime[]) { const a = idOf(l.source), b = idOf(l.target); if (a === focoId) s.add(b); if (b === focoId) s.add(a); }
    return s;
  }, [focoId, visivel.links]);
  // Busca: quem casa acende, o resto APAGA (não some — o usuário mantém a referência espacial).
  const buscados = useMemo(() => { const q = busca.trim().toLowerCase(); if (!q) return null; return new Set(visivel.nodes.filter((n) => `${n.label} ${n.tags.join(" ")}`.toLowerCase().includes(q)).map((n) => n.id)); }, [busca, visivel.nodes]);

  // Raio pela RAIZ do grau (linear faria um hub dominar a tela).
  const raio = useCallback((n: NodeRuntime) => (2 + Math.sqrt(n.val) * 1.6) * ajustes.tamanho, [ajustes.tamanho]);

  const desenharNo = useCallback((node: NodeRuntime, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node;
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;   // a simulação pode chamar antes de atribuir x/y
    const x = n.x as number, y = n.y as number;
    const cor = COR_TIPO[n.type] ?? COR_TIPO.nota;
    const apagadoPelaBusca = buscados ? !buscados.has(n.id) : false;
    const emFoco = (!focoId || vizinhos.has(n.id)) && !apagadoPelaBusca;
    const r = raio(n);

    // ── nascimento: bloom + 3 ondas + pop com overshoot (~2,4 s, uma vez) ──
    let bp = -1;
    if (n._born != null) { bp = (performance.now() - n._born) / NASC_MS; if (bp >= 1) { n._born = undefined; bp = -1; } }
    const nascendo = bp >= 0; const q = nascendo ? 1 - bp : 0;
    if (nascendo) {
      const bloomR = r + easeOutCubic(clamp01(bp / 0.8)) * (26 + n.val * 2.5); const fade = Math.pow(q, 1.4);
      ctx.save();
      const grad = ctx.createRadialGradient(x, y, 0, x, y, bloomR);
      grad.addColorStop(0, hexToRgba(cor, 0.5 * fade)); grad.addColorStop(0.4, hexToRgba(HALO, 0.25 * fade)); grad.addColorStop(1, hexToRgba(HALO, 0));
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, bloomR, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const start = i * 0.16; const rp = clamp01((bp - start) / (1 - start)); if (rp <= 0 || rp >= 1) continue;
        const rr = r + easeOutCubic(rp) * (34 + i * 12); const a = Math.pow(1 - rp, 2) * (0.6 - i * 0.14);
        ctx.beginPath(); ctx.strokeStyle = hexToRgba(cor, a); ctx.lineWidth = (1.4 - i * 0.35) / Math.max(0.6, scale);
        ctx.shadowColor = cor; ctx.shadowBlur = 10 * (1 - rp); ctx.arc(x, y, rr, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.restore();
    }
    const escala = nascendo ? Math.max(0.12, easeOutBack(clamp01(bp / 0.55))) : 1;
    const rEff = r * escala;
    const brilho = (focoId === n.id ? 22 : emFoco ? 10 : 2) + q * 24;

    ctx.save();
    ctx.globalAlpha = emFoco ? 1 : 0.18;
    ctx.shadowColor = nascendo ? "#ffffff" : cor; ctx.shadowBlur = brilho;
    ctx.beginPath(); ctx.arc(x, y, rEff, 0, 2 * Math.PI); ctx.fillStyle = cor; ctx.fill();
    if (focoId === n.id) { ctx.shadowBlur = brilho * 1.6; ctx.fill(); ctx.lineWidth = 1.2 / scale; ctx.strokeStyle = "#ffffff"; ctx.stroke(); }
    // nó fixado (arrastado): anel discreto, como o Obsidian marca nó "preso"
    if (n.fx != null && !nascendo) { ctx.beginPath(); ctx.arc(x, y, rEff + 2 / scale, 0, 2 * Math.PI); ctx.lineWidth = 0.8 / scale; ctx.strokeStyle = hexToRgba(cor, 0.6); ctx.shadowBlur = 0; ctx.stroke(); }
    ctx.restore();

    // rótulo: auto = zoom próximo (scale > 1.3) ou vizinhança em foco ou resultado da busca
    const mostrar = ajustes.rotulos === "sempre" || (ajustes.rotulos === "auto" && (scale > 1.3 || (focoId != null && vizinhos.has(n.id)) || (buscados?.has(n.id) ?? false)));
    if (mostrar && emFoco) {
      const fonte = 12 / scale;   // 12 px de TELA sempre. SEM piso: com Math.max o texto cresce junto com o zoom.
      ctx.font = `${focoId === n.id ? 600 : 400} ${fonte}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 4;
      ctx.fillStyle = focoId === n.id ? "#ffffff" : "#c7d2fe";
      ctx.globalAlpha = ajustes.rotulos === "auto" && scale > 1.3 && focoId == null && !buscados ? Math.min(1, (scale - 1.3) / 1.2 + 0.4) : 1;
      ctx.fillText(n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label, x, y + r + 4 / scale);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
  }, [focoId, vizinhos, buscados, raio, ajustes.rotulos]);

  const linkEmFoco = useCallback((l: LinkRuntime) => focoId != null && (idOf(l.source) === focoId || idOf(l.target) === focoId), [focoId]);
  const linkNascendo = useCallback((l: LinkRuntime) => { const nasc = (x: Endpoint) => typeof x === "object" && x != null && x._born != null; return nasc(l.source) || nasc(l.target); }, []);

  const reiniciarLayout = () => { for (const n of graph.nodes as NodeRuntime[]) { n.fx = undefined; n.fy = undefined; } fitDoneRef.current = false; try { fgRef.current?.d3ReheatSimulation(); } catch { /* noop */ } };
  // Teto no zoom: com 3–4 memórias o zoomToFit amplia até os nós virarem bolhas gigantes.
  const enquadrar = () => { const fg = fgRef.current; fg?.zoomToFit(500, 90); window.setTimeout(() => { try { if (fg && fg.zoom() > 2.2) fg.zoom(2.2, 400); } catch { /* noop */ } }, 550); };

  const selecionada = sel ? porNome.get(sel) ?? null : null;
  const recentes = useMemo(() => [...memorias].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6), [memorias]);
  const ocultos = graph.nodes.length - visivel.nodes.length;

  return (
    <div className="relative h-[calc(100dvh-13.5rem)] min-h-[520px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10"
         style={{ background: "radial-gradient(ellipse at 50% 30%, #161a33 0%, #0b0d1f 55%, #05060f 100%)" }}>

      {/* legenda / status / filtro por tipo (clicar liga e desliga) */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-slate-300 shadow-2xl backdrop-blur-md">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-100"><Brain className="h-4 w-4" style={{ color: HALO }} /> Cérebro de <<NOME>></span>
        <span className="flex items-center gap-2 text-[11px] text-slate-400">
          {carregando && graph.nodes.length === 0 ? "carregando…" : <>{visivel.nodes.length} memórias · {visivel.links.length} conexões{ocultos > 0 && <span className="text-slate-500"> · {ocultos} ocultas</span>}</>}
          <span className="flex items-center gap-1 text-emerald-400/90">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>
            ao vivo
          </span>
        </span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {TIPOS_MEMORIA.map((tp) => { const on = ajustes.tipos[tp.value]; return (
            <button key={tp.value} type="button" onClick={() => setAjuste("tipos", { ...ajustes.tipos, [tp.value]: !on })} title={on ? `Ocultar ${tp.label}` : `Mostrar ${tp.label}`}
                    className={cn("flex items-center gap-1.5 text-[11px] transition-opacity", on ? "text-slate-300" : "text-slate-500 opacity-50 line-through")}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: COR_TIPO[tp.value], boxShadow: on ? `0 0 6px ${COR_TIPO[tp.value]}` : "none" }} />{tp.label}
            </button>); })}
        </div>
        {temExemplos && onRemoverExemplos && (
          <button type="button" onClick={onRemoverExemplos} className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10" title="Apaga só as memórias de exemplo">
            <Eraser className="h-3 w-3" /> Remover exemplos
          </button>)}
      </div>

      {/* busca */}
      <div className="absolute left-1/2 top-4 z-10 hidden -translate-x-1/2 md:block">
        <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200 shadow-2xl backdrop-blur-md focus-within:border-white/30">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cérebro…" className="w-44 bg-transparent outline-none placeholder:text-slate-500" />
          {busca && <button type="button" onClick={() => setBusca("")} className="text-slate-400 hover:text-white" aria-label="Limpar busca"><X className="h-3.5 w-3.5" /></button>}
        </label>
      </div>

      {/* treinando (o treinador está classificando) */}
      {treinando && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/40 px-5 py-2.5 text-sm text-slate-100 shadow-2xl backdrop-blur-xl">
            <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: HALO }} /><span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: HALO }} /></span>
            <<NOME>> está aprendendo…
          </div>
        </div>)}

      {/* toast: nasceu uma memória */}
      {novaMemoria && !treinando && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-xs text-slate-100 shadow-2xl backdrop-blur-xl">
            <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: HALO }} /><span className="text-slate-400">nova memória:</span><span className="max-w-[280px] truncate font-medium">{novaMemoria}</span>
          </div>
        </div>)}

      {/* barra inferior: ajustes + ações */}
      <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
        <div className="flex flex-col items-start gap-2">
          {painelAjustes && (
            <div className="w-64 rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 text-xs text-slate-200 shadow-2xl backdrop-blur-xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Forças</p>
              <Controle label="Repulsão" valor={ajustes.repulsao} min={30} max={500} step={10} onChange={(v) => setAjuste("repulsao", v)} />
              <Controle label="Distância das ligações" valor={ajustes.distancia} min={15} max={200} step={5} onChange={(v) => setAjuste("distancia", v)} />
              <Controle label="Força central" valor={ajustes.centro} min={0} max={0.5} step={0.01} onChange={(v) => setAjuste("centro", v)} fmt={(v) => v.toFixed(2)} />
              <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Exibição</p>
              <Controle label="Tamanho dos nós" valor={ajustes.tamanho} min={0.5} max={2.5} step={0.1} onChange={(v) => setAjuste("tamanho", v)} fmt={(v) => `${v.toFixed(1)}×`} />
              <Controle label="Espessura das linhas" valor={ajustes.espessura} min={0.3} max={3} step={0.1} onChange={(v) => setAjuste("espessura", v)} fmt={(v) => `${v.toFixed(1)}×`} />
              <div className="mt-2 flex items-center justify-between"><span>Rótulos</span>
                <div className="inline-flex rounded-md border border-white/10 p-0.5">
                  {(["auto", "sempre", "nunca"] as const).map((r) => (
                    <button key={r} type="button" onClick={() => setAjuste("rotulos", r)} className={cn("rounded px-2 py-0.5 text-[11px] capitalize", ajustes.rotulos === r ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200")}>{r}</button>))}
                </div></div>
              <label className="mt-2 flex items-center justify-between"><span>Fixar nó ao arrastar</span><Switch checked={ajustes.fixar} onCheckedChange={(v) => setAjuste("fixar", v)} className="scale-75" /></label>
              <label className="mt-1 flex items-center justify-between"><span>Mostrar órfãos</span><Checkbox checked={ajustes.orfaos} onCheckedChange={(v) => setAjuste("orfaos", v === true)} className="border-white/40" /></label>
              <button type="button" onClick={() => setAjustes(AJUSTES_PADRAO)} className="mt-3 w-full rounded-md border border-white/10 py-1 text-[11px] text-slate-300 hover:bg-white/10">Restaurar padrão</button>
            </div>)}
          <div className="flex items-center gap-1.5">
            <BotaoFlutuante on={painelAjustes} onClick={() => setPainelAjustes((v) => !v)} title="Ajustes do grafo"><Settings2 className="h-3.5 w-3.5" /> Ajustes</BotaoFlutuante>
            <BotaoFlutuante onClick={enquadrar} title="Enquadrar tudo"><Maximize2 className="h-3.5 w-3.5" /></BotaoFlutuante>
            <BotaoFlutuante onClick={reiniciarLayout} title="Soltar os nós fixados e reorganizar"><RotateCcw className="h-3.5 w-3.5" /></BotaoFlutuante>
            <span className="ml-2 hidden text-[11px] text-slate-500 lg:inline">arraste os nós · scroll para zoom · clique para abrir</span>
          </div>
        </div>
      </div>

      <button type="button" onClick={onEnsinar} className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-4 py-2 text-xs font-medium text-slate-100 shadow-2xl backdrop-blur-xl transition-colors hover:bg-white/[0.14]">
        <Sparkles className="h-3.5 w-3.5" style={{ color: HALO }} /> Ensinar algo novo
      </button>

      {/* painel lateral: memória selecionada ou últimos treinos */}
      <div className="absolute right-4 top-4 z-10 w-80 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-slate-200 shadow-2xl backdrop-blur-xl">
        {selecionada ? (<>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: hexToRgba(COR_TIPO[selecionada.type], 0.18), color: COR_TIPO[selecionada.type] }}>{TIPO_MEMORIA_MAP[selecionada.type]?.label ?? selecionada.type}</span>
              {selecionada.seed && <span className="text-[10px] uppercase tracking-wide text-slate-500">exemplo</span>}
            </span>
            <button type="button" onClick={() => setSel(null)} className="text-slate-400 hover:text-white" aria-label="Fechar"><X className="h-4 w-4" /></button>
          </div>
          <h3 className="text-sm font-semibold leading-snug">{selecionada.description || selecionada.name}</h3>
          {selecionada.body && (
            <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">
              {/* [[wikilinks]] viram links que selecionam o nó de destino */}
              {selecionada.body.split(/(\[\[[^\]]+\]\])/g).map((parte, i) => {
                const m = /^\[\[([^\]]+)\]\]$/.exec(parte); if (!m) return <span key={i}>{parte}</span>;
                const alvo = graph.nodes.find((n) => n.label === m[1] || n.id === m[1]);
                return <button key={i} type="button" onClick={() => alvo && setSel(String(alvo.id))} className="text-violet-300 underline decoration-violet-500/50 underline-offset-2 hover:text-white">{m[1]}</button>;
              })}
            </p>)}
          {selecionada.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">{selecionada.tags.map((tg) => (
              <button key={tg} type="button" onClick={() => setBusca(tg)} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200">#{tg}</button>))}</div>)}
          <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-500">{Math.max(0, vizinhos.size - 1)} conexõe(s) · atualizada {desde(selecionada.updated_at)}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => onEditar(selecionada)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] hover:bg-white/10"><Pencil className="h-3.5 w-3.5" /> Editar</button>
            <button type="button" onClick={() => { setSel(null); onApagar(selecionada.name); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Apagar</button>
          </div>
        </>) : (<>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Últimos treinos</p>
          {recentes.length === 0 ? <p className="mt-2 text-[12px] text-slate-400"><<NOME>> ainda não tem memórias. Ensine a primeira.</p> : (
            <ul className="mt-2 space-y-1.5">{recentes.map((m) => (
              <li key={m.name}><button type="button" onClick={() => setSel(m.name)} onMouseEnter={() => setHover(m.name)} onMouseLeave={() => setHover(null)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: COR_TIPO[m.type], boxShadow: `0 0 6px ${COR_TIPO[m.type]}` }} />
                <span className="min-w-0"><span className="block truncate text-[12.5px] text-slate-100">{m.description || m.name}</span><span className="block text-[10.5px] text-slate-500">{TIPO_MEMORIA_MAP[m.type]?.label ?? m.type} · {desde(m.updated_at)}</span></span>
              </button></li>))}</ul>)}
        </>)}
      </div>

      <div ref={wrapRef} className={cn("h-full w-full", carregando && graph.nodes.length === 0 && "opacity-0")}>
        <Suspense fallback={null}>
          <ForceGraph2D
            ref={fgRef} graphData={visivel} width={dims.w} height={dims.h} backgroundColor="rgba(0,0,0,0)"
            enableNodeDrag
            onNodeDragEnd={(node: NodeRuntime) => { if (!ajustes.fixar) { node.fx = undefined; node.fy = undefined; } }}
            onEngineStop={() => { if (fitDoneRef.current) return; fitDoneRef.current = true; enquadrar(); }}   // enquadra só na 1ª estabilização
            nodeCanvasObject={desenharNo}
            nodePointerAreaPaint={(n: NodeRuntime, color: string, ctx: CanvasRenderingContext2D) => { if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x as number, n.y as number, 4 + raio(n), 0, 2 * Math.PI); ctx.fill(); }}
            linkColor={(l: LinkRuntime) => (linkNascendo(l) ? "rgba(233,241,255,0.85)" : linkEmFoco(l) ? "rgba(199,210,254,0.9)" : "rgba(167,139,250,0.14)")}
            linkWidth={(l: LinkRuntime) => (linkNascendo(l) ? 1.6 : linkEmFoco(l) ? 1.4 : 0.6) * ajustes.espessura}
            linkCurvature={0}
            linkDirectionalParticles={(l: LinkRuntime) => (linkNascendo(l) ? 5 : linkEmFoco(l) ? 3 : 0)}   // "energia" fluindo para o nó novo / em foco
            linkDirectionalParticleWidth={(l: LinkRuntime) => (linkNascendo(l) ? 2.6 : 1.8)}
            linkDirectionalParticleColor={(l: LinkRuntime) => (linkNascendo(l) ? "#eaf1ff" : HALO)}
            linkDirectionalParticleSpeed={(l: LinkRuntime) => (linkNascendo(l) ? 0.012 : 0.006)}
            onNodeHover={(node: NodeRuntime | null) => setHover(node ? String(node.id) : null)}
            onNodeClick={(node: NodeRuntime) => setSel(String(node.id))}
            onBackgroundClick={() => setSel(null)}
            cooldownTicks={200}
          />
        </Suspense>
      </div>
    </div>
  );
}

function Controle({ label, valor, min, max, step, onChange, fmt = (v) => String(Math.round(v)) }: { label: string; valor: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between"><span>{label}</span><span className="font-mono text-[10.5px] text-slate-400">{fmt(valor)}</span></div>
      <Slider value={[valor]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="[&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5" />
    </div>);
}
function BotaoFlutuante({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={title} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium shadow-2xl backdrop-blur-xl transition-colors", on ? "border-white/30 bg-white/[0.16] text-white" : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.12]")}>{children}</button>;
}
```

Respeite `prefers-reduced-motion`: nesse caso desenhe o nó direto no tamanho
final, sem ondas (`bp = -1` sempre).

## Passo 4 — A faixa de métricas (`CerebroTicker.tsx`)

Tudo derivado da própria lista de memórias, sem endpoint novo: treinar
invalida a query e o número sobe. Itens (ordem): **Memórias** (com "+N na
semana"), **Treinadas hoje**, **Conexões** (`buildGraph(memorias).links.length`),
**Mais conectada** (nó de maior `val`, "N conexões"), um item por **tipo**
com contagem, **Tags** distintas, **Último treino** (`desde(updated_at)` +
título curto). Cada item com ícone colorido e tooltip explicando o que o
número significa.

Esteira CSS infinita: duplicar a lista (`[...metricas, ...metricas]`),
animar `translateX(0 → -50%)`, duração `max(20, n × 6)s`, pausar no hover.
O relógio para "há X min" vem de `useSyncExternalStore` com `setInterval` de
1 min (ler `Date.now()` no render quebra a pureza do React 19).

```css
@keyframes agenteTickerScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.agente-ticker-track:hover { animation-play-state: paused; }
```

O Daniel amplia a faixa com dados do radar (perguntas na semana, usuários
ativos, tema mais pedido, lacunas sem fonte) e cada item abre um modal com a
quebra. Faça isso só se o radar existir.

## Passo 5 — O console de treino (`Treinar.tsx`)

- **Guia recolhível** ("Como treinar <<NOME>>"): os 5 tipos com cor e dica;
  "como escrever uma boa memória" (um assunto por memória; ao corrigir,
  escreva a regra; diga a origem) e o que não fazer (misturar assuntos;
  colar um número); o passo a passo em 4 linhas; 4 exemplos prontos; e o
  aviso: *as memórias ensinam como responder; os números vêm do painel e do
  banco.*
- **Compositor**: título ("O que <<NOME>> deve saber?"), tipo em chips com
  **Automático** (`Sparkles`) na frente, detalhe (textarea, "Suporta
  [[links]]"), tags (vírgula). Botão "Ensinar" mostra "<<NOME>> está
  aprendendo…" enquanto o treinador roda. Em edição: `name` fixo (slug
  estável), `refinar` só se o tipo for automático.
- **Biblioteca**: busca, chips de filtro por tipo com contadores, grid de
  cards (tipo, slug em mono, título, corpo com `line-clamp-3`, tags, Editar,
  Apagar com confirmação inline "Apagar? Sim/Não"), teto de altura com scroll
  próprio (com 278 memórias a grade virava página infinita).
- Props: `editar?: Memory` (lida só na montagem: a página remonta com `key`),
  `onTreinandoChange`, `onSaved` (volta para a aba do grafo).

## Passo 6 — A página (`DashboardAgenteCerebro.tsx`)

```tsx
const [aba, setAba] = useState<"grafo" | "treinar">("grafo");
const [editando, setEditando] = useState<Memory | null>(null);
const [treinando, setTreinando] = useState(false);
// Polling só na aba do grafo: é o "ao vivo".
const memorias = useMemoriesQuery(true, aba === "grafo" ? 4000 : false);
// header com título + abas (Grafo / Treinar) → <CerebroTicker/> → aba
// Grafo: <BrainGraph memorias carregando treinando onEditar={(m)=>{setEditando(m);setAba("treinar")}} onApagar onEnsinar onRemoverExemplos={() => setConfirmarExemplos(true)} />
// Treinar: <Treinar key={editando?.name ?? "nova"} editar={editando ?? undefined} onTreinandoChange={setTreinando} onSaved={() => { setEditando(null); setAba("grafo"); }} />
// AlertDialog "Remover as memórias de exemplo?" → useDeleteSeedMemories()
```

Só quem treina acessa a rota; inclua-a na lista de rotas restritas do layout.

## Passo 7 — Memórias de exemplo

Semeie 30–50 memórias ligadas por wikilinks e tags, `seed = true`, e ofereça
"Remover exemplos". Sem isso o usuário abre um fundo escuro vazio e fecha.
Cuidado: `feedback`/`user` do seed entram em toda resposta; escreva-as
alinhadas ao prompt.

## Armadilhas, em resumo

| sintoma | causa | conserto |
| --- | --- | --- |
| Nós saltam a cada atualização | `buildGraph` substituindo o estado | fundir preservando os objetos de nó |
| Rótulo cresce ao dar zoom | `Math.max(piso, 12/scale)` | `12 / scale`, sem piso |
| Grafo abre gigante com poucas memórias | `zoomToFit` sem teto | limitar o zoom em ~2.2 |
| Novelo preto de linhas | tags ligando todos com todos | cadeia por tag |
| Grafo abre deslocado | canvas medido depois do primeiro desenho | reenquadrar quando `dims` mudar |
| Trava com muitos nós | `charge` sem `distanceMax` | `distanceMax(800)` |
| `source` ora string, ora objeto | a biblioteca muta os links | normalizar com `idOf` |
| Build de SSR quebra | import direto | `lazy` / `dynamic({ ssr: false })` |
| Filtrar por tipo embaralha | cópias dos nós | filtrar os MESMOS objetos |
| Rótulo do nó não bate com `[[link]]` | slugify diferente do banco | um único slugify, testado contra o SQL |

## Verificação final

- [ ] Cérebro vazio, com 3 memórias e com 50: os três casos enquadram bem.
- [ ] Cadastrar com a tela aberta: a memória nasce animada, sem os outros nós saltarem; toast "nova memória".
- [ ] Arrastar um nó, recarregar: os ajustes voltam do `localStorage`.
- [ ] Clicar num tipo na legenda: os nós somem e voltam sem embaralhar o resto.
- [ ] Buscar: os que casam acendem, os outros apagam sem sumir.
- [ ] Clicar num `[[link]]` do painel seleciona o nó de destino.
- [ ] "Remover exemplos" apaga só `seed = true`.
- [ ] A faixa de métricas atualiza no mesmo instante do treino.

---

# Parte C — Variante Next.js + zustand (Daniel)

| ponto | Lya (Vite) | Daniel (Next.js) |
| --- | --- | --- |
| Chamada do agente | `fetch` na Edge Function com `Authorization` | `fetch('/api/chat')` (route handler no mesmo app); o JWT vai no **corpo** (`token`) porque o handler é server-side e repassa ao FastAPI |
| Estado do histórico | TanStack Query + fila por conversa em módulo | zustand `useDanielChats` (sessions, activeId, saveErrors, `ensureLoaded(userId)`, `reset()` no logout, migração única do localStorage legado) com a mesma fila/retry |
| Grafo | `lazy(() => import(...))` | `dynamic(() => import(...), { ssr: false })` |
| Fonte do grafo | montado no browser | `GET /brain/graph` no FastAPI (mesma lógica `_build_graph`) com fallback para `public/cerebro/graph.json` no protótipo |
| Anexos | não | chips de imagem/PDF no composer; base64 só em memória; `stripForStore` antes de salvar |
| Eventos extras | — | `sources` (chips de arquivo com score), `pdf` (card de download com data URL) |
| Aviso de save falho | banner "Entendi" | banner com **"Tentar de novo"** que reenvia o último payload (o store o guarda mesmo se a tela já estiver em outra conversa) |
| Erro 404 ao apagar | — | tratado como sucesso (conversa criada e nunca salva) |
| Tema | tokens shadcn (`bg-card`, `text-primary`) | CSS vars próprias (`var(--bg-card)`, `var(--logo-accent)`) |
| Guia de treino | `LyaGuia` dentro de `Treinar` | `TrainingGuide` com preferência aberto/fechado no `localStorage` |

Regra geral: as decisões de comportamento (turno em voo, save por
substituição, fila, aviso visível, `done` obrigatório) são as mesmas nas duas
pilhas; só a plumagem muda.

---

## Checklist final do front

- [ ] `types.ts` existe e as duas pontas o respeitam.
- [ ] `parseSseBuffer` tem teste com chunk partido no meio de um evento.
- [ ] O turno em voo vive fora do estado do React; `Symbol` por turno.
- [ ] Trocar de conversa no meio de uma resposta não perde nem mistura.
- [ ] Envio travado enquanto o histórico carrega ou falhou.
- [ ] O contexto da tela vai em toda pergunta.
- [ ] Erro do servidor aparece como frase.
- [ ] Balão some na tela cheia; sugestões quando vazio; `aria-label` muda com o estado.
- [ ] Chips de ferramenta em linguagem de gente; identificador nunca aparece.
- [ ] Só ressalvas altas entram no texto; médias no `<details>`; baixas não aparecem.
- [ ] Tela do cérebro: ticker + grafo + treinar compartilham a query; polling só na aba do grafo.
- [ ] Skill `cerebro-grafo` copiada para `.claude/skills/` do projeto do cliente.
