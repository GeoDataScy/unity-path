import { cn } from "@/lib/utils";

type Props = {
  /** 0–100. */
  value: number | null | undefined;
  /** Fim da escala; use o maior valor da lista para as barras serem comparáveis. */
  max?: number;
  className?: string;
};

/**
 * Barra dentro da célula da tabela: é o gráfico de barras da lista, só que sem
 * duplicar a tabela ao lado dele. O número fica na célula vizinha (o valor nunca
 * é só a barra), então a cor aqui não carrega informação sozinha.
 */
export function ShareBar({ value, max = 100, className }: Props) {
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, (value / (max || 100)) * 100));

  return (
    <div className={cn("h-2 w-full min-w-[48px] overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-[hsl(var(--chart-2))]"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
