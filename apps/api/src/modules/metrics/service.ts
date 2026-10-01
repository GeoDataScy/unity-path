import type {
  AgentDetail,
  AuditResponse,
  ChannelDetail,
  DashboardMetrics,
  HourlyPattern,
  MetricsRangeQuery,
  MyMetrics,
  PagedQuery,
} from "@xmx/contract";
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

// =====================================================================
// As quatro telas da gestora que ainda liam `_interaction_events`
//
// Cada função abaixo substitui uma RPC. Duas regras valem para todas:
//
// 1. **Um percurso por requisição** (G11.2). O recorte entra num CTE e os
//    agrupamentos saem dele. `dashboard_hourly_pattern` varre as duas
//    tabelas do legado SETE vezes; aqui é uma vez.
//
// 2. **O fuso é convertido na borda, nunca por linha.** Virar
//    `occurred_at` em data de São Paulo linha por linha é exatamente o
//    predicado não indexável que derrubou o banco. A borda do período é
//    que vira instante, e a comparação é de faixa.
// =====================================================================

/** Início e fim (exclusivo) do período, como instante. Entra em todo CTE. */
const BORDAS = `
    SELECT $1::date::timestamp AT TIME ZONE 'America/Sao_Paulo'       AS ini,
           ($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS fim`;

/**
 * Auditoria — substitui `dashboard_audit`.
 *
 * O `totalCount` sai do mesmo recorte que alimenta a página. Por isso ele
 * bate com o total do painel por construção: é a mesma contagem, não uma
 * contagem parecida feita noutro lugar.
 */
export async function audit(tx: Tx, q: PagedQuery): Promise<AuditResponse> {
  const offset = (q.page - 1) * q.pageSize;

  const [row] = await tx.unsafe<Array<Record<string, any>>>(
    `
    WITH recorte AS (
      SELECT f.id, f.kind, f.ticket_id, f.interaction_id, f.occurred_at, f.day,
             f.agent_id, f.product_id, f.platform_id, f.channel_id
        FROM core.interaction_facts f
       WHERE f.day BETWEEN $1::date AND $2::date
         AND ($3::uuid IS NULL OR f.agent_id = $3::uuid)
    ), pagina AS (
      -- Ordem do relógio, com desempate estável. O legado ordena por
      -- event_at DESC, kind, id DESC; aqui é o mesmo critério.
      SELECT * FROM recorte
       ORDER BY occurred_at DESC, kind ASC, id DESC
       LIMIT $4 OFFSET $5
    )
    SELECT
      (SELECT count(*) FROM recorte) AS total,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id',          p.id::text,
                'kind',        p.kind,
                'ticketId',    p.ticket_id,
                'occurredAt',  p.occurred_at,
                'day',         p.day,
                'agentId',     p.agent_id,
                'agentName',   u.full_name,
                'clientEmail', t.client_email,
                'product',     pr.name,
                'platform',    sp.label,
                'channel',     ch.label,
                -- Abertura mostra o estado do ticket; interação mostra o
                -- estado que ela registrou.
                'status',      CASE WHEN p.kind = 'ticket'
                                    THEN t.derived_status::text
                                    ELSE i.status::text END,
                -- A numeração exibida é a do legado quando existe, para o
                -- histórico na tela continuar idêntico ao de hoje.
                'seq',         CASE WHEN p.kind = 'interaction'
                                    THEN coalesce(i.legacy_follow_up_number, i.seq)
                               END
              ) ORDER BY p.occurred_at DESC, p.kind ASC, p.id DESC), '[]'::jsonb)
         FROM pagina p
         JOIN core.tickets   t  ON t.id  = p.ticket_id
         JOIN core.users     u  ON u.id  = p.agent_id
         JOIN core.products  pr ON pr.id = p.product_id
         LEFT JOIN core.sales_platforms sp ON sp.id = p.platform_id
         LEFT JOIN core.channels        ch ON ch.id = p.channel_id
         LEFT JOIN core.interactions    i  ON i.id  = p.interaction_id) AS items
    `,
    [q.from, q.to, q.agentId ?? null, q.pageSize, offset],
  );

  return {
    totalCount: Number(row!.total),
    page: q.page,
    pageSize: q.pageSize,
    items: (row!.items as any[]).map((r) => ({ ...r, day: toDay(r.day) })),
  };
}

/**
 * Padrão por horário — substitui `dashboard_hourly_pattern`.
 *
 * Esta é a única rota que mede o INSTANTE do registro em vez do dia que o
 * agente declarou. É por isso que a tabela de fatos tem dois eixos: um
 * agente que registra à meia-noite o atendimento de ontem conta no dia de
 * ontem no volume e na madrugada aqui. O legado faz assim, e é o que a
 * gestora espera ver.
 *
 * O filtro `agent_id = creator_id` é fidelidade medida, não suposição: o
 * legado exige `s.user_id = f.user_id`, ou seja, só a interação feita pelo
 * próprio dono entra no padrão de horário. Com `current_owner_id` em vez de
 * criador, agosto dava 955 linhas a mais.
 */
export async function hourlyPattern(
  tx: Tx,
  q: MetricsRangeQuery,
): Promise<HourlyPattern> {
  const [row] = await tx.unsafe<Array<Record<string, any>>>(
    `
    WITH bordas AS (${BORDAS}
    ), atividade AS (
      SELECT (f.occurred_at AT TIME ZONE 'America/Sao_Paulo') AS ts_sp,
             f.agent_id, f.ticket_id
        FROM core.interaction_facts f
        CROSS JOIN bordas b
        JOIN core.tickets t ON t.id = f.ticket_id
       WHERE f.occurred_at >= b.ini AND f.occurred_at < b.fim
         AND ($3::uuid IS NULL OR f.agent_id = $3::uuid)
         AND f.agent_id = t.creator_id
    ), celulas AS (
      SELECT extract(dow  FROM ts_sp)::int AS dow,
             extract(hour FROM ts_sp)::int AS hour,
             count(*)::int AS cnt
        FROM atividade GROUP BY 1, 2
    ), grade AS (
      SELECT d AS dow, h AS hour
        FROM generate_series(0, 6) d CROSS JOIN generate_series(0, 23) h
    ), por_dia AS (
      SELECT ts_sp::date AS dia,
             extract(epoch FROM (min(ts_sp) - date_trunc('day', min(ts_sp)))) / 3600.0 AS primeira,
             extract(epoch FROM (max(ts_sp) - date_trunc('day', max(ts_sp)))) / 3600.0 AS ultima
        FROM atividade GROUP BY 1
    ), primeiro_toque AS (
      -- A meta conta ticket DISTINTO: só o primeiro toque do dia naquele
      -- ticket faz o contador andar.
      SELECT DISTINCT ON (agent_id, ts_sp::date, ticket_id)
             agent_id, ts_sp::date AS dia, ticket_id, ts_sp
        FROM atividade
       ORDER BY agent_id, ts_sp::date, ticket_id, ts_sp
    ), ranqueado AS (
      SELECT agent_id, dia, ts_sp,
             row_number() OVER (PARTITION BY agent_id, dia ORDER BY ts_sp) AS idx
        FROM primeiro_toque
    ), meta_agente AS (
      -- Canal majoritário no período decide a meta: SMS → 150, senão 100.
      SELECT f.agent_id,
             CASE WHEN count(*) FILTER (WHERE ch.label = 'SMS')
                     > count(*) FILTER (WHERE ch.label IS DISTINCT FROM 'SMS')
                  THEN 150 ELSE 100 END AS meta
        FROM core.interaction_facts f
        LEFT JOIN core.channels ch ON ch.id = f.channel_id
       WHERE f.kind = 'ticket' AND f.day BETWEEN $1::date AND $2::date
         AND ($3::uuid IS NULL OR f.agent_id = $3::uuid)
       GROUP BY f.agent_id
    ), batidas AS (
      SELECT r.agent_id, r.dia,
             min(r.ts_sp) FILTER (WHERE r.idx = coalesce(m.meta, 100)) AS bateu_em
        FROM ranqueado r LEFT JOIN meta_agente m ON m.agent_id = r.agent_id
       GROUP BY r.agent_id, r.dia
    )
    SELECT
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'dow', g.dow, 'hour', g.hour, 'count', coalesce(c.cnt, 0))
                ORDER BY g.dow, g.hour), '[]'::jsonb)
         FROM grade g LEFT JOIN celulas c ON c.dow = g.dow AND c.hour = g.hour) AS grade,

      (SELECT count(*)                  FROM atividade)             AS total,
      (SELECT count(DISTINCT ts_sp::date) FROM atividade)           AS dias_ativos,

      (SELECT jsonb_build_object('dow', dow, 'hour', hour, 'count', cnt)
         FROM celulas ORDER BY cnt DESC, dow, hour LIMIT 1)         AS pico,

      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY primeira) FROM por_dia) AS inicio,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ultima)   FROM por_dia) AS fim,

      (SELECT count(*) FILTER (WHERE h >= 5  AND h < 12) FROM (
         SELECT extract(hour FROM ts_sp)::int h FROM atividade) a)  AS manha,
      (SELECT count(*) FILTER (WHERE h >= 12 AND h < 18) FROM (
         SELECT extract(hour FROM ts_sp)::int h FROM atividade) a)  AS tarde,
      (SELECT count(*) FILTER (WHERE h >= 18 AND h < 22) FROM (
         SELECT extract(hour FROM ts_sp)::int h FROM atividade) a)  AS noite,
      (SELECT count(*) FILTER (WHERE h >= 22 OR  h < 5)  FROM (
         SELECT extract(hour FROM ts_sp)::int h FROM atividade) a)  AS madrugada,

      (SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM (bateu_em - date_trunc('day', bateu_em))) / 3600.0)
         FROM batidas WHERE bateu_em IS NOT NULL)                   AS meta_hora,
      (SELECT count(*) FROM batidas WHERE bateu_em IS NOT NULL)     AS meta_dias,
      (SELECT count(*) FROM batidas)                                AS meta_dias_totais,
      -- Com um agente filtrado, a meta dele; sem filtro, a mais comum.
      (SELECT coalesce(
                CASE WHEN $3::uuid IS NOT NULL
                     THEN (SELECT meta FROM meta_agente WHERE agent_id = $3::uuid)
                     ELSE (SELECT meta FROM meta_agente
                            GROUP BY meta ORDER BY count(*) DESC, meta LIMIT 1)
                END, 100))                                          AS meta_valor
    `,
    [q.from, q.to, q.agentId ?? null],
  );

  const total = Number(row!.total);
  const frac = (n: unknown) => (total > 0 ? Number((Number(n) / total).toFixed(4)) : 0);
  const pico = (row!.pico ?? null) as { dow: number; hour: number; count: number } | null;

  return {
    byDowHour: row!.grade,
    total,
    activeDays: Number(row!.dias_ativos),
    peak: {
      dow: pico ? pico.dow : null,
      hour: pico ? pico.hour : null,
      count: pico ? pico.count : 0,
    },
    shift: {
      startHour: row!.inicio === null ? null : Number(row!.inicio),
      endHour: row!.fim === null ? null : Number(row!.fim),
    },
    shiftsShare: {
      morning: frac(row!.manha),
      afternoon: frac(row!.tarde),
      evening: frac(row!.noite),
      night: frac(row!.madrugada),
    },
    goalHit: {
      hour: row!.meta_hora === null ? null : Number(row!.meta_hora),
      daysHit: Number(row!.meta_dias),
      totalActiveDays: Number(row!.meta_dias_totais),
      threshold: Number(row!.meta_valor),
    },
  };
}

/**
 * Detalhe por canal — substitui `dashboard_channel_detail`.
 *
 * `doneCount` conta tickets ABERTOS no período que estão concluídos,
 * creditados a quem abriu. O legado descobre isso olhando o último
 * follow-up de cada ticket a cada requisição; aqui é `derived_status`, que
 * o gatilho mantém no mesmo commit da escrita.
 */
export async function channelDetail(
  tx: Tx,
  q: MetricsRangeQuery,
): Promise<ChannelDetail> {
  const rows = await tx.unsafe<Array<Record<string, any>>>(
    `
    WITH recorte AS (
      SELECT f.agent_id, f.kind, f.ticket_id, f.channel_id
        FROM core.interaction_facts f
       WHERE f.day BETWEEN $1::date AND $2::date
         AND ($3::uuid IS NULL OR f.agent_id = $3::uuid)
    ), volume AS (
      SELECT r.agent_id,
             coalesce(ch.label, 'Não informado') AS canal,
             count(*) FILTER (WHERE r.kind = 'ticket')::int      AS novos,
             count(*) FILTER (WHERE r.kind = 'interaction')::int AS interacoes,
             count(*)::int                                       AS total
        FROM recorte r LEFT JOIN core.channels ch ON ch.id = r.channel_id
       GROUP BY 1, 2
    ), concluidos AS (
      SELECT r.agent_id,
             coalesce(ch.label, 'Não informado') AS canal,
             count(*)::int AS feitos
        FROM recorte r
        JOIN core.tickets t ON t.id = r.ticket_id
        LEFT JOIN core.channels ch ON ch.id = r.channel_id
       WHERE r.kind = 'ticket' AND t.derived_status = 'concluido'
       GROUP BY 1, 2
    )
    SELECT v.canal                             AS channel,
           v.agent_id                          AS "agentId",
           coalesce(u.full_name, 'Sem nome')   AS "agentName",
           v.novos                             AS "newTickets",
           coalesce(c.feitos, 0)               AS "doneCount",
           v.interacoes                        AS interactions,
           v.total                             AS total
      FROM volume v
      LEFT JOIN core.users u ON u.id = v.agent_id
      LEFT JOIN concluidos c ON c.agent_id = v.agent_id AND c.canal = v.canal
     ORDER BY v.canal, v.total DESC, 3
    `,
    [q.from, q.to, q.agentId ?? null],
  );

  return { byChannelAgent: rows as any };
}

/**
 * Detalhe por agente — substitui `dashboard_follow_up_detail`.
 *
 * Regra que a tela sempre teve e continua valendo: agente sem nenhum
 * registro no período **aparece zerado**, não desaparece da tabela. Por
 * isso o universo de linhas é a união de quem registrou com quem tem cargo
 * de agente.
 */
export async function agentDetail(
  tx: Tx,
  q: MetricsRangeQuery,
): Promise<AgentDetail> {
  const linhas = await tx.unsafe<Array<Record<string, any>>>(
    `
    WITH recorte AS (
      SELECT f.agent_id, f.kind, f.ticket_id
        FROM core.interaction_facts f
       WHERE f.day BETWEEN $1::date AND $2::date
    ), volume AS (
      SELECT agent_id,
             count(*) FILTER (WHERE kind = 'ticket')::int      AS novos,
             count(*) FILTER (WHERE kind = 'interaction')::int AS interacoes
        FROM recorte GROUP BY 1
    ), abertos AS (
      SELECT r.agent_id, r.ticket_id,
             (t.derived_status = 'concluido') AS feito
        FROM recorte r JOIN core.tickets t ON t.id = r.ticket_id
       WHERE r.kind = 'ticket'
    ), feitos AS (
      SELECT agent_id, count(*)::int AS n FROM abertos WHERE feito GROUP BY 1
    ), media AS (
      -- Média de interações até concluir, nos tickets abertos no período.
      -- Contada por ticket, via índice, e não varrendo as interações todas.
      SELECT a.agent_id, round(avg(x.n), 1) AS media
        FROM abertos a
        CROSS JOIN LATERAL (SELECT count(*)::int AS n
                              FROM core.interactions i
                             WHERE i.ticket_id = a.ticket_id) x
       WHERE a.feito GROUP BY 1
    ), universo AS (
      SELECT agent_id FROM volume
      UNION
      SELECT id FROM core.users WHERE role = 'agent'
    )
    SELECT un.agent_id                        AS "agentId",
           coalesce(u.full_name, 'Sem nome')  AS "agentName",
           coalesce(v.novos, 0)
             + coalesce(v.interacoes, 0)      AS "totalTickets",
           coalesce(v.novos, 0)               AS "newTicketsCount",
           coalesce(v.interacoes, 0)          AS "interactionsCount",
           coalesce(f.n, 0)                   AS "doneCount",
           coalesce(m.media, 0)               AS "avgInteractionsToClose",
           CASE WHEN coalesce(v.novos, 0) > 0
                THEN round(coalesce(f.n, 0)::numeric / v.novos * 100, 1)
                ELSE 0 END                    AS "completionRate"
      FROM universo un
      LEFT JOIN core.users u ON u.id = un.agent_id
      LEFT JOIN volume    v ON v.agent_id = un.agent_id
      LEFT JOIN feitos    f ON f.agent_id = un.agent_id
      LEFT JOIN media     m ON m.agent_id = un.agent_id
     ORDER BY 2
    `,
    [q.from, q.to],
  );

  const byAgent = linhas.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentName,
    totalTickets: Number(r.totalTickets),
    newTicketsCount: Number(r.newTicketsCount),
    interactionsCount: Number(r.interactionsCount),
    doneCount: Number(r.doneCount),
    avgInteractionsToClose: Number(r.avgInteractionsToClose),
    completionRate: Number(r.completionRate),
  }));

  // Os KPIs e os três cards saem DAQUI, não de consultas próprias. É o que
  // garante que o número do card bata com a soma da tabela embaixo dele —
  // a divergência que o legado já teve entre gráfico e modal.
  const soma = (f: (a: typeof byAgent[number]) => number) =>
    byAgent.reduce((s, a) => s + f(a), 0);

  const ativos = byAgent.filter((a) => a.totalTickets > 0);
  const melhor = [...ativos.filter((a) => a.newTicketsCount > 0)].sort(
    (a, b) => b.completionRate - a.completionRate || b.doneCount - a.doneCount,
  )[0];
  const maisNovos = [...ativos].sort(
    (a, b) => b.newTicketsCount - a.newTicketsCount || a.agentName.localeCompare(b.agentName),
  )[0];
  const maisProdutivo = [...ativos].sort(
    (a, b) => b.interactionsCount - a.interactionsCount || a.agentName.localeCompare(b.agentName),
  )[0];

  return {
    kpi: {
      totalServices: soma((a) => a.totalTickets),
      newTicketsCount: soma((a) => a.newTicketsCount),
      interactionsCount: soma((a) => a.interactionsCount),
      doneCount: soma((a) => a.doneCount),
    },
    byAgent,
    insights: {
      topPerformer: melhor
        ? {
            agentId: melhor.agentId,
            agentName: melhor.agentName,
            doneCount: melhor.doneCount,
            newTickets: melhor.newTicketsCount,
            completionRate: melhor.completionRate,
          }
        : null,
      mostNewTickets: maisNovos
        ? { agentId: maisNovos.agentId, agentName: maisNovos.agentName, newTickets: maisNovos.newTicketsCount }
        : null,
      mostProductive: maisProdutivo
        ? { agentId: maisProdutivo.agentId, agentName: maisProdutivo.agentName, interactions: maisProdutivo.interactionsCount }
        : null,
    },
  };
}
