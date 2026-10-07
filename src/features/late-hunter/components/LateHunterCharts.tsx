import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FAIXAS, formatCount, formatDay, formatShortDay, motivoLabel } from "../format";
import type { LateHunterFaixa, LateHunterOverview } from "../types";

// Uma cor só em todos os gráficos da aba: a identidade de cada barra está no
// rótulo ao lado, nunca na cor (os tokens --chart-* não se separam para quem
// tem daltonismo — ver reference_chart_tokens_cvd). O azul `ice` é o mesmo dos
// demais gráficos de série única do app e passa 3:1 nos dois temas.
const COR = "hsl(var(--ice))";

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {subtitle && <p className="text-xs text-ink-tertiary">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type BarRow = {
  key: string;
  label: string;
  sub?: string;
  value: number;
  /** Segundo número, em texto (ex.: "12 há +30 dias"). */
  note?: string;
};

/**
 * Barras horizontais em HTML: rótulo legível de qualquer tamanho, valor sempre
 * escrito, e cada linha é um botão que liga/desliga o filtro correspondente.
 */
function BarList({
  rows,
  selected,
  onToggle,
  emptyText,
  ariaLabel,
}: {
  rows: BarRow[];
  selected: string[];
  onToggle: (key: string) => void;
  emptyText: string;
  ariaLabel: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const anySelected = selected.length > 0;
  return (
    <ul className="space-y-1" aria-label={ariaLabel}>
      {rows.map((r) => {
        const isOn = selected.includes(r.key);
        return (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onToggle(r.key)}
              aria-pressed={isOn}
              title={isOn ? "Clique para tirar do filtro" : "Clique para filtrar a tabela"}
              className={cn(
                "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isOn && "bg-subtle",
                anySelected && !isOn && "opacity-60",
              )}
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm text-ink">{r.label}</span>
                  {r.sub && <span className="truncate text-xs text-ink-tertiary">{r.sub}</span>}
                </span>
                <span className="mt-1 block h-1.5 rounded-full bg-subtle" aria-hidden>
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`, background: COR }}
                  />
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-sm tabular-nums text-ink">{formatCount(r.value)}</span>
                {r.note && <span className="block text-[11px] text-ink-tertiary">{r.note}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type AgingProps = {
  overview: LateHunterOverview | undefined;
  loading: boolean;
  faixaAtiva: LateHunterFaixa | null;
  onFaixa: (f: LateHunterFaixa | null) => void;
};

/**
 * Envelhecimento da fila: quantos pedidos abertos estão em cada faixa de dias.
 * É a pergunta principal do time — "o que está parado há tempo demais?" — e por
 * isso é uma distribuição, não uma média.
 */
export function AgingChart({ overview, loading, faixaAtiva, onFaixa }: AgingProps) {
  const data = FAIXAS.map((f) => ({ ...f, value: overview?.envelhecimento?.[f.key] ?? 0 }));
  const semDado = overview?.envelhecimento?.sem_dado ?? 0;
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0) + semDado;

  return (
    <ChartCard title="Há quanto tempo estão em espera" subtitle="Pedidos em on-hold agora, por dias em espera. Clique numa barra para filtrar.">
      {loading ? (
        <Skeleton className="h-[188px] w-full" />
      ) : total === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Nenhum pedido em on-hold.</p>
      ) : (
        <>
          <div className="flex h-[160px] items-end gap-2" role="list" aria-label="Pedidos por faixa de dias em espera">
            {data.map((d) => {
              const isOn = faixaAtiva === d.key;
              const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <button
                  key={d.key}
                  type="button"
                  role="listitem"
                  onClick={() => onFaixa(isOn ? null : d.key)}
                  aria-pressed={isOn}
                  aria-label={`${d.label}: ${d.value} pedidos (${pct}%)`}
                  title={`${d.label}: ${formatCount(d.value)} pedidos (${pct}%)`}
                  className={cn(
                    "group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md px-0.5 pt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    faixaAtiva && !isOn && "opacity-50",
                  )}
                >
                  <span className="font-mono text-xs tabular-nums text-ink">{formatCount(d.value)}</span>
                  <span
                    className="w-full max-w-[56px] rounded-t-[4px] transition-opacity group-hover:opacity-80"
                    style={{ height: `${(d.value / max) * 120}px`, minHeight: d.value > 0 ? 2 : 0, background: COR }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex gap-2 border-t border-line pt-1.5" aria-hidden>
            {data.map((d) => (
              <span key={d.key} className="flex-1 text-center text-[11px] text-ink-tertiary">
                {d.label}
              </span>
            ))}
          </div>
          {semDado > 0 && (
            <p className="mt-2 text-xs text-ink-tertiary">
              {formatCount(semDado)} pedido(s) sem dias em espera informados pela ShipOffers.
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type FlowRow = { referencia: string; label: string; abertos: number | null; entraram: number; sairam: number };

function FlowTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: FlowRow }> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-ink">{formatDay(r.referencia)}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-ink-secondary">
        <span>Em on-hold na última varredura</span>
        <span className="text-right font-mono tabular-nums text-ink">{r.abertos == null ? "—" : formatCount(r.abertos)}</span>
        <span>Entraram</span>
        <span className="text-right font-mono tabular-nums text-ink">{formatCount(r.entraram)}</span>
        <span>Saíram</span>
        <span className="text-right font-mono tabular-nums text-ink">{formatCount(r.sairam)}</span>
      </div>
    </div>
  );
}

/**
 * Tamanho da fila dia a dia (últimos 30 dias com varredura). Uma série só, num eixo só;
 * entradas e saídas do dia ficam no tooltip — em vez de três linhas coloridas
 * disputando a mesma escala.
 */
export function FlowChart({ overview, loading }: { overview: LateHunterOverview | undefined; loading: boolean }) {
  const rows: FlowRow[] = (overview?.fluxo ?? []).map((f) => ({ ...f, label: formatShortDay(f.referencia) }));
  return (
    <ChartCard title="Tamanho da fila por dia" subtitle="Pedidos em on-hold na última varredura de cada dia. Passe o mouse para ver entradas e saídas do dia.">
      {loading ? (
        <Skeleton className="h-[188px] w-full" />
      ) : rows.length < 2 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          O gráfico aparece a partir do segundo dia com varredura.
        </p>
      ) : (
        <div className="h-[188px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 20, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="lh-fila" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COR} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "hsl(var(--chart-axis))", fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "hsl(var(--chart-axis))", fontSize: 11 }}
                allowDecimals={false}
                width={44}
              />
              <Tooltip content={<FlowTooltip />} cursor={{ stroke: "hsl(var(--line-strong))" }} />
              <Area
                type="monotone"
                dataKey="abertos"
                stroke={COR}
                strokeWidth={2}
                fill="url(#lh-fila)"
                dot={false}
                activeDot={{ r: 4, stroke: "hsl(var(--surface))", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type BreakdownProps = {
  overview: LateHunterOverview | undefined;
  loading: boolean;
  selected: string[];
  onToggle: (key: string) => void;
};

export function ReasonsChart({ overview, loading, selected, onToggle }: BreakdownProps) {
  const rows: BarRow[] = (overview?.motivos ?? [])
    .filter((m) => m.abertos > 0 || selected.includes(m.motivo))
    .map((m) => ({ key: m.motivo, label: motivoLabel(m.motivo), sub: m.motivo !== motivoLabel(m.motivo) ? m.motivo : undefined, value: m.abertos }));
  return (
    <ChartCard
      title="Por que estão retidos"
      subtitle="Um pedido pode ter mais de um motivo, então a soma passa do total."
    >
      {loading ? (
        <Skeleton className="h-[188px] w-full" />
      ) : (
        <BarList rows={rows} selected={selected} onToggle={onToggle} emptyText="Nenhum motivo na fila." ariaLabel="Motivos do on-hold" />
      )}
    </ChartCard>
  );
}

const TOP_LOJAS = 8;

export function StoresChart({ overview, loading, selected, onToggle }: BreakdownProps) {
  const all = (overview?.lojas ?? []).filter((l) => l.abertos > 0 || selected.includes(l.loja));
  const rows: BarRow[] = all.slice(0, TOP_LOJAS).map((l) => ({
    key: l.loja,
    label: l.loja,
    sub: l.loja_nome ?? undefined,
    value: l.abertos,
    note: l.mais_30_dias > 0 ? `${formatCount(l.mais_30_dias)} há +30 dias` : undefined,
  }));
  // Loja filtrada fora do top continua visível, para dar para desmarcar.
  for (const l of all.slice(TOP_LOJAS)) {
    if (selected.includes(l.loja)) rows.push({ key: l.loja, label: l.loja, sub: l.loja_nome ?? undefined, value: l.abertos });
  }
  const resto = Math.max(all.length - TOP_LOJAS, 0);
  return (
    <ChartCard
      title="Lojas com mais pedidos retidos"
      subtitle={resto > 0 ? `As ${TOP_LOJAS} maiores de ${all.length}. As demais estão no filtro de loja.` : undefined}
    >
      {loading ? (
        <Skeleton className="h-[188px] w-full" />
      ) : (
        <BarList rows={rows} selected={selected} onToggle={onToggle} emptyText="Nenhuma loja com pedidos na fila." ariaLabel="Lojas" />
      )}
    </ChartCard>
  );
}
