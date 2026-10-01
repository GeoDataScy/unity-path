import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addDays, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
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
  Crown,
  Minus,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useMyAgentMetricsQuery, type AgentMyMetrics } from "@/features/agent/useMyAgentMetricsQuery";

// ── Cores ─────────────────────────────────────────────────────────────────────
//
// Só duas séries no gráfico principal (novos / follow-ups) e elas precisam ser
// distinguíveis por quem tem daltonismo. Roxo + turquesa foi validado:
// ΔE 20.9 sob deuteranopia, 29.7 com visão normal — bem acima do piso.
// (O par roxo + azul que estava aqui antes dava ΔE 2.6 sob protanopia, ou seja,
// era a MESMA cor para boa parte das pessoas. Não voltar para ele.)
const COLOR_NOVOS      = "hsl(var(--chart-1))"; // roxo
const COLOR_FOLLOWUPS  = "hsl(var(--chart-6))"; // turquesa
const COLOR_MAGNITUDE  = "hsl(var(--chart-1))"; // hue única p/ ranking de canal/plataforma

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

// ── Mensagem principal ────────────────────────────────────────────────────────
//
// Regra: toda mensagem termina em algo que a pessoa PODE FAZER, com número
// contável. Nunca só "você está atrás" — isso informa o problema e não dá saída.

type Tone = "leader" | "ahead" | "onpar" | "action" | "empty";

interface Headline {
  title: string;
  message: string;
  tone: Tone;
}

function getHeadline(m: AgentMyMetrics): Headline {
  const total     = m.total_interactions ?? 0;
  const myRate    = Number(m.my_rate ?? 0);
  const median    = Number(m.team_median_rate ?? 0);
  const gap       = Number(m.gap_per_day ?? 0);
  const left      = Number(m.days_remaining ?? 0);
  const activeDays = Number(m.active_days ?? 0);

  if (total === 0) {
    return {
      title: "Nada registrado neste período",
      message: "Escolha outro período acima, ou comece a registrar — o primeiro atendimento do dia é o que destrava o resto.",
      tone: "empty",
    };
  }

  if (m.is_leader) {
    return {
      title: "Você foi quem mais atendeu no período",
      message: `${fmtN(total)} atendimentos em ${activeDays} ${plural(activeDays, "dia trabalhado", "dias trabalhados")}. Seu ritmo é ${fmtRate(myRate)} por dia. Segura esse ritmo.`,
      tone: "leader",
    };
  }

  // Sem time suficiente para comparar (agente sozinho no período).
  if (median <= 0) {
    return {
      title: `Seu ritmo é ${fmtRate(myRate)} por dia trabalhado`,
      message: `${fmtN(total)} atendimentos em ${activeDays} ${plural(activeDays, "dia", "dias")}. Ainda não dá para comparar com o time neste período.`,
      tone: "onpar",
    };
  }

  if (gap <= 0) {
    const aheadPct = median > 0 ? Math.round((myRate / median - 1) * 100) : 0;
    if (aheadPct <= 0) {
      return {
        title: "Você está no mesmo ritmo do time",
        message: `${fmtRate(myRate)} por dia trabalhado, igual à metade do time. Mais 1 por dia já te coloca na frente.`,
        tone: "onpar",
      };
    }
    return {
      title: `Você está ${aheadPct}% acima do time`,
      message: `Seu ritmo é ${fmtRate(myRate)} por dia trabalhado. A metade do time faz ${fmtRate(median)}. Continue assim.`,
      tone: "ahead",
    };
  }

  // Atrás: sempre vira alvo contável, nunca só "você está atrás".
  const catchUp = Math.ceil(gap * Math.max(left, 1));
  const projection =
    left >= 2
      ? ` São cerca de ${fmtN(catchUp)} atendimentos nos ${left} dias que faltam no período.`
      : "";

  return {
    title: `Faltam ${fmtRate(gap)} por dia para alcançar o time`,
    message: `Você faz ${fmtRate(myRate)} por dia trabalhado e a metade do time faz ${fmtRate(median)}.${projection}`,
    tone: "action",
  };
}

const TONE_CARD: Record<Tone, string> = {
  leader: "border-amber-400/70 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/25",
  ahead:  "border-emerald-400/70 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/25",
  onpar:  "border-border bg-card",
  action: "border-primary/50 bg-primary/5",
  empty:  "border-border bg-muted/40",
};

const TONE_ICON: Record<Tone, React.ElementType> = {
  leader: Crown,
  ahead:  TrendingUp,
  onpar:  Minus,
  action: Target,
  empty:  BarChart3,
};

const TONE_ICON_COLOR: Record<Tone, string> = {
  leader: "text-amber-500",
  ahead:  "text-emerald-600 dark:text-emerald-400",
  onpar:  "text-muted-foreground",
  action: "text-primary",
  empty:  "text-muted-foreground",
};

// ── Barra "você vs time" ──────────────────────────────────────────────────────

function RateBar({
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
          {fmtRate(value)}
          <span className="ml-1 text-xs font-normal text-muted-foreground">/dia</span>
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

/** Ranking por magnitude → uma hue só. Cor diferente por categoria sugeriria
 *  uma identidade que esses cortes não têm. */
function RankingChart({ data, unit = "interações" }: { data: { name: string; value: number }[]; unit?: string }) {
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
  const { fullName } = useOutletContext<AgentOutletContext>();

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

  const firstName = ((fullName ?? "").trim().split(/\s+/)[0]) || "Agente";

  const myRate     = Number(m?.my_rate ?? 0);
  const medianRate = Number(m?.team_median_rate ?? 0);
  const activeDays = Number(m?.active_days ?? 0);

  const headline = useMemo(() => (m ? getHeadline(m) : null), [m]);

  const chartSeries = useMemo(() => {
    if (!m) return [];
    return (m.by_day ?? []).map((d) => ({
      day: format(parseISO(d.day), "dd/MM"),
      novos: d.services,
      followups: d.followups,
      total: d.value,
    }));
  }, [m]);

  const trend = useMemo(() => {
    const pct = Number(m?.trend_pct ?? 0);
    if (pct >= 10)  return { Icon: TrendingUp,   cls: "text-emerald-600 dark:text-emerald-400" };
    if (pct <= -10) return { Icon: TrendingDown, cls: "text-destructive" };
    return { Icon: Minus, cls: "text-foreground" };
  }, [m]);

  // Escala das barras de ritmo: 15% de folga em cima do maior valor, para a
  // barra cheia nunca encostar na borda e sugerir "no máximo".
  const rateMax = Math.max(myRate, medianRate, 0.1) * 1.15;

  // ── Paginação da tabela "Dia a dia" ─────────────────────────────────────────
  // Clampar em vez de sincronizar com efeito: se o período novo tiver menos
  // páginas que a página atual, cai na última válida sem render intermediário.
  const allDays   = m?.by_day ?? [];
  const pageCount = Math.max(1, Math.ceil(allDays.length / DAYS_PER_PAGE));
  const page      = Math.min(Math.max(dayPage, 1), pageCount);
  const pageStart = (page - 1) * DAYS_PER_PAGE;
  const pagedDays = allDays.slice(pageStart, pageStart + DAYS_PER_PAGE);

  const HeadlineIcon = headline ? TONE_ICON[headline.tone] : BarChart3;

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
      ) : m && headline ? (
        <Card className="mb-6 overflow-hidden">
          <CardContent className="p-0">
            <div className="grid gap-6 p-6 md:grid-cols-2">
              {/* Hero */}
              <div>
                <p className="text-sm font-medium text-muted-foreground">Seu ritmo</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-5xl font-medium font-mono tabular-nums leading-none">{fmtRate(myRate)}</span>
                  <span className="text-sm text-muted-foreground">atendimentos por dia trabalhado</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {fmtN(m.total_interactions)} no total, em{" "}
                  <span className="font-medium text-foreground">
                    {activeDays} {plural(activeDays, "dia", "dias")}
                  </span>{" "}
                  que você trabalhou.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Contamos por dia trabalhado, não pelo total do mês — assim folga e férias não contam contra você.
                </p>
              </div>

              {/* Comparação */}
              <div className="space-y-4 md:border-l md:pl-6">
                <RateBar
                  label="Você"
                  value={myRate}
                  max={rateMax}
                  colorClass={myRate >= medianRate ? "bg-emerald-500" : "bg-primary"}
                  strong
                />
                <RateBar
                  label="Metade do time faz até"
                  value={medianRate}
                  max={rateMax}
                  colorClass="bg-muted-foreground/50"
                />
                <p className="text-xs leading-snug text-muted-foreground">
                  A referência é a <span className="font-medium text-foreground">mediana</span>: metade do time está
                  acima dela e metade abaixo. Usamos ela no lugar da média porque um único colega muito acima não
                  distorce o alvo de todo mundo.
                  {m.team_leader_name && !m.is_leader && (
                    <>
                      {" "}Quem mais atendeu no período foi{" "}
                      <span className="font-medium text-foreground">{m.team_leader_name}</span>, com{" "}
                      {fmtN(m.team_leader_count)}.
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Faixa de ação */}
            <div className={cn("flex items-start gap-3 border-t px-6 py-4", TONE_CARD[headline.tone])}>
              <HeadlineIcon className={cn("mt-0.5 h-5 w-5 shrink-0", TONE_ICON_COLOR[headline.tone])} />
              <div>
                <p className="font-medium">{headline.title}</p>
                <p className="text-sm text-muted-foreground">{headline.message}</p>
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
          label="Como você vem indo"
          value={isLoading ? "—" : !m?.trend_reliable ? "Sem leitura" : m.trend_label}
          hint={
            !m?.trend_reliable
              ? "Poucos dias trabalhados para comparar o começo com o fim do período sem virar chute."
              : `A segunda metade do período está ${Math.abs(Number(m?.trend_pct ?? 0))}% ${Number(m?.trend_pct ?? 0) >= 0 ? "acima" : "abaixo"} da primeira, comparando ritmo por dia trabalhado.`
          }
          icon={trend.Icon}
          valueClass={m?.trend_reliable ? trend.cls : "text-muted-foreground text-2xl"}
          loading={isLoading}
        />
      </section>

      {/* ── 3. Gráfico: cada dia do período ──────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Seus dias no período</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada barra é um dia. A altura é quanto você fez; a linha tracejada é o ritmo do time.
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
                {medianRate > 0 && (
                  <ReferenceLine
                    y={medianRate}
                    stroke="hsl(var(--chart-axis))"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    label={{
                      value: `Ritmo do time: ${fmtRate(medianRate)}`,
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: "hsl(var(--chart-axis))",
                    }}
                  />
                )}
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
                  {!m?.by_channel?.length ? <ChartEmpty /> : <RankingChart data={m.by_channel} />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Por plataforma</CardTitle>
                </CardHeader>
                <CardContent className="h-[240px]">
                  {!m?.by_platform?.length ? <ChartEmpty /> : <RankingChart data={m.by_platform} />}
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
                          <TableHead>Leitura</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedDays.map((row) => {
                          // Comparação contra o PRÓPRIO ritmo por dia trabalhado.
                          // Dia sem atividade não é "dia ruim" — é dia de folga.
                          const reading =
                            row.value === 0             ? "Sem atividade"
                            : myRate <= 0               ? "—"
                            : row.value > myRate * 1.2  ? "Dia forte"
                            : row.value < myRate * 0.8  ? "Dia fraco"
                            : "No seu ritmo";
                          const badge =
                            reading === "Dia forte"     ? "success"
                            : reading === "Dia fraco"   ? "destructive"
                            : reading === "Sem atividade" ? "open"
                            : "secondary";

                          return (
                            <TableRow key={row.day} className={row.value === 0 ? "opacity-50" : ""}>
                              <TableCell className="whitespace-nowrap">{format(parseISO(row.day), "dd/MM/yyyy")}</TableCell>
                              <TableCell className="text-right font-medium font-mono tabular-nums">{fmtN(row.value)}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{fmtN(row.services)}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{fmtN(row.followups)}</TableCell>
                              <TableCell>
                                <Badge variant={badge as any} className="text-xs">{reading}</Badge>
                              </TableCell>
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
    </main>
  );
}
