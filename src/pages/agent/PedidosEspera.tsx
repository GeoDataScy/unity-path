import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertCircle, CheckCircle2, Flag, MessageSquare, RotateCcw, Search, UserX } from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { usePanelPagination } from "@/features/support-base/usePanelPagination";
import { PanelPagination } from "@/features/support-base/components/PanelPagination";
import { useMyHeldOrdersMetricsQuery, useMyHeldOrdersQuery } from "@/features/held-orders/useMyHeldOrdersQuery";
import { HeldOrderTrackingDialog } from "@/features/held-orders/HeldOrderTrackingDialog";
import { heldOrderStoreLabel, parseAddress, parseItems, parseReasons } from "@/features/held-orders/format";
import { formatHeldOrderAge, formatHeldOrderDate, formatHeldOrderDateTime } from "@/features/held-orders/dates";
import {
  HELD_ORDER_PENDING_TAG_LABEL,
  HELD_ORDER_PENDING_TAGS,
  type HeldOrderAgentStatus,
  type HeldOrderPendingTag,
  type MyHeldOrder,
} from "@/features/held-orders/types";

/** Concluídos que a tela carrega: os últimos 30 dias (o histórico fica com a gestão). */
const CONCLUDED_DAYS = 30;

// Cards são compactos, mas 10 por página ainda enchem a tela.
const PAGE_SIZE_OPTIONS = [10, 20, 50];

type Tab = "fazer" | "novo" | "em_andamento" | "inativo" | "concluido";

const TABS: { value: Tab; label: string }[] = [
  { value: "fazer", label: "Para fazer" },
  { value: "novo", label: "Novos" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "inativo", label: "Inativos" },
  { value: "concluido", label: "Concluídos" },
];

function inTab(status: HeldOrderAgentStatus, tab: Tab): boolean {
  if (tab === "fazer") return status === "novo" || status === "em_andamento";
  return status === tab;
}

const STATUS_DOT: Record<HeldOrderAgentStatus, string> = {
  novo: "bg-info",
  em_andamento: "bg-status-in-progress",
  inativo: "bg-warning",
  concluido: "bg-success",
};

const STATUS_LABEL: Record<HeldOrderAgentStatus, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
  inativo: "Inativo",
  concluido: "Concluído",
};

/** "any" = qualquer pendência; "none" = sem pendência. */
type PendingFilter = "all" | "any" | "none" | HeldOrderPendingTag;
type SortOrder = "antigos" | "recentes";

/** Data que ordena a fila: a do pedido (ou da devolução). */
function orderRefDate(o: MyHeldOrder): string {
  return o.order_date ?? o.return_date ?? "";
}

export default function PedidosEspera() {
  const { userId } = useOutletContext<AgentOutletContext>();

  const ordersQuery = useMyHeldOrdersQuery(Boolean(userId), "all", CONCLUDED_DAYS);
  const metricsQuery = useMyHeldOrdersMetricsQuery(Boolean(userId));

  const [tab, setTab] = useState<Tab>("fazer");
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>("all");
  const [sort, setSort] = useState<SortOrder>("antigos");
  const [selected, setSelected] = useState<MyHeldOrder | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const listRef = useRef<HTMLDivElement>(null);

  const allOrders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const metrics = metricsQuery.data;
  const goal = metrics?.goal ?? 30;
  const doneToday = metrics?.confirmed_today ?? 0;
  const remaining = Math.max(0, goal - doneToday);
  const progress = goal > 0 ? Math.min(100, (doneToday / goal) * 100) : 0;
  const progressColor = progress < 60 ? "bg-destructive" : progress < 90 ? "bg-warning" : "bg-success";

  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = { fazer: 0, novo: 0, em_andamento: 0, inativo: 0, concluido: 0 };
    for (const o of allOrders) {
      for (const t of TABS) if (inTab(o.agent_status, t.value)) counts[t.value] += 1;
    }
    return counts;
  }, [allOrders]);

  // Cada pedido da aba já parseado uma vez — reusado pelos filtros e pelos cards.
  const parsed = useMemo(
    () =>
      allOrders
        .filter((o) => inTab(o.agent_status, tab))
        .map((o) => ({ order: o, reasons: parseReasons(o.reason), items: parseItems(o.items), address: parseAddress(o) })),
    [allOrders, tab],
  );

  /** Motivos existentes na aba, com contagem — alimenta o filtro. */
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
      const t = p.order.pending_tag;
      if (t) {
        withTag += 1;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    counts.set("any", withTag);
    counts.set("none", parsed.length - withTag);
    return counts;
  }, [parsed]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = parsed.filter((p) => {
      const o = p.order;
      if (term) {
        const hay = `${o.order_number ?? ""} ${o.customer_name ?? ""} ${o.email ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (reasonFilter !== "all" && !p.reasons.some((r) => r.key === reasonFilter)) return false;
      if (pendingFilter === "any" && !o.pending_tag) return false;
      if (pendingFilter === "none" && o.pending_tag) return false;
      if (!["all", "any", "none"].includes(pendingFilter) && o.pending_tag !== pendingFilter) return false;
      return true;
    });
    // "Mais antigos primeiro" mantém a ordem do banco (novos, pendência, data do
    // pedido); "mais recentes" ordena pela entrada no sistema, do último para trás.
    if (sort === "recentes") {
      return [...list].sort((a, b) => (b.order.imported_at ?? "").localeCompare(a.order.imported_at ?? ""));
    }
    return list;
  }, [parsed, search, reasonFilter, pendingFilter, sort]);

  // Qualquer filtro novo volta para a página 1.
  const pagination = usePanelPagination(
    filtered,
    pageSize,
    [tab, search, reasonFilter, pendingFilter, sort].join("|"),
  );

  // Motivo escolhido que não existe na aba nova: volta para todos.
  useEffect(() => {
    if (reasonFilter !== "all" && !reasonOptions.some((r) => r.key === reasonFilter)) setReasonFilter("all");
  }, [reasonOptions, reasonFilter]);

  // O pager fica no fim da lista: ao trocar de página, volta para o topo dela
  // em vez de deixar o agente no rodapé dos cards novos.
  const isFirstPageRender = useRef(true);
  useEffect(() => {
    if (isFirstPageRender.current) {
      isFirstPageRender.current = false;
      return;
    }
    const el = listRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [pagination.pagina]);

  const hasExtraFilters = search.trim() !== "" || reasonFilter !== "all" || pendingFilter !== "all" || sort !== "antigos";

  /** O pedido voltou para o agente por outra pessoa e ele ainda não registrou nada. */
  function handoffLabel(o: MyHeldOrder): string | null {
    if (!o.last_event_user_id || o.last_event_user_id === userId) return null;
    if (o.agent_status === "concluido" || o.agent_status === "inativo") return null;
    return o.last_event_by_manager ? "Devolvido pela gestão" : "Veio de outro prestador";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Pedidos em Espera</h1>
          <p className="text-sm text-muted-foreground">Clique num pedido para registrar o que foi feito.</p>
        </div>

        {/* Meta de Pedidos em Espera (separada da de Meus Atendimentos) */}
        <section aria-label="Meta de hoje" className="grid w-full gap-1.5 rounded-xl border bg-card px-4 py-3 sm:w-[360px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Meta de hoje</span>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <span>
                <span className="font-mono text-[22px] font-normal leading-none tracking-[-0.03em] tabular-nums">
                  {doneToday.toLocaleString("pt-BR")}
                </span>
                <span className="text-sm text-muted-foreground"> / {goal}</span>
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all", progressColor)} style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-ink-tertiary">
            {doneToday >= goal ? "Meta batida! " : `Faltam ${remaining} · `}inclui concluídos e inativos
          </p>
        </section>
      </header>

      {/* Onde estão os pedidos do agente */}
      <div role="tablist" aria-label="Status dos pedidos" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.value)}
              className={cn(
                "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-2 text-sm transition-colors",
                active ? "border-foreground font-medium text-foreground" : "border-transparent text-ink-secondary hover:text-foreground",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 font-mono text-xs tabular-nums",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary",
                )}
              >
                {ordersQuery.isLoading ? "…" : tabCounts[t.value].toLocaleString("pt-BR")}
              </span>
            </button>
          );
        })}
      </div>
      {tab === "concluido" && (
        <p className="text-xs text-ink-tertiary">Mostrando os concluídos dos últimos {CONCLUDED_DAYS} dias.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="agent-held-orders-search"
            placeholder="Buscar pedido, cliente ou e-mail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {tab !== "inativo" && (
          <>
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="h-10 w-full sm:w-[230px]" aria-label="Motivo do On Hold">
                <SelectValue />
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
              <SelectTrigger className="h-10 w-full sm:w-[230px]" aria-label="Pendência">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as pendências</SelectItem>
                <SelectItem value="any">Com pendência ({pendingCounts.get("any") ?? 0})</SelectItem>
                <SelectItem value="none">Sem pendência ({pendingCounts.get("none") ?? 0})</SelectItem>
                {HELD_ORDER_PENDING_TAGS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {HELD_ORDER_PENDING_TAG_LABEL[t]} ({pendingCounts.get(t) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={(v) => setSort(v as SortOrder)}>
              <SelectTrigger className="h-10 w-full sm:w-[220px]" aria-label="Ordem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="antigos">Mais antigos primeiro</SelectItem>
                <SelectItem value="recentes">Entraram por último</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        {hasExtraFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setReasonFilter("all");
              setPendingFilter("all");
              setSort("antigos");
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Limpar filtros
          </Button>
        )}
      </div>

      <div ref={listRef} className="scroll-mt-4">
        {ordersQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : ordersQuery.isError ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <AlertCircle className="h-6 w-6" />
            <p>Não foi possível carregar os pedidos.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            {tab === "inativo" ? <UserX className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8 text-success" />}
            <p>
              {allOrders.length === 0
                ? "Nenhum pedido atribuído a você."
                : parsed.length === 0
                  ? tab === "fazer"
                    ? "Nenhum pedido na sua fila."
                    : "Nenhum pedido nesta aba."
                  : "Nenhum pedido com estes filtros."}
            </p>
          </div>
        ) : tab === "inativo" ? (
          // Inativos: clientes que não responderam. Fora da fila; reabrir pelo diálogo.
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Marcado inativo em</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="pr-6 text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.visiveis.map(({ order: o }) => (
                    <TableRow key={o.id}>
                      <TableCell className="pl-6 font-mono font-medium">{o.order_number ?? "Sem número"}</TableCell>
                      <TableCell className="text-sm">
                        <div>{o.customer_name ?? "—"}</div>
                        {o.email && <div className="text-xs text-muted-foreground">{o.email}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">
                        {formatHeldOrderDateTime(o.status_changed_at)}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">{o.last_note || "—"}</TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(o)}>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reabrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {pagination.visiveis.map(({ order: o, reasons, items, address }) => {
              const handoff = handoffLabel(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelected(o)}
                  className="grid w-full gap-2.5 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-line-strong hover:bg-muted/40"
                >
                  {/* Identificação + estado */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                      <span className="font-mono text-lg font-medium leading-none tracking-tight">
                        {o.order_number ?? "Sem número"}
                      </span>
                      <span className="rounded-md bg-muted px-1.5 text-xs text-ink-tertiary">
                        {heldOrderStoreLabel(o.dyna_code)}
                      </span>
                      {o.rma && <span className="text-xs text-muted-foreground">RMA {o.rma}</span>}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {handoff && (
                        <span className="rounded-md bg-info/10 px-1.5 text-xs font-medium text-info">{handoff}</span>
                      )}
                      {o.pending_tag && (
                        <Badge variant="destructive" className="gap-1">
                          <Flag className="h-3 w-3" />
                          {HELD_ORDER_PENDING_TAG_LABEL[o.pending_tag]}
                        </Badge>
                      )}
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[o.agent_status])} />
                        {STATUS_LABEL[o.agent_status]}
                      </span>
                    </div>
                  </div>

                  {/* Cliente + motivos */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{o.customer_name ?? "—"}</span>
                      {o.email && <span className="text-muted-foreground"> · {o.email}</span>}
                    </span>
                    {reasons.map((r) => (
                      <span key={r.key} className="rounded-md bg-warning/10 px-1.5 text-xs text-warning">
                        {r.label}
                      </span>
                    ))}
                  </div>

                  {/* Datas, cada uma com o nome escrito */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-tertiary">
                    {o.order_date || !o.return_date ? (
                      <span>
                        Data do pedido{" "}
                        <b className="font-mono font-medium tabular-nums text-foreground">{formatHeldOrderDate(o.order_date)}</b>
                      </span>
                    ) : null}
                    {o.return_date && (
                      <span>
                        Data da devolução{" "}
                        <b className="font-mono font-medium tabular-nums text-foreground">{formatHeldOrderDate(o.return_date)}</b>
                      </span>
                    )}
                    <span>
                      Entrada no sistema{" "}
                      <b className="font-mono font-medium tabular-nums text-foreground">{formatHeldOrderDate(o.imported_at)}</b>
                    </span>
                    <span>
                      Última mudança{" "}
                      <b className="font-mono font-medium tabular-nums text-foreground">
                        {formatHeldOrderDateTime(o.status_changed_at)}
                      </b>
                    </span>
                    {o.age && (
                      <span>
                        Idade no arquivo{" "}
                        <b className="font-mono font-medium tabular-nums text-foreground">{formatHeldOrderAge(o.age)}</b>
                      </span>
                    )}
                  </div>

                  {/* Produtos e endereço numa linha; o completo fica no diálogo */}
                  {(items.length > 0 || address.oneLine) && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2.5 text-xs text-ink-secondary">
                      {items.length > 0 && (
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {items.map((it, idx) => (
                            <span key={`${it.sku}-${idx}`}>
                              <span className="mr-1 rounded bg-primary/10 px-1 font-mono font-medium text-primary">{it.qty}×</span>
                              {it.product}
                            </span>
                          ))}
                        </span>
                      )}
                      {address.oneLine && <span className="min-w-0 truncate text-ink-tertiary">{address.oneLine}</span>}
                      {o.event_count > 0 && (
                        <span className="ml-auto inline-flex items-center gap-1 text-ink-tertiary">
                          <MessageSquare className="h-3 w-3" />
                          {o.event_count}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!ordersQuery.isLoading && !ordersQuery.isError && filtered.length > 0 && (
          <div className="mt-4">
            <PanelPagination
              estado={pagination}
              rotulo={["pedido", "pedidos"]}
              porPagina={pageSize}
              onPorPaginaChange={setPageSize}
              opcoesPorPagina={PAGE_SIZE_OPTIONS}
            />
          </div>
        )}
      </div>

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
