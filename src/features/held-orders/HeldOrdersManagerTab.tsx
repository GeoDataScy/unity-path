import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CopyX,
  Inbox,
  ListChecks,
  Loader2,
  PackageSearch,
  Search,
  Send,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useManagerUsersQuery } from "@/features/dashboard/useManagerUsersQuery";
import { useManagerHeldOrdersQuery } from "./useManagerHeldOrdersQuery";
import { ImportHeldOrdersDialog } from "./ImportHeldOrdersDialog";
import { AssignHeldOrdersDialog } from "./AssignHeldOrdersDialog";
import { RETURNS_DYNA_CODE } from "./parseHeldOrdersCsv";
import type { ManagerHeldOrder, ManagerHeldOrderStatusFilter } from "./types";

function formatDate(value: string | null): string {
  if (!value) return "—";
  // order_date vem como YYYY-MM-DD.
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/** O agente já começou a tratar o pedido (e ainda não concluiu). */
function isInProgress(o: ManagerHeldOrder): boolean {
  return o.agent_status === "em_andamento" && o.status !== "confirmed";
}

// Badge de status na visão do manager:
//   concluído            -> "Confirmado"
//   em atendimento       -> "Em andamento" (agent_status = 'em_andamento')
//   nunca distribuído    -> "Novo"         (assign_count = 0)
//   distribuído N vezes  -> "Pendente N"   (assign_count >= 1, sem início)
function statusBadge(o: ManagerHeldOrder) {
  if (o.agent_status === "concluido" || o.status === "confirmed") {
    return <Badge variant="success">Confirmado</Badge>;
  }
  if (isInProgress(o)) {
    return <Badge variant="in-progress">Em andamento</Badge>;
  }
  if ((o.assign_count ?? 0) === 0) {
    return (
      <Badge variant="outline" className="text-sky-600 dark:text-sky-400">
        Novo
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
      Pendente {o.assign_count}
    </Badge>
  );
}

export function HeldOrdersManagerTab() {
  const [statusFilter, setStatusFilter] = useState<ManagerHeldOrderStatusFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [batchQty, setBatchQty] = useState<string>("10");
  const [importOpen, setImportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const usersQuery = useManagerUsersQuery();
  const ordersQuery = useManagerHeldOrdersQuery({
    statusFilter,
    // "unassigned" não é expresso pelo RPC (que filtra por agent_id específico);
    // busca tudo e filtra no cliente abaixo.
    agentId: agentFilter === "all" || agentFilter === "unassigned" ? null : agentFilter,
  });

  const result = ordersQuery.data;
  const allRows = useMemo(() => result?.rows ?? [], [result]);
  const summary = result?.summary_by_agent ?? [];

  // Linhas repetidas do mesmo pedido (dados anteriores a 05/08/2026, já
  // consolidados no banco): ficam fora das contagens e da tabela por padrão, mas
  // seguem inspecionáveis — nada foi apagado.
  const realRows = useMemo(() => allRows.filter((o) => !o.duplicate_of), [allRows]);
  const duplicateCount = allRows.length - realRows.length;

  // Filtro "não atribuído" e busca textual são aplicados no cliente (o RPC já
  // filtrou status e agente específico).
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (showDuplicates ? allRows : realRows).filter((o) => {
      if (agentFilter === "unassigned" && o.assigned_to) return false;
      if (!term) return true;
      const hay = `${o.order_number ?? ""} ${o.dyna_code} ${o.email ?? ""} ${o.customer_name ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [allRows, realRows, showDuplicates, agentFilter, search]);

  // "Aguardando" e "Em andamento" particionam os pendentes: aguardando = ninguém
  // começou; em andamento = agente já registrou atendimento.
  const totals = useMemo(() => {
    const inProgress = realRows.filter(isInProgress).length;
    const waiting = realRows.filter((o) => o.status === "pending" && !isInProgress(o)).length;
    const confirmed = realRows.filter((o) => o.status === "confirmed").length;
    const unassigned = realRows.filter((o) => !o.assigned_to).length;
    return { total: realRows.length, waiting, inProgress, confirmed, unassigned };
  }, [realRows]);

  // Só pedidos pendentes podem ser selecionados para distribuir — e nunca uma
  // linha repetida (o RPC também a recusaria).
  const selectablePendingIds = useMemo(
    () => rows.filter((o) => o.status === "pending" && !o.duplicate_of).map((o) => o.id),
    [rows],
  );
  const allSelected = selectablePendingIds.length > 0 && selectablePendingIds.every((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (selectablePendingIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectablePendingIds);
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Seleção em lote: marca os primeiros N pendentes da tabela filtrada (na ordem
  // exibida). "all" marca todos os pendentes filtrados.
  const selectFirstN = () => {
    const n = batchQty === "all" ? selectablePendingIds.length : Number(batchQty);
    setSelected(new Set(selectablePendingIds.slice(0, n)));
  };

  const clearSelection = () => setSelected(new Set());

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  // A distribuição agrupa por CLIENTE (mesma regra do banco: e-mail; sem e-mail, o
  // nome; sem nome, a própria linha), então a prévia do rateio conta clientes.
  const selectedClientCount = useMemo(() => {
    const keys = new Set<string>();
    for (const o of allRows) {
      if (!selected.has(o.id)) continue;
      const email = o.email?.trim().toLowerCase();
      const name = o.customer_name?.trim().toLowerCase();
      keys.add(email || (name ? `nome:${name}` : `linha:${o.id}`));
    }
    return keys.size;
  }, [allRows, selected]);

  return (
    <div className="space-y-6">
      {/* Resumo */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <PackageSearch className="h-4 w-4 text-primary" /> Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ordersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold">{totals.total}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4 text-amber-500" /> Aguardando
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ordersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold">{totals.waiting}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Loader2 className="h-4 w-4 text-status-in-progress" /> Em andamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ordersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold">{totals.inProgress}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Confirmados
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ordersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold">{totals.confirmed}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Inbox className="h-4 w-4 text-muted-foreground" /> Sem agente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ordersQuery.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold">{totals.unassigned}</div>}
          </CardContent>
        </Card>
      </section>

      {/* Resumo por agente */}
      {summary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Por agente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {summary.map((s) => (
                <div key={s.agent_id} className="rounded-md border px-3 py-1.5 text-sm">
                  <span className="font-medium">{s.full_name ?? "Sem nome"}</span>{" "}
                  <span className="text-amber-600 dark:text-amber-400 tabular-nums">{s.pending} pend.</span>{" "}
                  <span className="text-status-in-progress tabular-nums">{s.in_progress ?? 0} em and.</span>{" "}
                  <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{s.confirmed} conf.</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Pedidos em espera</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar pedido, e-mail, loja..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-60 pl-8"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as ManagerHeldOrderStatusFilter)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="aguardando">Aguardando</SelectItem>
                  <SelectItem value="em_andamento">Em andamento</SelectItem>
                  <SelectItem value="confirmed">Confirmados</SelectItem>
                </SelectContent>
              </Select>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos agentes</SelectItem>
                  <SelectItem value="unassigned">Sem agente</SelectItem>
                  {(usersQuery.data ?? [])
                    .filter((u) => u.role === "agent")
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {duplicateCount > 0 && (
                <Button
                  variant={showDuplicates ? "secondary" : "ghost"}
                  onClick={() => setShowDuplicates((v) => !v)}
                  title="Linhas repetidas do mesmo pedido, consolidadas e fora da caixa do agente"
                >
                  <CopyX className="mr-1.5 h-4 w-4" />
                  {showDuplicates ? "Ocultar" : "Ver"} repetidos ({duplicateCount})
                </Button>
              )}
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1.5 h-4 w-4" /> Importar arquivo
              </Button>
              <Button onClick={() => setAssignOpen(true)} disabled={selectedIds.length === 0}>
                <Send className="mr-1.5 h-4 w-4" /> Distribuir{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Seleção em lote por quantidade */}
          {selectablePendingIds.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Selecionar as primeiras</span>
              <Select value={batchQty} onValueChange={setBatchQty}>
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="15">15</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="30">30</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="secondary" size="sm" onClick={selectFirstN}>
                Selecionar
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectablePendingIds.length} pendente(s) na lista
              </span>
              {selectedIds.length > 0 && (
                <>
                  <span className="ml-auto text-sm font-medium text-foreground">
                    {selectedIds.length} selecionado(s)
                  </span>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    Limpar
                  </Button>
                </>
              )}
            </div>
          )}
          {ordersQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : ordersQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <AlertCircle className="h-6 w-6" />
              <p>Não foi possível carregar os pedidos.</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">Nenhum pedido encontrado.</div>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Selecionar todos pendentes"
                        disabled={selectablePendingIds.length === 0}
                      />
                    </TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o: ManagerHeldOrder) => {
                    const isDuplicate = Boolean(o.duplicate_of);
                    const isPending = o.status === "pending" && !isDuplicate;
                    return (
                      <TableRow key={o.id} className={isDuplicate ? "opacity-60" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(o.id)}
                            onCheckedChange={() => toggleOne(o.id)}
                            disabled={!isPending}
                            aria-label={`Selecionar pedido ${o.order_number}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {o.order_number ?? <span className="text-muted-foreground italic">sem número</span>}
                          {o.rma && (
                            <span className="block text-xs text-muted-foreground">RMA: {o.rma}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {o.dyna_code === RETURNS_DYNA_CODE ? "Devolução" : o.dyna_code}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground" title={o.reason ?? ""}>
                          {o.reason ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm">{o.customer_name ?? "—"}</span>
                            {o.email && <span className="text-xs text-muted-foreground">{o.email}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{formatDate(o.order_date)}</TableCell>
                        <TableCell className="text-sm">
                          {o.assigned_to_name ?? <span className="text-muted-foreground italic">sem agente</span>}
                        </TableCell>
                        <TableCell>
                          {isDuplicate ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              Repetido
                            </Badge>
                          ) : (
                            statusBadge(o)
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ImportHeldOrdersDialog open={importOpen} onOpenChange={setImportOpen} />
      <AssignHeldOrdersDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        orderIds={selectedIds}
        clientCount={selectedClientCount}
        agents={usersQuery.data ?? []}
        onAssigned={() => setSelected(new Set())}
      />
    </div>
  );
}
