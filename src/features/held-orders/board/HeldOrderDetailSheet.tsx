import { useEffect, useState } from "react";
import { Clock, Flag, MapPin, Package, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatHeldOrderAge, formatHeldOrderDate, formatHeldOrderDateTime, HELD_ORDER_DATE_LABEL } from "../dates";
import { heldOrderStoreLabel, parseAddress, parseItems, parseReasons, totalUnits } from "../format";
import { useAssignHeldOrdersMutation } from "../useManagerHeldOrdersQuery";
import { useHeldOrderEventsQuery } from "../useMyHeldOrdersQuery";
import {
  HELD_ORDER_AGENT_STATUS_BADGE,
  HELD_ORDER_AGENT_STATUS_LABEL,
  HELD_ORDER_PENDING_TAG_LABEL,
} from "../types";
import {
  HELD_ORDER_BUCKET_DOT,
  HELD_ORDER_BUCKET_LABEL,
  heldOrderIsOpen,
  type HeldOrdersBoardRow,
} from "./useHeldOrdersBoard";

type Props = {
  order: HeldOrdersBoardRow | null;
  onOpenChange: (open: boolean) => void;
  /** Agentes ativos que podem receber o pedido. */
  agents: { id: string; name: string }[];
};

/**
 * Detalhe do pedido para a gestora: as quatro datas lado a lado, produtos,
 * endereço e o histórico completo do agente. Reatribuir leva junto os outros
 * pedidos em aberto do mesmo cliente (regra "um cliente, um agente").
 */
export function HeldOrderDetailSheet({ order, onOpenChange, agents }: Props) {
  const { toast } = useToast();
  const eventsQuery = useHeldOrderEventsQuery(order?.id ?? null);
  const assign = useAssignHeldOrdersMutation();
  const [agentId, setAgentId] = useState<string>("");

  useEffect(() => {
    setAgentId("");
  }, [order?.id]);

  const events = eventsQuery.data ?? [];
  const reasons = order ? parseReasons(order.reason) : [];
  const items = order ? parseItems(order.items) : [];
  const address = order ? parseAddress(order) : null;
  const canReassign = order ? heldOrderIsOpen(order) : false;
  const targets = agents.filter((a) => a.id !== order?.assigned_to);

  const handleReassign = async () => {
    if (!order || !agentId) return;
    try {
      const moved = await assign.mutateAsync({ orderIds: [order.id], agentId });
      const name = agents.find((a) => a.id === agentId)?.name ?? "o agente";
      toast({
        title: "Pedido reatribuído",
        description:
          moved > 1
            ? `${moved} pedidos em aberto deste cliente foram para ${name}.`
            : `O pedido foi para ${name}.`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Não foi possível reatribuir",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    }
  };

  const dates: { label: string; value: string; source: string }[] = order
    ? [
        { label: HELD_ORDER_DATE_LABEL.order_date, value: formatHeldOrderDate(order.order_date), source: "da planilha" },
        { label: HELD_ORDER_DATE_LABEL.return_date, value: formatHeldOrderDate(order.return_date), source: "só devoluções" },
        { label: HELD_ORDER_DATE_LABEL.imported_at, value: formatHeldOrderDateTime(order.imported_at), source: "não muda" },
        {
          label: HELD_ORDER_DATE_LABEL.status_changed_at,
          value: formatHeldOrderDateTime(order.status_changed_at),
          source: "registro do agente",
        },
      ]
    : [];

  return (
    <Sheet open={Boolean(order)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {order && (
          <div className="grid gap-5">
            <SheetHeader className="space-y-1 text-left">
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">
                {heldOrderStoreLabel(order.dyna_code)}
                {order.rma && ` · RMA ${order.rma}`}
              </span>
              <SheetTitle className="font-mono text-xl font-medium tracking-tight">
                {order.order_number ?? "Sem número"}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <span className={cn("h-2 w-2 rounded-full", HELD_ORDER_BUCKET_DOT[order.bucket])} />
                    {HELD_ORDER_BUCKET_LABEL[order.bucket]}
                  </span>
                  <span>· {order.assigned_to_name ?? "sem agente"}</span>
                  {order.pending_tag && (
                    <Badge variant="destructive" className="gap-1">
                      <Flag className="h-3 w-3" />
                      {HELD_ORDER_PENDING_TAG_LABEL[order.pending_tag]}
                    </Badge>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            <div>
              <p className="font-medium">{order.customer_name ?? "—"}</p>
              {order.email && <p className="text-sm text-muted-foreground">{order.email}</p>}
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
              {dates.map((d) => (
                <div key={d.label} className="grid gap-0.5 bg-card px-3 py-2.5">
                  <dt className="text-[11px] text-ink-tertiary">{d.label}</dt>
                  <dd className="font-mono text-sm font-medium tabular-nums">{d.value}</dd>
                  <span className="text-[11px] text-ink-tertiary">{d.source}</span>
                </div>
              ))}
            </dl>

            {(reasons.length > 0 || order.age) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {reasons.map((r) => (
                  <Badge key={r.key} variant="outline" className="border-warning/40 font-medium text-warning">
                    {r.label}
                  </Badge>
                ))}
                {order.age && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {formatHeldOrderAge(order.age)}
                  </span>
                )}
              </div>
            )}

            {items.length > 0 && (
              <section className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Produtos
                  <span className="font-normal normal-case tracking-normal">
                    ({items.length} item(ns) · {totalUnits(items)} un.)
                  </span>
                </p>
                <ul className="space-y-1">
                  {items.map((item, idx) => (
                    <li key={`${item.sku}-${idx}`} className="flex items-baseline gap-2 text-sm">
                      <span className="min-w-[2.25rem] shrink-0 rounded bg-primary/10 px-1.5 text-center font-mono font-medium tabular-nums text-primary">
                        {item.qty}×
                      </span>
                      <span className="font-medium">{item.product}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{item.sku}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {address?.oneLine && (
              <section className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> Endereço
                </p>
                <address className="space-y-0.5 text-sm not-italic">
                  {address.street.map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                  {address.locality && <div>{address.locality}</div>}
                  {address.country && <div className="font-medium text-muted-foreground">{address.country}</div>}
                </address>
              </section>
            )}

            <section className="grid gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Histórico</p>
              {eventsQuery.isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground">O agente ainda não registrou nada neste pedido.</p>
              ) : (
                <ol className="grid gap-3 border-l-2 pl-3.5">
                  {[...events].reverse().map((e) => (
                    <li key={e.id} className="grid gap-0.5 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={HELD_ORDER_AGENT_STATUS_BADGE[e.status]} className="px-1.5 py-0 text-[10px]">
                          {HELD_ORDER_AGENT_STATUS_LABEL[e.status]}
                        </Badge>
                        {e.pending_tag && (
                          <span className="text-xs text-destructive">{HELD_ORDER_PENDING_TAG_LABEL[e.pending_tag]}</span>
                        )}
                      </div>
                      {e.note && <p className="text-muted-foreground">{e.note}</p>}
                      <span className="font-mono text-[11px] text-ink-tertiary">
                        {formatHeldOrderDateTime(e.recorded_at)} · {e.user_name ?? "—"}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {canReassign && (
              <section className="grid gap-2 rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <UserCog className="h-4 w-4" /> Reatribuir
                </p>
                <div className="flex gap-2">
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Escolha o agente" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleReassign} disabled={!agentId || assign.isPending}>
                    {assign.isPending ? "Movendo..." : "Reatribuir"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Os outros pedidos em aberto deste cliente vão junto, para ele continuar com um agente só.
                </p>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
