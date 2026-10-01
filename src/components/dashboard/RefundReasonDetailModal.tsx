import { useEffect, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { useDashboardRefundReasonDetailQuery } from "@/features/dashboard/useDashboardRefundReasonDetailQuery";
import { exportRefundReasonDetail } from "@/lib/reportExport";

function safeParseISODate(value: string | null): Date | null {
  if (!value) return null;
  const dt = parseISO(value);
  return isValid(dt) ? dt : null;
}

function formatDate(value: string | null): string {
  const dt = safeParseISODate(value);
  return dt ? format(dt, "dd/MM/yyyy", { locale: ptBR }) : value ?? "—";
}

function formatValue(v: number | null): string {
  if (v === null || v === undefined) return "—";
  // refunds.refund_value é dólar (o agente digita com "$" em Reembolsos.tsx).
  return v.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

type Props = {
  open: boolean;
  onClose: () => void;
  reasonCategory: string | null;
  from: string;
  to: string;
  agentId?: string;
  status?: "all" | "open" | "done";
  refundType?: string;
  product?: string;
};

const PAGE_SIZE = 50;

export function RefundReasonDetailModal({
  open,
  onClose,
  reasonCategory,
  from,
  to,
  agentId,
  status = "all",
  refundType = "all",
  product = "all",
}: Props) {
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);

  // Reset to first page whenever the category or filters change.
  useEffect(() => {
    setPage(1);
  }, [reasonCategory, from, to, agentId, status, refundType, product]);

  const query = useDashboardRefundReasonDetailQuery({
    enabled: open,
    from,
    to,
    reasonCategory,
    agentId,
    status,
    refundType,
    product,
    page,
    pageSize: PAGE_SIZE,
    refetchIntervalMs: 15_000,
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  const total = data?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const periodLabel = `${formatDate(from)} — ${formatDate(to)}`;

  async function handleDownload() {
    if (!reasonCategory || downloading) return;
    setDownloading(true);
    try {
      const count = await exportRefundReasonDetail({
        reasonCategory,
        fromISO: from,
        toISO: to,
        agentId,
        status,
        refundType,
        product,
      });
      toast.success(`Relatório gerado com ${count.toLocaleString("pt-BR")} reembolso(s).`);
    } catch (err) {
      console.error("Falha ao gerar relatório de reembolsos:", err);
      toast.error("Não foi possível gerar o relatório. Tente novamente.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-primary" />
            Motivos de reembolso — {reasonCategory ?? ""}
          </DialogTitle>
        </DialogHeader>

        {/* Resumo */}
        <div className="flex flex-wrap items-stretch gap-3 pb-1">
          <div className="rounded-lg border bg-card p-3 min-w-[180px]">
            <p className="text-xs text-muted-foreground">Reembolsos nesta categoria</p>
            <p className="text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]">{total.toLocaleString("pt-BR")}</p>
          </div>
          <div className="rounded-lg border bg-card p-3 min-w-[200px]">
            <p className="text-xs text-muted-foreground">Período</p>
            <p className="text-sm font-medium leading-tight mt-1">{periodLabel}</p>
          </div>
          <Button
            onClick={handleDownload}
            disabled={downloading || query.isLoading || total === 0}
            className="ml-auto self-center gap-2"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Baixar relatório
          </Button>
        </div>

        {query.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <MessageSquareText className="h-6 w-6 opacity-40" />
            <p className="text-sm">Nenhum reembolso encontrado nesta categoria</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Solicitação</TableHead>
                    <TableHead>Conclusão</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Motivo original</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(row.request_date)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.completion_date ? formatDate(row.completion_date) : "Em aberto"}
                      </TableCell>
                      <TableCell className="font-medium">{row.profiles?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.customer_email}</TableCell>
                      <TableCell>{row.product ?? "—"}</TableCell>
                      <TableCell>{row.sales_platform}</TableCell>
                      <TableCell className="font-mono text-xs">{row.order_id}</TableCell>
                      <TableCell>{row.channel ?? "—"}</TableCell>
                      <TableCell>{row.refund_type ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatValue(row.refund_value)}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground" title={row.original_reason ?? undefined}>
                        {row.original_reason ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Página {page} de {totalPages} • {total.toLocaleString("pt-BR")} registros
              </p>

              {totalPages > 1 && (
                <Pagination className="mx-0 w-auto">
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
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
