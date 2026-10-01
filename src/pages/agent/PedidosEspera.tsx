import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Flag,
  MapPin,
  MessageSquare,
  Package,
  PackageSearch,
  RotateCcw,
} from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMyHeldOrdersMetricsQuery, useMyHeldOrdersQuery } from "@/features/held-orders/useMyHeldOrdersQuery";
import { HeldOrderTrackingDialog } from "@/features/held-orders/HeldOrderTrackingDialog";
import { RETURNS_DYNA_CODE } from "@/features/held-orders/parseHeldOrdersCsv";
import { parseAddress, parseItems, parseReasons, totalUnits } from "@/features/held-orders/format";
import {
  HELD_ORDER_AGENT_STATUS_LABEL,
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

type StatusFilter = "all" | HeldOrderAgentStatus;
/** "any" = qualquer pendência; "none" = sem pendência. */
type PendingFilter = "all" | "any" | "none" | HeldOrderPendingTag;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "novo", label: "Novo" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "concluido", label: "Concluído" },
];

export default function PedidosEspera() {
  const { userId } = useOutletContext<AgentOutletContext>();

  const ordersQuery = useMyHeldOrdersQuery(Boolean(userId), "all");
  const metricsQuery = useMyHeldOrdersMetricsQuery(Boolean(userId));

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>("all");
  const [selected, setSelected] = useState<MyHeldOrder | null>(null);

  const orders = ordersQuery.data ?? [];
  const metrics = metricsQuery.data;
  const goal = metrics?.goal ?? 30;
  const confirmedToday = metrics?.confirmed_today ?? 0;
  const remaining = Math.max(0, goal - confirmedToday);

  // Cada pedido já parseado uma vez — a lista é reusada por card e por filtro.
  const parsed = useMemo(
    () =>
      orders.map((o) => ({
        order: o,
        reasons: parseReasons(o.reason),
        address: parseAddress(o),
        items: parseItems(o.items),
      })),
    [orders],
  );

  /** Motivos existentes nos pedidos do agente, com contagem — alimenta o filtro. */
  const reasonOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const p of parsed) {
      for (const r of p.reasons) {
        const entry = counts.get(r.key);
        if (entry) entry.count += 1;
        else counts.set(r.key, { label: r.label, count: 1 });
      }
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  }, [parsed]);

  const pendingCounts = useMemo(() => {
    const counts = new Map<PendingFilter, number>();
    let withTag = 0;
    for (const p of parsed) {
      const tag = p.order.pending_tag;
      if (tag) {
        withTag += 1;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    counts.set("any", withTag);
    counts.set("none", parsed.length - withTag);
    return counts;
  }, [parsed]);

  const filtered = useMemo(
    () =>
      parsed.filter((p) => {
        if (statusFilter !== "all" && p.order.agent_status !== statusFilter) return false;
        if (reasonFilter !== "all" && !p.reasons.some((r) => r.key === reasonFilter)) return false;
        if (pendingFilter === "any" && !p.order.pending_tag) return false;
        if (pendingFilter === "none" && p.order.pending_tag) return false;
        if (
          pendingFilter !== "all" &&
          pendingFilter !== "any" &&
          pendingFilter !== "none" &&
          p.order.pending_tag !== pendingFilter
        ) {
          return false;
        }
        return true;
      }),
    [parsed, statusFilter, reasonFilter, pendingFilter],
  );

  const hasExtraFilters = reasonFilter !== "all" || pendingFilter !== "all";

  const progress = useMemo(() => {
    if (goal <= 0) return 0;
    return Math.min(100, Math.max(0, (confirmedToday / goal) * 100));
  }, [confirmedToday, goal]);

  const indicatorClassName = useMemo(() => {
    const pct = goal > 0 ? confirmedToday / goal : 0;
    if (pct < 0.6) return "bg-destructive";
    if (pct < 0.9) return "bg-status-open";
    return "bg-status-success";
  }, [confirmedToday, goal]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-medium tracking-tight">
          <PackageSearch className="h-7 w-7 text-primary" /> Pedidos em Espera
        </h1>
        <p className="text-sm text-muted-foreground">
          Gerencie cada pedido retido atribuído a você. Clique em um pedido para mudar o status,
          marcar uma pendência e registrar o que foi feito. Concluir um pedido conta para a sua
          meta diária.
        </p>
      </header>

      {/* Métricas do dia (meta própria, separada de Meus Atendimentos) */}
      <section className="mb-6 grid gap-4 md:grid-cols-3" aria-label="Métricas do dia">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-medium">Concluídos hoje</CardTitle>
              {!metricsQuery.isLoading && confirmedToday >= goal && <Badge variant="success">🏆 Meta Batida!</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-medium tabular-nums">{confirmedToday.toLocaleString("pt-BR")}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Faltam para a meta</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-medium tabular-nums">{remaining.toLocaleString("pt-BR")}</div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">Meta diária: {goal}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-medium tabular-nums">
                {(metrics?.pending ?? 0).toLocaleString("pt-BR")}
              </div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">Ainda não concluídos</p>
          </CardContent>
        </Card>
      </section>

      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Progresso da meta</p>
          {!metricsQuery.isLoading && (
            <p className="text-sm tabular-nums text-muted-foreground">
              {confirmedToday.toLocaleString("pt-BR")}/{goal}
            </p>
          )}
        </div>
        {metricsQuery.isLoading ? (
          <Skeleton className="h-4 w-full" />
        ) : (
          <Progress value={progress} className="h-4" indicatorClassName={indicatorClassName} />
        )}
      </div>

      {/* Lista de pedidos */}
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Pedidos atribuídos a você</CardTitle>
            <p className="text-sm tabular-nums text-muted-foreground">
              {filtered.length === orders.length
                ? `${orders.length} pedido(s)`
                : `${filtered.length} de ${orders.length} pedido(s)`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => {
              const count =
                f.value === "all" ? orders.length : orders.filter((o) => o.agent_status === f.value).length;
              return (
                <Button
                  key={f.value}
                  size="sm"
                  variant={statusFilter === f.value ? "default" : "outline"}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                  <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[280px]">
                <SelectValue placeholder="Motivo do On Hold" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os motivos</SelectItem>
                {reasonOptions.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label} ({r.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={pendingFilter} onValueChange={(v) => setPendingFilter(v as PendingFilter)}>
              <SelectTrigger className="h-9 w-full sm:w-[280px]">
                <SelectValue placeholder="Pendência" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as pendências</SelectItem>
                <SelectItem value="any">
                  Com pendência ({pendingCounts.get("any") ?? 0})
                </SelectItem>
                <SelectItem value="none">
                  Sem pendência ({pendingCounts.get("none") ?? 0})
                </SelectItem>
                {HELD_ORDER_PENDING_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {HELD_ORDER_PENDING_TAG_LABEL[tag]} ({pendingCounts.get(tag) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasExtraFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReasonFilter("all");
                  setPendingFilter("all");
                }}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Limpar filtros
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {ordersQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : ordersQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <AlertCircle className="h-6 w-6" />
              <p>Não foi possível carregar os pedidos.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-status-success" />
              <p>{orders.length === 0 ? "Nenhum pedido atribuído a você." : "Nenhum pedido neste filtro."}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(({ order: o, reasons, address, items }) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelected(o)}
                  className="w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  {/* Linha 1 — o que identifica o pedido, em destaque */}
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="font-mono text-xl font-medium leading-none tracking-tight">
                        {o.order_number ?? "Sem número"}
                      </span>
                      <Badge variant="secondary">
                        {o.dyna_code === RETURNS_DYNA_CODE ? "Devolução" : o.dyna_code}
                      </Badge>
                      {o.rma && <span className="text-xs text-muted-foreground">RMA: {o.rma}</span>}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {o.pending_tag && (
                        <Badge variant="destructive" className="gap-1">
                          <Flag className="h-3 w-3" />
                          {HELD_ORDER_PENDING_TAG_LABEL[o.pending_tag]}
                        </Badge>
                      )}
                      <Badge variant={STATUS_BADGE[o.agent_status]}>
                        {HELD_ORDER_AGENT_STATUS_LABEL[o.agent_status]}
                      </Badge>
                    </div>
                  </div>

                  {/* Linha 2 — motivos do On Hold + idade */}
                  {(reasons.length > 0 || o.age) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {reasons.map((r) => (
                        <Badge
                          key={r.key}
                          variant="outline"
                          className="border-amber-500/40 font-medium text-amber-600 dark:text-amber-400"
                        >
                          {r.label}
                        </Badge>
                      ))}
                      {o.age && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" /> {o.age}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Linha 3 — produto e endereço lado a lado, cada um em seu bloco */}
                  {(items.length > 0 || address.oneLine) && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {items.length > 0 && (
                        <section className="rounded-md border bg-muted/30 p-2.5">
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            <Package className="h-3.5 w-3.5" />
                            Produtos
                            <span className="font-normal normal-case tracking-normal">
                              ({items.length} item(ns) · {totalUnits(items)} un.)
                            </span>
                          </p>
                          <ul className="space-y-1">
                            {items.map((item, idx) => (
                              <li key={`${item.sku}-${idx}`} className="flex items-baseline gap-2 text-sm">
                                <span className="min-w-[2.25rem] shrink-0 rounded bg-primary/10 px-1.5 text-center font-medium tabular-nums text-primary">
                                  {item.qty}×
                                </span>
                                <span className="min-w-0">
                                  <span className="font-medium">{item.product}</span>
                                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                                    {item.sku}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      {address.oneLine && (
                        <section className="rounded-md border bg-muted/30 p-2.5">
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                    </div>
                  )}

                  {/* Linha 4 — cliente (contexto, não é o dado principal) */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{o.customer_name ?? "—"}</span>
                      {o.email && <span className="text-muted-foreground"> · {o.email}</span>}
                    </span>
                    {o.event_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        {o.event_count}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <HeldOrderTrackingDialog
        order={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
