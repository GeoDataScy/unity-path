import { useEffect, useState } from "react";
import { Clock, Flag, MapPin, Package, PackageSearch } from "lucide-react";

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
import { parseAddress, parseItems, parseReasons, totalUnits } from "@/features/held-orders/format";
import {
  useHeldOrderEventsQuery,
  useSetHeldOrderStatusMutation,
} from "@/features/held-orders/useMyHeldOrdersQuery";
import {
  HELD_ORDER_AGENT_STATUS_LABEL,
  HELD_ORDER_PENDING_TAG_HINT,
  HELD_ORDER_PENDING_TAG_LABEL,
  HELD_ORDER_PENDING_TAGS,
  type HeldOrderAgentStatus,
  type HeldOrderPendingTag,
  type MyHeldOrder,
} from "@/features/held-orders/types";

const STATUS_BADGE: Record<HeldOrderAgentStatus, "new" | "in-progress" | "done"> = {
  novo: "new",
  em_andamento: "in-progress",
  concluido: "done",
};

/** O Select do shadcn não aceita item com value vazio — sentinela para "sem pendência". */
const NO_TAG = "sem_pendencia";

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
  const [pendingTag, setPendingTag] = useState<string>(NO_TAG);
  const [note, setNote] = useState("");

  // Ao abrir um pedido, parte do status e da pendência atuais dele.
  useEffect(() => {
    if (open && order) {
      setStatus(order.agent_status === "concluido" ? "concluido" : "em_andamento");
      setPendingTag(order.pending_tag ?? NO_TAG);
      setNote("");
    }
  }, [open, order]);

  if (!order) return null;

  const events = eventsQuery.data ?? [];
  const reasons = parseReasons(order.reason);
  const address = parseAddress(order);
  const items = parseItems(order.items);
  // Concluir encerra o caso: o RPC limpa a tag, então a seleção fica desabilitada.
  const tagDisabled = status === "concluido";

  const handleSubmit = async () => {
    try {
      await setStatusMutation.mutateAsync({
        orderId: order.id,
        status,
        note,
        pendingTag: pendingTag === NO_TAG ? null : (pendingTag as HeldOrderPendingTag),
      });
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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <PackageSearch className="h-5 w-5 shrink-0" />
            <span className="font-mono text-xl font-medium tracking-tight">
              {order.order_number ?? "Sem número"}
            </span>
            <Badge variant="secondary">
              {order.dyna_code === RETURNS_DYNA_CODE ? "Devolução" : order.dyna_code}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {order.customer_name ?? "—"}
            {order.email && <span> · {order.email}</span>}
          </DialogDescription>
        </DialogHeader>

        {/* Motivo do On Hold + idade */}
        {(reasons.length > 0 || order.age || order.rma) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {reasons.map((r) => (
              <Badge
                key={r.key}
                variant="outline"
                className="border-amber-500/40 font-medium text-amber-600 dark:text-amber-400"
              >
                {r.label}
              </Badge>
            ))}
            {order.age && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> {order.age}
              </span>
            )}
            {order.rma && <span className="text-xs text-muted-foreground">RMA: {order.rma}</span>}
          </div>
        )}

        {/* Produtos */}
        {items.length > 0 && (
          <section className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              Produtos
              <span className="font-normal normal-case tracking-normal">
                ({items.length} item(ns) · {totalUnits(items)} un.)
              </span>
            </p>
            <ul className="space-y-1">
              {items.map((item, idx) => (
                <li key={`${item.sku}-${idx}`} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-[2.25rem] shrink-0 rounded bg-primary/10 px-1.5 text-center font-medium font-mono tabular-nums text-primary">
                    {item.qty}×
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{item.product}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{item.sku}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Endereço */}
        {address.oneLine && (
          <section className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Endereço
            </p>
            <address className="space-y-0.5 text-sm not-italic">
              {address.street.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
              {address.locality && <div>{address.locality}</div>}
              {address.country && (
                <div className="font-medium text-muted-foreground">{address.country}</div>
              )}
            </address>
          </section>
        )}

        {/* Campos extras de devolução */}
        {(order.restocked_items || order.damaged_items || order.comments) && (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            {order.restocked_items && <div>Recolocados: {order.restocked_items}</div>}
            {order.damaged_items && (
              <div className="text-destructive">Danificados: {order.damaged_items}</div>
            )}
            {order.comments && <div>Obs.: {order.comments}</div>}
          </div>
        )}

        {/* Status e pendência atuais */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Status atual:</span>
          <Badge variant={STATUS_BADGE[order.agent_status]}>
            {HELD_ORDER_AGENT_STATUS_LABEL[order.agent_status]}
          </Badge>
          {order.pending_tag && (
            <Badge variant="destructive" className="gap-1">
              <Flag className="h-3 w-3" />
              {HELD_ORDER_PENDING_TAG_LABEL[order.pending_tag]}
            </Badge>
          )}
        </div>

        {/* Histórico */}
        <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Histórico</p>
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
                      {e.pending_tag && (
                        <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]">
                          <Flag className="h-2.5 w-2.5" />
                          {HELD_ORDER_PENDING_TAG_LABEL[e.pending_tag]}
                        </Badge>
                      )}
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
          <p className="text-sm font-medium">Novo registro</p>
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
            <Label>Pendência</Label>
            <Select value={pendingTag} onValueChange={setPendingTag} disabled={tagDisabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TAG}>Sem pendência</SelectItem>
                {HELD_ORDER_PENDING_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {HELD_ORDER_PENDING_TAG_LABEL[tag]} — {HELD_ORDER_PENDING_TAG_HINT[tag]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {tagDisabled
                ? "Concluir o pedido remove a pendência."
                : "Marque quando o caso depende de alguém e precisa ser retomado depois."}
            </p>
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
