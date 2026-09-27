# Estrutura e convenções de `apps/api` — XMX Suporte v2

> Trilha: **backend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Referências `R-XXX-n` apontam para `10-backend-regras-atuais.md`; rotas, para `11`; tabelas, para `12`.
>
> **Especificação.** Nenhum arquivo de `apps/api` foi criado e `package.json` não foi tocado (§0 do contrato).
>
> ### Reconciliado com §8-A do contrato em 26/09/2026
>
> **D2** fechou a maior lacuna deste documento: a API conecta com o token do usuário e as policies
> permanecem como rede, com quatro exigências de desempenho — §4 abaixo especifica como. **D1**
> transforma a regra das 18h de bloqueio em marcação, o que muda o nome e o papel de um módulo de
> regra pura. **D3** acrescenta `goal_policies` e o parâmetro `asOf`. **D7** mantém a paginação
> numerada, o que acrescenta um caso de teste de contrato.

## 1. Onde fica

O monorepo do §1 do contrato, detalhado no que toca ao backend:

```
unity-path/
├── apps/
│   ├── web/                    # frontend (trilha de frontend)
│   └── api/                    # ESTE documento
├── packages/
│   ├── contract/               # a fronteira: schemas Zod + tipos + códigos de erro
│   └── db/                     # Drizzle: schema + migrations do modelo novo
├── src/                        # LEGADO, intocado até o corte
└── supabase/                   # LEGADO, congelado
```

A regra de dependência do §1 é verificada mecanicamente, não confiada à disciplina:

```
apps/web  ──>  packages/contract  <──  apps/api  ──>  packages/db
```

`apps/web` **nunca** importa `apps/api` nem `packages/db`. A verificação entra no lint (`eslint-plugin-import` com `no-restricted-paths`) e falha o build, não só avisa. Sem isso, a separação é decorativa — e a primeira vez que alguém importar um tipo de `packages/db` no front, a fronteira acaba.

## 2. Árvore de `apps/api`

```
apps/api/
├── src/
│   ├── main.ts                     # composição: env → container → servidor → listen
│   ├── env.ts                      # leitura e validação das variáveis (Zod) — falha no boot
│   ├── app.ts                      # monta o servidor, plugins, error handler, rotas
│   │
│   ├── http/
│   │   ├── routes/                 # UMA pasta por módulo de 11
│   │   │   ├── session.routes.ts
│   │   │   ├── tickets.routes.ts
│   │   │   ├── interactions.routes.ts
│   │   │   ├── transfers.routes.ts
│   │   │   ├── takeovers.routes.ts
│   │   │   ├── refunds.routes.ts
│   │   │   ├── metrics.routes.ts
│   │   │   ├── audit.routes.ts
│   │   │   ├── notifications.routes.ts
│   │   │   ├── held-orders.routes.ts
│   │   │   ├── radar.routes.ts
│   │   │   ├── notes.routes.ts
│   │   │   ├── support-base.routes.ts
│   │   │   ├── training.routes.ts
│   │   │   ├── users.routes.ts
│   │   │   ├── settings.routes.ts
│   │   │   ├── copy-analytics.routes.ts
│   │   │   ├── exports.routes.ts
│   │   │   └── integrations/
│   │   │       ├── zendesk.routes.ts
│   │   │       └── lya.routes.ts
│   │   ├── middleware/
│   │   │   ├── authenticate.ts     # JWKS → claims → perfil (cache 60 s)
│   │   │   ├── authorize.ts        # requireRole / requireCapability
│   │   │   ├── idempotency.ts      # Idempotency-Key
│   │   │   ├── request-context.ts  # traceId, userId, businessDay
│   │   │   ├── rate-limit.ts
│   │   │   └── error-handler.ts    # AppError → { error: { code, message, details } }
│   │   ├── cursor.ts               # encode/decode do cursor de §0.2 de `11`
│   │   └── serializers/            # linha do banco → objeto da API (snake → camel)
│   │
│   ├── modules/                    # UMA pasta por domínio — o coração
│   │   ├── tickets/
│   │   │   ├── use-cases/
│   │   │   │   ├── create-ticket.ts
│   │   │   │   ├── list-tickets.ts
│   │   │   │   ├── get-ticket.ts
│   │   │   │   ├── update-ticket.ts
│   │   │   │   ├── delete-ticket.ts
│   │   │   │   ├── lookup-ticket-by-email.ts
│   │   │   │   ├── claim-ticket.ts
│   │   │   │   ├── correct-ticket-date.ts
│   │   │   │   └── reassign-tickets.ts
│   │   │   ├── rules/              # regra pura, sem I/O — testável sozinha
│   │   │   │   ├── same-day-repeat.ts         # [D1] R-INT-2, R-INT-4 — MARCA, não bloqueia
│   │   │   │   ├── duplicate-email-policy.ts  # R-TKT-3..R-TKT-7
│   │   │   │   ├── contact-reason-note.ts     # R-TKT-14
│   │   │   │   └── derived-status.ts          # [C8] R-TKT-24 + fallback em legacy status
│   │   │   ├── ticket.repository.ts
│   │   │   └── ticket.errors.ts
│   │   ├── interactions/ · transfers/ · takeovers/ · refunds/ · metrics/
│   │   ├── notifications/ · held-orders/ · radar/ · notes/ · support-base/
│   │   ├── training/ · users/ · settings/ · copy-analytics/ · exports/
│   │   ├── metrics/rules/compliance.ts        # [D3] a avaliação disciplinar
│   │   ├── metrics/goal-policy.repository.ts  # [D3] metas vigentes em asOf
│   │   └── integrations/ { zendesk/ lya/ }
│   │
│   ├── shared/
│   │   ├── errors.ts               # AppError e as subclasses
│   │   ├── time.ts                 # ÚNICO lugar que sabe o que é "dia em São Paulo"
│   │   ├── uow.ts                  # unidade de trabalho (transação)
│   │   ├── realtime.ts             # publicação de eventos
│   │   ├── logger.ts
│   │   └── metrics.ts              # instrumentação
│   │
│   └── jobs/
│       ├── recompute-daily-rollups.ts   # [G11.4] ver emenda §1 de `12`
│       ├── schema-drift-check.ts        # [G6.2, G7.5] catálogo real x schema versionado
│       ├── refund-overdue-scan.ts       # gera notificação refund_overdue
│       ├── radar-due-scan.ts            # gera notificação radar_due
│       ├── lya-query-log-gc.ts          # [G7.4] retenção de 90 dias
│       └── idempotency-gc.ts            # limpa chaves > 24 h
│
├── test/
│   ├── rules/                      # um arquivo por regra de `10` (§8 deste doc)
│   ├── use-cases/
│   ├── http/                       # contrato: forma da resposta e códigos de erro
│   ├── parity/                     # legado × novo (§7.2 de `12`)
│   └── fixtures/
├── package.json
└── tsconfig.json
```

### Por que módulo antes de camada

A alternativa (`controllers/`, `services/`, `repositories/` no topo) espalha um domínio por três pastas distantes. O sistema de hoje já mostra o custo disso: a regra das 18h vive em `useStatusTracking.ts`, o trigger que a marca vive numa migration de julho, e a RPC que a mede vive em outra — ninguém que muda uma lembra das outras. Com módulo no topo, tudo de "tickets" está num lugar só, e a regra tem um arquivo com o nome dela.

---

## 3. As quatro camadas

O caminho de uma requisição é sempre o mesmo, e cada camada tem **uma** responsabilidade.

| Camada | Arquivo | Pode | Não pode |
|---|---|---|---|
| **Rota** | `http/routes/*.routes.ts` | declarar método, caminho, schema de entrada e saída, middlewares, chamar **um** caso de uso | conter `if` de regra de negócio, tocar no banco |
| **Validação** | `packages/contract/schemas/*` | validar formato, coagir tipo, aplicar `trim`, recusar campo desconhecido | consultar o banco, decidir permissão |
| **Caso de uso** | `modules/*/use-cases/*.ts` | orquestrar regra + repositório, abrir transação, publicar evento, lançar `AppError` | conhecer HTTP (`req`, `res`, status), montar SQL |
| **Repositório** | `modules/*/*.repository.ts` | falar com o banco por Drizzle, traduzir linha ↔ entidade | decidir regra de negócio, lançar erro de domínio |

E, dentro do caso de uso, **regra pura** (`modules/*/rules/*.ts`): função sem I/O, que recebe dados e devolve decisão. É onde a regra das 18h vive, e é o que torna o teste dela trivial.

```ts
// modules/tickets/rules/same-day-repeat.ts — [D1] R-INT-2, R-INT-4
//
// ATENÇÃO: esta função NÃO bloqueia nada. A regra das 18h deixou de bloquear
// (§8-A/D1). O que sobrou é a MARCAÇÃO, e ela não é um detalhe: é o que permite
// a métrica não contar a mesma conversa duas vezes. Quem remover isto junto com
// o bloqueio distorce todo dashboard.
export function isSameDayRepeat(input: {
  lastInteractionAt: Date | null;
  hasTrackingCode: boolean;
  now: Date;
}): boolean {
  if (input.lastInteractionAt === null) return false;  // primeira interação nunca é repetição
  if (input.hasTrackingCode) return false;             // R-INT-2: isento
  return input.now < saoPauloEndOfBusinessDay(input.lastInteractionAt); // 18:00 SP
}
```

Três coisas que essa assinatura garante e a implementação de hoje não:
- `now` é **parâmetro**, então o teste não depende do relógio.
- `lastInteractionAt` vem de `tickets.last_interaction_at` (materializado), não do último item de um
  array ordenado — some a dependência de ordenação implícita (R-INT-3).
- O resultado alimenta **uma coluna**, não uma decisão de permissão. Não existe caminho em que esta
  função recuse uma escrita.

E a regra que o C8 corrigiu:

```ts
// modules/tickets/rules/derived-status.ts — [C8] R-TKT-24
export function deriveStatus(input: {
  lastInteractionStatus: "em_andamento" | "concluido" | null;
  legacyStatus: "registered" | "concluido";   // ← o fallback, sem ele 1.220 tickets reabrem
}): "novo" | "em_andamento" | "concluido" {
  if (input.lastInteractionStatus === null) {
    return input.legacyStatus === "concluido" ? "concluido" : "novo";
  }
  return input.lastInteractionStatus === "concluido" ? "concluido" : "em_andamento";
}
```

1.220 tickets estão `concluido` na coluna e não têm interação nenhuma (foram concluídos antes de
`service_follow_ups` existir, em 26/03/2026). Sem o segundo parâmetro, todos reabrem na virada.

### Exemplo de rota

```ts
// http/routes/interactions.routes.ts
app.post(
  "/api/v1/tickets/:id/interactions",
  {
    preHandler: [authenticate, requireRole("agent", "manager"), idempotency],
    schema: {
      params: TicketIdParams,          // packages/contract
      body: CreateInteractionBody,
      response: { 201: CreateInteractionResponse },
    },
  },
  async (req, reply) => {
    const result = await createInteraction({
      ctx: req.ctx,
      ticketId: req.params.id,
      ...req.body,
    });
    return reply.code(201).send(result);
  },
);
```

Nenhum `if`. Se aparecer um `if` de negócio numa rota, ele está no lugar errado e o code review recusa.

---

## 4. Autenticação e autorização

### `authenticate`

1. Lê `Authorization: Bearer`. Sem cabeçalho ⇒ `401 UNAUTHENTICATED`.
2. Valida assinatura por **JWKS** do Supabase, com cache das chaves e rotação automática.
3. Extrai `sub` (o id do usuário).
4. Carrega o perfil (`role` + capacidades + `is_active`) de `users`, com **cache de 60 s por usuário** (§3 do contrato).
5. `is_active = false` ou perfil ausente ⇒ `403 ACCOUNT_BLOCKED` com `details.reason` (R-AUTH-4, R-AUTH-5).
6. Monta `req.ctx`.

```ts
export interface RequestContext {
  userId: string;
  role: AppRole;
  capabilities: Capabilities;
  isAvailable: boolean;
  now: Date;              // congelado no início da requisição
  businessDay: string;    // dia em São Paulo, resolvido UMA vez
  traceId: string;
}
```

`now` congelado no início da requisição é o que impede duas regras da mesma requisição de discordarem sobre que horas são — e o que faz o teste ser determinístico.

> **Invalidação do cache (Lacuna).** 60 s de cache significa que desativar um usuário demora até 60 s para bloqueá-lo. A proposta é que `POST /users/:id/deactivate` e `PATCH /users/:id/capabilities` publiquem um evento que **fura** o cache daquele usuário imediatamente. Precisa de aval.

### `authorize`

Dois combinadores, e nada além deles:

```ts
requireRole("manager")
requireCapability("canViewSupportAnalytics")
```

A tabela completa de quem pode o quê está em `11` §0.3 e em cada rota. Duas regras que não cabem em combinador, porque dependem do recurso, ficam **no caso de uso** e são documentadas lá:
- `canApproveTakeovers` exige `role = 'manager'` junto (R-CAP-4);
- "é meu ticket?" depende de carregar o ticket — vira `404 NOT_FOUND`, nunca `403`, para não revelar existência (§0.1 de `11`).

### [D2] Quem a API é no banco

**Decidido em §8-A/D2: a API não usa credencial de superusuário.** Cada requisição abre transação e
assume a identidade de quem chamou; as policies do banco permanecem como rede de segurança.

A razão da escolha é a que esta trilha havia argumentado: em sete meses o sistema acumulou cinco
regras de visibilidade diferentes (dono, criador, `can_view_all_tickets`, gestora, copy). A chance
de a API esquecer uma num endpoint novo é alta, e a RLS é a única coisa que hoje impede o erro de
virar vazamento.

A condição imposta pelo dono foi **não ficar lento**. O desenho que atende:

#### 1. A policy é rede, não filtro

Todo recorte real vai no `WHERE`, servido por índice. A policy só confirma.

```ts
// modules/tickets/ticket.repository.ts
// O WHERE carrega o recorte inteiro: dono, período, status. A policy confirma
// a mesma coisa e não é ela quem reduz o conjunto.
const rows = await tx.select().from(tickets)
  .where(and(
    eq(tickets.currentOwnerId, ctx.userId),        // ← o índice resolve isto
    between(tickets.businessDay, from, to),
    ne(tickets.derivedStatus, "concluido"),
  ))
  .orderBy(desc(tickets.businessDay), desc(tickets.createdAt), desc(tickets.id))
  .limit(limit + 1);
```

O antipadrão a evitar é o oposto: `SELECT * FROM tickets` confiando que a policy filtra. Funciona,
devolve o resultado certo, e varre a tabela — foi assim que `my_follow_ups` chegou a estourar o
`statement_timeout` de 8 s (R-INT-10).

**Regra de revisão**: toda consulta de leitura tem `EXPLAIN` no teste de desempenho, e um
`Seq Scan` em `tickets`, `interactions` ou `refunds` reprova.

#### 2. Os helpers continuam envolvidos em `(SELECT ...)`

A correção de 27/07/2026 (19.442× menos varreduras) é pré-requisito e **não pode regredir**:

```sql
-- CORRETO — InitPlan, avaliado uma vez por consulta
USING (current_owner_id = (SELECT auth.uid()) OR (SELECT public.is_manager()))

-- ERRADO — a função roda uma vez por linha varrida
USING (current_owner_id = auth.uid() OR public.is_manager())
```

Um teste percorre `pg_policies` e reprova qualquer `qual` ou `with_check` que chame `auth.uid()`,
`is_manager()`, `can_view_all_tickets()` ou `can_view_support_analytics()` **fora** de um
`(SELECT ...)`. Sem esse teste, a regressão volta no primeiro `CREATE POLICY` escrito com pressa.

#### 3. Identidade com escopo local à transação

```ts
// shared/uow.ts
await tx.execute(sql`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`);
await tx.execute(sql`SET LOCAL ROLE api_request`);   // NÃO `authenticated` — ver G7.1 abaixo
```

O `true` em `set_config` e o `LOCAL` em `SET ROLE` são o detalhe que faz isso funcionar com **pooler
em modo transação**: o escopo morre no `COMMIT`, então a conexão devolvida ao pool não carrega a
identidade de ninguém. Essa é a razão de a Lacuna 3 (que dizia que pooler proibiria `SET LOCAL
role`) estar resolvida: `SET LOCAL` é justamente a forma compatível — o que não funciona é `SET`
sem `LOCAL`, cujo efeito vaza para a próxima requisição que pegar a mesma conexão.

**O papel é `api_request`, não `authenticated`** — e isto é o ajuste que **G7.1** exigiu. A versão
anterior deste documento assumia `SET LOCAL ROLE authenticated`, o que só funciona se `authenticated`
tiver privilégio nas tabelas. G7.1 proíbe exatamente isso: "nenhum papel anônimo ou de usuário final
tem privilégio nas tabelas; só a API acessa". Medido em produção, é o defeito que existe hoje —
`anon` e `authenticated` têm privilégio de escrita nas 32 tabelas, com a RLS como única defesa.

O desenho que satisfaz D2 **e** G7.1:

| Papel | Privilégio | Quem usa |
|---|---|---|
| `anon`, `authenticated` | **`REVOKE ALL`** em todas as tabelas do schema | ninguém — o browser não fala com o banco (G3.1) |
| `api_request` | `SELECT`/`INSERT`/`UPDATE`/`DELETE` conforme a tabela, **com RLS ativa** | toda transação de requisição |
| `api_admin` | o necessário para a Admin API | só `revoke-login` e `POST /users`, por conexão separada |
| `lya_analytics_ro` | `SELECT` nas views sem PII | só a rota de análise (§9.2) |

As policies são escritas `TO api_request` e leem `request.jwt.claims`, de modo que `auth.uid()`
continua funcionando como hoje. A RLS segue sendo rede real (D2) e nenhum papel de usuário final tem
acesso (G7.1) — as duas exigências convivem porque a identidade viaja no *claim*, não no papel.

Consequências que precisam estar escritas:
- **Transação curta, sempre.** Nenhuma chamada externa (Anthropic, Zendesk) dentro de transação.
- **Nada de trabalho fora de transação** nas rotas de dados: sem transação não há identidade, e sem
  identidade a policy barra tudo — o que é o comportamento seguro, mas parece "bug de permissão".
- Os poucos casos que precisam de `service_role` (`POST /users/:id/revoke-login`, `POST /users`, que
  falam com a Admin API) usam **outra** conexão, explicitamente nomeada `adminDb`, e um teste
  garante que ela só é importada por esses dois casos de uso.

#### 4. Toda tabela nova nasce com RLS ligada

Medido em produção: `anon` e `authenticated` têm privilégio de escrita nas **32** tabelas, então
tabela sem policy nasce **gravável pelo mundo** (B3 do backlog). Vale para `interaction_facts`,
`daily_rollups`, `notifications`, `refund_events`, `migration_rejects`, `goal_policies` e
`sales_platforms`.

O teste que garante: percorre `pg_class` e reprova qualquer tabela em `public` com
`relrowsecurity = false`, ou com RLS ligada e **zero** policies (que é pior — nega tudo em silêncio
e o sintoma aparece só em produção).

### [G6, G7] O que a estrutura garante por verificação, não por disciplina

| Garantia | Onde é cobrada nesta estrutura |
|---|---|
| **G6.1 · toda DDL por migration** | `packages/db/migrations/`, executadas pelo runner do repositório. Nenhum caminho da API executa DDL; `api_request` não tem `CREATE`. §8-B do contrato |
| **G6.2 · verificação de desvio** | job `schema-drift-check` (§2) compara `information_schema` + `pg_policies` + privilégios com o schema versionado, em cada integração e em agenda diária. Diferença é alarme |
| **G6.3 · versão única e monotônica** | o runner recusa carimbo duplicado. O legado tem **três pares** com o mesmo carimbo (B16 do backlog) — é o defeito que esta regra fecha |
| **G6.4 · migration revertível** | cada migration tem `down`, ou um comentário declarando por que não tem |
| **G7.1 · nenhum papel de usuário final com privilégio** | papel `api_request`; `REVOKE ALL` de `anon` e `authenticated`; teste de segurança tenta ler e escrever cada tabela com a chave pública e exige recusa |
| **G7.2 · RLS ligada em toda tabela nova** | teste de catálogo reprova tabela sem RLS, **e** tabela com RLS e zero policies (que nega tudo em silêncio) |
| **G7.3 · view com `security_invoker`** | teste de catálogo. `lya_agents_view` (§6.9 de `12`) declara `security_invoker = true` — é a correção de B1, a view que era legível e gravável sem login |
| **G7.5 · privilégios versionados** | a matriz de papéis vive em `packages/db/roles.sql` e entra na verificação de desvio de G6.2 |

## 5. Transação

Regra: **um caso de uso, uma transação.** Rota não abre transação; repositório não abre transação.

```ts
export async function createInteraction(input: CreateInteractionInput) {
  return uow.transaction(input.ctx, async (tx) => {
    const ticket = await ticketRepo.findForUpdate(tx, input.ticketId);      // lock
    if (!ticket) throw new NotFoundError();
    assertCanWriteTicket(input.ctx, ticket);

    // [D1] Nenhuma janela de horário. A marcação é consequência, não permissão.
    const sameDayRepeat = isSameDayRepeat({
      lastInteractionAt: ticket.lastInteractionAt,
      hasTrackingCode: ticket.hasTrackingCode,
      now: input.ctx.now,
    });

    const interaction = await interactionRepo.insert(tx, { ..., sameDayRepeat }); // seq do banco
    const updated     = await ticketRepo.refreshDerivedState(tx, ticket.id);
    await factsRepo.emit(tx, { kind: "interaction", sourceId: interaction.id, ... });
    await rollupRepo.bump(tx, updated.businessDay, input.ctx.userId);

    tx.afterCommit(() => realtime.publish(`user:${ticket.currentOwnerId}`, {
      type: "ticket.changed", ticketId: ticket.id,
    }));

    return { interaction, ticket: updated };
  });
}
```

Quatro regras dentro desse exemplo:
1. **`SELECT ... FOR UPDATE` antes de decidir.** É o que `claim_ticket`, `approve_ticket_takeover` e `set_held_order_status` já fazem (R-TKT-31, R-TKO-8, R-HLD-17); passa a ser padrão, não exceção.
2. **Efeito externo só depois do commit.** `afterCommit` existe para não publicar evento de uma transação que fez rollback — é como o "sucesso falso" nasce (R-TRF-10).
3. **Escrita que não afeta linha nenhuma é erro**, nunca `2xx`. O repositório devolve `affectedRows`; o caso de uso lança `NotFoundError` quando é 0. É a emenda §5 de `11`.
4. **Nada de transação aninhada.** Um caso de uso que precisa de outro chama a **função de domínio**, não o caso de uso inteiro.

Nível de isolamento: `READ COMMITTED` (o padrão) em tudo, porque os pontos de corrida reais são tratados por lock explícito. `POST /held-orders/distribute` é a exceção: roda em `REPEATABLE READ`, porque decide a distribuição lendo o estado de vários clientes de uma vez (R-HLD-6, R-HLD-7) e não há uma linha só para travar.

---

## 6. `packages/contract` — a fronteira

É o único lugar que os dois lados importam, e é o que torna a separação verificável.

```
packages/contract/
├── src/
│   ├── schemas/          # Zod: entrada e saída de cada rota
│   │   ├── ticket.ts · interaction.ts · refund.ts · metrics.ts · …
│   │   └── common.ts     # Cursor, Paginated<T>, ApiError, IsoDate, IsoDateTime
│   ├── enums/            # espelho dos enums de `12`
│   │   ├── contact-reason.ts · refund-reason.ts · refund-percent.ts
│   │   ├── app-role.ts · ticket-status.ts · …
│   ├── errors/
│   │   └── codes.ts      # TODOS os códigos de `11`, como const object
│   ├── routes.ts         # o mapa tipado: caminho → { params, query, body, response }
│   └── index.ts
└── package.json
```

O ponto central:

```ts
// packages/contract/src/routes.ts
export const routes = {
  "POST /api/v1/tickets/:id/interactions": {
    params: TicketIdParams,
    body: CreateInteractionBody,
    response: CreateInteractionResponse,
    errors: ["FOLLOW_UP_BLOCKED", "TICKET_ALREADY_CONCLUDED", "NOT_FOUND"],
  },
  // …
} as const satisfies RouteMap;

export type Routes = typeof routes;
export type ResponseOf<K extends keyof Routes> = z.infer<Routes[K]["response"]>;
export type ErrorOf<K extends keyof Routes> = Routes[K]["errors"][number];
```

Com isso:
- `apps/api` **não exporta tipo nenhum**. Ele *implementa* `routes`, e um teste de tipo garante que cada handler devolve exatamente `ResponseOf<K>`. Quem muda a resposta sem mudar o schema não compila.
- `apps/web` importa `ResponseOf<"GET /api/v1/tickets">` e `ErrorOf<...>`. O front reagir a um código de erro que a API não emite vira erro de tipo, não bug de produção.
- Os códigos de erro são `const`, então `switch` no front é exaustivo.

**Um schema, duas bordas**: a rota valida a entrada com o mesmo objeto Zod que o front usa para desabilitar o botão. É isso que impede o caso de hoje, em que `canSubmit` (`Atendimentos.tsx:482`) e a validação real do banco são dois textos diferentes que podem divergir (R-TKT-10).

Geração de cliente: `packages/contract` também exporta um `createApiClient(fetch)` tipado. O front **não** escreve `fetch("/api/v1/...")` à mão.

---

## 7. Observabilidade

O sistema já teve dois incidentes que a observabilidade de hoje não teria explicado sozinha: a sobrecarga de CPU de 24/07/2026 e o "todo ticket aparece como Novo". O desenho abaixo é resposta direta a eles.

### Log estruturado

Uma linha JSON por requisição, no fim: `traceId`, `method`, `path` (**o template**, não o caminho com id), `status`, `durationMs`, `userId`, `role`, `dbQueries`, `dbDurationMs`, `errorCode`.

`dbQueries` e `dbDurationMs` existem porque o incidente de julho foi uma consulta lenta chamada muitas vezes — a média por requisição não mostraria; a contagem, sim.

**Nunca** entram no log: `client_email`, `customer_email`, endereço de `held_orders`, corpo de anotação, conteúdo de conversa da Lya, token. O logger tem uma lista de chaves redigidas e um teste que a verifica.

### Métricas

| Métrica | Por quê |
|---|---|
| `http_request_duration_seconds{route,method,status}` (histograma) | p95 por rota; é o que detecta "essa tela ficou lenta" antes do usuário |
| `http_requests_total{route,status,error_code}` | taxa de erro **por código** — `FOLLOW_UP_BLOCKED` subindo significa mudança de comportamento, não falha |
| `db_query_duration_seconds{repository,operation}` | o equivalente a `pg_stat_statements`, do lado da aplicação |
| `db_pool_in_use` / `db_pool_waiting` | o `t4g.micro` tem poucas conexões; fila é o primeiro sintoma |
| `rollup_drift_total` | diferença entre `daily_rollups` incremental e recalculado (emenda §1 de `12`). **Deve ser sempre 0**; ≠ 0 é alarme |
| `idempotency_replay_total` | quantos cliques duplos a API absorveu |
| `lya_sql_duration_seconds` / `lya_sql_rows` | o SQL livre da Lya, que hoje **não tem log nenhum** (emenda §3 de `12`) |
| `zendesk_upstream_calls_total` | a cota é 400/min (R-ZEN-10); sem contador, o `429` é surpresa |

### Trace

`traceId` gerado no `request-context`, propagado no log, devolvido em `details.traceId` de todo `500`, e ecoado em `X-Trace-Id`. O usuário lê um erro em português; o suporte pede o `traceId` e acha a requisição.

### Alarmes propostos

- `rollup_drift_total > 0` — o número do dashboard divergiu da fonte.
- p95 de qualquer rota > 2 s por 5 min.
- `db_pool_waiting > 0` por 1 min — é o prenúncio do incidente de julho.
- taxa de `500` > 1% por 5 min.
- `migration_rejects` com `severity='blocking'` crescendo depois do corte — significa que algo ainda escreve no legado.

---

## 8. Testes

Regra do brief, adotada literalmente: **um teste por regra de negócio de `10`**. O arquivo de teste cita o identificador no nome do `describe`, e um script de verificação lista as regras sem teste e falha o CI.

```
test/
├── rules/
│   ├── R-INT-4.same-day-repeat-marking.test.ts   # [D1] NÃO bloqueia, MAS marca
│   ├── R-TKT-7.duplicate-email-order.test.ts
│   ├── R-REF-6.pristine-auto-refund.test.ts
│   ├── R-HLD-6.client-single-agent.test.ts
│   ├── R-RAD-2.next-follow-up-required.test.ts
│   ├── R-MET-31.compliance-evaluation.test.ts    # [D3] com asOf e política datada
│   ├── R-TKT-24.derived-status-fallback.test.ts  # [C8] os 1.220 concluídos sem interação
│   └── …                                   # um por regra
├── use-cases/
├── http/
└── parity/
```

### Os quatro níveis

| Nível | O que testa | Como |
|---|---|---|
| **Regra** | função pura de `modules/*/rules/` | sem banco, sem mock; `now` é parâmetro. Rápido, e é onde mora a maior parte dos casos |
| **Caso de uso** | orquestração, transação, erro de domínio | Postgres real em container, com `TRUNCATE` entre testes. **Não** mockar o banco: metade das regras aqui é constraint, e mock de banco não tem constraint |
| **HTTP** | forma da resposta e código de erro | requisição de verdade contra o servidor montado. O que este nível garante é o **contrato**: se `11` diz `422 FOLLOW_UP_BLOCKED` com `details.unlocksAt`, o teste verifica os três |
| **Paridade** | legado × novo | §7.2 de `12`. Roda contra uma cópia dos dados; é o que autoriza o corte |

### Os testes que valem por muitos

- **R-MET-4 (a garantia de consistência).** `GET /metrics/me` e `GET /metrics/dashboard` para o mesmo agente e período devem dar o mesmo `totalCount`, e `SUM(byDay[].value)` deve dar `totalCount`. Hoje isso é um comentário no cabeçalho de uma migration (`20260525000200:5-13`); passa a ser um teste que quebra o build.
- **Deriva de rollup.** Escreve N interações por caminhos variados (criar, concluir, apagar, corrigir data), roda `recompute_daily_rollup` e exige diferença zero contra o incremental.
- **Ordem das checagens de duplicidade (R-TKT-7).** Uma tabela de casos com as quatro combinações de `canViewAllTickets` × `canRegisterDuplicateEmails` × dono. Oito linhas, oito asserções — é uma regra que ninguém lembra de cabeça.
- **Matriz de autorização.** Para **cada** rota de `11`, uma tabela `(role, capacidade) → status esperado`. Gerada a partir do mapa de `routes.ts`, para que rota nova sem linha na matriz reprove o CI. É o que impede um endpoint novo nascer aberto.
- **Erro nunca é silencioso.** Um teste que percorre as rotas de escrita, força "0 linhas afetadas" e exige `4xx`, nunca `2xx` (R-TRF-10, emenda §5 de `11`).
- **Fuso.** A mesma requisição às 20:59 e às 21:01 de São Paulo cai em dias de negócio diferentes; o teste congela o relógio nos dois instantes e verifica `businessDay` (§5 do contrato, R-NOT-1, R-MET-19).
- **[D1] A interação no mesmo dia passa, e vem marcada.** Dois testes que precisam existir juntos,
  porque separados um deles envelhece sozinho: (a) registrar duas interações no mesmo ticket no mesmo
  dia responde `201` nas duas — sem `FOLLOW_UP_BLOCKED`, que não existe mais; (b) a segunda vem com
  `isSameDayRepeat = true`, e com `hasTrackingCode` vem `false`. É a proteção contra o erro mais
  provável de quem implementar lendo só o título da decisão: remover a marcação junto com o bloqueio.
- **[C8] Os 1.220 concluídos sem interação.** Um ticket com `legacyStatus = 'concluido'` e zero
  interações precisa derivar `'concluido'`. Sem esse teste, o fallback é exatamente o tipo de linha
  que alguém "simplifica" num refactor, e 1.220 atendimentos reabrem.
- **[D3] A política datada.** `GET /metrics/compliance?asOf=2026-08-15` precisa aplicar a política
  vigente em agosto, não a atual. O teste insere duas vigências e verifica que a avaliação da mesma
  semana muda conforme o `asOf` — é o que prova que "qual era a meta em agosto" tem resposta.
- **[D7] Paginação numerada.** Para cada uma das quatro listas: `totalCount` correto, `totalPages`
  consistente, e `page > totalPages` respondendo `400 PAGE_OUT_OF_RANGE` — nunca lista vazia, que o
  front leria como "não há nada".
- **[D2] A policy é rede, não filtro.** Dois testes: (a) `EXPLAIN` de cada consulta quente sem
  `Seq Scan` em `tickets`, `interactions` ou `refunds`; (b) varredura de `pg_policies` reprovando
  helper chamado fora de `(SELECT ...)` e tabela em `public` sem RLS ou com RLS e zero policies.
- **[D4] Moeda.** Toda rota que devolve dinheiro devolve `{ amount, currency: "USD" }`. Um teste de
  tipo sobre `packages/contract` reprova campo de dinheiro que seja `number` solto — é o que impede o
  rótulo de voltar a divergir do dado, como aconteceu com "Valor (R$)".
- **[G10.2] Orçamento de tamanho de resposta.** Cada rota de coleção declara um teto em bytes, medido
  com dados realistas (a conta mais pesada de produção, não uma fixture de três linhas). É o que
  impede o retorno do problema de `my_follow_ups`, que baixava 1,5 MB por carregamento sem ninguém
  perceber, até o banco cair.
- **[G11.2] Orçamento de consultas por requisição.** O teste conta as consultas de cada rota e falha
  acima do orçamento declarado. Duas derivações da mesma base na mesma requisição é o que ele pega —
  hoje `agent_my_metrics` chama `_interaction_events` **sete vezes** no mesmo turno.
- **[G6.2] Desvio de schema.** Compara `information_schema`, `pg_policies` e a matriz de privilégios
  com o que está versionado em `packages/db`. Diferença é falha, não descoberta de auditoria — é a
  regra que faltava e por isso o legado acumulou 15 colunas com tipo trocado sem nenhum
  `ALTER ... TYPE` no repositório.

### Dados de teste

`test/fixtures/` com construtores (`aTicket()`, `anAgent()`, `aRefund()`), nunca SQL solto. Fixture em SQL envelhece sem ninguém notar; construtor tipado quebra na hora que o schema muda.

---

## 8-A. Conferência contra `01-GARANTIAS.md` — o que esta estrutura cumpre

As garantias de schema estão em `12` §6-A. Aqui, as de estrutura, processo e comportamento.

| # | Garantia | Onde é cumprida | Ajuste que exigiu |
|---|---|---|---|
| G1.3 | o cliente nunca envia `seq`, status do ticket nem contagem | schemas de `packages/contract` recusam campo desconhecido; teste de contrato por rota | — |
| G3.1 | só a API escreve; o browser perde privilégio de escrita | `REVOKE ALL` de `anon` e `authenticated`; papel `api_request` (§4) | **sim** — assumia `SET LOCAL ROLE authenticated` |
| G3.2 | toda regra do inventário tem um teste nomeado | `test/rules/registry.json` + verificador que reprova regra sem teste (§8, emenda 5) | — |
| G3.4 | o front pode esconder, nunca autorizar | matriz de autorização gerada de `routes.ts`; rota nova sem linha reprova o CI (§8) | — |
| G4.1 | proibido valor padrão em leitura remota | regra de lint sobre desestruturação com padrão (é o `const { data = [] }` de julho) | — |
| G4.2 | escrita confere linhas afetadas | repositório devolve a linha ou lança; não existe caminho "ok com zero" (§5) | — |
| G4.4 | envelope de erro com código estável | `errors/codes.ts` em `packages/contract` + teste de contrato por rota | — |
| G5.1–G5.3 | dinheiro é par, formatação deriva da moeda, rótulo não é texto digitado | teste de tipo reprova campo de dinheiro `number` solto (§8) | — |
| G6.1 | toda DDL por migration | `packages/db/migrations/`; `api_request` não tem `CREATE` (§4) | — |
| G6.2 | verificação de desvio em cada integração e diária | job `schema-drift-check` (§2, §4) | **sim** — o job não existia |
| G6.3 | versão única e monotônica | o runner recusa carimbo duplicado (o legado tem três pares colididos) | — |
| G7.1 | nenhum papel de usuário final com privilégio | papel `api_request` + `REVOKE ALL`; teste de segurança com a chave pública (§4) | **sim** |
| G7.2 | RLS em toda tabela nova | teste de catálogo, incluindo o caso "RLS ligada e zero policies" (§4) | — |
| G7.3 | view com `security_invoker` | teste de catálogo (§4) | — |
| G7.4 | sem SQL arbitrário exposto | catálogo de consultas nomeadas em `modules/integrations/lya/queries/` (§9.2) | **sim** |
| G7.5 | privilégios versionados | `packages/db/roles.sql` na verificação de desvio (§4) | **sim** |
| G8.1 | uma ação, uma rota | os dois botões de concluir chamam `POST /tickets/:id/interactions`; as duas telas de plataforma leem o mesmo catálogo | — |
| G8.2 | validação no caso de uso, não no chamador | §3: rota sem `if` de negócio; teste chama a rota direto e exige a mesma recusa | — |
| G8.3 | ação que muda dinheiro ou dono grava evento | `refund_events` em toda baixa; histórico de transferência em toda troca de dono | — |
| G10.1 | limite com teto no servidor | `limit`/`pageSize` no schema da rota; sem limite não compila | — |
| G10.2 | orçamento de tamanho de resposta por rota | **teste novo** com dados realistas (§8) | **sim** — não existia |
| G10.3 | histórico sob demanda, por item | `GET /tickets/:id/interactions`; `my_follow_ups` (que baixava tudo) desaparece | — |
| G10.4 | nenhuma consulta com todas as colunas | o construtor exige lista explícita; `SELECT *` é achado de revisão | — |
| G11.2 | uma requisição materializa a base uma vez | **teste novo** que conta consultas por requisição e falha acima do orçamento (§8) | **sim** — não existia |
| G11.3 | cada métrica tem definição escrita e teste | `test/rules/` + as definições de `10` §8 | — |
| G12.1 | nenhum intervalo de rede no cliente | regra de lint proíbe `setInterval` com requisição; o polling de 30 s e o heartbeat saem | — |
| G12.3 | presença não grava no banco | Realtime Presence (R-AUTH-7) | — |
| G12.4 | orçamento de requisições em repouso: **zero** | teste de integração mede a aba parada | — |

### Exceções registradas

1. **G12.4 versus a emenda 4 deste documento.** A emenda propõe `users.last_seen_at` atualizada no
   máximo a cada 15 minutos, para não perder o histórico de "último visto" que `agent_heartbeats`
   guarda. Isso **não** viola G12.4: o gatilho é uma requisição que já aconteceria (efeito colateral
   de uma chamada real), não um temporizador no cliente. Em aba parada o orçamento continua zero.
   Registrado porque a leitura apressada confunde as duas coisas.

2. **G10.4 versus `GET /tickets/:id`.** A rota devolve praticamente todas as colunas do ticket,
   porque a tela de acompanhamento mostra praticamente todas. A garantia é contra `SELECT *`, não
   contra lista explícita longa: a lista é escrita, versionada no contrato, e uma coluna nova não
   entra na resposta sem alguém decidir.

3. **G7.4 e a capacidade que se perde.** Cumprida, com o custo registrado em `11` §16 e em `12`
   emenda 3: a pergunta imprevista deixa de ser possível sem um arquivo novo. O `lya_query_log` é o
   que transforma esse custo em fila de trabalho em vez de em limite silencioso.

---

## 9. Absorção das duas Edge Functions

As Edge Functions rodam em Deno, no Supabase. A API roda em Node, na Vercel. As duas vão junto no corte, e cada uma tem uma dificuldade específica.

### 9.1 `zendesk` → `modules/integrations/zendesk/`

Porte quase direto: o arquivo é uma função com cinco ações e `fetch` (R-ZEN-4). Vira:

```
modules/integrations/zendesk/
├── zendesk.client.ts       # Basic auth, retry, tradução de 429 (R-ZEN-10)
├── zendesk.mapper.ts       # shapeTicket, decodeEntities (R-ZEN-8, R-ZEN-9)
├── search-query.ts         # buildSearchQuery (R-ZEN-6, R-ZEN-7)
├── prefill.ts              # o mapa campo-a-campo (R-ZEN-11)
└── use-cases/              # status · tickets · ticket · groups · agents · prefill
```

Três coisas mudam:
- O segredo sai dos secrets do Supabase e vai para a variável de ambiente da API, validada no boot por `env.ts` (R-ZEN-1). Credencial ausente continua devolvendo `{ connected: false }`, não erro (R-ZEN-3).
- O guard deixa de ser uma consulta a `profiles` dentro da função e vira `requireRole("manager")` (R-ZEN-2).
- Entra `zendesk_upstream_calls_total`, que hoje não existe.

O que **não** muda: a paginação por página com corte em 1000 (R-ZEN-5, R-ZEN-12) e o mapeamento de autor `cliente`/`time` (R-ZEN-8).

### 9.2 `lya` → `modules/integrations/lya/`

Mais delicada, porque é streaming com orçamento de tempo.

```
modules/integrations/lya/
├── anthropic.client.ts
├── prompt/          { system.ts · context-block.ts · memories-block.ts }
├── tools/           { registry.ts · panel-tools.ts · list-tools.ts
│                      · query-tool.ts · chart-tool.ts · memory-tool.ts }
├── queries/         # [G7.4] um arquivo por consulta NOMEADA: SQL parametrizado
│                    # + schema Zod dos parâmetros + schema da resposta
├── verifier.ts      # o passe anti-fakenews (R-LYA-9)
├── trainer.ts
├── turn.ts          # o loop de tool-use com orçamento (R-LYA-7, R-LYA-8)
└── use-cases/       # chat (SSE) · ping · memórias · conversas · sql
```

**O streaming SSE.** A rota devolve `text/event-stream` com os **mesmos nomes de evento** de hoje — `tool`, `token`, `chart`, `memoria`, `aviso`, `revisao`, `error`, `done` (R-LYA-5). O front não muda uma linha de parsing. Detalhes que precisam ser preservados por serem regra, não implementação:

- `done` **sempre** chega. É para isso que existem os três orçamentos (95 s para forçar a síntese, 115 s para pular o verificador, 25 s de timeout do verificador — R-LYA-8). Na plataforma nova os números mudam de valor, não de papel: viram configuração, e o teste verifica que um turno que estoura o orçamento ainda emite `done`.
- Cliente que desconecta não derruba o servidor: o escritor vira no-op, como o `fechado` de hoje (`lya/index.ts:89-96`).
- Falha no recall emite `aviso` com `codigo: "memoria_indisponivel"` e o chat continua (R-LYA-6). Ficar em silêncio faria o usuário ler uma resposta destreinada como se fosse treinada.
- A resposta desabilita buffering (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`). Se a plataforma de deploy fizer buffering de resposta, o streaming morre em silêncio — é o primeiro item a verificar na implementação.

**O ponto de segurança (R-LYA-2).** Hoje a Edge Function cria um client Supabase com o JWT do usuário, e cada RPC aplica o mesmo guard que aplicaria na tela. Na API, isso vira: **as ferramentas da Lya chamam os casos de uso com o mesmo `RequestContext` da requisição**, jamais com credencial de serviço. Uma ferramenta que consultasse o banco por fora transformaria a Lya num bypass de permissão para qualquer um que tenha `canViewSupportAnalytics`. Um teste garante isso: um usuário `copy_grup` pergunta algo que exigiria `manager` e a ferramenta precisa falhar com `FORBIDDEN`, não responder.

**As 18 ferramentas** (R-LYA-15) passam a chamar os endpoints de `11`, um a um: `painel_atendimentos` → `GET /metrics/dashboard`, `painel_reembolsos` → `GET /metrics/refunds`, e assim por diante. O mapa completo vira uma tabela em `tools/registry.ts`, e um teste verifica que toda ferramenta aponta para uma rota que existe em `routes.ts`.

**[G7.4] O SQL livre deixa de existir.** `query-tool.ts` → `POST /integrations/lya/query` aceita o
**nome** de uma consulta do catálogo `queries/`, com parâmetros vinculados e validados por Zod —
nunca texto SQL. As proteções de hoje (R-LYA-10, R-LYA-11) continuam e ficam mais estreitas: papel
`lya_analytics_ro` sobre views sem PII, `statement_timeout` de 5 s, teto de `LIMIT` 200, e **log
obrigatório** em `lya_query_log`, que hoje não existe.

Dois testes específicos disto:
- **Nenhum caminho aceita SQL.** Um teste varre `modules/integrations/lya/` procurando execução de
  texto vindo do corpo da requisição e reprova. É o que impede o SQL livre de voltar por conveniência.
- **Toda consulta do catálogo roda.** Um teste executa cada arquivo de `queries/` com parâmetros de
  exemplo contra o banco de teste, para que consulta quebrada apareça no CI e não no chat da gestora.

---

## 10. Do que a API depende para funcionar

`env.ts` valida no boot e **falha rápido** — variável faltando derruba o processo, não vira `undefined` numa requisição às 3 da manhã.

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Postgres (pool de aplicação) |
| `DATABASE_URL_MIGRATIONS` | conexão direta, sem pooler, para Drizzle |
| `SUPABASE_URL`, `SUPABASE_JWKS_URL` | validação do JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | **só** para `POST /users/:id/revoke-login` e criação de conta (Admin API) |
| `ANTHROPIC_API_KEY` | Lya (R-LYA-1) |
| `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN` | Zendesk (R-ZEN-1) |
| `BUSINESS_TIMEZONE` | `America/Sao_Paulo`; existe para o fuso ser explícito, não implícito |
| `DATABASE_URL_ADMIN` | conexão `service_role`, usada **só** por `revoke-login` e `POST /users` (§4) |
| `LOG_LEVEL`, `NODE_ENV` | |

`shared/time.ts` é o **único** módulo que importa `BUSINESS_TIMEZONE`. Um teste de lint proíbe a string `"America/Sao_Paulo"` em qualquer outro arquivo de `apps/api`. Isso importa porque hoje a string aparece espalhada em migrations, em `useStatusTracking.ts`, em `useCheckInSnapshot.ts` e em `Atendimentos.tsx` — quatro lugares que podem divergir.

---

## Lacunas

0. **Onde vive o cache de `totalCount`** (§0.3 de `11`). O contrato manda cachear por combinação de filtro, mas não diz onde — mesma questão da chave de idempotência (item 5). Se for em memória do processo, some em serverless.
1. **Framework HTTP não definido.** O contrato não escolhe. A estrutura acima é agnóstica, mas `preHandler`, validação por `schema` e serialização de resposta pressupõem algo no estilo Fastify. Precisa de decisão: Fastify (validação e serialização por schema, mais rápido), Hono (leve, roda em edge e em Node) ou Express (mais conhecido, menos ajuda).
2. **Onde a API roda.** Vercel Functions (mesma conta, mesmo deploy, mas *serverless* — e SSE de 2 minutos em função serverless é o risco central da Lya) ou um servidor persistente. A escolha muda o desenho de §9.2, o pool de conexões e os jobs de §2.
3. **RESOLVIDA por D2, com a premissa corrigida.** A lacuna dizia que pooler em modo transação proibiria `SET LOCAL role`. Está errado: `SET LOCAL` é justamente a forma **compatível** — o escopo morre no `COMMIT` e a conexão volta limpa ao pool. O que é incompatível é `SET` sem `LOCAL`. O desenho de §4 usa `SET LOCAL ROLE` + `set_config(..., true)` e funciona com pooler em modo transação e com serverless. O que continua aberto é o **dimensionamento** do pool no `t4g.micro`.
4. **Agendador dos jobs** (§2): cron da plataforma, `pg_cron` ou fila. `pg_cron` já está disponível no Supabase e não depende da API estar de pé.
5. **Onde fica a chave de idempotência**: tabela no Postgres (durável, custa uma escrita) ou Redis (rápido, mais uma dependência).
6. **Migrations do modelo novo**: Drizzle Kit gerando, ou SQL escrito à mão e versionado? O legado é SQL à mão com comentários longos, e esses comentários são metade do valor do repositório.
7. **Como as duas APIs convivem no corte.** Se houver período de dupla escrita, falta definir quem é a fonte de verdade durante ele.
8. **Versionamento de `packages/contract`.** Workspace interno (uma versão só, sempre em sincronia) ou pacote versionado (permite front e API em versões diferentes)? A primeira é mais simples; a segunda é necessária se os deploys forem independentes.

---

## Propostas de emenda

### 1. RESOLVIDA — a API conecta com o token do usuário `§8-A/D2`

Era a principal emenda desta trilha e foi **aceita**: §8-A/D2 tornou explícito no contrato quem a
API é no banco, e a RLS permanece como rede. A ressalva sobre pooler que acompanhava a proposta
estava baseada em premissa errada e está corrigida em §4 e na Lacuna 3.

O que esta trilha acrescenta como cuidado, porque D2 impôs fluidez e o cuidado é o que a garante:
os **dois testes de §8** (`EXPLAIN` sem `Seq Scan`; varredura de `pg_policies` contra helper fora de
`(SELECT ...)`) não são boa prática — são o que impede a exigência de desempenho de regredir no
primeiro `CREATE POLICY` escrito com pressa. Sem eles, D2 vira uma frase no documento.

### 2. O teste de paridade é critério de corte, não etapa de qualidade

O §8 do contrato diz "nenhuma funcionalidade pode desaparecer" e exige inventário. Proposta de acrescentar: **as provas de §7.2 de `12` rodando com diferença zero são pré-condição do corte**, assinada por quem opera, não por quem desenvolve. Motivo: um inventário prova que alguém pensou em cada item; só a paridade prova que o número continua o mesmo. E é o número que a gestora vai olhar no dia seguinte.

### 3. `apps/api` não exporta tipo; implementa o contrato

§1 do contrato diz "se o front precisa de um tipo, ele vive em `packages/contract`". Proposta de reforçar: `apps/api` **não tem exports públicos**. A direção da dependência vira `api implements contract`, verificada por teste de tipo. Sem isso, o caminho natural é `packages/contract` virar um arquivo de tipos que alguém atualiza à mão depois de mudar a API — e que fica defasado, exatamente como `src/integrations/supabase/types.ts` está hoje (§20 de `10`).

### 4. D3 pede uma tela que não está na linha de base do §7

D3 manda metas, faixas e a regra de acúmulo virarem configuração com vigência. Isso cria um dado que
**alguém precisa editar**, e não existe rota nem tela para isso: §7 do contrato não tem
`/goal-policies`, e a tela de Usuários não tem onde cadastrar meta.

Sem a rota, a política sai do bundle e vai para uma tabela que só muda por SQL — o que troca "muda
por deploy de front" por "muda por SQL em produção", e o segundo é pior, porque não tem revisão.

Proposta: acrescentar `GET /goal-policies` e `POST /goal-policies` (gestora), onde o `POST` **fecha a
vigência anterior e abre a nova** numa transação, em vez de permitir `UPDATE` — é o que preserva o
histórico que D3 pediu. Registrado também como lacuna em `11`.

### 5. Um teste por regra precisa de um verificador automático

Sem ele, "um teste por regra" é intenção. Proposta: os identificadores `R-XXX-n` de `10` viram um arquivo de dados (`test/rules/registry.json`), e um teste percorre esse arquivo exigindo um `describe` correspondente. Regra sem teste **reprova o CI**, e regra nova sem entrada no registro também. É o que faz o inventário continuar vivo depois que esta fase acabar — em vez de virar um documento que envelhece, como `CLAUDE.md` envelheceu (§20 de `10`).

### 6. O streaming SSE precisa de decisão de plataforma **antes** da implementação `→ B23 do backlog`

§4 do contrato trata de tempo real por Realtime, mas o streaming da Lya é outra coisa: uma resposta HTTP única que dura até 2 minutos (R-LYA-8). Em função serverless com teto de duração, esse turno morre no meio, e o sintoma é o pior possível — a resposta some sem `done`, que é exatamente o que os três orçamentos de hoje existem para evitar. Proposta: decidir a plataforma da rota de chat antes de escrever a primeira linha, e, se o teto for menor que o orçamento do turno, reduzir `MAX_STEPS` e o orçamento **juntos**, de forma que o `done` continue garantido.
