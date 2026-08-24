import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ESTRUTURA_LABEL, type Estrutura } from "../types";

const TOM: Record<Estrutura, string> = {
  nova: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
  antiga:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
};

const CURTO: Record<Estrutura, string> = {
  nova: "Nova",
  antiga: "Antiga",
};

/**
 * Estrutura errada = link errado para o cliente, então ela vira selo em cada
 * card. Antes o sinal vivia só no título da seção; com a lista paginada o card
 * precisa carregar a informação por conta própria.
 */
export function EstruturaBadge({
  estrutura,
  curto = false,
  className,
}: {
  estrutura: Estrutura;
  curto?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      title={ESTRUTURA_LABEL[estrutura]}
      className={cn("shrink-0 text-[10px] font-semibold", TOM[estrutura], className)}
    >
      {curto ? CURTO[estrutura] : ESTRUTURA_LABEL[estrutura]}
    </Badge>
  );
}
