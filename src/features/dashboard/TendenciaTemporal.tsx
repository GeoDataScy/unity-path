import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Info, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Stats helpers ─────────────────────────────────────────────────────────────

type Regression = { slope: number; intercept: number; r2: number };

/**
 * Ordinary least-squares linear regression on y vs index.
 * Returns slope (units per day), intercept and R² (coefficient of determination).
 */
function linearRegression(values: number[]): Regression {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? values[0] : 0, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    const dy = values[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);

  return { slope, intercept, r2 };
}

/** Trailing simple moving average. Returns null for indices with insufficient data. */
function rollingMean(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    return sum / window;
  });
}

function addDaysISO(iso: string, days: number): string {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const fmt = (n: number, digits = 0) => new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(n);

// ── Types ─────────────────────────────────────────────────────────────────────

export type ByDayPoint = { day: string; value: number };

type Props = {
  loading: boolean;
  byDay: ByDayPoint[];
  /** Window for moving average (days). */
  movingWindow?: number;
  /** Forecast horizon (days). */
  forecastDays?: number;
};

// ── Main component ────────────────────────────────────────────────────────────

export function TendenciaTemporal({
  loading,
  byDay,
  movingWindow = 15,
  forecastDays = 7,
}: Props) {
  const [openTopic, setOpenTopic] = useState<null | "trend" | "r2" | "forecast" | "ma">(null);

  const chartData = useMemo(() => {
    if (!byDay || byDay.length === 0) {
      return { rows: [], stats: null as null | Regression, lastObservedISO: null as string | null };
    }

    const sorted = [...byDay].sort((a, b) => (a.day < b.day ? -1 : 1));
    const values = sorted.map((d) => d.value);
    const stats = linearRegression(values);
    const ma = rollingMean(values, Math.min(movingWindow, values.length));

    const lastObservedISO = sorted[sorted.length - 1].day;

    type Row = {
      day: string;
      label: string;
      value: number | null;
      ma: number | null;
      reg: number | null;
      forecast: number | null;
    };

    const rows: Row[] = sorted.map((d, i) => ({
      day: d.day,
      label: format(parseISO(d.day), "dd/MM"),
      value: d.value,
      ma: ma[i],
      reg: stats.slope * i + stats.intercept,
      forecast: null,
    }));

    // Forecast region: extends the regression line into the future. We attach
    // the last observed regression value to the first forecast row so the line
    // visually connects.
    const lastIdx = sorted.length - 1;
    rows[lastIdx].forecast = stats.slope * lastIdx + stats.intercept;
    for (let k = 1; k <= forecastDays; k++) {
      const idx = lastIdx + k;
      rows.push({
        day: addDaysISO(lastObservedISO, k),
        label: format(parseISO(addDaysISO(lastObservedISO, k)), "dd/MM"),
        value: null,
        ma: null,
        reg: null,
        forecast: stats.slope * idx + stats.intercept,
      });
    }

    return { rows, stats, lastObservedISO };
  }, [byDay, movingWindow, forecastDays]);

  const stats = chartData.stats;
  const slope = stats?.slope ?? 0;
  const r2 = stats?.r2 ?? 0;
  const meanY = useMemo(() => {
    if (!byDay.length) return 0;
    return byDay.reduce((s, d) => s + d.value, 0) / byDay.length;
  }, [byDay]);
  const projected = stats
    ? Math.max(0, Math.round(stats.slope * (byDay.length - 1 + forecastDays) + stats.intercept))
    : 0;

  // Verdict — label-only, with a deadband on small slopes that aren't
  // statistically meaningful (low R² or slope tiny relative to the mean).
  const slopeMagnitudeFraction = meanY > 0 ? Math.abs(slope) / meanY : 0;
  const significant = r2 >= 0.2 && slopeMagnitudeFraction >= 0.005;
  const verdict: "up" | "down" | "stable" = !significant ? "stable" : slope > 0 ? "up" : "down";

  const VerdictIcon = verdict === "up" ? TrendingUp : verdict === "down" ? TrendingDown : Activity;
  const verdictColor =
    verdict === "up" ? "text-success"
    : verdict === "down" ? "text-destructive"
    : "text-muted-foreground";
  const verdictLabel = verdict === "up" ? "Crescendo" : verdict === "down" ? "Caindo" : "Estável";

  const r2Quality =
    r2 >= 0.7 ? "alta"
    : r2 >= 0.4 ? "moderada"
    : r2 >= 0.2 ? "baixa"
    : "muito baixa";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Tendência temporal
          <span className="text-xs font-normal text-muted-foreground">
            (regressão linear · média móvel {movingWindow}d · projeção +{forecastDays}d)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          {/* Chart */}
          <div className="h-[340px]">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : !chartData.rows.length ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Nenhum dado encontrado neste período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tendArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-mute-2))" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="hsl(var(--chart-mute-2))" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(val: number | null, name: string) => {
                      if (val == null) return ["—", name];
                      const labelMap: Record<string, string> = {
                        value: "Atendimentos",
                        ma: `Média móvel ${movingWindow}d`,
                        reg: "Tendência (regressão)",
                        forecast: "Projeção",
                      };
                      return [fmt(Math.round(val)), labelMap[name] ?? name];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--chart-mute-1))"
                    fill="url(#tendArea)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ma"
                    stroke="hsl(var(--chart-info))"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="reg"
                    stroke={verdict === "down" ? "hsl(var(--chart-danger))" : "hsl(var(--chart-success))"}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    stroke="hsl(var(--chart-warning))"
                    strokeWidth={2}
                    strokeDasharray="3 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* KPI panel */}
          <div className="flex flex-col gap-2">
            <KpiButton onClick={() => setOpenTopic("trend")} disabled={loading || !stats}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Tendência</span>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className={cn("mt-1 flex items-baseline gap-1.5 text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]", verdictColor)}>
                <VerdictIcon className="h-5 w-5" />
                {slope >= 0 ? "+" : ""}{fmt(slope, 1)}
                <span className="text-xs font-normal text-muted-foreground">/dia</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{verdictLabel}</div>
            </KpiButton>

            <KpiButton onClick={() => setOpenTopic("r2")} disabled={loading || !stats}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Confiança (R²)</span>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="mt-1 text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]">{fmt(r2, 2)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">qualidade {r2Quality}</div>
            </KpiButton>

            <KpiButton onClick={() => setOpenTopic("forecast")} disabled={loading || !stats}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Projeção (+{forecastDays}d)</span>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5 text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]">
                <Sparkles className="h-4 w-4 text-warning" />
                ~{fmt(projected)}
                <span className="text-xs font-normal text-muted-foreground">/dia</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">se o ritmo continuar</div>
            </KpiButton>

            <KpiButton onClick={() => setOpenTopic("ma")} disabled={loading || !stats}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Média móvel {movingWindow}d</span>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">linha azul tracejada</div>
            </KpiButton>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
          <Legend swatch="bg-chart-mute-2/40 border border-chart-mute-1" label="Atendimentos por dia (real)" />
          <Legend swatch="border-2 border-info border-dashed" label={`Média móvel ${movingWindow} dias`} />
          <Legend swatch={cn("border-2", verdict === "down" ? "border-destructive" : "border-success")} label="Tendência (regressão linear)" />
          <Legend swatch="border-2 border-warning border-dashed" label={`Projeção +${forecastDays} dias`} />
        </div>
      </CardContent>

      {/* Explanatory dialog */}
      <ExplainDialog
        topic={openTopic}
        onClose={() => setOpenTopic(null)}
        movingWindow={movingWindow}
        forecastDays={forecastDays}
      />
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 text-left transition",
        "hover:bg-accent hover:shadow-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-4 rounded-sm", swatch)} />
      {label}
    </span>
  );
}

function ExplainDialog({
  topic,
  onClose,
  movingWindow,
  forecastDays,
}: {
  topic: null | "trend" | "r2" | "forecast" | "ma";
  onClose: () => void;
  movingWindow: number;
  forecastDays: number;
}) {
  const open = topic !== null;
  const content = topic ? CONTENTS[topic](movingWindow, forecastDays) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        {content && (
          <>
            <DialogHeader>
              <DialogTitle>{content.title}</DialogTitle>
              <DialogDescription>{content.subtitle}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <Section title="O que isso significa, sem matematiquês:">
                <p className="text-muted-foreground">{content.simple}</p>
              </Section>
              <Section title="Como o sistema chega nesse número:">
                <p className="text-muted-foreground">{content.how}</p>
              </Section>
              <Section title="A fórmula matemática:">
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                  {content.formula}
                </pre>
              </Section>
              <Section title="Como ler o resultado:">
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {content.howToRead.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </Section>
              {content.caveat && (
                <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-xs text-ink">
                  <strong>Importante:</strong> {content.caveat}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-foreground">{title}</h4>
      {children}
    </div>
  );
}

// ── Explanatory copy ──────────────────────────────────────────────────────────

type Explanation = {
  title: string;
  subtitle: string;
  simple: string;
  how: string;
  formula: string;
  howToRead: string[];
  caveat?: string;
};

const CONTENTS: Record<"trend" | "r2" | "forecast" | "ma", (mw: number, fd: number) => Explanation> = {
  trend: () => ({
    title: "Tendência (atendimentos por dia)",
    subtitle: "Quantos atendimentos a mais (ou a menos) o time vem fazendo, em média, a cada dia que passa.",
    simple:
      "Imagine que cada dia desse período é um pontinho no gráfico. Se você desenhar a melhor reta possível passando pelo meio de todos esses pontinhos — sem subir nem descer demais pra nenhum lado — a inclinação dessa reta é a sua tendência. Se a reta sobe, o time está acelerando. Se desce, está perdendo ritmo. Se está reta, o volume está estável.",
    how:
      "O sistema pega cada dia e o respectivo total de atendimentos, transforma em coordenadas (dia, total) e calcula a reta que passa o mais perto possível de todos os pontos ao mesmo tempo. Em estatística esse método se chama 'regressão linear por mínimos quadrados' — ele acha a reta que minimiza a distância elevada ao quadrado entre cada ponto real e a reta.",
    formula:
`slope = (n · Σ(x · y) − Σx · Σy) / (n · Σx² − (Σx)²)
intercept = (Σy − slope · Σx) / n

x = índice do dia (0, 1, 2, ...)
y = atendimentos no dia
n = quantidade de dias`,
    howToRead: [
      "Número positivo (verde) = volume crescendo dia a dia",
      "Número negativo (vermelho) = volume caindo dia a dia",
      "Número próximo de zero = estável",
      "O valor é em 'atendimentos por dia' — um +2,5 quer dizer que o time está adicionando ~2,5 atendimentos a cada dia que passa",
    ],
    caveat:
      "Tendência sozinha pode ser enganosa se os dados forem muito ruidosos. Olhe o R² ao lado — se for baixo, a tendência é menos confiável.",
  }),

  r2: () => ({
    title: "R² — confiança da tendência",
    subtitle: "Quão bem a reta de tendência consegue 'explicar' os dados reais. Vai de 0 a 1.",
    simple:
      "Imagine que você quer prever se vai chover amanhã olhando a barriga do gato. Às vezes acerta, mas a barriga do gato não tem nada a ver com chuva — sua taxa de acerto é igual a chute. Agora imagine olhar o radar meteorológico — a relação é forte e os acertos são altos. R² mede exatamente isso: quão fortemente a reta de tendência 'segue' os pontos reais.",
    how:
      "O sistema calcula duas coisas: (1) quanto os pontos variam em relação à média geral e (2) quanto eles variam em relação à reta de tendência. Quanto menor a segunda variação, melhor a reta está representando os dados. R² é a fração da variação total que a reta consegue explicar.",
    formula:
`R² = 1 − Σ(y − ŷ)² / Σ(y − ȳ)²

ŷ = valor que a reta prevê para o dia y
ȳ = média de todos os y observados`,
    howToRead: [
      "0,00 a 0,20 — muito baixa: os dados oscilam demais; a tendência mostrada é mais palpite que regra",
      "0,20 a 0,40 — baixa: existe uma direção, mas com bastante ruído",
      "0,40 a 0,70 — moderada: tendência razoavelmente clara",
      "0,70 a 1,00 — alta: a reta descreve bem o comportamento do time",
    ],
    caveat:
      "R² alto não significa 'o futuro está garantido'. Significa apenas que o passado seguiu uma reta com pouca dispersão. Promoções, contratações, feriados, tudo pode mudar o cenário a partir de hoje.",
  }),

  forecast: (_mw, fd) => ({
    title: `Projeção (+${fd} dias)`,
    subtitle: `Estimativa de quantos atendimentos por dia o time vai fazer daqui ${fd} dias se o ritmo atual continuar.`,
    simple:
      "Imagine que você está em um carro a uma velocidade constante. Se a velocidade não mudar, dá pra calcular onde você vai estar daqui a 5 minutos: é só multiplicar. A projeção faz exatamente isso com os atendimentos: pega a velocidade de crescimento atual (a tendência) e estende a reta por mais alguns dias à frente.",
    how:
      `O sistema usa a mesma reta de tendência (regressão linear) calculada acima, e calcula o valor que ela teria daqui a ${fd} dias. Não é 'inteligência artificial' — é geometria pura: você prolonga a reta.`,
    formula:
`projeção(d) = slope · (índice_do_dia) + intercept

Para hoje + ${fd} dias:
y(hoje + ${fd}) = slope · (último_índice + ${fd}) + intercept`,
    howToRead: [
      `O número mostra o volume diário esperado em ${fd} dias`,
      "Se a tendência for negativa, a projeção vai ser menor que hoje (alerta)",
      "Quanto menor o R², menos confiável é a projeção",
    ],
    caveat:
      `Esta projeção assume que NADA muda — nenhum agente é contratado/demitido, nenhuma campanha é lançada, nenhum feriado, etc. Use como sinalização de tendência, não como meta. Para horizontes maiores que ${fd} dias, a confiabilidade cai rapidamente.`,
  }),

  ma: (mw) => ({
    title: `Média móvel de ${mw} dias`,
    subtitle: "Mostra o 'volume típico' da última quinzena, suavizando o ruído diário.",
    simple:
      `Imagine que cada dia tem um humor próprio: segunda costuma ter X atendimentos, sexta tem outro número, fim de semana é diferente ainda. Olhar dia a dia confunde — você vê altos e baixos sem saber qual é a real. A média móvel pega os últimos ${mw} dias seguidos e tira a média. O resultado é uma linha mais lisa que mostra o nível geral, sem o sobe-desce dos dias individuais.`,
    how:
      `Para cada dia do gráfico, o sistema soma os valores dos ${mw} dias anteriores (incluindo o próprio) e divide por ${mw}. Como os primeiros ${mw - 1} dias não têm histórico suficiente, a linha começa a aparecer só a partir do dia ${mw}.`,
    formula:
`MM(dia) = (y(dia−${mw - 1}) + y(dia−${mw - 2}) + ... + y(dia)) / ${mw}`,
    howToRead: [
      "Se a curva real cruza a média móvel pra cima, é um sinal de aceleração",
      "Se cruza pra baixo, possível desaceleração",
      "Se ela está plana, o volume está estável apesar do ruído diário",
    ],
  }),
};
