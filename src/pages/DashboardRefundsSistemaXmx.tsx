import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useOutletContext } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ManagerOutletContext } from "@/layouts/ManagerLayout";
import { RefundsSubNav } from "@/components/dashboard/RefundsSubNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { plataforma } from "@/features/xmx-vendas/plataformas";
import { useXmxRefundsQuery, type XmxGroupBy } from "@/features/xmx-vendas/useXmxRefundsQuery";

const AGRUPAR: { value: XmxGroupBy; label: string }[] = [
  { value: "day", label: "Dias" },
  { value: "week", label: "Semanas" },
  { value: "month", label: "Meses" },
];

const fmtDia = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");

function rotuloPeriodo(from: string, to: string) {
  const hoje = format(new Date(), "yyyy-MM-dd");
  if (from === to) return from === hoje ? "de hoje" : `de ${fmtDia(from)}`;
  return `de ${fmtDia(from)} a ${fmtDia(to)}`;
}

function rotuloBucket(bucket: string, groupBy: XmxGroupBy) {
  const d = parseISO(bucket);
  if (groupBy === "month") return format(d, "MMM/yy", { locale: ptBR });
  if (groupBy === "week") return `sem. ${format(d, "dd/MM")}`;
  return format(d, "dd/MM");
}

/**
 * Comparativo com o sistema de vendas da XMX: reembolsos lidos do banco de
 * vendas (sincronizados a cada 15 min). Por plataforma, porque o banco de
 * vendas ainda não nos diz o produto de cada pedido.
 */
export default function DashboardRefundsSistemaXmx() {
  const { fromISO, toISO } = useOutletContext<ManagerOutletContext>();
  const [groupBy, setGroupBy] = useState<XmxGroupBy>("day");
  const [platform, setPlatform] = useState("all");

  const query = useXmxRefundsQuery({ from: fromISO, to: toISO, groupBy, platform });
  const data = query.data;

  // Só reformata a série da RPC (bucket × plataforma) no formato do Recharts.
  const { linhas, chaves } = useMemo(() => {
    const porBucket = new Map<string, Record<string, number | string>>();
    for (const s of data?.series ?? []) {
      const linha = porBucket.get(s.bucket) ?? { bucket: s.bucket };
      linha[s.key] = s.count;
      porBucket.set(s.bucket, linha);
    }
    return {
      linhas: [...porBucket.values()],
      // Ordem da pilha = ordem da distribuição (maior embaixo).
      chaves: (data?.distribution ?? []).map((d) => d.key),
    };
  }, [data]);

  const periodo = rotuloPeriodo(fromISO, toISO);
  const atualizado = data?.last_sync_at ? format(parseISO(data.last_sync_at), "dd/MM 'às' HH:mm") : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[15px] text-ink-tertiary">Analytics</p>
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Reembolsos</h1>
        <RefundsSubNav />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Reembolsos registrados no sistema de vendas da XMX, por plataforma.
          {data?.backfill_done === false && " Carga inicial em andamento: o histórico ainda está chegando."}
        </p>
        <div className="flex items-center gap-3">
          {atualizado && <span className="text-xs text-muted-foreground">Atualizado em {atualizado}</span>}
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9 w-[180px]" aria-label="Plataforma">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as plataformas</SelectItem>
              {(data?.platforms ?? []).map((k) => (
                <SelectItem key={k} value={k}>
                  {plataforma(k).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isError ? (
        <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          Não foi possível carregar os reembolsos do sistema XMX.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Distribuição dos Reembolsos</CardTitle>
              <p className="text-sm text-muted-foreground">Distribuição {periodo}</p>
            </CardHeader>
            <CardContent>
              {query.isLoading ? (
                <Skeleton className="h-[320px] w-full" />
              ) : !data?.total ? (
                <Vazio sincronizado={Boolean(data?.last_sync_at)} />
              ) : (
                <>
                  <div className="relative h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.distribution}
                          dataKey="count"
                          nameKey="key"
                          innerRadius="58%"
                          outerRadius="88%"
                          paddingAngle={1}
                          stroke="hsl(var(--card))"
                          strokeWidth={2}
                          isAnimationActive={false}
                        >
                          {data.distribution.map((d) => (
                            <Cell key={d.key} fill={plataforma(d.key).cor} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number, k: string) => [`${v} reembolsos`, plataforma(k).label]}
                          contentStyle={{ fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold tabular-nums">{data.total}</span>
                      <span className="text-xs text-muted-foreground">reembolsos</span>
                    </div>
                  </div>
                  <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                    {data.distribution.map((d) => (
                      <li key={d.key} className="flex items-start gap-2">
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: plataforma(d.key).cor }} />
                        <span className="leading-snug">
                          {plataforma(d.key).label} - {d.count} ({d.pct.toFixed(1)}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {data.kinds.total} integrais · {data.kinds.parcial} parciais
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
              <div>
                <CardTitle className="text-base font-medium">Reembolsos por Plataforma</CardTitle>
                <p className="text-sm text-muted-foreground">Evolução {periodo}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Agrupar por:</span>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as XmxGroupBy)}>
                  <SelectTrigger className="h-8 w-[110px]" aria-label="Agrupar por">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGRUPAR.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {query.isLoading ? (
                <Skeleton className="h-[320px] w-full" />
              ) : !data?.total ? (
                <Vazio sincronizado={Boolean(data?.last_sync_at)} />
              ) : (
                <>
                  <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {chaves.map((k) => (
                      <li key={k} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: plataforma(k).cor }} />
                        {plataforma(k).label}
                      </li>
                    ))}
                  </ul>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={linhas} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="bucket"
                          tickFormatter={(b: string) => rotuloBucket(b, data.group_by)}
                          tick={{ fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          labelFormatter={(b: string) => rotuloBucket(b, data.group_by)}
                          formatter={(v: number, k: string) => [v, plataforma(k).label]}
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                          contentStyle={{ fontSize: 12 }}
                        />
                        {chaves.map((k) => (
                          <Bar
                            key={k}
                            dataKey={k}
                            stackId="plataformas"
                            fill={plataforma(k).cor}
                            stroke="hsl(var(--card))"
                            strokeWidth={1}
                            maxBarSize={48}
                            isAnimationActive={false}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Vazio({ sincronizado }: { sincronizado: boolean }) {
  return (
    <div className="flex h-[320px] items-center justify-center text-center text-sm text-muted-foreground">
      {sincronizado ? "Nenhum reembolso no período." : "Aguardando a primeira sincronização com o sistema XMX."}
    </div>
  );
}
