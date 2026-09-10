import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fmtInt, fmtMonth, type ComparisonProductMonthRow } from "./types";

// Azul = interno, laranja = loja. Mesmo par do card de eficiência por canal,
// validado para daltonismo nos dois temas. Cada produto tem o próprio painel
// (small multiples) em vez de um gráfico com seis cores.
export const COLOR_INTERNAL = "hsl(var(--chart-2))";
export const COLOR_EXTERNAL = "hsl(var(--chart-8))";

type Props = {
  rows: ComparisonProductMonthRow[];
};

type Point = {
  month: string;
  label: string;
  interno: number;
  externo: number;
  casados: number;
};

function PanelTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{p.label}</p>
      <p>Interno: {fmtInt(p.interno)}</p>
      <p>Loja: {fmtInt(p.externo)}</p>
      <p className="text-muted-foreground">Casados: {fmtInt(p.casados)}</p>
    </div>
  );
}

export function ProductMonthPanels({ rows }: Props) {
  const months = useMemo(() => Array.from(new Set(rows.map((r) => r.month))).sort(), [rows]);
  const products = useMemo(() => Array.from(new Set(rows.map((r) => r.product))).sort(), [rows]);

  const series = useMemo(() => {
    const byKey = new Map<string, ComparisonProductMonthRow>();
    for (const r of rows) byKey.set(`${r.product}|${r.month}`, r);
    return products.map((product) => ({
      product,
      points: months.map<Point>((month) => {
        const hit = byKey.get(`${product}|${month}`);
        return {
          month,
          label: fmtMonth(month),
          interno: hit?.internal_count ?? 0,
          externo: hit?.external_count ?? 0,
          casados: hit?.matched_count ?? 0,
        };
      }),
    }));
  }, [rows, products, months]);

  // Escala compartilhada: sem isso o painel de 7 pedidos parece igual ao de 717.
  const yMax = useMemo(() => {
    const max = Math.max(0, ...series.flatMap((s) => s.points.flatMap((p) => [p.interno, p.externo])));
    return Math.max(5, Math.ceil((max * 1.15) / 5) * 5);
  }, [series]);

  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados para o período.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_INTERNAL }} aria-hidden="true" />
          Interno (registrado pelos agentes)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_EXTERNAL }} aria-hidden="true" />
          Loja (export importado)
        </span>
        <span>Escala igual em todos os painéis.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {series.map((s) => (
          <div key={s.product} className="rounded-lg border bg-card p-3">
            <p className="truncate text-sm font-medium" title={s.product}>
              {s.product}
            </p>
            <div className="mt-2 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.points} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid stroke="hsl(var(--chart-grid))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "hsl(var(--chart-axis))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis domain={[0, yMax]} hide />
                  <Tooltip content={<PanelTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
                  <Bar dataKey="interno" name="Interno" fill={COLOR_INTERNAL} radius={[3, 3, 0, 0]}>
                    <LabelList dataKey="interno" position="top" fontSize={10} fill="hsl(var(--chart-axis))" />
                  </Bar>
                  <Bar dataKey="externo" name="Loja" fill={COLOR_EXTERNAL} radius={[3, 3, 0, 0]}>
                    <LabelList dataKey="externo" position="top" fontSize={10} fill="hsl(var(--chart-axis))" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
