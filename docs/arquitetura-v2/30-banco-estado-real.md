# 30 — O banco como ele é (produção `kjkyyqxqrqsdozjyyuon`)

> Trilha de **dados**. Este documento descreve a **realidade atual** do banco de produção,
> extraída do catálogo do Postgres em 26/09/2026 — não das migrations. Onde ele contradiz
> `supabase/migrations/`, a realidade é o que está aqui e a migration é o que está errado.
>
> Nada foi escrito no banco para produzir este documento. Todas as consultas são de leitura
> sobre `pg_catalog` / `information_schema`, exceto uma leitura de `agent_daily_service_counts`
> (1.949 linhas) usada para datar o último refresh da tabela derivada.

Data do levantamento: **26/09/2026**. Postgres **17.6** on aarch64, compute `t4g.micro`.

> **Reconciliado em 26/09/2026 com `00-CONTRATO.md` §8-A.** As sete decisões do dono do
> projeto estão aplicadas. As emendas deste documento que foram decididas aparecem marcadas
> **DECIDIDA**; as que continuam abertas apontam para `90-BACKLOG.md`. Um achado deste
> documento (a view `lya_agentes`) foi **corrigido em produção** e a correção está verificada
> na seção 9.

---

## 0. Como reproduzir este levantamento

Acesso por Management API, sempre somente leitura:

```bash
TOK=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/kjkyyqxqrqsdozjyyuon/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  --data-binary @payload.json
```

O endpoint devolve apenas o resultado da **última** instrução do lote, roda como `postgres`
(portanto `auth.uid()` é nulo e RLS não se aplica) e aceita uma instrução por requisição na
prática. Para consultas longas, gere o corpo com:

```bash
python3 -c "import json,sys;print(json.dumps({'query':open(sys.argv[1]).read()}))" arquivo.sql > payload.json
```

Todo o SQL usado está reproduzido nas seções a seguir e também em
`docs/arquitetura-v2/sql/30-levantamento.sql`.

---

## 1. Inventário de tabelas

`reltuples` é estimativa do planner (`-1` = nunca analisada; tabela nova ou minúscula).
Tamanho inclui índices e TOAST.

```sql
SELECT c.relname, c.relkind, c.relrowsecurity AS rls, c.reltuples::bigint AS est_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f')
ORDER BY pg_total_relation_size(c.oid) DESC;
```

| Tabela | kind | RLS | linhas (est.) | tamanho | policies |
|---|---|---|---|---|---|
| `services` | r | sim | 101.888 | 50 MB | 12 |
| `service_follow_ups` | r | sim | 56.943 | 21 MB | 5 |
| `ticket_transfers` | r | sim | 5.754 | 2752 kB | 5 |
| `held_orders` | r | sim | 3.900 | 2736 kB | 2 |
| `refunds` | r | sim | 5.577 | 2680 kB | 6 |
| `external_refunds` | r | sim | 4.026 | 2576 kB | 2 |
| `held_order_events` | r | sim | 3.626 | 1472 kB | 2 |
| `auth_events` | r | sim | 4.577 | 1456 kB | 2 |
| `refund_reason_classifications` | r | sim | 5.574 | 1440 kB | 2 |
| `ticket_takeover_requests` | r | sim | 2.370 | 1184 kB | 2 |
| `agent_daily_service_counts` | r | sim | 1.946 | 1040 kB | 3 |
| `lya_chat_messages` | r | sim | 106 | 376 kB | 1 |
| `radar_events` | r | sim | 506 | 256 kB | 1 |
| `radar_items` | r | sim | 215 | 192 kB | 1 |
| `lya_memories` | r | sim | 45 | 168 kB | 1 |
| `support_products` | r | sim | 112 | 112 kB | 3 |
| `agent_heartbeats` | r | sim | 34 | 96 kB | 1 |
| `agent_notes` | r | sim | — | 96 kB | 1 |
| `profiles` | r | sim | 44 | 96 kB | 4 |
| `support_sms_replies` | r | sim | 55 | 88 kB | 3 |
| `training_video_views` | r | sim | 15 | 88 kB | 4 |
| `lya_chats` | r | sim | 27 | 80 kB | 1 |
| `products` | r | sim | — | 80 kB | 3 |
| `refund_manager_completions` | r | sim | — | 64 kB | 2 |
| `support_sms_brands` | r | sim | 30 | 64 kB | 3 |
| `user_roles` | r | sim | 44 | 64 kB | 0 |
| `claude_skills_leads` | r | sim | — | 48 kB | 1 |
| `training_videos` | r | sim | — | 48 kB | 2 |
| `goals` | r | sim | — | 32 kB | 3 |
| `lya_file_rows` | r | sim | — | 32 kB | 2 |
| `lya_files` | r | sim | — | 32 kB | 2 |
| `service_date_corrections` | r | sim | — | 32 kB | 3 |
| `lya_agentes` | v | não | — | 0 bytes | 0 |

Total do schema `public`: **89.7 MB**. Duas tabelas concentram 71% disso:
`services` (50 MB) e `service_follow_ups` (21 MB).

Dois objetos merecem nota imediata:

- **`user_roles`** tem RLS ligada e **zero policies**. Para `anon` e `authenticated` ela é
  ilegível e inescrevível: tabela morta na prática, sobrevivente do modelo original de roles.
  As 44 linhas continuam lá.
- **`lya_agentes`** é uma VIEW de `profiles`, dona `postgres`, **sem `security_invoker`**.
  Views sem essa opção rodam com os privilégios do dono, então ela contorna a RLS de
  `profiles`. Até 26/09/2026 `anon` tinha `SELECT` nela; o `GRANT` foi **revogado** e a
  correção está verificada na seção 9 (backlog B1, `RESOLVIDO`).

### Schema `auth`

Apenas o que a aplicação toca, e é pouco: três FKs de `public` apontam para `auth.users`
(`training_video_views.user_id`, `refund_manager_completions.completed_by`,
`service_date_corrections.corrected_by`). O resto do schema `auth` é do Supabase e não é
modelado por nós. **`profiles.id` não tem FK para `auth.users`** — ver seção 11.3.

---

## 2. Colunas, por tabela

```sql
SELECT table_name, ordinal_position, column_name, data_type, is_nullable,
       column_default, identity_generation, generation_expression
FROM information_schema.columns WHERE table_schema='public'
ORDER BY table_name, ordinal_position;
```

Legenda: `NOT NULL` explícito; `def=` default; `GEN` coluna gerada; `IDENTITY` identidade.


### `agent_daily_service_counts`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `user_id` | `text` | **não** | — |
| 2 | `day` | `text` | **não** | — |
| 3 | `service_count` | `integer` | **não** | `0` |
| 4 | `updated_at` | `timestamp without time zone` | **não** | `CURRENT_TIMESTAMP` |

### `agent_heartbeats`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `user_id` | `text` | **não** | — |
| 2 | `last_seen_at` | `timestamp with time zone` | **não** | `now()` |
| 3 | `user_agent` | `text` | sim | — |
| 4 | `updated_at` | `timestamp with time zone` | **não** | `now()` |

### `agent_notes`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `user_id` | `text` | **não** | `(auth.uid())::text` |
| 3 | `note_date` | `date` | **não** | `((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date` |
| 4 | `body` | `text` | **não** | — |
| 5 | `kind` | `text` | **não** | `'nota'::text` |
| 6 | `done` | `boolean` | **não** | `false` |
| 7 | `pinned` | `boolean` | **não** | `false` |
| 8 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 9 | `updated_at` | `timestamp with time zone` | **não** | `now()` |
| 10 | `done_at` | `timestamp with time zone` | sim | — |

### `auth_events`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `bigint` | **não** | `nextval('auth_events_id_seq'::regclass)` |
| 2 | `user_id` | `text` | **não** | — |
| 3 | `event_type` | `text` | **não** | — |
| 4 | `occurred_at` | `timestamp with time zone` | **não** | `now()` |
| 5 | `actor_id` | `text` | sim | — |
| 6 | `metadata` | `jsonb` | sim | — |

### `claude_skills_leads`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `email` | `text` | **não** | — |
| 3 | `lang` | `text` | **não** | `'en'::text` |
| 4 | `source_url` | `text` | sim | — |
| 5 | `user_agent` | `text` | sim | — |
| 6 | `created_at` | `timestamp with time zone` | **não** | `now()` |

### `external_refunds`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `bigint` | **não** | **IDENTITY ALWAYS** |
| 2 | `product` | `text` | **não** | — |
| 3 | `month_ref` | `date` | **não** | — |
| 4 | `source_file` | `text` | **não** | — |
| 5 | `order_date` | `date` | **não** | — |
| 6 | `order_name` | `text` | **não** | — |
| 7 | `order_number` | `text` | sim | **GEN** `normalize_order_number(order_name)` |
| 8 | `address` | `text` | sim | — |
| 9 | `address2` | `text` | sim | — |
| 10 | `zip` | `text` | sim | — |
| 11 | `city` | `text` | sim | — |
| 12 | `province` | `text` | sim | — |
| 13 | `product_count` | `smallint` | **não** | `1` |
| 14 | `product_id` | `bigint` | sim | — |
| 15 | `variant_id` | `bigint` | **não** | `0` |
| 16 | `full_name` | `text` | sim | — |
| 17 | `mobile_no` | `text` | sim | — |
| 18 | `shipping_method` | `text` | sim | — |
| 19 | `status` | `text` | sim | — |
| 20 | `refund_amount` | `numeric` | **não** | `0` |
| 21 | `payment_status` | `text` | **não** | — |
| 22 | `tracking_code` | `text` | sim | — |
| 23 | `product_name` | `text` | **não** | — |
| 24 | `variant_name` | `text` | sim | — |
| 25 | `raw_date` | `text` | sim | — |
| 26 | `imported_by` | `text` | sim | — |
| 27 | `imported_at` | `timestamp with time zone` | **não** | `now()` |
| 28 | `platform` | `text` | **não** | `'Cartpanda'::text` |

### `goals`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | `(gen_random_uuid())::text` |
| 2 | `month` | `text` | **não** | — |
| 3 | `target_value` | `double precision` | **não** | — |
| 4 | `created_at` | `timestamp without time zone` | **não** | `CURRENT_TIMESTAMP` |
| 5 | `updated_at` | `timestamp without time zone` | **não** | — |

### `held_order_events`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `order_id` | `uuid` | **não** | — |
| 3 | `user_id` | `text` | **não** | — |
| 4 | `status` | `text` | **não** | — |
| 5 | `note` | `text` | sim | `''::text` |
| 6 | `recorded_at` | `timestamp with time zone` | **não** | `now()` |
| 7 | `pending_tag` | `text` | sim | — |

### `held_orders`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `dyna_code` | `text` | **não** | — |
| 3 | `order_number` | `text` | sim | — |
| 4 | `merged_orders` | `text` | sim | — |
| 5 | `reason` | `text` | sim | — |
| 6 | `order_date` | `date` | sim | — |
| 7 | `email` | `text` | sim | — |
| 8 | `customer_name` | `text` | sim | — |
| 9 | `city` | `text` | sim | — |
| 10 | `street1` | `text` | sim | — |
| 11 | `street2` | `text` | sim | — |
| 12 | `street3` | `text` | sim | — |
| 13 | `state` | `text` | sim | — |
| 14 | `country` | `text` | sim | — |
| 15 | `postal_code` | `text` | sim | — |
| 16 | `age` | `text` | sim | — |
| 17 | `items` | `text` | sim | — |
| 18 | `source_file` | `text` | sim | — |
| 19 | `assigned_to` | `text` | sim | — |
| 20 | `status` | `text` | **não** | `'pending'::text` |
| 21 | `confirmed_at` | `timestamp with time zone` | sim | — |
| 22 | `confirmed_by` | `text` | sim | — |
| 23 | `imported_at` | `timestamp with time zone` | **não** | `now()` |
| 24 | `imported_by` | `text` | sim | — |
| 25 | `rma` | `text` | sim | — |
| 26 | `restocked_items` | `text` | sim | — |
| 27 | `damaged_items` | `text` | sim | — |
| 28 | `comments` | `text` | sim | — |
| 29 | `import_key` | `text` | sim | — |
| 30 | `agent_status` | `text` | **não** | `'novo'::text` |
| 31 | `assign_count` | `integer` | **não** | `0` |
| 32 | `pending_tag` | `text` | sim | — |
| 33 | `duplicate_of` | `uuid` | sim | — |

### `lya_agentes`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | sim | — |
| 2 | `full_name` | `text` | sim | — |
| 3 | `role` | `text` | sim | — |
| 4 | `support_channel` | `text` | sim | — |
| 5 | `is_active` | `boolean` | sim | — |
| 6 | `is_available` | `boolean` | sim | — |
| 7 | `created_at` | `timestamp without time zone` | sim | — |

### `lya_chat_messages`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `bigint` | **não** | `nextval('lya_chat_messages_id_seq'::regclass)` |
| 2 | `chat_id` | `uuid` | **não** | — |
| 3 | `ordem` | `integer` | **não** | — |
| 4 | `role` | `text` | **não** | — |
| 5 | `content` | `text` | **não** | `''::text` |
| 6 | `tools` | `jsonb` | **não** | `'[]'::jsonb` |
| 7 | `charts` | `jsonb` | **não** | `'[]'::jsonb` |
| 8 | `memorias` | `jsonb` | **não** | `'[]'::jsonb` |
| 9 | `revisao` | `jsonb` | sim | — |
| 10 | `created_at` | `timestamp with time zone` | **não** | `now()` |

### `lya_chats`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | — |
| 2 | `user_id` | `text` | **não** | — |
| 3 | `titulo` | `text` | **não** | `'Nova conversa'::text` |
| 4 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 5 | `updated_at` | `timestamp with time zone` | **não** | `now()` |

### `lya_file_rows`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `file_id` | `uuid` | **não** | — |
| 2 | `linha` | `integer` | **não** | — |
| 3 | `data` | `jsonb` | **não** | `'{}'::jsonb` |

### `lya_files`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `nome` | `text` | **não** | — |
| 3 | `arquivo` | `text` | **não** | — |
| 4 | `tipo` | `text` | **não** | — |
| 5 | `status` | `text` | **não** | `'processando'::text` |
| 6 | `colunas` | `jsonb` | **não** | `'[]'::jsonb` |
| 7 | `total_linhas` | `integer` | **não** | `0` |
| 8 | `conteudo` | `text` | **não** | `''::text` |
| 9 | `resumo` | `text` | **não** | `''::text` |
| 10 | `tags` | `jsonb` | **não** | `'[]'::jsonb` |
| 11 | `erro` | `text` | sim | — |
| 12 | `bytes` | `integer` | **não** | `0` |
| 13 | `uploaded_by` | `text` | sim | — |
| 14 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 15 | `updated_at` | `timestamp with time zone` | **não** | `now()` |

### `lya_memories`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `bigint` | **não** | `nextval('lya_memories_id_seq'::regclass)` |
| 2 | `name` | `text` | **não** | — |
| 3 | `description` | `text` | **não** | `''::text` |
| 4 | `type` | `text` | **não** | `'nota'::text` |
| 5 | `tags` | `jsonb` | **não** | `'[]'::jsonb` |
| 6 | `body` | `text` | **não** | `''::text` |
| 7 | `author_id` | `text` | sim | — |
| 8 | `seed` | `boolean` | **não** | `false` |
| 9 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 10 | `updated_at` | `timestamp with time zone` | **não** | `now()` |
| 11 | `origem` | `text` | **não** | `'treino'::text` |
| 12 | `file_id` | `uuid` | sim | — |

### `products`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | — |
| 2 | `name` | `text` | **não** | — |
| 3 | `is_active` | `boolean` | **não** | `true` |
| 4 | `created_at` | `timestamp without time zone` | **não** | `CURRENT_TIMESTAMP` |
| 5 | `updated_at` | `timestamp without time zone` | **não** | — |

### `profiles`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | `(gen_random_uuid())::text` |
| 2 | `email` | `text` | **não** | — |
| 3 | `full_name` | `text` | sim | — |
| 4 | `role` | `USER-DEFINED` | **não** | `'agent'::"AppRole"` |
| 5 | `created_at` | `timestamp without time zone` | sim | `CURRENT_TIMESTAMP` |
| 6 | `support_channel` | `text` | **não** | `'email'::text` |
| 7 | `is_active` | `boolean` | **não** | `true` |
| 8 | `deactivated_at` | `timestamp with time zone` | sim | — |
| 9 | `deactivated_by` | `text` | sim | — |
| 10 | `can_view_all_tickets` | `boolean` | **não** | `false` |
| 11 | `can_register_duplicate_emails` | `boolean` | **não** | `false` |
| 12 | `can_claim_tickets` | `boolean` | **não** | `false` |
| 13 | `is_available` | `boolean` | **não** | `true` |
| 14 | `can_approve_takeovers` | `boolean` | **não** | `false` |

### `radar_events`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `item_id` | `uuid` | **não** | — |
| 3 | `user_id` | `text` | **não** | — |
| 4 | `status` | `text` | **não** | — |
| 5 | `action` | `text` | **não** | `''::text` |
| 6 | `next_follow_up_date` | `date` | sim | — |
| 7 | `recorded_at` | `timestamp with time zone` | **não** | `now()` |

### `radar_items`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `user_id` | `text` | **não** | — |
| 3 | `client_email` | `text` | **não** | — |
| 4 | `order_number` | `text` | sim | — |
| 5 | `product` | `text` | sim | — |
| 6 | `kind` | `text` | **não** | — |
| 7 | `action_needed` | `text` | **não** | — |
| 8 | `status` | `text` | **não** | `'aberto'::text` |
| 9 | `next_follow_up_date` | `date` | sim | — |
| 10 | `notes` | `text` | **não** | `''::text` |
| 11 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 12 | `updated_at` | `timestamp with time zone` | **não** | `now()` |
| 13 | `closed_at` | `timestamp with time zone` | sim | — |

### `refund_manager_completions`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `refund_id` | `text` | **não** | — |
| 3 | `refund_owner_id` | `text` | **não** | — |
| 4 | `completed_by` | `uuid` | **não** | — |
| 5 | `completion_date` | `text` | **não** | — |
| 6 | `refund_value` | `double precision` | sim | — |
| 7 | `refund_type` | `text` | sim | — |
| 8 | `reason` | `text` | sim | — |
| 9 | `items_returned` | `boolean` | **não** | `false` |
| 10 | `days_overdue` | `integer` | sim | — |
| 11 | `created_at` | `timestamp with time zone` | **não** | `now()` |

### `refund_reason_classifications`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `refund_id` | `text` | **não** | — |
| 2 | `original_reason` | `text` | sim | — |
| 3 | `category` | `text` | **não** | — |
| 4 | `classification_method` | `text` | **não** | `'auto'::text` |
| 5 | `classified_at` | `timestamp with time zone` | **não** | `now()` |
| 6 | `updated_at` | `timestamp with time zone` | **não** | `now()` |

### `refunds`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | `(gen_random_uuid())::text` |
| 2 | `user_id` | `text` | **não** | — |
| 3 | `order_id` | `text` | **não** | — |
| 4 | `customer_email` | `text` | **não** | — |
| 5 | `sales_platform` | `text` | **não** | — |
| 6 | `request_date` | `text` | **não** | — |
| 7 | `completion_date` | `text` | sim | — |
| 8 | `reason` | `text` | sim | — |
| 9 | `refund_type` | `text` | sim | — |
| 10 | `refund_value` | `double precision` | sim | — |
| 11 | `items_returned` | `boolean` | **não** | `false` |
| 12 | `created_at` | `timestamp without time zone` | **não** | `CURRENT_TIMESTAMP` |
| 13 | `product` | `text` | sim | — |
| 14 | `channel` | `text` | sim | — |
| 15 | `service_id` | `text` | sim | — |
| 16 | `created_from_service` | `boolean` | **não** | `false` |
| 17 | `picked_up_at` | `timestamp with time zone` | sim | — |
| 18 | `picked_up_by` | `text` | sim | — |

### `service_date_corrections`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `service_id` | `text` | **não** | — |
| 3 | `corrected_by` | `uuid` | **não** | — |
| 4 | `previous_date` | `text` | **não** | — |
| 5 | `new_date` | `text` | **não** | — |
| 6 | `reason` | `text` | **não** | — |
| 7 | `corrected_at` | `timestamp with time zone` | **não** | `now()` |

### `service_follow_ups`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | `(gen_random_uuid())::text` |
| 2 | `service_id` | `text` | **não** | — |
| 3 | `user_id` | `text` | **não** | — |
| 4 | `follow_up_number` | `integer` | **não** | `1` |
| 5 | `status` | `text` | **não** | `'em_andamento'::text` |
| 6 | `recorded_at` | `timestamp with time zone` | **não** | `now()` |
| 7 | `observation` | `text` | sim | `''::text` |
| 8 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 9 | `is_same_day_repeat` | `boolean` | **não** | `false` |

### `services`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | `(gen_random_uuid())::text` |
| 2 | `user_id` | `text` | **não** | — |
| 3 | `client_email` | `text` | **não** | — |
| 4 | `product` | `text` | **não** | — |
| 5 | `service_date` | `text` | **não** | — |
| 6 | `status` | `text` | **não** | `'pendente'::text` |
| 7 | `created_at` | `timestamp without time zone` | sim | `CURRENT_TIMESTAMP` |
| 8 | `platform` | `text` | sim | — |
| 9 | `channel` | `text` | sim | — |
| 10 | `has_tracking_code` | `boolean` | **não** | `false` |
| 11 | `contact_reason` | `text` | sim | — |
| 12 | `current_owner_id` | `text` | **não** | — |
| 13 | `takeover_approved_at` | `timestamp with time zone` | sim | — |
| 14 | `takeover_approved_by` | `text` | sim | — |
| 15 | `order_id` | `text` | sim | — |
| 16 | `contact_reason_note` | `text` | sim | — |

### `support_products`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `nome` | `text` | **não** | — |
| 3 | `funcao` | `text` | sim | — |
| 4 | `url` | `text` | sim | — |
| 5 | `estrutura` | `text` | **não** | — |
| 6 | `plataforma` | `text` | sim | — |
| 7 | `bonus_url` | `text` | sim | — |
| 8 | `bonus_tipo` | `text` | sim | — |
| 9 | `nicho` | `text` | sim | — |
| 10 | `sms_number` | `text` | sim | — |
| 11 | `links` | `jsonb` | **não** | `'[]'::jsonb` |
| 12 | `ativo` | `boolean` | **não** | `true` |
| 13 | `sort_order` | `integer` | **não** | `0` |
| 14 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 15 | `updated_at` | `timestamp with time zone` | **não** | `now()` |
| 16 | `updated_by` | `text` | sim | — |

### `support_sms_brands`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `nome` | `text` | **não** | — |
| 3 | `sistema` | `text` | **não** | — |
| 4 | `estrutura` | `text` | **não** | — |
| 5 | `sms_number` | `text` | sim | — |
| 6 | `ativo` | `boolean` | **não** | `true` |
| 7 | `sort_order` | `integer` | **não** | `0` |
| 8 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 9 | `updated_at` | `timestamp with time zone` | **não** | `now()` |
| 10 | `updated_by` | `text` | sim | — |

### `support_sms_replies`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `categoria` | `text` | **não** | — |
| 3 | `titulo` | `text` | **não** | — |
| 4 | `texto_en` | `text` | **não** | — |
| 5 | `texto_pt` | `text` | **não** | — |
| 6 | `ativo` | `boolean` | **não** | `true` |
| 7 | `sort_order` | `integer` | **não** | `0` |
| 8 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 9 | `updated_at` | `timestamp with time zone` | **não** | `now()` |
| 10 | `updated_by` | `text` | sim | — |

### `ticket_takeover_requests`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `service_id` | `text` | **não** | — |
| 3 | `requester_id` | `text` | **não** | — |
| 4 | `owner_id` | `text` | sim | — |
| 5 | `status` | `text` | **não** | `'pending'::text` |
| 6 | `note` | `text` | sim | — |
| 7 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 8 | `responded_at` | `timestamp with time zone` | sim | — |
| 9 | `responded_by` | `text` | sim | — |

### `ticket_transfers`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `service_id` | `text` | **não** | — |
| 3 | `from_user_id` | `text` | **não** | — |
| 4 | `to_user_id` | `text` | **não** | — |
| 5 | `status` | `text` | **não** | `'pending'::text` |
| 6 | `message` | `text` | sim | — |
| 7 | `response_note` | `text` | sim | — |
| 8 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 9 | `responded_at` | `timestamp with time zone` | sim | — |
| 10 | `recipient_seen_at` | `timestamp with time zone` | sim | — |
| 11 | `requester_seen_at` | `timestamp with time zone` | sim | — |
| 12 | `assigned_by_manager_id` | `text` | sim | — |

### `training_video_views`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `user_id` | `uuid` | **não** | — |
| 3 | `video_id` | `uuid` | **não** | — |
| 4 | `watched_seconds` | `integer` | **não** | `0` |
| 5 | `completed` | `boolean` | **não** | `false` |
| 6 | `last_watched_at` | `timestamp with time zone` | **não** | `now()` |
| 7 | `created_at` | `timestamp with time zone` | **não** | `now()` |

### `training_videos`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `uuid` | **não** | `gen_random_uuid()` |
| 2 | `section` | `text` | **não** | — |
| 3 | `title` | `text` | **não** | — |
| 4 | `description` | `text` | sim | — |
| 5 | `video_url` | `text` | sim | — |
| 6 | `thumbnail_url` | `text` | sim | — |
| 7 | `duration_seconds` | `integer` | sim | — |
| 8 | `display_order` | `integer` | **não** | `0` |
| 9 | `is_published` | `boolean` | **não** | `true` |
| 10 | `created_at` | `timestamp with time zone` | **não** | `now()` |
| 11 | `updated_at` | `timestamp with time zone` | **não** | `now()` |

### `user_roles`

| # | coluna | tipo | nulo | default / geração |
|---|---|---|---|---|
| 1 | `id` | `text` | **não** | `(gen_random_uuid())::text` |
| 2 | `user_id` | `text` | **não** | — |
| 3 | `role` | `USER-DEFINED` | **não** | — |
| 4 | `created_at` | `timestamp without time zone` | **não** | `CURRENT_TIMESTAMP` |

---

## 3. Chaves e constraints

```sql
SELECT rel.relname, con.conname, con.contype, pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
ORDER BY rel.relname, con.contype, con.conname;
```

`contype`: `p` primary key · `f` foreign key · `u` unique · `c` check.


**`agent_daily_service_counts`**

- `f` `agent_daily_service_counts_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT
  ```
- `p` `agent_daily_service_counts_pkey`
  ```
  PRIMARY KEY (user_id, day)
  ```

**`agent_heartbeats`**

- `p` `agent_heartbeats_pkey`
  ```
  PRIMARY KEY (user_id)
  ```

**`agent_notes`**

- `c` `agent_notes_body_chk`
  ```
  CHECK (((btrim(body) <> ''::text) AND (length(body) <= 4000)))
  ```
- `c` `agent_notes_done_at_chk`
  ```
  CHECK ((done = (done_at IS NOT NULL)))
  ```
- `c` `agent_notes_done_kind_chk`
  ```
  CHECK (((kind = 'tarefa'::text) OR (done = false)))
  ```
- `c` `agent_notes_kind_chk`
  ```
  CHECK ((kind = ANY (ARRAY['nota'::text, 'tarefa'::text])))
  ```
- `f` `agent_notes_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id)
  ```
- `p` `agent_notes_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`auth_events`**

- `c` `auth_events_type_check`
  ```
  CHECK ((event_type = ANY (ARRAY['login'::text, 'logout'::text, 'force_logout'::text, 'deactivated'::text, 'reactivated'::text, 'deleted'::text, 'restored'::text])))
  ```
- `p` `auth_events_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`claude_skills_leads`**

- `c` `claude_skills_leads_email_format`
  ```
  CHECK (((email ~* '^\S+@\S+\.\S+$'::text) AND (char_length(email) <= 320)))
  ```
- `p` `claude_skills_leads_pkey`
  ```
  PRIMARY KEY (id)
  ```
- `u` `claude_skills_leads_email_key`
  ```
  UNIQUE (email)
  ```

**`external_refunds`**

- `c` `external_refunds_payment_status_check`
  ```
  CHECK ((payment_status = ANY (ARRAY['Refunded'::text, 'Partially refunded'::text, 'Refunded (unspecified)'::text])))
  ```
- `c` `external_refunds_platform_check`
  ```
  CHECK ((platform = ANY (ARRAY['Cartpanda'::text, 'Buygoods'::text, 'PagAmerican'::text])))
  ```
- `p` `external_refunds_pkey`
  ```
  PRIMARY KEY (id)
  ```
- `u` `external_refunds_natural_key`
  ```
  UNIQUE (platform, product, order_name, variant_id)
  ```

**`goals`**

- `p` `goals_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`held_order_events`**

- `c` `held_order_events_pending_tag_chk`
  ```
  CHECK (((pending_tag IS NULL) OR (pending_tag = ANY (ARRAY['pedido_nao_encontrado'::text, 'aguardando_cliente'::text, 'aguardando_transportadora'::text, 'outra'::text]))))
  ```
- `c` `held_order_events_status_chk`
  ```
  CHECK ((status = ANY (ARRAY['novo'::text, 'em_andamento'::text, 'concluido'::text])))
  ```
- `f` `held_order_events_order_id_fkey`
  ```
  FOREIGN KEY (order_id) REFERENCES held_orders(id) ON DELETE CASCADE
  ```
- `f` `held_order_events_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `p` `held_order_events_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`held_orders`**

- `c` `held_orders_agent_status_chk`
  ```
  CHECK ((agent_status = ANY (ARRAY['novo'::text, 'em_andamento'::text, 'concluido'::text])))
  ```
- `c` `held_orders_pending_tag_chk`
  ```
  CHECK (((pending_tag IS NULL) OR (pending_tag = ANY (ARRAY['pedido_nao_encontrado'::text, 'aguardando_cliente'::text, 'aguardando_transportadora'::text, 'outra'::text]))))
  ```
- `c` `held_orders_status_chk`
  ```
  CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text])))
  ```
- `f` `held_orders_assigned_to_fkey`
  ```
  FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `held_orders_confirmed_by_fkey`
  ```
  FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `held_orders_duplicate_of_fkey`
  ```
  FOREIGN KEY (duplicate_of) REFERENCES held_orders(id) ON DELETE SET NULL
  ```
- `f` `held_orders_imported_by_fkey`
  ```
  FOREIGN KEY (imported_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `p` `held_orders_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`lya_chat_messages`**

- `c` `lya_chat_messages_role_check`
  ```
  CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
  ```
- `f` `lya_chat_messages_chat_id_fkey`
  ```
  FOREIGN KEY (chat_id) REFERENCES lya_chats(id) ON DELETE CASCADE
  ```
- `p` `lya_chat_messages_pkey`
  ```
  PRIMARY KEY (id)
  ```
- `u` `uq_lya_chat_messages_ordem`
  ```
  UNIQUE (chat_id, ordem)
  ```

**`lya_chats`**

- `f` `lya_chats_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  ```
- `p` `lya_chats_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`lya_file_rows`**

- `f` `lya_file_rows_file_id_fkey`
  ```
  FOREIGN KEY (file_id) REFERENCES lya_files(id) ON DELETE CASCADE
  ```
- `p` `lya_file_rows_pkey`
  ```
  PRIMARY KEY (file_id, linha)
  ```

**`lya_files`**

- `c` `lya_files_colunas_chk`
  ```
  CHECK ((jsonb_typeof(colunas) = 'array'::text))
  ```
- `c` `lya_files_status_check`
  ```
  CHECK ((status = ANY (ARRAY['processando'::text, 'pronto'::text, 'erro'::text])))
  ```
- `c` `lya_files_tags_chk`
  ```
  CHECK ((jsonb_typeof(tags) = 'array'::text))
  ```
- `c` `lya_files_tipo_check`
  ```
  CHECK ((tipo = ANY (ARRAY['csv'::text, 'markdown'::text])))
  ```
- `f` `lya_files_uploaded_by_fkey`
  ```
  FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `p` `lya_files_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`lya_memories`**

- `c` `lya_memories_origem_chk`
  ```
  CHECK ((origem = ANY (ARRAY['treino'::text, 'arquivo'::text, 'sistema'::text])))
  ```
- `c` `lya_memories_tags_chk`
  ```
  CHECK ((jsonb_typeof(tags) = 'array'::text))
  ```
- `c` `lya_memories_type_check`
  ```
  CHECK ((type = ANY (ARRAY['user'::text, 'feedback'::text, 'project'::text, 'reference'::text, 'nota'::text])))
  ```
- `f` `lya_memories_author_id_fkey`
  ```
  FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `lya_memories_file_id_fkey`
  ```
  FOREIGN KEY (file_id) REFERENCES lya_files(id) ON DELETE CASCADE
  ```
- `p` `lya_memories_pkey`
  ```
  PRIMARY KEY (id)
  ```
- `u` `lya_memories_name_key`
  ```
  UNIQUE (name)
  ```

**`products`**

- `p` `products_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`profiles`**

- `c` `profiles_support_channel_check`
  ```
  CHECK ((support_channel = ANY (ARRAY['email'::text, 'sms'::text])))
  ```
- `p` `profiles_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`radar_events`**

- `c` `radar_events_status_chk`
  ```
  CHECK ((status = ANY (ARRAY['aberto'::text, 'em_andamento'::text, 'aguardando_cliente'::text, 'aguardando_logistica'::text, 'resolvido'::text, 'cancelado'::text])))
  ```
- `f` `radar_events_item_id_fkey`
  ```
  FOREIGN KEY (item_id) REFERENCES radar_items(id) ON DELETE CASCADE
  ```
- `f` `radar_events_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id)
  ```
- `p` `radar_events_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`radar_items`**

- `c` `radar_items_action_chk`
  ```
  CHECK ((btrim(action_needed) <> ''::text))
  ```
- `c` `radar_items_closed_at_chk`
  ```
  CHECK (((status = ANY (ARRAY['resolvido'::text, 'cancelado'::text])) = (closed_at IS NOT NULL)))
  ```
- `c` `radar_items_email_chk`
  ```
  CHECK ((btrim(client_email) <> ''::text))
  ```
- `c` `radar_items_kind_chk`
  ```
  CHECK ((kind = ANY (ARRAY['devolucao'::text, 'rma'::text, 'reenvio'::text, 'reenvio_endereco'::text, 'correcao_endereco'::text, 'novo_rastreio'::text, 'on_hold'::text, 'logistica'::text, 'outros'::text])))
  ```
- `c` `radar_items_next_date_chk`
  ```
  CHECK (((status = ANY (ARRAY['resolvido'::text, 'cancelado'::text])) = (next_follow_up_date IS NULL)))
  ```
- `c` `radar_items_status_chk`
  ```
  CHECK ((status = ANY (ARRAY['aberto'::text, 'em_andamento'::text, 'aguardando_cliente'::text, 'aguardando_logistica'::text, 'resolvido'::text, 'cancelado'::text])))
  ```
- `f` `radar_items_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id)
  ```
- `p` `radar_items_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`refund_manager_completions`**

- `f` `refund_manager_completions_completed_by_fkey`
  ```
  FOREIGN KEY (completed_by) REFERENCES auth.users(id)
  ```
- `f` `refund_manager_completions_refund_id_fkey`
  ```
  FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE CASCADE
  ```
- `p` `refund_manager_completions_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`refund_reason_classifications`**

- `c` `refund_reason_classifications_classification_method_check`
  ```
  CHECK ((classification_method = ANY (ARRAY['auto'::text, 'manual'::text])))
  ```
- `f` `refund_reason_classifications_refund_id_fkey`
  ```
  FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE CASCADE
  ```
- `p` `refund_reason_classifications_pkey`
  ```
  PRIMARY KEY (refund_id)
  ```

**`refunds`**

- `c` `refunds_refund_value_non_negative`
  ```
  CHECK (((refund_value IS NULL) OR (refund_value >= (0)::double precision)))
  ```
- `f` `refunds_picked_up_by_fkey`
  ```
  FOREIGN KEY (picked_up_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `refunds_service_id_fkey`
  ```
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
  ```
- `f` `refunds_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT
  ```
- `p` `refunds_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`service_date_corrections`**

- `f` `service_date_corrections_corrected_by_fkey`
  ```
  FOREIGN KEY (corrected_by) REFERENCES auth.users(id)
  ```
- `f` `service_date_corrections_service_id_fkey`
  ```
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  ```
- `p` `service_date_corrections_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`service_follow_ups`**

- `f` `service_follow_ups_service_id_fkey`
  ```
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  ```
- `p` `service_follow_ups_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`services`**

- `c` `services_contact_reason_check`
  ```
  CHECK (((contact_reason IS NULL) OR (contact_reason = ANY (ARRAY['duvida_de_uso'::text, 'reembolso'::text, 'cancelamento_de_compra'::text, 'cancelamento_de_assinatura'::text, 'reclamacao_vsl'::text, 'troca_de_endereco'::text, 'embalagem_danificada'::text, 'duvida_de_envio'::text, 'ingredientes'::text, 'duvidas_geral'::text, 'outro'::text]))))
  ```
- `c` `services_contact_reason_note_check`
  ```
  CHECK ( CASE     WHEN (contact_reason = 'outro'::text) THEN ((contact_reason_note IS NOT NULL) AND (btrim(contact_reason_note) <> ''::text) AND (char_length(btrim(contact_reason_note)) <= 200))     WHEN (contact_reason = 'reclamacao_vsl'::text) THEN ((contact_reason_note IS NULL) OR ((btrim(contact_reason_note) <> ''::text) AND (char_length(btrim(contact_reason_note)) <= 200)))     ELSE (contact_reason_note IS NULL) END)
  ```
- `c` `services_product_check`
  ```
  CHECK ((product = ANY (ARRAY['Arialief'::text, 'Alphacur'::text, 'Blinzador'::text, 'Feilaira'::text, 'Garaherb'::text, 'Karylief'::text, 'Kymezol'::text, 'Jertaris'::text, 'Laellium'::text, 'Memyts'::text, 'Presgera'::text, 'Biografa'::text, 'Cetacondor'::text, 'Cetadusse'::text, 'Sciatilief'::text, 'Goldenfrib'::text, 'Felaromi'::text, 'Tenurima'::text, 'Ariovira'::text, 'CucuDrops'::text, 'Zalovira'::text, 'Xelovita'::text, 'Cerami'::text, 'NATHUREX'::text, 'Mahgryn'::text, 'Levhyn'::text, 'Ariomyx'::text, 'Alitoryn'::text, 'Athentys'::text, 'Velynivo'::text, 'Mioralab'::text, 'Vergolief'::text, 'Olisteren'::text, 'Halegryn'::text, 'Danmyts'::text, 'Maizkidor'::text, 'Basmontex'::text, 'Fraganief'::text, 'Ceramiri'::text, 'Shapeon'::text, 'Nexburn'::text, 'Memoryon'::text, 'Korvizol'::text, 'Erectozyn'::text, 'Thewellnesswize'::text, 'VIP.Shipping'::text, 'VisualEase'::text, 'NerveEase'::text, 'Steelpower'::text, 'Gluco Off'::text, 'Cognivex'::text, 'Nad Dermal+'::text, 'Alpharock'::text, 'Hair Bloom'::text, 'Guardon'::text, 'Joint Mend'::text, 'Keskara'::text, 'Lipolegs'::text, 'LipoShape'::text, 'Mind Recall'::text, 'Mind Wake'::text, 'Prostate Vital'::text, 'Quiet Nerves'::text, 'Quiet Rest'::text, 'RingSilence'::text, 'FlowStrong'::text, 'Youth Within'::text, 'Thermo Ignite'::text, 'Glyco Barrier'::text, 'Gluco Mild'::text, 'Horsefil'::text, 'Honeyfil'::text, 'Clear Gaze'::text, 'PagAmerican'::text, 'Jellyrock'::text, 'Blue Horse'::text, 'Nail Defender'::text, 'Mind Honey Trick'::text, 'Nerve Relief Protocol'::text, 'Lean Leg'::text, 'Soda Burn'::text, 'Nerve Stride'::text, 'Honey Vital'::text, 'Cardio Honey'::text, 'Gut Active'::text, 'Military Honey'::text])))
  ```
- `f` `services_current_owner_id_fkey`
  ```
  FOREIGN KEY (current_owner_id) REFERENCES profiles(id) ON DELETE CASCADE
  ```
- `f` `services_takeover_approved_by_fkey`
  ```
  FOREIGN KEY (takeover_approved_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `services_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT
  ```
- `p` `services_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`support_products`**

- `c` `support_products_bonus_tipo_chk`
  ```
  CHECK (((bonus_tipo IS NULL) OR (bonus_tipo = ANY (ARRAY['simples'::text, 'super'::text]))))
  ```
- `c` `support_products_estrutura_chk`
  ```
  CHECK ((estrutura = ANY (ARRAY['nova'::text, 'antiga'::text])))
  ```
- `c` `support_products_links_chk`
  ```
  CHECK ((jsonb_typeof(links) = 'array'::text))
  ```
- `f` `support_products_updated_by_fkey`
  ```
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `p` `support_products_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`support_sms_brands`**

- `c` `support_sms_brands_estrutura_chk`
  ```
  CHECK ((estrutura = ANY (ARRAY['nova'::text, 'antiga'::text])))
  ```
- `f` `support_sms_brands_updated_by_fkey`
  ```
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `p` `support_sms_brands_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`support_sms_replies`**

- `f` `support_sms_replies_updated_by_fkey`
  ```
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `p` `support_sms_replies_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`ticket_takeover_requests`**

- `c` `ticket_takeover_distinct_parties`
  ```
  CHECK ((requester_id <> owner_id))
  ```
- `c` `ticket_takeover_requests_status_check`
  ```
  CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
  ```
- `f` `ticket_takeover_requests_owner_id_fkey`
  ```
  FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `ticket_takeover_requests_requester_id_fkey`
  ```
  FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE
  ```
- `f` `ticket_takeover_requests_responded_by_fkey`
  ```
  FOREIGN KEY (responded_by) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `ticket_takeover_requests_service_id_fkey`
  ```
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  ```
- `p` `ticket_takeover_requests_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`ticket_transfers`**

- `c` `ticket_transfers_distinct_parties`
  ```
  CHECK ((from_user_id <> to_user_id))
  ```
- `c` `ticket_transfers_status_check`
  ```
  CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))
  ```
- `f` `ticket_transfers_assigned_by_manager_id_fkey`
  ```
  FOREIGN KEY (assigned_by_manager_id) REFERENCES profiles(id) ON DELETE SET NULL
  ```
- `f` `ticket_transfers_from_user_id_fkey`
  ```
  FOREIGN KEY (from_user_id) REFERENCES profiles(id) ON DELETE CASCADE
  ```
- `f` `ticket_transfers_service_id_fkey`
  ```
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  ```
- `f` `ticket_transfers_to_user_id_fkey`
  ```
  FOREIGN KEY (to_user_id) REFERENCES profiles(id) ON DELETE CASCADE
  ```
- `p` `ticket_transfers_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`training_video_views`**

- `f` `training_video_views_user_id_fkey`
  ```
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
  ```
- `f` `training_video_views_video_id_fkey`
  ```
  FOREIGN KEY (video_id) REFERENCES training_videos(id) ON DELETE CASCADE
  ```
- `p` `training_video_views_pkey`
  ```
  PRIMARY KEY (id)
  ```
- `u` `training_video_views_user_id_video_id_key`
  ```
  UNIQUE (user_id, video_id)
  ```

**`training_videos`**

- `p` `training_videos_pkey`
  ```
  PRIMARY KEY (id)
  ```

**`user_roles`**

- `p` `user_roles_pkey`
  ```
  PRIMARY KEY (id)
  ```

### O que falta de constraint, e custa caro

| Ausência | Consequência medida |
|---|---|
| `service_follow_ups` **sem UNIQUE** em `(service_id, follow_up_number)` | numeração duplicada em massa — ver `31`, seção de dado sujo |
| `service_follow_ups.user_id` **sem FK** para `profiles` | agente órfão possível; é a única coluna `user_id` do núcleo sem FK |
| `services.status` **sem CHECK** | qualquer texto entra; o valor real da coluna é ignorado pela UI, que deriva status do último follow-up |
| `services.platform` / `channel` **sem CHECK e sem NOT NULL** | 26 mil tickets sem plataforma — ver `31` |
| `refunds.refund_type` **sem CHECK** | formato `'NN%'` é convenção só validada por regex dentro de RPC |
| `user_roles` sem FK e sem UNIQUE em `(user_id, role)` | irrelevante hoje: tabela sem policy, inacessível |
| `goals` sem UNIQUE em `month` | duas metas para o mesmo mês são possíveis |

### O `CHECK` de `services.product`

É a constraint mais operacionalmente sensível do banco: **85 produtos** literais. Produto novo
**exige migration** — foi o que quebrou no caso `Jellyrock`. A lista real, em ordem de
declaração, está no `pg_get_constraintdef` de `services_product_check` acima.

Note a assimetria: `refunds.product`, `radar_items.product` e `external_refunds.product` são
`text` livre, sem CHECK. Portanto o mesmo produto pode existir grafado de duas formas em
tabelas diferentes, e só `services` recusa um nome fora da lista.

---

## 4. Índices

```sql
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public' ORDER BY tablename, indexname;
```


**`agent_daily_service_counts`**

- `agent_daily_service_counts_pkey`
  ```sql
  CREATE UNIQUE INDEX agent_daily_service_counts_pkey ON public.agent_daily_service_counts USING btree (user_id, day)
  ```
- `idx_agent_daily_service_counts_user_day`
  ```sql
  CREATE INDEX idx_agent_daily_service_counts_user_day ON public.agent_daily_service_counts USING btree (user_id, day)
  ```

**`agent_heartbeats`**

- `agent_heartbeats_pkey`
  ```sql
  CREATE UNIQUE INDEX agent_heartbeats_pkey ON public.agent_heartbeats USING btree (user_id)
  ```
- `idx_agent_heartbeats_last_seen`
  ```sql
  CREATE INDEX idx_agent_heartbeats_last_seen ON public.agent_heartbeats USING btree (last_seen_at DESC)
  ```

**`agent_notes`**

- `agent_notes_pkey`
  ```sql
  CREATE UNIQUE INDEX agent_notes_pkey ON public.agent_notes USING btree (id)
  ```
- `idx_agent_notes_pagina`
  ```sql
  CREATE INDEX idx_agent_notes_pagina ON public.agent_notes USING btree (user_id, note_date, created_at)
  ```
- `idx_agent_notes_pendentes` — **parcial** · **expressão**
  ```sql
  CREATE INDEX idx_agent_notes_pendentes ON public.agent_notes USING btree (user_id, note_date) WHERE ((kind = 'tarefa'::text) AND (done = false))
  ```

**`auth_events`**

- `auth_events_pkey`
  ```sql
  CREATE UNIQUE INDEX auth_events_pkey ON public.auth_events USING btree (id)
  ```
- `idx_auth_events_event_type`
  ```sql
  CREATE INDEX idx_auth_events_event_type ON public.auth_events USING btree (event_type)
  ```
- `idx_auth_events_user_id_occurred`
  ```sql
  CREATE INDEX idx_auth_events_user_id_occurred ON public.auth_events USING btree (user_id, occurred_at DESC)
  ```

**`claude_skills_leads`**

- `claude_skills_leads_email_key`
  ```sql
  CREATE UNIQUE INDEX claude_skills_leads_email_key ON public.claude_skills_leads USING btree (email)
  ```
- `claude_skills_leads_pkey`
  ```sql
  CREATE UNIQUE INDEX claude_skills_leads_pkey ON public.claude_skills_leads USING btree (id)
  ```

**`external_refunds`**

- `external_refunds_natural_key`
  ```sql
  CREATE UNIQUE INDEX external_refunds_natural_key ON public.external_refunds USING btree (platform, product, order_name, variant_id)
  ```
- `external_refunds_pkey`
  ```sql
  CREATE UNIQUE INDEX external_refunds_pkey ON public.external_refunds USING btree (id)
  ```
- `idx_external_refunds_platform_product`
  ```sql
  CREATE INDEX idx_external_refunds_platform_product ON public.external_refunds USING btree (platform, product, order_date)
  ```
- `idx_external_refunds_product_date`
  ```sql
  CREATE INDEX idx_external_refunds_product_date ON public.external_refunds USING btree (product, order_date)
  ```
- `idx_external_refunds_product_order`
  ```sql
  CREATE INDEX idx_external_refunds_product_order ON public.external_refunds USING btree (product, order_number)
  ```
- `idx_external_refunds_source_file`
  ```sql
  CREATE INDEX idx_external_refunds_source_file ON public.external_refunds USING btree (source_file)
  ```

**`goals`**

- `goals_pkey`
  ```sql
  CREATE UNIQUE INDEX goals_pkey ON public.goals USING btree (id)
  ```

**`held_order_events`**

- `held_order_events_pkey`
  ```sql
  CREATE UNIQUE INDEX held_order_events_pkey ON public.held_order_events USING btree (id)
  ```
- `idx_held_order_events_order`
  ```sql
  CREATE INDEX idx_held_order_events_order ON public.held_order_events USING btree (order_id, recorded_at)
  ```
- `idx_held_order_events_user_concluido` — **parcial**
  ```sql
  CREATE INDEX idx_held_order_events_user_concluido ON public.held_order_events USING btree (user_id, recorded_at) WHERE (status = 'concluido'::text)
  ```

**`held_orders`**

- `held_orders_one_open_per_identity_uniq` — **parcial** · **expressão**
  ```sql
  CREATE UNIQUE INDEX held_orders_one_open_per_identity_uniq ON public.held_orders USING btree (dyna_code, import_key) WHERE ((agent_status <> 'concluido'::text) AND (duplicate_of IS NULL))
  ```
- `held_orders_pkey`
  ```sql
  CREATE UNIQUE INDEX held_orders_pkey ON public.held_orders USING btree (id)
  ```
- `idx_held_orders_agent_status`
  ```sql
  CREATE INDEX idx_held_orders_agent_status ON public.held_orders USING btree (assigned_to, agent_status)
  ```
- `idx_held_orders_assigned_to` — **parcial**
  ```sql
  CREATE INDEX idx_held_orders_assigned_to ON public.held_orders USING btree (assigned_to) WHERE (assigned_to IS NOT NULL)
  ```
- `idx_held_orders_client_key_open` — **parcial** · **expressão**
  ```sql
  CREATE INDEX idx_held_orders_client_key_open ON public.held_orders USING btree (held_order_client_key(email, customer_name, id)) WHERE ((duplicate_of IS NULL) AND (agent_status <> 'concluido'::text))
  ```
- `idx_held_orders_confirmed_by_at` — **parcial**
  ```sql
  CREATE INDEX idx_held_orders_confirmed_by_at ON public.held_orders USING btree (confirmed_by, confirmed_at) WHERE (confirmed_at IS NOT NULL)
  ```
- `idx_held_orders_duplicate_of` — **parcial**
  ```sql
  CREATE INDEX idx_held_orders_duplicate_of ON public.held_orders USING btree (duplicate_of) WHERE (duplicate_of IS NOT NULL)
  ```
- `idx_held_orders_pending_tag` — **parcial**
  ```sql
  CREATE INDEX idx_held_orders_pending_tag ON public.held_orders USING btree (assigned_to, pending_tag) WHERE (pending_tag IS NOT NULL)
  ```
- `idx_held_orders_status`
  ```sql
  CREATE INDEX idx_held_orders_status ON public.held_orders USING btree (status)
  ```

**`lya_chat_messages`**

- `idx_lya_chat_messages_chat`
  ```sql
  CREATE INDEX idx_lya_chat_messages_chat ON public.lya_chat_messages USING btree (chat_id, ordem)
  ```
- `lya_chat_messages_pkey`
  ```sql
  CREATE UNIQUE INDEX lya_chat_messages_pkey ON public.lya_chat_messages USING btree (id)
  ```
- `uq_lya_chat_messages_ordem`
  ```sql
  CREATE UNIQUE INDEX uq_lya_chat_messages_ordem ON public.lya_chat_messages USING btree (chat_id, ordem)
  ```

**`lya_chats`**

- `idx_lya_chats_user`
  ```sql
  CREATE INDEX idx_lya_chats_user ON public.lya_chats USING btree (user_id, updated_at DESC)
  ```
- `lya_chats_pkey`
  ```sql
  CREATE UNIQUE INDEX lya_chats_pkey ON public.lya_chats USING btree (id)
  ```

**`lya_file_rows`**

- `idx_lya_file_rows_data`
  ```sql
  CREATE INDEX idx_lya_file_rows_data ON public.lya_file_rows USING gin (data jsonb_path_ops)
  ```
- `lya_file_rows_pkey`
  ```sql
  CREATE UNIQUE INDEX lya_file_rows_pkey ON public.lya_file_rows USING btree (file_id, linha)
  ```

**`lya_files`**

- `idx_lya_files_criado`
  ```sql
  CREATE INDEX idx_lya_files_criado ON public.lya_files USING btree (created_at DESC)
  ```
- `idx_lya_files_status`
  ```sql
  CREATE INDEX idx_lya_files_status ON public.lya_files USING btree (status)
  ```
- `lya_files_pkey`
  ```sql
  CREATE UNIQUE INDEX lya_files_pkey ON public.lya_files USING btree (id)
  ```

**`lya_memories`**

- `idx_lya_memories_file` — **parcial**
  ```sql
  CREATE INDEX idx_lya_memories_file ON public.lya_memories USING btree (file_id) WHERE (file_id IS NOT NULL)
  ```
- `idx_lya_memories_fts` — **expressão**
  ```sql
  CREATE INDEX idx_lya_memories_fts ON public.lya_memories USING gin (to_tsvector('portuguese'::regconfig, ((((COALESCE(description, ''::text) || ' '::text) || COALESCE(body, ''::text)) || ' '::text) || COALESCE((tags)::text, ''::text))))
  ```
- `idx_lya_memories_tags`
  ```sql
  CREATE INDEX idx_lya_memories_tags ON public.lya_memories USING gin (tags)
  ```
- `idx_lya_memories_type`
  ```sql
  CREATE INDEX idx_lya_memories_type ON public.lya_memories USING btree (type)
  ```
- `lya_memories_name_key`
  ```sql
  CREATE UNIQUE INDEX lya_memories_name_key ON public.lya_memories USING btree (name)
  ```
- `lya_memories_pkey`
  ```sql
  CREATE UNIQUE INDEX lya_memories_pkey ON public.lya_memories USING btree (id)
  ```

**`products`**

- `products_name_key`
  ```sql
  CREATE UNIQUE INDEX products_name_key ON public.products USING btree (name)
  ```
- `products_pkey`
  ```sql
  CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id)
  ```

**`profiles`**

- `idx_profiles_is_active`
  ```sql
  CREATE INDEX idx_profiles_is_active ON public.profiles USING btree (is_active)
  ```
- `profiles_email_key`
  ```sql
  CREATE UNIQUE INDEX profiles_email_key ON public.profiles USING btree (email)
  ```
- `profiles_pkey`
  ```sql
  CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)
  ```

**`radar_events`**

- `idx_radar_events_item`
  ```sql
  CREATE INDEX idx_radar_events_item ON public.radar_events USING btree (item_id, recorded_at DESC)
  ```
- `radar_events_pkey`
  ```sql
  CREATE UNIQUE INDEX radar_events_pkey ON public.radar_events USING btree (id)
  ```

**`radar_items`**

- `idx_radar_items_closed` — **parcial**
  ```sql
  CREATE INDEX idx_radar_items_closed ON public.radar_items USING btree (user_id, closed_at DESC) WHERE (status = ANY (ARRAY['resolvido'::text, 'cancelado'::text]))
  ```
- `idx_radar_items_open` — **parcial**
  ```sql
  CREATE INDEX idx_radar_items_open ON public.radar_items USING btree (user_id, next_follow_up_date) WHERE (status <> ALL (ARRAY['resolvido'::text, 'cancelado'::text]))
  ```
- `radar_items_open_uniq` — **parcial** · **expressão**
  ```sql
  CREATE UNIQUE INDEX radar_items_open_uniq ON public.radar_items USING btree (user_id, lower(btrim(client_email)), COALESCE(btrim(order_number), ''::text), kind) WHERE (status <> ALL (ARRAY['resolvido'::text, 'cancelado'::text]))
  ```
- `radar_items_pkey`
  ```sql
  CREATE UNIQUE INDEX radar_items_pkey ON public.radar_items USING btree (id)
  ```

**`refund_manager_completions`**

- `idx_refund_manager_completions_created_at`
  ```sql
  CREATE INDEX idx_refund_manager_completions_created_at ON public.refund_manager_completions USING btree (created_at DESC)
  ```
- `idx_refund_manager_completions_refund`
  ```sql
  CREATE INDEX idx_refund_manager_completions_refund ON public.refund_manager_completions USING btree (refund_id)
  ```
- `refund_manager_completions_pkey`
  ```sql
  CREATE UNIQUE INDEX refund_manager_completions_pkey ON public.refund_manager_completions USING btree (id)
  ```

**`refund_reason_classifications`**

- `idx_refund_reason_classifications_category`
  ```sql
  CREATE INDEX idx_refund_reason_classifications_category ON public.refund_reason_classifications USING btree (category)
  ```
- `refund_reason_classifications_pkey`
  ```sql
  CREATE UNIQUE INDEX refund_reason_classifications_pkey ON public.refund_reason_classifications USING btree (refund_id)
  ```

**`refunds`**

- `idx_refunds_open_by_email` — **parcial** · **expressão**
  ```sql
  CREATE INDEX idx_refunds_open_by_email ON public.refunds USING btree (lower(btrim(customer_email))) WHERE (completion_date IS NULL)
  ```
- `idx_refunds_product_order_number` — **expressão**
  ```sql
  CREATE INDEX idx_refunds_product_order_number ON public.refunds USING btree (product, normalize_order_number(order_id))
  ```
- `idx_refunds_user_id`
  ```sql
  CREATE INDEX idx_refunds_user_id ON public.refunds USING btree (user_id)
  ```
- `refunds_pkey`
  ```sql
  CREATE UNIQUE INDEX refunds_pkey ON public.refunds USING btree (id)
  ```
- `refunds_service_id_uniq` — **parcial**
  ```sql
  CREATE UNIQUE INDEX refunds_service_id_uniq ON public.refunds USING btree (service_id) WHERE (service_id IS NOT NULL)
  ```

**`service_date_corrections`**

- `idx_service_date_corrections_corrected_at`
  ```sql
  CREATE INDEX idx_service_date_corrections_corrected_at ON public.service_date_corrections USING btree (corrected_at DESC)
  ```
- `idx_service_date_corrections_service`
  ```sql
  CREATE INDEX idx_service_date_corrections_service ON public.service_date_corrections USING btree (service_id)
  ```
- `service_date_corrections_pkey`
  ```sql
  CREATE UNIQUE INDEX service_date_corrections_pkey ON public.service_date_corrections USING btree (id)
  ```

**`service_follow_ups`**

- `idx_follow_ups_same_day_repeat` — **parcial**
  ```sql
  CREATE INDEX idx_follow_ups_same_day_repeat ON public.service_follow_ups USING btree (recorded_at, user_id) WHERE is_same_day_repeat
  ```
- `idx_service_follow_ups_service_id`
  ```sql
  CREATE INDEX idx_service_follow_ups_service_id ON public.service_follow_ups USING btree (service_id)
  ```
- `idx_service_follow_ups_user_followup`
  ```sql
  CREATE INDEX idx_service_follow_ups_user_followup ON public.service_follow_ups USING btree (user_id, follow_up_number)
  ```
- `idx_service_follow_ups_user_id`
  ```sql
  CREATE INDEX idx_service_follow_ups_user_id ON public.service_follow_ups USING btree (user_id)
  ```
- `service_follow_ups_pkey`
  ```sql
  CREATE UNIQUE INDEX service_follow_ups_pkey ON public.service_follow_ups USING btree (id)
  ```

**`services`**

- `idx_services_contact_reason`
  ```sql
  CREATE INDEX idx_services_contact_reason ON public.services USING btree (contact_reason)
  ```
- `idx_services_current_owner_id`
  ```sql
  CREATE INDEX idx_services_current_owner_id ON public.services USING btree (current_owner_id)
  ```
- `idx_services_lower_trim_email` — **expressão**
  ```sql
  CREATE INDEX idx_services_lower_trim_email ON public.services USING btree (lower(TRIM(BOTH FROM client_email)))
  ```
- `idx_services_user_id_created_at`
  ```sql
  CREATE INDEX idx_services_user_id_created_at ON public.services USING btree (user_id, created_at DESC)
  ```
- `services_pkey`
  ```sql
  CREATE UNIQUE INDEX services_pkey ON public.services USING btree (id)
  ```

**`support_products`**

- `idx_support_products_ordem`
  ```sql
  CREATE INDEX idx_support_products_ordem ON public.support_products USING btree (estrutura, sort_order, nome)
  ```
- `support_products_nome_uniq` — **expressão**
  ```sql
  CREATE UNIQUE INDEX support_products_nome_uniq ON public.support_products USING btree (lower(nome))
  ```
- `support_products_pkey`
  ```sql
  CREATE UNIQUE INDEX support_products_pkey ON public.support_products USING btree (id)
  ```

**`support_sms_brands`**

- `idx_support_sms_brands_ordem`
  ```sql
  CREATE INDEX idx_support_sms_brands_ordem ON public.support_sms_brands USING btree (estrutura, sort_order, nome)
  ```
- `support_sms_brands_nome_uniq` — **expressão**
  ```sql
  CREATE UNIQUE INDEX support_sms_brands_nome_uniq ON public.support_sms_brands USING btree (lower(nome))
  ```
- `support_sms_brands_pkey`
  ```sql
  CREATE UNIQUE INDEX support_sms_brands_pkey ON public.support_sms_brands USING btree (id)
  ```

**`support_sms_replies`**

- `idx_support_sms_replies_ordem`
  ```sql
  CREATE INDEX idx_support_sms_replies_ordem ON public.support_sms_replies USING btree (sort_order, categoria, titulo)
  ```
- `support_sms_replies_pkey`
  ```sql
  CREATE UNIQUE INDEX support_sms_replies_pkey ON public.support_sms_replies USING btree (id)
  ```

**`ticket_takeover_requests`**

- `idx_takeover_requests_requester`
  ```sql
  CREATE INDEX idx_takeover_requests_requester ON public.ticket_takeover_requests USING btree (requester_id, status)
  ```
- `idx_takeover_requests_service`
  ```sql
  CREATE INDEX idx_takeover_requests_service ON public.ticket_takeover_requests USING btree (service_id)
  ```
- `idx_takeover_requests_status`
  ```sql
  CREATE INDEX idx_takeover_requests_status ON public.ticket_takeover_requests USING btree (status)
  ```
- `idx_unique_pending_takeover` — **parcial**
  ```sql
  CREATE UNIQUE INDEX idx_unique_pending_takeover ON public.ticket_takeover_requests USING btree (service_id, requester_id) WHERE (status = 'pending'::text)
  ```
- `ticket_takeover_requests_pkey`
  ```sql
  CREATE UNIQUE INDEX ticket_takeover_requests_pkey ON public.ticket_takeover_requests USING btree (id)
  ```

**`ticket_transfers`**

- `idx_ticket_transfers_assigned_by_manager` — **parcial**
  ```sql
  CREATE INDEX idx_ticket_transfers_assigned_by_manager ON public.ticket_transfers USING btree (assigned_by_manager_id) WHERE (assigned_by_manager_id IS NOT NULL)
  ```
- `idx_ticket_transfers_from_user`
  ```sql
  CREATE INDEX idx_ticket_transfers_from_user ON public.ticket_transfers USING btree (from_user_id, status)
  ```
- `idx_ticket_transfers_service`
  ```sql
  CREATE INDEX idx_ticket_transfers_service ON public.ticket_transfers USING btree (service_id)
  ```
- `idx_ticket_transfers_to_user`
  ```sql
  CREATE INDEX idx_ticket_transfers_to_user ON public.ticket_transfers USING btree (to_user_id, status)
  ```
- `idx_unique_pending_transfer` — **parcial**
  ```sql
  CREATE UNIQUE INDEX idx_unique_pending_transfer ON public.ticket_transfers USING btree (service_id, from_user_id) WHERE (status = 'pending'::text)
  ```
- `ticket_transfers_pkey`
  ```sql
  CREATE UNIQUE INDEX ticket_transfers_pkey ON public.ticket_transfers USING btree (id)
  ```

**`training_video_views`**

- `idx_training_video_views_user`
  ```sql
  CREATE INDEX idx_training_video_views_user ON public.training_video_views USING btree (user_id)
  ```
- `training_video_views_pkey`
  ```sql
  CREATE UNIQUE INDEX training_video_views_pkey ON public.training_video_views USING btree (id)
  ```
- `training_video_views_user_id_video_id_key`
  ```sql
  CREATE UNIQUE INDEX training_video_views_user_id_video_id_key ON public.training_video_views USING btree (user_id, video_id)
  ```

**`training_videos`**

- `idx_training_videos_section_order`
  ```sql
  CREATE INDEX idx_training_videos_section_order ON public.training_videos USING btree (section, display_order)
  ```
- `training_videos_pkey`
  ```sql
  CREATE UNIQUE INDEX training_videos_pkey ON public.training_videos USING btree (id)
  ```

**`user_roles`**

- `user_roles_pkey`
  ```sql
  CREATE UNIQUE INDEX user_roles_pkey ON public.user_roles USING btree (id)
  ```

**106 índices**, dos quais 18 parciais e 10 de expressão.

Índices de expressão que a aplicação **precisa casar literalmente** para não perder o índice:

- `idx_services_lower_trim_email` → o predicado tem de ser `lower(trim(client_email))`.
- `idx_refunds_open_by_email` → `lower(btrim(customer_email))` **e** `completion_date IS NULL`.
- `idx_refunds_product_order_number` → `normalize_order_number(order_id)`.
- `idx_held_orders_client_key_open` → `held_order_client_key(email, customer_name, id)`.
- `radar_items_open_uniq` → `lower(btrim(client_email))` + `coalesce(btrim(order_number),'')`.

Isto é exatamente a armadilha registrada no radar de pendências: **helper no `WHERE` mata o
índice parcial**. No schema novo, o predicado da consulta e a definição do índice têm de ser
gerados do mesmo lugar.

### Buracos de índice que importam para o modelo novo

`services` **não tem índice em `service_date`**. Toda métrica da gestora filtra por
`(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ...`, o que é
sempre **seq scan de ~102 mil linhas**. Não há como indexar isso hoje sem um índice de
expressão sobre o cast — que não existe. É a causa estrutural da lentidão dos dashboards e
um argumento direto para `service_date` virar coluna de data real no modelo novo.

---

## 5. Triggers

```sql
SELECT rel.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class rel ON rel.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=rel.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
ORDER BY rel.relname, t.tgname;
```

`tgenabled = 'O'` significa habilitada (origin). **Todas as 19 estão habilitadas.**

| Tabela | Trigger | Quando | Função |
|---|---|---|---|
| `agent_notes` | `trg_agent_notes_touch` | BEFORE INSERT OR UPDATE / ROW | `agent_notes_touch()` |
| `held_orders` | `trg_held_orders_client_single_agent_ins` | AFTER INSERT / STATEMENT | `held_orders_client_single_agent()` |
| `held_orders` | `trg_held_orders_client_single_agent_upd` | AFTER UPDATE / STATEMENT | `held_orders_client_single_agent()` |
| `lya_files` | `trg_lya_files_touch` | BEFORE UPDATE / ROW | `lya_touch()` |
| `lya_memories` | `trg_lya_memories_touch` | BEFORE UPDATE / ROW | `lya_touch()` |
| `refunds` | `trg_sync_refund_reason_classification` | AFTER INSERT OR UPDATE OF reason / ROW | `sync_refund_reason_classification()` |
| `service_follow_ups` | `trg_follow_up_block_date_change` | BEFORE UPDATE / ROW | `_tg_follow_up_block_date_change()` |
| `service_follow_ups` | `trg_follow_up_force_now` | BEFORE INSERT / ROW | `_tg_follow_up_force_now()` |
| `service_follow_ups` | `trg_follow_up_mark_same_day_repeat` | BEFORE INSERT / ROW | `_tg_follow_up_mark_same_day_repeat()` |
| `services` | `services_refresh_agent_daily_counts` | AFTER INSERT OR DELETE OR UPDATE / ROW | `trg_services_refresh_agent_daily_counts()` |
| `services` | `trg_service_block_freeze_fields` | BEFORE UPDATE / ROW | `_tg_service_block_freeze_fields()` |
| `services` | `trg_service_cleanup_refund_del` | BEFORE DELETE / ROW · **WHEN** | `cleanup_refund_of_deleted_service()` |
| `services` | `trg_service_default_current_owner` | BEFORE INSERT / ROW | `_tg_service_default_current_owner()` |
| `services` | `trg_service_pin_date_on_insert` | BEFORE INSERT / ROW | `_tg_service_pin_date_on_insert()` |
| `services` | `trg_service_sync_refund_ins` | AFTER INSERT / ROW · **WHEN** | `sync_refund_from_service()` |
| `services` | `trg_service_sync_refund_upd` | AFTER UPDATE / ROW · **WHEN** | `sync_refund_from_service()` |
| `support_products` | `trg_support_products_touch` | BEFORE UPDATE / ROW | `support_base_touch()` |
| `support_sms_brands` | `trg_support_sms_brands_touch` | BEFORE UPDATE / ROW | `support_base_touch()` |
| `support_sms_replies` | `trg_support_sms_replies_touch` | BEFORE UPDATE / ROW | `support_base_touch()` |

Definições completas:

- ```sql
  CREATE TRIGGER trg_agent_notes_touch BEFORE INSERT OR UPDATE ON public.agent_notes FOR EACH ROW EXECUTE FUNCTION agent_notes_touch()
  ```
- ```sql
  CREATE TRIGGER trg_held_orders_client_single_agent_ins AFTER INSERT ON public.held_orders REFERENCING NEW TABLE AS newrows FOR EACH STATEMENT EXECUTE FUNCTION held_orders_client_single_agent()
  ```
- ```sql
  CREATE TRIGGER trg_held_orders_client_single_agent_upd AFTER UPDATE ON public.held_orders REFERENCING OLD TABLE AS oldrows NEW TABLE AS newrows FOR EACH STATEMENT EXECUTE FUNCTION held_orders_client_single_agent()
  ```
- ```sql
  CREATE TRIGGER trg_lya_files_touch BEFORE UPDATE ON public.lya_files FOR EACH ROW EXECUTE FUNCTION lya_touch()
  ```
- ```sql
  CREATE TRIGGER trg_lya_memories_touch BEFORE UPDATE ON public.lya_memories FOR EACH ROW EXECUTE FUNCTION lya_touch()
  ```
- ```sql
  CREATE TRIGGER trg_sync_refund_reason_classification AFTER INSERT OR UPDATE OF reason ON public.refunds FOR EACH ROW EXECUTE FUNCTION sync_refund_reason_classification()
  ```
- ```sql
  CREATE TRIGGER trg_follow_up_block_date_change BEFORE UPDATE ON public.service_follow_ups FOR EACH ROW EXECUTE FUNCTION _tg_follow_up_block_date_change()
  ```
- ```sql
  CREATE TRIGGER trg_follow_up_force_now BEFORE INSERT ON public.service_follow_ups FOR EACH ROW EXECUTE FUNCTION _tg_follow_up_force_now()
  ```
- ```sql
  CREATE TRIGGER trg_follow_up_mark_same_day_repeat BEFORE INSERT ON public.service_follow_ups FOR EACH ROW EXECUTE FUNCTION _tg_follow_up_mark_same_day_repeat()
  ```
- ```sql
  CREATE TRIGGER services_refresh_agent_daily_counts AFTER INSERT OR DELETE OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION trg_services_refresh_agent_daily_counts()
  ```
- ```sql
  CREATE TRIGGER trg_service_block_freeze_fields BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION _tg_service_block_freeze_fields()
  ```
- ```sql
  CREATE TRIGGER trg_service_cleanup_refund_del BEFORE DELETE ON public.services FOR EACH ROW WHEN ((old.contact_reason = 'reembolso'::text)) EXECUTE FUNCTION cleanup_refund_of_deleted_service()
  ```
- ```sql
  CREATE TRIGGER trg_service_default_current_owner BEFORE INSERT ON public.services FOR EACH ROW EXECUTE FUNCTION _tg_service_default_current_owner()
  ```
- ```sql
  CREATE TRIGGER trg_service_pin_date_on_insert BEFORE INSERT ON public.services FOR EACH ROW EXECUTE FUNCTION _tg_service_pin_date_on_insert()
  ```
- ```sql
  CREATE TRIGGER trg_service_sync_refund_ins AFTER INSERT ON public.services FOR EACH ROW WHEN ((new.contact_reason = 'reembolso'::text)) EXECUTE FUNCTION sync_refund_from_service()
  ```
- ```sql
  CREATE TRIGGER trg_service_sync_refund_upd AFTER UPDATE ON public.services FOR EACH ROW WHEN (((new.contact_reason IS DISTINCT FROM old.contact_reason) OR ((new.contact_reason = 'reembolso'::text) AND ((new.client_email IS DISTINCT FROM old.client_email) OR (new.product IS DISTINCT FROM old.product) OR (new.platform IS DISTINCT FROM old.platform) OR (new.channel IS DISTINCT FROM old.channel) OR (new.order_id IS DISTINCT FROM old.order_id) OR (new.service_date IS DISTINCT FROM old.service_date) OR (new.current_owner_id IS DISTINCT FROM old.current_owner_id))))) EXECUTE FUNCTION sync_refund_from_service()
  ```
- ```sql
  CREATE TRIGGER trg_support_products_touch BEFORE UPDATE ON public.support_products FOR EACH ROW EXECUTE FUNCTION support_base_touch()
  ```
- ```sql
  CREATE TRIGGER trg_support_sms_brands_touch BEFORE UPDATE ON public.support_sms_brands FOR EACH ROW EXECUTE FUNCTION support_base_touch()
  ```
- ```sql
  CREATE TRIGGER trg_support_sms_replies_touch BEFORE UPDATE ON public.support_sms_replies FOR EACH ROW EXECUTE FUNCTION support_base_touch()
  ```

### As três triggers que determinam o dado que existe

1. **`trg_service_pin_date_on_insert`** — sobrescreve `service_date` no INSERT, sempre:

   ```sql
   NEW.service_date := to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD')
                       || 'T00:00:00-03:00';
   ```

   Consequência para a travessia: **o agente não escolhe a data**; ela é o dia de São Paulo
   do INSERT, sempre à meia-noite, sempre com offset literal `-03:00`. Qualquer backfill
   histórico precisa desabilitar esta trigger (`ALTER TABLE ... DISABLE TRIGGER`), o que é
   escrita e portanto está fora desta fase.

   O offset é **fixo em `-03:00`**, gravado como texto. São Paulo não usa horário de verão
   desde 2019, então hoje isso é correto; mas é um literal, não uma conversão.

2. **`trg_service_block_freeze_fields`** — `user_id` é imutável; `service_date` só muda por
   gestora (via `manager_correct_service_date`); `current_owner_id` só muda por gestora ou
   pelo `claim_ticket` (que sinaliza com `set_config('app.claim_owner', ...)`).

   **Portanto `service_date` *é* corrigido manualmente em produção** — existe RPC e existe
   tabela de auditoria (`service_date_corrections`) só para isso. Ver emenda 1.

3. **`trg_follow_up_force_now`** — `recorded_at := now()` no INSERT, incondicionalmente. O
   cliente não controla o instante da interação. Isso é o que torna `recorded_at` confiável
   como ordem, e o que faz empate de `recorded_at` ser possível só em inserções concorrentes.

`trg_services_refresh_agent_daily_counts` é tratada na seção 11.4, porque a suspeita de que
estaria quebrada não se confirmou.

---

## 6. Funções do schema `public`

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
       p.prosecdef, p.provolatile, p.proconfig, l.lanname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' ORDER BY p.proname;
```

**118 funções.** 104 são `SECURITY DEFINER`.

| Função | Retorno | SECDEF | Volatilidade | `search_path` |
|---|---|---|---|---|
| `_interaction_events(from_date date, to_date date, agent_id text)` | `TABLE(day date, user_id text, service_id text, product te…` | **sim** | STABLE | search_path=public |
| `_tg_follow_up_block_date_change()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `_tg_follow_up_force_now()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `_tg_follow_up_mark_same_day_repeat()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `_tg_service_block_freeze_fields()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `_tg_service_default_current_owner()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `_tg_service_pin_date_on_insert()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `agent_daily_metrics(target_date date)` | `jsonb` | **sim** | STABLE | search_path=public |
| `agent_heartbeat(p_user_agent text)` | `void` | **sim** | VOLATILE | search_path=public |
| `agent_metrics_range(from_date date, to_date date)` | `jsonb` | **sim** | STABLE | search_path=public |
| `agent_my_metrics(from_date date, to_date date)` | `jsonb` | **sim** | STABLE | search_path=public |
| `agent_notes_touch()` | `trigger` | não | VOLATILE | search_path=public |
| `agent_product_mix(from_date date, to_date date, top_n integer)` | `jsonb` | **sim** | STABLE | search_path=public |
| `approve_ticket_takeover(p_request_id uuid)` | `void` | **sim** | VOLATILE | search_path=public |
| `can_claim_tickets()` | `boolean` | **sim** | STABLE | search_path=public |
| `can_read_refund_analytics()` | `boolean` | **sim** | STABLE | search_path=public |
| `can_view_all_tickets()` | `boolean` | **sim** | STABLE | search_path=public |
| `can_view_support_analytics()` | `boolean` | **sim** | STABLE | search_path=public |
| `claim_ticket(p_service_id text)` | `TABLE(id text, client_email text, service_date text, prod…` | **sim** | VOLATILE | search_path=public |
| `classify_refund_reason(p_reason text)` | `text` | não | IMMUTABLE | - |
| `cleanup_refund_of_deleted_service()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `confirm_held_order(p_order_id uuid)` | `void` | **sim** | VOLATILE | search_path=public |
| `copy_refund_reason_analytics(from_date date, to_date date, product_filter text, platform_filter tex…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `copy_refund_reason_evidence(from_date date, to_date date, reason_category text, product_filter tex…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `create_refund(p_customer_email text, p_request_date date, p_sales_platform text, p_o…)` | `void` | **sim** | VOLATILE | search_path=public |
| `create_refund(p_customer_email text, p_request_date date, p_sales_platform text, p_o…)` | `void` | **sim** | VOLATILE | search_path=public |
| `dashboard_audit(from_date date, to_date date, agent_id text, page_size integer, page_o…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_channel_detail(p_from_date date, p_to_date date, p_agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_contact_reason_notes(from_date date, to_date date, agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_daily_tickets(from_date date, to_date date, agent_id text, platform_filter text, pro…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_export_extras(from_date date, to_date date, agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_external_refund_comparison(from_date date, to_date date, product_filter text, divergence_filter t…)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `dashboard_follow_up_detail(p_from_date date, p_to_date date)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_hourly_pattern(from_date date, to_date date, agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_metrics(from_date date, to_date date, agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_refund_audit(from_date date, to_date date, agent_id text, status_filter text, refun…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_refund_metrics(from_date date, to_date date, agent_id text, status_filter text, refun…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_refund_reason_detail(from_date date, to_date date, reason_category text, agent_id text, sta…)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_same_day_repeats(from_date date, to_date date, agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `dashboard_status_summary(from_date date, to_date date, agent_id text)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `export_agent_services(p_from date, p_to date)` | `jsonb` | **sim** | STABLE | search_path=public |
| `find_ticket_by_email(p_email text)` | `TABLE(id text, user_id text, current_owner_id text, agent…` | **sim** | VOLATILE | search_path=public |
| `handle_new_user()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `has_role(_user_id uuid, _role "AppRole")` | `boolean` | **sim** | STABLE | search_path=public |
| `held_order_client_key(p_email text, p_customer_name text, p_id uuid)` | `text` | não | IMMUTABLE | - |
| `held_order_events_for(p_order_id uuid)` | `jsonb` | **sim** | STABLE | search_path=public |
| `held_orders_client_conflicts(p_keys text[])` | `text[]` | não | STABLE | search_path=public |
| `held_orders_client_single_agent()` | `trigger` | não | VOLATILE | search_path=public |
| `is_copy_team()` | `boolean` | **sim** | STABLE | search_path=public |
| `is_manager()` | `boolean` | **sim** | STABLE | search_path=public |
| `is_produtos_team()` | `boolean` | **sim** | STABLE | search_path=public |
| `lya_atualizar_arquivo(p_file_id uuid, p_nome text, p_resumo text, p_tags jsonb)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `lya_criar_arquivo(p_nome text, p_arquivo text, p_tipo text, p_bytes integer, p_conteudo …)` | `uuid` | **sim** | VOLATILE | search_path=public |
| `lya_delete_chat(p_chat_id uuid)` | `integer` | **sim** | VOLATILE | search_path=public |
| `lya_delete_file(p_file_id uuid)` | `integer` | **sim** | VOLATILE | search_path=public |
| `lya_delete_memory(p_name text)` | `integer` | **sim** | VOLATILE | search_path=public |
| `lya_delete_seed_memories()` | `integer` | **sim** | VOLATILE | search_path=public |
| `lya_exec_sql(p_sql text, p_limit integer)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `lya_finalizar_arquivo(p_file_id uuid, p_colunas jsonb, p_total integer, p_resumo text, p_tag…)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `lya_get_chat(p_chat_id uuid)` | `jsonb` | **sim** | STABLE | search_path=public |
| `lya_get_file(p_file_id uuid, p_amostra integer)` | `jsonb` | **sim** | STABLE | search_path=public |
| `lya_inserir_linhas(p_file_id uuid, p_linhas jsonb, p_offset integer)` | `integer` | **sim** | VOLATILE | search_path=public |
| `lya_list_chats()` | `jsonb` | **sim** | STABLE | search_path=public |
| `lya_list_files()` | `jsonb` | **sim** | STABLE | search_path=public |
| `lya_list_memories()` | `SETOF lya_memories` | **sim** | STABLE | search_path=public |
| `lya_recall_memories(p_query text, p_limit integer)` | `jsonb` | **sim** | STABLE | search_path=public |
| `lya_save_chat(p_chat_id uuid, p_mensagens jsonb)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `lya_sistema_nos()` | `jsonb` | **sim** | STABLE | search_path=public |
| `lya_slugify(p_text text)` | `text` | não | IMMUTABLE | - |
| `lya_touch()` | `trigger` | não | VOLATILE | search_path=public |
| `lya_upsert_memory(p_name text, p_description text, p_type text, p_tags jsonb, p_body tex…)` | `lya_memories` | **sim** | VOLATILE | search_path=public |
| `manager_assign_held_orders(p_order_ids uuid[], p_agent_id text)` | `integer` | **sim** | VOLATILE | search_path=public |
| `manager_complete_refund(p_refund_id text, p_completion_date date, p_refund_value numeric, p_re…)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_correct_service_date(p_service_id text, p_new_date date, p_reason text)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_delete_auth_user(p_target_user_id text, p_confirm_email text)` | `void` | **sim** | VOLATILE | search_path=public |
| `manager_delete_external_refunds(p_product text, p_month_ref date, p_platform text)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_distribute_held_orders(p_order_ids uuid[], p_agent_ids text[])` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_import_external_refunds(p_product text, p_month_ref date, p_source_file text, p_rows jsonb, p_…)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_import_held_orders(p_rows jsonb)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_list_held_orders(from_date date, to_date date, agent_id text, status_filter text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `manager_list_open_tickets_by_agent(p_agent_id text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `manager_list_users()` | `jsonb` | **sim** | STABLE | search_path=public |
| `manager_reassign_tickets(p_assignments jsonb)` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_refund_alerts()` | `jsonb` | **sim** | VOLATILE | search_path=public |
| `manager_set_agent_availability(p_target_user_id text, p_available boolean)` | `void` | **sim** | VOLATILE | search_path=public |
| `manager_set_user_active(p_target_user_id text, p_active boolean)` | `void` | **sim** | VOLATILE | search_path=public |
| `manager_takeover_notifications()` | `TABLE(request_id uuid, service_id text, client_email text…` | **sim** | STABLE | search_path=public |
| `me_status()` | `jsonb` | **sim** | STABLE | search_path=public |
| `my_follow_ups()` | `jsonb` | **sim** | STABLE | search_path=public |
| `my_held_orders(p_status text)` | `jsonb` | **sim** | STABLE | search_path=public |
| `my_held_orders_daily_metrics()` | `jsonb` | **sim** | STABLE | search_path=public |
| `my_radar_items()` | `jsonb` | **sim** | STABLE | search_path=public |
| `my_radar_summary()` | `jsonb` | **sim** | STABLE | search_path=public |
| `my_recent_services(p_days_back integer)` | `TABLE(id text, client_email text, service_date text, prod…` | **sim** | STABLE | search_path=public |
| `my_refunds_with_refunded_value()` | `TABLE(id uuid, created_at timestamp with time zone, user_…` | não | STABLE | search_path=public |
| `my_transfer_history()` | `TABLE(role text, transfer_id uuid, service_id text, clien…` | **sim** | VOLATILE | search_path=public |
| `my_transfer_notifications()` | `TABLE(role text, transfer_id uuid, service_id text, clien…` | **sim** | VOLATILE | search_path=public |
| `normalize_order_number(p text)` | `text` | não | IMMUTABLE | search_path=public |
| `pick_up_refund(p_refund_id text)` | `void` | **sim** | VOLATILE | search_path=public |
| `radar_create_item(p_client_email text, p_kind text, p_action_needed text, p_next_follow_…)` | `uuid` | **sim** | VOLATILE | search_path=public |
| `radar_delete_item(p_item_id uuid)` | `void` | **sim** | VOLATILE | search_path=public |
| `radar_is_closed(p_status text)` | `boolean` | não | IMMUTABLE | search_path=public |
| `radar_item_events(p_item_id uuid)` | `jsonb` | **sim** | STABLE | search_path=public |
| `radar_register_action(p_item_id uuid, p_status text, p_action text, p_next_follow_up_date da…)` | `void` | **sim** | VOLATILE | search_path=public |
| `radar_today()` | `date` | não | STABLE | search_path=public |
| `radar_update_item(p_item_id uuid, p_client_email text, p_kind text, p_action_needed text…)` | `void` | **sim** | VOLATILE | search_path=public |
| `record_auth_event(p_event_type text, p_target_user_id text, p_metadata jsonb)` | `void` | **sim** | VOLATILE | search_path=public |
| `redact_free_text(p_value text)` | `text` | não | IMMUTABLE | - |
| `refresh_agent_daily_service_count(p_user_id uuid, p_day date)` | `void` | **sim** | VOLATILE | search_path=public |
| `refund_refunded_value(p_refund_value numeric, p_refund_type text)` | `numeric` | não | IMMUTABLE | - |
| `reject_ticket_takeover(p_request_id uuid, p_note text)` | `void` | **sim** | VOLATILE | search_path=public |
| `request_ticket_takeover(p_service_id text, p_note text)` | `uuid` | **sim** | VOLATILE | search_path=public |
| `set_held_order_status(p_order_id uuid, p_status text, p_note text, p_pending_tag text)` | `void` | **sim** | VOLATILE | search_path=public |
| `support_base_touch()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `sync_refund_from_service()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `sync_refund_reason_classification()` | `trigger` | **sim** | VOLATILE | search_path=public |
| `text_to_date_safe(p_value text)` | `date` | não | IMMUTABLE | - |
| `trg_services_refresh_agent_daily_counts()` | `trigger` | **sim** | VOLATILE | search_path=public |

### Funções sem `search_path` fixado

`classify_refund_reason`, `held_order_client_key`, `redact_free_text`, `refund_refunded_value`,
`text_to_date_safe` rodam com `cfg=-`, isto é, sem `SET search_path`. Todas são `IMMUTABLE` e
`SECURITY INVOKER`, então não são vetor de escalada; mas são a exceção ao padrão da casa e
valem ser normalizadas no modelo novo.

### Sobrecarga viva

`create_refund` existe em **duas** assinaturas:

```
create_refund(p_customer_email text, p_request_date date, p_sales_platform text, p_order_id text, p_product text)
create_refund(p_customer_email text, p_request_date date, p_sales_platform text, p_order_id text, p_product text, p_channel text)
```

A de 5 argumentos é resíduo: o front chama a de 6. Qualquer port precisa decidir por uma.
Nenhuma outra função tem sobrecarga — as variantes `uuid` das RPCs de métrica já foram
derrubadas, como o `CLAUDE.md` afirma, e isso se confirma: **nenhuma função de `public` recebe
`agent_id uuid`**; todas recebem `agent_id text`.

---

## 7. Policies RLS

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check, permissive
FROM pg_policies WHERE schemaname='public' ORDER BY tablename, cmd, policyname;
```

**85 policies** em 31 tabelas.


**`agent_daily_service_counts`**

- `SELECT` · `Managers view all counts` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Users view own counts` · roles=`public`
  - `USING`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`agent_heartbeats`**

- `SELECT` · `managers read all heartbeats` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`

**`agent_notes`**

- `ALL` · `agent_notes_own` · roles=`public`
  - `USING`: `(user_id = ( SELECT (auth.uid())::text AS uid))`
  - `WITH CHECK`: `(user_id = ( SELECT (auth.uid())::text AS uid))`

**`auth_events`**

- `SELECT` · `managers read all auth events` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `users read own auth events` · roles=`public`
  - `USING`: `(user_id = (( SELECT auth.uid() AS uid))::text)`

**`claude_skills_leads`**

- `INSERT` · `anon_insert_leads` · roles=`anon`
  - `WITH CHECK`: `true`

**`external_refunds`**

- `ALL` · `external_refunds_manager_all` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`goals`**

- `ALL` · `Managers can manage goals` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Anyone can view goals` · roles=`public`
  - `USING`: `true`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`held_order_events`**

- `SELECT` · `held_order_events_select` · roles=`public`
  - `USING`: `((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT is_manager() AS is_manager) OR (EXISTS ( SELECT 1    FROM held_orders o   WHERE ((o.id = held_order_events.order_id) AND (o.assigned_to = (( SELECT auth.uid() AS uid))::text))))))`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`held_orders`**

- `SELECT` · `held_orders_select` · roles=`public`
  - `USING`: `((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT is_manager() AS is_manager) OR (assigned_to = (( SELECT auth.uid() AS uid))::text)))`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`lya_chat_messages`**

- `ALL` · `lya_chat_messages_own` · roles=`authenticated`
  - `USING`: `(EXISTS ( SELECT 1    FROM lya_chats c   WHERE ((c.id = lya_chat_messages.chat_id) AND (c.user_id = (( SELECT auth.uid() AS uid))::text))))`
  - `WITH CHECK`: `(EXISTS ( SELECT 1    FROM lya_chats c   WHERE ((c.id = lya_chat_messages.chat_id) AND (c.user_id = (( SELECT auth.uid() AS uid))::text))))`

**`lya_chats`**

- `ALL` · `lya_chats_own` · roles=`authenticated`
  - `USING`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
  - `WITH CHECK`: `(user_id = (( SELECT auth.uid() AS uid))::text)`

**`lya_file_rows`**

- `SELECT` · `lya_file_rows_read_analytics` · roles=`authenticated`
  - `USING`: `can_view_support_analytics()`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`lya_files`**

- `SELECT` · `lya_files_read_analytics` · roles=`authenticated`
  - `USING`: `can_view_support_analytics()`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`lya_memories`**

- `SELECT` · `lya_memories_read_analytics` · roles=`authenticated`
  - `USING`: `can_view_support_analytics()`

**`products`**

- `ALL` · `Managers can manage products` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Anyone can view products` · roles=`public`
  - `USING`: `true`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`profiles`**

- `SELECT` · `Copy team can view all profiles` · roles=`authenticated`
  - `USING`: `( SELECT is_copy_team() AS is_copy_team)`
- `SELECT` · `Cross-agent view all profiles` · roles=`public`
  - `USING`: `( SELECT can_view_all_tickets() AS can_view_all_tickets)`
- `SELECT` · `Managers can view all profiles` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Users can view own profile` · roles=`public`
  - `USING`: `((( SELECT auth.uid() AS uid))::text = id)`

**`radar_events`**

- `SELECT` · `radar_events_select` · roles=`public`
  - `USING`: `(( SELECT is_manager() AS is_manager) OR (EXISTS ( SELECT 1    FROM radar_items i   WHERE ((i.id = radar_events.item_id) AND (i.user_id = ( SELECT (auth.uid())::text AS uid))))))`

**`radar_items`**

- `SELECT` · `radar_items_select` · roles=`public`
  - `USING`: `((user_id = ( SELECT (auth.uid())::text AS uid)) OR ( SELECT is_manager() AS is_manager))`

**`refund_manager_completions`**

- `INSERT` · `Managers insert refund completions` · roles=`public`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Managers read refund completions` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`

**`refund_reason_classifications`**

- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `SELECT` · `managers can read refund reason classifications` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`

**`refunds`**

- `DELETE` · `Users delete own refunds` · roles=`public`
  - `USING`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
- `INSERT` · `Users insert own refunds` · roles=`public`
  - `WITH CHECK`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
- `SELECT` · `Managers view all refunds` · roles=`public`
  - `USING`: `((( SELECT auth.uid() AS uid) IS NOT NULL) AND ( SELECT is_manager() AS is_manager))`
- `SELECT` · `Users view own refunds` · roles=`public`
  - `USING`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `UPDATE` · `Users update own refunds` · roles=`public`
  - `USING`: `(user_id = (( SELECT auth.uid() AS uid))::text)`

**`service_date_corrections`**

- `INSERT` · `Managers insert corrections` · roles=`public`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Managers read corrections` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`service_follow_ups`**

- `INSERT` · `Agents can insert own follow-ups` · roles=`public`
  - `WITH CHECK`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
- `SELECT` · `Agents can read own follow-ups` · roles=`public`
  - `USING`: `((user_id = (( SELECT auth.uid() AS uid))::text) OR (EXISTS ( SELECT 1    FROM services s   WHERE ((s.id = service_follow_ups.service_id) AND (s.current_owner_id = (( SELECT auth.uid() AS uid))::text)))))`
- `SELECT` · `Cross-agent read all follow-ups` · roles=`public`
  - `USING`: `( SELECT can_view_all_tickets() AS can_view_all_tickets)`
- `SELECT` · `Managers can read all follow-ups` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`

**`services`**

- `DELETE` · `Agents delete own services` · roles=`public`
  - `USING`: `(current_owner_id = (( SELECT auth.uid() AS uid))::text)`
- `DELETE` · `Managers delete services` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `INSERT` · `Agents insert own services` · roles=`public`
  - `WITH CHECK`: `(user_id = (( SELECT auth.uid() AS uid))::text)`
- `INSERT` · `Managers insert services` · roles=`public`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Agents view own services` · roles=`public`
  - `USING`: `(current_owner_id = (( SELECT auth.uid() AS uid))::text)`
- `SELECT` · `Copy team can view all services` · roles=`authenticated`
  - `USING`: `( SELECT is_copy_team() AS is_copy_team)`
- `SELECT` · `Cross-agent view all services` · roles=`public`
  - `USING`: `( SELECT can_view_all_tickets() AS can_view_all_tickets)`
- `SELECT` · `Managers view all services` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `UPDATE` · `Agents update own services` · roles=`public`
  - `USING`: `(current_owner_id = (( SELECT auth.uid() AS uid))::text)`
  - `WITH CHECK`: `(current_owner_id = (( SELECT auth.uid() AS uid))::text)`
- `UPDATE` · `Cross-agent update services` · roles=`public`
  - `USING`: `( SELECT can_view_all_tickets() AS can_view_all_tickets)`
- `UPDATE` · `Managers update services` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`

**`support_products`**

- `ALL` · `support_products_write` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `SELECT` · `support_products_select` · roles=`public`
  - `USING`: `(( SELECT auth.uid() AS uid) IS NOT NULL)`

**`support_sms_brands`**

- `ALL` · `support_sms_brands_write` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `SELECT` · `support_sms_brands_select` · roles=`public`
  - `USING`: `(( SELECT auth.uid() AS uid) IS NOT NULL)`

**`support_sms_replies`**

- `ALL` · `support_sms_replies_write` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `SELECT` · `support_sms_replies_select` · roles=`public`
  - `USING`: `(( SELECT auth.uid() AS uid) IS NOT NULL)`

**`ticket_takeover_requests`**

- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `SELECT` · `takeover_select` · roles=`public`
  - `USING`: `((requester_id = (( SELECT auth.uid() AS uid))::text) OR ( SELECT is_manager() AS is_manager))`

**`ticket_transfers`**

- `INSERT` · `Agents create transfers as sender` · roles=`public`
  - `WITH CHECK`: `(from_user_id = (( SELECT auth.uid() AS uid))::text)`
- `SELECT` · `Agents see own transfers` · roles=`public`
  - `USING`: `((from_user_id = (( SELECT auth.uid() AS uid))::text) OR (to_user_id = (( SELECT auth.uid() AS uid))::text))`
- `SELECT` · `Managers see all transfers` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `lya_sql_ro read` · roles=`lya_sql_ro`
  - `USING`: `true`
- `UPDATE` · `Agents update own transfers` · roles=`public`
  - `USING`: `((from_user_id = (( SELECT auth.uid() AS uid))::text) OR (to_user_id = (( SELECT auth.uid() AS uid))::text))`
  - `WITH CHECK`: `((from_user_id = (( SELECT auth.uid() AS uid))::text) OR (to_user_id = (( SELECT auth.uid() AS uid))::text))`

**`training_video_views`**

- `INSERT` · `Agents can insert own training views` · roles=`public`
  - `WITH CHECK`: `(user_id = ( SELECT auth.uid() AS uid))`
- `SELECT` · `Agents can read own training views` · roles=`public`
  - `USING`: `(user_id = ( SELECT auth.uid() AS uid))`
- `SELECT` · `Managers can read all training views` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
- `UPDATE` · `Agents can update own training views` · roles=`public`
  - `USING`: `(user_id = ( SELECT auth.uid() AS uid))`
  - `WITH CHECK`: `(user_id = ( SELECT auth.uid() AS uid))`

**`training_videos`**

- `ALL` · `Managers can manage training videos` · roles=`public`
  - `USING`: `( SELECT is_manager() AS is_manager)`
  - `WITH CHECK`: `( SELECT is_manager() AS is_manager)`
- `SELECT` · `Authenticated can read published training videos` · roles=`public`
  - `USING`: `(is_published = true)`

### Otimização de initplan: quase completa, três sobras

A correção de 27/07/2026 (`rls_initplan_optimization`) envolveu `auth.uid()` e os helpers em
`( SELECT ... )`, o que faz o Postgres avaliar uma vez por consulta em vez de uma vez por
linha. O catálogo confirma que a maioria está envolvida.

**Ficaram de fora três policies**, todas criadas depois daquela correção (feature da Lya):

| Tabela | Policy | Expressão |
|---|---|---|
| `lya_file_rows` | `lya_file_rows_read_analytics` | `can_view_support_analytics()` |
| `lya_files` | `lya_files_read_analytics` | `can_view_support_analytics()` |
| `lya_memories` | `lya_memories_read_analytics` | `can_view_support_analytics()` |

São tabelas pequenas (`lya_files`, `lya_file_rows`, `lya_memories`), então o custo hoje é
irrelevante. Registro porque é o mesmo defeito que causou o incidente de julho, e porque
mostra que a correção foi pontual e não virou regra — nada impede a próxima policy de nascer
com o mesmo problema.

### Tabelas sem policy

- **`user_roles`** — RLS ligada, zero policies: inacessível para `anon` e `authenticated`.
- **`lya_agentes`** — é view; não tem RLS própria. Ver seção 9.

### Assimetrias de leitura que o modelo novo precisa preservar

- `agent_notes`: policy única `ALL` restrita ao próprio `user_id`. **A gestora não lê o
  caderno do agente** — e isso é intencional, não um esquecimento.
- `services`: 12 policies. Leitura é por `current_owner_id` (não por `user_id`), o que
  significa que **quem criou o ticket deixa de vê-lo se a posse muda**, a menos que tenha
  `can_view_all_tickets`. Escrita de INSERT, porém, é validada contra `user_id`.
- `service_follow_ups`: leitura própria **ou** de tickets que a pessoa possui hoje.
- `training_videos`: `SELECT` com `USING (is_published = true)` para role `public` —
  sem exigir `auth.uid() IS NOT NULL`. Como `anon` tem `SELECT` na tabela, **vídeo publicado
  é legível sem login**. Baixo impacto (só metadado e URL), mas é leitura anônima real.

---

## 8. Enums e roles do banco

```sql
SELECT t.typname, n.nspname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
JOIN pg_enum e ON e.enumtypid=t.oid
WHERE n.nspname IN ('public','auth') GROUP BY t.typname, n.nspname, t.oid;
```

| Enum | Labels | Colunas que usam |
|---|---|---|
| `public."AppRole"` | `agent, manager, copy_grup, produto` | **2** (`profiles.role`, `user_roles.role`) |
| `public.app_role` | `agent, manager, copy_grup, produto` | **0** — órfão |

Os dois existem, com **labels idênticos**, e só o de nome em PascalCase entre aspas é usado.
`public.app_role` é o enum original das migrations (seção 11.5); `"AppRole"` foi criado fora
do repositório. Mexer em `app_role` não tem efeito nenhum sobre a aplicação.

Roles do banco relevantes:

| Role | login | bypassrls | membro de |
|---|---|---|---|
| `anon` | não | **não** | — |
| `authenticated` | não | **não** | — |
| `service_role` | não | **sim** | — |
| `lya_sql_ro` | não | **não** | — |
| `authenticator` | **sim** | não | `anon`, `authenticated`, `service_role` |
| `postgres` | sim | **sim** | vários, incl. `lya_sql_ro` |

`lya_sql_ro` é role dedicada ao sandbox SQL da Lya: **não** tem `bypassrls`, e recebe acesso
por policies explícitas `lya_sql_ro read … USING (true)` numa lista branca de tabelas. É o
desenho correto.

---

## 9. GRANTs

```sql
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role','lya_sql_ro');
```

O resultado é **uniforme e vale registrar por escrito**:

> **`anon` e `authenticated` têm `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
> TRIGGER` em todas as 32 tabelas de `public`.**

Isto é o default do Supabase (`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`)
e nunca foi restringido. **A RLS é a única coisa que protege o dado.** Uma tabela nova que
nasça sem policy nasce ilegível (bom); uma tabela que nasça com RLS desligada nasce
**mundialmente escrevível por `anon`** (ruim). Não há hoje nenhuma tabela nessa situação —
todas as 32 têm `relrowsecurity = true` — mas a margem é zero.

`lya_sql_ro` recebe **apenas `SELECT`**, e só nas 19 tabelas da lista branca. Tabelas fora da
lista para essa role: `agent_heartbeats`, `agent_notes`, `auth_events`, `claude_skills_leads`,
`lya_chats`, `lya_chat_messages`, `lya_memories`, `profiles`, `radar_events`, `radar_items`,
`refund_manager_completions`, `training_video_views`, `training_videos`, `user_roles`.
Note que **`profiles` está fora** — a Lya não lê a tabela de perfis diretamente.

### A view `lya_agentes` — achado corrigido em produção

```sql
SELECT relname, reloptions, pg_get_userbyid(relowner) FROM pg_class
WHERE relnamespace='public'::regnamespace AND relkind='v';
-- lya_agentes | reloptions = NULL | owner = postgres
```

`reloptions` nulo significa **sem `security_invoker=true`**. Uma view sem essa opção é
avaliada com os privilégios do dono (`postgres`, que tem `bypassrls`), portanto ela avalia
`profiles` **contornando as 4 policies de `profiles`**. Enquanto `anon` teve `SELECT` na view,
isso significava ler o quadro de pessoal inteiro sem autenticar.

**Corrigido pelo dono em 26/09/2026** com `REVOKE ALL ON public.lya_agentes FROM anon,
authenticated`. Verificado por leitura de catálogo depois da correção:

```sql
SELECT coalesce(string_agg(DISTINCT grantee||':'||privilege_type,' '),'(nenhum)')
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='lya_agentes';
```

| Role | `SELECT` na view, hoje |
|---|---|
| `anon` | **nenhum privilégio** |
| `authenticated` | **nenhum privilégio** |
| `lya_sql_ro` | `SELECT` — preservado, a Lya continua funcionando |
| `postgres`, `service_role` | tudo (ambos têm `bypassrls` de todo modo) |

Contagem de concessões para `anon` e `authenticated`: **0**.

A view continua **sem** `security_invoker`, e isso deixou de importar para o risco original:
quem não tem `SELECT` não chega à view. Registro a diferença porque ela é real — a causa
estrutural (view avaliada com poder do dono) segue lá, e qualquer `GRANT` futuro a reabre. A
correção definitiva (`security_invoker = true` mais policy explícita para `lya_sql_ro`) está
em `sql/30-correcao-lya-agentes.sql`, opção A, e **não** foi aplicada.

Ver `90-BACKLOG.md` B1.

### GRANTs de função

O default do Supabase também se aplica: quase toda função de `public` tem
`EXECUTE` para `PUBLIC`, `anon`, `authenticated`, `service_role`. As RPCs `SECURITY DEFINER`
se defendem **dentro do corpo**, com `is_manager()` / `can_view_*()` — não pelo GRANT.

Duas exceções que valem nota:

| Função | ACL | Leitura |
|---|---|---|
| `lya_exec_sql(text, integer)` | `lya_sql_ro=X`, `authenticated=X`, `service_role=X` — **sem `anon`, sem `PUBLIC`** | dona é `lya_sql_ro`; ver abaixo |
| `_interaction_events(date, date, text)` | `anon`, `authenticated`, `service_role` — **sem `PUBLIC`** | helper interno das métricas |

**`lya_exec_sql` existe e está adequadamente contida.** É `SECURITY DEFINER` pertencente a
`lya_sql_ro` (role sem `bypassrls`), e o corpo faz, em ordem:

1. `IF NOT public.can_view_support_analytics() THEN RAISE EXCEPTION 'forbidden'` (42501);
2. recusa qualquer SQL que não comece com `select` ou `with` (regex `^\s*(select|with)\y`);
3. recusa qualquer `;` no texto — uma instrução por chamada;
4. `set_config('statement_timeout','8000',true)`;
5. `set_config('transaction_read_only','on',true)`;
6. envolve a consulta em `SELECT * FROM (%s) q LIMIT <=500`.

Ou seja: só analista autorizado, só leitura, uma instrução, 8 s de teto, 500 linhas de teto,
e ainda sujeito à RLS de `lya_sql_ro`. **Não é um buraco.** O ponto de atenção que resta é
`format()` com `%s`: a consulta do usuário é interpolada como texto, então a defesa contra
efeito colateral é inteiramente o par "começa com select/with" + `transaction_read_only`. O
segundo é o que realmente garante, e garante bem.

Uma anomalia menor: `refresh_agent_daily_service_count(uuid, date)` é `SECURITY DEFINER`,
**escreve** em `agent_daily_service_counts` e tem `EXECUTE` para `PUBLIC` e `anon`. Como ela
apenas recalcula a contagem a partir de `services` (idempotente, sem parâmetro que decida
valor), o pior efeito de um abuso é gasto de CPU — que num `t4g.micro` não é nada.

---

## 10. Tamanho e contagem por tabela

Já na seção 1. Repito aqui o recorte que importa para dimensionar o backfill:

| Tabela | linhas (est.) | tamanho | % do schema |
|---|---|---|---|
| `services` | 101.888 | 50 MB | 56% |
| `service_follow_ups` | 56.943 | 21 MB | 23% |
| `ticket_transfers` | 5.754 | 2752 kB | 3% |
| `held_orders` | 3.900 | 2736 kB | 3% |
| `refunds` | 5.577 | 2680 kB | 3% |
| `external_refunds` | 4.026 | 2576 kB | 3% |
| `held_order_events` | 3.626 | 1472 kB | 2% |
| `auth_events` | 4.577 | 1456 kB | 2% |
| `refund_reason_classifications` | 5.574 | 1440 kB | 2% |
| `ticket_takeover_requests` | 2.370 | 1184 kB | 1% |

O banco inteiro tem **90 MB** em `public`. Isso é pequeno: cabe folgado em
memória de um `t4g.micro` (1 GB). O problema de desempenho de hoje **não é volume**, é
ausência de índice sobre o cast de `service_date` e derivação de estado no cliente.

---

## 11. Divergências entre o banco real e `supabase/migrations/`

Esta é a seção pela qual a trilha existe.

### 11.0 Resumo

| # | Divergência | Gravidade |
|---|---|---|
| 11.1 | 8 colunas convertidas de `uuid`/`timestamptz`/`date` para `text` sem nenhuma migration | **crítica** |
| 11.2 | `created_at` de `services`/`refunds`/`goals`/`products`/`profiles` virou `timestamp` **sem** fuso | **alta** |
| 11.3 | `profiles.id` perdeu a FK para `auth.users` e ganhou default próprio | **alta** |
| 11.4 | trigger de rollup: suspeita **não confirmada** — está viva e atualizada hoje | resolvida |
| 11.5 | dois enums de role; o das migrations é o órfão | média |
| 11.6 | policy `"Require authentication"` em `profiles`: **não existe mais** | resolvida |
| 11.7 | 33 arquivos locais nunca registrados; 3 versões registradas sem arquivo; 42 pares com versão divergente | **alta** |
| 11.8 | `20260724110939` (índices do incidente): efeito aplicado, registro ausente | média |
| 11.9 | 3 pares de migration com timestamp duplicado | média |
| 11.7(d) | 4 objetos em produção **sem fonte em migration nenhuma**, incl. `external_refunds` (4.026 linhas) e `normalize_order_number` | **alta** |

### 11.1 A conversão de tipo que não está em migration nenhuma

Busca exaustiva em todos os 153 arquivos:

```bash
grep -rniE "alter[[:space:]]+(table|column).*(type|using)" supabase/migrations/ \
  | grep -viE "add constraint|drop constraint|add column|set (default|not null)|drop default|drop not null"
# (nenhum resultado)
```

**Zero `ALTER ... TYPE` no repositório.** E no entanto:

| Tabela.coluna | Migration que criou | Tipo declarado | Tipo real hoje |
|---|---|---|---|
| `services.id` | `20260115171248` | `uuid` PK `gen_random_uuid()` | **`text`** PK `gen_random_uuid()::text` |
| `services.user_id` | `20260115171248` | `uuid` → `profiles(id)` | **`text`** → `profiles(id)` |
| `services.service_date` | `20260115171248` | `timestamptz NOT NULL` | **`text`** NOT NULL |
| `services.created_at` | `20260115171248` | `timestamptz DEFAULT now()` | **`timestamp`** (sem fuso) `DEFAULT CURRENT_TIMESTAMP` |
| `refunds.id` | `20260123050459` | `uuid` PK | **`text`** PK |
| `refunds.user_id` | `20260123050459` | `uuid` → `profiles(id)` | **`text`** → `profiles(id)` |
| `refunds.request_date` | `20260123050459` | `date NOT NULL` | **`text`** NOT NULL |
| `refunds.completion_date` | `20260123050459` | `date NULL` | **`text`** NULL |
| `refunds.created_at` | `20260123050459` | `timestamptz NOT NULL now()` | **`timestamp`** (sem fuso) |
| `refunds.reason` | `20260123050459` | `text NOT NULL` | `text` **NULL** |
| `refunds.refund_type` | `20260123050459` | `text NOT NULL` | `text` **NULL** |
| `profiles.id` | `20260115171248` | `uuid` PK → `auth.users(id)` | **`text`** PK, **sem FK** |
| `profiles.role` | `20260115171248` | `public.app_role` | **`public."AppRole"`** |
| `agent_daily_service_counts.user_id` | `20260131001710` | `uuid` | **`text`** |
| `agent_daily_service_counts.day` | `20260131001710` | `date` | **`text`** |

**Datação da conversão.** É possível cercá-la sem acesso a log:

- `agent_daily_service_counts` nasceu em **31/01/2026** com `user_id uuid, day date`.
- `service_follow_ups` nasceu em **26/03/2026** (`20260326140000`) já com
  `service_id text REFERENCES public.services(id)` e `user_id text`, e já usando
  `auth.uid()::text` nas policies. Uma FK `text → uuid` não é aceita pelo Postgres, logo
  **`services.id` já era `text` em 26/03/2026**.
- Entre essas duas datas o repositório tem 17 migrations
  (`20260220145500` … `20260325130000`) e **nenhuma** delas altera tipo.

**Conclusão: a conversão foi feita fora do repositório, entre 31/01/2026 e 26/03/2026**, pelo
dashboard ou pelo Lovable, sem deixar rastro versionado. A partir de `20260326140000` o
repositório passa a *assumir* `text` como se sempre tivesse sido — é a assinatura de um
schema que foi reescrito por baixo e depois normalizado na narrativa.

**Hipótese do que aconteceu.** O padrão (`id uuid` → `text` com default
`gen_random_uuid()::text`, FK para `auth.users` removida, `timestamptz` → `text` no formato
`YYYY-MM-DDT00:00:00-03:00`, `timestamptz` → `timestamp` em `created_at`) é consistente com
uma reconstrução de tabela por ferramenta de UI: cria tabela nova com os tipos "simples" que
a ferramenta escolhe, copia o dado, renomeia. Isso explica ao mesmo tempo a perda da FK
(`auth.users` está em outro schema e a ferramenta não recria), a perda do fuso em `created_at`
(`timestamp` é o default de muitas ferramentas) e o formato textual literal de `service_date`.

### 11.2 `created_at` sem fuso

Cinco tabelas têm `created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP`:
`services`, `refunds`, `goals`, `products`, `profiles`. As tabelas criadas depois da conversão
(`agent_notes`, `radar_items`, `held_orders`, `lya_*`, `ticket_*`, `support_*`) têm
`timestamptz DEFAULT now()`.

`CURRENT_TIMESTAMP` gravado em `timestamp` guarda o horário na `TimeZone` da sessão. Sessões
do PostgREST rodam em **UTC**, então os valores são de fato UTC — mas **nada no tipo diz
isso**. Qualquer leitor que interprete `services.created_at` como hora local erra em 3 horas.
A trilha de backend precisa saber: **`created_at` dessas cinco tabelas é UTC por convenção,
não por tipo**, e a conversão para `timestamptz` no modelo novo é
`created_at AT TIME ZONE 'UTC'`, não um cast simples.

Ponto de atenção: `services.created_at` é o que `idx_services_user_id_created_at` ordena e o
que "Meus Atendimentos" usa como ordem. `service_date` é o dia de negócio. **Os dois divergem**
sempre que houve correção manual de data — ver `31`.

### 11.3 `profiles` desligada de `auth.users`

Migration: `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`.
Realidade: `id text PRIMARY KEY DEFAULT (gen_random_uuid())::text`, **sem FK**.

Duas consequências sérias:

1. **Nada garante que exista um usuário de auth para cada perfil, nem o contrário.** O
   `ON DELETE CASCADE` que limpava perfis ao apagar o usuário não existe mais; a limpeza
   virou responsabilidade da RPC `manager_delete_auth_user`.
2. **O default é ativo.** Um `INSERT INTO profiles` sem `id` gera um uuid novo que não
   corresponde a nenhum `auth.users.id`, e esse perfil nunca casará com `auth.uid()`. Todas
   as policies comparam `id = auth.uid()::text`, então o perfil existiria e seria invisível
   para o próprio dono. Isso é uma armadilha de operação, e é medida em `31`.

O código todo depende de `profiles.id` ser **textualmente igual** a `auth.users.id`. É uma
invariante real do sistema que **nenhuma constraint sustenta**.

### 11.4 O rollup diário: a suspeita não se confirma

A hipótese era: `refresh_agent_daily_service_count(uuid, date)` teria assinatura incompatível
com as colunas `text` de hoje, e `agent_daily_service_counts` estaria estagnada.

**Os dois objetos existem**, a trigger está habilitada, e **ambos foram consertados para
`text`** depois da conversão:

```sql
-- refresh_agent_daily_service_count(p_user_id uuid, p_day date)
DECLARE v_count int; v_uid text := p_user_id::text;   -- converte na entrada
  SELECT COUNT(*) INTO v_count FROM public.services s
   WHERE s.user_id = v_uid
     AND (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = p_day;
  INSERT INTO public.agent_daily_service_counts (user_id, day, service_count, updated_at)
  VALUES (v_uid, p_day::text, COALESCE(v_count,0), now())   -- e na saída
  ON CONFLICT (user_id, day) DO UPDATE SET ...

-- trg_services_refresh_agent_daily_counts()
new_day := (NEW.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date;
PERFORM public.refresh_agent_daily_service_count(NEW.user_id::uuid, new_day);
```

Ou seja: a assinatura ficou `uuid`/`date`, e a compatibilidade foi obtida com
`NEW.user_id::uuid` na chamada e `p_user_id::text` / `p_day::text` no corpo. Feio, mas
funcional.

**Prova de que está vivo** (esta é a única leitura de tabela de negócio deste documento;
1.949 linhas, sem agregação sobre `services`):

```sql
SELECT max(updated_at), min(updated_at), count(*),
       max(day), min(day),
       count(*) FILTER (WHERE updated_at > now() - interval '7 days')  AS touched_7d,
       count(*) FILTER (WHERE updated_at > now() - interval '1 day')   AS touched_1d
FROM agent_daily_service_counts;
```

| max(updated_at) | min(updated_at) | linhas | max(day) | min(day) | 7d | 1d |
|---|---|---|---|---|---|---|
| **2026-09-26 12:30:25** | 2026-01-31 00:17:08 | 1.949 | `2026-09-26` | **`1997-04-28`** | 200 | 57 |

Atualizada **hoje**, 57 linhas tocadas nas últimas 24 h. A tabela derivada está correta e em
uso. **Registro a suspeita como refutada.**

Mas o levantamento produziu um achado que a suspeita não previa: **`min(day) = '1997-04-28'`**.
Como `day` é `text`, o mínimo é lexicográfico e portanto real: existe pelo menos um ticket cujo
`service_date` cai em 1997. Isso só pode ter vindo de backfill com a trigger desabilitada ou
de correção manual de data. Quantificado em `31`.

Há ainda uma fragilidade latente: `NEW.user_id::uuid` **estoura** se algum `profiles.id` não
for um uuid textualmente válido. Nesse caso o `INSERT` em `services` falha inteiro. Medido em
`31`.

### 11.5 Dois enums de role

A migration inicial criou `CREATE TYPE public.app_role AS ENUM ('agent','manager')` e
`profiles.role public.app_role`. Hoje `profiles.role` é `public."AppRole"`, e `app_role`
existe com **0 colunas usando**.

Só 3 migrations mencionam `"AppRole"` — `20260817120000_add_copy_grup_role.sql`,
`20260817200000_copy_refund_reason_analytics.sql`, `20260915120000_add_produto_role.sql` —
todas de agosto/setembro, muito depois da troca. Ou seja: **a criação de `"AppRole"` e a
migração da coluna para ele também aconteceram fora do repositório**; o repositório só
aprendeu o nome novo quando precisou acrescentar labels.

Os dois enums têm hoje os mesmos 4 labels (`agent, manager, copy_grup, produto`), o que
significa que alguém manteve os dois em sincronia por um tempo. `has_role(_user_id uuid,
_role "AppRole")` usa o de PascalCase. **Emenda para o schema novo: um enum, nome em
snake_case, sem aspas.**

### 11.6 A policy `"Require authentication"` em `profiles`

**Não existe mais.** `profiles` tem exatamente 4 policies, todas de `SELECT` e todas escopadas:

| Policy | `USING` |
|---|---|
| `Users can view own profile` | `(( SELECT auth.uid()))::text = id` |
| `Managers can view all profiles` | `( SELECT is_manager())` |
| `Cross-agent view all profiles` | `( SELECT can_view_all_tickets())` |
| `Copy team can view all profiles` | `( SELECT is_copy_team())` |

Nenhuma libera SELECT a qualquer autenticado. **Suspeita refutada.**

Porém — e isso anula parte do ganho — a view `lya_agentes` expõe o mesmo conteúdo (menos o
e-mail) **sem nenhuma verificação**, inclusive para `anon`. Ver seção 9. O buraco que a
policy fechava foi reaberto por um caminho diferente.

### 11.7 O registro de migrations não descreve o repositório

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

| | |
|---|---|
| versões registradas no banco | **123** |
| arquivos `.sql` locais | **153** (150 versões distintas) |
| registradas **sem** arquivo local | **45** |
| arquivos locais **não** registrados | **72** |

Cruzando pelo *slug* (o nome depois do timestamp), o quadro fica claro e é muito melhor do que
os números brutos sugerem:

**(a) 42 pares são a mesma migration registrada com outra versão.** Padrão: o arquivo local
tem timestamp arredondado (escrito à mão), e o banco registrou o instante real da aplicação
pelo dashboard/MCP.

| local | banco | slug |
|---|---|---|
| `20260514010000` | `20260514152158` | `create_ticket_transfers` |
| `20260514020000` | `20260514153937` | `create_my_transfer_notifications` |
| `20260514030000` | `20260514160307` | `create_my_transfer_history` |
| `20260520000000` | `20260520173725` | `add_by_platform_to_refund_metrics` |
| `20260520010000` | `20260520200240` | `create_refund_reason_classifications` |
| `20260520020000` | `20260520200442` | `add_by_reason_to_refund_metrics` |
| `20260520030000` | `20260520201303` | `create_dashboard_export_extras` |
| `20260520040000` | `20260520202238` | `user_management_schema` |
| `20260520050000` | `20260520202357` | `user_management_rpcs` |
| `20260521120000` | `20260521172147` | `add_is_supervisor_flag` |
| `20260521120100` | `20260521172255` | `supervisor_profiles_select` |
| `20260522120000` | `20260522154012` | `add_can_register_duplicate_emails_flag` |
| `20260525000000` | `20260525123740` | `create_interaction_events_helper` |
| `20260525000100` | `20260525123806` | `rewrite_dashboard_metrics_one_event_per_interaction` |
| `20260525000200` | `20260525124004` | `rewrite_agent_metrics_one_event_per_interaction` |
| `20260525000300` | `20260525124302` | `freeze_history_triggers` |
| `20260525000400` | `20260525124426` | `manager_correct_service_date_rpc` |
| `20260611000000` | `20260611165749` | `add_alpharock_product` |
| `20260611000100` | `20260611171303` | `add_new_products_june` |
| `20260617000000` | `20260617185026` | `create_held_orders` |
| `20260622000000` | `20260622140227` | `held_orders_returns_format` |
| `20260622000100` | `20260622142103` | `held_orders_optional_order_number` |
| `20260623000000` | `20260623155732` | `held_orders_dedupe_by_source_file` |
| `20260623000100` | `20260623160913` | `held_orders_store_all` |
| `20260625000000` | `20260625162145` | `held_orders_agent_status_and_events` |
| `20260627000000` | `20260627164704` | `held_orders_fix_confirm_and_assign` |
| `20260629000000` | `20260629080136` | `held_orders_assign_count_and_distribute` |
| `20260630120000` | `20260630161126` | `add_dashboard_refund_reason_detail` |
| `20260715120000` | `20260715192824` | `export_agent_services_rpc` |
| `20260716120000` | `20260716144138` | `claim_ticket_rpc` |
| `20260716130000` | `20260716170908` | `can_claim_tickets_permission` |
| `20260716140000` | `20260716192713` | `add_new_products_july` |
| `20260717120000` | `20260717144108` | `agent_availability` |
| `20260717120500` | `20260717144208` | `ticket_takeover_requests` |
| `20260725120000` | `20260725153940` | `my_follow_ups_rpc` |
| `20260727120000` | `20260727103626` | `rls_initplan_optimization` |
| `20260727120100` | `20260727103635` | `autovacuum_hot_small_tables` |
| `20260727140000` | `20260727124718` | `mark_same_day_repeat_follow_ups` |
| `20260727150000` | `20260727204027` | `channel_detail_one_event_per_interaction` |
| `20260728120000` | `20260728160728` | `manager_complete_refund_rpc` |
| `20260729120000` | `20260729195537` | `add_honeyfil_product` |
| `20260729120000` | `20260729134722` | `held_orders_pending_tag` |

Note as duas anomalias de ordem dentro desses pares: `rls_initplan_optimization` e
`autovacuum_hot_small_tables` foram **aplicadas às 10:36** e o arquivo local diz `120000`
(12:00); `channel_detail_one_event_per_interaction` foi aplicada às **20:40** e o arquivo diz
`150000`. Ou seja, **a ordem local não reproduz a ordem de aplicação**. Reexecutar o
repositório do zero contra um banco limpo produziria uma sequência diferente da que gerou o
banco atual. Para migrations idempotentes de RPC isso é inócuo; para as que dependem de
estado anterior, não é.

**(b) 33 arquivos locais cujo slug não existe no registro** — nunca foram registrados sob
nenhum nome:

| versão local | slug |
|---|---|
| `20260513000000` | `add_cognivex_naddermal_products` |
| `20260514000000` | `create_find_ticket_by_email` |
| `20260521130000` | `rename_is_supervisor_to_can_view_all_tickets` |
| `20260724110939` | `perf_indexes_incident_overload` |
| `20260803120000` | `channel_detail_agent_filter_and_export_tz` |
| `20260804120000` | `add_clear_gaze_product` |
| `20260805120000` | `held_orders_no_open_duplicates` |
| `20260806120000` | `held_orders_dedupe_by_order_number` |
| `20260806130000` | `held_orders_open_duplicates_supersede` |
| `20260806140000` | `held_orders_one_agent_per_client` |
| `20260806150000` | `services_sync_refund` |
| `20260810120000` | `status_summary_mesmo_universo_do_grafico` |
| `20260810160000` | `follow_up_detail_one_event_per_interaction` |
| `20260810170000` | `held_orders_manager_em_andamento` |
| `20260817120000` | `add_copy_grup_role` |
| `20260817140000` | `agent_my_metrics_ritmo_por_dia_trabalhado` |
| `20260817180000` | `base_suporte` |
| `20260817200000` | `copy_refund_reason_analytics` |
| `20260818140000` | `contact_reason_outro_note` |
| `20260824120000` | `areas_gestora_e_copy` |
| `20260825120000` | `radar_pendencias` |
| `20260826120000` | `agent_notepad` |
| `20260826140000` | `add_jellyrock_pagamerican_products` |
| `20260827120000` | `refund_audit_mesma_regra_de_data_das_metricas` |
| `20260828120000` | `contact_reason_note_vsl` |
| `20260828120000` | `copy_evidencia_percentual_no_produto` |
| `20260828160000` | `copy_valores_em_dolar` |
| `20260902120000` | `copy_valor_ja_em_dolar` |
| `20260904120000` | `dashboard_audit_uma_linha_por_interacao` |
| `20260904120000` | `refund_channel_efficiency_percentuais` |
| `20260907120000` | `lya_agente_ia` |
| `20260908120000` | `lya_seed_cerebro` |
| `20260915120000` | `add_produto_role` |

**Não registrado não quer dizer não aplicado.** O catálogo prova que a maioria *está* em
produção — `radar_items`, `agent_notes`, `support_products`, `lya_*`, `services.order_id`,
`contact_reason_note`, `held_orders.pending_tag`, o enum com `produto`, todos existem. Ou seja
essas migrations foram aplicadas por dashboard/MCP/Management API **sem passar pelo runner**,
que é o único que grava em `schema_migrations`.

O registro para em **`20260729195537`**. De 29/07/2026 em diante, **nada mais foi registrado**:
dois meses de mudanças (agosto e setembro — Base de Suporte, áreas por role, radar, caderno,
Lya, área de produtos) existem no banco e não existem no registro.

Verificação individual pendente, porque só o catálogo não decide: `add_cognivex_naddermal_products`,
`add_clear_gaze_product`, `add_jellyrock_pagamerican_products` — os produtos estão no `CHECK`
de `services.product`, então foram aplicadas. `rename_is_supervisor_to_can_view_all_tickets` —
a coluna real é `can_view_all_tickets` e não existe `is_supervisor`, então foi aplicada.

**(c) 3 versões registradas sem nenhum arquivo local, nem por slug:**

| versão | nome | existe no banco? |
|---|---|---|
| `20260716153250` | `claim_ticket_rpc_fix_ambiguous_id` | sim — `claim_ticket(p_service_id text)` existe |
| `20260727124851` | `dashboard_same_day_repeats_rpc` | sim — `dashboard_same_day_repeats(...)` existe |
| `20260727230336` | `create_claude_skills_leads` | sim — tabela `claude_skills_leads` existe |

Essas três foram escritas direto em produção e **nunca voltaram para o repositório**. São
perda real de fonte: o corpo atual pode ser recuperado com `pg_get_functiondef`, mas a
intenção e o comentário não.

**(d) Quatro objetos existem em produção e não aparecem em migration nenhuma** — nem
registrada, nem local. É categoria pior que "não registrado": é **sem fonte**.

```bash
for obj in lya_files lya_file_rows external_refunds normalize_order_number; do
  echo "$obj: $(grep -rl "$obj" supabase/migrations/ | wc -l) arquivo(s)"
done
# todos: 0 arquivo(s)
```

| Objeto | O que é | Peso |
|---|---|---|
| `external_refunds` | tabela, 28 colunas, chave natural, 4 índices | **4.026 linhas, 2.576 kB** |
| `normalize_order_number(text)` | função `IMMUTABLE` | usada por **1 coluna gerada e 2 índices** |
| `lya_files` | tabela, 15 colunas, 4 `CHECK` | — |
| `lya_file_rows` | tabela com índice GIN `jsonb_path_ops` | — |

`normalize_order_number` é o caso mais grave em proporção: `external_refunds.order_number` é
uma **coluna gerada** que a invoca, e `idx_refunds_product_order_number` é um índice de
expressão sobre ela. Perder a definição dessa função significa não conseguir recriar nem a
coluna nem o índice — e ela não está em lugar nenhum do repositório. O corpo é recuperável com
`pg_get_functiondef`, e **deveria ser recuperado agora**, não quando alguém precisar.

Isso também explica por que `20260907120000_lya_agente_ia.sql` menciona `lya_memories` e
`lya_chats` (que têm fonte) mas não `lya_files`/`lya_file_rows`: a feature de arquivos da Lya
foi inteira para produção por dashboard/MCP.

`supabase migration list --linked` (leitura, seguro) reproduz o cruzamento das letras (a)–(c)
lado a lado e é o comando recomendado para reconferir antes de qualquer decisão. Ele **não**
detecta a letra (d), porque objeto sem migration não aparece em comparação de migrations —
só em comparação de catálogo. Ver `90-BACKLOG.md` B15.

### 11.8 A migration de índices do incidente de 24/07

`20260724110939_perf_indexes_incident_overload.sql` **não está registrada** — mas os quatro
índices que ela define **existem em produção**:

| Índice da migration | Existe? | Definição real |
|---|---|---|
| `idx_services_user_id_created_at` | **sim** | `btree (user_id, created_at DESC)` |
| `idx_services_lower_trim_email` | **sim** | `btree (lower(TRIM(BOTH FROM client_email)))` |
| `idx_service_follow_ups_user_followup` | **sim** | `btree (user_id, follow_up_number)` |
| `idx_refunds_user_id` | **sim** | `btree (user_id)` |

E o próprio arquivo explica por quê, no comentário: *"Já aplicados em produção em 2026-07-24
via `CREATE INDEX CONCURRENTLY` (fora de transação, sem lock de escrita)"*. O arquivo foi
escrito **depois** da correção, para documentar o que já se tinha feito à mão, e por isso
nunca passou pelo runner.

**Resposta: o efeito está aplicado; o registro não.** Nenhuma ação de dado é necessária. O que
falta é registro, e isso é escrita.

Dois índices da migration original de `refunds` (`20260123050459`), por outro lado,
**desapareceram**: `idx_refunds_user_request_date` e `idx_refunds_user_completion_date` não
estão em `pg_indexes`. Foram derrubados fora do repositório. Hoje `refunds` tem só
`idx_refunds_user_id`, e nenhuma ordenação por `request_date` é indexada — o que casa com
`my_refunds_with_refunded_value()` terminando em `ORDER BY r.request_date DESC` sobre uma
coluna `text` sem índice.

### 11.9 Pares de migration com timestamp duplicado

São **três**, não dois:

| versão | arquivos |
|---|---|
| `20260729120000` | `add_honeyfil_product.sql` · `held_orders_pending_tag.sql` |
| `20260828120000` | `contact_reason_note_vsl.sql` · `copy_evidencia_percentual_no_produto.sql` |
| `20260904120000` | `dashboard_audit_uma_linha_por_interacao.sql` · `refund_channel_efficiency_percentuais.sql` |

O primeiro par é o mais interessante porque **ambos os lados estão registrados no banco, com
versões distintas e em ordem invertida**: `held_orders_pending_tag` às 13:47 e
`add_honeyfil_product` às 19:55. O arquivo local os declara empatados, então a ordem relativa
deles é indefinida no repositório.

O runner do Supabase ordena por versão e aplica uma vez por versão. Com dois arquivos na mesma
versão o comportamento não é definido pela convenção: dependendo da implementação, um dos dois
é silenciosamente ignorado. Os três pares tratam de objetos disjuntos (produto vs. held_orders;
CHECK de nota vs. RPC de copy; RPC de auditoria vs. RPC de reembolso), então nenhum depende do
outro. O risco é de reexecução futura, não de estado atual. Tratamento proposto em `32`.

### 11.10 Outras divergências menores, registradas para não se perderem

- **Nomes de policy trocados sem migration.** `agent_daily_service_counts` nasceu com
  `"Agents view own daily service counts"` e `"Managers view all daily service counts"`; hoje
  são `"Users view own counts"` e `"Managers view all counts"`. Renomeação feita fora do repo.
- **Policies originais de `profiles` com subconsulta a `profiles`.** A migration inicial
  escreveu `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'manager')`
  — recursão sobre a própria tabela. Hoje é `( SELECT is_manager())`, função `SECURITY
  DEFINER`. A troca foi feita fora do repo e é a correta.
- **`refunds.reason` e `refunds.refund_type` deixaram de ser `NOT NULL`.** Sem migration.
  Importa para `31`: há reembolsos sem motivo e sem tipo.
- **`external_refunds.order_number` é coluna gerada** (`normalize_order_number(order_name)`).
  Nenhuma outra tabela usa coluna gerada; é um recurso usado uma única vez.
- **`held_orders.duplicate_of`, `assign_count`, `pending_tag`** existem e vêm de migrations
  não registradas (`held_orders_open_duplicates_supersede`, `..._assign_count_...`,
  `..._pending_tag`).
- **`user_roles` é vestígio.** Criada no modelo original de roles, hoje sem policy e sem uso.
  A autoridade de role é `profiles.role`.

---

## Lacunas

Estado em 26/09/2026, depois de `00-CONTRATO.md` §8-A.

### Fechadas

| # | Lacuna | Como fechou |
|---|---|---|
| 1 | alvo de `service_date` | **`date`.** Emenda 1 acatada; `12-backend-schema-alvo.md` §3.1 usa `business_day date` |
| 2 | `id` preserva valor ou é reemitido | **preserva.** Emenda 3 acatada |
| 6 | destino de `lya_*`, `claude_skills_leads`, `external_refunds` | `12-backend-schema-alvo.md` §6.9 e §6 cobrem; `external_refunds` continua, e a **falta de fonte** dela virou B15 |
| 7 | postura de `GRANT` para `anon`/`authenticated` | contrato **D2**: proteção por linha ligada em toda tabela nova, policy como rede e não como filtro; o privilégio herdado fica em `90-BACKLOG.md` B3 |

### Abertas

1. **Onde vive `migration_rejects`.** No banco novo (auditável por SQL, sujeito a RLS) ou
   fora dele. O contrato não trata de artefato de migração. `12-backend-schema-alvo.md` §5.4 o
   coloca no banco novo, o que resolve metade — falta dizer **quem pode lê-lo**: o `payload`
   carrega dado de cliente, então a tabela precisa de policy e não pode nascer aberta.

2. **Quando o dado ambíguo é decidido.** Antes do backfill (bloqueante) ou depois (rejeito
   revisável). Proponho depois, e as 133 linhas previstas de rejeito
   (`32-banco-migracao.md` §6.1) cabem nessa forma. Falta confirmar.

3. **Se o corte admite janela de indisponibilidade**, e de quanto. Dimensiona se o backfill é
   uma passada única ou precisa de captura de delta. Estimativa de 15–30 min em
   `32-banco-migracao.md` §9.

4. **Quem aprova a reconciliação, e com que amostra.** `STATUS_DIVERGENCE` tem ~10 mil linhas;
   ninguém revisa isso à mão. Ver `32-banco-migracao.md` §6.2.

5. **Prazo de retenção do schema legado depois da virada.** Proponho 30 dias
   (`32-banco-migracao.md` §10.1). É o que separa "voltar atrás custa caro" de "voltar atrás é
   impossível".

Os itens de qualidade de dado que o dono optou por adiar não são lacunas: estão decididos como
adiados, em `90-BACKLOG.md` B4–B14.

---

## Propostas de emenda

### Emenda 1 — `service_date` deve ser `date` · **DECIDIDA — acatada**

> Decidida em 26/09/2026. O alvo é `date`. `12-backend-schema-alvo.md` §3.1 adota como
> `business_day date NOT NULL`, com a conversão via `timestamptz AT TIME ZONE
> 'America/Sao_Paulo'` e `legacy_service_date text` para prova. A regra de conversão e a
> armadilha que ela evita estão em `32-banco-migracao.md` §3.1.1.

O documento de arquitetura propõe `service_date` como `date` puro. Eu concordo, e discordo de
quem usaria a correção manual como objeção.

O que o banco mostra:

- A trigger `trg_service_pin_date_on_insert` **descarta** qualquer instante enviado e grava
  `'YYYY-MM-DDT00:00:00-03:00'`. Todo valor produzido pelo fluxo normal tem hora zero.
- `manager_correct_service_date(p_service_id text, p_new_date **date**, p_reason text)` já
  recebe **`date`**. A gestora nunca escolheu hora; escolhe dia.
- `service_date_corrections` guarda `previous_date text` e `new_date text`, ou seja a
  auditoria já é textual e já é por dia.
- O instante real do registro **não se perde**: está em `services.created_at`, que é outra
  coluna e continua existindo.

Portanto `date` não perde informação: perde um zero literal e um offset constante. E ganha o
que hoje falta: **um índice possível**. Hoje toda métrica faz
`(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`, expressão não indexada
sobre 102 mil linhas, em cada consulta de cada dashboard. Com `date`, `BETWEEN` usa índice.

Proposta concreta: `business_date date NOT NULL` (dia de negócio em São Paulo) + manter
`created_at timestamptz NOT NULL` (instante real, UTC). Dois campos, dois significados,
nenhum dos dois ambíguo. E a correção da gestora passa a ser um `UPDATE` de `date` com
registro em tabela de auditoria — exatamente o que já é, sem o cast.

### Emenda 2 — `agent_daily_service_counts` como testemunha de reconciliação · **DECIDIDA — acatada**

> Decidida em 26/09/2026 (`90-BACKLOG.md` B22): a tabela **não é migrada e não é removida**.
> Serve de conferência independente na reconciliação — verificação R8 de
> `32-banco-migracao.md` §8, a única da suíte que pode acusar divergência legitimamente.

Diferente das outras tabelas, ela **não contém dado original**: é 100% derivada de `services`,
recalculável a qualquer momento por `COUNT(*)` agrupado. Preservá-la seria migrar um cache.

Mas ela tem um valor que se perde se for simplesmente descartada: **é a única testemunha
independente da contagem histórica**. Se o `daily_rollups` novo divergir dela, a divergência é
informação — pode ser bug do backfill, ou pode ser que a tabela velha esteja errada em algum
dia (ela foi mantida por trigger durante uma conversão de tipo).

Proposta: **não migrar** a tabela; **copiá-la para `migration_checks`** como linha de
comparação, rodar o novo `daily_rollups` a partir de `services`, comparar dia a dia, e
registrar cada divergência como item auditável. Depois de aprovada a reconciliação, a cópia
vira histórico e a tabela original morre com o schema legado. Isso preserva o valor probatório
sem carregar o cache.

Observação que reforça: `min(day) = '1997-04-28'` prova que a tabela reflete fielmente um dado
absurdo em `services`. Ela é bom espelho, não boa fonte.

### Emenda 3 — a conversão de id preserva o valor, e `legacy_id` existe de todo modo · **DECIDIDA — acatada**

> Decidida em 26/09/2026. Nenhum uuid é reemitido: `id::uuid` sobre os 168.905 ids medidos,
> todos válidos. `legacy_id text NOT NULL UNIQUE` em toda tabela migrada, e é por ele que a
> suíte de reconciliação faz `JOIN` (R1 e R2 de `32-banco-migracao.md` §8).

Discordo de qualquer opção que gere uuid novo. Razões medidas:

1. Os ids atuais **já são uuid em formato texto** (quantificado em `31`). Converter é
   `id::uuid`, uma operação sem perda e sem colisão.
2. **Há referências externas ao valor.** `refunds.service_id`, `service_follow_ups.service_id`,
   `ticket_transfers.service_id`, `ticket_takeover_requests.service_id`,
   `service_date_corrections.service_id`, `refund_manager_completions.refund_id`,
   `refund_reason_classifications.refund_id` — sete FKs sobre esses valores. Reemitir exige
   reescrever todas, e qualquer falha silenciosa é dado cruzado errado.
3. **Há referências fora do banco**: exportações de planilha já entregues, links, e os
   relatórios que a gestora guardou. Reemitir invalida tudo isso sem aviso.

Proposta: `id uuid PRIMARY KEY` recebendo `legacy_id::uuid`; **e ainda assim** uma coluna
`legacy_id text NOT NULL UNIQUE` em toda tabela migrada, com o valor textual exato de origem.
Parece redundante quando o texto é um uuid válido — e é, para as linhas limpas. Serve para as
outras: qualquer linha cujo `id` textual **não** seja uuid válido precisa de um `id` novo, e
`legacy_id` é o que permite reencontrá-la. Sem ele, essas linhas viram órfãs sem rastro. O
custo é uma coluna de texto e um índice único; o benefício é reversibilidade.

### Emenda 4 — correção de segurança pronta antes do corte · **ACATADA E EXECUTADA**

> O dono executou a opção mínima em 26/09/2026: `REVOKE ALL ON public.lya_agentes FROM anon,
> authenticated`. Verificado por catálogo na seção 9 deste documento. A causa estrutural (view
> sem `security_invoker`) permanece e está em `90-BACKLOG.md` B1; `lya_exec_sql` segue em B2.

Não é competência da trilha de dados decidir, mas é competência dela apontar: a view
`lya_agentes` expõe o quadro de pessoal a `anon`. O contrato proíbe escrita nesta fase, e eu
não proponho violar isso. Proponho que o SQL de correção seja escrito e deixado em
`docs/arquitetura-v2/sql/` para o dono executar **quando ele decidir**, em vez de esperar o
corte da v2 — porque a v2 tem prazo e essa exposição é de hoje. O SQL está em
`docs/arquitetura-v2/sql/30-correcao-lya-agentes.sql`.

### Emenda 5 — o contrato deve proibir DDL fora do runner · **ACATADA — texto redigido abaixo**

O contrato §0 congela `supabase/migrations/`. Isso é necessário e insuficiente: **foi
exatamente por fora do repositório que o schema divergiu**. 33 arquivos nunca registrados,
3 migrations que só existem no banco, e uma conversão de tipo inteira sem rastro são o
resultado de uma regra que proibia tocar o repo mas não proibia tocar o banco.

O levantamento acrescentou, depois da primeira redação desta emenda, um argumento mais forte
do que os 33 arquivos não registrados: **quatro objetos rodam em produção sem fonte em
migration nenhuma** (seção 11.7(d)), um deles com 4.026 linhas e outro sendo uma função da qual
dependem uma coluna gerada e um índice de expressão. Não é dívida de registro — é código de
produção que não existe em lugar nenhum fora do banco.

Texto redigido para entrar no contrato (o coordenador insere):

> ### Toda mudança de schema entra por migration versionada
>
> Nenhuma alteração de estrutura pode ser aplicada por dashboard, MCP, Management API ou
> conexão direta. Isso vale para `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, policy, índice,
> trigger, função e tipo — em qualquer schema do projeto.
>
> A regra é: **o arquivo de migration vem primeiro, e é o runner que aplica.** Um objeto que
> existe no banco e não existe em `migration/` é um incidente, não um atalho.
>
> Três consequências operacionais:
>
> 1. **Emergência não abre exceção, abre prazo.** Se uma correção urgente for aplicada à mão,
>    a migration correspondente é escrita e registrada **no mesmo dia**, e a reconciliação é
>    pré-requisito do próximo deploy. Urgência justifica inverter a ordem; nunca omitir o
>    arquivo.
> 2. **Todo deploy confere.** Um passo automatizado compara o catálogo do banco com o que as
>    migrations descrevem — tabelas, colunas e tipos, no mínimo — e falha quando divergem. A
>    divergência de hoje sobreviveu dois anos porque ninguém a media; medir é o que impede a
>    repetição.
> 3. **`supabase db push` continua proibido neste repositório**, e a proibição vale também
>    para o schema novo. O registro de migrations do legado não descreve o legado
>    (`30-banco-estado-real.md` §11.7), e por isso `push` reaplicaria dezenas de arquivos.
>
> O que motivou a regra, medido em 26/09/2026: 15 colunas mudaram de tipo sem nenhum
> `ALTER ... TYPE` em 153 migrations; 33 arquivos locais nunca foram registrados; 3 migrations
> existem só no banco; e 4 objetos de produção não têm fonte em lugar nenhum.

Sem isso, o modelo novo divergirá do mesmo jeito, e em dois anos alguém escreverá este
documento de novo.
