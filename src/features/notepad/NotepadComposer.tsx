// Bloco de notas — a linha onde se escreve.
//
// Não é um formulário dentro de um cartão: é a PRÓXIMA LINHA do papel. Fundo
// transparente, mesma pauta, mesma tipografia da anotação já salva — a diferença
// entre "escrevendo" e "escrito" é só o cursor. O seletor Nota/Pendência e a
// dica de teclado só aparecem quando o campo está em uso, para o estado parado
// do caderno ficar limpo.

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ListTodo, Loader2, PenLine, StickyNote } from "lucide-react";

import { cn } from "@/lib/utils";
import { MARGIN_LEFT, fitToRules } from "./notepadPaper";
import type { NoteKind } from "./types";

export type NotepadComposerHandle = { focus: () => void };

type Props = {
  /** Rótulo do dia em que a anotação vai cair ("hoje", "25/08"...). */
  dayLabel: string;
  saving: boolean;
  onCreate: (body: string, kind: NoteKind) => void;
  /** Esc com o campo vazio deve fechar o caderno, e não só limpar o rascunho. */
  onEscapeEmpty: () => void;
};

export const NotepadComposer = forwardRef<NotepadComposerHandle, Props>(
  ({ dayLabel, saving, onCreate, onEscapeEmpty }, ref) => {
    const [draft, setDraft] = useState("");
    const [kind, setKind] = useState<NoteKind>("nota");
    const [active, setActive] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    // Altura sempre no múltiplo da entrelinha, para qualquer origem da mudança
    // (digitar, limpar no Enter, limpar no Esc).
    useLayoutEffect(() => {
      fitToRules(inputRef.current);
    }, [draft]);

    const expanded = active || draft.trim() !== "";

    const submit = () => {
      const body = draft.trim();
      if (body === "") return;
      onCreate(body, kind);
      setDraft("");
      // Mantém o tipo escolhido e o foco: escrever três pendências seguidas é
      // o caso comum no começo do turno.
      inputRef.current?.focus();
    };

    return (
      <div className="relative">
        <div
          className="absolute top-0 flex h-7 items-center justify-center"
          style={{ left: 0, width: MARGIN_LEFT }}
        >
          {saving ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <PenLine
              aria-hidden
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                expanded ? "text-primary" : "text-muted-foreground/50",
              )}
            />
          )}
        </div>

        <div style={{ paddingLeft: MARGIN_LEFT + 12 }} className="pr-3">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={
              kind === "tarefa" ? "Nova pendência…" : "Escreva uma anotação rápida…"
            }
            aria-label={`Nova anotação em ${dayLabel}`}
            onFocus={() => setActive(true)}
            onBlur={() => setActive(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
                return;
              }
              if (e.key === "Escape") {
                if (draft !== "") {
                  // Limpa o rascunho; fechar o caderno com texto escrito por
                  // engano seria perder o que a pessoa acabou de digitar.
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft("");
                  return;
                }
                onEscapeEmpty();
              }
            }}
            className={cn(
              "block w-full resize-none border-0 bg-transparent p-0 text-sm leading-7 outline-none",
              "text-foreground placeholder:text-muted-foreground/60 focus:ring-0",
            )}
          />

          {/* Altura h-7 obrigatória: qualquer outro valor desalinha a pauta. */}
          <div
            className={cn(
              "flex h-7 items-center gap-1 overflow-hidden transition-all",
              expanded ? "opacity-100" : "pointer-events-none h-0 opacity-0",
            )}
          >
            <KindOption
              active={kind === "nota"}
              label="Nota"
              onClick={() => setKind("nota")}
              icon={<StickyNote className="h-3 w-3" />}
            />
            <KindOption
              active={kind === "tarefa"}
              label="Pendência"
              onClick={() => setKind("tarefa")}
              icon={<ListTodo className="h-3 w-3" />}
            />
            <span className="ml-auto hidden text-[10px] text-muted-foreground/70 sm:block">
              Enter salva · Shift+Enter pula linha
            </span>
          </div>
        </div>
      </div>
    );
  },
);
NotepadComposer.displayName = "NotepadComposer";

function KindOption({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // onMouseDown em vez de onClick: o clique no botão tira o foco do textarea,
      // o composer recolheria e o botão sairia debaixo do cursor antes do click.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
