import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fmtInt, fmtMonth, fmtPct } from "@/features/copy/format";

type MonthlyRow = { month: string; category: string; n: number; share: number | null };

type Props = {
  rows: MonthlyRow[];
  /** Motivos a exibir, na ordem em que aparecem (maior volume primeiro). */
  categories: string[];
};

type Point = { month: string; label: string; share: number | null; n: number };

/**
 * Small multiples em vez de um gráfico com 4-5 linhas coloridas.
 *
 * Motivo: a identidade do motivo passa a vir do título do painel, não do matiz —
 * os tokens `--chart-*` do app não têm 4 cores que se separem com segurança em
 * daltonismo nos dois temas (roxo↔azul são praticamente iguais em protanopia).
 * Um painel, uma cor, escala Y compartilhada: comparação continua honesta.
 */
export function MixEvolutionPanels({ rows, categories }: Props) {
  const months = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => r.month)));
    return unique.sort();
  }, [rows]);

  const series = useMemo(() => {
    const byKey = new Map<string, MonthlyRow>();
    for (const row of rows) byKey.set(`${row.category}|${row.month}`, row);

    return categories.map((category) => ({
      category,
      points: months.map<Point>((month) => {
        const hit = byKey.get(`${category}|${month}`);
        return {
          month,
          label: fmtMonth(month),
          // Mês sem nenhum reembolso daquele motivo é 0% de participação, não
          // ausência de dado — a linha precisa cair até o chão.
          share: hit?.share ?? 0,
          n: hit?.n ?? 0,
        };
      }),
    }));
  }, [rows, categories, months]);

  // Escala compartilhada: sem isso cada painel se auto-escala e um motivo de 5%
  // parece do mesmo tamanho de um de 50%.
  const yMax = useMemo(() => {
    const max = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.share ?? 0)));
    return Math.min(100, Math.ceil((max + 5) / 10) * 10);
  }, [series]);

  if (months.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        O período selecionado cobre um único mês — escolha um intervalo maior para ver a evolução do mix.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {series.map((s) => {
        const last = s.points[s.points.length - 1];
        const first = s.points[0];
        const deltaPp = (last.share ?? 0) - (first.share ?? 0);

        return (
          <div key={s.category} className="rounded-lg border bg-card p-3">
            <p className="truncate text-xs font-medium" title={s.category}>
              {s.category}
            </p>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums">{fmtPct(last.share)}</span>
              <span className="text-[11px] text-muted-foreground">
                em {last.label} · {deltaPp >= 0 ? "+" : ""}
                {deltaPp.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p. desde {first.label}
              </span>
            </div>

            <div className="mt-2 h-24">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--chart-grid))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "hsl(var(--chart-axis))" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis domain={[0, yMax]} hide />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(value: number, _name, item) => [
                      `${fmtPct(value)} · ${fmtInt((item?.payload as Point)?.n)} reembolso(s)`,
                      "Participação",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="share"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: "hsl(var(--chart-2))" }}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
