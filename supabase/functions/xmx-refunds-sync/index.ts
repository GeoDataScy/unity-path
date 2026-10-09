// Edge Function `xmx-refunds-sync` — copia os reembolsos do banco MySQL de
// VENDAS da XMX (homosistemaxmx) para public.xmx_refunds.
//
// Quem chama: pg_cron a cada 15 min (migration 20261010180100). Cada chamada:
//   1. enquanto a carga inicial não termina, avança até BACKFILL_PAGES páginas
//      de 2.000 pedidos reembolsados desde 2025-01-01, por orders.id;
//   2. faz o incremental: pedidos com updated_at >= cursor − 1 h (a margem evita
//      perder linha gravada no mesmo segundo), em páginas de 2.000 por id. Quem
//      está em reembolso é gravado; quem saiu do reembolso vira is_refunded = false.
// Toda a escrita mora no SQL (xmx_refunds_apply), que é idempotente.
//
// MySQL é o banco de produção do dev de vendas: conexão READ ONLY, só SELECT
// nas 5 tabelas liberadas, e nunca lemos nome/e-mail de cliente.
// `orders` não tem índice em updated_at: o incremental custa ~0,5 s de scan.
//
// Secrets (nunca no repositório):
//   XMX_DB_HOST, XMX_DB_PORT, XMX_DB_USER, XMX_DB_PASSWORD, XMX_DB_NAME
//   XMX_REFUNDS_SYNC_TOKEN  -> Bearer exigido de quem chama (o cron)
//
// Deploy SEM verificação de JWT do Supabase (o cron manda o token próprio):
//   supabase functions deploy xmx-refunds-sync --project-ref kjkyyqxqrqsdozjyyuon --use-api --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import mysql from "npm:mysql2@3.11.0/promise";

const PAGE = 2000;
const BACKFILL_PAGES = 5; // ~10–30 s por chamada; a 1ª chamada fria levou 83 s com 8
const INCREMENTAL_MAX_PAGES = 25;
const BACKFILL_FROM = "2025-01-01";

const KIND_SQL = `CASE
    WHEN o.status_id IN ('refunded','refund','rfnd','payment,refund','refund requested') THEN 'total'
    WHEN o.status_id IN ('partially refunded','partially_refunded','part_refund','rfnd_partial') THEN 'parcial'
  END`;

// Só colunas que o gráfico precisa. Nada de first_name/last_name/email_client.
const SELECT_SQL = `SELECT o.id, CAST(o.platform_id AS UNSIGNED) AS platform_id, p.name AS platform_name,
    o.order_id_cartpanda AS order_code, o.status_id AS status, ${KIND_SQL} AS kind,
    o.date_refund AS refund_at, o.purchase_date AS purchase_at, o.updated_at
  FROM orders o LEFT JOIN platforms p ON p.id = o.platform_id`;

type OrderRow = {
  id: number;
  platform_id: number;
  platform_name: string | null;
  order_code: string | null;
  status: string | null;
  kind: "total" | "parcial" | null;
  refund_at: string | null;
  purchase_at: string | null;
  updated_at: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function tokenOk(header: string | null, esperado: string) {
  if (!esperado || !header?.startsWith("Bearer ")) return false;
  const recebido = header.slice(7);
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

/** 'YYYY-MM-DD HH:MM:SS' em UTC (sessão MySQL em +00:00) → ISO. */
const utcIso = (s: string) => s.replace(" ", "T") + "Z";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "metodo_nao_permitido" }, 405);
  if (!tokenOk(req.headers.get("authorization"), Deno.env.get("XMX_REFUNDS_SYNC_TOKEN") ?? "")) {
    return json({ erro: "nao_autorizado" }, 401);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const inicio = Date.now();
  let upserted = 0;
  let unrefunded = 0;
  let lidos = 0;
  let conn: mysql.Connection | null = null;

  try {
    const { data: state, error: stErr } = await supabase.from("xmx_sync_state").select("*").eq("id", 1).single();
    if (stErr) throw new Error(`estado: ${stErr.message}`);

    conn = await mysql.createConnection({
      host: Deno.env.get("XMX_DB_HOST"),
      port: Number(Deno.env.get("XMX_DB_PORT") ?? "3306"),
      user: Deno.env.get("XMX_DB_USER"),
      password: Deno.env.get("XMX_DB_PASSWORD"),
      database: Deno.env.get("XMX_DB_NAME"),
      dateStrings: true,
      connectTimeout: 15_000,
    });
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    // TIMESTAMP (updated_at) passa a vir em UTC. DATETIME (date_refund,
    // purchase_date) não muda: continua o horário de São Paulo gravado.
    await conn.query("SET time_zone = '+00:00'");

    // Valor reembolsado: soma de refunds_orders sem as linhas duplicadas
    // (mesmo order_id + total_amount + create_at_refund). R$ no Cartpanda
    // antigo (id 1), US$ nas demais. Só existe para as plataformas 1, 6, 7, 8.
    const valores = async (ids: number[]) => {
      const mapa = new Map<number, number>();
      if (ids.length === 0) return mapa;
      const [rows] = await conn!.query(
        `SELECT order_id, SUM(total_amount) AS amount FROM (
           SELECT DISTINCT order_id, total_amount, create_at_refund FROM refunds_orders WHERE order_id IN (?)
         ) x GROUP BY order_id`,
        [ids],
      );
      for (const r of rows as { order_id: number; amount: string }[]) mapa.set(Number(r.order_id), Number(r.amount));
      return mapa;
    };

    const aplicar = async (rows: OrderRow[], estado: Record<string, unknown>) => {
      const refundIds = rows.filter((r) => r.kind).map((r) => Number(r.id));
      const amounts = await valores(refundIds);
      const payload = rows.map((r) =>
        r.kind
          ? {
              id: Number(r.id),
              platform_id: Number(r.platform_id),
              platform_name: r.platform_name,
              order_code: r.order_code,
              kind: r.kind,
              status: r.status,
              refund_at: r.refund_at,
              purchase_at: r.purchase_at,
              amount: amounts.get(Number(r.id)) ?? null,
              currency: amounts.has(Number(r.id)) ? (Number(r.platform_id) === 1 ? "BRL" : "USD") : null,
              updated_at: r.updated_at ? utcIso(r.updated_at) : null,
            }
          : { id: Number(r.id), kind: null, status: r.status, updated_at: r.updated_at ? utcIso(r.updated_at) : null },
      );
      const { data, error } = await supabase.rpc("xmx_refunds_apply", { p_rows: payload, p_state: estado });
      if (error) throw new Error(`xmx_refunds_apply: ${error.message}`);
      upserted += (data as { upserted: number }).upserted;
      unrefunded += (data as { unrefunded: number }).unrefunded;
      lidos += rows.length;
    };

    // Primeira execução: o incremental começa de agora (−1 h); a carga inicial
    // cobre o passado. Assim nada que mude durante a carga se perde.
    let cursor: string | null = state.cursor_updated_at;
    if (!cursor) {
      const [[agora]] = (await conn.query("SELECT UTC_TIMESTAMP() AS t")) as unknown as [[{ t: string }]];
      cursor = utcIso(agora.t);
      await aplicar([], { cursor_updated_at: cursor });
    }

    // 1) Carga inicial, por orders.id.
    let backfillPaginas = 0;
    if (!state.backfill_done) {
      let lastId = Number(state.backfill_cursor_id ?? 0);
      for (; backfillPaginas < BACKFILL_PAGES; backfillPaginas++) {
        const [rows] = await conn.query(
          `${SELECT_SQL} WHERE o.id > ? AND (${KIND_SQL}) IS NOT NULL AND o.date_refund >= ? ORDER BY o.id LIMIT ${PAGE}`,
          [lastId, BACKFILL_FROM],
        );
        const lote = rows as OrderRow[];
        const fim = lote.length < PAGE;
        if (lote.length) lastId = Number(lote[lote.length - 1].id);
        await aplicar(lote, { backfill_cursor_id: lastId, backfill_done: fim });
        if (fim) break;
      }
    }

    // 2) Incremental por updated_at (com margem de 1 h), paginado por id.
    const desde = new Date(new Date(cursor).getTime() - 3600_000).toISOString().slice(0, 19).replace("T", " ");
    let maxUpdatedMs = new Date(cursor).getTime();
    let lastId = 0;
    let incPaginas = 0;
    for (; incPaginas < INCREMENTAL_MAX_PAGES; incPaginas++) {
      const [rows] = await conn.query(`${SELECT_SQL} WHERE o.updated_at >= ? AND o.id > ? ORDER BY o.id LIMIT ${PAGE}`, [
        desde,
        lastId,
      ]);
      const lote = rows as OrderRow[];
      for (const r of lote) {
        if (r.updated_at) maxUpdatedMs = Math.max(maxUpdatedMs, new Date(utcIso(r.updated_at)).getTime());
      }
      const fim = lote.length < PAGE;
      if (lote.length) lastId = Number(lote[lote.length - 1].id);
      // O cursor só avança na última página: se cair no meio, a próxima
      // execução refaz a janela inteira (o apply é idempotente).
      await aplicar(lote, fim ? { cursor_updated_at: new Date(maxUpdatedMs).toISOString() } : {});
      if (fim) break;
    }

    await supabase.rpc("xmx_sync_finish", { p_status: "ok", p_upserted: upserted, p_unrefunded: unrefunded });
    const resumo = {
      evento: "xmx_refunds_sync",
      lidos,
      upserted,
      unrefunded,
      backfill_paginas: backfillPaginas,
      incremental_paginas: incPaginas + 1,
      cursor: new Date(maxUpdatedMs).toISOString(),
      ms: Date.now() - inicio,
    };
    console.log(JSON.stringify(resumo));
    return json(resumo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ evento: "xmx_refunds_sync_falhou", erro: msg, upserted, unrefunded }));
    await supabase.rpc("xmx_sync_finish", { p_status: "erro", p_upserted: upserted, p_unrefunded: unrefunded, p_error: msg });
    return json({ erro: "falha_sync", mensagem: msg }, 500);
  } finally {
    await conn?.end().catch(() => {});
  }
});
