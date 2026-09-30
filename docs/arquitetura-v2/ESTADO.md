# Estado da reconstrução — documento vivo

> **Para quem assume o trabalho.** Este arquivo diz onde a reconstrução está
> agora, o que já foi verificado e o que fazer em seguida. Ele é atualizado a
> cada passo concluído: quem termina um passo marca aqui, com a data e a
> evidência que provou o resultado.
>
> Regra que vale mais que qualquer outra neste projeto: **nada é "pronto"
> porque passou no teste local.** Só é pronto quando responde em produção e
> a resposta foi conferida. Três correções seguidas na mesma função (#94,
> #95, #97) existem porque essa regra foi ignorada.

**Última verificação:** 30/09/2026, conferida contra `origin/main`, contra o
banco de produção e contra `https://xmxapp.vercel.app`.

> **A API está no ar E LENDO O BANCO.** Desde 30/09/2026:
> `/api/v1/health` → `{"ok":true}` e `/api/v1/health/db` → `{"ok":true,"db":"up","ms":116}`.

---

## 1. Resumo em três linhas

Os dados já atravessaram: 103.057 atendimentos e 60.030 interações vivem no
schema `core` em produção, ao lado do legado intocado, com reconciliação
assinada. **A API está no ar, autentica e lê o banco**, com 26 rotas. A fundação está
completa. O próximo trabalho é de produto, não de infraestrutura: ligar a tela
de Atendimentos e construir os módulos restantes (seção 5, passos 4 e 5).

---

## 2. Em produção, funcionando `VERIFICADO`

| O quê | Quando | Como foi provado |
|---|---|---|
| Vazamento da view `lya_agentes` fechado | 26/09 | leitura e escrita anônimas devolvem 401; o papel `lya_sql_ro` ainda lê os 47 perfis |
| Moeda dos reembolsos em dólar (PR #91) | 28/09 | varredura dos 160 chunks do bundle: `Valor (R$)` em nenhum, `currency:"BRL"` em nenhum |
| Schema `core` (migrations 0001 e 0002) | 28/09 | 11 objetos presentes no catálogo |
| Travessia dos dados (backfill 0003) | 28/09 | 13 de 13 verificações de reconciliação |
| **API no ar e autenticando** (#99) | 30/09 | ver a tabela de comportamento abaixo |
| **Migrations 0004 e 0005 + travessia** | 30/09 | 6 tabelas criadas; contas fechando nos 3 módulos |
| **Conexão com o banco em produção** (#102) | 30/09 | `/health/db` → `{"ok":true,"db":"up","ms":116}` |

### Comportamento da API em produção, conferido em 30/09

| Requisição | Resposta |
|---|---|
| `GET /api/v1/health` | `{"ok":true}` |
| `GET /api/v1/health/db` | `{"ok":true,"db":"up","ms":116}` — estável em 3 chamadas |
| `GET /api/v1/me` sem token | `401 UNAUTHENTICATED` |
| `GET /api/v1/tickets` sem token | `401` |
| Token **forjado** | `401` — "assinatura inválida" |
| Atalho de desenvolvimento | `401` — "recusado em produção" |
| Rota inexistente | `404` |

A verificação de assinatura funciona contra as chaves reais do Supabase, o
atalho de desenvolvimento está barrado, **e a conexão com o banco está de pé**.

Volume servido: 104.567 atendimentos, 61.144 interações, 5.903 reembolsos,
6.246 transferências, 2.649 tomadas de ticket.

### Números da travessia, medidos em produção

| Medida | Resultado |
|---|---|
| Atendimentos | 103.059 no legado = 103.057 migrados + 2 rejeitados |
| Interações | 60.031 no legado = 60.030 migradas + 1 rejeitada |
| Produtos no catálogo | 75 |
| Usuários | 47 |
| Concluídos sem interação preservados | 1.220 (era o defeito C8) |
| Numerações duplicadas resolvidas sem apagar linha | 5.545 pares |
| Legado depois da travessia | contagem idêntica à de antes |

Os 3 rejeitos: dois atendimentos com data de **28/04/1997** e a interação
órfã de um deles. As linhas originais continuam em `public`, intactas, e o
conteúdo delas está em `core.migration_rejects.payload`.

---

## 3. Em `main`, mas **não** em produção

### 3.1 Migrations 0004 e 0005 nunca aplicadas `PENDENTE`

Conferido no catálogo de produção em 30/09. **Faltam seis tabelas:**

```
core.refund_reason_categories   core.ticket_transfers
core.refunds                    core.ticket_takeovers
core.refund_events              core.notifications
```

Consequência: os módulos de reembolso, transferência e notificação existem em
código e **não têm onde gravar**. Aplicar é o passo 2 da seção 5.

### 3.2 Nada — a infraestrutura está completa `RESOLVIDO 30/09`

Função no ar, autenticando e lendo o banco. O que falta daqui para a frente é
produto: ligar as telas e construir os módulos restantes.

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
vercel pull --yes --environment production
vercel build --prod --yes
grep -iE "error TS" .vercel/output/../../../tmp/vbuild.log   # ou veja a saída do build
cd .vercel/output/functions/api/index.func && node -e "import('./api/index.js').then(m=>console.log('CARREGOU:',Object.keys(m))).catch(e=>console.log('FALHOU:',e.message))"
```

Se carregar aqui, carrega lá. Esse passo teria encontrado as quatro no
primeiro dia.

---

## 5. Próximos passos, em ordem

Cada passo depende do anterior. Não pule.

### Passo 1 · Pôr a função no ar `CONCLUIDO 30/09`

Feito nos PRs #94, #95, #97 e #99. Conferido em produção — ver a tabela de
comportamento na seção 2.

### Passo 2 · Aplicar as migrations 0004 e 0005 em produção `PROXIMO`

Aditivo e reversível: cria tabelas novas no schema `core` e não toca nada do
legado nem do que já migrou.

```bash
TOK=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d); for f in packages/db/migrations/0004_reembolsos.sql packages/db/migrations/0005_transferencias.sql packages/db/backfill/0004_backfill_reembolsos.sql; do echo "== $f"; python3 -c "import json,sys;print(json.dumps({'query':open(sys.argv[1]).read()}))" "$f" | curl -s -X POST "https://api.supabase.com/v1/projects/kjkyyqxqrqsdozjyyuon/database/query" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data-binary @- | head -c 600; echo; done
```

Rodar da raiz do repositório. Saída esperada: `[]` em cada um, que significa
sucesso sem linhas retornadas.

> **Atenção:** `reconciliacao.sql` usa `\set`, que é comando do `psql` e a
> Management API **recusa**. Pela API use `reconciliacao-api.sql`.

Reconciliar depois, e o critério é aritmético:

```
linhas no legado = linhas em core + linhas em migration_rejects
```

### Passo 3 · Variável de ambiente na Vercel `CONCLUIDO 30/09`

> Tarefa pronta para delegar, com a navegação tela a tela:
> **`TAREFA-vercel-variaveis.md`**.
>
> **Existem DOIS projetos na Vercel.** As variáveis vão em **`xmxapp`**
> (`https://xmxapp.vercel.app`, o que o time usa), e **não** em `unity-path`.
> O `xmxapp` já tem três variáveis `VITE_SUPABASE_*` de ~200 dias atrás; o
> `unity-path` não tem nenhuma. Tela vazia = projeto errado.

Segredo do dono do projeto. Em Settings → Environment Variables, para
Production:

```
DATABASE_URL=postgresql://postgres.kjkyyqxqrqsdozjyyuon:<SENHA>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://kjkyyqxqrqsdozjyyuon.supabase.co
```

A senha está em Supabase → Project Settings → Database. Use a string do
**Transaction pooler**, porta 6543, que é a correta para função sem
servidor. Depois de salvar é preciso um Redeploy para valer.

Teste com um token real de agente:

```bash
curl -s -H "Authorization: Bearer <TOKEN>" "https://xmxapp.vercel.app/api/v1/tickets?limit=2"
```

### Passo 4 · Ligar a tela de Atendimentos do agente

Só depois dos três anteriores. O que falta na API para essa tela:
`PATCH /tickets/:id`, `DELETE /tickets/:id` e a exportação. O resto das
rotas que ela usa já existe.

É o passo que o time sente, porque acaba com o download de até 1,5 MB por
agente só para pintar um badge de status.

### Passo 5 · Módulos restantes

Nove de quatorze ainda não existem, na ordem de dor:

```
metricas  →  pedidos-em-espera  →  radar  →  caderno
base-de-suporte  →  treinamento  →  usuarios
copy-analytics  →  exportacoes  →  integracoes (zendesk, lya)
```

`metricas` é o mais urgente: é o que hoje derruba o banco, com a função
central sendo chamada de 5 a 9 vezes por requisição de dashboard.

---

## 6. O que existe hoje na API

| Módulo | Rotas | Situação |
|---|---|---|
| `session` | `GET /me` | código pronto, sem tabela pendente |
| `catalogs` | `GET /catalogs` | idem |
| `tickets` | 7 rotas | idem |
| `refunds` | 6 rotas | **tabelas faltam em produção** |
| `transfers` / `takeovers` | 8 rotas | **tabelas faltam em produção** |
| `notifications` | 2 rotas | **tabela falta em produção** |

Total: **25 rotas** de 80 especificadas. Dos 14 módulos, **5 existem**.

### Como rodar as suítes

```bash
./packages/db/run-tests.sh
```

Esperado: 33 garantias em 2 arquivos, zero falhas.

```bash
cd apps/api && PGDATABASE=xmx_api_test DATABASE_URL=postgres://localhost/xmx_api_test ALLOW_DEV_TOKENS=1 SUPABASE_URL=https://kjkyyqxqrqsdozjyyuon.supabase.co ../../node_modules/.bin/tsx src/test/run.ts
```

Esperado: 50 verificações, zero falhas. Precisa de Postgres local.

Ensaio da travessia, com os casos difíceis medidos em produção:

```bash
createdb xmx_bf && for f in packages/db/migrations/0001_core.sql packages/db/migrations/0002_catalogos.sql packages/db/migrations/0004_reembolsos.sql packages/db/migrations/0005_transferencias.sql packages/db/backfill/fixture_legado.sql packages/db/backfill/0003_backfill.sql packages/db/backfill/0004_backfill_reembolsos.sql; do psql -q -d xmx_bf -v ON_ERROR_STOP=1 -f "$f"; done && psql -d xmx_bf -f packages/db/backfill/reconciliacao.sql
```

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

---

## 8. Armadilhas desta máquina e deste repositório

Custaram tempo real. Leia antes de trabalhar.

**A árvore de trabalho está numa branch defasada.** O repositório principal
está em `v2`, dezenas de commits atrás da produção, travado por 16 arquivos
não commitados de outro agente, parados desde 21/09. **Confira a base antes
de cada commit:**

```bash
git merge-base --is-ancestor origin/main HEAD && echo "sobre main" || echo "DEFASADO — transplante antes"
```

Três vezes commits caíram na base errada e precisaram de transplante.

**Nunca mova o ponteiro de uma branch que está com checkout em outro
worktree.** Existem 15 worktrees neste repo. Fazer isso deixa a árvore do
principal inconsistente com o HEAD.

**Há um stash deliberado de outra pessoa**, com mensagem
"deferred: reportExport + MinhasMetricas pending review". Eu o restaurei sem
querer e voltei atrás. Não mexa.

**`node_modules` em Documents é sincronizado pelo iCloud** e trava `tsc` e
`vitest`. Para worktree, use uma cópia real em vez de link.

**`python3` não tem certificado raiz nesta máquina.** Chamada HTTPS estoura;
use `curl`.

**Aplicar DDL em produção é bloqueado** para mim pelo classificador. O SQL
fica pronto e o dono executa.

---

## 9. Regras de verificação — aprendidas errando

Quatro vezes uma medição pareceu conclusiva comparando coisas diferentes.
Todas as quatro foram pegas, mas custaram tempo.

| Erro | O que corrigiu |
|---|---|
| Varri 30 de 200 arquivos e li a ausência como prova | **reportar o denominador**: "nenhum resultado" sem "sobre quantos" não prova nada |
| Comparei o bundle de produção com ele mesmo | dizer explicitamente **contra o que** se compara |
| Teste de fuso que premiava qualquer deslocamento para trás | achar um **árbitro independente** (foi o gatilho que fixa a data) |
| Reinstalei dependências entre dois builds e culpei meu código | **isolar a variável**: mesmo ambiente, só a mudança em teste |

Mais uma, de script: uma cadeia de comandos com `&&` onde um passo falha
deixa as variáveis seguintes vazias, e a comparação com vazio devolve
"diferente". Verifique o código de saída de cada passo.

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
| `packages/contract/` | a fronteira entre web e api |
| `packages/db/migrations/` | schema; `backfill/` a travessia; `tests/` as garantias |
| `apps/api/` | a API (Hono + postgres.js) |
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
| 28/09 | API com 25 rotas, 50 verificações | suítes locais passando |
| 28/09 | Roteamento e dependências da função (#94, #95) | função passou a ser invocada |
| 30/09 | Contrato compilado (#97) | `vercel build` local prova que `packages/contract/dist` entra na função |
| 30/09 | **API no ar e autenticando (#99)** | `/health` → `{"ok":true}`; token forjado → 401 "assinatura inválida"; atalho de dev → 401 |
| 30/09 | Migrations 0004/0005 e travessia dos 3 módulos | contas fechando: refunds 5.905=5.903+2, transfers 6.274=6.246+28, takeovers 2.677=2.649+28 |
| 30/09 | Sincronizador de edições (#101) | 13/13 na reconciliação com 4 edições simuladas |
| 30/09 | Rota de prontidão do banco (#102) | 503 limpo com banco inalcançável, sem vazar conexão |
| 30/09 | **Variáveis na Vercel e conexão de pé** | `/health/db` → `{"ok":true,"db":"up","ms":116}` |
| — | Tela de Atendimentos ligada na API | **próximo** — passo 4 |
