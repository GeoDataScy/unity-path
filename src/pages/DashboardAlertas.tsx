import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, Mail, Package, RefreshCw, Search, ShoppingBag, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDashboardRefundAlertsQuery } from "@/features/dashboard/useDashboardRefundAlertsQuery";
import type { AgentOverdueGroup, OverdueRefund } from "@/features/dashboard/useDashboardRefundAlertsQuery";
import { useManagerCompleteRefundMutation } from "@/features/dashboard/useManagerCompleteRefundMutation";
import { CompleteRefundDialog } from "@/features/refunds/CompleteRefundDialog";
import type { CompleteRefundValues } from "@/features/refunds/CompleteRefundDialog";
import { SameDayRepeatsSection } from "@/components/dashboard/SameDayRepeatsSection";
import { useToast } from "@/hooks/use-toast";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import type { ManagerOutletContext } from "@/layouts/ManagerLayout";

/** Reembolso selecionado para baixa, junto do agente dono (usado na auditoria). */
type PendingWriteOff = {
  refund: OverdueRefund;
  agentId: string;
  agentName: string;
};

function DelayBadge({ days }: { days: number }) {
  if (days >= 4) {
    return <Badge variant="destructive">{days}d de atraso</Badge>;
  }
  if (days >= 2) {
    return (
      <Badge className="bg-orange-500 hover:bg-orange-600 text-white">
        {days}d de atraso
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-400 hover:bg-amber-500 text-amber-950">
      {days}d de atraso
    </Badge>
  );
}

function AgentCard({
  group,
  onWriteOff,
  writingOffId,
}: {
  group: AgentOverdueGroup;
  onWriteOff: (selection: PendingWriteOff) => void;
  writingOffId: string | null;
}) {
  const severity =
    group.overdue_count >= 5
      ? "border-destructive/60"
      : group.overdue_count >= 3
      ? "border-orange-400/60"
      : "border-amber-400/60";

  return (
    <Card className={`border-2 ${severity}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">{group.agent_name}</CardTitle>
          <Badge variant="destructive" className="text-sm px-3 py-0.5">
            {group.overdue_count} {group.overdue_count === 1 ? "reembolso" : "reembolsos"} em atraso
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail cliente</TableHead>
                <TableHead>Plataforma</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Solicitado em</TableHead>
                <TableHead>Atraso</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.refunds.map((r: OverdueRefund) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{r.customer_email}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {r.sales_platform}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.product ? (
                      <span className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {r.product}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{r.order_id}</span>
                  </TableCell>
                  <TableCell>{r.channel ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {format(parseISO(r.request_date), "dd/MM/yyyy")}
                  </TableCell>
                  <TableCell>
                    <DelayBadge days={r.days_overdue} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={writingOffId === r.id}
                      onClick={() =>
                        onWriteOff({
                          refund: r,
                          agentId: group.agent_id,
                          agentName: group.agent_name,
                        })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {writingOffId === r.id ? "Dando baixa..." : "Dar baixa"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardAlertas() {
  const alertsQuery = useDashboardRefundAlertsQuery();
  const data = alertsQuery.data;
  const isLoading = alertsQuery.isLoading;

  const { toast } = useToast();
  const completeRefund = useManagerCompleteRefundMutation();
  const [writeOff, setWriteOff] = useState<PendingWriteOff | null>(null);

  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("all");

  const worstAgent = data?.by_agent?.[0];

  const agentOptions = useMemo(
    () => data?.by_agent?.map((g) => ({ id: g.agent_id, name: g.agent_name })) ?? [],
    [data?.by_agent]
  );

  const filteredAgents = useMemo(() => {
    const list = data?.by_agent ?? [];
    return list.filter((g) => {
      const matchesSelect = selectedAgent === "all" || g.agent_id === selectedAgent;
      const matchesSearch = g.agent_name.toLowerCase().includes(search.toLowerCase());
      return matchesSelect && matchesSearch;
    });
  }, [data?.by_agent, search, selectedAgent]);

  const hasFilter = search !== "" || selectedAgent !== "all";

  function clearFilters() {
    setSearch("");
    setSelectedAgent("all");
  }

  async function handleWriteOffSubmit(values: CompleteRefundValues) {
    if (!writeOff) return;
    const { refund, agentId, agentName } = writeOff;

    try {
      await completeRefund.mutateAsync({ refundId: refund.id, agentId, values });
      toast({
        title: "Baixa registrada",
        description: `Reembolso de ${refund.customer_email} (${agentName}) concluído.`,
      });
      setWriteOff(null);
    } catch (error: unknown) {
      console.error("[manager-complete-refund] failed:", {
        refund_id: refund.id,
        agent_id: agentId,
        request_date: refund.request_date,
        values,
        error,
        cause: (error as { cause?: unknown })?.cause,
      });
      const message = supabaseErrorMessage(error, "Não foi possível dar baixa no reembolso.");
      toast({ title: "Erro ao dar baixa", description: message, variant: "destructive" });
      throw error;
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/15 p-2.5 mt-0.5">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Alertas</h1>
            <p className="text-sm text-muted-foreground">
              Reembolsos em aberto há mais de 24 horas — atualizado a cada 60s
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => alertsQuery.refetch()}
          disabled={isLoading || alertsQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${alertsQuery.isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-3">
        <Card className={data?.total_overdue ? "border-destructive/40" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total em atraso</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <div className={`text-3xl font-medium ${data?.total_overdue ? "text-destructive" : "text-green-600"}`}>
                {data?.total_overdue ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={data?.agents_affected ? "border-destructive/40" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agentes com atraso</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-12" />
            ) : (
              <div className={`text-3xl font-medium ${data?.agents_affected ? "text-destructive" : "text-green-600"}`}>
                {data?.agents_affected ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={worstAgent ? "border-destructive/40" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Mais crítico</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : worstAgent ? (
              <div>
                <div className="text-lg font-medium text-destructive leading-tight">{worstAgent.agent_name}</div>
                <div className="text-sm text-muted-foreground">{worstAgent.overdue_count} reembolsos</div>
              </div>
            ) : (
              <div className="text-lg font-medium text-green-600">Nenhum</div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Filters */}
      {!isLoading && !!data?.by_agent?.length && (
        <section className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar agente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={selectedAgent} onValueChange={setSelectedAgent}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Todos os agentes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os agentes</SelectItem>
              {agentOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground">
              <X className="h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          )}

          <span className="text-sm text-muted-foreground ml-auto">
            {filteredAgents.length} de {data.by_agent.length} {data.by_agent.length === 1 ? "agente" : "agentes"}
          </span>
        </section>
      )}

      {/* Agent cards */}
      <section className="space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </>
        ) : !data?.by_agent?.length ? (
          <Card>
            <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-lg font-medium text-green-600">Sem alertas</p>
              <p className="text-sm text-muted-foreground">
                Todos os reembolsos estão dentro do prazo de 24 horas.
              </p>
            </CardContent>
          </Card>
        ) : filteredAgents.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-2 text-center">
              <Search className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Nenhum agente encontrado com os filtros aplicados.</p>
              <Button variant="ghost" size="sm" onClick={clearFilters}>Limpar filtros</Button>
            </CardContent>
          </Card>
        ) : (
          filteredAgents.map((group) => (
            <AgentCard
              key={group.agent_id}
              group={group}
              onWriteOff={setWriteOff}
              writingOffId={completeRefund.isPending ? writeOff?.refund.id ?? null : null}
            />
          ))
        )}
      </section>

      {alertsQuery.error && (
        <p className="text-xs text-destructive-foreground/90 bg-destructive/60 rounded-md px-3 py-2">
          {supabaseErrorMessage(alertsQuery.error, "Erro ao carregar alertas.")}
        </p>
      )}

      {writeOff && (
        <CompleteRefundDialog
          open
          title="Dar baixa no reembolso"
          description="Conclui o reembolso em nome do agente. A baixa fica registrada com o seu usuário."
          ownerName={writeOff.agentName}
          refund={{
            customer_email: writeOff.refund.customer_email,
            order_id: writeOff.refund.order_id,
            completion_date: format(new Date(), "yyyy-MM-dd"),
            reason: null,
            refund_type: null,
            refund_value: null,
            items_returned: false,
          }}
          submitting={completeRefund.isPending}
          onOpenChange={(open) => {
            if (!open && !completeRefund.isPending) setWriteOff(null);
          }}
          onSubmit={handleWriteOffSubmit}
        />
      )}
    </div>
  );
}
