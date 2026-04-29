import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
import {
  Award,
  BarChart3,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useMyAgentMetricsQuery, type AgentMyMetrics } from "@/features/agent/useMyAgentMetricsQuery";

// ── Constants ──────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(221 83% 65%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(var(--muted-foreground))",
  "hsl(262 80% 60%)",
  "hsl(0 72% 55%)",
];

const CHANNEL_COLORS: Record<string, string> = {
  Email:           "hsl(221 83% 55%)",
  SMS:             "hsl(142 71% 45%)",
  Clickbank:       "hsl(38 92% 50%)",
  "Não informado": "hsl(var(--muted-foreground))",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function spToday(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function parseISOLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function fmtN(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function fmtUsd(n: number) {
  return "$ " + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ── Motivation engine ──────────────────────────────────────────────────────────

type MotivationTone = "leader" | "great" | "good" | "neutral" | "push";

interface MotivationResult {
  title: string;
  message: string;
  tone: MotivationTone;
}

function getMotivation(m: AgentMyMetrics, days: number): MotivationResult {
  const { total_interactions: total, benchmark_count: bench, benchmark_name: benchName,
          is_leader, trend_label, trend_pct, avg_daily, new_services } = m;

  if (total === 0) {
    return {
      title: "Bora começar!",
      message: "Nenhuma interação registrada neste período. O primeiro atendimento do dia é o mais importante — vamos lá!",
      tone: "push",
    };
  }

  if (is_leader || bench === 0) {
    return {
      title: "Você lidera o período! 🏆",
      message: `Com ${fmtN(total)} interações você está no topo do time neste período. Mantenha esse ritmo!`,
      tone: "leader",
    };
  }

  const pct = Math.round((total / bench) * 100);
  const gap = bench - total;
  const neededAvg = days > 0 ? Math.ceil(bench / days) : 0;

  if (pct >= 90) {
    return {
      title: "Incrível! Quase no topo 🎯",
      message: `Você está a apenas ${fmtN(gap)} interação${gap !== 1 ? "ões" : ""} de superar ${benchName} (${fmtN(bench)}). Empurra mais!`,
      tone: "great",
    };
  }

  if (pct >= 70 && trend_label === "Evoluindo") {
    return {
      title: `Evoluindo ${Math.abs(trend_pct).toFixed(0)}%! 📈`,
      message: `Você está crescendo e chegando perto do benchmark de ${benchName} (${fmtN(bench)}). Continue assim e vai chegar lá!`,
      tone: "great",
    };
  }

  if (pct >= 70) {
    return {
      title: "Bom desempenho!",
      message: `${pct}% do benchmark. ${benchName} tem ${fmtN(bench)} interações. Média de ${avg_daily.toFixed(1)}/dia — tente chegar a ${neededAvg}/dia.`,
      tone: "good",
    };
  }

  if (pct >= 50 && trend_label === "Evoluindo") {
    return {
      title: "Tendência positiva! 📊",
      message: `Você já registrou ${fmtN(new_services)} atendimento${new_services !== 1 ? "s" : ""} novos. Com a tendência crescente, o benchmark (${fmtN(bench)}) está ao alcance.`,
      tone: "good",
    };
  }

  if (pct >= 50) {
    return {
      title: "Potencial em construção",
      message: `Você tem ${fmtN(total)} interações vs ${fmtN(bench)} do benchmark (${benchName}). Uma média de ${neededAvg}/dia é o que precisa para chegar lá.`,
      tone: "neutral",
    };
  }

  return {
    title: "Hora de acelerar! 🚀",
    message: `Cada interação conta. O benchmark do período é ${fmtN(bench)} (${benchName}). ${trend_label === "Evoluindo" ? "A tendência está positiva — mantenha o foco!" : "Foque nos atendimentos novos e nas interações de follow-up!"}`,
    tone: "push",
  };
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <div className="text-3xl font-semibold">{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Empty chart placeholder ────────────────────────────────────────────────────

function ChartEmpty({ msg = "Nenhum dado no período" }: { msg?: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{msg}</div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MinhasMetricas() {
  const { fullName } = useOutletContext<AgentOutletContext>();

  const defaultRange = useMemo<DateRange>(() => {
    const todayISO = spToday();
    const today = parseISOLocal(todayISO);
    return { from: addDays(today, -29), to: today };
  }, []);

  const [range, setRange] = useState<DateRange | undefined>(defaultRange);

  const { fromISO, toISO } = useMemo(() => {
    const today = spToday();
    const from = range?.from ? spToday(range.from) : spToday(addDays(new Date(), -29));
    const to   = range?.to   ? spToday(range.to)   : (range?.from ? spToday(range.from) : today);
    return { fromISO: from, toISO: to };
  }, [range]);

  const days = useMemo(() => {
    const d = (parseISOLocal(toISO).getTime() - parseISOLocal(fromISO).getTime()) / 86_400_000 + 1;
    return Math.max(1, Math.round(d));
  }, [fromISO, toISO]);

  const metricsQuery = useMyAgentMetricsQuery({ enabled: true, from: fromISO, to: toISO });
  const isLoading = metricsQuery.isLoading;
  const m = metricsQuery.data;

  const greetingName = (fullName ?? "").trim() || "Agente";

  // ── Derived display values ───────────────────────────────────────────────────

  const trend = useMemo(() => {
    if (!m) return { label: "—", pct: 0, tone: "neutral" as const, Icon: TrendingUp };
    const pct = Number(m.trend_pct ?? 0);
    const label = m.trend_label ?? "Estável";
    const tone = pct >= 5 ? ("success" as const) : pct <= -5 ? ("destructive" as const) : ("neutral" as const);
    const Icon = pct >= 5 ? TrendingUp : pct <= -5 ? TrendingDown : BarChart3;
    return { label, pct, tone, Icon };
  }, [m]);

  const motivation = useMemo(() => {
    if (!m) return null;
    return getMotivation(m, days);
  }, [m, days]);

  const benchPct = useMemo(() => {
    if (!m || m.benchmark_count === 0) return 100;
    return Math.min(Math.round((m.total_interactions / m.benchmark_count) * 100), 100);
  }, [m]);

  const chartSeries = useMemo(() => {
    if (!m) return [];
    return (m.by_day ?? []).map((d) => ({
      day: format(parseISO(d.day), "dd/MM"),
      total: d.value,
      novos: d.services,
      followups: d.followups,
    }));
  }, [m]);

  const avgDaily = m ? Number(m.avg_daily ?? 0) : 0;

  const trendClass =
    trend.tone === "success"
      ? "text-green-600"
      : trend.tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  const motivationBg: Record<MotivationTone, string> = {
    leader:  "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30",
    great:   "border-green-400 bg-green-50 dark:bg-green-950/30",
    good:    "border-primary/40 bg-primary/5",
    neutral: "border-border bg-card",
    push:    "border-orange-400 bg-orange-50 dark:bg-orange-950/30",
  };

  const motivationIcon: Record<MotivationTone, React.ElementType> = {
    leader:  Award,
    great:   Star,
    good:    TrendingUp,
    neutral: BarChart3,
    push:    Zap,
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Olá, {greetingName}!</p>
          <h1 className="text-3xl font-semibold tracking-tight">Minhas Métricas</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {format(parseISO(fromISO), "dd/MM/yyyy")} — {format(parseISO(toISO), "dd/MM/yyyy")}
            &nbsp;·&nbsp;{days} dia{days !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="w-full md:w-[340px]">
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </header>

      {/* Motivation card */}
      {isLoading ? (
        <Skeleton className="mb-6 h-20 w-full rounded-xl" />
      ) : motivation && (
        <div className={cn("mb-6 flex items-start gap-3 rounded-xl border p-4", motivationBg[motivation.tone])}>
          {(() => {
            const Icon = motivationIcon[motivation.tone];
            return <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />;
          })()}
          <div>
            <p className="font-semibold">{motivation.title}</p>
            <p className="text-sm text-muted-foreground">{motivation.message}</p>
          </div>
        </div>
      )}

      {/* ── KPIs: Atendimentos ─────────────────────────────────────────────── */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Atendimentos
      </h2>
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Total de interações"
          value={fmtN(m?.total_interactions ?? 0)}
          sub="novos + follow-ups"
          icon={BarChart3}
          loading={isLoading}
        />
        <KpiCard
          label="Novos atendimentos"
          value={fmtN(m?.new_services ?? 0)}
          sub="tickets registrados"
          icon={MessageSquare}
          loading={isLoading}
        />
        <KpiCard
          label="Follow-ups"
          value={fmtN(m?.follow_ups ?? 0)}
          sub="interações em abertos"
          icon={RefreshCw}
          loading={isLoading}
        />
        <KpiCard
          label="Média diária"
          value={isLoading ? "—" : avgDaily.toFixed(1).replace(".", ",")}
          sub="interações/dia"
          icon={TrendingUp}
          loading={isLoading}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <trend.Icon className="h-4 w-4 text-primary" />
              Tendência
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <div className={cn("text-xl font-semibold", trendClass)}>
                  {trend.label}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {trend.pct >= 0 ? "+" : ""}{trend.pct.toFixed(0)}% (2ª vs 1ª metade)
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── KPIs: Reembolsos + Benchmark ──────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Reembolsos em aberto"
          value={fmtN(m?.refunds_open ?? 0)}
          sub="solicitados no período"
          icon={RefreshCw}
          loading={isLoading}
        />
        <KpiCard
          label="Reembolsos concluídos"
          value={fmtN(m?.refunds_done ?? 0)}
          sub="finalizados no período"
          icon={CheckCircle2}
          loading={isLoading}
        />
        <KpiCard
          label="Valor reembolsado"
          value={isLoading ? "—" : fmtUsd(m?.refunds_total_value ?? 0)}
          sub="concluídos no período"
          icon={BarChart3}
          loading={isLoading}
        />

        {/* Benchmark card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4 text-primary" />
              Benchmark do período
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : m?.is_leader ? (
              <>
                <div className="text-xl font-semibold text-yellow-600">Você lidera! 🏆</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{fmtN(m.benchmark_count)} interações no topo</div>
              </>
            ) : (
              <>
                <div className="text-base font-semibold">{m?.benchmark_name ?? "—"}</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${benchPct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs font-medium">{benchPct}%</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtN(m?.total_interactions ?? 0)} / {fmtN(m?.benchmark_count ?? 0)} interações
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Melhor dia ────────────────────────────────────────────────────── */}
      {!isLoading && m?.best_day && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border bg-card px-4 py-3">
          <Award className="h-4 w-4 text-yellow-500" />
          <span className="text-sm">
            <span className="font-semibold">Melhor dia do período:</span>{" "}
            {format(parseISO(m.best_day), "dd/MM/yyyy")} com{" "}
            <span className="font-semibold text-primary">{fmtN(m.best_day_count)} interações</span>
          </span>
        </div>
      )}

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        {/* Evolução diária */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Evolução diária (interações)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : chartSeries.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(val: number, name: string) => [
                      fmtN(val),
                      name === "total" ? "Total" : name === "novos" ? "Novos" : "Follow-ups",
                    ]}
                  />
                  <Legend
                    formatter={(v) => v === "total" ? "Total" : v === "novos" ? "Novos" : "Follow-ups"}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <ReferenceLine
                    y={avgDaily}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="6 4"
                    label={{ value: "Média", position: "insideTopRight", fontSize: 10 }}
                  />
                  <Line type="monotone" dataKey="total"     stroke="hsl(var(--primary))"    strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="novos"     stroke="hsl(142 71% 45%)"       strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="followups" stroke="hsl(221 83% 65%)"       strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Canal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por canal</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : !m?.by_channel?.length ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={m.by_channel}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [fmtN(v), "Interações"]} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {(m.by_channel ?? []).map((entry, i) => (
                      <Cell key={entry.name} fill={CHANNEL_COLORS[entry.name] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Produtos */}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mix de produtos</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : !m?.by_product?.length ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [fmtN(v), "Atend."]} />
                  <Pie
                    data={m.by_product}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {(m.by_product ?? []).map((_, i) => (
                      <Cell key={`c-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Plataforma */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Por plataforma</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : !m?.by_platform?.length ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={m.by_platform}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [fmtN(v), "Interações"]} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Tabela diária ─────────────────────────────────────────────────── */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalhamento por dia</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !chartSeries.length ? (
              <div className="py-10 text-center text-muted-foreground">Nenhum dado no período</div>
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Novos</TableHead>
                      <TableHead className="text-right">Follow-ups</TableHead>
                      <TableHead className="text-right">% período</TableHead>
                      <TableHead>Leitura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(m?.by_day ?? []).map((row, idx) => {
                      const prev    = idx > 0 ? (m?.by_day ?? [])[idx - 1].value : null;
                      const delta   = prev == null ? null : row.value - prev;
                      const pct     = (m?.total_interactions ?? 0) > 0
                        ? Math.round((row.value / (m?.total_interactions ?? 1)) * 100)
                        : 0;
                      const reading =
                        row.value === 0            ? "Sem atividade"
                        : row.value > avgDaily * 1.2 ? "Acima da média"
                        : row.value < avgDaily * 0.8 ? "Abaixo da média"
                        : "Na média";
                      const readingBadge =
                        reading === "Acima da média"   ? "success"
                        : reading === "Abaixo da média" ? "destructive"
                        : reading === "Sem atividade"   ? "open"
                        : "secondary";
                      const deltaColor =
                        delta == null ? "" : delta > 0 ? "text-green-600" : delta < 0 ? "text-destructive" : "text-muted-foreground";

                      return (
                        <TableRow key={row.day} className={row.value === 0 ? "opacity-40" : ""}>
                          <TableCell>{format(parseISO(row.day), "dd/MM/yyyy")}</TableCell>
                          <TableCell className="text-right font-semibold">{fmtN(row.value)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtN(row.services)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtN(row.followups)}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{pct}%</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={readingBadge as any} className="text-xs">
                                {reading}
                              </Badge>
                              {delta != null && (
                                <span className={cn("text-xs font-medium", deltaColor)}>
                                  {delta > 0 ? `+${delta}` : delta}
                                </span>
                              )}
                            </div>
                          </TableCell>
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
