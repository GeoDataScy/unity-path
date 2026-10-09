import { useMemo } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ChartMetric } from "./series";
import type { ComparisonSeriesRow } from "./types";
import { fmtInt, fmtPct, fmtUsd } from "./types";

type Props = {
  series: ComparisonSeriesRow[];
  products: { key: string; color: string }[];
  metric: ChartMetric;
  /** Lixeira do cartão (só gestora): apaga o reembolso externo importado do produto. */
  onDelete?: (product: string) => void;
};

/**
 * Um cartão por produto com o total do período, a fatia dele no total e uma
 * sparkline da série. A sparkline usa sempre o eixo do próprio produto — é
 * leitura de forma ("subiu? tem pico?"), não de comparação entre cartões, que é
 * o que a fatia em % já responde.
 */
export function ProductBreakdownCards({ series, products, metric, onDelete }: Props) {
  const dates = useMemo(() => [...new Set(series.map((r) => r.date))].sort(), [series]);

  const agg = useMemo(() => {
    const m = new Map<string, { orders: number; amount: number; partial: number; matched: number }>();
    for (const r of series) {
      const cur = m.get(r.product) ?? { orders: 0, amount: 0, partial: 0, matched: 0 };
      cur.orders += r.orders;
      cur.amount += Number(r.amount);
      cur.partial += r.partial;
      cur.matched += r.matched;
      m.set(r.product, cur);
    }
    return m;
  }, [series]);

  const totalOrders = useMemo(() => series.reduce((s, r) => s + r.orders, 0), [series]);

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of series) m.set(`${r.date}|${r.product}`, metric === "qtd" ? r.orders : Number(r.amount));
    return m;
  }, [series, metric]);

  if (products.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {products.map((p) => {
        const a = agg.get(p.key) ?? { orders: 0, amount: 0, partial: 0, matched: 0 };
        const serie = dates.map((d) => byDate.get(`${d}|${p.key}`) ?? 0);
        const mx = Math.max(1, ...serie);
        const w = 180;
        const h = 34;
        const step = w / Math.max(1, serie.length - 1);
        const pts = serie.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / mx) * h).toFixed(1)}`).join(" ");
        return (
          <div
            key={p.key}
            className="rounded-2xl border p-4"
            style={{ background: "var(--rf-panel)", borderColor: "var(--rf-line)", boxShadow: "var(--rf-shadow)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: "var(--rf-ink)" }}>
                <span className="h-3 w-3 shrink-0 rounded" style={{ background: p.color }} />
                <span className="truncate">{p.key}</span>
              </div>
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1.5 -mt-1 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(p.key)}
                  aria-label={`Apagar reembolsos externos de ${p.key}`}
                  title="Apagar os dados importados deste produto"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="rf-display mt-1 text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]" style={{ color: "var(--rf-ink)" }}>
              {metric === "qtd" ? fmtInt(a.orders) : fmtUsd(a.amount)}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--rf-ink-soft)" }}>
              {fmtInt(a.orders)} reemb. · {fmtPct(totalOrders > 0 ? (a.orders / totalOrders) * 100 : 0)} do total ·{" "}
              {fmtUsd(a.amount)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                style={{ background: "var(--rf-panel-2)", color: "var(--rf-ink-soft)" }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--rf-parcial)" }} />
                {fmtPct(a.orders > 0 ? (a.partial / a.orders) * 100 : 0)} parciais
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                style={{ background: "var(--rf-panel-2)", color: "var(--rf-ink-soft)" }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--rf-equipe)" }} />
                {fmtPct(a.orders > 0 ? (a.matched / a.orders) * 100 : 0)} interno
              </span>
            </div>
            <svg className="mt-3 w-full" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
              <polyline points={pts} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
