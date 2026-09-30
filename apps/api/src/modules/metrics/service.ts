import type { DashboardMetrics, MetricsRangeQuery, MyMetrics } from "@xmx/contract";
import type { Tx } from "../../db.js";
import type { Caller } from "../../middleware/auth.js";

/**
 * Métricas, lidas da tabela de fatos.
 *
 * A regra que define tudo aqui: **uma requisição materializa a base uma
 * vez** (G11.2). O legado chama `_interaction_events` seis vezes numa
 * chamada de `dashboard_metrics`, cada vez varrendo duas tabelas com
 * predicado não indexável. Aqui o recorte entra num CTE e os cinco
 * agrupamentos saem dele.
 */

const toDay = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Dia de hoje em São Paulo. O fuso de negócio só é aplicado na borda. */
export const hojeSP = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export async function dashboardMetrics(
  tx: Tx,
  q: MetricsRangeQuery,
): Promise<DashboardMetrics> {
  const params = [q.from, q.to, q.agentId ?? null];

  // Um único percurso da tabela de fatos alimenta os cinco agrupamentos.
  // Sem o CTE seriam cinco varreduras — o erro que o legado comete.
  const [row] = await tx.unsafe<Array<Record<string, any>>>(
    `
    WITH recorte AS (
      SELECT f.day, f.agent_id, f.kind, f.is_same_day_repeat,
             f.product_id, f.platform_id, f.channel_id
        FROM core.interaction_facts f
       WHERE f.day BETWEEN $1::date AND $2::date
         AND ($3::uuid IS NULL OR f.agent_id = $3::uuid)
    )
    SELECT
      (SELECT count(*) FROM recorte)                                      AS total,
      (SELECT count(*) FROM recorte WHERE kind = 'ticket')                AS tickets,
      (SELECT count(*) FROM recorte WHERE kind = 'interaction')           AS interacoes,
      (SELECT count(*) FROM recorte WHERE is_same_day_repeat)             AS repeticoes,

      (SELECT coalesce(jsonb_agg(x ORDER BY x->>'value' DESC), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('agentId', r.agent_id,
                                   'name', coalesce(u.full_name, u.email),
                                   'value', count(*)) x
           FROM recorte r JOIN core.users u ON u.id = r.agent_id
          GROUP BY r.agent_id, u.full_name, u.email) a)                   AS por_agente,

      (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('name', p.name, 'value', count(*)) x
           FROM recorte r JOIN core.products p ON p.id = r.product_id
          GROUP BY p.name ORDER BY count(*) DESC) b)                      AS por_produto,

      (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('day', r.day, 'value', count(*)) x
           FROM recorte r GROUP BY r.day ORDER BY r.day) c)               AS por_dia,

      (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('name', coalesce(sp.label, 'Não preenchido'),
                                   'value', count(*)) x
           FROM recorte r LEFT JOIN core.sales_platforms sp ON sp.id = r.platform_id
          GROUP BY sp.label ORDER BY count(*) DESC) d)                    AS por_plataforma,

      (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('name', coalesce(ch.label, 'Não preenchido'),
                                   'value', count(*)) x
           FROM recorte r LEFT JOIN core.channels ch ON ch.id = r.channel_id
          GROUP BY ch.label ORDER BY count(*) DESC) e)                    AS por_canal
    `,
    params,
  );

  return {
    totalCount: Number(row!.total),
    ticketCount: Number(row!.tickets),
    interactionCount: Number(row!.interacoes),
    sameDayRepeatCount: Number(row!.repeticoes),
    byAgent: row!.por_agente,
    byProduct: row!.por_produto,
    byDay: (row!.por_dia as any[]).map((d) => ({ day: toDay(d.day), value: d.value })),
    byPlatform: row!.por_plataforma,
    byChannel: row!.por_canal,
  };
}

/**
 * Métricas do próprio agente.
 *
 * Substitui três chamadas separadas que hoje o front faz em laço:
 * `agent_daily_metrics`, `agent_my_metrics` e `agent_metrics_range`. Em
 * 156 dias, só a primeira foi chamada 272.590 vezes, consumindo 13 horas
 * de processamento.
 */
export async function myMetrics(
  tx: Tx,
  caller: Caller,
  from: string,
  to: string,
): Promise<MyMetrics> {
  const hoje = hojeSP();

  const [row] = await tx.unsafe<Array<Record<string, any>>>(
    `
    WITH recorte AS (
      SELECT f.day, f.kind, f.product_id
        FROM core.interaction_facts f
       WHERE f.agent_id = $1::uuid AND f.day BETWEEN $2::date AND $3::date
    ), de_hoje AS (
      SELECT f.kind FROM core.interaction_facts f
       WHERE f.agent_id = $1::uuid AND f.day = $4::date
    )
    SELECT
      (SELECT count(*) FROM de_hoje WHERE kind = 'ticket')      AS hoje_tickets,
      (SELECT count(*) FROM de_hoje WHERE kind = 'interaction') AS hoje_interacoes,
      (SELECT count(*) FROM recorte WHERE kind = 'ticket')      AS per_tickets,
      (SELECT count(*) FROM recorte WHERE kind = 'interaction') AS per_interacoes,
      -- Dias em que houve QUALQUER registro. É o denominador do ritmo:
      -- dividir pelo total de dias do período puniria quem tirou folga.
      (SELECT count(DISTINCT day) FROM recorte)                 AS dias_trabalhados,

      (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('day', r.day, 'value', count(*)) x
           FROM recorte r GROUP BY r.day ORDER BY r.day) c)     AS por_dia,

      (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('name', p.name, 'value', count(*)) x
           FROM recorte r JOIN core.products p ON p.id = r.product_id
          GROUP BY p.name ORDER BY count(*) DESC) b)            AS por_produto
    `,
    [caller.id, from, to, hoje],
  );

  const hj = { t: Number(row!.hoje_tickets), i: Number(row!.hoje_interacoes) };
  const pr = { t: Number(row!.per_tickets), i: Number(row!.per_interacoes) };

  return {
    today: { day: hoje, tickets: hj.t, interactions: hj.i, total: hj.t + hj.i },
    range: {
      from,
      to,
      tickets: pr.t,
      interactions: pr.i,
      total: pr.t + pr.i,
      daysWorked: Number(row!.dias_trabalhados),
    },
    byDay: (row!.por_dia as any[]).map((d) => ({ day: toDay(d.day), value: d.value })),
    byProduct: row!.por_produto,
  };
}
