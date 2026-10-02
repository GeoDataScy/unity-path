import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, ListChecks, RotateCcw, Search, Send, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { isUsableFilterDate } from "@/lib/filterDate";
import { cn } from "@/lib/utils";
import { useManagerUsersQuery } from "@/features/dashboard/useManagerUsersQuery";
import { PanelPagination } from "@/features/support-base/components/PanelPagination";
import { AssignHeldOrdersDialog } from "@/features/held-orders/AssignHeldOrdersDialog";
import { ImportHeldOrdersDialog } from "@/features/held-orders/ImportHeldOrdersDialog";
import { exportHeldOrders } from "@/features/held-orders/exportHeldOrders";
import { formatHeldOrderDate, formatHeldOrderDateTime, formatSince } from "@/features/held-orders/dates";
import { heldOrderStoreLabel, parseReasons } from "@/features/held-orders/format";
import { HeldOrderDetailSheet } from "@/features/held-orders/board/HeldOrderDetailSheet";
import { HeldOrdersStatusStrip } from "@/features/held-orders/board/HeldOrdersStatusStrip";
import { HeldOrdersTeamTable } from "@/features/held-orders/board/HeldOrdersTeamTable";
import {
  fetchAllHeldOrdersForExport,
  fetchSelectableHeldOrders,
  heldOrderIsOpen,
  HELD_ORDER_BUCKET_DOT,
  HELD_ORDER_BUCKET_LABEL,
  useHeldOrdersBoardPage,
  useHeldOrdersTeam,
  type HeldOrderBucket,
  type HeldOrderDateField,
  type HeldOrdersBoardFilters,
  type HeldOrdersBoardRow,
} from "@/features/held-orders/board/useHeldOrdersBoard";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

type PeriodPreset = "7" | "30" | "90" | "all" | "custom";

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  "7": "Últimos 7 dias",
  "30": "Últimos 30 dias",
  "90": "Últimos 90 dias",
  all: "Todo o período",
  custom: "Personalizado",
};

const DATE_FIELD_LABEL: Record<HeldOrderDateField, string> = {
  entrada: "Entrada no sistema",
  pedido: "Data do pedido",
};

/** Hoje em São Paulo como YYYY-MM-DD, deslocado `days` dias. */
function spDate(days = 0): string {
  const base = new Date(Date.now() + days * 86_400_000);
  return base.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function presetRange(p: PeriodPreset): { from: string | null; to: string | null } {
  if (p === "all" || p === "custom") return { from: null, to: null };
  // "Últimos 30 dias" inclui hoje: hoje e os 29 anteriores.
  return { from: spDate(-(Number(p) - 1)), to: null };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DashboardPedidosEspera() {
  const { toast } = useToast();

  // ── Filtros ─────────────────────────────────────────────────────────────
  // Abre nos últimos 30 dias pela entrada no sistema; a gestora troca quando quiser.
  const [status, setStatus] = useState<HeldOrderBucket | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);
  const [product, setProduct] = useState<string | null>(null);
  const [dateField, setDateField] = useState<HeldOrderDateField>("entrada");
  const [preset, setPreset] = useState<PeriodPreset>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset);
    // Só vai ao banco data completa e plausível (ano parcial do input trava o banco).
    return {
      from: isUsableFilterDate(customFrom) ? customFrom : null,
      to: isUsableFilterDate(customTo) ? customTo : null,
    };
  }, [preset, customFrom, customTo]);

  const filters: HeldOrdersBoardFilters = useMemo(
    () => ({ status, agentId, search, product, dateField, from: range.from, to: range.to }),
    [status, agentId, search, product, dateField, range.from, range.to],
  );
  const filtersKey = JSON.stringify(filters);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // ── Seleção para distribuir: id → cliente ─────────────────────────────
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [batchQty, setBatchQty] = useState("10");

  // Filtro novo: volta para a página 1 e esquece a seleção (ela era de outra lista).
  useEffect(() => {
    setPage(1);
    setSelected(new Map());
  }, [filtersKey, pageSize]);

  const boardQuery = useHeldOrdersBoardPage(filters, page, pageSize);
  const teamQuery = useHeldOrdersTeam();
  const usersQuery = useManagerUsersQuery(true);

  const board = boardQuery.data;
  const rows = board?.rows ?? [];
  const total = board?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A lista encolheu (pedido concluído saiu do filtro): não fica numa página vazia.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Produto escolhido sumiu das opções do filtro atual: volta para todos.
  useEffect(() => {
    if (product && board && !board.products.some((p) => p.code === product)) setProduct(null);
  }, [board, product]);

  const assignableAgents = useMemo(
    () =>
      (usersQuery.data ?? [])
        .filter((u) => u.role === "agent" && u.is_active)
        .map((u) => ({ id: u.id, name: u.full_name ?? u.email }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [usersQuery.data],
  );
  const filterAgents = useMemo(
    () =>
      (teamQuery.data?.agents ?? []).map((a) => ({ id: a.agent_id, name: a.full_name ?? "Sem nome" })),
    [teamQuery.data],
  );
  const agentName = filterAgents.find((a) => a.id === agentId)?.name ?? null;

  // "Atualizado há X" — anda sozinho entre os refetches.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const updatedAt = Math.max(boardQuery.dataUpdatedAt || 0, teamQuery.dataUpdatedAt || 0);

  const [importOpen, setImportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [detail, setDetail] = useState<HeldOrdersBoardRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const selectableOnPage = rows.filter(heldOrderIsOpen);
  const allOnPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((r) => selected.has(r.id));
  const clientCount = new Set(selected.values()).size;

  const toggleRow = (r: HeldOrdersBoardRow) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.set(r.id, r.client_key);
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (allOnPageSelected) selectableOnPage.forEach((r) => next.delete(r.id));
      else selectableOnPage.forEach((r) => next.set(r.id, r.client_key));
      return next;
    });

  const selectFirstN = async () => {
    setSelecting(true);
    try {
      const list = await fetchSelectableHeldOrders(filters, batchQty === "all" ? null : Number(batchQty));
      setSelected(new Map(list.map((x) => [x.id, x.client_key])));
    } catch (e) {
      toast({
        title: "Não foi possível selecionar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setSelecting(false);
    }
  };

  const periodLabel =
    range.from || range.to
      ? `${DATE_FIELD_LABEL[dateField]} ${range.from ? `de ${formatHeldOrderDate(range.from)}` : ""}${
          range.to ? ` até ${formatHeldOrderDate(range.to)}` : " até hoje"
        }`
      : null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const all = await fetchAllHeldOrdersForExport(filters);
      const count = exportHeldOrders({
        rows: all,
        filters: {
          status: status ? HELD_ORDER_BUCKET_LABEL[status] : null,
          store: null,
          product,
          agent: agentName,
          search,
          includesDuplicates: false,
          period: periodLabel,
        },
      });
      toast({ title: "Relatório gerado", description: `${count} pedido(s) na planilha, com os filtros da tela.` });
    } catch (e) {
      console.error("[export-held-orders] falhou:", e);
      toast({ title: "Erro ao exportar", description: "Não foi possível gerar a planilha.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const hasFilters =
    status !== null || agentId !== null || searchInput.trim() !== "" || product !== null || preset !== "30" || dateField !== "entrada";

  const clearFilters = () => {
    setStatus(null);
    setAgentId(null);
    setSearchInput("");
    setProduct(null);
    setPreset("30");
    setDateField("entrada");
    setCustomFrom("");
    setCustomTo("");
  };

  const paginationState = {
    pagina: page,
    setPagina: setPage,
    totalPaginas: totalPages,
    visiveis: rows,
    total,
    inicio: total === 0 ? 0 : (page - 1) * pageSize + 1,
    fim: Math.min(page * pageSize, total),
  };

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[15px] text-ink-tertiary">Operação</p>
          <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Pedidos em Espera</h1>
          <p className="flex items-center gap-1.5 text-xs text-ink-tertiary">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            {updatedAt ? `Atualizado ${formatSince(new Date(updatedAt).toISOString(), now)}` : "Carregando"} · atualiza a
            cada minuto
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="mr-1.5 h-4 w-4" /> Importar planilha
        </Button>
      </header>

      <HeldOrdersStatusStrip
        counts={board?.counts}
        today={teamQuery.data?.today}
        active={status}
        onChange={setStatus}
        loading={boardQuery.isLoading}
      />

      <HeldOrdersTeamTable
        team={teamQuery.data}
        loading={teamQuery.isLoading}
        activeAgentId={agentId}
        onSelectAgent={setAgentId}
      />

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-medium">
              Pedidos{" "}
              <span className="font-mono font-normal tabular-nums text-ink-tertiary">
                · {total.toLocaleString("pt-BR")}
              </span>
            </CardTitle>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Voltar ao padrão
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="held-orders-search"
                placeholder="Buscar pedido, cliente ou e-mail"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>

            <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
              <SelectTrigger className="w-44" aria-label="Período">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIOD_LABEL) as PeriodPreset[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {preset === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input
                  id="held-orders-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-40"
                  aria-label="De"
                />
                <span className="text-sm text-muted-foreground">até</span>
                <Input
                  id="held-orders-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-40"
                  aria-label="Até"
                />
              </div>
            )}

            {preset !== "all" && (
              <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Período pela data">
                {(["entrada", "pedido"] as HeldOrderDateField[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={dateField === f}
                    onClick={() => setDateField(f)}
                    className={cn(
                      "px-3 py-2 text-xs font-medium transition-colors",
                      dateField === f ? "bg-primary text-primary-foreground" : "bg-card text-ink-secondary hover:bg-muted",
                    )}
                  >
                    {DATE_FIELD_LABEL[f]}
                  </button>
                ))}
              </div>
            )}

            <Select value={product ?? "all"} onValueChange={(v) => setProduct(v === "all" ? null : v)}>
              <SelectTrigger className="w-44" aria-label="Produto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                {(board?.products ?? []).map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.code} ({p.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {agentId ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-3 py-1.5 text-xs font-medium text-info">
                Agente: {agentName ?? "—"}
                <button type="button" onClick={() => setAgentId(null)} aria-label="Remover filtro de agente">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <Select value="all" onValueChange={(v) => setAgentId(v === "all" ? null : v)}>
                <SelectTrigger className="w-44" aria-label="Agente">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os agentes</SelectItem>
                  {filterAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting || boardQuery.isLoading || total === 0}
                title="Exportar para Excel todos os pedidos deste filtro, de todas as páginas"
              >
                <Download className="mr-1.5 h-4 w-4" />
                {exporting ? "Gerando..." : `Exportar (${total.toLocaleString("pt-BR")})`}
              </Button>
            </div>
          </div>

          {(board?.open_outside_period ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
              <AlertCircle className="h-4 w-4 text-warning" />
              <span>
                {board!.open_outside_period.toLocaleString("pt-BR")} pedido(s) em aberto ficaram fora deste período.
              </span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setPreset("all")}>
                Ver todo o período
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ListChecks className="h-4 w-4" />
            <span>Selecionar os primeiros</span>
            <Select value={batchQty} onValueChange={setBatchQty}>
              <SelectTrigger className="h-8 w-24" aria-label="Quantidade a selecionar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["10", "15", "20", "30", "50"].map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
            <span>em aberto deste filtro</span>
            <Button variant="secondary" size="sm" onClick={selectFirstN} disabled={selecting || total === 0}>
              {selecting ? "Selecionando..." : "Selecionar"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-0">
          {boardQuery.isLoading ? (
            <div className="space-y-2 px-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : boardQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <AlertCircle className="h-6 w-6" />
              <p>Não foi possível carregar os pedidos.</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nenhum pedido com estes filtros.</div>
          ) : (
            <div className="overflow-x-auto border-y">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-6">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={togglePage}
                        disabled={selectableOnPage.length === 0}
                        aria-label="Selecionar os pedidos em aberto desta página"
                      />
                    </TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Data do pedido</TableHead>
                    <TableHead>Entrada no sistema</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead className="pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => {
                    const reasons = parseReasons(o.reason);
                    const isSelected = selected.has(o.id);
                    return (
                      <TableRow
                        key={o.id}
                        onClick={() => setDetail(o)}
                        className={cn("cursor-pointer", isSelected && "bg-info/10 hover:bg-info/10")}
                      >
                        <TableCell className="pl-6" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(o)}
                            disabled={!heldOrderIsOpen(o)}
                            aria-label={`Selecionar pedido ${o.order_number ?? ""}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-mono text-sm font-medium">
                            {o.order_number ?? <span className="italic text-muted-foreground">sem número</span>}
                          </span>
                          <span className="block text-xs text-ink-tertiary">{heldOrderStoreLabel(o.dyna_code)}</span>
                        </TableCell>
                        <TableCell className="min-w-[180px]">
                          <span className="text-sm">{o.customer_name ?? "—"}</span>
                          {o.email && <span className="block text-xs text-ink-tertiary">{o.email}</span>}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          {reasons.length > 0 ? (
                            <span
                              className="inline-block max-w-full truncate rounded bg-warning/10 px-1.5 text-xs text-warning"
                              title={reasons.map((r) => r.label).join(", ")}
                            >
                              {reasons[0].label}
                              {reasons.length > 1 && ` +${reasons.length - 1}`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">
                          {formatHeldOrderDate(o.order_date)}
                          {o.return_date && (
                            <span className="block text-[11px] text-ink-tertiary">
                              devolução {formatHeldOrderDate(o.return_date)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">
                          {formatHeldOrderDateTime(o.imported_at)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {o.assigned_to_name ?? <span className="italic text-muted-foreground">sem agente</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap pr-6">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <span className={cn("h-2 w-2 rounded-full", HELD_ORDER_BUCKET_DOT[o.bucket])} />
                            {HELD_ORDER_BUCKET_LABEL[o.bucket]}
                          </span>
                          {o.status_changed_at && (
                            <span className="block font-mono text-[11px] text-ink-tertiary">
                              mudou {formatHeldOrderDateTime(o.status_changed_at)}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {!boardQuery.isLoading && !boardQuery.isError && total > 0 && (
            <div className="px-6 pt-4">
              <PanelPagination
                estado={paginationState}
                rotulo={["pedido", "pedidos"]}
                porPagina={pageSize}
                onPorPaginaChange={setPageSize}
                opcoesPorPagina={PAGE_SIZE_OPTIONS}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-primary py-2 pl-4 pr-2 text-sm text-primary-foreground shadow-lg">
            <span>
              {selected.size.toLocaleString("pt-BR")} pedido(s) de {clientCount.toLocaleString("pt-BR")} cliente(s)
            </span>
            <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)}>
              <Send className="mr-1.5 h-3.5 w-3.5" /> Distribuir…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              onClick={() => setSelected(new Map())}
            >
              Limpar
            </Button>
          </div>
        </div>
      )}

      <ImportHeldOrdersDialog open={importOpen} onOpenChange={setImportOpen} />
      <AssignHeldOrdersDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        orderIds={Array.from(selected.keys())}
        clientCount={clientCount}
        agents={usersQuery.data ?? []}
        onAssigned={() => setSelected(new Map())}
      />
      <HeldOrderDetailSheet
        order={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        agents={assignableAgents}
      />
    </div>
  );
}
