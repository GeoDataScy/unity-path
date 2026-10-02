import { useMemo, useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { useDashboardChannelDetailQuery } from "@/features/dashboard/useDashboardChannelDetailQuery";

// ── colour palette ────────────────────────────────────────────────────────────

const AGENT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
];

// O gráfico é empilhado e a soma das barras tem de fechar com a coluna "Total"
// da tabela (Tickets Novos + Interações). Por isso a primeira faixa é
// "Novos em aberto" = Tickets Novos − Concluídos: os concluídos aparecem na
// faixa verde. Rotular essa faixa como "Tickets Novos" fazia o tooltip mostrar
// um número menor que a tabela (ex.: 163 no gráfico vs 175 na tabela).
const TYPE_COLORS: Record<string, string> = {
  "Novos em aberto": "hsl(var(--chart-1))",
  "Interações":      "hsl(var(--chart-info))",
  "Concluídos":      "hsl(var(--chart-success))",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function safeParse(iso: string): Date | null {
  const d = parseISO(iso);
  return isValid(d) ? d : null;
}

type ViewMode = "por-agente" | "por-tipo";

// ── component ─────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onClose: () => void;
  initialFrom: string;
  initialTo: string;
  /** filtro de agente do cabeçalho da gestora — o mesmo que o relatório usa */
  agentId?: string;
  agentLabel?: string;
};

export function ChannelDetailModal({ open, onClose, initialFrom, initialTo, agentId, agentLabel }: Props) {
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = safeParse(initialFrom);
    const to   = safeParse(initialTo);
    return from ? { from, to: to ?? from } : undefined;
  });
  const [view, setView] = useState<ViewMode>("por-agente");

  const fromISO = range?.from ? toISODate(range.from) : initialFrom;
  const toISO   = range?.to   ? toISODate(range.to)   : (range?.from ? toISODate(range.from) : initialTo);

  const query = useDashboardChannelDetailQuery({ enabled: open, from: fromISO, to: toISO, agentId });
  const rows  = query.data?.by_channel_agent ?? [];

  // ── derived data ─────────────────────────────────────────────────────────────

  const { channels, agents, chartData, channelTotals } = useMemo(() => {
    const channelSet = new Set<string>();
    const agentMap   = new Map<string, string>(); // id → name
    rows.forEach((r) => {
      channelSet.add(r.channel);
      agentMap.set(r.agent_id, r.agent_name);
    });

    const channels = Array.from(channelSet).sort();
    const agents   = Array.from(agentMap.entries()).map(([id, name]) => ({ id, name }));

    // Chart data by agent: one entry per channel with a key per agent
    const byAgent = channels.map((ch) => {
      const entry: Record<string, string | number> = { channel: ch };
      agents.forEach(({ name }) => {
        const row = rows.find((r) => r.channel === ch && r.agent_name === name);
        entry[name] = row?.total ?? 0;
      });
      return entry;
    });

    // Chart data by type: one entry per channel with new/interactions/done
    const byType = channels.map((ch) => {
      const chRows = rows.filter((r) => r.channel === ch);
      const newT   = chRows.reduce((s, r) => s + r.new_tickets, 0);
      const inter  = chRows.reduce((s, r) => s + r.interactions, 0);
      const done   = chRows.reduce((s, r) => s + r.done_count, 0);
      return {
        channel: ch,
        "Novos em aberto": Math.max(0, newT - done),
        "Interações":      inter,
        "Concluídos":      done,
      };
    });

    // Channel totals for the summary table
    const channelTotals = channels.map((ch) => {
      const chRows = rows.filter((r) => r.channel === ch);
      const newT   = chRows.reduce((s, r) => s + r.new_tickets, 0);
      const inter  = chRows.reduce((s, r) => s + r.interactions, 0);
      const done   = chRows.reduce((s, r) => s + r.done_count, 0);
      const total  = chRows.reduce((s, r) => s + r.total, 0);
      const rate   = newT > 0 ? Math.round((done / newT) * 100) : 0;
      return { channel: ch, new_tickets: newT, interactions: inter, done_count: done, total, rate };
    }).sort((a, b) => b.total - a.total);

    return { channels, agents, chartData: view === "por-agente" ? byAgent : byType, channelTotals };
  }, [rows, view]);

  const barKeys  = view === "por-agente" ? agents.map((a) => a.name) : Object.keys(TYPE_COLORS);
  const colorFor = (key: string, idx: number) =>
    view === "por-agente" ? AGENT_COLORS[idx % AGENT_COLORS.length] : TYPE_COLORS[key];

  const periodLabel = range?.from
    ? range.to && toISODate(range.to) !== toISODate(range.from)
      ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} — ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}`
      : format(range.from, "dd/MM/yyyy", { locale: ptBR })
    : "";

  // ── summary cards ─────────────────────────────────────────────────────────────

  const topChannel    = channelTotals[0];
  const bestRate      = [...channelTotals].sort((a, b) => b.rate - a.rate)[0];
  const grandTotal    = channelTotals.reduce((s, c) => s + c.total, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Atendimentos por Canal — Detalhamento</DialogTitle>
        </DialogHeader>

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <div className="w-72">
            <DateRangePicker
              value={range}
              onChange={(r) => setRange(r)}
              className="bg-surface text-foreground hover:bg-subtle"
            />
          </div>
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button
              className={`px-4 py-1.5 transition-colors ${view === "por-agente" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-subtle"}`}
              onClick={() => setView("por-agente")}
            >
              Por Agente
            </button>
            <button
              className={`px-4 py-1.5 transition-colors ${view === "por-tipo" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-subtle"}`}
              onClick={() => setView("por-tipo")}
            >
              Por Tipo
            </button>
          </div>
          {periodLabel && (
            <span className="text-sm text-muted-foreground ml-auto">
              {periodLabel}
              {agentId && agentId !== "all" ? ` • ${agentLabel ?? "agente selecionado"}` : ""}
            </span>
          )}
        </div>

        {/* ── Summary cards ── */}
        {!query.isLoading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3 pb-2">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Total no período</p>
              <p className="font-mono text-2xl font-normal tracking-[-0.03em] tabular-nums">{grandTotal}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{channels.length} canal(is) ativos</p>
            </div>
            {topChannel && (
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Canal mais ativo</p>
                <p className="text-2xl font-medium truncate">{topChannel.channel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{topChannel.total} atendimentos</p>
              </div>
            )}
            {bestRate && bestRate.new_tickets > 0 && (
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Melhor taxa de conclusão</p>
                <p className="text-2xl font-medium">{bestRate.channel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{bestRate.rate}% concluídos</p>
              </div>
            )}
          </div>
        )}

        {/* ── Chart ── */}
        <div className="h-72">
          {query.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : rows.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Nenhum dado encontrado neste período
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {barKeys.map((key, idx) => (
                  <Bar key={key} dataKey={key} stackId="a" fill={colorFor(key, idx)} radius={idx === barKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Table ── */}
        {!query.isLoading && rows.length > 0 && (
          <div className="overflow-x-auto mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead className="text-right">Tickets Novos</TableHead>
                  <TableHead className="text-right">Interações</TableHead>
                  <TableHead className="text-right">Concluídos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">% Conclusão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channelTotals.map((ct) => {
                  const agentRows = rows.filter((r) => r.channel === ct.channel);
                  return [
                    // Channel summary row
                    <TableRow key={`ch-${ct.channel}`} className="font-medium bg-muted/40">
                      <TableCell colSpan={2}>{ct.channel}</TableCell>
                      <TableCell className="text-right">{ct.new_tickets}</TableCell>
                      <TableCell className="text-right">{ct.interactions}</TableCell>
                      <TableCell className="text-right">{ct.done_count}</TableCell>
                      <TableCell className="text-right">{ct.total}</TableCell>
                      <TableCell className="text-right">{ct.new_tickets > 0 ? `${ct.rate}%` : "—"}</TableCell>
                    </TableRow>,
                    // Per-agent rows
                    ...agentRows
                      .sort((a, b) => b.total - a.total)
                      .map((r) => (
                        <TableRow key={`${r.channel}-${r.agent_id}`} className="text-sm text-muted-foreground">
                          <TableCell />
                          <TableCell>{r.agent_name}</TableCell>
                          <TableCell className="text-right">{r.new_tickets}</TableCell>
                          <TableCell className="text-right">{r.interactions}</TableCell>
                          <TableCell className="text-right">{r.done_count}</TableCell>
                          <TableCell className="text-right">{r.total}</TableCell>
                          <TableCell className="text-right">
                            {r.new_tickets > 0
                              ? `${Math.round((r.done_count / r.new_tickets) * 100)}%`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      )),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
