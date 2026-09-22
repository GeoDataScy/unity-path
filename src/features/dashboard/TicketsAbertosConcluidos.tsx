import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyTickets } from "@/features/dashboard/useDashboardDailyTicketsQuery";

// Roxo da marca para o que entra, verde corporativo para o que fecha. O par é
// validado para daltonismo nos dois temas (ver os tokens em index.css); roxo +
// azul, o reflexo natural aqui, é justamente o que não passa.
const COLOR_OPEN = "hsl(var(--chart-ticket-open))";
const COLOR_CLOSED = "hsl(var(--chart-ticket-done))";

/**
 * Largura reservada para cada dia. É o que sustenta a promessa de "mostrar
 * todos os dias": em vez de espremer 90 barras na largura da tela (o eixo some
 * e as barras viram fios), o gráfico cresce e a área rola para o lado.
 */
export const PX_POR_DIA = 44;

/** Coluna fixa à esquerda com a escala. Não rola junto, senão perde-se a régua. */
const LARGURA_EIXO = 52;

/** Altura reservada para o eixo de datas nos dois gráficos — é o que os alinha. */
const ALTURA_EIXO_X = 30;

const MARGEM = { top: 8, right: 8, bottom: 0, left: 0 } as const;

export function larguraMinimaDoGrafico(dias: number): number {
  return Math.max(dias, 0) * PX_POR_DIA;
}

/**
 * Escala vertical "redonda" (passo 1, 2 ou 5 × potência de 10), calculada aqui
 * em vez de delegada ao recharts porque os DOIS gráficos — a coluna do eixo e a
 * área que rola — precisam do mesmo domínio para a grade cair sobre os valores
 * certos.
 */
export function escalaY(maiorValor: number): { topo: number; ticks: number[] } {
  if (!Number.isFinite(maiorValor) || maiorValor <= 0) return { topo: 1, ticks: [0, 1] };

  const ALVO = 5; // no máximo este tanto de intervalos
  let passo = 1;
  for (let k = 0; k < 12; k += 1) {
    const mag = 10 ** k;
    const candidato = [1, 2, 5].map((m) => m * mag).find((p) => maiorValor / p <= ALVO);
    if (candidato) {
      passo = candidato;
      break;
    }
  }

  const topo = Math.ceil(maiorValor / passo) * passo;
  const ticks: number[] = [];
  for (let t = 0; t <= topo; t += passo) ticks.push(t);
  return { topo, ticks };
}

function count(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("pt-BR");
}

/** 2026-09-22 → 22/09, sem passar por timezone (a string já é o dia certo). */
function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

type ChartRow = { day: string; label: string; opened: number; closed: number };

type Serie = "opened" | "closed";

function DailyTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  series?: Record<Serie, boolean>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{row.label}</div>
      {series?.opened && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_OPEN }} />
          <span className="text-muted-foreground">Abertos</span>
          <span className="ml-auto font-medium tabular-nums">{count(row.opened)}</span>
        </div>
      )}
      {series?.closed && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_CLOSED }} />
          <span className="text-muted-foreground">Concluídos</span>
          <span className="ml-auto font-medium tabular-nums">{count(row.closed)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * A legenda É o filtro: clicar apaga ou traz de volta a série, e a escala do
 * gráfico se refaz em cima do que sobrou.
 */
function SerieToggle({
  color,
  label,
  value,
  ativo,
  onToggle,
}: {
  color: string;
  label: string;
  value: number;
  ativo: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={ativo}
      aria-label={`${label}: ${count(value)}. Clique para ${ativo ? "ocultar" : "mostrar"} no gráfico`}
      className={cn(
        "flex items-baseline gap-2 rounded-md px-2 py-1 transition-colors",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !ativo && "opacity-55",
      )}
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[-2px] rounded-full border-2"
        style={{ borderColor: color, background: ativo ? color : "transparent" }}
      />
      <span className="text-2xl font-semibold tabular-nums">{count(value)}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </button>
  );
}

type Props = {
  data: DailyTickets | undefined;
  isLoading: boolean;
};

/**
 * Tickets abertos × concluídos, dia a dia, no período escolhido na tela.
 * Conta TICKET, não interação: um chamado com cinco follow-ups aparece uma vez
 * só, no dia em que nasceu. As duas barras não somam entre si — um ticket
 * aberto antes do período e fechado dentro dele só existe na barra verde.
 */
export function TicketsAbertosConcluidos({ data, isLoading }: Props) {
  const [series, setSeries] = useState<Record<Serie, boolean>>({ opened: true, closed: true });

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

  // O topo olha só para as séries ligadas: esconder "abertos" tem que soltar a
  // escala, senão as barras de "concluídos" continuam esmagadas no rodapé.
  const { topo, ticks } = useMemo(() => {
    const valores = rows.flatMap((r) => [series.opened ? r.opened : 0, series.closed ? r.closed : 0]);
    return escalaY(valores.length ? Math.max(...valores) : 0);
  }, [rows, series]);

  const nenhumaSerie = !series.opened && !series.closed;
  const semDados = rows.length === 0 || rows.every((r) => r.opened === 0 && r.closed === 0);

  // No macOS a barra de rolagem só aparece durante o gesto, então nada avisa
  // que o gráfico continua para o lado. Em vez de chutar um limite de dias,
  // mede: o aviso aparece exatamente quando há o que rolar.
  const areaRolagem = useRef<HTMLDivElement>(null);
  const [rola, setRola] = useState(false);
  useEffect(() => {
    const el = areaRolagem.current;
    if (!el) {
      setRola(false);
      return;
    }
    const medir = () => setRola(el.scrollWidth > el.clientWidth + 1);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [rows.length, nenhumaSerie, semDados, isLoading]);

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
            <div className="-mr-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <SerieToggle
                color={COLOR_OPEN}
                label="abertos"
                value={data?.total_opened ?? 0}
                ativo={series.opened}
                onToggle={() => setSeries((s) => ({ ...s, opened: !s.opened }))}
              />
              <SerieToggle
                color={COLOR_CLOSED}
                label="concluídos"
                value={data?.total_closed ?? 0}
                ativo={series.closed}
                onToggle={() => setSeries((s) => ({ ...s, closed: !s.closed }))}
              />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-[360px]">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : nenhumaSerie ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
              Nenhuma série selecionada — clique em “abertos” ou “concluídos” acima para trazer de volta.
            </div>
          ) : semDados ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Nenhum ticket neste período
            </div>
          ) : (
            <div className="flex h-full">
              {/* Coluna do eixo: mesmo domínio e mesma altura de eixo X da área que
                  rola, para a grade cair em cima dos valores certos. */}
              <div className="h-full shrink-0" style={{ width: LARGURA_EIXO }} aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ ...MARGEM, right: 0 }}>
                    <YAxis
                      width={LARGURA_EIXO}
                      domain={[0, topo]}
                      ticks={ticks}
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: "hsl(var(--chart-axis))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <XAxis dataKey="label" height={ALTURA_EIXO_X} tick={false} tickLine={false} axisLine={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div ref={areaRolagem} className="h-full flex-1 overflow-x-auto">
                <div className="h-full" style={{ minWidth: larguraMinimaDoGrafico(rows.length) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={MARGEM} barGap={2}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis
                        dataKey="label"
                        height={ALTURA_EIXO_X}
                        tick={{ fontSize: 12, fill: "hsl(var(--chart-axis))" }}
                        tickLine={false}
                        axisLine={{ stroke: "hsl(var(--chart-grid))" }}
                        // Todo dia do período tem rótulo — é para isso que a área rola.
                        interval={0}
                        minTickGap={0}
                      />
                      <YAxis hide domain={[0, topo]} ticks={ticks} allowDecimals={false} />
                      <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={<DailyTooltip series={series} />} />
                      {series.opened && (
                        <Bar name="Abertos" dataKey="opened" fill={COLOR_OPEN} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      )}
                      {series.closed && (
                        <Bar name="Concluídos" dataKey="closed" fill={COLOR_CLOSED} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>

        {rola && (
          <p className="text-xs text-muted-foreground">
            O período tem {rows.length} dias e todos estão no gráfico — role para o lado para ver o
            resto. A escala da esquerda fica parada.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
