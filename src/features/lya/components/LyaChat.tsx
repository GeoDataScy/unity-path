import { useCallback, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, ClipboardCheck, MessageSquarePlus, RefreshCcw, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { LyaArquivoChip } from "../arquivos/LyaArquivoChip";
import { useEnviarLyaArquivo } from "../arquivos/useLyaArquivos";
import type { LyaArquivoAnexado, LyaContexto } from "../types";
import { newChatId, useDeleteLyaChat, useLyaChatsQuery } from "../useLyaChats";
import { useLyaConversation } from "../useLyaConversation";
import { LyaComposer } from "./LyaComposer";
import { LyaMark } from "./LyaMark";
import { LyaMessages } from "./LyaMessages";

// Tela cheia da Lya: lista de conversas à esquerda + conversa à direita, no
// estilo Claude/ChatGPT (estado vazio com saudação e sugestões; histórico
// rolável + composer fixo embaixo). O histórico vive no banco, por usuário.

const SUGESTOES = [
  { icon: BarChart3, label: "Atendimentos", prompt: "Como está o volume de atendimentos no período selecionado? Quem mais atendeu?" },
  { icon: RefreshCcw, label: "Reembolsos", prompt: "Resumo dos reembolsos do período: abertos, concluídos, principais motivos e eficiência por canal." },
  { icon: Activity, label: "Interações", prompt: "Qual agente tem a melhor taxa de conclusão e quantas interações leva para concluir?" },
  { icon: AlertTriangle, label: "Alertas", prompt: "Quais reembolsos estão em atraso hoje e há quantos dias?" },
  { icon: ClipboardCheck, label: "Pedidos em espera", prompt: "Quantos pedidos em espera estão aguardando e como estão distribuídos por agente?" },
  { icon: Users, label: "Time", prompt: "Quem do time está online agora e quantos tickets em aberto cada um tem?" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function LyaChat({
  contexto,
  canTrain,
  firstName,
  initialChatId = null,
}: {
  contexto: LyaContexto;
  canTrain: boolean;
  /** Primeiro nome de quem está logado; `null` quando o perfil não tem nome. */
  firstName: string | null;
  /**
   * Conversa a abrir na montagem — vem do `?chat=` de quem expandiu o balão.
   * Só semeia o estado inicial: trocar de conversa depois é do usuário, e
   * a URL não manda mais nada.
   */
  initialChatId?: string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialChatId);
  const [modoTreino, setModoTreino] = useState(false);
  const [anexos, setAnexos] = useState<LyaArquivoAnexado[]>([]);
  const [anexando, setAnexando] = useState<string | null>(null);
  const chats = useLyaChatsQuery();
  const deleteChat = useDeleteLyaChat();
  const { toast } = useToast();
  const upload = useEnviarLyaArquivo();

  const onNeedChatId = useCallback(() => {
    const id = newChatId();
    setActiveId(id);
    return id;
  }, []);

  // O arquivo anexado vira contexto do turno: a Edge Function recebe os ids e
  // lê o arquivo antes de responder.
  const contextoComArquivos = useMemo<LyaContexto>(
    () => (anexos.length > 0 ? { ...contexto, arquivos: anexos } : contexto),
    [contexto, anexos],
  );

  const conv = useLyaConversation({
    chatId: activeId,
    persist: true,
    onNeedChatId,
    contexto: contextoComArquivos,
    modoTreino: canTrain && modoTreino,
  });

  /**
   * Anexar sobe o arquivo na hora (acervo permanente), e não "cola" o conteúdo
   * na pergunta: é o que deixa a Lya cruzar a planilha com o banco depois, em
   * qualquer conversa.
   */
  const anexar = useCallback(
    async (file: File) => {
      setAnexando(file.name);
      try {
        // `xlsx` entra só quando alguém anexa: o chat não precisa carregar o
        // parser de planilha para abrir.
        const { parseLyaFile } = await import("../arquivos/parseLyaFile");
        const parse = parseLyaFile(await file.arrayBuffer(), file.name);
        const nome = file.name.replace(/\.[^.]+$/, "") || file.name;
        const { arquivo, interpretado, aviso } = await upload.enviar(nome, parse);
        setAnexos((prev) => [
          ...prev.filter((a) => a.id !== arquivo.id),
          {
            id: arquivo.id,
            nome: arquivo.nome,
            tipo: arquivo.tipo,
            total_linhas: arquivo.total_linhas,
            colunas: arquivo.colunas.map((c) => c.nome),
          },
        ]);
        toast(
          interpretado
            ? { title: "Arquivo anexado", description: `A Lya já leu ${arquivo.nome} e pode consultar na resposta.` }
            : {
                title: "Arquivo anexado sem a leitura da Lya",
                description: aviso ?? "O arquivo subiu e está consultável, mas ela não conseguiu interpretá-lo agora.",
              },
        );
      } catch (err) {
        toast({
          title: "Não consegui anexar o arquivo",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      } finally {
        setAnexando(null);
      }
    },
    [toast, upload],
  );

  const started = conv.messages.length > 0 || conv.loadingHistory;
  const sessions = useMemo(() => chats.data ?? [], [chats.data]);

  const avisos = (
    <>
      {conv.saveError && (
        <div role="alert" className="mb-2 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-warning/40 bg-card px-3 py-2 text-[12px] text-foreground">
          <span>
            Não foi possível salvar esta conversa no histórico.{" "}
            <span className="text-muted-foreground">Ela continua na tela, mas pode se perder ao recarregar.</span>
          </span>
          <button type="button" onClick={conv.dismissSaveError} className="rounded-lg border border-border px-2 py-0.5 font-medium text-primary">
            Entendi
          </button>
        </div>
      )}
      {conv.aviso && (
        <div role="alert" className="mb-2 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-warning/40 bg-card px-3 py-2 text-[12px] text-foreground">
          <span>{conv.aviso}</span>
          <button type="button" onClick={conv.dismissAviso} className="rounded-lg border border-border px-2 py-0.5 font-medium text-primary">
            Entendi
          </button>
        </div>
      )}
    </>
  );

  const composer = (
    <>
      {(anexos.length > 0 || anexando) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {anexos.map((a) => (
            <LyaArquivoChip
              key={a.id}
              arquivo={a}
              onRemover={() => setAnexos((prev) => prev.filter((p) => p.id !== a.id))}
            />
          ))}
          {anexando && (
            <LyaArquivoChip
              carregando
              arquivo={{ id: "enviando", nome: anexando, tipo: "csv", total_linhas: 0, colunas: [] }}
            />
          )}
        </div>
      )}
      <LyaComposer
        onSend={conv.send}
        loading={conv.loading}
        disabled={conv.loadingHistory || conv.historyError}
        canTrain={canTrain}
        modoTreino={modoTreino}
        onToggleTreino={() => setModoTreino((v) => !v)}
        onAnexar={anexar}
        anexando={Boolean(anexando)}
      />
    </>
  );

  return (
    <div className="flex gap-6" style={{ height: "calc(100dvh - 4rem)" }}>
      {/* ── Lista de conversas ── */}
      <aside className="hidden w-60 shrink-0 flex-col md:flex">
        <Button
          variant="secondary"
          className="mb-3 w-full justify-start gap-2"
          onClick={() => {
            setActiveId(null);
            conv.reset();
          }}
        >
          <MessageSquarePlus className="h-4 w-4" />
          Nova conversa
        </Button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {sessions.length === 0 && !chats.isLoading && (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">Suas conversas com a Lya aparecem aqui.</p>
          )}
          {sessions.map((s) => {
            const on = s.id === activeId;
            return (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
                  on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <button type="button" onClick={() => setActiveId(s.id)} className="min-w-0 flex-1 text-left" title={s.titulo}>
                  <span className="block truncate">{s.titulo}</span>
                  <span className="block text-[10.5px] opacity-70">{formatarData(s.updated_at)}</span>
                </button>
                <button
                  type="button"
                  aria-label="Apagar conversa"
                  onClick={() => {
                    if (s.id === activeId) {
                      setActiveId(null);
                      conv.reset();
                    }
                    deleteChat.mutate(s.id);
                  }}
                  className="rounded p-1 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Conversa ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!started ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2">
            <div className="mb-8 flex flex-col items-center gap-4">
              <LyaMark size={72} estado={conv.estado} />
              <h1 className="text-[26px] font-normal text-foreground sm:text-[32px]">
                {greeting()}
                {firstName && (
                  <>
                    , <span className="text-primary">{firstName}</span>
                  </>
                )}
              </h1>
            </div>
            <div className="w-full max-w-3xl">
              {avisos}
              {composer}
            </div>
            <div className="mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => conv.send(s.prompt)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[13px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <s.icon className="h-4 w-4" />
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-6 max-w-xl text-center text-[12px] text-muted-foreground">
              A Lya responde só com o que está no painel, no banco e na Base de Suporte, e diz de onde tirou cada
              número. Sem período na pergunta, ela usa o período e o agente da barra lateral.
            </p>
          </div>
        ) : (
          <>
            {conv.historyError && (
              <div role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-card px-3 py-2 text-[13px] text-foreground">
                Não foi possível carregar esta conversa. Tente abrir de novo.
              </div>
            )}
            <LyaMessages messages={conv.messages} loading={conv.loading} loadingHistory={conv.loadingHistory} estado={conv.estado} />
            <div className="pb-2 pt-2">
              {avisos}
              {composer}
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                A Lya pode cometer erros. Confira informações importantes na tela correspondente.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
