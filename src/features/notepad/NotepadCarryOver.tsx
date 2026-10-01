// Bloco de notas — pendências que ficaram para trás.
//
// O problema que esta faixa resolve: se cada anotação fica presa ao seu dia (e
// fica — é o que faz o caderno ter história), a pendência de terça-feira
// desaparece de vista na quarta. Migrar sozinha resolveria a visibilidade e
// destruiria o histórico: a tarefa passaria a "ter nascido hoje", e ninguém mais
// saberia que ela está aberta há três dias.
//
// A saída é não mexer no dado e mexer na apresentação: um "clipe" preso ACIMA da
// página de hoje, fora do papel, mostrando cada pendência com a data em que
// nasceu. Concluir dali resolve no lugar; "trazer para hoje" é um botão explícito
// que reescreve a data — decisão do agente, nunca automática.

import { useState } from "react";
import { ArrowDownToLine, ChevronDown, Flag } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { NotepadAction } from "./NotepadAction";
import { daysBetween, formatBrDate, todayInSaoPaulo } from "./notepadDates";
import { readPref, writePref } from "./notepadPrefs";
import type { AgentNote } from "./types";

type Props = {
  notes: AgentNote[];
  onToggleDone: (note: AgentNote) => void;
  onMoveToToday: (note: AgentNote) => void;
  onOpenDay: (date: string) => void;
};

export function NotepadCarryOver({ notes, onToggleDone, onMoveToToday, onOpenDay }: Props) {
  const [open, setOpen] = useState(() => readPref("carry") !== "0");
  const today = todayInSaoPaulo();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writePref("carry", next ? "1" : "0");
  };

  return (
    <section className="shrink-0 border-b border-status-open/25 bg-status-open/[0.08]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Flag aria-hidden className="h-3.5 w-3.5 shrink-0 text-status-open" />
        <span className="text-[11px] font-medium text-foreground">
          {notes.length} {notes.length === 1 ? "pendência" : "pendências"} de dias anteriores
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul className="max-h-[136px] overflow-y-auto overscroll-contain px-3 pb-2">
          {notes.map((note) => {
            const late = Math.abs(daysBetween(today, note.note_date));
            return (
              <li key={note.id} className="flex items-start gap-2 py-1">
                <Checkbox
                  checked={false}
                  onCheckedChange={() => onToggleDone(note)}
                  aria-label={`Concluir "${note.body}"`}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border-status-open/60"
                />

                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs leading-snug text-foreground">{note.body}</p>
                  <button
                    type="button"
                    onClick={() => onOpenDay(note.note_date)}
                    className="text-[10px] text-muted-foreground hover:text-primary hover:underline"
                  >
                    {formatBrDate(note.note_date)}
                    {late > 0 && ` · ${late} ${late === 1 ? "dia" : "dias"} atrás`}
                  </button>
                </div>

                <NotepadAction
                  label="Trazer para hoje"
                  onClick={() => onMoveToToday(note)}
                  className="mt-px"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </NotepadAction>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
