import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ESTRUTURA_LABEL, type Estrutura } from "../types";

const TOM: Record<Estrutura, string> = {
  nova: "border-success/40 bg-signal-soft text-success",
  antiga:
    "border-warning/40 bg-warning-soft text-ink",
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
      className={cn("shrink-0 text-[10px] font-medium", TOM[estrutura], className)}
    >
      {curto ? CURTO[estrutura] : ESTRUTURA_LABEL[estrutura]}
    </Badge>
  );
}
