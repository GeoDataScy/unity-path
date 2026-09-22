import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyTickets } from "@/features/dashboard/useDashboardDailyTicketsQuery";

// Roxo da marca para o que entra, verde corporativo para o que fecha. O par é
// validado para daltonismo nos dois temas (ver os tokens em index.css); roxo +
// azul, o reflexo natural aqui, é justamente o que não passa.
const COLOR_OPEN = "hsl(var(--chart-ticket-open))";
const COLOR_CLOSED = "hsl(var(--chart-ticket-done))";

function count(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("pt-BR");
}

/** 2026-09-22 → 22/09, sem passar por timezone (a string já é o dia certo). */
function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

type ChartRow = { day: string; label: string; opened: number; closed: number };

function DailyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{row.label}</div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_OPEN }} />
        <span className="text-muted-foreground">Abertos</span>
        <span className="ml-auto font-medium tabular-nums">{count(row.opened)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_CLOSED }} />
        <span className="text-muted-foreground">Concluídos</span>
        <span className="ml-auto font-medium tabular-nums">{count(row.closed)}</span>
      </div>
    </div>
  );
}

function TotalLegenda({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[-2px] rounded-full" style={{ background: color }} />
      <span className="text-2xl font-semibold tabular-nums">{count(value)}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

type Props = {
  data: DailyTickets | undefined;
  isLoading: boolean;
};

/**
 * Tickets abertos × concluídos, dia a dia, no período escolhido na sidebar.
 * Conta TICKET, não interação: um chamado com cinco follow-ups aparece uma vez
 * só, no dia em que nasceu. As duas barras não somam entre si — um ticket
 * aberto antes do período e fechado dentro dele só existe na barra verde.
 */
export function TicketsAbertosConcluidos({ data, isLoading }: Props) {
  const rows = useMemo<ChartRow[]>(
    () =>
      (data?.by_day ?? []).map((r) => ({
        day: r.day,
        label: shortDay(r.day),
        opened: r.opened,
        closed: r.closed,
      })),
    [data?.by_day],
  );

  const vazio = rows.length === 0 || rows.every((r) => r.opened === 0 && r.closed === 0);

  return (
    <Card>
      <CardHeader className="gap-3 space-y-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <CardTitle>Tickets abertos e concluídos por dia</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Chamados que nasceram no dia e chamados que foram fechados no dia. Follow-up não conta como atendimento novo.
            </p>
          </div>
          {!isLoading && (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <TotalLegenda color={COLOR_OPEN} label="abertos" value={data?.total_opened ?? 0} />
              <TotalLegenda color={COLOR_CLOSED} label="concluídos" value={data?.total_closed ?? 0} />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="h-[360px]">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : vazio ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Nenhum ticket neste período
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={2}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "hsl(var(--chart-axis))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--chart-grid))" }}
                // Período longo não cabe com um rótulo por dia: o recharts
                // esconde os que colidiriam, mantendo o primeiro e o último.
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                width={44}
                tick={{ fontSize: 12, fill: "hsl(var(--chart-axis))" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={<DailyTooltip />} />
              <Bar name="Abertos" dataKey="opened" fill={COLOR_OPEN} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar name="Concluídos" dataKey="closed" fill={COLOR_CLOSED} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
