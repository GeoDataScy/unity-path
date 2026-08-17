/**
 * Extração de mensagem de erro do supabase-js.
 *
 * Sem `throwOnError`, o `error` devolvido por `.rpc()`/`.from()` é um objeto
 * simples (`{ message, details, hint, code }`) — e não uma instância de `Error`.
 * Por isso o padrão `error instanceof Error ? error.message : "texto genérico"`
 * sempre cai no texto genérico e esconde o motivo real da falha (guard de RPC,
 * JWT expirado, constraint violada, função fora do schema cache...).
 */

type SupabaseLikeError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asSupabaseLikeError(error: unknown): SupabaseLikeError | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as SupabaseLikeError;
  const hasText =
    trimmed(candidate.message) !== "" ||
    trimmed(candidate.details) !== "" ||
    trimmed(candidate.hint) !== "" ||
    trimmed(candidate.code) !== "";
  return hasText ? candidate : null;
}

/**
 * Mensagem legível para o usuário. Mantém o `code` do Postgres/PostgREST no
 * final porque é o que permite distinguir "regra de negócio recusou" (P0001) de
 * "sessão expirada" (PGRST301) ou "função ausente" (PGRST202) no relato do
 * usuário — sem ele, toda falha vira "não foi possível".
 */
export function supabaseErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim() !== "") return error.trim();

  const like = asSupabaseLikeError(error);
  if (!like) {
    const message = error instanceof Error ? trimmed(error.message) : "";
    return message || fallback;
  }

  const message = trimmed(like.message) || trimmed(like.details) || fallback;
  const code = trimmed(like.code);
  return code ? `${message} (${code})` : message;
}

/**
 * Normaliza qualquer erro do supabase-js em `Error`, para que os `catch` que
 * checam `instanceof Error` continuem valendo. O objeto original fica em
 * `cause` (details/hint seguem disponíveis no console).
 */
export function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error && trimmed(error.message) !== "") return error;
  const normalized = new Error(supabaseErrorMessage(error, fallback));
  if (error !== undefined && error !== null) {
    (normalized as { cause?: unknown }).cause = error;
  }
  return normalized;
}
