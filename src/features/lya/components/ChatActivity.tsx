import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Brain,
  Check,
  ClipboardCheck,
  Clock,
  Database,
  Loader2,
  RefreshCcw,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { LyaMemoriaSalva, LyaRevisao, LyaToolCall } from "../types";

// Indicadores de atividade da Lya: chips de ferramenta (qual tela/fonte ela
// consultou), o indicador "pensando", o card de memória gravada e as notas do
// verificador. Compartilhados pelo balão e pela tela cheia.

interface ToolInfo {
  area: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
}

const TOOL_INFO: Record<string, ToolInfo> = {
  painel_atendimentos: { area: "Atendimentos", detail: "Cards e gráficos da tela", icon: BarChart3, tone: "text-primary bg-primary/10" },
  painel_status_tickets: { area: "Atendimentos", detail: "Status dos tickets", icon: BarChart3, tone: "text-primary bg-primary/10" },
  painel_canais: { area: "Atendimentos", detail: "Detalhe por canal", icon: BarChart3, tone: "text-primary bg-primary/10" },
  painel_padrao_horarios: { area: "Atendimentos", detail: "Padrão de horários", icon: Clock, tone: "text-primary bg-primary/10" },
  painel_interacoes: { area: "Interações", detail: "KPIs e ranking por agente", icon: Activity, tone: "text-blue-600 bg-blue-500/10 dark:text-blue-400" },
  painel_repeticoes_mesmo_dia: { area: "Interações", detail: "Repetições no mesmo dia", icon: Activity, tone: "text-blue-600 bg-blue-500/10 dark:text-blue-400" },
  painel_reembolsos: { area: "Reembolsos", detail: "Métricas da tela", icon: RefreshCcw, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  painel_reembolsos_motivo: { area: "Reembolsos", detail: "Detalhe por motivo", icon: RefreshCcw, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  painel_alertas_reembolso: { area: "Alertas", detail: "Reembolsos em atraso", icon: AlertTriangle, tone: "text-destructive bg-destructive/10" },
  painel_usuarios: { area: "Usuários", detail: "Time e status online", icon: Users, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-400" },
  painel_pedidos_espera: { area: "Acompanhamento", detail: "Pedidos em espera", icon: ClipboardCheck, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-400" },
  listar_atendimentos: { area: "Atendimentos", detail: "Tabela de auditoria", icon: BarChart3, tone: "text-primary bg-primary/10" },
  listar_reembolsos: { area: "Reembolsos", detail: "Tabela de auditoria", icon: RefreshCcw, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  listar_agentes: { area: "Time", detail: "Lista de agentes", icon: Users, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-400" },
  consultar_banco: { area: "Banco de dados", detail: "Consulta SQL", icon: Database, tone: "text-muted-foreground bg-muted" },
  buscar_base_suporte: { area: "Base de Suporte", detail: "Produtos, brands e respostas", icon: BookOpen, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  gerar_grafico: { area: "Gráfico", detail: "Montando a visualização", icon: BarChart3, tone: "text-primary bg-primary/10" },
  salvar_memoria: { area: "Cérebro", detail: "Gravando o aprendizado", icon: Brain, tone: "text-primary bg-primary/10" },
};

function toolInfo(name: string): ToolInfo {
  return TOOL_INFO[name] ?? { area: "Fonte de dados", detail: name.replace(/_/g, " "), icon: Database, tone: "text-muted-foreground bg-muted" };
}

export function ToolActivity({ tools, active }: { tools: LyaToolCall[]; active: boolean }) {
  if (!tools.length) return null;
  const groups: { name: string; count: number }[] = [];
  for (const t of tools) {
    const last = groups[groups.length - 1];
    if (last && last.name === t.name) last.count += 1;
    else groups.push({ name: t.name, count: 1 });
  }
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {groups.map((g, gi) => {
        const info = toolInfo(g.name);
        const Icon = info.icon;
        const running = active && gi === groups.length - 1;
        return (
          <div
            key={gi}
            className={cn(
              "inline-flex w-fit items-center gap-2.5 rounded-xl border bg-card px-2.5 py-1.5",
              running ? "border-primary/40" : "border-border",
            )}
          >
            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg", info.tone)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[12px] text-muted-foreground">
                {running ? "Consultando" : "Consultou"} <span className="font-semibold text-foreground">{info.area}</span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {info.detail}
                {g.count > 1 ? ` · ${g.count} consultas` : ""}
              </span>
            </span>
            <span className="ml-1 shrink-0">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

export function ThinkingIndicator({ label = "Pensando" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-muted-foreground">
      <ThinkingDots />
      <span className="text-[13px] font-medium">{label}…</span>
    </span>
  );
}

export function LyaAvatar({ className }: { className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-violet-700 text-primary-foreground", className)}>
      <Sparkles className="h-[55%] w-[55%]" />
    </span>
  );
}

export function MemoryCard({ memoria }: { memoria: LyaMemoriaSalva }) {
  return (
    <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-2.5">
      <Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Aprendido · {memoria.type}</p>
        <p className="text-[13px] leading-snug text-foreground">{memoria.description}</p>
        {memoria.tags?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {memoria.tags.map((t) => (
              <span key={t} className="rounded-full bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Notas médias/baixas do verificador (as altas já entram no texto). */
export function RevisaoNotas({ revisao }: { revisao: LyaRevisao | null | undefined }) {
  if (!revisao) return null;
  const notas = revisao.ressalvas.filter((r) => r.gravidade === "media" && r.afirmacao && !r.afirmacao.startsWith("("));
  if (notas.length === 0) return null;
  return (
    <details className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">
      <summary className="cursor-pointer select-none">
        Revisão automática: {notas.length} ponto{notas.length > 1 ? "s" : ""} para conferir
      </summary>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        {notas.map((r, i) => (
          <li key={i}>
            <span className="text-foreground">{r.afirmacao}</span> — {r.motivo}
          </li>
        ))}
      </ul>
    </details>
  );
}
