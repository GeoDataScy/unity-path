import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { LyaChart } from "../types";

// Gráfico gerado pela Lya (tool gerar_grafico) e renderizado na conversa. A
// spec vem pronta do servidor — só dados numéricos, sem HTML. Paleta = tokens
// --chart-N do tema (os mesmos dos dashboards da gestora).
const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `hsl(var(--chart-${n}))`);
const axisTick = { fontSize: 11, fill: "hsl(var(--chart-axis))" };
const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  fontSize: 12,
  color: "hsl(var(--foreground))",
};

const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR") : String(v ?? ""));

export function ChartCard({ chart }: { chart: LyaChart }) {
  const rows = useMemo(
    () =>
      chart.categorias.map((cat, i) => {
        const row: Record<string, string | number> = { categoria: cat };
        for (const s of chart.series) row[s.nome] = s.valores[i] ?? 0;
        return row;
      }),
    [chart],
  );
  const pieData = useMemo(
    () => (chart.tipo === "pizza" ? chart.categorias.map((cat, i) => ({ name: cat, value: chart.series[0]?.valores[i] ?? 0 })) : []),
    [chart],
  );

  return (
    <div className="mt-3 w-full rounded-xl border border-border bg-card p-4">
      <div className="text-[13px] font-medium text-foreground">{chart.titulo}</div>
      {chart.subtitulo && <div className="mb-1 text-[11px] text-muted-foreground">{chart.subtitulo}</div>}
      <div className="mt-2" style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.tipo === "pizza" ? (
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={({ value }) => fmt(value)}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          ) : chart.tipo === "barras" ? (
            <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="categoria" tick={axisTick} />
              <YAxis tick={axisTick} tickFormatter={fmt} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chart.series.map((s, i) => (
                <Bar key={s.nome} dataKey={s.nome} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          ) : chart.tipo === "area" ? (
            <AreaChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="categoria" tick={axisTick} />
              <YAxis tick={axisTick} tickFormatter={fmt} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chart.series.map((s, i) => (
                <Area key={s.nome} type="monotone" dataKey={s.nome} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.18} />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="categoria" tick={axisTick} />
              <YAxis tick={axisTick} tickFormatter={fmt} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chart.series.map((s, i) => (
                <Line key={s.nome} type="monotone" dataKey={s.nome} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
