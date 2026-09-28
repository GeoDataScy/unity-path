import type {
  CompleteRefundBody,
  CreateRefundBody,
  ListRefundsQuery,
  Refund,
  RefundEvent,
} from "@xmx/contract";
import type { Tx } from "../../db.ts";
import { fail } from "../../lib/errors.ts";
import type { Caller } from "../../middleware/auth.ts";

/**
 * Reembolsos.
 *
 * A baixa é UMA rota. Hoje o agente escreve direto na tabela sem
 * validação e a gestora passa por função que recusa data no futuro, data
 * anterior à solicitação e valor negativo — mesma ação, dois
 * comportamentos, e só a dela deixa rastro.
 */

const REFUND_COLUMNS = `
  r.id, r.ticket_id, r.agent_id, r.order_id, r.customer_email,
  r.request_date, r.completion_date, r.refund_value, r.currency, r.refund_percent,
  r.reason, r.items_returned, r.created_from_ticket, r.picked_up_at, r.created_at,
  ag.full_name AS agent_name,
  pu.full_name AS picked_up_by_name,
  sp.id AS platform_id, sp.label AS platform_label, sp.kind AS platform_kind,
  ch.id AS channel_id, ch.label AS channel_label, ch.kind AS channel_kind,
  pr.id AS product_id, pr.name AS product_name,
  rc.label AS reason_category
`;

const FROM_REFUNDS = `
  FROM core.refunds r
  JOIN core.users ag ON ag.id = r.agent_id
  LEFT JOIN core.users pu ON pu.id = r.picked_up_by
  LEFT JOIN core.sales_platforms sp ON sp.id = r.platform_id
  LEFT JOIN core.channels ch ON ch.id = r.channel_id
  LEFT JOIN core.products pr ON pr.id = r.product_id
  LEFT JOIN core.refund_reason_categories rc ON rc.id = r.reason_category_id
`;

const toDate = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;

const toRefund = (r: Record<string, any>): Refund => {
  const completion = toDate(r.completion_date);
  const request = toDate(r.request_date)!;
  return {
    id: r.id,
    ticketId: r.ticket_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    orderId: r.order_id,
    customerEmail: r.customer_email,
    platform: r.platform_id
      ? { id: r.platform_id, label: r.platform_label, kind: r.platform_kind }
      : null,
    channel: r.channel_id ? { id: r.channel_id, label: r.channel_label, kind: r.channel_kind } : null,
    product: r.product_id ? { id: r.product_id, name: r.product_name } : null,
    requestDate: request,
    completionDate: completion,
    // Dinheiro sempre com a moeda junto (G5.1).
    value: r.refund_value === null ? null : { amount: Number(r.refund_value), currency: "USD" },
    percent: r.refund_percent,
    reason: r.reason,
    reasonCategory: r.reason_category,
    itemsReturned: r.items_returned,
    createdFromTicket: r.created_from_ticket,
    pickedUpAt: r.picked_up_at ? r.picked_up_at.toISOString() : null,
    pickedUpByName: r.picked_up_by_name,
    // Derivado no servidor: a tela não decide o que é "aberto".
    status: completion ? "concluido" : "aberto",
    daysOpen: completion
      ? null
      : Math.floor((Date.now() - new Date(request + "T12:00:00Z").getTime()) / 86_400_000),
    createdAt: r.created_at.toISOString(),
  };
};

export async function listRefunds(tx: Tx, caller: Caller, q: ListRefundsQuery) {
  const agentFilter = q.agentId ?? (caller.can("can_view_all_tickets") ? null : caller.id);
  const offset = (q.page - 1) * q.limit;

  const params = [
    agentFilter,
    q.status ?? null,
    q.q ?? null,
    q.from ?? null,
    q.to ?? null,
    q.limit,
    offset,
  ];

  const where = `
     WHERE ($1::uuid IS NULL OR r.agent_id = $1::uuid)
       AND ($2::text IS NULL
            OR ($2 = 'aberto'    AND r.completion_date IS NULL)
            OR ($2 = 'concluido' AND r.completion_date IS NOT NULL))
       AND ($3::text IS NULL OR r.customer_email_normalized LIKE '%' || lower(btrim($3)) || '%'
                              OR r.order_id ILIKE '%' || $3 || '%')
       AND ($4::date IS NULL OR r.request_date >= $4::date)
       AND ($5::date IS NULL OR r.request_date <= $5::date)`;

  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT ${REFUND_COLUMNS} ${FROM_REFUNDS} ${where}
      ORDER BY r.request_date DESC, r.id DESC
      LIMIT $6 OFFSET $7`,
    params,
  );

  // A tela mostra "Página 3 de 12, 287 registros" e a soma do período, e
  // as duas coisas valem para a CONSULTA INTEIRA, não para a página.
  const agg: Array<Record<string, any>> = await tx.unsafe(
    `SELECT count(*)::int AS total, coalesce(sum(r.refund_value), 0)::numeric AS soma
       FROM core.refunds r ${where}`,
    params.slice(0, 5),
  );

  const total = agg[0]!.total as number;
  return {
    items: rows.map(toRefund),
    page: q.page,
    limit: q.limit,
    totalCount: total,
    pageCount: Math.max(1, Math.ceil(total / q.limit)),
    totalValue: { amount: Number(agg[0]!.soma), currency: "USD" as const },
  };
}

export async function getRefund(tx: Tx, id: string): Promise<Refund | null> {
  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT ${REFUND_COLUMNS} ${FROM_REFUNDS} WHERE r.id = $1::uuid`,
    [id],
  );
  return rows[0] ? toRefund(rows[0]) : null;
}

export async function createRefund(tx: Tx, caller: Caller, body: CreateRefundBody): Promise<Refund> {
  if (body.ticketId) {
    const taken = await tx.unsafe<Array<{ id: string }>>(
      `SELECT id FROM core.refunds WHERE ticket_id = $1::uuid`,
      [body.ticketId],
    );
    if (taken[0]) fail("REFUND_ALREADY_EXISTS", "este atendimento já tem reembolso", {
      refundId: taken[0].id,
    });
  }

  const rows = await tx.unsafe<Array<{ id: string }>>(
    `INSERT INTO core.refunds
       (ticket_id, agent_id, order_id, customer_email, platform_id, channel_id,
        product_id, request_date, reason, items_returned)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::smallint, $6::smallint,
             $7::uuid, $8::date, $9, $10)
     RETURNING id`,
    [
      body.ticketId ?? null,
      caller.id,
      body.orderId.trim(),
      body.customerEmail.trim(),
      body.platformId ?? null,
      body.channelId ?? null,
      body.productId ?? null,
      body.requestDate,
      body.reason?.trim() || null,
      body.itemsReturned,
    ],
  );

  await recordEvent(tx, rows[0]!.id, "created", caller.id, null);
  return (await getRefund(tx, rows[0]!.id))!;
}

/** Assumir: quem dá baixa passa a ser responsável. */
export async function pickUpRefund(tx: Tx, caller: Caller, id: string): Promise<Refund> {
  const rows = await tx.unsafe<Array<Record<string, any>>>(
    `UPDATE core.refunds SET picked_up_at = now(), picked_up_by = $2::uuid, updated_at = now()
      WHERE id = $1::uuid AND completion_date IS NULL
      RETURNING id`,
    [id, caller.id],
  );
  if (!rows[0]) fail("REFUND_NOT_FOUND", "reembolso não encontrado ou já concluído");
  await recordEvent(tx, id, "picked_up", caller.id, null);
  return (await getRefund(tx, id))!;
}

/**
 * Dar baixa — uma rota, uma validação, sempre com rastro.
 */
export async function completeRefund(
  tx: Tx,
  caller: Caller,
  id: string,
  body: CompleteRefundBody,
): Promise<Refund> {
  const current = await tx.unsafe<Array<Record<string, any>>>(
    `SELECT id, agent_id, request_date, completion_date FROM core.refunds
      WHERE id = $1::uuid FOR UPDATE`,
    [id],
  );
  const r = current[0];
  if (!r) fail("REFUND_NOT_FOUND", "reembolso não encontrado");

  if (r.agent_id !== caller.id && !caller.can("can_view_all_tickets")) {
    fail("FORBIDDEN", "reembolso de outro agente");
  }

  const requestDate = toDate(r.request_date)!;
  if (body.completionDate < requestDate) {
    fail("REFUND_COMPLETION_BEFORE_REQUEST", "baixa anterior à solicitação", {
      requestDate,
      completionDate: body.completionDate,
    });
  }

  await tx.unsafe(
    `UPDATE core.refunds
        SET completion_date = $2::date, refund_value = $3::numeric,
            refund_percent = $4::smallint, reason = $5, items_returned = $6,
            updated_at = now()
      WHERE id = $1::uuid`,
    [id, body.completionDate, body.amount, body.percent, body.reason.trim(), body.itemsReturned],
  );

  await recordEvent(tx, id, "completed", caller.id, {
    completionDate: body.completionDate,
    amount: body.amount,
    percent: body.percent,
  });
  return (await getRefund(tx, id))!;
}

export async function listRefundEvents(tx: Tx, refundId: string): Promise<RefundEvent[]> {
  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT e.id, e.kind, e.actor_id, e.note, e.recorded_at, u.full_name AS actor_name
       FROM core.refund_events e JOIN core.users u ON u.id = e.actor_id
      WHERE e.refund_id = $1::uuid ORDER BY e.recorded_at DESC LIMIT 100`,
    [refundId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    actorId: r.actor_id,
    actorName: r.actor_name,
    note: r.note,
    recordedAt: r.recorded_at.toISOString(),
  }));
}

async function recordEvent(
  tx: Tx,
  refundId: string,
  kind: string,
  actorId: string,
  snapshot: unknown,
) {
  await tx.unsafe(
    `INSERT INTO core.refund_events (refund_id, kind, actor_id, snapshot)
     VALUES ($1::uuid, $2::core.refund_event_kind, $3::uuid, $4::jsonb)`,
    [refundId, kind, actorId, snapshot === null ? null : JSON.stringify(snapshot)],
  );
}
