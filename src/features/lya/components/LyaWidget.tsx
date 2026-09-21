import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Maximize2, X } from "lucide-react";

import type { LyaContexto } from "../types";
import { useLyaConversation } from "../useLyaConversation";
import { LyaComposer } from "./LyaComposer";
import { LyaMark } from "./LyaMark";
import { LyaMessages } from "./LyaMessages";

const SUGESTOES = [
  "Quantos atendimentos tivemos no período?",
  "Quais reembolsos estão em atraso?",
  "Quem tem a melhor taxa de conclusão?",
];

// Balão flutuante (canto inferior direito) que abre um painel de chat com a
// Lya em qualquer tela do painel. A conversa aqui é da sessão (não vai para o
// histórico); a tela cheia (/dashboard/lya) é a que persiste.
export function LyaWidget({ contexto }: { contexto: LyaContexto }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const conv = useLyaConversation({ persist: false, contexto });

  // Na tela cheia a própria Lya já ocupa a página — esconde o balão.
  if (pathname.startsWith("/dashboard/lya")) return null;

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Fechar a Lya" : "Perguntar à Lya"}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary to-violet-700 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
      >
        {/* Fechado, o botão é a própria Lya: mostra se ela está pensando mesmo
            com o painel recolhido. Mono branca porque o fundo é roxo. */}
        {open ? <X className="h-6 w-6" /> : <LyaMark size={30} tone="branco" estado={conv.estado} label={null} />}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-5 z-[60] flex w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          style={{ height: "min(640px, calc(100vh - 8rem))" }}
        >
          <header className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary to-violet-700 px-4 py-3 text-primary-foreground">
            <LyaMark size={36} tone="branco" estado={conv.estado} label={null} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-sm font-semibold">Lya</p>
              <p className="truncate text-xs text-primary-foreground/75">Pergunte sobre os dados do suporte</p>
            </div>
            <Link to="/dashboard/lya" title="Abrir em tela cheia" className="rounded-md p-1.5 hover:bg-white/15">
              <Maximize2 className="h-4 w-4" />
            </Link>
          </header>

          {conv.messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
              <LyaMark size={56} estado={conv.estado} className="mb-3" />
              <p className="mb-1 text-sm font-medium text-foreground">Como posso ajudar?</p>
              <p className="mb-4 text-xs text-muted-foreground">Respondo com os números do painel, do banco e da Base de Suporte.</p>
              <div className="flex w-full flex-col gap-2">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => conv.send(s)}
                    className="rounded-lg border border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <LyaMessages messages={conv.messages} loading={conv.loading} compact />
          )}

          <div className="border-t border-border px-3 pb-2 pt-3">
            {conv.aviso && (
              <p className="mb-2 rounded-lg border border-amber-500/50 px-2 py-1 text-[11px] text-foreground">{conv.aviso}</p>
            )}
            <LyaComposer onSend={conv.send} loading={conv.loading} compact autoFocus={open} />
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Enter envia · Shift+Enter quebra linha</p>
          </div>
        </div>
      )}
    </>
  );
}
