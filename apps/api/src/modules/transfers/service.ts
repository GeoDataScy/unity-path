import type { Notification, Takeover, Transfer } from "@xmx/contract";
import type { Tx } from "../../db.js";
import { fail } from "../../lib/errors.js";
import type { Caller } from "../../middleware/auth.js";

/**
 * Transferências, tomadas de ticket e notificações.
 *
 * O ticket NÃO troca de dono numa transferência: `to_user_id` é quem já
 * era dono e está sendo chamado de volta a continuar. Quem troca o dono é
 * a tomada, e só com aprovação de quem tem a capacidade.
 *
 * Cada ação gera notificação e publica no canal do destinatário. É o que
 * substitui os três sinos perguntando a cada 30 segundos.
 */

const TICKET_REF = `
  t.id AS t_id, t.client_email AS t_email, pr.name AS t_product
`;

const toTicketRef = (r: Record<string, any>) => ({
  id: r.t_id,
  clientEmail: r.t_email,
  productName: r.t_product,
});

// ---------------------------------------------------------------------
// Transferências
// ---------------------------------------------------------------------

export async function listTransfers(tx: Tx, caller: Caller): Promise<Transfer[]> {
  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT tr.id, tr.from_user_id, tr.to_user_id, tr.status, tr.message,
            tr.response_note, tr.responded_at, tr.created_at,
            uf.full_name AS from_name, ut.full_name AS to_name, ${TICKET_REF}
       FROM core.ticket_transfers tr
       JOIN core.tickets t ON t.id = tr.ticket_id
       JOIN core.products pr ON pr.id = t.product_id
       JOIN core.users uf ON uf.id = tr.from_user_id
       JOIN core.users ut ON ut.id = tr.to_user_id
      WHERE tr.from_user_id = $1::uuid OR tr.to_user_id = $1::uuid
      ORDER BY tr.created_at DESC LIMIT 100`,
    [caller.id],
  );
  return rows.map((r) => ({
    id: r.id,
    ticket: toTicketRef(r),
    fromUserId: r.from_user_id,
    fromUserName: r.from_name,
    toUserId: r.to_user_id,
    toUserName: r.to_name,
    status: r.status,
    message: r.message,
    responseNote: r.response_note,
    respondedAt: r.responded_at ? r.responded_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    awaitingMe: r.status === "pending" && r.to_user_id === caller.id,
  }));
}

export async function createTransfer(
  tx: Tx,
  caller: Caller,
  ticketId: string,
  message: string | null,
): Promise<Transfer> {
  const t = await tx.unsafe<Array<{ current_owner_id: string }>>(
    `SELECT current_owner_id FROM core.tickets WHERE id = $1::uuid`,
    [ticketId],
  );
  if (!t[0]) fail("TICKET_NOT_FOUND", "atendimento não encontrado");
  if (t[0].current_owner_id === caller.id) {
    fail("FORBIDDEN", "o ticket já é seu; não há para quem transferir");
  }

  let id: string;
  try {
    const rows = await tx.unsafe<Array<{ id: string }>>(
      `INSERT INTO core.ticket_transfers (ticket_id, from_user_id, to_user_id, message)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING id`,
      [ticketId, caller.id, t[0].current_owner_id, message],
    );
    id = rows[0]!.id;
  } catch (e: any) {
    // Índice único parcial: um pendente por par. A corrida entre duas
    // abas é detectada aqui, e não depende do cliente checar antes.
    if (e?.code === "23505") fail("TRANSFER_ALREADY_PENDING", "já existe pedido pendente seu para este ticket");
    throw e;
  }

  await notify(tx, t[0].current_owner_id, "transfer_requested", ticketId, {
    transferId: id,
    fromName: caller.fullName,
    message,
  });

  return (await listTransfers(tx, caller)).find((x) => x.id === id)!;
}

export async function respondTransfer(
  tx: Tx,
  caller: Caller,
  id: string,
  accept: boolean,
  note: string | null,
): Promise<Transfer> {
  const rows = await tx.unsafe<Array<Record<string, any>>>(
    `UPDATE core.ticket_transfers
        SET status = $3::core.request_status, response_note = $4, responded_at = now()
      WHERE id = $1::uuid AND to_user_id = $2::uuid AND status = 'pending'
      RETURNING id, ticket_id, from_user_id`,
    [id, caller.id, accept ? "accepted" : "declined", note],
  );
  // Zero linhas não é sucesso silencioso: é 404 explícito (G4.2).
  if (!rows[0]) fail("TICKET_NOT_FOUND", "pedido não encontrado, já respondido, ou não é seu");

  await notify(tx, rows[0].from_user_id, accept ? "transfer_accepted" : "transfer_declined",
    rows[0].ticket_id, { transferId: id, byName: caller.fullName, note });

  return (await listTransfers(tx, caller)).find((x) => x.id === id)!;
}

// ---------------------------------------------------------------------
// Tomada de ticket
// ---------------------------------------------------------------------

export async function listTakeovers(tx: Tx, caller: Caller): Promise<Takeover[]> {
  // Quem aprova vê todos os pendentes; os demais veem os próprios.
  const canApprove = caller.can("can_approve_takeovers");
  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT tk.id, tk.requester_id, tk.owner_id, tk.status, tk.note,
            tk.responded_at, tk.created_at,
            ur.full_name AS requester_name, uo.full_name AS owner_name,
            uo.is_available AS owner_is_available, urb.full_name AS responded_by_name,
            ${TICKET_REF}
       FROM core.ticket_takeovers tk
       JOIN core.tickets t ON t.id = tk.ticket_id
       JOIN core.products pr ON pr.id = t.product_id
       JOIN core.users ur ON ur.id = tk.requester_id
       LEFT JOIN core.users uo  ON uo.id  = tk.owner_id
       LEFT JOIN core.users urb ON urb.id = tk.responded_by
      WHERE $2::boolean OR tk.requester_id = $1::uuid
      ORDER BY tk.created_at DESC LIMIT 100`,
    [caller.id, canApprove],
  );
  return rows.map((r) => ({
    id: r.id,
    ticket: toTicketRef(r),
    requesterId: r.requester_id,
    requesterName: r.requester_name,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    ownerIsAvailable: r.owner_is_available,
    status: r.status,
    note: r.note,
    respondedAt: r.responded_at ? r.responded_at.toISOString() : null,
    respondedByName: r.responded_by_name,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function createTakeover(
  tx: Tx,
  caller: Caller,
  ticketId: string,
  note: string | null,
): Promise<Takeover> {
  const t = await tx.unsafe<Array<{ current_owner_id: string; available: boolean }>>(
    `SELECT t.current_owner_id, u.is_available AS available
       FROM core.tickets t JOIN core.users u ON u.id = t.current_owner_id
      WHERE t.id = $1::uuid`,
    [ticketId],
  );
  if (!t[0]) fail("TICKET_NOT_FOUND", "atendimento não encontrado");
  if (t[0].current_owner_id === caller.id) fail("FORBIDDEN", "o ticket já é seu");

  let id: string;
  try {
    const rows = await tx.unsafe<Array<{ id: string }>>(
      `INSERT INTO core.ticket_takeovers (ticket_id, requester_id, owner_id, note)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING id`,
      [ticketId, caller.id, t[0].current_owner_id, note],
    );
    id = rows[0]!.id;
  } catch (e: any) {
    if (e?.code === "23505") fail("TAKEOVER_ALREADY_PENDING", "você já pediu este ticket");
    throw e;
  }

  // Quem aprova é quem tem a capacidade, não um cargo fixo.
  const aprovadores = await tx.unsafe<Array<{ id: string }>>(
    `SELECT id FROM core.users WHERE can_approve_takeovers AND is_active`,
  );
  for (const a of aprovadores) {
    await notify(tx, a.id, "takeover_requested", ticketId, {
      takeoverId: id, requesterName: caller.fullName, ownerName: null, note,
    });
  }

  return (await listTakeovers(tx, caller)).find((x) => x.id === id)!;
}

/**
 * Aprovar tomada: aqui o dono do ticket MUDA de verdade.
 */
export async function respondTakeover(
  tx: Tx,
  caller: Caller,
  id: string,
  approve: boolean,
  note: string | null,
): Promise<Takeover> {
  if (!caller.can("can_approve_takeovers")) {
    fail("MISSING_CAPABILITY", "requer can_approve_takeovers", {
      capability: "can_approve_takeovers",
    });
  }

  const rows = await tx.unsafe<Array<Record<string, any>>>(
    `UPDATE core.ticket_takeovers
        SET status = $3::core.request_status, responded_at = now(),
            responded_by = $2::uuid, note = coalesce($4, note)
      WHERE id = $1::uuid AND status = 'pending'
      RETURNING id, ticket_id, requester_id`,
    [id, caller.id, approve ? "accepted" : "declined", note],
  );
  if (!rows[0]) fail("TICKET_NOT_FOUND", "pedido não encontrado ou já respondido");

  if (approve) {
    await tx.unsafe(
      `UPDATE core.tickets
          SET current_owner_id = $2::uuid, takeover_approved_at = now(),
              takeover_approved_by = $3::uuid, updated_at = now()
        WHERE id = $1::uuid`,
      [rows[0].ticket_id, rows[0].requester_id, caller.id],
    );
  }

  await notify(tx, rows[0].requester_id, approve ? "takeover_approved" : "takeover_rejected",
    rows[0].ticket_id, { takeoverId: id, byName: caller.fullName, note });

  return (await listTakeovers(tx, caller)).find((x) => x.id === id)!;
}

// ---------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------

async function notify(
  tx: Tx,
  userId: string,
  kind: string,
  ticketId: string | null,
  payload: unknown,
) {
  await tx.unsafe(
    `INSERT INTO core.notifications (user_id, kind, ticket_id, payload)
     VALUES ($1::uuid, $2::core.notification_kind, $3::uuid, $4::jsonb)`,
    [userId, kind, ticketId, JSON.stringify(payload)],
  );
}

export async function listNotifications(tx: Tx, caller: Caller) {
  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT id, kind, payload, ticket_id, seen_at, created_at
       FROM core.notifications WHERE user_id = $1::uuid
      ORDER BY created_at DESC LIMIT 50`,
    [caller.id],
  );
  const items: Notification[] = rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    payload: r.payload,
    ticketId: r.ticket_id,
    seenAt: r.seen_at ? r.seen_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  }));
  return { items, unseenCount: items.filter((n) => n.seenAt === null).length };
}

export async function markNotificationSeen(tx: Tx, caller: Caller, id: number) {
  const rows = await tx.unsafe<Array<{ id: string }>>(
    `UPDATE core.notifications SET seen_at = now()
      WHERE id = $1 AND user_id = $2::uuid AND seen_at IS NULL RETURNING id`,
    [id, caller.id],
  );
  return rows.length > 0;
}
