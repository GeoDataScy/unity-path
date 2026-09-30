/**
 * Ponto de entrada da API como Função da Vercel.
 *
 * O mesmo app Hono que roda local em `apps/api/src/server.ts`. Aqui ele
 * é servido pela Vercel no mesmo domínio do front, então não há CORS
 * nem segundo domínio para configurar.
 */
import { handle } from "hono/vercel";
import { app } from "../apps/api/src/app.js";

export const config = { runtime: "nodejs" };

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
