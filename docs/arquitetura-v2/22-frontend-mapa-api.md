# Frontend v2 — mapa da fronteira (tela → endpoint)

> Trilha: **frontend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Este documento é a fronteira vista do lado do consumidor: para cada tela e cada
> interação, **qual rota da linha de base** (contrato §7) ela usa, **quais campos**
> da resposta consome, **o que deixa de ser calculado no cliente**, **que cache
> invalida** depois de escrever e **que evento de tempo real** a atualiza.
>
> A trilha de backend é dona da lista de rotas. Onde falta rota, este documento
> aponta para a seção **Lacunas** — nunca inventa endpoint.
>
> Data: 26/09/2026.

> **Reconciliado com `00-CONTRATO.md` §8-A em 26/09/2026.** Decisões que mudaram este
> documento: **D1** (a regra das 18h deixa de bloquear — não existe
> `FOLLOW_UP_BLOCKED` nem `unlocksAt`), **D3** (a avaliação disciplinar vira
> `GET /metrics/compliance`), **D4** (valor monetário é `{ amount, currency }` com
> `currency` fixo em `USD`) e **D7** (paginação numerada com `totalCount` continua
> existindo em quatro das cinco listas; só "Meus Atendimentos" vai para cursor).

## Convenções

- Rotas escritas sem o prefixo: leia `GET /tickets` como `GET /api/v1/tickets`.
- `[LACUNA n]` remete ao item numerado da seção Lacunas deste arquivo.
- Campos em `camelCase`, como manda o contrato §3.
- "Invalidação" usa as chaves de cache da v2, propostas em
  `23-frontend-estrutura.md` (`["tickets","list",params]` etc.). As chaves de hoje
  aparecem na tabela de rastreabilidade.
- Canais de tempo real: `user:{userId}` e `managers` (contrato §4).

---

## 1. Sessão e cromo comum

| Interação | Rota | Parâmetros | Campos consumidos | Invalidação | Tempo real |
|---|---|---|---|---|---|
| Montar qualquer layout | `GET /me` | — | `id`, `fullName`, `role`, `capabilities.{canViewAllTickets, canRegisterDuplicateEmails, canClaimTickets, canApproveTakeovers}`, `isActive`, `areas[]`, e (novo) `supportChannel`, `dailyGoal` | — | `user:{userId}` evento `account.blocked` → limpa sessão e vai para `/blocked` |
| Login | Supabase Auth (`signInWithPassword`) — **não muda** | — | `access_token` | `GET /me` | — |
| Logout | Supabase Auth + limpar `sb-*` | — | — | limpa o cache inteiro | — |
| Presença ("quem está online") | Realtime Presence no canal `managers` | — | — | — | substitui `agent_heartbeat` |
| Trilha de auth (`login`/`logout`/`force_logout`) | `POST /me/auth-events` `[LACUNA 1]` | `{eventType, metadata}` | — | — | — |

**O que sai do cliente:** as três requisições em sequência que todo layout faz hoje
(`getSession` → `me_status` → `profiles`) viram **uma**. O `setInterval` de 30 s
desaparece; o bloqueio chega por push **e** por `403 ACCOUNT_BLOCKED` em qualquer
resposta (ver emenda 3 de `20-frontend-agente.md`).

---

## 2. Área do agente

### 2.1 `/workspace` — Atendimentos

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Cartões do dia | `GET /metrics/me` | `window=today` | `myCount`, `leaderCount`, `leaderName`, `isLeader`, **`dailyGoal`**, **`supportChannel`** |
| Contador "Total de atendimentos" do período | `GET /metrics/me` | `from`, `to` | `totalCount` |
| Tabela "Meus Atendimentos Recentes" | `GET /tickets` | `from`, `to`, `activityFrom`, `activityTo`, `hasTrackingCode`, **`cursor`** (D7: esta é a única lista do sistema que vai para cursor), `limit=15`, `includeOthers` (quando `canViewAllTickets`) | `items[]`: `id`, `clientEmail`, `serviceDate`, `createdAt`, `product`, `platform`, `channel`, `status`, `statusLabel`, **`interactionCount`**, `hasTrackingCode`, `contactReason`, `contactReasonNote`, `orderId`, `ownerId`, `ownerName`, `creatorId`, `creatorName`, `canDelete`; `nextCursor`, `hasMore`, `totalCount` |
| Busca por e-mail | `GET /tickets/lookup` | `email` (parcial) | os mesmos campos; **ignora o filtro de data**, como hoje |
| Abrir acompanhamento | `GET /tickets/:id` + `GET /tickets/:id/interactions` | `cursor`, `limit` | ticket completo (inclui `orderId`, que hoje exige um `SELECT` extra) + `items[]`: `seq`, `status`, `statusLabel`, `recordedAt`, `observation`, `authorName`, **`isSameDayRepeat`** (marcação que o banco mantém para a métrica não contar duas vezes — D1). **Sem** `nextInteractionUnlocksAt`: não há mais janela de horário |
| Criar atendimento | `POST /tickets` (`Idempotency-Key`) | `{clientEmail, product, platform, channel, hasTrackingCode, contactReason, contactReasonNote, orderId, concludeNow}` | `{outcome: "created"\|"mine"\|"otherAgent", ticket}` — **a checagem de duplicidade acontece no servidor** |
| Registrar interação | `POST /tickets/:id/interactions` (`Idempotency-Key`) | `{status, observation}` | interação criada, com `seq` **do banco**. A rota **não valida janela de horário** (D1): valida dono, permissão e status |
| Concluir rápido | mesma rota, `{status:"concluido", observation:""}` | — | idem — e sem a checagem de bloqueio que este caminho fazia e o diálogo não (D1) |
| Editar | `PATCH /tickets/:id` | `{clientEmail, product, platform, channel, contactReason, contactReasonNote, orderId}` — **`serviceDate` nunca é enviado** | ticket atualizado |
| Excluir | `DELETE /tickets/:id` | — | — |
| Assumir ticket | `POST /tickets/:id/claim` | — | ticket, já como meu |
| Encaminhar | `POST /transfers` | `{ticketId, message}` | transferência criada |
| Pedir aprovação (dono de folga) | `POST /takeovers` | `{ticketId, note}` | pedido criado |
| Exportar planilha | `POST /exports/agent-tickets` | `{from, to}` | `{url}` ou o arquivo — **`xlsx` sai do cliente** |

**Invalidação depois de escrever:**

| Escrita | Invalida |
|---|---|
| criar ticket | `tickets.list`, `metrics.me`, e `refunds.list` **quando o motivo é reembolso** (o servidor cria o reembolso) |
| criar interação | `tickets.list`, `tickets.detail(id)`, `tickets.interactions(id)`, `metrics.me` |
| editar ticket | `tickets.list`, `tickets.detail(id)`, `refunds.list` (a edição pode criar/atualizar o reembolso vinculado) |
| excluir ticket | `tickets.list`, `metrics.me` |
| assumir ticket | `tickets.list`, `tickets.detail(id)` |
| encaminhar | `transfers.list` |
| pedir aprovação | `takeovers.list` |

**Tempo real:** `user:{userId}` com `ticket.assigned` (redistribuição da gestora ou
aprovação de tomada) → invalida `tickets.list`; `transfer.received` e
`transfer.answered` → `notifications`; `takeover.decided` → `tickets.list` +
`notifications`.

**Otimismo mantido:** o ticket recém-criado entra no topo da lista antes do refetch,
e a interação nova entra no histórico antes da resposta — as duas coisas existem
porque o refetch demorava segundos e o agente achava que não salvou. Na v2 o
otimismo é do front (§6), mas a linha otimista **não fabrica `seq`**: mostra um
marcador de "gravando" até a resposta trazer o número real.

### 2.2 `/workspace/reembolsos`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Aba "Em Aberto" | `GET /refunds` | `status=open`, `q`, `requestedFrom`, `requestedTo`, **`page`**, `limit=15` (D7: numerada, com total) | `items[]`: `id`, `customerEmail`, `requestDate`, `salesPlatform`, `product`, `orderId`, `channel`, `ticketId`, `pickedUpAt`; `totalCount`, `pageCount` |
| Aba "Histórico/Concluídos" | `GET /refunds` | `status=done`, `q`, `completedFrom`, `completedTo`, `page`, … | + `completionDate`, `refundType`, `refundedValue` como **`{ amount, currency }`** com `currency: "USD"` (D4), `reason`, `itemsReturned`; e **`totalRefundedValue`** do recorte, na mesma forma |
| Novo reembolso | `POST /refunds` (`Idempotency-Key`) | `{customerEmail, requestDate, salesPlatform, orderId, product, channel}` | reembolso criado |
| Assumir | `POST /refunds/:id/pickup` | — | reembolso com `pickedUpAt` |
| Concluir | `POST /refunds/:id/complete` | `{completionDate, refundValue, refundType, reason, itemsReturned}` | reembolso concluído |
| Editar concluído | `PATCH /refunds/:id` | os mesmos campos | reembolso atualizado |
| Excluir | `DELETE /refunds/:id` | — | — |

Invalidação: todas as escritas invalidam `refunds.list` e `metrics.me` (a métrica do
agente tem contadores de reembolso).
Tempo real: `user:{userId}` `refund.created` (quando nasce de um atendimento) →
`refunds.list`; `refund.overdue` → o alerta de 24 h.

**Alerta de 24 h:** `GET /refunds?overdue=true` ou `GET /notifications`
(`[LACUNA 4]` de `20-frontend-agente.md`) — hoje a regra das 24 h é filtro no
cliente sobre a lista inteira.

### 2.3 `/workspace/metricas`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| tudo | `GET /metrics/me` | `from`, `to` | `totalCount`, `newServices`, `followUps`, `bestDay`, `bestDayCount`, `trendPct`, `trendLabel`, `trendReliable`, `periodDays`, `activeDays`, `daysRemaining`, `myRate`, `teamMedianRate`, `teamMedianTotal`, `teamSize`, `teamLeaderRate`, `teamLeaderName`, `teamLeaderCount`, `isLeader`, `gapPerDay`, `gapToMedianPct`, `isBelowTeamRate`, `byDay[]{day,value,services,followups}`, `byChannel[]`, `byPlatform[]`, `byProduct[]`, `refundsOpen`, `refundsDone`, `refundsTotalValue` |

Não escreve nada. Sem invalidação e sem evento.
Os campos legados que a tela hoje ignora (`avgDaily`, `totalInteractions` como alias
de `totalCount`, `teamAverage`, `gapToAvgPct`, `isBelowTeamAvg20pct`, `benchmarkName`,
`benchmarkCount`) **não** precisam existir na v2 — ver "Propostas de emenda".

### 2.4 `/workspace/transferencias`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Aba "A resolver" | `GET /transfers?role=received&state=to-resolve` `[LACUNA 2]` | `cursor`, `limit` | `items[]`: `transferId`, `ticketId`, `clientEmail`, `product`, `receivedAt`, `fromAgentName`, `assignedByManager` (booleano), `ticketStatus`, `hasTrackingCode` — **já desduplicado por ticket e já filtrando ticket concluído** |
| Aba "Histórico" | `GET /transfers` | `role`, `status`, `q`, `cursor`, `limit` | + `transferStatus`, `message`, `responseNote`, `otherAgentName`, `respondedAt`; `totalCount` |
| Abrir acompanhamento | `GET /tickets/:id` + interações | — | igual a 2.1 |

Tempo real: `user:{userId}` `transfer.received` / `transfer.answered` →
`transfers.list`.

### 2.5 `/workspace/radar`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Lista + cartões | `GET /radar` | `bucket`, `kind`, `status`, `q`, `cursor`, `limit` | `items[]`: `id`, `clientEmail`, `orderNumber`, `product`, `kind`, `actionNeeded`, `status`, `nextFollowUpDate`, `notes`, `createdAt`, `agentName`, `eventCount`, `lastAction`, `lastActionAt`, `daysOverdue`, `isOverdue`, `isDueToday`, `closedAt`; `summary{open,overdue,dueToday,dueWeek,resolved,cancelled}`; **`today`** (dia-SP do servidor) |
| Badge da sidebar | `GET /radar/summary` | — | `{open, overdue, dueToday}` |
| Timeline de um caso | `GET /radar/:id/events` `[LACUNA 5 de 20-]` | — | `items[]`: `status`, `action`, `nextFollowUpDate`, `recordedAt`, `userName` |
| Novo caso | `POST /radar` (`Idempotency-Key`) | `{clientEmail, kind, actionNeeded, nextFollowUpDate, orderNumber, product, notes}` | caso criado |
| Corrigir cadastro | `PATCH /radar/:id` | os mesmos campos **menos** status e data | caso atualizado |
| Registrar ação | `POST /radar/:id/actions` | `{status, action, nextFollowUpDate}` (nula quando o status fecha) | caso + evento |
| Excluir | `DELETE /radar/:id` | — | — |
| Exportar | `POST /exports/radar` | os mesmos filtros da tela | `{url}` |

Invalidação: toda escrita invalida `radar.list`, `radar.summary` e
`radar.events(id)`.
Tempo real: nenhum hoje, nenhum necessário — o Radar é do próprio agente. O badge
atualiza por invalidação, como já faz.

**`today` do servidor é obrigatório:** o rótulo de prazo ("Atrasado 3 dias", "Hoje",
"Amanhã") é calculado contra ele, não contra o relógio do navegador. Isso já é
assim e o contrato §5 confirma.

### 2.6 `/workspace/pedidos-espera`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Lista | `GET /held-orders` | `status`, `reason`, `pendingTag`, `cursor`, `limit` | `items[]`: `id`, `orderNumber`, `dynaCode`, `rma`, `reason`, `orderDate`, `age`, `customerName`, `email`, `items`, `address*`, `restockedItems`, `damagedItems`, `comments`, `agentStatus`, `pendingTag`, `eventCount`; `facets.reasons[]{key,label,count}`, `facets.pendingTags[]` `[LACUNA 4 de 21-]` |
| Métricas do dia | `GET /metrics/me?scope=held-orders` | — | `{confirmedToday, pending, goal}` |
| Timeline | `GET /held-orders/:id/events` | — | `items[]`: `status`, `pendingTag`, `recordedAt`, `userName`, `note` |
| Registrar | `POST /held-orders/:id/status` | `{status, note, pendingTag}` | pedido atualizado |

Invalidação: `heldOrders.list`, `heldOrders.metrics`, `heldOrders.events(id)`.
Tempo real: `user:{userId}` `held-order.assigned` (a gestora distribuiu) →
`heldOrders.list` + `heldOrders.metrics`.

### 2.7 `/workspace/base-suporte`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Produtos (E-mail) | `GET /support-base/products` | `activeOnly=true` | `nome`, `funcao`, `url`, `estrutura`, `plataforma`, `bonusUrl`, `bonusTipo`, `nicho`, `smsNumber`, `links[]{label,url}` |
| Produtos (SMS) | `GET /support-base/sms-brands` | idem | `nome`, `sistema`, `estrutura`, `smsNumber` |
| Respostas SMS | `GET /support-base/sms-replies` | idem | `categoria`, `titulo`, `textoEn`, `textoPt` |
| E-mails Clickbank | fixo no bundle **ou** `GET /support-base/email-templates` `[LACUNA 11 de 20-]` | — | — |
| Playbook de reembolso | fixo no bundle **ou** rota equivalente | — | — |

Nenhuma escrita (a escrita é da gestora). Cache longo (o conteúdo é editorial:
`staleTime` de 5 min hoje). Tempo real: nenhum; a gestora publica e o agente pega no
próximo carregamento — **é o comportamento de hoje e serve**.

A aba selecionada continua no parâmetro de URL `?aba=produtos|sms|respostas|emails|reembolso`.
`[MANTER]` — são links salvos pelo time.

### 2.8 `/workspace/comece-aqui`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Prateleiras | `GET /training/videos` | — | `videos[]`: `id`, `section`, `title`, `description`, `videoUrl`, `thumbnailUrl`, `durationSeconds`, `displayOrder`, `watchedSeconds`, `completed`, `progressPct`; e o agrupamento por seção |
| Gravar progresso | `POST /training/videos/:id/progress` | `{watchedSeconds, completed}` | — |

Invalidação: `training.videos`. Tempo real: nenhum.

### 2.9 Caderno do agente (em todas as telas)

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Página (dia/semana/mês) | `GET /notes` | `from`, `to` | `items[]`: `id`, `noteDate`, `body`, `kind`, `done`, `pinned`, `createdAt`, `updatedAt` |
| Pendências abertas (badge + faixa de atrasadas) | `GET /notes?state=open-tasks` `[LACUNA 7 de 20-]` | — | os mesmos campos |
| Busca | `GET /notes?q=` | `q` (mín. 2 caracteres) | idem |
| Criar | `POST /notes` | `{body, kind, noteDate}` | nota criada |
| Editar / concluir / fixar / trocar tipo / mover de dia | `PATCH /notes/:id` | campo alterado | nota atualizada |
| Excluir | `DELETE /notes/:id` | — | — |
| **Desfazer a exclusão** | `POST /notes` com o corpo da nota apagada `[LACUNA 7 de 20-]` | — | nota recriada |

Invalidação: qualquer escrita invalida `notes.*` (as três variações). Otimismo com
snapshot/rollback, como hoje. Tempo real: nenhum — o caderno é pessoal.

---

## 3. Área da gestora

### 3.1 `/dashboard` — Atendimentos

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| KPIs + gráficos | `GET /metrics/dashboard` | `from`, `to`, `agentId`, `includeTestAccounts=false` | `totalCount`, **`dailyAverage`**, `byAgent[]`, `byProduct[]`, `byPlatform[]`, `byChannel[]`, `byDay[]`, e **`benchmark{leaderId, leaderName, leaderCount, gapPct}`** (dispensa a 2ª chamada) |
| Tendência temporal | mesmo endpoint, bloco `trend` | `movingWindow=15`, `forecastDays=7` | `trend{slope, intercept, r2, quality, verdict, movingAverage[], forecast[]}` |
| Padrão de horários | `GET /metrics/hourly` | `from`, `to`, `agentId` | `byDowHour[]` (168 células), `peak{hour,dowName,count}`, `shift{startHour,endHour}`, `goalHit{hour,daysHit,totalActiveDays,threshold}`, `shiftsShare{morning,afternoon,evening,night}` |
| Auditoria | `GET /audit` | `from`, `to`, `agentId`, **`page`**, `limit=10` (D7: numerada, com total) | `items[]`: `occurredAt`, `kind`, `seq`, `agentName`, `clientEmail`, `product`, `platform`, `channel`; `totalCount`, `pageCount` |
| Modal de canal | `GET /metrics/channels` | `from`, `to`, `agentId` | `rows[]`: `channel`, `agentId`, `agentName`, `newTickets`, `interactions`, `done`, `total`, `rate`; e os três resumos (`total`, `mostActive`, `bestRate`) |

Não escreve. Tempo real: canal `managers`, evento `metrics.stale` (com o dia
afetado) → invalida `metrics.dashboard` e `audit` — **substitui os 15 s de polling**.

### 3.2 `/dashboard/reembolsos`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| KPIs + gráficos | `GET /metrics/refunds` | `from`, `to`, `agentId`, `status`, `refundType`, `product` | `totalCount`, `openCount`, `doneCount`, **`completionRate`**, `byAgent[]`, `byStatus[]`, `byChannel[]`, `byProduct[]`, `byRefundType[]` (**já ordenado por percentual**), `byPlatform[]` (+ total), `byReason[]` (+ total e share), `byChannelEfficiency[]`, `channelEfficiencyTotal`, e **`facets{refundTypes[], products[]}`** |
| Auditoria | `GET /audit?scope=refunds` | + **`page`**, `limit=10` (D7) | `items[]` com `statusLabel` **já resolvido** pelo servidor; `totalCount`, `pageCount` |
| Detalhe de um motivo | `GET /metrics/refunds/reasons/:category` | os mesmos filtros + **`page`**, `limit=50` (D7) | `items[]`: `requestDate`, `completionDate`, `agentName`, `customerEmail`, `product`, `store`, `orderId`, `channel`, `refundType`, `value{amount,currency}` com `currency: "USD"` (D4), `originalReason`; `totalCount`, `pageCount` |
| Exportar o detalhe | `POST /exports/refund-reason-detail` | categoria + os mesmos filtros | `{url}` — **o conjunto inteiro, não a página** |

Tempo real: `managers` `refund.changed` → invalida `metrics.refunds` e `audit`.

### 3.3 `/dashboard/acompanhamento`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| tudo | `GET /metrics/compliance` `[DECIDIDO — D3]` | `weeks=8` | `rules{effectiveFrom, escalation, byChannel}`; `weeks[]{from,to,label}`; `agents[]`: `agentId`, `agentName`, `channel`, `weeklyGoal`, `byWeek[]{count,status,statusLabel}`, `accumulatedAlerts`, `totalWarnings`, `contractRisk`, `situation`. Formato completo em `21-frontend-outras-areas.md` §4.4 |

Não escreve. Sem tempo real (é apuração semanal), `staleTime` de 5 min. **Esta é a
rota que substitui as 8 chamadas de `dashboard_metrics` + o `SELECT` em `services` +
o motor de regras no navegador.**

Os textos das regras continuam no front (contrato §6), mas os **números** das faixas
vêm em `rules` para não divergirem do que o servidor aplicou — e `rules.effectiveFrom`
é o que permite responder "qual era a meta em agosto" (D3).

### 3.4 `/dashboard/interacoes`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| tudo | `GET /metrics/follow-ups` | `from`, `to`, **`agentId`** | `kpi{totalServices, newTicketsCount, interactionsCount, doneCount, interactionsPerTicket}` **já filtrado pelo agente**; `byAgent[]` com `openInRange`/`interactions`/`done`/`totalTickets`/`completionRate`/`avgInteractionsToClose`; `statusDistribution[]` (as 3 fatias **já com "Novos em aberto" descontado**); `recentFollowUps[]` com **`agentId`** (hoje só vem o nome); `insights{highlight, mostNewTickets, mostProductive}` |

Não escreve. Tempo real: `managers` `metrics.stale`.

Três cálculos saem do cliente: o recálculo do KPI por agente, a subtração
`newTickets − done` das fatias, e o **join por nome** de `recentFollowUps`
(que hoje quebra com homônimo).

### 3.5 `/dashboard/alertas`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Lista | `GET /refunds?overdue=true&groupBy=agent` `[LACUNA 10 de 21-]` | `q`, `agentId` | `totalOverdue`, `agentsAffected`, `byAgent[]{agentId, agentName, overdueCount, refunds[]{id, customerEmail, salesPlatform, product, orderId, channel, requestDate, daysOverdue}}`; e `facets.agents[]` |
| Badge da sidebar | o mesmo, ou `GET /notifications?type=refund-overdue` | — | `totalOverdue` |
| Dar baixa em nome do agente | `POST /refunds/:id/complete` com `onBehalfOf` | `{completionDate, refundValue, refundType, reason, itemsReturned}` | reembolso concluído, com `completedByUserId` |

Invalidação: `refunds.overdue` **e** `metrics.refunds` (é o que o otimismo de hoje já
faz). Tempo real: `managers` `refund.overdue` → substitui o polling de 60 s.

### 3.6 `/dashboard/usuarios`

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Lista | `GET /users` | — (lista pequena; filtro no cliente é aceitável aqui) | `items[]`: `id`, `fullName`, `email`, `role`, `isActive`, `isAvailable`, `isOnline`, `lastSeenAt`, `lastLoginAt`, `lastLogoutAt`, `authAccountDeleted`, `deletedAt`, `deletedByEmail`, `openTicketsCount`, `authorizedOpenCount` |
| Alternar ativo | `PATCH /users/:id` | `{isActive}` | usuário atualizado |
| Alternar folga | `PATCH /users/:id` | `{isAvailable}` | idem |
| Excluir conta de login | `DELETE /users/:id` | `{confirmEmail}` — **a API revalida a confirmação** | — |
| Tickets em aberto de um agente | `GET /users/:id/open-tickets` `[LACUNA 7 de 21-]` | `cursor`, `limit` | `items[]`: `serviceId`, `clientEmail`, `product`, `serviceDate`, `effectiveStatus`, `followUpCount` |
| Redistribuir | `POST /tickets/reassign` `[LACUNA 7 de 21-]` | `{assignments:[{ticketId, toUserId}]}` | `{moved, skipped}` |

Invalidação: `users.list`; a redistribuição também invalida
`users.openTickets`, **`tickets.list`** (do agente), `transfers.*` e
`notifications`. Tempo real: presença no canal `managers` atualiza `isOnline` **sem
requisição** — é o que substitui o polling de 15 s.

### 3.7 `/dashboard/usuarios` → Pedidos em Espera

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| Lista | `GET /held-orders?scope=manager` | `status`, `agentId`, `q`, `product`, `includeDuplicates`, `cursor`, `limit` | `items[]` (+ `assignedTo`, `assignedToName`, `duplicateOf`, `distributions`, `confirmedAt`, `sourceFile`, `importedAt`); `summaryByAgent[]`; `totals{all, waiting, inProgress, confirmed, unassigned}`; `facets.products[]{key,label,count}` |
| Importar | `POST /held-orders/import` (`Idempotency-Key`) | arquivo (multipart) **ou** `{rows}` | `{inserted, duplicates[], emptyRows}` — é o que alimenta o texto do toast |
| Distribuir | `POST /held-orders/distribute` | `{orderIds, agentIds}` | `{moved, perAgent[]{agentId,count}, keptWithExistingAgent, sameCustomerCarried}` |
| Exportar | `POST /exports/held-orders` | **os mesmos filtros da tela** | `{url}` |

Invalidação: `heldOrders.list` (escopo gestora) e, quando distribui, também o escopo
do agente. Tempo real: `managers` `held-order.imported` / `held-order.distributed`.

**O parsing do CSV/XLSX passa para o servidor.** Os dois mapas de coluna
(`On_Holds_Details` e `Returned Shipments`) estão transcritos em
`21-frontend-outras-areas.md` §10.4 e são contrato com o fornecedor do arquivo.

### 3.8 `/dashboard/base` — Base de Suporte (escrita)

| Interação | Rota | Parâmetros |
|---|---|---|
| Listar (incluindo inativos) | `GET /support-base/{products\|sms-brands\|sms-replies}` | `activeOnly=false` |
| Criar | `POST /support-base/{coleção}` | o objeto |
| Editar | `PATCH /support-base/{coleção}/:id` | campos alterados |
| Excluir | `DELETE /support-base/{coleção}/:id` | — |

Invalidação: a chave base da coleção — que na v2 atinge as duas variantes
(`activeOnly` true/false), como hoje. Tempo real: nenhum.

**Conflito de nome único precisa de código próprio** (`409 DUPLICATE_NAME`): hoje o
front procura `support_products_nome_uniq` **dentro da mensagem do Postgres** para
escrever "Já existe um produto com esse nome." `[LACUNA 11 de 21-]`

### 3.9 `/dashboard/zendesk` e a Lya

| Interação | Rota | Parâmetros |
|---|---|---|
| Status da integração | `GET /integrations/zendesk/status` | `from`, `to` |
| Tickets | `GET /integrations/zendesk/tickets` | `status`, `groupId`, `q`, `from`, `to`, `page`, `perPage=25` — **paginação por página, não keyset** (é a do Zendesk) `[LACUNA 12 de 21-]` |
| Um ticket | `GET /integrations/zendesk/tickets/:id` | — |
| Grupos | `GET /integrations/zendesk/groups` | — |
| Chat da Lya | `POST /integrations/lya/chat` — **SSE**, fora do envelope do §3 `[LACUNA 13 de 21-]` | `{pergunta, contexto, conversaId}` |
| Histórico da Lya | `GET /integrations/lya/chats`, `GET /integrations/lya/chats/:id`, `PUT`, `DELETE` | — |
| Memórias (cérebro) | `GET /integrations/lya/memories`, `POST`, `DELETE /:id`, `DELETE ?seed=true` | — |

O token do Zendesk e a chave da IA **nunca** chegam ao browser — é assim hoje
(Edge Functions) e continua assim.

### 3.10 Sino de aprovação da gestora

| Interação | Rota | Parâmetros |
|---|---|---|
| Lista | `GET /takeovers?status=pending` | — |
| Autorizar | `POST /takeovers/:id/approve` | — |
| Recusar | `POST /takeovers/:id/reject` | `{note}` (máx. 300) |

Invalidação: `takeovers.list` e `users.list`. Tempo real: `managers`
`takeover.requested` → **substitui o polling de 30 s** e é o que dispara o som.

---

## 4. Copy e Produtos

| Interação | Rota | Parâmetros | Campos consumidos |
|---|---|---|---|
| `/copy` | `GET /copy-analytics/refund-reasons` | `from`, `to`, `product`, `platform`, `channel` | `kpi{doneCount, deltaPrev, refundedValue, valueShare, avgOrderTicket, retentionPct, declaredReasonPct, withoutReasonCount, medianDaysToClose, openCount}`; `reasons[]{category, n, share, deltaPp, refundedValue, valuePct, daysToClose}`; `reasonMonthly[]{month, category, share, n}`; `byProduct[]`; `byPlatform[]`; `byChannel[]`; `reasonByProduct[]{product, category, n, shareInProduct, baselineShare, lift}`; **`filters{products[], platforms[], channels[]}`**; **`copySignals[]`** já filtrado por `n >= 8` e `lift >= 1.3` |
| Evidência de um motivo | `GET /copy-analytics/refund-reasons/:category/evidence` | os mesmos filtros + `maxRows=25` | `counts{total, withText, handwritten}`; `texts[]{text, isStandardLabel, n, share}`; `words[]{word, n, share}`; `byProduct[]`; `byChannel[]` |
| `/produtos` | **nenhuma** | — | tela em branco de propósito |

Não escreve. Sem tempo real (`staleTime` de 5 min é suficiente e já é o que existe).
A resposta da evidência **não pode** trazer e-mail, número de pedido nem nome de
agente — é regra de privacidade declarada na própria tela.

---

## 5. Estado que hoje é derivado no cliente e passa a vir pronto

Caso a caso, como pedido. "Onde está hoje" aponta o arquivo; "o que passa a vir"
aponta o campo da resposta.

| # | Derivação no cliente hoje | Onde está | Passa a vir como | Rota |
|---|---|---|---|---|
| 1 | **Status do ticket a partir do histórico** de follow-ups (`getCurrentStatus`, incluindo o rótulo "Em Andamento {N}") | `src/features/services/useStatusTracking.ts` | `status` + `statusLabel` materializados no ticket | `GET /tickets`, `GET /tickets/:id` |
| 2 | **Renomear "Em Aberto" → "Novo"** só na área do agente (`getAgentStatus`) | `src/pages/agent/Atendimentos.tsx` | fica no front: é texto de interface (§6). O servidor manda o código, o front escolhe a palavra | — |
| 3 | **Contagem de interações** (`follow-ups + 1`) | `Atendimentos.tsx` (`getInteractionCount`) | `interactionCount` | `GET /tickets` |
| 4 | **`follow_up_number`** calculado como `existentes + 1` antes do INSERT | `useStatusTracking.ts` | `seq` gerado pelo banco (contrato §6) | resposta de `POST /tickets/:id/interactions` |
| 5 | **Regra das 18h** (`canAddInteraction`, com a exceção de `has_tracking_code`) | `useStatusTracking.ts` | **deixa de existir** `[DECIDIDO — D1]`: nem no cliente, nem no servidor. Sai o aviso, sai o toast, sai o estado desabilitado. O que fica é a marcação `isSameDayRepeat`, que o banco mantém para a métrica não contar a conversa duas vezes | — |
| 6 | **Duplicidade cross-agent** e a decisão entre "é meu" / "é de outro" / "posso duplicar" | `Atendimentos.tsx` (`createMutation`) | `{outcome}` na resposta da criação, e `GET /tickets/lookup` para a busca | `POST /tickets`, `GET /tickets/lookup` |
| 7 | **Dono de folga** (`current_owner_is_available`) para escolher entre Encaminhar e Pedir aprovação | `TransferTicketDialog.tsx` | `ownerIsAvailable` no resultado da busca | `GET /tickets/lookup` |
| 8 | **Maioria SMS/e-mail** (`supportChannel`) contada sobre os 30 dias carregados | `Atendimentos.tsx` | `supportChannel` | `GET /me`, `GET /metrics/me` |
| 9 | **Meta diária** (150 SMS / 100 e-mail) | `Atendimentos.tsx` | `dailyGoal` | `GET /metrics/me` |
| 10 | **Atribuição da interação ao dia em que foi feita** (`followUpServiceIds`, varrendo todos os follow-ups e formatando em fuso SP) | `Atendimentos.tsx` | parâmetros `activityFrom`/`activityTo` na listagem | `GET /tickets` |
| 11 | **Total de atendimentos do período** trocando de fonte quando há busca ou filtro de rastreio | `Atendimentos.tsx` | `totalCount` sob os mesmos filtros, sempre da mesma fonte | `GET /tickets` |
| 12 | **Filtro por e-mail, por rastreio e por data** em memória | `Atendimentos.tsx` | parâmetros de rota | `GET /tickets` |
| 13 | **Paginação de 15 em memória** (com no máximo 7 links numéricos) | `Atendimentos.tsx`, `Reembolsos.tsx` | `[DECIDIDO — D7]` **"Meus Atendimentos" vai para cursor** (lista quente, aberta o dia todo, o agente navega pelo começo); **Reembolsos mantém número de página e total**. A paginação passa a ser do servidor nos dois casos | `GET /tickets` (cursor), `GET /refunds` (`page`) |
| 14 | **Regra das 24 h** do alerta de reembolso | `PendingRefundsAlert.tsx` | `overdue=true` (lista pronta) | `GET /refunds` |
| 15 | **Soma "Total reembolsado"** das linhas filtradas | `Reembolsos.tsx` | `totalRefundedValue` do recorte | `GET /refunds` |
| 16 | **Separar aberto/concluído** e paginar cada aba | `Reembolsos.tsx` | `status=open\|done` | `GET /refunds` |
| 17 | **Snapshot do check-in** — 8 `count` paralelos em 3 tabelas, 2 janelas | `useCheckInSnapshot.ts` | um objeto com `recent{…}` e `today{…}` | `GET /metrics/me?window=checkin` |
| 18 | **Recortes do Radar** (`matchesBucket`) e busca em `notes` | `Radar.tsx` | `bucket` + `q` | `GET /radar` |
| 19 | **Rótulo de prazo** relativo a `today` | `radar/nextFollowUp.ts` | fica no front, mas com o `today` do servidor (já é assim) | `GET /radar` |
| 20 | **Facetas de motivo e de pendência** dos Pedidos em Espera, montadas dos dados carregados | `PedidosEspera.tsx` | `facets` na resposta | `GET /held-orders` |
| 21 | **Fila "A resolver"** das transferências: filtrar aceitas, checar status efetivo por follow-up e desduplicar por ticket | `Transferencias.tsx` | lista pronta | `GET /transfers?state=to-resolve` |
| 22 | **Média diária** do dashboard (`total / dias`) | `Dashboard.tsx` | `dailyAverage` | `GET /metrics/dashboard` |
| 23 | **Distância do líder** (2ª chamada de métricas + `gap`) | `Dashboard.tsx` | `benchmark{…}` na mesma resposta | `GET /metrics/dashboard` |
| 24 | **Esconder contas de teste por nome** (`"geovani"`, `"agente teste"`) | `Dashboard.tsx` | `includeTestAccounts` + flag no perfil | `GET /metrics/dashboard` |
| 25 | **% de cada fatia** do donut de produtos | `Dashboard.tsx` | `share` por item | `GET /metrics/dashboard` |
| 26 | **Regressão linear, R², média móvel e projeção** | `TendenciaTemporal.tsx` | bloco `trend{…}` | `GET /metrics/dashboard` |
| 27 | **Matriz 7×24, turnos e insights** de horário | `PadraoHorarios.tsx` | `byDowHour`, `peak`, `shift`, `goalHit`, `shiftsShare` (as **frases** continuam no front) | `GET /metrics/hourly` |
| 28 | **Taxa de conclusão** de reembolsos | `DashboardRefunds.tsx` | `completionRate` | `GET /metrics/refunds` |
| 29 | **Opções dos filtros** de tipo e produto, deduplicadas do resultado | `DashboardRefunds.tsx` | `facets` | `GET /metrics/refunds` |
| 30 | **Ordenar tipos por percentual** (`parseFloat("25%")`) | `DashboardRefunds.tsx` | ordenação fixa na rota | `GET /metrics/refunds` |
| 31 | **Total e % por plataforma / por motivo** | `DashboardRefunds.tsx` | totais e `share` por item | `GET /metrics/refunds` |
| 32 | **Status "Concluído/Em aberto"** derivado de `completion_date` na auditoria | `DashboardRefunds.tsx` | `statusLabel` (código + rótulo) | `GET /audit?scope=refunds` |
| 33 | **Todo o motor do Acompanhamento** (canal dominante, metas, faixas, escalonamento, risco de contrato) | `DashboardAcompanhamento.tsx` | a resposta inteira, com `rules` datado `[DECIDIDO — D3]` | `GET /metrics/compliance` |
| 34 | **KPI recalculado por agente** e as 3 fatias com `newTickets − done` | `DashboardInteracoes.tsx` | `kpi` filtrado + `statusDistribution` | `GET /metrics/follow-ups` |
| 35 | **Join por nome** para filtrar as interações recentes por agente | `DashboardInteracoes.tsx` | `agentId` em `recentFollowUps` | `GET /metrics/follow-ups` |
| 36 | **Ordenação por taxa de conclusão** com os zerados no fim | `DashboardInteracoes.tsx` | ordenação na rota (ou mantida no front — é ordenação de exibição) `[DECISÃO]` | `GET /metrics/follow-ups` |
| 37 | **Três resumos do modal de canal** (total, mais ativo, melhor taxa) | `ChannelDetailModal.tsx` | campos de resumo | `GET /metrics/channels` |
| 38 | **Pivot canal × agente** | `ChannelDetailModal.tsx` | `rows[]` já no formato longo (é o que vem) — o pivot é de apresentação e **fica no front** | — |
| 39 | **Quatro contadores de usuários** | `DashboardUsers.tsx` | contadores na resposta, ou mantidos no cliente (lista pequena) `[DECISÃO]` | `GET /users` |
| 40 | **Cinco contadores e o select de produto** dos Pedidos em Espera | `HeldOrdersManagerTab.tsx` | `totals` + `facets` | `GET /held-orders?scope=manager` |
| 41 | **Prévia do rateio** da distribuição (round-robin) | `AssignHeldOrdersDialog.tsx` | fica no front (é prévia, não decisão) — o resultado real vem na resposta | `POST /held-orders/distribute` |
| 42 | **Dedupe de cliente** para contar "M cliente(s)" na distribuição | `HeldOrdersManagerTab.tsx` | `customerCount` na resposta da listagem | `GET /held-orders?scope=manager` |
| 43 | **Destinos elegíveis** da redistribuição (`is_active && role=agent && != origem`) | `ReassignTicketsDialog.tsx` | `GET /users?eligibleForReassign=…` ou filtro no cliente `[DECISÃO]` | `GET /users` |
| 44 | **Sinais de copy** (filtro `n>=8`, `lift>=1.3`, ordenação, top 12) | `CopyMotivos.tsx` | `copySignals[]` | `GET /copy-analytics/refund-reasons` |
| 45 | **Escala compartilhada do small multiples** (`ceil((max+5)/10)*10`) e Δ p.p. por painel | `MixEvolutionPanels` | fica no front: é escala de gráfico | — |
| 46 | **Top 12 produtos** e a escala das `ShareBar` | `CopyMotivos.tsx` | `limit` na rota; a escala fica no front | `GET /copy-analytics/refund-reasons` |
| 47 | **Ticker do Cérebro da Lya** (7 números derivados da lista de memórias) | `LyaCerebroTicker.tsx` | resumo na resposta de memórias | `GET /integrations/lya/memories` |
| 48 | **Contagem "9+"**, tempo relativo, singular/plural, formatação de data, moeda e número | vários | **fica no front** (§6) | — |

---

## 6. Rastreabilidade — cada chamada de hoje e quem passa a atendê-la

Toda linha tem destino. Onde a linha de base (contrato §7) não cobre, o destino
aponta o item de **Lacunas** correspondente — não há linha vazia.

### 6.1 RPCs (`supabase.rpc`)

| RPC de hoje | Arquivo | Endpoint v2 |
|---|---|---|
| `me_status` | `lib/userSession.ts` | `GET /me` (campo `isActive`) + `403 ACCOUNT_BLOCKED` |
| `agent_heartbeat` | `lib/userSession.ts` | Realtime Presence (canal `managers`) — sem rota |
| `record_auth_event` | `lib/userSession.ts` | `POST /me/auth-events` `[LACUNA 1]` |
| `agent_daily_metrics` | `features/agent/useAgentDailyMetricsQuery.ts` | `GET /metrics/me?window=today` |
| `agent_my_metrics` | `features/agent/useMyAgentMetricsQuery.ts` | `GET /metrics/me?from&to` |
| `agent_metrics_range` | `features/agent/useMyMetricsRangeQuery.ts` | **sem consumidor** — hook órfão; ver "Propostas de remoção" |
| `agent_product_mix` | `features/agent/useMyProductMixQuery.ts` | **sem consumidor** — hook órfão; idem |
| `my_recent_services` | `features/services/useMyServicesQuery.ts` | `GET /tickets` |
| `my_follow_ups` | `features/services/useStatusTracking.ts` | **deixa de existir**: `status` e `interactionCount` vêm no ticket; o histórico vem de `GET /tickets/:id/interactions`. Com **D1** ela também perde o último motivo de existir, que era alimentar a checagem das 18h no cliente |
| `find_ticket_by_email` | `pages/agent/Atendimentos.tsx` | `GET /tickets/lookup` (e o desfecho de `POST /tickets`) |
| `claim_ticket` | `pages/agent/Atendimentos.tsx` | `POST /tickets/:id/claim` |
| `request_ticket_takeover` | `pages/agent/Atendimentos.tsx` | `POST /takeovers` |
| `my_transfer_history` | `features/transfers/useTransferHistoryQuery.ts` | `GET /transfers` (+ `state=to-resolve`, `[LACUNA 2]`) |
| `my_transfer_notifications` | `features/transfers/useTransferNotificationsQuery.ts` | `GET /notifications` |
| `my_refunds_with_refunded_value` | `features/refunds/useMyRefundsQuery.ts` | `GET /refunds` |
| `create_refund` | `pages/agent/Reembolsos.tsx` | `POST /refunds` |
| `pick_up_refund` | `pages/agent/Reembolsos.tsx` | `POST /refunds/:id/pickup` |
| `my_radar_items` | `features/radar/useMyRadarQuery.ts` | `GET /radar` |
| `my_radar_summary` | `features/radar/useMyRadarQuery.ts` | `GET /radar/summary` |
| `radar_item_events` | `features/radar/useMyRadarQuery.ts` | `GET /radar/:id/events` `[LACUNA 3]` |
| `radar_create_item` | `features/radar/useMyRadarQuery.ts` | `POST /radar` |
| `radar_update_item` | `features/radar/useMyRadarQuery.ts` | `PATCH /radar/:id` |
| `radar_register_action` | `features/radar/useMyRadarQuery.ts` | `POST /radar/:id/actions` |
| `radar_delete_item` | `features/radar/useMyRadarQuery.ts` | `DELETE /radar/:id` |
| `my_held_orders` | `features/held-orders/useMyHeldOrdersQuery.ts` | `GET /held-orders` |
| `my_held_orders_daily_metrics` | idem | `GET /metrics/me?scope=held-orders` `[LACUNA 4 de 20-]` |
| `held_order_events_for` | idem | `GET /held-orders/:id/events` `[LACUNA 6 de 20-]` |
| `set_held_order_status` | idem | `POST /held-orders/:id/status` |
| `export_agent_services` | `lib/reportExport.ts` | `POST /exports/agent-tickets` |
| `dashboard_metrics` | `features/dashboard/useDashboardMetricsQuery.ts`, `pages/DashboardAcompanhamento.tsx`, `lib/reportExport.ts` | `GET /metrics/dashboard`; as **8 chamadas semanais** do Acompanhamento viram uma só em `GET /metrics/compliance` `[DECIDIDO — D3]` |
| `dashboard_audit` | `features/dashboard/useDashboardAuditQuery.ts` | `GET /audit` |
| `dashboard_follow_up_detail` | `features/dashboard/useFollowUpInsightsQuery.ts` | `GET /metrics/follow-ups` |
| `dashboard_hourly_pattern` | `features/dashboard/useDashboardHourlyPatternQuery.ts` | `GET /metrics/hourly` |
| `dashboard_channel_detail` | `features/dashboard/useDashboardChannelDetailQuery.ts`, `lib/reportExport.ts` | `GET /metrics/channels` |
| `dashboard_refund_metrics` | `features/dashboard/useDashboardRefundMetricsQuery.ts`, `lib/reportExport.ts` | `GET /metrics/refunds` |
| `dashboard_refund_audit` | `features/dashboard/useDashboardRefundAuditQuery.ts` | `GET /audit?scope=refunds` `[LACUNA 16 de 21-]` |
| `dashboard_refund_reason_detail` | `features/dashboard/useDashboardRefundReasonDetailQuery.ts`, `lib/reportExport.ts` | `GET /metrics/refunds/reasons/:category` + `POST /exports/refund-reason-detail` |
| `dashboard_status_summary` | `lib/reportExport.ts` | `POST /exports/manager-report` (bloco interno) |
| `dashboard_export_extras` | `lib/reportExport.ts` | idem |
| `dashboard_contact_reason_notes` | `lib/reportExport.ts` | idem |
| `dashboard_same_day_repeats` | `features/dashboard/useSameDayRepeatsQuery.ts` | `GET /metrics/same-day-repeats` — o componente hoje **não é renderizado** (`[BACKLOG — B19]`). A rota continua fazendo sentido: com **D1** a repetição no mesmo dia deixa de ser infração e passa a ser só o que a métrica precisa não contar duas vezes |
| `manager_refund_alerts` | `features/dashboard/useDashboardRefundAlertsQuery.ts` | `GET /refunds?overdue=true&groupBy=agent` `[LACUNA 10 de 21-]` |
| `manager_complete_refund` | `features/dashboard/useManagerCompleteRefundMutation.ts` | `POST /refunds/:id/complete` com `onBehalfOf` |
| `manager_list_users` | `features/dashboard/useManagerUsersQuery.ts` | `GET /users` |
| `manager_set_user_active` | idem | `PATCH /users/:id` (`isActive`) |
| `manager_set_agent_availability` | idem | `PATCH /users/:id` (`isAvailable`) |
| `manager_delete_auth_user` | idem | `DELETE /users/:id` |
| `manager_list_open_tickets_by_agent` | `features/dashboard/useOpenTicketsByAgentQuery.ts` | `GET /users/:id/open-tickets` `[LACUNA 7 de 21-]` |
| `manager_reassign_tickets` | `features/dashboard/useReassignTicketsMutation.ts` | `POST /tickets/reassign` `[LACUNA 7 de 21-]` |
| `manager_list_held_orders` | `features/held-orders/useManagerHeldOrdersQuery.ts` | `GET /held-orders?scope=manager` |
| `manager_import_held_orders` | idem | `POST /held-orders/import` |
| `manager_distribute_held_orders` | idem | `POST /held-orders/distribute` |
| `manager_assign_held_orders` | idem | **sem consumidor na UI** — existe no hook e nenhuma tela chama; `[DECISÃO]` manter como `POST /held-orders/assign` ou remover |
| `manager_takeover_notifications` | `features/takeovers/useTakeoverNotificationsQuery.ts` | `GET /takeovers?status=pending` `[LACUNA 9 de 21-]` |
| `approve_ticket_takeover` | `features/takeovers/ManagerApprovalsBell.tsx` | `POST /takeovers/:id/approve` |
| `reject_ticket_takeover` | idem | `POST /takeovers/:id/reject` |
| `copy_refund_reason_analytics` | `features/copy/useCopyRefundAnalyticsQuery.ts` | `GET /copy-analytics/refund-reasons` |
| `copy_refund_reason_evidence` | `features/copy/useCopyReasonEvidenceQuery.ts` | `GET /copy-analytics/refund-reasons/:category/evidence` |
| `lya_list_chats` | `features/lya/api.ts` | `GET /integrations/lya/chats` |
| `lya_get_chat` | idem | `GET /integrations/lya/chats/:id` |
| `lya_save_chat` | idem | `PUT /integrations/lya/chats/:id` |
| `lya_delete_chat` | idem | `DELETE /integrations/lya/chats/:id` |
| `lya_list_memories` | idem | `GET /integrations/lya/memories` |
| `lya_delete_memory` | idem | `DELETE /integrations/lya/memories/:id` |
| `lya_delete_seed_memories` | idem | `DELETE /integrations/lya/memories?seed=true` |

### 6.2 Acesso direto a tabela (`supabase.from`)

| Tabela | Arquivo | Uso | Endpoint v2 |
|---|---|---|---|
| `profiles` | `layouts/AgentLayout.tsx`, `layouts/ManagerLayout.tsx`, `layouts/CopyLayout.tsx`, `layouts/ProdutosLayout.tsx`, `pages/Index.tsx`, `pages/Login.tsx`, `pages/AreaSelect.tsx` | ler role, nome e capacidades do próprio usuário | `GET /me` |
| `profiles` | `pages/agent/Atendimentos.tsx` | mapa `id → full_name` dos agentes (só com `can_view_all_tickets`) | `ownerName` no ticket `[LACUNA 13 de 20-]` |
| `profiles` | `features/dashboard/useAgentsQuery.ts` | popular o `Select` global de agente | `GET /users?role=agent` |
| `profiles` | `pages/DashboardAcompanhamento.tsx` | lista de agentes das 8 semanas | `GET /metrics/compliance` (vem em `agents[]`) `[DECIDIDO — D3]` |
| `services` | `pages/agent/Atendimentos.tsx` | `INSERT` do atendimento, `UPDATE` da edição, `DELETE`, e `SELECT` por id no desfecho "mine" | `POST /tickets`, `PATCH /tickets/:id`, `DELETE /tickets/:id`, `GET /tickets/:id` |
| `services` | `features/services/EditServiceDialog.tsx` | `SELECT order_id` (remendo porque a listagem não traz) | `GET /tickets/:id` |
| `services` | `features/agent/check-in/useCheckInSnapshot.ts` | dois `count` (2 h e hoje) | `GET /metrics/me?window=checkin` |
| `services` | `pages/DashboardAcompanhamento.tsx` | `user_id, channel` das 8 semanas, para achar o canal dominante | `GET /metrics/compliance` (campo `channel`) `[DECIDIDO — D3]` |
| `service_follow_ups` | `features/services/useStatusTracking.ts` | `INSERT` da interação | `POST /tickets/:id/interactions` |
| `service_follow_ups` | `features/agent/check-in/useCheckInSnapshot.ts` | dois `count` | `GET /metrics/me?window=checkin` |
| `refunds` | `pages/agent/Reembolsos.tsx` | `UPDATE` de concluir e de editar, `DELETE` | `POST /refunds/:id/complete`, `PATCH /refunds/:id`, `DELETE /refunds/:id` |
| `refunds` | `features/agent/check-in/useCheckInSnapshot.ts` | quatro `count` (criados e concluídos, 2 janelas) | `GET /metrics/me?window=checkin` |
| `ticket_transfers` | `features/transfers/TransferTicketDialog.tsx` | `INSERT` do encaminhamento | `POST /transfers` |
| `ticket_transfers` | `features/transfers/NotificationsBell.tsx` | `UPDATE` de aceitar, recusar e marcar como lido | `POST /transfers/:id/accept`, `POST /transfers/:id/decline`, `POST /notifications/:id/seen` |
| `support_products` | `features/support-base/useSupportBaseQuery.ts` | leitura (agente/copy) e CRUD (gestora) | `GET/POST/PATCH/DELETE /support-base/products` |
| `support_sms_brands` | idem | idem | `…/support-base/sms-brands` |
| `support_sms_replies` | idem | idem | `…/support-base/sms-replies` |
| `training_videos` | `features/training/useTrainingVideosQuery.ts` | catálogo de vídeos | `GET /training/videos` |
| `training_video_views` | `features/training/useTrainingVideosQuery.ts`, `useTrainingVideoViewMutation.ts` | progresso por vídeo | `GET /training/videos` (campos de progresso) + `POST /training/videos/:id/progress` |
| `agent_notes` | `features/notepad/useAgentNotesQuery.ts` | leitura por intervalo, pendências abertas, busca, `INSERT`, `UPDATE`, `DELETE` e o **reinsert do "Desfazer"** | `GET/POST/PATCH/DELETE /notes` `[LACUNA 7 de 20-]` |
| `services` + `profiles` | `pages/Workspace.tsx` | **arquivo não roteado** — confirmado: `Workspace` não aparece em `src/App.tsx` nem em nenhum import. Código morto | nenhum: ver "Propostas de remoção" |
| `services` | `features/dashboard/useDashboardServicesQuery.ts` | **sem consumidor** — confirmado por busca: o hook não é importado em nenhum lugar. Código morto | nenhum: idem |

### 6.3 Edge Functions

| Chamada de hoje | Arquivo | Endpoint v2 |
|---|---|---|
| `functions.invoke("zendesk", {action:"status"})` | `features/zendesk/useZendeskQuery.ts` | `GET /integrations/zendesk/status` |
| `… {action:"tickets"}` | idem | `GET /integrations/zendesk/tickets` |
| `… {action:"ticket"}` | idem | `GET /integrations/zendesk/tickets/:id` |
| `… {action:"groups"}` | idem | `GET /integrations/zendesk/groups` |
| `fetch(.../functions/v1/lya, {action:"chat"})` — SSE | `features/lya/api.ts` | `POST /integrations/lya/chat` (streaming, `[LACUNA 13 de 21-]`) |
| `… {action:"ping"}` | idem | `GET /integrations/lya/health` |
| `… {action:"memoria_salvar"}` | idem | `POST /integrations/lya/memories` |

### 6.4 Geração de planilha no cliente (`xlsx`)

| Função de hoje | Arquivo | Endpoint v2 |
|---|---|---|
| `exportManagerReport` | `lib/reportExport.ts` | `POST /exports/manager-report` |
| `exportRefundReasonDetail` | `lib/reportExport.ts` | `POST /exports/refund-reason-detail` |
| `exportAgentServices` | `lib/reportExport.ts` | `POST /exports/agent-tickets` |
| `exportRadar` | `features/radar/exportRadar.ts` | `POST /exports/radar` |
| `exportHeldOrders` | `features/held-orders/exportHeldOrders.ts` | `POST /exports/held-orders` |
| `parseHeldOrdersCsv` (leitura de CSV/XLSX) | `features/held-orders/parseHeldOrdersCsv.ts` | `POST /held-orders/import` (multipart) |

Com isso o pacote `xlsx` **sai inteiro do bundle** — é a maior dependência do
cliente hoje.

---

## Lacunas

Além das lacunas já listadas em `20-frontend-agente.md` e
`21-frontend-outras-areas.md`, a fronteira em si precisa de definição em:

1. **Trilha de autenticação.** `record_auth_event("login" | "logout" |
   "force_logout")` não tem rota na linha de base. Ou a API grava sozinha (o que é
   melhor: o front não decide auditoria), ou existe `POST /me/auth-events`. Hoje o
   front dispara os três.
2. **Fila "a resolver" das transferências.** `GET /transfers` na linha de base cobre
   o histórico; falta o parâmetro (ou a rota) que devolve a fila operacional
   desduplicada por ticket e sem os concluídos.
3. **Timeline de um caso do Radar.** A linha de base diz "CRUD + registro de ação +
   resumo" — a timeline (`radar_item_events`) fica de fora.
4. ~~**`totalCount` nas listas paginadas.**~~ **`RESOLVIDA` por D7:** quatro das
   cinco tabelas mantêm "Página {p} de {t} • {n} registros" e recebem `totalCount`;
   o §3 do contrato foi emendado para isso. O total é contado sobre a tabela de
   fatos e guardado em cache por combinação de filtro, então trocar de página não
   reconta. Só "Meus Atendimentos" vai para cursor, e essa é a única que perde o
   número de página. O que resta em aberto é operacional: **quanto tempo vive o
   cache do total** e o que a tela mostra enquanto ele é calculado pela primeira vez.
5. **Ordenação documentada por rota.** O contrato exige ordenação fixa por rota
   (para o cursor ser válido). Hoje a ordem de algumas listas é escolhida no cliente
   (interações por taxa de conclusão, agentes por nome, motivos por volume). Cada
   uma precisa ser declarada como ordenação de rota **ou** explicitamente marcada
   como ordenação de apresentação.
6. **Mapa de evento de tempo real → query invalidada.** O contrato §4 define os
   canais e diz que "o evento carrega o mínimo para decidir o que invalidar", mas
   não lista os eventos. Este documento propõe: `ticket.created`, `ticket.updated`,
   `ticket.assigned`, `interaction.created`, `refund.created`, `refund.changed`,
   `refund.overdue`, `transfer.received`, `transfer.answered`,
   `takeover.requested`, `takeover.decided`, `held-order.assigned`,
   `held-order.imported`, `held-order.distributed`, `account.blocked`,
   `metrics.stale`. A nomenclatura e o payload são da trilha de backend.
7. **Códigos de erro que o front precisa distinguir.** Com **D1**, o exemplo do
   contrato (`FOLLOW_UP_BLOCKED`) **deixa de existir** — a rota de interação não
   valida horário, e o contrato §3 precisa de outro exemplo. Continuam faltando os
   códigos em que a interface reage de forma **diferente** (não só com texto
   diferente): duplicidade cross-agent (abre diálogo em vez de mostrar erro), pedido
   de transferência já pendente (hoje detectado pelo código Postgres `23505`), nome
   já existente na Base de Suporte (hoje detectado pela string do índice **dentro da
   mensagem**), produto fora do catálogo (o CHECK de `services.product`), e conta
   bloqueada (`ACCOUNT_BLOCKED`, que precisa ser tratada globalmente).
8. **Idempotência nas rotas que faltam.** O contrato obriga `Idempotency-Key` em
   criar ticket, criar interação, criar reembolso e importar pedidos em espera.
   Faltam, com o mesmo risco de clique duplo: criar caso do Radar, registrar ação do
   Radar, registrar status de pedido em espera, criar nota do caderno, criar
   transferência e criar pedido de tomada.
9. **Exportação assíncrona.** Se `POST /exports/*` devolve `{url}` na hora, o
   relatório do gestor (6 agregações) pode estourar o tempo de resposta. Precisa
   ficar definido se é síncrono, ou se devolve um id e o front acompanha — o que
   muda a interface (hoje é "Extraindo..." e o arquivo cai).
10. **Sessão e refresh.** O contrato diz que login, refresh e logout não mudam. Falta
    dizer o que o front faz quando recebe `401` com token que o Supabase considera
    válido: tentar um refresh e repetir a requisição uma vez, ou mandar para o
    login. Sem isso, cada tela decide sozinha — que é o problema de hoje.

## Propostas de emenda

### 1. O envelope da coleção não serve para as telas de análise

O contrato §3 define dois formatos: objeto na raiz e `{items, nextCursor, hasMore}`.
Mas quase toda tela da gestora consome **um objeto com vários blocos** (`totalCount`
+ `byAgent[]` + `byProduct[]` + `byDay[]` + `facets` + `benchmark`), e isso não é
coleção nem recurso único.

Emenda: o contrato reconhece um terceiro formato — **relatório**: objeto na raiz com
blocos nomeados, sem cursor, sem paginação. Tentar encaixar isso em `{items}` faria a
gestora emitir 8 requisições por tela, que é pior que hoje.

### 2. ~~Keyset tira o salto para página arbitrária~~ — `RESOLVIDA` por D7

Esta emenda foi resolvida, e a trilha estava com o diagnóstico errado. O custo de
hoje **não é o `OFFSET`**: é o predicado não indexável que ele percorre — filtrar
`service_date` em texto, convertido e com fuso aplicado por linha, obriga varredura.
Sobre uma tabela de fatos com índice por dia e agente, saltar alguns milhares de
linhas é barato.

Como fica, por decisão do dono:

| Lista | Paginação | Por quê |
|---|---|---|
| Meus Atendimentos (agente) | **cursor**, sem número de página | lista quente, aberta o dia todo, o agente navega pelo começo |
| Reembolsos, duas abas | numerada, com total | o agente precisa saber quantos faltam |
| Auditoria de atendimentos e de reembolsos | numerada, com total | consulta fria, o total **é** a informação |
| Detalhe de motivo de reembolso | numerada, com total | idem |

Listas pequenas e fechadas (usuários, alertas, Base de Suporte) continuam sem
paginação, como hoje. Fica registrado o que a trilha aprendeu: **medir o predicado
antes de culpar o mecanismo de paginação.**

### 3. `xlsx` sair do cliente muda o significado de "a planilha é o que está na tela"

Hoje três exportações têm uma garantia forte: o array filtrado que alimenta a tabela
é **literalmente** o mesmo que alimenta a planilha (o código dos Pedidos em Espera
diz isso em comentário). Com a exportação no servidor, a garantia só se mantém se o
`POST /exports/*` receber **exatamente** os mesmos parâmetros da listagem, incluindo
busca textual e "incluir repetidos".

Emenda: as rotas de exportação recebem o **mesmo objeto de filtro** das rotas de
listagem, e isso é obrigação de contrato, não detalhe de implementação. Sem isso a
gestora vai comparar tela e planilha e achar divergência — que é exatamente o
incidente de "modal de canal vs gráfico" que o projeto já viveu.

### 4. Um cliente HTTP, não um cliente por feature

Hoje há três padrões conviverndo: `supabase.rpc` tipado, `supabase.rpc` com
`bind` e `as any` (Radar, Pedidos em Espera, Lya, Base de Suporte — tudo que é
posterior à última geração de tipos) e `fetch` cru (Lya SSE). Emenda: um único
cliente em `apps/web/src/lib/api`, tipado por `packages/contract`, que:
- injeta o `Authorization`;
- traduz `{error:{code,message,details}}` em um `ApiError` tipado por `code`;
- trata `401` (um refresh + repetição) e `403 ACCOUNT_BLOCKED` (logout global) **num
  lugar só**;
- gera `Idempotency-Key` automaticamente nas rotas marcadas como idempotentes no
  contrato.

Nenhuma feature fala com a rede por fora dele. É o que torna "o front reage ao
`code`" (§3) verificável, em vez de aspiracional.

### 5. Push sem polling precisa de um caminho de recuperação explícito

O contrato §4 diz que o front revalida ao reconectar. Na prática são três estados:
conectado, reconectando e **desistiu**. Emenda: a v2 mostra um indicador discreto de
"dados podem estar desatualizados" quando o socket está fora há mais de X segundos, e
um botão de recarregar. Sem isso, trocar polling por push transforma uma queda de
socket em "o número não atualiza e ninguém sabe por quê" — pior que o polling que se
quer remover.

## Propostas de remoção

Confirmadas por busca no repositório.

**Já triados pelo dono e movidos para `90-BACKLOG.md`** — a discussão é lá, não aqui:

| Item | Onde ficou |
|---|---|
| `src/pages/Workspace.tsx` (469 linhas, não roteado) e `useDashboardServicesQuery` (sem consumidor, com `select *` sem limite) | **B21** — não serão migrados; remover do legado é opcional |
| `SameDayRepeatsSection`, importado e nunca renderizado | **B19** — religar ou remover é decisão adiada |
| Contas de teste escondidas pelas strings "geovani" e "agente teste" | **B20** — na v2 vira marca no perfil, mas a lista precisa ser conferida |

**Ainda sem destino, e pequenos o bastante para decidir na implementação:**

| Item | Evidência | Efeito de remover |
|---|---|---|
| `src/features/agent/useMyMetricsRangeQuery.ts` (`agent_metrics_range`) | nenhum import | nenhum |
| `src/features/agent/useMyProductMixQuery.ts` (`agent_product_mix`) | nenhum import | nenhum |
| `byDaySeries` em `src/pages/Dashboard.tsx` | calculado e nunca renderizado | nenhum |
| `dashboard_follow_up_detail` chamada em `src/pages/Dashboard.tsx` | o `data` é descartado; serve só para compor `isLoading`/`error` | uma RPC a menos por carregamento do dashboard |
| `myCountOverride` em `AgentDailyMetricsSection` | prop sem chamador | nenhum |
| `_canViewAllTickets` em `useMyServicesQuery` | parâmetro ignorado (a RPC resolve no servidor) | nenhum |
| `efficiency_score` em `ChannelEfficiencyRow` | campo nunca lido | nenhum |
| campos legados de `agent_my_metrics` (`avg_daily`, `total_interactions`, `team_average`, `gap_to_avg_pct`, `is_below_team_avg_20pct`, `benchmark_name`, `benchmark_count`) | a tela usa os equivalentes novos | resposta menor |
| `manager_assign_held_orders` | existe no hook, nenhuma tela chama | **verificar antes**: pode ser rota futura |
| `canAddInteraction` e todo o aparato de bloqueio das 18h | `[DECIDIDO — D1]`: a regra deixou de existir | nenhum — mas a marcação `is_same_day_repeat` do banco **não** sai |
