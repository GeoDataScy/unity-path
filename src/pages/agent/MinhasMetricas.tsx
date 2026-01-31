import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, LineChart as LineChartIcon, Package, TrendingUp } from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useMyMetricsRangeQuery } from "@/features/agent/useMyMetricsRangeQuery";
import { useMyProductMixQuery } from "@/features/agent/useMyProductMixQuery";

const DONUT_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--ring))",
  "hsl(var(--muted-foreground))",
  "hsl(var(--foreground))",
];

function saoPauloISODate(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function parseISODateOnlyToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatCompactNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

export default function MinhasMetricas() {
  const { fullName } = useOutletContext<AgentOutletContext>();

  const defaultRange = useMemo<DateRange>(() => {
    const todayISO = saoPauloISODate();
    const today = parseISODateOnlyToLocalDate(todayISO);
    const from = addDays(today, -6);
    return { from, to: today };
  }, []);

  const [range, setRange] = useState<DateRange | undefined>(defaultRange);

  const { fromISO, toISO } = useMemo(() => {
    const todayISO = saoPauloISODate();
    const fallbackTo = todayISO;
    const fallbackFrom = saoPauloISODate(addDays(new Date(), -6));

    const from = range?.from ? saoPauloISODate(range.from) : fallbackFrom;
    const to = (range?.to ?? range?.from) ? saoPauloISODate((range?.to ?? range?.from) as Date) : fallbackTo;

    return { fromISO: from, toISO: to };
  }, [range]);

  const metricsQuery = useMyMetricsRangeQuery({ enabled: true, from: fromISO, to: toISO });
  const mixQuery = useMyProductMixQuery({ enabled: true, from: fromISO, to: toISO, topN: 10 });

  const isLoading = metricsQuery.isLoading || mixQuery.isLoading;
  const metrics = metricsQuery.data;
  const mix = mixQuery.data ?? [];

  const greetingName = useMemo(() => {
    const trimmed = (fullName ?? "").trim();
    return trimmed.length > 0 ? trimmed : "Time";
  }, [fullName]);

  const kpis = useMemo(() => {
    const empty = {
      days: 7,
      total: 0,
      avgDaily: 0,
      bestDayLabel: "—",
      bestDayCount: 0,
      trendPct: 0,
      trendLabel: "Estável" as string,
      trendTone: "neutral" as "success" | "open" | "destructive" | "neutral",
      chartSeries: [] as Array<{ day: string; value: number; avg: number }>,
      tableRows: [] as Array<{ dayISO: string; dayLabel: string; value: number; delta: number; note: string }>,
    };

    if (!metrics) return empty;

    const days = Math.max(1, metrics.days ?? 1);
    const avg = Number(metrics.avg_daily ?? 0);

    const byDay = (metrics.by_day ?? []).map((d) => ({
      dayISO: d.day,
      dayLabel: format(parseISO(d.day), "dd/MM"),
      value: d.value ?? 0,
    }));

    const chartSeries = byDay.map((d) => ({ day: d.dayLabel, value: d.value, avg }));

    const tableRows = byDay.map((d, idx) => {
      const prev = idx > 0 ? byDay[idx - 1].value : null;
      const delta = prev == null ? 0 : d.value - prev;
      const note = d.value > avg ? "Acima da média" : d.value < avg ? "Abaixo da média" : "Na média";
      return {
        dayISO: d.dayISO,
        dayLabel: format(parseISO(d.dayISO), "dd/MM/yyyy"),
        value: d.value,
        delta,
        note,
      };
    });

    const trendPct = Number(metrics.trend_pct ?? 0);
    const trendLabel = metrics.trend_label ?? "Estável";
    const trendTone = trendPct >= 5 ? "success" : trendPct <= -5 ? "destructive" : "open";

    const bestDayLabel = metrics.best_day ? format(parseISO(metrics.best_day), "dd/MM/yyyy") : "—";

    return {
      days,
      total: Number(metrics.total_count ?? 0),
      avgDaily: avg,
      bestDayLabel,
      bestDayCount: Number(metrics.best_day_count ?? 0),
      trendPct,
      trendLabel,
      trendTone,
      chartSeries,
      tableRows,
    };
  }, [metrics]);

  const trendClass =
    kpis.trendTone === "success"
      ? "text-status-success"
      : kpis.trendTone === "destructive"
        ? "text-destructive"
        : kpis.trendTone === "open"
          ? "text-status-open"
          : "text-foreground";

  const totalInPeriod = kpis.total;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-lg font-semibold text-muted-foreground">Olá {greetingName}!</p>
          <h1 className="text-3xl font-semibold tracking-tight">Minhas métricas</h1>
          <p className="text-sm text-muted-foreground">
            Período: {format(parseISO(fromISO), "dd/MM/yyyy")} — {format(parseISO(toISO), "dd/MM/yyyy")}
          </p>
        </div>

        <div className="w-full md:w-[340px]">
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Total no período
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-3xl font-semibold">{formatCompactNumber(kpis.total)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Média diária
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-3xl font-semibold">{kpis.avgDaily.toFixed(1).replace(".", ",")}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <LineChartIcon className="h-4 w-4 text-primary" /> Tendência
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <>
                <div className={cn("text-lg font-semibold", trendClass)}>
                  {kpis.trendLabel} ({kpis.trendPct.toFixed(0)}%)
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  (média da 2ª metade vs 1ª metade do período)
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> Melhor dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <>
                <div className="text-lg font-semibold">
                  {kpis.bestDayLabel} ({formatCompactNumber(kpis.bestDayCount)})
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Charts row */}
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evolução (atendimentos por dia)</CardTitle>
          </CardHeader>
          <CardContent className="h-[340px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.chartSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={kpis.chartSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <ReferenceLine
                    y={kpis.avgDaily}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="6 6"
                    ifOverflow="extendDomain"
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mix de produtos</CardTitle>
          </CardHeader>
          <CardContent className="h-[340px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : mix.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip />
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
                    {mix.map((_, i) => (
                      <Cell key={`cell-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Daily table */}
      <section className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Tabela diária</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : kpis.tableRows.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Atendimentos</TableHead>
                      <TableHead>Δ vs dia anterior</TableHead>
                      <TableHead>Leitura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpis.tableRows.map((row, idx) => {
                      const deltaTone = row.delta > 0 ? "text-status-success" : row.delta < 0 ? "text-destructive" : "text-muted-foreground";
                      const deltaLabel = idx === 0 ? "—" : `${row.delta > 0 ? "+" : ""}${row.delta}`;
                      const pct = totalInPeriod > 0 ? Math.round((row.value / totalInPeriod) * 100) : 0;
                      return (
                        <TableRow key={row.dayISO}>
                          <TableCell>{row.dayLabel}</TableCell>
                          <TableCell className="font-medium">
                            {formatCompactNumber(row.value)}
                            <span className="ml-2 text-xs text-muted-foreground">({pct}%)</span>
                          </TableCell>
                          <TableCell className={cn("font-medium", deltaTone)}>{deltaLabel}</TableCell>
                          <TableCell className="text-muted-foreground">{row.note}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
