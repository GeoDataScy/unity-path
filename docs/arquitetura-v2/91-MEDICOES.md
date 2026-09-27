# Medições complementares — 26/09/2026

Sete agregações que a trilha de backend não pôde rodar (a instrução dela proibia executar SQL)
e que decidiam itens abertos. Executadas em produção, somente leitura, uma por vez, com
`SET LOCAL statement_timeout = '15s'`. Nenhum timeout.

---

## M1 · `services.status` tem só dois valores, não três `RESOLVE 19.12`

| Valor | Linhas |
|---|---|
| `registered` | 101.529 |
| `concluido` | 1.271 |

**Zero linhas com `'pendente'`**, apesar de ser o default da coluna em produção. O terceiro
estado que a trilha de backend temia é um default morto: nunca foi materializado porque o
cliente sempre grava `'registered'` explicitamente.

Consequência para o schema: o alvo precisa de dois estados, e o default deve ser o mesmo
valor que o código grava, em vez de um terceiro que ninguém usa.

### O mecanismo do ticket fantasma, agora visível em dois números

Só **1.271** atendimentos têm `status = 'concluido'` na tabela, mas **14.102** interações têm
`status = 'concluido'`. A tela lê a interação, o banco guarda a coluna, e ninguém sincroniza.
É a prova aritmética dos ~10 mil tickets que aparecem concluídos e estão abertos.

---

## M2 · A duplicação de `follow_up_number` é toda recente `RESOLVE 19.5`

| Medida | Valor |
|---|---|
| Pares repetidos nos últimos 180 dias | 5.543 |
| Linhas excedentes nos últimos 180 dias | 12.753 |
| Total histórico medido pela trilha de dados | 12.755 |

Praticamente **toda** a duplicação aconteceu nos últimos seis meses. Não é lixo histórico, é
um defeito em curso. Reforça que `seq` gerado pelo banco com unicidade é urgente, e não
apenas desejável.

---

## M3 · A validação mais estrita passa em quase todo o histórico `RESOLVE 19.6`

Sobre os 5.624 reembolsos de 2026:

| Verificação | Linhas que violam |
|---|---|
| Baixa anterior à solicitação | 39 |
| Baixa sem valor, tipo ou motivo | 0 |

Unificar a baixa numa rota só, com a validação que hoje só a gestora enfrenta, custa tratar
**39 linhas**. O caminho fica livre.

---

## M4 · `channel` tem o mesmo problema que `platform` `NOVO — PRECISA DE DECISÃO`

| Valor | Linhas |
|---|---|
| `SMS` | 36.081 |
| *(vazio)* | 30.994 |
| `Email` | 30.887 |
| `Clickbank` | 3.710 |
| `Nenhum` | 1.128 |

A decisão D5 do contrato tratou de `platform`, onde "Nenhum" e vazio convivem. **`channel`
tem exatamente o mesmo padrão** e não foi coberto pela decisão. Por coerência, a mesma regra
deve valer: preservar os dois como distintos e decidir depois.

Note também que `Clickbank` aparece como *canal de atendimento*, o que é uma plataforma de
venda. São 3.710 linhas usando o campo para outra coisa.

---

## M5 · A lista de plataformas de venda tem mais valores no banco que na tela `PRECISA DE DECISÃO`

| Valor | Linhas |
|---|---|
| `Cartpanda` | 2.400 |
| `Buygoods` | 1.452 |
| `ClickBank` | 1.414 |
| `Hotmart` | 143 |
| `PagAmerican` | 139 |
| `LogiCall` | 59 |
| `SalesBound` | 45 |
| `Nenhum` | 36 |
| `CartCandy` | 22 |
| `Digistore24` | 4 |

São **10 valores no banco** contra **8 no seletor** documentado pela trilha de frontend. Um
`CHECK` com a lista da tela rejeitaria as linhas dos valores que sobraram.

Atenção à caixa: `ClickBank` em reembolsos e `Clickbank` em canal de atendimento são o mesmo
nome escrito de dois jeitos.

---

## M6 · `refund_type` tem 21 variantes e o maior grupo é vazio `PRECISA DE DECISÃO`

O maior grupo é *(vazio)*, com **1.242** linhas, seguido de `80%` (961) e `100%` (881). Os 21
valores distintos são percentuais de 5 em 5, com duas particularidades:

- `05%` está com zero à esquerda, enquanto `10%` e os demais não. Ordenação por texto quebra.
- Um `CHECK` com os 20 valores documentados na tela rejeitaria `95%`, que existe com 1 linha.

Recomendação da reconciliação: a coluna deveria guardar um número (percentual inteiro) e o
rótulo ser formatado na tela. Isso resolve ordenação e o zero à esquerda de uma vez.

---

## M7 · O mesmo "Nenhum" vira duas coisas diferentes conforme a tela `PRECISA DE DECISÃO`

Descoberto na reconciliação de 26/09/2026, depois da decisão D5. Ele **limita o que D5 pode
garantir**, então precisa ser resolvido junto.

O seletor oferece "Nenhum" nas duas telas. O que é gravado depende de qual tela escreveu:

| Caminho | Código | O que grava |
|---|---|---|
| Atendimento | `Atendimentos.tsx`, `EditServiceDialog.tsx` | o texto `"Nenhum"`, literal |
| Reembolso | `Reembolsos.tsx:154` e `:157` | converte para vazio antes de enviar |

Efeito no banco: em `services` existem 10.666 plataformas e 1.128 canais com "Nenhum"; em
`refunds` existem apenas 36, que são resíduo de antes dessa conversão.

**Consequência para D5.** A decisão preserva "Nenhum" e vazio como coisas distintas, na
premissa de que "Nenhum" significa "verifiquei, não há". Essa premissa **só vale para
atendimentos**. Em reembolsos os dois já foram fundidos na origem, e continuarão sendo nos
registros novos enquanto a conversão existir.

É a classe 8 de `01-GARANTIAS.md`: a mesma ação com dois comportamentos.

### As listas também divergem

Três cópias da lista de plataformas, em dois conteúdos diferentes:

| Arquivo | Valores |
|---|---|
| `src/pages/agent/Atendimentos.tsx:134` | 9, com `PagAmerican` |
| `src/features/services/EditServiceDialog.tsx:110` | 9, com `PagAmerican` |
| `src/features/refunds/types.ts:23` | **8, sem `PagAmerican`** |

O agente pode registrar um atendimento com `PagAmerican` e **não pode** registrar um
reembolso com a mesma plataforma. Mesmo assim existem 139 reembolsos com esse valor no banco,
ou seja, entraram por outro caminho.

Some-se a isso que `PagAmerican` aparece também dentro da lista de **produtos** de reembolso
(`src/features/refunds/types.ts:100`), que é outro domínio.

### O que isto exige da arquitetura nova

Cobre as garantias G9.1, G9.2 e G9.3: catálogo único com chave estrangeira, a lista da tela
derivada dele, e "não se aplica" sendo um valor nomeado em vez de um vazio disputando
significado com um texto.

---

## M8 · `created_at` é UTC, provado `FECHA C6`

O defeito C6 dependia de saber em que fuso os cinco `created_at` sem fuso foram gravados.
Assumir errado desloca todo o histórico em 3 horas. A pergunta ficou aberta porque "provável
UTC" não é resposta. Agora está fechada com prova.

### Por que os dois primeiros testes não serviram

O primeiro comparava `created_at` com a primeira interação usando o mesmo fuso nas duas
pernas, então os dois contadores eram complementares por construção e não distinguiam nada.

O segundo comparava as duas hipóteses de verdade, e deu 3.289 violações supondo UTC contra
9.170 supondo hora local. Parece conclusivo, mas é **enviesado**: interpretar como UTC empurra
o carimbo 3 horas para trás, e qualquer hipótese que empurre para trás reduz violações de
"criado depois da primeira interação". O teste premiava o deslocamento, não a verdade.

### O teste que decide

O gatilho `trg_service_pin_date_on_insert` grava `service_date` como **a data de São Paulo no
momento do insert**. Então a hipótese correta é a que reproduz esse dia. Basta olhar a faixa
das 00:00 às 03:00 UTC, que é exactly onde as duas hipóteses discordam sobre qual é o dia.

Restrito a linhas criadas depois de a migration do gatilho existir:

| Medida | Valor |
|---|---|
| Linhas na faixa decisiva | 233 |
| Acertam o dia supondo UTC | **233** |
| Acertam o dia supondo hora local de São Paulo | **0** |

**Conclusão: `created_at` é UTC.** A conversão correta é `created_at AT TIME ZONE 'UTC'`.
Conversão implícita (`::timestamptz`, ou comparação direta com `timestamptz`) usa o fuso da
sessão e dá resultado diferente conforme quem executa, o que é a pior forma de errar.

### Um achado lateral, para o backlog

Entre os 29.786 atendimentos com interação, **3.289 têm o carimbo de criação posterior à
primeira interação**, mesmo já interpretando como UTC. O atraso médio é de **0,40 hora**, ou
seja 24 minutos, e não 3 horas. Portanto não é fuso: é uma anomalia de ordenação com outra
causa, ainda não investigada.

---

## M9 · A ordem canônica `(recorded_at, id)` é um sorteio `CORRIGIDO NO SCHEMA`

Descoberto em 27/09/2026 **executando** o schema novo, não lendo a especificação. As três
trilhas concordavam com a ordem errada.

A trilha de dados fixou a ordem canônica de interação em `(recorded_at, id)` porque é a que
`my_follow_ups()` usa, e é o que a tela mostra hoje. Está certo como descrição do legado. Como
regra do sistema novo, quebra.

### O que aconteceu no teste

Um ticket com duas interações gravadas no mesmo pedido, a segunda concluindo o atendimento:

| seq | status | recorded_at | id |
|---|---|---|---|
| 1 | `em_andamento` | 03:00:01.879822 | `b5344a8b…` |
| 2 | `concluido` | 03:00:01.879822 | `0bce54c0…` |

Resultado: `derived_status = 'em_andamento'` num ticket que acabou de ser concluído.

**Causa.** Em Postgres, `now()` é da transação, não da linha. Duas interações gravadas no mesmo
pedido têm `recorded_at` **idêntico**, e o desempate cai no `id`, que é uuid aleatório. A
"última" interação passa a ser a de maior uuid, sorteada.

É o defeito dos 10.115 tickets fantasma reaparecendo por outra porta, no schema que existia
para eliminá-lo. E explica as **216 linhas com status final ambíguo** que a trilha de dados
mediu no legado: não é dado sujo, é a ordem que não decide.

### A correção

Ordem canônica passa a ser `(recorded_at, seq)`. `seq` é monotônico e único por ticket por
constraint, então o desempate é determinístico. Aplicado no trigger e no índice
`interactions_ticket_canonical_idx`.

O backfill continua atribuindo `seq` na ordem legada `(recorded_at, id)`, de modo que o
histórico exibido não muda em nenhum ticket. Depois disso as duas ordens concordam para
sempre, e a ambiguidade deixa de existir em vez de ser herdada.

> Exige ajuste em `32-banco-migracao.md` §5.1 e §5.2: a ordem de atribuição de `seq` permanece
> a legada, mas a ordem de **leitura** do estado passa a ser por `seq`.

### Por que isto não apareceu na especificação

Nenhuma leitura de documento pegaria: depende de um detalhe de execução do Postgres. Foi o
primeiro teste executado contra o schema real que pegou, no quarto caso de teste. É o argumento
mais forte para a regra de que toda garantia precisa de cobrança mecânica: a revisão humana
tinha aprovado a ordem errada três vezes.

---

## Consulta usada

Padrão de todas, trocando só o corpo:

```sql
SET LOCAL statement_timeout = '15s';
SELECT status, count(*) FROM public.services GROUP BY 1 ORDER BY 2 DESC;
```

Enviadas uma por requisição pela Management API, para que o endpoint devolvesse cada
resultado e para não empilhar carga na instância `t4g.micro`.
