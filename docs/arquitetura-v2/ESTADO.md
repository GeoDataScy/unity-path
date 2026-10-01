# Estado da reconstrução — documento vivo

> **Para quem assume o trabalho.** Este arquivo diz onde a reconstrução está
> agora, o que já foi verificado e o que fazer em seguida. Ele é atualizado a
> cada passo concluído: quem termina um passo marca aqui, com a data e a
> evidência que provou o resultado.
>
> Regra que vale mais que qualquer outra neste projeto: **nada é "pronto"
> porque passou no teste local.** Só é pronto quando responde em produção e
> a resposta foi conferida. Quatro correções seguidas na mesma função (#94,
> #95, #97, #99) existem porque essa regra foi ignorada.

**Última verificação:** 01/10/2026 (segunda rodada), conferida contra
`origin/main`, contra o banco de produção e contra `https://xmxapp.vercel.app`.

> **A API está no ar, lendo o banco, com as métricas apoiadas em tabela de
> fatos.** `/api/v1/health/db` → `{"ok":true,"db":"up","ms":721}`.

---

## 1. Resumo em três linhas

A fundação está completa e medida: 104.567 atendimentos, 61.144 interações e
165.711 fatos de métrica vivem no schema `core` em produção, ao lado do legado
intocado. A API tem **28 rotas**, autentica, lê o banco, e as métricas novas
**batem com as da gestora de hoje** linha por linha (seção 2). O que falta não
é infraestrutura: é decidir o corte e construir os oito módulos restantes.

---

## 2. Em produção, funcionando `VERIFICADO`

| O quê | Quando | Como foi provado |
|---|---|---|
| Vazamento da view `lya_agentes` fechado | 26/09 | leitura e escrita anônimas devolvem 401; o papel `lya_sql_ro` ainda lê os 47 perfis |
| Moeda dos reembolsos em dólar (PR #91) | 28/09 | varredura dos 160 chunks do bundle: `Valor (R$)` em nenhum, `currency:"BRL"` em nenhum |
| Schema `core` (migrations 0001 e 0002) | 28/09 | 11 objetos presentes no catálogo |
| Travessia dos dados (backfill 0003) | 28/09 | 13 de 13 verificações de reconciliação |
| API no ar e autenticando (#99) | 30/09 | ver a tabela de comportamento abaixo |
| Migrations 0004 e 0005 + travessia | 30/09 | 6 tabelas criadas; contas fechando nos 3 módulos |
| Conexão com o banco (#102) | 30/09 | `/health/db` → `{"ok":true,"db":"up"}` |
| **Tabela de fatos (0006) + travessia** | 01/10 | 165.711 fatos = 104.567 aberturas + 61.144 interações, idêntico às duas tabelas de origem |
| **Rotas de métricas (#104, #105)** | 01/10 | conferem com o legado linha por linha — ver o árbitro abaixo |
| **Eixo do relógio nos fatos (0007)** | 01/10 | 165.711 instantes preenchidos, nenhum nulo, nenhum fora da origem; 9.074 aberturas em que os dois eixos divergem |
| **Filtro do criador materializado (0008)** | 01/10 | 158.597 de 165.711 marcadas (= 165.711 − 7.114 interações de outro agente), zero marcações erradas |

### Comportamento da API em produção

| Requisição | Resposta |
|---|---|
| `GET /api/v1/health` | `{"ok":true}` |
| `GET /api/v1/health/db` | `{"ok":true,"db":"up","ms":721}` |
| `GET /api/v1/me` sem token | `401 UNAUTHENTICATED` |
| `GET /api/v1/metrics/dashboard` sem token | `401 UNAUTHENTICATED` — "token ausente" |
| Token **forjado** | `401` — "assinatura inválida" |
| Atalho de desenvolvimento | `401` — "recusado em produção" |
| Rota inexistente | `404` |

Volume em `core`: 104.567 atendimentos, 61.144 interações, 5.903 reembolsos,
6.246 transferências, 2.649 tomadas, 165.711 fatos, 18 tabelas, 61 rejeitos
auditáveis.

### O árbitro: as métricas novas contra o que a gestora vê hoje `01/10`

Esta é a verificação que faltava, e é a que autoriza desligar os painéis
antigos. `public._interaction_events` é a função que alimenta **todos** os
painéis de hoje. Comparei a saída dela com `core.interaction_facts` em janelas
fechadas — fechadas porque o legado continua recebendo registros e o `core`
está parado desde a travessia.

| Janela | Aberturas (legado → novo) | Interações (legado → novo) | Veredito |
|---|---|---|---|
| ago/2026 | 9.399 → 9.399 | 10.052 → 10.052 | **IGUAL** |
| set/2026, dias 1 a 25 | 9.383 → 9.383 | 8.526 → 8.526 | **IGUAL** |
| histórico inteiro | 102.663 → 102.663 | 59.654 → 59.653 | **−1, explicado** |

A única linha de diferença em todo o histórico cai em **05/05/2026**, e é
exatamente a interação órfã rejeitada na travessia: `source_table =
service_follow_ups`, `reason_code = ORPHAN_TICKET`, `recorded_at =
2026-05-05T16:51`. Ela não foi perdida — está em
`core.migration_rejects.payload`, com a linha original intacta em `public`.

**Ou seja:** sobre 162.317 linhas de histórico, o número novo é idêntico ao
número antigo, com uma divergência de uma linha que é o rejeito documentado.

### E o custo, que era o motivo de tudo isto

Mesma pergunta — contagem por dia em agosto — medida com `EXPLAIN ANALYZE` em
produção:

| | Tempo | Páginas lidas |
|---|---|---|
| `_interaction_events` (legado) | 151,6 ms | 46.034 |
| `core.interaction_facts` (novo) | **4,3 ms** | **25** |

**35× mais rápido, 1.841× menos páginas.** E o número de cima é de **uma**
chamada: `dashboard_metrics` e `agent_my_metrics` chamam essa função **6 vezes
cada** — conferido contando as ocorrências na definição delas em produção. Um
carregamento de painel custa hoje ~910 ms de processamento e ~2,1 GiB de
páginas percorridas. A rota nova faz **um** percurso, num CTE, para os cinco
agrupamentos (garantia G11.2).

### O padrão por horário, e a lição de medir depois de aplicar

`dashboard_hourly_pattern` é a mais cara das RPCs: varre as duas tabelas
**sete** vezes. Mesma pergunta — contagem por dia da semana e hora, agosto:

| | Tempo | Páginas |
|---|---|---|
| Legado | 110,6 ms | 45.378 |
| Só com `0007` | 105,6 ms | 11.777 |
| Com `0008` | **26,8 ms** | **51** |

A linha do meio é a que ensina. Depois de aplicar `0007`, a varredura do índice
custava 1,6 ms — e o `join` com os 104.567 tickets custava 66 ms. **O índice
resolvia e o join devolvia o problema inteiro.** Se a conferência tivesse
parado no `[]` da migration, teria entrado em produção uma rota que não é mais
rápida que a de hoje.

O join existia por uma condição: no padrão de horário o legado só conta a
interação feita pelo próprio criador do ticket. Ela não é descartável — corta
7.114 das 61.144 interações, 11,6%. Virou coluna (`by_ticket_creator`) com
índice parcial, e o join saiu.

**Regra que sai disto:** migration aplicada não é ganho medido. Depois de
aplicar, rode `EXPLAIN ANALYZE` da consulta real contra produção e compare com
o legado. Duas vezes neste projeto o custo estava num lugar diferente de onde
eu supunha.

### A tabela de fatos tem dois eixos de tempo, de propósito

| Coluna | O que é | Serve a |
|---|---|---|
| `day` | a data que o agente **declarou** | volume, metas, ritmo |
| `occurred_at` | o **instante real** do registro | hora do dia, turno, pico |

Medido: em **9.074 aberturas** os dois eixos caem em dias diferentes. Quem
registra à meia-noite o atendimento de ontem aparece no dia de ontem no volume
e na madrugada no mapa de horário. O legado faz exatamente isso, usando
`service_date` num lugar e `created_at` no outro. Com um eixo só, um dos dois
painéis passa a mentir e ninguém percebe olhando.

Na interação os dois coincidem, porque ambos saem de `recorded_at` — conferido:
0 divergências em 61.144.

### Números da travessia, medidos em produção

| Medida | Resultado |
|---|---|
| Produtos no catálogo | 75 |
| Usuários | 47 |
| Concluídos sem interação preservados | 1.220 (era o defeito C8) |
| Numerações duplicadas resolvidas sem apagar linha | 5.545 pares |
| Legado depois da travessia | contagem idêntica à de antes |
| Rejeitos auditáveis | 61, todos com `reason_code` e `payload` |

Os rejeitos por motivo: 40 `ORPHAN_TICKET` (transferências e tomadas cujo
ticket não existe), 16 `UNKNOWN_*` (agente fora do catálogo), 3
`DATE_OUT_OF_RANGE` (datas de 1997), 1 interação órfã, 1 reembolso sem agente.
Nenhuma linha original foi tocada.

---

## 2-A. Os fluxos do agente em produção — conferidos em 01/10, 12:07 SP

> Mapeado a pedido do dono, depois de a gestora relatar que "o sistema está
> liberando o preenchimento do mesmo cliente mais de uma vez ao dia".
> **Primeiro fato:** nenhuma tela do agente passa pela API nova. O que o
> agente usa hoje é o sistema antigo, intocado. O que mudou, mudou lá — ou não
> mudou, como se viu.

### Os fluxos estão vivos

| Fluxo (tabela) | Hoje até 12:07 | Mesmo dia, semana passada (dia inteiro) | Último registro |
|---|---|---|---|
| Atendimentos (`services`) | 173 | 542 | 12:05 |
| Interações (`service_follow_ups`) | 226 | 344 | 12:07 |
| Reembolsos (`refunds`) | 32 | 52 | 11:59 |
| Transferências | 9 | 57 | 09:53 |
| Tomadas de ticket | 18 | 55 | 11:35 |
| Pedidos em espera (importados) | 25 | 92 | 10:10 |
| Caderno do agente | 0 | 0 | ontem 17:08 |

Edge Functions: `zendesk` v9 e `lya` v11, ambas `ACTIVE`.

### As regras de servidor que o fluxo depende estão vivas

Medido nos 174 atendimentos de hoje:

| Regra | Mecanismo | Resultado hoje |
|---|---|---|
| Data do atendimento fixada em hoje | `trg_service_pin_date_on_insert` | 0 com data diferente |
| Motivo "reembolso" cria o reembolso | `trg_service_sync_refund_ins` | 21 tickets, 0 sem registro |
| Dono atual preenchido | `trg_service_default_current_owner` | 0 sem dono |
| Instante da interação é `now()` | `trg_follow_up_force_now` | 0 no futuro |
| Interação em ticket alheio | RLS permite (`CHECK user_id = uid` só) | 0 hoje; 15 em 45 dias |

### A queixa da gestora: o mecanismo, medido

A regra das 18h **vive só no navegador** (`useStatusTracking.canAddInteraction`).
O banco não barra: ele só **marca** (`_tg_follow_up_mark_same_day_repeat` →
`is_same_day_repeat`). O diálogo de acompanhamento aplica a regra e desabilita
o botão — **exceto quando o status escolhido é "Concluído"**:

```ts
// StatusTrackingDialog.tsx:94
const canSubmit = !addEntryMutation.isPending &&
  (status === "concluido" || interactionCheck.allowed || isReopening);
```

Isso é deliberado no código: concluir sempre pode. E é por aí que passa tudo:

| Em 45 dias | |
|---|---|
| Interações repetidas no mesmo dia, antes das 18h, sem código de rastreio | **439** |
| … com status "Concluído" | **435** (99%) |
| … registradas por outro agente que o anterior | 15 |
| … em menos de 90 s da anterior | 47 (16 em menos de 10 s) |
| … sem explicação | **0** |
| Agentes envolvidos | 8 — um deles responde por 310 das 443 marcações |

**Não é regressão.** Por semana, desde 17/08: 56, 88, 42, 48, 75, 95, 39. É
assim há pelo menos sete semanas, e o código não mudou nesse período.

**O que isso faz com os números.** A marcação existe, mas só
`dashboard_same_day_repeats` (a seção "Interações repetidas no mesmo dia" em
`/dashboard/alertas`) a lê. `_interaction_events` **não** filtra, então todas as
outras métricas — inclusive a **meta diária do agente** — contam o "Concluído"
do mesmo dia como segunda interação. Em 30/09, uma agente contou 201 na meta
com 6 repetidos; outra, 152 com 9.

A outra leitura da queixa — ticket **novo** para o mesmo e-mail no mesmo dia —
é pequena (3 a 8 por semana) e passa porque `find_ticket_by_email` só acha
ticket **não concluído**: concluiu, pode abrir de novo.

### O que isso significa para a arquitetura nova `BLOQUEIO DO CORTE`

A decisão D1 removeu o bloqueio das 18h e disse: "`is_same_day_repeat`
**continua sendo marcado** — a marcação é o que evita contar a conversa duas
vezes". Conferido em código e em produção: **nada na v2 marca.** A coluna
existe em `core.interactions` com `DEFAULT false`; os três gatilhos da tabela
(`freeze_recorded_at`, `refresh_ticket_state`, `sync_fact`) não a calculam; a
API só a devolve. As 1.720 marcações que o `core` tem vieram copiadas do
legado na travessia; 0 interações nasceram pela API até agora.

No dia em que a tela do agente virar, toda interação nova entraria como
`false`, e a seção de repetidos da gestora ficaria cega. **É um gatilho em
`core` replicando `_tg_follow_up_mark_same_day_repeat`, e precisa entrar antes
do corte.** Está no backlog como B26.

---

## 3. O que está fora de produção

### 3.1 Migrations `RESOLVIDO 01/10`

Nada pendente. As migrations 0001, 0002, 0004, 0005, 0006, **0007 e 0008** estão
aplicadas, e as travessias 0003, 0004 e 0006 rodaram. 18 tabelas em `core`.

> `0008` recusa a segunda execução com `column already exists`, porque não usa
> `IF NOT EXISTS`. Isso é proteção, não defeito: a mensagem diz que já entrou.
> Antes de concluir qualquer coisa a partir dela, confira o estado — foi o que
> fiz, e os oito indicadores estavam corretos.

### 3.2 Três PRs abertos `AGUARDAM MERGE`

| PR | O que traz |
|---|---|
| #101 | sincronizador de edições (abaixo) |
| #106 | este documento |
| #107 | as quatro telas da gestora, `0007` e `0008` — **o SQL já está em produção; falta o código da API** |

> **Atenção à ordem:** `0007` e `0008` já estão aplicadas no banco, mas as
> rotas que as usam só sobem quando #107 mergear. Até lá a API em produção tem
> 28 rotas, não 32.

#### #101 · sincronizador de edições

`packages/db/backfill/0005_sync_edicoes.sql` existe só nesse PR. A travessia
copia registros **novos**; ela ignora **edições** de registros que já tinham
atravessado. O script fecha esse buraco.

> **Aviso que está no cabeçalho do próprio arquivo e precisa ser respeitado:**
> **não rodar depois que a API virar a dona da escrita.** Rodar depois sobrescreve
> com o legado aquilo que a API gravou.

### 3.3 A deriva, que é o que define o corte `MEDIDO 01/10`

O legado continua recebendo registros; o `core` está parado desde a travessia.

| | Legado | `core` | Deriva |
|---|---|---|---|
| Atendimentos | 105.255 | 104.567 | **688** |
| Interações | 61.796 | 61.144 | **652** |

Todos os 688 são registros **novos** — nenhum ticket do `core` perdeu o par no
legado. A deriva cresce em torno de 230 atendimentos por dia útil. Ela não é
um defeito: é o preço de os dois sistemas coexistirem, e some no corte.

---

## 4. As quatro correções da mesma função — leia antes de mexer nisto

A função na Vercel precisou de **quatro** correções, e nenhuma delas aparece
em teste local. Vale entender o padrão para não repetir.

| # | Sintoma em produção | Causa | Situação |
|---|---|---|---|
| #94 | `/api/v1/health` devolvia o HTML do app | `vercel.json` mandava **tudo** para `index.html`, inclusive `/api/*` | mergeado |
| #95 | função invocada mas não carregava | a Vercel roda `npm install` na **raiz**, e a raiz não tinha `hono`, `postgres`, `jose` nem `@xmx/contract` | mergeado |
| #97 | `FUNCTION_INVOCATION_FAILED` | `@xmx/contract` apontava para TypeScript puro e as importações internas não tinham extensão | mergeado |
| #99 | `FUNCTION_INVOCATION_FAILED` | 29 imports com extensão `.ts` sobreviviam no JS emitido. A Vercel compila com `tsc` e **emite**; `.ts` só funciona com `noEmit` | mergeado |

**A lição de método, que vale para todo o resto do projeto.**

As quatro só aparecem em produção porque o ambiente local sempre empacota e a
Vercel compila. Três foram descobertas às cegas, publicando e vendo quebrar.
A quarta levou minutos, porque finalmente rodei o build da Vercel na máquina.

**Rode isto antes de publicar qualquer mudança na função:**

```bash
vercel pull --yes --environment production && vercel build --prod --yes
cd .vercel/output/functions/api/index.func && node -e "import('./api/index.js').then(m=>console.log('CARREGOU:',Object.keys(m))).catch(e=>console.log('FALHOU:',e.message))"
```

Se carregar aqui, carrega lá. Esse passo teria encontrado as quatro no
primeiro dia.

---

## 5. Próximos passos, em ordem

### Passos 1 a 3 · Infraestrutura `CONCLUIDO 30/09–01/10`

Função no ar (#94, #95, #97, #99), variáveis na Vercel, conexão com o banco
(#102), migrations e travessias aplicadas, tabela de fatos populada, métricas
conferidas contra o legado. Nada de infraestrutura está pendente.

### Passo 4 · A decisão do corte `AGUARDA O DONO`

Este é o único passo que mexe no que o time usa, e por isso não avança sem
decisão. O problema tem nome: **o sincronizador só corre numa direção**, do
legado para o `core`. Ligar uma tela sozinha cria duas verdades.

| Caminho | O que acontece | Risco |
|---|---|---|
| **A. Virar agente e gestora juntos** | o dado nasce na API e os painéis leem do `core`; uma verdade só | exige janela curta de congelamento para a última sincronização (minutos, fora do horário) |
| **B. Virar só a tela do agente** | o agente grava no `core`; os painéis continuam no legado e **param de ver o que ele digita** | **alto** — a gestora enxergaria menos atendimento do que houve |
| **C. Gravar nos dois** | sem janela de parada | **alto** — duas escritas sem transação comum; qualquer falha deixa os dois divergentes e sem árbitro |

**Recomendação: caminho A.** As métricas foram conferidas contra o legado, que
era a condição que faltava para virar a gestora junto. O caminho C parece o
mais seguro e é o mais perigoso: a escrita dupla não tem como ser atômica
entre dois schemas com gatilhos diferentes.

O que falta em código para o caminho A:

- **Tela do agente:** `PATCH /tickets/:id`, `DELETE /tickets/:id` e a exportação.
- **Painel da gestora:** ~~as rotas de auditoria, padrão por horário, detalhe de
  canal e detalhe de interações~~ — **prontas em #107.** Nada falta aqui.
- **Gatilho que marca `is_same_day_repeat` em `core.interactions`** (B26) —
  sem ele, a seção de repetidos da gestora fica cega no dia do corte. Ver 2-A.
- **Roteiro do corte:** congelar escrita, rodar `0005_sync_edicoes.sql` e a
  travessia uma última vez, reconciliar, apontar as telas, liberar. Com
  reversão: enquanto o legado continuar intacto, voltar é mudar o apontamento.

### Passo 5 · Módulos restantes

Oito de quatorze ainda não existem, na ordem de dor:

```
pedidos-em-espera  →  radar  →  caderno  →  base-de-suporte
treinamento  →  usuarios  →  copy-analytics  →  exportacoes
integracoes (zendesk, lya)
```

---

## 6. O que existe hoje na API

| Módulo | Rotas | Situação |
|---|---|---|
| `health` | `GET /health`, `GET /health/db` | em produção, sem token por desenho |
| `session` | `GET /me` | em produção |
| `catalogs` | `GET /catalogs` | em produção |
| `tickets` | 6 rotas | em produção |
| `refunds` | 6 rotas | em produção |
| `transfers` / `takeovers` | 8 rotas | em produção |
| `notifications` | 2 rotas | em produção |
| `metrics` | `/metrics/dashboard`, `/metrics/me` | em produção, sobre a tabela de fatos |
| `metrics` (gestora) | `/metrics/audit`, `/metrics/hourly`, `/metrics/channels`, `/metrics/agents` | **em #107**, banco já pronto |

Total: **32 rotas** de 80 especificadas (28 publicadas, 4 em #107). Dos 14
módulos, **6 existem**, e `metricas` está completo.

### Como rodar as suítes

```bash
./packages/db/run-tests.sh
```

Esperado, com o denominador: **59 garantias em 4 arquivos, zero falhas.**

```bash
dropdb --if-exists xmx_api_test; createdb xmx_api_test
for f in packages/db/migrations/000[1-8]*.sql; do psql -q -d xmx_api_test -v ON_ERROR_STOP=1 -f "$f"; done
cd apps/api && PGDATABASE=xmx_api_test DATABASE_URL=postgres://localhost/xmx_api_test ALLOW_DEV_TOKENS=1 SUPABASE_URL=https://kjkyyqxqrqsdozjyyuon.supabase.co ../../node_modules/.bin/tsx src/test/run.ts
```

Esperado: **88 verificações, zero falhas.** Precisa de Postgres local.

Ensaio da travessia, com os casos difíceis medidos em produção:

```bash
createdb xmx_bf && for f in packages/db/migrations/000[1-8]*.sql packages/db/backfill/fixture_legado.sql packages/db/backfill/0003_backfill.sql packages/db/backfill/0004_backfill_reembolsos.sql packages/db/backfill/0006_backfill_fatos.sql; do psql -q -d xmx_bf -v ON_ERROR_STOP=1 -f "$f"; done && psql -d xmx_bf -f packages/db/backfill/reconciliacao.sql
```

> `reconciliacao.sql` usa `\set`, que é comando do `psql` e a Management API
> **recusa**. Pela API use `reconciliacao-api.sql`.

---

## 7. Decisões já tomadas — não reabrir

Estão em `00-CONTRATO.md` §8-A, com o raciocínio completo. Resumo:

| # | Decisão |
|---|---|
| D1 | A regra das 18h **não bloqueia** mais. Mas `is_same_day_repeat` continua sendo marcado, porque é o que evita contar a mesma conversa duas vezes na métrica |
| D2 | A API usa o token do usuário e a proteção por linha continua como rede. O recorte real vai no `WHERE` servido por índice; a policy só confirma |
| D3 | A avaliação disciplinar sai do browser, com metas datadas em `GET /metrics/compliance`. Valores iniciais idênticos aos de hoje |
| D4 | Todo valor monetário é **dólar**, e viaja como `{amount, currency}` |
| D5 | `platform` e `channel`: "Nenhum" e vazio permanecem **distintos** |
| D6 | E-mails preservados como digitados; normalização só em coluna gerada |
| D7 | Paginação numerada mantida nas listas frias; cursor só em "Meus Atendimentos" |

### O princípio que resolve a preservação de dados

**O catálogo é aberto para ler o passado e fechado para escrever o futuro.**

Todo valor existente ganha linha, inclusive erro de digitação e uso fora de
lugar. Nenhum registro é rejeitado por ter valor estranho. Mas só linhas
marcadas como selecionáveis servem para escrita nova, e o critério é a
própria coluna `legacy_id` — sem sinalizador de sessão para alguém esquecer
de desligar.

### A ordem canônica é `(recorded_at, seq)`, nunca `(recorded_at, id)`

Herdada de `my_follow_ups()`, a ordem antiga é um sorteio: `now()` em Postgres
é da **transação**, então interações gravadas no mesmo pedido têm
`recorded_at` idêntico e o desempate cai num uuid aleatório. No teste, um
ticket concluído voltou a `em_andamento`. A travessia atribui `seq` na ordem
legada, então o histórico exibido não muda.

---

## 8. Armadilhas desta máquina e deste repositório

Custaram tempo real. Leia antes de trabalhar.

**A árvore de trabalho principal está numa branch defasada.** O repositório
principal está em `v2`, dezenas de commits atrás da produção, travado por 16
arquivos não commitados de outro agente, parados desde 21/09. **Confira a base
antes de cada commit:**

```bash
git merge-base --is-ancestor origin/main HEAD && echo "sobre main" || echo "DEFASADO — transplante antes"
```

Três vezes commits caíram na base errada e precisaram de transplante. O
worktree `~/dev-worktrees/unity-path-wt-v2base` serve para isto: ramificar
sempre de `origin/main`.

**Nunca mova o ponteiro de uma branch que está com checkout em outro
worktree.** Existem 16 worktrees neste repo. Fazer isso deixa a árvore do
principal inconsistente com o HEAD.

**Há um stash deliberado de outra pessoa**, com mensagem
"deferred: reportExport + MinhasMetricas pending review". Eu o restaurei sem
querer e voltei atrás. Não mexa.

**`node_modules` em Documents é sincronizado pelo iCloud** e trava `tsc` e
`vitest`. Para worktree, use uma cópia real em vez de link.

**`python3` não tem certificado raiz nesta máquina.** Chamada HTTPS estoura;
use `curl`.

**Aplicar DDL em produção é bloqueado** para mim pelo classificador. O SQL
fica pronto e o dono executa. `gh pr merge` também.

**O host do pooler é `aws-1-sa-east-1`, não `aws-0`.** Documentos antigos
deste projeto traziam `aws-0` e estavam errados.

---

## 9. Regras de verificação — aprendidas errando

Cinco vezes uma medição pareceu conclusiva comparando coisas diferentes.
Todas foram pegas, mas custaram tempo.

| Erro | O que corrigiu |
|---|---|
| Varri 30 de 200 arquivos e li a ausência como prova | **reportar o denominador**: "nenhum resultado" sem "sobre quantos" não prova nada |
| Comparei o bundle de produção com ele mesmo | dizer explicitamente **contra o que** se compara |
| Teste de fuso que premiava qualquer deslocamento para trás | achar um **árbitro independente** (foi o gatilho que fixa a data) |
| Reinstalei dependências entre dois builds e culpei meu código | **isolar a variável**: mesmo ambiente, só a mudança em teste |
| Cadeia com `&&` onde um passo falha deixa a variável seguinte vazia, e comparar com vazio devolve "diferente" | conferir o código de saída de **cada** passo |

Uma sexta, de 01/10: **migration aplicada não é ganho medido.** A `0007`
aplicou sem erro e a consulta continuou custando 105 ms contra 110 ms do
legado — o índice resolvia e um `join` devolvia o problema inteiro. O que
corrigiu: rodar `EXPLAIN ANALYZE` da consulta real contra produção **depois** de
aplicar, e comparar com o legado em tempo e em páginas.

A regra do árbitro independente é a que mais rendeu: a conferência das
métricas da seção 2 existe porque a pergunta certa não é "a tabela nova está
consistente consigo mesma?", é "ela diz o mesmo que a função que a gestora
usa hoje?".

---

## 10. Onde está cada coisa

| Caminho | Conteúdo |
|---|---|
| `docs/arquitetura-v2/00-CONTRATO.md` | normativo: HTTP, erros, paginação, fuso, decisões, regra de DDL |
| `docs/arquitetura-v2/01-GARANTIAS.md` | as 12 classes de erro e a garantia mecânica de cada uma |
| `docs/arquitetura-v2/10..13` | inventário de regras, superfície da API, schema alvo, estrutura |
| `docs/arquitetura-v2/20..23` | inventário exaustivo das telas e o mapa tela→endpoint |
| `docs/arquitetura-v2/30..32` | estado real do banco, perfil dos dados, plano de travessia |
| `docs/arquitetura-v2/90-BACKLOG.md` | 24 itens adiados, com número medido |
| `docs/arquitetura-v2/91-MEDICOES.md` | medições que fecharam itens abertos |
| `docs/arquitetura-v2/TAREFA-vercel-variaveis.md` | tarefa fechada, já concluída, serve de modelo |
| `packages/contract/` | a fronteira entre web e api |
| `packages/db/migrations/` | schema (0001, 0002, 0004, 0005, 0006, 0007, 0008) |
| `packages/db/backfill/` | a travessia (0003, 0004, 0006) e as reconciliações |
| `packages/db/tests/` | as 59 garantias de schema |
| `apps/api/` | a API (Hono + postgres.js); `src/test/run.ts` tem as 88 verificações |
| `api/index.ts` | ponto de entrada como Função da Vercel |

---

## 11. Registro de passos concluídos

Quem termina um passo escreve aqui: data, o que foi feito, e **a evidência**.

| Data | Passo | Evidência |
|---|---|---|
| 26/09 | Levantamento completo | 15 documentos, 16.341 linhas |
| 26/09 | Vazamento da view fechado | leitura e escrita anônimas → 401; Lya intacta |
| 28/09 | Moeda em dólar em produção (#91) | 160 chunks varridos, zero com rótulo em real |
| 28/09 | Schema `core` + catálogos em produção | 11 objetos no catálogo |
| 28/09 | Travessia dos dados em produção | 13/13 na reconciliação, 3 rejeitos explicados |
| 28/09 | Roteamento e dependências da função (#94, #95) | função passou a ser invocada |
| 30/09 | Contrato compilado (#97) | `vercel build` local prova que `packages/contract/dist` entra na função |
| 30/09 | **API no ar e autenticando (#99)** | `/health` → `{"ok":true}`; token forjado → 401 "assinatura inválida"; atalho de dev → 401 |
| 30/09 | Migrations 0004/0005 e travessia dos 3 módulos | contas fechando: refunds 5.905=5.903+2, transfers 6.274=6.246+28, takeovers 2.677=2.649+28 |
| 30/09 | Rota de prontidão do banco (#102) | 503 limpo com banco inalcançável, sem vazar conexão |
| 30/09 | **Variáveis na Vercel e conexão de pé** | `/health/db` → `{"ok":true,"db":"up"}` |
| 01/10 | Tabela de fatos criada e populada (#104) | 165.711 = 104.567 aberturas + 61.144 interações, idêntico às tabelas de origem |
| 01/10 | Rotas de métricas no ar (#105) | 65 verificações na suíte; `/metrics/dashboard` sem token → 401 |
| 01/10 | **Métricas novas conferidas contra o legado** | ago e set/2026 idênticos; histórico 102.663=102.663 aberturas e 59.654→59.653 interações, a única diferença sendo o rejeito órfão de 05/05/2026 |
| 01/10 | Ganho medido em produção | 151,6 ms / 46.034 páginas → 4,3 ms / 25 páginas, e o legado chama isso 6× por painel |
| 01/10 | Deriva medida | 688 atendimentos e 652 interações, todos registros novos; nenhum par perdido |
| 01/10 | Quatro telas da gestora, módulo de métricas completo (#107) | 32 rotas, 88 verificações de API, 59 garantias de schema |
| 01/10 | Eixo do relógio em produção (`0007`) | 165.711 instantes, nenhum nulo, nenhum fora da origem; distribuição por hora idêntica ao legado nas 24 horas de agosto |
| 01/10 | Filtro do criador materializado (`0008`) | 158.597 marcadas = 165.711 − 7.114; padrão por horário de 110,6 ms / 45.378 páginas para **26,8 ms / 51 páginas** |
| 01/10 | Erro de mapeamento pego pelo árbitro | filtro escrito com `current_owner_id` dava 955 linhas a mais em agosto; o legado usa o **criador** |
| 01/10 | Quebra de paridade pega lendo os guardas | `/metrics/dashboard` exigia `can_view_all_tickets`, que 0 de 49 usuários têm — recusaria a gestora |
| 01/10 | Fluxos do agente em produção mapeados (seção 2-A) | 7 fluxos vivos com registro nos últimos minutos; 5 regras de servidor com 0 violações hoje |
| 01/10 | Queixa da gestora explicada com número | 435 de 439 repetições do mesmo dia são "Concluído", exceção deliberada do diálogo; estável há 7 semanas; a meta diária conta |
| 01/10 | **Lacuna da v2 encontrada antes do corte** | nada marca `is_same_day_repeat` em `core` — B26, bloqueio do passo 4 |
| — | **Decisão do corte** | **próximo — aguarda o dono. Passo 4, caminho A recomendado, depois de B26** |
