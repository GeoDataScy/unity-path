import type { LucideIcon } from "lucide-react";
import { AlertTriangle, SearchX } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Erro de carregamento — mesma mensagem/formato nas quatro abas. */
export function PanelError({ recurso }: { recurso: string }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        Não foi possível carregar {recurso}. Recarregue a página e tente de novo.
      </AlertDescription>
    </Alert>
  );
}

export function PanelSkeleton({
  quantidade = 6,
  altura = "h-40",
  colunas = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  quantidade?: number;
  altura?: string;
  colunas?: string;
}) {
  return (
    <div className={`grid gap-3 ${colunas}`}>
      {Array.from({ length: quantidade }).map((_, i) => (
        <Skeleton key={i} className={`${altura} rounded-xl`} />
      ))}
    </div>
  );
}

/**
 * Vazio com saída: filtro que não devolveu nada sem um botão de limpar deixa o
 * agente preso achando que o conteúdo não existe.
 */
export function PanelEmpty({
  titulo,
  descricao,
  onLimpar,
  icone: Icone = SearchX,
}: {
  titulo: string;
  descricao?: string;
  onLimpar?: () => void;
  icone?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
      <Icone className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{titulo}</p>
      {descricao && <p className="max-w-sm text-xs text-muted-foreground">{descricao}</p>}
      {onLimpar && (
        <Button variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={onLimpar}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
