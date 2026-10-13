// Edge Function `xmx-refunds-sync` — copia do banco MySQL de VENDAS da XMX
// (homosistemaxmx) para o Supabase tudo o que a página "Sistema XMX" mostra:
//   * reembolsos  → public.xmx_refunds     (um por linha de orders)
//   * chargebacks → public.xmx_chargebacks (um por linha de orders)
//   * vendas      → public.xmx_sales_daily (agregado dia × plataforma × país)
//
// Quem chama: pg_cron a cada 15 min (migration 20261010180100). Cada chamada:
//   1. carga inicial v2, um pedaço por chamada até terminar: repassa os
//      reembolsos (país, motivo, valores em US$) e traz os chargebacks, desde
//      2025-01-01, por orders.id;
//   2. incremental de pedidos por updated_at (cursor − 1 h), páginas de 2.000;
//   3. vendas: histórico mês a mês (até alcançar a janela recente) e, sempre, os
//      últimos SALES_WINDOW_DAYS dias — pedidos chegam com atraso de horas a
//      dias (o PagAmerican chega a ~5 dias).
// Toda a escrita mora no SQL (xmx_orders_apply, xmx_sales_apply), idempotente.
//
// MySQL é o banco de produção do dev de vendas: conexão READ ONLY, só SELECT
// nas 5 tabelas liberadas, e nunca lemos nome/e-mail de cliente. As anotações
// de reembolso (refunds_orders.note) são lidas só para virar uma CATEGORIA de
// motivo; o texto não é gravado.
// `orders` não tem índice em updated_at: o incremental custa ~0,5 s de scan.
//
// Secrets (nunca no repositório):
//   XMX_DB_HOST, XMX_DB_PORT, XMX_DB_USER, XMX_DB_PASSWORD, XMX_DB_NAME
//   XMX_REFUNDS_SYNC_TOKEN  -> Bearer exigido de quem chama (o cron)
//
// Deploy SEM verificação de JWT do Supabase (o cron manda o token próprio):
//   supabase functions deploy xmx-refunds-sync --project-ref cggigwessiododyjbegp --use-api --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import mysql from "npm:mysql2@3.11.0/promise";

import { motivo, pais } from "./classificar.ts";

const PAGE = 2000;
const BACKFILL_PAGES = 5; // ~10–30 s por chamada; a 1ª chamada fria levou 83 s com 8
const INCREMENTAL_MAX_PAGES = 25;
const BACKFILL_FROM = "2025-01-01";
const SALES_WINDOW_DAYS = 10;
const SALES_BACKFILL_MONTHS = 2; // com 4, a carga chegou a 78 s (o cron espera 120 s)

const KIND_SQL = `CASE
    WHEN o.status_id IN ('refunded','refund','rfnd','payment,refund','refund requested') THEN 'total'
    WHEN o.status_id IN ('partially refunded','partially_refunded','part_refund','rfnd_partial') THEN 'parcial'
  END`;
const CB_SQL = `(o.status_id IN ('chargeback','cgbk','partial chargeback','payment,chargeback','payment,refund,chargeback'))`;

// Valor do pedido em US$: o MySQL guarda o valor em R$ e o câmbio do dia.
// Sem câmbio, vale o valor original quando ele já está em dólar.
const ORDER_USD_SQL = `CASE
    WHEN o.cotacao_dolar > 0 AND o.total_price_real_brazil IS NOT NULL THEN o.total_price_real_brazil / o.cotacao_dolar
    WHEN o.total_order_symbol IN ('USD','US') OR o.total_order_symbol IS NULL OR o.total_order_symbol = '' THEN o.total_order_amount
  END`;

// Só colunas que a página precisa. Nada de first_name/last_name/email_client.
const SELECT_SQL = `SELECT o.id, CAST(o.platform_id AS UNSIGNED) AS platform_id, p.name AS platform_name,
    o.order_id_cartpanda AS order_code, o.status_id AS status, ${KIND_SQL} AS kind,
    ${CB_SQL} AS is_cb, o.date_refund AS refund_at, o.date_chargeback AS chargeback_at,
    o.purchase_date AS purchase_at, o.updated_at, o.country,
    ${ORDER_USD_SQL} AS order_usd, o.cotacao_dolar AS fx,
    o.refund_total_amount_real_brazil AS refund_brl
  FROM orders o LEFT JOIN platforms p ON p.id = o.platform_id`;

type OrderRow = {
  id: number;
  platform_id: number;
  platform_name: string | null;
  order_code: string | null;
  status: string | null;
  kind: "total" | "parcial" | null;
  is_cb: number | string;
  refund_at: string | null;
  chargeback_at: string | null;
  purchase_at: string | null;
  updated_at: string;
  country: string | null;
  order_usd: string | null;
  fx: string | null;
  refund_brl: string | null;
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
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const somaMeses = (dia: string, n: number) => {
  const d = new Date(`${dia.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "metodo_nao_permitido" }, 405);
  if (!tokenOk(req.headers.get("authorization"), Deno.env.get("XMX_REFUNDS_SYNC_TOKEN") ?? "")) {
    return json({ erro: "nao_autorizado" }, 401);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const inicio = Date.now();
  const c = { lidos: 0, upserted: 0, unrefunded: 0, chargebacks: 0, unchargebacked: 0, vendas_linhas: 0 };
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
    // "Hoje" no fuso do servidor de vendas (São Paulo), antes de trocar o fuso da sessão.
    const [[hojeRow]] = (await conn.query("SELECT CURDATE() AS d")) as unknown as [[{ d: string }]];
    const hoje = hojeRow.d;
    // TIMESTAMP (updated_at) passa a vir em UTC. DATETIME (date_refund,
    // purchase_date, date_chargeback) não muda: continua o horário de SP gravado.
    await conn.query("SET time_zone = '+00:00'");

    // Valor reembolsado (refunds_orders sem as linhas duplicadas: mesmo
    // order_id + total_amount + create_at_refund) e a anotação de motivo.
    // R$ no Cartpanda antigo (id 1), US$ nas demais. Só existe p/ 1, 6, 7, 8.
    const detalhes = async (ids: number[]) => {
      const valor = new Map<number, number>();
      const razao = new Map<number, string>();
      if (ids.length === 0) return { valor, razao };
      const [vals] = await conn!.query(
        `SELECT order_id, SUM(total_amount) AS amount FROM (
           SELECT DISTINCT order_id, total_amount, create_at_refund FROM refunds_orders WHERE order_id IN (?)
         ) x GROUP BY order_id`,
        [ids],
      );
      for (const r of vals as { order_id: number; amount: string }[]) valor.set(Number(r.order_id), Number(r.amount));
      const [notas] = await conn!.query(
        `SELECT order_id, note FROM refunds_orders
          WHERE order_id IN (?) AND note IS NOT NULL AND note NOT IN ('', '--')
          ORDER BY order_id, create_at_refund`,
        [ids],
      );
      // Vale a primeira anotação que vira uma categoria.
      for (const r of notas as { order_id: number; note: string }[]) {
        const id = Number(r.order_id);
        if (razao.has(id)) continue;
        const m = motivo(r.note);
        if (m) razao.set(id, m);
      }
      return { valor, razao };
    };

    const aplicar = async (rows: OrderRow[], estado: Record<string, unknown>) => {
      const { valor, razao } = await detalhes(rows.filter((r) => r.kind).map((r) => Number(r.id)));
      const payload = rows.map((r) => {
        const id = Number(r.id);
        const fx = num(r.fx);
        const orderUsd = num(r.order_usd);
        const base = {
          id,
          platform_id: Number(r.platform_id),
          platform_name: r.platform_name,
          order_code: r.order_code,
          status: r.status,
          updated_at: r.updated_at ? utcIso(r.updated_at) : null,
          purchase_at: r.purchase_at,
          country: pais(r.country),
          order_usd: orderUsd === null ? null : Math.round(orderUsd * 100) / 100,
          is_chargeback: Number(r.is_cb) === 1,
          chargeback_at: r.chargeback_at,
        };
        if (!r.kind) return { ...base, refund_kind: null };
        const amount = valor.get(id) ?? null;
        const currency = amount === null ? null : Number(r.platform_id) === 1 ? "BRL" : "USD";
        // US$ reembolsado: refunds_orders → valor em R$ de orders → (se total) o pedido inteiro.
        let refundUsd: number | null = null;
        if (amount !== null) refundUsd = currency === "BRL" ? (fx ? amount / fx : null) : amount;
        const refundBrl = num(r.refund_brl);
        if (refundUsd === null && refundBrl !== null && fx) refundUsd = refundBrl / fx;
        if (refundUsd === null && r.kind === "total") refundUsd = orderUsd;
        return {
          ...base,
          refund_kind: r.kind,
          refund_at: r.refund_at,
          refund_amount: amount,
          refund_currency: currency,
          refund_usd: refundUsd === null ? null : Math.round(refundUsd * 100) / 100,
          reason: razao.get(id) ?? null,
        };
      });
      const { data, error } = await supabase.rpc("xmx_orders_apply", { p_rows: payload, p_state: estado });
      if (error) throw new Error(`xmx_orders_apply: ${error.message}`);
      const d = data as { upserted: number; unrefunded: number; chargebacks: number; unchargebacked: number };
      c.upserted += d.upserted;
      c.unrefunded += d.unrefunded;
      c.chargebacks += d.chargebacks;
      c.unchargebacked += d.unchargebacked;
      c.lidos += rows.length;
    };

    // Vendas de um intervalo de dias [de, ate], agregadas no MySQL e gravadas
    // substituindo esse intervalo inteiro.
    const vendas = async (de: string, ate: string, estado: Record<string, unknown>) => {
      const [rows] = await conn!.query(
        `SELECT DATE(o.purchase_date) AS day, CAST(o.platform_id AS UNSIGNED) AS platform_id, o.country,
                COUNT(DISTINCT o.order_id_cartpanda) AS orders, COUNT(*) AS line_count,
                SUM(${ORDER_USD_SQL}) AS gross_usd
           FROM orders o
          WHERE o.purchase_date >= ? AND o.purchase_date < ?
          GROUP BY 1, 2, 3`,
        [`${de} 00:00:00`, `${somaDias(ate, 1)} 00:00:00`],
      );
      type Linha = { day: string; platform_id: number; country: string | null; orders: number; line_count: number; gross_usd: string | null };
      const payload = (rows as Linha[]).map((r) => ({
        day: r.day,
        platform_id: Number(r.platform_id),
        country: pais(r.country),
        orders: Number(r.orders),
        lines: Number(r.line_count),
        gross_usd: num(r.gross_usd) ?? 0,
      }));
      const { data, error } = await supabase.rpc("xmx_sales_apply", { p_from: de, p_to: ate, p_rows: payload, p_state: estado });
      if (error) throw new Error(`xmx_sales_apply: ${error.message}`);
      c.vendas_linhas += Number(data);
    };

    // Primeira execução: o incremental começa de agora (−1 h); as cargas
    // iniciais cobrem o passado. Assim nada que mude durante a carga se perde.
    let cursor: string | null = state.cursor_updated_at;
    if (!cursor) {
      const [[agora]] = (await conn.query("SELECT UTC_TIMESTAMP() AS t")) as unknown as [[{ t: string }]];
      cursor = utcIso(agora.t);
      await aplicar([], { cursor_updated_at: cursor });
    }

    // 1) Carga inicial v2 (reembolsos com colunas novas + chargebacks), por orders.id.
    let backfillPaginas = 0;
    if (!state.v2_backfill_done) {
      let lastId = Number(state.v2_backfill_cursor_id ?? 0);
      for (; backfillPaginas < BACKFILL_PAGES; backfillPaginas++) {
        const [rows] = await conn.query(
          `${SELECT_SQL}
            WHERE o.id > ?
              AND (((${KIND_SQL}) IS NOT NULL AND o.date_refund >= ?) OR (${CB_SQL} AND o.date_chargeback >= ?))
            ORDER BY o.id LIMIT ${PAGE}`,
          [lastId, BACKFILL_FROM, BACKFILL_FROM],
        );
        const lote = rows as OrderRow[];
        const fim = lote.length < PAGE;
        if (lote.length) lastId = Number(lote[lote.length - 1].id);
        await aplicar(lote, { v2_backfill_cursor_id: lastId, v2_backfill_done: fim });
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

    // 3) Vendas: histórico mês a mês até alcançar a janela recente; a janela sempre.
    const janelaDe = somaDias(hoje, -SALES_WINDOW_DAYS);
    let vendasMeses = 0;
    if (!state.sales_backfill_done) {
      let mes = String(state.sales_backfill_month ?? BACKFILL_FROM).slice(0, 10);
      for (; vendasMeses < SALES_BACKFILL_MONTHS && mes < janelaDe; vendasMeses++) {
        const fimMes = somaDias(somaMeses(mes, 1), -1);
        const ate = fimMes < janelaDe ? fimMes : somaDias(janelaDe, -1);
        const proximo = somaMeses(mes, 1);
        await vendas(mes, ate, { sales_backfill_month: proximo, sales_backfill_done: proximo >= janelaDe });
        mes = proximo;
      }
      if (mes >= janelaDe) await vendas(janelaDe, janelaDe, { sales_backfill_done: true });
    }
    await vendas(janelaDe, hoje, {});

    await supabase.rpc("xmx_sync_finish", { p_status: "ok", p_upserted: c.upserted, p_unrefunded: c.unrefunded });
    const resumo = {
      evento: "xmx_refunds_sync",
      ...c,
      backfill_paginas: backfillPaginas,
      incremental_paginas: incPaginas + 1,
      vendas_meses_carregados: vendasMeses,
      cursor: new Date(maxUpdatedMs).toISOString(),
      ms: Date.now() - inicio,
    };
    console.log(JSON.stringify(resumo));
    return json(resumo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ evento: "xmx_refunds_sync_falhou", erro: msg, ...c }));
    await supabase.rpc("xmx_sync_finish", { p_status: "erro", p_upserted: c.upserted, p_unrefunded: c.unrefunded, p_error: msg });
    return json({ erro: "falha_sync", mensagem: msg }, 500);
  } finally {
    await conn?.end().catch(() => {});
  }
});
