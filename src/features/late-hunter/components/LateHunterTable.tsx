import { RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LIMITE_ANTIGO, formatDay, motivoLabel } from "../format";
import type { LateHunterOrder } from "../types";

/** Dias em espera com peso visual crescente: o olho acha o que está velho. */
export function DiasEmEspera({ dias }: { dias: number | null }) {
  if (dias == null) return <span className="text-muted-foreground">—</span>;
  const antigo = dias > LIMITE_ANTIGO;
  return (
    <span className={cn("font-mono tabular-nums", antigo ? "font-medium text-warning" : "text-ink")}>
      {dias}
      <span className="ml-0.5 text-xs font-normal text-ink-tertiary">{dias === 1 ? "dia" : "dias"}</span>
    </span>
  );
}

export function SituacaoBadge({ o }: { o: LateHunterOrder }) {
  if (o.situacao === "encerrado") {
    return (
      <Badge variant="outline" className="whitespace-nowrap text-success" title={`Saiu do on-hold no lote de ${formatDay(o.encerrado_referencia)}`}>
        Saiu do hold
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="whitespace-nowrap text-info">
      Em on-hold
    </Badge>
  );
}

type Props = {
  rows: LateHunterOrder[];
  onOpen: (o: LateHunterOrder) => void;
  /** Liga a coluna "saiu em" quando a lista mostra encerrados. */
  showClosed: boolean;
};

export function LateHunterTable({ rows, onOpen, showClosed }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead>
            <TableHead>Loja</TableHead>
            <TableHead>Motivo</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>País</TableHead>
            <TableHead>Data do pedido</TableHead>
            <TableHead className="text-right">Em espera</TableHead>
            <TableHead>No Late Hunter desde</TableHead>
            {showClosed && <TableHead>Saiu em</TableHead>}
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o) => (
            <TableRow
              key={o.id}
              className="cursor-pointer"
              onClick={() => onOpen(o)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(o);
                }
              }}
              tabIndex={0}
              aria-label={`Abrir pedido ${o.pedido} da loja ${o.loja}`}
            >
              <TableCell className="font-mono text-sm">{o.pedido}</TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-mono text-xs">{o.loja}</span>
                  {o.loja_nome && <span className="text-xs text-ink-tertiary">{o.loja_nome}</span>}
                </div>
              </TableCell>
              <TableCell className="max-w-[240px]">
                <div className="flex flex-wrap gap-1">
                  {o.motivos.map((m) => (
                    <Badge key={m} variant="secondary" className="max-w-full truncate font-normal" title={m}>
                      {motivoLabel(m)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm">{o.cliente_nome || "—"}</span>
                  {o.cliente_email && <span className="text-xs text-muted-foreground">{o.cliente_email}</span>}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{o.pais ?? "—"}</TableCell>
              <TableCell className="font-mono text-sm tabular-nums">{formatDay(o.data_pedido)}</TableCell>
              <TableCell className="text-right">
                <DiasEmEspera dias={o.dias_em_espera} />
              </TableCell>
              <TableCell className="text-sm">
                <span className="font-mono tabular-nums">{formatDay(o.primeira_referencia)}</span>
                {o.vezes_reaberto > 0 && (
                  <span
                    className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-warning"
                    title="Saiu do on-hold e voltou depois"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    voltou {o.vezes_reaberto}×
                  </span>
                )}
              </TableCell>
              {showClosed && (
                <TableCell className="font-mono text-sm tabular-nums">
                  {o.situacao === "encerrado" ? formatDay(o.encerrado_referencia) : "—"}
                </TableCell>
              )}
              <TableCell>
                <SituacaoBadge o={o} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
