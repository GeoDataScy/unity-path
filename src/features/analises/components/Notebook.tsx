import type { CSSProperties, ReactNode } from "react";
import { Construction, Eye, FileCode2 } from "lucide-react";

import { cn } from "@/lib/utils";

// Peças de um notebook "somente leitura" no estilo Jupyter. Sem dados por
// enquanto: as páginas usam estas peças para mostrar a estrutura que os
// relatórios vão ter, marcada como prévia.

/** A folha branca do notebook, com a faixa do arquivo aberto no topo. */
export function NotebookSheet({ fileName, children }: { fileName: string; children: ReactNode }) {
  return (
    <article
      className="w-full overflow-hidden rounded-b-md bg-[var(--nb-sheet)] sm:rounded-tr-md"
      style={{ boxShadow: "var(--nb-sheet-shadow)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--nb-border)] bg-[var(--nb-chrome)] px-3 py-2 sm:px-5">
        <span className="flex min-w-0 items-center gap-2 text-[var(--nb-ink-2)]">
          <FileCode2 className="h-4 w-4 shrink-0 text-[var(--nb-accent)]" aria-hidden="true" />
          <span className="nb-code truncate text-[12.5px]">{fileName}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--nb-ink-3)]">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          Somente leitura
        </span>
      </div>
      <div className="space-y-2 px-2 py-5 sm:px-6 sm:py-8">{children}</div>
    </article>
  );
}

type CellKind = "markdown" | "code" | "output";

const PROMPT: Record<CellKind, string> = {
  markdown: "",
  code: "In [ ]:",
  output: "Out[ ]:",
};

/**
 * Uma célula. O prompt fica na coluna da esquerda, como no Jupyter; em tela
 * estreita ele sobe para cima do conteúdo para não roubar largura.
 * "[ ]" vazio é exatamente como o Jupyter mostra célula ainda não executada.
 */
export function Cell({
  kind,
  children,
  label,
}: {
  kind: CellKind;
  children: ReactNode;
  /** Rótulo acessível opcional (ex.: "Consulta usada"). */
  label?: string;
}) {
  const prompt = PROMPT[kind];
  return (
    <div
      role="group"
      aria-label={label}
      className="group relative grid grid-cols-1 gap-1 rounded-sm py-2 pl-3 pr-1 sm:grid-cols-[5.25rem_minmax(0,1fr)] sm:gap-3 sm:pr-2"
    >
      {/* Barra lateral da célula "selecionada" (azul do Jupyter), só no hover. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-[var(--nb-cell-active)] opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div
        aria-hidden={prompt ? undefined : true}
        className={cn(
          "nb-code select-none text-[12px] sm:pt-2.5 sm:text-right",
          kind === "code" && "text-[var(--nb-in)]",
          kind === "output" && "text-[var(--nb-out)]",
          !prompt && "hidden sm:block",
        )}
      >
        {prompt}
      </div>
      <div className="min-w-0">
        {kind === "code" ? (
          <div className="nb-code overflow-x-auto rounded-sm border border-[var(--nb-border)] bg-[var(--nb-code-bg)] px-3 py-2.5">
            {children}
          </div>
        ) : kind === "output" ? (
          <div className="py-1">{children}</div>
        ) : (
          <div className="nb-md py-1">{children}</div>
        )}
      </div>
    </div>
  );
}

/** Linha de código. `tone="comment"` pinta como comentário do Jupyter. */
export function CodeLine({ children, tone }: { children?: ReactNode; tone?: "comment" | "keyword" }) {
  return (
    <div
      className={cn(
        // Comentário quebra linha (em celular não esconde texto); código mantém o recuo.
        tone === "comment" ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        tone === "comment" && "italic text-[var(--nb-comment)]",
        tone === "keyword" && "text-[var(--nb-keyword)]",
        !tone && "text-[var(--nb-ink)]",
      )}
    >
      {children ?? " "}
    </div>
  );
}

/** Aviso "Em construção", no estilo das caixas de alerta do Jupyter. */
export function ConstructionNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="mt-4 flex gap-3 rounded-sm border border-[var(--nb-note-border)] bg-[var(--nb-note-bg)] px-4 py-3 text-[14px] leading-relaxed text-[var(--nb-note-ink)]"
    >
      <Construction className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <strong className="font-semibold">Em construção.</strong> {children}
      </div>
    </div>
  );
}

/**
 * Moldura tracejada em volta da prévia: deixa claro que o que está dentro é só
 * o desenho da estrutura, sem dado nenhum.
 */
export function PreviewFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={`Prévia: ${title}`}
      className="relative mt-4 rounded-md border border-dashed border-[var(--nb-border-strong)] px-1 pb-3 pt-7 sm:mt-6 sm:px-2"
    >
      <div className="absolute -top-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 bg-[var(--nb-sheet)] px-2">
        <span className="rounded-sm border border-[var(--nb-accent)] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--nb-accent-ink)]">
          Prévia
        </span>
        <span className="truncate text-[12.5px] text-[var(--nb-ink-3)]">{title}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/** Barra cinza no lugar de um texto que ainda não existe. */
export function Placeholder({ width, className }: { width: CSSProperties["width"]; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block h-2.5 rounded-full bg-[var(--nb-skeleton)]", className)}
      style={{ width }}
    />
  );
}

/** Texto-guia em itálico: diz o que vai entrar naquele lugar. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="italic text-[var(--nb-ink-3)]">{children}</p>;
}
