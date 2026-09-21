import { FileSpreadsheet, FileText, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { LyaArquivoAnexado } from "../types";

// Chip do arquivo anexado ao turno, acima da caixa de envio. Mostra o que a
// Lya vai receber junto da pergunta: nome, formato e tamanho em linhas.

export function LyaArquivoChip({
  arquivo,
  onRemover,
  carregando = false,
  legenda,
  className,
}: {
  arquivo: LyaArquivoAnexado;
  onRemover?: () => void;
  /** Ainda subindo: o chip já aparece, mas sem o X (não há o que desanexar). */
  carregando?: boolean;
  /** Substitui o detalhe enquanto sobe (ex.: "enviando 3.500/9.000"). */
  legenda?: string;
  className?: string;
}) {
  const Icone = arquivo.tipo === "markdown" ? FileText : FileSpreadsheet;
  const detalhe = arquivo.tipo === "markdown"
    ? "documento"
    : `${arquivo.total_linhas.toLocaleString("pt-BR")} linha${arquivo.total_linhas === 1 ? "" : "s"}`;

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-[12.5px] shadow-sm",
        className,
      )}
    >
      {carregando ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <Icone className="h-4 w-4 shrink-0 text-primary" />
      )}
      <span className="min-w-0 truncate font-medium text-foreground" title={arquivo.nome}>
        {arquivo.nome}
      </span>
      <span className="shrink-0 text-muted-foreground">{carregando ? "enviando…" : detalhe}</span>
      {!carregando && onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label={`Desanexar ${arquivo.nome}`}
          title="Desanexar"
          className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
