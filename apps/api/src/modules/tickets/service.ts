import type {
  CreateInteractionBody,
  CreateTicketBody,
  Interaction,
  TicketListItem,
} from "@xmx/contract";
import type { Tx } from "../../db.js";
import { fail } from "../../lib/errors.js";
import { getTicket } from "./repository.js";
import type { Caller } from "../../middleware/auth.js";

/**
 * Regras de negócio de atendimento.
 *
 * Vivem aqui, não no navegador. Hoje a regra das 18h, a numeração da
 * interação, a checagem de e-mail duplicado e o `canSave` moram em
 * componentes React, o que significa que um deploy de front muda regra
 * sem deixar rastro.
 */

/** Dia de hoje em São Paulo. O fuso de negócio só é aplicado aqui. */
export const businessDayNow = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export async function createTicket(
  tx: Tx,
  caller: Caller,
  body: CreateTicketBody,
): Promise<TicketListItem> {
  const email = body.clientEmail.trim();

  // Duplicidade: a ordem das checagens importa e hoje está invertida no
  // cliente, o que torna `can_register_duplicate_emails` código morto
  // para quem também tem `can_view_all_tickets`.
  const dup = await tx.unsafe<Array<{ id: string; owner: string; owner_name: string | null }>>(
    `SELECT t.id, t.current_owner_id AS owner, u.full_name AS owner_name
       FROM core.tickets t JOIN core.users u ON u.id = t.current_owner_id
      WHERE t.client_email_normalized = lower(btrim($1))
        AND t.derived_status <> 'concluido'
      LIMIT 1`,
    [email],
  );

  if (dup[0]) {
    const mine = dup[0].owner === caller.id;
    if (mine) {
      fail("TICKET_DUPLICATE_SAME_AGENT", "já existe ticket aberto seu para este e-mail", {
        ticketId: dup[0].id,
      });
    }
    if (!caller.can("can_register_duplicate_emails")) {
      fail("TICKET_DUPLICATE_OTHER_AGENT", "já existe ticket aberto para este e-mail com outro agente", {
        ticketId: dup[0].id,
        ownerName: dup[0].owner_name,
      });
    }
  }

  const rows = await tx.unsafe<Array<{ id: string }>>(
    `INSERT INTO core.tickets
       (client_email, business_day, product_id, platform_id, channel_id,
        contact_reason, contact_reason_note, order_id, has_tracking_code,
        creator_id, current_owner_id)
     VALUES ($1, $2::date, $3::uuid, $4::smallint, $5::smallint,
             $6::core.contact_reason, $7, $8, $9, $10::uuid, $10::uuid)
     RETURNING id`,
    [
      email,
      businessDayNow(),
      body.productId,
      body.platformId ?? null,
      body.channelId ?? null,
      body.contactReason,
      body.contactReasonNote?.trim() || null,
      body.orderId?.trim() || null,
      body.hasTrackingCode,
      caller.id,
    ],
  );

  const created = await getTicket(tx, rows[0]!.id, caller.id);
  return created!;
}

export async function addInteraction(
  tx: Tx,
  caller: Caller,
  ticketId: string,
  body: CreateInteractionBody,
): Promise<{ interaction: Interaction; ticket: TicketListItem }> {
  const owner = await tx.unsafe<Array<{ current_owner_id: string; interaction_count: number }>>(
    `SELECT current_owner_id, interaction_count FROM core.tickets WHERE id = $1::uuid FOR UPDATE`,
    [ticketId],
  );
  if (!owner[0]) fail("TICKET_NOT_FOUND", "atendimento não encontrado");

  if (owner[0].current_owner_id !== caller.id && !caller.can("can_view_all_tickets")) {
    fail("FORBIDDEN", "atendimento de outro agente");
  }

  // Não há validação de janela de horário: a decisão D1 removeu o
  // bloqueio das 18h, que existia só no navegador e de forma incoerente
  // (a lista recusava, o diálogo deixava passar).

  const next = await tx.unsafe<Array<{ seq: number }>>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM core.interactions WHERE ticket_id = $1::uuid`,
    [ticketId],
  );

  let inserted: Array<Record<string, any>>;
  try {
    inserted = await tx.unsafe(
      `INSERT INTO core.interactions (ticket_id, seq, status, observation, author_id)
       VALUES ($1::uuid, $2::smallint, $3::core.interaction_status, $4, $5::uuid)
       RETURNING id, ticket_id, seq, status, observation, recorded_at, author_id, is_same_day_repeat`,
      [ticketId, next[0]!.seq, body.status, body.observation?.trim() || null, caller.id],
    );
  } catch (e: any) {
    // UNIQUE (ticket_id, seq): duas abas gravando ao mesmo tempo. O
    // número nasce no banco, então a corrida é detectada em vez de
    // produzir duplicata silenciosa como hoje.
    if (e?.code === "23505") {
      fail("INTERACTION_SEQ_CONFLICT", "outra interação foi registrada ao mesmo tempo; tente de novo");
    }
    throw e;
  }

  const r = inserted[0]!;
  const ticket = await getTicket(tx, ticketId, caller.id);

  return {
    interaction: {
      id: r.id,
      ticketId: r.ticket_id,
      seq: r.seq,
      status: r.status,
      observation: r.observation,
      recordedAt: r.recorded_at.toISOString(),
      authorId: r.author_id,
      authorName: caller.fullName,
      isSameDayRepeat: r.is_same_day_repeat,
    },
    // O ticket volta já atualizado: o estado mudou na mesma transação,
    // então a tela não recalcula nada.
    ticket: ticket!,
  };
}

export async function listInteractions(tx: Tx, ticketId: string): Promise<Interaction[]> {
  const rows: Array<Record<string, any>> = await tx.unsafe(
    `SELECT i.id, i.ticket_id, i.seq, i.status, i.observation, i.recorded_at,
            i.author_id, i.is_same_day_repeat, u.full_name AS author_name
       FROM core.interactions i
       JOIN core.users u ON u.id = i.author_id
      WHERE i.ticket_id = $1::uuid
      ORDER BY i.recorded_at DESC, i.seq DESC
      LIMIT 200`,
    [ticketId],
  );
  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticket_id,
    seq: r.seq,
    status: r.status,
    observation: r.observation,
    recordedAt: r.recorded_at.toISOString(),
    authorId: r.author_id,
    authorName: r.author_name,
    isSameDayRepeat: r.is_same_day_repeat,
  }));
}
