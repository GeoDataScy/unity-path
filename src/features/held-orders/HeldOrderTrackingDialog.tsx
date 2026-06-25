import { useEffect, useState } from "react";
import { Clock, MapPin, Package, PackageSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RETURNS_DYNA_CODE } from "@/features/held-orders/parseHeldOrdersCsv";
import {
  useHeldOrderEventsQuery,
  useSetHeldOrderStatusMutation,
} from "@/features/held-orders/useMyHeldOrdersQuery";
import {
  HELD_ORDER_AGENT_STATUS_LABEL,
  type HeldOrderAgentStatus,
  type MyHeldOrder,
} from "@/features/held-orders/types";

const STATUS_BADGE: Record<HeldOrderAgentStatus, "new" | "in-progress" | "done"> = {
  novo: "new",
  em_andamento: "in-progress",
  concluido: "done",
};

function fullAddress(o: MyHeldOrder): string {
  return [o.street1, o.street2, o.street3, o.city, o.state, o.postal_code, o.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

type Props = {
  order: MyHeldOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function HeldOrderTrackingDialog({ order, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const eventsQuery = useHeldOrderEventsQuery(open ? order?.id ?? null : null);
  const setStatusMutation = useSetHeldOrderStatusMutation();

  const [status, setStatus] = useState<HeldOrderAgentStatus>("em_andamento");
  const [note, setNote] = useState("");

  // Ao abrir um pedido, parte do status atual dele.
  useEffect(() => {
    if (open && order) {
      setStatus(order.agent_status === "concluido" ? "concluido" : "em_andamento");
      setNote("");
    }
  }, [open, order]);

  if (!order) return null;

  const events = eventsQuery.data ?? [];

  const handleSubmit = async () => {
    try {
      await setStatusMutation.mutateAsync({ orderId: order.id, status, note });
      toast({
        title: "Registro salvo",
        description:
          status === "concluido"
            ? "Pedido marcado como concluído."
            : `Status atualizado para "${HELD_ORDER_AGENT_STATUS_LABEL[status]}".`,
      });
      setNote("");
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Erro ao registrar",
        description: e instanceof Error ? e.message : "Não foi possível salvar o registro.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5" />
            {order.order_number ?? "Sem número"}
            <Badge variant="secondary" className="ml-1">
              {order.dyna_code === RETURNS_DYNA_CODE ? "Devolução" : order.dyna_code}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {order.customer_name ?? "—"}
            {order.email && <span> · {order.email}</span>}
          </DialogDescription>
        </DialogHeader>

        {/* Dados do pedido */}
        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          {order.reason && (
            <div>
              <span className="font-medium text-foreground">Motivo:</span> {order.reason}
            </div>
          )}
          {order.rma && <div>RMA: {order.rma}</div>}
          {order.age && (
            <div className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {order.age}
            </div>
          )}
          {fullAddress(order) && (
            <div className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{fullAddress(order)}</span>
            </div>
          )}
          {order.items && (
            <div className="flex items-start gap-1.5">
              <Package className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{order.items}</span>
            </div>
          )}
          {order.restocked_items && <div>Recolocados: {order.restocked_items}</div>}
          {order.damaged_items && (
            <div className="text-destructive">Danificados: {order.damaged_items}</div>
          )}
          {order.comments && <div>Obs.: {order.comments}</div>}
        </div>

        {/* Status atual */}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Status atual:</span>
          <Badge variant={STATUS_BADGE[order.agent_status]}>
            {HELD_ORDER_AGENT_STATUS_LABEL[order.agent_status]}
          </Badge>
        </div>

        {/* Histórico */}
        <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Histórico</p>
          {eventsQuery.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : events.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Nenhum registro ainda. Adicione o primeiro abaixo.
            </p>
          ) : (
            events.map((e) => {
              const dt = new Date(e.recorded_at);
              const dateStr = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
              const timeStr = dt.toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-2 border-l-2 border-primary/30 pl-3 text-sm"
                >
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_BADGE[e.status]} className="px-1.5 py-0 text-[10px]">
                        {HELD_ORDER_AGENT_STATUS_LABEL[e.status]}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {dateStr} {timeStr}
                      </span>
                      {e.user_name && (
                        <span className="text-xs text-muted-foreground">· {e.user_name}</span>
                      )}
                    </div>
                    {e.note && <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Novo registro */}
        <div className="grid gap-4 rounded-lg border bg-card p-4">
          <p className="text-sm font-semibold">Novo registro</p>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as HeldOrderAgentStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="novo">Novo</SelectItem>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="concluido">Concluído</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Observação</Label>
            <Textarea
              placeholder="Descreva o que foi feito neste pedido..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={setStatusMutation.isPending}>
            {setStatusMutation.isPending ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
