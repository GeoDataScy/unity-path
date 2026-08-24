import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { paginasVisiveis, type PanelPaginationState } from "../usePanelPagination";

type PanelPaginationProps = {
  estado: PanelPaginationState<unknown>;
  /** Nome da unidade paginada, no singular e no plural ("produto"/"produtos"). */
  rotulo: [string, string];
  porPagina: number;
  onPorPaginaChange: (n: number) => void;
  opcoesPorPagina?: number[];
};

/**
 * Rodapé de paginação compartilhado pelos painéis. Some quando cabe tudo numa
 * página só — pager de uma página é ruído.
 */
export function PanelPagination({
  estado,
  rotulo,
  porPagina,
  onPorPaginaChange,
  opcoesPorPagina = [12, 24, 48],
}: PanelPaginationProps) {
  const { pagina, setPagina, totalPaginas, total, inicio, fim } = estado;

  if (total === 0) return null;

  const unidade = total === 1 ? rotulo[0] : rotulo[1];
  const irPara = (p: number) => setPagina(Math.min(totalPaginas, Math.max(1, p)));

  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {inicio}–{fim}
          </span>{" "}
          de {total} {unidade}
        </p>

        {total > opcoesPorPagina[0] && (
          <Select
            value={String(porPagina)}
            onValueChange={(v) => onPorPaginaChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-[112px] text-xs" aria-label="Itens por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-50">
              {opcoesPorPagina.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n} por página
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {totalPaginas > 1 && (
        <Pagination className="mx-0 w-auto justify-start sm:justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={pagina === 1}
                className={cn("h-8", pagina === 1 && "pointer-events-none opacity-40")}
                onClick={(e) => {
                  e.preventDefault();
                  irPara(pagina - 1);
                }}
              />
            </PaginationItem>

            {paginasVisiveis(pagina, totalPaginas).map((p, idx) =>
              p === "gap" ? (
                <PaginationItem key={`gap-${idx}`}>
                  <PaginationEllipsis className="h-8" />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === pagina}
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.preventDefault();
                      irPara(p);
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={pagina === totalPaginas}
                className={cn("h-8", pagina === totalPaginas && "pointer-events-none opacity-40")}
                onClick={(e) => {
                  e.preventDefault();
                  irPara(pagina + 1);
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
