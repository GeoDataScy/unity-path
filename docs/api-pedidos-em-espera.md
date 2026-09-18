# API Pedidos em Espera — contrato implementado

Resposta do painel à especificação "API Pedidos em Espera" (17/09/2026), do time do
Wall-E. O `/sync` está implementado; este documento é o que muda em relação ao
proposto e o que o Wall-E precisa saber para integrar.

## Endereço e autenticação

```
POST https://<projeto>.supabase.co/functions/v1/pedidos-espera-sync
Authorization: Bearer <WALLE_SYNC_TOKEN>
Content-Type: application/json
```

- **Formato de auth: `Bearer`** (respondendo à pergunta em aberto da spec). O header
  `apikey` também é aceito, com o mesmo valor, para quem já usa esse padrão.
- Um token por ambiente, emitido pelo painel e guardado nos secrets do projeto
  Supabase. Ele **não** é o JWT de usuário nem a anon key.
- A comparação do token é feita em tempo constante.

## Tamanho de lote

- **Máximo de 5.000 itens por requisição** (respondendo à segunda pergunta em
  aberto). O estoque atual (3.289) cabe num lote só.
- Acima disso, o painel devolve `400` e o Wall-E pagina com `pagina` /
  `totalPaginas`, exatamente como a spec prevê. **O encerramento da regra 3 só roda
  quando chega a última página** (`pagina === totalPaginas`).

## Códigos de status

| Código | Quando |
|---|---|
| `200` | Lote processado, mesmo com itens em `rejeitados` |
| `400` | JSON inválido, envelope inválido, ou lote acima do limite |
| `401` | Token ausente ou inválido |
| `409` | Lote com a mesma `(fonte, referencia, pagina)` já processado — o corpo traz o resultado original e `jaProcessado: true` |
| `500` | Erro do painel; o Wall-E repete com backoff |
| `503` | Integração não configurada no painel (secret ausente) |

O corpo de sucesso é o da spec, mais um campo:

```json
{
  "recebidos": 3289, "criados": 142, "atualizados": 3105,
  "reabertos": 3, "inalterados": 39, "encerrados": 87,
  "repetidos": 2, "rejeitados": []
}
```

`repetidos` = itens que vieram duas vezes **no mesmo lote** (mesma loja + pedido).
Entra a primeira ocorrência. Serve para o Wall-E detectar consolidação duplicada de
dyna codes antes que vire problema.

## Campos aceitos

Todos os do payload da spec. Três notas:

- `lojaNome` é gravado e já aparece na tela, ao lado do dyna code. **É tratado como
  atributo da loja, não fato do pedido**: um lote sem `lojaNome` não apaga o nome já
  conhecido. Todos os outros campos são fatos do dia e o sync sobrescreve.
- `diasEmEspera` é gravado como inteiro e é o que ordena a fila por idade.
- `clienteEmail` é normalizado em minúsculas, como a spec descreve.

Rejeição individual (não derruba o lote) acontece para `pedido`, `loja` ou `motivo`
ausentes. **`clienteNome`, `clienteEmail` e `data` ausentes NÃO rejeitam o item** —
entram como `null`. Perder um on-hold real porque o CSV veio sem e-mail é pior que a
lacuna; a spec os marca como obrigatórios e essa é uma divergência deliberada.

## Duas divergências que o Wall-E precisa conhecer

### A. "Existe e está encerrada → reabre"

A spec trata *encerrado* e *concluído* como o mesmo estado. No painel não são:

- **Encerrado pelo sync** (saiu do relatório da ShipOffers) → o próximo lote que
  trouxer o pedido **reabre a mesma linha**, preservando o histórico. É o que a spec
  pede.
- **Concluído por um agente** → o sync **não reabre**. Reabrir reescreveria trabalho
  já entregue e violaria a regra 2. O pedido voltar ao on-hold depois de atendido é
  trabalho novo e entra como **linha nova**, com histórico anterior intacto.

Isso aparece no retorno: nesse caso o item conta em `criados`, não em `reabertos`.

### B. O que a regra 3 pode encerrar

O painel tem ~3,3 mil linhas abertas vindas do import manual, muitas provavelmente já
resolvidas fora do sistema. Um primeiro lote `completo: true` que encerrasse "toda
linha aberta que não veio no lote" fecharia a base inteira de uma vez, inclusive o que
agentes estão tratando agora.

Então **a regra 3 só alcança linha que o sync já reconheceu ao menos uma vez.** O
legado entra nesse universo no dia em que aparecer num lote. O que nunca aparecer
continua aberto e visível — a tela de produtos mostra esse resíduo como
`legado_fora_do_sync`, para o time decidir o que fazer com ele.

Efeito prático no dry-run (etapa 2 do rollout): **o `encerrados` do primeiro lote virá
baixo**, e vai subir conforme a base for sendo reconhecida. Isso é esperado, não é
divergência de dados.

## Regras 1 e 2, como ficaram

**Regra 1 — chave natural `(loja, pedido)`.** Já era a identidade do painel antes da
API: índice único parcial sobre `(dyna_code, import_key)` entre as linhas em aberto.
O sync reusa essa mesma chave, então planilha e API não podem divergir. Nenhuma linha
repetida é criada, e o upsert atualiza a linha existente em vez de inserir outra.

**Regra 2 — `agente` e `status` intocáveis.** O `UPDATE` do sync não tem
`assigned_to`, `agent_status`, `status`, `pending_tag`, `assign_count`, `confirmed_at`
nem `confirmed_by` na lista de colunas. Não é uma checagem que pode falhar: os campos
não existem na instrução.

## Idempotência

Reenviar o mesmo `(fonte, referencia, pagina)` devolve `409` com o resultado original e
não altera nada. Um lote processado parcialmente não existe: cada requisição roda numa
transação só — ou entra inteira, ou não entra.

Lote atrasado (`referencia` anterior à última já processada) é aceito para upsert, mas
**não encerra nada** — senão um retry fora de ordem fecharia pedidos que o lote mais
novo acabou de confirmar.

## Alternativa `/import` (xlsx)

Não foi implementada. O `parseHeldOrdersCsv` do painel já lê xlsx/xls/csv e detecta o
formato, então o caminho existe — mas, como a própria spec reconhece, ele mantém os
dois defeitos estruturais. Com o `/sync` no ar, não há etapa intermediária a ganhar.

## O que falta para a etapa 2 (dry-run)

1. Definir o `WALLE_SYNC_TOKEN` de homologação e de produção e passar ao time do Wall-E.
2. Publicar a Edge Function nos dois ambientes.
3. Rodar o dry-run comparando `recebidos` / `criados` / `encerrados` com o que o import
   manual produz no mesmo dia — lembrando do efeito da divergência B no `encerrados`.
