import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Area,
  AreaChart,
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
} from "recharts";
import { BarChart3, Package, TrendingUp, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

import logo from "@/assets/logo-xmx.png";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { useAgentsQuery } from "@/features/dashboard/useAgentsQuery";
import { useDashboardServicesQuery, type DashboardServiceRow } from "@/features/dashboard/useDashboardServicesQuery";

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

const Dashboard = () => {
  const navigate = useNavigate();

  const [authLoading, setAuthLoading] = useState(true);

  // Defaults requested: 01/01/2026 -> 31/01/2026
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    return { from, to };
  });

  const [agentId, setAgentId] = useState<string>("all");

  const fromISO = useMemo(() => {
    const d = range?.from;
    return d ? toISODate(d) : "2026-01-01";
  }, [range?.from]);

  const toISO = useMemo(() => {
    const d = range?.to ?? range?.from;
    return d ? toISODate(d) : "2026-01-31";
  }, [range?.to, range?.from]);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        navigate("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (profile?.role !== "manager") {
        navigate("/workspace");
        return;
      }

      setAuthLoading(false);
    };

    checkAuth();
  }, [navigate]);

  const agentsQuery = useAgentsQuery(!authLoading);

  const servicesQuery = useDashboardServicesQuery({
    enabled: !authLoading,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
  });

  // Query to always get ALL agents data for benchmark calculation
  const allServicesQuery = useDashboardServicesQuery({
    enabled: !authLoading && agentId !== "all",
    from: fromISO,
    to: toISO,
    agentId: undefined, // Always fetch all agents
  });

  const services = servicesQuery.data ?? [];
  const allServices = allServicesQuery.data ?? [];

  // Metrics + series
  const {
    kpiTotal,
    kpiDailyAvg,
    kpiTopAgentLabel,
    kpiTopAgentSubtext,
    kpiTopProduct,
    byAgentSeries,
    byProductSeries,
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
      byDaySeries: [] as Array<{ day: string; value: number }>,
    };

    const fromDt = range?.from ?? safeParseISODate(fromISO) ?? new Date(2026, 0, 1);
    const toDt = range?.to ?? safeParseISODate(toISO) ?? new Date(2026, 0, 31);

    const daysSelected = Math.max(1, differenceInCalendarDays(toDt, fromDt) + 1);

    const agentCounts = new Map<string, number>();
    const productCounts = new Map<string, number>();
    const dayCounts = new Map<string, number>();

    for (const row of services) {
      kpi.kpiTotal += 1;

      const agentName = (row.profiles?.full_name ?? "").trim() || "Sem nome";
      agentCounts.set(agentName, (agentCounts.get(agentName) ?? 0) + 1);

      const product = (row.product ?? "").trim() || "—";
      productCounts.set(product, (productCounts.get(product) ?? 0) + 1);

      const dayKey = row.service_date.slice(0, 10);
      dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
    }

    kpi.kpiDailyAvg = kpi.kpiTotal / daysSelected;

    // Fill missing days for area chart continuity
    for (let i = 0; i < daysSelected; i++) {
      const d = addDays(fromDt, i);
      const key = toISODate(d);
      if (!dayCounts.has(key)) dayCounts.set(key, 0);
    }

    kpi.byAgentSeries = Array.from(agentCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    kpi.byProductSeries = Array.from(productCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    kpi.byDaySeries = Array.from(dayCounts.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, value]) => ({ day: format(parseISO(day), "dd/MM"), value }));

    // TOP AGENT LOGIC
    if (agentId === "all") {
      // Show the winner (top agent)
      const topAgent = kpi.byAgentSeries[0];
      if (topAgent) kpi.kpiTopAgentLabel = `${topAgent.name} (${formatCompactNumber(topAgent.value)})`;
    } else {
      // Benchmark mode: compare selected agent vs leader
      // Calculate leader from ALL services (not filtered)
      const allAgentCounts = new Map<string, number>();
      for (const row of allServices) {
        const agentName = (row.profiles?.full_name ?? "").trim() || "Sem nome";
        allAgentCounts.set(agentName, (allAgentCounts.get(agentName) ?? 0) + 1);
      }

      const allAgentsSeries = Array.from(allAgentCounts.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

      const leader = allAgentsSeries[0];
      const selectedAgent = kpi.byAgentSeries[0]; // The filtered one

      if (leader && selectedAgent) {
        const leaderCount = leader.value;
        const selectedCount = selectedAgent.value;

        if (selectedAgent.name === leader.name) {
          // The selected agent IS the leader
          kpi.kpiTopAgentLabel = "Você é o Líder 🏆";
          kpi.kpiTopAgentSubtext = "0% de gap";
        } else {
          // Calculate gap (distance from leader)
          const volumePercentage = (selectedCount / leaderCount) * 100;
          const gap = 100 - volumePercentage;
          kpi.kpiTopAgentLabel = `${gap.toFixed(0)}%`;
          kpi.kpiTopAgentSubtext = `Líder: ${leader.name} (${formatCompactNumber(leaderCount)} atendimentos)`;
        }
      }
    }

    const topProduct = kpi.byProductSeries[0];
    if (topProduct) kpi.kpiTopProduct = topProduct.name;

    return kpi;
  }, [services, allServices, agentId, range, fromISO, toISO]);

  // Table pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setPage(1);
  }, [fromISO, toISO, agentId]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(services.length / pageSize)), [services.length]);
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return services.slice(start, start + pageSize);
  }, [services, page]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleRefresh = async () => {
    await Promise.all([agentsQuery.refetch(), servicesQuery.refetch()]);
  };

  const isLoading = authLoading || agentsQuery.isLoading || servicesQuery.isLoading || (agentId !== "all" && allServicesQuery.isLoading);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-[250px] shrink-0 sticky top-0 h-screen bg-dashboard-sidebar text-dashboard-sidebar-foreground border-r border-white/10">
        <div className="h-full flex flex-col p-4 gap-6">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Logo da empresa" className="h-8 w-auto" loading="lazy" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">Painel da Gestora</div>
              <div className="text-xs opacity-80">Analytics</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">Período</div>
              <DateRangePicker value={range} onChange={setRange} />
              <div className="text-[11px] opacity-75">Default: 01/01/2026 — 31/01/2026</div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">Agente</div>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-full bg-white/10 border-white/15 text-dashboard-sidebar-foreground">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent className="z-50">
                  <SelectItem value="all">Todos</SelectItem>
                  {(agentsQuery.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              Atualizar Métricas
            </Button>

            {servicesQuery.error ? (
              <p className="text-xs text-destructive-foreground/90 bg-destructive/60 rounded-md px-3 py-2">
                {(servicesQuery.error as any)?.message ?? "Erro ao carregar dados."}
              </p>
            ) : null}
          </div>

          <div className="mt-auto">
            <Button
              onClick={handleLogout}
              variant="secondary"
              className="w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15"
            >
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 bg-dashboard-surface p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex items-end justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-muted-foreground">Olá Ester!</p>
              <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Período: {format(parseISO(fromISO), "dd/MM/yyyy")} — {format(parseISO(toISO), "dd/MM/yyyy")} • Agente: {agentId === "all" ? "Todos" : "Selecionado"}
              </p>
            </div>
          </header>

          {/* KPIs */}
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Total de atendimentos
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
                    <div className={`text-lg font-semibold ${agentId !== "all" && kpiTopAgentLabel !== "Você é o Líder 🏆" ? "text-orange-600 dark:text-orange-400" : ""}`}>
                      {kpiTopAgentLabel}
                    </div>
                    {agentId !== "all" && kpiTopAgentLabel !== "Você é o Líder 🏆" && (
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
                <CardTitle>Ranking de performance</CardTitle>
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

          {/* Evolution */}
          <section>
            <Card>
              <CardHeader>
                <CardTitle>Tendência temporal</CardTitle>
              </CardHeader>
              <CardContent className="h-[340px]">
                {isLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : byDaySeries.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={byDaySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fill="url(#areaFill)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
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
                ) : services.length === 0 ? (
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
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pageRows.map((row: DashboardServiceRow) => (
                            <TableRow key={row.id}>
                              <TableCell>{format(parseISO(row.service_date.slice(0, 10)), "dd/MM/yyyy")}</TableCell>
                              <TableCell className="font-medium">{row.profiles?.full_name ?? "—"}</TableCell>
                              <TableCell className="text-muted-foreground">{row.client_email}</TableCell>
                              <TableCell>{row.product}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Página {page} de {totalPages} • {formatCompactNumber(services.length)} registros
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
        </div>
      </main>
    </div>
  );
};

export default Dashboard;

