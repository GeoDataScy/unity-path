/**
 * Testes de ponta a ponta da API.
 *
 * Batem nas rotas de verdade, contra um Postgres de verdade, com as
 * migrations de `packages/db` aplicadas. Não há simulação de banco: o
 * que falha aqui falharia em produção.
 *
 * Reporta o denominador — quantas verificações rodaram, não só quantas
 * falharam. "Nenhuma falha" sem "sobre quantas" não prova nada.
 */
import { execFileSync } from "node:child_process";
import { app } from "../app.js";
import { sql } from "../db.js";

const DB = process.env.PGDATABASE ?? "xmx_api_test";
const AGENT = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const SUPER = "33333333-3333-3333-3333-333333333333";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FALHOU ${label}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

const psql = (args: string[]) => execFileSync("psql", args, { stdio: "pipe" });

function resetDatabase() {
  execFileSync("dropdb", ["--if-exists", DB], { stdio: "pipe" });
  execFileSync("createdb", [DB], { stdio: "pipe" });
  const root = new URL("../../../../packages/db/migrations/", import.meta.url).pathname;
  for (const f of ["0001_core.sql", "0002_catalogos.sql", "0004_reembolsos.sql", "0005_transferencias.sql", "0006_metricas.sql"]) {
    psql(["-q", "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", root + f]);
  }
}

async function seed() {
  await sql`INSERT INTO core.users (id, email, full_name, role, legacy_id) VALUES
    (${AGENT}::uuid, 'ana@xmx.test',  'Ana',   'agent',   'u-ana'),
    (${OUTRO}::uuid, 'bia@xmx.test',  'Bia',   'agent',   'u-bia'),
    (${SUPER}::uuid, 'sup@xmx.test',  'Super', 'agent',   'u-sup')`;
  await sql`UPDATE core.users SET can_view_all_tickets = true, can_register_duplicate_emails = true,
                                  can_approve_takeovers = true
             WHERE id = ${SUPER}::uuid`;
  await sql`INSERT INTO core.products (name) VALUES ('Arialief'), ('Jellyrock')`;
}

const call = (path: string, init: RequestInit & { as?: string } = {}) =>
  app.fetch(
    new Request(`http://t/api/v1${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.as === null ? {} : { authorization: `Bearer dev:${init.as ?? AGENT}` }),
        ...(init.headers ?? {}),
      },
    }),
  );

const json = async (r: Response) => ({ status: r.status, body: await r.json() as any });

async function main() {
  console.log("preparando banco…");
  resetDatabase();
  await seed();

  const cat = await json(await call("/catalogs"));
  const platformCartpanda = cat.body.salesPlatforms.find((p: any) => p.code === "Cartpanda");
  const platformNenhum = cat.body.salesPlatforms.find((p: any) => p.kind === "not_applicable");
  const channelEmail = cat.body.channels.find((c: any) => c.code === "Email");
  const produto = cat.body.products.find((p: any) => p.name === "Arialief");

  console.log("\n— prontidão do banco —");
  const hdb = await json(await call("/health/db", { as: null as any }));
  check("GET /health/db responde sem exigir token", hdb.status === 200, hdb.body);
  check("diz que o banco esta de pe", hdb.body.ok === true && hdb.body.db === "up", hdb.body);
  check("nao vaza string de conexao nem host", !JSON.stringify(hdb.body).match(/postgres:|@|password|pooler/i), hdb.body);

  console.log("\n— sessão e catálogo —");
  const me = await json(await call("/me"));
  check("GET /me devolve perfil e capacidades", me.status === 200 && me.body.role === "agent");
  check("GET /me sem token é recusado", (await call("/me", { as: null as any })).status === 401);
  check("catálogo traz 10 plataformas numa lista só", cat.body.salesPlatforms.length === 10);
  check("PagAmerican está lá — faltava na tela de reembolso",
    cat.body.salesPlatforms.some((p: any) => p.code === "PagAmerican"));

  console.log("\n— criar atendimento —");
  const criado = await json(
    await call("/tickets", {
      method: "POST",
      body: JSON.stringify({
        clientEmail: "  Cliente@Exemplo.COM ",
        productId: produto.id,
        platformId: platformCartpanda.id,
        channelId: channelEmail.id,
        contactReason: "duvida_de_uso",
        hasTrackingCode: false,
      }),
    }),
  );
  check("POST /tickets cria e devolve 201", criado.status === 201, criado.body);
  check("nasce como 'novo' com contagem 1",
    criado.body.derivedStatus === "novo" && criado.body.interactionCount === 1);
  check("o dia é o dia de São Paulo, não UTC",
    criado.body.businessDay === new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));

  const t1 = criado.body.id;

  console.log("\n— validação é do servidor, não da tela —");
  const semNota = await json(await call("/tickets", {
    method: "POST",
    body: JSON.stringify({ clientEmail: "x@y.com", productId: produto.id,
      contactReason: "outro", hasTrackingCode: false }),
  }));
  check("motivo 'outro' sem nota é recusado", semNota.status === 400 &&
    semNota.body.error.code === "VALIDATION_FAILED");

  const semPedido = await json(await call("/tickets", {
    method: "POST",
    body: JSON.stringify({ clientEmail: "x@y.com", productId: produto.id,
      contactReason: "reembolso", hasTrackingCode: false }),
  }));
  check("reembolso sem número de pedido é recusado — hoje só a tela exigia",
    semPedido.status === 400);

  console.log("\n— duplicidade de e-mail —");
  const dupMesmo = await json(await call("/tickets", {
    method: "POST",
    body: JSON.stringify({ clientEmail: "cliente@exemplo.com", productId: produto.id,
      contactReason: "duvida_de_uso", hasTrackingCode: false }),
  }));
  check("mesmo agente, e-mail já aberto: recusado (e ignora a caixa)",
    dupMesmo.status === 409 && dupMesmo.body.error.code === "TICKET_DUPLICATE_SAME_AGENT", dupMesmo.body);

  const dupOutro = await json(await call("/tickets", {
    as: OUTRO,
    method: "POST",
    body: JSON.stringify({ clientEmail: "cliente@exemplo.com", productId: produto.id,
      contactReason: "duvida_de_uso", hasTrackingCode: false }),
  }));
  check("outro agente: recusado com o dono no detalhe",
    dupOutro.status === 409 && dupOutro.body.error.code === "TICKET_DUPLICATE_OTHER_AGENT" &&
    dupOutro.body.error.details?.ownerName === "Ana", dupOutro.body);

  const dupSuper = await json(await call("/tickets", {
    as: SUPER,
    method: "POST",
    body: JSON.stringify({ clientEmail: "cliente@exemplo.com", productId: produto.id,
      contactReason: "duvida_de_uso", hasTrackingCode: false }),
  }));
  check("quem tem a capacidade de duplicar consegue — a flag não é código morto",
    dupSuper.status === 201, dupSuper.body);

  console.log("\n— registrar interação —");
  const i1 = await json(await call(`/tickets/${t1}/interactions`, {
    method: "POST",
    body: JSON.stringify({ status: "em_andamento", observation: "primeiro contato" }),
  }));
  check("POST interação devolve 201", i1.status === 201, i1.body);
  check("o número da interação nasce no banco", i1.body.interaction.seq === 1);
  check("o ticket volta já atualizado, sem a tela recalcular",
    i1.body.ticket.derivedStatus === "em_andamento" && i1.body.ticket.lastInteractionAt !== null);

  const i2 = await json(await call(`/tickets/${t1}/interactions`, {
    method: "POST",
    body: JSON.stringify({ status: "concluido" }),
  }));
  check("concluir muda o estado na mesma resposta",
    i2.body.ticket.derivedStatus === "concluido" && i2.body.interaction.seq === 2, i2.body.ticket);
  check("sem bloqueio das 18h — a decisão D1 removeu", i2.status === 201);

  const alheio = await json(await call(`/tickets/${t1}/interactions`, {
    as: OUTRO,
    method: "POST",
    body: JSON.stringify({ status: "em_andamento" }),
  }));
  check("agente sem permissão não escreve em ticket alheio",
    alheio.status === 403 && alheio.body.error.code === "FORBIDDEN", alheio.body);

  console.log("\n— leitura —");
  const hist = await json(await call(`/tickets/${t1}/interactions`));
  check("histórico sob demanda traz as duas interações", hist.body.items.length === 2);

  const lista = await json(await call("/tickets?limit=2"));
  check("lista devolve envelope com cursor",
    Array.isArray(lista.body.items) && "nextCursor" in lista.body && "hasMore" in lista.body);
  check("lista traz o estado pronto na linha",
    lista.body.items.every((t: any) => typeof t.derivedStatus === "string" && typeof t.interactionCount === "number"));
  check("agente comum só vê os próprios",
    lista.body.items.every((t: any) => t.isMine === true));

  const cursorInvalido = await json(await call("/tickets?cursor=lixo"));
  check("cursor inválido é recusado, não devolve lista vazia",
    cursorInvalido.status === 400 && cursorInvalido.body.error.code === "INVALID_CURSOR");

  // Paginação: cria o suficiente para virar página.
  for (let i = 0; i < 4; i++) {
    await call("/tickets", {
      method: "POST",
      body: JSON.stringify({ clientEmail: `p${i}@exemplo.com`, productId: produto.id,
        contactReason: "duvida_de_uso", hasTrackingCode: false }),
    });
  }
  const p1 = await json(await call("/tickets?limit=2"));
  const p2 = await json(await call(`/tickets?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`));
  const ids1 = p1.body.items.map((t: any) => t.id);
  const ids2 = p2.body.items.map((t: any) => t.id);
  check("página 1 respeita o limite", ids1.length === 2);
  check("página 2 não repete nada da página 1", ids2.every((id: string) => !ids1.includes(id)));

  const lookup = await json(await call("/tickets/lookup?email=CLIENTE@exemplo.com"));
  check("busca por e-mail ignora caixa e diz se o dono está disponível",
    lookup.body.ticket !== null && typeof lookup.body.ownerIsAvailable === "boolean", lookup.body);

  console.log("\n— quem vê tudo —");
  const listaSuper = await json(await call("/tickets?limit=50", { as: SUPER }));
  check("supervisor vê tickets de outros agentes",
    listaSuper.body.items.some((t: any) => t.isMine === false), listaSuper.body.items.length);

  console.log("\n— reembolsos —");
  const rNovo = await json(await call("/refunds", {
    method: "POST",
    body: JSON.stringify({ orderId: "PED-100", customerEmail: "reemb@x.test",
      platformId: platformCartpanda.id, requestDate: "2026-09-20",
      reason: "nao gostou", itemsReturned: false }),
  }));
  check("POST /refunds cria", rNovo.status === 201, rNovo.body);
  check("nasce aberto, com dias em aberto calculados no servidor",
    rNovo.body.status === "aberto" && typeof rNovo.body.daysOpen === "number");
  const rid = rNovo.body.id;

  const rBaixaAntes = await json(await call(`/refunds/${rid}/complete`, {
    method: "POST",
    body: JSON.stringify({ completionDate: "2026-09-18", amount: 50, percent: 80,
      reason: "ok", itemsReturned: false }),
  }));
  check("baixa anterior a solicitacao e recusada — hoje so a gestora era barrada",
    rBaixaAntes.status === 422 &&
    rBaixaAntes.body.error.code === "REFUND_COMPLETION_BEFORE_REQUEST", rBaixaAntes.body);

  const rBaixa = await json(await call(`/refunds/${rid}/complete`, {
    method: "POST",
    body: JSON.stringify({ completionDate: "2026-09-22", amount: 99.9, percent: 80,
      reason: "reembolso integral", itemsReturned: false }),
  }));
  check("baixa valida passa e o status vira concluido",
    rBaixa.status === 200 && rBaixa.body.status === "concluido", rBaixa.body);
  check("o valor volta com a moeda junto, nunca numero solto",
    rBaixa.body.value?.currency === "USD" && rBaixa.body.value?.amount === 99.9, rBaixa.body.value);
  check("o percentual e numero, nao texto", rBaixa.body.percent === 80);

  const rEv = await json(await call(`/refunds/${rid}/events`));
  check("toda acao em dinheiro deixa rastro (criacao + baixa)",
    rEv.body.items.length >= 2 && rEv.body.items.some((e: any) => e.kind === "completed"),
    rEv.body.items.map((e: any) => e.kind));

  const rLista = await json(await call("/refunds?limit=10&page=1"));
  check("lista traz pagina numerada com total (decisao D7)",
    typeof rLista.body.totalCount === "number" && typeof rLista.body.pageCount === "number");
  check("e a soma do periodo inteiro, nao so da pagina",
    rLista.body.totalValue?.currency === "USD", rLista.body.totalValue);

  console.log("\n— transferencias —");
  const tOutro = await json(await call("/tickets", {
    as: OUTRO, method: "POST",
    body: JSON.stringify({ clientEmail: "dono-outro@x.test", productId: produto.id,
      contactReason: "duvida_de_uso", hasTrackingCode: false }),
  }));
  const ticketDeOutro = tOutro.body.id;

  const trf = await json(await call("/transfers", {
    method: "POST",
    body: JSON.stringify({ ticketId: ticketDeOutro, message: "continua?" }),
  }));
  check("POST /transfers cria pedido para o dono original", trf.status === 201, trf.body);

  const trfDup = await json(await call("/transfers", {
    method: "POST", body: JSON.stringify({ ticketId: ticketDeOutro }),
  }));
  check("segundo pedido pendente e recusado pela constraint, nao pelo cliente",
    trfDup.status === 409 && trfDup.body.error.code === "TRANSFER_ALREADY_PENDING", trfDup.body);

  const nOutro = await json(await call("/notifications", { as: OUTRO }));
  check("o dono recebeu notificacao — sem sino perguntando a cada 30s",
    nOutro.body.unseenCount >= 1 &&
    nOutro.body.items.some((n: any) => n.kind === "transfer_requested"), nOutro.body);

  const trfAlheio = await json(await call(`/transfers/${trf.body.id}/accept`, { method: "POST" }));
  check("quem nao e o destinatario nao responde pelo pedido", trfAlheio.status === 404);

  const trfOk = await json(await call(`/transfers/${trf.body.id}/accept`, {
    as: OUTRO, method: "POST", body: JSON.stringify({ responseNote: "sigo eu" }),
  }));
  check("o destinatario aceita", trfOk.status === 200 && trfOk.body.status === "accepted", trfOk.body);

  console.log("\n— tomada de ticket —");
  const tkv = await json(await call("/takeovers", {
    method: "POST",
    body: JSON.stringify({ ticketId: ticketDeOutro, note: "dono de folga" }),
  }));
  check("POST /takeovers cria pedido", tkv.status === 201, tkv.body);

  const tkvSemPermissao = await json(await call(`/takeovers/${tkv.body.id}/approve`, { method: "POST" }));
  check("agente comum nao aprova tomada",
    tkvSemPermissao.status === 403 &&
    tkvSemPermissao.body.error.code === "MISSING_CAPABILITY", tkvSemPermissao.body);

  const antes = await json(await call(`/tickets/${ticketDeOutro}`, { as: SUPER }));
  const tkvOk = await json(await call(`/takeovers/${tkv.body.id}/approve`, {
    as: SUPER, method: "POST", body: JSON.stringify({ note: "aprovado" }),
  }));
  check("quem tem a capacidade aprova", tkvOk.status === 200, tkvOk.body);

  const depois = await json(await call(`/tickets/${ticketDeOutro}`, { as: SUPER }));
  check("aprovar MUDA o dono do ticket — transferencia nao muda, tomada muda",
    antes.body.ownerId !== depois.body.ownerId && depois.body.ownerId === AGENT,
    { antes: antes.body.ownerId, depois: depois.body.ownerId });

  const nMe = await json(await call("/notifications"));
  check("quem pediu foi avisado da aprovacao",
    nMe.body.items.some((n: any) => n.kind === "takeover_approved"));

  const primeira = nMe.body.items[0];
  const visto = await json(await call(`/notifications/${primeira.id}/seen`, { method: "POST" }));
  check("marcar como vista funciona", visto.body.ok === true);

  console.log("\n— metricas —");
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const mMe = await json(await call(`/metrics/me?from=${hoje}&to=${hoje}`));
  check("GET /metrics/me responde", mMe.status === 200, mMe.body);
  check("conta os atendimentos criados no teste",
    mMe.body.today.tickets >= 5 && mMe.body.today.total >= mMe.body.today.tickets, mMe.body.today);
  check("separa abertura de interacao",
    mMe.body.today.total === mMe.body.today.tickets + mMe.body.today.interactions, mMe.body.today);
  check("traz dias trabalhados, nao dias do periodo", mMe.body.range.daysWorked >= 1, mMe.body.range);

  const mNeg = await json(await call(`/metrics/dashboard?from=${hoje}&to=${hoje}`));
  check("agente comum NAO ve o painel da gestora",
    mNeg.status === 403 && mNeg.body.error.code === "MISSING_CAPABILITY", mNeg.body);

  const mDash = await json(await call(`/metrics/dashboard?from=${hoje}&to=${hoje}`, { as: SUPER }));
  check("quem tem a capacidade ve", mDash.status === 200, mDash.body);
  check("total = aberturas + interacoes",
    mDash.body.totalCount === mDash.body.ticketCount + mDash.body.interactionCount, mDash.body);
  check("agrupa por agente, produto, dia, plataforma e canal",
    ["byAgent","byProduct","byDay","byPlatform","byChannel"].every(k => Array.isArray(mDash.body[k])),
    Object.keys(mDash.body));
  check("por agente traz o id junto do nome",
    mDash.body.byAgent.length > 0 && typeof mDash.body.byAgent[0].agentId === "string",
    mDash.body.byAgent[0]);
  check("nao preenchido aparece com rotulo, nao como nulo",
    mDash.body.byPlatform.every((p: any) => typeof p.name === "string" && p.name.length > 0),
    mDash.body.byPlatform);

  const mFiltro = await json(await call(`/metrics/dashboard?from=${hoje}&to=${hoje}&agentId=${AGENT}`, { as: SUPER }));
  check("filtrar por agente reduz o total",
    mFiltro.body.totalCount <= mDash.body.totalCount, { filtrado: mFiltro.body.totalCount, todos: mDash.body.totalCount });
  check("filtrado por um agente, so ele aparece no agrupamento",
    mFiltro.body.byAgent.every((a: any) => a.agentId === AGENT), mFiltro.body.byAgent);

  console.log("\n— verificação de token (G3.1) —");
  const forjado = "eyJhbGciOiJFUzI1NiJ9." +
    Buffer.from(JSON.stringify({ sub: AGENT, exp: 9999999999 })).toString("base64url") +
    ".assinaturaFalsa";
  const r1 = await app.fetch(new Request("http://t/api/v1/me", {
    headers: { authorization: `Bearer ${forjado}` },
  }));
  check("token forjado é recusado (assinatura conferida)", r1.status === 401, await r1.text());

  const semDev = process.env.ALLOW_DEV_TOKENS;
  delete process.env.ALLOW_DEV_TOKENS;
  const r2 = await app.fetch(new Request("http://t/api/v1/me", {
    headers: { authorization: `Bearer dev:${AGENT}` },
  }));
  check("atalho de desenvolvimento é recusado sem a variável explícita", r2.status === 401);
  if (semDev !== undefined) process.env.ALLOW_DEV_TOKENS = semDev;

  console.log("\n— tamanho da resposta (G10.2) —");
  const raw = await (await call("/tickets?limit=25")).text();
  const kb = Buffer.byteLength(raw) / 1024;
  check(`lista de 25 cabe no orçamento (${kb.toFixed(1)} kB < 50 kB)`, kb < 50);

  console.log(`\n────────────────────────────────`);
  console.log(`verificações: ${passed + failed}   ok: ${passed}   falhas: ${failed}`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("erro fatal na suíte:", e);
  await sql.end().catch(() => {});
  process.exit(1);
});
