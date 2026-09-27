# Inventário de regras de negócio vivas — XMX Suporte (estado em 26/09/2026)

> Trilha: **backend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
>
> **Critério de verdade:** o sistema real é o código, não a documentação. Onde
> `CLAUDE.md` divergir do código, vale o código e a divergência está registrada na
> seção "Divergências entre documentação e código".
>
> **Como ler cada regra.** Toda regra tem um identificador estável `R-<DOMÍNIO>-<n>`
> usado pelos arquivos `11`, `12` e `13` e pelos testes (`13` exige um teste por regra).
> Cada regra declara:
>
> | Campo | Significado |
> |---|---|
> | **Enunciado** | uma frase, em português, no vocabulário do negócio |
> | **Hoje** | `arquivo:linha` + forma (RPC, trigger, policy, constraint, código do cliente) |
> | **v2** | rota da API, constraint ou trigger de invariante que passa a carregar a regra |
> | **Natureza** | `intencional` · `bug-virou-comportamento` · `acidente` · `a decidir` |
>
> Onde aparece **DECISÃO NECESSÁRIA**, a trilha não escolheu: a opção fica proposta e a
> decisão é do dono do projeto (§8 e §9 do contrato).
>
> ### Reconciliado com §8-A do contrato em 26/09/2026
>
> Sete decisões do dono do projeto (D1 a D7) e dois defeitos apontados pela trilha de dados
> (C6 e C8) foram incorporados. As regras afetadas trazem o marcador **[Dn]**. A seção §19
> registra o que cada decisão fechou; o que continua aberto aponta para
> `docs/arquitetura-v2/90-BACKLOG.md`, que é a lista viva.

## Sumário por domínio

| Domínio | Regras | Seção |
|---|---|---|
| Sessão, autenticação e autorização | R-AUTH-1 … R-AUTH-14 | [1](#1-sessão-autenticação-e-autorização) |
| Capacidades e papéis | R-CAP-1 … R-CAP-12 | [2](#2-capacidades-e-papéis) |
| Tickets (atendimentos) | R-TKT-1 … R-TKT-26 | [3](#3-tickets-atendimentos) |
| Interações (follow-ups) | R-INT-1 … R-INT-14 | [4](#4-interações-follow-ups) |
| Transferências entre agentes | R-TRF-1 … R-TRF-10 | [5](#5-transferências-entre-agentes) |
| Tomada de ticket (folga) | R-TKO-1 … R-TKO-9 | [6](#6-tomada-de-ticket-aprovação-da-gestora) |
| Reembolsos | R-REF-1 … R-REF-22 | [7](#7-reembolsos) |
| Métricas e auditoria | R-MET-1 … R-MET-35 | [8](#8-métricas-e-auditoria) |
| Pedidos em espera | R-HLD-1 … R-HLD-18 | [9](#9-pedidos-em-espera-held-orders) |
| Radar de pendências | R-RAD-1 … R-RAD-10 | [10](#10-radar-de-pendências) |
| Caderno do agente | R-NOT-1 … R-NOT-5 | [11](#11-caderno-do-agente) |
| Base de suporte | R-BAS-1 … R-BAS-7 | [12](#12-base-de-suporte) |
| Treinamento | R-TRN-1 … R-TRN-6 | [13](#13-treinamento) |
| Usuários e administração | R-USR-1 … R-USR-14 | [14](#14-usuários-e-administração) |
| Área do copy | R-CPY-1 … R-CPY-12 | [15](#15-área-do-copy) |
| Lya (agente de IA) | R-LYA-1 … R-LYA-14 | [16](#16-lya-agente-de-ia) |
| Zendesk | R-ZEN-1 … R-ZEN-10 | [17](#17-zendesk) |
| Exportações | R-EXP-1 … R-EXP-6 | [18](#18-exportações) |

---

## 1. Sessão, autenticação e autorização

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-AUTH-1 | O login é e-mail + senha no Supabase Auth; o app não tem cadastro próprio. | `src/pages/Login.tsx` | inalterado — o JWT continua do Supabase Auth (§3 do contrato) | intencional |
| R-AUTH-2 | Ao entrar, o destino depende da role: quem tem duas áreas cai em `/areas` e escolhe; quem tem uma vai direto. | `src/lib/roles.ts:97-101` (`homePathForRole`) | `GET /me` devolve `areas[]` e `homeArea`; o front roteia | intencional |
| R-AUTH-3 | Role desconhecida pelo bundle **não** cai no fallback de agente: mostra "sua área não existe neste bundle" em vez de redirecionar em laço. | `src/lib/roles.ts:80-82` (`isKnownRole`), `src/layouts/AgentLayout.tsx:84-88` | `GET /me` devolve `role` cru + `areas[]` resolvidas no servidor; o laço deixa de ser possível | intencional (correção de bug anterior) |
| R-AUTH-4 | Conta com `is_active = false` é expulsa para `/blocked` e as chaves `sb-*` do `localStorage` são apagadas. | RPC `me_status` (`20260520050000_user_management_rpcs.sql:69-96`) + `src/layouts/AgentLayout.tsx:57-62,105-111` | middleware de auth devolve `403 ACCOUNT_BLOCKED` em toda rota; o front derruba a sessão | intencional |
| R-AUTH-5 | Perfil inexistente (usuário apagado com JWT ainda válido) também bloqueia, com motivo `no_profile`. | `me_status` (`...user_management_rpcs.sql:87-89`) | `403 ACCOUNT_BLOCKED` com `details.reason = "no_profile"` | intencional |
| R-AUTH-6 | O status da conta é verificado a cada 30 s e em `focus`/`visibilitychange`. | `src/layouts/AgentLayout.tsx:151` (`setInterval(revalidate, 30_000)`) | **substituído** por Realtime: canal `user:{userId}` + revalidação na reconexão (§4 do contrato). O polling morre. | intencional |
| R-AUTH-7 | O agente publica um heartbeat a cada 30 s para a gestora ver quem está online. | RPC `agent_heartbeat` (`...user_management_rpcs.sql:8-28`), tabela `agent_heartbeats` | **substituído** por Realtime Presence, que não grava no banco (§4). Ver R-USR-6 para o que a gestora perde. | intencional |
| R-AUTH-8 | "Online" é `last_seen_at > now() - 90 s`. | `manager_list_users` (`...user_management_rpcs.sql:131`) | `GET /users` devolve `isOnline` a partir de Presence | intencional |
| R-AUTH-9 | O logout é registrado em `auth_events` **pelo cliente, antes** do `signOut`. | RPC `record_auth_event` (`...user_management_rpcs.sql:36-64`) | `POST /session/logout` registra no servidor; o front não escolhe se registra | **bug-virou-comportamento**: se o browser fecha antes da chamada, o logout não existe. `last_logout_at` da tela de Usuários mente nesse caso. |
| R-AUTH-10 | Um usuário só registra evento de auth para si; gestora registra para qualquer um. | `record_auth_event` (`...:57-59`) | interno à API | intencional |
| R-AUTH-11 | `handle_new_user` cria a linha em `profiles` no `AFTER INSERT` de `auth.users`, lendo `role` e `full_name` do metadata. | `20260115171248_...sql` (trigger `on_auth_user_created`) | mantido como trigger de invariante em `users` | intencional |
| R-AUTH-12 | `is_manager()` é `role = 'manager'` lido de `profiles`, e é usada em ~157 pontos, muitos de escrita — por isso **nunca** foi alargada para o copy. | `20260122185317_...sql`; justificativa em `20260824120000_areas_gestora_e_copy.sql:18-21` | autorização por capacidade explícita no middleware; nada de "role que cresce" | intencional |
| R-AUTH-13 | O front esconde o que a role não pode ver, mas a recusa real é sempre do banco. | guards espalhados nos layouts + `RAISE EXCEPTION 'forbidden'` nos RPCs | mantido (§3 e §6 do contrato) | intencional |
| R-AUTH-14 | `is_supervisor()` ainda existe no banco como função, mas nada a chama: foi renomeada para `can_view_all_tickets()`. | `20260521120000_add_is_supervisor_flag.sql` (última definição) vs. `20260521130000_rename_is_supervisor_to_can_view_all_tickets.sql` | **não migra** — ver "Propostas de remoção" | acidente (resíduo de rename) |

---

## 2. Capacidades e papéis

### 2.1 Roles (`profiles.role`, enum `public."AppRole"`)

| Role | Áreas (ordem = prioridade) | O que libera hoje |
|---|---|---|
| `agent` | `workspace` (`/workspace`) | criar/editar/concluir os próprios tickets, interações, reembolsos próprios, radar, caderno, pedidos em espera atribuídos, treinamento, leitura da Base de Suporte |
| `manager` | `analytics` (`/dashboard`), `copy` (`/copy`) | tudo de leitura analítica + toda a gestão: usuários, reassign, baixa de reembolso, importação/distribuição de pedidos em espera, correção de data, escrita na Base de Suporte, Zendesk, treinar a Lya |
| `copy_grup` | `copy` (`/copy`), `analytics` (`/dashboard`) | **somente leitura** dos agregados das 4 telas de analytics + telas de copy; nenhum poder de gestão |
| `produto` | `produtos` (`/produtos`) | área exclusiva; **nem a gestora entra** |

Fonte: `src/lib/roles.ts:47-52` (`ROLE_AREAS`).

### 2.2 Capacidades (uma boolean por capacidade, em `profiles`)

| ID | Flag | O que libera exatamente hoje | Onde é checada |
|---|---|---|---|
| R-CAP-1 | `can_view_all_tickets` | ver tickets e follow-ups de **todos** os agentes; ver todos os perfis; no fluxo de criação, um e-mail duplicado de outro agente é tratado como "meu" e abre o acompanhamento direto | helper `can_view_all_tickets()` (`20260521130000`), policies "Cross-agent *", `my_follow_ups`, `src/pages/agent/Atendimentos.tsx:524` |
| R-CAP-2 | `can_register_duplicate_emails` | abrir um ticket próprio para um e-mail que já tem ticket em aberto de **outro** agente | só no cliente: `src/pages/agent/Atendimentos.tsx:529` | 
| R-CAP-3 | `can_claim_tickets` | assumir para si um ticket em aberto de outro agente (RPC `claim_ticket`) | helper `can_claim_tickets()` + guard dentro de `claim_ticket` (`20260716130000:41-43`) |
| R-CAP-4 | `can_approve_takeovers` | receber e responder os pedidos de tomada de ticket de agente de folga; **exige `role = 'manager'` junto** | `manager_takeover_notifications`, `approve_ticket_takeover`, `reject_ticket_takeover` (`20260717120500`) |
| R-CAP-5 | `is_available` | `false` = de folga. Só então o colega pode **pedir** a tomada; com `true`, `request_ticket_takeover` recusa e manda encaminhar. Não é bloqueio de login. | `request_ticket_takeover` (`20260717120500:~130`), `manager_set_agent_availability` |
| R-CAP-6 | `is_active` | `false` = conta bloqueada: `me_status` derruba a sessão. Independente de `is_available`. | `me_status`, `manager_set_user_active` |
| R-CAP-7 | `can_view_support_analytics()` (derivada) | `is_manager() OR is_copy_team()` — guard de leitura das RPCs de analytics e do sandbox da Lya | `20260824120000:31-38` |
| R-CAP-8 | `can_read_refund_analytics()` (derivada) | delega para `can_view_support_analytics()`; existe só para não haver duas definições da mesma regra | `20260824120000:45-52` |
| R-CAP-9 | `support_channel` (`profiles`) | coluna existe e é exibida na tela de Usuários, mas **nenhuma regra a lê**: a meta diária é derivada dos tickets do agente (R-MET-12). | `profiles.support_channel` vs. `src/pages/agent/Atendimentos.tsx:471-476` | 
| R-CAP-10 | **Nenhuma capacidade tem UI de edição.** `can_view_all_tickets`, `can_register_duplicate_emails`, `can_claim_tickets` e `can_approve_takeovers` só mudam por SQL direto em produção. | ausência de escrita em `src/pages/DashboardUsers.tsx` | **DECISÃO NECESSÁRIA** — ver §19 |
| R-CAP-11 | `user_roles` é uma segunda tabela de papéis, alimentada por `has_role()`, e **não é a fonte de verdade**: `profiles.role` é. | `20260122185317_...sql` | não migra como fonte; ver "Propostas de remoção" | acidente (duplicidade histórica) |
| R-CAP-12 | Existem **dois** enums de role no banco: `public."AppRole"` (usado por `profiles.role`) e `public.app_role` (órfão). | memória do projeto + `src/integrations/supabase/types.ts:1235` | v2 tem um enum só | acidente |

---

## 3. Tickets (atendimentos)

### 3.1 Criação

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TKT-1 | A data do atendimento é **sempre hoje em São Paulo**, seja lá o que o cliente mande. | trigger `trg_service_pin_date_on_insert` → `_tg_service_pin_date_on_insert` (`20260525000300_freeze_history_triggers.sql:66-86`), gravando o texto `'YYYY-MM-DDT00:00:00-03:00'` | `POST /tickets` ignora qualquer data do corpo; trigger de invariante mantém a garantia | intencional |
| R-TKT-2 | `current_owner_id` nasce igual a `user_id` quando o cliente não manda. | trigger `trg_service_default_current_owner` (`20260528000000:31-47`) | `POST /tickets` define `currentOwnerId = creatorId`; coluna `NOT NULL` + trigger | intencional |
| R-TKT-3 | **[D6]** Antes de criar, o sistema procura um ticket **não concluído** com o mesmo e-mail (case-insensitive, `TRIM`), o mais recente, **em toda a base** (cruza RLS). O e-mail digitado é preservado como veio; só a comparação usa a versão normalizada. | RPC `find_ticket_by_email` (`20260717120000_agent_availability.sql:~90`) chamada em `src/pages/agent/Atendimentos.tsx:512` | `GET /tickets/lookup?email=`, comparando por `client_email_normalized` (coluna **gerada** — o original nunca é sobrescrito, §8-A/D6) | intencional |
| R-TKT-4 | Se o ticket encontrado já é meu (`current_owner_id = eu`) **ou** eu tenho `can_view_all_tickets`, o formulário não cria nada: abre o acompanhamento do ticket existente. | `src/pages/agent/Atendimentos.tsx:524-526` | `POST /tickets` responde `409 TICKET_ALREADY_OPEN` com o `ticketId`; o front abre o diálogo | intencional |
| R-TKT-5 | Se o ticket é de outro agente e eu **não** tenho `can_register_duplicate_emails`, o formulário não cria: abre o diálogo de encaminhamento/tomada. | `src/pages/agent/Atendimentos.tsx:529-531` | `POST /tickets` responde `409 TICKET_OWNED_BY_OTHER_AGENT` com dono, nome e `ownerIsAvailable` | intencional |
| R-TKT-6 | Com `can_register_duplicate_emails`, a duplicidade é ignorada e o ticket próprio é criado. | idem | `POST /tickets` aceita; RLS não muda nada disso hoje, e não deve mudar | intencional |
| R-TKT-7 | A **ordem** das três checagens é: (1) sou o dono atual ou vejo tudo → abrir existente; (2) sem permissão de duplicar → barrar; (3) criar. Inverter a ordem muda o comportamento de quem tem as duas permissões. | `src/pages/agent/Atendimentos.tsx:510-535` | mesma ordem, no caso de uso `CreateTicket`; **um teste por ramo** | intencional (frágil — merece teste) |
| R-TKT-8 | "Registrar e concluir" grava `status = 'concluido'` direto no ticket, **sem** criar follow-up, justamente para não contar duas interações. | `src/pages/agent/Atendimentos.tsx:545` + comentário | `POST /tickets` com `concludeNow: true` | intencional |
| R-TKT-9 | O cliente grava `status = 'registered'`, mas o **default da coluna no banco é `'pendente'`** — toda escrita que não informar o status cria um terceiro valor. | `src/pages/agent/Atendimentos.tsx:545` vs. `services.status DEFAULT 'pendente'` (banco real, `30-banco-estado-real.md` §2) | enum fechado em `12` §3.1; o backfill precisa saber quantas linhas têm cada valor | **bug-virou-comportamento**: três valores possíveis para dois estados. Ver DECISÃO 19.12 |
| R-TKT-10 | O botão de salvar só habilita com: e-mail (ou telefone completo, se canal SMS), data, produto, plataforma, motivo, e — quando o motivo pede — a descrição; motivo `reembolso` exige número do pedido. | `canSubmit` em `src/pages/agent/Atendimentos.tsx:482-492` | validação Zod na rota `POST /tickets`, espelhada pelo front | intencional |
| R-TKT-11 | Canal `SMS` valida **telefone completo**, não e-mail. | `isPhoneComplete(clientEmail)` em `canSubmit` | validação condicional por `channel` | intencional (a coluna continua chamada `client_email` guardando telefone) |
| R-TKT-11b | **[D5, M4, M7]** `platform` e `channel` guardam **duas ausências diferentes**: "Nenhum" e vazio. Em `platform` são 10.666 "Nenhum" e 26.764 vazios; em `channel`, 1.128 e 30.994. A diferença entre "verifiquei e não há" e "ninguém preencheu" é informação. | `services.platform`, `services.channel` (`text` livre, sem `CHECK`) | **[G9.3]** os dois permanecem distintos **e nomeados**: `'Nenhum'` vira a linha de catálogo `not_applicable` e o vazio vira `NULL` na coluna FK (`12` §3.1, §4.5). Ausência deixa de ser um texto disputando significado com um vazio | intencional por decisão |
| R-TKT-11d | **[M7]** O mesmo "Nenhum" do seletor é gravado **literal** pelo caminho do atendimento e **convertido para vazio** pelo caminho do reembolso. Por isso `refunds` tem só 36 "Nenhum": são resíduo de antes da conversão. | `Atendimentos.tsx`/`EditServiceDialog.tsx` gravam o texto · `src/pages/agent/Reembolsos.tsx:154` e `:157` convertem | **[G8.1, G9.2]** catálogo único com FK servindo as duas telas: gravam a mesma linha e a divergência deixa de ser possível (`12` §4.5) | **bug-virou-comportamento** — é a classe 8 de `01-GARANTIAS.md`, a mesma ação com dois comportamentos |
| R-TKT-11e | **[M7]** Existem **três cópias** da lista de plataformas, em **dois conteúdos**: as duas telas de atendimento têm 9 valores **com** `PagAmerican`; a de reembolso tem 8 **sem** ele — e há **139 reembolsos com esse valor no banco**. `PagAmerican` aparece também na lista de **produtos** de reembolso. | `Atendimentos.tsx:134`, `EditServiceDialog.tsx:110`, `src/features/refunds/types.ts:23` e `:100` | **[G9.2]** a lista da tela **deriva** do catálogo (`GET /sales-platforms?selectable=true`); as três listas literais deixam de existir. A entrada de `PagAmerican` em produtos é confusão de domínio, e a limpeza é decisão do dono (§19.15) | **bug-virou-comportamento** |
| R-TKT-11c | **[M4]** 3.710 tickets têm `Clickbank` no campo de **canal de atendimento**, que é nome de plataforma de venda. O campo está sendo usado para outra coisa em 3,5% dos casos. | `services.channel` | qualidade de dado, não conversão: o backfill preserva e registra; o que fazer com as linhas é decisão do dono (§19.14) | **bug-virou-comportamento** |
| R-TKT-12 | `product` é **fechado** por `CHECK`: produto novo exige migration. | `services_product_check` (`20260826140000_add_jellyrock_pagamerican_products.sql:27+`, ~75 valores) | tabela `products` referenciada por FK — produto novo passa a ser linha, não migration | **DECISÃO NECESSÁRIA** — ver §19 |
| R-TKT-13 | `contact_reason` é fechado por `CHECK` em 11 valores. | `services_contact_reason_check` (`20260818140000_contact_reason_outro_note.sql:28-41`) | enum no schema novo | intencional |
| R-TKT-14 | `contact_reason_note` é **obrigatória** quando o motivo é `outro`; **opcional no banco e obrigatória na UI** quando é `reclamacao_vsl`; **precisa ser NULL** nos outros motivos. Máximo 200 caracteres. | `services_contact_reason_note_check` (`20260828120000_contact_reason_note_vsl.sql:23-38`) | mesma constraint; a API passa a exigir a nota de VSL também (hoje só a UI exige) | **bug-virou-comportamento**: a divergência banco↔UI existe só por causa dos tickets antigos sem nota. **DECISÃO**: manter opcional no banco e exigir na API, ou exigir nos dois? |

### 3.2 Edição, exclusão e congelamento do passado

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TKT-15 | `services.user_id` (o **criador**) é imutável, sem exceção — nem gestora muda. Mudar reescreveria o crédito histórico das métricas. | `_tg_service_block_freeze_fields` (`20260716120000_claim_ticket_rpc.sql:26-29`) | trigger de invariante idêntico | intencional |
| R-TKT-16 | `services.service_date` é imutável, **exceto** por gestora. | idem, `:32-36` | `PATCH /tickets/:id` nunca aceita data; `POST /tickets/:id/correct-date` (gestora) | intencional |
| R-TKT-17 | `current_owner_id` só muda por gestora **ou** por auto-claim, autorizado por um GUC transacional `app.claim_owner` igual ao novo dono. | idem, `:41-46` | a API é a única escritora: o GUC desaparece e a regra vira código do caso de uso + trigger que só aceita `currentOwnerId` vindo do caso de uso | intencional (o GUC é um truque para contornar PostgREST; morre com a API) |
| R-TKT-18 | A edição do atendimento manda e-mail, produto, plataforma, canal, motivo, nota e número do pedido — **nunca** `service_date`. | `updateMutation` em `src/pages/agent/Atendimentos.tsx:~680` | `PATCH /tickets/:id` com corpo fechado | intencional |
| R-TKT-19 | O diálogo de edição só salva com número do pedido (se reembolso) e com a descrição (se o motivo pede). | `canSave` em `src/features/services/EditServiceDialog.tsx:170-176` | mesma validação Zod de `PATCH /tickets/:id` | intencional |
| R-TKT-20 | O diálogo de edição busca `services.order_id` numa **segunda** requisição, porque `types.ts` não conhece a coluna. | `src/features/services/EditServiceDialog.tsx:150-168` | `GET /tickets/:id` já devolve `orderId` — a segunda requisição desaparece | acidente (contorno de tipo gerado desatualizado) |
| R-TKT-21 | O agente pode **excluir** o próprio ticket, sem confirmação de motivo e sem log. | `deleteMutation` em `src/pages/agent/Atendimentos.tsx:~655` + policy "Agents delete own services" | `DELETE /tickets/:id` | **DECISÃO NECESSÁRIA**: exclusão de dado que alimenta métrica, sem trilha. Propor soft-delete. Ver §19 |
| R-TKT-22 | Gestora corrige a data de um atendimento com **motivo obrigatório**, e a correção é auditada em `service_date_corrections`. | RPC `manager_correct_service_date` (`20260525000400`) | `POST /tickets/:id/correct-date` | intencional |
| R-TKT-23 | Gestora redistribui tickets em lote; cada movimento vira uma linha `ticket_transfers` com `status='accepted'` e `assigned_by_manager_id`; é idempotente (pula quem já é dono) e tudo roda numa transação. | RPC `manager_reassign_tickets` (`20260528000400`) | `POST /tickets/reassign` | intencional |

### 3.3 Visibilidade e status derivado

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TKT-24 | **[C8, M1]** O status **exibido** do ticket é derivado no browser: sem follow-up e `status='concluido'` → "Concluído"; sem follow-up → "Em Aberto" (que o agente vê como "Novo"); com follow-up, o **último** decide; mais de um follow-up `em_andamento` → "Em Andamento N". | `getCurrentStatus` em `src/features/services/useStatusTracking.ts:78-107`; remapeamento para "Novo" em `src/pages/agent/Atendimentos.tsx:263-272` | **materializado** em `tickets.derived_status` + `interaction_count` (§6 do contrato); a API só entrega. A regra de derivação precisa de **fallback em `legacy_status`**, senão 1.220 atendimentos concluídos antes de existirem follow-ups (26/03/2026) reabrem na virada — defeito C8, corrigido em `12` §3.1 | intencional, mas a **derivação no cliente é a causa raiz** do incidente "todo ticket aparece como Novo". Prova aritmética (M1): **1.271** tickets com `status='concluido'` contra **14.102** interações com `status='concluido'` |
| R-TKT-25 | A contagem de interações exibida é `follow-ups + 1` — a criação conta como interação #1. | `getInteractionCount` em `src/pages/agent/Atendimentos.tsx:275-278` | coluna materializada `interaction_count` (já incluindo a criação) | intencional |
| R-TKT-26 | Enquanto os follow-ups não carregaram, o badge mostra um placeholder — **nunca** "Novo" — porque mapa vazio colapsava todo status para "Novo". | `followUpsUnavailable` em `src/pages/agent/Atendimentos.tsx:352-357` | deixa de existir: o status vem pronto na linha do ticket | intencional (blindagem contra o bug de julho) |

### 3.4 Assumir ticket (claim)

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TKT-27 | Assumir exige `can_claim_tickets` **ou** ser gestora. | `claim_ticket` (`20260716130000:41-43`) | `POST /tickets/:id/claim` | intencional |
| R-TKT-28 | Ticket `concluido` não pode ser assumido. | `claim_ticket` (`...:54-56`) | `422 TICKET_ALREADY_CONCLUDED` | intencional |
| R-TKT-29 | Assumir um ticket que já é meu é no-op silencioso (devolve a linha). | `claim_ticket` (`...:58`) | `200` idempotente | intencional |
| R-TKT-30 | Toda tomada registra uma linha `ticket_transfers` `accepted` com a mensagem "Atendimento assumido", com os três `seen_at` preenchidos para não gerar notificação enganosa. | `claim_ticket` (`...:70-78`) | `POST /tickets/:id/claim` grava o evento de histórico | intencional |
| R-TKT-31 | A linha é travada com `FOR UPDATE` antes de ler o dono — duas tomadas simultâneas não se atropelam. | `claim_ticket` (`...:48-51`) | transação da API com o mesmo lock | intencional |

---

## 4. Interações (follow-ups)

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-INT-1 | **[D1] A regra das 18h deixa de existir como bloqueio.** Hoje: depois de uma interação, o mesmo ticket fica bloqueado até 18:00 (São Paulo) do dia dessa interação, e só no browser. **Na v2 nada bloqueia**: registrar interação no mesmo dia é permitido. | **só no cliente**: `canAddInteraction` em `src/features/services/useStatusTracking.ts:110-157` | **nenhum endpoint valida janela de horário.** `POST /tickets/:id/interactions` valida dono, permissão e status, e nada mais (§8-A/D1) | **decidido**: o bloqueio sai. A incoerência de R-INT-5 se resolve igualando pelo lado permissivo |
| R-INT-2 | **[D1]** Ticket com `has_tracking_code = true` nunca é marcado como repetição do mesmo dia. Com D1 a isenção deixa de valer para "bloqueio" (que não existe mais) e passa a valer **só para a marcação**. | `useStatusTracking.ts:128-130`; trigger `_tg_follow_up_mark_same_day_repeat` (`20260727140000:~55`) | trigger de invariante `mark_same_day_repeat`, com a mesma isenção | intencional |
| R-INT-3 | O cálculo de "18:00 do dia da última interação" usa o **último** follow-up do array ordenado, não o máximo — o array vem ordenado por `(recorded_at, id)`, então coincide. | `useStatusTracking.ts:117-121` vs. `my_follow_ups` (`20260725120000:~55`) | `MAX(recorded_at)` explícito no servidor | acidente (depende de ordenação implícita) |
| R-INT-4 | **[D1] A marcação `is_same_day_repeat` PERMANECE, e agora é a única coisa que resta da regra.** Ela não é o bloqueio: é o que permite a métrica não contar a mesma conversa duas vezes. Perdê-la distorceria todo dashboard. | trigger `trg_follow_up_mark_same_day_repeat` (`20260727140000`) | **trigger de invariante mantido**, palavra por palavra. A API não bloqueia; o banco continua marcando (§8-A/D1) | intencional — a decisão de 27/07 ("registrar, não bloquear") venceu, e D1 só removeu o bloqueio que existia no browser |
| R-INT-5 | **[D1] RESOLVIDO.** O conflito era: concluir pela lista bloqueava e concluir pelo diálogo passava. Com D1 **os dois passam** — um comportamento só, e é o permissivo. | bloqueava: `handleQuickConclude` (`src/pages/agent/Atendimentos.tsx:284-289`) · liberava: `src/features/services/StatusTrackingDialog.tsx:54` e `:95` | `POST /tickets/:id/interactions`, sem janela | **era** bug-virou-comportamento; fechado por §8-A/D1 |
| R-INT-6 | **[M2]** `follow_up_number` é calculado no cliente como `follow-ups existentes + 1`, a partir do cache. Medido: **5.543 pares repetidos e 12.753 linhas excedentes nos últimos 180 dias** — praticamente toda a duplicação histórica (12.755). É defeito em curso, não lixo antigo. | `src/features/services/useStatusTracking.ts:175` e `:207` (otimista) | `seq` gerado pelo banco com `UNIQUE (ticket_id, seq)` (§6 do contrato). O backfill **renumera** e preserva `legacy_follow_up_number` (§19.5) | **bug-virou-comportamento**, com correção urgente |
| R-INT-7 | `recorded_at` é forçado para `now()` no `INSERT` — o cliente não escolhe a data. | trigger `trg_follow_up_force_now` (`20260525000300:24-42`) | trigger de invariante idêntico | intencional |
| R-INT-8 | `recorded_at` é **imutável** no `UPDATE`, sem carve-out nem para gestora: follow-up errado se apaga e reinsere. | trigger `trg_follow_up_block_date_change` (`20260525000300:45-64`) | trigger de invariante idêntico | intencional |
| R-INT-9 | O agente vê os follow-ups **próprios** e os dos tickets que ele detém hoje (`current_owner_id`); gestora e `can_view_all_tickets` veem todos. | RPC `my_follow_ups` (`20260725120000:47-70`) reproduzindo as policies de `service_follow_ups` | `GET /tickets/:id/interactions` + a lista de tickets já traz o resumo | intencional |
| R-INT-10 | Todo o histórico de follow-ups do agente é baixado numa **única** chamada que devolve um jsonb, para fugir do teto de ~1000 linhas do PostgREST. | RPC `my_follow_ups`, `src/features/services/useFollowUpsQuery` | **desaparece**: a lista de tickets já vem com status e contagem materializados; interação se lê por ticket, paginada | intencional (contorno de plataforma — o problema morre com a API) |
| R-INT-11 | A inserção da interação é otimista no cache e desfeita em erro, com a causa real no toast. | `addEntryMutation.onMutate/onError` (`useStatusTracking.ts:190-238`) | mantido no front (§6: otimismo é do front) | intencional |
| R-INT-12 | Um follow-up escrito pelo agente B num ticket criado por A conta **uma vez para B**, independentemente de quem detém o ticket hoje. | `_interaction_events` (`20260528000300:~60`, guarda `s.user_id = f.user_id` removida) | `interaction_facts.actor_id` | intencional (a guarda antiga escondia trabalho real) |
| R-INT-13 | A observação da interação é texto livre, opcional, sem limite de tamanho. | `service_follow_ups.observation` | `interactions.note`, com limite explícito | acidente (falta de limite) |
| R-INT-14 | O status possível de uma interação é `em_andamento` ou `concluido`. | `ServiceStatus` em `useStatusTracking.ts:12`; coluna `status text` sem `CHECK` | enum no schema novo | **acidente**: a coluna aceita qualquer texto hoje |

---

## 5. Transferências entre agentes

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TRF-1 | A transferência é um **pedido**, não uma mudança de dono: o ticket não se move. `to_user_id` é quem está sendo convidado a continuar. | tabela `ticket_transfers` (`20260514010000`) | `POST /transfers` | intencional |
| R-TRF-2 | Um índice único parcial proíbe dois pedidos **pendentes** do mesmo agente para o mesmo ticket. | índice parcial em `ticket_transfers` | `409 TRANSFER_ALREADY_PENDING` | intencional |
| R-TRF-3 | O sino do agente mostra duas coisas: pedidos **pendentes recebidos** e respostas (aceito/recusado) a pedidos que **eu** enviei e ainda não vi (`requester_seen_at IS NULL`). | RPC `my_transfer_notifications` (`20260514020000`) | `GET /notifications` unificado | intencional |
| R-TRF-4 | O histórico traz `service_date` e `has_tracking_code` porque o diálogo de interação precisa aplicar a regra das 18h ali também. | RPC `my_transfer_history` (`20260529000000:6-13`) | desnecessário: a API decide a regra; a resposta traz `canAddInteraction` + `unlocksAt` | intencional hoje, **removível** na v2 |
| R-TRF-5 | `assigned_by_manager_id IS NULL` distingue transferência entre colegas de redistribuição feita pela gestora. | `20260528000400:~20` | campo `origin: "peer" \| "manager" \| "claim" \| "takeover"` | intencional |
| R-TRF-6 | Aceitar a transferência redireciona para `/workspace/atendimentos?openTicket=<id>`, que abre o diálogo de acompanhamento e limpa a URL. | `src/pages/agent/Atendimentos.tsx:378-388` | mantido no front | intencional |
| R-TRF-7 | O status da transferência é `pending`/`accepted`/`declined`/`cancelled`. | `ticket_transfers.status` | enum | intencional |
| R-TRF-8 | Toda tomada de ticket (claim ou takeover aprovado) grava uma linha `accepted` em `ticket_transfers` para o histórico ficar completo. | `claim_ticket`, `approve_ticket_takeover`, `manager_reassign_tickets` | evento em `notifications`/histórico de ticket | intencional |
| R-TRF-9 | O agente escreve em `ticket_transfers` por policy direta (`Agents create transfers as sender`, `Agents update own transfers`) — não por RPC. | policies em `20260514010000` / `20260727120000` | toda escrita passa pela API; sem policy de escrita para o cliente | intencional (a v2 fecha a superfície) |
| R-TRF-10 | Um `.update()` em `ticket_transfers` barrado por RLS devolve **sucesso com 0 linhas** — a UI acha que salvou. | comportamento do PostgREST + `src/features/transfers/NotificationsBell.tsx` | a API devolve `404`/`403` explícito; `affectedRows = 0` é erro | **bug-virou-comportamento** (o "sucesso falso" citado no contrato) |

---

## 6. Tomada de ticket (aprovação da gestora)

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TKO-1 | Só se pede tomada quando o dono operacional está **de folga** (`is_available = false`); com o dono disponível, o RPC recusa e manda encaminhar. | `request_ticket_takeover` (`20260717120500:~128-135`) | `422 OWNER_IS_AVAILABLE` | intencional |
| R-TKO-2 | Não se pede tomada de ticket concluído. | idem (`:~110`) | `422 TICKET_ALREADY_CONCLUDED` | intencional |
| R-TKO-3 | Não se pede tomada de ticket que já é meu. | idem (`:~120`) | `422 ALREADY_OWNER` | intencional |
| R-TKO-4 | Dono operacional efetivo = `current_owner_id`, caindo para `user_id` se nulo. | idem (`:~117`) | `current_owner_id` é `NOT NULL` na v2, o fallback morre | acidente (defesa contra dado antigo) |
| R-TKO-5 | Um único pedido **pendente** por (ticket, solicitante); a violação de unicidade vira mensagem em português. | índice `idx_unique_pending_takeover` + `EXCEPTION WHEN unique_violation` | `409 TAKEOVER_ALREADY_PENDING` | intencional |
| R-TKO-6 | Só quem tem `role='manager'` **e** `can_approve_takeovers` vê a fila e responde. | `manager_takeover_notifications`, `approve_ticket_takeover`, `reject_ticket_takeover` | capacidade `canApproveTakeovers` no middleware | intencional |
| R-TKO-7 | Aprovar move `current_owner_id` para o solicitante **e** marca `takeover_approved_at`/`_by` no ticket. | `approve_ticket_takeover` (`20260717120500:~300`) | `POST /takeovers/:id/approve` | intencional |
| R-TKO-8 | Tanto o pedido quanto o ticket são travados com `FOR UPDATE`; pedido já respondido recusa. | idem | transação + `409 ALREADY_ANSWERED` | intencional |
| R-TKO-9 | Recusar sobrescreve a nota do pedido com a justificativa da gestora (`note = COALESCE(nova, antiga)`) — a nota original do agente é **perdida**. | `reject_ticket_takeover` (`20260717120500:~395`) | duas colunas: `requesterNote` e `responseNote` | **bug-virou-comportamento** |
| R-TKO-10 | A aba Usuários mostra quantos tickets em aberto de cada agente foram **autorizados** pela gestora (`authorized_open_count`). | `manager_list_users` (`20260717120500:~430`) | `GET /users` | intencional |

---

## 7. Reembolsos

### 7.1 Ciclo de vida

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-REF-1 | Reembolso **em aberto** é o que tem `completion_date IS NULL`; **concluído** é o que tem data. Não existe coluna de status. | `src/pages/agent/Reembolsos.tsx:78-79` | coluna `status` derivada/materializada | intencional, mas frágil |
| R-REF-2 | Um atendimento com motivo `reembolso` **cria** o registro em Reembolsos, na mesma transação. | trigger `trg_service_sync_refund_ins` → `sync_refund_from_service` (`20260806150000:189-195`) | caso de uso `CreateTicket` cria o reembolso na mesma transação; trigger de invariante opcional | intencional |
| R-REF-3 | Se já existe reembolso **em aberto** do mesmo agente para o mesmo cliente+pedido cadastrado à mão, a automação **vincula** em vez de duplicar. | `sync_refund_from_service` (`...:140-154`) | mesma regra no caso de uso | intencional |
| R-REF-4 | Enquanto o reembolso está em aberto, editar o atendimento **atualiza** e-mail, pedido, produto, plataforma, canal, data e dono. Nunca toca motivo, tipo, valor, itens devolvidos nem a baixa. | `sync_refund_from_service` (`...:171-184`) | mesmo conjunto de campos, explicitado no caso de uso `UpdateTicket` | intencional |
| R-REF-5 | Reembolso com baixa dada é histórico: não é alterado nem apagado, aconteça o que acontecer com o atendimento. | `... AND r.completion_date IS NULL` no `UPDATE` (`...:185`) | invariante na v2 | intencional |
| R-REF-6 | Tirar o motivo `reembolso` (ou apagar o atendimento) só remove o reembolso se ele **nasceu** da automação (`created_from_service`), **ninguém assumiu** (`picked_up_at IS NULL`), não tem baixa e **nenhum** campo do fluxo foi preenchido (motivo, tipo, valor, itens). | `sync_refund_from_service` (`...:112-124`) e `cleanup_refund_of_deleted_service` (`...:~245`) | mesma condição de 7 termos, num predicado nomeado `isPristineAutoRefund` | intencional (é a regra que protege trabalho feito) |
| R-REF-7 | Reembolso criado pelo atendimento entra **"apagado"** na aba do agente; assumir acende a linha e registra quem e quando. | coluna `picked_up_at`/`picked_up_by` + RPC `pick_up_refund` (`20260806150000:~255`) | `POST /refunds/:id/pickup` | intencional |
| R-REF-8 | Só o dono do reembolso (ou gestora) assume, e só se ainda não assumido e sem baixa. | `pick_up_refund` (`...:~268`) | `422`/`409` conforme o caso | intencional |
| R-REF-9 | **Um** reembolso por atendimento (índice único parcial em `service_id`). | `refunds_service_id_uniq` (`20260806150000:88-89`) | mesma constraint | intencional |
| R-REF-10 | Apagar o atendimento deixa o reembolso **com trabalho** órfão mas visível (`FK ON DELETE SET NULL`), em vez de apagá-lo. | `refunds_service_id_fkey` (`...:52-56`) | mesma semântica | intencional |
| R-REF-11 | **Não houve backfill**: atendimentos antigos com motivo reembolso não geraram registro retroativo. | `20260806150000:28-29` | documentar como lacuna de dado; o backfill da v2 não deve inventar esses reembolsos | intencional |

### 7.2 Baixa (conclusão)

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-REF-12 | A baixa exige data de conclusão, valor, percentual, motivo e o flag de itens devolvidos. | `completeSchema` em `src/features/refunds/CompleteRefundDialog.tsx:69-82` (agente) e `manager_complete_refund` (`20260728120000:~100-125`) (gestora) | `POST /refunds/:id/complete`, validação única | intencional |
| R-REF-13 | **[M6]** O percentual é um de 20 valores fechados: `05%`…`100%`, de 5 em 5. Medido no banco: **21 variantes**, maior grupo **vazio (1.242 linhas)**, `05%` com zero à esquerda e os demais sem, e `95%` existindo com 1 linha. | cliente: `PERCENT_OPTIONS` (`CompleteRefundDialog.tsx:27-30`) · servidor: regex em `manager_complete_refund` (`20260728120000:~117`) | coluna `refund_percent smallint` (0–100), rótulo formatado na tela (§19.16, `12` §4.1) | intencional, mas duplicado em dois lugares e guardado como texto ordenável errado |
| R-REF-14 | O motivo da baixa é um de 15 rótulos fechados. | `REASON_OPTIONS` (`CompleteRefundDialog.tsx:32-48`) | enum no contrato | intencional |
| R-REF-15 | **[M3]** Data de conclusão **no futuro** é recusada, e **anterior à solicitação** também — mas só no caminho da gestora. | só em `manager_complete_refund` (`20260728120000:~104-112`) | validado em `POST /refunds/:id/complete` para **todos**. Custo medido: **39 linhas** do histórico de 2026 violam "baixa anterior à solicitação" e **zero** violam "baixa incompleta" (§19.6) | **bug-virou-comportamento**: o caminho do **agente** é um `.update()` direto na tabela e não valida nada disso |
| R-REF-16 | A baixa feita pela gestora é auditada em `refund_manager_completions`, com `days_overdue`. | `manager_complete_refund` (`...:~150`) | `refund_events` (append-only) para **toda** baixa, não só a da gestora | intencional (ampliar) |
| R-REF-17 | `days_overdue` é calculado como `hoje − request_date`, **não** `completion_date − request_date`. | `manager_complete_refund` (`...:~134`) | explicitar qual dos dois é o correto | **DECISÃO NECESSÁRIA** — parece bug |
| R-REF-18 | **[M3] RESOLVIDO no desenho.** O agente dá a própria baixa com `.update()` direto na tabela, sem RPC e sem auditoria. | `src/pages/agent/Reembolsos.tsx:212` e `:267` | `POST /refunds/:id/complete` **única**, com a validação estrita da gestora valendo para todos e `refund_events` auditando toda baixa (§19.6) | **bug-virou-comportamento** (assimetria agente↔gestora) |
| R-REF-19 | O agente pode **apagar** um reembolso próprio, sem log. | `src/pages/agent/Reembolsos.tsx:242` + policy "Users delete own refunds" | `DELETE /refunds/:id` — **DECISÃO**: soft-delete? | a decidir |

### 7.3 Valores e classificação

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-REF-20 | O **valor efetivamente devolvido** é `refund_value × percentual/100`, arredondado a 2 casas; devolve `NULL` se o tipo não casar com `^\d{1,3}%$` ou estiver fora de 0–100. | `my_refunds_with_refunded_value` (`20260806150000:~330-345`) e função `refund_refunded_value` (`20260817200000`) | coluna gerada ou campo calculado na API, uma definição só | intencional |
| R-REF-21 | Cada reembolso recebe uma **categoria** derivada do motivo, por `classify_refund_reason`, mantida por trigger em `refund_reason_classifications`. | `20260520010000_create_refund_reason_classifications.sql` | mesma tabela; a classificação passa a rodar no caso de uso | intencional |
| R-REF-22 | A partir de jun/2026 `original_reason` repete o rótulo do menu: texto livre do cliente só existe até maio/2026. | memória do projeto + `reference_refund_reason_texto_livre` | documentado; nenhuma tela deve prometer texto livre em período novo | intencional |
| R-REF-23 | **[D4] Todo valor monetário do sistema é dólar.** Hoje é incoerente: as telas do copy convertem por `app_settings.usd_brl_rate` e as da gestora exibem o mesmo número como se fosse real. O dono confirmou que o dado **sempre foi** dólar — a conversão e a cotação eram o erro, não o rótulo. | `usd_brl_rate()` + CTE `base` em `copy_refund_reason_analytics` (`20260828160000`); os dois rótulos errados foram corrigidos no legado em 26/09/2026 (`RefundReasonDetailModal.tsx:35`, `reportExport.ts`) | **toda** rota que devolve dinheiro devolve `{ amount, currency: "USD" }`, para o rótulo não poder divergir do dado. `usd_brl_rate` e a conversão **deixam de existir** (§8-A/D4) | **era** bug-virou-comportamento; fechado por §8-A/D4 |
| R-REF-24 | **[M5]** `refunds.sales_platform` é fechado em 8 valores **no cliente** e livre no banco. Medido: **10 valores no banco** — `Hotmart` (143) e `PagAmerican` (139) existem e não estão no seletor. Um `CHECK` com a lista da tela rejeitaria 282 linhas reais. | `SALES_PLATFORMS` em `src/features/refunds/types.ts:23` | tabela `sales_platforms` semeada com os 10 medidos + flag `is_selectable` (§19.15, `12` §4.5) | acidente |
| R-REF-25 | `refunds.product` é lista fechada **no cliente** (~75 nomes, espelho de `services.product`) e `text` livre no banco. | `REFUND_PRODUCTS` em `src/features/refunds/types.ts:26+` | FK para `products` | acidente (duas listas que podem divergir) |
| R-REF-26 | O alerta de reembolso atrasado da gestora tem sua própria RPC. | `manager_refund_alerts` (`20260421100000`) | `GET /refunds/alerts` | intencional |
| R-REF-27 | "% interno" no comparativo interno×externo é `CASADOS ÷ total` (regra do gestor, PR #70), e o casamento depende da plataforma. | memória `project_comparativo_reembolso_externo` | `GET /metrics/refunds/external-comparison` | intencional |

---

## 8. Métricas e auditoria

### 8.1 A definição de "atendimento" — a regra mais importante do sistema

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-MET-1 | **Cada interação vale 1.** A criação do ticket é 1 evento na `service_date`; cada follow-up é 1 evento no `recorded_at`. Todas as métricas saem dessa mesma função. | `_interaction_events(from, to, agent_id)` (`20260528000300`) | tabela `interaction_facts` (§12) — mesma semântica, materializada | intencional |
| R-MET-2 | O evento de **criação** é creditado a `services.user_id` (o criador, imutável); o evento de **follow-up** é creditado a `service_follow_ups.user_id` (quem escreveu). | idem | `interaction_facts.actor_id` | intencional |
| R-MET-3 | O "dia" do evento é o dia em **America/Sao_Paulo**, obtido por `(... AT TIME ZONE 'America/Sao_Paulo')::date`. | idem | `interaction_facts.business_day date` | intencional |
| R-MET-4 | Garantia de consistência exigida entre RPCs: `agent_daily_metrics(d).my_count == dashboard_metrics(d,d,uid).total_count` e `agent_my_metrics(f,t).total_count == dashboard_metrics(f,t,uid).total_count` e `SUM(by_day[*].value) == total_count`. | `20260525000200:5-13` | mesma garantia, verificada por teste | intencional — **é contrato, não coincidência** |
| R-MET-5 | Interações que furam a regra das 18h **entram** na contagem (não são descontadas); o gestor vê o desvio separado. | `dashboard_same_day_repeats` (`20260727140000:~150`) | `GET /metrics/same-day-repeats` | intencional |
| R-MET-6 | `same_day_extra` (interações além da primeira no mesmo ticket no mesmo dia) e `rule_violations` (subconjunto que furou as 18h) são **números diferentes**: um follow-up às 19h do mesmo dia é permitido pela regra mas ainda conta 2× no dia. | `20260727140000:~120-135` | dois campos distintos, com os nomes preservados | intencional |
| R-MET-7 | A quebra por agente do desvio traz **percentual sobre o total do próprio agente**, porque volume absoluto puniria quem trabalha mais. | `20260727140000:~185` | idem | intencional |
| R-MET-8 | Vários RPCs excluem follow-up do mesmo dia quando o ticket tem `has_tracking_code`, para não contar duas vezes a interação de código de rastreio. | `dashboard_same_day_repeats` (`...:~127`), `CLAUDE.md` | explicitado por endpoint em `11` | intencional |

### 8.2 Métricas do agente

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-MET-9 | O card diário mostra minha contagem do dia, o líder do time no dia (nome e contagem) e se eu sou o líder; empate é desfeito por `user_id ASC`. | `agent_daily_metrics` (`20260525000200:22-73`) | `GET /metrics/me?day=` | intencional |
| R-MET-10 | `active_days` = dias em que o agente registrou ≥1 evento; `my_rate` = total ÷ `active_days` ("ritmo por dia trabalhado"). | `agent_my_metrics` (`20260817140000:~150-165`) | `GET /metrics/me?from&to` | intencional |
| R-MET-11 | A comparação com o time usa a **mediana do ritmo dos outros agentes**, não a média, porque a média é sensível a outlier; quem não teve evento no período **não entra** na mediana. | `agent_my_metrics` (`20260817140000:~300-330`) | idem | intencional |
| R-MET-12 | **Meta diária** = 150 se a maioria dos tickets do agente é canal `SMS`, senão 100. O cálculo é feito no browser sobre o array de tickets carregado. | `src/pages/agent/Atendimentos.tsx:471-476` | `GET /me` devolve `dailyGoal` e `supportChannel`; a derivação passa a ser do servidor | **bug-virou-comportamento**: o array do cliente está filtrado pelos últimos 30 dias e pelo recorte de data da tela, então a meta **muda conforme o filtro**. `profiles.support_channel` existe e é ignorada (R-CAP-9). |
| R-MET-13 | A tendência compara o ritmo da 2ª metade do período com o da 1ª, dividindo por dias **ativos** de cada metade, ignorando datas futuras, com banda neutra de ±10%. | `agent_my_metrics` (`20260817140000:~200-250`) | idem | intencional |
| R-MET-14 | A tendência só é "confiável" com ≥2 dias trabalhados em **cada** metade e ritmo da 1ª metade > 0; a UI esconde o card quando não é. | `v_trend_reliable` (`20260817140000:~240`) | campo `trendReliable` no payload | intencional |
| R-MET-15 | Todos os campos legados do payload (`team_average`, `gap_to_avg_pct`, `is_below_team_avg_20pct`, `benchmark_*`, `total_interactions`, `avg_daily`) continuam sendo devolvidos para não quebrar consumidor. | `20260817140000:32-34` | **DECISÃO**: a v2 pode cortar os aliases legados — ver §19 | acidente acumulado |
| R-MET-16 | "Total de atendimentos" do período na tela do agente vem da RPC (interações), **exceto** quando há busca por e-mail ou filtro de rastreio ativo — aí passa a ser a contagem da tabela filtrada, como "resultados encontrados". | `src/pages/agent/Atendimentos.tsx:449-465` | `GET /tickets` devolve `totalInteractions` no mesmo recorte, e o front deixa de trocar a semântica do número | intencional, mas o número muda de significado sem o usuário saber |
| R-MET-17 | Os reembolsos das métricas do agente contam **em aberto por `request_date`** e **concluídos por `completion_date`**, ambos no período. | `agent_my_metrics` (`20260817140000:~275-290`) | idem | intencional |
| R-MET-18 | O check-in do agente conta, em duas janelas (últimas 2 h e hoje desde a meia-noite de SP), tickets criados, follow-ups, reembolsos criados e reembolsos concluídos — **8 requisições `count: exact, head: true` em paralelo, direto nas tabelas**. | `src/features/agent/check-in/useCheckInSnapshot.ts:44-110` | `GET /metrics/me/check-in` — uma chamada | **bug-virou-comportamento**: reembolso concluído "nas últimas 2 h" é impossível de saber (`completion_date` é `date`), então as duas janelas devolvem o mesmo número, conforme o próprio comentário do código |
| R-MET-19 | As janelas do check-in usam `created_at` (instante real), enquanto as métricas usam `service_date` (data fixada). Os dois números **podem divergir** para um ticket criado depois das 21h de SP. | `useCheckInSnapshot.ts` vs. `_interaction_events` | unificar em `business_day` | acidente |

### 8.3 Métricas e auditoria da gestora

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-MET-20 | Toda RPC de analytics é guardada por `can_view_support_analytics()` = gestora **ou** copy; nenhuma RPC de gestão foi aberta ao copy. | `20260824120000` (lista explícita nas linhas 10-16) | capacidade `canViewSupportAnalytics` no middleware | intencional |
| R-MET-21 | `dashboard_metrics` devolve total, quebra por agente, por produto (top 10), por dia (série completa, com zeros), por plataforma e por canal. | `20260824120000:745-830` | `GET /metrics/dashboard` | intencional |
| R-MET-22 | A série por dia é preenchida com `generate_series` — dia sem evento aparece com 0, não desaparece. | idem (`:786-802`) | idem | intencional |
| R-MET-23 | `by_agent` inclui **qualquer** autor de evento, não só `role='agent'`. | idem (`:764-774`) | idem | intencional |
| R-MET-24 | A tabela de Interações (`dashboard_follow_up_detail`) sempre mostra **todos** os agentes, inclusive os zerados: o universo é "quem registrou evento" ∪ "todo perfil com `role='agent'`". | `20260824120000:270-276` | `GET /metrics/follow-ups` | intencional |
| R-MET-25 | "Concluído" de um ticket, nas telas da gestora, é `services.status='concluido' OR último follow-up='concluido'`, e o último follow-up é escolhido por `follow_up_number DESC NULLS LAST` (não por `recorded_at`). | `dashboard_follow_up_detail` (`20260824120000:238-247`) vs. `manager_list_open_tickets_by_agent`, que usa `recorded_at DESC` | uma definição só: `tickets.derived_status` materializado | **bug-virou-comportamento**: duas telas ordenam o "último follow-up" por critérios diferentes e, com `follow_up_number` repetido (R-INT-6), podem discordar |
| R-MET-26 | A taxa de conclusão por agente é `concluídos ÷ tickets abertos no período`, creditada a quem **abriu** o ticket. | `dashboard_follow_up_detail` (`...:290-296`) | idem | intencional |
| R-MET-27 | A auditoria lista **uma linha por interação** — é espelho de `_interaction_events`, não de tickets. | `dashboard_audit` (`20260904120000_dashboard_audit_uma_linha_por_interacao.sql`) | `GET /audit` | intencional (alinhamento feito em 04/09) |
| R-MET-28 | `dashboard_channel_detail` foi reescrita sobre `_interaction_events` em 27/07 e a divergência com o gráfico foi validada em 0; `dashboard_follow_up_detail` (Interações) **ainda usa a regra antiga**. | memória `project_channel_detail_divergencia` | ambas sobre `interaction_facts` | **bug conhecido, não corrigido** |
| R-MET-29 | Eficiência por canal em reembolso: parcial = `refund_type` informado e ≠ `'100%'`; integral = `'100%'`; as taxas são **dentro do canal** e somam 100% quando todo concluído tem tipo. | `20260904120000_refund_channel_efficiency_percentuais.sql:6-7,242-243` | `GET /metrics/refunds` | intencional |
| R-MET-30 | **[D7] A paginação numerada permanece, com total.** A auditoria e o detalhe de reembolso paginam com `page_size`/`page_offset`, e as telas mostram "Página 3 de 12". | `dashboard_audit`, `dashboard_refund_audit`, `dashboard_refund_reason_detail` | **mantida numerada, com `totalCount`**, em Reembolsos (2 abas), auditoria de atendimentos, auditoria de reembolsos e detalhe de motivo. Só "Meus Atendimentos" usa cursor. O diagnóstico anterior estava incompleto: o custo não é o `OFFSET`, é o predicado não indexável que ele percorre (§8-A/D7) | intencional — a proposta de emenda da trilha (trocar tudo por keyset) foi **recusada** |
| R-MET-31 | **[D3]** O **Acompanhamento** avalia 8 semanas por agente: meta semanal 500 (e-mail) / 750 (SMS); abaixo da meta mas ≥450/675 = "alerta"; abaixo de 400/600 = "advertência"; **2 alertas acumulados viram 1 advertência**; 3 advertências = "risco contratual". | **tudo no cliente**: `GOALS` (`src/pages/DashboardAcompanhamento.tsx:33-36`) e `evaluateAgents` (`:148-204`) | `GET /metrics/compliance` calcula no servidor; metas, faixas e a regra de acúmulo viram **configuração com vigência** em `goal_policies` (`12` §6.8), para responder "qual era a meta em agosto". Valores iniciais **idênticos** aos de hoje, de modo que o corte não mude a avaliação de ninguém (§8-A/D3) | **decidido**: sai do browser, com a funcionalidade inteira preservada |
| R-MET-32 | O canal do agente no Acompanhamento é derivado do **mesmo jeito** que na tela do agente (maioria SMS), mas sobre outro recorte de dados. | `src/pages/DashboardAcompanhamento.tsx:110-122` | uma definição só, no servidor | acidente (duas derivações da mesma coisa) |
| R-MET-33 | `dashboard_status_summary` existe para olhar exatamente o **mesmo universo** do gráfico e é guardada por `is_manager()` puro (copy não vê). | `20260810120000_status_summary_mesmo_universo_do_grafico.sql` | `GET /metrics/status-summary` | intencional |
| R-MET-34 | `agent_metrics_range` e `agent_product_mix` continuam vivas e chamadas pelo front, mas nunca foram reescritas sobre `_interaction_events`: contam pela regra antiga. | `20260131001710_...sql` (última definição) + `src/features/agent/useMyMetricsRangeQuery.ts`, `useMyProductMixQuery.ts` | consolidar em `GET /metrics/me` | **bug-virou-comportamento**: podem discordar de `agent_my_metrics` para o mesmo período |
| R-MET-35 | `agent_daily_service_counts` é uma tabela de contagem mantida pelo trigger `services_refresh_agent_daily_counts`, e **nenhuma tela a lê**. | `20260131001710_...sql` | precursor de `daily_rollups`; ver §12 | acidente (rollup abandonado) |

---

## 9. Pedidos em espera (held orders)

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-HLD-1 | Pedidos retidos entram por CSV que a gestora envia; o agente só trabalha o que lhe foi distribuído. | `manager_import_held_orders` (`20260805120000:132+`) | `POST /held-orders/import` (com `Idempotency-Key`) | intencional |
| R-HLD-2 | A **identidade do pedido** é `(dyna_code, import_key)`, onde `import_key` é `order_number` quando existe, senão o hash do conteúdo da linha. Nas devoluções, o `rma` entra na identidade, porque `dyna_code` é a constante `'RETURNS'` e um pedido pode voltar em vários RMAs. | `20260805120000:19-27` | mesma chave, explicitada em `12` | intencional |
| R-HLD-3 | Só é repetição se **já existe** linha daquele pedido ainda em aberto (`agent_status <> 'concluido'`). Pedido concluído que volta a ficar retido é trabalho novo. | `20260805120000:28-31` + índice `held_orders_one_open_per_identity_uniq` | mesma constraint parcial | intencional |
| R-HLD-4 | A importação **nunca é silenciosa**: devolve `{ total, inserted, duplicates, empty_rows, duplicate_orders (amostra de até 20), skipped }`. `skipped` é mantido só porque bundles antigos em cache ainda o leem. | `20260805120000:121-131` | mesmo payload; `skipped` marcado como deprecado | intencional |
| R-HLD-5 | Linha repetida não é apagada: é **marcada** com `duplicate_of` apontando para a linha boa, sai da lista do agente e das contagens, e continua visível para a gestora. | `20260805120000:41-47,100-112` | mesma coluna | intencional |
| R-HLD-6 | **Um cliente, um agente**: a unidade de distribuição é o cliente, não a linha. Identidade do cliente = e-mail normalizado → nome → a própria linha. | `held_order_client_key` (`20260806140000:30-51`) | mesma função, `IMMUTABLE`, indexada | intencional |
| R-HLD-7 | Se o cliente já tem pedido em aberto com um agente **ativo**, todo pedido novo dele vai para esse mesmo agente, mesmo fora do round-robin. | `manager_distribute_held_orders` (`20260806140000:117+`) | `POST /held-orders/distribute` | intencional |
| R-HLD-8 | Linhas do mesmo cliente que estavam com **outro** agente são movidas junto, e a resposta informa quantas — para a gestora saber. | idem | idem | intencional |
| R-HLD-9 | A invariante "nenhum cliente com dois agentes em aberto" é garantida por **trigger**, não só pela RPC, e a validação só olha linhas cujo `assigned_to` mudou naquela instrução, para não travar mudança de status. | `held_orders_client_single_agent` + triggers `_ins`/`_upd` (`20260806140000:351-390`) | trigger de invariante mantido | intencional |
| R-HLD-10 | Pedido concluído é histórico: não entra na conta de distribuição nem é movido. | `20260806140000:22` | idem | intencional |
| R-HLD-11 | Distribuição em lote exige ≥1 agente destino e recusa agente inexistente ou inativo. | `manager_distribute_held_orders` (`20260806140000:139-160`) | `400`/`422` | intencional |
| R-HLD-12 | O agente move o pedido entre `novo` → `em_andamento` → `concluido`, com observação e uma **tag de pendência** opcional. | `set_held_order_status` (`20260729120000:68-141`) | `PATCH /held-orders/:id/status` | intencional |
| R-HLD-13 | A tag de pendência é fechada em 4 valores: `pedido_nao_encontrado`, `aguardando_cliente`, `aguardando_transportadora`, `outra`. | `held_orders_pending_tag_chk` (`20260729120000:30-39`) | enum | intencional |
| R-HLD-14 | Concluir **limpa** a tag de pendência: não há o que acompanhar depois. | `20260729120000:99-102` | idem | intencional |
| R-HLD-15 | `confirmed_at` só é gravado ao **entrar** em `concluido` (não é reescrito se já estava); sair de `concluido` limpa `confirmed_at` e `confirmed_by`. | `set_held_order_status` (`20260729120000:118-131`) | idem | intencional |
| R-HLD-16 | Toda mudança de status grava uma linha em `held_order_events` (histórico append-only, com tag e nota). | idem (`:136-137`) | idem | intencional |
| R-HLD-17 | O agente só mexe em pedido atribuído a ele — a linha é travada com `FOR UPDATE` e o `WHERE` inclui `assigned_to = eu`. | idem (`:108-113`) | `404` quando não é dele | intencional |
| R-HLD-18 | A meta diária de pedidos em espera é **30**, fixa no corpo da RPC, e conta o que **eu** confirmei hoje (SP); "pendente" conta o que está atribuído a mim e não concluído, ignorando repetições. | `my_held_orders_daily_metrics` (`20260805120000:365-400`) | `GET /held-orders/metrics/me`; a meta vira configuração | intencional (meta hard-coded é acidente) |
| R-HLD-19 | Na visão da gestora o badge é derivado assim: `concluido` → "Confirmado"; `em_andamento` → "Em andamento"; `assign_count = 0` → "Novo"; resto → "Pendente N". | `20260810170000:20-25` + `HeldOrdersManagerTab.tsx` | campo `managerStatus` calculado na API | intencional, mas derivado no cliente |
| R-HLD-20 | `held_orders.status` (`pending`/`confirmed`) é **legado** espelhado a partir de `agent_status`, mantido para clientes antigos. | `set_held_order_status` (`20260729120000:115-117`) | **uma** coluna de status na v2 | acidente (duas colunas para a mesma coisa) |
| R-HLD-21 | `confirm_held_order` existe no banco e **nenhuma tela a chama**: foi substituída por `set_held_order_status`. | `20260617000000:329` vs. ausência em `src/` | não migra — ver "Propostas de remoção" | acidente |

---

## 10. Radar de pendências

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-RAD-1 | Todo caso pendente tem dono, ação necessária e **data do próximo acompanhamento**. | `radar_items` (`20260825120000:38-88`) | `POST /radar` | intencional |
| R-RAD-2 | **A regra central**: enquanto o caso não está `resolvido`/`cancelado`, `next_follow_up_date` é obrigatória; quando fecha, é limpa. Os dois sentidos amarrados numa constraint com `=` entre booleanos. | `radar_items_next_date_chk` (`20260825120000:81-83`) | mesma constraint | intencional |
| R-RAD-3 | `closed_at` existe **se e somente se** o status é `resolvido`/`cancelado`. | `radar_items_closed_at_chk` (`:84-86`) | idem | intencional |
| R-RAD-4 | O tipo do caso é fechado em 9 valores; o status em 6. | `radar_items_kind_chk`, `radar_items_status_chk` (`:58-76`) | enums | intencional |
| R-RAD-5 | O mesmo agente não abre dois casos iguais (mesmo e-mail + pedido + tipo) **ao mesmo tempo**; fechado não conta, então o cliente pode voltar com o mesmo problema depois. | índice `radar_items_open_uniq` (`:107-108`) | mesma constraint parcial | intencional |
| R-RAD-6 | Data de próximo acompanhamento **no passado** é recusada na criação e no registro de ação. | `radar_create_item` (`:243`), `radar_register_action` (`:383`) | `422 FOLLOW_UP_DATE_IN_PAST` | intencional |
| R-RAD-7 | Status e `closed_at` **nunca** são editados soltos: só mudam por `radar_register_action`, junto com o evento de histórico correspondente. | `20260825120000:14-18,343+` | `POST /radar/:id/actions` | intencional |
| R-RAD-8 | Reabrir um caso que colidiria com outro caso em aberto é recusado. | `radar_register_action` (`:405`) | `409 RADAR_DUPLICATE_OPEN` | intencional |
| R-RAD-9 | Os baldes do resumo são **disjuntos**: atrasado (`< hoje`), hoje (`= hoje`) e próximos 7 dias (`> hoje` e `<= hoje+7`) nunca contam o mesmo caso. | `my_radar_items` (`20260825120000:~545`) | `GET /radar/summary` | intencional |
| R-RAD-10 | A aba "Resolvidos" mostra os últimos **30 dias** de casos fechados. | `my_radar_items` (`:~489`) | parâmetro explícito | intencional |
| R-RAD-11 | A gestora **já enxerga** os dados do Radar por RLS, mas a tela dela nunca foi entregue. | policy `radar_items_select` (`:151`) + `20260825120000:31-33` | `GET /radar` com filtro de agente para gestora | intencional (feature pendente, não regra faltando) |
| R-RAD-12 | Nenhuma FK do Radar tem `ON DELETE` em `profiles`: perfil é desativado, nunca apagado, e histórico não pode sumir junto. | `20260825120000:34-36` | mesma decisão | intencional |

---

## 11. Caderno do agente

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-NOT-1 | Cada anotação está presa a **um dia** (`note_date`), e o padrão é hoje **em São Paulo** — não o dia UTC, senão a anotação das 21h cairia na página de amanhã. | `agent_notes.note_date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)` (`20260826120000:~41`) | `POST /notes` resolve o dia na borda | intencional |
| R-NOT-2 | Mudar a data de uma anotação é ação **explícita** do agente ("trazer para hoje"), nunca automática: pendência que se move sozinha deixa de ser histórico. | `20260826120000:10-13` | `PATCH /notes/:id` com `noteDate` | intencional |
| R-NOT-3 | **A gestora não lê o caderno.** Decisão de produto: é rascunho pessoal; se o agente souber que alguém lê, volta para o papel. A policy é única e simétrica — dono lê, dono escreve, mais ninguém. | `agent_notes_own` (`20260826120000:120-123`) + justificativa `:15-19` | a API **não expõe** nenhuma rota de leitura de caderno de terceiro, nem para gestora | intencional — **não negociável sem decisão do dono** |
| R-NOT-4 | Só `tarefa` pode ser concluída; `nota` marcada como concluída não significaria nada e faria o contador de pendentes mentir. | `agent_notes_done_kind_chk` (`:61`) | mesma constraint | intencional |
| R-NOT-5 | `done` e `done_at` andam juntos: `done = (done_at IS NOT NULL)`. | `agent_notes_done_at_chk` (`:63`) | idem | intencional |
| R-NOT-6 | Corpo obrigatório, no máximo 4000 caracteres. | `agent_notes_body_chk` (`:57`) | idem | intencional |
| R-NOT-7 | Anotação fixada aparece no topo da página. | coluna `pinned` | campo no payload | intencional |
| R-NOT-8 | O caderno é CRUD puro por RLS, **sem RPC**, porque não há regra de negócio cruzada. | `20260826120000:22-24` | passa a ir pela API como tudo o mais | intencional |

---

## 12. Base de suporte

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-BAS-1 | O conteúdo mora no banco (substituiu um HTML solto com senha no JS e edições em `localStorage`). | `20260817180000_base_suporte.sql:1-6` | `GET /support-base`, `PATCH`/`POST` para gestora | intencional |
| R-BAS-2 | Três tabelas: `support_products` (painel E-mail), `support_sms_brands` (painel SMS), `support_sms_replies` (mensagens prontas EN+PT por categoria). | `20260817180000:40,72,95` | mesmas três, ver §12 | intencional |
| R-BAS-3 | **Leitura: qualquer autenticado. Escrita: só `is_manager()`.** Sem RPC — policy direta, porque é CRUD sem regra. | policies `*_select`/`*_write` (`20260817180000:139-157`) | capacidade no middleware | intencional |
| R-BAS-4 | `updated_at`/`updated_by` são gravados por trigger (`support_base_touch`), não pelo cliente. | `20260817180000:24-35` | trigger de invariante | intencional |
| R-BAS-5 | Nome de produto e de marca SMS são **únicos** (índice único sobre o nome normalizado). | `support_products_nome_uniq`, `support_sms_brands_nome_uniq` | mesma constraint | intencional |
| R-BAS-6 | `estrutura` é fechada em `nova`/`antiga`; `bonus_tipo` em `simples`/`super` ou nulo; `links` precisa ser um array JSON. | `20260817180000:58-60,84` | enums + validação Zod | intencional |
| R-BAS-7 | A ordem de exibição vem de uma coluna `ordem` indexada. | `idx_support_products_ordem` etc. | campo `sortOrder` | intencional |
| R-BAS-8 | A Base de Suporte **saiu** da sidebar do copy (commit `c001104`), mas a policy de leitura continua liberando para ele. | `src` vs. policy | front esconde, API libera — alinhar | acidente inofensivo |

---

## 13. Treinamento

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-TRN-1 | Qualquer autenticado lê os vídeos **publicados** (`is_published`); a gestora gerencia o catálogo. | policies "Authenticated can read published training videos" / "Managers can manage training videos" (`20260509000000`) | `GET /training/videos`, `POST/PATCH` gestora | intencional |
| R-TRN-2 | O progresso é um **upsert** por `(user_id, video_id)`, com `watched_seconds` arredondado e nunca negativo, e `last_watched_at` vindo do **cliente**. | `src/features/training/useTrainingVideoViewMutation.ts:17-27` | `PUT /training/videos/:id/progress`; `lastWatchedAt` passa a ser `now()` no servidor | **bug-virou-comportamento**: o instante é escolhido pelo browser |
| R-TRN-3 | O agente lê e escreve só o próprio progresso; a gestora lê o de todos. | policies "Agents can read/insert/update own training views", "Managers can read all training views" | RLS equivalente na API | intencional |
| R-TRN-4 | Os vídeos ficam num bucket de storage com leitura para autenticado e escrita para gestora. | policies "Authenticated can read training-videos bucket" / "Managers can write" | mantido (Supabase Storage continua) | intencional |
| R-TRN-5 | O vídeo tem `section`, `display_order`, `duration_seconds`, `thumbnail_url` e `description` — nenhum deles com validação além de `NOT NULL` em `section` e `title`. | tabela `training_videos` | validação Zod | intencional |
| R-TRN-6 | `completed` é decidido pelo cliente, não derivado de `watched_seconds ÷ duration_seconds`. | `useTrainingVideoViewMutation.ts:23` | **DECISÃO**: derivar no servidor? Ver §19 | a decidir |

---

## 14. Usuários e administração

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-USR-1 | A tela de Usuários é **um payload só**: perfil, dados de `auth.users`, heartbeat, último logout, tickets em aberto e autorizados. | `manager_list_users` (`20260717120500:~400-470`) | `GET /users` | intencional |
| R-USR-2 | A gestora **não pode desativar a si mesma**. | `manager_set_user_active` (`...user_management_rpcs.sql:164-166`) | `422 CANNOT_TARGET_SELF` | intencional |
| R-USR-3 | Desativar/reativar é idempotente (no-op quando já está no estado pedido) e grava `deactivated_at`/`deactivated_by`, com evento em `auth_events`. | idem (`:172-186`) | `POST /users/:id/deactivate` / `/reactivate` | intencional |
| R-USR-4 | Apagar a conta de login **exige redigitar o e-mail** do alvo como prova, apaga `auth.users` (e sessões, por cascata interna do Supabase), mas **preserva** o perfil e todo o histórico. | `manager_delete_auth_user` (`...:~195-245`) | `POST /users/:id/revoke-login` com `confirmEmail` | intencional |
| R-USR-5 | Apagar a conta também marca o perfil inativo e remove o heartbeat, para a linha não continuar "online". | idem (`:~225-232`) | idem | intencional |
| R-USR-6 | Desativar um usuário **bane no auth**, não só põe `is_active = false`. | memória `reference_contas_time_copy` | documentar no endpoint | intencional |
| R-USR-7 | A gestora marca folga/disponível por RPC dedicada. | `manager_set_agent_availability` (`20260717120000:~215`) | `PATCH /users/:id` com `isAvailable` | intencional |
| R-USR-8 | "Tickets em aberto" por agente conta pelo `current_owner_id` e usa o **último follow-up por `recorded_at`** para decidir se está concluído. | `manager_list_users` (`20260717120500:~410-425`) | `tickets.derived_status` materializado | intencional (mas ver R-MET-25) |
| R-USR-9 | A contagem de tickets em aberto agrupa por `current_owner_id` sem filtrar `role`, então perfis não-agente também aparecem com contagem. | idem | filtrar explicitamente | acidente |
| R-USR-10 | `last_logout_at` é o evento `logout` **ou** `force_logout` mais recente em `auth_events`. | idem (`:~450`) | idem | intencional |
| R-USR-11 | `auth_events` é lido pelo próprio usuário e por gestora. | policies "users read own auth events" / "managers read all auth events" (`20260520040000`) | `GET /users/:id/auth-events` | intencional |
| R-USR-12 | Criar usuário **não existe no app**: é feito pela Admin API, com a role no metadata, e `full_name` exige um `UPDATE` extra. | memórias `reference_conta_teste_copy`, `reference_contas_manager_advg` | **DECISÃO NECESSÁRIA**: `POST /users` na v2? Ver §19 | acidente operacional |
| R-USR-13 | `goals` (meta por mês) é uma tabela gerenciada só por gestora, com trigger `set_updated_at`, e **nenhuma tela a lê**. | `20260116050820` + policies "Managers can manage goals" | ver "Propostas de remoção" | acidente (feature abandonada) |
| R-USR-14 | `products` (tabela) existe e é gerenciada por gestora, mas o produto do ticket é validado por `CHECK`, não por FK — a tabela não é a fonte de verdade. | policy "Managers can manage products" (`20260727120000`) vs. `services_product_check` | v2: FK real (ver R-TKT-12) | acidente |

---

## 15. Área do copy

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-CPY-1 | `copy_grup` tem **duas** áreas (`/copy` e `/dashboard`) e escolhe no login. | `src/lib/roles.ts:49` | `GET /me` | intencional |
| R-CPY-2 | O copy lê os agregados das quatro telas de analytics — **só leitura**. Nada de gestão foi aberto. | lista explícita em `20260824120000:10-16` | capacidade `canViewSupportAnalytics` | intencional |
| R-CPY-3 | A análise de motivos de reembolso do copy tem RPC própria, com valores em dólar. | `copy_refund_reason_analytics` (`20260828160000`) | `GET /copy-analytics/refund-reasons` | intencional |
| R-CPY-4 | A evidência por motivo mostra o percentual **dentro do produto**. | `copy_refund_reason_evidence` (`20260828120000_copy_evidencia_percentual_no_produto.sql`) | `GET /copy-analytics/refund-reasons/:category/evidence` | intencional |
| R-CPY-5 | O texto livre do cliente é **redigido** antes de sair do banco (`redact_free_text`). | `20260817200000:~` | mesma função no caso de uso | intencional (privacidade) |
| R-CPY-6 | `text_to_date_safe` existe porque `refunds.request_date`/`completion_date` são `text` e podem ter lixo: converte ou devolve nulo em vez de estourar. | `20260817200000` | **desaparece**: a v2 tipa como `date` e o backfill rejeita o que não converte (`migration_rejects`) | acidente que a v2 resolve |
| R-CPY-7 | A cotação exibida vem com `atualizada_em` para a tela dizer quando mudou. | `copy_refund_reason_analytics` (`20260828160000:~288`) | campo no payload | intencional |
| R-CPY-8 | `can_read_refund_analytics()` e `can_view_support_analytics()` são a **mesma** regra; a primeira delega para a segunda. | `20260824120000:45-52` | uma capacidade só | intencional (consolidação já feita) |
| R-CPY-9 | A Base de Suporte saiu da sidebar do copy. | commit `c001104` | ver R-BAS-8 | intencional |

---

## 16. Lya (agente de IA)

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-LYA-1 | A chave da Anthropic nunca vai para o browser: vive nos secrets e só sai da Edge Function. | `supabase/functions/lya/index.ts:1-6` | `POST /integrations/lya/chat` na API, mesmo princípio | intencional |
| R-LYA-2 | Os dados são lidos com o **JWT do próprio usuário**: cada RPC aplica na Lya o mesmo guard que aplica na tela. | `lya/index.ts:263-268` | a API chama os próprios casos de uso com o contexto do usuário | intencional — **é o que impede a Lya de virar bypass de permissão** |
| R-LYA-3 | Só `manager` e `copy_grup` falam com a Lya; conta desativada é recusada com 403. | `lya/index.ts:274-279` | capacidade `canViewSupportAnalytics` + `ACCOUNT_BLOCKED` | intencional |
| R-LYA-4 | Só `manager` **treina** (escreve no cérebro). | `lya/index.ts:295`; `lya_upsert_memory` (`20260907120000:158`) | idem | intencional |
| R-LYA-5 | A resposta é **SSE**, com eventos `tool`, `token`, `chart`, `memoria`, `aviso`, `revisao`, `error`, `done`. | `lya/index.ts:8-10,88-110` | `POST /integrations/lya/chat` devolve `text/event-stream` com os mesmos nomes de evento | intencional |
| R-LYA-6 | Falha no recall de memórias **não derruba** o chat, mas emite `aviso` com código `memoria_indisponivel` — o usuário precisa saber que a resposta saiu sem o treino. | `lya/index.ts:62-80,112-118` | mesmo evento | intencional |
| R-LYA-7 | O turno tem trava anti-loop de **10 rodadas** de tool-use; na última o modelo é forçado a sintetizar (`tool_choice: none`). | `lya/index.ts:30-31` | mesmas constantes | intencional |
| R-LYA-8 | Orçamento de parede: 95 s para decidir sintetizar, 115 s para pular o verificador, 25 s de timeout do verificador — tudo para **garantir** que o `done` chegue. | `lya/index.ts:32-36` | mesmos limites, ajustados ao runtime novo | intencional |
| R-LYA-9 | O passe do verificador anti-fakenews é **fail-open**: se ele falhar, a resposta sai mesmo assim. | `lya/index.ts:16-17` + `verificador.ts` | mantido | intencional |
| R-LYA-10 | **[G7.4]** O sandbox de SQL aceita **só** `SELECT`/`WITH`, **instrução única** (proíbe `;`), roda em transação somente-leitura, com `statement_timeout` de 8 s e `LIMIT` imposto por fora (teto 500). | `lya_exec_sql` (`20260907120000:565-602`) | **o SQL livre deixa de existir**: `POST /integrations/lya/query` aceita o **nome** de uma consulta do catálogo, com parâmetros vinculados (G7.4 de `01-GARANTIAS.md`). Timeout cai para 5 s, teto de `LIMIT` para 200, e toda execução é registrada em `lya_query_log` — hoje não há registro nenhum | intencional, mas **sem log**: não há como saber o que a Lya executou |
| R-LYA-11 | **[G7.4]** O sandbox roda como a role dedicada `lya_sql_ro` (`NOLOGIN`), dona da função, com `GRANT SELECT` em **15 tabelas** de dados — nunca `profiles` inteiro, `auth`, logs de sessão, memórias ou chats. Pessoas do time só pela view `lya_agentes`, sem e-mail. | `20260907120000:500-565` | `lya_analytics_ro` sobre `interaction_facts`, `daily_rollups`, catálogos e **views sem PII** de tickets, reembolsos e pedidos em espera (`12` §6.9) | intencional — **mas as 15 tabelas incluem `held_orders`, com endereço completo de cliente**. A view `lya_agentes` existia para proteger PII do time; ninguém protegeu a do cliente |
| R-LYA-12 | As memórias são lidas por quem tem analytics e escritas só por gestora; o recall é full-text em português. | `lya_memories_read_analytics`, `lya_recall_memories` (`20260907120000:121,214`) | `GET/POST/DELETE /integrations/lya/memories` | intencional |
| R-LYA-13 | Conversas são por usuário (`lya_chats_own`, `lya_chat_messages_own`); ninguém lê a conversa de outro, nem a gestora. | policies (`20260907120000:346-357`) | idem | intencional |
| R-LYA-14 | Os papéis de memória são `user`, `feedback`, `project`, `reference`, `nota`. | `CHECK` em `lya_memories.type` (`:82`) | enum | intencional |
| R-LYA-15 | A Lya tem 18 ferramentas, das quais 11 são leitura de painel (espelho dos RPCs das telas), 3 de listagem, 1 de SQL livre, 1 de gráfico e 1 de memória. | `lya/tools.ts:142-635` | cada ferramenta passa a chamar o endpoint correspondente de `11` | intencional |
| R-LYA-16 | `lya_files` e `lya_file_rows` **existem em produção** e **não existem em `supabase/migrations/`**: foram criadas fora do repositório (PR #80). `lya_files` guarda o arquivo inteiro (`conteudo`, `resumo`, `colunas`, `status`, `erro`) e `lya_file_rows` uma linha jsonb por linha do CSV. | `30-banco-estado-real.md` §2 (`lya_files`, `lya_file_rows`) vs. ausência em `supabase/migrations/` | `12` §6.9 + `/integrations/lya/files` em `11` §16 | **acidente de processo**: schema em produção sem migration |

---

## 17. Zendesk

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-ZEN-1 | O token do Zendesk nunca vai para o bundle: vive nos secrets (`ZENDESK_SUBDOMAIN`, `_EMAIL`, `_API_TOKEN`). | `supabase/functions/zendesk/index.ts:1-6` | `/api/v1/integrations/zendesk/*` | intencional |
| R-ZEN-2 | **Só `role = 'manager'`** passa — nem o copy. | `zendesk/index.ts:281` | capacidade explícita | intencional |
| R-ZEN-3 | Credencial ausente devolve `200 { connected: false }`, não erro — a tela mostra "não configurado" em vez de quebrar. | `zendesk/index.ts:284` | mesmo comportamento | intencional |
| R-ZEN-4 | Cinco ações: `status`, `tickets`, `ticket`, `groups`, `agents`. | `zendesk/index.ts:11-18` | cinco endpoints REST | intencional |
| R-ZEN-5 | A busca do Zendesk só devolve os **primeiros 1000** resultados; passar disso responde `400` pedindo refinar o filtro. | `zendesk/index.ts:33,~330` | `400 SEARCH_WINDOW_EXCEEDED` | intencional |
| R-ZEN-6 | Consulta que é **só dígitos** é tratada como ID de ticket e vai direto, sem passar pela busca. | `zendesk/index.ts:~318` | idem | intencional |
| R-ZEN-7 | Consulta com `@` filtra por solicitante; qualquer outra coisa é texto livre com aspas removidas. | `buildSearchQuery` (`zendesk/index.ts:~140`) | idem | intencional |
| R-ZEN-8 | Autor `end-user` é "cliente"; `agent`/`admin` é "time". Nota interna = time **e** não pública. | `zendesk/index.ts:~365-375` | idem | intencional |
| R-ZEN-9 | `plain_body` tem entidades HTML decodificadas e 3+ quebras de linha colapsadas em 2. | `decodeEntities` (`zendesk/index.ts:~110`) | idem | intencional |
| R-ZEN-10 | Limite de 400 chamadas/min por conta: `tickets` gasta 2 por página, `ticket` 2, `status` 9. Erro `429` do Zendesk vira mensagem em português. | `zendesk/index.ts:20-22,~95` | `429` propagado com `RATE_LIMITED` | intencional |
| R-ZEN-11 | O pré-preenchimento do atendimento a partir do Zendesk tem teto de cobertura de ~52%, porque SMS não gera ticket lá. | memória `project_zendesk_prefill_agente` | documentado | intencional |
| R-ZEN-12 | Paginação do Zendesk é por **página**, não cursor — é da API externa e não pode virar keyset. | `zendesk/index.ts:~310` | exceção documentada ao §3 do contrato | ver "Propostas de emenda" |

---

## 18. Exportações

| ID | Enunciado | Hoje | v2 | Natureza |
|---|---|---|---|---|
| R-EXP-1 | O agente exporta os próprios atendimentos do período para planilha. | RPC `export_agent_services` (`20260818140000`) + `src/lib/reportExport.ts` | `POST /exports/agent-services` | intencional |
| R-EXP-2 | O relatório da gestora combina `dashboard_export_extras`, `export_agent_services`, `dashboard_status_summary` e `dashboard_contact_reason_notes`, e é guardado por `is_manager()` puro. | `src/lib/reportExport.ts` + `20260824120000:13-15` | `POST /exports/manager-report` | intencional |
| R-EXP-3 | A montagem da planilha (colunas, abas, formatação) acontece **no browser**. | `src/lib/reportExport.ts` | §7 do contrato: `exports` = "geração de planilha no servidor" | intencional (muda na v2) |
| R-EXP-4 | A exportação de atendimentos traz a nota do motivo, separando "Outro" de "Reclamação VSL" pelo código do motivo. | `dashboard_contact_reason_notes` (`20260828120000:43-47`) | idem | intencional |
| R-EXP-5 | O fuso da exportação foi corrigido para São Paulo. | `20260803120000_channel_detail_agent_filter_and_export_tz.sql` | §5 do contrato | intencional |
| R-EXP-6 | Vazio não gera arquivo: a contagem exportada é devolvida e a UI avisa. | `src/pages/agent/Atendimentos.tsx:315-320` | resposta com `rowCount` | intencional |

---

## 19. Conflitos e bugs que viraram comportamento — estado das decisões

Sete questões foram **decididas** pelo dono do projeto em 26/09/2026 (§8-A do contrato) e sete
foram **medidas** em produção (`91-MEDICOES.md`). Esta seção registra o que fechou, com o
número que fechou, e o que continua aberto. O que continua aberto vive em
`docs/arquitetura-v2/90-BACKLOG.md` — é lá que a lista segue viva depois desta fase.

| # | Assunto | Estado |
|---|---|---|
| 19.1 | Concluir: dois comportamentos | **FECHADO** por D1 |
| 19.2 | Regra das 18h bloqueia no servidor? | **FECHADO** por D1 — não bloqueia |
| 19.3 | Meta diária derivada do array do cliente | **FECHADO em parte** por D3; fonte de `supportChannel` no backlog |
| 19.4 | Avaliação disciplinar no browser | **FECHADO** por D3 |
| 19.5 | `follow_up_number` calculado no cliente | **FECHADO** por M2 — renumerar, urgente |
| 19.6 | Baixa de reembolso sem validação | **FECHADO** por M3 — opção A, custa 39 linhas |
| 19.7 | Exclusão sem rastro | **ABERTO** → backlog |
| 19.8 | Catálogo de produtos como `CHECK` | **ABERTO** → backlog |
| 19.9 | Nota da tomada sobrescrita | **especificado**, aguarda confirmação → backlog |
| 19.10 | `contact_reason_note` de VSL | **ABERTO** → backlog |
| 19.11 | Capacidades sem tela, criação de usuário | **ABERTO** → backlog |
| 19.12 | `services.status` com três valores | **FECHADO** por M1 — são dois |
| 19.13 | Dinheiro em float, instante sem fuso | **FECHADO** por D4 e C6 |
| 19.14 | `channel` com "Nenhum" e vazio | **NOVO** (M4) — aguarda o dono |
| 19.15 | `sales_platform`: 10 no banco, 8 na tela | **NOVO** (M5) — aguarda o dono |
| 19.16 | `refund_type`: 21 variantes, maior grupo vazio | **NOVO** (M6) — aguarda o dono |

---

### 19.1 e 19.2 — Concluir e a regra das 18h · **FECHADO por D1**

**Decisão: o bloqueio sai, dos dois lados.** Nem servidor, nem browser. A incoerência (concluir
pela lista bloqueava, concluir pelo diálogo passava) se resolveu igualando pelo lado permissivo.

O que **não** sai, e é o ponto que se perde com facilidade: **a marcação `is_same_day_repeat`
permanece**. Ela nunca foi o bloqueio — é o que permite a métrica não contar a mesma conversa
duas vezes (R-MET-5, R-MET-6). Remover a marcação junto com o bloqueio distorceria todo
dashboard, e é o erro mais provável de quem implementar lendo só o título da decisão.

Consequência esperada e aceita: cresce o volume de interações no mesmo dia, e com ele o número
de linhas marcadas como repetição. A **definição** das métricas não muda, então o número de
"atendimentos" não infla — o que muda é quantas repetições o gestor vê.

Reflexos: R-INT-1, R-INT-2, R-INT-4, R-INT-5; `POST /tickets/:id/interactions` (`11` §2) perde
o erro `FOLLOW_UP_BLOCKED`; `GET /tickets` perde `canAddInteraction` e `interactionUnlocksAt`.

### 19.3 — Meta diária · **FECHADO em parte por D3**

D3 manda metas, faixas e a regra de acúmulo virarem **configuração com vigência**. Isso vale
para a meta diária (100/150) tanto quanto para a semanal: as duas saem do bundle e vão para
`goal_policies` (`12` §6.8), datadas.

**Continua aberto**: de onde vem `supportChannel`. Hoje é derivado da maioria dos tickets
carregados **na tela**, então trocar o filtro de data muda a meta do agente (R-MET-12), e a
coluna `profiles.support_channel` existe e é ignorada (R-CAP-9). A especificação assume a opção
B (derivar no servidor sobre janela fixa de 30 dias) por ser a que preserva o comportamento
automático sem depender de ninguém manter a coluna — **mas isso é escolha da trilha, não
decisão do dono**. → `90-BACKLOG.md`

### 19.4 — Avaliação disciplinar · **FECHADO por D3**

Sai do browser para `GET /metrics/compliance`, com a funcionalidade inteira preservada e os
valores iniciais idênticos, para que o corte não mude a avaliação de ninguém. Ganho registrado
pelo dono: a política passa a ter histórico e deixa de mudar por deploy de front.

### 19.5 — `follow_up_number` · **FECHADO por M2: renumerar**

Medido nos últimos 180 dias: **5.543 pares repetidos, 12.753 linhas excedentes**. O total
histórico é 12.755 — ou seja, **praticamente toda a duplicação é dos últimos seis meses**.

Isso inverte a leitura: não é lixo antigo que se tolera, é **defeito em curso**. E preservar os
números significaria abrir mão da `UNIQUE (ticket_id, seq)`, que é exatamente a constraint cuja
ausência causou o problema. Some a isso o fato de `dashboard_follow_up_detail` escolher o
"último follow-up" por `follow_up_number DESC` (R-MET-25): um número repetido muda o status que
a gestora vê.

**Renumerar** com `row_number() OVER (PARTITION BY ticket_id ORDER BY recorded_at, id)`, guardando
`legacy_follow_up_number`. Nada se perde, e a constraint entra.

A ordem canônica é **`(recorded_at, id)`** — não `(recorded_at, follow_up_number, id)`. É a ordem que
`my_follow_ups()` usa, e portanto a que a tela mostra hoje. A diferença não é cosmética: muda o
status final de **37 tickets**, porque muda qual interação é a última.

### 19.6 — Baixa de reembolso · **FECHADO por M3: opção A**

Uma rota só (`POST /refunds/:id/complete`), com a validação estrita que hoje só a gestora
enfrenta valendo para todos, e `refund_events` auditando **toda** baixa.

Custo medido sobre os 5.624 reembolsos de 2026: **39 linhas** com baixa anterior à solicitação e
**zero** com baixa incompleta. As 39 entram como `warning` em `migration_rejects` e a constraint
entra `NOT VALID` para o histórico — o caminho novo já nasce validando.

Sobre `days_overdue` (R-REF-17), que hoje é `hoje − request_date` em vez de
`completion_date − request_date`: a especificação usa a segunda forma e preserva a primeira em
`legacy_days_overdue`, para que os números já auditados continuem auditáveis. **Confirmar.**
→ `90-BACKLOG.md`

### 19.12 — `services.status` · **FECHADO por M1: são dois valores**

Medido: `registered` 101.529, `concluido` 1.271, **`'pendente'` zero linhas** — apesar de ser o
default da coluna. O terceiro estado que esta trilha temia é **default morto**: nunca foi
materializado porque o cliente sempre grava o valor explicitamente.

O alvo tem **dois** estados e o default passa a ser o valor que o código grava, em vez de um
terceiro que ninguém usa. Um default que não coincide com a escrita é uma armadilha esperando
o primeiro `INSERT` que esqueça o campo.

M1 também deu a prova aritmética do ticket fantasma: **1.271** tickets com
`status = 'concluido'` contra **14.102** interações com `status = 'concluido'`. A tela lê a
interação, o banco guarda a coluna, ninguém sincroniza. É por isso que `derived_status`
materializado (R-TKT-24) não é refinamento — é correção.

### 19.13 — Dinheiro em float e instante sem fuso · **FECHADO por D4 e C6**

- **Moeda**: D4 decidiu dólar em todo o sistema. A API devolve `{ amount, currency: "USD" }`,
  para o rótulo nunca poder divergir do dado. `refunds.refund_value` deixa de ser
  `double precision` e passa a `numeric(12,2)`.
- **Fuso · FECHADO com prova (M8)**: cinco colunas são `timestamp` **sem** fuso e foram gravadas em
  **UTC** — provado, não suposto. A conversão é `AT TIME ZONE 'UTC'`, e o cast implícito está
  **proibido**, porque usa o fuso da sessão e dá resultado diferente conforme quem executa
  (`12` §7). O teste decisivo usou o gatilho `trg_service_pin_date_on_insert` como árbitro: na faixa
  das 00:00 às 03:00 UTC, **233 linhas, 233 acertos supondo UTC, zero supondo hora local**.

---

### 19.7 — Exclusão sem rastro (R-TKT-21, R-REF-19) · **ABERTO**

Agente apaga ticket e reembolso próprios, sem motivo e sem log — dado que alimenta métrica,
meta e avaliação disciplinar. Opções: soft-delete (`deleted_at`, `deleted_by`, `delete_reason`),
manter hard-delete, ou só gestora apaga. A especificação de `12` traz as colunas de soft-delete
marcadas como condicionais. → `90-BACKLOG.md`

### 19.8 — Catálogo de produtos como `CHECK` (R-TKT-12, R-REF-25, R-USR-14) · **ABERTO**

`services.product` tem `CHECK` com ~75 nomes, e foi assim que o Jellyrock quebrou. Existe uma
tabela `products` gerenciável que nada valida contra, e o cliente tem uma **terceira** lista
(`REFUND_PRODUCTS`). Opção proposta: FK para `products`, e produto novo deixa de exigir deploy.
Pergunta que sobra: `refunds.product` também vira FK? → `90-BACKLOG.md`

### 19.9 — Nota da tomada sobrescrita (R-TKO-9) · **especificado, aguarda confirmação**

Recusar sobrescreve a justificativa do agente com a da gestora. `12` §3.5 separa em
`requester_note` e `response_note`. As notas já sobrescritas não voltam, e o backfill registra
isso como `AMBIGUOUS_FIELD` em `migration_rejects`. → `90-BACKLOG.md`

### 19.10 — `contact_reason_note` de VSL (R-TKT-14) · **ABERTO**

Obrigatória na UI, opcional no banco, por causa dos tickets antigos sem nota. Opção A: a API
exige e o banco continua permitindo nulo (o histórico sobrevive). Opção B: exigir nos dois e
tratar o histórico no backfill. A especificação de `11` assume A. → `90-BACKLOG.md`

### 19.11 — Capacidades sem tela (R-CAP-10) e criação de usuário (R-USR-12) · **ABERTO**

Quatro capacidades e a criação de conta só existem por SQL e Admin API em produção. `11` §12
especifica `PATCH /users/:id/capabilities` e `POST /users` como propostas. → `90-BACKLOG.md`

---

### 19.14 — `channel` tem o mesmo problema de `platform` · **NOVO (M4), aguarda o dono**

Medido: `SMS` 36.081, **vazio 30.994**, `Email` 30.887, `Clickbank` 3.710, **`Nenhum` 1.128**.

D5 decidiu que em `platform` "Nenhum" e vazio **permanecem distintos**, porque a diferença entre
"verifiquei e não há" e "ninguém preencheu" é informação. `channel` tem exatamente o mesmo
padrão e **não foi coberto pela decisão**. Por coerência, a especificação de `12` aplica a mesma
regra — preserva os dois — e registra como **pendente de confirmação do dono**.

Além disso: **3.710 linhas têm `Clickbank` no campo de canal de atendimento**, que é nome de
plataforma de venda. O campo está sendo usado para outra coisa em 3,5% dos casos. Isso não é
conversão de tipo, é qualidade de dado, e a decisão sobre o que fazer com essas linhas é do
dono. → `90-BACKLOG.md`

### 19.15 — `sales_platform`: 10 valores no banco, 8 na tela · **NOVO (M5), aguarda o dono**

Medido: `Cartpanda` 2.400, `Buygoods` 1.452, `ClickBank` 1.414, **`Hotmart` 143**,
**`PagAmerican` 139**, `LogiCall` 59, `SalesBound` 45, `Nenhum` 36, `CartCandy` 22,
`Digistore24` 4.

`Hotmart` e `PagAmerican` **existem no banco e não no seletor da tela**. Um `CHECK` com a lista
da tela rejeitaria 282 linhas reais — e rejeitar linha real num backfill é perder dado, que é o
que §8 do contrato proíbe.

Desenho especificado em `12` §4.1: a lista de plataformas vira **tabela** (`sales_platforms`),
semeada com os **10 valores medidos**, com um flag `is_selectable` que diz quais aparecem no
seletor. Assim o histórico é válido e a tela continua curta. **Pendente de confirmação**: se
`Hotmart` e `PagAmerican` devem passar a aparecer no seletor.

Atenção à caixa, que é a armadilha: **`ClickBank`** em reembolsos e **`Clickbank`** em canal são
o mesmo nome escrito de dois jeitos. A tabela guarda uma grafia canônica e a comparação é
case-insensitive. → `90-BACKLOG.md`

### 19.16 — `refund_type`: 21 variantes e o maior grupo é vazio · **NOVO (M6), aguarda o dono**

Medido: o maior grupo é **vazio, com 1.242 linhas**, seguido de `80%` (961) e `100%` (881). São
21 valores distintos, com duas armadilhas:

- **`05%` tem zero à esquerda e os demais não.** Ordenação por texto coloca `05%` antes de
  `10%` — por acidente, certo — e `100%` antes de `20%`, o que está errado. Qualquer gráfico
  ordenado por tipo de reembolso está com as barras fora de ordem hoje.
- **`95%` existe com 1 linha** e um `CHECK` com os 20 valores da tela o rejeitaria.

Desenho especificado em `12` §4.1: a coluna passa a ser **`refund_percent smallint`** (percentual
inteiro, 0–100), com `CHECK (refund_percent BETWEEN 0 AND 100)`, e o rótulo `"80%"` é formatado
**na tela**. Isso resolve ordenação e zero à esquerda de uma vez, e `refunded_value` deixa de
depender de um `regexp` sobre texto (R-REF-20).

Conversão: `NULLIF(btrim(refund_type),'')` → remove o `%` → `::smallint`. Os 1.242 vazios viram
`NULL`, que é o que já significam. **Pendente de confirmação do dono**: se o percentual continua
restrito a múltiplos de 5 (e então `CHECK (refund_percent % 5 = 0)`, que os dados atuais
satisfazem) ou se qualquer inteiro é aceito. → `90-BACKLOG.md`

## 20. Divergências entre documentação e código

| Onde | O que a documentação diz | O que o código faz |
|---|---|---|
| `CLAUDE.md`, "Permission flags vocabulary" | lista **duas** capacidades (`can_view_all_tickets`, `can_register_duplicate_emails`) | existem **quatro** (`+ can_claim_tickets`, `+ can_approve_takeovers`) e mais dois flags de estado (`is_available`, `is_active`) |
| `CLAUDE.md`, "Two user worlds, two layouts" | descreve **dois** mundos (`/workspace` e `/dashboard`) | existem **quatro** layouts: `AgentLayout`, `ManagerLayout`, `CopyLayout`, `ProdutosLayout` |
| `CLAUDE.md`, "Feature folders" | lista 5 domínios | existem também `notepad`, `radar`, `support-base`, `held-orders`, `lya`, `copy` |
| `CLAUDE.md`, "Supabase integration" | `types.ts` "é gerado, não editar" | está **editado à mão** (comentário em português em `src/integrations/supabase/types.ts`, na linha de `services.current_owner_id`) e **desatualizado**: falta `app_settings`, `agent_notes`, `radar_items`, `radar_events`, `support_products`, `support_sms_brands`, `support_sms_replies`, `lya_*`, `refund_manager_completions`, e as colunas `services.order_id`, `services.contact_reason_note` em parte, `refunds.service_id`, `refunds.picked_up_at`, `service_follow_ups.is_same_day_repeat` |
| `CLAUDE.md`, "Schema gotchas" | "`refunds.request_date` e `completion_date` são `text`" | correto; **mas** `my_refunds_with_refunded_value` já devolve `date`, e `refunds.user_id` é convertido com `::uuid` — o tipo real no banco não está descrito por nenhuma migration (ver Lacunas) |
| `00-CONTRATO.md` §7 | `metrics` tem 7 rotas | são necessárias ao menos 12 para cobrir as ~35 regras de métrica (ver `11`) |
| memória `project_lya_arquivos_feature` | `lya_files`/`lya_file_rows` em produção (PR #80) | **confirmado**: existem em produção e **não** em `supabase/migrations/` (`30-banco-estado-real.md` §2) |
| `supabase/migrations/` | `services.status` sem default declarado | o default real é `'pendente'` — valor que **nenhuma** migration menciona |
| `supabase/migrations/` | `refunds.refund_value numeric` | é `double precision` em produção |
| `supabase/migrations/` | carimbos `timestamptz` | `services.created_at`, `refunds.created_at` e `profiles.created_at` são `timestamp` **sem** fuso |
| — | comparativo interno×externo sem tabela | existe `external_refunds` (4.026 linhas, com `order_number` gerada por `normalize_order_number`) — **ausente de `supabase/migrations/`** |
| `supabase/config.toml` | `project_id = aiypwzylxoeppnmsqlok` | o runtime usa `kjkyyqxqrqsdozjyyuon` (`.env`) |

---

## 21. Propostas de remoção

Decisão do dono do projeto (§8 do contrato). A trilha só aponta.

| Item | Por que propor a remoção | Risco |
|---|---|---|
| `is_supervisor()` (função) e a coluna `is_supervisor`, se ainda existir | renomeada para `can_view_all_tickets` em `20260521130000`; nada chama | nenhum — verificar antes se alguma policy antiga sobreviveu |
| `user_roles` (tabela) e `has_role()` | `profiles.role` é a fonte de verdade; a tabela nunca foi sincronizada | nenhum se estiver vazia/desatualizada — **conferir conteúdo antes** |
| `public.app_role` (enum órfão) | `profiles.role` usa `public."AppRole"` | nenhum |
| `confirm_held_order` | substituída por `set_held_order_status`; nenhuma tela chama | nenhum |
| `agent_daily_service_counts` + trigger `services_refresh_agent_daily_counts` + `refresh_agent_daily_service_count` | rollup que nenhuma tela lê; `daily_rollups` o substitui | nenhum — mas o **histórico** pode servir de semente para o backfill de `daily_rollups` |
| `goals` (tabela) | nenhuma tela lê; as metas vivem em constantes de código | **não remover**: é o lugar natural para as metas de R-MET-12/R-MET-31 saírem do bundle |
| `agent_metrics_range`, `agent_product_mix` | contam pela regra antiga e podem discordar de `agent_my_metrics` (R-MET-34) | as telas que as usam precisam migrar primeiro |
| `held_orders.status` (`pending`/`confirmed`) | duplica `agent_status` (R-HLD-20) | bundles antigos em cache podem ler |
| aliases legados de `agent_my_metrics` (`total_interactions`, `team_average`, `gap_to_avg_pct`, `is_below_team_avg_20pct`, `benchmark_*`) | mantidos só por compatibilidade | o corte é seguro no mesmo deploy do front novo |
| `skipped` em `manager_import_held_orders` | idem, para bundle em cache | idem |

---

## Lacunas

1. **Tipos reais das colunas — RESOLVIDA durante esta fase.** A conversão `uuid`/`timestamptz` → `text` aconteceu fora do repositório e não existe `ALTER COLUMN TYPE` em migration nenhuma. Esta trilha não executou SQL (a instrução recebida proíbe), mas a **trilha de dados** levantou o catálogo em 26/09/2026 e o resultado está em `30-banco-estado-real.md` §2. `12` §7 foi reconciliado com ele. O que sobra de lacuna é menor e está no item 1-A.
1-A. **RESOLVIDA por M8.** Os carimbos `timestamp` sem fuso são **UTC**, provado pelo gatilho de
   fixação de data como árbitro. A conversão explícita está em `12` §7 e o cast implícito está
   proibido.
2. **Contagem de linhas por tabela.** Sem `reltuples` não é possível dimensionar o backfill nem decidir entre rollup incremental e recálculo com números.
3. **Quais linhas violam as constraints novas.** O contrato não define o que acontece com elas: `migration_rejects` guarda, mas nada diz se a migração para se houver rejeição, ou até quanto.
4. **Idempotência (§3).** O contrato exige `Idempotency-Key` em 4 rotas mas não define onde a chave é guardada, nem se a resposta gravada inclui os cabeçalhos, nem o que acontece quando a **mesma chave** chega com **corpo diferente** (`409 IDEMPOTENCY_KEY_REUSED`?).
5. **Cursor (§3) — parcialmente resolvida.** D7 definiu **onde** cada paginação vale: cursor só em "Meus Atendimentos"; numerada com total nas outras quatro listas. Continua sem aval o **formato interno** do cursor e a invalidação quando a ordenação muda de versão (`11` §0.2 propõe um formato).
6. **Realtime (§4).** Não define quem **emite** o evento (trigger de banco? a API depois do commit?), nem a garantia de entrega, nem o que fazer com eventos perdidos além de "revalida ao reconectar".
7. **RESOLVIDA por D2.** A API conecta com o token do usuário e as policies permanecem como rede de segurança, com quatro exigências de desempenho (policy é rede e não filtro; helpers em `(SELECT ...)`; identidade com escopo local à transação; toda tabela nova com RLS ligada). Detalhado em `13` §4.
8. **Exportação no servidor (§7).** Não define formato (XLSX? CSV?), se é síncrono ou por job, nem onde o arquivo fica.
9. **Retenção.** Nenhum documento diz por quanto tempo `auth_events`, `interaction_facts`, `held_order_events`, `radar_events` e `refund_events` são guardados.
10. **Fuso do turno.** A regra das 18h e "hoje em São Paulo" pressupõem que a operação inteira está em SP. Não há registro de decisão sobre agente em outro fuso.
11. **`lya_files`/`lya_file_rows` e `external_refunds` — confirmadas em produção, ausentes das migrations.** O schema alvo as inclui (`12` §6.9 e §4.4). O que falta é saber **como** foram criadas e se há mais objetos nessa situação; `30-banco-estado-real.md` §11 lista as divergências encontradas.
12. **Migração de `auth.users`.** O contrato diz que o login não muda, mas não diz se a v2 continua no mesmo projeto Supabase (e então `auth.users` é a mesma tabela) ou em outro.

---

## Propostas de emenda ao contrato

> **Estado em 26/09/2026**: as emendas 2, 3 e 5 abaixo foram **respondidas** por §8-A do
> contrato (D7 recusou a troca por keyset; D2 e D3 fecharam as demais). Ficam registradas com o
> resultado, porque a razão técnica continua valendo para quem implementar.

1. **§7 — a lista de rotas de `metrics` está subdimensionada.** Sete rotas não cobrem as ~35 regras de métrica. `11` propõe 13. Motivo: `dashboard_status_summary`, `dashboard_same_day_repeats`, `dashboard_contact_reason_notes`, o comparativo interno×externo e a avaliação disciplinar (R-MET-31) não têm onde entrar.
2. **§3 — "nunca OFFSET" · RESPONDIDA por D7, e a emenda virou mais ampla do que a trilha propôs.** A trilha pediu uma exceção para agregados; o dono manteve a **paginação numerada com total** em quatro listas (Reembolsos nas 2 abas, as duas auditorias e o detalhe de motivo), e cursor só em "Meus Atendimentos". A razão é melhor que a da trilha: o custo de hoje não é o `OFFSET`, é o **predicado não indexável** que ele percorre (`service_date` em texto, convertido e com fuso aplicado por linha). Sobre `interaction_facts` com índice por dia e agente, saltar milhares de linhas é barato. O total é contado sobre a tabela de fatos e cacheado por combinação de filtro.
3. **§3 — o Zendesk não pode ser keyset.** A API externa pagina por número de página e corta em 1000 resultados (R-ZEN-5, R-ZEN-12). Emenda: rotas de integração espelham a paginação do provedor e isso fica documentado, não escondido.
4. **§6 — "estado derivado: banco, materializado" precisa de uma exceção nomeada.** O status do ticket depende do **último** follow-up; materializar com trigger é fácil, mas `interaction_count` também precisa ser correto depois de `DELETE` de interação. Emenda: nomear explicitamente quais colunas são materializadas e por qual trigger, e exigir um teste de recomputação (`recompute()` que devolve zero diferenças).
5. **§4 — o heartbeat e o dado histórico que se perde com Presence.** Presence não grava no banco, então a gestora perde "último visto" de quem está offline há dias (hoje em `agent_heartbeats.last_seen_at`). Emenda: manter uma escrita **de baixa frequência** (por exemplo, no login e no logout, ou a cada 15 min) só para o histórico, ou aceitar explicitamente a perda.
6. **§0 vs. a instrução desta trilha.** O contrato foi atualizado em 26/09/2026 para permitir **leitura** em produção; a instrução recebida por esta trilha proíbe executar SQL em qualquer lugar. A trilha seguiu a instrução mais restritiva e deixou o SQL de levantamento escrito em `12` §8. Reconciliar.
7. **§8 — "nenhuma funcionalidade pode desaparecer" colide com os bugs de §19.** Vários comportamentos de hoje são bugs (número de interação repetido, baixa sem validação, meta que muda com o filtro). Manter o comportamento é manter o bug. Emenda: distinguir "funcionalidade" de "comportamento defeituoso", e exigir que cada correção seja **listada** e aprovada, em vez de proibida por padrão.
