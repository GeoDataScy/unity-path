import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { filaPath, formatCasoId, formatPrazoContratual, formatVencidoHa } from "./format";
import { useOverdueQueueItemsQuery } from "./useOverdueQueueItemsQuery";

const SESSION_KEY = "xmx:sla-overdue-alert-shown";

function alreadyShown(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(`${SESSION_KEY}:${userId}`) === "1";
  } catch {
    return false;
  }
}

function markShown(userId: string): void {
  try {
    window.sessionStorage.setItem(`${SESSION_KEY}:${userId}`, "1");
  } catch {
    // sessionStorage indisponível: no pior caso o aviso reaparece no próximo carregamento.
  }
}

/**
 * Ajuste 4 do doc XMX-2026/IMP-SUP-01-A v2: informa os itens da fila com prazo
 * contratual vencido. É informação, não ordem: fecha livremente, abre uma vez
 * por sessão e não grava ciência em lugar nenhum.
 */
export function OverdueQueueAlert({ userId }: { userId: string | null }) {
  const navigate = useNavigate();
  const { data: items = [] } = useOverdueQueueItemsQuery(Boolean(userId));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId || items.length === 0 || alreadyShown(userId)) return;
    markShown(userId);
    setOpen(true);
  }, [userId, items.length]);

  if (items.length === 0) return null;

  // Os itens vêm do mais antigo para o mais recente; "Ver fila" leva à tela do primeiro.
  const destino = filaPath(items[0].tipo);
  const n = items.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Itens da sua fila com prazo contratual vencido</DialogTitle>
          <DialogDescription>
            {n} {n === 1 ? "caso ultrapassou" : "casos ultrapassaram"} o prazo previsto no pacote. Informação da
            fila — não é ordem, não exige confirmação.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[360px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caso</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prazo contratual</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={`${item.tipo}:${item.caso_id}`}>
                  <TableCell className="font-mono">{formatCasoId(item.caso_id)}</TableCell>
                  <TableCell>{item.rotulo_tipo}</TableCell>
                  <TableCell>{formatPrazoContratual(item.prazo_horas)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{formatVencidoHa(item.vencido_ha_horas)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              navigate(destino);
            }}
          >
            Ver fila
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
