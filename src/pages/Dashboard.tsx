import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Package, TrendingUp, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { useDashboardMetricsQuery } from "@/features/dashboard/useDashboardMetricsQuery";
import { useDashboardAuditQuery } from "@/features/dashboard/useDashboardAuditQuery";
import { useFollowUpInsightsQuery } from "@/features/dashboard/useFollowUpInsightsQuery";
import { ChannelDetailModal } from "@/components/dashboard/ChannelDetailModal";
import { TendenciaTemporal } from "@/features/dashboard/TendenciaTemporal";

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeParseISODate(value: string): Date | null {
  const dt = parseISO(value);
  return isValid(dt) ? dt : null;
}

function formatCompactNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

const DONUT_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--ring))",
  "hsl(var(--muted-foreground))",
  "hsl(var(--foreground))",
];

const LEADER_LABEL = "Líder do grupo 🏆";

const Dashboard = () => {
  const { fullName, range, fromISO, toISO, agentId } = useOutletContext<ManagerOutletContext>();

  // Fetch metrics for the selected filter (agent or all)
  const metricsQuery = useDashboardMetricsQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
  });

  // Fetch ALL agents metrics — for benchmark comparison and always-all-agents channel chart
  const allMetricsQuery = useDashboardMetricsQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: undefined,
  });

  const followUpQuery = useFollowUpInsightsQuery(fromISO, toISO);

  // Channel detail modal
  const [channelModalOpen, setChannelModalOpen] = useState(false);

  // Table pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setPage(1);
  }, [fromISO, toISO, agentId]);

  const auditQuery = useDashboardAuditQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
    page,
    pageSize,
  });

  const metrics = metricsQuery.data;
  const allMetrics = allMetricsQuery.data;
  const audit = auditQuery.data;

  // Metrics + series
  const {
    kpiTotal,
    kpiDailyAvg,
    kpiTopAgentLabel,
    kpiTopAgentSubtext,
    kpiTopProduct,
    byAgentSeries,
    byProductSeries,
    byPlatformSeries,
    byChannelSeries,
    byDaySeries,
  } = useMemo(() => {
    const kpi = {
      kpiTotal: 0,
      kpiDailyAvg: 0,
      kpiTopAgentLabel: "—",
      kpiTopAgentSubtext: "" as string | undefined,
      kpiTopProduct: "—",
      byAgentSeries: [] as Array<{ name: string; value: number }>,
      byProductSeries: [] as Array<{ name: string; value: number }>,
      byPlatformSeries: [] as Array<{ name: string; value: number }>,
      byChannelSeries: [] as Array<{ name: string; value: number }>,
      byDaySeries: [] as Array<{ day: string; value: number }>,
    };

    if (!metrics) return kpi;

    const now = new Date();
    const fromDt = range?.from ?? safeParseISODate(fromISO) ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const toDt = range?.to ?? safeParseISODate(toISO) ?? now;
    const daysSelected = Math.max(1, differenceInCalendarDays(toDt, fromDt) + 1);

    kpi.kpiTotal = metrics.total_count;
    kpi.kpiDailyAvg = metrics.total_count / daysSelected;

    kpi.byAgentSeries = metrics.by_agent.map(({ name, value }) => ({ name, value }));
    kpi.byProductSeries = metrics.by_product.slice(0, 10).map(({ name, value }) => ({ name, value }));
    kpi.byPlatformSeries = (metrics.by_platform ?? []).map(({ name, value }) => ({ name, value }));
    kpi.byChannelSeries = (allMetrics?.by_channel ?? metrics.by_channel ?? []).map(({ name, value }) => ({ name, value }));

    // Fill missing days for area chart continuity
    const dayCounts = new Map<string, number>(
      metrics.by_day.map(({ day, value }) => [day, value])
    );

    for (let i = 0; i < daysSelected; i++) {
      const d = addDays(fromDt, i);
      const key = toISODate(d);
      if (!dayCounts.has(key)) dayCounts.set(key, 0);
    }

    kpi.byDaySeries = Array.from(dayCounts.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, value]) => ({ day: format(parseISO(day), "dd/MM"), value }));

    // TOP AGENT LOGIC
    if (agentId === "all") {
      const topAgent = kpi.byAgentSeries[0];
      if (topAgent) kpi.kpiTopAgentLabel = `${topAgent.name} (${formatCompactNumber(topAgent.value)})`;
    } else {
      // Benchmark mode: compare selected agent vs leader from ALL agents
      if (allMetrics) {
        const leader = allMetrics.by_agent[0];
        const selectedAgent = kpi.byAgentSeries[0];

        if (leader && selectedAgent) {
          const leaderCount = leader.value;
          const selectedCount = selectedAgent.value;

          if (selectedAgent.name === leader.name) {
            kpi.kpiTopAgentLabel = LEADER_LABEL;
            kpi.kpiTopAgentSubtext = "0% de gap";
          } else {
            const volumePercentage = (selectedCount / leaderCount) * 100;
            const gap = 100 - volumePercentage;
            kpi.kpiTopAgentLabel = `${gap.toFixed(0)}%`;
            kpi.kpiTopAgentSubtext = `Líder: ${leader.name} (${formatCompactNumber(leaderCount)} atendimentos)`;
          }
        }
      }
    }

    const topProduct = kpi.byProductSeries[0];
    if (topProduct) kpi.kpiTopProduct = topProduct.name;

    return kpi;
  }, [metrics, allMetrics, agentId, range, fromISO, toISO]);


  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((audit?.total_count ?? 0) / pageSize)),
    [audit?.total_count]
  );
  const pageRows = audit?.rows ?? [];

  const handleRefresh = async () => {
    await Promise.all([metricsQuery.refetch(), allMetricsQuery.refetch(), auditQuery.refetch()]);
  };

  const isLoading = metricsQuery.isLoading || (agentId !== "all" && allMetricsQuery.isLoading) || auditQuery.isLoading || followUpQuery.isLoading;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-muted-foreground">Olá {fullName ?? ""}!</p>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Período: {format(parseISO(fromISO), "dd/MM/yyyy")} — {format(parseISO(toISO), "dd/MM/yyyy")} • Agente: {agentId === "all" ? "Todos" : "Selecionado"}
          </p>
        </div>

        <Button type="button" onClick={handleRefresh} disabled={isLoading}>
          Atualizar Métricas
        </Button>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              {agentId === "all" ? "Total de atendimentos (todos)" : `Atendimentos — ${byAgentSeries[0]?.name ?? "agente"}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-3xl font-semibold">{formatCompactNumber(kpiTotal)}</div>}
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
              <div className="text-3xl font-semibold">{kpiDailyAvg.toFixed(1).replace(".", ",")}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> {agentId === "all" ? "Top agente" : "Distância do Líder"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <>
                <div className={`text-lg font-semibold ${agentId !== "all" && kpiTopAgentLabel !== LEADER_LABEL ? "text-orange-600 dark:text-orange-400" : ""}`}>
                  {kpiTopAgentLabel}
                </div>
                {agentId !== "all" && kpiTopAgentLabel !== LEADER_LABEL && (
                  <div className="text-sm text-muted-foreground">abaixo da referência</div>
                )}
                {kpiTopAgentSubtext && <div className="text-xs text-muted-foreground mt-1">{kpiTopAgentSubtext}</div>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> Produto + saída
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-32" /> : <div className="text-lg font-semibold">{kpiTopProduct}</div>}
          </CardContent>
        </Card>
      </section>

      {/* Charts row */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Atendimentos por agente</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : byAgentSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byAgentSeries} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} height={50} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mix de produtos</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : byProductSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip />
                  <Pie
                    data={byProductSeries}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={2}
                  >
                    {byProductSeries.map((_, i) => (
                      <Cell key={`cell-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Platform & Channel charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Atendimentos por plataforma</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : byPlatformSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byPlatformSeries} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} height={50} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow"
          onClick={() => setChannelModalOpen(true)}
        >
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Atendimentos por canal</CardTitle>
            <span className="text-xs text-muted-foreground select-none">Clique para detalhar</span>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : byChannelSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byChannelSeries} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--ring))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Evolution */}
      <section>
        <TendenciaTemporal
          loading={isLoading}
          byDay={(metrics?.by_day ?? []).map(({ day, value }) => ({ day, value }))}
          movingWindow={15}
          forecastDays={7}
        />
      </section>

      {/* Table */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Auditoria (registros)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : pageRows.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <>
                <div className="rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Agente</TableHead>
                        <TableHead>E-mail Cliente</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Plataforma</TableHead>
                        <TableHead>Canal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{format(parseISO(row.service_date.slice(0, 10)), "dd/MM/yyyy")}</TableCell>
                          <TableCell className="font-medium">{row.profiles?.full_name ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{row.client_email}</TableCell>
                          <TableCell>{row.product}</TableCell>
                          <TableCell>{row.platform ?? "—"}</TableCell>
                          <TableCell>{row.channel ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Página {page} de {totalPages} • {formatCompactNumber(audit?.total_count ?? 0)} registros
                  </p>

                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setPage((p) => Math.max(1, p - 1));
                          }}
                        />
                      </PaginationItem>

                      {Array.from({ length: totalPages }).slice(0, 7).map((_, idx) => {
                        const p = idx + 1;
                        return (
                          <PaginationItem key={p}>
                            <PaginationLink
                              href="#"
                              isActive={p === page}
                              onClick={(e) => {
                                e.preventDefault();
                                setPage(p);
                              }}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      })}

                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setPage((p) => Math.min(totalPages, p + 1));
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>
      {metricsQuery.error || auditQuery.error || followUpQuery.error ? (
        <p className="text-xs text-destructive-foreground/90 bg-destructive/60 rounded-md px-3 py-2">
          {(metricsQuery.error as any)?.message || (auditQuery.error as any)?.message || (followUpQuery.error as any)?.message || "Erro ao carregar dados."}
        </p>
      ) : null}

      <ChannelDetailModal
        open={channelModalOpen}
        onClose={() => setChannelModalOpen(false)}
        initialFrom={fromISO}
        initialTo={toISO}
      />
    </div>
  );
};

export default Dashboard;

