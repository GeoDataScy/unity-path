import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
  Legend,
} from "recharts";
import {
  Activity,
  Award,
  CheckCircle2,
  Clock,
  FolderOpen,
  Loader2,
  MessageSquareText,
  Target,
  TrendingUp,
  User,
  Zap,
} from "lucide-react";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import {
  useFollowUpInsightsQuery,
  type AgentBreakdown,
} from "@/features/dashboard/useFollowUpInsightsQuery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Colors ──────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  open: "#64748b",        // slate
  in_progress: "#f59e0b", // amber
  done: "#10b981",        // emerald
  interactions: "#8b5cf6", // violet
} as const;

const AGENT_BAR_COLORS = [
  "hsl(var(--primary))",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function pct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  return dt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusBadge(status: string) {
  if (status === "concluido") {
    return <Badge variant="done" className="text-[10px] px-1.5 py-0">Concluido</Badge>;
  }
  return <Badge variant="in-progress" className="text-[10px] px-1.5 py-0">Em Andamento</Badge>;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function DashboardInteracoes() {
  const { fromISO, toISO, agentId } = useOutletContext<ManagerOutletContext>();
  const { data, isLoading, error } = useFollowUpInsightsQuery(fromISO, toISO);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<"all" | "open" | "in_progress" | "done" | "interactions">("all");

  // Filter by selected agent if not "all"
  const filteredAgents = useMemo(() => {
    if (!data) return [];
    if (agentId === "all") return data.by_agent;
    return data.by_agent.filter((a) => a.agent_id === agentId);
  }, [data, agentId]);

  // Recalculate KPIs when agent is filtered
  const kpi = useMemo(() => {
    if (!data) return null;
    if (agentId === "all") return data.kpi;

    const agents = filteredAgents;
    return {
      total_services: agents.reduce((s, a) => s + a.total_tickets, 0),
      open_count: agents.reduce((s, a) => s + a.open_count, 0),
      in_progress_count: agents.reduce((s, a) => s + a.in_progress_count, 0),
      done_count: agents.reduce((s, a) => s + a.done_count, 0),
      total_interactions: agents.reduce((s, a) => s + a.total_interactions, 0),
    };
  }, [data, agentId, filteredAgents]);

  // Filter recent follow-ups
  const recentFollowUps = useMemo(() => {
    if (!data) return [];
    if (agentId === "all") return data.recent_follow_ups;
    return data.recent_follow_ups.filter((f) => {
      const agent = data.by_agent.find((a) => a.agent_name === f.agent_name);
      return agent?.agent_id === agentId;
    });
  }, [data, agentId]);

  // Pie chart data
  const pieData = useMemo(() => {
    if (!kpi) return [];
    return [
      { name: "Em Aberto", value: kpi.open_count, fill: STATUS_COLORS.open },
      { name: "Em Andamento", value: kpi.in_progress_count, fill: STATUS_COLORS.in_progress },
      { name: "Concluido", value: kpi.done_count, fill: STATUS_COLORS.done },
    ].filter((d) => d.value > 0);
  }, [kpi]);

  // Stacked bar chart data (by agent)
  const stackedBarData = useMemo(() => {
    return filteredAgents
      .filter((a) => a.total_tickets > 0)
      .map((a) => ({
        name: a.agent_name.split(" ")[0],
        "Em Aberto": a.open_count,
        "Em Andamento": a.in_progress_count,
        "Concluido": a.done_count,
        "Interações": a.total_interactions,
        total: a.open_count + a.in_progress_count + a.done_count + a.total_interactions,
      }));
  }, [filteredAgents]);

  // Sort agents: worst completion rate first (needs attention)
  const sortedAgents = useMemo(() => {
    return [...filteredAgents].sort((a, b) => {
      if (a.total_tickets === 0 && b.total_tickets === 0) return 0;
      if (a.total_tickets === 0) return 1;
      if (b.total_tickets === 0) return -1;
      return a.completion_rate - b.completion_rate;
    });
  }, [filteredAgents]);

  const insights = data?.insights;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-7 w-7" />
          Interacoes dos Agentes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visao detalhada dos status e interacoes registradas pelos agentes no periodo selecionado
        </p>
      </header>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <section className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard
          icon={<Target className="h-4 w-4 text-blue-600" />}
          label="Total Tickets"
          value={kpi?.total_services}
          isLoading={isLoading}
        />
        <KpiCard
          icon={<FolderOpen className="h-4 w-4 text-slate-500" />}
          label="Em Aberto"
          value={kpi?.open_count}
          accent="text-slate-600"
          isLoading={isLoading}
          subtitle={kpi ? pct(kpi.open_count, kpi.total_services) : undefined}
        />
        <KpiCard
          icon={<Loader2 className="h-4 w-4 text-amber-500" />}
          label="Em Andamento"
          value={kpi?.in_progress_count}
          accent="text-amber-600"
          isLoading={isLoading}
          subtitle={kpi ? pct(kpi.in_progress_count, kpi.total_services) : undefined}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Concluidos"
          value={kpi?.done_count}
          accent="text-emerald-600"
          isLoading={isLoading}
          subtitle={kpi ? pct(kpi.done_count, kpi.total_services) : undefined}
        />
        <KpiCard
          icon={<MessageSquareText className="h-4 w-4 text-violet-500" />}
          label="Interacoes"
          value={kpi?.total_interactions}
          accent="text-violet-600"
          isLoading={isLoading}
          subtitle={
            kpi && kpi.total_services > 0
              ? `${(kpi.total_interactions / kpi.total_services).toFixed(1)} por ticket`
              : undefined
          }
        />
      </section>

      {/* ── Charts Row ───────────────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-5">
        {/* Pie - Status distribution */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Distribuicao de Status</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px] flex items-center justify-center">
            {isLoading ? (
              <Skeleton className="h-48 w-48 rounded-full" />
            ) : pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados no periodo</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [value, "Tickets"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Stacked bars - By agent */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Tickets por Agente</CardTitle>
              <div className="flex gap-1">
                {([
                  { key: "all", label: "Todos" },
                  { key: "open", label: "Em Aberto" },
                  { key: "in_progress", label: "Em Andamento" },
                  { key: "done", label: "Concluído" },
                  { key: "interactions", label: "Interações" },
                ] as const).map((opt) => (
                  <Button
                    key={opt.key}
                    size="sm"
                    variant={ticketStatusFilter === opt.key ? "default" : "outline"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setTicketStatusFilter(opt.key)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[280px]">
            {isLoading ? (
              <div className="space-y-3 pt-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : stackedBarData.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Sem dados no periodo</p>
              </div>
            ) : ticketStatusFilter === "all" ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stackedBarData}
                  margin={{ top: 28, right: 10, left: 0, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const item = payload[0]?.payload as { "Em Aberto": number; "Em Andamento": number; Concluido: number; "Interações": number; total: number } | undefined;
                      if (!item) return null;
                      return (
                        <div className="rounded-md border bg-background p-2 text-xs shadow-md">
                          <p className="mb-1 font-semibold">{label}</p>
                          <div className="space-y-0.5">
                            <p className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_COLORS.open }} />Em Aberto: <span className="font-medium">{item["Em Aberto"]}</span></p>
                            <p className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_COLORS.in_progress }} />Em Andamento: <span className="font-medium">{item["Em Andamento"]}</span></p>
                            <p className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_COLORS.done }} />Concluído: <span className="font-medium">{item.Concluido}</span></p>
                            <p className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_COLORS.interactions }} />Interações: <span className="font-medium">{item["Interações"]}</span></p>
                            <p className="mt-1 border-t pt-1 font-semibold">Total: {item.total}</p>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Em Aberto" stackId="status" fill={STATUS_COLORS.open} radius={[0, 0, 0, 0]}>
                    <LabelList dataKey="Em Aberto" position="inside" style={{ fontSize: 10, fill: "#fff" }} formatter={(v: number) => v > 0 ? v : ""} />
                  </Bar>
                  <Bar dataKey="Em Andamento" stackId="status" fill={STATUS_COLORS.in_progress}>
                    <LabelList dataKey="Em Andamento" position="inside" style={{ fontSize: 10, fill: "#fff" }} formatter={(v: number) => v > 0 ? v : ""} />
                  </Bar>
                  <Bar dataKey="Concluido" stackId="status" fill={STATUS_COLORS.done}>
                    <LabelList dataKey="Concluido" position="inside" style={{ fontSize: 10, fill: "#fff" }} formatter={(v: number) => v > 0 ? v : ""} />
                  </Bar>
                  <Bar dataKey="Interações" stackId="status" fill={STATUS_COLORS.interactions} radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="Interações" position="inside" style={{ fontSize: 10, fill: "#fff" }} formatter={(v: number) => v > 0 ? v : ""} />
                    <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (() => {
              const dataKey = ticketStatusFilter === "open" ? "Em Aberto"
                : ticketStatusFilter === "in_progress" ? "Em Andamento"
                : ticketStatusFilter === "interactions" ? "Interações"
                : "Concluido";
              const color = ticketStatusFilter === "in_progress" ? STATUS_COLORS.in_progress
                : ticketStatusFilter === "done" ? STATUS_COLORS.done
                : ticketStatusFilter === "interactions" ? STATUS_COLORS.interactions
                : STATUS_COLORS.open;
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stackedBarData}
                    margin={{ top: 20, right: 10, left: 0, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]}>
                      <LabelList dataKey={dataKey} position="top" style={{ fontSize: 11, fill: "hsl(var(--foreground))" }} formatter={(v: number) => v > 0 ? v : ""} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>
      </section>

      {/* ── Insights Cards ───────────────────────────────────────────────── */}
      {!isLoading && insights && (
        <section className="grid gap-4 md:grid-cols-3">
          {insights.top_performer && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-emerald-500/15 p-2">
                    <Award className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Destaque do Periodo</p>
                    <p className="text-lg font-semibold">{insights.top_performer.agent_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {insights.top_performer.rate}% de conclusao ({insights.top_performer.done}/{insights.top_performer.total} tickets)
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {insights.most_open && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-amber-500/15 p-2">
                    <FolderOpen className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Mais Tickets em Aberto</p>
                    <p className="text-lg font-semibold">{insights.most_open.agent_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {insights.most_open.open_count} tickets sem interacao
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {insights.most_productive && (
            <Card className="border-violet-500/30 bg-violet-500/5">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-violet-500/15 p-2">
                    <Zap className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Mais Produtivo</p>
                    <p className="text-lg font-semibold">{insights.most_productive.agent_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {insights.most_productive.interaction_count} interacoes registradas
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ── Agent Detail Table ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Detalhamento por Agente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sortedAgents.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">Nenhum agente encontrado no periodo</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Agente</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Em Aberto</TableHead>
                    <TableHead className="text-center">Em Andamento</TableHead>
                    <TableHead className="text-center">Concluidos</TableHead>
                    <TableHead className="text-center">Interacoes</TableHead>
                    <TableHead className="text-center min-w-[120px]">Media Int/Ticket</TableHead>
                    <TableHead className="text-center min-w-[160px]">Taxa de Conclusao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAgents.map((agent) => (
                    <AgentRow key={agent.agent_id} agent={agent} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Activity Feed ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Atividade Recente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentFollowUps.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhuma interacao registrada no periodo</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto space-y-1">
              {recentFollowUps.map((fu) => (
                <div
                  key={fu.id}
                  className="flex items-start gap-3 rounded-lg border-l-2 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                  style={{
                    borderLeftColor:
                      fu.status === "concluido"
                        ? STATUS_COLORS.done
                        : STATUS_COLORS.in_progress,
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{fu.agent_name}</span>
                      {statusBadge(fu.status)}
                      {fu.follow_up_number > 1 && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          #{fu.follow_up_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{fu.client_email}</span>
                      <span className="opacity-50">|</span>
                      <span>{fu.product}</span>
                      <span className="opacity-50">|</span>
                      <span>{formatDateTime(fu.recorded_at)}</span>
                    </div>
                    {fu.observation && (
                      <p className="mt-1 text-xs text-muted-foreground/80 line-clamp-2">
                        {fu.observation}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="text-xs text-destructive-foreground/90 bg-destructive/60 rounded-md px-3 py-2">
          {(error as any)?.message || "Erro ao carregar dados."}
        </p>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  accent,
  subtitle,
  isLoading,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  accent?: string;
  subtitle?: string;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div>
            <div className={`text-3xl font-semibold ${accent ?? ""}`}>
              {value ?? 0}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgentRow({ agent }: { agent: AgentBreakdown }) {
  const hasTickets = agent.total_tickets > 0;
  const rateColor =
    agent.completion_rate >= 80
      ? "text-emerald-600"
      : agent.completion_rate >= 50
        ? "text-amber-600"
        : agent.completion_rate > 0
          ? "text-red-600"
          : "text-muted-foreground";

  return (
    <TableRow>
      <TableCell className="font-medium">{agent.agent_name}</TableCell>
      <TableCell className="text-center font-semibold">{agent.total_tickets}</TableCell>
      <TableCell className="text-center">
        <UITooltip>
          <TooltipTrigger asChild>
            <span className={agent.open_count > 0 ? "text-slate-600 font-medium" : "text-muted-foreground"}>
              {agent.open_count}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {agent.open_count} tickets sem nenhuma interacao
          </TooltipContent>
        </UITooltip>
      </TableCell>
      <TableCell className="text-center">
        <span className={agent.in_progress_count > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>
          {agent.in_progress_count}
        </span>
      </TableCell>
      <TableCell className="text-center">
        <span className={agent.done_count > 0 ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
          {agent.done_count}
        </span>
      </TableCell>
      <TableCell className="text-center">
        <span className="text-violet-600 font-medium">{agent.total_interactions}</span>
      </TableCell>
      <TableCell className="text-center">
        {hasTickets ? (
          <span className="text-sm">{agent.avg_interactions_to_close}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Progress
            value={agent.completion_rate}
            className="h-2 flex-1"
          />
          <span className={`text-sm font-semibold min-w-[40px] text-right ${rateColor}`}>
            {agent.completion_rate}%
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}
