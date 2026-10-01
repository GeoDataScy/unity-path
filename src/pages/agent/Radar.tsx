// Radar — a tela do agente para clientes com ação pendente.
//
// A ordem da lista vem do banco (mais atrasado primeiro, fechados no fim) e os
// contadores dos cartões vêm somados de lá também — nada de métrica calculada no
// cliente. Aqui só há recorte: cartão clicado, tipo, status e busca textual.

import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Download,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Radar as RadarIcon,
  Search,
  Trash2,
} from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import { RadarActionDialog } from "@/features/radar/RadarActionDialog";
import { RadarItemDialog } from "@/features/radar/RadarItemDialog";
import { exportRadar } from "@/features/radar/exportRadar";
import { dueLabel, formatBrDate } from "@/features/radar/nextFollowUp";
import { useDeleteRadarItemMutation, useMyRadarQuery } from "@/features/radar/useMyRadarQuery";
import {
  RADAR_KINDS,
  RADAR_STATUSES,
  getRadarKind,
  getRadarStatus,
  isRadarStatusOpen,
  radarKindLabel,
  radarStatusLabel,
  type MyRadarItem,
} from "@/features/radar/types";

/** Recorte por prazo — é o cartão clicado no topo. */
type Bucket = "overdue" | "today" | "week" | "open" | "closed" | "all";

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "Atrasados",
  today: "Para hoje",
  week: "Próximos 7 dias",
  open: "Todos em aberto",
  closed: "Fechados (30 dias)",
  all: "Todos",
};

// Referência estável para a lista vazia: `?? []` criaria um array novo a cada
// render e o useMemo do filtro nunca reaproveitaria o resultado.
const EMPTY_ITEMS: MyRadarItem[] = [];

function matchesBucket(item: MyRadarItem, bucket: Bucket): boolean {
  const open = isRadarStatusOpen(item.status);
  switch (bucket) {
    case "overdue":
      return open && item.is_overdue;
    case "today":
      return open && item.is_due_today;
    case "week":
      // Cartão "próximos 7 dias" é o que ainda não venceu — atrasado e hoje têm
      // cartão próprio, e somá-los aqui faria os três números se sobreporem.
      return open && item.days_overdue !== null && item.days_overdue < 0 && item.days_overdue >= -7;
    case "open":
      return open;
    case "closed":
      return !open;
    case "all":
      return true;
  }
}

export default function Radar() {
  const { userId, fullName } = useOutletContext<AgentOutletContext>();
  const { toast } = useToast();

  const radarQuery = useMyRadarQuery(Boolean(userId));
  const deleteMutation = useDeleteRadarItemMutation();

  const [bucket, setBucket] = useState<Bucket>("open");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MyRadarItem | null>(null);
  const [actionItem, setActionItem] = useState<MyRadarItem | null>(null);
  const [deleting, setDeleting] = useState<MyRadarItem | null>(null);

  const today = radarQuery.data?.today ?? "";
  const items = radarQuery.data?.items ?? EMPTY_ITEMS;
  const summary = radarQuery.data?.summary;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((i) => {
      if (!matchesBucket(i, bucket)) return false;
      if (kindFilter !== "all" && i.kind !== kindFilter) return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (term === "") return true;
      return [i.client_email, i.order_number, i.product, i.action_needed, i.notes]
        .some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [items, bucket, kindFilter, statusFilter, search]);

  const openNew = () => {
    setEditing(null);
    setItemDialogOpen(true);
  };

  const openEdit = (item: MyRadarItem) => {
    setEditing(item);
    setItemDialogOpen(true);
  };

  const handleExport = () => {
    const count = exportRadar({
      rows: filtered,
      today,
      agentName: fullName ?? "",
      filters: {
        bucket: BUCKET_LABEL[bucket],
        kind: kindFilter === "all" ? "Todos os tipos" : radarKindLabel(kindFilter),
        status: statusFilter === "all" ? "Todos os status" : radarStatusLabel(statusFilter),
        search,
      },
    });
    toast({
      title: "Planilha gerada",
      description: `${count} ${count === 1 ? "caso" : "casos"} exportado${count === 1 ? "" : "s"}.`,
    });
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast({ title: "Caso excluído", description: "O caso e o histórico dele foram removidos." });
      setDeleting(null);
    } catch (e) {
      toast({
        title: "Erro ao excluir",
        description: supabaseErrorMessage(e, "Não foi possível excluir o caso."),
        variant: "destructive",
      });
    }
  };

  const cards: { bucket: Bucket; title: string; value: number; icon: typeof AlertTriangle; tone: string }[] = [
    {
      bucket: "overdue",
      title: "Atrasados",
      value: summary?.overdue ?? 0,
      icon: AlertTriangle,
      tone: "text-destructive",
    },
    {
      bucket: "today",
      title: "Para hoje",
      value: summary?.due_today ?? 0,
      icon: CalendarClock,
      tone: "text-status-open",
    },
    {
      bucket: "week",
      title: "Próximos 7 dias",
      value: summary?.due_week ?? 0,
      icon: CalendarDays,
      tone: "text-primary",
    },
    {
      bucket: "open",
      title: "Em aberto",
      value: summary?.open ?? 0,
      icon: Inbox,
      tone: "text-muted-foreground",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[28px] font-medium leading-[34px] tracking-[-0.025em]">
            <RadarIcon className="h-7 w-7 text-primary" /> Radar
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Todo cliente que depende de uma ação sua entra aqui — devolução, RMA, reenvio, endereço,
            rastreio, On Hold, retorno da logística. Cada caso tem uma data de próximo
            acompanhamento: enquanto não for resolvido, ele não sai do radar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={radarQuery.isLoading}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Novo caso
          </Button>
        </div>
      </header>

      {/* Cartões: clicar troca o recorte da lista. */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo do Radar">
        {cards.map((c) => {
          const Icon = c.icon;
          const active = bucket === c.bucket;
          return (
            <Card
              key={c.bucket}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => setBucket(c.bucket)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setBucket(c.bucket);
                }
              }}
              className={`cursor-pointer transition-colors hover:border-primary/50 ${
                active ? "border-primary ring-1 ring-primary/30" : ""
              }`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
                  {c.title}
                  <Icon className={`h-4 w-4 ${c.tone}`} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {radarQuery.isLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <div className={`text-3xl font-normal font-mono tabular-nums ${c.tone} tracking-[-0.03em]`}>
                    {c.value.toLocaleString("pt-BR")}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Filtros */}
      <section className="mb-4 flex flex-wrap items-center gap-3" aria-label="Filtros">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por e-mail, pedido, produto ou ação..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
          <SelectTrigger className="w-[200px]" aria-label="Prazo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
              <SelectItem key={b} value={b}>
                {BUCKET_LABEL[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Tipo de acompanhamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {RADAR_KINDS.map((k) => (
              <SelectItem key={k.code} value={k.code}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[190px]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {RADAR_STATUSES.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* Lista */}
      <Card>
        <CardContent className="p-0">
          {radarQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : radarQuery.isError ? (
            <p className="p-8 text-center text-sm text-destructive">
              {supabaseErrorMessage(radarQuery.error, "Não foi possível carregar o Radar.")}
            </p>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <RadarIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                {items.length === 0
                  ? "Seu radar está limpo."
                  : "Nenhum caso com os filtros aplicados."}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length === 0
                  ? "Registre o primeiro cliente que depende de uma ação sua."
                  : "Troque o recorte de prazo ou limpe a busca."}
              </p>
              {items.length === 0 && (
                <Button className="mt-4" onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" /> Novo caso
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Prazo</TableHead>
                    <TableHead>Cliente / Pedido</TableHead>
                    <TableHead className="hidden lg:table-cell">Tipo</TableHead>
                    <TableHead className="hidden xl:table-cell">Ação necessária</TableHead>
                    <TableHead className="w-[170px]">Status</TableHead>
                    <TableHead className="w-[52px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => {
                    const kindMeta = getRadarKind(i.kind);
                    const statusMeta = getRadarStatus(i.status);
                    const open = isRadarStatusOpen(i.status);
                    return (
                      <TableRow
                        key={i.id}
                        className="cursor-pointer"
                        onClick={() => setActionItem(i)}
                      >
                        <TableCell className="align-top">
                          {open ? (
                            <>
                              <div
                                className={`text-sm font-medium ${
                                  i.is_overdue
                                    ? "text-destructive"
                                    : i.is_due_today
                                      ? "text-status-open"
                                      : ""
                                }`}
                              >
                                {dueLabel(i.next_follow_up_date, today)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatBrDate(i.next_follow_up_date)}
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Fora do radar</span>
                          )}
                        </TableCell>

                        <TableCell className="align-top">
                          <div className="text-sm font-medium">{i.client_email}</div>
                          <div className="text-xs text-muted-foreground">
                            {i.order_number ? `Pedido ${i.order_number}` : "Sem pedido"}
                            {i.product && ` · ${i.product}`}
                          </div>
                          {/* Em telas estreitas o tipo não tem coluna própria. */}
                          <div className="mt-1 text-xs text-muted-foreground lg:hidden">
                            {radarKindLabel(i.kind)}
                          </div>
                        </TableCell>

                        <TableCell className="hidden align-top lg:table-cell">
                          <span className="inline-flex items-center gap-2 text-sm">
                            {kindMeta && (
                              <span className={`h-2 w-2 shrink-0 rounded-full ${kindMeta.dot}`} />
                            )}
                            {radarKindLabel(i.kind)}
                          </span>
                        </TableCell>

                        <TableCell className="hidden max-w-[320px] align-top xl:table-cell">
                          <p className="truncate text-sm" title={i.action_needed}>
                            {i.action_needed}
                          </p>
                          {i.last_action && (
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={i.last_action}
                            >
                              Última: {i.last_action}
                            </p>
                          )}
                        </TableCell>

                        <TableCell className="align-top">
                          <Badge variant={statusMeta?.variant ?? "secondary"}>
                            {radarStatusLabel(i.status)}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {i.event_count} {i.event_count === 1 ? "registro" : "registros"}
                          </div>
                        </TableCell>

                        <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Ações do caso">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setActionItem(i)}>
                                <RadarIcon className="mr-2 h-4 w-4" /> Registrar ação
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(i)}>
                                <Pencil className="mr-2 h-4 w-4" /> Editar cadastro
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleting(i)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {filtered.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando {filtered.length} de {items.length} casos ·{" "}
          {BUCKET_LABEL[bucket].toLowerCase()}. Casos resolvidos ou cancelados há mais de 30 dias
          saem desta lista.
        </p>
      )}

      <RadarItemDialog open={itemDialogOpen} onOpenChange={setItemDialogOpen} item={editing} />

      <RadarActionDialog
        item={actionItem}
        today={today}
        open={Boolean(actionItem)}
        onOpenChange={(o) => !o && setActionItem(null)}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este caso do Radar?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.client_email}
              {deleting?.order_number ? ` · pedido ${deleting.order_number}` : ""}. O histórico de
              acompanhamento vai junto e não há como recuperar. Se o caso terminou, prefira
              registrar uma ação como "Resolvido" — assim fica o rastro do que foi feito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
