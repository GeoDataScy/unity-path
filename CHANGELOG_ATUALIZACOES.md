# Sistema XMX Suporte - Registro de Atualizacoes

**Projeto:** Unity Path - Sistema de Suporte XMX  
**Stack:** React + TypeScript (Vite) | Supabase (PostgreSQL) | Vercel  
**Repositorio:** GeoDataScy/unity-path  
**Data das atualizacoes:** 16/04/2026  

---

## Banco de Dados

**Plataforma:** Supabase  
**Projeto ID:** `kjkyyqxqrqsdozjyyuon`  
**URL:** `https://kjkyyqxqrqsdozjyyuon.supabase.co`  
**Credenciais:** Acessar via Supabase Dashboard (https://supabase.com/dashboard) - as credenciais de acesso ao banco nao devem ser versionadas no repositorio por questoes de seguranca.

### Tabelas Principais

| Tabela | Descricao |
|--------|-----------|
| `profiles` | Perfis dos usuarios (agentes e managers), com `full_name`, `role` |
| `services` | Registros de atendimentos dos agentes |
| `service_follow_ups` | Interacoes de acompanhamento (status) dos atendimentos |
| `refunds` | Registros de reembolsos |
| `products` | Produtos cadastrados |
| `goals` | Metas mensais |
| `agent_daily_service_counts` | Contagem diaria de servicos por agente (cache) |
| `user_roles` | Papeis dos usuarios (agent/manager) |

### Colunas Relevantes - `services`

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | text (UUID) | Identificador unico |
| `user_id` | text (UUID) | ID do agente |
| `client_email` | text | Email do cliente |
| `service_date` | text (timestamptz) | Data do atendimento (escolhida pelo agente) |
| `product` | text | Produto atendido |
| `platform` | text | Plataforma de vendas |
| `channel` | text | Canal (Email, SMS, Clickbank) |
| `has_tracking_code` | boolean | Se o atendimento tem codigo de rastreio |
| `status` | text | Status do servico |
| `created_at` | timestamptz | Data de criacao no banco |

### Colunas Relevantes - `service_follow_ups`

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | text (UUID) | Identificador unico |
| `service_id` | text | FK para services |
| `user_id` | text | ID do agente |
| `follow_up_number` | integer | Numero sequencial da interacao |
| `status` | text | Status (em_andamento, concluido) |
| `recorded_at` | timestamptz | Data/hora da interacao (escolhida pelo agente) |
| `observation` | text | Observacao do agente |
| `created_at` | timestamptz | Data de criacao no banco |

### Colunas Relevantes - `refunds`

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | text (UUID) | Identificador unico |
| `user_id` | text | ID do agente |
| `customer_email` | text | Email do cliente |
| `request_date` | text | Data da solicitacao |
| `completion_date` | text | Data de conclusao |
| `sales_platform` | text | Plataforma de vendas |
| `order_id` | text | ID do pedido |
| `refund_type` | text | Tipo de reembolso |
| `reason` | text | Motivo |
| `items_returned` | boolean | Se houve devolucao |
| `product` | text | Produto |
| `channel` | text | Canal |

---

## RPCs (Remote Procedure Calls) do Supabase

### 1. `agent_daily_metrics(target_date date)`

**Finalidade:** Retorna metricas diarias do agente para a barra de progresso "Total de atendimentos hoje".

**Regra de contagem:**
- Services com `service_date` = target_date (data que o agente escolheu ao registrar)
- Follow-ups com `recorded_at` = target_date em tickets de dias anteriores (`service_date < target_date`)
- Evita duplicacao: follow-ups em tickets do mesmo dia nao contam extra

**Retorno:** `{ my_count, leader_count, leader_name, leader_id, is_leader }`

**Arquivo de migracao:** `20260414140000_agent_daily_metrics_services_plus_followups.sql`

---

### 2. `dashboard_refund_metrics(from_date, to_date, agent_id, status_filter, refund_type_filter, product_filter)`

**Finalidade:** Metricas de reembolso para o dashboard do manager.

**Correcoes aplicadas:**
- Cast `r.request_date::date` para comparacao com parametros `date` (coluna `request_date` e tipo `text`)
- Variavel `v_agent text := agent_id::text` para comparacao com `user_id` (tipo `text`)
- Adicionado parametro `product_filter` que estava faltando nos types.ts

**Retorno:** `{ total_count, open_count, done_count, by_agent, by_status, by_refund_type, by_product, by_channel }`

**Arquivo de migracao:** `20260325130000_add_channel_to_refunds.sql`

---

### 3. `dashboard_refund_audit(from_date, to_date, agent_id, status_filter, refund_type_filter, product_filter, page_size, page_offset)`

**Finalidade:** Listagem paginada de reembolsos para auditoria do manager.

**Correcoes aplicadas:** Mesmas do `dashboard_refund_metrics` (cast `::date` e `v_agent text`).

**Retorno:** `{ total_count, rows[] }`

---

### 4. `dashboard_follow_up_detail(p_from_date, p_to_date)`

**Finalidade:** Dashboard de interacoes dos agentes para o manager (pagina /dashboard/interacoes).

**Correcoes aplicadas:**
- Cast `s.service_date::timestamptz` em todas as comparacoes (coluna `service_date` e tipo `text`)
- Funcao adicionada aos `types.ts`

**Retorno:** `{ kpi, by_agent[], recent_follow_ups[], insights }`

**Arquivo de migracao:** `20260327100000_create_follow_up_detail_rpc.sql`

---

### 5. `dashboard_metrics(from_date, to_date, agent_id)`

**Finalidade:** Metricas do dashboard de atendimentos do manager (funciona corretamente, serviu de referencia para correcoes).

---

### 6. `dashboard_audit(from_date, to_date, agent_id, page_size, page_offset)`

**Finalidade:** Listagem paginada de atendimentos para auditoria do manager (funciona corretamente).

---

## Atualizacoes Realizadas

### 1. Fix: RPCs de Reembolso (dashboard_refund_metrics / dashboard_refund_audit)

**Problema:** Erro `operator does not exist: text >= date` e 404 no console.

**Causa raiz:** A migration `20260325130000_add_channel_to_refunds.sql` recriou as funcoes SEM o cast `::date` na coluna `request_date`, desfazendo o fix anterior da migration `20260316120000`.

**Correcoes:**
- Adicionado `r.request_date::date` em todas as comparacoes
- Adicionado `v_agent text := agent_id::text` para comparacao com `user_id`
- Adicionado `product_filter` nos `types.ts` (estava faltando)

**Arquivos alterados:**
- `supabase/migrations/20260325130000_add_channel_to_refunds.sql`
- `src/integrations/supabase/types.ts`

---

### 2. Fix: Dashboard de Interacoes (dashboard_follow_up_detail)

**Problema:** Pagina de interacoes do manager nao carregava dados.

**Causa raiz:** A RPC `dashboard_follow_up_detail` comparava `service_date` (text) com `timestamptz` sem cast, e a funcao nao existia nos `types.ts`.

**Correcoes:**
- Adicionado `s.service_date::timestamptz` em todas as comparacoes
- Adicionada definicao da funcao nos `types.ts`
- Adicionada tabela `service_follow_ups` nos `types.ts`

**Arquivos alterados:**
- `supabase/migrations/20260327100000_create_follow_up_detail_rpc.sql`
- `src/integrations/supabase/types.ts`

---

### 3. Feat: Produto Gluco Off

**Descricao:** Adicionado "Gluco Off" na lista de produtos disponiveis.

**Arquivos alterados:**
- `src/pages/agent/Atendimentos.tsx`
- `src/features/services/EditServiceDialog.tsx`
- `src/features/refunds/types.ts`

---

### 4. Feat: Regra de Bloqueio de Interacao (18h)

**Regra anterior:** Bloqueio de 24 horas apos ultima interacao.

**Regra nova:** Bloqueio ate 18:00 (horario de Sao Paulo) do dia da ultima interacao.

**Logica de bloqueio:**
- Usa `service_date` (data do atendimento, nao `created_at`) como referencia para o primeiro bloqueio
- Usa `recorded_at` do ultimo follow-up para bloqueios subsequentes
- Se o agente registra um ticket com data de ontem, ele pode interagir imediatamente hoje
- Se o agente registra uma interacao com data de ontem, o bloqueio ja expirou

**Mensagem ao agente:** "A proxima interacao com este atendimento so pode ser registrada no dia seguinte."

**Arquivos alterados:**
- `src/features/services/useStatusTracking.ts` - funcao `canAddInteraction`
- `src/features/services/StatusTrackingDialog.tsx` - mensagens de bloqueio

---

### 5. Feat: Codigo de Rastreio (has_tracking_code)

**Descricao:** Toggle "Cod. Rastreio" ao lado do campo Canal no formulario de novo atendimento.

**Regras:**
- Quando ativado (`has_tracking_code = true`), o atendimento pode ser reaberto no **mesmo dia** (bypass do bloqueio de 18h)
- Dados existentes ficam com `has_tracking_code = false` (default)
- A contabilizacao ocorre normalmente (registro + interacao)

**Componentes:**
- Toggle (Switch) ao lado dos botoes de Canal
- Icone indicador (Package) na coluna Canal da tabela
- Botao filtro "Cod. Rastreio" ao lado de "Total de interacoes" para filtrar na tabela

**Arquivos alterados:**
- `supabase/migrations/20260416120000_add_has_tracking_code_to_services.sql` - Nova coluna
- `src/integrations/supabase/types.ts` - Tipo atualizado
- `src/features/services/useMyServicesQuery.ts` - ServiceItem + select
- `src/features/services/useStatusTracking.ts` - Bypass no `canAddInteraction`
- `src/features/services/StatusTrackingDialog.tsx` - Prop `hasTrackingCode`
- `src/pages/agent/Atendimentos.tsx` - Toggle UI, filtro, icone, insert

---

### 6. Fix: Contagem de Atendimentos Diarios (agent_daily_metrics)

**Problema:** A barra "Total de atendimentos hoje" nao refletia corretamente o trabalho do agente.

**Regra final de contagem:**
```
Total hoje = Services com service_date = hoje
           + Follow-ups com recorded_at = hoje em tickets de dias anteriores
```

**Detalhamento:**
- **Services:** Contam pela data que o agente escolheu (`service_date`), NAO pela data de criacao no banco (`created_at`)
- **Follow-ups:** Contam pela data que o agente registrou (`recorded_at`), mas APENAS em tickets cujo `service_date < hoje` (evita duplicacao)
- **Lider:** Calculado com a mesma logica (services + follow-ups de tickets antigos)

**Exemplo pratico:**
- Agente registra 12 tickets com `service_date = hoje` → barra mostra 12
- Agente registra 3 tickets com `service_date = ontem` → NAO conta hoje, conta ontem
- Agente clica status em 1 ticket antigo e coloca `recorded_at = hoje` → barra sobe para 13
- Follow-up em ticket de hoje → NAO duplica (ticket ja conta como 1)

**Arquivo de migracao:** `20260414140000_agent_daily_metrics_services_plus_followups.sql`

---

## Fluxo de Dados - Visao Geral

```
AGENTE                                    MANAGER
  |                                          |
  |-- Registra atendimento (services)        |
  |-- Clica status (service_follow_ups)      |
  |-- Ve barra de progresso                  |-- Dashboard Atendimentos
  |   (agent_daily_metrics RPC)              |   (dashboard_metrics RPC)
  |                                          |   (dashboard_audit RPC)
  |-- Registra reembolso (refunds)           |
  |                                          |-- Dashboard Reembolsos
  |                                          |   (dashboard_refund_metrics RPC)
  |                                          |   (dashboard_refund_audit RPC)
  |                                          |
  |                                          |-- Dashboard Interacoes
  |                                          |   (dashboard_follow_up_detail RPC)
```

---

## Padrao de Correcao Recorrente

**Problema recorrente:** Colunas do tipo `text` comparadas com parametros `date` ou `uuid`.

**Solucao padrao:**
- `text` vs `date` → usar `coluna::date` ou `coluna::timestamptz`
- `uuid` vs `text` → usar `v_agent text := agent_id::text` e comparar `text = text`
- Sempre verificar o tipo real da coluna antes de criar ou alterar RPCs

**Referencia:** O `dashboard_metrics` (atendimentos) que funciona corretamente usa:
```sql
v_agent text := agent_id::text;
s.service_date::timestamptz >= from_date::timestamptz
```

---

## Historico de Commits

| Commit | Descricao |
|--------|-----------|
| `5eb9edf` | fix: corrigir RPCs de reembolso - cast text::date e adicionar product_filter nos types |
| `0a1c605` | fix: adicionar dashboard_follow_up_detail nos types e corrigir cast timestamptz |
| `9149c1e` | feat: adicionar produto Gluco Off na lista de produtos |
| `cfc1ef3` | feat: bloqueio de interacao ate 18h do dia da ultima interacao |
| `822a085` | feat: adicionar campo Codigo de Rastreio com toggle, bypass de bloqueio e filtro |
| `c8666e4` | fix: bloqueio de interacao baseado em service_date ao inves de created_at |
| `5017514` | fix: agent_daily_metrics conta por service_date e recorded_at |
