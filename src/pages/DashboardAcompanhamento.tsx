import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, subWeeks, startOfWeek, endOfWeek, isAfter } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAgentsQuery } from "@/features/dashboard/useAgentsQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ----- constants -----
const WEEKLY_GOAL = 500;
const WEEKS_WINDOW = 8;

type WeekRange = { from: string; to: string; label: string };

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build the last N complete weeks (Mon-Sun) ending before the reference Friday. */
function buildWeekRanges(weeksCount: number): WeekRange[] {
  const now = new Date();
  const ranges: WeekRange[] = [];

  for (let i = 0; i < weeksCount; i++) {
    const ref = subWeeks(now, i);
    const monday = startOfWeek(ref, { weekStartsOn: 1 });
    const sunday = endOfWeek(ref, { weekStartsOn: 1 });

    ranges.push({
      from: toISODate(monday),
      to: toISODate(sunday),
      label: `${format(monday, "dd/MM", { locale: ptBR })} - ${format(sunday, "dd/MM", { locale: ptBR })}`,
    });
  }

  return ranges.reverse(); // oldest first
}

type WeeklyMetrics = {
  total_count: number;
  by_agent: Array<{ name: string; value: number; user_id: string }>;
};

function useWeeklyMetricsQuery(weeks: WeekRange[]) {
  return useQuery({
    queryKey: ["acompanhamento", "weekly", weeks.map((w) => w.from).join(",")],
    queryFn: async (): Promise<WeeklyMetrics[]> => {
      const results: WeeklyMetrics[] = [];
      for (const week of weeks) {
        const { data, error } = await supabase.rpc("dashboard_metrics", {
          from_date: week.from,
          to_date: week.to,
        });
        if (error) throw error;
        results.push(data as WeeklyMetrics);
      }
      return results;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ----- evaluation logic -----
type WeekStatus = "ok" | "alerta" | "advertencia";

type AgentWeekResult = {
  count: number;
  status: WeekStatus;
  weekLabel: string;
};

type AgentSummary = {
  userId: string;
  name: string;
  weeks: AgentWeekResult[];
  totalAlerts: number;
  totalWarnings: number;
  contractRisk: boolean;
};

function evaluateAgents(
  agents: Array<{ id: string; label: string }>,
  weeks: WeekRange[],
  metricsPerWeek: WeeklyMetrics[],
): AgentSummary[] {
  return agents.map((agent) => {
    const weekResults: AgentWeekResult[] = [];
    let accumulatedAlerts = 0;
    let totalWarnings = 0;

    for (let w = 0; w < weeks.length; w++) {
      const weekMetrics = metricsPerWeek[w];
      const agentData = weekMetrics?.by_agent?.find((a) => a.user_id === agent.id);
      const count = agentData?.value ?? 0;

      let status: WeekStatus;

      if (count >= WEEKLY_GOAL) {
        status = "ok";
      } else if (count >= 450) {
        // 450-499 → alerta
        accumulatedAlerts += 1;
        status = "alerta";
      } else if (count >= 400) {
        // 400-449 → advertência
        accumulatedAlerts += 1;
        totalWarnings += 1;
        status = "advertencia";
      } else {
        // <400 → advertência
        accumulatedAlerts += 1;
        totalWarnings += 1;
        status = "advertencia";
      }

      // 2 alertas acumulados viram +1 advertência
      if (accumulatedAlerts >= 2 && status === "alerta") {
        totalWarnings += 1;
        accumulatedAlerts = 0;
        status = "advertencia";
      }

      weekResults.push({ count, status, weekLabel: weeks[w].label });
    }

    return {
      userId: agent.id,
      name: agent.label,
      weeks: weekResults,
      totalAlerts: accumulatedAlerts,
      totalWarnings,
      contractRisk: totalWarnings >= 3,
    };
  });
}

// ----- status helpers -----
function statusColor(s: WeekStatus) {
  switch (s) {
    case "ok":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "alerta":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "advertencia":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  }
}

function statusLabel(s: WeekStatus) {
  switch (s) {
    case "ok":
      return "OK";
    case "alerta":
      return "Alerta";
    case "advertencia":
      return "Advertência";
  }
}

function StatusIcon({ status }: { status: WeekStatus }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
    case "alerta":
      return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
    case "advertencia":
      return <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />;
  }
}

function barColor(count: number) {
  if (count >= WEEKLY_GOAL) return "hsl(var(--primary))";
  if (count >= 450) return "#f59e0b";
  return "#ef4444";
}

// ----- component -----
export default function DashboardAcompanhamento() {
  const { fullName } = useOutletContext<ManagerOutletContext>();

  const agentsQuery = useAgentsQuery(true);
  const weeks = useMemo(() => buildWeekRanges(WEEKS_WINDOW), []);
  const metricsQuery = useWeeklyMetricsQuery(weeks);

  const agents = agentsQuery.data ?? [];
  const metricsPerWeek = metricsQuery.data ?? [];

  const summaries = useMemo(() => {
    if (agents.length === 0 || metricsPerWeek.length === 0) return [];
    return evaluateAgents(agents, weeks, metricsPerWeek);
  }, [agents, weeks, metricsPerWeek]);

  const isLoading = agentsQuery.isLoading || metricsQuery.isLoading;

  // KPI totals
  const kpi = useMemo(() => {
    const totalAgents = summaries.length;
    const atRisk = summaries.filter((s) => s.contractRisk).length;
    const withWarnings = summaries.filter((s) => s.totalWarnings > 0).length;
    const allGood = summaries.filter((s) => s.totalWarnings === 0 && !s.contractRisk).length;
    return { totalAgents, atRisk, withWarnings, allGood };
  }, [summaries]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Acompanhamento</h1>
        <p className="text-sm text-muted-foreground">
          Controle semanal de performance dos agentes (meta: {WEEKLY_GOAL} atendimentos/semana) — Últimas {WEEKS_WINDOW} semanas
        </p>
      </header>

      {/* KPI cards */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              Total de agentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold">{kpi.totalAgents}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Sem ocorrências
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold text-emerald-600">{kpi.allGood}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Com advertências
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold text-amber-600">{kpi.withWarnings}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Risco de não renovação
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold text-red-600">{kpi.atRisk}</div>}
          </CardContent>
        </Card>
      </section>

      {/* Rules reminder */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p><strong>Regras de acompanhamento:</strong></p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li><span className="text-emerald-600 font-medium">500+</span> atendimentos → OK</li>
                <li><span className="text-amber-600 font-medium">450–499</span> atendimentos → Alerta</li>
                <li><span className="text-red-600 font-medium">400–449</span> atendimentos → Advertência</li>
                <li><span className="text-red-600 font-medium">&lt;400</span> atendimentos → Advertência</li>
                <li><strong>2 alertas</strong> acumulados = 1 advertência</li>
                <li><strong>3 advertências</strong> em {WEEKS_WINDOW} semanas → contrato não renovado</li>
                <li>Apuração recorrente: <strong>sexta-feira</strong></li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent detail table */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Desempenho semanal por agente</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : summaries.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">Nenhum agente encontrado</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-card z-10 min-w-[160px]">Agente</TableHead>
                      {weeks.map((w) => (
                        <TableHead key={w.from} className="text-center min-w-[100px] text-xs">
                          {w.label}
                        </TableHead>
                      ))}
                      <TableHead className="text-center min-w-[100px]">Advertências</TableHead>
                      <TableHead className="text-center min-w-[100px]">Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.map((agent) => (
                      <TableRow key={agent.userId} className={agent.contractRisk ? "bg-red-500/5" : ""}>
                        <TableCell className="sticky left-0 bg-card z-10 font-medium">
                          {agent.name}
                        </TableCell>
                        {agent.weeks.map((w, i) => (
                          <TableCell key={i} className="text-center">
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <div className="inline-flex flex-col items-center gap-1">
                                  <span className="text-sm font-medium">{w.count}</span>
                                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusColor(w.status)}`}>
                                    <StatusIcon status={w.status} />
                                    <span className="ml-1">{statusLabel(w.status)}</span>
                                  </Badge>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{w.weekLabel}: {w.count} atendimentos</p>
                                <p className="text-xs opacity-80">Status: {statusLabel(w.status)}</p>
                              </TooltipContent>
                            </UITooltip>
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          <span className={`text-lg font-bold ${agent.totalWarnings >= 3 ? "text-red-600" : agent.totalWarnings > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                            {agent.totalWarnings}
                          </span>
                          <span className="text-xs text-muted-foreground">/{WEEKS_WINDOW} sem.</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {agent.contractRisk ? (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              Não renovar
                            </Badge>
                          ) : agent.totalWarnings > 0 ? (
                            <Badge variant="outline" className={`gap-1 ${statusColor("advertencia")}`}>
                              <ShieldAlert className="h-3 w-3" />
                              Atenção ({agent.totalWarnings})
                            </Badge>
                          ) : (
                            <Badge variant="outline" className={`gap-1 ${statusColor("ok")}`}>
                              <CheckCircle2 className="h-3 w-3" />
                              Regular
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Per-agent bar charts */}
      {!isLoading && summaries.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {summaries.map((agent) => (
            <Card key={agent.userId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <span>{agent.name}</span>
                  {agent.contractRisk ? (
                    <Badge variant="destructive" className="text-[10px]">Risco</Badge>
                  ) : agent.totalWarnings > 0 ? (
                    <Badge variant="outline" className={`text-[10px] ${statusColor("advertencia")}`}>{agent.totalWarnings} adv.</Badge>
                  ) : (
                    <Badge variant="outline" className={`text-[10px] ${statusColor("ok")}`}>OK</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={agent.weeks.map((w) => ({ name: w.weekLabel.split(" - ")[0], value: w.count }))}
                    margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} domain={[0, "auto"]} />
                    <Tooltip />
                    {/* Reference line for goal */}
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {agent.weeks.map((w, i) => (
                        <Cell key={i} fill={barColor(w.count)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {metricsQuery.error && (
        <p className="text-xs text-destructive-foreground/90 bg-destructive/60 rounded-md px-3 py-2">
          {(metricsQuery.error as any)?.message || "Erro ao carregar dados."}
        </p>
      )}
    </div>
  );
}
