// Edge Function `late-hunter-sync` — porta de entrada do Late Hunter.
//
// O Late Hunter (o "Wall-E" da especificação "API Pedidos em Espera") chama
// esta função a cada varredura (7x por dia: 04:15, 07:15, 10:15, 13:15, 16:15,
// 19:15 e 22:15 UTC) com o lote consolidado de on-holds da ShipOffers. Cada
// varredura é um lote, identificado por `geradoEm`; todas as páginas de uma
// varredura levam o mesmo `geradoEm`. Toda a regra de negócio (upsert, encerramento,
// idempotência, paginação) mora na função SQL `late_hunter_sync`, que roda numa
// transação só. Aqui ficam só a porta: autenticação, limites e o envelope.
//
// Autenticação: Bearer estático, um token por ambiente, guardados nos secrets
// do projeto Supabase:
//   LATE_HUNTER_TOKEN_PRODUCAO     -> grava em ambiente 'producao'
//   LATE_HUNTER_TOKEN_HOMOLOGACAO  -> grava em ambiente 'homologacao'
// É o token que decide o ambiente; o corpo não escolhe.
//
// Deploy SEM verificação de JWT do Supabase (o Late Hunter não tem sessão):
//   supabase functions deploy late-hunter-sync --project-ref kjkyyqxqrqsdozjyyuon --use-api --no-verify-jwt
//
// O payload traz nome, e-mail e endereço de cliente final: NUNCA logar o corpo.
// O log leva só ambiente, referência, página e contagens.
import { createClient } from "npm:@supabase/supabase-js@2";

import { MAX_BODY_BYTES, ambienteDoToken, validarEnvelope } from "./validacao.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function erro(status: number, codigo: string, mensagem: string) {
  return json({ erro: codigo, mensagem }, status);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return erro(405, "metodo_nao_permitido", "Use POST.");

  const ambiente = ambienteDoToken(req.headers.get("authorization"), {
    producao: Deno.env.get("LATE_HUNTER_TOKEN_PRODUCAO") ?? "",
    homologacao: Deno.env.get("LATE_HUNTER_TOKEN_HOMOLOGACAO") ?? "",
  });
  if (!ambiente) return erro(401, "nao_autorizado", "Token invalido ou ausente.");

  const tamanho = Number(req.headers.get("content-length") ?? "0");
  if (tamanho > MAX_BODY_BYTES) return erro(413, "lote_grande_demais", "Envie o lote em paginas.");

  let body: unknown;
  try {
    const texto = await req.text();
    if (texto.length > MAX_BODY_BYTES) return erro(413, "lote_grande_demais", "Envie o lote em paginas.");
    body = JSON.parse(texto);
  } catch {
    return erro(400, "json_invalido", "Corpo nao e JSON valido.");
  }

  const problema = validarEnvelope(body);
  if (problema) return erro(400, "envelope_invalido", problema);

  const lote = body as Record<string, unknown>;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const inicio = Date.now();
  const { data, error } = await supabase.rpc("late_hunter_sync", { p_ambiente: ambiente, p_lote: lote });
  if (error) {
    // 22023 = o próprio SQL recusou o envelope (rede de segurança): é 400, não
    // vale retry. Qualquer outra coisa é nossa: 500, o Late Hunter tenta de novo.
    if (error.code === "22023") return erro(400, "envelope_invalido", error.message);
    console.error(JSON.stringify({ evento: "late_hunter_sync_falhou", ambiente, referencia: lote.referencia, codigo: error.code }));
    return erro(500, "erro_interno", "Falha ao processar o lote. Tente novamente.");
  }

  const r = data as Record<string, unknown>;
  console.log(
    JSON.stringify({
      evento: "late_hunter_sync",
      ambiente,
      referencia: lote.referencia,
      pagina: lote.pagina ?? 1,
      totalPaginas: lote.totalPaginas ?? 1,
      completo: lote.completo,
      recebidos: r.recebidos,
      criados: r.criados,
      atualizados: r.atualizados,
      reabertos: r.reabertos,
      inalterados: r.inalterados,
      encerrados: r.encerrados,
      rejeitados: Array.isArray(r.rejeitados) ? r.rejeitados.length : 0,
      encerramento: r.encerramento,
      ms: Date.now() - inicio,
    }),
  );

  return json(r);
});
