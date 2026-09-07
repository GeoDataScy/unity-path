import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { lyaDeleteChat, lyaGetChat, lyaListChats, lyaSaveChat } from "./api";
import type { LyaChatSummary, LyaMessage } from "./types";

// Histórico de conversas da Lya — no banco, por usuário (RPCs lya_*_chat).
//
// Três decisões herdadas do Daniel que não são óbvias no código:
//   - o id da conversa nasce no CLIENTE (uuid v4), para ela entrar na lista no
//     instante do envio; a linha nasce no 1º save;
//   - o salvamento é por SUBSTITUIÇÃO: cada save manda a conversa inteira, então
//     um save perdido se conserta no seguinte — mas dois saves do mesmo turno
//     precisam sair EM ORDEM (a pergunta e a resposta chegam quase juntas);
//   - o título é derivado no banco (primeira pergunta), aqui só o espelhamos.

export const LYA_CHATS_KEY = ["lya", "chats"] as const;
export const lyaChatKey = (id: string) => ["lya", "chat", id] as const;

export function newChatId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function titleFrom(messages: LyaMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const raw = (first?.content || "").trim().replace(/\s+/g, " ");
  if (!raw) return "Nova conversa";
  return raw.length > 42 ? `${raw.slice(0, 42)}…` : raw;
}

// Fila por conversa: garante que os saves saem na ordem em que foram pedidos.
const filaPorChat = new Map<string, Promise<void>>();
// Último payload pedido por conversa: um save mais novo já cobre o anterior.
const ultimoPayload = new Map<string, LyaMessage[]>();

function enfileirar(id: string, tarefa: () => Promise<void>): Promise<void> {
  const anterior = filaPorChat.get(id) ?? Promise.resolve();
  const proxima = anterior.then(tarefa, tarefa);
  filaPorChat.set(id, proxima);
  void proxima.then(() => {
    if (filaPorChat.get(id) === proxima) filaPorChat.delete(id);
  });
  return proxima;
}

async function salvarComRetry(id: string, messages: LyaMessage[]) {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      return await lyaSaveChat(id, messages);
    } catch (err) {
      ultimoErro = err;
      const msg = err instanceof Error ? err.message : "";
      // sessão/permissão não melhoram com insistência
      if (/42501|PGRST301|Sessão inválida/i.test(msg)) throw err;
      if (tentativa < 2) await new Promise((r) => setTimeout(r, 600 * 2 ** tentativa));
    }
  }
  throw ultimoErro;
}

export function useLyaChatsQuery(enabled = true) {
  return useQuery({
    queryKey: LYA_CHATS_KEY,
    queryFn: lyaListChats,
    enabled,
    staleTime: 60_000,
  });
}

export function useLyaChatQuery(id: string | null) {
  return useQuery({
    queryKey: lyaChatKey(id ?? "none"),
    queryFn: () => lyaGetChat(id as string),
    enabled: Boolean(id),
    staleTime: Infinity,
  });
}

/**
 * Salva a conversa (na fila da conversa) e mantém a lista da barra lateral
 * atualizada na hora — o título aparece no mesmo frame do envio.
 */
export function useSaveLyaChat() {
  const qc = useQueryClient();

  return async (id: string, messages: LyaMessage[]): Promise<boolean> => {
    const title = titleFrom(messages);
    qc.setQueryData<LyaChatSummary[]>(LYA_CHATS_KEY, (prev) => {
      const lista = prev ?? [];
      const atual = lista.find((c) => c.id === id);
      const agora = new Date().toISOString();
      const updated: LyaChatSummary = {
        id,
        titulo: title,
        total_mensagens: messages.length,
        created_at: atual?.created_at ?? agora,
        updated_at: agora,
      };
      return [updated, ...lista.filter((c) => c.id !== id)];
    });
    ultimoPayload.set(id, messages);

    let ok = true;
    await enfileirar(id, async () => {
      if (ultimoPayload.get(id) !== messages) return; // um save mais novo já cobre este
      try {
        const salvo = await salvarComRetry(id, messages);
        qc.setQueryData<LyaChatSummary[]>(LYA_CHATS_KEY, (prev) =>
          (prev ?? []).map((c) => (c.id === id ? { ...c, titulo: salvo.titulo, updated_at: salvo.updated_at } : c)),
        );
        // a conversa aberta passa a ter a versão gravada
        qc.setQueryData(lyaChatKey(id), (prev: unknown) =>
          prev && typeof prev === "object"
            ? { ...(prev as object), mensagens: messages.map((m, i) => ({ ...m, ordem: i })) }
            : prev,
        );
      } catch (err) {
        console.error("[lya] falha ao salvar a conversa", err);
        ok = false;
      }
    });
    return ok;
  };
}

export function useDeleteLyaChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      ultimoPayload.delete(id);
      // Na mesma fila dos saves: apagar antes de um save pendente faria o save
      // recriar a conversa (o salvamento é upsert).
      await enfileirar(id, async () => {
        await lyaDeleteChat(id);
      });
    },
    onMutate: async (id) => {
      const anterior = qc.getQueryData<LyaChatSummary[]>(LYA_CHATS_KEY);
      qc.setQueryData<LyaChatSummary[]>(LYA_CHATS_KEY, (prev) => (prev ?? []).filter((c) => c.id !== id));
      return { anterior };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.anterior) qc.setQueryData(LYA_CHATS_KEY, ctx.anterior);
    },
    onSettled: (_d, _e, id) => {
      qc.removeQueries({ queryKey: lyaChatKey(id) });
    },
  });
}
