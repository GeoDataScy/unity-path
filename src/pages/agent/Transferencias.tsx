import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Send } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentOutletContext } from "@/layouts/AgentLayout";
import {
  useTransferHistoryQuery,
  type TransferHistoryItem,
} from "@/features/transfers/useTransferHistoryQuery";

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
    pending: { label: "Pendente", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    accepted: { label: "Aceito", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    declined: { label: "Recusado", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
    cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
  };
  const cfg = map[status];
  return (
    <Badge variant="outline" className={cfg.cls}>
      {cfg.label}
    </Badge>
  );
}

export default function Transferencias() {
  const { userId } = useOutletContext<AgentOutletContext>();
  const { data: history = [], isLoading } = useTransferHistoryQuery(Boolean(userId));

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "sent" | "received">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | TransferHistoryItem["transfer_status"]>(
    "all",
  );

  const filtered = useMemo(() => {
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
      pending: history.filter((t) => t.transfer_status === "pending").length,
    };
  }, [history]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Transferências</h1>
        <p className="text-sm text-muted-foreground">
          Histórico de encaminhamentos de tickets entre você e os outros agentes.
        </p>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Enviados" value={stats.sent} icon={<Send className="h-4 w-4" />} />
        <StatCard label="Recebidos" value={stats.received} icon={<ArrowDownLeft className="h-4 w-4" />} />
        <StatCard label="Pendentes" value={stats.pending} icon={<ArrowUpRight className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lista completa</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
            <div className="grid flex-1 gap-1">
              <label className="text-xs text-muted-foreground">Buscar</label>
              <Input
                placeholder="E-mail do cliente ou nome do agente"
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
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Nenhuma transferência encontrada.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((t) => (
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
    </main>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md bg-muted/40 p-2 text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}
