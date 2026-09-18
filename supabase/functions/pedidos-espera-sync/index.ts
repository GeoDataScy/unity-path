// Edge Function `pedidos-espera-sync` — o endpoint POST /sync da especificação
// "API Pedidos em Espera" (17/09/2026).
//
// Por que existe: o app roda 100% no browser e não há backend neste repositório.
// O Wall-E precisa de um endereço HTTP com token próprio, que não seja o do
// usuário logado e não passe pelo Supabase Auth. Aqui o token do Wall-E é
// validado contra um secret do projeto (WALLE_SYNC_TOKEN) e a escrita é delegada
// à RPC sync_held_orders, que é quem implementa as três regras do contrato e só
// aceita service_role.
//
// Toda a lógica de negócio fica no Postgres, de propósito: é lá que estão a chave
// natural, o índice parcial que impede duplicata e a transação. Esta função é
// transporte — autentica, valida o formato e traduz erro em código HTTP.
//
// Secrets necessários (supabase secrets set):
//   WALLE_SYNC_TOKEN        token estático do Wall-E (um por ambiente)
//   SUPABASE_URL            já vem do runtime
//   SUPABASE_SERVICE_ROLE_KEY  já vem do runtime
//
// Chamada:
//   POST /functions/v1/pedidos-espera-sync
//   Authorization: Bearer <WALLE_SYNC_TOKEN>      (ou header `apikey`)
//   Content-Type: application/json
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Resposta à pergunta em aberto da spec ("confirmar o tamanho máximo de lote").
// 5.000 itens cobre com folga o estoque atual (3.289) num lote só; acima disso o
// Wall-E pagina e a regra 3 roda na última página, como a própria spec prevê.
const MAX_ITENS_POR_REQUISICAO = 5000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Comparação de tempo constante. Um `===` vaza, pelo tempo de resposta, quantos
 * caracteres do token o atacante já acertou.
 */
function tokensIguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** Token do Wall-E: `Authorization: Bearer <token>` ou header `apikey`. */
function tokenDaRequisicao(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (bearer) return bearer[1].trim();
  const apikey = req.headers.get("apikey");
  return apikey ? apikey.trim() : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida o envelope antes de gastar uma transação no banco. Só o envelope — item
 * inválido é rejeitado individualmente pela RPC e volta em `rejeitados`, que é o
 * que a spec pede (um CSV torto não pode derrubar o lote do dia).
 */
function erroDeEnvelope(body: Record<string, unknown>): string | null {
  if (typeof body.fonte !== "string" || !body.fonte.trim()) {
    return "fonte obrigatoria";
  }
  if (typeof body.referencia !== "string" || !ISO_DATE.test(body.referencia)) {
    return "referencia obrigatoria no formato AAAA-MM-DD";
  }
  if (typeof body.completo !== "boolean") {
    return "completo obrigatorio (booleano)";
  }
  if (!Array.isArray(body.itens)) {
    return "itens obrigatorio (array, pode ser vazio)";
  }
  if (body.itens.length > MAX_ITENS_POR_REQUISICAO) {
    return `lote acima do limite: ${body.itens.length} itens, maximo ${MAX_ITENS_POR_REQUISICAO} por requisicao — use paginacao (pagina/totalPaginas)`;
  }
  if (body.geradoEm != null && Number.isNaN(Date.parse(String(body.geradoEm)))) {
    return "geradoEm invalido (ISO 8601)";
  }
  const pagina = body.pagina;
  const total = body.totalPaginas;
  if (pagina != null && (!Number.isInteger(pagina) || (pagina as number) < 1)) {
    return "pagina deve ser inteiro >= 1";
  }
  if (total != null && (!Number.isInteger(total) || (total as number) < 1)) {
    return "totalPaginas deve ser inteiro >= 1";
  }
  if (pagina != null && total != null && (pagina as number) > (total as number)) {
    return "pagina maior que totalPaginas";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (req.method !== "POST") {
    return json({ erro: "metodo nao suportado; use POST" }, 405);
  }

  const esperado = Deno.env.get("WALLE_SYNC_TOKEN");
  if (!esperado) {
    // Falha de configuração do painel, não do Wall-E: 5xx faz ele tentar de novo
    // com backoff, que é o comportamento certo enquanto alguém configura o secret.
    return json({ erro: "integracao nao configurada (WALLE_SYNC_TOKEN ausente)" }, 503);
  }

  const recebido = tokenDaRequisicao(req);
  if (!recebido || !tokensIguais(recebido, esperado)) {
    return json({ erro: "token invalido" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "payload malformado: JSON invalido" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ erro: "payload malformado: esperado objeto JSON" }, 400);
  }

  const problema = erroDeEnvelope(body);
  if (problema) return json({ erro: `envelope invalido: ${problema}` }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("sync_held_orders", { p_payload: body });

  if (error) {
    // A RPC levanta 22023 (invalid_parameter_value) para envelope que ela mesma
    // recusa; qualquer outra coisa é problema do painel e o Wall-E deve repetir.
    const invalido = error.code === "22023" || /envelope invalido|payload invalido/i.test(error.message ?? "");
    return json({ erro: error.message }, invalido ? 400 : 500);
  }

  const resultado = (data ?? {}) as Record<string, unknown>;

  // Reenvio de um lote já processado: a spec manda o Wall-E tratar 409 como
  // sucesso. Devolvemos o resultado original junto, para o log dele bater.
  if (resultado.jaProcessado === true) {
    return json(resultado, 409);
  }

  return json(resultado, 200);
});
