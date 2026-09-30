import {
  completeRefundBody,
  createInteractionBody,
  createRefundBody,
  createTakeoverBody,
  createTicketBody,
  createTransferBody,
  listRefundsQuery,
  listTicketsQuery,
  lookupTicketQuery,
  respondTakeoverBody,
  respondTransferBody,
  type MeResponse,
} from "@xmx/contract";
import { Hono } from "hono";
import { withUser } from "./db.js";
import { ApiError } from "./lib/errors.js";
import { decodeCursor } from "./lib/cursor.js";
import { requireAuth } from "./middleware/auth.js";
import * as repo from "./modules/tickets/repository.js";
import * as refunds from "./modules/refunds/service.js";
import * as tickets from "./modules/tickets/service.js";
import * as transfers from "./modules/transfers/service.js";

export const app = new Hono().basePath("/api/v1");

/**
 * Envelope de erro único, em toda rota, sempre.
 *
 * Nunca existe caminho "ok com nada": falha de leitura vira estado de
 * erro visível. Foi um `const { data = [] }` transformando timeout em
 * lista vazia que fez todo ticket aparecer como "Novo" em julho.
 */
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(err.toJSON(), err.status as any);
  console.error("[erro não tratado]", err);
  return c.json({ error: { code: "INTERNAL", message: "erro inesperado" } }, 500);
});

app.notFound((c) =>
  c.json({ error: { code: "TICKET_NOT_FOUND", message: "rota não encontrada" } }, 404),
);

const parse = <T>(schema: { safeParse: (v: unknown) => any }, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ApiError("VALIDATION_FAILED", "dados inválidos", {
      issues: r.error.issues.map((i: any) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data as T;
};

app.get("/health", (c) => c.json({ ok: true }));

app.use("/me", requireAuth());
app.use("/tickets", requireAuth());
app.use("/tickets/*", requireAuth());
app.use("/catalogs", requireAuth());
app.use("/refunds", requireAuth());
app.use("/refunds/*", requireAuth());
app.use("/transfers", requireAuth());
app.use("/transfers/*", requireAuth());
app.use("/takeovers", requireAuth());
app.use("/takeovers/*", requireAuth());
app.use("/notifications", requireAuth());
app.use("/notifications/*", requireAuth());

/**
 * GET /me — substitui `me_status`, as três leituras de perfil por login
 * e o heartbeat de 30 segundos.
 */
app.get("/me", (c) => {
  const u = c.get("caller");
  const areas: MeResponse["areas"] =
    u.role === "manager" ? ["dashboard"]
    : u.role === "copy_grup" ? ["copy"]
    : u.role === "produto" ? ["produtos"]
    : ["workspace"];

  return c.json({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isAvailable: u.isAvailable,
    supportChannel: null,
    capabilities: u.capabilities,
    areas,
    serverTime: new Date().toISOString(),
  } satisfies MeResponse);
});

/** Lista quente do agente: cursor keyset, nunca OFFSET. */
app.get("/tickets", async (c) => {
  const caller = c.get("caller");
  const q = parse<any>(listTicketsQuery, Object.fromEntries(new URL(c.req.url).searchParams));

  // Quem não pode ver tudo só enxerga os próprios. O recorte vai no
  // WHERE, servido por índice — a policy é rede, não filtro.
  const ownerFilter = q.agentId ?? (caller.can("can_view_all_tickets") ? null : caller.id);

  const page = await withUser(caller.id, (tx) =>
    repo.listTickets(tx, {
      viewerId: caller.id,
      ownerFilter,
      cursor: q.cursor ? decodeCursor(q.cursor) : null,
      limit: q.limit,
      status: q.status,
      contactReason: q.contactReason,
      q: q.q,
    }),
  );
  return c.json(page);
});

app.post("/tickets", async (c) => {
  const caller = c.get("caller");
  const body = parse<any>(createTicketBody, await c.req.json());
  const ticket = await withUser(caller.id, (tx) => tickets.createTicket(tx, caller, body));
  return c.json(ticket, 201);
});

app.get("/tickets/lookup", async (c) => {
  const caller = c.get("caller");
  const q = parse<any>(lookupTicketQuery, Object.fromEntries(new URL(c.req.url).searchParams));
  const found = await withUser(caller.id, (tx) => repo.findOpenTicketByEmail(tx, q.email, caller.id));
  return c.json({ ticket: found?.ticket ?? null, ownerIsAvailable: found?.ownerIsAvailable ?? null });
});

app.get("/tickets/:id", async (c) => {
  const caller = c.get("caller");
  const t = await withUser(caller.id, (tx) => repo.getTicket(tx, c.req.param("id"), caller.id));
  if (!t) throw new ApiError("TICKET_NOT_FOUND", "atendimento não encontrado");
  return c.json(t);
});

/** Histórico sob demanda: nunca no carregamento da tela (G10.3). */
app.get("/tickets/:id/interactions", async (c) => {
  const caller = c.get("caller");
  const items = await withUser(caller.id, (tx) => tickets.listInteractions(tx, c.req.param("id")));
  return c.json({ items });
});

/**
 * Registrar interação: uma transação, e o ticket volta já atualizado.
 * O cliente nunca envia `seq` — ele nasce no banco.
 */
app.post("/tickets/:id/interactions", async (c) => {
  const caller = c.get("caller");
  const body = parse<any>(createInteractionBody, await c.req.json());
  const result = await withUser(caller.id, (tx) =>
    tickets.addInteraction(tx, caller, c.req.param("id"), body),
  );
  return c.json(result, 201);
});


// ---------------------------------------------------------------------
// Reembolsos — lista fria, paginada por número, com total (decisão D7)
// ---------------------------------------------------------------------

app.get("/refunds", async (c) => {
  const caller = c.get("caller");
  const q = parse<any>(listRefundsQuery, Object.fromEntries(new URL(c.req.url).searchParams));
  return c.json(await withUser(caller.id, (tx) => refunds.listRefunds(tx, caller, q)));
});

app.post("/refunds", async (c) => {
  const caller = c.get("caller");
  const body = parse<any>(createRefundBody, await c.req.json());
  return c.json(await withUser(caller.id, (tx) => refunds.createRefund(tx, caller, body)), 201);
});

app.get("/refunds/:id", async (c) => {
  const caller = c.get("caller");
  const r = await withUser(caller.id, (tx) => refunds.getRefund(tx, c.req.param("id")));
  if (!r) throw new ApiError("REFUND_NOT_FOUND", "reembolso não encontrado");
  return c.json(r);
});

app.post("/refunds/:id/pickup", async (c) => {
  const caller = c.get("caller");
  return c.json(await withUser(caller.id, (tx) => refunds.pickUpRefund(tx, caller, c.req.param("id"))));
});

/** Uma rota só para dar baixa, com a validação que hoje só a gestora enfrenta. */
app.post("/refunds/:id/complete", async (c) => {
  const caller = c.get("caller");
  const body = parse<any>(completeRefundBody, await c.req.json());
  return c.json(
    await withUser(caller.id, (tx) => refunds.completeRefund(tx, caller, c.req.param("id"), body)),
  );
});

app.get("/refunds/:id/events", async (c) => {
  const caller = c.get("caller");
  const items = await withUser(caller.id, (tx) => refunds.listRefundEvents(tx, c.req.param("id")));
  return c.json({ items });
});

// ---------------------------------------------------------------------
// Transferências e tomada de ticket
// ---------------------------------------------------------------------

app.get("/transfers", async (c) => {
  const caller = c.get("caller");
  return c.json({ items: await withUser(caller.id, (tx) => transfers.listTransfers(tx, caller)) });
});

app.post("/transfers", async (c) => {
  const caller = c.get("caller");
  const b = parse<any>(createTransferBody, await c.req.json());
  return c.json(
    await withUser(caller.id, (tx) => transfers.createTransfer(tx, caller, b.ticketId, b.message ?? null)),
    201,
  );
});

app.post("/transfers/:id/accept", async (c) => {
  const caller = c.get("caller");
  const b = parse<any>(respondTransferBody, await c.req.json().catch(() => ({})));
  return c.json(await withUser(caller.id, (tx) =>
    transfers.respondTransfer(tx, caller, c.req.param("id"), true, b.responseNote ?? null)));
});

app.post("/transfers/:id/decline", async (c) => {
  const caller = c.get("caller");
  const b = parse<any>(respondTransferBody, await c.req.json().catch(() => ({})));
  return c.json(await withUser(caller.id, (tx) =>
    transfers.respondTransfer(tx, caller, c.req.param("id"), false, b.responseNote ?? null)));
});

app.get("/takeovers", async (c) => {
  const caller = c.get("caller");
  return c.json({ items: await withUser(caller.id, (tx) => transfers.listTakeovers(tx, caller)) });
});

app.post("/takeovers", async (c) => {
  const caller = c.get("caller");
  const b = parse<any>(createTakeoverBody, await c.req.json());
  return c.json(
    await withUser(caller.id, (tx) => transfers.createTakeover(tx, caller, b.ticketId, b.note ?? null)),
    201,
  );
});

/** Aprovar é onde o dono do ticket muda de verdade. */
app.post("/takeovers/:id/approve", async (c) => {
  const caller = c.get("caller");
  const b = parse<any>(respondTakeoverBody, await c.req.json().catch(() => ({})));
  return c.json(await withUser(caller.id, (tx) =>
    transfers.respondTakeover(tx, caller, c.req.param("id"), true, b.note ?? null)));
});

app.post("/takeovers/:id/reject", async (c) => {
  const caller = c.get("caller");
  const b = parse<any>(respondTakeoverBody, await c.req.json().catch(() => ({})));
  return c.json(await withUser(caller.id, (tx) =>
    transfers.respondTakeover(tx, caller, c.req.param("id"), false, b.note ?? null)));
});

// ---------------------------------------------------------------------
// Notificações — um sino, uma tabela. Substitui três consultas em laço.
// ---------------------------------------------------------------------

app.get("/notifications", async (c) => {
  const caller = c.get("caller");
  return c.json(await withUser(caller.id, (tx) => transfers.listNotifications(tx, caller)));
});

app.post("/notifications/:id/seen", async (c) => {
  const caller = c.get("caller");
  const ok = await withUser(caller.id, (tx) =>
    transfers.markNotificationSeen(tx, caller, Number(c.req.param("id"))));
  return c.json({ ok });
});

/** Catálogos: uma fonte só, servindo as duas telas. */
app.get("/catalogs", async (c) => {
  const caller = c.get("caller");
  return c.json(
    await withUser(caller.id, async (tx) => ({
      salesPlatforms: await tx`SELECT id, code, label, kind FROM core.selectable_sales_platforms`,
      channels: await tx`SELECT id, code, label, kind FROM core.selectable_channels`,
      products: await tx`SELECT id, name FROM core.products WHERE is_selectable ORDER BY name`,
    })),
  );
});
