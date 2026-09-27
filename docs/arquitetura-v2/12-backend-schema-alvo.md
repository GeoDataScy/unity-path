# Schema alvo — XMX Suporte v2

> Trilha: **backend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Referências `R-XXX-n` apontam para `10-backend-regras-atuais.md`.
>
> **Este documento é especificação. Não existe migration aqui, e nenhum DDL foi
> executado.** O schema legado em `supabase/migrations/` está congelado (§0 do
> contrato). O modelo novo mora em `packages/db` quando a fase de implementação
> começar.
>
> ### Reconciliado com §8-A do contrato e `91-MEDICOES.md` em 26/09/2026
>
> Incorpora as decisões **D2** (RLS permanece como rede), **D3** (metas com vigência), **D4**
> (dólar), **D5** (`platform` preserva "Nenhum" e vazio), **D6** (e-mail intacto + coluna gerada)
> e **D7** (paginação numerada), as medições **M1, M2, M3, M5, M6**, e corrige os dois defeitos
> apontados pela trilha de dados: **C6** (`created_at` precisa de `AT TIME ZONE 'UTC'`) e **C8**
> (`derived_status` precisa de fallback em `legacy_status`).
>
> **Fonte dos tipos de origem:** `30-banco-estado-real.md` (levantamento do catálogo de
> produção em 26/09/2026, feito pela trilha de dados). Onde `supabase/migrations/` discorda
> do banco real, **vale o banco real**; as discordâncias estão em §20 de `10` e em §11 de `30`.

## 0. Princípios

1. **Tipo certo, sempre.** O legado guarda id, data e instante em `text`. Toda coluna nova tem o tipo real: `uuid`, `date`, `timestamptz`, `numeric`. A conversão é a maior fonte de risco da migração e está descrita coluna a coluna em §7.
2. **Nome em inglês** (§2 do contrato): `tickets`, `interactions`, `users`. O vocabulário de negócio em português vive nos *valores* de enum que já são português (`em_andamento`, `reembolso`), porque mudá-los quebraria o histórico sem ganho nenhum.
3. **[D2] Toda escrita passa pela API, sob a identidade de quem chamou, e as policies permanecem como rede de segurança.** Decidido em §8-A/D2. Quatro consequências para este schema, todas obrigatórias:
   - **A policy é rede, não filtro.** O recorte real (agente, período, status) vai no `WHERE` servido por índice; a policy só confirma. Nenhum índice deste documento existe para "fazer a policy funcionar" — existem para o `WHERE` da consulta.
   - **Helpers em `(SELECT ...)`.** A correção de 27/07/2026 (19.442× menos varreduras) é pré-requisito e não pode regredir. Toda policy escrita aqui usa `(SELECT auth.uid())` e `(SELECT public.is_manager())`, nunca a chamada direta.
   - **Identidade com escopo local à transação**, compatível com pooler em modo transação e execução serverless (`13` §4).
   - **Toda tabela nova nasce com RLS ligada.** Medido em produção: `anon` e `authenticated` têm privilégio de escrita nas 32 tabelas, então tabela sem policy nasce **gravável pelo mundo** (B3 do backlog). Neste documento, isso vale para `interaction_facts`, `daily_rollups`, `notifications`, `refund_events`, `migration_rejects`, `goal_policies` e `sales_platforms`.
4. **Estado derivado é materializado** (§6 do contrato) e tem uma função de recomputação testada: `recompute_ticket_state(ticket_id)`, `recompute_daily_rollup(day, user_id)`. O teste exige diferença zero entre o materializado e o recalculado.
5. **Nada de `text` onde cabe enum.** Toda coluna de estado vira tipo enumerado; hoje várias aceitam qualquer string (R-INT-14).
6. **Auditoria de origem.** Toda tabela migrada carrega colunas `legacy_*` (§6 deste arquivo) para que qualquer número divergente possa ser rastreado até a linha de origem, sem depender do dump.

## 1. Convenções de coluna

| Convenção | Regra |
|---|---|
| Chave primária | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, exceto onde a chave natural é melhor |
| Carimbos | `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` mantido por trigger |
| Dia de negócio | `business_day date NOT NULL` — o dia em `America/Sao_Paulo`, nunca derivado no cliente (§5 do contrato) |
| Dinheiro | **[D4]** `numeric(12,2)`, **em dólar**, nunca `double precision`. O legado usa `double precision` em `refunds.refund_value` e em `refund_manager_completions.refund_value`. Não existe coluna de moeda: o sistema inteiro é USD, e a borda devolve `{ amount, currency: "USD" }` |
| Instante convertido de `timestamp` sem fuso | **[C6]** `coluna AT TIME ZONE 'UTC'`, **nunca** `coluna::timestamptz` — o cast direto interpreta no `TimeZone` da sessão e erra 3 horas |
| Texto livre | sempre com limite via `CHECK (char_length(x) <= n)` |
| Soft delete | `deleted_at timestamptz`, `deleted_by uuid`, `delete_reason text` — **só nas tabelas em que a decisão 19.7 disser que sim** |
| FK para pessoa | `REFERENCES users(id)`, **sem** `ON DELETE CASCADE`: perfil é desativado, nunca apagado (R-RAD-12) |

---

## 2. Tabelas de identidade

### 2.1 `users`

Origem: `public.profiles`.

| Coluna | Tipo | Nulo | Origem no legado | Conversão |
|---|---|---|---|---|
| `id` | `uuid` PK | não | `profiles.id` (`text`) | `::uuid` — falha vai para `migration_rejects` |
| `email` | `citext` | não | `profiles.email` | `lower(btrim())` |
| `full_name` | `text` | sim | `profiles.full_name` | — |
| `role` | `app_role` (enum) | não | `profiles.role` (`"AppRole"`) | mapeia 1:1; o enum órfão `app_role` do legado é descartado (R-CAP-12) |
| `support_channel` | `support_channel` (enum) | sim | `profiles.support_channel` (`text`) | `NULL` passa a significar "derivar" — **decisão 19.3** |
| `is_active` | `boolean` | não | `profiles.is_active` | default `true` |
| `is_available` | `boolean` | não | `profiles.is_available` | default `true` |
| `can_view_all_tickets` | `boolean` | não | idem | default `false` |
| `can_register_duplicate_emails` | `boolean` | não | idem | default `false` |
| `can_claim_tickets` | `boolean` | não | idem | default `false` |
| `can_approve_takeovers` | `boolean` | não | idem | default `false` |
| `deactivated_at` | `timestamptz` | sim | idem | |
| `deactivated_by` | `uuid` | sim | idem (`text`) | `::uuid` |
| `created_at` | `timestamptz` | não | `profiles.created_at` (**`timestamp` SEM fuso**, nullable) | **[C6]** `COALESCE(created_at AT TIME ZONE 'UTC', now())`. O cast direto erraria 3 horas. Medido: não há nulo, então o `COALESCE` nunca dispara |
| `updated_at` | `timestamptz` | não | — | novo |
| `legacy_id` | `text` | não | `profiles.id` | cópia crua |

Chaves e constraints:
- `UNIQUE (email)`.
- `CHECK (NOT can_approve_takeovers OR role = 'manager')` — hoje é só convenção, verificada dentro de cada RPC (R-CAP-4).
- `CHECK (is_active OR deactivated_at IS NOT NULL)` — desativado sem carimbo é dado incompleto.

Índices:
- `idx_users_role_active (role, is_active) WHERE is_active` — `GET /users/agents` e todo `LEFT JOIN users` nos dashboards.
- `idx_users_email_lower` já coberto por `citext` + `UNIQUE`.

Triggers de invariante que permanecem: `handle_new_user` no `AFTER INSERT` de `auth.users` (R-AUTH-11), `touch_updated_at`.

Enums:
```
app_role        := 'agent' | 'manager' | 'copy_grup' | 'produto'
support_channel := 'email' | 'sms'
```

> **Não migra**: `user_roles` e `has_role()` (R-CAP-11). Antes de descartar, conferir se a tabela tem linha que `profiles.role` não tem.

### 2.2 `auth_events`

Origem: `public.auth_events`. Append-only.

| Coluna | Tipo | Nulo | Origem | Conversão |
|---|---|---|---|---|
| `id` | `bigint` PK (identity) | não | `auth_events.id` | mantém o valor, sequência reposicionada |
| `user_id` | `uuid` | não | `auth_events.user_id` (`text`) | `::uuid` |
| `actor_id` | `uuid` | sim | idem | `::uuid` |
| `event_type` | `auth_event_type` (enum) | não | `auth_events.event_type` (`text`) | valores vistos: `logout`, `force_logout`, `deactivated`, `reactivated`, `deleted`; **acrescenta** `capability_changed` (R-CAP-10) e `login` |
| `metadata` | `jsonb` | sim | idem | |
| `occurred_at` | `timestamptz` | não | idem | |

Índices: `idx_auth_events_user_time (user_id, occurred_at DESC)` — é o acesso de `lastLogoutAt` (R-USR-10) e de `GET /users/:id/auth-events`.

> Um `event_type` do legado fora da lista vai para `migration_rejects` em vez de virar enum silenciosamente.

### 2.3 `app_settings`

Origem: `public.app_settings`. Chave/valor.

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `key` | `text` PK | não | `app_settings.key` |
| `value` | `jsonb` | não | `app_settings.value` (`text`) → `to_jsonb(value)`; valores numéricos viram número |
| `updated_at` | `timestamptz` | não | idem |
| `updated_by` | `uuid` | sim | idem (`text` → `::uuid`) |

Chaves conhecidas no backfill: `usd_brl_rate` (hoje `'5.40'`). Chaves **acrescentadas** com valor inicial igual à constante de hoje, para tirar número do bundle: `daily_goal_email = 100`, `daily_goal_sms = 150`, `weekly_goal_email = 500`, `weekly_goal_sms = 750`, `weekly_alert_min_email = 450`, `weekly_alert_min_sms = 675`, `weekly_low_min_email = 400`, `weekly_low_min_sms = 600`, `held_orders_daily_goal = 30` (R-MET-12, R-MET-31, R-HLD-18).

Trigger: `app_settings_touch` (permanece).

### 2.4 `products`

Origem: `public.products` — hoje existe e **nada valida contra ela** (R-USR-14, R-TKT-12).

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `id` | `uuid` PK | não | `products.id` (`text` → `::uuid`, ou novo se não converter) |
| `name` | `citext` | não | `products.name` |
| `is_active` | `boolean` | não | `products.is_active` |
| `created_at`, `updated_at` | `timestamptz` | não | idem |

Constraints: `UNIQUE (name)`.

**Backfill**: além das linhas de `products`, insere **todos os ~75 nomes** da constraint `services_product_check` (`20260826140000`) e todos os nomes de `REFUND_PRODUCTS` (`src/features/refunds/types.ts`) que não estiverem lá, para que nenhuma linha histórica de `tickets` ou `refunds` fique órfã. **Depende da decisão 19.8**: se `product` continuar `CHECK`, esta tabela permanece decorativa e `tickets.product` volta a ser `text` com `CHECK`.

---

## 3. Tabelas de atendimento

### 3.1 `tickets`

Origem: `public.services`. É a tabela central do sistema.

| Coluna | Tipo | Nulo | Origem no legado | Conversão / nota |
|---|---|---|---|---|
| `id` | `uuid` PK | não | `services.id` (**`text`**) | `::uuid`; falha → `migration_rejects` |
| `client_email` | `text` | não | `services.client_email` | `btrim`; guarda telefone quando `channel='SMS'` (R-TKT-11) |
| `client_email_normalized` | `citext` GENERATED | não | — | `lower(btrim(client_email))` — é o que o lookup usa (R-TKT-3) |
| `business_day` | `date` | não | `services.service_date` (**`text`** ISO com fuso) | `(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date` — **é a regra que `_interaction_events` já aplica** |
| `product_id` | `uuid` FK → `products` | não | `services.product` (`text`) | resolve por `lower(name)`; não achou → cria em `products` no backfill e registra em `migration_rejects` como aviso |
| `platform_id` | `smallint` FK → `sales_platforms` | **sim** | `services.platform` (`text` livre) | **[D5 + G9.1/G9.3]** `'Nenhum'` (10.666) resolve para a linha de catálogo `not_applicable`; vazio (26.764) resolve para **`NULL`**. Os dois permanecem **distintos** — e agora com significado nomeado, em vez de um texto disputando sentido com um vazio |
| `channel_id` | `smallint` FK → `channels` | **sim** | `services.channel` (`text` livre) | **[M4 + G9.1/G9.3]** mesma regra: `'Nenhum'` (1.128) → `not_applicable`; vazio (30.994) → `NULL`; `SMS` (36.081) e `Email` (30.887) → linhas do catálogo. As **3.710 linhas com `Clickbank`** entram no catálogo como linha `misfiled_clickbank` com `is_selectable = false`, preservadas e visíveis — ver abaixo |
| `contact_reason` | `contact_reason` (enum) | sim | `services.contact_reason` | 11 valores (R-TKT-13) |
| `contact_reason_note` | `text` | sim | `services.contact_reason_note` | ≤200 |
| `order_id` | `text` | sim | `services.order_id` | ≤100; **ausente de `types.ts`** (ver divergências) |
| `has_tracking_code` | `boolean` | não | idem | default `false` |
| `status` | `ticket_status` (enum) | não | `services.status` (`text`, default morto `'pendente'`) | **[M1]** exatamente **dois** valores: `'registered'` (101.529 linhas) e `'concluido'` (1.271). `'pendente'` é o default da coluna em produção e tem **zero linhas**. O default do alvo passa a ser `'registered'`, que é o que o código grava |
| `creator_id` | `uuid` FK → `users` | não | `services.user_id` (**`text`**) | `::uuid`. **Imutável** (R-TKT-15) |
| `current_owner_id` | `uuid` FK → `users` | não | `services.current_owner_id` (**`text`**) | `::uuid` |
| `takeover_approved_at` | `timestamptz` | sim | idem | |
| `takeover_approved_by` | `uuid` FK → `users` | sim | idem (`text`) | `::uuid` |
| `derived_status` | `ticket_derived_status` (enum) | não | **materializado** | `'novo'` \| `'em_andamento'` \| `'concluido'` (R-TKT-24). **[C8] A regra de derivação tem fallback obrigatório em `status`** — ver abaixo |
| `interaction_count` | `integer` | não | **materializado** | inclui a criação (R-TKT-25); `CHECK (interaction_count >= 1)` |
| `last_interaction_at` | `timestamptz` | sim | **materializado** | `MAX(interactions.recorded_at)` — base da regra das 18h (R-INT-1) |
| `created_at` | `timestamptz` | não | `services.created_at` (**`timestamp` SEM fuso**, nullable) | **[C6]** `COALESCE(created_at AT TIME ZONE 'UTC', (business_day + time '12:00') AT TIME ZONE 'America/Sao_Paulo')`. Medido: `created_at IS NULL` tem **zero linhas**, então o fallback nunca dispara — mas se disparasse, o `timestamp` de meio-dia sem fuso teria o mesmo defeito |
| `updated_at` | `timestamptz` | não | — | novo |
| `deleted_at` / `deleted_by` / `delete_reason` | `timestamptz` / `uuid` / `text` | sim | — | **só se 19.7 escolher soft-delete** |
| `legacy_id` | `text` | não | `services.id` | cópia crua — chave de reconciliação |
| `legacy_service_date` | `text` | não | `services.service_date` | o texto original, para provar a conversão de `business_day` |

Constraints:
- `CHECK (CASE WHEN contact_reason = 'outro' THEN contact_reason_note IS NOT NULL AND btrim(contact_reason_note) <> '' AND char_length(btrim(contact_reason_note)) <= 200 WHEN contact_reason = 'reclamacao_vsl' THEN contact_reason_note IS NULL OR (btrim(contact_reason_note) <> '' AND char_length(btrim(contact_reason_note)) <= 200) ELSE contact_reason_note IS NULL END)` — cópia fiel de `services_contact_reason_note_check` (R-TKT-14). **Depende de 19.10.**
- `CHECK (contact_reason <> 'reembolso' OR order_id IS NOT NULL)` — **novo**: hoje só a UI exige (R-TKT-10). Backfill: tickets antigos de reembolso sem `order_id` existem; ou a constraint entra `NOT VALID`, ou as linhas vão para `migration_rejects`. **Decisão necessária.**
- `CHECK (interaction_count >= 1)`.

#### [M4 · G9.3] As três ausências de `platform` e `channel`, e as 3.710 linhas fora de lugar

D5 decidiu preservar `'Nenhum'` e vazio como coisas diferentes. G9.3 exige que, se "não se aplica"
é diferente de "não preenchido", **sejam dois valores nomeados** — não um texto e um vazio disputando
significado. As duas exigências se encontram assim:

| Hoje | No alvo | Significado |
|---|---|---|
| `'Nenhum'` | linha de catálogo `not_applicable` ("Não se aplica") | verifiquei, não há |
| `''` ou `NULL` | `NULL` na coluna FK | ninguém preencheu |
| `'Clickbank'` em `channel` (3.710) | linha `misfiled_clickbank`, `is_selectable = false` | dado fora de lugar, preservado |

A terceira linha é a que resolve o problema real: um enum rejeitaria as 3.710, e `text` livre as
aceitaria sem nunca deixar claro que são um erro. Uma linha de catálogo não selecionável as mantém
íntegras **e** visíveis como anomalia, para a gestora decidir depois (§19.14 de `10`).

> **[M7] Isto também fecha uma inconsistência que D5 sozinha não cobria**: hoje o mesmo "Nenhum"
> é gravado literal pelo caminho do atendimento e **convertido para vazio** pelo caminho do reembolso
> (`src/pages/agent/Reembolsos.tsx:154` e `:157`). Por isso `refunds` tem só 36 "Nenhum" — são
> resíduo de antes da conversão. Com FK única para o catálogo, as duas telas gravam a mesma linha e
> a divergência deixa de ser possível (G8.1, G9.2).

#### [C8] A regra de derivação de `derived_status` — com fallback, obrigatoriamente

```sql
-- "última interação" pela ORDEM CANÔNICA (recorded_at, id) — a mesma de my_follow_ups(),
-- que é o que a tela mostra hoje. NÃO é a de maior seq.
WITH ultima AS (
  SELECT DISTINCT ON (ticket_id) ticket_id, status
  FROM interactions ORDER BY ticket_id, recorded_at DESC, id DESC
)
derived_status :=
  CASE
    WHEN u.status IS NULL AND t.legacy_status = 'concluido' THEN 'concluido'  -- ← o fallback
    WHEN u.status IS NULL                                   THEN 'novo'
    WHEN u.status = 'concluido'                             THEN 'concluido'
    ELSE 'em_andamento'
  END
```

O fallback está no legado em `src/features/services/useStatusTracking.ts:87` — é código vivo, não
suposição, e vale **1.220 tickets**.

A **ordem canônica é `(recorded_at, id)`**, não `(recorded_at, follow_up_number, id)`. A diferença
muda o status final de **37 tickets**, porque muda qual interação é a última. `seq` não serve como
critério: **12.753 linhas têm o número repetido** (M2).

O fallback não é detalhe: **1.220 tickets estão `concluido` em `services.status` e não têm interação
nenhuma**, porque foram concluídos antes de `service_follow_ups` existir (26/03/2026). Uma derivação
que olhe só `interactions` os marca `'novo'`, e **1.220 atendimentos concluídos reabrem na virada** —
o oposto de "nenhuma funcionalidade pode desaparecer" (§8 do contrato).

**A linha de base que a derivação tem de reproduzir**, medida em 26/09/2026:

| O que a tela mostra hoje | Tickets | `derived_status` no alvo |
|---|---|---|
| Em Aberto | 71.798 | `novo` |
| Em Andamento | 19.699 | `em_andamento` |
| Concluído via follow-up | 10.085 | `concluido` |
| **Concluído via `services.status`** | **1.220** | `concluido` — **só com o fallback** |

Por isso a coluna `status` (o valor legado) **permanece** no alvo: ela não é redundante com
`derived_status`, é insumo dele para os tickets anteriores a março.

O critério de desempate ser `recorded_at` e não `seq` também importa: hoje
`dashboard_follow_up_detail` usa `follow_up_number DESC` (R-MET-25) e `manager_list_users` usa
`recorded_at DESC` — duas telas que podem discordar, porque **12.753 linhas têm `seq` repetido**
(M2). Com uma definição só, materializada, a discordância acaba.

> A prova aritmética de que a derivação no cliente está errada hoje (M1): **1.271** tickets com
> `status = 'concluido'` contra **14.102** interações com `status = 'concluido'`. A tela lê a
> interação, o banco guarda a coluna, ninguém sincroniza.

Índices:

| Índice | Justificativa |
|---|---|
| `idx_tickets_owner_day (current_owner_id, business_day DESC, id DESC)` | a consulta quente: `GET /tickets` com `scope=owned`, e é a chave de keyset |
| `idx_tickets_creator_day (creator_id, business_day DESC, id DESC)` | `scope=created` e o crédito histórico das métricas |
| `idx_tickets_email_open (client_email_normalized) WHERE status <> 'concluido'` | **parcial** — é exatamente o `GET /tickets/lookup` (R-TKT-3), que hoje varre a tabela inteira |
| `idx_tickets_email_search (client_email_normalized text_pattern_ops)` | busca por e-mail que ignora o filtro de data |
| `idx_tickets_day (business_day)` | agregações da gestora sem filtro de agente |
| `idx_tickets_tracking (current_owner_id) WHERE has_tracking_code` | **parcial** — o filtro de código de rastreio da tela do agente |
| `idx_tickets_takeover (current_owner_id) WHERE takeover_approved_at IS NOT NULL` | **parcial** — `authorizedOpenCount` (R-TKO-10) |
| `idx_tickets_open_by_owner (current_owner_id) WHERE derived_status <> 'concluido'` | **parcial** — `openTicketsCount` e `GET /users/:id/open-tickets` |

> **Alerta de plano (memória `project_radar_pendencias_feature`)**: um helper no `WHERE` mata o índice parcial, e `OR` também. As consultas que usam os índices parciais acima precisam repetir o predicado literal, não chamar função.

Triggers de invariante que permanecem:
- `pin_business_day_on_insert` (R-TKT-1)
- `default_current_owner` (R-TKT-2)
- `block_frozen_fields` — `creator_id` imutável, `business_day` e `current_owner_id` só pela API (R-TKT-15/16/17), **sem** a carve-out do GUC
- `sync_refund_from_ticket` (R-REF-2…R-REF-6), mantido como rede de segurança
- `cleanup_refund_of_deleted_ticket` (R-REF-6)
- `touch_updated_at`

Enums:
```
ticket_status         := 'registered' | 'concluido'      -- [M1] dois valores, default 'registered'
ticket_derived_status := 'novo' | 'em_andamento' | 'concluido'
contact_reason        := 'duvida_de_uso' | 'reembolso' | 'cancelamento_de_compra'
                       | 'cancelamento_de_assinatura' | 'reclamacao_vsl'
                       | 'troca_de_endereco' | 'embalagem_danificada'
                       | 'duvida_de_envio' | 'ingredientes' | 'duvidas_geral' | 'outro'
-- [M4] channel NÃO vira enum: 3.710 linhas têm nome de plataforma de venda no campo
--      de canal, e um enum as rejeitaria. Permanece text.
```

### 3.2 `interactions`

Origem: `public.service_follow_ups`.

| Coluna | Tipo | Nulo | Origem | Conversão |
|---|---|---|---|---|
| `id` | `uuid` PK | não | `service_follow_ups.id` | `::uuid` |
| `ticket_id` | `uuid` FK → `tickets` `ON DELETE CASCADE` | não | `service_id` (`text`) | `::uuid` |
| `actor_id` | `uuid` FK → `users` | não | `user_id` (`text`) | `::uuid`. Quem **escreveu** (R-INT-12) |
| `seq` | `integer` | não | `follow_up_number` | **[M2] renumerado** com a **ordem canônica `(recorded_at, id)`**: `row_number() OVER (PARTITION BY ticket_id ORDER BY recorded_at, id)`. Medido: 5.543 pares repetidos e **12.753 linhas excedentes em 180 dias**, contra 12.755 no histórico inteiro — defeito em curso, não lixo antigo |
| `status` | `interaction_status` (enum) | não | `status` (`text`, sem `CHECK` hoje — R-INT-14) | `'em_andamento'` \| `'concluido'`; outro valor → `migration_rejects` |
| `note` | `text` | sim | `observation` | `CHECK (char_length(note) <= 2000)` — **novo** (R-INT-13) |
| `recorded_at` | `timestamptz` | não | idem | imutável (R-INT-8) |
| `business_day` | `date` GENERATED | não | — | `(recorded_at AT TIME ZONE 'America/Sao_Paulo')::date` |
| `is_same_day_repeat` | `boolean` | não | idem | default `false`. **[D1] PERMANECE.** A marcação nunca foi o bloqueio: é o que permite a métrica não contar a mesma conversa duas vezes (R-INT-4). O bloqueio saiu; a marcação fica |
| ~~`forced_justification`~~ | — | — | — | **[D1] não existe.** Só faria sentido com bloqueio e escape auditado; sem bloqueio, não há o que justificar |
| `created_at` | `timestamptz` | não | idem | |
| `legacy_id` | `text` | não | `service_follow_ups.id` | |
| `legacy_follow_up_number` | `integer` | não | `follow_up_number` | preserva o número original mesmo se `seq` for renumerado |

Constraints:
- `UNIQUE (ticket_id, seq)` — **é a correção de R-INT-6**, e com M2 ela deixa de ser opcional: preservar os números significaria abrir mão justamente da constraint cuja ausência causou o problema. A renumeração a torna possível, e `legacy_follow_up_number` preserva o original.
- `CHECK (recorded_at <= now() + interval '1 minute')` — nenhuma interação no futuro.

Índices:

| Índice | Justificativa |
|---|---|
| `idx_interactions_ticket_time (ticket_id, recorded_at ASC, id ASC)` | linha do tempo de `GET /tickets/:id/interactions` e chave de keyset |
| `idx_interactions_actor_day (actor_id, business_day)` | crédito por agente; alimenta o recálculo de rollup |
| `idx_interactions_same_day (business_day, actor_id) WHERE is_same_day_repeat` | **parcial** — `GET /metrics/same-day-repeats` (R-MET-5); espelha `idx_follow_ups_same_day_repeat` de hoje |

Triggers de invariante: `force_recorded_at_now` (R-INT-7), `block_recorded_at_change` (R-INT-8),
**`mark_same_day_repeat` (R-INT-4 — mantido palavra por palavra, §8-A/D1)**, `assign_seq` (R-INT-6),
`refresh_ticket_state` (atualiza `derived_status` pela regra de C8 acima, `interaction_count`,
`last_interaction_at`), `emit_interaction_fact`.

> **Armadilha de implementação**: quem ler só o título de D1 ("a regra das 18h sai") tende a
> remover `mark_same_day_repeat` junto. São coisas diferentes. Um teste de `13` §8 existe só para
> isso: registrar duas interações no mesmo dia precisa **passar** e a segunda precisa vir
> **marcada**.

### 3.3 `ticket_date_corrections`

Origem: `public.service_date_corrections`. Append-only.

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `id` | `uuid` PK | não | idem |
| `ticket_id` | `uuid` FK → `tickets` | não | `service_id` (`text` → `::uuid`) |
| `previous_day` | `date` | não | `previous_date` (`text` → data em SP) |
| `new_day` | `date` | não | `new_date` (idem) |
| `reason` | `text` | não | idem, `CHECK (char_length ≤ 500)` |
| `corrected_by` | `uuid` FK → `users` | não | `corrected_by` (`text` → `::uuid`) |
| `corrected_at` | `timestamptz` | não | idem |

Índice: `idx_ticket_date_corrections_ticket (ticket_id, corrected_at DESC)`.

### 3.4 `ticket_transfers`

Origem: `public.ticket_transfers`.

| Coluna | Tipo | Nulo | Origem | Nota |
|---|---|---|---|---|
| `id` | `uuid` PK | não | idem | |
| `ticket_id` | `uuid` FK → `tickets` `ON DELETE CASCADE` | não | `service_id` (`text`) | |
| `from_user_id` | `uuid` FK → `users` | não | idem (`text`) | |
| `to_user_id` | `uuid` FK → `users` | não | idem (`text`) | |
| `status` | `transfer_status` (enum) | não | idem | `pending` \| `accepted` \| `declined` \| `cancelled` |
| `origin` | `transfer_origin` (enum) | não | derivado | `peer` (hoje `assigned_by_manager_id IS NULL` e mensagem comum), `manager` (`assigned_by_manager_id IS NOT NULL`), `claim` (mensagem `'Atendimento assumido'`), `takeover` (mensagem `'Tomada autorizada pela gestora'`) — R-TRF-5, R-TRF-8 |
| `assigned_by_manager_id` | `uuid` FK → `users` | sim | idem | mantido para reconciliação |
| `message` | `text` | sim | idem | ≤500 |
| `response_note` | `text` | sim | idem | ≤500 |
| `responded_at` | `timestamptz` | sim | idem | |
| `created_at` | `timestamptz` | não | idem | |
| `legacy_id` | `text` | não | idem | |

> `recipient_seen_at` e `requester_seen_at` **saem daqui** e viram linhas em `notifications` (§5.1). O backfill converte cada `seen_at` na `seen_at` da notificação correspondente.

Constraints: `CHECK (from_user_id <> to_user_id)`; `UNIQUE (ticket_id, from_user_id) WHERE status = 'pending'` (R-TRF-2).

Índices: `idx_transfers_ticket (ticket_id, created_at DESC)`; `idx_transfers_pending_to (to_user_id) WHERE status = 'pending'` (parcial).

### 3.5 `ticket_takeover_requests`

Origem: `public.ticket_takeover_requests`.

| Coluna | Tipo | Nulo | Origem | Nota |
|---|---|---|---|---|
| `id` | `uuid` PK | não | idem | |
| `ticket_id` | `uuid` FK → `tickets` `ON DELETE CASCADE` | não | `service_id` | |
| `requester_id` | `uuid` FK → `users` | não | idem | |
| `owner_id` | `uuid` FK → `users` | sim | idem | |
| `status` | `takeover_status` (enum) | não | idem | `pending` \| `approved` \| `rejected` \| `cancelled` |
| `requester_note` | `text` | sim | `note` | ≤500 — **a nota do agente** |
| `response_note` | `text` | sim | — | **nova**: hoje a resposta sobrescreve `note` (R-TKO-9). Backfill: linhas `rejected` com `responded_at IS NOT NULL` têm `note` **ambígua** — vai para `requester_note` e fica registrado em `migration_rejects` como perda conhecida |
| `responded_at` | `timestamptz` | sim | idem | |
| `responded_by` | `uuid` FK → `users` | sim | idem | |
| `created_at` | `timestamptz` | não | idem | |

Constraints: `CHECK (requester_id <> owner_id)`; `UNIQUE (ticket_id, requester_id) WHERE status = 'pending'` (R-TKO-5).

Índices: `idx_takeover_pending (created_at DESC) WHERE status = 'pending'` (parcial — é a fila da gestora); `idx_takeover_requester (requester_id, created_at DESC)`.

---

## 4. Tabelas de reembolso

### 4.1 `refunds`

Origem: `public.refunds`.

| Coluna | Tipo | Nulo | Origem | Conversão |
|---|---|---|---|---|
| `id` | `uuid` PK | não | `refunds.id` (`text`) | `::uuid` |
| `owner_id` | `uuid` FK → `users` | não | `refunds.user_id` (**`text`**) | `::uuid` — hoje `my_refunds_with_refunded_value` já faz `r.user_id::uuid` |
| `ticket_id` | `uuid` FK → `tickets` `ON DELETE SET NULL` | sim | `refunds.service_id` (`text`) | `::uuid`. `NULL` = cadastrado direto na aba (R-REF-10) |
| `customer_email` | `text` | não | idem | `btrim` |
| `customer_email_normalized` | `citext` GENERATED | não | — | `lower(btrim(customer_email))` |
| `order_id` | `text` | não | idem | `btrim`, ≤100 |
| `product_id` | `uuid` FK → `products` | sim | `refunds.product` (`text` livre) | resolve por nome; não achou → cria no backfill (R-REF-25) |
| `sales_platform_id` | `smallint` FK → `sales_platforms` | **sim** | `refunds.sales_platform` (`text` livre) | **[M5, M7]** resolve por `citext` contra os **10** valores medidos; `'Nenhum'` (36) → `not_applicable`; vazio → `NULL`. Um enum com os 8 do seletor rejeitaria 282 linhas reais (`Hotmart` 143, `PagAmerican` 139) — §4.5 |
| `channel_id` | `smallint` FK → `channels` | sim | `refunds.channel` (`text`) | mesma regra de `tickets.channel_id` (§4.5) |
| `request_date` | `date` | não | `refunds.request_date` (**`text`**) | `text_to_date_safe` equivalente; falha → `migration_rejects` (R-CPY-6) |
| `completion_date` | `date` | sim | `refunds.completion_date` (**`text`**) | idem |
| `status` | `refund_status` GENERATED | não | — | `'done'` quando `completion_date IS NOT NULL`, senão `'open'` (R-REF-1) |
| `reason` | `refund_reason` (enum) | sim | idem (`text`) | 15 valores (R-REF-14); texto antigo fora da lista → `reason_legacy` |
| `reason_legacy` | `text` | sim | `refunds.reason` | preserva o texto livre anterior a mai/2026 (R-REF-22) |
| `refund_percent` | `smallint` | sim | `refunds.refund_type` (`text`) | **[M6]** percentual **inteiro** (0–100), não o texto `'80%'`. Medido: 21 variantes, maior grupo **vazio (1.242)**, `05%` com zero à esquerda e os demais sem, `95%` com 1 linha. Guardar número resolve ordenação e zero à esquerda de uma vez; o rótulo `"80%"` é formatação de tela |
| `refund_value` | `numeric(12,2)` | sim | idem (**`double precision`**) | **[D4]** dólar. Sai do ponto flutuante: `round(value::numeric, 2)` |
| `refunded_value` | `numeric(12,2)` GENERATED | sim | — | **[D4/M6]** `round(refund_value * refund_percent / 100.0, 2)`; `NULL` se faltar um dos dois (R-REF-20). Deixa de depender de `regexp` sobre texto |
| `items_returned` | `boolean` | não | idem | default `false` |
| `created_from_ticket` | `boolean` | não | `created_from_service` | default `false` (R-REF-6) |
| `picked_up_at` | `timestamptz` | sim | idem | (R-REF-7) |
| `picked_up_by` | `uuid` FK → `users` | sim | idem (`text`) | `::uuid` |
| `created_at` | `timestamptz` | não | idem | |
| `updated_at` | `timestamptz` | não | — | novo |
| `legacy_id` | `text` | não | `refunds.id` | |
| `legacy_request_date` | `text` | não | `refunds.request_date` | prova da conversão |
| `legacy_completion_date` | `text` | sim | `refunds.completion_date` | idem |
| `legacy_refund_type` | `text` | sim | `refunds.refund_type` | **[M6]** preserva o texto original (`'05%'`, `''`, `'95%'`), para reconciliar a conversão |
| `legacy_sales_platform` | `text` | não | `refunds.sales_platform` | **[M5]** preserva a grafia original, inclusive a diferença de caixa `ClickBank`/`Clickbank` |

Constraints:
- `UNIQUE (ticket_id) WHERE ticket_id IS NOT NULL` — um reembolso por atendimento (R-REF-9).
- `CHECK (completion_date IS NULL OR completion_date >= request_date)` — **novo**, hoje só a gestora
  é validada (R-REF-15). **[M3]** Medido: **39 linhas** de 2026 violam. Entra **`NOT VALID`**, as 39
  vão para `migration_rejects` com `severity = 'warning'`, e o caminho novo nasce validando.
- `CHECK (refund_value IS NULL OR refund_value >= 0)` — **novo**.
- `CHECK (refund_percent IS NULL OR refund_percent BETWEEN 0 AND 100)` — **[M6]**. A restrição a
  múltiplos de 5 (`refund_percent % 5 = 0`) é satisfeita pelos dados atuais, mas **não** entra sem
  confirmação do dono: fechar em múltiplos de 5 impede um reembolso de 33% que a operação talvez
  queira amanhã (§19.16 de `10`).
- `CHECK (completion_date IS NULL OR (refund_value IS NOT NULL AND refund_percent IS NOT NULL AND reason IS NOT NULL))`
  — **novo**: baixa sem os campos obrigatórios não existe (R-REF-12). **[M3]** Medido: **zero
  linhas** violam isso em 2026. Entra `VALID`.

Índices:

| Índice | Justificativa |
|---|---|
| `idx_refunds_owner_request (owner_id, request_date DESC, id DESC)` | `GET /refunds` e chave de keyset |
| `idx_refunds_open_by_email (customer_email_normalized) WHERE completion_date IS NULL` | **parcial** — é a busca de reembolso equivalente no vínculo automático (R-REF-3); espelha `idx_refunds_open_by_email` de hoje |
| `idx_refunds_open (owner_id) WHERE completion_date IS NULL` | **parcial** — "em aberto" é a aba padrão e o alerta de atraso |
| `idx_refunds_unpicked (owner_id) WHERE picked_up_at IS NULL AND ticket_id IS NOT NULL` | **parcial** — a lista "apagada" (R-REF-7) |
| `idx_refunds_completion (completion_date) WHERE completion_date IS NOT NULL` | **parcial** — métricas por data de conclusão (R-MET-17) |
| `idx_refunds_request_page (request_date DESC, id DESC)` | **[D7]** é o que torna a paginação numerada barata: o `OFFSET` salta linhas que o índice já ordenou, em vez de percorrer predicado não indexável |

Triggers: `touch_updated_at`, `classify_refund_reason` (R-REF-21), `emit_refund_event`.

### 4.2 `refund_reason_classifications`

Origem: `public.refund_reason_classifications`. Relação 1:1 com `refunds`.

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `refund_id` | `uuid` PK FK → `refunds` `ON DELETE CASCADE` | não | idem (`text` → `::uuid`) |
| `category` | `refund_reason_category` (enum) | não | `category` (`text`) |
| `classification_method` | `text` | não | idem |
| `original_reason` | `text` | sim | idem — a partir de jun/2026 repete o rótulo (R-REF-22) |
| `classified_at`, `updated_at` | `timestamptz` | não | idem |

Trigger: `sync_refund_reason_classification` (permanece).

### 4.3 `refund_events` — **tabela nova**

Substitui `public.refund_manager_completions` e o amplia: hoje **só** a baixa da gestora é auditada (R-REF-16, R-REF-18). Append-only.

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `uuid` PK | não | |
| `refund_id` | `uuid` FK → `refunds` `ON DELETE CASCADE` | não | |
| `kind` | `refund_event_kind` (enum) | não | `created` \| `linked_to_ticket` \| `picked_up` \| `updated` \| `completed` \| `reopened` \| `deleted` |
| `actor_id` | `uuid` FK → `users` | não | quem fez |
| `actor_role` | `app_role` | não | congelado no momento do evento |
| `refund_owner_id` | `uuid` FK → `users` | não | de quem era o reembolso |
| `completion_date` | `date` | sim | só em `completed` |
| `refund_value` | `numeric(12,2)` | sim | **`numeric`, não `double precision`** — o legado usa `double precision` |
| `refund_type` | `refund_percent` | sim | |
| `reason` | `refund_reason` | sim | |
| `items_returned` | `boolean` | sim | |
| `days_overdue` | `integer` | sim | **decisão 19.6**: `completion_date − request_date`. O legado grava `hoje − request_date` (R-REF-17) |
| `note` | `text` | sim | justificativa de `reopened`/`deleted` |
| `occurred_at` | `timestamptz` | não | |
| `legacy_completion_id` | `uuid` | sim | id da linha de `refund_manager_completions` |

**O que recebe no backfill**: uma linha `completed` para cada `refund_manager_completions` (com `actor_role = 'manager'`, `legacy_completion_id` preenchido, `days_overdue` **copiado cru** e um segundo campo `days_overdue_recomputed` — ou a migração aceita o número antigo; decisão 19.6) e uma linha `completed` **sintética** para cada `refunds.completion_date IS NOT NULL` que **não** tem linha de auditoria (são as baixas feitas pelo agente), com `actor_id = owner_id`, `actor_role = 'agent'` e `note = 'reconstruído no backfill: baixa do agente sem auditoria no legado'`.

Índices: `idx_refund_events_refund (refund_id, occurred_at DESC)`; `idx_refund_events_time (occurred_at DESC)`.

### 4.5 `sales_platforms` e `channels` — **catálogos únicos [M5, M7, G9.1–G9.4]**

Substituem o enum que a trilha havia proposto, e resolvem três problemas medidos de uma vez.

**O que estava errado.** Existem **três cópias** da lista de plataformas no código, em **dois
conteúdos diferentes**:

| Arquivo | Valores |
|---|---|
| `src/pages/agent/Atendimentos.tsx:134` | 9, **com** `PagAmerican` |
| `src/features/services/EditServiceDialog.tsx:110` | 9, **com** `PagAmerican` |
| `src/features/refunds/types.ts:23` | **8, sem** `PagAmerican` |

O agente pode registrar um **atendimento** com `PagAmerican` e **não pode** registrar um
**reembolso** com a mesma plataforma — e existem **139 reembolsos com esse valor no banco**, ou seja,
entraram por outro caminho. Pior: `PagAmerican` aparece também dentro da lista de **produtos** de
reembolso (`src/features/refunds/types.ts:100`), que é outro domínio inteiro.

#### `sales_platforms`

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `smallint` PK (identity) | não | |
| `code` | `text` | não | chave estável, em inglês: `cartpanda`, `not_applicable`, … |
| `name` | `citext` | não | grafia **canônica** exibida |
| `kind` | `platform_kind` (enum) | não | `real` \| `not_applicable` \| `misfiled` |
| `is_selectable` | `boolean` | não | `true` = aparece nos seletores |
| `sort_order` | `smallint` | não | |
| `created_at` | `timestamptz` | não | |

Constraints: `UNIQUE (code)`, `UNIQUE (name)` — `citext` resolve a armadilha da caixa (`ClickBank`
em reembolsos e `Clickbank` em canal são o mesmo nome escrito de dois jeitos).

**Semente do backfill** — os 10 valores medidos em `refunds`, mais o valor nomeado de ausência:

| `code` | `name` | linhas em `refunds` | `kind` | `is_selectable` |
|---|---|---|---|---|
| `cartpanda` | Cartpanda | 2.400 | `real` | sim |
| `buygoods` | Buygoods | 1.452 | `real` | sim |
| `clickbank` | ClickBank | 1.414 | `real` | sim |
| `hotmart` | Hotmart | 143 | `real` | **pendente** |
| `pagamerican` | PagAmerican | 139 | `real` | **pendente** |
| `logicall` | LogiCall | 59 | `real` | sim |
| `salesbound` | SalesBound | 45 | `real` | sim |
| `cartcandy` | CartCandy | 22 | `real` | sim |
| `digistore24` | Digistore24 | 4 | `real` | sim |
| `not_applicable` | Não se aplica | 36 (era `'Nenhum'`) | `not_applicable` | sim |

`Hotmart` e `PagAmerican` existem no banco e **não** no seletor de reembolso de hoje — mas
`PagAmerican` **está** no seletor de atendimento. As duas possibilidades (eram válidas e alguém
removeu de uma tela; ou entraram por importação) levam a decisões diferentes, e a decisão é do dono
(§19.15 de `10`). Enquanto não houver resposta entram com `is_selectable = false`: o histórico fica
válido e nenhuma tela muda.

#### `channels`

Mesma forma. Semente com os valores medidos em `services`:

| `code` | `name` | linhas | `kind` | `is_selectable` |
|---|---|---|---|---|
| `sms` | SMS | 36.081 | `real` | sim |
| `email` | Email | 30.887 | `real` | sim |
| `not_applicable` | Não se aplica | 1.128 (era `'Nenhum'`) | `not_applicable` | sim |
| `misfiled_clickbank` | Clickbank (fora de lugar) | 3.710 | `misfiled` | **não** |

O vazio (30.994) **não** é linha de catálogo: vira `NULL` na coluna FK, que é "não preenchido".

#### As garantias que estes dois catálogos cumprem

| Garantia | Como |
|---|---|
| **G9.1** domínio fechado é catálogo com FK, nunca texto livre | `tickets.platform_id`, `tickets.channel_id`, `refunds.sales_platform_id` |
| **G9.2** a lista da tela **deriva** do catálogo | `GET /sales-platforms?selectable=true` e `GET /channels?selectable=true` alimentam os seletores; as três listas literais do código deixam de existir |
| **G9.3** ausência tem significado só | `not_applicable` é linha nomeada; `NULL` é "não preenchido". Nunca um texto disputando sentido com um vazio |
| **G8.1** uma ação, um comportamento | as duas telas gravam a mesma linha; a conversão para vazio de `Reembolsos.tsx:154` desaparece |

> **Por que catálogo e não enum**: acrescentar plataforma a um enum exige `ALTER TYPE` em migration —
> exatamente a armadilha do catálogo de produtos (R-TKT-12, o bug do Jellyrock). Plataforma nova deve
> ser linha, não deploy. E `kind = 'misfiled'` é o que um enum não sabe expressar: dado errado que se
> preserva sem fingir que está certo.

> **Pendência de domínio, não de schema**: `PagAmerican` estar na lista de **produtos** de reembolso
> (`types.ts:100`) é confusão entre plataforma e produto. O catálogo de produtos é outro (§2.4), e a
> limpeza dessa entrada é decisão do dono. → `90-BACKLOG.md`

### 4.4 `external_refunds`### 4.4 `external_refunds`

Origem: `public.external_refunds` — **existe em produção (4.026 linhas) e não existe em
`supabase/migrations/`**. É a base do comparativo interno × externo (R-REF-27), alimentada por
importação de CSV das plataformas (PagAmerican, Buygoods).

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `bigint` identity | não | mantém o valor |
| `product` | `text` | não | **não** vira FK: é o nome como a plataforma escreve, que pode não casar com `products` |
| `month_ref` | `date` | não | mês de referência do arquivo |
| `source_file` | `text` | não | |
| `order_date` | `date` | não | |
| `order_name` | `text` | não | como a plataforma escreve |
| `order_number` | `text` GENERATED | sim | `normalize_order_number(order_name)` — **é a chave do casamento** com `refunds.order_id` |
| `address`, `address2`, `zip`, `city`, `province`, `full_name`, `mobile_no`, `shipping_method`, `status` | `text` | sim | dados da plataforma; contêm PII de cliente |
| `product_count` | `smallint` | não | default 1 |
| `product_id`, `variant_id` | `bigint` | sim / não | ids da plataforma, não do nosso catálogo |
| `refund_amount` | `numeric` | não | default 0 |

Índices: `idx_external_refunds_match (order_number, month_ref)` — é o `JOIN` do casamento;
`idx_external_refunds_month (month_ref)`.

Regra de negócio que vive aqui: **% interno = casados ÷ total** (regra do gestor, PR #70 — R-REF-27),
e o casamento **depende da plataforma**. A função `normalize_order_number` é o que torna o casamento
possível e precisa migrar junto, como função `IMMUTABLE` (é coluna gerada).

**Esta tabela não aparece em nenhuma migration.** Antes de migrar é preciso descobrir como ela é
alimentada hoje (provavelmente `INSERT` manual ou script fora do repositório) e transformar isso em
`POST /refunds/external-import` (Lacuna 8 de `11`).

> **PII**: `external_refunds` tem nome, telefone e endereço completo de cliente. Não entra no alcance
> do SQL livre da Lya (emenda §3).

---

## 5. Tabelas de notificação e de fato

### 5.1 `notifications` — **tabela nova**

Unifica os três sinos (R-TRF-3, R-TKO-6, R-REF-26) e acrescenta três tipos que hoje não existem (§6 de `11`).

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `uuid` PK | não | |
| `user_id` | `uuid` FK → `users` | não | o destinatário |
| `kind` | `notification_kind` (enum) | não | `transfer_received` \| `transfer_answered` \| `takeover_requested` \| `takeover_answered` \| `refund_overdue` \| `radar_due` \| `held_order_assigned` |
| `payload` | `jsonb` | não | o mínimo para invalidar a query (§4 do contrato) |
| `ticket_id` | `uuid` FK → `tickets` `ON DELETE CASCADE` | sim | desnormalizado para o índice |
| `refund_id` | `uuid` FK → `refunds` `ON DELETE CASCADE` | sim | idem |
| `source_id` | `uuid` | sim | id da transferência / pedido / caso que gerou |
| `seen_at` | `timestamptz` | sim | |
| `created_at` | `timestamptz` | não | |

Constraints: `UNIQUE (kind, source_id, user_id)` — evita notificação duplicada quando o evento é reemitido.

Índices: `idx_notifications_unseen (user_id, created_at DESC) WHERE seen_at IS NULL` — **parcial**, é o badge do sino; `idx_notifications_user (user_id, created_at DESC, id DESC)` — chave de keyset.

**O que recebe no backfill**:
- uma `transfer_received` para cada `ticket_transfers` com `status='pending'`, `seen_at = recipient_seen_at`;
- uma `transfer_answered` para cada `ticket_transfers` respondida, `user_id = from_user_id`, `seen_at = requester_seen_at`;
- uma `takeover_requested` para cada `ticket_takeover_requests` pendente, para cada usuário com `can_approve_takeovers`;
- **nada** de `refund_overdue`, `radar_due` e `held_order_assigned`: são calculados, não históricos.

### 5.2 `interaction_facts` — **tabela nova**

Materializa `_interaction_events` (R-MET-1). Uma linha por evento contável.

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `uuid` PK | não | |
| `kind` | `interaction_fact_kind` (enum) | não | `ticket_created` \| `interaction` |
| `source_id` | `uuid` | não | `tickets.id` ou `interactions.id` |
| `ticket_id` | `uuid` FK → `tickets` `ON DELETE CASCADE` | não | |
| `actor_id` | `uuid` FK → `users` | não | criador (para `ticket_created`) ou autor da interação (R-MET-2) |
| `business_day` | `date` | não | dia em São Paulo (R-MET-3) |
| `occurred_at` | `timestamptz` | não | `tickets.created_at` ou `interactions.recorded_at` — é o que `GET /metrics/hourly` usa |
| `product_id` | `uuid` FK → `products` | sim | **denormalizado do ticket** |
| `platform` | `text` | sim | idem |
| `channel` | `channel` | sim | idem |
| `contact_reason` | `contact_reason` | sim | idem |
| `has_tracking_code` | `boolean` | não | idem (R-MET-8) |
| `is_same_day_repeat` | `boolean` | não | `false` para `ticket_created` (R-MET-6) |

Constraints: `UNIQUE (kind, source_id)` — é a garantia de que nada conta duas vezes.

Índices:

| Índice | Justificativa |
|---|---|
| `idx_facts_day_actor (business_day, actor_id)` | toda métrica por agente e período |
| `idx_facts_actor_day (actor_id, business_day)` | `GET /metrics/me` |
| `idx_facts_ticket (ticket_id)` | o `EXISTS` do filtro "teve interação no período" de `GET /tickets` |
| `idx_facts_day_kind (business_day, kind)` | separação criação × interação, usada por `GET /metrics/follow-ups` |
| `BRIN (occurred_at)` | `GET /metrics/hourly` varre faixas longas; BRIN custa quase nada em disco numa tabela append-only por tempo |

**O que recebe no backfill**: exatamente o `UNION ALL` de `_interaction_events(data_mínima, hoje, NULL)` — uma linha `ticket_created` por `services` e uma `interaction` por `service_follow_ups`, com as colunas denormalizadas vindas do `JOIN` com `services`. A **prova de migração** é: para cada dia e agente, `count(*)` em `interaction_facts` = resultado de `_interaction_events` no legado. Diferença ≠ 0 bloqueia o corte.

Manutenção: triggers `emit_interaction_fact` em `tickets` (`AFTER INSERT`, e `AFTER UPDATE OF business_day` para a correção de data — R-TKT-22) e em `interactions` (`AFTER INSERT`, `AFTER DELETE`).

> **Por que tabela e não view materializada** — ver "Propostas de emenda §2".

### 5.3 `daily_rollups` — **tabela nova**

Substitui `agent_daily_service_counts` (R-MET-35), que é um rollup que nenhuma tela lê.

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `business_day` | `date` | não | PK composta |
| `actor_id` | `uuid` FK → `users` | não | PK composta |
| `total_count` | `integer` | não | eventos do agente no dia |
| `tickets_created` | `integer` | não | |
| `interactions` | `integer` | não | |
| `same_day_repeats` | `integer` | não | (R-MET-5) |
| `tickets_concluded` | `integer` | não | |
| `refunds_created` | `integer` | não | por `request_date` |
| `refunds_completed` | `integer` | não | por `completion_date` |
| `refunds_completed_value` | `numeric(14,2)` | não | |
| `held_orders_confirmed` | `integer` | não | (R-HLD-18) |
| `by_channel` | `jsonb` | não | `{ "SMS": 12, "Email": 40 }` |
| `by_platform` | `jsonb` | não | |
| `by_product` | `jsonb` | não | `{ "<productId>": n }` |
| `computed_at` | `timestamptz` | não | |

Chave: `PRIMARY KEY (business_day, actor_id)`.

Índices: `idx_rollups_day (business_day)` para o agregado do time.

**O que recebe no backfill**: um `GROUP BY (business_day, actor_id)` sobre `interaction_facts` recém-populada, mais as contagens de `refunds` e `held_orders`. A **prova** é: `SUM(total_count)` por período = `count(*)` de `interaction_facts` no mesmo período (é a garantia R-MET-4, agora verificável por consulta).

Manutenção: **ver "Propostas de emenda §1"** — incremental por trigger ou recálculo por dia afetado.

### 5.4 `migration_rejects` — **tabela nova**

Toda linha do legado que não converte. É o que impede a migração de perder dado em silêncio.

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `bigint` PK (identity) | não | |
| `source_table` | `text` | não | `'services'`, `'refunds'`, … |
| `source_pk` | `text` | não | o id cru, do jeito que está no legado |
| `reason_code` | `text` | não | `INVALID_UUID` \| `INVALID_DATE` \| `UNKNOWN_ENUM_VALUE` \| `FK_NOT_FOUND` \| `CHECK_VIOLATION` \| `DUPLICATE_KEY` \| `AMBIGUOUS_FIELD` |
| `column_name` | `text` | sim | qual coluna causou |
| `raw_value` | `text` | sim | o valor cru |
| `raw_row` | `jsonb` | não | a linha inteira, para reconstrução manual |
| `severity` | `text` | não | `blocking` \| `warning` |
| `rejected_at` | `timestamptz` | não | |

Índices: `idx_rejects_table_reason (source_table, reason_code)`.

Regra de corte proposta (**precisa de aval — Lacuna 3**): qualquer linha `blocking` em `tickets`, `interactions`, `refunds` ou `users` **impede** o corte. `warning` (produto criado no backfill, `sales_platform` desconhecida, nota de takeover ambígua) é registrado e segue.

---

## 6. Tabelas operacionais

### 6.1 `held_orders`

Origem: `public.held_orders`. **Nenhuma coluna do CSV é descartada** (§8 do contrato).

| Coluna | Tipo | Nulo | Origem | Nota |
|---|---|---|---|---|
| `id` | `uuid` PK | não | idem | já é `uuid` no legado |
| `dyna_code` | `text` | não | idem | |
| `order_number` | `text` | sim | idem | `NOT NULL` no legado original, relaxado depois |
| `import_key` | `text` | não | idem | `order_number` ou hash da linha (R-HLD-2) |
| `rma` | `text` | sim | idem | entra na identidade das devoluções (R-HLD-2) |
| `merged_orders`, `reason`, `email`, `customer_name`, `city`, `street1`, `street2`, `street3`, `state`, `country`, `postal_code`, `age`, `items`, `damaged_items`, `restocked_items`, `comments`, `source_file` | `text` | sim | idem | `age` fica **cru** (`"5 day(s)"`) por decisão do legado |
| `order_date` | `date` | sim | idem | |
| `client_key` | `text` GENERATED | não | `held_order_client_key(email, customer_name, id)` | R-HLD-6 |
| `assigned_to` | `uuid` FK → `users` | sim | idem (`text`) | `::uuid` |
| `assign_count` | `integer` | não | idem | R-HLD-19 |
| `agent_status` | `held_order_status` (enum) | não | idem | `novo` \| `em_andamento` \| `concluido` |
| `pending_tag` | `held_order_pending_tag` (enum) | sim | idem | 4 valores (R-HLD-13) |
| `duplicate_of` | `uuid` FK → `held_orders` | sim | idem | R-HLD-5 |
| `confirmed_at` | `timestamptz` | sim | idem | R-HLD-15 |
| `confirmed_by` | `uuid` FK → `users` | sim | idem (`text`) | |
| `imported_at` | `timestamptz` | não | idem | |
| `imported_by` | `uuid` FK → `users` | sim | idem (`text`) | |
| `legacy_status` | `text` | sim | `held_orders.status` | R-HLD-20: **não** vira coluna de estado; só reconciliação |

Constraints:
- `UNIQUE (dyna_code, import_key) WHERE agent_status <> 'concluido' AND duplicate_of IS NULL` — **parcial**, é a invariante "um pedido em aberto por vez" (R-HLD-3).
- `CHECK (agent_status <> 'concluido' OR pending_tag IS NULL)` — concluir limpa a tag (R-HLD-14).
- `CHECK (agent_status <> 'concluido' OR confirmed_at IS NOT NULL)`.

Índices:

| Índice | Justificativa |
|---|---|
| `idx_held_open_by_agent (assigned_to, imported_at DESC, id DESC) WHERE agent_status <> 'concluido' AND duplicate_of IS NULL` | **parcial** — a lista do agente e a chave de keyset |
| `idx_held_pending_tag (assigned_to, pending_tag) WHERE pending_tag IS NOT NULL` | **parcial** — filtro de pendência (espelha o índice de hoje) |
| `idx_held_client_open (client_key) WHERE agent_status <> 'concluido' AND duplicate_of IS NULL` | **parcial** — a checagem da invariante de cliente único (R-HLD-9) |
| `idx_held_confirmed_by_day (confirmed_by, confirmed_at) WHERE agent_status = 'concluido'` | **parcial** — meta diária (R-HLD-18) |

Triggers de invariante que permanecem: `held_orders_client_single_agent` em `INSERT` e `UPDATE` (R-HLD-9), `touch_updated_at`.

### 6.2 `held_order_events`

Origem: `public.held_order_events`. Append-only (R-HLD-16).

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `id` | `uuid` PK | não | idem |
| `order_id` | `uuid` FK → `held_orders` `ON DELETE CASCADE` | não | idem |
| `actor_id` | `uuid` FK → `users` | não | `user_id` (`text` → `::uuid`) |
| `status` | `held_order_status` | não | idem |
| `pending_tag` | `held_order_pending_tag` | sim | idem |
| `note` | `text` | sim | idem, ≤1000 |
| `recorded_at` | `timestamptz` | não | idem |

Índice: `idx_held_events_order (order_id, recorded_at DESC)`.

### 6.3 `radar_items`

Origem: `public.radar_items`. As constraints do legado são boas e migram **literalmente**.

| Coluna | Tipo | Nulo | Origem | Conversão |
|---|---|---|---|---|
| `id` | `uuid` PK | não | idem | já `uuid` |
| `owner_id` | `uuid` FK → `users` | não | `user_id` (`text`) | `::uuid` |
| `client_email` | `text` | não | idem | |
| `client_email_normalized` | `citext` GENERATED | não | — | `lower(btrim())` |
| `order_number` | `text` | sim | idem | |
| `product_id` | `uuid` FK → `products` | sim | `product` (`text` livre) | resolve por nome; não achou vira `product_legacy` |
| `product_legacy` | `text` | sim | `product` | preserva o texto livre |
| `kind` | `radar_kind` (enum) | não | idem | 9 valores |
| `action_needed` | `text` | não | idem | ≤1000 |
| `status` | `radar_status` (enum) | não | idem | 6 valores |
| `next_follow_up_date` | `date` | sim | idem | |
| `notes` | `text` | não | idem | default `''`, ≤4000 |
| `closed_at` | `timestamptz` | sim | idem | |
| `created_at`, `updated_at` | `timestamptz` | não | idem | |

Constraints (cópia fiel — R-RAD-2, R-RAD-3, R-RAD-5):
- `CHECK ((status IN ('resolvido','cancelado')) = (next_follow_up_date IS NULL))`
- `CHECK ((status IN ('resolvido','cancelado')) = (closed_at IS NOT NULL))`
- `CHECK (btrim(client_email) <> '')`, `CHECK (btrim(action_needed) <> '')`
- `UNIQUE (owner_id, client_email_normalized, COALESCE(btrim(order_number),''), kind) WHERE status NOT IN ('resolvido','cancelado')`

Índices:
- `idx_radar_open (owner_id, next_follow_up_date) WHERE status NOT IN ('resolvido','cancelado')` — **parcial**, é "meus casos em aberto, do mais atrasado ao mais distante".
- `idx_radar_closed (owner_id, closed_at DESC) WHERE status IN ('resolvido','cancelado')` — **parcial**, aba "Resolvidos" (R-RAD-10).

### 6.4 `radar_events`

Origem: `public.radar_events`. Append-only (R-RAD-7).

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `id` | `uuid` PK | não | idem |
| `item_id` | `uuid` FK → `radar_items` `ON DELETE CASCADE` | não | idem |
| `actor_id` | `uuid` FK → `users` | não | `user_id` (`text` → `::uuid`) |
| `status` | `radar_status` | não | idem |
| `action` | `text` | não | default `''`, ≤1000 |
| `next_follow_up_date` | `date` | sim | idem |
| `recorded_at` | `timestamptz` | não | idem |

Índice: `idx_radar_events_item (item_id, recorded_at DESC)`.

### 6.5 `agent_notes`

Origem: `public.agent_notes`.

| Coluna | Tipo | Nulo | Origem |
|---|---|---|---|
| `id` | `uuid` PK | não | idem |
| `owner_id` | `uuid` FK → `users` | não | `user_id` (`text` → `::uuid`) |
| `note_day` | `date` | não | `note_date`; default = hoje em SP (R-NOT-1) |
| `body` | `text` | não | idem |
| `kind` | `note_kind` (enum) | não | `nota` \| `tarefa` |
| `done` | `boolean` | não | idem |
| `done_at` | `timestamptz` | sim | idem |
| `pinned` | `boolean` | não | idem |
| `created_at`, `updated_at` | `timestamptz` | não | idem |

Constraints (cópia fiel — R-NOT-4, R-NOT-5, R-NOT-6):
`CHECK (btrim(body) <> '' AND char_length(body) <= 4000)`, `CHECK (kind = 'tarefa' OR done = false)`, `CHECK (done = (done_at IS NOT NULL))`.

Índices: `idx_notes_page (owner_id, note_day DESC, pinned DESC, created_at DESC)`; `idx_notes_pending (owner_id) WHERE kind = 'tarefa' AND NOT done` (parcial).

**RLS**: policy única e simétrica — `owner_id = auth.uid()`, `USING` e `WITH CHECK`. **Nem a gestora lê** (R-NOT-3). Esta é a única tabela do sistema sem carve-out de gestora, e isso é intencional.

### 6.6 `support_products`, `support_sms_brands`, `support_sms_replies`

Origem: as três tabelas homônimas. **Os nomes de coluna estão em português no legado** (`nome`, `funcao`, `estrutura`, `plataforma`, `bonus_url`, `bonus_tipo`, `nicho`, `ativo`, `categoria`, `titulo`, `texto_en`, `texto_pt`); §2 do contrato manda coluna em inglês, então o mapeamento é:

| `support_products` novo | legado |
|---|---|
| `id` `uuid` PK | `id` |
| `name` `citext` NOT NULL | `nome` |
| `purpose` `text` | `funcao` |
| `url` `text` | `url` |
| `structure` `support_structure` (enum `new`\|`old`) NOT NULL | `estrutura` (`nova`\|`antiga`) |
| `platform` `text` | `plataforma` |
| `bonus_url` `text` | `bonus_url` |
| `bonus_kind` `support_bonus_kind` (enum `simple`\|`super`) | `bonus_tipo` |
| `niche` `text` | `nicho` |
| `sms_number` `text` | `sms_number` |
| `links` `jsonb` NOT NULL DEFAULT `'[]'` | `links` |
| `is_active` `boolean` NOT NULL | `ativo` |
| `sort_order` `integer` NOT NULL | `sort_order` |
| `created_at`, `updated_at`, `updated_by` | idem (`updated_by` `text` → `::uuid`) |

`support_sms_brands`: `name` ← `nome`, `system_name` ← `sistema`, `structure` ← `estrutura`, `sms_number`, `is_active` ← `ativo`, `sort_order`, carimbos.
`support_sms_replies`: `category` ← `categoria`, `title` ← `titulo`, `text_en` ← `texto_en`, `text_pt` ← `texto_pt`, `is_active` ← `ativo`, `sort_order`, carimbos.

Constraints: `UNIQUE (lower(name))` em produtos e marcas (R-BAS-5); `CHECK (jsonb_typeof(links) = 'array')` (R-BAS-6).
Índices: `(structure, sort_order, name)` nas duas primeiras; `(sort_order, category, title)` na terceira (R-BAS-7).
Trigger: `support_base_touch` (R-BAS-4).

### 6.7 `training_videos` e `training_video_views`

Origem: as duas homônimas. Conversões: `id`, `user_id`, `video_id` para `uuid`; `user_id` → `viewer_id`.

`training_videos`: `id`, `title`, `description`, `section`, `display_order`, `duration_seconds`, `thumbnail_url`, `video_url`, `is_published`, `created_at`, `updated_at`.
`training_video_views`: `id`, `video_id` FK, `viewer_id` FK → `users`, `watched_seconds integer NOT NULL CHECK (>= 0)`, `completed boolean NOT NULL`, `last_watched_at timestamptz NOT NULL`, `created_at`.

Constraints: `UNIQUE (viewer_id, video_id)` — hoje é o `onConflict` do upsert (R-TRN-2).
Índices: `idx_training_videos_catalog (section, display_order) WHERE is_published` (parcial); `idx_training_views_viewer (viewer_id)`.

`completed` é **derivado no servidor** (`watched_seconds >= 0.9 × duration_seconds`). R-TRN-6
continua **aberto** — não estava entre as sete decisões — então a especificação assume a derivação
no servidor por ser a que não deixa o cliente decidir conclusão de treinamento, e registra a
alternativa. → `90-BACKLOG.md`

### 6.8 `goal_policies` — **[D3] metas e faixas com vigência**

Origem: `public.goals` (que hoje nenhuma tela lê — R-USR-13) **mais** as constantes que vivem no
bundle: `dailyGoal` 100/150 (`Atendimentos.tsx:471-476`) e `GOALS` semanal 500/750 com as faixas
(`DashboardAcompanhamento.tsx:33-36`).

D3 exige que metas, faixas e a regra de acúmulo sejam **configuração com vigência**, para que se
possa responder "qual era a meta em agosto". Chave/valor (`app_settings`) não serve: não tem data.

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `uuid` PK | não | |
| `channel` | `support_channel` | não | `'email'` ou `'sms'` — as metas sempre diferiram por canal |
| `daily_target` | `integer` | não | 100 (e-mail) / 150 (SMS) |
| `weekly_target` | `integer` | não | 500 / 750 |
| `weekly_alert_min` | `integer` | não | 450 / 675 — abaixo da meta mas ≥ isto é `alerta` |
| `weekly_low_min` | `integer` | não | 400 / 600 — abaixo disto é `advertencia` |
| `alerts_per_warning` | `smallint` | não | **2** — dois alertas acumulados viram uma advertência |
| `warnings_for_contract_risk` | `smallint` | não | **3** |
| `effective_from` | `date` | não | |
| `effective_to` | `date` | sim | `NULL` = vigente |
| `created_at` | `timestamptz` | não | |
| `created_by` | `uuid` FK → `users` | sim | quem mudou a política |

Constraints:
- `EXCLUDE USING gist (channel WITH =, daterange(effective_from, effective_to, '[)') WITH &&)`
  — **nenhuma sobreposição de vigência por canal**. É o que garante que "a meta em agosto" tenha
  uma resposta só. Exige `btree_gist`.
- `CHECK (weekly_low_min <= weekly_alert_min AND weekly_alert_min <= weekly_target)` — as faixas
  não podem se cruzar.
- `CHECK (effective_to IS NULL OR effective_to > effective_from)`.

Índice: `idx_goal_policies_lookup (channel, effective_from DESC)` — é o `asOf` de
`GET /metrics/compliance`.

**O que recebe no backfill**: duas linhas, uma por canal, com `effective_from` = a data mais antiga
de `interaction_facts` e `effective_to = NULL`, e os valores **exatamente iguais aos de hoje**
(§8-A/D3: "para que o corte não mude a avaliação de ninguém"). A partir daí, mudar a meta é inserir
linha nova e fechar a anterior — e a avaliação de agosto continua calculável com a meta de agosto.

> A tabela `goals` do legado (`month`, `target_value`) tem outra forma e **nenhuma tela lê**. O
> backfill a preserva em `legacy_goals` só como testemunha, sem ser fonte de nada.

### 6.9 Tabelas da Lya

`lya_memories` → `lya_memories`: `id bigint identity` (era `bigserial`), `name text UNIQUE`, `description`, `type lya_memory_type` (enum de 5 — R-LYA-14), `tags jsonb CHECK (jsonb_typeof = 'array')`, `body`, `author_id uuid`, `seed boolean`, carimbos. Índice FTS em português sobre `description || body` (é o recall — R-LYA-12) e `idx_lya_memories_type (type)`.

`lya_chats` → `lya_chats`: `id uuid PK`, `owner_id uuid FK → users ON DELETE CASCADE`, `title text`, carimbos. Índice `(owner_id, updated_at DESC)`.

`lya_chat_messages` → `lya_chat_messages`: `id bigint identity`, `chat_id uuid FK ON DELETE CASCADE`, `position integer` (era `ordem`), `role lya_message_role` (enum `user`\|`assistant`), `content text`, `tools jsonb`, `charts jsonb`, `memories jsonb` (era `memorias`), `review jsonb` (era `revisao`), `created_at`. Constraint `UNIQUE (chat_id, position)`; índice `(chat_id, position)`.

RLS: `owner_id = auth.uid()` nas duas de chat (R-LYA-13); leitura de memórias por `canViewSupportAnalytics`, escrita por `manager` (R-LYA-4, R-LYA-12).

A view `lya_agentes` vira `lya_agents_view`: `id, full_name, role, support_channel, is_active,
is_available, created_at` — **sem e-mail** (R-LYA-11) e **com `security_invoker = true`** (**G7.3**).
A ausência dessa opção é o defeito B1: a view era legível **e gravável sem login**, porque view sem
`security_invoker` roda com o poder do dono e passa por cima das policies.

`lya_files` → `lya_files`: `id uuid PK`, `name text` (era `nome`), `file_name text` (era `arquivo`),
`kind text` (era `tipo`), `status lya_file_status` (enum; hoje `text` com default `'processando'`),
`columns jsonb` (era `colunas`), `row_count integer` (era `total_linhas`), `content text` (era `conteudo`),
`summary text` (era `resumo`), `tags jsonb`, `error text` (era `erro`), `bytes integer`,
`uploaded_by uuid FK → users` (era `text`), `created_at timestamptz`.

`lya_file_rows` → `lya_file_rows`: `file_id uuid FK → lya_files ON DELETE CASCADE`,
`line integer` (era `linha`), `data jsonb`. Chave `PRIMARY KEY (file_id, line)`; índice GIN em `data`
se a busca por conteúdo for necessária.

**As duas existem em produção e em nenhuma migration** (R-LYA-16). O backfill as trata como qualquer
outra tabela; o que falta é a especificação das rotas (`11` §16, "Arquivos").

**[G7.4] A role `lya_sql_ro` é substituída por `lya_analytics_ro`**, com alcance menor e propósito
diferente: não serve mais SQL livre, serve o catálogo de consultas nomeadas
(`POST /integrations/lya/query`, `11` §16). Enxerga:

| Objeto | Por quê |
|---|---|
| `interaction_facts`, `daily_rollups` | é onde as perguntas de volume se respondem, já agregadas |
| `products`, `sales_platforms`, `channels`, `goal_policies` | catálogos, sem PII |
| `lya_agents_view` | pessoas do time, sem e-mail |
| `tickets_analytics_view` | `tickets` **sem** `client_email`; cliente identificado por `client_key` (hash estável) quando o agrupamento por cliente for necessário |
| `refunds_analytics_view` | `refunds` **sem** `customer_email` |
| `held_orders_analytics_view` | `held_orders` **sem** endereço, nome, telefone e e-mail |

**Não** enxerga: `users`, `auth_events`, `agent_notes`, `lya_memories`, `lya_chats`,
`lya_chat_messages`, `external_refunds` (que tem nome, telefone e endereço de cliente), nem qualquer
tabela crua com PII. As três views declaram `security_invoker = true` (**G7.3**).

`lya_query_log` — **tabela nova**: `id bigint identity`, `actor_id uuid FK → users`, `query text`,
`params jsonb`, `duration_ms integer`, `row_count integer`, `error text`,
`occurred_at timestamptz NOT NULL DEFAULT now()`. Índices `(occurred_at DESC)` e
`(query, occurred_at DESC)`. RLS ligada, leitura só para `manager`, retenção de 90 dias por job.
Hoje **não existe registro nenhum** do que a Lya executou.

### 6.10 `agent_heartbeats` — **não migra**

Substituída por Realtime Presence (R-AUTH-7). **Mas o histórico de `last_seen_at` se perde**, e é ele que diz "esse agente não aparece há 3 dias". Ver "Propostas de emenda §4" e a emenda §5 de `10`.

### 6.11 `agent_daily_service_counts` — **não migra como tabela**

Substituída por `daily_rollups` (R-MET-35). Mas serve de **semente e de conferência** do backfill: para cada `(user_id, day)`, comparar `service_count` com `daily_rollups.tickets_created`. Divergência não bloqueia (o legado conta por regra antiga), mas precisa ser explicada.

### 6.12 `user_roles` — **não migra**

`profiles.role` é a fonte de verdade (R-CAP-11). Antes de descartar: conferir se há linha em `user_roles` com role que `profiles` não tem; se houver, vai para `migration_rejects` com `severity = 'warning'`.

### 6.13 `claude_skills_leads` — **não migra, e precisa de decisão**

Existe em produção (`30-banco-estado-real.md` §2), tem RLS ligada, uma policy e uma constraint de formato
de e-mail. **Não pertence ao XMX Suporte**: é captura de e-mail (`email`, `lang`, `source_url`,
`user_agent`, `created_at`) de algo não relacionado ao produto, e não existe em `supabase/migrations/`
nem é lida por nenhuma linha de `src/`.

Como guarda e-mail de pessoas, não é uma tabela que se apague por conta própria. **Decisão do dono do
projeto**: fica onde está (o projeto Supabase legado continua de pé), migra junto, ou é exportada e
removida. A trilha não decide — só registra que ela existe, para não sumir sem ninguém notar.

### 6.14 `refund_manager_completions` — **não migra como tabela**

Absorvida por `refund_events` (§4.3), que guarda `legacy_completion_id`.

---

## 6-A. Conferência contra `01-GARANTIAS.md` — o que este schema cumpre

Só as garantias que dependem do **schema**. As de estrutura e processo estão em `13`.

| # | Garantia | Como este schema cumpre | Ajuste que exigiu |
|---|---|---|---|
| G1.1 | estado derivado é coluna de `tickets`, escrita na mesma transação | `derived_status`, `interaction_count`, `last_interaction_at` + trigger `refresh_ticket_state` (§3.1) | — |
| G1.2 | `UNIQUE (ticket_id, seq)`, `seq` do banco | §3.2, com renumeração na ordem canônica `(recorded_at, id)` | **sim** — a ordem estava errada |
| G1.4 | consulta de conciliação no teste | §7.2, verificação **determinística** R11 | **sim** — a prova era por amostra de 1.000, que os 1.220 tickets de C8 podiam furar |
| G2.1 | `uuid`, `timestamptz`, `date`, sem exceção | §7 converte as 15 colunas de tipo errado | — |
| G2.2 | nenhuma conversão de tipo em `WHERE`/`JOIN`/`GROUP BY` | colunas tipadas + geradas (`client_email_normalized`, `client_key`); os índices de §3.1 são sobre coluna, nunca sobre expressão de cast | — |
| G2.3 | formato nunca é convenção de aplicação | `business_day date` substitui `service_date text` ISO por convenção | — |
| G2.4 | todo instante carrega fuso | nenhuma coluna `timestamp` sem fuso no alvo; conversão explícita `AT TIME ZONE 'UTC'` (§7) | **sim** — C6 |
| G3.3 | meta e limiar são configuração com vigência | `goal_policies` (§6.8), com `EXCLUDE` contra sobreposição | — |
| G4.2 | escrita confere linhas afetadas | contratos de repositório em `13` §5; aqui, `UNIQUE` e `CHECK` tornam a escrita errada impossível em vez de silenciosa | — |
| G5.1 | dinheiro é `{ amount, currency }` | `numeric(12,2)` em USD; `refund_value` sai de `double precision` (§4.1) | — |
| G7.2 | toda tabela nova nasce com RLS | `interaction_facts`, `daily_rollups`, `notifications`, `refund_events`, `migration_rejects`, `goal_policies`, `sales_platforms`, `channels`, `lya_query_log` | — |
| G7.3 | view sem `security_invoker` é proibida | `lya_agents_view` e as três views de análise declaram (§6.9) | **sim** |
| G7.4 | sem SQL arbitrário | `lya_analytics_ro` serve catálogo de consultas nomeadas (§6.9) | **sim** — a emenda 3 da trilha foi retirada |
| G9.1 | domínio fechado é catálogo com FK | `products`, `sales_platforms`, `channels` (§2.4, §4.5) | **sim** — `channel` e `platform` eram `text` livre |
| G9.3 | ausência tem um significado só | `not_applicable` é linha nomeada; `NULL` é "não preenchido" (§3.1, §4.5) | **sim** — M7 |
| G9.4 | percentual é número | `refund_percent smallint` (§4.1) | **sim** — M6 |
| G11.1 | período fechado vem de agregado pronto | `daily_rollups` (§5.3); o dia corrente é somado ao vivo sobre `interaction_facts` | — |
| G11.4 | agregado reconstruível e comparado com o incremental | `recompute_daily_rollup(day, actor_id)` + métrica `rollup_drift_total` (emenda 1) | — |

### Exceção registrada

**G2.2 tem uma exceção necessária no backfill.** As consultas de conversão de §7 **precisam** de cast
em predicado (`service_date::timestamptz`, `request_date::date`), porque é exatamente o que elas
existem para eliminar. A garantia vale para o schema **alvo** e para o código da API, não para as
migrations de travessia, que rodam uma vez e são a ponte entre os dois mundos. Sem essa exceção, a
conversão não é expressável.

---

## 7. Regras de conversão de tipo — de `text` para o tipo certo

> ### [C6 · FECHADO com prova — `91-MEDICOES.md` §M8]
>
> As cinco colunas `timestamp` **sem** fuso (`services.created_at`, `refunds.created_at`,
> `profiles.created_at`, `goals.*`, `products.*`) foram gravadas em **UTC**. Isso está **provado**,
> não suposto, e a conversão é:
>
> ```sql
> coluna AT TIME ZONE 'UTC'        -- correto, sempre
> coluna::timestamptz              -- PROIBIDO: usa o TimeZone da sessão
> ```
>
> **A conversão implícita está proibida** — não por estilo, mas porque dá resultado diferente
> conforme quem executa. Reconhecer a dúvida e deixar o cast implícito era o pior dos dois mundos:
> o cast acontecia, acontecia errado, e ninguém havia decidido.
>
> **Como ficou provado** (vale registrar, porque os dois primeiros testes enganavam): comparar as
> duas pernas no mesmo fuso torna os contadores complementares por construção; e comparar as duas
> hipóteses de verdade (3.289 violações supondo UTC contra 9.170 supondo hora local) é **enviesado**,
> porque interpretar como UTC empurra o carimbo 3 h para trás e qualquer hipótese que empurre para
> trás reduz violações de "criado depois da primeira interação". O teste decisivo usa o gatilho
> `trg_service_pin_date_on_insert`, que grava `service_date` como a data de São Paulo no instante do
> insert: a hipótese correta é a que reproduz esse dia. Na faixa das 00:00 às 03:00 UTC, onde as
> hipóteses discordam sobre qual é o dia — **233 linhas, 233 acertos supondo UTC, zero acertos
> supondo hora local**.

Esta é a parte que **não pode ser inferida do repositório**: a conversão de `uuid`/`timestamptz` para `text` aconteceu fora das migrations. As regras abaixo são as que os próprios RPCs já aplicam, e por isso são seguras; a confirmação contra `information_schema` ainda é necessária (§8).

| Coluna legada | Tipo hoje | Tipo alvo | Regra de conversão | Como falha |
|---|---|---|---|---|
| `services.id` | `text` | `uuid` | `value::uuid` | `INVALID_UUID` → `blocking` |
| `services.user_id`, `services.current_owner_id`, `services.takeover_approved_by` | `text` | `uuid` | `value::uuid` + FK para `users` | `INVALID_UUID` / `FK_NOT_FOUND` → `blocking` |
| `services.service_date` | `text` (ISO com fuso, ex. `2026-09-26T00:00:00-03:00`) | `date` (`business_day`) | `(value::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date` — **exatamente** o que `_interaction_events` faz | `INVALID_DATE` → `blocking` |
| `services.created_at` | **`timestamp` SEM fuso**, nullable | `timestamptz` NOT NULL | **[C6]** `COALESCE(created_at AT TIME ZONE 'UTC', (business_day + time '12:00') AT TIME ZONE 'America/Sao_Paulo')`. UTC está **provado** (M8). Medido: zero linhas nulas, o fallback nunca dispara | nunca falha |
| `services.status` | `text`, default **`'pendente'`** | `ticket_status`, default `'registered'` | **[M1]** medido: **dois** valores — `registered` 101.529, `concluido` 1.271, `'pendente'` **zero**. O default era morto. O alvo tem dois estados e o default passa a coincidir com o que o código grava | `UNKNOWN_ENUM_VALUE` → `blocking` |
| `services.product` | `text` com `CHECK` de ~75 | `uuid` FK | `lower(btrim())` contra `products.name`; não achou → cria em `products` | `warning` |
| `services.platform` | `text` | `text` | **[D5]** `'Nenhum'` (10.666) e vazio (26.764) **preservados distintos**. Nenhum `NULLIF`, nenhuma unificação | nunca falha |
| `services.channel` | `text` | `text` | **[M4]** mesma regra de `platform`. **Não** vira enum: `Clickbank` (3.710) é nome de plataforma no campo de canal e um enum o rejeitaria | nunca falha; as 3.710 entram como `warning` de qualidade |
| `services.contact_reason` | `text` | `contact_reason` (enum) | literal | `UNKNOWN_ENUM_VALUE` → `blocking` |
| `service_follow_ups.id`, `.service_id`, `.user_id` | `text`/`uuid` | `uuid` | `::uuid` | `blocking` |
| `service_follow_ups.recorded_at` | `timestamptz` | `timestamptz` | direto — **é um dos poucos carimbos que já tem fuso** | — |
| `service_follow_ups.status` | `text` **sem `CHECK`** | `interaction_status` | literal | `UNKNOWN_ENUM_VALUE` → `blocking` (R-INT-14 — é aqui que se descobre se há lixo) |
| `service_follow_ups.follow_up_number` | `integer` | `integer` (`seq`) | preserva ou renumera (**19.5**) | `DUPLICATE_KEY` se preservar e houver repetição |
| `refunds.id` | `text` | `uuid` | `::uuid` | `blocking` |
| `refunds.user_id`, `.picked_up_by` | `text` | `uuid` | `::uuid` — hoje já convertido assim no RPC | `blocking` |
| `refunds.service_id` | `text` | `uuid` | `::uuid`, FK `ON DELETE SET NULL` | `warning` (ticket apagado) |
| `refunds.request_date` | **`text`** | `date` | `to_date(value,'YYYY-MM-DD')` com a tolerância de `text_to_date_safe`; formato inesperado → rejeito | `INVALID_DATE` → `blocking` |
| `refunds.completion_date` | **`text`** | `date` | idem, `NULL` continua `NULL` | `blocking` quando não converte e não é nulo |
| `refunds.created_at`, `profiles.created_at`, `goals.*`, `products.*`, `agent_daily_service_counts.updated_at` | **`timestamp` SEM fuso** | `timestamptz` | **[C6]** `value AT TIME ZONE 'UTC'`. Mesma prova (M8) | nunca falha |
| `agent_daily_service_counts.day` | **`text`** | `date` | `to_date(value,'YYYY-MM-DD')` | só usado na conferência de §6.11 |
| `refunds.refund_value` | **`double precision`** | `numeric(12,2)` | `round(value::numeric, 2)` — dinheiro deixa de ser ponto flutuante (19.13 de `10`) | `warning` quando `|round(v::numeric,2) - v| > 0.005` |
| `refunds.refund_type` | `text`, 21 variantes | `refund_percent smallint` | **[M6]** `NULLIF(btrim(refund_type),'')` → remove o `%` → `::smallint`. Os **1.242 vazios** (maior grupo) viram `NULL`, que é o que já significam. `05%` → `5` e `95%` → `95` entram sem caso especial. Texto original em `legacy_refund_type` | `warning` quando não casa `^\d{1,3}%$` |
| `refunds.reason` | `text` livre | `refund_reason` + `reason_legacy` | casa com os 15 rótulos; senão `NULL` no enum e o texto em `reason_legacy` | `warning` |
| `refunds.sales_platform` | `text` livre, 10 valores | `smallint` FK → `sales_platforms` | **[M5]** resolve por `citext` contra a semente dos 10 medidos (§4.5). Grafia original em `legacy_sales_platform` | `FK_NOT_FOUND` → `warning` (valor novo aparecido depois da medição) |
| `refunds.product` | `text` livre | `uuid` FK | como em `services.product` | `warning` |
| `ticket_transfers.*_user_id`, `.assigned_by_manager_id` | `text` | `uuid` | `::uuid` | `blocking` / `warning` |
| `ticket_takeover_requests.requester_id`, `.owner_id`, `.responded_by` | `text` | `uuid` | `::uuid` | `blocking` |
| `ticket_takeover_requests.note` | `text` ambíguo | `requester_note` | ver §3.5 | `AMBIGUOUS_FIELD` → `warning` |
| `held_orders.assigned_to`, `.confirmed_by`, `.imported_by` | `text` | `uuid` | `::uuid` | `warning` (`ON DELETE SET NULL`) |
| `held_orders.order_date` | `date` | `date` | direto | — |
| `held_orders.status` | `text` | — | vira `legacy_status` (R-HLD-20) | — |
| `radar_items.user_id`, `radar_events.user_id` | `text` | `uuid` | `::uuid` | `blocking` |
| `agent_notes.user_id` | `text` | `uuid` | `::uuid` | `blocking` |
| `profiles.id` | `text` | `uuid` | `::uuid` — precisa bater com `auth.users.id` | `blocking` |
| `auth_events.user_id`, `.actor_id` | `text` | `uuid` | `::uuid` | `warning` para `actor_id` |
| `app_settings.value` | `text` | `jsonb` | numérico vira número, resto vira string JSON | — |
| `support_*.updated_by` | `text` | `uuid` | `::uuid` | `warning` |
| `lya_memories.author_id`, `lya_chats.user_id` | `text` | `uuid` | `::uuid` | `warning` / `blocking` |
| `refund_manager_completions.refund_value` | **`double precision`** | `numeric(12,2)` | **[D4]** `round(value::numeric, 2)`, em dólar | `warning` se a diferença passar de 0,01 |
| `refunds.refund_value` | **`double precision`** | `numeric(12,2)` | **[D4]** `round(value::numeric, 2)`. Dinheiro sai do ponto flutuante | `warning` se a diferença passar de 0,01 |
| `services.client_email`, `refunds.customer_email` | `text` | `text` + coluna gerada | **[D6]** o original é gravado **intacto**; `*_normalized citext GENERATED` faz índice e comparação. As 179 colisões por caixa **não** são resolvidas | nunca falha |
| `refund_manager_completions.completed_by` | `uuid` (FK `auth.users`) | `uuid` FK → `users` | direto | `FK_NOT_FOUND` → `warning` |

### 7.1 Ordem do backfill

A ordem importa porque há FK. Cada passo é uma transação, e cada um tem uma consulta de prova.

1. `users` ← `profiles` · prova: `count(users) = count(profiles)` menos rejeitos.
2. `products` ← `products` ∪ nomes de `services_product_check` ∪ `REFUND_PRODUCTS`.
2-A. `sales_platforms` ← a semente dos 10 valores medidos (§4.5).
2-B. `goal_policies` ← duas linhas (e-mail e SMS) com os valores atuais e vigência aberta (§6.8).
3. `app_settings` ← `app_settings` + as chaves novas de meta.
4. `auth_events`, `goals`, `training_videos`, `support_*`, `lya_memories`.
5. `tickets` ← `services` · prova: `count` igual; e `count(DISTINCT business_day)` igual ao do legado.
6. `interactions` ← `service_follow_ups` · prova: `count` igual.
7. **Recomputar** `tickets.derived_status` **pela regra de C8, com fallback em `status`**,
   `interaction_count`, `last_interaction_at` · **prova bloqueante**: `count(*)` de
   `derived_status = 'concluido'` ≥ 1.220 + (tickets com última interação concluída). Se algum dos
   **1.220** tickets concluídos sem interação sair como `'novo'`, o fallback não foi aplicado e o
   corte para.
8. `refunds` ← `refunds`; depois `refund_reason_classifications`.
9. `refund_events` ← `refund_manager_completions` + as baixas sintéticas (§4.3).
10. `ticket_transfers`, `ticket_takeover_requests`, `ticket_date_corrections`.
11. `notifications` ← os `seen_at` das duas anteriores (§5.1).
12. `held_orders` → `held_order_events`; `radar_items` → `radar_events`; `agent_notes`; `training_video_views`; `lya_chats` → `lya_chat_messages`.
13. `interaction_facts` ← `_interaction_events(min, hoje, NULL)` · **prova bloqueante**: por `(business_day, actor_id)`, a contagem bate com a do legado. Diferença ≠ 0 impede o corte.
14. `daily_rollups` ← `GROUP BY` sobre `interaction_facts` + contagens de `refunds` e `held_orders` · prova: `SUM(total_count) = count(interaction_facts)` no mesmo período.

### 7.2 Provas de paridade obrigatórias antes do corte

| Prova | Consulta | Critério |
|---|---|---|
| Contagem de interações | `dashboard_metrics(f,t,NULL).total_count` (legado) × `GET /metrics/dashboard` (novo) | diferença 0 em **todos** os meses desde o início |
| Por agente e por dia | `_interaction_events` agrupada × `daily_rollups` | diferença 0 |
| **[C8] Status de ticket — determinístico, sem amostra** | `sql/32-reconciliacao.sql` **R11**: a distribuição de `derived_status` no alvo tem de reproduzir **linha por linha** a linha de base medida (71.798 / 19.699 / 10.085 / 1.220) | diferença 0 nos quatro grupos |
| **[C8]** Concluídos sem interação | `SELECT count(*) FROM tickets t WHERE t.legacy_status='concluido' AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.ticket_id=t.id) AND t.derived_status <> 'concluido'` | **0**. Qualquer resultado > 0 bloqueia o corte |
| **[C8]** Ordem canônica | status derivado com `ORDER BY (recorded_at, id)` × com `(recorded_at, follow_up_number, id)` | a diferença conhecida é **37 tickets**; o alvo tem de casar com a primeira |
| **[M1]** Estados de ticket | distribuição de `status` | `registered` 101.529, `concluido` 1.271, nenhuma linha em um terceiro valor |
| **[M2]** Unicidade de `seq` | `count(*)` de `(ticket_id, seq)` repetidos | **0** — a `UNIQUE` entra `VALID` |
| **[D4]** Moeda | toda coluna de dinheiro | `numeric(12,2)`; nenhuma `double precision` sobrevive |

> **Por que a prova de status não pode ser por amostragem.** A versão anterior deste documento
> propunha "amostra de 1.000 comparada com `getCurrentStatus`". Dois defeitos: (a) `getCurrentStatus`
> é justamente a função que **tem** o fallback, então comparar com ela esconde a ausência dele no
> alvo; (b) os 1.220 tickets são **1,2%** do total — uma amostra de 1.000 tem chance alta de não
> pegar nenhum, e o defeito sobreviveria à prova. A verificação R11 é determinística e cobre as
> 102.802 linhas.
| Reembolsos em aberto | `count` legado × `count` novo, por agente | diferença 0 |
| Valor devolvido | `SUM(refunded_value)` legado × novo | diferença ≤ R$ 0,01 por arredondamento |
| Pedidos em espera abertos | por agente | diferença 0 |
| Casos de radar abertos | por agente | diferença 0 |
| Anotações | `count` por agente e dia | diferença 0 |

---

## 8. O que falta levantar em produção

**Esta trilha não executou SQL** (a instrução recebida proíbe). A **trilha de dados** executou o
levantamento de catálogo em 26/09/2026 e o resultado está em `30-banco-estado-real.md`; §7 deste
documento já foi reconciliado com ele, e as consultas 1 a 9 abaixo estão **respondidas lá**.

As consultas 10 a 13 **foram executadas** pela coordenação em 26/09/2026 e os resultados estão em
`91-MEDICOES.md`. Elas fecharam §19.5, §19.6 e §19.12, e abriram três questões novas (§19.14,
§19.15, §19.16) que estão especificadas neste documento e aguardam confirmação do dono:

| Medição | Resultado | Onde foi aplicado |
|---|---|---|
| M1 · `services.status` | `registered` 101.529, `concluido` 1.271, `'pendente'` **zero** | §3.1, §7 |
| M2 · `follow_up_number` | 5.543 pares, **12.753 linhas excedentes em 180 dias** | §3.2 |
| M3 · validação da baixa | **39** linhas com baixa antes da solicitação, **0** incompletas | §4.1 |
| M4 · `channel` | vazio 30.994, `Nenhum` 1.128, `Clickbank` 3.710 | §3.1, §7 |
| M5 · `sales_platform` | **10** valores, `Hotmart` 143 e `PagAmerican` 139 fora do seletor | §4.5 |
| M6 · `refund_type` | 21 variantes, **1.242 vazios**, `05%` com zero à esquerda, `95%` com 1 linha | §4.1, §7 |

Todo o SQL fica registrado abaixo para reprodução.

```sql
-- 1. Tipo real de cada coluna (catálogo, barato) — é o que fecha §7
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 2. Constraints reais (o repositório pode estar defasado)
SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY 1, 2;

-- 3. Índices reais
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' ORDER BY 1, 2;

-- 4. Policies reais (o inventário conta ~55)
SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' ORDER BY 1, 2;

-- 5. Funções realmente instaladas (confirma que "última definição vence")
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer, p.provolatile
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' ORDER BY 1;

-- 6. Triggers realmente instalados
SELECT c.relname AS tabela, t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1, 2;

-- 7. Tamanho aproximado (reltuples, NUNCA COUNT(*))
SELECT c.relname, c.reltuples::bigint AS linhas_aprox,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.reltuples DESC;

-- 8. Enums existentes (confirma os dois enums de role — R-CAP-12)
SELECT t.typname, string_agg(e.enumlabel, ' | ' ORDER BY e.enumsortorder)
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' GROUP BY 1 ORDER BY 1;

-- 9. `user_roles` tem algo que `profiles` não tem? (R-CAP-11)
SELECT ur.user_id, ur.role AS role_em_user_roles, p.role AS role_em_profiles
FROM public.user_roles ur LEFT JOIN public.profiles p ON p.id = ur.user_id
WHERE p.id IS NULL OR p.role IS DISTINCT FROM ur.role
LIMIT 200;

-- 10. Valores distintos das colunas que viram enum (agregação — uma por vez)
SET LOCAL statement_timeout = '15s';
SELECT status, count(*) FROM public.service_follow_ups GROUP BY 1 ORDER BY 2 DESC;
-- depois, separadamente:
--   SELECT channel, count(*) FROM public.services GROUP BY 1 ORDER BY 2 DESC;
--   SELECT sales_platform, count(*) FROM public.refunds GROUP BY 1 ORDER BY 2 DESC;
--   SELECT refund_type, count(*) FROM public.refunds GROUP BY 1 ORDER BY 2 DESC;

-- 11. Quantos violariam as constraints novas (agregação — uma por vez, com recorte)
SET LOCAL statement_timeout = '15s';
SELECT count(*) FILTER (WHERE completion_date::date < request_date::date) AS baixa_antes,
       count(*) FILTER (WHERE completion_date IS NOT NULL
                          AND (refund_value IS NULL OR refund_type IS NULL OR reason IS NULL)) AS baixa_incompleta
FROM public.refunds
WHERE request_date >= '2026-01-01';

-- 13. Distribuição de services.status (decisão 19.12 — quantas linhas têm 'pendente')
SET LOCAL statement_timeout = '15s';
SELECT status, count(*) FROM public.services GROUP BY 1 ORDER BY 2 DESC;

-- 12. Quantos `follow_up_number` estão repetidos no mesmo ticket (R-INT-6, decisão 19.5)
SET LOCAL statement_timeout = '15s';
SELECT count(*) AS pares_repetidos FROM (
  SELECT service_id, follow_up_number FROM public.service_follow_ups
  WHERE recorded_at >= now() - interval '180 days'
  GROUP BY 1,2 HAVING count(*) > 1
) t;
```

Se o acesso for barrado, este SQL vai para `docs/arquitetura-v2/sql/` (§0 do contrato) — **nunca** para `/tmp`, que a limpeza noturna do macOS esvazia.

---

## Lacunas

1. **RESOLVIDA.** Os tipos reais vieram de `30-banco-estado-real.md`, e o defeito C6 (fuso dos cinco `timestamp` sem fuso) foi corrigido em §7: a conversão é `AT TIME ZONE 'UTC'`, que é a convenção de gravação confirmada pela trilha de dados.
2. **Volume — parcialmente resolvida.** `30-banco-estado-real.md` §1 traz as estimativas: `services` 101.888 linhas (50 MB), `service_follow_ups` 56.943 (21 MB), `ticket_transfers` 5.754, `refunds` 5.577, `external_refunds` 4.026, `held_orders` 3.900. `interaction_facts` nasce, portanto, com ~159 mil linhas. O que falta é a distribuição por mês, para dimensionar o recálculo por dia.
3. **Critério de rejeição.** Quantos rejeitos `blocking` a migração tolera antes de parar? O contrato não define. Com as medições, os números conhecidos são: 39 `warning` de baixa antecipada (M3), 3.710 `warning` de canal com nome de plataforma (M4), e **zero** `blocking` previsto nas conversões medidas. A proposta continua sendo: qualquer `blocking` em `tickets`, `interactions`, `refunds` ou `users` **impede** o corte.
4. **RESOLVIDA por D2.** A API escreve sob a identidade de quem chamou; as policies deste documento são **rede de segurança real**, não decoração, e toda tabela nova nasce com RLS ligada (princípio 3).
5. **Mesmo projeto Supabase?** Se sim, `auth.users` é a mesma tabela e `users.id` continua sendo o id do Auth. Se não, há um mapeamento de identidade a fazer, e `legacy_id` deixa de ser suficiente.
6. **Retenção.** Nada define por quanto tempo `interaction_facts`, `auth_events`, `refund_events`, `held_order_events` e `radar_events` são guardados. `interaction_facts` cresce ~20k linhas/mês.
7. **Estratégia de corte.** Big-bang (uma janela, tudo de uma vez) ou dupla escrita (os dois schemas vivos por um período)? O contrato não diz. A trilha de dados é dona da travessia (`32-banco-migracao.md`); esta lacuna pertence a ela.
9. **Confirmações pendentes do dono**, todas com o desenho já especificado: `channel` seguir a regra de D5 e o que fazer com as 3.710 linhas de `Clickbank` (§19.14 de `10`); `Hotmart` e `PagAmerican` entrarem no seletor (§19.15); `refund_percent` ficar restrito a múltiplos de 5 (§19.16). → `90-BACKLOG.md`
8. **Objetos em produção sem migration.** `lya_files`, `lya_file_rows`, `external_refunds` e a função `normalize_order_number` existem no banco e não no repositório. Estão especificados aqui (§4.4, §6.9), mas **falta saber como foram criados** e se há mais objetos nessa situação — o que muda o processo, não só o schema. `30-banco-estado-real.md` §11 é o ponto de partida.

---

## Propostas de emenda

### 1. `daily_rollups`: incremental **e** recálculo, não um ou outro

O contrato (§6) diz "agregação de métrica: API, sobre rollups", mas não diz como o rollup se mantém.

**Incremental por trigger** é barato no caminho quente (uma interação = um `UPDATE ... SET total_count = total_count + 1`), mas erra silenciosamente: basta uma exceção, um `DELETE` de interação, uma correção de data (R-TKT-22, que move o ticket de dia) ou uma escrita fora da API para o número divergir — e ninguém percebe, porque não há com o que comparar.

**Recálculo completo** é correto por construção, mas varrer `interaction_facts` inteira num `t4g.micro` é exatamente o perfil de consulta do incidente de 24/07/2026.

Proposta: **os dois**, com papéis distintos.
- Trigger incremental mantém `daily_rollups` em dia no caminho quente. Correção de data e `DELETE` marcam os dias afetados como sujos.
- `recompute_daily_rollup(day, user_id)` existe, é a definição canônica, e roda: (a) para todo dia sujo; (b) para **ontem**, uma vez por noite, num horário de baixa carga; (c) sob demanda.
- Um teste compara incremental × recálculo e exige diferença zero. **É esse teste que transforma "confiamos no trigger" em "sabemos que o trigger está certo"** — que é justamente o que falta hoje em `agent_daily_service_counts` (R-MET-35: existe, ninguém lê, ninguém sabe se está certa).

Custo do recálculo noturno: ~20k linhas/mês em `interaction_facts` significa um dia ≈ 700 linhas. Recalcular um dia é trivial; recalcular tudo é o que não pode virar rotina.

### 2. `interaction_facts` deve ser **tabela**, não view materializada

Três motivos, em ordem de peso:

1. **Atualização incremental.** `REFRESH MATERIALIZED VIEW` reconstrói tudo; mesmo com `CONCURRENTLY`, varre a base inteira. Numa tabela, uma interação nova é um `INSERT`. Com a tabela chegando a centenas de milhares de linhas num `t4g.micro`, a diferença não é de estilo.
2. **Latência.** O agente registra a interação e o card diário tem que mudar **na hora** (é o que `emitAgentInteraction` faz hoje). Uma view materializada só muda no refresh: ou o refresh é constante (e o banco não aguenta), ou o número fica velho.
3. **Colunas que a view não teria.** `is_same_day_repeat` é marcado por trigger no `INSERT` comparando com a interação anterior (R-INT-4). Numa view isso vira uma window function sobre a tabela inteira a cada refresh.

Contra-argumento honesto: a view materializada não pode divergir da fonte, e a tabela pode. A resposta é a mesma do item 1 — a função de recomputação e o teste de diferença zero.

### 3. RETIRADA · a Lya deixa de ter SQL livre `G7.4`

Esta emenda recomendava **manter** o SQL livre com alcance reduzido. `01-GARANTIAS.md` **G7.4**
decidiu o contrário, e a trilha cumpre: a rota de análise aceita **consulta nomeada** com parâmetros
vinculados (`11` §16), sob `lya_analytics_ro` e views sem PII, com log obrigatório.

As duas condições que esta emenda propunha como mitigação — log de toda consulta e
`statement_timeout` de 5 s — passam a ser **parte do desenho**, não remendo. E o alcance ficou menor
do que a própria emenda pedia: a trilha propunha remover só `services`/`service_follow_ups` cruas; o
desenho novo remove também `held_orders` cru, que tem endereço completo de cliente. Era PII que
ninguém havia notado, porque a preocupação com `lya_agentes` foi com o time e não com o cliente.

O argumento original continua verdadeiro e vira outra coisa: retirar o SQL livre custa a **pergunta
imprevista**, que é o que diferencia a Lya de um menu de dashboards. Por isso o `lya_query_log`
importa mais do que parecia — as perguntas que caem em `404 QUERY_NOT_FOUND` são exatamente a fila
de consultas a escrever. **O log deveria existir antes de o catálogo estar completo**, senão a
evolução do catálogo vira adivinhação. → B2 do backlog.

### 4. A perda do histórico de `agent_heartbeats`

Presence não grava (§4 do contrato), e `agent_heartbeats.last_seen_at` é o único registro de "esse agente sumiu há 3 dias". Proposta: uma coluna `users.last_seen_at` atualizada no máximo uma vez a cada 15 minutos pela própria API (não é polling do front: é efeito colateral de requisição que já aconteceria). Custo: um `UPDATE` por usuário a cada 15 min. Ganho: a tela de Usuários não perde a informação.

### 5. `legacy_*` não é temporário

A proposta deste documento é que as colunas `legacy_id`, `legacy_service_date`, `legacy_request_date`, `legacy_completion_date`, `legacy_follow_up_number` e `legacy_status` **permaneçam** depois do corte, não sejam removidas numa "limpeza" posterior. Motivo: a primeira vez que um número do dashboard novo for questionado, a pergunta será "de onde veio essa linha no sistema antigo?" — e `legacy_id` é a única resposta possível. O custo é alguns bytes por linha.
