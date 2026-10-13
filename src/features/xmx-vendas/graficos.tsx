import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { fmtInt, fmtPct, rotuloBucket } from "./format";
import { plataforma } from "./plataformas";
import type { XmxGroupBy } from "./useXmxSistemaQuery";

const TOOLTIP = { fontSize: 12, borderRadius: 8 };

/** Cartão padrão da página: título, uma linha de explicação e, opcionalmente, um controle à direita. */
export function Painel({
  titulo,
  descricao,
  acao,
  className,
  children,
}: {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base font-medium">{titulo}</CardTitle>
          {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
        </div>
        {acao}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Vazio({ texto = "Nada no período escolhido." }: { texto?: string }) {
  return <div className="flex h-[240px] items-center justify-center text-center text-sm text-muted-foreground">{texto}</div>;
}

/** Rosca por plataforma, com o total no meio e a legenda "Plataforma - N (x%)" embaixo. */
export function Rosca({ itens, rotulo }: { itens: { key: string; count: number }[]; rotulo: string }) {
  const total = itens.reduce((s, i) => s + i.count, 0);
  if (!total) return <Vazio />;
  return (
    <div>
      <div className="relative h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={itens}
              dataKey="count"
              nameKey="key"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {itens.map((d) => (
                <Cell key={d.key} fill={plataforma(d.key).cor} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number, k: string) => [fmtInt(v), plataforma(k).label]} contentStyle={TOOLTIP} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{fmtInt(total)}</span>
          <span className="text-xs text-muted-foreground">{rotulo}</span>
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {itens.map((d) => (
          <li key={d.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: plataforma(d.key).cor }} />
            <span className="truncate">{plataforma(d.key).label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {fmtInt(d.count)} ({fmtPct((100 * d.count) / total)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras empilhadas por período, um segmento por plataforma. A ordem da pilha segue `chaves`. */
export function BarrasEmpilhadas({
  serie,
  chaves,
  groupBy,
  formatar = fmtInt,
}: {
  serie: { bucket: string; key: string; valor: number }[];
  chaves: string[];
  groupBy: XmxGroupBy;
  formatar?: (n: number) => string;
}) {
  if (!serie.length) return <Vazio />;
  const porBucket = new Map<string, Record<string, number | string>>();
  for (const s of serie) {
    const linha = porBucket.get(s.bucket) ?? { bucket: s.bucket };
    linha[s.key] = s.valor;
    porBucket.set(s.bucket, linha);
  }
  const linhas = [...porBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {chaves.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: plataforma(k).cor }} />
            {plataforma(k).label}
          </li>
        ))}
      </ul>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={linhas} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="bucket"
              tickFormatter={(b: string) => rotuloBucket(b, groupBy)}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={12}
            />
            <YAxis tickFormatter={formatar} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              labelFormatter={(b: string) => rotuloBucket(b, groupBy)}
              formatter={(v: number, k: string) => [formatar(v), plataforma(k).label]}
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
              contentStyle={TOOLTIP}
            />
            {chaves.map((k) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="p"
                fill={plataforma(k).cor}
                stroke="hsl(var(--card))"
                strokeWidth={1}
                maxBarSize={44}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Taxa de reembolso e de chargeback por período de compra (mesma escala: %). */
export function LinhaTaxas({
  serie,
  groupBy,
}: {
  serie: { bucket: string; refund_rate: number | null; chargeback_rate: number | null }[];
  groupBy: XmxGroupBy;
}) {
  if (!serie.length) return <Vazio />;
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="bucket"
            tickFormatter={(b: string) => rotuloBucket(b, groupBy)}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={12}
          />
          <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            labelFormatter={(b: string) => rotuloBucket(b, groupBy)}
            formatter={(v: number, nome: string) => [fmtPct(v, nome === "Chargeback" ? 2 : 1), nome]}
            contentStyle={TOOLTIP}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Line
            name="Reembolso"
            dataKey="refund_rate"
            stroke="var(--xmx-taxa-reembolso)"
            strokeWidth={2}
            dot={serie.length <= 31 ? { r: 3 } : false}
            isAnimationActive={false}
          />
          <Line
            name="Chargeback"
            dataKey="chargeback_rate"
            stroke="var(--xmx-taxa-chargeback)"
            strokeWidth={2}
            dot={serie.length <= 31 ? { r: 3 } : false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Lista com barra horizontal proporcional (motivos, faixas de dias). Uma cor só. */
export function BarrasLista({
  itens,
  className,
}: {
  itens: { rotulo: string; valor: number; detalhe?: string }[];
  className?: string;
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  if (!itens.length) return <Vazio />;
  return (
    <ul className={cn("space-y-2.5", className)}>
      {itens.map((i) => (
        <li key={i.rotulo} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate">{i.rotulo}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {fmtInt(i.valor)}
              {i.detalhe && <span className="ml-1.5">{i.detalhe}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-subtle">
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${(100 * i.valor) / max}%`, background: "hsl(var(--foreground) / 0.55)" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
