import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PanelToolbarProps = {
  busca: string;
  onBuscaChange: (v: string) => void;
  placeholder: string;
  /** Selects e toggles do painel — entram à direita da busca. */
  children?: ReactNode;
  className?: string;
};

/**
 * Barra de filtros única para todos os painéis: antes cada um montava a sua e
 * elas não batiam entre si (ordem, alturas e larguras diferentes por aba).
 *
 * Fica `sticky` no topo porque as listas são longas — o agente que rolou até a
 * página 3 continua com a busca à mão sem voltar ao topo.
 */
export function PanelToolbar({
  busca,
  onBuscaChange,
  placeholder,
  children,
  className,
}: PanelToolbarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-1 flex flex-col gap-2 border-b bg-dashboard-surface/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-dashboard-surface/80 lg:flex-row lg:items-center",
        className,
      )}
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => onBuscaChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 bg-background pl-9 pr-9"
        />
        {busca && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Limpar busca"
            onClick={() => onBuscaChange("")}
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {children && (
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">{children}</div>
      )}
    </div>
  );
}
