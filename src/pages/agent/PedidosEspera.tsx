import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock, MapPin, Package, PackageSearch } from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useConfirmHeldOrderMutation,
  useMyHeldOrdersMetricsQuery,
  useMyHeldOrdersQuery,
} from "@/features/held-orders/useMyHeldOrdersQuery";
import { RETURNS_DYNA_CODE } from "@/features/held-orders/parseHeldOrdersCsv";
import type { MyHeldOrder } from "@/features/held-orders/types";

function fullAddress(o: MyHeldOrder): string {
  return [o.street1, o.street2, o.street3, o.city, o.state, o.postal_code, o.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export default function PedidosEspera() {
  const { userId } = useOutletContext<AgentOutletContext>();
  const { toast } = useToast();

  const ordersQuery = useMyHeldOrdersQuery(Boolean(userId), "pending");
  const metricsQuery = useMyHeldOrdersMetricsQuery(Boolean(userId));
  const confirmMutation = useConfirmHeldOrderMutation();

  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const orders = ordersQuery.data ?? [];
  const metrics = metricsQuery.data;
  const goal = metrics?.goal ?? 30;
  const confirmedToday = metrics?.confirmed_today ?? 0;
  const remaining = Math.max(0, goal - confirmedToday);

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

  const handleConfirm = async (order: MyHeldOrder) => {
    setConfirmingId(order.id);
    try {
      await confirmMutation.mutateAsync(order.id);
      toast({
        title: "Atendimento confirmado",
        description: `Pedido ${order.order_number} (${order.dyna_code}).`,
      });
    } catch (e) {
      toast({
        title: "Erro ao confirmar",
        description: e instanceof Error ? e.message : "Não foi possível confirmar.",
        variant: "destructive",
      });
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <PackageSearch className="h-7 w-7 text-primary" /> Pedidos em Espera
        </h1>
        <p className="text-sm text-muted-foreground">
          Confirme o atendimento de cada pedido retido atribuído a você. Cada confirmação conta para a sua meta diária.
        </p>
      </header>

      {/* Métricas do dia (meta própria, separada de Meus Atendimentos) */}
      <section className="mb-6 grid gap-4 md:grid-cols-3" aria-label="Métricas do dia">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold">Confirmados hoje</CardTitle>
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
                {(metrics?.pending ?? orders.length).toLocaleString("pt-BR")}
              </div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">Aguardando confirmação</p>
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

      {/* Lista de pedidos pendentes */}
      <Card>
        <CardHeader>
          <CardTitle>Pedidos atribuídos a você</CardTitle>
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
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-status-success" />
              <p>Nenhum pedido pendente. Bom trabalho!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{o.order_number}</span>
                      <Badge variant="secondary">
                        {o.dyna_code === RETURNS_DYNA_CODE ? "Devolução" : o.dyna_code}
                      </Badge>
                      {o.rma && (
                        <span className="text-xs text-muted-foreground">RMA: {o.rma}</span>
                      )}
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
                    {(o.restocked_items || o.damaged_items || o.comments) && (
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {o.restocked_items && <div>Recolocados: {o.restocked_items}</div>}
                        {o.damaged_items && (
                          <div className="text-destructive">Danificados: {o.damaged_items}</div>
                        )}
                        {o.comments && <div>Obs.: {o.comments}</div>}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Button
                      onClick={() => handleConfirm(o)}
                      disabled={confirmMutation.isPending && confirmingId === o.id}
                      className={cn("w-full sm:w-auto")}
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      {confirmMutation.isPending && confirmingId === o.id ? "Confirmando..." : "Confirmar"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
