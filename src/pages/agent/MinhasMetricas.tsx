import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addDays, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Award,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useMyAgentMetricsQuery, type AgentMyMetrics } from "@/features/agent/useMyAgentMetricsQuery";
import { MonthlyReportSection } from "@/features/sla/MonthlyReportSection";

// ── Cores ─────────────────────────────────────────────────────────────────────
//
// Só duas séries no gráfico principal (novos / follow-ups) e elas precisam ser
// distinguíveis por quem tem daltonismo. Roxo + turquesa foi validado:
// ΔE 20.9 sob deuteranopia, 29.7 com visão normal — bem acima do piso.
// (O par roxo + azul que estava aqui antes dava ΔE 2.6 sob protanopia, ou seja,
// era a MESMA cor para boa parte das pessoas. Não voltar para ele.)
const COLOR_NOVOS      = "hsl(var(--chart-1))"; // roxo
const COLOR_FOLLOWUPS  = "hsl(var(--chart-6))"; // turquesa
const COLOR_MAGNITUDE  = "hsl(var(--chart-1))"; // hue única p/ canal/plataforma

// ── Helpers ────────────────────────────────────────────────────────────────────

function spToday(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function parseISOLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function fmtN(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

/** Ritmo sempre com 1 casa: "8,4". Duas casas viram ruído visual. */
function fmtRate(n: number) {
  return (Number(n) || 0).toFixed(1).replace(".", ",");
}

function fmtUsd(n: number) {
  return "$ " + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

// ── Referência da operação ────────────────────────────────────────────────────
//
// Item 3 do documento jurídico: nada de ranking, líder, posição ou "quanto falta
// para alcançar o time". A única comparação permitida é a mediana anônima do
// volume dos prestadores no mesmo período, ao lado do volume do próprio.
//
// Com poucos prestadores a mediana deixa de ser anônima (com 2 ela é a média de
// dois volumes conhecidos). A RPC já devolve 0 abaixo deste mínimo; a UI repete
// a regra para não depender só do banco.
const MIN_PROVIDERS_FOR_MEDIAN = 4;

/** Mesma divisão que a RPC usa para a tendência: metade do período até hoje. */
function trendHalves(fromISO: string, toISO: string) {
  const from = parseISOLocal(fromISO);
  const end  = parseISOLocal(toISO < spToday() ? toISO : spToday());
  const span = Math.round((end.getTime() - from.getTime()) / 86_400_000);
  if (span < 1) return null;
  const mid = addDays(from, Math.floor(span / 2));
  return {
    first:  `${format(from, "dd/MM")} a ${format(mid, "dd/MM")}`,
    second: `${format(addDays(mid, 1), "dd/MM")} a ${format(end, "dd/MM")}`,
  };
}

function fmtPct(n: number) {
  const v = Math.round(Number(n) || 0);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

// ── Barra "você vs referência" ──────────────────────────────────────────────────────

function VolumeBar({
  label,
  value,
  max,
  colorClass,
  strong,
}: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
  strong?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={cn("text-sm", strong ? "font-medium text-foreground" : "text-muted-foreground")}>
          {label}
        </span>
        <span className={cn("font-mono tabular-nums", strong ? "text-lg font-medium" : "text-sm text-muted-foreground")}>
          {fmtN(Math.round(value))}
          <span className="ml-1 text-xs font-normal text-muted-foreground">atendimentos</span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", colorClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── KPI simples, com uma linha de explicação em português claro ────────────────

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
  valueClass,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  loading: boolean;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <>
            <div className={cn("text-3xl font-normal font-mono tabular-nums tracking-[-0.03em]", valueClass)}>{value}</div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChartEmpty({ msg = "Nenhum dado no período" }: { msg?: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{msg}</div>;
}

/** Ordenado por magnitude → uma hue só. Cor diferente por categoria sugeriria
 *  uma identidade que esses cortes não têm. */
function BreakdownChart({ data, unit = "interações" }: { data: { name: string; value: number }[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={data} margin={{ top: 5, right: 28, left: 8, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--chart-grid))" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--chart-axis))" />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} stroke="hsl(var(--chart-axis))" />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))" }}
          formatter={(v: number) => [fmtN(v), unit]}
        />
        <Bar dataKey="value" fill={COLOR_MAGNITUDE} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

type PresetKey = "hoje" | "semana" | "mes" | "30d";

/** Linhas por página na tabela "Dia a dia". 10 cabe na tela sem rolar. */
const DAYS_PER_PAGE = 10;

export default function MinhasMetricas() {
  const { fullName, userId } = useOutletContext<AgentOutletContext>();

  const presets = useMemo(() => {
    const today = parseISOLocal(spToday());
    return {
      hoje:   { label: "Hoje",            range: { from: today, to: today } },
      semana: { label: "Esta semana",     range: { from: startOfWeek(today, { weekStartsOn: 1 }), to: today } },
      mes:    { label: "Este mês",        range: { from: startOfMonth(today), to: today } },
      "30d":  { label: "Últimos 30 dias", range: { from: addDays(today, -29), to: today } },
    } as Record<PresetKey, { label: string; range: DateRange }>;
  }, []);

  const [range, setRange] = useState<DateRange | undefined>(presets["30d"].range);
  const [dayPage, setDayPage] = useState(1);

  // Trocar o período muda a quantidade de linhas — sempre voltar para a página 1,
  // senão a pessoa clica em "Este mês" e cai numa página vazia.
  function changeRange(next: DateRange | undefined) {
    setRange(next);
    setDayPage(1);
  }

  const { fromISO, toISO } = useMemo(() => {
    const today = spToday();
    const from = range?.from ? spToday(range.from) : spToday(addDays(new Date(), -29));
    const to   = range?.to   ? spToday(range.to)   : (range?.from ? spToday(range.from) : today);
    return { fromISO: from, toISO: to };
  }, [range]);

  const activePreset = useMemo<PresetKey | null>(() => {
    const entries = Object.entries(presets) as [PresetKey, { range: DateRange }][];
    const hit = entries.find(
      ([, p]) => spToday(p.range.from!) === fromISO && spToday(p.range.to!) === toISO,
    );
    return hit ? hit[0] : null;
  }, [presets, fromISO, toISO]);

  const metricsQuery = useMyAgentMetricsQuery({ enabled: true, from: fromISO, to: toISO });
  const isLoading = metricsQuery.isLoading;
  const m = metricsQuery.data;

  const firstName = ((fullName ?? "").trim().split(/\s+/)[0]) || "Prestador";

  const myRate     = Number(m?.my_rate ?? 0);
  const myTotal    = Number(m?.total_interactions ?? 0);
  const medianTotal = Number(m?.team_median_total ?? 0);
  // team_size inclui o próprio agente, assim como a mediana.
  const showMedian = Number(m?.team_size ?? 0) >= MIN_PROVIDERS_FOR_MEDIAN && medianTotal > 0;
  const activeDays = Number(m?.active_days ?? 0);

  const halves = useMemo(() => trendHalves(fromISO, toISO), [fromISO, toISO]);

  const chartSeries = useMemo(() => {
    if (!m) return [];
    return (m.by_day ?? []).map((d) => ({
      day: format(parseISO(d.day), "dd/MM"),
      novos: d.services,
      followups: d.followups,
      total: d.value,
    }));
  }, [m]);

  // Tendência só como número: sem rótulo de julgamento e sem cor de "bom/ruim".
  const trendPct = Number(m?.trend_pct ?? 0);
  const TrendIcon = trendPct > 0 ? TrendingUp : trendPct < 0 ? TrendingDown : Minus;

  // Escala das barras: 15% de folga em cima do maior valor, para a barra cheia
  // nunca encostar na borda e sugerir "no máximo".
  const volumeMax = Math.max(myTotal, medianTotal, 1) * 1.15;

  // ── Paginação da tabela "Dia a dia" ─────────────────────────────────────────
  // Clampar em vez de sincronizar com efeito: se o período novo tiver menos
  // páginas que a página atual, cai na última válida sem render intermediário.
  const allDays   = m?.by_day ?? [];
  const pageCount = Math.max(1, Math.ceil(allDays.length / DAYS_PER_PAGE));
  const page      = Math.min(Math.max(dayPage, 1), pageCount);
  const pageStart = (page - 1) * DAYS_PER_PAGE;
  const pagedDays = allDays.slice(pageStart, pageStart + DAYS_PER_PAGE);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* ── Cabeçalho + período ──────────────────────────────────────────── */}
      <header className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">Olá, {firstName}!</p>
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Minhas Métricas</h1>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(Object.keys(presets) as PresetKey[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={activePreset === key ? "default" : "outline"}
              onClick={() => changeRange(presets[key].range)}
            >
              {presets[key].label}
            </Button>
          ))}
          <div className="ml-auto w-full sm:w-auto sm:min-w-[260px]">
            <DateRangePicker
              value={range}
              onChange={changeRange}
              className="border bg-background text-foreground hover:bg-accent"
            />
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Mostrando {format(parseISO(fromISO), "dd/MM/yyyy")} até {format(parseISO(toISO), "dd/MM/yyyy")}
        </p>
      </header>

      {/* ── 1. O número principal: seu ritmo ─────────────────────────────── */}
      {isLoading ? (
        <Skeleton className="mb-6 h-56 w-full rounded-xl" />
      ) : m ? (
        <Card className="mb-6 overflow-hidden">
          <CardContent className="p-0">
            <div className="grid gap-6 p-6 md:grid-cols-2">
              {/* Hero */}
              <div>
                <p className="text-sm font-medium text-muted-foreground">Seu ritmo</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-5xl font-medium font-mono tabular-nums leading-none">{fmtRate(myRate)}</span>
                  <span className="text-sm text-muted-foreground">atendimentos por dia com atendimentos</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {fmtN(m.total_interactions)} no total, em{" "}
                  <span className="font-medium text-foreground">
                    {activeDays} {plural(activeDays, "dia", "dias")}
                  </span>{" "}
                  com atendimentos.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Contamos por dia com atendimentos, não pelo total do mês.
                </p>
              </div>

              {/* Referência da operação */}
              <div className="space-y-4 md:border-l md:pl-6">
                <p className="text-sm font-medium text-muted-foreground">
                  Volume no período ({format(parseISO(fromISO), "dd/MM")} a {format(parseISO(toISO), "dd/MM")})
                </p>
                <VolumeBar label="Seu volume" value={myTotal} max={volumeMax} colorClass="bg-primary" strong />
                {showMedian ? (
                  <>
                    <VolumeBar
                      label="Referência da operação (mediana)"
                      value={medianTotal}
                      max={volumeMax}
                      colorClass="bg-muted-foreground/50"
                    />
                    <p className="text-xs leading-snug text-muted-foreground">
                      A mediana é o valor central dos volumes de atendimento dos prestadores no mesmo período. Por
                      exemplo: para volumes de 800, 1.000 e 1.500 atendimentos, a mediana é 1.000. Ela não identifica
                      nenhum prestador.
                    </p>
                  </>
                ) : (
                  <p className="text-xs leading-snug text-muted-foreground">
                    A referência da operação (mediana) aparece quando há prestadores suficientes no período para que
                    ela não identifique ninguém.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── 2. Três números de apoio ─────────────────────────────────────── */}
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total no período"
          value={fmtN(m?.total_interactions ?? 0)}
          hint={`${fmtN(m?.new_services ?? 0)} atendimentos novos e ${fmtN(m?.follow_ups ?? 0)} follow-ups (retornos em tickets que já existiam).`}
          icon={BarChart3}
          loading={isLoading}
        />
        <KpiCard
          label="Seu melhor dia"
          value={isLoading || !m?.best_day ? "—" : fmtN(m.best_day_count)}
          hint={
            m?.best_day
              ? `Foi em ${format(parseISO(m.best_day), "dd/MM")}. É a prova de que esse número cabe no seu dia.`
              : "Sem nenhum dia com atendimento neste período."
          }
          icon={Award}
          loading={isLoading}
        />
        <KpiCard
          label="Variação no período"
          value={isLoading || !m?.trend_reliable ? "—" : fmtPct(trendPct)}
          hint={
            !m?.trend_reliable || !halves
              ? "Poucos dias com atendimentos para comparar o começo com o fim do período."
              : `Atendimentos por dia com atendimentos de ${halves.second}, comparados com ${halves.first}.`
          }
          icon={TrendIcon}
          valueClass={m?.trend_reliable ? undefined : "text-muted-foreground"}
          loading={isLoading}
        />
      </section>

      {/* ── 3. Gráfico: cada dia do período ──────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Seus dias no período</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada barra é um dia. A altura é quanto você fez.
          </p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : chartSeries.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSeries} margin={{ top: 16, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--chart-grid))" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  minTickGap={20}
                  stroke="hsl(var(--chart-axis))"
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--chart-axis))" tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))" }}
                  formatter={(val: number, name: string) => [fmtN(val), name === "novos" ? "Novos" : "Follow-ups"]}
                />
                <Legend
                  formatter={(v) => (v === "novos" ? "Novos atendimentos" : "Follow-ups")}
                  wrapperStyle={{ fontSize: 12 }}
                />
                {/* stroke na cor da superfície = separador de 1,5px entre os
                    segmentos empilhados, sem inventar uma terceira cor */}
                <Bar dataKey="novos"     stackId="dia" fill={COLOR_NOVOS}     stroke="hsl(var(--card))" strokeWidth={1.5} maxBarSize={38} />
                <Bar dataKey="followups" stackId="dia" fill={COLOR_FOLLOWUPS} stroke="hsl(var(--card))" strokeWidth={1.5} maxBarSize={38} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── 4. Reembolsos ────────────────────────────────────────────────── */}
      <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.06em] text-muted-foreground">Reembolsos</h2>
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Em aberto"
          value={fmtN(m?.refunds_open ?? 0)}
          hint="Pedidos que você abriu no período e ainda não foram concluídos."
          icon={RefreshCw}
          loading={isLoading}
        />
        <KpiCard
          label="Concluídos"
          value={fmtN(m?.refunds_done ?? 0)}
          hint="Pedidos que receberam baixa dentro do período."
          icon={CheckCircle2}
          loading={isLoading}
        />
        <KpiCard
          label="Valor devolvido"
          value={isLoading ? "—" : fmtUsd(m?.refunds_total_value ?? 0)}
          hint="Soma dos reembolsos concluídos no período."
          icon={Wallet}
          loading={isLoading}
        />
      </section>

      {/* ── 5. Detalhes (fechado por padrão) ─────────────────────────────── */}
      <Accordion type="single" collapsible className="rounded-lg border bg-card px-4">
        <AccordionItem value="detalhes" className="border-none">
          <AccordionTrigger className="text-sm font-medium hover:no-underline">
            Ver detalhes — canal, plataforma e dia a dia
          </AccordionTrigger>
          <AccordionContent className="pb-6">
            <p className="mb-4 text-sm text-muted-foreground">
              Esses cortes descrevem de onde vieram os atendimentos. Quem escolhe o canal e a plataforma é o cliente,
              então eles servem para entender o período — não para cobrar de você.
            </p>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Por canal</CardTitle>
                </CardHeader>
                <CardContent className="h-[240px]">
                  {!m?.by_channel?.length ? <ChartEmpty /> : <BreakdownChart data={m.by_channel} />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Por plataforma</CardTitle>
                </CardHeader>
                <CardContent className="h-[240px]">
                  {!m?.by_platform?.length ? <ChartEmpty /> : <BreakdownChart data={m.by_platform} />}
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Dia a dia</CardTitle>
              </CardHeader>
              <CardContent>
                {!chartSeries.length ? (
                  <div className="py-10 text-center text-muted-foreground">Nenhum dado no período</div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Novos</TableHead>
                          <TableHead className="text-right">Follow-ups</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedDays.map((row) => {
                          return (
                            <TableRow key={row.day} className={row.value === 0 ? "opacity-50" : ""}>
                              <TableCell className="whitespace-nowrap">{format(parseISO(row.day), "dd/MM/yyyy")}</TableCell>
                              <TableCell className="text-right font-medium font-mono tabular-nums">{fmtN(row.value)}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{fmtN(row.services)}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{fmtN(row.followups)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {allDays.length > 0 && (
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Mostrando{" "}
                      <span className="font-medium text-foreground font-mono tabular-nums">
                        {pageStart + 1}–{pageStart + pagedDays.length}
                      </span>{" "}
                      de {fmtN(allDays.length)} {plural(allDays.length, "dia", "dias")}
                    </p>

                    {pageCount > 1 && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={page <= 1}
                          onClick={() => setDayPage(page - 1)}
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Anterior
                        </Button>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground">
                          Página {page} de {pageCount}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={page >= pageCount}
                          onClick={() => setDayPage(page + 1)}
                          aria-label="Próxima página"
                        >
                          Próxima
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <MonthlyReportSection userId={userId} />
    </main>
  );
}
