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
      { name: "Manhã (5h-12h)", value: s.morning, fill: "hsl(38 92% 50%)" },
      { name: "Tarde (12h-18h)", value: s.afternoon, fill: "hsl(221 83% 55%)" },
      { name: "Noite (18h-22h)", value: s.evening, fill: "hsl(262 80% 60%)" },
      { name: "Madrugada (22h-5h)", value: s.night, fill: "hsl(220 9% 46%)" },
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
              <Section title="O que isso significa, sem matematiquês:">
                <p className="text-muted-foreground">{content.simple}</p>
              </Section>
              <Section title="Como o sistema chega nesse número:">
                <p className="text-muted-foreground">{content.how}</p>
              </Section>
              {content.formula && (
                <Section title="A fórmula matemática:">
                  <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                    {content.formula}
                  </pre>
                </Section>
              )}
              <Section title="Como ler o resultado:">
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {content.howToRead.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </Section>
              {content.caveat && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
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
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h4>
      {children}
    </div>
  );
}

type Explanation = {
  title: string;
  subtitle: string;
  simple: string;
  how: string;
  formula?: string;
  howToRead: string[];
  caveat?: string;
};

const CONTENTS: Record<"peak" | "start" | "end" | "goal" | "heatmap" | "shift", (goal: number) => Explanation> = {
  heatmap: () => ({
    title: "Mapa de calor — quando o time trabalha",
    subtitle: "Cada quadradinho representa um dia da semana e uma hora do dia.",
    simple:
      "Imagine que você anotou em um caderno toda vez que alguém fez um atendimento, e marcou em qual dia da semana e em qual hora. Depois você empilha tudo: terça às 10h tem muitas marcações? O quadradinho fica escuro. Domingo às 4h da manhã tem nenhuma? Fica claro. Esse mapa é exatamente isso, mas o sistema desenha pra você.",
    how:
      "O sistema converte cada atendimento e cada interação para o horário de São Paulo, separa por dia da semana (de domingo a sábado) e por hora do dia (de 0h até 23h), e conta quantos eventos caíram em cada combinação. Cada combinação vira um quadradinho colorido — quanto mais eventos, mais escura a cor.",
    howToRead: [
      "Linhas mostram o dia da semana (Seg, Ter, Qua...)",
      "Colunas mostram a hora do dia (0h até 23h)",
      "Quanto mais escuro o quadrado, mais o time trabalhou naquele momento",
      "Quadrados claros (quase brancos) = pouco ou nenhum trabalho",
      "Olhe o padrão geral: existem dias mais fortes? Há horários mortos no meio do dia?",
    ],
    caveat:
      "Se uma hora isolada está muito quente, pode ser cadastro em massa (alguém empilhou registros). Olhe o padrão geral, não só o quadradinho mais escuro.",
  }),
  peak: () => ({
    title: "Hora de pico do time",
    subtitle: "A combinação de dia da semana + hora do dia em que o time mais trabalhou.",
    simple:
      "É o quadradinho mais escuro do mapa. Mostra exatamente em qual momento da semana o time estava mais ativo no período escolhido.",
    how:
      "O sistema percorre todos os 168 quadrados (7 dias × 24 horas) do mapa de calor e escolhe aquele com o maior número de atendimentos+interações.",
    formula: `pico = MAX(contagem) sobre todos os pares (dia_da_semana, hora_do_dia)`,
    howToRead: [
      "Mostra dia da semana e hora juntos: 'Quarta às 15h'",
      "Útil pra escalar gente nesse horário (não deixar ninguém faltando)",
      "Útil pra entender se o time concentra esforço em um único pico (ruim) ou se distribui bem (bom)",
    ],
    caveat:
      "Pico isolado pode ser cadastro retroativo em massa, especialmente nas primeiras horas da manhã. Cruze com a tela de 'Atendimentos' pra confirmar.",
  }),
  start: () => ({
    title: "Hora típica de início do dia",
    subtitle: "Por volta de que horas o time costuma começar a trabalhar.",
    simple:
      "Em cada dia que o time teve atividade, o sistema anota a hora do PRIMEIRO atendimento ou interação. Depois pega o valor 'do meio' dessa lista. Esse valor é a hora típica de início.",
    how:
      "Para cada dia com atividade no período, registramos o horário da primeira ação. Tiramos a MEDIANA — o valor central — em vez da média comum. Mediana é mais robusta: um dia com início estranho (ex: alguém abriu o sistema às 3h da manhã pra testar) não distorce o resultado.",
    formula: `inicio = MEDIANA(hora_da_primeira_atividade) por dia`,
    howToRead: [
      "Se o resultado é 09:12, significa que tipicamente alguém do time começa por volta dessa hora",
      "Mediana = no meio: metade dos dias começou antes, metade começou depois",
      "Comparar com o expediente esperado ajuda a detectar atrasos crônicos",
    ],
    caveat:
      "Se há cadastros retroativos (lançar tickets de ontem hoje de manhã), pode parecer que o dia começa cedo demais. Olhe junto com a tela de 'Atendimentos' pra confirmar.",
  }),
  end: () => ({
    title: "Hora típica de fim do dia",
    subtitle: "Por volta de que horas o time costuma encerrar a atividade.",
    simple:
      "Mesma ideia do início, só que olhando o ÚLTIMO atendimento ou interação de cada dia. O sistema pega a hora da última ação por dia, e mostra o valor 'do meio' dessa lista.",
    how:
      "Para cada dia com atividade, registramos o horário da última ação. Tiramos a mediana — o valor central — para evitar que dias atípicos puxem o resultado.",
    formula: `fim = MEDIANA(hora_da_ultima_atividade) por dia`,
    howToRead: [
      "Se o resultado é 18:30, é por volta dessa hora que o time costuma parar",
      "Comparar com a hora esperada de fim ajuda a detectar excesso de horas",
      "Se o número está muito tarde, vale checar disponibilidade do time",
    ],
    caveat:
      "Atividade tarde da noite pode ser cadastro pontual e não significa que o time trabalhou todo o tempo. Use a hora de fim em conjunto com a hora de início para estimar duração de turno.",
  }),
  goal: (goal) => ({
    title: `Hora em que a meta de ${goal} é batida`,
    subtitle: `Em média, em que momento do dia o agente cruza a meta de ${goal} atendimentos.`,
    simple:
      `Imagine que cada agente tem uma meta diária — ${goal} atendimentos no caso. O sistema acompanha cada dia e olha em que hora o agente chegou nesses ${goal}. Depois pega o valor 'do meio' dessas horas (mediana). Se o número é 14:35, na maioria dos dias em que a meta foi batida, ela foi batida por volta dessa hora.`,
    how:
      `Para cada dia em que o agente teve atividade, ordenamos os atendimentos por hora e contamos quantos tickets DISTINTOS já tinham sido tocados. Quando esse contador chega em ${goal}, registramos a hora. Repetimos pra todos os dias do período e pegamos a mediana. Se o filtro for 'todos os agentes', primeiro calculamos por agente e depois tiramos a mediana entre os agentes.`,
    formula:
`Para cada (agente, dia):
  ordenar atividades por timestamp
  contar tickets distintos cumulativos
  hora_meta = primeira hora em que cumulativo = ${goal}

bate_meta = MEDIANA(hora_meta) sobre todos os pares (agente, dia)`,
    howToRead: [
      `O número mostra a hora típica em que o agente atinge ${goal} atendimentos`,
      "Quanto mais cedo, mais produtivo é o agente",
      "Se a meta nunca é batida, o número aparece como '—' e a contagem 'em 0 dias'",
      "A meta é definida pelo canal majoritário do agente: SMS = 150, demais = 100",
    ],
    caveat:
      "Esta é a hora MEDIANA — metade dos dias batem antes, metade batem depois. Se o time bate meta poucas vezes (poucos dias 'hit'), o número pode ser pouco representativo. Olhe junto com a contagem 'em X de Y dias'.",
  }),
  shift: () => ({
    title: "Distribuição por turno",
    subtitle: "Quanto da atividade total acontece em cada parte do dia.",
    simple:
      "O dia foi dividido em 4 partes: manhã (5h-12h), tarde (12h-18h), noite (18h-22h) e madrugada (22h-5h). O sistema conta cada atendimento ou interação e calcula a participação percentual de cada turno no total.",
    how:
      "Cada atendimento e cada interação é classificado pelo turno em que aconteceu, com base na hora do dia em São Paulo. Depois somamos tudo e calculamos cada turno como porcentagem do total.",
    formula: `participação(turno) = atividades_do_turno / total_de_atividades × 100%`,
    howToRead: [
      "Em equipes com horário comercial, é normal ver 80%+ entre Manhã e Tarde",
      "Atividade significativa em Noite ou Madrugada merece investigação",
      "Comparar entre períodos diferentes mostra mudanças no padrão de trabalho",
    ],
  }),
};
