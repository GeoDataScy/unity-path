import type { Capability, Role } from "@xmx/contract";
import type { MiddlewareHandler } from "hono";
import { sql } from "../db.ts";
import { verifyAccessToken } from "./jwt.ts";
import { ApiError } from "../lib/errors.ts";

/**
 * Identidade de quem chamou.
 *
 * O JWT continua sendo emitido pelo Supabase Auth: login, refresh e
 * logout não mudam. A API valida a assinatura e carrega o perfil.
 *
 * O front pode esconder, nunca autorizar (G3.4): toda rota confere de
 * novo, e o teste chama a rota sem a capacidade exigindo recusa.
 */
export type Caller = {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  isAvailable: boolean;
  capabilities: Capability[];
  can: (c: Capability) => boolean;
};

declare module "hono" {
  interface ContextVariableMap {
    caller: Caller;
  }
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; caller: Caller }>();

const CAPABILITY_COLUMNS: Capability[] = [
  "can_view_all_tickets",
  "can_register_duplicate_emails",
  "can_claim_tickets",
  "can_approve_takeovers",
  "can_view_support_analytics",
];

async function loadProfile(userId: string): Promise<Caller> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.caller;

  const rows = await sql<Array<Record<string, any>>>`
    SELECT id, email, full_name, role, is_active, is_available,
           ${sql.unsafe(CAPABILITY_COLUMNS.join(", "))}
      FROM core.users WHERE id = ${userId}::uuid`;

  const u = rows[0];
  if (!u) throw new ApiError("USER_NOT_FOUND", "perfil não encontrado");

  // Conta desativada é barrada aqui, a cada requisição, com cache curto.
  // Substitui o `me_status` que era chamado a cada 30 segundos por aba.
  if (!u.is_active) throw new ApiError("ACCOUNT_BLOCKED", "conta desativada");

  const capabilities = CAPABILITY_COLUMNS.filter((c) => u[c] === true);
  const caller: Caller = {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isAvailable: u.is_available,
    capabilities,
    can: (c) => capabilities.includes(c),
  };

  cache.set(userId, { at: Date.now(), caller });
  return caller;
}

export const invalidateProfile = (userId: string) => cache.delete(userId);

/**
 * Extrai o usuário do token.
 *
 * Em desenvolvimento e teste aceita `Authorization: Bearer dev:<uuid>`,
 * para que a suíte exercite as rotas de verdade sem depender do Supabase.
 * Em produção isso é recusado.
 */
export const requireAuth = (): MiddlewareHandler => async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new ApiError("UNAUTHENTICATED", "token ausente");

  let userId: string;
  if (token.startsWith("dev:")) {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_TOKENS !== "1") {
      throw new ApiError("UNAUTHENTICATED", "token de desenvolvimento recusado em produção");
    }
    userId = token.slice(4);
  } else {
    userId = (await verifyAccessToken(token)).sub;
  }

  c.set("caller", await loadProfile(userId));
  await next();
};

/** Exige uma capacidade. O front espelha isto só para esconder botão. */
export const requireCapability =
  (cap: Capability): MiddlewareHandler =>
  async (c, next) => {
    if (!c.get("caller").can(cap)) {
      throw new ApiError("MISSING_CAPABILITY", `requer ${cap}`, { capability: cap });
    }
    await next();
  };
