import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmtDate, fmtUsd, KIND_LABEL, type DivergenceRow } from "./types";

type Props = {
  rows: DivergenceRow[];
  isLoading: boolean;
};

function KindBadge({ row }: { row: DivergenceRow }) {
  const label = KIND_LABEL[row.kind];
  if (row.kind === "ambos") return <Badge variant="success">{label}</Badge>;
  if (row.kind === "interno") return <Badge variant="in-progress">{label}</Badge>;
  return (
    <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
      {label}
    </Badge>
  );
}

function externalStatusLabel(row: DivergenceRow): string {
  if (!row.payment_status) return "—";
  return row.payment_status === "Refunded" ? "Integral" : "Parcial";
}

/** Lista pedido a pedido. O número (ou a ausência dele) é a chave de tudo. */
export function DivergencesTable({ rows, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum pedido para os filtros escolhidos.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead>Onde aparece</TableHead>
            <TableHead>Pedido (externo)</TableHead>
            <TableHead>Solicitado (interno)</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Externo</TableHead>
            <TableHead>Interno</TableHead>
            <TableHead className="text-right">Valor (externo)</TableHead>
            <TableHead>Agente</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, idx) => (
            <TableRow key={`${r.kind}-${r.product}-${r.order_number ?? r.internal_order_id ?? idx}-${idx}`}>
              <TableCell className="font-mono text-xs">
                {r.order_name ?? r.internal_order_id ?? <span className="text-muted-foreground">sem nº</span>}
              </TableCell>
              <TableCell>{r.product}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <KindBadge row={r} />
                  {r.type_mismatch && (
                    <Badge variant="destructive" title="Reembolso externo e interno discordam entre parcial e integral">
                      tipo diverge
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{fmtDate(r.external_date)}</TableCell>
              <TableCell className="tabular-nums">
                {fmtDate(r.internal_request_date)}
                {r.internal_request_date && !r.internal_completion_date && (
                  <span className="ml-1 text-xs text-muted-foreground">(em aberto)</span>
                )}
              </TableCell>
              <TableCell className="max-w-[200px] truncate" title={r.customer_name ?? r.customer_email ?? ""}>
                {r.customer_name ?? r.customer_email ?? "—"}
              </TableCell>
              <TableCell>
                <span className={cn(!r.payment_status && "text-muted-foreground")}>{externalStatusLabel(r)}</span>
                {r.external_status === "Open" && (
                  <span className="ml-1 text-xs text-muted-foreground">(não enviado)</span>
                )}
              </TableCell>
              <TableCell>
                {r.internal_request_date ? (
                  <span>
                    {r.refund_type ?? <span className="text-muted-foreground">sem baixa</span>}
                    {r.sales_platform && <span className="ml-1 text-xs text-muted-foreground">· {r.sales_platform}</span>}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtUsd(r.refund_amount)}</TableCell>
              <TableCell className="max-w-[160px] truncate" title={r.agent_name ?? ""}>
                {r.agent_name ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
