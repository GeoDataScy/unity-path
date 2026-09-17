import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle, Building2, CircleDollarSign, Database, Store, Upload } from "lucide-react";

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
import {
  useDeleteExternalRefundsMutation,
  useExternalRefundComparisonQuery,
} from "@/features/external-refunds/useExternalRefundComparisonQuery";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_PLATFORM,
  EXTERNAL_PLATFORMS,
  fmtDate,
  fmtInt,
  fmtMonth,
  fmtPct,
  fmtUsd,
  type DivergenceFilter,
  type ExternalPlatform,
} from "@/features/external-refunds/types";

const PAGE_SIZE = 25;

/**
 * Interno maior que o total importado. Não é para esconder: significa que o
 * arquivo daquele período está velho ou faltando, e o denominador das colunas
 * de % não dá para confiar.
 */
function InconsistentBadge() {
  return (
    <span
      className="ml-1 inline-flex items-center rounded-sm bg-destructive/15 px-1 text-xs font-medium text-destructive"
      title="interno excede o total importado; verificar import do período"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">interno excede o total importado; verificar import do período</span>
    </span>
  );
}

/**
 * Coluna "Integral / parcial". O arquivo da PagAmerican confirma o reembolso mas
 * em parte dos pedidos não diz o tipo, e esses não entram em nenhum dos dois
 * números. Sem o terceiro, integral + parcial não fecharia com o total e a
 * diferença ficaria invisível. Na Cartpanda todo pedido é classificado, o
 * terceiro é zero e a célula fica idêntica ao que sempre foi.
 */
function TypeBreakdown({ row }: { row: { external_count: number; external_full: number; external_partial: number } }) {
  const semTipo = Math.max(row.external_count - row.external_full - row.external_partial, 0);
  return (
    <>
      {fmtInt(row.external_full)} / {fmtInt(row.external_partial)}
      {semTipo > 0 && (
        <span className="text-muted-foreground" title="o arquivo não informa se foi integral ou parcial">
          {" "}
          · {fmtInt(semTipo)} s/ tipo
        </span>
      )}
    </>
  );
}

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

export default function DashboardRefundsComparativo() {
  const { role } = useOutletContext<ManagerOutletContext>();
  const isManager = role === "manager";

  const [month, setMonth] = useState<string>("all");
  const [product, setProduct] = useState<string>("all");
  const [platform, setPlatform] = useState<ExternalPlatform>(DEFAULT_PLATFORM);
  const [kind, setKind] = useState<DivergenceFilter>("all");
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const deleteMutation = useDeleteExternalRefundsMutation();

  useEffect(() => {
    setPage(1);
  }, [month, product, platform, kind]);

  const { from, to } = useMemo(() => {
    if (month === "all") return { from: ALL_FROM, to: todayISO() };
    return monthRange(month);
  }, [month]);

  const query = useExternalRefundComparisonQuery({
    from,
    to,
    product,
    platform,
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

  const handleDelete = async () => {
    if (!productToDelete) return;
    try {
      const r = await deleteMutation.mutateAsync({ product: productToDelete, platform });
      toast({
        title: "Reembolsos externos apagados",
        description: `${productToDelete} (${platform}): ${fmtInt(r.deleted)} linha(s) removida(s). Importe o arquivo de novo quando quiser.`,
      });
      if (product === productToDelete) setProduct("all");
    } catch (e) {
      toast({
        title: "Erro ao apagar",
        description: e instanceof Error ? e.message : "Não foi possível apagar.",
        variant: "destructive",
      });
    } finally {
      setProductToDelete(null);
    }
  };

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
            Compara os reembolsos concluídos pelos agentes (interno) com os reembolsos externos importados por
            arquivo, pedido a pedido, só para os produtos que têm reembolso externo importado. Reembolso interno
            ainda em aberto não entra em nenhum número desta tela. O filtro de plataforma vale
            nos dois lados: externo pelo arquivo importado, interno pela plataforma do reembolso. O período e o agente da
            barra lateral não se aplicam aqui.
          </p>
        </div>
        {isManager && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Importar reembolso externo
          </Button>
        )}
      </header>

      {query.isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível carregar o comparativo: {(query.error as Error)?.message ?? "erro desconhecido"}.
        </p>
      )}

      {/* Filtros */}
      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plataforma</div>
          <Select value={platform} onValueChange={(v) => setPlatform(v as ExternalPlatform)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Plataforma" />
            </SelectTrigger>
            <SelectContent>
              {EXTERNAL_PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              <SelectItem value="all">Todos com reembolso externo</SelectItem>
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
              <SelectItem value="externo">Só externo</SelectItem>
              <SelectItem value="interno">Só interno</SelectItem>
              <SelectItem value="tipo">Parcial × integral divergem</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {!isLoading && !hasImports && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum reembolso externo de {platform} foi importado ainda.
            {isManager ? " Use o botão “Importar reembolso externo” para começar." : ""}
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4 text-primary" /> Interno concluído ({platform})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpi(summary?.internal_count)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Store className="h-4 w-4 text-primary" /> Total da loja
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
              <Store className="h-4 w-4 text-primary" /> Externo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpi(summary?.external_diff)}
            {summary && (
              <p className="mt-1 text-xs text-muted-foreground">total da loja menos o interno</p>
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
              <Store className="h-4 w-4 text-primary" /> Só externo
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
              <CircleDollarSign className="h-4 w-4 text-primary" /> Valor do total
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
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ProductMonthPanels
              rows={data?.by_product_month ?? []}
              onDelete={isManager ? (p) => setProductToDelete(p) : undefined}
              platform={platform}
            />
          )}
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
                    <TableHead className="text-right">Total da loja</TableHead>
                    <TableHead className="text-right">Interno</TableHead>
                    <TableHead className="text-right">Externo</TableHead>
                    <TableHead className="text-right">Só interno</TableHead>
                    <TableHead className="text-right">Só externo</TableHead>
                    <TableHead className="text-right">% interno</TableHead>
                    <TableHead className="text-right">% externo</TableHead>
                    <TableHead className="text-right">Integral / parcial</TableHead>
                    <TableHead className="text-right">Valor do total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.by_product_month ?? []).map((r) => (
                    <TableRow key={`${r.product}-${r.month}`}>
                      <TableCell className="font-medium">{r.product}</TableCell>
                      <TableCell>{fmtMonth(r.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(r.external_count)}
                        {r.inconsistent && <InconsistentBadge />}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.internal_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.external_diff)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.internal_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.external_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(r.internal_pct)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(r.external_pct)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <TypeBreakdown row={r} />
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
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(summary.external_count)}
                        {summary.inconsistent && <InconsistentBadge />}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.internal_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.external_diff)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.internal_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(summary.external_only)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(summary.internal_pct)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(summary.external_pct)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <TypeBreakdown row={summary} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(summary.external_amount)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Total da loja</strong> é a contagem de pedidos distintos do arquivo importado,{" "}
                {platform === "PagAmerican"
                  ? "no mês do reembolso, que o próprio arquivo informa"
                  : "no mês informado na importação"}
                . <strong>Interno</strong> são os reembolsos concluídos com plataforma{" "}
                {platform}, pela data da baixa — o mesmo que a Visão geral mostra com Status “Concluídos”.{" "}
                <strong>Externo</strong> é o que sobra: total da loja menos o interno. Daí saem{" "}
                <strong>% interno</strong> (interno ÷ total) e <strong>% externo</strong> (o restante), que somam 100%.
                Sem arquivo importado para o período, as duas colunas ficam em “—” em vez de 0%. Se o interno passar do
                total, o externo fica em 0 e a linha ganha um aviso: o arquivo daquele período está velho ou faltando.
                {platform === "PagAmerican" && (
                  <>
                    Nesta plataforma o arquivo confirma o reembolso mas nem sempre diz se foi integral ou parcial: esses
                    aparecem como “s/ tipo” e contam normalmente no total e nas porcentagens, que não usam o tipo.{" "}
                  </>
                )}
                As colunas “só interno” e “só externo” vêm do casamento por número de pedido (interno <code>1896</code>{" "}
                = externo <code>#1896</code>) e servem para a lista pedido a pedido — não entram no cálculo das
                porcentagens, porque quem não casa por ruído subestimaria o interno.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lotes importados */}
      {hasImports && (
        <Card>
          <CardHeader>
            <CardTitle>Reembolsos externos importados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plataforma</TableHead>
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
                    <TableRow key={`${b.platform}-${b.product}-${b.month_ref}-${b.source_file}`}>
                      <TableCell>{b.platform}</TableCell>
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

      <AlertDialog open={productToDelete !== null} onOpenChange={(open) => !open && setProductToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar reembolsos externos de {productToDelete}?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove todos os meses importados deste produto na plataforma {platform}. Os reembolsos internos não são afetados. Dá para importar
              o arquivo de novo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Apagando..." : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
