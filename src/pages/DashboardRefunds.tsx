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
import { BarChart3, CircleDot, Filter, Package, PackageCheck } from "lucide-react";

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
      byChannelEfficiency: metrics?.by_channel_efficiency ?? [],
    };
  }, [metrics]);

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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Eficiência por canal</CardTitle>
          </CardHeader>
          <CardContent className="h-[380px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : kpis.byChannelEfficiency.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Nenhum dado encontrado neste período</div>
            ) : (() => {
              const chartData = kpis.byChannelEfficiency.map((x) => ({
                name: x.channel,
                Parcial: x.partial_count,
                Total: x.full_count,
                score: x.efficiency_score,
                done: x.total_done,
              }));
              return (
                <div className="flex h-full flex-col">
                  <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(var(--chart-success))" }} /> Parcial (&lt;100%)</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(var(--chart-danger))" }} /> Total (100%)</span>
                  </div>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip
                          formatter={(value: number, name: string) => [value, name === "Parcial" ? "Reembolso parcial" : "Reembolso 100%"]}
                          labelFormatter={(label: string) => {
                            const item = chartData.find((x) => x.name === label);
                            if (!item) return label;
                            return `${label} — Score: ${item.score}% (${item.done} concluídos)`;
                          }}
                        />
                        <Bar dataKey="Parcial" fill="hsl(var(--chart-success))" radius={[0, 0, 0, 0]} stackId="eff">
                          <LabelList dataKey="Parcial" position="inside" style={{ fontSize: 11, fill: "#fff" }} formatter={(v: number) => v > 0 ? v : ""} />
                        </Bar>
                        <Bar dataKey="Total" fill="hsl(var(--chart-danger))" radius={[6, 6, 0, 0]} stackId="eff">
                          <LabelList dataKey="Total" position="inside" style={{ fontSize: 11, fill: "#fff" }} formatter={(v: number) => v > 0 ? v : ""} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
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
    </div>
  );
}
