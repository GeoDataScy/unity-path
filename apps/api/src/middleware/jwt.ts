import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiError } from "../lib/errors.ts";

/**
 * Verificação do token do Supabase Auth.
 *
 * O login, o refresh e o logout continuam sendo do Supabase — o que muda
 * é que a API confere a assinatura em vez de confiar no conteúdo.
 *
 * O projeto publica chaves assimétricas (ES256) em JWKS, que é o caminho
 * preferido: a API verifica sem guardar segredo nenhum. HS256 continua
 * aceito para projetos que ainda emitem assim, e nesse caso o segredo é
 * obrigatório — sem ele a verificação falha, em vez de passar batido.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!SUPABASE_URL) {
    throw new ApiError("INTERNAL", "SUPABASE_URL não configurada");
  }
  jwks ??= createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), {
    // O conjunto de chaves é cacheado; a rotação é buscada sozinha.
    cacheMaxAge: 10 * 60_000,
    cooldownDuration: 30_000,
  });
  return jwks;
}

export type Claims = JWTPayload & { sub: string; email?: string; role?: string };

export async function verifyAccessToken(token: string): Promise<Claims> {
  const header = decodeHeader(token);

  let payload: JWTPayload;
  try {
    if (header.alg === "HS256") {
      if (!JWT_SECRET) {
        throw new ApiError("INTERNAL", "token HS256 recebido e SUPABASE_JWT_SECRET não configurado");
      }
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET), {
        algorithms: ["HS256"],
      }));
    } else {
      ({ payload } = await jwtVerify(token, getJwks(), {
        algorithms: ["ES256", "RS256"],
      }));
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const code = (e as any)?.code;
    if (code === "ERR_JWT_EXPIRED") {
      throw new ApiError("TOKEN_EXPIRED", "token expirado");
    }
    throw new ApiError("UNAUTHENTICATED", "assinatura inválida");
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new ApiError("UNAUTHENTICATED", "token sem identificação de usuário");
  }

  // `role` no token do Supabase é o papel do banco (authenticated), não o
  // papel de negócio. O papel de negócio vem do perfil, nunca do token,
  // para que trocar de cargo não dependa de expirar sessão.
  return payload as Claims;
}

function decodeHeader(token: string): { alg?: string } {
  const [raw] = token.split(".");
  if (!raw) throw new ApiError("UNAUTHENTICATED", "token malformado");
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("UNAUTHENTICATED", "token malformado");
  }
}
