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
  CloudRain,
  Crown,
  MessageSquare,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
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

type MotivationTone = "leader" | "great" | "good" | "neutral" | "sad";

interface MotivationResult {
  title: string;
  message: string;
  tone: MotivationTone;
}

function getMotivation(m: AgentMyMetrics): MotivationResult {
  const {
    total_interactions: total,
    team_average,
    team_leader_count,
    team_leader_name,
    is_leader,
    is_below_team_avg_20pct,
    gap_to_avg_pct,
    trend_label,
    trend_pct,
  } = m;

  // Empty period — gentle nudge
  if (total === 0) {
    return {
      title: "Bora começar!",
      message: "Nenhuma interação registrada neste período. O primeiro atendimento do dia é o mais importante — vamos lá!",
      tone: "sad",
    };
  }

  // Leader takes precedence over everything else
  if (is_leader) {
    return {
      title: "Você lidera o período! 🏆",
      message: `Com ${fmtN(total)} atendimentos você está no topo do time. Mantenha esse ritmo!`,
      tone: "leader",
    };
  }

  // The flagged "20% below the team average" — sad tone with the exact copy
  if (is_below_team_avg_20pct) {
    return {
      title: "Hora de acelerar.",
      message: `O time está ${fmtN(gap_to_avg_pct)}% acima de você. Cada interação conta.`,
      tone: "sad",
    };
  }

  // Above-or-around the team average — encouraging variants
  if (team_average > 0 && total >= team_average) {
    const aheadPct = Math.round(((total - team_average) / team_average) * 100);
    return {
      title: "Acima da média do time 📈",
      message: aheadPct > 0
        ? `Você está ${aheadPct}% acima da média do time (${fmtN(Math.round(team_average))}). Líder do período: ${team_leader_name} com ${fmtN(team_leader_count)}.`
        : `Você está exatamente na média do time (${fmtN(Math.round(team_average))}). Bora superar?`,
      tone: "great",
    };
  }

  if (trend_label === "Evoluindo") {
    return {
      title: `Tendência positiva: +${Math.abs(trend_pct).toFixed(0)}% 📊`,
      message: `Você está crescendo. Continue nesse ritmo para alcançar a média do time (${fmtN(Math.round(team_average))}).`,
      tone: "good",
    };
  }

  // Below average but within the 20% tolerance
  return {
    title: "Próximo da média",
    message: `Você está com ${fmtN(total)} atendimentos. Média do time: ${fmtN(Math.round(team_average))}. Continue firme!`,
    tone: "neutral",
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

// ── Comparison bar (você vs referência) ───────────────────────────────────────

function ComparisonBar({
  label,
  yourValue,
  refValue,
  youAheadColor,
  refAheadColor,
}: {
  label: string;
  yourValue: number;
  refValue: number;
  youAheadColor: string;
  refAheadColor: string;
}) {
  const max = Math.max(yourValue, refValue, 1);
  const yourPct = Math.round((yourValue / max) * 100);
  const refPct = Math.round((refValue / max) * 100);
  const youAhead = yourValue >= refValue;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="font-medium">{fmtN(yourValue)}</span>
          <span className="mx-1.5 text-muted-foreground">/</span>
          <span className="text-muted-foreground">{fmtN(Math.round(refValue))}</span>
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        {/* Reference (lighter, full ref value) */}
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full opacity-30", youAhead ? "bg-muted-foreground" : refAheadColor)}
          style={{ width: `${refPct}%` }}
        />
        {/* You (solid) */}
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", youAhead ? youAheadColor : refAheadColor)}
          style={{ width: `${yourPct}%` }}
        />
      </div>
    </div>
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
    return getMotivation(m);
  }, [m, days]);

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
  const teamAvgDaily = m && days > 0 ? Number(m.team_average ?? 0) / days : 0;

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
    sad:     "border-rose-400/70 bg-rose-50 dark:bg-rose-950/30",
  };

  const motivationIcon: Record<MotivationTone, React.ElementType> = {
    leader:  Award,
    great:   Star,
    good:    TrendingUp,
    neutral: BarChart3,
    sad:     CloudRain,
  };

  const motivationIconColor: Record<MotivationTone, string> = {
    leader:  "text-yellow-500",
    great:   "text-green-600",
    good:    "text-primary",
    neutral: "text-muted-foreground",
    sad:     "text-rose-500",
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
        <div className="flex w-full flex-col gap-1.5 md:w-[360px]">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Período (de — até)
          </label>
          <DateRangePicker
            value={range}
            onChange={setRange}
            className="border bg-background text-foreground hover:bg-accent"
          />
          <p className="text-[11px] text-muted-foreground">
            Clique para escolher a data inicial e final
          </p>
        </div>
      </header>

      {/* Motivation card */}
      {isLoading ? (
        <Skeleton className="mb-6 h-20 w-full rounded-xl" />
      ) : motivation && (
        <div className={cn("mb-6 flex items-start gap-3 rounded-xl border p-4", motivationBg[motivation.tone])}>
          {(() => {
            const Icon = motivationIcon[motivation.tone];
            return <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", motivationIconColor[motivation.tone])} />;
          })()}
          <div>
            <p className="font-semibold">{motivation.title}</p>
            <p className="text-sm text-muted-foreground">{motivation.message}</p>
          </div>
        </div>
      )}

      {/* Team comparison card — você vs média vs líder */}
      {!isLoading && m && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4 text-primary" />
              Comparação com o time no período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Você */}
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Você</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtN(m.total_interactions)}</div>
                <div className="text-xs text-muted-foreground">atendimentos</div>
              </div>
              {/* Média do time (excluindo você) */}
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Média do time</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtN(Math.round(m.team_average))}</div>
                <div className="text-xs text-muted-foreground">excluindo você</div>
              </div>
              {/* Líder */}
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Crown className="h-3.5 w-3.5 text-yellow-500" />
                  Líder
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtN(m.team_leader_count)}</div>
                <div className="truncate text-xs text-muted-foreground">{m.is_leader ? "Você 🏆" : m.team_leader_name}</div>
              </div>
            </div>

            {/* Progress bars: você vs média e você vs líder */}
            <div className="mt-4 space-y-3">
              <ComparisonBar
                label="vs média"
                yourValue={m.total_interactions}
                refValue={m.team_average}
                youAheadColor="bg-emerald-500"
                refAheadColor="bg-rose-500"
              />
              <ComparisonBar
                label="vs líder"
                yourValue={m.total_interactions}
                refValue={m.team_leader_count}
                youAheadColor="bg-yellow-500"
                refAheadColor="bg-primary"
              />
            </div>
          </CardContent>
        </Card>
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

      {/* ── KPIs: Reembolsos ─────────────────────────────────────────────── */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Reembolsos
      </h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Em aberto"
          value={fmtN(m?.refunds_open ?? 0)}
          sub="solicitados no período"
          icon={RefreshCw}
          loading={isLoading}
        />
        <KpiCard
          label="Concluídos"
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
                    label={{ value: "Sua média", position: "insideTopLeft", fontSize: 10 }}
                  />
                  {teamAvgDaily > 0 && (
                    <ReferenceLine
                      y={teamAvgDaily}
                      stroke="hsl(0 72% 55%)"
                      strokeDasharray="3 3"
                      label={{ value: "Média do time", position: "insideTopRight", fontSize: 10, fill: "hsl(0 72% 55%)" }}
                    />
                  )}
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

      {/* Plataforma */}
      <section className="mb-6">
        <Card>
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
