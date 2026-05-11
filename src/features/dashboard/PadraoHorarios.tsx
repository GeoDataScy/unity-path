import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Clock, Coffee, Info, Moon, Sun, Sunset, Target, TrendingUp } from "lucide-react";

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

import type { HourlyPattern } from "./useDashboardHourlyPatternQuery";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOW_LABEL_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DOW_LABEL_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function decimalToHHMM(decimal: number | null | undefined): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  const total = Math.round(decimal * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  loading: boolean;
  data?: HourlyPattern;
};

export function PadraoHorarios({ loading, data }: Props) {
  const [topic, setTopic] = useState<null | "peak" | "start" | "end" | "goal" | "heatmap" | "shift">(null);

  const heatmap = useMemo(() => {
    if (!data?.by_dow_hour) return { rows: [] as number[][], maxCount: 0 };
    // by_dow_hour is already 168 entries (zero-filled). Build 7×24 matrix.
    const rows: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of data.by_dow_hour) {
      if (cell.dow >= 0 && cell.dow < 7 && cell.hour >= 0 && cell.hour < 24) {
        rows[cell.dow][cell.hour] = cell.count;
      }
    }
    let maxCount = 0;
    for (const r of rows) for (const c of r) if (c > maxCount) maxCount = c;
    return { rows, maxCount };
  }, [data]);

  // Shifts → pie data
  const shiftsPie = useMemo(() => {
    const s = data?.shifts_share;
    if (!s) return [];
    const items = [
      { name: "Manhã (5h-12h)", value: s.morning, fill: "hsl(var(--chart-warning))" },
      { name: "Tarde (12h-18h)", value: s.afternoon, fill: "hsl(var(--chart-info))" },
      { name: "Noite (18h-22h)", value: s.evening, fill: "hsl(var(--chart-1))" },
      { name: "Madrugada (22h-5h)", value: s.night, fill: "hsl(var(--chart-neutral))" },
    ];
    return items.filter((i) => i.value > 0);
  }, [data]);

  const goalHitRate = data && data.goal_hit.total_active_days > 0
    ? data.goal_hit.days_hit / data.goal_hit.total_active_days
    : 0;

  // Auto-insights
  const insights = useMemo(() => {
    if (!data) return [];
    const out: { icon: React.ReactNode; text: string }[] = [];
    if (data.peak.hour != null && data.peak.dow_name) {
      out.push({
        icon: <TrendingUp className="h-4 w-4 text-emerald-500" />,
        text: `O horário mais quente do time é ${data.peak.dow_name} às ${data.peak.hour}h, com ${data.peak.count} ações concentradas nessa hora.`,
      });
    }
    const businessHours = data.shifts_share.morning + data.shifts_share.afternoon;
    if (businessHours > 0) {
      out.push({
        icon: <Sun className="h-4 w-4 text-amber-500" />,
        text: `${pct(businessHours)} de toda a atividade acontece no horário comercial (8h–18h).`,
      });
    }
    if (data.goal_hit.hour != null && data.goal_hit.days_hit > 0) {
      out.push({
        icon: <Target className="h-4 w-4 text-primary" />,
        text: `Em média, a meta diária de ${data.goal_hit.threshold} é atingida por volta das ${decimalToHHMM(data.goal_hit.hour)} — em ${plural(data.goal_hit.days_hit, "dia", "dias")} dos ${data.goal_hit.total_active_days} dias com atividade no período.`,
      });
    } else if (data.goal_hit.total_active_days > 0) {
      out.push({
        icon: <Target className="h-4 w-4 text-rose-500" />,
        text: `A meta diária de ${data.goal_hit.threshold} não foi batida em nenhum dia do período. Vale revisar carga ou disponibilidade.`,
      });
    }
    if (data.shifts_share.night > 0.05) {
      out.push({
        icon: <Moon className="h-4 w-4 text-indigo-400" />,
        text: `${pct(data.shifts_share.night)} da atividade ocorre na madrugada (22h–5h). Confirme se isso é esperado.`,
      });
    }
    return out;
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Padrão de horários
          <span className="text-xs font-normal text-muted-foreground">
            (quando o time está mais ativo)
          </span>
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada quadradinho mostra quantos atendimentos foram feitos naquele dia da semana e naquela hora.
          Mais escuro = mais movimento. Clique nos cards para entender cada número.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Heatmap + KPI panel */}
        <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
          {loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : !data || data.total === 0 ? (
            <div className="flex h-[200px] items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
              Sem dados de atividade no período selecionado.
            </div>
          ) : (
            <Heatmap
              rows={heatmap.rows}
              maxCount={heatmap.maxCount}
              onClick={() => setTopic("heatmap")}
            />
          )}

          {/* KPI panel */}
          <div className="flex flex-col gap-2">
            <KpiButton onClick={() => setTopic("peak")} disabled={loading || !data}>
              <KpiHeader icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-500" />} label="Hora de pico" />
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {data?.peak.hour != null ? `${data.peak.hour}h` : "—"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {data?.peak.dow_name ? `${data.peak.dow_name} • ${data.peak.count} ações` : "Sem dados"}
              </div>
            </KpiButton>

            <KpiButton onClick={() => setTopic("start")} disabled={loading || !data}>
              <KpiHeader icon={<Coffee className="h-3.5 w-3.5 text-amber-500" />} label="Começa às" />
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {decimalToHHMM(data?.shift.start_hour)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">início típico do dia</div>
            </KpiButton>

            <KpiButton onClick={() => setTopic("end")} disabled={loading || !data}>
              <KpiHeader icon={<Sunset className="h-3.5 w-3.5 text-rose-500" />} label="Termina às" />
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {decimalToHHMM(data?.shift.end_hour)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">fim típico do dia</div>
            </KpiButton>

            <KpiButton onClick={() => setTopic("goal")} disabled={loading || !data}>
              <KpiHeader icon={<Target className="h-3.5 w-3.5 text-primary" />} label={`Bate meta às`} />
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {decimalToHHMM(data?.goal_hit.hour)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {data
                  ? `em ${data.goal_hit.days_hit} de ${data.goal_hit.total_active_days} dias (meta: ${data.goal_hit.threshold})`
                  : "sem dados"}
              </div>
            </KpiButton>
          </div>
        </div>

        {/* Shifts donut + bar */}
        {!loading && shiftsPie.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setTopic("shift")}
              className="mb-2 inline-flex items-center gap-1.5 rounded-md text-sm font-medium hover:underline"
            >
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              Distribuição por turno
            </button>
            <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip formatter={(v: number) => [pct(v), "Participação"]} contentStyle={{ fontSize: 12 }} />
                    <Pie
                      data={shiftsPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {shiftsPie.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {shiftsPie.map((s) => (
                  <div key={s.name}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.fill }} />
                        {s.name}
                      </span>
                      <span className="font-medium tabular-nums">{pct(s.value)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${s.value * 100}%`, backgroundColor: s.fill }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Auto insights */}
        {!loading && insights.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              O que esses dados estão dizendo
            </h4>
            <ul className="space-y-2">
              {insights.map((ins, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                  <span className="mt-0.5">{ins.icon}</span>
                  <span>{ins.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <ExplainDialog
        topic={topic}
        onClose={() => setTopic(null)}
        goalThreshold={data?.goal_hit.threshold ?? 100}
      />
    </Card>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

function Heatmap({
  rows,
  maxCount,
  onClick,
}: {
  rows: number[][];
  maxCount: number;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} className="cursor-pointer">
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th className="w-10" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="px-0.5 py-1 text-center font-normal text-muted-foreground">
                  {h % 3 === 0 ? `${h}h` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Render Mon–Sun (1..6, 0 last) so the week reads left-to-right */}
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
              <tr key={dow}>
                <td className="pr-2 text-right text-muted-foreground">{DOW_LABEL_SHORT[dow]}</td>
                {rows[dow].map((count, h) => {
                  const intensity = maxCount > 0 ? count / maxCount : 0;
                  const opacity = count === 0 ? 0 : 0.15 + intensity * 0.85;
                  return (
                    <td key={h} className="p-[1px]">
                      <div
                        className={cn(
                          "h-6 rounded-sm",
                          count === 0 ? "bg-muted/50" : "",
                        )}
                        style={count > 0 ? { backgroundColor: `hsl(var(--primary) / ${opacity})` } : undefined}
                        title={`${DOW_LABEL_FULL[dow]} ${h}h — ${count} ${count === 1 ? "ação" : "ações"}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Scale legend */}
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>menos</span>
        <div className="flex h-2.5 flex-1 max-w-[180px] overflow-hidden rounded-sm">
          {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((o, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: `hsl(var(--primary) / ${o})` }} />
          ))}
        </div>
        <span>mais</span>
      </div>
    </div>
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

function KpiHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <Info className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

// ── Explanatory dialogs ───────────────────────────────────────────────────────

function ExplainDialog({
  topic,
  onClose,
  goalThreshold,
}: {
  topic: null | "peak" | "start" | "end" | "goal" | "heatmap" | "shift";
  onClose: () => void;
  goalThreshold: number;
}) {
  const open = topic !== null;
  const content = topic ? CONTENTS[topic](goalThreshold) : null;

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
              <Section title="Em poucas palavras">
                <p className="text-muted-foreground">{content.simple}</p>
              </Section>
              <Section title="Como o sistema coleta esses horários">
                <p className="text-muted-foreground">{content.collection}</p>
              </Section>
              <Section title="Por que esse número apareceu aqui">
                <p className="text-muted-foreground">{content.why}</p>
              </Section>
              <Section title="Como ler o resultado">
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {content.howToRead.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </Section>
              {content.caveat && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <strong>Vale lembrar:</strong> {content.caveat}
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
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h4>
      {children}
    </div>
  );
}

type Explanation = {
  title: string;
  subtitle: string;
  simple: string;
  collection: string;
  why: string;
  howToRead: string[];
  caveat?: string;
};

const CONTENTS: Record<"peak" | "start" | "end" | "goal" | "heatmap" | "shift", (goal: number) => Explanation> = {
  heatmap: () => ({
    title: "Mapa de calor — quando o time trabalha",
    subtitle: "Cada quadradinho mostra um dia da semana e uma hora do dia.",
    simple:
      "É como uma agenda visual da semana inteira: linhas são os dias (Segunda, Terça...) e colunas são as horas (0h até 23h). Quanto mais escura a cor do quadrado, mais o time trabalhou naquele momento.",
    collection:
      "Toda vez que um agente cadastra um atendimento ou registra uma interação no sistema, fica gravado o horário exato em que aquilo aconteceu. O sistema pega esses horários e converte para o horário de São Paulo, depois separa cada um pelo dia da semana e pela hora do dia.",
    why:
      "O sistema empilha todas as ações do período escolhido em 168 quadradinhos (7 dias da semana × 24 horas). Cada vez que uma ação cai em um deles, o quadrado 'esquenta' um pouco. No final, os quadrados mais cheios ficam mais escuros — então é só bater o olho pra ver quando o time mais trabalha.",
    howToRead: [
      "Linhas = dia da semana (Seg, Ter, Qua...)",
      "Colunas = hora do dia (0h até 23h)",
      "Quanto mais escuro, mais ações naquela hora daquele dia",
      "Quadrados quase brancos = pouco ou nenhum trabalho",
      "Olhe o padrão geral: dias mais fortes? Horas mortas no meio do dia? Algo na madrugada?",
    ],
    caveat:
      "Se um quadrado isolado está muito escuro, pode ser cadastro em massa (alguém empilhou vários tickets de uma vez). Vale olhar o padrão geral, não só o quadrado mais escuro.",
  }),
  peak: () => ({
    title: "Hora de pico do time",
    subtitle: "O dia da semana e a hora em que o time mais trabalhou no período.",
    simple:
      "É o quadrado mais escuro do mapa de calor. Mostra exatamente em qual momento da semana o time estava com mais movimento.",
    collection:
      "O sistema usa o mesmo registro do mapa de calor: cada cadastro de atendimento e cada interação ficam guardados com o horário em que aconteceram, convertidos para o horário de São Paulo.",
    why:
      "Depois de contar quantas ações caíram em cada combinação de dia + hora, o sistema simplesmente escolhe a combinação com o maior número de ações. Se 'Quarta às 15h' tem 89 ações e nenhuma outra combinação chegou perto, esse é o pico.",
    howToRead: [
      "Aparece junto: dia da semana e hora (ex: 'Quarta às 15h')",
      "Útil pra saber em que momento garantir mais gente disponível",
      "Se o pico está muito concentrado, talvez o time precise distribuir melhor a carga",
    ],
    caveat:
      "Picos no início da manhã podem ser cadastro retroativo (atendimentos de ontem registrados hoje cedo). Vale conferir na tela 'Atendimentos' pra ter certeza.",
  }),
  start: () => ({
    title: "Hora típica de início do dia",
    subtitle: "Por volta de que horas o time costuma começar a trabalhar.",
    simple:
      "É a hora em que, na maioria dos dias, alguém do time fez a primeira ação. Funciona como um 'horário típico de chegada'.",
    collection:
      "Cada cadastro de atendimento e cada interação ficam guardados com o horário exato. O sistema, em cada dia que teve atividade, identifica o primeiro horário de cada um — o início do expediente daquele dia.",
    why:
      "Em vez de usar a média (que pode ser distorcida por dias estranhos, tipo alguém testando o sistema às 3h da madrugada), o sistema pega o valor 'do meio' da lista. Pra entender: se você ordenar todos os horários de início e olhar o que está bem no centro, esse é o número que aparece. Metade dos dias começou antes desse horário, metade começou depois.",
    howToRead: [
      "Se aparece 09:12, é por volta dessa hora que o time costuma chegar",
      "Comparar com o horário oficial de expediente ajuda a detectar atrasos frequentes",
      "Se o filtro está em um agente só, é só dele; se está em 'todos', é o time inteiro",
    ],
    caveat:
      "Se há cadastros retroativos (alguém lança hoje cedo um ticket que aconteceu ontem), o início pode parecer mais cedo do que de fato é. Vale cruzar com a tela 'Atendimentos'.",
  }),
  end: () => ({
    title: "Hora típica de fim do dia",
    subtitle: "Por volta de que horas o time costuma encerrar o expediente.",
    simple:
      "É a hora em que, na maioria dos dias, alguém do time fez a última ação. Funciona como um 'horário típico de saída'.",
    collection:
      "Mesmo registro usado nos outros cards: cada ação tem horário gravado. O sistema, em cada dia que teve atividade, identifica a última ação registrada — o fim do expediente daquele dia.",
    why:
      "Como no início do dia, o sistema pega o valor 'do meio' da lista (não a média), pra evitar que dias com horários muito atípicos puxem o número pra um lado ou pro outro. Resultado: metade dos dias terminou antes desse horário, metade depois.",
    howToRead: [
      "Se aparece 18:30, é por volta dessa hora que o time costuma encerrar",
      "Comparar com o horário esperado de saída ajuda a detectar excesso de horas",
      "Se está bem mais tarde do que o esperado, vale conferir disponibilidade",
    ],
    caveat:
      "Uma ação isolada tarde da noite pode mover o número, sem necessariamente significar que o time ficou trabalhando até tarde. Use junto com o início do dia pra estimar duração de turno.",
  }),
  goal: (goal) => ({
    title: `Hora em que a meta de ${goal} é batida`,
    subtitle: `Por volta de que horas o agente atinge ${goal} atendimentos no dia.`,
    simple:
      `Cada agente tem uma meta diária. Quando aparece ${goal} aqui, é porque a meta dele é ${goal} atendimentos por dia. Esse card mostra a hora típica em que essa meta cai — em média, durante o dia, em que momento ele bate o número.`,
    collection:
      `Toda vez que um agente cadastra um atendimento ou registra interação, o horário fica gravado. Pra cada dia em que ele teve atividade, o sistema enfileira todos esses momentos em ordem. Aí vai contando quantos tickets diferentes ele já tocou — quando o contador chega em ${goal}, anota a hora.`,
    why:
      `O sistema repete essa contagem pra cada dia, e no fim pega o valor 'do meio' da lista (não a média) pra evitar que um dia atípico distorça o resultado. Se o filtro for 'todos os agentes', primeiro calcula a hora típica de cada agente e depois junta. A meta é definida pelo canal mais usado pelo agente: SMS = 150, demais (Email/Clickbank) = 100.`,
    howToRead: [
      `O horário mostrado é uma estimativa típica de quando a meta é atingida`,
      "Quanto mais cedo, mais rápido o agente atinge o objetivo",
      "Se a meta nunca foi batida no período, o card mostra '—' e 'em 0 dias'",
      "A contagem 'em X de Y dias' é importante: se X for muito pequeno, o número é só um indicativo fraco",
    ],
    caveat:
      "Se a meta foi batida em poucos dias dentro do período, o horário típico pode não representar bem a realidade — olhe a contagem 'em X de Y dias' antes de tirar conclusões.",
  }),
  shift: () => ({
    title: "Distribuição por turno",
    subtitle: "Quanto da atividade total cai em cada parte do dia.",
    simple:
      "O dia foi dividido em 4 partes: manhã (5h–12h), tarde (12h–18h), noite (18h–22h) e madrugada (22h–5h). O gráfico mostra qual fatia do trabalho do time aconteceu em cada uma.",
    collection:
      "Os horários gravados em cada cadastro e em cada interação são usados pra classificar cada ação em uma dessas 4 partes do dia, com base no horário de São Paulo.",
    why:
      "O sistema soma quantas ações caíram em cada turno e calcula que porcentagem do total cada um representa. Por exemplo: se metade das ações aconteceu entre 12h e 18h, a tarde aparece com 50%.",
    howToRead: [
      "Em times com horário comercial, é esperado que manhã + tarde somem 80% ou mais",
      "Atividade alta em noite ou madrugada vale uma investigação",
      "Comparar períodos diferentes mostra se o padrão de trabalho está mudando",
    ],
  }),
};
