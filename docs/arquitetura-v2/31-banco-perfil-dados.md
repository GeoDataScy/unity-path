# 31 — Perfil dos dados de produção

> Trilha de **dados**. Companion de `30-banco-estado-real.md`. Ali está o *schema*; aqui está
> o *conteúdo*. A regra de conversão de cada coluna depende do que existe de verdade, e o que
> existe de verdade quase nunca é o que o tipo declara.
>
> Somente leitura. Toda agregação rodou **uma por vez**, com
> `SET LOCAL statement_timeout = '15s'` na mesma requisição, e sempre com
> `WITH … AS MATERIALIZED` para varrer a tabela grande **uma única vez** por consulta. Nenhuma
> consulta devolveu mais que algumas centenas de linhas. Nenhuma usou `COUNT(*)` sobre tabela
> grande sem necessidade — mas onde a pergunta era "quantas linhas sujas", `COUNT(*)` é a
> resposta, e a varredura única materializada é o jeito barato de obtê-la.

Data do levantamento: **26/09/2026**, entre 12:51 e 13:10 (horário do servidor).

> **Reconciliado em 26/09/2026 com `00-CONTRATO.md` §8-A.** As três perguntas que este
> documento levantou na seção 5 **foram respondidas** pelo dono do projeto (D4, D5, D6) e a
> seção 5 agora registra as respostas. Os itens de qualidade de dado que ele optou por adiar
> estão em `90-BACKLOG.md` B4–B14 — adiados por decisão, não pendentes por omissão.

> **O banco está vivo.** Entre a primeira e a última consulta, `services` foi de 102.738 para
> 102.743 linhas. Todos os números abaixo são de um instante, não de um congelamento. Onde a
> diferença importa, eu digo qual consulta produziu qual número. Para reconciliação de
> verdade, o backfill precisa de um ponto de corte — ver `32`.

---

## 1. Volume e período por tabela

```sql
-- contagem exata só nas tabelas em que ela é a pergunta; o resto vem de reltuples (ver 30)
SET LOCAL statement_timeout = '15s';
SELECT count(*) FROM services;   -- e análogos
```

| Tabela | linhas | primeiro registro | último registro | coluna de tempo usada |
|---|---|---|---|---|
| `services` | **102.743** | 2026-01-15 | 2026-09-26 | `service_date` (dia SP) |
| `service_follow_ups` | **59.715** | 2026-03-25 16:31 | 2026-09-26 12:55 | `recorded_at` |
| `refunds` | **5.710** | 2025-01-14 † | 2026-09-26 | `request_date` |
| `external_refunds` | 4.026 | 2026-06-01 | 2026-09-25 | `order_date` |
| `ticket_transfers` | 6.096 | — | — | `created_at` |
| `held_orders` | 3.974 | 2025-06-21 | 2026-09-24 | `order_date` |
| `ticket_takeover_requests` | 2.505 | — | — | `created_at` |
| `agent_daily_service_counts` | 1.949 | 2026-01-31 | 2026-09-26 | `updated_at` |
| `refund_reason_classifications` | 5.710 | — | — | `classified_at` |
| `radar_items` | 219 | 2026-08-25 | 2026-09-25 | `created_at` |
| `profiles` | **47** | 2026-01-15 | — | `created_at` |
| `held_order_events` | 3.626 | — | — | `recorded_at` |
| `agent_notes` | 13 | 2026-08-26 | — | `note_date` |
| `refund_manager_completions` | **8** | — | — | `created_at` |
| `service_date_corrections` | **0** | — | — | `corrected_at` |
| `goals` | **1** | — | — | — |
| `products` | 86 | — | — | — |

† `refunds` tem pedidos datados de 2025 e um de ano `0025` — ver 4.2.

Duas linhas dessa tabela mudam decisões de projeto:

- **`service_date_corrections` está vazia.** A RPC `manager_correct_service_date` existe desde
  25/05/2026, tem auditoria dedicada, está exposta na interface — e **nunca foi usada em
  produção**. Quatro meses, zero correções. Isso é o fato central da emenda 1 de `30`.
- **`refund_manager_completions` tem 8 linhas.** O fluxo da gestora concluir reembolso no
  lugar do agente existe e é praticamente inutilizado.

### Crescimento mês a mês

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT to_char((service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS m
  FROM services
), f AS MATERIALIZED (
  SELECT to_char((recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM') AS m
  FROM service_follow_ups
), r AS MATERIALIZED (
  SELECT to_char(request_date::date,'YYYY-MM') AS m FROM refunds
)
SELECT coalesce(a.m,b.m,c.m) AS mes, coalesce(a.n,0) AS tickets,
       coalesce(b.n,0) AS followups, coalesce(c.n,0) AS reembolsos
FROM      (SELECT m,count(*) n FROM s GROUP BY m) a
FULL JOIN (SELECT m,count(*) n FROM f GROUP BY m) b ON b.m = a.m
FULL JOIN (SELECT m,count(*) n FROM r GROUP BY m) c ON c.m = coalesce(a.m,b.m)
ORDER BY 1;
```

| mês | tickets | follow-ups | reembolsos |
|---|---|---|---|
| `0025-11` | 0 | 0 | 1 |
| `1997-04` | **2** | 0 | 0 |
| 2025-01 | 0 | 0 | 2 |
| 2025-08 | 0 | 0 | 2 |
| 2025-09 | 0 | 0 | 1 |
| 2025-10 | 0 | 0 | 10 |
| 2025-11 | 0 | 0 | 28 |
| 2025-12 | 0 | 0 | 46 |
| 2026-01 | 6.864 | 0 | 215 |
| 2026-02 | 12.218 | 0 | 350 |
| 2026-03 | 18.768 | 1.263 | 443 |
| 2026-04 | 15.459 | 7.391 | 583 |
| 2026-05 | 12.966 | 10.346 | 1.061 |
| 2026-06 | 8.041 | 9.952 | 571 |
| 2026-07 | 9.565 | 12.124 | 600 |
| 2026-08 | 9.399 | 10.052 | 972 |
| 2026-09 (parcial) | 9.461 | 8.587 | 825 |

Leitura: ticket teve pico em março (18,7 mil) e estabilizou em ~9,5 mil/mês. Follow-up só
existe a partir de 26/03/2026 — antes disso **a interação não era registrada**, o que significa
que os 37.850 tickets de janeiro a março **não têm histórico de interação nenhum**, e nenhuma
migração pode inventá-lo. Últimos 6 meses: ~9.500 tickets e ~10.500 follow-ups por mês, ou
seja **~20 mil eventos de interação/mês** para o `interaction_facts` do modelo novo.

---

## 2. Valores reais das colunas de baixa cardinalidade

Isto define o `CHECK`/enum do schema novo. **Nada aqui pode ser perdido**: um valor legítimo
que não entre no enum novo é um `INSERT` que passa a falhar ou um dado que passa a virar
rejeito.

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (SELECT status, platform, channel, has_tracking_code,
                               contact_reason, contact_reason_note, order_id FROM services)
SELECT jsonb_pretty(jsonb_build_object(
  'status',   (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(status,'<NULL>'),'n',count(*)) x
                 FROM s GROUP BY status ORDER BY count(*) DESC) q),
  'platform', (SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('v',coalesce(platform,'<NULL>'),'n',count(*)) x
                 FROM s GROUP BY platform ORDER BY count(*) DESC) q)
  -- … idem channel, has_tracking_code, contact_reason
));
```

### 2.1 `services.status` — a coluna é vestigial

| valor | linhas |
|---|---|
| `registered` | 101.469 |
| `concluido` | 1.271 |

**Só dois valores, e o default da coluna (`'pendente'`) não aparece em nenhuma linha.** A
migration original declarou default `'pending'`, depois virou `'pendente'`, e o dado real é
`'registered'`. Ou seja: **quem escreve nessa coluna não usa o default** e o vocabulário está
em duas línguas.

O status que o usuário vê **não vem daqui** — vem do último follow-up. Esta coluna é lixo
histórico que ninguém ousou remover. Quantificado em 4.4.

### 2.2 `services.platform`

| valor | linhas | observação |
|---|---|---|
| `Cartpanda` | 31.440 | |
| **`<NULL>`** | **26.764** | ver 4.1 |
| `Buygoods` | 15.699 | |
| `ClickBank` | 13.299 | |
| `Nenhum` | 10.666 | sentinela textual, não nulo |
| `PagAmerican` | 2.755 | |
| `LogiCall` | 995 | |
| `Digistore24` | 817 | |
| `SalesBound` | 163 | |
| `CartCandy` | 141 | |
| **`Logicall`** | **1** | **erro de caixa** — o certo é `LogiCall` |

Dois problemas de vocabulário, não de volume:

1. **`Logicall` (1 linha) vs `LogiCall` (995).** Sem `CHECK` na coluna, a grafia errada entrou.
   Num enum, essa linha não entra.
2. **`Nenhum` é sentinela.** 10.666 linhas dizem "nenhuma plataforma" com uma *string*, e
   26.764 dizem a mesma coisa com `NULL`. **São dois jeitos de dizer a mesma coisa**, e
   nenhuma métrica sabe disso. **Decidido (D5): permanecem distintos** — ver 5.1.

### 2.3 `services.channel`

| valor | linhas |
|---|---|
| `SMS` | 36.062 |
| **`<NULL>`** | **30.994** |
| `Email` | 30.846 |
| `Clickbank` | 3.710 |
| `Nenhum` | 1.128 |

Note `Clickbank` aqui (minúsculo no b) contra `ClickBank` em `platform`. **Canal e plataforma
compartilham o valor "Clickbank" com grafias diferentes** — e são dimensões diferentes.
Nenhum enum único serve para as duas.

### 2.4 `services.has_tracking_code`

| valor | linhas |
|---|---|
| `false` | 101.642 |
| `true` | **1.098** |

Só 1,1% dos tickets têm código de rastreio, e é **sobre esse 1,1% que várias RPCs aplicam a
exclusão de follow-up no mesmo dia**. A regra é real mas incide em pouquíssimo dado.

### 2.5 `services.contact_reason`

| valor | linhas |
|---|---|
| **`<NULL>`** | **60.344** |
| `duvidas_geral` | 17.501 |
| `duvida_de_envio` | 10.262 |
| `reembolso` | 6.570 |
| `duvida_de_uso` | 3.432 |
| `cancelamento_de_compra` | 2.467 |
| `outro` | 772 |
| `cancelamento_de_assinatura` | 412 |
| `ingredientes` | 351 |
| `troca_de_endereco` | 315 |
| `reclamacao_vsl` | 235 |
| `embalagem_danificada` | 79 |

Todos os 11 valores do `CHECK` estão em uso — nenhum é letra morta. Os 60.344 nulos são
tickets criados antes do campo existir; o `CHECK` já admite `NULL` explicitamente, então o
modelo novo **precisa** manter o motivo opcional, ou 59% dos tickets não migram.

`contact_reason_note` preenchida: **809** linhas (772 de `outro` + 37 de `reclamacao_vsl`), o
que casa exatamente com o `CHECK` condicional documentado em `30`.

### 2.6 `services.product`

**86 produtos no `CHECK`; 75 em uso.** Onze entradas do `CHECK` nunca receberam um ticket.
A distribuição é muito concentrada:

| produto | tickets |
|---|---|
| `Steelpower` | 19.074 |
| `Presgera` | 15.968 |
| `Garaherb` | 10.114 |
| `Horsefil` | 5.607 |
| `NerveEase` | 5.485 |
| `Memoryon` | 4.149 |
| `Memyts` | 4.135 |
| `Thewellnesswize` | 4.060 |
| `Shapeon` | 3.785 |
| `Mahgryn` | 3.633 |
| `Laellium` | 3.173 |
| `Honeyfil` | 3.169 |
| `Arialief` | 2.807 |
| `Jellyrock` | 2.666 |
| `Quiet Nerves` | 2.461 |
| `Karylief` | 1.767 |
| `Glyco Barrier` | 1.410 |
| `Alphacur` | 1.238 |
| `Blinzador` | 1.113 |
| `Gluco Off` | 976 |
| … | … |

Cauda: 10 produtos com **1 ou 2 tickets** (`Honey Vital`, `Cardio Honey`, `Ariomyx`, `Levhyn`,
`Maizkidor`, `Mioralab`, `Ceramiri`, `Ariovira`, `Zalovira`, `Hair Bloom`). Um produto com 1
ticket ainda é produto: não pode sair do vocabulário.

**Divergência entre tabelas.** `refunds.product` é texto livre e contém duas grafias que
`services` recusaria:

```sql
SELECT r.product, count(*) FROM refunds r
WHERE r.product IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.product = r.product)
GROUP BY r.product;
```

| `refunds.product` | linhas | grafia correta em `services` |
|---|---|---|
| `MemoryOn` | 1 | `Memoryon` |
| `SteelPower` | 1 | `Steelpower` |

Só 2 linhas, mas provam o ponto: **a tabela com `CHECK` está limpa e a sem `CHECK` não está.**
`radar_items.product` não tem nenhuma divergência (219 linhas, todas casando).

### 2.7 `service_follow_ups.status`

| valor | linhas |
|---|---|
| `em_andamento` | 45.622 |
| `concluido` | 14.088 |

Dois valores. O default é `'em_andamento'`, coerente. **Este é o vocabulário real de status do
ticket** — o `services.status` da 2.1 é o falso.

`is_same_day_repeat`: `false` 58.014 · `true` **1.696** (2,8%).

`follow_up_number`: mínimo 1, máximo **21**, nenhum ≤ 0.

### 2.8 `refunds.refund_type` — percentual como texto

21 valores distintos, todos no formato `NN%`, mais 1.240 nulos:

| valor | n | | valor | n |
|---|---|---|---|---|
| `<NULL>` | **1.240** | | `45%` | 123 |
| `80%` | 960 | | `20%` | 107 |
| `100%` | 881 | | `65%` | 83 |
| `50%` | 534 | | `55%` | 82 |
| `30%` | 436 | | `35%` | 77 |
| `40%` | 396 | | `90%` | 21 |
| `75%` | 275 | | `10%` | 16 |
| `60%` | 256 | | **`05%`** | **16** |
| `70%` | 175 | | `25%` | 13 |
| | | | `85%` | 12 |
| | | | `15%` | 6 |
| | | | `95%` | 1 |

**`05%` (16 linhas) é zero-padded** e nenhum outro valor é. A regex
`^\d{1,3}%$` de `my_refunds_with_refunded_value()` aceita, e `replace('05%','%','')::numeric`
dá 5, então o cálculo está certo hoje. Mas se o alvo for `numeric`, `05%` e `5%` colapsam no
mesmo valor — o que é **correto** e é o argumento para converter.

### 2.9 `refunds.sales_platform`

| valor | linhas | observação |
|---|---|---|
| `Cartpanda` | 2.397 | |
| `Buygoods` | 1.452 | |
| `ClickBank` | 1.414 | |
| **`Hotmart`** | **143** | **não existe em `services.platform`** |
| `PagAmerican` | 138 | |
| `LogiCall` | 59 | |
| `SalesBound` | 45 | |
| `Nenhum` | 36 | sentinela |
| `CartCandy` | 22 | |
| `Digistore24` | 4 | |

**`Hotmart` só existe em reembolso.** Nenhum ticket foi registrado com essa plataforma. Se o
schema novo unificar plataforma num enum só, ele precisa dos 10 valores de `refunds` **mais**
os 11 de `services` — e `Hotmart` é o valor que se perderia se alguém derivasse o enum só de
`services`.

Sem nulos: a coluna é `NOT NULL` e todas as 5.710 linhas têm valor.

### 2.10 `refunds.channel` e `items_returned`

`channel`: `Email` 2.655 · `SMS` 1.443 · `Clickbank` 865 · `<NULL>` 747.
Mesmo vocabulário de `services.channel` **menos `Nenhum`** — aqui a ausência é sempre `NULL`.
Mais uma inconsistência de sentinela entre tabelas irmãs.

`items_returned`: `false` 5.320 · `true` 390. `NOT NULL`, sem nulo.

### 2.11 `held_orders`

| coluna | valores |
|---|---|
| `status` | `pending` 2.359 · `confirmed` 1.615 |
| `agent_status` | `concluido` 1.615 · `em_andamento` 1.349 · `novo` 1.010 |
| `pending_tag` | `<NULL>` 3.151 · `aguardando_cliente` 782 · `outra` 26 · `aguardando_transportadora` 8 · `pedido_nao_encontrado` 7 |

`status` e `agent_status` estão **perfeitamente correlacionados** nos concluídos:
`confirmed` = 1.615 = `concluido`. São duas colunas contando a mesma coisa em vocabulários
diferentes (inglês/português). Candidato a unificação — mas é decisão do dono, não minha.

Outros: `duplicate_of` preenchido em 294 · `assigned_to` nulo em 15 · `order_number` nulo em
130 · `email` nulo em **28** · `email` com maiúscula em **167**.

### 2.12 `radar_items`

| `status` | n | | `kind` | n |
|---|---|---|---|---|
| `resolvido` | 121 | | `logistica` | 75 |
| `aberto` | 55 | | `reenvio` | 51 |
| `aguardando_logistica` | 22 | | `on_hold` | 24 |
| `aguardando_cliente` | 11 | | `devolucao` | 22 |
| `em_andamento` | 10 | | `correcao_endereco` | 21 |
| | | | `outros` | 12 |
| | | | `rma` | 9 |
| | | | `reenvio_endereco` | 3 |
| | | | `novo_rastreio` | 2 |

Os 6 valores de `status` do `CHECK`: `cancelado` **não aparece** (0 linhas). Os 9 de `kind`:
todos em uso. E-mails 100% limpos (nenhum com espaço, nenhum com maiúscula) — é a tabela mais
nova e a única com índice único normalizado, e isso se vê no dado.

### 2.13 `profiles`

| `role` | n |
|---|---|
| `agent` | 24 |
| `manager` | 11 |
| `copy_grup` | 11 |
| `produto` | 1 |

**`support_channel`: `email` em todas as 47 linhas.** O `CHECK` admite `sms` e **nenhum perfil
usa**. Mas `services.channel = 'SMS'` tem 36 mil tickets. Ou seja **a coluna não significa o
que o nome diz** e está morta. Não confundir com o canal do atendimento.

Flags: `is_active` 35 de 47 · `is_available` 26 · `can_register_duplicate_emails` 3 ·
`can_claim_tickets` **1** · `can_approve_takeovers` **1** · `can_view_all_tickets` **0**.

**`can_view_all_tickets` está em zero.** A capacidade existe, tem 5 policies dependendo dela
em `30`, e **nenhum usuário a tem hoje**. É funcionalidade viva no código e desligada na
operação — não pode ser removida por parecer sem uso.

### 2.14 `refund_reason_classifications.category` — 15 categorias

| categoria | n |
|---|---|
| `Outros` | 1.682 |
| `Insatisfação com o produto` | 1.437 |
| `Produto não funcionou como esperado` | 901 |
| `Compra em excesso` | 458 |
| `Indicação médica / efeitos colaterais` | 443 |
| `Arrependimento de compra` | 270 |
| `Atraso na entrega/acesso` | 169 |
| `Follow up (sem motivo declarado)` | 120 |
| `Risco de chargeback` | 102 |
| `Compra duplicada` | 39 |
| `Reclamação VSL / Propaganda` | 37 |
| `Problemas técnicos` | 21 |
| `Não reconhece a compra` | 21 |
| `Dificuldade de uso` | 7 |
| `Cobrança recorrente` | 3 |

Soma = 5.710 = total de `refunds`. **Cobertura 100%**, sem classificação órfã e sem reembolso
sem classificação. A trigger `sync_refund_reason_classification` funciona. Note que a coluna
**não tem `CHECK`**: as 15 categorias são produto da função `classify_refund_reason`, não do
schema. `Outros` com 29% indica que a classificação automática acerta pouco mais de dois terços.

### 2.15 Outras tabelas de estado

`ticket_transfers.status`: `accepted` 5.554 · `pending` **443** · `declined` 99 · `cancelled` 0.
`ticket_takeover_requests.status`: `approved` 2.503 · `pending` 2 · `rejected` 0 · `cancelled` 0.
`agent_notes.kind`: `nota` 10 · `tarefa` 3.
`external_refunds.platform`: `Buygoods` 1.773 · `Cartpanda` 1.331 · `PagAmerican` 922.
`external_refunds.payment_status`: `Refunded (unspecified)` 1.901 · `Refunded` 1.071 ·
`Partially refunded` 1.054.

`cancelled` e `rejected` estão em zero em ambas as tabelas de fluxo. São estados alcançáveis
pelo código e nunca alcançados. Mantêm-se.

---

## 3. Formatos reais das colunas `text` que serão convertidas

### 3.1 `services.service_date` — duas eras, e a conversão ingênua erra 6.778 tickets

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (SELECT service_date FROM services)
SELECT count(*) FILTER (WHERE service_date ~ '^\d{4}-\d{2}-\d{2}T00:00:00-03:00$') AS canonico,
       count(*) FILTER (WHERE service_date !~ '^\d{4}-\d{2}-\d{2}T00:00:00-03:00$') AS fora,
       count(*) FILTER (WHERE service_date IS NULL OR btrim(service_date)='')        AS nulo
FROM s;
```

| | linhas | % |
|---|---|---|
| casa `^\d{4}-\d{2}-\d{2}T00:00:00-03:00$` | **80.418** | 78,3% |
| **não** casa | **22.320** | 21,7% |
| nulo ou vazio | **0** | 0% |

E as 22.320 exceções são **um único formato**, não um zoológico:

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT service_date FROM services
  WHERE service_date !~ '^\d{4}-\d{2}-\d{2}T00:00:00-03:00$'
), cls AS (
  SELECT CASE
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$'      THEN 'A: +00:00'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+00:00$' THEN 'B: ms +00:00'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'            THEN 'C: Z'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$'       THEN 'E: hora nao-zero -03:00'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2}$'                               THEN 'F: so a data'
    WHEN service_date ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'              THEN 'G: espaco em vez de T'
    ELSE 'Z: OUTRO' END AS fmt, service_date
  FROM s
)
SELECT fmt, count(*) AS n, min(service_date) AS ex_min, max(service_date) AS ex_max
FROM cls GROUP BY fmt ORDER BY n DESC;
```

| formato | linhas | exemplo mínimo | exemplo máximo |
|---|---|---|---|
| `A: YYYY-MM-DDTHH:MM:SS+00:00` | **22.320** | `2026-01-15T00:00:00+00:00` | `2026-03-10T03:00:00+00:00` |
| todos os outros | **0** | — | — |

**Uma única exceção, e ela datA a conversão.** Todas as 22.320 linhas com `+00:00` vão de
15/01/2026 (primeiro dia do sistema) a **10/03/2026**. Nenhuma depois. Nenhuma linha
`-03:00` antes. Ou seja:

> A coluna era `timestamptz`, foi convertida para `text` em **10/03/2026** (o cast gravou o
> valor renderizado em UTC, `+00:00`), e a trigger `trg_service_pin_date_on_insert` — que grava
> `-03:00` literal — entrou em vigor **no mesmo momento**.

Isso fecha a janela que `30` §11.1 tinha estimado em "entre 31/01 e 26/03" para **um dia**.

**O perigo concreto.** Para uma linha `+00:00`, o prefixo de 10 caracteres **não é** o dia de
São Paulo:

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (
  SELECT substring(service_date,1,10)::date AS dia_texto,
         (service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS dia_sp
  FROM services
)
SELECT (dia_texto - dia_sp) AS delta, count(*) FROM s GROUP BY 1 ORDER BY 1;
```

| `dia_texto − dia_sp` | linhas |
|---|---|
| 0 | 95.961 |
| **+1** | **6.778** |

**6.778 tickets (6,6%) seriam datados um dia adiante** por uma conversão que fizesse
`substring(service_date,1,10)::date`. São exatamente as linhas `+00:00` cuja hora UTC está
entre 00:00 e 02:59, que em São Paulo (UTC−3) caem no dia anterior.

**Regra obrigatória de conversão:**

```sql
-- CORRETO
(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
-- ERRADO — erra 6.778 tickets
substring(service_date, 1, 10)::date
left(service_date, 10)::date
service_date::date
```

Todas as RPCs atuais já usam a forma correta (ver `_interaction_events` em `30` §6), então as
métricas de hoje estão certas. O risco é o backfill escolher o atalho.

### 3.2 `services` — ids e e-mails

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (SELECT id, user_id, current_owner_id, client_email FROM services)
SELECT count(*) FILTER (WHERE id      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS id_ok,
       count(*) FILTER (WHERE id      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS id_ruim,
       count(*) FILTER (WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS user_ruim,
       count(*) FILTER (WHERE current_owner_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS owner_ruim
FROM s;
```

| coluna | uuid válido | inválido |
|---|---|---|
| `services.id` | **102.738 / 102.738** | **0** |
| `services.user_id` | 102.738 / 102.738 | **0** |
| `services.current_owner_id` | 102.738 / 102.738 | **0** |
| `service_follow_ups.id` | 59.710 / 59.710 | **0** |
| `service_follow_ups.service_id` | 59.710 / 59.710 | **0** |
| `service_follow_ups.user_id` | 59.710 / 59.710 | **0** |
| `refunds.id` | 5.710 / 5.710 | **0** |
| `refunds.user_id` | 5.710 / 5.710 | **0** |
| `profiles.id` | 47 / 47 | **0** |

> **Todos os ids `text` do banco são uuid textualmente válidos. Zero exceções.**

Esta é a melhor notícia do levantamento e é o que sustenta a emenda 3 de `30`:
`id::uuid` é uma conversão **sem perda, sem colisão e sem reemissão**. Nenhuma linha precisa
de id novo.

### 3.3 `refunds.request_date` e `completion_date` — ISO puro, com anos absurdos

A suspeita era texto livre até maio/2026. **Não se confirma para as colunas de data:**

```sql
SET LOCAL statement_timeout = '15s';
WITH r AS MATERIALIZED (SELECT request_date, completion_date FROM refunds)
SELECT count(*) FILTER (WHERE request_date ~ '^\d{4}-\d{2}-\d{2}$')    AS req_iso,
       count(*) FILTER (WHERE request_date !~ '^\d{4}-\d{2}-\d{2}$')   AS req_fora,
       count(*) FILTER (WHERE text_to_date_safe(request_date) IS NULL) AS req_nao_castavel,
       count(*) FILTER (WHERE completion_date IS NULL)                                    AS fim_nulo,
       count(*) FILTER (WHERE completion_date ~ '^\d{4}-\d{2}-\d{2}$')                    AS fim_iso,
       count(*) FILTER (WHERE completion_date IS NOT NULL
                          AND completion_date !~ '^\d{4}-\d{2}-\d{2}$')                   AS fim_fora
FROM r;
```

| | linhas |
|---|---|
| `request_date` no formato `YYYY-MM-DD` | **5.710 / 5.710 (100%)** |
| `request_date` fora do formato | **0** |
| `request_date` não convertível por `text_to_date_safe` | **0** |
| `completion_date` nulo | 1.240 |
| `completion_date` no formato `YYYY-MM-DD` | **4.470 / 4.470 (100% dos não-nulos)** |
| `completion_date` fora do formato | **0** |
| `completion_date` string vazia | **0** |

**As duas colunas são 100% ISO.** O texto livre que existe até maio/2026 está em
`refund_reason_classifications.original_reason` e em `refunds.reason` — **não nas datas**.
A conversão `::date` é direta.

**Mas o ano pode ser absurdo.** Formato válido não é valor válido:

| coluna | valor | linhas | leitura |
|---|---|---|---|
| `request_date` | `0025-11-14` | 1 | digitaram `25` no ano |
| `completion_date` | `0026-02-02` | 1 | digitaram `26` no ano |
| `completion_date` | `0026-02-04` | 1 | digitaram `26` no ano |
| `completion_date` | `2025-03-18` | 1 | ano anterior ao pedido (`2025-10-01`) |

Além disso **89 reembolsos legítimos datados de 2025** (ago a dez/2025): são pedidos antigos
cujo reembolso foi pedido antes do sistema existir, lançados retroativamente. **Não são
sujeira** — o sistema começou em 15/01/2026 mas o negócio, não.

### 3.4 `client_email` não é um e-mail — é um contato polimórfico

```sql
SET LOCAL statement_timeout = '15s';
WITH s AS MATERIALIZED (SELECT client_email, channel FROM services)
SELECT coalesce(channel,'<NULL>') AS canal,
       count(*) FILTER (WHERE client_email NOT LIKE '%@%') AS sem_arroba,
       count(*) FILTER (WHERE client_email LIKE '%@%')     AS com_arroba
FROM s GROUP BY channel ORDER BY count(*) DESC;
```

| canal | sem `@` | com `@` |
|---|---|---|
| `SMS` | **22.446** | 13.616 |
| `<NULL>` | 0 | 30.994 |
| `Email` | 0 | 30.852 |
| `Clickbank` | 0 | 3.710 |
| `Nenhum` | 0 | 1.128 |

E o formato dos 22.446:

| formato | linhas |
|---|---|
| telefone (`^\+?[\d\s\(\)\-]{8,20}$`) | **22.446 (100%)** |
| qualquer outra coisa | **0** |

> **Os 22.446 valores sem `@` são todos números de telefone, e todos estão no canal `SMS`.
> Zero exceções nos dois sentidos.**

Isto não é dado sujo. É uma **coluna com dois significados**: `client_email` guarda e-mail
quando o canal é e-mail e telefone quando o canal é SMS. A coluna é `NOT NULL` e chama-se
`client_email`, e 22% do conteúdo não é e-mail.

Consequências que o schema novo precisa encarar:

- **Validação de e-mail na coluna quebraria 22.446 linhas.** Um `CHECK (email LIKE '%@%')` no
  modelo novo é um backfill que falha.
- `idx_services_lower_trim_email` e a busca por e-mail operam sobre telefone também — e
  telefone tem grafia variável (`+1 (555) 123-4567` vs `15551234567`), então **a
  deduplicação por "e-mail" é frágil justamente no canal com mais volume**.
- A regra de negócio de duplicidade (`can_register_duplicate_emails`) compara
  `lower(btrim(client_email))`, o que para telefone só casa se a grafia for idêntica.

Higiene do campo:

| verificação | linhas |
|---|---|
| com espaço nas bordas | **0** |
| com maiúscula | **1.501** |
| vazio | 0 |
| distintos, como estão | 69.951 |
| distintos, normalizados (`lower(btrim(...))`) | 69.772 |
| valores normalizados que colidem só por caixa | **179** |
| clientes (normalizados) atendidos por **2+ agentes** | **8.888** |

Os 179 são pares como `João@x.com` / `joao@x.com`: **hoje são clientes diferentes** para o
índice e para a regra de duplicidade, e no modelo novo normalizado virariam o mesmo. Isso
mudaria o resultado da regra de duplicidade retroativamente. **Decidido (D6): preservar as
duas grafias**, normalizando só em coluna gerada — ver 5.3.

Em `refunds`: 150 e-mails com maiúscula, 0 com espaço. Em `held_orders`: 167 com maiúscula,
28 nulos. Em `radar_items`: **0 e 0** (tem índice normalizado).

---

## 4. Inventário de dado sujo, quantificado

Cada item traz a consulta reexecutável e a **proposta de destino**. Os destinos possíveis são:

- **converter** — passa direto, sem marca;
- **converter com marca** — passa, mas com bandeira numa coluna de qualidade, para a operação
  poder filtrar e revisar depois;
- **rejeito auditável** — não entra na tabela principal; vai para `migration_rejects` com
  motivo, e é revisado por pessoa;
- **decisão humana** — bloqueia até o dono do projeto decidir; não tenho autoridade.

**Nada é descartado em nenhum cenário.**

### 4.1 Tickets sem plataforma — 26.764 (esperado ~26.772, confirmado)

```sql
SET LOCAL statement_timeout = '15s';
SELECT count(*) FILTER (WHERE platform IS NULL)                AS nulo,
       count(*) FILTER (WHERE platform = 'Nenhum')             AS sentinela_nenhum,
       count(*) FILTER (WHERE platform IS NULL
                          OR platform = 'Nenhum')              AS sem_plataforma_efetiva
FROM services;
```

| | linhas |
|---|---|
| `platform IS NULL` | **26.764** |
| `platform = 'Nenhum'` | **10.666** |
| sem plataforma de fato | **37.430 (36,4%)** |

O número esperado (~26.772) se confirma para o nulo. Mas o número que importa é **37.430**,
porque `NULL` e `'Nenhum'` significam a mesma coisa e são contados diferente por qualquer
métrica que agrupe por plataforma.

Distribuição no tempo: os nulos são quase todos anteriores à introdução do campo. Não é erro
de digitação, é campo que não existia.

**Destino: converter literalmente, sem normalizar.** Decisão **D5** de
`00-CONTRATO.md` §8-A: os 10.666 `'Nenhum'` e os 26.764 vazios **permanecem distintos**. O dono
decidiu não unificar e não apagar, porque a diferença entre "verifiquei e não há" e "ninguém
preencheu" é informação.

Consequência para a travessia: `platform` é **cópia literal**, `'Nenhum'` inclusive. Não há
normalização, não há coluna-sentinela, e **não há rejeito por este motivo**. A regra em
`32-banco-migracao.md` §3.1.3 foi reescrita de acordo. O item fica em `90-BACKLOG.md` B9.

O que **não** muda com D5: as duas grafias de `LogiCall`/`Logicall` continuam sendo erro de
digitação, não semântica (1 linha contra 995). Ver 2.2.

### 4.2 Datas absurdas

```sql
SET LOCAL statement_timeout = '15s';
-- services
WITH s AS MATERIALIZED (
  SELECT id, service_date, product, channel,
         (service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS dia
  FROM services)
SELECT id, dia, service_date, product, channel FROM s
WHERE dia < '2026-01-01' OR dia > current_date;
```

| tabela | valor | linhas | detalhe |
|---|---|---|---|
| `services.service_date` | dia SP = `1997-04-28` | **2** | `1997-04-28T00:00:00-03:00`, produtos `Presgera` e `Steelpower`, canal `Email` |
| `services.service_date` | dia SP > hoje | **0** | — |
| `refunds.request_date` | `0025-11-14` | 1 | |
| `refunds.completion_date` | `0026-02-02`, `0026-02-04` | 2 | |
| `refunds.completion_date` | `2025-03-18` (pedido em `2025-10-01`) | 1 | |

Os 2 tickets de 1997 estão no formato **canônico `-03:00`**, o que prova que **não** vieram da
trigger (ela sempre grava hoje): vieram de `INSERT` com
`ALTER TABLE services DISABLE TRIGGER trg_service_pin_date_on_insert`, isto é, de um backfill
de planilha. `1997` é quase certamente `2026` digitado errado, mas **eu não tenho como provar
qual era a data pretendida.**

**Destino: decisão humana.** São 6 linhas no total. Um humano olha as 6, diz a data certa, e
elas convertem. Adivinhar a data de um atendimento é inventar dado. Enquanto não houver
decisão: **rejeito auditável**, com o valor original preservado em `legacy_*`.

### 4.3 `follow_up_number` duplicado — 12.755 linhas excedentes (esperado ~12.602, confirmado)

```sql
SET LOCAL statement_timeout = '15s';
WITH f AS MATERIALIZED (SELECT service_id, follow_up_number FROM service_follow_ups)
SELECT count(*)                          AS pares_duplicados,
       coalesce(sum(c-1),0)              AS linhas_excedentes
FROM (SELECT service_id, follow_up_number, count(*) AS c
      FROM f GROUP BY 1,2 HAVING count(*) > 1) d;
```

| | valor |
|---|---|
| pares `(service_id, follow_up_number)` com mais de uma linha | **5.544** |
| linhas excedentes (total − 1 por par) | **12.755** |

Concentração por número:

| `follow_up_number` | excedentes | % do total |
|---|---|---|
| **1** | **12.514** | **98,1%** |
| 2 | 176 | 1,4% |
| 3 | 48 | 0,4% |
| 4 | 7 | |
| 5 | 3 | |
| 6–18 | 7 | |

98,1% em número 1 (a expectativa era 96% — a proporção subiu). O padrão é inequívoco: **a
numeração não é atribuída pelo banco**. Não há `UNIQUE`, não há sequência, não há trigger que
calcule `follow_up_number` — o cliente manda o número, e quando ele não sabe qual é (leitura
falhou, corrida entre duas abas, retry de rede) ele manda **1**. O incidente de status "todo
ticket aparece como Novo" é exatamente isso: o cliente que não conseguiu ler o histórico
escreve interação como se fosse a primeira.

**Destino: converter, renumerando.** Nenhuma linha é rejeito: cada linha é uma interação real
que aconteceu. O que é lixo é o *número*, não a linha. No modelo novo, `seq` é derivado:

```sql
row_number() OVER (PARTITION BY service_id ORDER BY recorded_at, id)
```

e `follow_up_number` legado é preservado em `legacy_follow_up_number` para auditoria. Ver `32`
para a regra de empate.

### 4.4 Tickets "concluídos na tela, abertos no banco" — 10.087 (esperado ~6.042: **cresceu**)

```sql
SET LOCAL statement_timeout = '15s';
WITH ult AS MATERIALIZED (
  SELECT DISTINCT ON (f.service_id) f.service_id, f.status AS ult_status
  FROM service_follow_ups f
  ORDER BY f.service_id, f.recorded_at DESC, f.follow_up_number DESC, f.id DESC
)
SELECT s.status AS services_status,
       coalesce(u.ult_status,'<sem follow-up>') AS ultimo_followup,
       count(*)
FROM services s LEFT JOIN ult u ON u.service_id = s.id
GROUP BY 1,2 ORDER BY count(*) DESC;
```

| `services.status` | último follow-up | linhas |
|---|---|---|
| `registered` | *sem follow-up* | **71.784** |
| `registered` | `em_andamento` | 19.599 |
| **`registered`** | **`concluido`** | **10.087** ← os fantasmas |
| `concluido` | *sem follow-up* | 1.220 |
| `concluido` | `em_andamento` | **28** ← o inverso |
| `concluido` | `concluido` | 23 |

| medida | valor |
|---|---|
| concluído na tela, aberto no banco | **10.087** |
| concluído no banco, aberto na tela (inverso) | **28** |
| concluído no banco, sem nenhum follow-up | 1.220 |
| tickets **sem nenhum** follow-up | **73.004 (71%)** |
| tickets com ao menos um follow-up | 29.737 |

**O número esperado era ~6.042 e hoje é 10.087.** A divergência não é erro de medição — ela
**cresce continuamente**, porque `services.status` nunca é atualizado quando uma interação
conclui o ticket. Cada conclusão nova soma um fantasma. Isso torna o item mais urgente, não
menos: a 6 mil em julho, 10 mil em setembro, o ritmo é ~2 mil/mês.

Note também os **28 casos inversos** e os **1.220 `concluido` sem follow-up nenhum** — esses
últimos são tickets concluídos antes de 26/03/2026, quando não havia tabela de follow-up. Para
eles `services.status` é a **única** fonte de verdade, e descartá-lo perderia 1.220 conclusões.

**Destino: converter com derivação, preservando as duas fontes.** O `status` do modelo novo é
derivado do último evento **quando existe evento**, e cai para `services.status` quando não
existe. Ambos os valores de origem ficam em `legacy_status` e `legacy_derived_status`, e as
10.087 + 28 divergências viram linhas em `migration_checks` para a gestora conferir por
amostragem. Regra completa em `32`.

### 4.5 Ambiguidade na derivação do status — 216 tickets

```sql
SET LOCAL statement_timeout = '15s';
WITH f AS MATERIALIZED (SELECT service_id, status, recorded_at, follow_up_number, id
                        FROM service_follow_ups),
por_num AS (SELECT DISTINCT ON (service_id) service_id, status AS st FROM f
            ORDER BY service_id, follow_up_number DESC, recorded_at DESC, id DESC),
por_tempo AS (SELECT DISTINCT ON (service_id) service_id, status AS st FROM f
              ORDER BY service_id, recorded_at DESC, follow_up_number DESC, id DESC)
SELECT (SELECT count(*) FROM por_num a JOIN por_tempo b USING (service_id) WHERE a.st <> b.st)
         AS as_duas_ordens_discordam,
       (SELECT count(*) FROM (SELECT service_id, recorded_at FROM f
          GROUP BY 1,2 HAVING count(*)>1 AND count(DISTINCT status)>1) z)
         AS empates_com_status_divergente;
```

| medida | valor |
|---|---|
| fantasmas ordenando por `recorded_at` | 10.087 |
| fantasmas ordenando por `follow_up_number` | **9.994** |
| tickets em que as duas ordens **discordam** do status final | **216** |
| tickets com empate exato de `recorded_at` | 85 |
| linhas envolvidas nesses empates | 171 |
| empates em que as linhas empatadas **discordam** do status | **69** |

Isto é o custo exato da ambiguidade. Não é hipotético: **216 tickets têm dois status finais
defensáveis**, e em **69 deles duas interações registradas no mesmo instante discordam** sobre
se o atendimento acabou.

**Destino: converter com regra determinística + marca.** `32` fixa a ordem
`(recorded_at, follow_up_number, id)` — a mesma que as RPCs de hoje usam, para que o número
novo reproduza o número velho. Os 216 recebem marca de ambiguidade; os 69 empates vão também
para `migration_checks`, porque ali a ordem é literalmente arbitrária.

### 4.6 E-mails com caixa inconsistente — 1.501 em `services`, 179 colisões

| tabela | com maiúscula | com espaço | colisões só por caixa |
|---|---|---|---|
| `services.client_email` | **1.501** | 0 | **179** |
| `refunds.customer_email` | **150** | 0 | — |
| `held_orders.email` | **167** | 0 (28 nulos) | — |
| `radar_items.client_email` | 0 | 0 | 0 |
| `profiles.email` | 0 | 0 | 0 |

**Nenhuma tabela tem e-mail com espaço nas bordas.** A sujeira é só de caixa.

**Destino: preservar o original intacto; normalizar só em coluna gerada.** Decisão **D6** de
`00-CONTRATO.md` §8-A: o valor digitado **nunca é sobrescrito**, e as 179 colisões por caixa
**não são resolvidas agora**.

A normalização existe como **coluna gerada**, usada apenas para índice e comparação:

```sql
client_email            text  NOT NULL                    -- exatamente como digitado
client_email_normalized citext GENERATED ALWAYS AS (lower(btrim(client_email))) STORED
```

Isso é mais forte que a minha proposta original de duas colunas gravadas: coluna gerada não
pode divergir do original por bug de escrita, porque não é escrita.

As **179 colisões** continuam sendo dois clientes distintos no dado e o **mesmo** cliente para
o índice normalizado — que é exatamente o comportamento pedido. Elas viram
`migration_checks` como **informação**, não como pendência de conversão: nada precisa ser
decidido para o backfill rodar. Ver `90-BACKLOG.md` B10.

### 4.7 Integridade referencial — melhor que o esperado

```sql
SET LOCAL statement_timeout = '15s';
SELECT (SELECT count(*) FROM service_follow_ups f
          WHERE NOT EXISTS (SELECT 1 FROM services s  WHERE s.id = f.service_id)) AS fu_service_orfao,
       (SELECT count(*) FROM service_follow_ups f
          WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = f.user_id))     AS fu_user_orfao,
       (SELECT count(*) FROM refunds r
          WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = r.user_id))     AS rf_user_orfao,
       (SELECT count(*) FROM refunds r WHERE r.service_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM services s WHERE s.id = r.service_id))    AS rf_service_orfao,
       (SELECT count(*) FROM ticket_transfers t
          WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.id = t.service_id))  AS tr_service_orfao;
```

| verificação | órfãos |
|---|---|
| `service_follow_ups.service_id` → `services` | **0** (FK garante) |
| `service_follow_ups.user_id` → `profiles` | **0** ← e **não há FK**; está limpo por sorte |
| `refunds.user_id` → `profiles` | **0** |
| `refunds.service_id` → `services` | **0** |
| `ticket_transfers.service_id` → `services` | **0** |
| `user_roles.user_id` → `profiles` | **0** |
| `refund_reason_classifications.refund_id` → `refunds` | **0** |

Zero órfãos em tudo. Mas há o inverso, e é sério:

### 4.8 Perfis sem usuário de autenticação — 2 perfis, 5.665 tickets

```sql
SET LOCAL statement_timeout = '15s';
SELECT p.id, p.email, p.full_name, p.role::text, p.is_active, p.created_at,
  (SELECT count(*) FROM services s WHERE s.user_id = p.id)            AS tickets_criados,
  (SELECT count(*) FROM services s WHERE s.current_owner_id = p.id)   AS tickets_em_posse,
  (SELECT count(*) FROM service_follow_ups f WHERE f.user_id = p.id)  AS followups,
  (SELECT count(*) FROM refunds r WHERE r.user_id = p.id)             AS reembolsos
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = p.id);
```

| perfil | role | ativo | tickets criados | em posse | follow-ups | reembolsos |
|---|---|---|---|---|---|---|
| `Aguida` (`65b7968a-…`) | `agent` | **false** | **5.380** | 5.206 | 2.112 | **302** |
| `Maria` (`95b2268f-…`) | `agent` | **false** | 285 | 284 | 505 | 0 |
| **total** | | | **5.665** | 5.490 | **2.617** | **302** |

| | |
|---|---|
| `profiles` | 47 |
| `auth.users` | 45 |
| perfis sem `auth.users` | **2** |
| `auth.users` sem perfil | **0** |

Os dois são agentes **desativados** cujo usuário de autenticação foi **apagado** (via
`manager_delete_auth_user`), e cujo perfil sobreviveu.

**E isso é uma feature, não um defeito.** A migration original tinha
`id UUID REFERENCES auth.users(id) ON DELETE CASCADE`. Se aquela FK ainda existisse, apagar a
Aguida do `auth` teria **apagado em cascata 5.380 tickets, 2.112 follow-ups e 302
reembolsos**. A perda da FK (`30` §11.3) é o que salvou esse dado.

**Destino: converter, e o modelo novo precisa suportar isto por desenho.** Um agente é um
**registro de autoria** que pode existir sem identidade de login. Se o schema alvo puser
`users.id` como FK para `auth.users`, **5.665 tickets não migram**. Isto é um conflito direto
com qualquer alvo que assuma 1:1 entre perfil e usuário de auth — registrado na seção de
conflitos.

### 4.9 Reembolso sem ticket e ticket de reembolso sem reembolso

```sql
SET LOCAL statement_timeout = '15s';
SELECT (SELECT count(*) FROM refunds WHERE service_id IS NULL) AS reembolso_sem_ticket,
       (SELECT count(*) FROM services s WHERE s.contact_reason = 'reembolso'
          AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.service_id = s.id))
         AS ticket_reembolso_sem_reembolso,
       (SELECT count(*) FROM refunds r WHERE NOT EXISTS (
          SELECT 1 FROM services s
           WHERE lower(btrim(s.client_email)) = lower(btrim(r.customer_email))))
         AS reembolso_sem_nenhum_ticket_do_mesmo_cliente;
```

| medida | linhas |
|---|---|
| reembolsos sem `service_id` | **3.975** de 5.710 (70%) |
| reembolsos com `created_from_service = true` | 1.733 |
| tickets com `contact_reason='reembolso'` | 6.570 |
| **tickets de reembolso SEM reembolso correspondente** | **4.837** (74%) |
| reembolsos cujo e-mail não aparece em nenhum ticket | **388** |

Os 4.837 têm explicação documentada: a trigger `sync_refund_from_service` entrou em
**06/08/2026** e **não houve backfill**. Todo ticket de reembolso anterior a essa data não
gerou linha em `refunds`. Os 3.975 sem `service_id` são o espelho: reembolsos lançados
direto na tela de reembolso, sem ticket.

Os **388 sem nenhum ticket do mesmo cliente** são os interessantes: reembolso de cliente que
nunca foi atendido. Pode ser legítimo (reembolso vindo de planilha da plataforma) ou e-mail
digitado errado.

**Destino:** os 4.837 e os 3.975 **convertem sem marca** — não são sujeira, são duas fontes de
entrada que sempre existiram separadas. Vincular retroativamente ticket a reembolso por
e-mail + produto + data seria **inventar** um vínculo que ninguém registrou: não faço.
Os **388** viram `migration_checks` para amostragem humana.

### 4.10 Datas fora de ordem em `refunds` — 40

```sql
SET LOCAL statement_timeout = '15s';
SELECT count(*) FROM refunds
WHERE text_to_date_safe(completion_date) < text_to_date_safe(request_date);
```

**40 reembolsos concluídos antes de serem pedidos.** Exemplos:

| `request_date` | `completion_date` | leitura |
|---|---|---|
| `2025-10-01` | `2025-03-18` | 7 meses antes |
| `2026-01-24` | `2026-01-02` | 22 dias antes |
| `2026-02-02` | `0026-02-02` | ano digitado como `26` |
| `2026-02-03` | `0026-02-04` | ano digitado como `26` |
| `2026-02-06` | `2026-01-29` | 8 dias antes |
| `2026-02-12` | `2026-02-02` | 10 dias antes |

Dois grupos: **2 são o erro de ano `0026`** (correção óbvia, mas ainda decisão humana) e **38
são inversões de dias** — provavelmente a pessoa digitou a data de conclusão pensando no
pedido, ou trocou os campos.

**Destino: converter com marca + `migration_checks`.** As duas datas passam como estão, com
bandeira `date_order_violation`. Não invento a ordem certa, e não rejeito a linha — o
reembolso aconteceu e o valor entra na soma de controle. Um `CHECK
(completion_date >= request_date)` no schema novo **não pode** ser aplicado antes dessas 40
serem resolvidas, senão o backfill falha.

### 4.11 Valores nulos ou suspeitos em `refunds`

```sql
SET LOCAL statement_timeout = '15s';
SELECT count(*) FILTER (WHERE refund_value IS NULL)     AS valor_nulo,
       count(*) FILTER (WHERE refund_value = 0)         AS valor_zero,
       count(*) FILTER (WHERE refund_value > 500)       AS acima_500,
       count(*) FILTER (WHERE refund_value > 2000)      AS acima_2000,
       round(sum(refund_value)::numeric,2)              AS soma,
       max(refund_value)                                AS maximo
FROM refunds;
```

| medida | valor |
|---|---|
| `refund_value` nulo | **1.240** |
| `refund_value` = 0 | **18** |
| `refund_value` > 500 | **392** |
| `refund_value` > 2.000 | **88** |
| **soma total** | **2.385.239,01** |
| máximo | **76.365** |

Os **1.240 nulos são estruturais, não sujeira**: `refund_value`, `refund_type`, `reason` e
`completion_date` são nulos **nas mesmas 1.240 linhas** — são os reembolsos **abertos**, ainda
não concluídos. É o padrão "apagado até assumir". O `CHECK` já permite
(`refund_value IS NULL OR refund_value >= 0`).

Os valores altos são o problema real. Os 10 maiores:

| valor | tipo | plataforma |
|---|---|---|
| 76.365 | `50%` | Cartpanda |
| 72.417 | `80%` | Cartpanda |
| 59.610 | `30%` | Hotmart |
| 32.499 | `100%` | ClickBank |
| 32.009 | `100%` | ClickBank |
| 31.458 | `100%` | ClickBank |
| 31.458 | `100%` | ClickBank |
| 31.395 | `80%` | Cartpanda |
| 31.238 | `100%` | ClickBank |
| 30.958 | `100%` | ClickBank |

Um reembolso individual de **76.365** num negócio de suplemento não é plausível como dólar.
`76365` lido como centavos é **$763,65** — plausível. E o repositório tem **duas** migrations
sobre isso: `20260828160000_copy_valores_em_dolar.sql` e
`20260902120000_copy_valor_ja_em_dolar.sql` — ou seja **a unidade de `refund_value` já foi
motivo de confusão e de correção**, duas vezes, em cinco dias.

Eu **não** sei qual é a unidade. A coluna é `double precision` sem comentário, sem `CHECK` de
faixa, e a soma de 2,39 milhões pode ser dólar (plausível para 4.470 reembolsos concluídos,
média $534) ou centavos (média $5,34 — implausível). A média sugere dólar **no agregado**,
o que torna os 88 acima de 2.000 **outliers dentro da mesma coluna**, não um problema de
unidade global.

**Destino: converter preservando o número exato, e marcar os 88.** Decisão **D4** de
`00-CONTRATO.md` §8-A: **todo valor monetário é dólar**, em todo o sistema.

A minha dúvida de unidade está respondida. O que ela deixa para trás é mais estreito e continua
válido: **os 88 valores acima de 2.000 são qualidade de dado, não unidade.** Um reembolso de
`76.365` dólares num negócio de suplemento é implausível como valor único, mas é dólar — logo o
tratamento é marca (`value_outlier`), não conversão de escala. Ver `90-BACKLOG.md` B12.

O dono também corrigiu no app legado, em 26/09/2026, os **dois pontos onde o front mentia a
moeda** — um modal que formatava em `BRL` e quatro colunas de exportação rotuladas "Valor
(R$)". Isso não altera nenhum dado, só para de contradizê-lo. Na v2 a API devolve
`{ amount, currency }` com `currency` fixo em `USD`, de modo que rótulo e dado não podem mais
divergir.

A soma de controle continua sendo **2.385.239,01** e a conversão segue
`double precision → numeric(12,2)`, com a tolerância de `< 0.01` da verificação R4 de
`32-banco-migracao.md` §8 — ganho de precisão, não perda.

### 4.12 `recorded_at` diferente de `created_at` em follow-ups — 15.879

```sql
SET LOCAL statement_timeout = '15s';
SELECT count(*) FROM service_follow_ups WHERE recorded_at <> created_at;
```

**15.879 de 59.710 (26,6%).** Como `_tg_follow_up_force_now` faz `NEW.recorded_at := now()` e
`created_at` tem `DEFAULT now()`, e `now()` é constante dentro de uma transação, as duas
colunas **deveriam ser sempre iguais** para toda linha inserida depois da trigger existir.

Que 26,6% difiram significa que essas linhas foram inseridas **antes** da trigger
`trg_follow_up_force_now`, quando o cliente escolhia `recorded_at` livremente.

**Destino: converter.** `recorded_at` é a verdade de negócio (é o que todas as RPCs usam) e
`created_at` é a verdade física. As duas migram. A diferença é informação sobre a era do
registro, não sujeira.

### 4.13 Resumo do dado sujo, por categoria e destino

| # | Categoria | Linhas | Destino |
|---|---|---|---|
| 4.1 | tickets sem plataforma (`NULL`) | **26.764** | converter literal (**D5**) |
| 4.1 | tickets com plataforma `'Nenhum'` | **10.666** | converter literal, distinto do nulo (**D5**) |
| 4.3 | `follow_up_number` duplicado (linhas excedentes) | **12.755** | converter, renumerando |
| 4.4 | concluído na tela / aberto no banco | **10.087** | converter com derivação |
| 4.4 | concluído no banco / aberto na tela | **28** | converter com derivação |
| 4.9 | ticket de reembolso sem reembolso | **4.837** | converter (sem marca) |
| 4.9 | reembolso sem ticket | **3.975** | converter (sem marca) |
| 3.1 | `service_date` em formato `+00:00` | **22.320** | converter com regra de fuso |
| 3.1 | *(dos quais)* mudam de dia se convertidos ingenuamente | **6.778** | idem — alerta |
| 3.4 | `client_email` que é telefone | **22.446** | converter para contato polimórfico |
| 4.6 | e-mail com caixa inconsistente (`services`) | **1.501** | preservar original; normalizar em coluna gerada (**D6**) |
| 4.6 | colisões de e-mail só por caixa | **179** | preservar as duas (**D6**) |
| 4.5 | status final ambíguo entre as duas ordens | **216** | converter com marca |
| 4.5 | empates de `recorded_at` com status divergente | **69** | converter com marca |
| 4.11 | `refund_value` > 2.000 (qualidade, **não** unidade) | **88** | converter + marca (**D4**) |
| 4.11 | `refund_value` = 0 | **18** | converter com marca |
| 4.10 | `completion_date` < `request_date` | **40** | converter com marca |
| 4.9 | reembolso sem nenhum ticket do mesmo cliente | **388** | converter + amostragem |
| 4.8 | perfis sem `auth.users` (e o que possuem) | **2** (5.665 tickets) | converter — exige suporte no alvo |
| 4.2 | tickets datados em 1997 | **2** | **decisão humana** |
| 4.2 | datas com ano `0025`/`0026` | **4** | **decisão humana** |
| 2.2 | `platform = 'Logicall'` (erro de caixa) | **1** | converter corrigindo |
| 2.6 | `refunds.product` com grafia divergente | **2** | converter corrigindo |
| — | `service_follow_ups`/`refunds`/`services` órfãos | **0** | — |

**Nenhuma linha é descartada.**

Depois de D4, D5 e D6, o total que **ainda bloqueia** o backfill caiu de 10.939 para **6
linhas**: os 2 tickets de 1997 e as 4 datas com ano `0025`/`0026` (4.2). Tudo o mais tem regra
de conversão definida.

As 10.933 linhas que saíram da lista não foram resolvidas — foram **decididas como preservadas
sem alteração**, o que é uma resposta e não um adiamento. Elas continuam em `90-BACKLOG.md`
B9, B10 e B12 como qualidade de dado a tratar depois, e o dado sobrevive intacto até lá.

---

## 5. As três perguntas — respondidas em 26/09/2026

As três estavam fora da minha autoridade e foram decididas pelo dono do projeto em
`00-CONTRATO.md` §8-A. Registro pergunta e resposta juntas, porque a pergunta explica por que a
resposta importa.

### 5.1 `platform = 'Nenhum'` e `platform IS NULL` são a mesma coisa? → **D5: não**

Eram 10.666 e 26.764 linhas. Se fossem a mesma coisa, unificariam em `NULL` e as métricas por
plataforma mudariam.

**Decisão: permanecem distintos. Não unificar, não apagar.** A diferença entre "verifiquei e não
há" e "ninguém preencheu" é informação, e o que fazer com ela fica para depois
(`90-BACKLOG.md` B9).

Efeito na travessia: `platform` e `channel` são **cópia literal**. Some a normalização, some a
coluna-sentinela, some o rejeito por este motivo. Ver `32-banco-migracao.md` §3.1.3.

Efeito na reconciliação: a verificação R4.d, que eu havia escrito comparando contra
`legacy_platform` justamente porque esperava normalização, fica **mais simples** — compara
coluna com coluna, e a igualdade tem de ser exata.

### 5.2 Qual é a unidade de `refunds.refund_value`? → **D4: dólar**

A média dos concluídos ($534) sugeria dólar; os 88 valores acima de 2.000 e o máximo de 76.365
sugeriam centavos em pelo menos parte das linhas. A diferença é 100× em todo relatório
financeiro, e eu me recusei a inferir.

**Decisão: dólar, em todo o sistema.** Os 88 outliers passam a ser **qualidade de dado**, não
unidade (`90-BACKLOG.md` B12).

Efeito colateral útil: o dono encontrou e corrigiu, no app legado, dois pontos onde o **front
mentia a moeda** — um modal formatando em `BRL` e quatro colunas de exportação rotuladas
"Valor (R$)". A contradição que alimentava a dúvida era de rótulo, não de dado.

### 5.3 As 179 colisões de e-mail por caixa são o mesmo cliente? → **D6: preservar as duas**

Normalizar era o certo tecnicamente, mas mudaria a regra de duplicidade retroativamente.

**Decisão: preservar todos os dados, exatamente como digitados.** A normalização existe só como
**coluna gerada**, para índice e comparação; o original nunca é sobrescrito
(`90-BACKLOG.md` B10).

Isto é mais forte que a minha proposta, que gravava duas colunas: coluna gerada não pode
divergir do original, porque não é escrita.

## Lacunas

Estado em 26/09/2026, depois de `00-CONTRATO.md` §8-A.

### Fechadas

| # | Lacuna | Como fechou |
|---|---|---|
| 2 | significado de `services.status` | `12-backend-schema-alvo.md` §3.1 mantém `status ticket_status` (`registered`/`concluido`, os dois valores que existem) **e** `derived_status` materializado. A coluna sobrevive como campo, não só como legado — e é dela que vem o fallback dos 1.220 (emenda 8) |
| 3 | forma do `client_email` polimórfico | **D6** decide a metade da normalização (coluna gerada, original intacto). A parte de telefone continua aberta, mas agora como item nomeado em `90-BACKLOG.md` B5, não como lacuna sem dono |
| 4 | onde ficam as marcas de qualidade | resolvida por **D5** e **D6**, que eliminaram duas das três marcas que eu havia proposto: sem normalização de `platform` não há `legacy_platform_sentinel`, e sem sobrescrita de e-mail não há marca de normalização. Sobram `value_outlier` (88) e `date_order_violation` (40), ambas cabendo em `migration_checks` — tabela lateral, sem poluir o schema alvo |

### Abertas

1. **Ponto de corte do backfill.** O banco recebe ~300 tickets/dia. Todos os números deste
   documento são de 26/09/2026, entre 12:51 e 13:10. Sem um instante de corte acordado, nenhuma
   reconciliação fecha. Continua fora do contrato.

2. **Retenção do que não migra.** `claude_skills_leads`, `lya_chats`/`lya_chat_messages`
   (conversas), `auth_events` (4.577 linhas de auditoria) — o contrato não diz se são histórico
   a preservar ou operacional descartável.

3. **Amostragem aceitável.** `migration_checks` recebe ~10 mil linhas de `STATUS_DIVERGENCE`
   mais 216 + 388 + 179. Ninguém revisa 10 mil à mão. Falta o tamanho de amostra que dá
   confiança para aprovar, e quem aprova.

4. **Normalização de telefone** (era parte da lacuna 3). A coluna gerada de D6 não deduplica os
   22.446 telefones. Está em `90-BACKLOG.md` B5; registro aqui porque afeta a regra de
   duplicidade, que é regra de negócio e não de dados.

---

## Propostas de emenda

### Emenda 6 — `service_date` deve ser `date` · **DECIDIDA — acatada**

> Decidida em 26/09/2026 junto com a emenda 1 de `30`. O alvo é `business_day date NOT NULL`.
> A prova que faltava, e que segue sendo o argumento, está abaixo.

`30` já defendeu isso. O levantamento acrescenta dois fatos que fecham a questão:

1. **`service_date_corrections` tem 0 linhas.** A objeção era "a gestora corrige data
   manualmente". A capacidade existe desde 25/05/2026, com RPC que já recebe `date` e tabela
   de auditoria própria — e **nunca foi exercida em quatro meses**. A objeção é hipotética.
2. **100% dos valores têm hora zero na era canônica** (80.418 de 80.418 casam
   `T00:00:00-03:00`), e os 22.320 da era antiga têm hora só porque o cast de `timestamptz`
   gravou o instante UTC. **Nenhum valor carrega hora escolhida por alguém.**

O instante real continua em `created_at`. `date` não perde nada.

Ressalva obrigatória, e é a razão pela qual esta emenda é importante: a conversão **tem** de
ser `(service_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`. O atalho
`substring(…,1,10)::date` erra **6.778 tickets** e ninguém notaria, porque erra um dia — o
tipo de erro que só aparece quando a gestora reclama que o número do mês não fecha.

### Emenda 7 — `client_email` guarda telefone em 21,8% das linhas · **PARCIALMENTE ACATADA**

> **O que foi decidido (D6):** a normalização vira **coluna gerada**, e o original nunca é
> sobrescrito. Isso é a metade da emenda, e numa forma melhor do que eu propus.
>
> **O que continua aberto:** `contact_type` e a normalização **condicional** para telefone. A
> coluna gerada de D6 é `lower(btrim(...))`, que não toca em parênteses, hífens e espaços —
> portanto **não deduplica os 22.446 telefones**, que é o canal com mais volume. Fica em
> `90-BACKLOG.md` B5, sinalizado ali como "o que mais afeta o modelo novo".
>
> O texto abaixo é a medição que sustenta B5.

22.446 dos 102.743 tickets (21,8%) têm **telefone** numa coluna `NOT NULL` chamada
`client_email`, e todos no canal `SMS`. Correlação perfeita nos dois sentidos.

Consequências de manter uma coluna só:

- nenhuma validação de e-mail é possível (quebraria 22 mil linhas);
- a deduplicação por cliente é frágil onde há mais volume (telefone tem grafia variável, e
  `lower(btrim(...))` não normaliza `+1 (555) 123-4567` vs `15551234567`);
- a regra de `can_register_duplicate_emails` se chama "emails" e opera sobre telefone.

Proposta: `contact_type` (`email` | `phone`, derivável do canal com 100% de precisão hoje) +
`contact_as_entered` (o que a pessoa digitou) + `contact_normalized` (e-mail em minúscula sem
espaço; telefone reduzido a dígitos com `regexp_replace(x,'\D','','g')`). O índice único e a
regra de duplicidade passam a usar `contact_normalized`, e **só então** a deduplicação por SMS
passa a funcionar de fato.

Registro o efeito colateral honestamente: normalizar telefone para dígitos vai **fundir**
clientes que hoje são distintos. Não medi quantos — medir exige uma agregação a mais sobre
`services` e eu preferi não gastar outra varredura sem o dono ter decidido a direção. É a
primeira medição que eu faria se esta emenda for aceita.

### Emenda 8 — os 1.220 `concluido` sem follow-up proíbem descartar `services.status` · **CONFIRMADA NO CÓDIGO LEGADO**

> Verificada em 26/09/2026 contra o legado, e **procede**. `src/features/services/useStatusTracking.ts:87`
> tem exatamente o fallback que o schema alvo não tem:
>
> ```js
> // Service concluded directly (no follow-ups), set via status field
> if (serviceStatus === "concluido" && (!entries || entries.length === 0)) {
>   return { label: "Concluído", variant: "done" };
> }
> ```
>
> Medido: a tela de hoje mostra **1.220** atendimentos como "Concluído" por esse caminho. Sem o
> fallback, os 1.220 aparecem como "Em Aberto" no dia da virada. Encaminhado à trilha de
> backend como conflito **C8** (`32-banco-migracao.md` §12).

A tentação natural, dado que só existem dois valores e que o status real vem do follow-up, é
tratar `services.status` como lixo. **Não é, para 1.220 tickets.**

Follow-up só existe desde 26/03/2026. Para os 37.850 tickets de janeiro a março, `services.status`
é a **única** fonte de conclusão que existe — e 1.220 deles estão marcados `concluido`. Se a
derivação do modelo novo olhar apenas eventos de interação, esses 1.220 viram "abertos", e a
gestora vai ver 1.220 tickets reabrirem sozinhos na virada.

Proposta: a derivação é `coalesce(status_do_ultimo_evento, legacy_status)`, nessa ordem, e
`legacy_status` é coluna preservada. Detalhe em `32` §5.

### Emenda 9 — `support_channel` deveria ser marcada como morta, não migrada · **ABERTA**

> Não decidida. `12-backend-schema-alvo.md` §2.1 mantém a coluna como enum e anota que `NULL`
> passaria a significar "derivar" (decisão 19.3 dela). Minha medição continua valendo e é o
> argumento: **`email` nas 47 linhas**, e `sms` nunca usado, enquanto `services.channel='SMS'`
> tem 36.062 tickets. Segue como emenda aberta entre as duas trilhas.

As 47 linhas têm `support_channel = 'email'`. O `CHECK` admite `'sms'` e ninguém usa, enquanto
`services.channel = 'SMS'` tem 36.062 tickets. A coluna sugere "este agente atende por SMS" e
não significa isso — ninguém a mantém.

Proposta: não migrar como campo ativo; preservar como `legacy_support_channel` e deixar a
trilha de backend decidir se a capacidade "agente atende SMS" deve existir de verdade (e aí
nasce com dado correto) ou não deve existir. Migrar a coluna como está é carregar um campo
que mente para 47 de 47 linhas.
