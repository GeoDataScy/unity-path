import { useCallback, useEffect, useRef, useState } from "react";

import { streamLyaChat } from "./api";
import type { LyaContexto, LyaEstado, LyaMessage } from "./types";
import { useLyaChatQuery, useSaveLyaChat } from "./useLyaChats";

/** Depois disso o pulso elástico cansa: volta para o pêndulo até o fim do stream. */
const TETO_RESPONDENDO_MS = 60_000;
/** Quanto o símbolo fica no "resolvido" antes de assentar em repouso. */
const RESOLVIDO_MS = 2_500;

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
  const [estado, setEstado] = useState<LyaEstado>("repouso");
  const [aviso, setAviso] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const saveChat = useSaveLyaChat();

  const hydratedRef = useRef<string | null | undefined>(undefined);
  const turnoNaTelaRef = useRef<symbol | null>(null);
  const emVooRef = useRef(new Map<string, { token: symbol; turno: LyaMessage[] }>());
  const resolvidoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O "resolvido" roda uma vez e assenta sozinho; se a tela sair antes disso,
  // o timer morre junto.
  useEffect(() => () => clearTimeout(resolvidoTimerRef.current ?? undefined), []);

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
    setEstado("repouso");
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
      // Reatando no meio da resposta: volta ao pêndulo; o próximo token
      // devolve o pulso.
      setEstado("pensando");
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

      // ── Símbolo da Lya: pensando → respondendo → resolvido ──
      // Só mexe no símbolo quando este turno é o que está na tela; trocar de
      // conversa no meio da resposta não pode animar a conversa errada.
      clearTimeout(resolvidoTimerRef.current ?? undefined);
      const irPara = (s: LyaEstado) => {
        if (turnoNaTelaRef.current === turnoToken) setEstado(s);
      };
      let tetoTimer: ReturnType<typeof setTimeout> | null = null;
      let cansado = false; // já passou do teto: fica no pêndulo até o fim
      let houveErro = false;
      irPara("pensando");

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
            if (evt.type === "token") {
              aplicar((cur) => ({ ...cur, content: cur.content + evt.text }));
              if (!cansado) {
                if (!tetoTimer) {
                  tetoTimer = setTimeout(() => {
                    cansado = true;
                    irPara("pensando");
                  }, TETO_RESPONDENDO_MS);
                }
                irPara("respondendo");
              }
            } else if (evt.type === "tool") {
              aplicar((cur) => ({ ...cur, tools: [...(cur.tools || []), { name: evt.name }] }));
              irPara("pensando"); // consulta a ferramenta/base também é pensar
            } else if (evt.type === "chart") aplicar((cur) => ({ ...cur, charts: [...(cur.charts || []), evt.chart] }));
            else if (evt.type === "memoria") aplicar((cur) => ({ ...cur, memorias: [...(cur.memorias || []), evt.memoria] }));
            else if (evt.type === "revisao") aplicar((cur) => ({ ...cur, revisao: evt.revisao }));
            else if (evt.type === "aviso") setAviso(evt.message || "Esta resposta saiu sem as memórias treinadas da Lya.");
            else if (evt.type === "error") {
              houveErro = true;
              aplicar((cur) => ({ ...cur, content: `${cur.content}${cur.content ? "\n\n" : ""}⚠️ ${evt.message || "Falha ao responder."}` }));
            }
            salvarParcial();
          },
        });
      } catch (err) {
        houveErro = true;
        const message = err instanceof Error ? err.message : "falha de rede";
        aplicar((cur) => ({ ...cur, content: `${cur.content}${cur.content ? "\n\n" : ""}⚠️ ${message}` }));
      } finally {
        document.removeEventListener("visibilitychange", aoEsconder);
        clearTimeout(tetoTimer ?? undefined);
        if (id && emVooRef.current.get(id)?.token === turnoToken) emVooRef.current.delete(id);
        if (turnoNaTelaRef.current === turnoToken) setLoading(false);
        // Erro, timeout ou resposta vazia voltam para repouso — um símbolo que
        // pensa para sempre parece sistema travado. Resposta entregue floresce
        // uma vez e assenta.
        if (houveErro || !turno[turno.length - 1].content.trim()) {
          irPara("repouso");
        } else {
          irPara("resolvido");
          resolvidoTimerRef.current = setTimeout(() => irPara("repouso"), RESOLVIDO_MS);
        }
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
    clearTimeout(resolvidoTimerRef.current ?? undefined);
    setMessages([]);
    setLoading(false);
    setEstado("repouso");
    setAviso(null);
  }, []);

  return {
    messages,
    loading,
    /** Estado do símbolo da Lya — ver `LyaMark`. */
    estado,
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
