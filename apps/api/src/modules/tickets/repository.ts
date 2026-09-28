import type { TicketListItem } from "@xmx/contract";
import type { Tx } from "../../db.ts";
import { encodeCursor, type TicketCursor } from "../../lib/cursor.ts";

/**
 * Acesso a dados de atendimentos.
 *
 * Toda consulta lista as colunas explicitamente (G10.4) e tem limite com
 * teto aplicado no servidor (G10.1). Nenhuma devolve o histórico junto:
 * o estado do ticket já vem materializado na linha, então a tela não
 * precisa das interações para pintar o badge.
 */

const TICKET_COLUMNS = `
  t.id, t.client_email, t.business_day, t.contact_reason, t.contact_reason_note,
  t.order_id, t.has_tracking_code, t.derived_status, t.interaction_count,
  t.last_interaction_at, t.current_owner_id, t.created_at,
  p.id AS product_id, p.name AS product_name,
  sp.id AS platform_id, sp.label AS platform_label, sp.kind AS platform_kind,
  ch.id AS channel_id, ch.label AS channel_label, ch.kind AS channel_kind,
  ow.full_name AS owner_name
`;

type Row = Record<string, any>;

const toItem = (r: Row, viewerId: string): TicketListItem => ({
  id: r.id,
  clientEmail: r.client_email,
  businessDay:
    r.business_day instanceof Date
      ? r.business_day.toISOString().slice(0, 10)
      : String(r.business_day).slice(0, 10),
  product: { id: r.product_id, name: r.product_name },
  platform: r.platform_id
    ? { id: r.platform_id, label: r.platform_label, kind: r.platform_kind }
    : null,
  channel: r.channel_id ? { id: r.channel_id, label: r.channel_label, kind: r.channel_kind } : null,
  contactReason: r.contact_reason,
  contactReasonNote: r.contact_reason_note,
  orderId: r.order_id,
  hasTrackingCode: r.has_tracking_code,
  derivedStatus: r.derived_status,
  interactionCount: r.interaction_count,
  lastInteractionAt: r.last_interaction_at ? r.last_interaction_at.toISOString() : null,
  ownerId: r.current_owner_id,
  ownerName: r.owner_name,
  isMine: r.current_owner_id === viewerId,
  createdAt: r.created_at.toISOString(),
});

export type ListArgs = {
  viewerId: string;
  /** Null quando o usuário pode ver os tickets de todos. */
  ownerFilter: string | null;
  cursor: TicketCursor | null;
  limit: number;
  status?: string;
  contactReason?: string;
  q?: string;
};

export async function listTickets(tx: Tx, a: ListArgs) {
  // Pede uma linha a mais para saber se existe próxima página sem contar.
  const take = a.limit + 1;

  const rows: Row[] = await tx.unsafe(
    `
    SELECT ${TICKET_COLUMNS}
      FROM core.tickets t
      JOIN core.products p       ON p.id  = t.product_id
      JOIN core.users    ow      ON ow.id = t.current_owner_id
      LEFT JOIN core.sales_platforms sp ON sp.id = t.platform_id
      LEFT JOIN core.channels        ch ON ch.id = t.channel_id
     WHERE ($1::uuid IS NULL OR t.current_owner_id = $1::uuid)
       AND ($2::text IS NULL OR t.derived_status = $2::core.ticket_derived_status)
       AND ($3::text IS NULL OR t.contact_reason  = $3::core.contact_reason)
       AND ($4::text IS NULL OR t.client_email_normalized LIKE '%' || lower(btrim($4)) || '%'
                              OR t.order_id ILIKE '%' || $4 || '%')
       -- keyset: a página seguinte começa estritamente antes do cursor
       AND ($5::timestamptz IS NULL
            OR (t.created_at, t.id) < ($5::timestamptz, $6::uuid))
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $7
    `,
    [
      a.ownerFilter,
      a.status ?? null,
      a.contactReason ?? null,
      a.q ?? null,
      a.cursor?.createdAt ?? null,
      a.cursor?.id ?? null,
      take,
    ],
  );

  const hasMore = rows.length > a.limit;
  const page = hasMore ? rows.slice(0, a.limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map((r) => toItem(r, a.viewerId)),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null,
    hasMore,
  };
}

export async function getTicket(tx: Tx, id: string, viewerId: string): Promise<TicketListItem | null> {
  const rows: Row[] = await tx.unsafe(
    `SELECT ${TICKET_COLUMNS}
       FROM core.tickets t
       JOIN core.products p  ON p.id  = t.product_id
       JOIN core.users    ow ON ow.id = t.current_owner_id
       LEFT JOIN core.sales_platforms sp ON sp.id = t.platform_id
       LEFT JOIN core.channels        ch ON ch.id = t.channel_id
      WHERE t.id = $1::uuid`,
    [id],
  );
  return rows[0] ? toItem(rows[0], viewerId) : null;
}

/** Ticket aberto para um e-mail, sem olhar caixa nem espaços. */
export async function findOpenTicketByEmail(tx: Tx, email: string, viewerId: string) {
  const rows: Row[] = await tx.unsafe(
    `SELECT ${TICKET_COLUMNS}, ow.is_available AS owner_is_available
       FROM core.tickets t
       JOIN core.products p  ON p.id  = t.product_id
       JOIN core.users    ow ON ow.id = t.current_owner_id
       LEFT JOIN core.sales_platforms sp ON sp.id = t.platform_id
       LEFT JOIN core.channels        ch ON ch.id = t.channel_id
      WHERE t.client_email_normalized = lower(btrim($1))
        AND t.derived_status <> 'concluido'
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [email],
  );
  const r = rows[0];
  return r ? { ticket: toItem(r, viewerId), ownerIsAvailable: r.owner_is_available as boolean } : null;
}
