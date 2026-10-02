import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  HELD_ORDER_BUCKET_DOT,
  HELD_ORDER_BUCKET_LABEL,
  HELD_ORDER_BUCKETS,
  type HeldOrderBucket,
  type HeldOrdersTeam,
} from "./useHeldOrdersBoard";

type Props = {
  counts: Record<HeldOrderBucket, number> | undefined;
  today: HeldOrdersTeam["today"] | undefined;
  active: HeldOrderBucket | null;
  onChange: (next: HeldOrderBucket | null) => void;
  loading: boolean;
};

function hint(bucket: HeldOrderBucket, today: HeldOrdersTeam["today"] | undefined): string {
  if (!today) return "";
  switch (bucket) {
    case "sem_agente":
      return `${today.imported.toLocaleString("pt-BR")} entraram hoje`;
    case "novo":
      return "atribuídos, ninguém começou";
    case "andamento":
      return `${today.started.toLocaleString("pt-BR")} trabalhados hoje`;
    case "inativo":
      return "cliente não responde";
    case "concluido":
      return `${today.concluded.toLocaleString("pt-BR")} concluídos hoje`;
  }
}

/**
 * Onde estão os pedidos: uma aba por status, com a contagem do filtro atual.
 * Clicar filtra a lista; clicar de novo na aba ativa volta para todos.
 */
export function HeldOrdersStatusStrip({ counts, today, active, onChange, loading }: Props) {
  return (
    <div
      role="group"
      aria-label="Filtrar por status"
      className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card sm:grid-cols-3 lg:grid-cols-5"
    >
      {HELD_ORDER_BUCKETS.map((b) => {
        const isActive = active === b;
        const alerts = b === "inativo" ? today?.inactive_alerts ?? 0 : 0;
        return (
          <button
            key={b}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(isActive ? null : b)}
            className={cn(
              "relative grid gap-0.5 border-b border-r px-4 pb-3 pt-3.5 text-left transition-colors hover:bg-muted/60 lg:border-b-0 lg:last:border-r-0",
              isActive && "bg-muted/60",
            )}
          >
            {alerts > 0 && (
              <span className="absolute right-2.5 top-2.5 rounded-full bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">
                {alerts} para revisar
              </span>
            )}
            <span className="flex items-center gap-2 text-sm text-ink-secondary">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", HELD_ORDER_BUCKET_DOT[b])} />
              {HELD_ORDER_BUCKET_LABEL[b]}
            </span>
            {loading || !counts ? (
              <Skeleton className="my-1 h-7 w-16" />
            ) : (
              <span className="font-mono text-[26px] font-normal leading-8 tracking-[-0.03em] tabular-nums">
                {counts[b].toLocaleString("pt-BR")}
              </span>
            )}
            <span className="text-xs text-ink-tertiary">{hint(b, today)}</span>
            {isActive && <span className={cn("absolute inset-x-0 bottom-0 h-0.5", HELD_ORDER_BUCKET_DOT[b])} />}
          </button>
        );
      })}
    </div>
  );
}
