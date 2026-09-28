import {
  createInteractionBody,
  createTicketBody,
  listTicketsQuery,
  lookupTicketQuery,
  type MeResponse,
} from "@xmx/contract";
import { Hono } from "hono";
import { withUser } from "./db.ts";
import { ApiError } from "./lib/errors.ts";
import { decodeCursor } from "./lib/cursor.ts";
import { requireAuth } from "./middleware/auth.ts";
import * as repo from "./modules/tickets/repository.ts";
import * as tickets from "./modules/tickets/service.ts";

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

/** Catálogos: uma fonte só, servindo as duas telas. */
app.get("/catalogs", requireAuth(), async (c) => {
  const caller = c.get("caller");
  return c.json(
    await withUser(caller.id, async (tx) => ({
      salesPlatforms: await tx`SELECT id, code, label, kind FROM core.selectable_sales_platforms`,
      channels: await tx`SELECT id, code, label, kind FROM core.selectable_channels`,
      products: await tx`SELECT id, name FROM core.products WHERE is_selectable ORDER BY name`,
    })),
  );
});
