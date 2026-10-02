// Bloco de notas — uma linha do caderno.
//
// Regras de layout que este componente precisa respeitar (ver notepadPaper.ts):
// altura sempre múltipla da entrelinha e texto em `leading-7`. Por isso o horário
// e as ações NÃO ganham uma linha própria: ficam sobrepostos à direita da
// primeira linha, como uma anotação na margem.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ListTodo, Pin, StickyNote, Trash2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { NotepadAction } from "./NotepadAction";
import { formatBrDate, formatTime } from "./notepadDates";
import { MARGIN_LEFT, fitToRules } from "./notepadPaper";
import type { AgentNote } from "./types";

type Props = {
  note: AgentNote;
  /** Semana/mês/busca: mostra a data em vez do horário (o dia é o contexto). */
  showDate?: boolean;
  onToggleDone: (note: AgentNote) => void;
  onTogglePinned: (note: AgentNote) => void;
  onToggleKind: (note: AgentNote) => void;
  onSaveBody: (note: AgentNote, body: string) => void;
  onDelete: (note: AgentNote) => void;
};

export function NotepadNote({
  note,
  showDate = false,
  onToggleDone,
  onTogglePinned,
  onToggleKind,
  onSaveBody,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const isTask = note.kind === "tarefa";

  // Edição externa (outra aba, por exemplo) não pode sobrescrever o que está
  // sendo digitado aqui — só sincroniza quando o campo está fechado.
  useEffect(() => {
    if (!editing) setDraft(note.body);
  }, [note.body, editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    fitToRules(el);
    el?.focus();
    // Cursor no fim: quem clica para editar quase sempre quer completar a frase.
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === "" || next === note.body) {
      setDraft(note.body); // apagar tudo não é "apagar a nota" — para isso há a lixeira
      return;
    }
    onSaveBody(note, next);
  };

  const cancel = () => {
    setDraft(note.body);
    setEditing(false);
  };

  return (
    <li
      className={cn(
        "group/note relative",
        // O texto começa depois da linha da margem (o gutter fica à esquerda
        // dela) e para antes da faixa de horário/ações, à direita.
        "pr-[84px]",
        note.pinned && "bg-primary/[0.04]",
      )}
      style={{ paddingLeft: MARGIN_LEFT + 12 }}
    >
      {/* Gutter (dentro da margem): caixinha da pendência ou marcador da nota. */}
      <div
        className="absolute top-0 flex h-7 items-center justify-center"
        style={{ left: 0, width: MARGIN_LEFT }}
      >
        {isTask ? (
          <Checkbox
            checked={note.done}
            onCheckedChange={() => onToggleDone(note)}
            aria-label={note.done ? "Reabrir pendência" : "Concluir pendência"}
            className="h-4 w-4 rounded-[3px] border-notepad-rule data-[state=checked]:border-status-success data-[state=checked]:bg-status-success"
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              note.pinned ? "bg-primary" : "bg-notepad-rule",
            )}
          />
        )}
      </div>

      {editing ? (
        <textarea
          ref={editorRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            fitToRules(e.target);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation(); // Esc aqui cancela a edição, não fecha o caderno
              cancel();
            }
          }}
          className="block w-full resize-none border-0 bg-transparent p-0 text-sm leading-7 text-foreground outline-none focus:ring-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "block w-full whitespace-pre-wrap break-words text-left text-sm leading-7 outline-none",
            "focus-visible:underline focus-visible:decoration-primary focus-visible:decoration-dotted",
            note.done ? "text-muted-foreground line-through decoration-1" : "text-foreground",
          )}
        >
          {/* Alfinete inline: acompanha o texto sem brigar com o gutter nem
              precisar de uma linha própria (que desalinharia a pauta). */}
          {note.pinned && (
            <Pin aria-hidden className="mr-1 inline h-3 w-3 -rotate-45 align-[-1px] text-primary" />
          )}
          {note.body}
        </button>
      )}

      {/* Margem direita: horário/data até o mouse chegar, ações depois. */}
      <div className="absolute right-2 top-0 flex h-7 items-center">
        <span
          className={cn(
            "text-[10px] font-mono tabular-nums text-muted-foreground/70 transition-opacity",
            "group-hover/note:opacity-0 group-focus-within/note:opacity-0",
          )}
        >
          {showDate ? formatBrDate(note.note_date) : formatTime(note.created_at)}
        </span>

        <div
          className={cn(
            "absolute right-0 flex items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover/note:opacity-100 group-focus-within/note:opacity-100",
            // Sem hover no toque: as ações ficam sempre alcançáveis.
            "max-sm:opacity-70",
          )}
        >
          <NotepadAction
            label={note.pinned ? "Desafixar" : "Fixar no topo do dia"}
            onClick={() => onTogglePinned(note)}
          >
            <Pin className={cn("h-3.5 w-3.5", note.pinned && "text-primary")} />
          </NotepadAction>
          <NotepadAction
            label={isTask ? "Transformar em anotação" : "Transformar em pendência"}
            onClick={() => onToggleKind(note)}
          >
            {isTask ? <StickyNote className="h-3.5 w-3.5" /> : <ListTodo className="h-3.5 w-3.5" />}
          </NotepadAction>
          <NotepadAction label="Apagar" onClick={() => onDelete(note)} tone="danger">
            <Trash2 className="h-3.5 w-3.5" />
          </NotepadAction>
        </div>
      </div>
    </li>
  );
}
