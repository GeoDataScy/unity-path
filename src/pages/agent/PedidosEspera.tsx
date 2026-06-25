import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock, MapPin, MessageSquare, Package, PackageSearch } from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyHeldOrdersMetricsQuery, useMyHeldOrdersQuery } from "@/features/held-orders/useMyHeldOrdersQuery";
import { HeldOrderTrackingDialog } from "@/features/held-orders/HeldOrderTrackingDialog";
import { RETURNS_DYNA_CODE } from "@/features/held-orders/parseHeldOrdersCsv";
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

type StatusFilter = "all" | HeldOrderAgentStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "novo", label: "Novo" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "concluido", label: "Concluído" },
];

function fullAddress(o: MyHeldOrder): string {
  return [o.street1, o.street2, o.street3, o.city, o.state, o.postal_code, o.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export default function PedidosEspera() {
  const { userId } = useOutletContext<AgentOutletContext>();

  const ordersQuery = useMyHeldOrdersQuery(Boolean(userId), "all");
  const metricsQuery = useMyHeldOrdersMetricsQuery(Boolean(userId));

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<MyHeldOrder | null>(null);

  const orders = ordersQuery.data ?? [];
  const metrics = metricsQuery.data;
  const goal = metrics?.goal ?? 30;
  const confirmedToday = metrics?.confirmed_today ?? 0;
  const remaining = Math.max(0, goal - confirmedToday);

  const filtered = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.agent_status === filter)),
    [orders, filter],
  );

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
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <PackageSearch className="h-7 w-7 text-primary" /> Pedidos em Espera
        </h1>
        <p className="text-sm text-muted-foreground">
          Gerencie cada pedido retido atribuído a você. Clique em um pedido para mudar o status e
          registrar o que foi feito. Concluir um pedido conta para a sua meta diária.
        </p>
      </header>

      {/* Métricas do dia (meta própria, separada de Meus Atendimentos) */}
      <section className="mb-6 grid gap-4 md:grid-cols-3" aria-label="Métricas do dia">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold">Concluídos hoje</CardTitle>
              {!metricsQuery.isLoading && confirmedToday >= goal && <Badge variant="success">🏆 Meta Batida!</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-semibold tabular-nums">{confirmedToday.toLocaleString("pt-BR")}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Faltam para a meta</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-semibold tabular-nums">{remaining.toLocaleString("pt-BR")}</div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">Meta diária: {goal}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <div className="text-4xl font-semibold tabular-nums">
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
        <CardHeader className="gap-3">
          <CardTitle>Pedidos atribuídos a você</CardTitle>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const count = f.value === "all" ? orders.length : orders.filter((o) => o.agent_status === f.value).length;
              return (
                <Button
                  key={f.value}
                  size="sm"
                  variant={filter === f.value ? "default" : "outline"}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {ordersQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
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
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelected(o)}
                  className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">
                        {o.order_number ?? "Sem número"}
                      </span>
                      <Badge variant="secondary">
                        {o.dyna_code === RETURNS_DYNA_CODE ? "Devolução" : o.dyna_code}
                      </Badge>
                      {o.rma && <span className="text-xs text-muted-foreground">RMA: {o.rma}</span>}
                      {o.reason && (
                        <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                          {o.reason}
                        </Badge>
                      )}
                      {o.age && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" /> {o.age}
                        </span>
                      )}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{o.customer_name ?? "—"}</span>
                      {o.email && <span className="text-muted-foreground"> · {o.email}</span>}
                    </div>
                    {fullAddress(o) && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{fullAddress(o)}</span>
                      </div>
                    )}
                    {o.items && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Package className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{o.items}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    <Badge variant={STATUS_BADGE[o.agent_status]}>
                      {HELD_ORDER_AGENT_STATUS_LABEL[o.agent_status]}
                    </Badge>
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
