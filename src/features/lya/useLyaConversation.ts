import { useCallback, useEffect, useRef, useState } from "react";

import { streamLyaChat } from "./api";
import type { LyaContexto, LyaMessage } from "./types";
import { useLyaChatQuery, useSaveLyaChat } from "./useLyaChats";

// Estado de UMA conversa com a Lya, compartilhado pela tela cheia e pelo balão.
//
// O turno é espelhado numa cópia própria (`turno`) fora do estado do React: é
// dela que sai TODO save deste envio. Assim, abrir outra conversa no meio da
// resposta não grava a pergunta sem a resposta, e a resposta em voo continua
// sendo salva na conversa dona dela.

interface Options {
  /** Conversa aberta (null = nova). Sem persistência quando `persist` é false. */
  chatId?: string | null;
  persist?: boolean;
  /** Chamado quando um envio precisa criar a conversa (persist=true e chatId=null). */
  onNeedChatId?: () => string;
  contexto?: LyaContexto;
  modoTreino?: boolean;
}

export function useLyaConversation({ chatId = null, persist = false, onNeedChatId, contexto, modoTreino }: Options) {
  const [messages, setMessages] = useState<LyaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const saveChat = useSaveLyaChat();

  const hydratedRef = useRef<string | null | undefined>(undefined);
  const turnoNaTelaRef = useRef<symbol | null>(null);
  const emVooRef = useRef(new Map<string, { token: symbol; turno: LyaMessage[] }>());

  const chatQuery = useLyaChatQuery(persist ? chatId : null);
  const loadingHistory = persist && Boolean(chatId) && chatQuery.isLoading;
  const historyError = persist && Boolean(chatId) && chatQuery.isError;

  // Troca de conversa: limpa a tela e, se houver resposta em voo para a
  // conversa aberta, reata a ela em vez de reler o parcial do banco.
  useEffect(() => {
    if (!persist) return;
    if (hydratedRef.current === chatId) return;
    hydratedRef.current = chatId;
    turnoNaTelaRef.current = null;
    setLoading(false);
    setAviso(null);
    if (!chatId) {
      setMessages([]);
      return;
    }
    const emVoo = emVooRef.current.get(chatId);
    if (emVoo) {
      turnoNaTelaRef.current = emVoo.token;
      setMessages(emVoo.turno.slice());
      setLoading(true);
      return;
    }
    setMessages([]);
  }, [chatId, persist]);

  // Mensagens vindas do banco para a conversa aberta (só quando não há turno em voo).
  useEffect(() => {
    if (!persist || !chatId || !chatQuery.data) return;
    if (emVooRef.current.get(chatId)) return;
    if (hydratedRef.current !== chatId) return;
    setMessages(chatQuery.data.mensagens.map(({ ordem: _ordem, ...m }) => m));
  }, [persist, chatId, chatQuery.data]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || loading || loadingHistory || historyError) return;

      let id: string | null = chatId;
      if (persist && !id) {
        id = onNeedChatId?.() ?? null;
        if (id) hydratedRef.current = id; // impede o efeito de limpar esta conversa
      }
      const turnoToken = Symbol("turno");
      turnoNaTelaRef.current = turnoToken;
      setAviso(null);

      const userMsg: LyaMessage = { role: "user", content: text };
      const history = [...messages, userMsg];
      const turno: LyaMessage[] = [...history, { role: "assistant", content: "" }];
      if (id) emVooRef.current.set(id, { token: turnoToken, turno });
      setMessages(turno.slice());
      if (persist && id) void saveChat(id, history);
      setLoading(true);

      const aplicar = (patch: (m: LyaMessage) => LyaMessage) => {
        const atualizado = patch(turno[turno.length - 1]);
        turno[turno.length - 1] = atualizado;
        if (turnoNaTelaRef.current !== turnoToken) return;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = atualizado;
          return next;
        });
      };

      // Grava o parcial durante o stream (rede caindo no meio não perde tudo).
      let ultimoParcial = Date.now();
      const salvarParcial = (agora = false) => {
        if (!persist || !id) return;
        if (!agora && Date.now() - ultimoParcial < 8_000) return;
        ultimoParcial = Date.now();
        void saveChat(id, turno);
      };
      const aoEsconder = () => {
        if (document.visibilityState === "hidden") salvarParcial(true);
      };
      document.addEventListener("visibilitychange", aoEsconder);

      try {
        await streamLyaChat({
          messages: history,
          modoTreino,
          contexto,
          onEvent: (evt) => {
            if (evt.type === "token") aplicar((cur) => ({ ...cur, content: cur.content + evt.text }));
            else if (evt.type === "tool") aplicar((cur) => ({ ...cur, tools: [...(cur.tools || []), { name: evt.name }] }));
            else if (evt.type === "chart") aplicar((cur) => ({ ...cur, charts: [...(cur.charts || []), evt.chart] }));
            else if (evt.type === "memoria") aplicar((cur) => ({ ...cur, memorias: [...(cur.memorias || []), evt.memoria] }));
            else if (evt.type === "revisao") aplicar((cur) => ({ ...cur, revisao: evt.revisao }));
            else if (evt.type === "aviso") setAviso(evt.message || "Esta resposta saiu sem as memórias treinadas da Lya.");
            else if (evt.type === "error") aplicar((cur) => ({ ...cur, content: `${cur.content}${cur.content ? "\n\n" : ""}⚠️ ${evt.message || "Falha ao responder."}` }));
            salvarParcial();
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "falha de rede";
        aplicar((cur) => ({ ...cur, content: `${cur.content}${cur.content ? "\n\n" : ""}⚠️ ${message}` }));
      } finally {
        document.removeEventListener("visibilitychange", aoEsconder);
        if (id && emVooRef.current.get(id)?.token === turnoToken) emVooRef.current.delete(id);
        if (turnoNaTelaRef.current === turnoToken) setLoading(false);
        if (persist && id) {
          const ok = await saveChat(id, turno);
          if (!ok && turnoNaTelaRef.current === turnoToken) setSaveError(true);
        }
      }
    },
    [chatId, contexto, historyError, loading, loadingHistory, messages, modoTreino, onNeedChatId, persist, saveChat],
  );

  const reset = useCallback(() => {
    turnoNaTelaRef.current = null;
    setMessages([]);
    setLoading(false);
    setAviso(null);
  }, []);

  return {
    messages,
    loading,
    loadingHistory,
    historyError,
    aviso,
    dismissAviso: () => setAviso(null),
    saveError,
    dismissSaveError: () => setSaveError(false),
    send,
    reset,
  };
}
