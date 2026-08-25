// Bloco de notas — o que a área do agente monta.
//
// Duas peças: o MARCADOR (a aba que fica presa no canto inferior direito, com o
// número de pendências abertas) e o CADERNO (NotepadPanel). Este arquivo cuida
// só de abrir, fechar e animar a transição entre os dois.
//
// O painel é montado/desmontado em volta da animação — não fica no DOM escondido
// atrás do transform. Um painel "invisível" mas presente continuaria capturando
// Tab, e o agente pegaria foco em botões de um caderno fechado ao navegar pelo
// teclado nas telas de atendimento.

import { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";

import { cn } from "@/lib/utils";
import { NotepadPanel } from "./NotepadPanel";
import { readPref, writePref } from "./notepadPrefs";
import { useOpenTasksQuery } from "./useAgentNotesQuery";

/** Igual ao `duration-300` do painel: é o tempo de sair de cena. */
const EXIT_MS = 300;

type Props = {
  /** Só monta depois que o layout confirmou a sessão. */
  enabled: boolean;
  fullName: string | null;
};

export function AgentNotepad({ enabled, fullName }: Props) {
  // O agente que deixou o caderno aberto encontra o caderno aberto no próximo
  // login — é o comportamento de um caderno em cima da mesa.
  const [open, setOpen] = useState(() => readPref("open") === "1");
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  const openTasks = useOpenTasksQuery(enabled);
  // `!done` porque o update otimista marca a conclusão no cache antes da
  // resposta do banco: sem o filtro, o número só cairia no refetch seguinte.
  const pending = (openTasks.data ?? []).filter((n) => !n.done).length;

  useEffect(() => {
    writePref("open", open ? "1" : "0");

    if (open) {
      setMounted(true);
      // Um frame com translate-x-full antes de soltar: sem isso o painel
      // aparece já no lugar, sem deslizar.
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Esc fecha o caderno. O campo de escrita e a edição de uma linha param o
  // evento antes daqui quando têm rascunho para descartar.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!enabled) return null;

  return (
    <>
      {/* Marcador de página: fica no canto inferior direito e some quando o
          caderno abre (o painel ocupa a mesma borda, e fechar é o X da capa). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={
          pending > 0
            ? `Abrir meu caderno — ${pending} ${pending === 1 ? "pendência" : "pendências"} em aberto`
            : "Abrir meu caderno"
        }
        className={cn(
          "group fixed bottom-6 right-0 z-30 flex items-center gap-2 rounded-l-2xl py-3 pl-4 pr-4",
          "bg-dashboard-sidebar text-dashboard-sidebar-foreground shadow-lg ring-1 ring-white/10",
          "transition-all duration-200 hover:pr-6 hover:shadow-xl",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          open && "pointer-events-none translate-x-full opacity-0",
        )}
      >
        <NotebookPen aria-hidden className="h-4 w-4" />
        <span className="hidden text-xs font-medium sm:inline">Caderno</span>
        {pending > 0 && (
          <span
            aria-hidden
            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-status-open px-1 text-[10px] font-bold text-status-open-foreground"
          >
            {pending > 99 ? "99+" : pending}
          </span>
        )}
      </button>

      {/* No celular o caderno ocupa a tela toda, então ganha véu para deixar
          claro que o app está atrás. No desktop não há véu de propósito: o
          caderno é usado junto com o atendimento aberto ao lado. */}
      {mounted && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className={cn(
            "fixed inset-0 z-[35] bg-slate-950/40 transition-opacity duration-300 sm:hidden",
            visible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />
      )}

      {mounted && (
        <NotepadPanel
          visible={visible}
          onClose={() => setOpen(false)}
          fullName={fullName}
        />
      )}
    </>
  );
}
