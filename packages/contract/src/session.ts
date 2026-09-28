import { z } from "zod";
import { isoInstant, uuid } from "./common";

/**
 * GET /me — substitui `me_status`, as três leituras de `profiles` por
 * login e o `agent_heartbeat` de 30 segundos.
 *
 * Hoje um login faz três leituras de perfil e duas a três chamadas de
 * status, porque Login, Index/AreaSelect e o layout cada um busca por
 * conta própria. Aqui é uma resposta, lida do cache pelos três.
 */

export const ROLES = ["agent", "manager", "copy_grup", "produto"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Capacidades por usuário. São colunas booleanas, nomeadas pelo que
 * liberam — nunca por cargo.
 */
export const CAPABILITIES = [
  "can_view_all_tickets",
  "can_register_duplicate_emails",
  "can_claim_tickets",
  "can_approve_takeovers",
  "can_view_support_analytics",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const meResponse = z.object({
  id: uuid,
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(ROLES),
  /** Marca de disponibilidade (folga), usada pelo fluxo de tomada de ticket. */
  isAvailable: z.boolean(),
  supportChannel: z.string().nullable(),
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** Áreas que este usuário pode abrir. Uma só significa entrar direto. */
  areas: z.array(z.enum(["workspace", "dashboard", "copy", "produtos"])),
  serverTime: isoInstant,
});
export type MeResponse = z.infer<typeof meResponse>;
