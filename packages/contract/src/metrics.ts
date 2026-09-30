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
