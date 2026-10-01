// Bloco de notas — o caderno em si.
//
// Desenho, e o porquê de cada escolha:
//
// * Trilho à direita, altura inteira, SEM máscara escura por cima do app (só no
//   celular, onde ele ocupa a tela toda). O caderno é usado ENQUANTO se lê um
//   atendimento — se ele bloqueasse a tela, o agente teria que fechar para
//   consultar o pedido e abrir de novo para anotar.
// * Papel pautado de verdade: pauta a cada 28px, margem vermelha, blocado no
//   topo. É o que faz "bloco de notas" ser reconhecido em meio segundo, sem
//   precisar de título explicando. As regras de alinhamento estão em
//   notepadPaper.ts e valem para TODO filho do papel.
// * Uma página por dia. Semana e Mês não são "outros modos de escrever": são
//   modos de FOLHEAR — por isso não têm campo de escrita, e cada dia lá tem um
//   "+" que abre a página daquele dia. Anotação nasce sempre numa página.
// * Pendência de dia anterior não migra sozinha (isso apagaria o histórico do
//   dia em que foi criada): ela aparece numa faixa presa acima da página de hoje,
//   com a data de origem e um botão explícito de "trazer para hoje".

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Feather,
  Loader2,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { NotepadAction } from "./NotepadAction";
import { NotepadCarryOver } from "./NotepadCarryOver";
import { NotepadComposer, type NotepadComposerHandle } from "./NotepadComposer";
import { NotepadNote } from "./NotepadNote";
import {
  enumerateDays,
  formatShortDay,
  isIsoDate,
  isWeekend,
  rangeForScope,
  scopeHeadline,
  scopeSubtitle,
  shiftCursor,
  todayInSaoPaulo,
} from "./notepadDates";
import { MARGIN_LEFT, paperStyle } from "./notepadPaper";
import { readPref, writePref } from "./notepadPrefs";
import {
  useCreateNoteMutation,
  useDeleteNoteMutation,
  useNotesRangeQuery,
  useNotesSearchQuery,
  useOpenTasksQuery,
  useRestoreNoteMutation,
  useUpdateNoteMutation,
} from "./useAgentNotesQuery";
import { NOTEPAD_SCOPES, type AgentNote, type NoteKind, type NotepadScope } from "./types";

const MIN_SEARCH_LENGTH = 2;

type Props = {
  /** Controla só o transform: o pai monta/desmonta com o tempo da animação. */
  visible: boolean;
  onClose: () => void;
  fullName: string | null;
};

export function NotepadPanel({ visible, onClose, fullName }: Props) {
  const [today, setToday] = useState(todayInSaoPaulo);
  const [cursor, setCursor] = useState(today);
  const [scope, setScope] = useState<NotepadScope>(
    () => (readPref("scope") as NotepadScope) ?? "dia",
  );
  const [wide, setWide] = useState(() => readPref("wide") === "1");
  const [term, setTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const composerRef = useRef<NotepadComposerHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Caderno deixado aberto atravessa a meia-noite: sem isso, "hoje" continuaria
  // sendo o dia de ontem e a anotação da manhã cairia na página errada.
  useEffect(() => {
    const sync = () => setToday(todayInSaoPaulo());
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => writePref("scope", scope), [scope]);
  useEffect(() => writePref("wide", wide ? "1" : "0"), [wide]);

  const searching = searchOpen && term.trim().length >= MIN_SEARCH_LENGTH;
  const range = useMemo(() => rangeForScope(scope, cursor), [scope, cursor]);

  const notesQuery = useNotesRangeQuery(range.from, range.to, true);
  const openTasksQuery = useOpenTasksQuery(true);
  const searchQuery = useNotesSearchQuery(term, searching);

  const create = useCreateNoteMutation();
  const update = useUpdateNoteMutation();
  const remove = useDeleteNoteMutation();
  const restore = useRestoreNoteMutation();

  const saving =
    create.isPending || update.isPending || remove.isPending || restore.isPending;

  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);
  const byDay = useMemo(() => groupByDay(notes), [notes]);

  // Pendências que ficaram para trás. Vêm da mesma query do badge do atalho.
  // O `!n.done` é o que faz a linha sair da faixa no clique: o update otimista
  // marca `done` no cache antes da resposta do banco chegar.
  const carryOver = useMemo(
    () => (openTasksQuery.data ?? []).filter((n) => n.note_date < today && !n.done),
    [openTasksQuery.data, today],
  );

  const pendingInRange = notes.filter((n) => n.kind === "tarefa" && !n.done).length;

  const goToDay = (date: string) => {
    setCursor(date);
    setScope("dia");
    setSearchOpen(false);
    setTerm("");
    // O caderno abriu numa página nova: o cursor vai para a linha de escrita.
    window.setTimeout(() => composerRef.current?.focus(), 60);
  };

  const handleCreate = (body: string, kind: NoteKind) => {
    create.mutate(
      { body, kind, noteDate: cursor },
      { onError: (error) => toast.error(error.message) },
    );
  };

  const handleDelete = (note: AgentNote) => {
    remove.mutate(note, {
      onSuccess: () => {
        toast("Anotação apagada.", {
          action: {
            label: "Desfazer",
            onClick: () =>
              restore.mutate(note, { onError: (e) => toast.error(e.message) }),
          },
        });
      },
      onError: (error) => toast.error(error.message),
    });
  };

  const patch = (note: AgentNote, values: Parameters<typeof update.mutate>[0]["patch"]) => {
    update.mutate(
      { id: note.id, patch: values },
      { onError: (error) => toast.error(error.message) },
    );
  };

  const noteHandlers = {
    onToggleDone: (note: AgentNote) => patch(note, { done: !note.done }),
    onTogglePinned: (note: AgentNote) => patch(note, { pinned: !note.pinned }),
    onToggleKind: (note: AgentNote) =>
      patch(note, {
        kind: note.kind === "tarefa" ? "nota" : "tarefa",
        // Sair de pendência concluída para nota violaria a regra do banco
        // (só tarefa conclui), então a conclusão cai junto.
        ...(note.kind === "tarefa" && note.done ? { done: false } : {}),
      }),
    onSaveBody: (note: AgentNote, body: string) => patch(note, { body }),
    onDelete: handleDelete,
  };

  const firstName = (fullName ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <aside
      aria-label="Bloco de notas"
      className={cn(
        "fixed right-0 top-0 z-40 flex h-full flex-col bg-notepad-paper",
        "border-l border-notepad-rule shadow-lg",
        "transition-transform duration-300 ease-out will-change-transform",
        "w-full sm:w-[400px]",
        wide && "sm:w-[620px]",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      {/* ── Capa ─────────────────────────────────────────────────────────── */}
      <header className="bg-inverse px-3 py-2.5 text-ink-inverse">
        <div className="flex items-center gap-2">
          <NotebookPen aria-hidden className="h-4 w-4 shrink-0 opacity-80" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">Meu caderno</p>
            <p className="truncate text-[10px] leading-tight text-ink-inverse/60">
              {firstName ? `${firstName} · só você vê` : "anotações só suas"}
            </p>
          </div>

          <CoverAction
            label={searchOpen ? "Fechar busca" : "Buscar no caderno"}
            onClick={() => {
              const next = !searchOpen;
              setSearchOpen(next);
              if (!next) setTerm("");
              else window.setTimeout(() => searchRef.current?.focus(), 40);
            }}
            active={searchOpen}
          >
            <Search className="h-3.5 w-3.5" />
          </CoverAction>
          <CoverAction
            label={wide ? "Estreitar caderno" : "Alargar caderno"}
            onClick={() => setWide((v) => !v)}
            className="hidden sm:inline-flex"
          >
            {wide ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
          </CoverAction>
          <CoverAction label="Fechar caderno" onClick={onClose}>
            <X className="h-4 w-4" />
          </CoverAction>
        </div>

        {searchOpen && (
          <div className="relative mt-2">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-inverse/55"
            />
            <input
              ref={searchRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar em todas as datas…"
              aria-label="Buscar no caderno"
              className={cn(
                "h-8 w-full rounded-md border border-ink-inverse/20 bg-ink-inverse/10 pl-7 pr-7 text-xs",
                "text-ink-inverse placeholder:text-ink-inverse/50 focus:border-ink-inverse/40 focus:outline-none",
              )}
            />
            {term !== "" && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setTerm("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-inverse/60 hover:text-ink-inverse"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* Blocagem no topo do papel — o detalhe que faz o objeto ler como bloco. */}
      <div aria-hidden className="flex h-4 shrink-0 items-center justify-between px-5">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-4 rounded-full bg-foreground/10 ring-1 ring-inset ring-line"
          />
        ))}
      </div>

      {searching ? (
        <SearchResults
          term={term}
          notes={searchQuery.data ?? []}
          loading={searchQuery.isPending}
          handlers={noteHandlers}
        />
      ) : (
        <>
          {/* ── Navegador de páginas ────────────────────────────────────── */}
          <div className="shrink-0 border-b border-notepad-rule px-2 pb-2 pt-1.5">
            <div className="flex items-center gap-1">
              <NotepadAction
                label={scope === "dia" ? "Dia anterior" : scope === "semana" ? "Semana anterior" : "Mês anterior"}
                onClick={() => setCursor((c) => shiftCursor(scope, c, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </NotepadAction>

              <div className="min-w-0 flex-1 text-center">
                {/* Sem `capitalize` do CSS: quem cuida da maiúscula é
                    notepadDates, que capitaliza só a primeira letra. */}
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {scopeHeadline(scope, cursor, today)}
                </p>
                <p className="truncate text-[10px] leading-tight text-muted-foreground">
                  {scopeSubtitle(scope, cursor, today)}
                </p>
              </div>

              <NotepadAction
                label={scope === "dia" ? "Dia seguinte" : scope === "semana" ? "Semana seguinte" : "Mês seguinte"}
                onClick={() => setCursor((c) => shiftCursor(scope, c, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </NotepadAction>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex rounded-lg bg-foreground/[0.05] p-0.5">
                {NOTEPAD_SCOPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setScope(option.value)}
                    aria-pressed={scope === option.value}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                      scope === option.value
                        ? "bg-notepad-paper text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {cursor !== today && (
                <button
                  type="button"
                  onClick={() => setCursor(today)}
                  className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  Ir para hoje
                </button>
              )}
            </div>
          </div>

          {/* ── Faixa de pendências vindas de trás ──────────────────────── */}
          {scope === "dia" && cursor === today && carryOver.length > 0 && (
            <NotepadCarryOver
              notes={carryOver}
              onToggleDone={noteHandlers.onToggleDone}
              onMoveToToday={(note) => patch(note, { note_date: today })}
              onOpenDay={goToDay}
            />
          )}

          {/* ── Papel ──────────────────────────────────────────────────── */}
          <Paper>
            {notesQuery.isError ? (
              <PaperMessage
                title="Não foi possível carregar o caderno."
                hint={notesQuery.error?.message}
                action={{ label: "Tentar de novo", onClick: () => notesQuery.refetch() }}
              />
            ) : scope === "dia" ? (
              <>
                <NotepadComposer
                  ref={composerRef}
                  dayLabel={scopeHeadline("dia", cursor, today).toLowerCase()}
                  saving={create.isPending}
                  onCreate={handleCreate}
                  onEscapeEmpty={onClose}
                />
                {byDay.get(cursor)?.length ? (
                  <ul>
                    {byDay.get(cursor)!.map((note) => (
                      <NotepadNote key={note.id} note={note} {...noteHandlers} />
                    ))}
                  </ul>
                ) : notesQuery.isPending ? (
                  <PaperLoading />
                ) : (
                  <PaperMessage
                    title="Página em branco"
                    hint="Escreva na linha acima o que não pode esquecer hoje."
                  />
                )}
              </>
            ) : notesQuery.isPending ? (
              <PaperLoading />
            ) : (
              <SpreadView
                scope={scope}
                cursor={cursor}
                today={today}
                byDay={byDay}
                onOpenDay={goToDay}
                handlers={noteHandlers}
              />
            )}
          </Paper>
        </>
      )}

      {/* ── Rodapé ───────────────────────────────────────────────────────── */}
      <footer className="flex h-9 shrink-0 items-center gap-1.5 border-t border-notepad-rule px-3 text-[10px] text-muted-foreground">
        <span>
          {notes.length} {notes.length === 1 ? "anotação" : "anotações"}
        </span>
        {pendingInRange > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="font-medium text-status-open">
              {pendingInRange} {pendingInRange === 1 ? "pendente" : "pendentes"}
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          {saving ? (
            <>
              <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Check aria-hidden className="h-3 w-3 text-status-success" />
              Salvo na sua conta
            </>
          )}
        </span>
      </footer>
    </aside>
  );
}

// ── Peças internas ──────────────────────────────────────────────────────────

type NoteHandlers = {
  onToggleDone: (note: AgentNote) => void;
  onTogglePinned: (note: AgentNote) => void;
  onToggleKind: (note: AgentNote) => void;
  onSaveBody: (note: AgentNote, body: string) => void;
  onDelete: (note: AgentNote) => void;
};

/** Área pautada e rolável, com a linha da margem. */
function Paper({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex-1 overflow-y-auto overscroll-contain">
      <div className="relative min-h-full pb-16" style={paperStyle}>
        {/* Linha da margem. Abaixo de ~60% de opacidade ela deixa de ser lida
            como vermelha e vira mais uma pauta cinza. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-notepad-margin/60"
          style={{ left: MARGIN_LEFT }}
        />
        {children}
      </div>
    </div>
  );
}

/** Alturas múltiplas de 28px para não desalinhar a pauta. */
function PaperLoading() {
  return (
    <div className="flex h-28 items-center justify-center">
      <Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-foreground/60" />
    </div>
  );
}

function PaperMessage({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-28 flex-col items-center justify-center gap-1 px-6 text-center">
      <Feather aria-hidden className="h-4 w-4 text-muted-foreground/40" />
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {hint && <p className="text-[10px] leading-snug text-muted-foreground/70">{hint}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="text-[11px] font-medium text-primary hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Semana: os sete dias, inclusive os vazios. Mês: só os dias escritos. */
function SpreadView({
  scope,
  cursor,
  today,
  byDay,
  onOpenDay,
  handlers,
}: {
  scope: NotepadScope;
  cursor: string;
  today: string;
  byDay: Map<string, AgentNote[]>;
  onOpenDay: (date: string) => void;
  handlers: NoteHandlers;
}) {
  const range = rangeForScope(scope, cursor);
  const days =
    scope === "semana"
      ? // A semana mostra os dias vazios (é o valor de ver a semana inteira),
        // menos sábado e domingo em branco: quatro linhas de "—" no fim da lista
        // só empurram para baixo o que interessa. Fim de semana COM anotação
        // continua aparecendo.
        enumerateDays(range.from, range.to).filter(
          (date) => !isWeekend(date) || (byDay.get(date)?.length ?? 0) > 0,
        )
      : [...byDay.keys()].sort();

  if (days.length === 0) {
    return (
      <PaperMessage
        title="Nenhuma anotação neste mês"
        hint="Abra um dia para escrever."
      />
    );
  }

  return (
    <div>
      {days.map((date) => {
        const dayNotes = byDay.get(date) ?? [];
        return (
          <section key={date}>
            <header
              className="flex h-7 items-center gap-1.5 pr-1"
              style={{ paddingLeft: MARGIN_LEFT + 12 }}
            >
              <span
                className={cn(
                  "text-[11px] font-medium",
                  date === today ? "text-primary" : "text-muted-foreground",
                )}
              >
                {formatShortDay(date)}
              </span>
              {date === today && (
                <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                  hoje
                </span>
              )}
              {dayNotes.length > 0 && (
                <span className="text-[10px] text-muted-foreground/60">
                  {dayNotes.length}
                </span>
              )}
              <div className="ml-auto">
                <NotepadAction
                  label={`Escrever em ${formatShortDay(date)}`}
                  onClick={() => onOpenDay(date)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </NotepadAction>
              </div>
            </header>

            {dayNotes.length === 0 ? (
              <div
                className="flex h-7 items-center text-[11px] text-muted-foreground/40"
                style={{ paddingLeft: MARGIN_LEFT + 12 }}
              >
                —
              </div>
            ) : (
              <ul>
                {dayNotes.map((note) => (
                  <NotepadNote key={note.id} note={note} {...handlers} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Busca: lista corrida com a data à direita — aqui o dia é resultado, não contexto. */
function SearchResults({
  term,
  notes,
  loading,
  handlers,
}: {
  term: string;
  notes: AgentNote[];
  loading: boolean;
  handlers: NoteHandlers;
}) {
  return (
    <Paper>
      <div
        className="flex h-7 items-center pr-3 text-[10px] text-muted-foreground"
        style={{ paddingLeft: MARGIN_LEFT + 12 }}
      >
        {loading
          ? "Buscando…"
          : `${notes.length} ${notes.length === 1 ? "resultado" : "resultados"} para “${term.trim()}”`}
      </div>

      {loading ? (
        <PaperLoading />
      ) : notes.length === 0 ? (
        <PaperMessage title="Nada encontrado" hint="Tente outra palavra do texto da anotação." />
      ) : (
        <ul>
          {notes.map((note) => (
            <NotepadNote key={note.id} note={note} showDate {...handlers} />
          ))}
        </ul>
      )}

    </Paper>
  );
}

/** Botão de ícone da capa (fundo escuro) — o do papel é o NotepadAction. */
function CoverAction({
  label,
  onClick,
  children,
  active,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
        "text-ink-inverse/70 hover:bg-ink-inverse/10 hover:text-ink-inverse",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-inverse/40",
        active && "bg-ink-inverse/15 text-ink-inverse",
        className,
      )}
    >
      {children}
    </button>
  );
}

function groupByDay(notes: AgentNote[]): Map<string, AgentNote[]> {
  const map = new Map<string, AgentNote[]>();
  for (const note of notes) {
    if (!isIsoDate(note.note_date)) continue;
    const bucket = map.get(note.note_date);
    if (bucket) bucket.push(note);
    else map.set(note.note_date, [note]);
  }
  return map;
}
