import { useEffect, useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { useOutletContext } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CircleDot, Filter, MessageSquareText, Package, PackageCheck, Store } from "lucide-react";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
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
import { useDashboardRefundMetricsQuery } from "@/features/dashboard/useDashboardRefundMetricsQuery";
import { useDashboardRefundAuditQuery } from "@/features/dashboard/useDashboardRefundAuditQuery";
import { RefundReasonDetailModal } from "@/components/dashboard/RefundReasonDetailModal";
import { ChannelEfficiencyCard } from "@/components/dashboard/ChannelEfficiencyCard";

function safeParseISODate(value: string): Date | null {
  const dt = parseISO(value);
  return isValid(dt) ? dt : null;
}

const DONUT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
];

export default function DashboardRefunds() {
  const { fromISO, toISO, agentId } = useOutletContext<ManagerOutletContext>();

  const [status, setStatus] = useState<"all" | "open" | "done">("all");
  const [refundType, setRefundType] = useState<string>("all");
  const [product, setProduct] = useState<string>("all");

  // Drill-down: motivo selecionado ao clicar numa barra do gráfico de motivos
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  // Table pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setPage(1);
  }, [fromISO, toISO, agentId, status, refundType, product]);

  const metricsQuery = useDashboardRefundMetricsQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
    status,
    refundType,
    product,
    refetchIntervalMs: 15_000,
  });

  const auditQuery = useDashboardRefundAuditQuery({
    enabled: true,
    from: fromISO,
    to: toISO,
    agentId: agentId === "all" ? undefined : agentId,
    status,
    refundType,
    product,
    page,
    pageSize,
    refetchIntervalMs: 15_000,
  });

  const metrics = metricsQuery.data;
  const audit = auditQuery.data;

  const isLoading = metricsQuery.isLoading || auditQuery.isLoading;

  const refundTypeOptions = useMemo(() => {
    const items = (metrics?.by_refund_type ?? []).map((x) => x.name).filter(Boolean);
    // “Não informado” vem do backend como bucket para null
    const unique = Array.from(new Set(items));
    return unique;
  }, [metrics?.by_refund_type]);

  const productOptions = useMemo(() => {
    const items = (metrics?.by_product ?? []).map((x) => x.name).filter(Boolean);
    const unique = Array.from(new Set(items));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [metrics?.by_product]);

  const kpis = useMemo(() => {
    return {
      total: metrics?.total_count ?? 0,
      open: metrics?.open_count ?? 0,
      done: metrics?.done_count ?? 0,
      doneRate:
        (metrics?.total_count ?? 0) > 0 ? ((metrics?.done_count ?? 0) / (metrics?.total_count ?? 1)) * 100 : 0,
      byAgent: (metrics?.by_agent ?? []).map((x) => ({ name: x.name, value: x.value })),
      byStatus: metrics?.by_status ?? [],
      byType: (metrics?.by_refund_type ?? []).slice().sort((a, b) => {
        const numA = parseFloat(a.name ?? "0");
        const numB = parseFloat(b.name ?? "0");
        return numA - numB;
      }),
      byProduct: (metrics?.by_product ?? []).map((x) => ({ name: x.name, value: x.value })),
      byChannel: (metrics?.by_channel ?? []).map((x) => ({ name: x.name, value: x.value })),
      byPlatform: (metrics?.by_platform ?? []).map((x) => ({ name: x.name, value: x.value })),
      byReason: (metrics?.by_reason ?? []).map((x) => ({ name: x.name, value: x.value })),
      byChannelEfficiency: metrics?.by_channel_efficiency ?? [],
    };
  }, [metrics]);

  const reasonTotal = useMemo(
    () => kpis.byReason.reduce((sum, item) => sum + item.value, 0),
    [kpis.byReason],
  );

  const reasonChartData = useMemo(
    () =>
      kpis.byReason
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((item) => ({
          ...item,
          pct: reasonTotal > 0 ? (item.value / reasonTotal) * 100 : 0,
        })),
    [kpis.byReason, reasonTotal],
  );

  const topReason = reasonChartData[0];

  const platformTotal = useMemo(
    () => kpis.byPlatform.reduce((sum, item) => sum + item.value, 0),
    [kpis.byPlatform],
  );

  const productLabel =
    product === "all" ? null : product === "null" ? "Sem produto informado" : product;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((audit?.total_count ?? 0) / pageSize)), [audit?.total_count]);
  const pageRows = audit?.rows ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-muted-foreground">Analytics</p>
          <h1 className="text-3xl font-semibold tracking-tight">Reembolsos</h1>
          <p className="text-sm text-muted-foreground">
            Período: {format(parseISO(fromISO), "dd/MM/yyyy")} — {format(parseISO(toISO), "dd/MM/yyyy")} • Agente: {agentId === "all" ? "Todos" : "Selecionado"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filtros</span>
          </div>
        </div>
      </header>

      {/* Local filters */}
      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</div>
          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Em aberto</SelectItem>
              <SelectItem value="done">Concluídos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tipo de reembolso</div>
          <Select value={refundType} onValueChange={setRefundType}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="null">Não informado</SelectItem>
              {refundTypeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Produto</div>
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="null">Não informado</SelectItem>
              {productOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Total de reembolsos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-3xl font-semibold">{kpis.total}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CircleDot className="h-4 w-4 text-primary" /> Em aberto
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-3xl font-semibold">{kpis.open}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-primary" /> Concluídos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-3xl font-semibold">{kpis.done}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Taxa de conclusão
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-3xl font-semibold">{kpis.doneRate.toFixed(0)}%</div>}
          </CardContent>
        </Card>
      </section>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reembolsos por agente</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byAgent.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpis.byAgent} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
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
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byStatus.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip />
                  <Pie data={kpis.byStatus} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
                    {kpis.byStatus.map((_, i) => (
                      <Cell key={`cell-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reembolsos por canal</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byChannel.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpis.byChannel} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]}>
                    {kpis.byChannel.map((_, i) => (
                      <Cell key={`ch-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reembolsos por produto</CardTitle>
          </CardHeader>
          <CardContent className="h-[380px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byProduct.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpis.byProduct} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value: number) => [value, "Reembolsos"]} />
                  <Bar dataKey="value" name="Reembolsos" radius={[8, 8, 0, 0]}>
                    {kpis.byProduct.map((_, i) => (
                      <Cell key={`bar-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tipos de reembolso (concluídos)</CardTitle>
          </CardHeader>
          <CardContent className="h-[380px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byType.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpis.byType} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value: number, name: string) => [value, name]} />
                  <Bar dataKey="value" name="Quantidade" radius={[8, 8, 0, 0]}>
                    {kpis.byType.map((_, i) => (
                      <Cell key={`cell-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary" />
                  Reembolsos por plataforma
                </CardTitle>
                {productLabel && (
                  <p className="mt-1 truncate text-xs text-muted-foreground" title={productLabel}>
                    Produto: <span className="font-medium text-foreground">{productLabel}</span>
                  </p>
                )}
              </div>
              {!isLoading && kpis.byPlatform.length > 0 && (
                <div className="shrink-0 rounded-md border bg-muted/40 px-2.5 py-1 text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="text-base font-semibold tabular-nums leading-tight">
                    {platformTotal.toLocaleString("pt-BR")}
                  </p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="h-[380px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byPlatform.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Store className="h-6 w-6 opacity-40" />
                <p className="text-sm">Nenhum reembolso encontrado{productLabel ? ` para "${productLabel}"` : ""} neste período</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={kpis.byPlatform}
                  layout="vertical"
                  margin={{ top: 8, right: 32, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    formatter={(value: number) => {
                      const pct = platformTotal > 0 ? ((value / platformTotal) * 100).toFixed(1) : "0";
                      return [`${value.toLocaleString("pt-BR")} (${pct}%)`, "Reembolsos"];
                    }}
                  />
                  <Bar dataKey="value" name="Reembolsos" radius={[0, 6, 6, 0]} barSize={22}>
                    {kpis.byPlatform.map((_, i) => (
                      <Cell key={`pf-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      style={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
                      formatter={(v: number) => v.toLocaleString("pt-BR")}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-primary" />
                  Motivos de reembolso
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Histórico normalizado em 15 categorias — texto livre antigo reclassificado automaticamente.
                  <span className="ml-1 text-primary">Clique numa barra para ver os reembolsos.</span>
                </p>
              </div>

              {!isLoading && topReason && reasonTotal > 0 && (
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-muted/40 px-3 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Mais comum</p>
                    <p className="text-sm font-medium leading-tight" title={topReason.name}>
                      {topReason.name}
                      <span className="ml-1.5 text-muted-foreground">
                        ({((topReason.value / reasonTotal) * 100).toFixed(0)}%)
                      </span>
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/40 px-3 py-1.5 text-right">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Classificados</p>
                    <p className="text-sm font-semibold tabular-nums leading-tight">
                      {reasonTotal.toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="h-[520px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : reasonChartData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <MessageSquareText className="h-6 w-6 opacity-40" />
                <p className="text-sm">Nenhum motivo encontrado neste período</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={reasonChartData}
                  layout="vertical"
                  margin={{ top: 8, right: 80, left: 8, bottom: 8 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={240}
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    formatter={(value: number, _name, item: any) => {
                      const pct = item?.payload?.pct ?? 0;
                      return [`${value.toLocaleString("pt-BR")} (${pct.toFixed(1)}%)`, "Reembolsos"];
                    }}
                  />
                  <Bar
                    dataKey="value"
                    name="Reembolsos"
                    radius={[0, 6, 6, 0]}
                    barSize={20}
                    cursor="pointer"
                    onClick={(d: { name?: string; payload?: { name?: string } }) => {
                      const name = d?.name ?? d?.payload?.name;
                      if (name) setSelectedReason(name);
                    }}
                  >
                    {reasonChartData.map((_, i) => (
                      <Cell key={`reason-${i}`} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      style={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
                      formatter={(v: number) => {
                        const pct = reasonTotal > 0 ? ((v / reasonTotal) * 100).toFixed(1) : "0";
                        return `${v.toLocaleString("pt-BR")} • ${pct}%`;
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <ChannelEfficiencyCard
          className="lg:col-span-2"
          isLoading={isLoading}
          rows={kpis.byChannelEfficiency}
          total={metrics?.channel_efficiency_total ?? null}
        />
      </section>

      {/* Table */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Auditoria (reembolsos)</CardTitle>
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
                        <TableHead>Solicitação</TableHead>
                        <TableHead>Agente</TableHead>
                        <TableHead>E-mail</TableHead>
                        <TableHead>Plataforma</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tipo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((row) => {
                        const dt = safeParseISODate(row.request_date);
                        const statusLabel = row.completion_date ? "Concluído" : "Em aberto";
                        const typeLabel = row.refund_type ?? "—";
                        return (
                          <TableRow key={row.id}>
                            <TableCell>{dt ? format(dt, "dd/MM/yyyy") : row.request_date}</TableCell>
                            <TableCell className="font-medium">{row.profiles?.full_name ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{row.customer_email}</TableCell>
                            <TableCell>{row.sales_platform}</TableCell>
                            <TableCell>{row.product ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{row.order_id}</TableCell>
                            <TableCell>{row.channel ?? "—"}</TableCell>
                            <TableCell>{statusLabel}</TableCell>
                            <TableCell>{typeLabel}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Página {page} de {totalPages} • {(audit?.total_count ?? 0).toLocaleString("pt-BR")} registros
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

      <RefundReasonDetailModal
        open={!!selectedReason}
        onClose={() => setSelectedReason(null)}
        reasonCategory={selectedReason}
        from={fromISO}
        to={toISO}
        agentId={agentId === "all" ? undefined : agentId}
        status={status}
        refundType={refundType}
        product={product}
      />
    </div>
  );
}
