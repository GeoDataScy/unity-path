# 32 — Travessia: backfill, rejeitos, reconciliação e volta atrás

> Trilha de **dados**. `30` diz como o banco **é**; `31` diz o que ele **contém**; este
> documento diz como se vai de lá para o modelo novo **sem perder linha nem inventar dado**.
>
> Escrito para ser executado por outra pessoa. Cada etapa tem pré-condição, SQL, critério de
> aprovação e procedimento de volta atrás. Onde eu não tenho autoridade para decidir, está
> escrito "**decisão humana**" e a etapa **bloqueia**.
>
> Nada aqui foi executado. Esta fase é de especificação (`00-CONTRATO.md` §0) e o banco
> continua congelado para escrita.
>
> **Reconciliado em 26/09/2026 com `00-CONTRATO.md` §8-A.** As decisões D4, D5, D6 e D7 mudaram
> regras deste documento e estão aplicadas: a conversão de `platform` e de e-mail ficou
> **literal** (§3.1), `refund_value` é dólar (§3.3), e a paginação numerada exigiu um índice que
> faltava (§7.4). A ordem canônica de interação foi **corrigida** contra o código legado
> (§5.1). D1 (fim do bloqueio das 18h) não afeta o backfill: nenhuma regra aqui dependia do
> bloqueio, e a marcação `is_same_day_repeat` — que é o que as métricas usam — continua.

---

## 1. Premissas

Estas são as condições sem as quais o plano não vale. Se alguma mudar, o plano muda.

| # | Premissa | Fonte |
|---|---|---|
| P1 | Todo `id`/`user_id`/`service_id` `text` é uuid textualmente válido | `31` §3.2 — 0 exceções em 168.905 valores |
| P2 | `service_date` tem exatamente 2 formatos, e a conversão correta é via `timestamptz` | `31` §3.1 |
| P3 | `request_date` e `completion_date` são 100% ISO `YYYY-MM-DD` | `31` §3.3 |
| P4 | Não há órfão referencial em nenhuma direção | `31` §4.7 |
| P5 | Existem 2 perfis **sem** `auth.users`, donos de 5.665 tickets | `31` §4.8 |
| P6 | `public` inteiro tem ~90 MB; `services` 50 MB e `service_follow_ups` 21 MB | `30` §1 |
| P7 | O compute é `t4g.micro` (2 vCPU burstable, 1 GB RAM) e já caiu por CPU em 24/07/2026 | contrato §0 |
| P8 | O dado de negócio nasce em 15/01/2026; follow-up só existe a partir de 26/03/2026 | `31` §1 |

### 1.1 Ponto de corte

O banco recebe **~300 tickets e ~350 follow-ups por dia**. Entre a primeira e a última consulta
do levantamento (19 minutos), `services` cresceu 5 linhas. **Nenhuma reconciliação fecha sem um
instante de corte**, e o contrato não define um.

Proposta, na ordem de preferência:

1. **Corte único com janela de indisponibilidade.** Congela escrita, roda o backfill, reconcilia,
   vira a chave. Dado o volume (seção 9: minutos, não horas), é viável e é de longe o mais
   simples de provar correto.
2. **Corte com delta.** Backfill de tudo até `T0`, aplicação continua escrevendo no legado,
   depois um segundo passe leva o que nasceu entre `T0` e `T1`. Exige que toda tabela tenha
   coluna de tempo monotônica — e `services.created_at` serve, `service_follow_ups.created_at`
   serve, `refunds.created_at` serve. Mais trabalho, sem janela.

**Decisão humana** (lacuna 1 de `31`). O restante deste documento assume corte único; onde a
opção 2 muda algo, está marcado.

---

## 2. Ordem de execução

Cada etapa só começa quando a anterior foi **aprovada** pelo critério da seção 8.

```
 E0  Congelar e medir            (leitura)      ── sem volta atrás necessária
 E1  Criar schema novo vazio     (DDL)          ── DROP SCHEMA reverte
 E2  Migrar dimensões            (profiles, products)
 E3  Migrar tickets              (services → tickets)
 E4  Migrar interações           (service_follow_ups → interactions)
 E5  Derivar status do ticket    (dentro de tickets)
 E6  Migrar reembolsos           (refunds + classificações + completions)
 E7  Migrar satélites            (transfers, takeovers, radar, notes, held_orders, …)
 E8  Construir interaction_facts (derivado de E3+E4)
 E9  Construir daily_rollups     (derivado de E8)
 E10 Reconciliar                 (leitura)      ── porta de aprovação
 E11 Virar a chave               (aplicação)    ── IRREVERSÍVEL na prática
```

### Pré-condições, uma a uma

| Etapa | Pressupõe | Produz |
|---|---|---|
| **E0** | backup concluído e **verificado restaurável** | `migration_baseline`: os números de controle de `31` num instante `T0` |
| **E1** | E0 aprovada; schema alvo definido por `12-backend-schema-alvo.md` | tabelas vazias + `migration_rejects` + `migration_checks` |
| **E2** | E1 | `agents` (47, incluindo os 2 sem `auth.users`), `products` |
| **E3** | E2 (FK de agente) | `tickets` (102.7 mil) com `legacy_id` |
| **E4** | E3 (FK de ticket) | `interactions` (59.7 mil) com `seq` renumerado |
| **E5** | E4 | `tickets.status` derivado |
| **E6** | E2 + E3 (FK opcional de ticket) | `refunds` |
| **E7** | E3 + E6 | satélites |
| **E8** | E3 + E4 | `interaction_facts` |
| **E9** | E8 | `daily_rollups` |
| **E10** | E9 | laudo de reconciliação |
| **E11** | E10 **aprovada por pessoa** | aplicação apontando para o modelo novo |

**E2 antes de E3 não é detalhe.** Os 2 perfis sem `auth.users` (`31` §4.8) precisam existir em
`agents` antes de `tickets`, senão 5.665 tickets falham a FK. Se o schema alvo exigir
`auth.users`, **E2 falha e o plano para** — ver seção 12.

---

## 3. Regra de conversão, coluna a coluna

Notação: `→` é a expressão exata a usar. Onde há exceção medida em `31`, ela está tratada.

### 3.1 `services` → `tickets`

| Coluna legada | Tipo hoje | Coluna alvo | Conversão | Exceções (`31`) |
|---|---|---|---|---|
| `id` | `text` | `id uuid` | `id::uuid` | nenhuma — 102.738/102.738 válidos |
| `id` | `text` | `legacy_id text` | `id` (cópia literal) | sempre preenchido |
| `user_id` | `text` | `created_by uuid` | `user_id::uuid` | nenhuma |
| `current_owner_id` | `text` | `owner_id uuid` | `current_owner_id::uuid` | difere de `created_by` em 4.048 |
| `client_email` | `text` | `client_email text` | **valor literal, intacto** (**D6**) | nunca sobrescrito |
| — | — | `client_email_normalized citext` | **coluna gerada** `lower(btrim(client_email))` (**D6**) | 179 colisões viram o mesmo valor normalizado, de propósito |
| `product` | `text` | `product text` | `CASE WHEN product='Logicall' THEN 'LogiCall' ELSE product END` — não se aplica aqui (é `platform`); em `product` é cópia literal | 75 valores em uso |
| **`service_date`** | **`text`** | **`business_date date`** | **`(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`** | **ver 3.1.1 — crítico** |
| `service_date` | `text` | `legacy_service_date text` | cópia literal | obrigatório para auditoria |
| `status` | `text` | `legacy_status text` | cópia literal | só `registered` / `concluido` |
| — | — | `status` | derivado em **E5** — ver seção 5 | — |
| `created_at` | `timestamp` **sem fuso** | `created_at timestamptz` | **`created_at AT TIME ZONE 'UTC'`** | ver 3.1.2 |
| `platform` | `text` | `platform text` | **cópia literal** (**D5**) — `'Nenhum'` inclusive | ver 3.1.3 |
| `channel` | `text` | `channel` | **cópia literal** (**D5**) — `'Nenhum'` inclusive | 1.128 |
| `has_tracking_code` | `boolean` | `has_tracking_code boolean` | cópia | 1.098 `true` |
| `contact_reason` | `text` | `contact_reason` | cópia | **60.344 nulos — tem de continuar opcional** |
| `contact_reason_note` | `text` | `contact_reason_note` | cópia | 809 preenchidas |
| `order_id` | `text` | `order_number text` | cópia | 101.143 nulos |
| `takeover_approved_at/by` | | idem | `by::uuid` | |

#### 3.1.1 `service_date` — a única conversão que erra silenciosamente

```sql
-- OBRIGATÓRIO
(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date

-- PROIBIDO — erra 6.778 tickets em um dia, e ninguém percebe
substring(service_date,1,10)::date
left(service_date,10)::date
service_date::date
to_date(service_date,'YYYY-MM-DD')
```

Razão, de `31` §3.1: 22.320 linhas estão no formato `…T HH:MM:SS+00:00` (era anterior a
10/03/2026). Dessas, as que têm hora UTC entre 00:00 e 02:59 caem no **dia anterior** em São
Paulo. São **6.778 tickets**.

**Verificação de aceite da E3** (tem de dar zero):

```sql
SELECT count(*) FROM tickets t JOIN services s ON s.id = t.legacy_id
WHERE t.business_date <> (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date;
-- critério: 0
```

Exceções de valor (não de formato): os **2 tickets de 1997-04-28**. Formato válido, data
impossível. **Decisão humana** — enquanto não houver, vão para `migration_rejects` com motivo
`DATE_OUT_OF_RANGE` e **não** entram em `tickets`. São 2 linhas; a reconciliação de contagem
tem de somá-las de volta (`102.738 = tickets + rejects`).

#### 3.1.2 `created_at` — não é cast, é interpretação

`services.created_at` é `timestamp without time zone` com `DEFAULT CURRENT_TIMESTAMP`
(`30` §11.2). As sessões do PostgREST rodam em UTC, então **o valor é UTC por convenção, não
por tipo**.

```sql
-- CORRETO
created_at AT TIME ZONE 'UTC'         -- timestamp sem fuso, interpretado como UTC → timestamptz

-- ERRADO — interpretaria como hora local do servidor e erraria em 3h
created_at::timestamptz
```

Aplica-se igualmente a `refunds.created_at`, `goals.created_at/updated_at`,
`products.created_at/updated_at`, `profiles.created_at` — as cinco tabelas de `30` §11.2.

**Risco residual, registrado honestamente:** se em algum momento uma sessão gravou com
`TimeZone` diferente de UTC, aquelas linhas estão deslocadas e **não há como detectar**, porque
o tipo não guarda o fuso. Um sinal indireto: comparar `created_at` com
`min(recorded_at)` do primeiro follow-up do mesmo ticket; se `created_at` for sistematicamente
3h deslocado num período, achamos. Proponho isso como verificação **exploratória** em E0, não
como bloqueio.

#### 3.1.3 `platform = 'Nenhum'` — decidido: cópia literal

Decisão **D5** de `00-CONTRATO.md` §8-A: os 10.666 `'Nenhum'` e os 26.764 vazios **permanecem
distintos**. Não unificar, não apagar.

Portanto a conversão é a mais simples possível:

```sql
platform  -- cópia literal, sem CASE, sem NULLIF
channel   -- idem
```

O que isso **elimina** da especificação original deste documento:

- não há `legacy_platform` nem `legacy_channel` (a coluna original já é o valor original);
- não há `legacy_platform_sentinel`;
- não há `reason_code` de rejeito por sentinela;
- o `check_code` `PLATFORM_SENTINEL` sai da taxonomia (§6.2);
- a verificação R4.d compara **coluna com coluna**, e a igualdade tem de ser **exata** (§8).

Fica **uma** exceção que D5 não cobre, porque não é semântica: **`'Logicall'` com 1 linha
contra `'LogiCall'` com 995** é erro de digitação (`31` §2.2). D5 preserva a distinção entre
"nenhum" e "vazio"; não manda preservar um erro de caixa que nenhuma leitura de negócio
distingue.

Duas saídas, e eu **não** escolho:

| Saída | Efeito |
|---|---|
| corrigir no backfill (`'Logicall' → 'LogiCall'`) | 1 linha muda; a verificação R4.d acusa diferença de 1 e precisa de exceção escrita |
| copiar literal, como D5 manda para o resto | `platform` fica com 11 valores, um deles com 1 linha, e todo agrupamento por plataforma tem uma fatia órfã |

**Recomendo corrigir**, porque é o único caso em que a cópia literal propaga um defeito em vez
de preservar informação. Mas como `platform` é `text` no alvo (não enum), copiar literal **não
quebra nada** — só deixa o relatório com uma linha a mais. Decisão do dono; se não houver
decisão, o backfill copia literal e o item vai para `90-BACKLOG.md`.

### 3.2 `service_follow_ups` → `interactions`

| Coluna legada | Alvo | Conversão | Exceções |
|---|---|---|---|
| `id` | `id uuid` + `legacy_id text` | `id::uuid` / literal | 0 inválidos |
| `service_id` | `ticket_id uuid` | `service_id::uuid` | 0 órfãos |
| `user_id` | `agent_id uuid` | `user_id::uuid` | 0 órfãos (e **não havia FK**) |
| `follow_up_number` | `legacy_follow_up_number int` | cópia literal | **12.755 excedentes** |
| — | `seq int` | derivado por `row_number()` sobre `(recorded_at, id)` — seção 5.2 | |
| `status` | `status` | cópia (`em_andamento`/`concluido`) | 2 valores |
| `recorded_at` | `recorded_at timestamptz` | cópia (já é `timestamptz`) | — |
| `created_at` | `created_at timestamptz` | cópia | difere de `recorded_at` em 15.879 |
| `observation` | `note text` | cópia | 26.789 vazias |
| `is_same_day_repeat` | `is_same_day_repeat` | cópia | 1.696 `true` |

### 3.3 `refunds`

| Coluna legada | Tipo hoje | Alvo | Conversão | Exceções |
|---|---|---|---|---|
| `id` | `text` | `id uuid` + `legacy_id` | `id::uuid` | 0 |
| `user_id` | `text` | `agent_id uuid` | `user_id::uuid` | 0 órfãos |
| `request_date` | `text` | `requested_on date` | `request_date::date` | 100% ISO; 1 ano `0025` |
| `completion_date` | `text` | `completed_on date` | `completion_date::date` | 100% ISO; 2 anos `0026` |
| `refund_type` | `text` `'NN%'` | `refund_pct numeric(5,2)` | `replace(refund_type,'%','')::numeric` | `'05%'` → `5.00`; 1.240 nulos |
| `refund_type` | | `legacy_refund_type text` | literal | preserva `'05%'` |
| `refund_value` | `double precision` | `refund_value numeric(12,2)` | `refund_value::numeric(12,2)` | **é dólar (D4)**; 88 outliers recebem marca |
| `sales_platform` | `text` | `sales_platform` | **cópia literal** (**D5**) — `'Nenhum'` inclusive | `Hotmart` existe só aqui |
| `channel` | `text` | `channel` | cópia (sem `'Nenhum'` nesta tabela) | 747 nulos |
| `customer_email` | `text` | `customer_email` + `customer_email_normalized` (gerada) | **literal** + coluna gerada (**D6**) | 150 com maiúscula, preservadas |
| `reason` | `text` | `reason text` | cópia | 1.240 nulos (reembolso aberto) |
| `items_returned` | `boolean` | idem | cópia | |
| `service_id` | `text` | `ticket_id uuid` | `service_id::uuid` | 3.975 nulos, 0 órfãos |
| `created_at` | `timestamp` sem fuso | `timestamptz` | `AT TIME ZONE 'UTC'` | |

**`refund_value` é dólar** — decisão **D4** de `00-CONTRATO.md` §8-A. A dúvida de unidade
(centavos versus dólar) está respondida, e com ela cai a necessidade de um `UPDATE` de escala
depois do backfill.

A regra de conversão não muda em nada: **preservar o número exato**, converter só o tipo
(`double precision → numeric(12,2)`, ganho de precisão, não perda), e marcar os **88 valores
acima de 2.000** com `value_outlier`. O que muda é o **significado da marca**: ela sinaliza
qualidade de dado (um reembolso de 76.365 dólares é implausível como valor único), não unidade
desconhecida. A soma de controle continua **2.385.239,01** e bate por construção.

Na v2 a API devolve `{ amount, currency }` com `currency` fixo em `USD`, de modo que rótulo e
dado não possam divergir — foi o que aconteceu no legado, onde um modal formatava em `BRL` e
quatro colunas de exportação diziam "Valor (R$)". Ambos corrigidos pelo dono em 26/09/2026.

`double precision → numeric` merece cuidado: `0.1 + 0.2` em float não é `0.3`. A soma de
controle **tem de ser comparada com tolerância**:

```sql
-- critério: diferença absoluta < 0.01
SELECT abs(
  (SELECT sum(refund_value::numeric) FROM legado.refunds) -
  (SELECT sum(refund_value)          FROM novo.refunds)
) < 0.01;
```

### 3.4 `profiles` → `agents`

| Coluna | Alvo | Conversão | Nota |
|---|---|---|---|
| `id` | `id uuid` + `legacy_id` | `id::uuid` | 47/47 válidos |
| — | `auth_user_id uuid NULL` | `id::uuid` **se existir** em `auth.users`, senão `NULL` | **2 ficam NULL** — seção 12 |
| `role` | enum novo em snake_case | `role::text::novo_enum` | 4 labels; ver `30` §11.5 |
| `support_channel` | `legacy_support_channel` | literal | coluna morta — emenda 9 de `31` |
| `email` | `email citext` ou `text` normalizado | `lower(btrim(email))` | 0 sujos |
| flags | idem | cópia | `can_view_all_tickets` = 0 usuários, **mantém** |
| `created_at` | `timestamptz` | `AT TIME ZONE 'UTC'` | |

### 3.5 O que **não** migra como está

| Tabela | Destino | Motivo |
|---|---|---|
| `agent_daily_service_counts` | `migration_checks` | cache derivado — emenda 2 de `30` |
| `user_roles` | não migra | sem policy, 100% redundante com `profiles.role` (`31` §4.7: 0 divergências) |
| `agent_heartbeats` | não migra | contrato §4 troca heartbeat por Realtime Presence |
| `lya_agentes` (view) | recriar com `security_invoker` | `30` §9 |

---

## 4. Identidade: `legacy_id` em tudo, valor preservado em tudo

### 4.1 A regra

```sql
INSERT INTO novo.tickets (id, legacy_id, …)
SELECT s.id::uuid,   -- mesmo valor, outro tipo
       s.id,         -- literal, para auditoria e para as linhas que falharem
       …
FROM legado.services s
WHERE s.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

`legacy_id text NOT NULL UNIQUE` em **toda** tabela migrada. Para as 168.905 linhas medidas em
`31` §3.2, `legacy_id::uuid = id` — redundante e barato. Serve para:

1. **As linhas que virarem rejeito.** Um rejeito não tem `id` na tabela nova; `legacy_id` é o
   que permite reencontrá-lo e reprocessá-lo depois.
2. **Reexecução idempotente.** `ON CONFLICT (legacy_id) DO NOTHING` torna o backfill
   repetível sem duplicar.
3. **Reconciliação.** Todo `JOIN` entre legado e novo é por `legacy_id`, não por `id`, para que
   a verificação não pressuponha justamente o que está verificando.

### 4.2 Por que preservar o valor e não reemitir

Medido, não suposto:

- **P1: zero ids inválidos.** `id::uuid` é sem perda e sem colisão.
- **Sete FKs dependem desses valores**: `service_follow_ups.service_id`, `refunds.service_id`,
  `ticket_transfers.service_id`, `ticket_takeover_requests.service_id`,
  `service_date_corrections.service_id`, `refund_manager_completions.refund_id`,
  `refund_reason_classifications.refund_id`. Reemitir exige um mapa `velho→novo` aplicado
  sete vezes, e cada aplicação é uma chance de cruzar dado errado.
- **Há referências fora do banco.** `export_agent_services` gera planilha para a gestora, e
  essas planilhas já foram entregues com os ids atuais. Reemitir invalida o histórico dela
  sem aviso.

Reemitir uuid não traz benefício nenhum aqui. **Preservar.**

---

## 5. Derivação de `status` e de `seq`

### 5.1 `status` do ticket

> **Correção de 26/09/2026.** A primeira redação desta seção fixou a ordem
> `(recorded_at, follow_up_number, id)` "porque é a que as RPCs de hoje usam". Fui verificar no
> legado e **estava errado**: a RPC que alimenta a tela do agente ordena por
> `(recorded_at, id)`, sem `follow_up_number`. A diferença não é acadêmica — ela muda o status
> final de **37 tickets**. Corrigido abaixo.

Ordem canônica de interação, **fixada e verificada contra o legado**:

```sql
ORDER BY recorded_at, id          -- ascendente; "última" é o maior
```

A fonte é `my_follow_ups()`, a RPC que a tela do agente consome:

```sql
SELECT jsonb_agg(t ORDER BY t.recorded_at, t.id) FROM public.service_follow_ups t ...
```

e o cliente toma `entries[entries.length - 1]`
(`src/features/services/useStatusTracking.ts:95`), isto é, o máximo sob `(recorded_at, id)`.
`groupByService` apenas empilha na ordem de chegada, então **a ordem do banco é a ordem da
tela**.

Custo medido de cada escolha:

| Ordem de desempate | Fantasmas | |
|---|---|---|
| `(recorded_at, id)` — **legado** | **10.062** | reproduz a tela de hoje |
| `(recorded_at, follow_up_number, id)` | 10.099 | o que eu havia especificado |
| `(follow_up_number, recorded_at, id)` | 9.994 | |

As duas primeiras **discordam do status final em 37 tickets**. Como o objetivo da travessia é
que o número novo reproduza o número velho, a ordem correta é a do legado.

Regra completa:

```sql
WITH ultima AS (
  SELECT DISTINCT ON (ticket_id) ticket_id, status
  FROM novo.interactions
  ORDER BY ticket_id, recorded_at DESC, legacy_id DESC   -- espelha ORDER BY recorded_at, id
)
UPDATE novo.tickets t SET derived_status = COALESCE(
   (SELECT CASE u.status WHEN 'concluido' THEN 'concluido' ELSE 'em_andamento' END
      FROM ultima u WHERE u.ticket_id = t.id),
   CASE t.legacy_status WHEN 'concluido' THEN 'concluido' ELSE 'novo' END
);
```

Três pontos que não são óbvios e são obrigatórios:

1. **O `COALESCE` com `legacy_status` não é defensivo, é necessário — e o legado já o tem.**
   `useStatusTracking.ts:87`:

   ```js
   // Service concluded directly (no follow-ups), set via status field
   if (serviceStatus === "concluido" && (!entries || entries.length === 0)) {
     return { label: "Concluído", variant: "done" };
   }
   ```

   São **1.220** tickets concluídos antes de `service_follow_ups` existir (26/03/2026). Sem o
   fallback eles aparecem como "Em Aberto" no dia da virada. É o conflito **C8** (§12).

2. **Ticket sem interação e sem `legacy_status = 'concluido'` vira `novo`**, não
   `em_andamento`. São 71.798 tickets (70%) — a maioria absoluta do banco é atendimento de uma
   única interação, e o legado os rotula "Em Aberto".

3. **`legacy_status` e o status derivado ficam ambos gravados.** A divergência é informação: é
   o que permite a gestora conferir por amostragem.

Status que a tela mostra **hoje**, medido — é a linha de base que o backfill tem de reproduzir:

```sql
SET LOCAL statement_timeout = '15s';
WITH f AS MATERIALIZED (SELECT service_id, status, recorded_at, id FROM service_follow_ups),
legado AS (SELECT DISTINCT ON (service_id) service_id, status AS st
             FROM f ORDER BY service_id, recorded_at DESC, id DESC)
SELECT CASE
         WHEN l.st IS NULL AND s.status='concluido' THEN 'Concluido (via services.status)'
         WHEN l.st IS NULL                          THEN 'Em Aberto'
         WHEN l.st='concluido'                      THEN 'Concluido (via follow-up)'
         ELSE 'Em Andamento' END AS exibido,
       count(*)
FROM services s LEFT JOIN legado l ON l.service_id = s.id
GROUP BY 1 ORDER BY count(*) DESC;
```

| O que a tela mostra | Tickets |
|---|---|
| Em Aberto | **71.798** |
| Em Andamento | 19.699 |
| Concluído (via follow-up) | 10.085 |
| **Concluído (via `services.status`)** | **1.220** |

Soma = 102.802 no instante da medição. **`derived_status` do modelo novo tem de reproduzir esta
tabela, linha por linha.** É a verificação mais direta de que nada mudou para quem usa o
sistema.

#### Empates de `recorded_at`

85 tickets têm duas interações no **mesmo instante** (171 linhas), e em **69** deles as
interações empatadas discordam do status (`31` §4.5). Nesses casos `recorded_at` não desempata e
a ordem cai para `id`.

`id` é uuid v4 — aleatório. **Então nos empates o desempate é arbitrário, e eu digo isso em voz
alta em vez de esconder atrás de um `ORDER BY`.** É determinístico (mesma entrada, mesma saída,
backfill repetível) e é **o mesmo arbitrário que o legado já pratica** — o que é a propriedade
que importa: reproduzir, não melhorar.

Tratamento: os 69 vão para `migration_checks` com `TIE_AMBIGUOUS_STATUS`. São 69 linhas,
revisáveis à mão em uma sessão.

### 5.2 `seq` da interação

```sql
UPDATE novo.interactions i SET seq = x.rn
FROM (SELECT id, row_number() OVER (
        PARTITION BY ticket_id ORDER BY recorded_at, legacy_id) AS rn
      FROM novo.interactions) x
WHERE x.id = i.id;
```

A ordem é a **mesma** de §5.1 — `(recorded_at, id)`, a do legado. Usar uma ordem para numerar e
outra para derivar status produziria um `seq` cuja última linha não é a que define o status, que
é o tipo de incoerência que ninguém encontra até alguém reclamar de um número.

`seq` é **derivado, nunca importado**. `legacy_follow_up_number` tem 12.755 linhas excedentes
(98,1% no número 1, `31` §4.3) porque a numeração era escolhida pelo cliente e não havia
`UNIQUE`. Nenhuma dessas linhas é lixo — cada uma é uma interação que aconteceu; o que é lixo é
o número.

O schema alvo **tem** de ter `UNIQUE (ticket_id, seq)`, que é exatamente a constraint cuja
ausência causou o problema (`30` §3).

Aceite da E4:

```sql
-- nenhum buraco e nenhuma duplicata na numeração
SELECT count(*) FROM (
  SELECT ticket_id, count(*) AS n, max(seq) AS mx, count(DISTINCT seq) AS d
  FROM novo.interactions GROUP BY ticket_id
) t WHERE t.n <> t.mx OR t.n <> t.d;
-- critério: 0
```

---

## 6. `migration_rejects` e `migration_checks`

Duas tabelas, porque são duas coisas diferentes: **rejeito** é linha que *não entrou*;
**check** é linha que *entrou* e precisa de olho humano.

```sql
CREATE TABLE migration_rejects (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        uuid        NOT NULL,          -- qual execução do backfill
  source_table  text        NOT NULL,          -- 'services', 'refunds', …
  legacy_id     text        NOT NULL,          -- sempre preenchido: é como se reencontra
  reason_code   text        NOT NULL,          -- taxonomia abaixo
  reason_detail text,                          -- mensagem legível
  payload       jsonb       NOT NULL,          -- a LINHA INTEIRA de origem, to_jsonb(t.*)
  detected_at   timestamptz NOT NULL DEFAULT now(),
  resolution    text        NOT NULL DEFAULT 'pendente',
                            -- pendente | corrigido | aceito_como_esta | descartado_pelo_dono
  resolved_by   uuid,
  resolved_at   timestamptz,
  resolution_note text,
  UNIQUE (run_id, source_table, legacy_id, reason_code)
);

CREATE TABLE migration_checks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       uuid        NOT NULL,
  check_code   text        NOT NULL,
  source_table text        NOT NULL,
  legacy_id    text,                            -- nulo quando o check é agregado
  legacy_value jsonb,                           -- o que o legado dizia
  new_value    jsonb,                           -- o que o modelo novo diz
  detected_at  timestamptz NOT NULL DEFAULT now(),
  reviewed     boolean     NOT NULL DEFAULT false,
  reviewed_by  uuid,
  review_note  text
);
```

`payload jsonb` com a linha inteira é o que torna o rejeito **reprocessável sem consultar o
legado** — importante se o schema antigo for aposentado antes de todos os rejeitos serem
resolvidos.

### 6.1 Taxonomia de `reason_code`

| Código | Significado | Linhas previstas | Como se revisa |
|---|---|---|---|
| `DATE_OUT_OF_RANGE` | data fora de `[2025-01-01, hoje]` | **2** (`services` 1997) + **3** (`refunds` ano `0025`/`0026`) | humano informa a data certa; reprocessa |
| `DATE_ORDER_VIOLATION` | `completed_on < requested_on` | **40** | humano decide qual data está errada |
| `VALUE_OUTLIER` | `refund_value > 2000` | **88** | **D4**: é dólar, então é qualidade de dado; converte com marca, não rejeita — ver nota abaixo |
| `ID_NOT_UUID` | id textual não conversível | **0 previstas** | rede de segurança |
| `FK_ORPHAN` | referência sem destino | **0 previstas** | rede de segurança |
| `ENUM_UNKNOWN` | valor fora do vocabulário alvo | **0 se** o enum for derivado de `31` §2 | acrescenta label ou corrige |
| `CONTACT_INVALID` | contato que não é e-mail nem telefone | **0 previstas** (`31` §3.4) | rede de segurança |
| `DUPLICATE_LEGACY_ID` | `legacy_id` repetido | **0 previstas** | erro de backfill, não de dado |

**Nota sobre `VALUE_OUTLIER` depois de D4.** Como o dono confirmou dólar, os 88 valores altos
**não são rejeito**: convertem normalmente e recebem marca em `migration_checks`. Isso tira 88
linhas da previsão de rejeito.

Previsão total de rejeitos: **45 linhas** de 168.905 — 0,027%:

| Código | Linhas |
|---|---|
| `DATE_OUT_OF_RANGE` | **5** (2 em `services`, 3 em `refunds`) |
| `DATE_ORDER_VIOLATION` | **40** |

Os outros seis códigos devem dar **zero**; se derem qualquer coisa, **o backfill está errado**,
não o dado, e a etapa para.

### 6.2 `check_code`

| Código | Significado | Linhas previstas |
|---|---|---|
| `STATUS_DIVERGENCE` | `legacy_status` ≠ status derivado | **10.115** (10.087 + 28) |
| `TIE_AMBIGUOUS_STATUS` | empate de `recorded_at` com status divergente | **69** |
| `ORDER_AMBIGUOUS` | as duas ordens dariam status diferente | **216** |
| `EMAIL_CASE_COLLISION` | a coluna gerada normalizada funde clientes que o dado mantém distintos (**D6**) | **179** |
| `REFUND_WITHOUT_ANY_TICKET` | reembolso sem nenhum ticket do mesmo contato | **388** |
| `VALUE_OUTLIER` | `refund_value > 2000` — qualidade, não unidade (**D4**) | **88** |
| `DATE_ORDER_VIOLATION_KEPT` | as 40 linhas, se a decisão for `NOT VALID` em vez de rejeito | **40** |
| `ROLLUP_DIVERGENCE` | `daily_rollups` novo ≠ `agent_daily_service_counts` velho | ? — é o ponto da emenda 2 de `30` |
| `LEGACY_DATE_SHIFT` | conversão mudou o dia frente ao prefixo textual | **6.778** |

`PLATFORM_SENTINEL` **saiu** da taxonomia: com **D5**, `'Nenhum'` é copiado literal e não há
transformação para registrar.

**`STATUS_DIVERGENCE` com 10.115 linhas não é revisável à mão** (lacuna 6 de `31`). Proposta:
amostra aleatória de 200, revisada pela gestora; se a taxa de erro for zero, aprova o lote.
**Quem aprova e com que tamanho de amostra é decisão humana.**

### 6.3 Regra que não admite exceção

> **Nenhuma linha do legado desaparece.** Toda linha ou está numa tabela nova, ou está em
> `migration_rejects` com a linha inteira em `payload`. A verificação é a primeira da suíte:
>
> ```sql
> SELECT (SELECT count(*) FROM legado.services)
>      = (SELECT count(*) FROM novo.tickets)
>      + (SELECT count(*) FROM migration_rejects
>          WHERE source_table='services' AND run_id = :run);
> -- critério: true
> ```

---

## 7. `interaction_facts` e `daily_rollups`

### 7.1 A definição canônica já existe

`_interaction_events` (`30` §6) **é** o `interaction_facts` do modelo novo, em forma de função:

```sql
-- um evento por ticket, no dia SP do service_date
SELECT (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       s.user_id, s.id AS service_id, s.product, s.platform, s.channel, 'service' AS kind
FROM services s
UNION ALL
-- mais um evento por follow-up, no dia SP do recorded_at
SELECT (f.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
       f.user_id, s.id, s.product, s.platform, s.channel, 'follow_up'
FROM service_follow_ups f JOIN services s ON s.id = f.service_id;
```

Isto é o que `dashboard_metrics`, `agent_daily_metrics` e `agent_my_metrics` contam. **O
backfill de `interaction_facts` tem de reproduzir isto exatamente**, senão toda métrica muda.

Três sutilezas que o implementador vai errar se ninguém avisar:

1. **`product`, `platform` e `channel` do evento de follow-up vêm do TICKET, não do
   follow-up.** A tabela de follow-up não tem essas colunas. Logo, se alguém corrigir o
   produto de um ticket hoje, **todos os eventos históricos dele mudam de produto**
   retroativamente. Se `interaction_facts` for materializado, ele **congela** esse valor no
   momento do backfill — e passa a divergir do legado a cada correção futura. Isso é
   provavelmente **melhor** (fato histórico não deveria mudar), mas é **mudança de
   comportamento** e precisa ser dita, não descoberta.
2. **O `user_id` do evento de ticket é `services.user_id` (o criador), não
   `current_owner_id`.** São diferentes em 4.048 tickets. A métrica de produtividade credita
   **quem criou**.
3. **`_interaction_events` não exclui os `is_same_day_repeat`.** A exclusão de follow-up no
   mesmo dia com `has_tracking_code` acontece em *outras* RPCs, não nesta. `interaction_facts`
   é a base bruta; o filtro é da consulta.

### 7.2 Backfill

```sql
INSERT INTO novo.interaction_facts (day, agent_id, ticket_id, product, platform, channel, kind, source_id)
SELECT t.business_date, t.created_by, t.id, t.product, t.platform, t.channel, 'ticket', t.id
FROM novo.tickets t
UNION ALL
SELECT (i.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
       i.agent_id, t.id, t.product, t.platform, t.channel, 'interaction', i.id
FROM novo.interactions i JOIN novo.tickets t ON t.id = i.ticket_id;
```

**`platform` é cópia literal (D5), e isso simplifica a reconciliação.** A redação anterior desta
nota alertava que, se `'Nenhum'` virasse `NULL`, a comparação da seção 8 acusaria diferença em
2.359 eventos só em agosto/2026, e que a consulta teria de normalizar os dois lados.

Com **D5**, nada disso é necessário: `'Nenhum'` chega em `interaction_facts` como `'Nenhum'`, e a
verificação R7 compara **valor com valor**, exigindo igualdade exata. A distribuição de agosto
(Cartpanda 8.865 · Buygoods 6.714 · `Nenhum` 2.359 · … · `Logicall` 1) tem de ser reproduzida
**termo a termo**.

Única ressalva: se a correção de `'Logicall' → 'LogiCall'` (§3.1.3) for aceita, o termo
`Logicall 1` desaparece e `LogiCall` ganha 1. É a única diferença admissível, e precisa estar
escrita na aprovação.

### 7.3 `daily_rollups`

```sql
INSERT INTO novo.daily_rollups (day, agent_id, interaction_count, ticket_count, followup_count)
SELECT day, agent_id, count(*),
       count(*) FILTER (WHERE kind='ticket'),
       count(*) FILTER (WHERE kind='interaction')
FROM novo.interaction_facts GROUP BY day, agent_id;
```

`agent_daily_service_counts` (legado) conta **só tickets**, não interações. Então:

```
daily_rollups.ticket_count  ==  agent_daily_service_counts.service_count
daily_rollups.interaction_count  ==  o que dashboard_metrics chama de total
```

Confundir os dois é o erro mais provável desta etapa.

---

### 7.4 Paginação numerada (D7): o índice que falta em `interaction_facts`

Decisão **D7** de `00-CONTRATO.md` §8-A: a paginação numerada continua em cinco listas, com
`totalCount`, e o total é contado **sobre a tabela de fatos**. Verifiquei se os índices de
`12-backend-schema-alvo.md` §5.2 dão conta. **Dão conta da contagem; não dão conta da
ordenação.**

O que a lista de auditoria faz hoje (`dashboard_audit`, lido do catálogo):

```sql
WHERE (…)::date BETWEEN from_date AND to_date
  AND (agent_id IS NULL OR user_id = agent_id)
-- total:
SELECT COUNT(*) …
-- página:
ORDER BY ev.event_at DESC, ev.kind ASC, ev.id DESC
LIMIT page_size OFFSET page_offset
```

Contra os índices propostos:

| Necessidade | Índice proposto | Serve? |
|---|---|---|
| `COUNT(*)` por período | `idx_facts_day_actor (business_day, actor_id)` | **sim** — varredura de faixa, pode ser index-only |
| `COUNT(*)` por período + agente | idem | **sim** |
| `ORDER BY occurred_at DESC` numa faixa de dias | `idx_facts_day_actor` / `idx_facts_actor_day` | **não** |
| idem | `BRIN (occurred_at)` | **não** — BRIN não ordena, nunca |

O motivo é uma propriedade do btree fácil de esquecer: **predicado de faixa na primeira coluna
destrói a ordenação das colunas seguintes.** Com `business_day BETWEEN`, o índice
`(business_day, …)` devolve as linhas agrupadas por dia, mas não ordenadas por `occurred_at` no
conjunto todo. O planner então ordena o resultado inteiro a cada página — e com `OFFSET`, ordena
tudo para descartar o começo.

Hoje é barato: um mês tem **19.451** fatos, e ordenar 19 mil linhas é questão de
milissegundos. O problema é a trajetória: são ~20 mil fatos/mês, então "últimos 12 meses" já é
~240 mil linhas ordenadas por página virada, e a tabela cresce para sempre. É a classe de
consulta que ficou inofensiva por dois anos e derrubou o banco em 24/07/2026.

**Índices que proponho acrescentar:**

```sql
-- paginação da auditoria sem filtro de agente
CREATE INDEX idx_facts_time_page  ON interaction_facts (occurred_at DESC, id DESC);

-- paginação com filtro de agente (substitui idx_facts_actor_day)
CREATE INDEX idx_facts_actor_time ON interaction_facts (actor_id, occurred_at DESC, id DESC);
```

Com eles a página vem por varredura ordenada do índice, **sem sort**, inclusive com `OFFSET`.

**Condição de uso, e sem ela o índice não serve para nada:** a consulta tem de filtrar por
`occurred_at`, não só por `business_day`. Como `business_day` é derivada de `occurred_at`, a API
precisa emitir os dois predicados:

```sql
WHERE occurred_at >= (:from::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
  AND occurred_at <  ((:to::date + 1))::timestamp AT TIME ZONE 'America/Sao_Paulo'
  AND business_day BETWEEN :from AND :to     -- mantém a fronteira do dia de negócio
```

Os dois primeiros abrem o índice; o terceiro garante o recorte exato. Redundante de propósito: o
planner usa o que serve e o resultado não muda.

`idx_facts_actor_time` **substitui** `idx_facts_actor_day` em vez de somar: `(actor_id,
business_day)` é prefixo estritamente mais fraco que `(actor_id, occurred_at DESC, id DESC)`
para tudo que `GET /metrics/me` faz, porque `business_day` é função monotônica de `occurred_at`.
`BRIN (occurred_at)` pode ficar — custa quase nada e ajuda varredura larga de agregação — mas não
é o que pagina.

**Sobre o cache de total por combinação de filtro**, que D7 menciona: ele precisa de invalidação,
e `interaction_facts` recebe `DELETE` (a trigger `emit_interaction_fact` tem `AFTER DELETE`). O
critério mais simples e correto é invalidar por `business_day` tocado — qualquer combinação que
inclua aquele dia cai. Não é decisão da trilha de dados; registro porque total em cache que não
invalida é pior que contar de novo.

As outras quatro listas de D7 (duas abas de reembolso, auditoria de reembolso, detalhe de motivo)
contam sobre `refunds`, não sobre a tabela de fatos. Lá os índices de
`12-backend-schema-alvo.md` §4.1 já servem: `idx_refunds_owner_request (owner_id, request_date
DESC, id DESC)` ordena e pagina, e `idx_refunds_completion` cobre o recorte por conclusão. **Sem
índice faltando nesse lado.**

---

## 8. Suíte de reconciliação

Cada verificação tem SQL pronto e critério binário. **Nenhuma etapa avança com verificação
vermelha.** `:run` é o `run_id` da execução.

### R1 — Conservação de linhas (a mais importante)

```sql
SELECT 'services' AS tabela,
       (SELECT count(*) FROM legado.services)                                   AS legado,
       (SELECT count(*) FROM novo.tickets)                                      AS novo,
       (SELECT count(*) FROM migration_rejects
         WHERE source_table='services' AND run_id=:run)                         AS rejeitos
UNION ALL SELECT 'service_follow_ups',
       (SELECT count(*) FROM legado.service_follow_ups),
       (SELECT count(*) FROM novo.interactions),
       (SELECT count(*) FROM migration_rejects WHERE source_table='service_follow_ups' AND run_id=:run)
UNION ALL SELECT 'refunds',
       (SELECT count(*) FROM legado.refunds),
       (SELECT count(*) FROM novo.refunds),
       (SELECT count(*) FROM migration_rejects WHERE source_table='refunds' AND run_id=:run)
UNION ALL SELECT 'profiles',
       (SELECT count(*) FROM legado.profiles),
       (SELECT count(*) FROM novo.agents),
       (SELECT count(*) FROM migration_rejects WHERE source_table='profiles' AND run_id=:run);
```

**Critério: `legado = novo + rejeitos` em toda linha.** Esperado em `T0` ≈ 26/09/2026:
services 102.743 = 102.741 + 2 · follow_ups 59.715 = 59.715 + 0 · refunds 5.710 = 5.707 + 3 ·
profiles 47 = 47 + 0.

### R2 — Identidade preservada

```sql
SELECT count(*) FROM novo.tickets WHERE legacy_id::uuid <> id;           -- 0
SELECT count(*) FROM novo.tickets t
  WHERE NOT EXISTS (SELECT 1 FROM legado.services s WHERE s.id = t.legacy_id);  -- 0
SELECT count(*) FROM legado.services s
  WHERE NOT EXISTS (SELECT 1 FROM novo.tickets t WHERE t.legacy_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM migration_rejects r
                     WHERE r.source_table='services' AND r.legacy_id = s.id AND r.run_id=:run);  -- 0
```

### R3 — Datas convertidas corretamente

```sql
-- a conversão bate com a regra canônica, ticket a ticket
SELECT count(*) FROM novo.tickets t JOIN legado.services s ON s.id = t.legacy_id
WHERE t.business_date <> (s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date;   -- 0

-- quantos mudaram de dia frente ao prefixo textual (tem de bater com 31 §3.1)
SELECT count(*) FROM novo.tickets t JOIN legado.services s ON s.id = t.legacy_id
WHERE t.business_date <> substring(s.service_date,1,10)::date;                                    -- 6.778

-- refunds
SELECT count(*) FROM novo.refunds n JOIN legado.refunds l ON l.id = n.legacy_id
WHERE n.requested_on <> l.request_date::date
   OR n.completed_on IS DISTINCT FROM l.completion_date::date;                                    -- 0
```

A segunda verificação é a que **prova que a armadilha foi evitada**: se der 0 em vez de 6.778,
alguém usou `substring` e 6.778 tickets estão um dia adiante.

### R4 — Somas de controle

```sql
-- soma do valor de reembolso (tolerância por causa de double→numeric)
SELECT abs( (SELECT sum(refund_value::numeric) FROM legado.refunds)
          - (SELECT sum(refund_value)          FROM novo.refunds) ) < 0.01;    -- true
-- esperado: 2.385.239,01

-- contagem por agente e mês
SELECT * FROM (
  SELECT a.legacy_id AS agente, to_char(t.business_date,'YYYY-MM') AS mes, count(*) AS novo
  FROM novo.tickets t JOIN novo.agents a ON a.id = t.created_by
  GROUP BY 1,2) n
FULL JOIN (
  SELECT s.user_id AS agente,
         to_char((s.service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS mes,
         count(*) AS legado
  FROM legado.services s GROUP BY 1,2) l
USING (agente, mes)
WHERE coalesce(n.novo,0) <> coalesce(l.legado,0);          -- 0 linhas (fora os 2 rejeitos de 1997)

-- por produto
SELECT * FROM (SELECT product, count(*) n FROM novo.tickets GROUP BY 1) a
FULL JOIN (SELECT product, count(*) n FROM legado.services GROUP BY 1) b USING (product)
WHERE coalesce(a.n,0) <> coalesce(b.n,0);                  -- 0

-- por canal e por plataforma: com D5 a conversão é LITERAL, então compara coluna com
-- coluna e a igualdade tem de ser EXATA (inclusive para 'Nenhum')
SELECT * FROM (SELECT platform p, count(*) n FROM novo.tickets      GROUP BY 1) a
FULL JOIN  (SELECT platform p, count(*) n FROM legado.services GROUP BY 1) b USING (p)
WHERE coalesce(a.n,0) <> coalesce(b.n,0);                  -- 0
```

### R5 — Integridade referencial no modelo novo

```sql
SELECT (SELECT count(*) FROM novo.interactions i
          WHERE NOT EXISTS (SELECT 1 FROM novo.tickets t WHERE t.id = i.ticket_id))  AS i_sem_ticket,
       (SELECT count(*) FROM novo.interactions i
          WHERE NOT EXISTS (SELECT 1 FROM novo.agents a WHERE a.id = i.agent_id))    AS i_sem_agente,
       (SELECT count(*) FROM novo.tickets t
          WHERE NOT EXISTS (SELECT 1 FROM novo.agents a WHERE a.id = t.created_by))  AS t_sem_criador,
       (SELECT count(*) FROM novo.refunds r WHERE r.ticket_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM novo.tickets t WHERE t.id = r.ticket_id))    AS r_sem_ticket;
-- critério: 0 em tudo
```

`t_sem_criador` é a verificação que pega o problema dos 2 perfis sem `auth.users` (seção 12):
se `agents` recusar os dois, esta consulta acusa **5.665**.

### R6 — Numeração das interações

```sql
SELECT count(*) FROM (
  SELECT ticket_id, count(*) n, max(seq) mx, count(DISTINCT seq) d
  FROM novo.interactions GROUP BY ticket_id) t
WHERE t.n <> t.mx OR t.n <> t.d;                                 -- 0

-- e a renumeração não perdeu nenhuma linha
SELECT (SELECT count(*) FROM legado.service_follow_ups)
     = (SELECT count(*) FROM novo.interactions);                 -- true
```

### R7 — Métrica antiga versus métrica nova

Esta é a verificação que o dono do projeto vai olhar. Para **cada mês de 2026-01 a 2026-09**:

```sql
-- LADO LEGADO: a definição canônica de hoje
WITH legado AS (
  SELECT day, user_id, count(*) AS n
  FROM public._interaction_events(:from, :to, NULL)
  GROUP BY day, user_id
),
-- LADO NOVO: os rollups
novo AS (
  SELECT r.day, a.legacy_id AS user_id, r.interaction_count AS n
  FROM novo.daily_rollups r JOIN novo.agents a ON a.id = r.agent_id
  WHERE r.day BETWEEN :from AND :to
)
SELECT coalesce(l.day, n.day) AS dia,
       coalesce(l.user_id, n.user_id) AS agente,
       coalesce(l.n,0) AS legado, coalesce(n.n,0) AS novo,
       coalesce(n.n,0) - coalesce(l.n,0) AS diff
FROM legado l FULL JOIN novo n ON n.day = l.day AND n.user_id = l.user_id
WHERE coalesce(l.n,0) <> coalesce(n.n,0)
ORDER BY 1,2;
```

**Critério: zero linhas** (fora os dias dos 2 tickets rejeitados de 1997).

Baseline medido em 26/09/2026 para **agosto/2026**, para conferência imediata:

| medida | valor |
|---|---|
| `total_eventos` | **19.451** |
| `eventos_service` | 9.399 |
| `eventos_follow_up` | 10.052 |
| agentes distintos | 13 |
| dias cobertos | 26 |
| por canal | SMS 10.363 · Email 8.960 · Clickbank 72 · *não informado* 54 · Nenhum 2 |
| por plataforma | Cartpanda 8.865 · Buygoods 6.714 · **Nenhum 2.359** · ClickBank 668 · LogiCall 414 · PagAmerican 236 · SalesBound 68 · CartCandy 56 · *não informado* 40 · Digistore24 30 · **Logicall 1** |

Note os **2.359 eventos com `platform='Nenhum'`** e o **1 com `'Logicall'`**: se E3 normalizou
os dois, a comparação por plataforma **tem** de ser feita contra `legacy_platform`, ou vai
acusar 2.360 diferenças que são corretas.

Análogas, com a mesma forma:

```sql
-- agent_daily_metrics: my_count de um agente num dia
SELECT (public.agent_daily_metrics(:dia) ->> 'my_count')::int    -- como o agente autenticado
     = (SELECT interaction_count FROM novo.daily_rollups
         WHERE day = :dia AND agent_id = :agente);

-- dashboard_refund_metrics: comparar total e soma por período
```

### R8 — Rollup legado versus rollup novo (emenda 2 de `30`)

```sql
SELECT c.user_id, c.day, c.service_count AS legado, r.ticket_count AS novo
FROM legado.agent_daily_service_counts c
FULL JOIN (SELECT a.legacy_id AS user_id, r.day::text AS day, r.ticket_count
             FROM novo.daily_rollups r JOIN novo.agents a ON a.id = r.agent_id) r
  ON r.user_id = c.user_id AND r.day = c.day
WHERE coalesce(c.service_count,0) <> coalesce(r.ticket_count,0);
```

**Critério: nenhuma linha, OU toda divergência explicada e registrada como
`ROLLUP_DIVERGENCE`.** Diferente das outras, esta verificação pode legitimamente acusar
diferença: a tabela legada é cache mantido por trigger durante uma conversão de tipo, e pode
estar errada em algum dia. A divergência é **informação**, não necessariamente defeito — e é
exatamente por isso que a emenda 2 de `30` pede para preservá-la como testemunha.

### R9 — Vocabulário completo

```sql
-- nenhum valor do legado ficou fora do enum novo
SELECT DISTINCT legacy_platform FROM novo.tickets
EXCEPT SELECT unnest(enum_range(NULL::novo.platform))::text;      -- só 'Nenhum' e NULL esperados
SELECT DISTINCT product FROM novo.tickets
EXCEPT SELECT unnest(enum_range(NULL::novo.product))::text;       -- 0
```

Lembrete de `31` §2.9: o enum de plataforma precisa de **`Hotmart`**, que existe só em
`refunds` (143 linhas) e não em `services`. Derivar o enum só de `services` perde esse valor.

### 8.1 Painel de aprovação

| Verificação | Critério | Bloqueia? |
|---|---|---|
| R1 conservação de linhas | igualdade exata | **sim** |
| R2 identidade | 0 | **sim** |
| R3 datas | 0 / 6.778 / 0 | **sim** |
| R4 somas de controle | 0 e |Δ| < 0,01 | **sim** |
| R5 integridade referencial | 0 | **sim** |
| R6 numeração | 0 e igualdade | **sim** |
| R7 métrica antiga × nova | 0 linhas | **sim** |
| R8 rollup legado × novo | 0 **ou** explicado | não — registra |
| R9 vocabulário | 0 | **sim** |
| rejeitos previstos | ≤ **45** e só em `DATE_OUT_OF_RANGE` (5) e `DATE_ORDER_VIOLATION` (40) | **sim** |

---

## 9. Duração e tamanho

### 9.1 Duração

Base medida: as consultas de `31` varreram `services` (102.7 mil linhas, 50 MB) inteiras com
múltiplas agregações e voltaram em **poucos segundos**, dentro do teto de 15 s, num `t4g.micro`
**em produção, com carga real**.

| Etapa | Linhas | Estimativa | Observação |
|---|---|---|---|
| E2 dimensões | 133 | < 1 s | |
| E3 tickets | 102.7 mil | **1–3 min** | `INSERT … SELECT` + índices |
| E4 interações | 59.7 mil | **1–2 min** | |
| E5 derivar status | 102.7 mil | **1–2 min** | `UPDATE` de tabela inteira |
| E6 reembolsos | 5.7 mil | < 10 s | |
| E7 satélites | ~20 mil | < 30 s | |
| E8 `interaction_facts` | ~162 mil | **1–2 min** | |
| E9 `daily_rollups` | ~2 mil | < 5 s | |
| E10 reconciliação | — | **5–15 min** | R7 chama `_interaction_events` por mês, 9 vezes |
| **Total** | | **15–30 min** | |

Para dimensionar a janela, **dobre**: 30–60 minutos. O gargalo não é linha, é CPU burstable.

**Cuidados obrigatórios num `t4g.micro`:**

- **Criar índice depois do `INSERT`**, nunca antes. Inserir 102 mil linhas em tabela indexada
  custa várias vezes mais.
- **Uma etapa por vez.** Duas etapas em paralelo em 2 vCPU burstable é como se causou o
  incidente de 24/07.
- **Verificar os créditos de CPU antes de começar.** `t4g.micro` acumula crédito; entrar no
  backfill com saldo baixo é entrar em throttling no meio.
- **`ANALYZE` depois de cada etapa grande**, senão o planner da etapa seguinte trabalha com
  estatística de tabela vazia. Isso é o que transforma 2 minutos em 20.
- Se a opção "corte com delta" for escolhida, **não** usar `CREATE INDEX CONCURRENTLY` em
  paralelo com o backfill.

### 9.2 Tamanho

| | |
|---|---|
| `public` hoje | **90 MB** |
| `services` + `service_follow_ups` | 71 MB (79%) |

Estimativa do modelo novo, na mesma ordem de grandeza:

| Fator | Efeito |
|---|---|
| `id` de `text` (37 B) para `uuid` (16 B) | **−** em ~170 mil linhas × várias colunas |
| `service_date` de `text` (26 B) para `date` (4 B) | **−** ~2 MB |
| `legacy_id` + `legacy_*` em toda tabela | **+** — cancela boa parte do ganho |
| `interaction_facts` (~162 mil linhas) | **+ ~15 MB** |
| `daily_rollups` (~2 mil linhas) | desprezível |
| índices novos (`business_date`, `contact_normalized`, `UNIQUE(ticket_id,seq)`) | **+ ~15 MB** |

**Estimativa: 110–130 MB**, legado e novo convivendo → **~200–220 MB**. Continua pequeno para
o disco; continua confortável para 1 GB de RAM. **Volume não é o risco desta migração.**

---

## 10. Volta atrás

| Etapa | Como reverter | Custo | Irreversível? |
|---|---|---|---|
| E0 | nada a reverter (leitura) | — | não |
| E1 | `DROP SCHEMA novo CASCADE` | segundos | não |
| E2–E9 | `TRUNCATE` das tabelas da etapa **na ordem inversa das FKs**, ou `DROP SCHEMA novo CASCADE` e recomeçar | minutos | **não** |
| E10 | leitura; reverter é só descartar o laudo | — | não |
| **E11** | apontar a aplicação de volta para o legado | minutos *se* o legado estiver intacto | **sim, na prática** |

### 10.1 O que torna E11 irreversível

**Enquanto o schema legado existir e nada escrever nele, E11 é reversível**: basta reapontar a
aplicação. O ponto de não retorno é **a primeira escrita que só existe no modelo novo**.

A partir do primeiro ticket criado no schema novo:

- voltar para o legado **perde** todos os tickets, interações e reembolsos criados depois da
  virada (~300 tickets/dia — uma hora de operação já é ~15 tickets);
- voltar exige backfill **reverso**, que ninguém escreveu e que teria os mesmos riscos do
  direto, sem o benefício de ter sido testado.

**Mitigação obrigatória:** o schema legado **não** é derrubado na virada. Fica intacto e
somente leitura por um período acordado (proponho **30 dias**), custando 90 MB. Derrubar o
legado é a etapa **E12**, separada, explícita, e é o verdadeiro ponto de não retorno.

Enquanto o legado existir, o custo de voltar é "perder o que foi criado depois da virada" —
alto, mas finito e mensurável. Depois de E12, é total.

### 10.2 O que **não** é volta atrás

Corrigir um rejeito **não** exige reverter nada: reprocessa-se a linha individual a partir de
`migration_rejects.payload`. Por isso `payload` guarda a linha inteira.

---

## 11. As migrations problemáticas

### 11.1 Os três pares de timestamp duplicado

Não dois — **três** (`30` §11.9):

| versão | arquivos | ambos aplicados? |
|---|---|---|
| `20260729120000` | `add_honeyfil_product.sql` · `held_orders_pending_tag.sql` | **sim** — registrados como `20260729195537` e `20260729134722` |
| `20260828120000` | `contact_reason_note_vsl.sql` · `copy_evidencia_percentual_no_produto.sql` | nenhum registrado; efeito presente no banco |
| `20260904120000` | `dashboard_audit_uma_linha_por_interacao.sql` · `refund_channel_efficiency_percentuais.sql` | nenhum registrado; efeito presente |

Os três pares tratam de objetos **disjuntos**, então não há dependência entre os lados. O risco
não é o estado atual; é uma reexecução futura em que o runner aplique um e ignore o outro.

**Proposta: renomear os seis arquivos para versões distintas, preservando a ordem real.**
Renomear arquivo de migration só é seguro quando a versão **não** está registrada no banco —
caso contrário o runner a considera nova e reaplica. Daí a assimetria:

| arquivo | ação |
|---|---|
| `20260729120000_held_orders_pending_tag.sql` | → `20260729134722_…` (a versão com que foi registrado) |
| `20260729120000_add_honeyfil_product.sql` | → `20260729195537_…` (idem) |
| `20260828120000_contact_reason_note_vsl.sql` | → `20260828120000_…` (mantém; é o primeiro do par) |
| `20260828120000_copy_evidencia_percentual_no_produto.sql` | → `20260828120100_…` |
| `20260904120000_dashboard_audit_uma_linha_por_interacao.sql` | mantém |
| `20260904120000_refund_channel_efficiency_percentuais.sql` | → `20260904120100_…` |

Para o primeiro par, renomear para as versões **realmente registradas** resolve dois problemas
de uma vez: desempata o timestamp **e** reconcilia repositório com registro.

Isto altera `supabase/migrations/`, que o contrato §0 congela. **Portanto é proposta, não ação**
— entra na lista de itens para depois do corte, ou requer liberação explícita.

### 11.2 As 33 migrations locais nunca registradas

`30` §11.7 mostra que o registro parou em **29/07/2026** e que 33 arquivos nunca entraram. O
catálogo prova que o **efeito** da maioria está em produção (as tabelas, colunas, RPCs e
labels de enum existem).

Três caminhos, e eu recomendo o primeiro:

**(a) Reconciliar o registro sem tocar no schema** — inserir as 33 versões em
`supabase_migrations.schema_migrations` como já aplicadas. É a operação que `supabase migration
repair --status applied <versão>` faz. Pró: repositório e registro passam a concordar, e uma
reexecução futura não tenta reaplicar. Contra: é escrita, e **afirma** que foram aplicadas —
afirmação que precisa ser verificada arquivo a arquivo antes, não presumida.

**(b) Deixar como está.** Pró: zero risco agora. Contra: qualquer `db reset` ou ambiente novo
reaplica 33 migrations sobre um schema que já as tem. Como quase todas usam `IF NOT EXISTS` /
`CREATE OR REPLACE`, muitas passariam — mas `20260818140000_contact_reason_outro_note`
(que adiciona `CHECK`) e as de `ALTER TYPE … ADD VALUE` (enum) **falhariam**.

**(c) Declarar o legado morto e não reconciliar nada**, já que o modelo novo terá migrations
próprias. Pró: nenhum trabalho. Contra: perde-se a capacidade de recriar o ambiente legado, que
é justamente o que a seção 10.1 exige manter por 30 dias.

**Recomendação: (a), precedida de verificação item a item.** Para cada uma das 33, uma consulta
de catálogo que prove que o objeto existe — e o resultado vira uma tabela no próprio documento.
Onde não for possível provar, a migration é **aplicada de verdade**, não marcada.

### 11.3 As 3 migrations que só existem no banco

`20260716153250 claim_ticket_rpc_fix_ambiguous_id`, `20260727124851 dashboard_same_day_repeats_rpc`,
`20260727230336 create_claude_skills_leads`. Foram escritas direto em produção e nunca voltaram
ao repositório.

**Proposta: recuperar a fonte do catálogo e commitar** — `pg_get_functiondef()` para as duas
RPCs, e as definições de `30` para a tabela. O corpo se recupera; o comentário e a intenção não.
Os arquivos recuperados devem dizer isso explicitamente no cabeçalho.

---

## 12. Conflitos com `12-backend-schema-alvo.md`

> `12-backend-schema-alvo.md` foi publicado pela trilha de backend em 26/09/2026 21:16, depois
> de `30` e `31` e durante a escrita deste documento. Confrontei o alvo proposto com a
> realidade medida. **Não editei o arquivo dela** — o contrato §10 diz que conflito vira
> emenda, nunca edição cruzada.
>
> O alinhamento é alto. Em particular, o alvo **acerta** a conversão de `business_day` via
> `timestamptz AT TIME ZONE 'America/Sao_Paulo'`, prevê `legacy_id` e `legacy_service_date`,
> prevê `migration_rejects`, e mantém `ticket_status` com exatamente os dois valores que
> existem de verdade. Os conflitos abaixo são pontuais, e cada um vem com o número medido.

### C1 — `CHECK (contact_reason <> 'reembolso' OR order_id IS NOT NULL)` rejeita **4.985** tickets

O alvo (§3.1) propõe a constraint como **nova**, notando que "tickets antigos de reembolso sem
`order_id` existem" e deixando a decisão em aberto. O número é:

```sql
SET LOCAL statement_timeout = '15s';
SELECT count(*) FILTER (WHERE contact_reason='reembolso')                        AS reembolso_total,
       count(*) FILTER (WHERE contact_reason='reembolso'
                          AND (order_id IS NULL OR btrim(order_id)=''))          AS sem_order_id
FROM services;
```

| | |
|---|---|
| tickets com `contact_reason = 'reembolso'` | **6.571** |
| **sem `order_id`** | **4.985 (75,9%)** |

Três em cada quatro tickets de reembolso não têm número de pedido, porque a obrigatoriedade é
recente e vive na UI. `NOT VALID` é o único caminho que não rejeita 4.985 linhas — e `NOT VALID`
significa que a constraint vale para o novo e não para o histórico, o que é exatamente o
comportamento desejado. **Recomendo `NOT VALID`, sem `VALIDATE CONSTRAINT` depois.**

### C2 — `client_email_normalized` não normaliza telefone · **decidido em parte (D6)**

O alvo (§3.1) define `client_email_normalized citext GENERATED` = `lower(btrim(client_email))`, e
reconhece em R-TKT-11 que a coluna "guarda telefone quando `channel='SMS'`".

**D6 confirmou o desenho do alvo** — coluna gerada, original nunca sobrescrito — e é melhor do que
a minha proposta de duas colunas gravadas, porque coluna gerada não pode divergir do original.
Esse ponto está **fechado**.

O que **continua aberto** é o efeito, e ele é grande: medido em `31` §3.4, **22.446 tickets
(21,8%) têm telefone**, todos no canal SMS, todos com separadores (`+1 (555) 123-4567`).
`lower(btrim())` não toca em parênteses, hífens e espaços. Portanto
`idx_tickets_email_open` e `GET /tickets/lookup` **continuam sem deduplicar SMS**, que é o canal
com mais volume (36.062 tickets).

Não é regressão — é o comportamento de hoje, preservado, e D6 mandou preservar. Mas o alvo
descreve o `normalized` como se ele resolvesse a busca, e para 22 mil linhas ele não resolve.
Fica em `90-BACKLOG.md` B5, que a própria lista marca como "o que mais afeta o modelo novo".

### C3 — `sales_platform` como enum de 8 valores, mas existem **10** em produção

O alvo (§4.1) diz "8 valores da lista do cliente (R-REF-24); desconhecido → `migration_rejects`".

```sql
SET LOCAL statement_timeout = '15s';
SELECT sales_platform, count(*) FROM refunds GROUP BY 1 ORDER BY count(*) DESC;
```

| valor | linhas |
|---|---|
| `Cartpanda` | 2.397 |
| `Buygoods` | 1.452 |
| `ClickBank` | 1.414 |
| **`Hotmart`** | **143** |
| `PagAmerican` | 138 |
| `LogiCall` | 59 |
| `SalesBound` | 45 |
| **`Nenhum`** | **36** |
| `CartCandy` | 22 |
| `Digistore24` | 4 |

São **10 valores distintos**, não 8. Se a lista do cliente tiver 8 e os dois de fora forem
`Hotmart` e `Nenhum`, o backfill rejeita **179 reembolsos**.

Nota adicional: **`Hotmart` só existe em `refunds`** — nenhum ticket usa essa plataforma. Um
enum de plataforma derivado de `services` perderia esse valor. E `'Nenhum'` é sentinela, não
plataforma (`31` §5.1).

### C4 — `refunds.reason` como enum de 15 valores: **1.682** linhas vão para `reason_legacy`

O alvo (§4.1) define `reason refund_reason (enum)` com 15 valores e `reason_legacy text` para o
texto antigo. A medição mostra que `reason_legacy` não é caso de borda, é a regra para um terço:

```sql
SET LOCAL statement_timeout = '15s';
SELECT count(DISTINCT reason)                                                AS valores_distintos,
       count(*) FILTER (WHERE reason IN (SELECT category FROM refund_reason_classifications))
                                                                             AS batem_com_as_15,
       count(*) FILTER (WHERE reason IS NOT NULL
                          AND reason NOT IN (SELECT category FROM refund_reason_classifications))
                                                                             AS fora_das_15
FROM refunds;
```

| | |
|---|---|
| valores distintos de `refunds.reason` | **626** |
| casam com uma das 15 categorias | 2.788 |
| **não casam** | **1.682** |
| nulos (reembolso aberto) | 1.240 |

**626 valores distintos** confirma que `refunds.reason` é texto livre de verdade, e que as 15
categorias vivem em `refund_reason_classifications.category` (derivadas por
`classify_refund_reason`), não na coluna. O desenho do alvo funciona — só é bom saber que
**37,6% dos reembolsos com motivo** vão para `reason_legacy`, não uma minoria.

### C5 — `CHECK (completion_date >= request_date)`: **40** violações

Já em `31` §4.10 e na taxonomia da seção 6. O alvo (§4.1) prevê a decisão ("entra `NOT VALID`
ou rejeita histórico — decisão 19.6"); o número é **40**, dos quais **2** são erro de ano
(`0026-02-02`, `0026-02-04`) e 38 são inversão de dias.

### C6 — `created_at` sem fuso · **encaminhado, AINDA NÃO CORRIGIDO**

Reconferido em 26/09/2026 na versão de 21:22 do `12-backend-schema-alvo.md`. **O defeito
permanece**, embora agora esteja reconhecido.

O que mudou: a seção "O que falta levantar em produção" passou a dizer que a questão dos tipos
está *RESOLVIDA* e registra, como pendência, "**em que fuso** os carimbos `timestamp` sem fuso
foram gravados — provável UTC, mas assumir errado desloca todo o histórico em 3 horas".

O que **não** mudou: as regras de conversão de §2.1 e §3.1 continuam
`COALESCE(created_at, now())` e `COALESCE(created_at, business_day + interval '12h')`, sem
nenhum `AT TIME ZONE`. Tratar a pergunta como aberta e manter a conversão implícita é o pior dos
dois mundos: o cast acontece, e acontece errado, sem ninguém decidir.

**A pergunta não precisa ficar aberta — ela tem resposta.** O fuso é UTC, e dá para demonstrar
sem depender de suposição:

1. `services.created_at` tem `DEFAULT CURRENT_TIMESTAMP`, e todo `INSERT` vem do PostgREST, cujas
   sessões rodam com `TimeZone = 'UTC'`.
2. Prova independente, por consistência interna: `service_follow_ups.recorded_at` **é**
   `timestamptz` e é gravado por trigger com `now()`. Comparar o `created_at` do ticket com o
   `recorded_at` da sua primeira interação fecha a questão — se `created_at` fosse hora local,
   apareceria sistematicamente 3 h **à frente** da primeira interação, o que é impossível.

```sql
SET LOCAL statement_timeout = '15s';
WITH primeira AS (
  SELECT DISTINCT ON (service_id) service_id, recorded_at
  FROM service_follow_ups ORDER BY service_id, recorded_at
)
SELECT count(*)                                                        AS com_interacao,
       count(*) FILTER (WHERE s.created_at AT TIME ZONE 'UTC' <= p.recorded_at) AS utc_coerente,
       count(*) FILTER (WHERE s.created_at            >  p.recorded_at)         AS local_incoerente
FROM services s JOIN primeira p ON p.service_id = s.id;
```

Se `utc_coerente` ≈ total e `local_incoerente` for grande, está provado. **Não rodei** esta
consulta: ela é uma agregação sobre as duas tabelas grandes e a regra do contrato é uma por vez
com propósito claro — e o propósito aqui é resolver uma pendência da trilha de backend, não
minha. Deixo pronta.

Conversão correta, em todo caso:

```sql
created_at AT TIME ZONE 'UTC'    -- CORRETO
created_at::timestamptz          -- ERRADO: desloca 3 horas
```

Vale para as cinco tabelas de `30` §11.2: `services`, `refunds`, `profiles`, `goals`, `products`.

Detalhe menor que reforça: o `COALESCE` **nunca dispara** em `services` — `created_at IS NULL`
tem **0 linhas** (`31` §3.2) — e o fallback `business_day + interval '12h'` produziria um
`timestamp` sem fuso, sujeito ao mesmo problema.

Registrado em `90-BACKLOG.md` B18 como `TRATADO NA MIGRAÇÃO`, o que é verdade para **este**
documento (§3.1.2) e não para o schema alvo.

### C7 — `interactions.seq`: renumerar, e com a ordem do legado

O alvo (§3.2) deixa `seq` como "renumerado ou preservado — decisão 19.5", e nota corretamente que
`UNIQUE (ticket_id, seq)` **não pode** entrar se os números forem preservados.

Preservar é inviável: **12.755 linhas excedentes**, 98,1% no número 1 (`31` §4.3). Preservar
significa abrir mão da `UNIQUE`, que é justamente a constraint cuja ausência causou o problema.

**Recomendo renumerar**, com `legacy_follow_up_number` guardado — que o alvo já prevê. O SQL e o
critério de aceite estão em §5.2.

Uma correção que eu devo a este documento: a ordem de renumeração é
`(recorded_at, id)`, **não** `(recorded_at, follow_up_number, id)` como eu havia escrito. A ordem
verdadeira do legado veio de `my_follow_ups()` (`ORDER BY recorded_at, id`) e a diferença muda o
status final de **37 tickets**. Ver §5.1.

### C8 — `derived_status` sem fallback · **encaminhado, AINDA NÃO CORRIGIDO** · confirmado no legado

Reconferido em 26/09/2026 na versão de 21:22 do `12-backend-schema-alvo.md`: `derived_status`
continua definido apenas como `'novo' | 'em_andamento' | 'concluido'` materializado (R-TKT-24),
**sem nenhuma menção a `legacy_status` como origem**.

Fui verificar se a minha objeção procedia, e **procede**. O legado tem exatamente esse fallback,
em `src/features/services/useStatusTracking.ts:87`:

```js
// Service concluded directly (no follow-ups), set via status field
if (serviceStatus === "concluido" && (!entries || entries.length === 0)) {
  return { label: "Concluído", variant: "done" };
}
```

Medido: **1.220** tickets são exibidos como "Concluído" por esse caminho hoje — concluídos antes
de `service_follow_ups` existir (26/03/2026), sem nenhuma interação registrada. Uma derivação que
olhe só `interactions` os rotula `'novo'`, e 1.220 atendimentos concluídos **aparecem como "Em
Aberto" no dia da virada**.

A regra correta está em §5.1: `COALESCE(status_da_última_interação, legacy_status)`. Como o alvo
mantém `status ticket_status` **e** `derived_status`, a informação necessária já está no schema —
falta a regra de derivação dizer que usa as duas.

**Alerta sobre a prova de paridade proposta pelo alvo.** §7.2 dela define o critério como
"`getCurrentStatus` (browser, legado) × `tickets.derived_status`, diferença 0 em amostra de
1000". Isso **pegaria** o defeito, porque `getCurrentStatus` é justamente a função que tem o
fallback — mas só se a amostra contiver algum dos 1.220. Eles são **1,2%** dos tickets; numa
amostra aleatória de 1.000 a chance de nenhum aparecer é baixa, mas a de aparecerem poucos e
serem tratados como ruído não é.

Sugestão de endurecimento, que custa uma linha: além da amostra, a verificação determinística

```sql
SELECT count(*) FROM novo.tickets t
WHERE t.legacy_status = 'concluido'
  AND NOT EXISTS (SELECT 1 FROM novo.interactions i WHERE i.ticket_id = t.id)
  AND t.derived_status <> 'concluido';
-- critério: 0   (hoje seriam 1.220)
```

### C9 — `interaction_count >= 1` combina com a semântica, e o número fecha

O alvo (§3.1) define `interaction_count` "inclui a criação" com `CHECK (interaction_count >= 1)`.
Isso bate exatamente com `_interaction_events`, que emite um evento `'service'` por ticket mais
um `'follow_up'` por interação (`30` §6). Confirmação:

| | |
|---|---|
| tickets | 102.743 |
| follow-ups | 59.715 |
| eventos esperados | **162.458** |
| agosto/2026, medido pela RPC atual | 19.451 (9.399 + 10.052) |

Sem conflito — registro porque é a verificação R7 e é o número que a gestora vai olhar.

### C10 — `users` sem `auth.users`: o alvo **acerta**, e isso precisa ficar explícito

O alvo (§2.1) deriva `users` de `profiles` **sem** FK para `auth.users`. Está certo, e é
crítico que continue assim: **2 perfis não têm `auth.users`** e carregam **5.665 tickets, 2.617
interações e 302 reembolsos** (`31` §4.8). A FK original era `ON DELETE CASCADE`; se ela
voltasse, esse dado teria sido destruído quando a gestora apagou os dois usuários.

Um alerta sobre o §2.1: ele mantém `handle_new_user` como trigger de `AFTER INSERT` em
`auth.users`. Isso cobre criação, não exclusão. **Nada deve ser acrescentado que apague `users`
quando `auth.users` some.** Registro para que a ausência da FK seja lida como decisão, não como
esquecimento.

### C11 — Constraints do alvo que **passam** sem nenhuma violação

Medidas, porque "não há conflito" também é resultado:

| Constraint proposta | Violações hoje |
|---|---|
| `users.CHECK (NOT can_approve_takeovers OR role='manager')` | **0** |
| `users.CHECK (is_active OR deactivated_at IS NOT NULL)` | **0** (12 inativos, todos com carimbo) |
| `users.email citext UNIQUE` | **0** colisões por caixa |
| `refunds.CHECK (completion_date IS NULL OR (refund_value, refund_type, reason IS NOT NULL))` | **0** — os 1.240 nulos são exatamente as mesmas linhas |
| `refunds.CHECK (refund_value IS NULL OR refund_value >= 0)` | **0** |
| `interactions.CHECK (char_length(note) <= 2000)` | **0** — o máximo real é **820** |
| `tickets` `contact_reason_note ≤ 200` | **0** — o máximo real é exatamente **200** |
| `interactions.CHECK (recorded_at <= now() + 1 min)` | **0** |
| `tickets.product_id` FK resolvida por `lower(name)` | **0** — os 75 produtos em uso existem todos em `products` (86 linhas) |
| `refund_percent` enum `'05%'…'100%'` | **0** — os 20 valores reais são todos múltiplos de 5 |

O de `products` merece destaque: o alvo previa "não achou → cria em `products` no backfill e
registra aviso". **Isso nunca vai disparar** para `services` — os 75 produtos em uso casam
todos. Vai disparar para `refunds`, que tem `MemoryOn` e `SteelPower` (2 linhas, variantes de
caixa de `Memoryon` e `Steelpower`). Como a resolução é por `lower(name)`, **casam também** —
logo zero criações espúrias. Bom desenho.

### C12 — `refunds.order_id`: 148 strings vazias

O alvo (§4.1) mantém `order_id text NOT NULL` com `btrim`, ≤100. Hoje a coluna é `NOT NULL` e
tem **148 linhas com string vazia** após `btrim` (comprimento máximo real: 22).

`NOT NULL` aceita `''`, então não há violação. Mas se alguém acrescentar
`CHECK (btrim(order_id) <> '')` — o que é natural ao endurecer o schema — **148 reembolsos são
rejeitados**. Registro agora para que a decisão seja consciente.

### Resumo dos conflitos — estado em 26/09/2026

| # | Item | Linhas | Estado |
|---|---|---|---|
| C1 | `order_id` obrigatório em ticket de reembolso | **4.985** | aberto — recomendo `NOT VALID` |
| C2 | telefone não normalizado por `lower(btrim())` | **22.446** | **parcial**: desenho fechado por D6; efeito em `90-BACKLOG.md` B5 |
| C3 | enum de `sales_platform` com 8 de 10 valores | **179** | aberto — backend |
| C4 | `reason` fora das 15 categorias → `reason_legacy` | **1.682** | só dimensionamento, sem ação |
| C5 | `completion_date >= request_date` | **40** | aberto — `90-BACKLOG.md` B13 |
| **C6** | **`created_at` precisa de `AT TIME ZONE 'UTC'`** | 5 tabelas | **DEFEITO — não corrigido**; consulta de prova pronta acima |
| C7 | `seq` renumerado, com a ordem `(recorded_at, id)` | **12.755** | recomendação dada; ordem corrigida por mim |
| **C8** | **`derived_status` precisa de fallback em `legacy_status`** | **1.220** | **DEFEITO — não corrigido**; confirmado no código legado |
| C9 | `interaction_count >= 1` fecha com a semântica | — | sem conflito |
| C10 | `users` sem `auth.users` — o alvo acerta | 5.665 | sem conflito; **não acrescentar a FK** |
| C11 | dez constraints que passam com zero violação | — | sem conflito |
| C12 | `order_id` vazio em `refunds` | **148** | aberto — só se endurecerem a constraint |

**C6 e C8 continuam sendo os dois que eu classifico como defeito, não como escolha em aberto**, e
**nenhum dos dois foi corrigido** na revisão de 21:22. O primeiro produz dado silenciosamente
deslocado em 3 horas; o segundo faz 1.220 atendimentos concluídos aparecerem como abertos no dia
da virada. Para ambos deixei, acima, a verificação que transforma "provavelmente está certo" em
"está provado".

Nenhum conflito novo apareceu na revisão. As decisões D4–D7 não criaram conflito com o alvo: D5 e
D6 **simplificaram** a conversão (cópia literal, coluna gerada) e D7 revelou um índice faltando,
não uma divergência — está em §7.4 como proposta, não como objeção.

---

## Lacunas

Estado em 26/09/2026, depois de `00-CONTRATO.md` §8-A.

### Fechadas

| # | Lacuna | Como fechou |
|---|---|---|
| 1 | o schema alvo não existia | `12-backend-schema-alvo.md` publicado. Nomes provisórios deste documento reconciliados: `tickets`, `interactions`, `users`, `interaction_facts`, `daily_rollups`. Conflitos remanescentes na §12 |
| 5 | onde vivem `migration_rejects` / `migration_checks` | `12-backend-schema-alvo.md` §5.4 põe no banco novo. Falta só **quem pode ler** — `payload` carrega dado de cliente |
| 7 | as 3 decisões humanas de `31` §5 | **D4** (dólar), **D5** (`'Nenhum'` distinto), **D6** (e-mail literal + coluna gerada). Regras de conversão reescritas em §3 |

### Abertas

1. **Janela de indisponibilidade** (§1.1): corte único ou corte com delta. Muda a complexidade
   do plano inteiro e continua sem definição. Estimativa de 15–30 min em §9.

2. **Quem aprova a reconciliação, e com que amostra.** `STATUS_DIVERGENCE` tem ~10 mil linhas.
   Ver §6.2.

3. **Prazo de retenção do schema legado depois da virada.** Proponho 30 dias (§10.1).

4. **Se `interaction_facts` congela produto, plataforma e canal** (§7.1, sutileza 1). É mudança
   de comportamento observável nos relatórios históricos. Ver emenda 13.

5. **Invalidação do cache de total** que D7 pressupõe (§7.4). Não é da trilha de dados, mas sem
   critério escrito o total em cache fica errado depois de qualquer correção de data.

6. **`'Logicall'` (1 linha) corrige ou copia literal** (§3.1.3). D5 decidiu sobre semântica, não
   sobre erro de digitação. Sem decisão, o backfill copia literal.

---

## Propostas de emenda

### Emenda 10 — a suíte de reconciliação como critério de saída · **ABERTA**

`00-CONTRATO.md` §8 diz que nenhuma funcionalidade pode desaparecer, e exige inventário de
paridade de cada trilha. Isso cobre **funcionalidade**. Não cobre **dado**.

Um inventário de paridade perfeito convive com um backfill que perdeu 6.778 dias ou 12.755
interações: nenhuma funcionalidade sumiu, mas o número mudou. E número que muda em silêncio é
pior que tela que some, porque ninguém percebe.

Proposta de acréscimo ao §8:

> Além do inventário de paridade, o corte exige um **laudo de reconciliação de dados**: para
> cada tabela migrada, contagem de origem igual a contagem de destino mais rejeitos; e para
> cada métrica publicada hoje, igualdade com a métrica nova no mesmo período. Divergência não
> explicada é bloqueio, não observação.

### Emenda 11 — E12 (derrubar o legado) como etapa nomeada, com prazo · **ABERTA**

O plano acima separa E11 (virar a chave) de E12 (derrubar o legado). Isso não está no contrato,
e sem estar escrito acontece o de sempre: alguém "limpa" o schema velho na semana seguinte
porque está ocupando espaço, e a única rede de segurança some.

São 90 MB. O custo de manter é irrelevante; o custo de não ter é irreversível.

Proposta: E12 é etapa com data, aprovação explícita do dono do projeto, e pré-condição de que
`migration_rejects` não tenha nenhuma linha com `resolution = 'pendente'`.

### Emenda 12 — a ordem canônica de interação deveria ser declarada pelo backend · **PARCIALMENTE RESOLVIDA POR MIM**

A redação original dizia que a ordem `(recorded_at, follow_up_number, id)` era "uma escolha
minha, tomada por compatibilidade com as RPCs atuais", e pedia que a trilha de backend a
declarasse.

**Fui verificar em vez de esperar, e a escolha estava errada.** A ordem do legado é
`(recorded_at, id)`, vinda de `my_follow_ups()`, e a diferença muda o status final de **37
tickets**. Corrigido em §5.1. Ou seja: não era uma escolha em aberto, era um fato observável que
eu não tinha observado.

O que **continua** valendo como emenda: a ordem canônica é **regra de negócio** ("o que conta
como a última interação de um atendimento"), e o contrato §6 atribui regra de negócio à API.
Hoje ela está documentada só aqui. Proposta: `10-backend-regras-atuais.md` declara
`(recorded_at, id)` como regra nomeada, e o backfill a consome em vez de redescobri-la.

Os 69 empates exatos de `recorded_at` continuam com desempate arbitrário por uuid — que é o
mesmo arbitrário do legado, e essa é a propriedade que importa.

### Emenda 13 — `interaction_facts` deveria congelar produto, plataforma e canal · **ABERTA**

Hoje, corrigir o produto de um ticket **reescreve o histórico**: todos os eventos passados dele
mudam de produto, porque `_interaction_events` lê essas colunas do ticket em tempo de consulta
(`30` §6). O relatório de março muda quando alguém corrige um ticket em setembro.

`interaction_facts` materializado resolve isso — mas só se for **deliberado**. Se for
materializado por acidente de implementação, vira divergência inexplicada entre o número velho
e o novo, e alguém vai "consertar" reintroduzindo a leitura em tempo real.

Proposta: o contrato §6, na linha "Estado derivado (…) banco, materializado", ganha:

> Fato de interação é imutável: produto, plataforma e canal são gravados no momento do evento e
> não mudam quando o ticket é corrigido depois. Correção de ticket afeta o ticket, não o
> histórico de métrica.

---

### Emenda 14 — o índice de paginação de `interaction_facts` · **NOVA, decorrente de D7**

D7 manteve a paginação numerada e mandou contar o total sobre a tabela de fatos. Os índices
propostos em `12-backend-schema-alvo.md` §5.2 servem para **contar** e não para **ordenar**:
com faixa de dias na primeira coluna, o btree não entrega ordem por `occurred_at`, e `BRIN` não
entrega ordem nunca. O resultado é um sort do conjunto inteiro a cada página virada.

Proposta, detalhada em §7.4: acrescentar
`idx_facts_time_page (occurred_at DESC, id DESC)` e
`idx_facts_actor_time (actor_id, occurred_at DESC, id DESC)` — o segundo substituindo
`idx_facts_actor_day` —, e a API passar a emitir também o predicado em `occurred_at`, sem o qual
os índices não são usados.

Hoje o custo real é baixo (19.451 fatos por mês). A emenda existe pela trajetória: ~20 mil
fatos/mês, para sempre, na mesma tabela.
