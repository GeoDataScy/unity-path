import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowLeftRight, Building2, CircleDollarSign, Database, Store, Upload } from "lucide-react";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
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
import { RefundsSubNav } from "@/components/dashboard/RefundsSubNav";
import { DivergencesTable } from "@/features/external-refunds/DivergencesTable";
import { ImportExternalRefundsDialog } from "@/features/external-refunds/ImportExternalRefundsDialog";
import { ProductMonthPanels } from "@/features/external-refunds/ProductMonthPanels";
import { useExternalRefundComparisonQuery } from "@/features/external-refunds/useExternalRefundComparisonQuery";
import {
  fmtDate,
  fmtInt,
  fmtMonth,
  fmtPct,
  fmtUsd,
  type DivergenceFilter,
} from "@/features/external-refunds/types";

const PAGE_SIZE = 25;

// "Todos os meses" = do primeiro export importado até hoje. O intervalo largo
// não pesa: a RPC só olha external_refunds e os refunds dos produtos dela.
const ALL_FROM = "2026-01-01";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function CoverageBar({ value }: { value: number | null }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="h-2 w-full min-w-[48px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="h-full rounded-full bg-[hsl(var(--chart-2))]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function DashboardRefundsComparativo() {
  const { role } = useOutletContext<ManagerOutletContext>();
  const isManager = role === "manager";

  const [month, setMonth] = useState<string>("all");
  const [product, setProduct] = useState<string>("all");
  const [kind, setKind] = useState<DivergenceFilter>("all");
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [month, product, kind]);

  const { from, to } = useMemo(() => {
    if (month === "all") return { from: ALL_FROM, to: todayISO() };
    return monthRange(month);
  }, [month]);

  const query = useExternalRefundComparisonQuery({
    from,
    to,
    product,
    divergenceFilter: kind,
    page,
    pageSize: PAGE_SIZE,
  });
  const data = query.data;
  const isLoading = query.isLoading;
  const summary = data?.summary;

  // Meses disponíveis vêm dos lotes importados (não do período selecionado).
  const monthOptions = useMemo(() => {
    const set = new Set((data?.imports ?? []).map((b) => b.month_ref.slice(0, 7)));
    return Array.from(set).sort();
  }, [data?.imports]);

  const productOptions = useMemo(() => (data?.products ?? []).map((p) => p.product), [data?.products]);
  const hasImports = (data?.imports?.length ?? 0) > 0;

  const totalPages = Math.max(1, Math.ceil((data?.divergences.total_count ?? 0) / PAGE_SIZE));

  const kpi = (value: number | null | undefined, format: (v: number | null | undefined) => string = fmtInt) =>
    isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-3xl font-semibold tabular-nums">{format(value)}</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-lg font-semibold text-muted-foreground">Analytics</p>
          <h1 className="text-3xl font-semibold tracking-tight">Reembolsos</h1>
          <RefundsSubNav />
          <p className="max-w-3xl text-sm text-muted-foreground">
            Compara os reembolsos registrados pelos agentes com os exports de pedidos reembolsados das lojas, pedido a
            pedido, só para os produtos que têm export importado. O período e o agente da barra lateral não se aplicam
            aqui.
          </p>
        </div>
        {isManager && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Importar export da loja
          </Button>
        )}
      </header>

      {query.isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível carregar o comparativo: {(query.error as Error)?.message ?? "erro desconhecido"}.
        </p>
      )}

      {/* Filtros */}
      <section className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mês</div>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses importados</SelectItem>
              {monthOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {fmtMonth(m)}
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
              <SelectItem value="all">Todos com export</SelectItem>
              {productOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lista de pedidos</div>
          <Select value={kind} onValueChange={(v) => setKind(v as DivergenceFilter)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os pedidos</SelectItem>
              <SelectItem value="ambos">Nos dois lados</SelectItem>
              <SelectItem value="externo">Só na loja</SelectItem>
              <SelectItem value="interno">Só interno</SelectItem>
              <SelectItem value="tipo">Parcial × integral divergem</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {!isLoading && !hasImports && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum export de loja foi importado ainda.
            {isManager ? " Use o botão “Importar export da loja” para começar." : ""}
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4 text-primary" /> Interno
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpi(summary?.internal_count)}
            {summary && (
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtInt(summary.internal_without_order)} sem nº de pedido
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Store className="h-4 w-4 text-primary" /> Loja
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpi(summary?.external_count)}
            {summary && (
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtInt(summary.external_full)} integrais · {fmtInt(summary.external_partial)} parciais
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ArrowLeftRight className="h-4 w-4 text-primary" /> Casados
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpi(summary?.matched_count)}
            {summary && (
              <p className="mt-1 text-xs text-muted-foreground">{fmtPct(summary.coverage_pct)} dos pedidos da loja</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="h-4 w-4 text-primary" /> Só interno
            </CardTitle>
          </CardHeader>
          <CardContent>{kpi(summary?.internal_only)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Store className="h-4 w-4 text-primary" /> Só na loja
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpi(summary?.external_only)}
            {summary && summary.type_mismatch_count > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtInt(summary.type_mismatch_count)} casado(s) com tipo divergente
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CircleDollarSign className="h-4 w-4 text-primary" /> Valor na loja
            </CardTitle>
          </CardHeader>
          <CardContent>{kpi(summary?.external_amount, fmtUsd)}</CardContent>
        </Card>
      </section>

      {/* Small multiples por produto */}
      <Card>
        <CardHeader>
          <CardTitle>Reembolsos por produto e mês</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-48 w-full" /> : <ProductMonthPanels rows={data?.by_product_month ?? []} />}
        </CardContent>
      </Card>

      {/* Tabela produto × mês */}
      <Card>
        <CardHeader>
          <CardTitle>Produto × mês</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Interno</TableHead>
                    <TableHead className="text-right">Loja</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead className="text-right">Casados</TableHead>
                    <TableHead className="text-right">Só interno</TableHead>
                    <TableHead className="text-right">Só na loja</TableHead>
                    <TableHead className="min-w-[160px]">Cobertura</TableHead>
                    <TableHead className="text-right">Integral / parcial</TableHead>
                    <TableHead className="text-right">Valor na loja</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.by_product_month ?? []).map((r) => (
                    <TableRow key={`${r.product}-${r.month}`}>
                      <TableCell className="font-medium">{r.product}</TableCell>
                      <TableCell>{fmtMonth(r.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(r.internal_count)}
                        {r.internal_open > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">({fmtInt(r.internal_open)} em aberto)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.external_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.internal_count - r.external_count > 0 ? "+" : ""}
                        {fmtInt(r.internal_count - r.external_count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.matched_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.internal_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.external_only)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <CoverageBar value={r.coverage_pct} />
                          <span className="w-14 text-right text-xs tabular-nums">{fmtPct(r.coverage_pct)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(r.external_full)} / {fmtInt(r.external_partial)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(r.external_amount)}</TableCell>
                    </TableRow>
                  ))}
                  {summary && (
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell>Todos</TableCell>
                      <TableCell>
                        {month === "all" ? "período" : fmtMonth(month)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.internal_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.external_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {summary.internal_count - summary.external_count > 0 ? "+" : ""}
                        {fmtInt(summary.internal_count - summary.external_count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.matched_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.internal_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.external_only)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <CoverageBar value={summary.coverage_pct} />
                          <span className="w-14 text-right text-xs tabular-nums">{fmtPct(summary.coverage_pct)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(summary.external_full)} / {fmtInt(summary.external_partial)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(summary.external_amount)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                Interno conta pela data em que o cliente pediu o reembolso; loja conta pela data do pedido no export.
                Um pedido casa quando produto e número do pedido coincidem (interno <code>1896</code> = loja{" "}
                <code>#1896</code>), em qualquer mês. Cobertura = casados ÷ pedidos da loja. Reembolso interno em aberto
                ainda não aparece na loja — é a causa mais comum de “só interno”.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lotes importados */}
      {hasImports && (
        <Card>
          <CardHeader>
            <CardTitle>Exports importados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Mês</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                    <TableHead className="text-right">Pedidos</TableHead>
                    <TableHead>Importado em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.imports ?? []).map((b) => (
                    <TableRow key={`${b.product}-${b.month_ref}-${b.source_file}`}>
                      <TableCell className="font-medium">{b.product}</TableCell>
                      <TableCell>{fmtMonth(b.month_ref)}</TableCell>
                      <TableCell className="font-mono text-xs">{b.source_file}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(b.rows)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(b.orders)}</TableCell>
                      <TableCell className="tabular-nums">{fmtDate(b.imported_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pedido a pedido */}
      <Card>
        <CardHeader>
          <CardTitle>
            Pedido a pedido{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({fmtInt(data?.divergences.total_count)} registro(s))
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DivergencesTable rows={data?.divergences.rows ?? []} isLoading={isLoading} />
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage((p) => Math.max(1, p - 1));
                    }}
                    className={page === 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#" isActive onClick={(e) => e.preventDefault()}>
                    {page} / {totalPages}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setPage((p) => Math.min(totalPages, p + 1));
                    }}
                    className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>

      {isManager && <ImportExternalRefundsDialog open={importOpen} onOpenChange={setImportOpen} />}
    </div>
  );
}
