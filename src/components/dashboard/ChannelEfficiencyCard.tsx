import { useMemo } from "react";
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  ChannelEfficiencyRow,
  ChannelEfficiencyTotal,
} from "@/features/dashboard/useDashboardRefundMetricsQuery";

// Aqua = parcial (a conversão que a operação persegue), cinza = integral
// (hubi). O par se separa por luminosidade, não só por matiz: seguro em
// daltonismo nos dois temas.
const COLOR_PARTIAL = "hsl(var(--aqua))";
const COLOR_FULL = "hsl(var(--chart-mute-2))";
const TOTAL_LABEL = "Todos os canais";
const ROW_HEIGHT = 44;

type Props = {
  rows: ChannelEfficiencyRow[];
  total: ChannelEfficiencyTotal | null;
  isLoading: boolean;
  className?: string;
};

type ChartRow = {
  name: string;
  isTotal: boolean;
  total_done: number;
  partial_count: number;
  full_count: number;
  partial_rate: number;
  full_rate: number;
  partial_share: number | null;
  full_share: number | null;
};

function pct(value: number | null | undefined, digits = 1): string {
  return `${(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function count(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("pt-BR");
}

function EfficiencyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{row.name}</p>
      <p className="text-muted-foreground">{count(row.total_done)} reembolsos concluídos</p>
      <div className="mt-1.5 space-y-0.5">
        <p className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_PARTIAL }} />
          Parcial: {count(row.partial_count)} · conversão {pct(row.partial_rate)}
        </p>
        <p className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_FULL }} />
          Integral: {count(row.full_count)} · conversão {pct(row.full_rate)}
        </p>
      </div>
    </div>
  );
}

export function ChannelEfficiencyCard({ rows, total, isLoading, className }: Props) {
  const chartData = useMemo<ChartRow[]>(() => {
    const perChannel: ChartRow[] = rows.map((r) => ({
      name: r.channel,
      isTotal: false,
      total_done: r.total_done,
      partial_count: r.partial_count,
      full_count: r.full_count,
      partial_rate: r.partial_rate,
      full_rate: r.full_rate,
      partial_share: r.partial_share,
      full_share: r.full_share,
    }));
    if (!total || rows.length < 2) return perChannel;
    return [
      ...perChannel,
      {
        name: TOTAL_LABEL,
        isTotal: true,
        total_done: total.total_done,
        partial_count: total.partial_count,
        full_count: total.full_count,
        partial_rate: total.partial_rate,
        full_rate: total.full_rate,
        partial_share: null,
        full_share: null,
      },
    ];
  }, [rows, total]);

  const chartHeight = chartData.length * ROW_HEIGHT + 40;

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Eficiência por canal</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Reembolsos concluídos no período. Taxa de conversão é a fatia dos concluídos do canal que
          ficou em reembolso parcial (&lt;100%) ou integral (100%).
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : rows.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-muted-foreground">
            Nenhum dado encontrado neste período
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_PARTIAL }} />
                  Conversão parcial (&lt;100%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_FULL }} />
                  Conversão integral (100%)
                </span>
              </div>
              <div style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    barCategoryGap={10}
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  >
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      tick={{ fontSize: 11, fill: "hsl(var(--chart-axis))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={124}
                      tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={<EfficiencyTooltip />} />
                    <Bar
                      dataKey="partial_rate"
                      name="Conversão parcial"
                      stackId="rate"
                      fill={COLOR_PARTIAL}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="partial_rate"
                        position="center"
                        style={{ fontSize: 11, fontWeight: 600, fill: "#fff" }}
                        formatter={(v: number) => (v >= 12 ? pct(v, 0) : "")}
                      />
                    </Bar>
                    <Bar
                      dataKey="full_rate"
                      name="Conversão integral"
                      stackId="rate"
                      fill={COLOR_FULL}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="full_rate"
                        position="center"
                        style={{ fontSize: 11, fontWeight: 600, fill: "#fff" }}
                        formatter={(v: number) => (v >= 12 ? pct(v, 0) : "")}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">Concluídos</TableHead>
                    <TableHead className="text-right">Parciais</TableHead>
                    <TableHead className="text-right">% dos parciais</TableHead>
                    <TableHead className="text-right">Integrais</TableHead>
                    <TableHead className="text-right">% dos integrais</TableHead>
                    <TableHead className="text-right">Conv. parcial</TableHead>
                    <TableHead className="text-right">Conv. integral</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.map((row) => (
                    <TableRow
                      key={row.name}
                      className={cn(row.isTotal && "bg-muted/40 font-medium")}
                    >
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{count(row.total_done)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{count(row.partial_count)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.isTotal ? "—" : pct(row.partial_share)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{count(row.full_count)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.isTotal ? "—" : pct(row.full_share)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{pct(row.partial_rate)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{pct(row.full_rate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              “% dos parciais” e “% dos integrais” mostram quanto cada canal representa do total de
              reembolsos parciais e integrais do período.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
