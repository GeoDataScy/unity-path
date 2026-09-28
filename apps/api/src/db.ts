import postgres from "postgres";

/**
 * Conexão única.
 *
 * A API conecta com um papel dedicado (`api_request`) e assume a
 * identidade de quem chamou por transação (decisão D2). A proteção por
 * linha continua existindo como rede: o recorte real vai no WHERE,
 * servido por índice, e a policy só confirma. Ela nunca é quem reduz o
 * conjunto — foi essa inversão que derrubou o banco em julho.
 */
export const sql = postgres(process.env.DATABASE_URL ?? "postgres://localhost/xmx_v2_test", {
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idle_timeout: 20,
  // O schema novo vive em `core`; `public` entra pelo citext.
  connection: { search_path: "core,public" },
  onnotice: () => {},
});

/**
 * Executa dentro de uma transação, com a identidade do usuário aplicada
 * com escopo local. `SET LOCAL` morre no commit, o que é compatível com
 * pooler em modo transação e com execução sem servidor.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export type Tx = postgres.TransactionSql;
