import { z } from "zod";
import { isoDate, uuid } from "./common.js";

/**
 * Métricas.
 *
 * O formato preserva o que a tela da gestora já consome hoje
 * (`DashboardMetrics` em `useDashboardMetricsQuery.ts`), com os nomes em
 * camelCase do contrato. Preservar o formato é deliberado: a migração da
 * tela vira uma troca de origem, não uma reescrita de gráfico.
 *
 * A diferença está embaixo: em vez de uma função varrendo duas tabelas
 * com predicado não indexável, seis vezes por requisição, isto é uma
 * varredura de índice sobre a tabela de fatos.
 */

const fatia = z.object({ name: z.string(), value: z.number().int() });

export const metricsRangeQuery = z.object({
  from: isoDate,
  to: isoDate,
  /** Sem filtro, a gestora vê todos; o agente vê só a si. */
  agentId: uuid.optional(),
});
export type MetricsRangeQuery = z.infer<typeof metricsRangeQuery>;

export const dashboardMetricsResponse = z.object({
  /** Total de eventos contáveis: aberturas mais interações. */
  totalCount: z.number().int(),
  /** Só as aberturas, que é o número de atendimentos novos. */
  ticketCount: z.number().int(),
  /** Só as interações. */
  interactionCount: z.number().int(),
  /** Interações marcadas como repetição no mesmo dia. */
  sameDayRepeatCount: z.number().int(),

  byAgent: z.array(fatia.extend({ agentId: uuid })),
  byProduct: z.array(fatia),
  byDay: z.array(z.object({ day: isoDate, value: z.number().int() })),
  byPlatform: z.array(fatia),
  byChannel: z.array(fatia),
});
export type DashboardMetrics = z.infer<typeof dashboardMetricsResponse>;

/**
 * Métricas do próprio agente, para a barra de progresso e a tela de
 * "Minhas Métricas". Hoje são três RPCs separadas chamadas em laço.
 */
export const myMetricsResponse = z.object({
  today: z.object({
    day: isoDate,
    tickets: z.number().int(),
    interactions: z.number().int(),
    total: z.number().int(),
  }),
  range: z.object({
    from: isoDate,
    to: isoDate,
    tickets: z.number().int(),
    interactions: z.number().int(),
    total: z.number().int(),
    /** Dias em que houve algum registro, para calcular ritmo. */
    daysWorked: z.number().int(),
  }),
  byDay: z.array(z.object({ day: isoDate, value: z.number().int() })),
  byProduct: z.array(fatia),
});
export type MyMetrics = z.infer<typeof myMetricsResponse>;

// =====================================================================
// As quatro telas que faltavam da gestora
//
// Cada uma substitui uma RPC que chama `_interaction_events`. Os nomes
// de campo seguem o que a tela já consome, em camelCase, pelo mesmo
// motivo de antes: migrar a tela é trocar a origem, não reescrever.
// =====================================================================

/** Paginação numerada, mantida nas listas frias (decisão D7). */
export const pagedQuery = metricsRangeQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  page: z.coerce.number().int().min(1).default(1),
});
export type PagedQuery = z.infer<typeof pagedQuery>;

/**
 * Auditoria — substitui `dashboard_audit`.
 *
 * Lista evento por evento, na ordem do relógio. O `totalCount` sai do
 * mesmo recorte da contagem do painel, então os dois números batem por
 * construção, não por coincidência.
 */
export const auditRow = z.object({
  id: z.string(),
  kind: z.enum(["ticket", "interaction"]),
  ticketId: uuid,
  occurredAt: z.string(),
  day: isoDate,
  agentId: uuid,
  agentName: z.string().nullable(),
  clientEmail: z.string(),
  product: z.string(),
  platform: z.string().nullable(),
  channel: z.string().nullable(),
  status: z.string().nullable(),
  seq: z.number().int().nullable(),
});
export type AuditRow = z.infer<typeof auditRow>;

export const auditResponse = z.object({
  totalCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  items: z.array(auditRow),
});
export type AuditResponse = z.infer<typeof auditResponse>;

/**
 * Padrão por horário — substitui `dashboard_hourly_pattern`, que varre as
 * duas tabelas SETE vezes. Aqui é um percurso do eixo `occurred_at`.
 *
 * Atenção ao eixo: esta é a única rota que mede o INSTANTE do registro, e
 * não o dia declarado pelo agente. O recorte de data é convertido na
 * borda e comparado como faixa, para o índice servir.
 */
export const hourlyPatternResponse = z.object({
  /** 7×24 células, sempre completas — a tela desenha o mapa de calor. */
  byDowHour: z.array(
    z.object({
      dow: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      count: z.number().int(),
    }),
  ),
  total: z.number().int(),
  activeDays: z.number().int(),
  peak: z.object({
    dow: z.number().int().nullable(),
    hour: z.number().int().nullable(),
    count: z.number().int(),
  }),
  /** Mediana da primeira e da última atividade do dia, em horas decimais. */
  shift: z.object({
    startHour: z.number().nullable(),
    endHour: z.number().nullable(),
  }),
  /** Fração do volume por faixa do dia. Soma 1 quando há volume. */
  shiftsShare: z.object({
    morning: z.number(),
    afternoon: z.number(),
    evening: z.number(),
    night: z.number(),
  }),
  /**
   * A que hora a meta diária foi batida, na mediana.
   *
   * A meta é 150 para quem atendeu majoritariamente por SMS no período e
   * 100 para os demais — os valores de hoje, preservados. Pela decisão D3
   * eles viram configuração com vigência em `GET /metrics/compliance`;
   * até lá ficam aqui como constante, idênticos aos atuais.
   */
  goalHit: z.object({
    hour: z.number().nullable(),
    daysHit: z.number().int(),
    totalActiveDays: z.number().int(),
    threshold: z.number().int(),
  }),
});
export type HourlyPattern = z.infer<typeof hourlyPatternResponse>;

/**
 * Detalhe por canal — substitui `dashboard_channel_detail`.
 *
 * Uma linha por (canal, agente). `doneCount` conta tickets ABERTOS no
 * período que estão concluídos, creditados a quem abriu — a mesma regra
 * do legado, agora apoiada em `derived_status`, que é mantido por
 * gatilho em vez de recalculado por consulta.
 */
export const channelAgentRow = z.object({
  channel: z.string(),
  agentId: uuid,
  agentName: z.string(),
  newTickets: z.number().int(),
  doneCount: z.number().int(),
  interactions: z.number().int(),
  total: z.number().int(),
});
export type ChannelAgentRow = z.infer<typeof channelAgentRow>;

export const channelDetailResponse = z.object({
  byChannelAgent: z.array(channelAgentRow),
});
export type ChannelDetail = z.infer<typeof channelDetailResponse>;

/**
 * Detalhe por agente — substitui `dashboard_follow_up_detail`.
 *
 * Mantém a regra que a tela sempre teve: agente sem nenhum registro no
 * período **aparece zerado**, não desaparece da tabela.
 */
export const agentDetailRow = z.object({
  agentId: uuid,
  agentName: z.string(),
  totalTickets: z.number().int(),
  newTicketsCount: z.number().int(),
  interactionsCount: z.number().int(),
  doneCount: z.number().int(),
  /** Média de interações até concluir, nos tickets abertos no período. */
  avgInteractionsToClose: z.number(),
  /** Percentual de conclusão sobre o que o agente abriu. */
  completionRate: z.number(),
});
export type AgentDetailRow = z.infer<typeof agentDetailRow>;

export const agentDetailResponse = z.object({
  kpi: z.object({
    totalServices: z.number().int(),
    newTicketsCount: z.number().int(),
    interactionsCount: z.number().int(),
    doneCount: z.number().int(),
  }),
  byAgent: z.array(agentDetailRow),
  insights: z.object({
    topPerformer: z.object({
      agentId: uuid,
      agentName: z.string(),
      doneCount: z.number().int(),
      newTickets: z.number().int(),
      completionRate: z.number(),
    }).nullable(),
    mostNewTickets: z.object({
      agentId: uuid,
      agentName: z.string(),
      newTickets: z.number().int(),
    }).nullable(),
    mostProductive: z.object({
      agentId: uuid,
      agentName: z.string(),
      interactions: z.number().int(),
    }).nullable(),
  }),
});
export type AgentDetail = z.infer<typeof agentDetailResponse>;
