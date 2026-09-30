/**
 * @xmx/contract — a fronteira entre apps/web e apps/api.
 *
 * Regra de dependência (00-CONTRATO.md §1):
 *   apps/web  ──depende──>  contract  <──depende──  apps/api
 *
 * `apps/web` nunca importa de `apps/api` nem de `packages/db`. Se o front
 * precisa de um tipo, ele vive aqui. É isso que torna a separação real e
 * não decorativa.
 */
export * from "./common.js";
export * from "./errors.js";
export * from "./metrics.js";
export * from "./refunds.js";
export * from "./session.js";
export * from "./transfers.js";
export * from "./tickets.js";
