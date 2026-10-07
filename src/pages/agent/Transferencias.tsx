import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Inbox, PlayCircle, Send, Shield } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { encaminhadoPor } from "@/features/transfers/encaminhadoPor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentOutletContext } from "@/layouts/AgentLayout";
import {
  useTransferHistoryQuery,
  type TransferHistoryItem,
} from "@/features/transfers/useTransferHistoryQuery";
import { StatusTrackingDialog } from "@/features/services/StatusTrackingDialog";
import { useStatusTracking } from "@/features/services/useStatusTracking";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: TransferHistoryItem["transfer_status"]) {
  const map: Record<TransferHistoryItem["transfer_status"], { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "bg-warning-soft text-warning" },
    accepted: { label: "Aceito", cls: "bg-signal-soft text-success" },
    declined: { label: "Recusado", cls: "bg-coral-soft text-destructive" },
    cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
  };
  const cfg = map[status];
  return (
    <Badge variant="outline" className={cfg.cls}>
      {cfg.label}
    </Badge>
  );
}

type DialogTarget = {
  service_id: string;
  client_email: string;
  service_date: string;
  service_status: string;
  has_tracking_code: boolean;
};

export default function Transferencias() {
  const { userId } = useOutletContext<AgentOutletContext>();
  const { data: history = [], isLoading } = useTransferHistoryQuery(Boolean(userId));
  const { getCurrentStatus } = useStatusTracking();

  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);

  // Tickets que o agente recebeu via transferência aceita E que ainda estão abertos.
  // Status efetivo considera o último follow-up (não só services.status), via useStatusTracking.
  const toResolve = useMemo(() => {
    // Pode haver múltiplas transferências para o mesmo service_id ao longo do tempo
    // (peer-to-peer + reassign do gestor depois, por exemplo). Mantemos só a mais
    // recente por service_id para não duplicar linhas na fila operacional.
    const latestByService = new Map<string, TransferHistoryItem>();
    for (const t of history) {
      if (t.role !== "received") continue;
      if (t.transfer_status !== "accepted") continue;
      const status = getCurrentStatus(t.service_id, t.service_status);
      if (status.variant === "done") continue;
      const existing = latestByService.get(t.service_id);
      if (!existing || new Date(t.created_at) > new Date(existing.created_at)) {
        latestByService.set(t.service_id, t);
      }
    }
    return Array.from(latestByService.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [history, getCurrentStatus]);

  // Histórico (aba consulta): tudo, com filtros.
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "sent" | "received">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | TransferHistoryItem["transfer_status"]>(
    "all",
  );

  const filteredHistory = useMemo(() => {
    let result = history;
    if (roleFilter !== "all") {
      result = result.filter((t) => t.role === roleFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => t.transfer_status === statusFilter);
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.client_email.toLowerCase().includes(term) ||
          (t.other_agent_name ?? "").toLowerCase().includes(term),
      );
    }
    return result;
  }, [history, roleFilter, statusFilter, search]);

  const stats = useMemo(() => {
    return {
      sent: history.filter((t) => t.role === "sent").length,
      received: history.filter((t) => t.role === "received").length,
      toResolve: toResolve.length,
    };
  }, [history, toResolve]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Transferências</h1>
        <p className="text-sm text-muted-foreground">
          Tickets que você recebeu e o histórico completo de encaminhamentos.
        </p>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="A resolver" value={stats.toResolve} icon={<Inbox className="h-4 w-4" />} highlight={stats.toResolve > 0} />
        <StatCard label="Recebidos" value={stats.received} icon={<ArrowDownLeft className="h-4 w-4" />} />
        <StatCard label="Enviados" value={stats.sent} icon={<Send className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="to-resolve" className="space-y-4">
        <TabsList>
          <TabsTrigger value="to-resolve">
            A resolver
            {stats.toResolve > 0 && (
              <Badge variant="secondary" className="ml-2 font-mono tabular-nums">
                {stats.toResolve}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="to-resolve" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tickets recebidos para você atender</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recebido em</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Encaminhado por</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && toResolve.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                          Nenhum ticket pendente para resolver. Tudo em dia. 🎉
                        </TableCell>
                      </TableRow>
                    )}
                    {toResolve.map((t) => {
                      const fromManager = Boolean(t.assigned_by_manager_id);
                      return (
                        <TableRow key={t.transfer_id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDateTime(t.created_at)}
                          </TableCell>
                          <TableCell className="break-all text-sm font-medium">
                            {t.client_email}
                          </TableCell>
                          <TableCell className="text-sm">{t.product}</TableCell>
                          <TableCell className="text-sm">
                            {fromManager ? (
                              <Badge variant="outline" className="gap-1 bg-ice-soft text-info">
                                <Shield className="h-3 w-3" />
                                {encaminhadoPor(t)}
                              </Badge>
                            ) : (
                              encaminhadoPor(t)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() =>
                                setDialogTarget({
                                  service_id: t.service_id,
                                  client_email: t.client_email,
                                  service_date: t.service_date,
                                  service_status: t.service_status,
                                  has_tracking_code: t.has_tracking_code,
                                })
                              }
                            >
                              <PlayCircle className="mr-1.5 h-4 w-4" />
                              Acompanhar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Histórico completo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
                <div className="grid flex-1 gap-1">
                  <label className="text-xs text-muted-foreground">Buscar</label>
                  <Input
                    placeholder="E-mail do cliente ou nome do prestador"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">Tipo</label>
                  <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="sent">Eu enviei</SelectItem>
                      <SelectItem value="received">Recebidos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">Status</label>
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="accepted">Aceito</SelectItem>
                      <SelectItem value="declined">Recusado</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(search || roleFilter !== "all" || statusFilter !== "all") && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSearch("");
                      setRoleFilter("all");
                      setStatusFilter("all");
                    }}
                  >
                    Limpar
                  </Button>
                )}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Com</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Mensagem / Resposta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && filteredHistory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                          Nenhuma transferência encontrada.
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredHistory.map((t) => (
                      <TableRow key={t.transfer_id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDateTime(t.created_at)}
                        </TableCell>
                        <TableCell>
                          {t.role === "sent" ? (
                            <Badge variant="outline" className="gap-1">
                              <ArrowUpRight className="h-3 w-3" />
                              Enviado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <ArrowDownLeft className="h-3 w-3" />
                              Recebido
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="break-all text-sm">{t.client_email}</TableCell>
                        <TableCell className="text-sm">{t.product}</TableCell>
                        <TableCell className="text-sm">{t.other_agent_name ?? "—"}</TableCell>
                        <TableCell>{statusBadge(t.transfer_status)}</TableCell>
                        <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                          {t.message && (
                            <p className="truncate" title={t.message}>
                              <span className="font-medium">Msg:</span> {t.message}
                            </p>
                          )}
                          {t.response_note && (
                            <p className="truncate" title={t.response_note}>
                              <span className="font-medium">Resp:</span> {t.response_note}
                            </p>
                          )}
                          {!t.message && !t.response_note && <span>—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {dialogTarget && (
        <StatusTrackingDialog
          serviceId={dialogTarget.service_id}
          clientEmail={dialogTarget.client_email}
          serviceDate={dialogTarget.service_date}
          serviceStatus={dialogTarget.service_status}
          hasTrackingCode={dialogTarget.has_tracking_code}
          open={Boolean(dialogTarget)}
          onOpenChange={(open) => {
            if (!open) setDialogTarget(null);
          }}
        />
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : undefined}>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-mono text-2xl font-normal tracking-[-0.03em] tabular-nums">{value}</p>
        </div>
        <div className="rounded-md bg-muted/40 p-2 text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}
