# Superfície da API v2 — XMX Suporte

> Trilha: **backend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Referências `R-XXX-n` apontam para `10-backend-regras-atuais.md`.
>
> Esta trilha é **dona** da lista de rotas (§7 do contrato). A linha de base foi
> mantida onde cabia e ampliada onde não cabia; cada acréscimo traz justificativa.
>
> ### Reconciliado com §8-A do contrato e com `91-MEDICOES.md` em 26/09/2026
>
> | Decisão | Efeito nesta superfície |
> |---|---|
> | **D1** | `POST /tickets/:id/interactions` **não valida janela de horário**; o erro `FOLLOW_UP_BLOCKED` deixa de existir e `canAddInteraction`/`interactionUnlocksAt` saem das respostas |
> | **D2** | toda rota executa sob a identidade de quem chamou, com as policies como rede (`13` §4) |
> | **D3** | `GET /metrics/compliance` calcula a avaliação disciplinar, com metas datadas |
> | **D4** | todo valor monetário é `{ amount, currency: "USD" }`; não existe parâmetro de moeda |
> | **D7** | paginação **numerada com `totalCount`** em Reembolsos (2 abas), as duas auditorias e o detalhe de motivo; **cursor só** em "Meus Atendimentos" |
>
> Medições que fecharam desenho: **M1** (dois estados de ticket), **M2** (`seq` do banco é
> urgente), **M3** (baixa unificada custa 39 linhas), **M5** e **M6** (plataforma e percentual).

## 0. Convenções que valem para toda rota

Tudo aqui deriva do §3 do contrato e não se repete em cada endpoint.

| Assunto | Regra |
|---|---|
| Base | `/api/v1` |
| Auth | `Authorization: Bearer <access_token>` (JWT do Supabase Auth). Validação por JWKS; perfil resolvido com cache de 60 s por usuário |
| JSON | `camelCase` na borda, `snake_case` no banco. `date` = `"2026-09-26"`, `timestamptz` = `"2026-09-26T14:32:10.123Z"` |
| Fuso | toda conversão na API; "dia" significa dia em `America/Sao_Paulo` (R-MET-3) |
| Coleção, paginação por cursor | `{ items, nextCursor, hasMore }`. `limit` padrão 25, máximo 100. **Só** `GET /tickets` (§8-A/D7) |
| Coleção, paginação numerada | `{ items, page, pageSize, totalCount, totalPages }`. `pageSize` padrão 25, máximo 100. Usada nas quatro listas de D7 |
| Dinheiro | sempre `{ amount: number, currency: "USD" }`. Nunca número solto, nunca outra moeda (§8-A/D4) |
| Recurso único | objeto na raiz |
| Erro | `{ error: { code, message, details? } }`, `code` em `SCREAMING_SNAKE_CASE` |
| Idempotência | `Idempotency-Key: <uuid>` obrigatório em `POST /tickets`, `POST /tickets/:id/interactions`, `POST /refunds`, `POST /held-orders/import` |
| Validação | descrita como esquema Zod em prosa; o esquema executável vive em `packages/contract` |

### 0.1 Erros comuns a todas as rotas

| HTTP | Código | Significado |
|---|---|---|
| 401 | `UNAUTHENTICATED` | sem token, token inválido ou expirado |
| 403 | `ACCOUNT_BLOCKED` | `isActive = false` ou perfil ausente (R-AUTH-4, R-AUTH-5). `details.reason`: `"deactivated" \| "no_profile"` |
| 403 | `FORBIDDEN` | autenticado, sem a role ou a capacidade exigida. `details.required`: nome da capacidade |
| 404 | `NOT_FOUND` | não existe **ou não é visível** para quem pediu — a API nunca distingue os dois casos |
| 400 | `VALIDATION_FAILED` | corpo ou query inválidos. `details.issues[]` = `{ path, code, message }` no formato do Zod |
| 400 | `INVALID_CURSOR` | cursor malformado, de outra rota, ou de uma versão de ordenação anterior |
| 400 | `PAGE_OUT_OF_RANGE` | `page` acima de `totalPages` numa lista de paginação numerada |
| 409 | `IDEMPOTENCY_KEY_REUSED` | mesma chave com corpo diferente dentro de 24 h |
| 429 | `RATE_LIMITED` | `details.retryAfterSeconds` |
| 500 | `INTERNAL_ERROR` | inesperado; `details.traceId` |

### 0.2 Formato do cursor

Vale para `GET /tickets`, a única rota com paginação por cursor (§8-A/D7). O cursor é
**opaco para o front**: base64url de um JSON que a API decodifica.

```
{ "v": 1, "k": ["2026-09-26T14:32:10.123Z", "8a3f…"], "s": "<hash da ordenação>" }
```

- `v` — versão do formato.
- `k` — os valores da chave de ordenação da última linha entregue, na ordem declarada por cada rota.
- `s` — hash curto da declaração de ordenação da rota. Ordenação diferente ⇒ `s` diferente ⇒ `400 INVALID_CURSOR`.

Toda chave de ordenação termina em um **desempatador único** (`id`), para o keyset não pular nem repetir linha.

### 0.3 Paginação numerada e o `totalCount`

Quatro listas mantêm "Página 3 de 12" (§8-A/D7): Reembolsos (aba em aberto e aba concluídos),
auditoria de atendimentos, auditoria de reembolsos e detalhe de motivo de reembolso.

```
?page=<1..>&pageSize=<1..100>
→ { items, page, pageSize, totalCount, totalPages }
```

Três regras que fazem isso ser barato, e que são a razão pela qual a decisão foi possível:

1. **O predicado é indexável.** O custo de hoje não é o `OFFSET`: é `service_date` em texto,
   convertido e com fuso aplicado **por linha**, que obriga varredura. Sobre `interaction_facts`
   e `refunds` com `business_day`/`request_date` já tipados e indexados, o `OFFSET` salta linhas
   que o índice ordenou — barato.
2. **O total é contado sobre a tabela de fatos**, não sobre o `JOIN` da listagem.
3. **O total é cacheado por combinação de filtro** (60 s por chave `rota+filtros`, no mesmo cache
   do perfil), de modo que trocar de página não reconta. `page > 1` reaproveita o total da
   primeira página quando a chave é a mesma.

`page` acima de `totalPages` responde `400 PAGE_OUT_OF_RANGE` com `details.totalPages` — não uma
lista vazia, que o front leria como "não há nada" (§3 do contrato: nunca mais erro silencioso).

### 0.4 Capacidades, como a API as lê

| Nome no contrato | Deriva de | Endpoints que exige |
|---|---|---|
| `role` | `users.role` | ver cada rota |
| `canViewAllTickets` | `users.can_view_all_tickets` (R-CAP-1) | `GET /tickets`, `GET /tickets/:id`, `GET /tickets/:id/interactions` |
| `canRegisterDuplicateEmails` | `users.can_register_duplicate_emails` (R-CAP-2) | `POST /tickets` |
| `canClaimTickets` | `users.can_claim_tickets` (R-CAP-3) | `POST /tickets/:id/claim` |
| `canApproveTakeovers` | `users.can_approve_takeovers` + `role='manager'` (R-CAP-4) | `GET /takeovers`, `POST /takeovers/:id/approve`, `/reject` |
| `canViewSupportAnalytics` | `role IN ('manager','copy_grup')` (R-CAP-7) | tudo em `/metrics`, `/audit`, `/copy-analytics`, `/integrations/lya` |
| `isAvailable` | `users.is_available` (R-CAP-5) | lida por `POST /takeovers` |

Toda rota executa sob a identidade de quem chamou e as policies do banco confirmam a decisão (§8-A/D2). A autorização **é** da API; a RLS é rede. Ver `13` §4.

---

## 1. `session`

### `GET /me`

Quem: qualquer autenticado.

Substitui: RPC `me_status`, as leituras diretas de `profiles` nos quatro layouts (`AgentLayout.tsx:68`, `ManagerLayout.tsx:179`, `CopyLayout.tsx:141`, `ProdutosLayout.tsx:140`, `AreaSelect.tsx:98`, `Index.tsx:21`, `Login.tsx:89`, `Workspace.tsx:163`) e a derivação de meta/canal do cliente (R-MET-12).

Resposta:

| Campo | Tipo | Origem |
|---|---|---|
| `id` | `string` | `users.id` |
| `email` | `string` | |
| `fullName` | `string \| null` | |
| `role` | `"agent" \| "manager" \| "copy_grup" \| "produto"` | valor **cru**, mesmo se a API não o conhecer (R-AUTH-3) |
| `roleKnown` | `boolean` | `false` quando a role não está no mapa desta versão |
| `areas` | `AppArea[]` | resolvido no servidor (R-AUTH-2) |
| `homeArea` | `AppArea \| null` | primeira de `areas`; `null` quando `areas` está vazio |
| `needsAreaChoice` | `boolean` | `areas.length > 1` |
| `capabilities` | objeto | `canViewAllTickets`, `canRegisterDuplicateEmails`, `canClaimTickets`, `canApproveTakeovers`, `canViewSupportAnalytics` |
| `isActive` | `boolean` | |
| `isAvailable` | `boolean` | |
| `supportChannel` | `"email" \| "sms"` | derivado no servidor sobre janela **fixa** de 30 dias, o que elimina o efeito de hoje (a meta mudava com o filtro de data da tela). A **fonte** — coluna mantida pela gestora ou derivação — continua aberta (§19.3 de `10`) |
| `dailyGoal` | `number` | 100 ou 150, lido de `goal_policies` vigente (§8-A/D3 — sai do bundle) |
| `weeklyGoal` | `number` | 500 ou 750, mesma fonte |
| `serverTime` | `timestamptz` | para o front não confiar no relógio local |
| `businessDay` | `date` | hoje em São Paulo |

Erros: os comuns. Conta bloqueada devolve `403 ACCOUNT_BLOCKED` **também aqui** — não existe rota que responda 200 para conta bloqueada.

### `POST /session/logout`

Quem: qualquer autenticado. Corpo vazio. Resposta `204`.

Substitui: RPC `record_auth_event` chamada pelo cliente antes do `signOut` (R-AUTH-9). Registra `logout` em `auth_events` **no servidor**, corrigindo o caso em que o browser fecha antes da chamada.

### `GET /session/auth-events?limit=`

Quem: o próprio usuário (R-USR-11). Gestora usa `GET /users/:id/auth-events`.

Ordenação: `occurred_at DESC, id DESC`. Cursor: `[occurredAt, id]`.

---

## 2. `tickets`

Um "ticket" é o que o legado chama `services`. Um "interaction" é o que o legado chama `service_follow_ups`.

### `GET /tickets`

Quem: `agent` (os seus), `manager` (todos), `agent` com `canViewAllTickets` (todos).

Substitui: RPC `my_recent_services`, a query `useMyServicesQuery`, o filtro de data e de busca feito no browser (`Atendimentos.tsx:404-430`), a paginação de 15 no cliente (`:467-472`) e `my_follow_ups` (o status vem pronto).

Query:

| Parâmetro | Tipo / validação | Padrão |
|---|---|---|
| `from`, `to` | `date` (ISO `YYYY-MM-DD`) | ambos = hoje em SP |
| `email` | `string`, ≤255, busca por `ILIKE %termo%` em `client_email` | — |
| `hasTrackingCode` | `boolean` | — |
| `status` | `"novo" \| "em_andamento" \| "concluido"` — filtra por `derivedStatus` | — |
| `agentId` | `string` (uuid) — **só** com `canViewAllTickets` ou `manager`; caso contrário `403 FORBIDDEN` | eu |
| `scope` | `"owned" \| "created" \| "all"` | `owned` (`current_owner_id = eu`) |
| `cursor`, `limit` | ver §0 | 25 / 100 |

Regras aplicadas:
- **R-MET-16 / o filtro de data inclui atividade, não só criação**: uma linha entra quando `business_day` do ticket está no intervalo **ou** o ticket teve interação minha no intervalo. Hoje isso é um `Set` montado no browser (`Atendimentos.tsx:391-408`); passa a ser um `EXISTS` sobre `interaction_facts`.
- **R-TKT-3**: busca por e-mail **ignora** o filtro de data — localizar um ticket antigo não pode depender do recorte do dia.
- **R-TKT-24 / R-TKT-25**: `derivedStatus` e `interactionCount` vêm materializados. O front não deriva nada.

Ordenação fixa: `business_day DESC, created_at DESC, id DESC`. Cursor: `[businessDay, createdAt, id]`.

**[D7] Esta é a única rota com paginação por cursor.** Justificativa registrada pelo dono: é
lista quente, aberta o dia todo, e o agente navega pelo começo — não precisa de número de página.

Resposta: envelope, mais `totalInteractions` (o número que a tela mostra como "Total de atendimentos", R-MET-16) e `totalCount` **só** quando `email` ou `hasTrackingCode` está presente (aí a tela mostra "resultados encontrados").

Cada item:

| Campo | Tipo |
|---|---|
| `id` | `string` |
| `clientEmail` | `string` (guarda telefone quando `channel = "SMS"`, R-TKT-11) |
| `businessDay` | `date` |
| `product` | `string` |
| `platform` | `string \| null` |
| `channel` | `string \| null` |
| `contactReason` | enum \| `null` |
| `contactReasonNote` | `string \| null` |
| `orderId` | `string \| null` |
| `hasTrackingCode` | `boolean` |
| `status` | `"registered" \| "concluido"` (o campo cru, R-TKT-9) |
| `derivedStatus` | `"novo" \| "em_andamento" \| "concluido"` |
| `interactionCount` | `number` (inclui a criação, R-TKT-25) |
| `createdAt` | `timestamptz` |
| `creator` | `{ id, fullName }` |
| `currentOwner` | `{ id, fullName }` |
| `takeoverApprovedAt` | `timestamptz \| null` |
| `canAddInteraction` | **REMOVIDO por D1.** Não existe mais janela de horário, então não existe estado "não posso interagir agora". O botão fica sempre habilitado em ticket não concluído |
| `interactionUnlocksAt` | **REMOVIDO por D1** |

> **[D1]** A regra das 18h deixou de bloquear (§8-A/D1). O front não precisa de campo para
> desabilitar botão, porque não há mais o que desabilitar. O que **permanece** é a marcação
> `isSameDayRepeat` em cada interação — ela nunca foi o bloqueio, é o que impede a métrica de
> contar a mesma conversa duas vezes (R-INT-4).

Erros: comuns + `403 FORBIDDEN` quando `agentId` ≠ eu sem capacidade.

### `POST /tickets`

Quem: `agent`, `manager`. `Idempotency-Key` obrigatório.

Substitui: `supabase.from("services").insert(...)` em `Atendimentos.tsx:535-556`, o trigger `_tg_service_pin_date_on_insert`, o trigger `_tg_service_default_current_owner`, a chamada a `find_ticket_by_email` que precede o insert, e o trigger `sync_refund_from_service` no caminho de INSERT.

Corpo (Zod):

| Campo | Validação |
|---|---|
| `clientEmail` | `string`, `trim`, ≤255. Quando `channel = "SMS"`: telefone completo (E.164 ou o formato aceito hoje por `isPhoneComplete`). Senão: e-mail válido |
| `product` | `string`, deve existir em `products` e estar ativo (R-TKT-12) |
| `platform` | `string`, ≤100 |
| `channel` | enum de canais |
| `contactReason` | enum de 11 valores (R-TKT-13), obrigatório |
| `contactReasonNote` | obrigatório e ≤200 quando `contactReason = "outro"`; obrigatório e ≤200 quando `"reclamacao_vsl"` (**DECISÃO 19.10**); deve ser ausente nos outros |
| `orderId` | obrigatório, `trim`, ≥1, ≤100 quando `contactReason = "reembolso"` (R-TKT-10); ausente nos outros |
| `hasTrackingCode` | `boolean`, padrão `false` |
| `concludeNow` | `boolean`, padrão `false` (R-TKT-8) |

**Não aceita** `serviceDate`, `userId`, `currentOwnerId`, `status` — a API os define (R-TKT-1, R-TKT-2, R-TKT-9).

Regras aplicadas, **nesta ordem** (R-TKT-7 — cada ramo tem um teste):
1. Procura ticket não concluído com o mesmo e-mail normalizado, o mais recente, em toda a base (R-TKT-3).
2. Se achou e (`currentOwnerId = eu` **ou** tenho `canViewAllTickets`) → `409 TICKET_ALREADY_OPEN`, `details = { ticketId }` (R-TKT-4).
3. Se achou, é de outro, e **não** tenho `canRegisterDuplicateEmails` → `409 TICKET_OWNED_BY_OTHER_AGENT`, `details = { ticketId, ownerId, ownerName, ownerIsAvailable, creatorName }` (R-TKT-5). `ownerIsAvailable` é o que diz ao front se oferece "Encaminhar" ou "Solicitar aprovação" (R-TKO-1).
4. Cria: `businessDay` = hoje em SP, `creatorId` = `currentOwnerId` = eu, `status` = `concluido` se `concludeNow` senão `registered`.
5. Se `contactReason = "reembolso"`, cria/vincula o reembolso **na mesma transação** (R-REF-2, R-REF-3).

Resposta `201`: o ticket, no formato de item de `GET /tickets`, mais `createdRefund: { id } | null`.

Erros: comuns + `409 TICKET_ALREADY_OPEN` + `409 TICKET_OWNED_BY_OTHER_AGENT` + `422 PRODUCT_INACTIVE`.

### `GET /tickets/:id`

Quem: dono, criador, `canViewAllTickets`, `manager`, `copy_grup` (leitura, via policy "Copy team can view all services").

Substitui: a leitura direta por id em `Atendimentos.tsx:576-583` e a segunda requisição de `order_id` em `EditServiceDialog.tsx:150-168` (R-TKT-20).

Resposta: item de `GET /tickets` + `interactions` (as 20 mais recentes, para o diálogo de acompanhamento abrir cheio) + `transfers` (histórico do ticket).

### `PATCH /tickets/:id`

Quem: dono atual, `manager`.

Substitui: `updateMutation` (`Atendimentos.tsx:~680`) e o `canSave` de `EditServiceDialog.tsx:170-176`.

Corpo: subconjunto de `clientEmail`, `product`, `platform`, `channel`, `contactReason`, `contactReasonNote`, `orderId`. **Nunca** `businessDay`, `creatorId`, `currentOwnerId`, `status` (R-TKT-15, R-TKT-16, R-TKT-17, R-TKT-18).

Regras: a validação condicional de `contactReasonNote` e `orderId` é a mesma do `POST` (R-TKT-19). A sincronia do reembolso vinculado roda na mesma transação, com o conjunto de campos de R-REF-4 e o guard de R-REF-5. Tirar `contactReason = "reembolso"` aplica R-REF-6.

Erros: comuns + `422 FIELD_IMMUTABLE` (`details.field`) se o corpo trouxer campo congelado.

### `DELETE /tickets/:id`

Quem: criador, `manager`. **DECISÃO 19.7** — a especificação abaixo assume soft-delete; se a decisão for manter o hard-delete, o comportamento externo é o mesmo e só muda `12`.

Corpo opcional: `{ reason?: string ≤200 }`.

Regras: aplica R-REF-6 ao reembolso vinculado (só apaga se intocado). Resposta `204`.

Erros: comuns + `422 TICKET_HAS_INTERACTIONS` se a decisão for proibir apagar ticket com interação (**ver 19.7**).

### `GET /tickets/lookup?email=`

Quem: `agent`, `manager`. Substitui: RPC `find_ticket_by_email`.

Resposta `200`: `{ ticket: { id, clientEmail, product, platform, channel, status, businessDay, createdAt, creator: {id, fullName}, currentOwner: {id, fullName, isAvailable} } | null }`.

Regras: **[D6]** a comparação usa `client_email_normalized` (coluna **gerada**, `lower(btrim())`);
o valor digitado é devolvido como foi gravado, nunca normalizado na resposta. Só ticket **não
concluído**; o mais recente por `created_at DESC`; **cruza a visibilidade** (é `SECURITY DEFINER`
hoje), mas devolve apenas os campos acima — nunca o conteúdo do ticket alheio.

> **[D6]** As 179 colisões por caixa alta e baixa existentes **não são resolvidas**: o original
> fica intacto e a coluna gerada faz o casamento (§8-A/D6). Duas pessoas com o mesmo e-mail em
> caixas diferentes continuam sendo o mesmo cliente para esta rota — que é o comportamento de hoje.

### `POST /tickets/:id/claim`

Quem: `canClaimTickets` **ou** `manager` (R-TKT-27).

Substitui: RPC `claim_ticket` e o GUC `app.claim_owner` (R-TKT-17).

Corpo vazio. Resposta `200`: o ticket.

Regras: ticket concluído recusa (R-TKT-28); já sou dono é no-op `200` (R-TKT-29); grava o evento de histórico (R-TKT-30); linha travada (R-TKT-31).

Erros: comuns + `422 TICKET_ALREADY_CONCLUDED`.

### `POST /tickets/:id/correct-date`

Quem: `manager` (R-TKT-22). Substitui: RPC `manager_correct_service_date`.

Corpo: `{ newDate: date, reason: string trim ≥3 ≤500 }` — motivo obrigatório.

Regras: grava em `service_date_corrections` (auditoria) e move o ticket na mesma transação. `newDate` no futuro recusa. Recomputa os `interaction_facts` e os `daily_rollups` dos dois dias afetados.

Erros: comuns + `422 DATE_IN_FUTURE`.

### `POST /tickets/reassign`

Quem: `manager` (R-TKT-23). Substitui: RPC `manager_reassign_tickets`.

Corpo: `{ assignments: [{ ticketId, toUserId }] }`, 1..500 itens.

Regras: idempotente por item (pula quem já é dono); tudo numa transação — um erro desfaz o lote; cada movimento grava histórico com `origin: "manager"`.

Resposta: `{ moved: number, skipped: number, details: [{ ticketId, outcome: "moved" | "skipped" | "not_found" }] }`.

### `GET /tickets/:id/interactions`

Quem: mesma visibilidade de `GET /tickets/:id` (R-INT-9).

Substitui: RPC `my_follow_ups` (a parte por ticket) e a leitura de `service_follow_ups` no cliente.

Ordenação: `recorded_at ASC, id ASC` (é uma linha do tempo). Cursor: `[recordedAt, id]`.

Cada item: `{ id, seq, status, note, recordedAt, actor: {id, fullName}, isSameDayRepeat }`.

### `POST /tickets/:id/interactions`

Quem: dono atual, criador, `canViewAllTickets`, `manager`. `Idempotency-Key` obrigatório.

Substitui: `supabase.from("service_follow_ups").insert(...)` (`useStatusTracking.ts:180-188`), o cálculo de `follow_up_number` no cliente (R-INT-6), `canAddInteraction` (R-INT-1) e os triggers `_tg_follow_up_force_now` e `_tg_follow_up_mark_same_day_repeat`.

Corpo: `{ status: "em_andamento" | "concluido", note?: string ≤2000 }`. **Não aceita** `recordedAt` nem `seq` (R-INT-7, R-INT-6).

Regras — **[D1] esta rota valida dono, permissão e status, e nada mais**:
- **Dono**: quem escreve precisa ser dono atual, criador, ter `canViewAllTickets` ou ser gestora.
- **Status**: ticket concluído recusa com `422 TICKET_ALREADY_CONCLUDED` — reabrir é registrar
  interação `em_andamento` num ticket concluído, o que **é permitido** e é o fluxo "Reabrir
  Ticket" de hoje; o que não é permitido é registrar num ticket já concluído **sem** reabri-lo.
- **Nenhuma janela de horário.** Não existe `FOLLOW_UP_BLOCKED` (§8-A/D1).
- `seq` gerado pelo banco, único por ticket. Medido: **5.543 pares repetidos e 12.753 linhas
  excedentes em 180 dias** com o cálculo atual no cliente — é defeito em curso (M2, §19.5 de `10`).
- `recordedAt = now()`; o corpo não pode escolher.
- **`isSameDayRepeat` continua sendo marcado** pelo trigger, com a isenção de `hasTrackingCode`
  (R-INT-2, R-INT-4). A marcação **não** é o bloqueio: é o que permite a métrica não contar a
  mesma conversa duas vezes. Removê-la junto com o bloqueio distorceria todo dashboard.
- Atualiza `derivedStatus` e `interactionCount` do ticket, e `interaction_facts` +
  `daily_rollups`, na mesma transação.

Resposta `201`: `{ interaction, ticket }` — o ticket vem junto para o front não precisar de um segundo `GET` só para o badge.

Erros: comuns + `422 TICKET_ALREADY_CONCLUDED`. **`FOLLOW_UP_BLOCKED` não existe** (§8-A/D1) — se
aparecer em alguma implementação, é regressão.

### `DELETE /tickets/:id/interactions/:interactionId`

Quem: `manager`. Justificativa do acréscimo: R-INT-8 diz que follow-up errado "se apaga e reinsere", mas **nenhuma tela** oferece isso hoje — a operação é feita por SQL. Sem a rota, a regra documentada não tem como ser exercida.

Corpo: `{ reason: string ≥3 }`. Recomputa `derivedStatus`, `interactionCount`, `seq` dos seguintes (**ou não** — ver 19.5), `interaction_facts` e `daily_rollups`.

---

## 3. `transfers` e `takeovers`

### `POST /transfers`

Quem: `agent`, `manager`. Substitui: `supabase.from("ticket_transfers").insert(...)` em `TransferTicketDialog.tsx` + policy "Agents create transfers as sender" (R-TRF-9).

Corpo: `{ ticketId, toUserId, message?: string ≤500 }`.

Regras: R-TRF-1 (o ticket não se move); R-TRF-2 (um pendente por par ticket+remetente); recusa transferir para si mesmo; recusa ticket concluído.

Erros: comuns + `409 TRANSFER_ALREADY_PENDING` + `422 SAME_AGENT` + `422 TICKET_ALREADY_CONCLUDED`.

### `GET /transfers`

Quem: `agent` (as suas, enviadas e recebidas), `manager` (todas).

Substitui: RPC `my_transfer_history`. **[D1]** Os campos `serviceDate` e `hasTrackingCode`
existiam só para o browser aplicar a regra das 18h ali (R-TRF-4); com D1 **nenhum dos quatro é
necessário** e todos saem.

Query: `role` = `"sent" | "received" | "all"` (padrão `all`), `status`, `cursor`, `limit`.

Ordenação: `created_at DESC, id DESC`.

Cada item: `{ id, direction: "sent"|"received", ticket: { id, clientEmail, product, derivedStatus }, otherAgent: {id, fullName}, status, message, responseNote, origin: "peer"|"manager"|"claim"|"takeover", createdAt, respondedAt }`.

**[D1]** `canAddInteraction` e `interactionUnlocksAt` saíram daqui também: sem janela de horário,
o diálogo de interação aberto pela tela de Transferências não tem o que checar.

`origin` substitui a leitura de `assignedByManagerId` no front (R-TRF-5).

### `POST /transfers/:id/accept` · `POST /transfers/:id/decline`

Quem: o destinatário (`toUserId`). Substitui: `supabase.from("ticket_transfers").update(...)` em `NotificationsBell.tsx` (R-TRF-9) — e corrige R-TRF-10: um `update` que não afeta linha nenhuma deixa de virar sucesso falso.

Corpo do `decline`: `{ responseNote?: string ≤500 }`.

Regras: só transferência `pending`; grava `respondedAt`; aceitar emite o evento de notificação para o remetente. Aceitar **não** move o dono — coerente com R-TRF-1: quem move é `POST /tickets/:id/claim` ou a gestora.

Erros: comuns + `409 ALREADY_ANSWERED`.

### `POST /takeovers`

Quem: `agent`, `manager`. Substitui: RPC `request_ticket_takeover`.

Corpo: `{ ticketId, note?: string ≤500 }`.

Regras: R-TKO-1 (dono precisa estar de folga), R-TKO-2, R-TKO-3, R-TKO-5.

Erros: comuns + `422 OWNER_IS_AVAILABLE` + `422 TICKET_ALREADY_CONCLUDED` + `422 ALREADY_OWNER` + `409 TAKEOVER_ALREADY_PENDING`.

### `GET /takeovers`

Quem: o solicitante (os seus) · `canApproveTakeovers` (todos os pendentes). Substitui: RPC `manager_takeover_notifications`.

Query: `status` (padrão `pending`), `cursor`, `limit`. Ordenação: `created_at DESC, id DESC`.

Cada item: `{ id, ticket: { id, clientEmail, product, derivedStatus }, requester: {id, fullName}, owner: {id, fullName}, requesterNote, responseNote, status, createdAt, respondedAt, respondedBy }`.

`requesterNote` e `responseNote` são **duas** colunas, corrigindo R-TKO-9.

### `POST /takeovers/:id/approve` · `POST /takeovers/:id/reject`

Quem: `canApproveTakeovers` (R-TKO-6). Substitui: `approve_ticket_takeover`, `reject_ticket_takeover`.

Corpo do `reject`: `{ responseNote?: string ≤500 }`.

Regras: R-TKO-7 (move `currentOwner` e marca `takeoverApprovedAt`/`By`), R-TKO-8 (transação + já respondido recusa), grava o histórico com `origin: "takeover"` (R-TRF-8).

Erros: comuns + `409 ALREADY_ANSWERED` + `422 TICKET_ALREADY_CONCLUDED`.

---

## 4. `refunds`

### `GET /refunds`

Quem: `agent` (os seus), `manager` (todos).

Substitui: RPC `my_refunds_with_refunded_value` e os filtros de período feitos no browser (`Reembolsos.tsx:87-99`).

Query: `status` = `"open" | "done" | "all"` (R-REF-1), `from`, `to`, `dateField` = `"request" | "completion"` (o filtro de "em aberto" usa `request_date` e o de "concluídos" usa `completion_date` — R-MET-17), `agentId` (só gestora), `pickedUp` = `boolean`, **`page`, `pageSize`**.

**[D7] Paginação numerada, com `totalCount`**, nas duas abas — o agente precisa saber quantos
faltam (§8-A/D7). Ordenação: `request_date DESC, id DESC`.

Cada item: `{ id, customerEmail, orderId, product, salesPlatform, channel, requestDate, completionDate, reason, reasonCategory, refundPercent, refundValue, refundedValue, itemsReturned, ticketId, createdFromTicket, pickedUpAt, pickedUpBy, owner: {id, fullName}, createdAt }`.

**[D4]** `refundValue` e `refundedValue` são `{ amount, currency: "USD" }`. **[M6]**
`refundPercent` é **inteiro** (0–100), não o texto `"80%"` — o rótulo é formatado na tela, o que
resolve de uma vez a ordenação e o zero à esquerda de `05%` (§19.16 de `10`).
`refundedValue.amount` é `refundValue.amount × refundPercent / 100` arredondado a 2 casas, `null`
quando falta um dos dois (R-REF-20). `reasonCategory` vem de `refund_reason_classifications`.

### `POST /refunds`

Quem: `agent`, `manager`. `Idempotency-Key` obrigatório. Substitui: RPC `create_refund`.

Corpo (Zod, espelhando `newRefundSchema`): `customerEmail` (e-mail, ≤255 — **[D6]** gravado como
digitado), `requestDate` (`date`), `orderId` (`trim` ≥1 ≤100), `salesPlatform` (**[M5]** precisa
existir em `sales_platforms` com `isSelectable = true`; a tabela tem os **10** valores medidos em
produção, não os 8 do seletor de hoje — `Hotmart` e `PagAmerican` existem no banco), `product`
(existe em `products`, R-REF-25), `channel` (**[D5/M4]** `"Nenhum"` e ausente são valores
**diferentes**; o padrão continua `"Nenhum"`, que é o que a tela manda hoje).

Regras: `requestDate` no futuro recusa (acréscimo — hoje nada valida). `userId` = eu.

Erros: comuns + `422 DATE_IN_FUTURE`.

### `PATCH /refunds/:id`

Quem: dono (se em aberto), `manager`.

Corpo: subconjunto de `customerEmail`, `orderId`, `product`, `salesPlatform`, `channel`, `requestDate`.

Regras: reembolso **concluído** não é alterado (R-REF-5) → `422 REFUND_ALREADY_COMPLETED`.

### `POST /refunds/:id/pickup`

Quem: dono ou `manager` (R-REF-8). Substitui: RPC `pick_up_refund`.

Corpo vazio. Regras: só se `pickedUpAt IS NULL` e `completionDate IS NULL`.

Erros: comuns + `409 ALREADY_PICKED_UP` + `422 REFUND_ALREADY_COMPLETED`.

### `POST /refunds/:id/complete`

Quem: dono **ou** `manager`. **Uma rota só**, corrigindo R-REF-18 (hoje o agente faz `.update()` sem validação e a gestora passa por RPC validada).

Substitui: RPC `manager_complete_refund` **e** os dois `.update()` de `Reembolsos.tsx:212,267`.

Corpo (Zod):

| Campo | Validação |
|---|---|
| `completionDate` | `date`; **não** no futuro; **não** anterior a `requestDate` (R-REF-15) |
| `refundValue` | `{ amount: number ≥0, currency: "USD" }` — **[D4]** moeda explícita e fixa |
| `refundPercent` | `integer` 0..100 — **[M6]** inteiro, não `"80%"`. `CHECK (refundPercent % 5 = 0)` é o que os dados atuais satisfazem, **pendente de confirmação** (§19.16 de `10`) |
| `reason` | enum dos 15 motivos (R-REF-14) |
| `itemsReturned` | `boolean`, padrão `false` |

**[M3] Uma rota só, com a validação estrita valendo para todos.** Hoje o agente faz `.update()`
direto e não valida nada; a gestora passa por RPC validada (R-REF-15, R-REF-18). Custo medido de
unificar: **39 linhas** do histórico de 2026 com baixa anterior à solicitação e **zero** com baixa
incompleta, sobre 5.624 reembolsos. O caminho novo nasce validando; as 39 entram como `warning` em
`migration_rejects` e a constraint entra `NOT VALID` para o histórico (`12` §4.1).

Regras: reembolso já concluído recusa; grava linha em `refund_events` **para toda** baixa, com
`actorId`, `actorRole` e `daysOverdue`. `daysOverdue = completionDate − requestDate`; o número
antigo (`hoje − requestDate`, R-REF-17) é preservado em `legacyDaysOverdue` para que o já auditado
continue auditável — **confirmar** (§19.6 de `10`).

Resposta `200`: o reembolso atualizado.

Erros: comuns + `422 REFUND_ALREADY_COMPLETED` + `422 DATE_IN_FUTURE` + `422 COMPLETION_BEFORE_REQUEST`.

### `POST /refunds/:id/reopen`

Quem: `manager`. Acréscimo justificado: hoje reabrir só é possível por SQL, e R-REF-5 declara a baixa imutável — sem rota, um erro de baixa não tem como ser desfeito por quem opera. Corpo: `{ reason: string ≥3 }`. Grava `refund_events` com `kind: "reopened"`.

### `DELETE /refunds/:id`

Quem: dono (se em aberto e não assumido), `manager`. **DECISÃO 19.7**.

### `POST /refunds/external-import`

Quem: `manager`. `Idempotency-Key` obrigatório.

Substitui: a alimentação de `external_refunds` (4.026 linhas em produção), que hoje acontece **fora do
app** — a tabela existe no banco e não em `supabase/migrations/`.

Corpo: `{ sourceFile: string, monthRef: date, platform: string, rows: object[] }` (1..10000).

Regras: `order_number` é derivado de `order_name` por `normalize_order_number` (coluna gerada — `12` §4.4)
e é a chave do casamento com `refunds.order_id`. Linha repetida do mesmo `sourceFile` é ignorada e
relatada, como na importação de pedidos em espera (R-HLD-4).

Resposta: `{ total, inserted, duplicates, emptyRows, sample[] }`.

> **Lacuna**: é preciso descobrir como o arquivo é carregado hoje antes de fixar o formato de `rows`.

### `GET /refunds/alerts`

Quem: `manager` (R-REF-26). Substitui: RPC `manager_refund_alerts`.

Resposta: `{ items: [{ refundId, customerEmail, orderId, owner, requestDate, daysOpen, severity }], thresholds: { warningDays, criticalDays } }`.

---

## 5. `metrics` e `audit`

> A linha de base do §7 do contrato lista 7 rotas. São 13. Justificativa: `dashboard_status_summary`, `dashboard_same_day_repeats`, `dashboard_contact_reason_notes`, o comparativo interno×externo e a avaliação disciplinar (R-MET-31) não caberiam em nenhuma das 7 sem virar um endpoint com `?kind=` — proibido pelo §3.

Todas as rotas desta seção: `canViewSupportAnalytics` (gestora **ou** copy), **exceto** as marcadas `manager` (R-MET-20, R-MET-33).

Query comum: `from` (`date`, obrigatório), `to` (`date`, obrigatório, ≥ `from`, janela máxima 400 dias), `agentId` (opcional).

### `GET /metrics/me`

Quem: qualquer autenticado, **sobre si mesmo**. Substitui: `agent_daily_metrics`, `agent_my_metrics`, `agent_metrics_range`, `agent_product_mix` (R-MET-34 — consolidação).

Query: `from`, `to` (ambos ausentes ⇒ hoje).

Resposta (campos com o mesmo nome do payload de hoje, em `camelCase`):
`totalCount`, `newTickets`, `followUps`, `byDay[{day, value, services, followups}]`, `byChannel[]`, `byPlatform[]`, `byProduct[]`, `bestDay`, `bestDayCount`, `periodDays`, `activeDays`, `daysRemaining`, `myRate`, `avgDaily`, `teamMedianRate`, `teamMedianTotal`, `teamSize`, `teamLeaderName`, `teamLeaderCount`, `teamLeaderRate`, `isLeader`, `gapPerDay`, `gapToMedianPct`, `isBelowTeamRate`, `trendPct`, `trendLabel`, `trendReliable`, `refundsOpen`, `refundsDone`, `refundsTotalValue`, `dailyGoal`.

Regras: R-MET-1 a R-MET-4 (a garantia de que `totalCount` bate com `GET /metrics/dashboard` para o mesmo agente e período é **teste obrigatório**), R-MET-9 a R-MET-14, R-MET-17.

Os aliases legados (`total_interactions`, `team_average`, `gap_to_avg_pct`, `is_below_team_avg_20pct`, `benchmark_*`) **não** são reproduzidos — R-MET-15 / **DECISÃO**.

### `GET /metrics/me/check-in`

> **REMOVIDA — decisão D8 (01/10/2026).** O check-in saiu da área do agente no
> sistema atual; esta rota não é construída. Mantida aqui só como registro do que existia.

Quem: qualquer autenticado, sobre si. Substitui: as **8** consultas paralelas de `useCheckInSnapshot.ts:44-110` (R-MET-18).

Resposta: `{ recent: { services, followUps, refundsCreated, refundsCompleted }, today: { ... }, recentWindowHours: 2, businessDay }`.

Regras: as duas janelas usam `business_day` (não `created_at`), corrigindo R-MET-19. `refundsCompleted` em `recent` é **explicitamente igual** ao de `today`, com o campo `refundsCompletedRecentIsApproximate: true` na resposta, porque `completionDate` não tem hora (R-MET-18) — o front pode então dizer a verdade na tela.

### `GET /metrics/dashboard`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_metrics`.

Resposta: `{ totalCount, byAgent[{agentId, name, value}], byProduct[] (top 10), byDay[{day, value}] (série completa com zeros — R-MET-22), byPlatform[], byChannel[] }`.

Regras: R-MET-1, R-MET-21, R-MET-22, R-MET-23.

### `GET /metrics/channels`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_channel_detail`.

Resposta: por canal, volume, tickets abertos, concluídos, taxa de conclusão e as taxas de reembolso parcial/integral (R-MET-29).

### `GET /metrics/hourly`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_hourly_pattern`. Resposta: matriz hora × dia-da-semana, em hora de São Paulo.

### `GET /metrics/follow-ups`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_follow_up_detail`.

Resposta: `{ kpi, byAgent[{agentId, agentName, newTicketsCount, interactionsCount, doneCount, totalTickets, avgInteractionsToClose, completionRate}], recent[], insights[] }`.

Regras: R-MET-24 (todo agente aparece, inclusive zerado), R-MET-25 (**a definição de "último follow-up" passa a ser única** — `derivedStatus` materializado — corrigindo a divergência), R-MET-26, R-MET-28 (esta rota passa a ler `interaction_facts`, fechando a divergência conhecida).

### `GET /metrics/status-summary`

Quem: **`manager`** (R-MET-33). Substitui: RPC `dashboard_status_summary`.

### `GET /metrics/same-day-repeats`

Quem: `manager`. Substitui: RPC `dashboard_same_day_repeats`.

Resposta: `{ sameDayExtra, ruleViolations, byAgent[{agentId, agentName, repeatCount, totalCount, pct}], detail[{ticketId, clientEmail, product, agentName, recordedAt, previousAt, hoursApart, note}] }`.

Regras: R-MET-5, R-MET-6 (os **dois** números continuam separados, com os mesmos nomes), R-MET-7, R-MET-8.

### `GET /metrics/contact-reasons`

Quem: `manager`. Substitui: RPC `dashboard_contact_reason_notes`.

Resposta: as notas de `outro` e `reclamacao_vsl` **que têm texto**, com o código do motivo, para a exportação separar os dois (R-EXP-4).

### `GET /metrics/refunds`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_refund_metrics`.

Query: comum + `status`, `refundPercent` (**[M6]** inteiro), `product`.

Resposta: KPIs, `byReason`, `byRefundType`, `byProduct`, `byChannel` com as taxas parcial/integral (R-MET-29), `byAgent`.

### `GET /metrics/refunds/reasons/:category`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_refund_reason_detail`.

**[D7] Paginação numerada com `totalCount`**: `page`, `pageSize` (padrão 50, máx 200). A trilha
havia pedido isso como exceção para agregados; o dono manteve a paginação numerada nesta e em mais
três listas, por razão melhor — o custo nunca foi o `OFFSET`, foi o predicado não indexável
(§8-A/D7, §0.3 acima).

### `GET /metrics/refunds/external-comparison`

Quem: `canViewSupportAnalytics`. Acréscimo justificado: o comparativo interno×externo (PRs #52–#70, R-REF-27) é uma tela viva sem RPC nomeada no inventário — vive de importação de CSV e casamento por plataforma. Sem rota, a tela morre no corte.

Resposta: `{ internalPct, matched, total, byPlatform[], unmatchedSample[] }`, com `internalPct = matched / total` (regra do gestor, PR #70).

### `GET /metrics/compliance`

Quem: `manager`. **[D3]** Move para o servidor a avaliação disciplinar de R-MET-31, hoje inteira em
`evaluateAgents` (`DashboardAcompanhamento.tsx:148-204`), com a **funcionalidade preservada** e os
valores iniciais idênticos, para que o corte não mude a avaliação de ninguém (§8-A/D3).

Query: `weeks` (padrão 8, máx 26), `agentId`, `asOf` (`date`, padrão hoje).

`asOf` é o que torna a política auditável: a avaliação é calculada com as metas **vigentes em
`asOf`**, lidas de `goal_policies` (`12` §6.8). É assim que se responde "qual era a meta em agosto"
— pergunta que hoje não tem resposta, porque as metas são constantes no bundle e mudam por deploy.

Resposta:

```
{
  weeks: [{ from, to, label }],
  agents: [{
    agentId, name, supportChannel, weeklyGoal,
    weeks: [{ weekLabel, count, status: "ok" | "alerta" | "advertencia" }],
    totalAlerts, totalWarnings, contractRisk
  }],
  policy: {
    effectiveFrom, effectiveTo,
    email: { weekly: 500, alertMin: 450, lowMin: 400 },
    sms:   { weekly: 750, alertMin: 675, lowMin: 600 },
    alertsPerWarning: 2, warningsForContractRisk: 3
  }
}
```

Regras aplicadas, na ordem exata de hoje (R-MET-31) — a ordem importa, porque o acúmulo de alertas
é avaliado **depois** de classificar a semana:

1. `count >= weekly` → `ok`.
2. `count >= alertMin` → `alerta`, e `accumulatedAlerts += 1`.
3. `count >= lowMin` → `advertencia`, `accumulatedAlerts += 1`, `totalWarnings += 1`.
4. abaixo de `lowMin` → `advertencia`, com os mesmos incrementos.
5. Se `accumulatedAlerts >= 2` **e** a semana ficou em `alerta`: vira `advertencia`,
   `totalWarnings += 1`, e `accumulatedAlerts` **zera**.
6. `contractRisk = totalWarnings >= 3`.

`supportChannel` é resolvido **uma vez** no servidor, não duas como hoje (R-MET-32 — a tela do
agente e a da gestora derivam o mesmo canal de recortes diferentes).

`policy` vem na resposta para que a tela não tenha número escondido no bundle: a UI mostra a meta
que a API aplicou, não a que ela conhece.

Erros: comuns + `422 NO_POLICY_FOR_DATE` quando `asOf` cai antes da primeira vigência cadastrada —
explícito, em vez de aplicar uma meta silenciosamente errada.

### `GET /audit`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_audit`.

**[D7] Paginação numerada com `totalCount`** — é consulta fria, e o total é a informação que a
tela mostra. Ordenação: `occurred_at DESC, id DESC`. O total é contado sobre `interaction_facts`
(não sobre o `JOIN` da listagem) e cacheado por combinação de filtro (§0.3).

Resposta: uma linha **por interação** (R-MET-27): `{ id, occurredAt, businessDay, kind: "ticket_created"|"interaction", ticketId, clientEmail, product, platform, channel, contactReason, actor: {id, fullName}, status, note, isSameDayRepeat }`.

### `GET /audit/refunds`

Quem: `canViewSupportAnalytics`. Substitui: RPC `dashboard_refund_audit`.

**[D7] Paginação numerada com `totalCount`**, ordenada por `request_date DESC, id DESC`. Query:
comum + `status`, `refundPercent`, `product`.

---

## 6. `notifications`

Unifica o que hoje são três sinos diferentes com três RPCs.

### `GET /notifications`

Quem: qualquer autenticado (as suas). Substitui: RPC `my_transfer_notifications`, RPC `manager_takeover_notifications`, e a leitura de `manager_refund_alerts` feita como notificação.

Query: `unseenOnly` (`boolean`, padrão `true`), `kind`, `cursor`, `limit`. Ordenação: `created_at DESC, id DESC`.

Cada item: `{ id, kind, createdAt, seenAt, payload }`, onde `kind` é um de:

| `kind` | Quem recebe | Substitui |
|---|---|---|
| `transfer_received` | destinatário de transferência pendente | `my_transfer_notifications` ramo `inbox` (R-TRF-3) |
| `transfer_answered` | remetente, quando respondida e `requesterSeenAt IS NULL` | idem, ramo `response` (R-TRF-3) |
| `takeover_requested` | `canApproveTakeovers` | `manager_takeover_notifications` (R-TKO-6) |
| `takeover_answered` | solicitante | acréscimo: hoje o agente **não é notificado** da resposta; só descobre quando o ticket aparece na lista |
| `refund_overdue` | dono do reembolso e `manager` | `manager_refund_alerts` (R-REF-26) |
| `radar_due` | dono do caso | acréscimo: R-RAD-9 já calcula "atrasado/hoje", mas nada avisa |
| `held_order_assigned` | agente que recebeu pedidos | acréscimo: hoje o agente só descobre abrindo a aba |

`payload` é tipado por `kind` e carrega **o mínimo para decidir o que invalidar** (§4 do contrato), nunca o dado inteiro: sempre `{ ticketId }` ou `{ refundId }` ou `{ itemId }` mais o nome da outra parte.

### `POST /notifications/:id/seen` · `POST /notifications/seen`

Quem: o destinatário. Substitui: os `update` de `recipient_seen_at`/`requester_seen_at` em `NotificationsBell.tsx` (R-TRF-9, R-TRF-10).

A segunda forma aceita `{ ids: string[] }` (1..100) ou `{ kind }` para marcar tudo de um tipo. Resposta `204`.

### Eventos de Realtime

Canal `user:{userId}`: `notification.created`, `ticket.changed` (`{ ticketId }`), `refund.changed`, `radar.changed`, `heldOrder.changed`, `session.blocked`.
Canal `managers`: `metrics.invalidated` (`{ businessDay }`), `takeover.requested`, `refund.overdue`, `user.presence`.

O evento **não** carrega o dado; o front invalida a query correspondente (§4).

---

## 7. `held-orders`

### `GET /held-orders`

Quem: `agent` (os atribuídos a ele). Substitui: RPC `my_held_orders`.

Query: `status` = `"novo" | "em_andamento" | "concluido" | "open" | "all"` (padrão `all`), `pendingTag`, `cursor`, `limit`.

Regras: nunca devolve linha marcada como repetição (`duplicateOf IS NOT NULL`) — R-HLD-5.

Ordenação: `imported_at DESC, id DESC`.

Cada item: `{ id, dynaCode, orderNumber, mergedOrders, rma, reason, orderDate, email, customerName, address: {street1, street2, street3, city, state, country, postalCode}, age, items, damagedItems, restockedItems, comments, sourceFile, agentStatus, pendingTag, assignCount, confirmedAt, importedAt }`.

Todos os campos do CSV são preservados — §8 do contrato ("um campo de formulário perdido ali é dado perdido para sempre").

### `GET /held-orders/metrics/me`

Quem: `agent`. Substitui: RPC `my_held_orders_daily_metrics`.

Resposta: `{ confirmedToday, pending, goal }`. Regras: R-HLD-18. `goal` deixa de ser a constante 30 no corpo da função e passa a vir de configuração.

### `PATCH /held-orders/:id/status`

Quem: o agente a quem o pedido está atribuído (R-HLD-17). Substitui: RPC `set_held_order_status` e RPC `confirm_held_order` (morta — R-HLD-21).

Corpo: `{ status: "novo"|"em_andamento"|"concluido", note?: string ≤1000, pendingTag?: enum de 4 | null }`.

Regras: R-HLD-12, R-HLD-13, R-HLD-14 (concluir limpa a tag), R-HLD-15 (`confirmedAt` só ao **entrar** em `concluido`; sair limpa), R-HLD-16 (grava evento), R-HLD-17 (linha travada; `404` se não é dele).

Erros: comuns + `422 INVALID_PENDING_TAG`.

### `GET /held-orders/:id/events`

Quem: o agente atribuído, `manager`. Substitui: RPC `held_order_events_for`.

### `GET /held-orders/manager`

Quem: `manager` (R-MET-20 — o copy **não** vê pedidos em espera). Substitui: RPC `manager_list_held_orders`.

Query: `from`, `to`, `agentId`, `status` = `"all"|"aguardando"|"em_andamento"|"pending"|"confirmed"` (os dois últimos mantidos por compatibilidade — R-HLD-19), `cursor`, `limit`.

Resposta: envelope + `totalCount` + `duplicatesCount` + `summaryByAgent[{agentId, name, total, inProgress, done, pending}]`.

Cada item traz também `managerStatus` = `"Confirmado" | "Em andamento" | "Novo" | "Pendente N"`, calculado **na API** (hoje é derivado no componente — R-HLD-19).

### `POST /held-orders/import`

Quem: `manager`. `Idempotency-Key` obrigatório. Substitui: RPC `manager_import_held_orders`.

Corpo: `{ sourceFile: string, rows: object[] }` (1..5000 linhas).

Regras: R-HLD-2 (identidade `(dynaCode, importKey)`, com `rma` na identidade quando existe), R-HLD-3 (só é repetição se já há linha **em aberto**), R-HLD-4 (relata o que ignorou), R-HLD-5 (marca em vez de apagar).

Resposta `200`: `{ total, inserted, duplicates, emptyRows, duplicateOrders: [...até 20], skipped }`. `skipped` marcado como **deprecado** no contrato, mantido por R-HLD-4.

### `POST /held-orders/distribute`

Quem: `manager`. Substitui: RPC `manager_distribute_held_orders`.

Corpo: `{ orderIds: string[] (1..2000), agentIds: string[] (1..50) }`.

Regras: R-HLD-6 (a unidade é o **cliente**), R-HLD-7 (cliente com dono vai para o mesmo agente), R-HLD-8 (linhas do mesmo cliente com outro agente vão junto, e a resposta informa), R-HLD-9 (invariante por trigger), R-HLD-10, R-HLD-11.

Resposta: `{ assigned, movedFromOtherAgents, byAgent[{agentId, count}], conflicts[] }`.

Erros: comuns + `422 NO_ACTIVE_AGENTS` + `422 AGENT_INACTIVE` (`details.agentId`).

### `POST /held-orders/assign`

Quem: `manager`. Substitui: RPC `manager_assign_held_orders` (atribuição dirigida a **um** agente).

Corpo: `{ orderIds: string[], agentId: string }`. Mesmas regras de invariante de cliente único (R-HLD-9).

---

## 8. `radar`

### `GET /radar`

Quem: `agent` (os seus), `manager` (todos — R-RAD-11, a tela dela ainda não existe mas o dado já é visível).

Substitui: RPC `my_radar_items`.

Query: `state` = `"open" | "closed" | "all"` (padrão `open`), `bucket` = `"overdue" | "today" | "next7"`, `kind`, `agentId` (só gestora), `closedWithinDays` (padrão 30 — R-RAD-10), `cursor`, `limit`.

Ordenação fixa: casos abertos primeiro, por `next_follow_up_date ASC` (mais atrasado primeiro), depois fechados por `closed_at DESC`; desempate `id`.

Cada item: `{ id, clientEmail, orderNumber, product, kind, actionNeeded, status, nextFollowUpDate, notes, createdAt, updatedAt, closedAt, daysOverdue, isOverdue, isDueToday, owner: {id, fullName} }`.

### `GET /radar/summary`

Substitui: RPC `my_radar_summary`. Resposta: `{ businessDay, open, overdue, dueToday, next7 }`.

Regras: **baldes disjuntos** (R-RAD-9) — `overdue` (`< hoje`), `dueToday` (`= hoje`), `next7` (`> hoje` e `<= hoje+7`).

### `POST /radar`

Quem: `agent`, `manager`. Substitui: RPC `radar_create_item`.

Corpo: `{ clientEmail (trim, ≥1, ≤255), orderNumber?, product?, kind (enum de 9), actionNeeded (trim, ≥1, ≤1000), nextFollowUpDate (date), notes? (≤4000) }`.

Regras: R-RAD-1, R-RAD-2 (data obrigatória enquanto aberto), R-RAD-5 (um caso aberto por e-mail+pedido+tipo), R-RAD-6 (data no passado recusa).

Erros: comuns + `409 RADAR_DUPLICATE_OPEN` + `422 FOLLOW_UP_DATE_IN_PAST` + `422 INVALID_KIND`.

### `PATCH /radar/:id`

Substitui: RPC `radar_update_item`. Corpo: subconjunto de `clientEmail`, `orderNumber`, `product`, `kind`, `actionNeeded`, `notes`.

Regras: **não** aceita `status`, `nextFollowUpDate` nem `closedAt` — esses só mudam por `POST /radar/:id/actions` (R-RAD-7).

Erros: comuns + `409 RADAR_DUPLICATE_OPEN` + `422 FIELD_IMMUTABLE`.

### `POST /radar/:id/actions`

Substitui: RPC `radar_register_action`. Corpo: `{ status (enum de 6), action (trim ≥1 ≤1000), nextFollowUpDate?: date, notes?: string }`.

Regras: R-RAD-2 (data obrigatória quando o status novo não é `resolvido`/`cancelado`, e proibida quando é), R-RAD-3 (`closedAt` derivado), R-RAD-6, R-RAD-7 (o evento e o estado mudam juntos, na mesma transação), R-RAD-8 (reabrir que colidiria recusa).

### `GET /radar/:id/events`

Substitui: RPC `radar_item_events`. Ordenação `recorded_at ASC, id ASC`.

### `DELETE /radar/:id`

Substitui: RPC `radar_delete_item`. Quem: dono, `manager`.

---

## 9. `notes` (caderno do agente)

> **A gestora não tem rota de leitura aqui** (R-NOT-3). É decisão de produto, não omissão.

### `GET /notes`

Quem: o dono, e só ele. Substitui: `useAgentNotesQuery.ts` lendo `agent_notes` direto.

Query: `from`, `to` (`note_date`; ausentes ⇒ hoje), `kind`, `done`, `pinnedFirst` (padrão `true`), `cursor`, `limit`.

Ordenação: `pinned DESC, note_date DESC, created_at DESC, id DESC` (R-NOT-7).

### `POST /notes`

Corpo: `{ body (trim ≥1 ≤4000), kind: "nota"|"tarefa" (padrão "nota"), noteDate?: date, pinned?: boolean }`.

Regras: `noteDate` ausente ⇒ hoje **em São Paulo** (R-NOT-1). `userId` = eu, sempre.

### `PATCH /notes/:id`

Corpo: subconjunto de `body`, `kind`, `noteDate`, `pinned`, `done`.

Regras: R-NOT-2 (mudar `noteDate` é ação explícita, aceita), R-NOT-4 (`done = true` só em `kind = "tarefa"`), R-NOT-5 (`doneAt` derivado de `done`, nunca vindo do corpo).

Erros: comuns + `422 ONLY_TASKS_CAN_BE_DONE`.

### `DELETE /notes/:id`

Quem: o dono. Resposta `204`.

### `GET /notes/summary`

Acréscimo: a tela mostra contador de pendentes (é o que o índice parcial `idx_agent_notes_pendentes` serve). Resposta: `{ businessDay, pending, pinned, todayTotal }`.

---

## 10. `support-base`

Leitura: qualquer autenticado. Escrita: `manager` (R-BAS-3).

| Rota | Método | Substitui |
|---|---|---|
| `/support-base/products` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id` | leitura/escrita direta em `support_products` (`useSupportBaseQuery.ts`) |
| `/support-base/sms-brands` | idem | `support_sms_brands` |
| `/support-base/sms-replies` | idem | `support_sms_replies` |

Validação: `estrutura` ∈ {`nova`, `antiga`}; `bonusTipo` ∈ {`simples`, `super`} ou ausente; `links` é array de `{ label, url }` (R-BAS-6); nome único por tabela (R-BAS-5) → `409 NAME_ALREADY_EXISTS`.

Regras: `updatedAt`/`updatedBy` gravados pela API, nunca pelo corpo (R-BAS-4). Ordenação por `sortOrder ASC, name ASC` (R-BAS-7).

> Nota de alinhamento: hoje o copy **pode** ler (policy) mas a tela dele não mostra (R-BAS-8). A API mantém a leitura aberta a qualquer autenticado; o front decide o que exibe (§6).

---

## 11. `training`

| Rota | Método | Quem | Substitui |
|---|---|---|---|
| `/training/videos` | `GET` | autenticado (só `isPublished`), `manager` (todos, com `?includeUnpublished=true`) | leitura direta de `training_videos` |
| `/training/videos` | `POST` | `manager` | idem |
| `/training/videos/:id` | `PATCH`, `DELETE` | `manager` | idem |
| `/training/videos/:id/progress` | `PUT` | o próprio | upsert em `training_video_views` (R-TRN-2) |
| `/training/progress` | `GET` | o próprio; `manager` com `?userId=` (R-TRN-3) | idem |

`PUT .../progress` corpo: `{ watchedSeconds: number ≥0 }`. Regras: `lastWatchedAt = now()` **no servidor** (corrige R-TRN-2); `completed` — **DECISÃO 19 / R-TRN-6**: a especificação deriva no servidor (`watchedSeconds >= 0.9 × durationSeconds`) e ignora o campo do corpo; se a decisão for manter no cliente, `completed: boolean` volta ao corpo.

A leitura do bucket de vídeos continua pelo Supabase Storage com as policies de hoje (R-TRN-4) — a API devolve a URL, não faz proxy do arquivo.

---

## 12. `users` (administração)

Tudo aqui: `manager`.

### `GET /users`

Substitui: RPC `manager_list_users` e as leituras diretas de `profiles` em `useAgentsQuery.ts` e `Atendimentos.tsx:360-368`.

Query: `role`, `isActive`, `search` (nome ou e-mail), `cursor`, `limit`. Ordenação: `is_active DESC, full_name ASC, id ASC`.

Cada item: `{ id, email, fullName, role, supportChannel, isActive, isAvailable, deactivatedAt, deactivatedBy: {id, email} | null, createdAt, lastSignInAt, bannedUntil, authAccountDeleted, lastSeenAt, isOnline, lastLogoutAt, openTicketsCount, authorizedOpenCount, capabilities: {...} }`.

Regras: R-USR-1; `isOnline` de Presence (R-AUTH-7, R-AUTH-8); `openTicketsCount` filtrado por `role='agent'`, corrigindo R-USR-9; `authorizedOpenCount` (R-TKO-10); `lastLogoutAt` = último `logout`/`force_logout` (R-USR-10).

### `GET /users/agents`

Acréscimo para separar o caso quente do caso administrativo: devolve só `{ id, fullName }` de `role='agent'` ativos, com `Cache-Control` curto. Substitui: a query `["profiles","agent-names"]` em `Atendimentos.tsx:360-373` e `useAgentsQuery.ts`.

### `POST /users` — **DECISÃO 19.11**

Acréscimo proposto: hoje criar conta é Admin API por fora do app (R-USR-12). Corpo: `{ email, fullName, role, temporaryPassword? }`. Se a decisão for manter fora do app, a rota não existe e o inventário registra o processo manual.

### `PATCH /users/:id`

Corpo: subconjunto de `fullName`, `supportChannel`, `isAvailable`, `role`.

Substitui: RPC `manager_set_agent_availability` (R-USR-7) e o `UPDATE` manual de `full_name` feito hoje por SQL (R-USR-12).

### `PATCH /users/:id/capabilities` — **DECISÃO 19.11**

Acréscimo proposto: as quatro capacidades não têm UI (R-CAP-10). Corpo: subconjunto de `canViewAllTickets`, `canRegisterDuplicateEmails`, `canClaimTickets`, `canApproveTakeovers`.

Regras: `canApproveTakeovers = true` exige `role = 'manager'` → `422 CAPABILITY_REQUIRES_ROLE`. Toda mudança grava em `auth_events` com `kind: "capability_changed"`.

### `POST /users/:id/deactivate` · `POST /users/:id/reactivate`

Substitui: RPC `manager_set_user_active`.

Regras: R-USR-2 (não pode em si mesmo → `422 CANNOT_TARGET_SELF`), R-USR-3 (idempotente, grava `deactivatedAt`/`By` e evento), R-USR-6 (desativar **bane no auth**, não só a flag — a API faz as duas coisas na mesma operação).

### `POST /users/:id/revoke-login`

Substitui: RPC `manager_delete_auth_user`.

Corpo: `{ confirmEmail: string }` — precisa bater com o e-mail do alvo (R-USR-4) → `422 EMAIL_CONFIRMATION_MISMATCH`.

Regras: apaga a conta de login e as sessões; **preserva** o perfil e todo o histórico (R-USR-4); marca inativo e remove o heartbeat (R-USR-5); grava evento `deleted` com o e-mail no metadata.

### `GET /users/:id/auth-events`

Substitui: a leitura de `auth_events` pela gestora (R-USR-11).

### `GET /users/:id/open-tickets`

Substitui: RPC `manager_list_open_tickets_by_agent`.

Resposta: `{ items: [{ ticketId, clientEmail, product, platform, channel, businessDay, hasTrackingCode, contactReason, derivedStatus, lastInteractionAt, interactionCount, creator: {id, fullName, email}, takeoverApprovedAt }] }`.

Regras: filtra por `currentOwnerId`; "aberto" é `derivedStatus <> 'concluido'`, agora com **uma única** definição (R-MET-25).

### `GET /goal-policies` · `POST /goal-policies`

Quem: `manager`. **[D3] Acréscimo necessário, não previsto no §7 do contrato.**

D3 manda metas, faixas e a regra de acúmulo virarem configuração com vigência. Isso cria um dado que
**alguém precisa editar**, e não havia rota nem tela para isso. Sem a rota, a política sai do bundle
e passa a mudar por SQL em produção — que é pior que mudar por deploy, porque não tem revisão.

`GET` devolve `{ items: [{ id, channel, dailyTarget, weeklyTarget, weeklyAlertMin, weeklyLowMin, alertsPerWarning, warningsForContractRisk, effectiveFrom, effectiveTo, createdBy }] }`, ordenado por `channel, effectiveFrom DESC`.

`POST` corpo: `{ channel, dailyTarget, weeklyTarget, weeklyAlertMin, weeklyLowMin, alertsPerWarning, warningsForContractRisk, effectiveFrom }`.

Regras: **não existe `PATCH` nem `DELETE`** — alterar uma vigência apagaria o histórico que D3 pediu.
O `POST` **fecha a vigência anterior** daquele canal (`effectiveTo = effectiveFrom - 1 dia`) e abre a
nova, na mesma transação. `effectiveFrom` no passado, sobrepondo vigência existente, recusa.

Validação: `weeklyLowMin <= weeklyAlertMin <= weeklyTarget`; todos `> 0`.

Erros: comuns + `409 POLICY_PERIOD_OVERLAP` (`details.conflictingId`) + `422 THRESHOLDS_OUT_OF_ORDER`.

### `GET /settings` · `PATCH /settings/:key`

Quem: leitura por qualquer autenticado (é o que a policy `app_settings_select` faz hoje), escrita por `manager`.

Substitui: leitura direta de `app_settings` e a função `usd_brl_rate()`.

Chaves conhecidas: `heldOrdersDailyGoal` (`int > 0`, R-HLD-18). **[D4]** `usdBrlRate` **não
existe**: não há conversão a fazer. **[D3]** As metas **não** ficam aqui — vão para `goal_policies`
(`12` §6.8), porque precisam de vigência datada, que chave/valor não dá.

Resposta do `GET`: `{ items: [{ key, value, updatedAt, updatedBy }] }`.

---

## 13. `copy-analytics`

Quem: `canViewSupportAnalytics` (R-CPY-2, R-CPY-8).

| Rota | Substitui | Notas |
|---|---|---|
| `GET /copy-analytics/refund-reasons` | RPC `copy_refund_reason_analytics` | **[D4] Não existe parâmetro de moeda.** O dado sempre foi dólar; a conversão por `usdBrlRate` era o erro, não o rótulo. Todo valor sai `{ amount, currency: "USD" }`; `usd_brl_rate`, `rate` e `rateUpdatedAt` **deixam de existir** (§8-A/D4) |
| `GET /copy-analytics/refund-reasons/:category/evidence` | RPC `copy_refund_reason_evidence` | percentual **dentro do produto** (R-CPY-4); texto livre **redigido** antes de sair (R-CPY-5) |

Regra de dado a documentar na resposta: a partir de jun/2026 o texto livre do cliente não existe
mais — `originalReason` repete o rótulo (R-REF-22). A resposta inclui
`freeTextAvailableUntil: "2026-05-31"` para a tela não prometer o que não tem.

**[D4]** Os dois rótulos errados do legado (`RefundReasonDetailModal.tsx:35` formatava `BRL`,
`reportExport.ts` rotulava "Valor (R$)") foram corrigidos em 26/09/2026. Na v2 o par
`{ amount, currency }` torna a divergência impossível de repetir.

---

## 14. `exports`

Quem: `agent` (o próprio) / `manager` (relatório completo). §7 do contrato: geração **no servidor** (R-EXP-3 muda).

| Rota | Método | Substitui |
|---|---|---|
| `POST /exports/agent-services` | `POST` | RPC `export_agent_services` + montagem de planilha em `src/lib/reportExport.ts` |
| `POST /exports/manager-report` | `POST` | `dashboard_export_extras` + `export_agent_services` + `dashboard_status_summary` + `dashboard_contact_reason_notes`, hoje combinados no browser (R-EXP-2) |

Corpo: `{ from: date, to: date, agentId?: string, format: "xlsx" }`.

Resposta `200`: `{ rowCount, downloadUrl, expiresAt }` — e `rowCount: 0` **sem** `downloadUrl`, para a UI avisar em vez de baixar arquivo vazio (R-EXP-6).

Regras: fuso de São Paulo em toda data exportada (R-EXP-5); a nota do motivo vem separando `outro`
de `reclamacao_vsl` pelo código (R-EXP-4); `manager_report` exige `manager` puro, não
`canViewSupportAnalytics` (R-EXP-2). **[D4]** Toda coluna de dinheiro é rotulada **US$**, e o valor
vem do mesmo `{ amount, currency }` das rotas — o rótulo deixa de ser texto escrito à mão na
planilha, que foi como as 4 ocorrências de "Valor (R$)" sobreviveram até 26/09/2026.

**Lacuna do contrato**: síncrono ou por job? A especificação acima é síncrona com teto de 30 s; acima disso `202` com `{ jobId }` e `GET /exports/:jobId`. Precisa de decisão.

---

## 15. `integrations/zendesk`

Quem: **`role = 'manager'` puro** (R-ZEN-2). Absorve `supabase/functions/zendesk/index.ts`.

| Rota | Substitui a ação | Notas |
|---|---|---|
| `GET /integrations/zendesk/status?from&to` | `status` | Credencial ausente ⇒ `200 { connected: false, reason }`, **não** erro (R-ZEN-3). Gasta 9 chamadas no Zendesk (R-ZEN-10) |
| `GET /integrations/zendesk/tickets?page&perPage&q&status&groupId&from&to` | `tickets` | Paginação **por página** — exceção documentada ao §3 (R-ZEN-12). `q` só dígitos ⇒ busca por id (R-ZEN-6); `q` com `@` ⇒ `requester:` (R-ZEN-7). `page*perPage > 1000` ⇒ `400 SEARCH_WINDOW_EXCEEDED` (R-ZEN-5) |
| `GET /integrations/zendesk/tickets/:id` | `ticket` | Conversa inteira; `authorKind` ∈ {`cliente`,`time`}, `internalNote` = time e não público (R-ZEN-8); corpo com entidades decodificadas (R-ZEN-9) |
| `GET /integrations/zendesk/groups` | `groups` | ordenado por nome em pt-BR |
| `GET /integrations/zendesk/agents` | `agents` | |
| `GET /integrations/zendesk/prefill?ticketId=` | — | Acréscimo: formaliza o pré-preenchimento do atendimento (R-ZEN-11). Devolve o mapa campo-a-campo já traduzido para o corpo de `POST /tickets`, com `coverage` e `missing[]` explicando o que não veio |

Erros específicos: `502 ZENDESK_UPSTREAM` (`details.status`, `details.path`), `429 RATE_LIMITED` (R-ZEN-10), `404 ZENDESK_TICKET_NOT_FOUND`.

O segredo (`ZENDESK_SUBDOMAIN`, `_EMAIL`, `_API_TOKEN`) continua em variável de ambiente do servidor e nunca no bundle (R-ZEN-1).

---

## 16. `integrations/lya`

Quem: `canViewSupportAnalytics` (R-LYA-3); treino só `manager` (R-LYA-4). Absorve `supabase/functions/lya/*`.

### `POST /integrations/lya/chat`

`Content-Type` da resposta: `text/event-stream`.

Corpo: `{ messages: [{role: "user"|"assistant", content: string}] (1..50), modoTreino?: boolean, contexto?: ContextoTela }`.

Eventos SSE, com os **mesmos nomes** de hoje (R-LYA-5): `tool`, `token`, `chart`, `memoria`, `aviso`, `revisao`, `error`, `done`.

Regras: R-LYA-1 (chave só no servidor), R-LYA-2 (**as ferramentas chamam os casos de uso com o contexto do usuário**, nunca com credencial de serviço — é o que impede a Lya de virar bypass), R-LYA-6 (`aviso` com `codigo: "memoria_indisponivel"` quando o recall falha, sem derrubar o chat), R-LYA-7 (10 rodadas, última forçada a sintetizar), R-LYA-8 (95 s / 115 s / 25 s), R-LYA-9 (verificador fail-open).

`modoTreino` só vale com `role = 'manager'`; para o resto é ignorado silenciosamente, como hoje.

### `GET /integrations/lya/ping`

Resposta: `{ ok, chaveConfigurada, modelo, role }`. Chave ausente em `/chat` ⇒ `503 LLM_NOT_CONFIGURED`.

### Memórias (cérebro)

| Rota | Quem | Substitui |
|---|---|---|
| `GET /integrations/lya/memories` | `canViewSupportAnalytics` | `lya_list_memories` |
| `POST /integrations/lya/memories` | `manager` | `lya_upsert_memory` + ação `memoria_salvar` |
| `DELETE /integrations/lya/memories/:name` | `manager` | `lya_delete_memory` |
| `DELETE /integrations/lya/memories/seed` | `manager` | `lya_delete_seed_memories` |
| `POST /integrations/lya/memories/recall` | interno (a própria API) | `lya_recall_memories` |

`POST` corpo: `{ name?: string, description: string (trim ≥1), body: string, tags?: string[], type?: "user"|"feedback"|"project"|"reference"|"nota", refinar?: boolean (padrão true) }` (R-LYA-14).

### Conversas

| Rota | Substitui |
|---|---|
| `GET /integrations/lya/chats` | `lya_list_chats` |
| `GET /integrations/lya/chats/:id` | `lya_get_chat` |
| `PUT /integrations/lya/chats/:id` | `lya_save_chat` |
| `DELETE /integrations/lya/chats/:id` | `lya_delete_chat` |

Regras: R-LYA-13 — conversa é do usuário, ninguém lê a de outro, **nem a gestora**.

### `POST /integrations/lya/query` — **consulta nomeada, não SQL livre [G7.4]**

Quem: `canViewSupportAnalytics`. Substitui: RPC `lya_exec_sql`.

**[G7.4] Mudança de desenho.** A versão anterior desta especificação mantinha SQL livre com alcance
reduzido, e a trilha havia argumentado a favor. `01-GARANTIAS.md` G7.4 é normativo e diz o contrário:
"não existe execução de SQL arbitrário exposta a usuário; a rota de análise aceita **consulta
nomeada**, não texto livre". A trilha **cumpre**, e registra abaixo o que se perde e o que compensa.

Corpo: `{ query: string, params?: Record<string, string|number|boolean|null>, limit?: int 1..200 }`.

`query` é o **nome** de uma consulta do catálogo, nunca SQL. O catálogo vive em
`modules/integrations/lya/queries/` — um arquivo por consulta, com o SQL parametrizado, o schema Zod
dos parâmetros e o schema da resposta. O que o catálogo precisa cobrir para a Lya não regredir:

| `query` | Parâmetros | O que responde |
|---|---|---|
| `interactions_by_day` | `from`, `to`, `agentId?` | série diária de interações |
| `interactions_by_agent` | `from`, `to` | ranking por agente |
| `tickets_by_product` | `from`, `to`, `limit?` | volume por produto |
| `tickets_by_contact_reason` | `from`, `to` | volume por motivo de contato |
| `refunds_by_reason` | `from`, `to`, `platformId?` | reembolso por motivo, em USD |
| `refunds_by_platform` | `from`, `to` | reembolso por plataforma |
| `refund_value_distribution` | `from`, `to`, `buckets?` | faixas de valor |
| `same_day_repeats_by_agent` | `from`, `to` | repetições por agente |
| `held_orders_aging` | `asOf` | pedidos em espera por faixa de idade |
| `radar_overdue_by_agent` | `asOf` | casos de radar atrasados |
| `agent_active_days` | `from`, `to` | dias trabalhados por agente |

Regras: cada consulta declara seus parâmetros (validados por Zod) e roda com **parâmetros
vinculados**, nunca por interpolação de texto. Transação somente-leitura, `statement_timeout` de 5 s,
`LIMIT` imposto por fora com teto **200**, sob o papel `lya_analytics_ro`, que enxerga
`interaction_facts`, `daily_rollups`, os catálogos e **views sem PII** de `tickets`, `refunds` e
`held_orders` — nunca `users` inteiro, `auth`, `auth_events`, memórias, conversas, e nunca endereço
ou e-mail de cliente.

Toda execução é registrada em `lya_query_log` (`actorId`, `query`, `params`, `durationMs`,
`rowCount`, `error`), com retenção de 90 dias. Hoje **não existe log nenhum** do que a Lya executou.

Erros: `404 QUERY_NOT_FOUND` (nome fora do catálogo), `400 VALIDATION_FAILED` (parâmetros),
`422 QUERY_TIMEOUT`, `429 RATE_LIMITED`.

**O que se perde e o que compensa.** Perde-se a pergunta imprevista: hoje a gestora pergunta algo que
ninguém desenhou e o modelo escreve o `SELECT`. Com catálogo, pergunta nova exige arquivo novo — um
deploy, não uma conversa. O que compensa: (a) o banco roda em `t4g.micro` e **já caiu** por sobrecarga
em 24/07/2026, e um `SELECT` gerado por LLM sobre a tabela de interações inteira é o perfil exato
daquele incidente; (b) sem log, não havia como saber se a Lya participou de um incidente; (c) as 15
tabelas liberadas incluíam `held_orders`, com endereço completo de cliente — PII que a view
`lya_agentes` existia para evitar no caso do time e que ninguém havia evitado no caso do cliente.

O `lya_query_log` é o que torna a evolução do catálogo dirigida por dado: a pergunta que a gestora
tenta fazer e não tem consulta aparece como `404`, e vira a fila de consultas a escrever.
→ B2 do backlog.

### Arquivos da Lya (R-LYA-16)

`lya_files` e `lya_file_rows` **existem em produção** (confirmado em `30-banco-estado-real.md` §2) e
**não existem em `supabase/migrations/`**. As rotas:

| Rota | Quem | Notas |
|---|---|---|
| `POST /integrations/lya/files` | `manager` | ingestão de CSV ou markdown. Corpo multipart. Cria a linha em `lya_files` com `status = "processando"`, quebra o CSV em `lya_file_rows` e grava `columns`, `rowCount`, `summary`. Falha grava `status = "erro"` e `error` — **nunca** apaga a linha, senão o usuário não sabe o que aconteceu |
| `GET /integrations/lya/files` | `canViewSupportAnalytics` | lista com `name`, `kind`, `status`, `rowCount`, `bytes`, `tags`, `uploadedBy`, `createdAt` |
| `GET /integrations/lya/files/:id` | `canViewSupportAnalytics` | inclui `columns` e `summary`; **não** inclui `content` inteiro |
| `GET /integrations/lya/files/:id/rows` | `canViewSupportAnalytics` | keyset por `line ASC`; é o que a ferramenta da Lya consulta |
| `DELETE /integrations/lya/files/:id` | `manager` | remove o arquivo e as linhas (cascata) |

A ingestão cria um nó de cognição no grafo do cérebro (memória `project_lya_arquivos_feature`);
o efeito colateral fica no caso de uso, não na rota.

**Lacuna de processo**, não de especificação: como essas tabelas foram criadas em produção sem
migration, e o que mais está nessa situação.

---

## 17. Rastreabilidade — cada função do banco de hoje e seu destino

Inventário completo: **107 funções** em `supabase/migrations/` (ordem de aplicação = ordem alfabética do nome; para cada função, **a última definição é a que vale**). Dessas, **70** são superfície chamável (RPC), **7** são funções de trigger, **30** são helpers internos.

Nenhuma linha está vazia. `—` significa "não migra", com o motivo na coluna de notas.

### 17.1 RPCs de leitura

| RPC de hoje | Última definição em | Endpoint novo | Notas |
|---|---|---|---|
| `agent_daily_metrics` | `20260525000200` | `GET /metrics/me` | consolidada |
| `agent_my_metrics` | `20260817140000` | `GET /metrics/me` | consolidada; aliases legados cortados (R-MET-15) |
| `agent_metrics_range` | `20260131001710` | `GET /metrics/me` | conta pela regra antiga (R-MET-34); a consolidação corrige |
| `agent_product_mix` | `20260131001710` | `GET /metrics/me` (`byProduct`) | idem |
| `copy_refund_reason_analytics` | `20260828160000` | `GET /copy-analytics/refund-reasons` | |
| `copy_refund_reason_evidence` | `20260828120000` | `GET /copy-analytics/refund-reasons/:category/evidence` | |
| `dashboard_audit` | `20260904120000` | `GET /audit` | **[D7]** segue numerada, com `totalCount` contado sobre `interaction_facts` |
| `dashboard_channel_detail` | `20260824120000` | `GET /metrics/channels` | |
| `dashboard_contact_reason_notes` | `20260828120000` | `GET /metrics/contact-reasons` | |
| `dashboard_export_extras` | `20260803120000` | `POST /exports/manager-report` | vira insumo interno do export |
| `dashboard_follow_up_detail` | `20260824120000` | `GET /metrics/follow-ups` | passa a ler `interaction_facts` (R-MET-28) |
| `dashboard_hourly_pattern` | `20260824120000` | `GET /metrics/hourly` | |
| `dashboard_metrics` | `20260824120000` | `GET /metrics/dashboard` | |
| `dashboard_refund_audit` | `20260827120000` | `GET /audit/refunds` | **[D7]** segue numerada, com `totalCount` |
| `dashboard_refund_metrics` | `20260904120000` | `GET /metrics/refunds` | |
| `dashboard_refund_reason_detail` | `20260824120000` | `GET /metrics/refunds/reasons/:category` | **[D7]** numerada mantida, com `totalCount` |
| `dashboard_same_day_repeats` | `20260727140000` | `GET /metrics/same-day-repeats` | |
| `dashboard_status_summary` | `20260810120000` | `GET /metrics/status-summary` | `manager` puro |
| `export_agent_services` | `20260818140000` | `POST /exports/agent-services` | |
| `find_ticket_by_email` | `20260717120000` | `GET /tickets/lookup` | |
| `held_order_events_for` | `20260729120000` | `GET /held-orders/:id/events` | |
| `manager_list_held_orders` | `20260810170000` | `GET /held-orders/manager` | `managerStatus` passa a vir calculado |
| `manager_list_open_tickets_by_agent` | `20260717120500` | `GET /users/:id/open-tickets` | |
| `manager_list_users` | `20260717120500` | `GET /users` | |
| `manager_refund_alerts` | `20260421100000` | `GET /refunds/alerts` + `GET /notifications` (`refund_overdue`) | |
| `manager_takeover_notifications` | `20260717120500` | `GET /takeovers` + `GET /notifications` (`takeover_requested`) | |
| `me_status` | `20260520050000` | `GET /me` + middleware `403 ACCOUNT_BLOCKED` | polling de 30 s morre (R-AUTH-6) |
| `my_follow_ups` | `20260725120000` | `GET /tickets` (status materializado) + `GET /tickets/:id/interactions` | contorno do teto de linhas do PostgREST; some com a API (R-INT-10) |
| `my_held_orders` | `20260805120000` | `GET /held-orders` | |
| `my_held_orders_daily_metrics` | `20260805120000` | `GET /held-orders/metrics/me` | meta 30 sai do código |
| `my_radar_items` | `20260825120000` | `GET /radar` | |
| `my_radar_summary` | `20260825120000` | `GET /radar/summary` | |
| `my_recent_services` | `20260818140000` | `GET /tickets` | |
| `my_refunds_with_refunded_value` | `20260806150000` | `GET /refunds` | **[D7]** numerada nas 2 abas; **[D4]** dinheiro em `{ amount, currency }`; **[M6]** `refundPercent` inteiro |
| `my_transfer_history` | `20260529000000` | `GET /transfers` | `serviceDate`/`hasTrackingCode` saem (R-TRF-4) |
| `my_transfer_notifications` | `20260514020000` | `GET /notifications` | |
| `lya_list_memories` | `20260907120000` | `GET /integrations/lya/memories` | |
| `lya_recall_memories` | `20260907120000` | interno (`POST /integrations/lya/memories/recall`) | |
| `lya_list_chats` | `20260907120000` | `GET /integrations/lya/chats` | |
| `lya_get_chat` | `20260907120000` | `GET /integrations/lya/chats/:id` | |
| `lya_exec_sql` | `20260907120000` | `POST /integrations/lya/query` | **[G7.4]** deixa de aceitar SQL livre: consulta **nomeada** com parâmetros vinculados, papel `lya_analytics_ro` sobre views sem PII, log obrigatório |
| `radar_item_events` | `20260825120000` | `GET /radar/:id/events` | |

### 17.2 RPCs de escrita

| RPC de hoje | Última definição em | Endpoint novo | Notas |
|---|---|---|---|
| `agent_heartbeat` | `20260520050000` | — | substituído por Realtime Presence (R-AUTH-7). Ver emenda §5 sobre o histórico que se perde |
| `record_auth_event` | `20260520050000` | `POST /session/logout` (+ registros internos) | passa a ser do servidor (R-AUTH-9) |
| `claim_ticket` | `20260818140000` | `POST /tickets/:id/claim` | GUC `app.claim_owner` desaparece |
| `create_refund` | `20260325130000` | `POST /refunds` | ganha validação de data |
| `pick_up_refund` | `20260806150000` | `POST /refunds/:id/pickup` | |
| `manager_complete_refund` | `20260728120000` | `POST /refunds/:id/complete` | **unifica** com o caminho do agente (R-REF-18) |
| `manager_correct_service_date` | `20260525000400` | `POST /tickets/:id/correct-date` | |
| `manager_reassign_tickets` | `20260528000400` | `POST /tickets/reassign` | |
| `manager_set_user_active` | `20260520050000` | `POST /users/:id/deactivate` · `/reactivate` | |
| `manager_set_agent_availability` | `20260717120000` | `PATCH /users/:id` (`isAvailable`) | |
| `manager_delete_auth_user` | `20260520050000` | `POST /users/:id/revoke-login` | |
| `request_ticket_takeover` | `20260717120500` | `POST /takeovers` | |
| `approve_ticket_takeover` | `20260717120500` | `POST /takeovers/:id/approve` | |
| `reject_ticket_takeover` | `20260717120500` | `POST /takeovers/:id/reject` | `requesterNote`/`responseNote` separadas (R-TKO-9) |
| `manager_import_held_orders` | `20260805120000` | `POST /held-orders/import` | |
| `manager_distribute_held_orders` | `20260806140000` | `POST /held-orders/distribute` | |
| `manager_assign_held_orders` | `20260806140000` | `POST /held-orders/assign` | |
| `set_held_order_status` | `20260729120000` | `PATCH /held-orders/:id/status` | |
| `confirm_held_order` | `20260617000000` | — | morta: nenhuma tela chama (R-HLD-21) |
| `radar_create_item` | `20260825120000` | `POST /radar` | |
| `radar_update_item` | `20260825120000` | `PATCH /radar/:id` | |
| `radar_register_action` | `20260825120000` | `POST /radar/:id/actions` | |
| `radar_delete_item` | `20260825120000` | `DELETE /radar/:id` | |
| `lya_upsert_memory` | `20260907120000` | `POST /integrations/lya/memories` | |
| `lya_delete_memory` | `20260907120000` | `DELETE /integrations/lya/memories/:name` | |
| `lya_delete_seed_memories` | `20260908120000` | `DELETE /integrations/lya/memories/seed` | |
| `lya_save_chat` | `20260907120000` | `PUT /integrations/lya/chats/:id` | |
| `lya_delete_chat` | `20260907120000` | `DELETE /integrations/lya/chats/:id` | |

### 17.3 Funções de trigger

| Função | Trigger | Destino na v2 |
|---|---|---|
| `_tg_service_pin_date_on_insert` | `trg_service_pin_date_on_insert` | **permanece** como trigger de invariante (R-TKT-1) |
| `_tg_service_default_current_owner` | `trg_service_default_current_owner` | **permanece** (R-TKT-2); a coluna passa a ser `NOT NULL` com default do caso de uso |
| `_tg_service_block_freeze_fields` | `trg_service_block_freeze_fields` | **permanece**, sem a carve-out do GUC: só a API escreve (R-TKT-15/16/17) |
| `_tg_follow_up_force_now` | `trg_follow_up_force_now` | **permanece** (R-INT-7) |
| `_tg_follow_up_block_date_change` | `trg_follow_up_block_date_change` | **permanece** (R-INT-8) |
| `_tg_follow_up_mark_same_day_repeat` | `trg_follow_up_mark_same_day_repeat` | **permanece** (R-INT-4); a API passa a bloquear antes, conforme 19.2 |
| `sync_refund_from_service` | `trg_service_sync_refund_ins` / `_upd` | lógica migra para os casos de uso `CreateTicket`/`UpdateTicket`; trigger mantido como rede de segurança (R-REF-2…R-REF-6) |
| `cleanup_refund_of_deleted_service` | `trg_service_cleanup_refund_del` | **permanece** (R-REF-6) |
| `sync_refund_reason_classification` | `trg_sync_refund_reason_classification` | **permanece** (R-REF-21) |
| `held_orders_client_single_agent` | `trg_held_orders_client_single_agent_ins` / `_upd` | **permanece** — é a invariante "um cliente, um agente" (R-HLD-9) |
| `handle_new_user` | `on_auth_user_created` | **permanece** (R-AUTH-11) |
| `set_updated_at` | `set_goals_updated_at` | **permanece**, genérico |
| `agent_notes_touch` | `trg_agent_notes_touch` | **permanece** |
| `app_settings_touch` | `trg_app_settings_touch` | **permanece** |
| `support_base_touch` | `trg_support_products_touch`, `trg_support_sms_brands_touch`, `trg_support_sms_replies_touch` | **permanece** (R-BAS-4) |
| `lya_touch` | `trg_lya_memories_touch` | **permanece** |
| `trg_services_refresh_agent_daily_counts` | `services_refresh_agent_daily_counts` | — substituído pelo trigger de `daily_rollups` (R-MET-35) |

### 17.4 Helpers internos

| Função | Destino na v2 |
|---|---|
| `_interaction_events` | tabela `interaction_facts` (R-MET-1); a função some |
| `is_manager` | middleware de autorização (`role === 'manager'`) |
| `is_copy_team` | middleware (`role === 'copy_grup'`) |
| `is_supervisor` | — resíduo de rename (R-AUTH-14) |
| `has_role` | — `user_roles` não é fonte de verdade (R-CAP-11) |
| `can_view_all_tickets` | capacidade `canViewAllTickets` no middleware |
| `can_claim_tickets` | capacidade `canClaimTickets` |
| `can_view_support_analytics` | capacidade `canViewSupportAnalytics` |
| `can_read_refund_analytics` | idem — é a mesma regra (R-CPY-8) |
| `classify_refund_reason` | função do caso de uso `ClassifyRefundReason` (chamada pelo trigger) |
| `refund_refunded_value` | coluna gerada `refunds.refunded_value` (R-REF-20) |
| `usd_brl_rate` | — **[D4]** não migra: todo valor é dólar, não há conversão (§8-A/D4) |
| `goals` (tabela, nenhuma tela lê) | `GET /goal-policies` · `POST /goal-policies` — **[D3]** vira política datada (`12` §6.8) |
| `text_to_date_safe` | — a v2 tipa como `date`; o backfill rejeita o que não converte (R-CPY-6) |
| `redact_free_text` | função do caso de uso de copy-analytics (R-CPY-5) |
| `held_order_client_key` | função `IMMUTABLE` **mantida** — é a chave do índice (R-HLD-6) |
| `held_orders_client_conflicts` | interno de `POST /held-orders/distribute` |
| `radar_today` | resolvido na borda (fuso de negócio, §5 do contrato) |
| `radar_is_closed` | predicado do caso de uso |
| `lya_slugify` | função `IMMUTABLE` mantida (chave de memória) |
| `refresh_agent_daily_service_count` | — substituída pelo recálculo de `daily_rollups` (R-MET-35) |

### 17.5 Escritas diretas do cliente (sem RPC) — o que cada uma vira

| Hoje | Arquivo:linha | Endpoint novo |
|---|---|---|
| `services.insert` | `src/pages/agent/Atendimentos.tsx:535` | `POST /tickets` |
| `services.update` | `src/pages/agent/Atendimentos.tsx:~680` | `PATCH /tickets/:id` |
| `services.delete` | `src/pages/agent/Atendimentos.tsx:~655` | `DELETE /tickets/:id` |
| `services.select` por id | `src/pages/agent/Atendimentos.tsx:576` | `GET /tickets/:id` |
| `services.select("order_id")` | `src/features/services/EditServiceDialog.tsx:152` | `GET /tickets/:id` (elimina a 2ª requisição, R-TKT-20) |
| `services.select` count (check-in) | `src/features/agent/check-in/useCheckInSnapshot.ts:62,67` | `GET /metrics/me/check-in` |
| `services.select` (canal do agente) | `src/pages/DashboardAcompanhamento.tsx:~105` | `GET /metrics/compliance` |
| `service_follow_ups.insert` | `src/features/services/useStatusTracking.ts:180` | `POST /tickets/:id/interactions` |
| `service_follow_ups.select` count | `src/features/agent/check-in/useCheckInSnapshot.ts:72,77` | `GET /metrics/me/check-in` |
| `refunds.update` (baixa do agente) | `src/pages/agent/Reembolsos.tsx:212`, `:267` | `POST /refunds/:id/complete` |
| `refunds.delete` | `src/pages/agent/Reembolsos.tsx:242` | `DELETE /refunds/:id` |
| `refunds.select` count | `src/features/agent/check-in/useCheckInSnapshot.ts:82,87,92,97` | `GET /metrics/me/check-in` |
| `ticket_transfers.insert` | `src/features/transfers/TransferTicketDialog.tsx` | `POST /transfers` |
| `ticket_transfers.update` (aceitar/recusar) | `src/features/transfers/NotificationsBell.tsx` | `POST /transfers/:id/accept` · `/decline` |
| `ticket_transfers.update` (marcar visto) | `src/features/transfers/NotificationsBell.tsx` | `POST /notifications/:id/seen` |
| `profiles.select` (role, capacidades) | `AgentLayout:68`, `ManagerLayout:179`, `CopyLayout:141`, `ProdutosLayout:140`, `AreaSelect:98`, `Index:21`, `Login:89`, `Workspace:163` | `GET /me` |
| `profiles.select` (nomes de agentes) | `src/pages/agent/Atendimentos.tsx:360`, `src/features/dashboard/useAgentsQuery.ts:19` | `GET /users/agents` |
| `agent_notes` (select/insert/update/delete) | `src/features/notepad/useAgentNotesQuery.ts` (4 escritas) | `/notes` (CRUD) |
| `training_video_views.upsert` | `src/features/training/useTrainingVideoViewMutation.ts:17` | `PUT /training/videos/:id/progress` |
| `training_videos.select` | feature `training` | `GET /training/videos` |
| `support_products` / `support_sms_brands` / `support_sms_replies` (select + 3 escritas) | `src/features/support-base/useSupportBaseQuery.ts` | `/support-base/*` |
| `lya_chats` / `lya_chat_messages` (2 escritas) | `src/features/lya/useLyaChats.ts`, `useLyaConversation.ts` | `/integrations/lya/chats/*` |
| `app_settings.select` (cotação) | via `usd_brl_rate()` nas RPCs de copy | `GET /settings` |
| `held_orders` escrita | `HeldOrdersManagerTab.tsx`, `AssignHeldOrdersDialog.tsx` (via RPC) | `/held-orders/*` |
| Edge Function `zendesk` (5 ações) | `supabase/functions/zendesk/index.ts` | `/integrations/zendesk/*` |
| Edge Function `lya` (3 ações + SSE) | `supabase/functions/lya/index.ts` | `/integrations/lya/*` |
| `lya_files` / `lya_file_rows` (sem migration, em produção) | fora do repositório | `/integrations/lya/files/*` |
| `external_refunds` (sem migration, em produção) | fora do repositório | `POST /refunds/external-import` + `GET /metrics/refunds/external-comparison` |
| `normalize_order_number` (sem migration, coluna gerada) | fora do repositório | função `IMMUTABLE` mantida (`12` §4.4) |

### 17.6 Regras que hoje vivem **só** no cliente — destino obrigatório

Esta é a tabela que prova que nada do browser se perde. Item sem destino é bloqueio (§8 do contrato).

| Regra | Onde vive hoje | Endpoint que passa a aplicar |
|---|---|---|
| Regra das 18h (R-INT-1, R-INT-3) | `useStatusTracking.ts:110-157` | **[D1] some dos dois lados** — nenhum endpoint valida janela. O que migra para o servidor é a **marcação** `isSameDayRepeat`, que já é do banco e permanece (R-INT-2, R-INT-4) |
| `follow_up_number = existing.length + 1` (R-INT-6) | `useStatusTracking.ts:175`, `:207` | `POST /tickets/:id/interactions` (`seq` do banco) |
| Ordem das três checagens de duplicidade (R-TKT-3…R-TKT-7) | `Atendimentos.tsx:510-535` | `POST /tickets` |
| `canSubmit` do formulário de atendimento (R-TKT-10, R-TKT-11) | `Atendimentos.tsx:482-492` | `POST /tickets` (Zod) |
| `canSave` do diálogo de edição (R-TKT-19) | `EditServiceDialog.tsx:170-176` | `PATCH /tickets/:id` (Zod) |
| Status derivado do ticket (R-TKT-24) | `useStatusTracking.ts:78-107` | `derivedStatus` materializado, entregue por `GET /tickets` |
| Contagem de interações `+1` (R-TKT-25) | `Atendimentos.tsx:275-278` | `interactionCount` materializado |
| Placeholder no badge sem follow-ups (R-TKT-26) | `Atendimentos.tsx:352-357` | deixa de ser necessário |
| Filtro "data OU interação no período" (R-MET-16) | `Atendimentos.tsx:391-430` | `GET /tickets` (`EXISTS` em `interaction_facts`) |
| Paginação de 15 no cliente | `Atendimentos.tsx:467-472` | **[D7]** `GET /tickets` por cursor — a única lista com cursor |
| Meta diária 100/150 por maioria SMS (R-MET-12) | `Atendimentos.tsx:471-476` | **[D3]** `GET /me` (`dailyGoal`, `supportChannel`), lendo `goal_policies` datada |
| Meta semanal 500/750 + alerta/advertência/risco (R-MET-31) | `DashboardAcompanhamento.tsx:33-36,148-204` | **[D3]** `GET /metrics/compliance`, com `asOf` e `policy` na resposta |
| Canal do agente por maioria SMS, 2ª cópia (R-MET-32) | `DashboardAcompanhamento.tsx:110-122` | `GET /metrics/compliance` (uma definição só) |
| Janelas do check-in (R-MET-18, R-MET-19) | `useCheckInSnapshot.ts:44-110` | `GET /metrics/me/check-in` |
| `completed` do vídeo decidido no cliente (R-TRN-6) | `useTrainingVideoViewMutation.ts:23` | `PUT /training/videos/:id/progress` |
| `last_watched_at` vindo do browser (R-TRN-2) | `useTrainingVideoViewMutation.ts:24` | idem (`now()` no servidor) |
| `managerStatus` do pedido em espera (R-HLD-19) | `HeldOrdersManagerTab.tsx` | `GET /held-orders/manager` |
| Montagem da planilha (R-EXP-3) | `src/lib/reportExport.ts` | `POST /exports/*` |
| `origin` da transferência a partir de `assignedByManagerId` (R-TRF-5) | `NotificationsBell.tsx` / histórico | `GET /transfers` (`origin`) |
| Mapa de áreas por role (R-AUTH-2, R-AUTH-3) | `src/lib/roles.ts:47-52` | `GET /me` (`areas`, `homeArea`, `roleKnown`) |
| Conclusão rápida bloqueada vs. diálogo liberado (R-INT-5) | `Atendimentos.tsx:284` vs. `StatusTrackingDialog.tsx:54` | **[D1] resolvido**: os dois passam. Não há regra a migrar — há uma regra a **remover** do browser |
| Formatação de moeda em `BRL` no modal de motivos (R-REF-23) | `RefundReasonDetailModal.tsx:35` (corrigido no legado em 26/09) | **[D4]** `{ amount, currency: "USD" }` em toda rota; o front formata a partir de `currency`, nunca de constante |
| Rótulo "Valor (R$)" na planilha (R-REF-23) | `reportExport.ts`, 4 ocorrências (corrigidas em 26/09) | **[D4]** `POST /exports/*` gera a coluna com o rótulo derivado de `currency` |
| Paginação de 15 no cliente em Reembolsos | `Reembolsos.tsx:87-99` | **[D7]** `GET /refunds` numerada, com `totalCount` |
| Derivação do percentual a partir do texto `"80%"` (R-REF-20) | `types.ts`, `CompleteRefundDialog.tsx:27-30` | **[M6]** `refundPercent` inteiro na API; o rótulo `"80%"` é formatação de tela |

---

## Lacunas

1. **RESOLVIDA por D2.** A API escreve com o token do usuário e as policies permanecem como rede, com as quatro exigências de desempenho de §8-A/D2. Desenho em `13` §4.
2. **Idempotência.** Onde a chave é guardada, por quanto tempo exatamente (24 h é do contrato, mas a partir de quê — primeira requisição ou última?), o que é gravado (corpo, status, cabeçalhos?) e o que acontece com a **mesma chave e corpo diferente** (a especificação propõe `409 IDEMPOTENCY_KEY_REUSED`).
3. **RESOLVIDA por D7.** `totalCount` é devolvido em Reembolsos (2 abas), auditoria de atendimentos, auditoria de reembolsos e detalhe de motivo. Cursor só em "Meus Atendimentos". Sobra um caso que D7 não nomeia: `GET /held-orders/manager`, que hoje mostra total e contagem de repetidas — a especificação a mantém numerada por coerência com as demais listas frias, e registra como **pendente de confirmação** (→ `90-BACKLOG.md`).
4. **Exportação.** Síncrona ou por job; formato; onde o arquivo vive; validade do link.
5. **Limites de `limit`.** 100 é o teto do contrato, mas `POST /tickets/reassign` (até 500 itens) e `POST /held-orders/import` (até 5000 linhas) são escritas em lote, não coleções. O contrato não fala de teto em corpo de lote.
6. **Rate limit.** `429` está no contrato, mas nenhum número foi definido — nem global, nem por usuário, nem específico para `/integrations/lya/chat` (que consome LLM) e `/integrations/zendesk/*` (que consome a cota de 400/min do provedor).
7. **`/products` e `/sales-platforms`.** Se produto passa a ser tabela (§19.8 de `10`, **aberto**) e a plataforma de venda também (§19.15, **novo**), faltam duas rotas de CRUD para a gestora que não estão na linha de base do §7. Especificá-las depende das duas confirmações. → `90-BACKLOG.md`
8. **Comparativo interno×externo — parcialmente resolvida.** A tabela `external_refunds` existe em produção (4.026 linhas, `30-banco-estado-real.md` §2) e **não** no repositório. A rota `POST /refunds/external-import` está especificada acima, mas o **formato de `rows`** depende de descobrir como o arquivo é carregado hoje.
9. **Quem emite os eventos de Realtime** (§4): trigger de banco, `LISTEN/NOTIFY`, ou a API depois do commit. Muda `13`.
10. **`GET /me` e cache de 60 s.** O contrato manda cachear o perfil por 60 s, o que significa que desativar um usuário demora até 60 s para bloqueá-lo. `13` §4 propõe furar o cache pelo evento de desativação. Precisa de aval.
11. **`channel`, `sales_platform` e `refund_percent`** (M4, M5, M6): o desenho está especificado, com os valores medidos em produção, mas as três dependem de confirmação do dono — inclusive se `Hotmart` e `PagAmerican` passam a aparecer no seletor e o que fazer com as 3.710 linhas que têm `Clickbank` no campo de canal. → `90-BACKLOG.md`

---

## Propostas de emenda ao contrato

> **Estado em 26/09/2026**: a emenda 2 foi **respondida** por D7 (e de forma mais ampla do que a
> trilha propôs); a 3 permanece; a 5 permanece; a 6 depende de B2 do backlog. Ficam registradas com
> o resultado.

1. **§7 — `metrics` passa de 7 para 13 rotas, e `notifications` absorve três sinos.** Motivo: `dashboard_status_summary`, `dashboard_same_day_repeats`, `dashboard_contact_reason_notes`, o comparativo interno×externo e, principalmente, a **avaliação disciplinar** (R-MET-31) não têm onde entrar nas 7 rotas sem virar `?kind=`, que o §3 proíbe. Também acrescenta `GET /metrics/me/check-in`, que substitui 8 requisições paralelas.
2. **§3 — OFFSET · RESPONDIDA por D7, com alcance maior que o pedido.** A trilha pediu exceção para coleção derivada de agregação. O dono manteve **paginação numerada com total** em quatro listas, e cursor só em "Meus Atendimentos", com um diagnóstico melhor: o custo nunca foi o `OFFSET`, foi o **predicado não indexável** que ele percorre. A §3 do contrato já está emendada nesse sentido. O que esta trilha acrescenta como cuidado de implementação: `page > totalPages` responde `400 PAGE_OUT_OF_RANGE`, nunca lista vazia, e o total é contado sobre a tabela de fatos e cacheado por combinação de filtro — sem isso, trocar de página reconta e a decisão perde o fundamento.
3. **§3 — a paginação do Zendesk é do provedor.** `page`/`perPage` com corte em 1000 resultados (R-ZEN-5). Emenda: rotas de `integrations` espelham a paginação do provedor, documentadamente.
4. **§6 — "otimismo de UI: front" precisa de um complemento.** Hoje o otimismo do follow-up depende de calcular `follow_up_number` no cliente (R-INT-6), e a medição mostrou o preço: **12.753 linhas excedentes em 180 dias** (M2). Com `seq` no banco, o front não sabe o número antes da resposta. Emenda: a resposta de `POST /tickets/:id/interactions` devolve `{ interaction, ticket }` e o front reconcilia — o otimismo passa a ser "mostra a linha sem o número" em vez de "adivinha o número". Sem essa emenda, ou o front continua adivinhando (e a duplicação volta), ou perde o otimismo na ação mais quente da tela.
5. **§3 — "nunca mais erro silencioso" tem um ponto cego.** O contrato proíbe `const { data = [] }`. Falta proibir explicitamente o **outro** silêncio: uma escrita que afeta 0 linhas devolvendo sucesso (R-TRF-10). Emenda: toda rota de escrita que não afeta nenhuma linha responde `404 NOT_FOUND` ou `409`, nunca `2xx`.
6. **SQL livre da Lya · RETIRADA, e a trilha se corrige.** Esta emenda pedia **manter** o SQL livre com alcance reduzido, argumentando que retirá-lo custaria a capacidade que diferencia a Lya dos dashboards. `01-GARANTIAS.md` G7.4 decidiu o contrário, e o argumento da garantia é melhor que o da trilha: a rota de análise aceita consulta **nomeada**, porque SQL livre exposto a usuário não tem como ser garantido — só vigiado. A especificação foi refeita (`POST /integrations/lya/query`), preservando as duas condições que a trilha havia proposto (log obrigatório, timeout de 5 s) como parte do desenho novo, não como mitigação. O que a trilha mantém como observação: o **log** é o que permite descobrir quais perguntas o catálogo não cobre, e por isso ele deveria existir **antes** do catálogo estar completo. → B2 do backlog.
