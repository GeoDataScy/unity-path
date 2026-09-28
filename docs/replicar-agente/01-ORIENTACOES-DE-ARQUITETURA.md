# Orientações de arquitetura — agente de IA especialista nos dados de um sistema
## (a arquitetura da Lya e do Daniel)

> **Para quem é este arquivo.** Para a IA de programação (Claude Code, Cursor,
> Codex ou equivalente) que vai construir um agente de IA dentro do sistema de
> um cliente. Leia este arquivo inteiro antes de abrir os outros dois
> (`02-BACKEND-DOS-MODELOS.md` e `03-FRONTEND-DOS-MODELOS.md`). Ele explica o
> que você vai construir, por que cada peça existe, e como adaptar tudo ao
> banco de dados e às telas do cliente.
>
> **Premissa central.** O agente responde perguntas em linguagem natural sobre
> os dados do sistema do cliente. Para isso ele se conecta ao **banco de dados
> do próprio cliente** e às **mesmas funções que já alimentam as telas** do
> sistema. Ele nunca responde com conhecimento próprio do modelo, nunca inventa
> número e nunca faz conta "de cabeça". Tudo o que este documento descreve
> existe para sustentar essas três garantias.
>
> **O que você está replicando.** Dois agentes em produção, com a mesma
> arquitetura:
>
> | agente | cliente | em produção desde | onde roda |
> | --- | --- | --- | --- |
> | **Daniel** | CBIE Analytics (setor de energia) | agosto/2026 | Next.js (route handler) + FastAPI + Supabase |
> | **Lya** | XMX Suporte (painel da gestora do suporte) | 07/09/2026 | Supabase Edge Function (Deno) + React SPA |
>
> A Lya é uma cópia adaptada do Daniel. Ela nasceu já com as correções de um
> diagnóstico feito sobre o Daniel em agosto de 2026 (seção 9). **Quando os
> dois divergirem, siga a Lya.** O Daniel entra como referência para o que a
> Lya não tem (busca web, documentos PDF, anexos, geração de PDF, radar de
> demanda) e para a variante de stack com backend Python.

---

## 0. Em uma frase

Um **agente** (não um chatbot) que recebe uma pergunta, decide quais
**ferramentas** usar, executa essas ferramentas contra o banco do cliente com
o **crachá de quem perguntou**, repete até ter os dados, escreve a resposta
citando a fonte e o recorte, passa por um **revisor** que confere cada
afirmação contra as evidências coletadas, e **aprende** com o usuário por uma
memória (o "cérebro") que entra no prompt a cada pergunta, sem deploy.

O que ele **não** é:

- Não é RAG genérico sobre documentos. A fonte primária é o **banco**
  estruturado do cliente e as funções que desenham as telas.
- Não é fine-tuning. "Treinar" aqui é gravar memórias em uma tabela que o
  usuário edita em português.
- Não é um assistente de conhecimento geral. Se a informação não veio de uma
  ferramenta nem das regras fixas do sistema, o agente diz que não encontrou.

---

## 1. Linhagem e comparação das duas implantações

| dimensão | Daniel (CBIE) | Lya (XMX) — **referência principal** |
| --- | --- | --- |
| Onde roda o loop do agente | Route handler Next.js (`/api/chat`, `runtime nodejs`, `maxDuration 300`) | Supabase Edge Function `lya` (Deno) |
| Serviços de apoio | FastAPI (verificador, treinador, recall, sandbox SQL, radar) | Tudo na própria Edge Function + RPCs Postgres |
| Autenticação nas ferramentas | JWT do usuário repassado ao FastAPI; backend usa `service_role` + `require_role` | Client Supabase criado com o JWT do usuário; RLS e guards das RPCs valem como na tela |
| Fontes de dados | 31 tools de banco (rotas GET), `consultar_banco` (SQL), `buscar_documentos` (Pinecone, ~10k PDFs), `buscar_legislacao`, `web_search` server-side com allowlist + cascata | 11 tools `painel_*` (mesmos RPCs das telas), 2 `listar_*`, `consultar_banco` (SQL), `buscar_base_suporte` (conteúdo editorial) |
| Tools de entrega | `gerar_grafico`, `gerar_pdf` | `gerar_grafico` |
| Anexos do usuário | imagens e PDF como blocos na mensagem | não |
| Modelos (chat / treinador / verificador) | Sonnet 4.6 no front, Opus 4.8 no backend / Opus 4.8 / Haiku 4.5 | Opus 5 (thinking adaptive, effort medium) / Opus 5 / Haiku 4.5 |
| Recall do cérebro | Python em camadas: RPC FTS → fallback local com IDF → 1 salto de wikilinks | RPC única `lya_recall_memories` (FTS português com OR + tags + wikilinks) |
| Contexto da tela na pergunta | não | sim: período, filtro de agente, quem fala, papel, tela aberta |
| Cache do prompt | não | bloco estático com `cache_control: ephemeral` |
| Histórico | banco, por usuário, id nasce no cliente, save por substituição, fila por conversa, zustand como cache | idem, com TanStack Query |
| Cérebro visual | grafo "constelação" (react-force-graph-2d), polling 4 s | grafo estilo Obsidian com painel de forças, filtros, busca, órfãos, nascimento animado, seed de 45 memórias + "Remover exemplos" |
| Radar de demanda (fila de treino) | sim (coleta → classifica → relatório diário/semanal, pg_cron) | não |
| Eval de regressão do treino | `eval_daniel.py` (casos-ouro) | não |
| `temperature` | 0 onde o modelo aceita (Sonnet/Haiku) | só no verificador (Haiku); Opus 5 rejeita o parâmetro |

Leitura da tabela: a **Lya é a versão enxuta e corrigida** do núcleo; o Daniel
tem **módulos a mais** que você só replica se o cliente precisar deles
(documentos, web, PDF, radar).

---

## 2. Os princípios inegociáveis

Estes foram testados em produção. Cada um responde a um erro que aconteceu.
Não os afrouxe para "simplificar".

1. **A chave do LLM nunca vai para o navegador.** Vive num secret do
   servidor (Edge Function, route handler ou backend).
2. **O agente entra com o crachá de quem perguntou**, nunca com credencial de
   administrador (`service_role`). Quem não vê um dado na tela não o vê pelo
   agente. Na variante Daniel o backend usa `service_role`, mas só depois de
   validar o JWT e o papel do usuário em cada rota.
3. **As ferramentas de painel chamam as MESMAS funções que desenham as
   telas.** É o que garante que o número do agente é igual ao número do card.
   Se a tela lê a RPC `dashboard_metrics`, a tool `painel_atendimentos` chama
   `dashboard_metrics`, com os mesmos parâmetros.
4. **Toda conta acontece no banco.** Percentual, média, variação, ranking:
   ou vem pronto da função da tela ou é escrito dentro do SQL. Duas
   execuções da mesma pergunta têm de dar o mesmo número.
5. **SQL livre só dentro de um sandbox de cinco camadas** (seção 6). Nunca
   deixe o modelo consultar o banco com a conexão da aplicação.
6. **O catálogo do banco é escrito à mão**, não introspectado. É o que
   evita SQL plausível e errado (data guardada como texto sem cast, status
   derivado de outra tabela, valores em minúsculas sem acento).
7. **Proibido conhecimento próprio.** Se a informação não veio de uma
   ferramenta nem das regras fixas do sistema, o agente não a possui. A
   frase-sentinela é: "Não encontrei isso nos dados disponíveis."
8. **Afirmação de ausência só depois de consultar a fonte que teria o
   dado.** "Não há registro de X" sem ter aberto a tabela de X é o erro mais
   invisível do sistema (caso Angra I/II do Daniel, seção 9).
9. **Uma segunda IA revisa toda resposta**, contra as evidências
   coletadas, e **falha para o lado aberto**: se o revisor quebrar, a resposta
   sai com uma ressalva, nunca é bloqueada.
10. **O cérebro separa comportamento de conhecimento.** `feedback` e `user`
    entram em toda resposta; `nota`, `project`, `reference` entram por
    relevância. Regra de estilo salva como nota nunca é aplicada.
11. **Três modelos, três papéis, três variáveis de ambiente.** Chat (o mais
    capaz), treinador (roda pouco, pode ser caro), verificador (roda sempre,
    barato e determinístico).
12. **O evento `done` sempre chega.** Orçamento de tempo do turno, última
    rodada forçada a sintetizar, verificador pulado perto do teto, `finally`
    que fecha o stream. Uma interface que fica "carregando para sempre" é
    falha de backend.

---

## 3. Arquitetura em camadas

### 3.1 Visão geral

```
┌──────────────────────────────┐
│  NAVEGADOR (React)           │  tela cheia · balão flutuante · tela do cérebro
│  - manda a pergunta + histórico + contexto da tela
│  - recebe eventos SSE e desenha ao vivo
│  - lê/grava histórico e cérebro pelas RPCs (com RLS)
└──────────────┬───────────────┘
               │ POST + Authorization: Bearer <JWT do usuário>
               ▼
┌──────────────────────────────┐
│  ORQUESTRADOR (servidor)     │  Edge Function (Deno)  ou  route handler / FastAPI
│  1. porteiro: valida JWT, papel, conta ativa
│  2. recall das memórias (cérebro) para a pergunta
│  3. monta o system: [estático cacheado] + [contexto da tela + memórias]
│  4. loop de tool-use com stream (MAX_STEPS, orçamento de tempo)
│  5. executa tools com o client do usuário → evidências
│  6. verificador (2ª IA) confere o rascunho contra as evidências
│  7. emite `done`
└───────┬──────────────┬───────┘
        │              │
        ▼              ▼
┌──────────────┐  ┌────────────────────────────────────────────┐
│ API do LLM   │  │ POSTGRES DO CLIENTE (Supabase)              │
│ (Anthropic)  │  │ - RPCs das telas (mesmas que a UI usa)      │
│ chat/trainer/│  │ - agente_exec_sql (sandbox, role NOLOGIN)   │
│ verifier     │  │ - agente_memories + agente_recall_memories  │
└──────────────┘  │ - agente_chats / agente_chat_messages       │
                  │ - tabelas editoriais (base de conteúdo)     │
                  └────────────────────────────────────────────┘
```

### 3.2 O turno, passo a passo

1. O navegador envia `{ action: "chat", messages: [...], contexto: {...}, modoTreino }`.
2. **Porteiro**: cria o client com o JWT, `auth.getUser()`, lê `profiles`
   (papel, ativo). Recusa 401/403 com mensagem em português para o usuário.
3. **Recall**: chama a RPC de recall com a última pergunta. Falha aqui não
   derruba o turno, mas emite `aviso` (o usuário precisa saber que a resposta
   saiu sem o treino).
4. **System prompt**: bloco 1 (persona + regras duras + glossário do negócio
   + catálogo do banco) com cache; bloco 2 (contexto da tela + memórias).
5. **Loop** (até `MAX_STEPS`, com orçamento de parede): chama o modelo com
   stream; tokens de texto vão direto para o navegador; se `stop_reason ===
   "tool_use"`, executa as tools em paralelo, guarda evidências (tools com
   `origem`), devolve `tool_result` e repete. Na última rodada
   `tool_choice: none` força a síntese.
6. **Verificador**: modelo barato, `temperature 0`, tool forçada
   `emitir_revisao`, com hierarquia de fontes. Divergências e ressalvas altas
   viram um bloco "Revisão automática" no fim do texto; o veredito inteiro
   vai como evento `revisao`.
7. `done`. `finally` fecha o stream.

### 3.3 O contrato dos eventos (SSE)

```ts
type AgentEvent =
  | { type: "token";   text: string }                     // pedaço do texto
  | { type: "tool";    name: string; input?: unknown }    // começou uma ferramenta
  | { type: "chart";   chart: ChartSpec }                 // gráfico para desenhar
  | { type: "memoria"; memoria: MemoriaSalva }            // gravou memória (modo treino)
  | { type: "aviso";   codigo?: string; message?: string }// degradação, não erro
  | { type: "revisao"; revisao: Revisao }                 // veredito do verificador
  | { type: "error";   message?: string }
  | { type: "done" };                                     // SEMPRE chega
```

O Daniel tem ainda `sources` (fontes dos PDFs) e `pdf` (arquivo gerado).
Adicione só se replicar esses módulos.

---

## 4. Mapa de componentes

| componente | onde vive | o que faz | arquivo de referência |
| --- | --- | --- | --- |
| Porteiro | `index.ts` (Deno) / `deps.py` (FastAPI) | JWT → usuário → papel → ativo; ações `chat`, `memoria_salvar`, `ping` | 02 §II.6 |
| Loop do turno | `index.ts` / `route.ts` | tool-use com stream, travas, evidências, verificador, `done` | 02 §II.6 |
| Tools | `tools.ts` | 4 famílias: painel, banco, conteúdo, entrega; cada uma devolve string e declara `origem` | 02 §II.3 |
| Sandbox SQL | migration + `consultar_banco` | role NOLOGIN dona da função, só SELECT, read-only, timeout, LIMIT, guard | 02 §I.3 |
| Prompt | `prompt.ts` | persona, regras duras, glossário, catálogo, modo treino, bloco de contexto, bloco de memórias | 02 §II.2 |
| Cérebro | tabela `agente_memories` + RPCs | 5 tipos, FTS português (OR) + tags + 1 salto de wikilinks | 02 §I.1 |
| Treinador | `treinador.ts` | classifica e enriquece a memória com tool forçada | 02 §II.5 |
| Modo treino | `prompt.ts` + `tools.ts` | só a tool `salvar_memoria`; lista memórias existentes com slug para corrigir sem duplicar | 02 §II.2/§II.3 |
| Verificador | `verificador.ts` | revisão pós-geração, fail-open, hierarquia de fontes | 02 §II.4 |
| Histórico | tabelas `agente_chats` + `agente_chat_messages` + RPCs | id no cliente, save por substituição, RLS pelo dono | 02 §I.2 · 03 §5 |
| UI do chat | `features/agente/` | tela cheia, balão, mensagens, composer, gráfico, markdown, atividade | 03 §1–§7 |
| Cérebro visual | `DashboardCerebro` + `BrainGraph` + `Ticker` + `Treinar` | grafo Obsidian, faixa de métricas, console de treino | 03 §9–§10 |
| Seed | migration | 30–50 memórias de exemplo ligadas, `seed = true`, botão "Remover exemplos" | 02 §I.4 |
| Radar de demanda (opcional) | `daniel_radar.py` + 2 tabelas + pg_cron | o que os usuários perguntam, lacunas, fila de treino | 02 §IV |
| Eval (opcional) | `eval_agente.py` | casos-ouro de regressão do recall | 02 §VI |

---

## 5. A arquitetura de treinamento

"Treinar" tem três camadas, com donos e ciclos de vida diferentes. Explique
isso ao cliente com estas palavras; é a parte que mais gera expectativa
errada.

### 5.1 Camada fixa — do desenvolvedor (deploy)

O `SYSTEM` do prompt: persona, regras duras, **glossário do negócio** (o que
conta como um evento, como um status é derivado, qual é a meta) e o
**catálogo do banco** (tabelas, colunas, tipos, armadilhas). Muda com deploy.
O glossário entra também como evidência de origem `regras` para o
verificador, para ele distinguir "regra do sistema" de "invenção".

### 5.2 Camada viva — do usuário (sem deploy): o cérebro

Uma tabela de memórias que o usuário cadastra em português, pela tela do
cérebro ou pelo **modo treino** do chat. Cada pergunta faz um recall e injeta
as memórias relevantes no prompt.

| tipo | é | quando entra no prompt | exemplos |
| --- | --- | --- | --- |
| `feedback` | como responder: estilo, formato, o que evitar, estrutura de um entregável recorrente | **sempre** | "Comece pela conclusão", "Em ranking, mostre a meta de cada um" |
| `user` | quem o agente é e para quem responde | **sempre** | "Você responde para a gestora do suporte" |
| `nota` | um fato do domínio | por relevância (FTS) | "A Ana atende só por e-mail" |
| `project` | trabalho em andamento, meta, campanha; também hubs que ligam memórias | por relevância | "Campanha do produto X em setembro" |
| `reference` | link, planilha, painel externo | por relevância | "Planilha de metas: <url>" |

Regras do recall (a RPC `agente_recall_memories`):

- comportamento (`feedback` + `user`): todas, cap 50, sem busca;
- conhecimento: `websearch_to_tsquery('portuguese', pergunta)` com **os
  termos em OR** (o AND padrão devolvia zero em quase toda pergunta real),
  sobre `description || body || tags::text`, ranqueado por `ts_rank`, top 12;
- **1 salto de `[[wikilinks]]`** a partir das encontradas (cap 8);
- desempate determinístico por `name` (sem isso, editar qualquer memória
  muda o prompt de perguntas não relacionadas);
- devolve um único JSON `{ comportamento, conhecimento }`.

O **treinador** (uma IA com tool forçada) recebe o que o usuário escreveu,
classifica o tipo e enriquece descrição, corpo e tags **para ser encontrado
depois** (sinônimos, nome com e sem sobrenome, palavras que o usuário usaria
ao perguntar). Regra de comportamento salva como `nota` é corrigida para
`feedback`.

O **modo treino** do chat lista no system as memórias que o agente já tem
sobre o assunto, cada uma com o slug, e pede que uma correção passe o slug
exato em `salvar_memoria.name`. É o que faz o upsert atualizar a memória
certa em vez de criar uma segunda, contraditória.

O ciclo que o usuário vive: **pergunta → errou ou ficou longo → corrige (tela
ou modo treino) → a próxima resposta já vem certa**. Sem espera, sem código.

### 5.3 Camada de fontes — os dados

Banco do cliente (RPCs das telas + sandbox), tabelas editoriais (uma "base de
conhecimento" que o próprio cliente edita, como a Base de Suporte da XMX) e,
se o cliente tiver, documentos indexados e web (Daniel). É de onde saem
números e fatos. **Memória não é fonte de fato.**

### 5.4 A decisão de produto que você precisa levar ao cliente

Por desenho, o agente **não usa memória como fato**: a regra "proibido
conhecimento próprio" mais o verificador bloqueiam qualquer afirmação que não
venha de banco, conteúdo editorial ou regras fixas. Quando um especialista
treina "a meta de setembro é 120" e o agente não repete isso como número, ele
está funcionando como especificado.

Duas saídas, e a escolha é do cliente:

- **Opção A — manter a regra.** Treino serve para comportamento e
  interpretação; fatos entram por tabela (a base editorial), que é fonte
  citável. Comunique isso na tela de treino (a Lya e o Daniel fazem isso no
  guia embutido: "não use a memória para colar um número").
- **Opção B — criar a categoria "conhecimento da empresa" como fonte.** Um
  tipo de memória que entra na lista de `evidencias` com autoria e data, que
  o prompt autoriza citar como "base de conhecimento <empresa>, cadastrado
  por <autor> em <data>", e que o verificador aceita como nível próprio na
  hierarquia.

Recomendação registrada no diagnóstico do Daniel: **opção B, com o tipo novo
restrito ao perfil que administra o agente**. Nunca afrouxe a regra geral.

### 5.5 Fechar o ciclo: radar de demanda e eval (do Daniel)

- **Radar**: todo dia, varre as conversas, grava cada pergunta nova
  (idempotente por `(chat_id, ordem)`), classifica com o modelo em
  setor/subtema, calcula sinais de lacuna (resposta sem fonte, pergunta
  refeita, pergunta sem resposta, tema em várias empresas) e gera um
  relatório com "por onde começar o treino". O botão "Treinar" de cada tema
  abre o compositor de memória já preenchido. Sem radar, treino é palpite.
- **Eval**: casos-ouro `{pergunta, deve_conter, nao_deve_conter}` rodados
  contra o recall (barato) e, opcionalmente, fim a fim. Regressão de que o
  treino continua chegando ao prompt quando alguém mexe no recall.

---

## 6. Segurança e permissões

### 6.1 Matriz de papéis (adapte os nomes ao cliente)

| capacidade | quem | onde é imposta |
| --- | --- | --- |
| Conversar com o agente | papéis da área (na XMX: gestora e time de copy; na CBIE: todos os assinantes) | porteiro (403) + guard da RPC de recall/save |
| Ver dados restritos pelas tools | quem já vê na tela | as próprias RPCs das telas (o agente não ganha permissão nova) |
| Treinar (escrever no cérebro) | um papel administrador (gestora / analista+admin) | guard `is_manager()` dentro das RPCs `upsert`/`delete`; porteiro recusa `memoria_salvar` |
| Ver o próprio histórico | cada usuário só o seu, inclusive administradores | RLS `user_id = auth.uid()` + RPCs escopadas |
| Ver o radar | administrador | rota restrita; tabelas com RLS ligada e sem policy |

Use **nomes de capacidade**, não de cargo, quando criar flags novas
(`can_train_agent`, não `is_supervisor`).

### 6.2 O sandbox de SQL — cinco camadas

```
1. filtro no orquestrador   só SELECT/WITH, uma instrução (sem ';'), blocklist de tabelas sensíveis
2. guard de negócio         a função exige a permissão da área (ex.: can_view_analytics())
3. restrições da função     transação read-only, statement_timeout 8 s, LIMIT por fora (teto 500)
4. dona da função           role NOLOGIN dedicada; a função SECURITY DEFINER PERTENCE a ela
5. o que a role enxerga     GRANT SELECT tabela a tabela; view de pessoas sem e-mail; nada de auth,
                            logs, PII, memórias do agente, chats
```

A camada 4 é a que torna as outras redundantes, e redundância aqui é o
objetivo. Tabelas com RLS ligada precisam de uma policy `FOR SELECT TO
<role>` (a role não está em nenhuma policy existente; sem isso a query roda e
devolve `[]` em silêncio, e o agente conclui "não há dados" com cara de
certo). O predicado dessa policy é uma **decisão de segurança**: `USING
(true)` só quando quem conversa já pode ver todas as linhas; em banco
multi-tenant, o mesmo predicado de tenant do cliente (ver 6.5). Nunca use
`GRANT ... ON ALL TABLES` nem `BYPASSRLS`.

### 6.3 O que nunca entra no sandbox nem no catálogo

Tabela de perfis inteira (use uma view sem e-mail), `auth.*`, `storage.*`,
`vault.*`, logs de sessão, heartbeats, memórias e chats do agente, qualquer
tabela com credencial ou dado pessoal sensível que a tela não mostra.

### 6.4 PII na resposta

Regra do prompt: dado de cliente (e-mail, nº de pedido) só quando a pergunta
pedir o detalhe; em respostas agregadas, nunca listar.

### 6.5 O que estas orientações fazem e NÃO fazem no banco do cliente

Leia antes de rodar qualquer SQL. Esta é a garantia que você dá ao cliente.

**Nunca:**

- `DROP TABLE`, `TRUNCATE`, `DELETE`, `UPDATE` ou `ALTER TABLE` em qualquer
  tabela que já exista no banco do cliente. As migrations só **criam**
  objetos novos com o prefixo do agente (`agente_*`) e concedem `SELECT` à
  role do sandbox. Os únicos `DROP ... IF EXISTS` e `DELETE` do pacote atuam
  em objetos criados pela própria migration (policies `agente_sql_ro read`,
  trigger `trg_agente_memories_touch`, linhas de `agente_memories` e
  `agente_chats`).
- `CREATE OR REPLACE` sobre função, view ou trigger que já exista com outro
  dono. Antes de aplicar, confira colisão de nomes:
  `SELECT proname FROM pg_proc WHERE proname LIKE 'agente\_%'` e
  `SELECT relname FROM pg_class WHERE relname LIKE 'agente\_%'`. Se houver
  qualquer resultado que não seja seu, troque o prefixo.
- Conceder escrita à role do sandbox, `BYPASSRLS`, `SUPERUSER` ou
  `GRANT ... ON ALL TABLES`.
- Usar `service_role` na Edge Function ou expor essa chave ao navegador.
- Mudar policies, roles ou grants existentes do cliente. O agente ganha
  permissões próprias, nunca mexe nas dos outros.
- Gravar dados de usuário em log.

**Sempre, antes de aplicar em produção:**

- Snapshot/backup do banco (no Supabase: Database → Backups, ou `pg_dump`).
- Rodar a migration num banco de teste com stubs, como foi feito na Lya.
- Ter o script de reversão pronto (02 §I.6): ele remove só os objetos
  `agente_*` e a role, e deixa o resto intacto.

**Onde a segurança do dado do cliente realmente está em jogo:**

| ponto | risco | o que fazer |
| --- | --- | --- |
| Policy `USING (true)` para a role do sandbox | em cliente **multi-tenant** (várias empresas no mesmo banco), a role veria linhas de todos os tenants | só use `USING (true)` quando quem conversa já pode ver TODAS as linhas da tabela (caso XMX: analytics do time inteiro). Senão, policy com o mesmo predicado de tenant que o cliente já usa (02 §I.3) ou não exponha a tabela ao sandbox |
| Dados saem para a API da Anthropic | pergunta, resultados das tools (até 36 k caracteres por tool), memórias e glossário viajam para o provedor do modelo | informe o cliente por escrito; leia a política de retenção da API (dados de API não treinam modelos por padrão; retenção limitada; há opção de zero data retention para contas elegíveis); não exponha ao sandbox colunas que não precisam sair (mascare por view) |
| Colunas de PII nas tabelas de dados | e-mail, CPF, endereço, telefone chegam ao modelo e podem aparecer na resposta | exponha ao sandbox uma **view** sem essas colunas quando a tela não precisa delas; a view de pessoas do time já nasce sem e-mail |
| Funções `SECURITY DEFINER` do cliente com `EXECUTE` para `PUBLIC` | o SQL do modelo pode chamar `SELECT * FROM funcao_x()` e ela roda como o dono, fora das restrições da role | audite (02 §I.7). A exposição é a mesma que o usuário já tem pelo PostgREST, mas funções sem guard e abertas a PUBLIC precisam de `REVOKE ... FROM PUBLIC` |
| CORS `*` na Edge Function | qualquer origem pode chamar; a autenticação é pelo JWT, então não há vazamento, mas é mais superfície | restrinja `Access-Control-Allow-Origin` ao domínio do app |
| Radar de demanda (opcional) | um administrador passa a ler perguntas e respostas de todos os usuários, com nome e empresa | só com consentimento do cliente e aviso aos usuários; tabelas com RLS ligada e sem policy; rota só de administrador |
| Histórico de conversas | contém o que o usuário perguntou e o que o agente respondeu, com dados do negócio | RLS pelo dono; nem administrador lê o dos outros; apagar conversa apaga as mensagens (cascade) |
| Enumeração do schema pelo sandbox | `pg_tables`/`pg_class` são legíveis por qualquer role; o modelo pode listar nomes de tabelas (não dados) | se os nomes forem sensíveis, adicione `pg_tables|pg_class|pg_namespace|pg_proc` à blocklist do `consultar_banco` |

---

## 7. Modelos, custo e limites

| papel | modelo (referência set/2026) | por quê | parâmetros |
| --- | --- | --- | --- |
| Chat | `claude-opus-5` | escolhe ferramentas e escreve SQL; precisa do mais capaz | `thinking: adaptive`, `output_config.effort: medium` (suba para `high` se pular etapas de coleta), `max_tokens 16000` (é teto, não gasto) |
| Treinador | `claude-opus-5` | roda uma vez por memória; qualidade da classificação importa | `effort: low`, `max_tokens 2048`, tool forçada |
| Verificador | `claude-haiku-4-5` | roda em toda resposta; barato e determinístico | `temperature: 0`, `max_tokens 4096`, tool forçada |

Regras:

- **`temperature` só onde o modelo aceita.** Opus 4.7+, Fable e Mythos
  rejeitam `temperature`/`top_p`/`top_k` com 400. No Daniel isso é detectado
  por regex no nome do modelo; na Lya simplesmente não se envia para o chat.
- Os três leem a mesma `ANTHROPIC_API_KEY` do secret do servidor. O cliente
  do SDK fica **amarrado ao valor da chave**: se o secret for regravado, a
  instância quente passa a usar a nova sem reciclar.
- **Valide a chave caractere a caractere** (0x21–0x7E). Uma chave colada com
  aspas curvas, `•` (mascaramento de chat) ou quebra de linha derruba o turno
  com um erro opaco. Aconteceu duas vezes na Lya.
- Cache do prefixo: o bloco estático do system vai com `cache_control:
  ephemeral`; o bloco por turno (contexto + memórias) fica separado para não
  invalidar o cache a cada pergunta.
- Travas de tempo (Edge Function): `MAX_STEPS 10`, `TURN_BUDGET_MS 95 s`,
  `VERIFIER_SKIP_AFTER_MS 115 s`, `VERIFIER_TIMEOUT_MS 25 s`. No Next.js com
  `maxDuration 300`: `MAX_STEPS 16`, `230 s`, `265 s`, `20 s`. Ajuste ao teto
  da plataforma do cliente.
- Resultado de tool cortado em ~36 k caracteres com aviso para o modelo
  refinar o recorte; evidência cortada em 2,5 k para o verificador.

---

## 8. Procedimento de adaptação ao cliente

Siga nesta ordem. Cada passo tem um critério de "pronto".

### 8.1 Descubra a stack e escolha a variante

```
O sistema usa Supabase?
├─ sim ── o front fala direto com o Supabase (SPA sem servidor próprio)?
│         ├─ sim → VARIANTE A (Lya): Edge Function em Deno + RPCs. Referência principal.
│         └─ não, tem Next.js → VARIANTE B-front (Daniel): route handler `/api/chat`
│                               com o loop; RPCs do Supabase para memórias/chats/sandbox.
└─ não ── Postgres próprio + backend (FastAPI/Node/…)?
          └─ VARIANTE B-backend (Daniel): o loop e os serviços no backend;
             o front consome SSE. Substitua "RPC" por "função SQL + endpoint autenticado".
```

Em qualquer variante, as **peças de banco são as mesmas** (memórias, recall,
chats, sandbox, seed). O que muda é onde o loop roda e como o crachá do
usuário chega ao banco.

Pronto quando: você sabe onde vai rodar o loop, como o JWT do usuário chega
lá, e qual é o teto de duração da plataforma.

### 8.2 Inventarie o banco do cliente

Rode introspecção **para você**, mas escreva o catálogo **à mão**, como
texto, com a semântica:

```sql
-- tabelas e views do schema público
SELECT c.relname, c.relkind, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1;

-- colunas e tipos de uma tabela
SELECT column_name, data_type, is_nullable
FROM information_schema.columns WHERE table_schema='public' AND table_name='<tabela>' ORDER BY ordinal_position;

-- funções (as RPCs das telas)
SELECT p.proname, pg_get_function_arguments(p.oid), p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' ORDER BY 1;

-- valores reais de uma coluna categórica (grafia, caixa, acento)
SELECT <coluna>, count(*) FROM <tabela> GROUP BY 1 ORDER BY 2 DESC LIMIT 50;
```

Para cada tabela de dados, registre no catálogo: colunas com tipo **real**
(datas guardadas como texto, ids em texto), valores exatos das colunas
categóricas (minúsculas? acento?), o que uma linha representa, qual coluna
não é confiável e por quê, e a regra de fuso horário. Marque quais tabelas
têm RLS ligada (precisam de policy para a role do sandbox).

Pronto quando: o catálogo lista só tabelas de dados, cada uma com armadilhas
explícitas, e a lista de tabelas para o `GRANT` é a mesma do catálogo.

### 8.3 Inventarie as telas e as funções que as alimentam

Para cada tela de números do sistema: qual função/endpoint/query a alimenta,
com quais parâmetros, e o que cada card significa. Cada tela vira uma tool
`painel_<tela>` que chama **essa mesma função**. Se a tela calcula algo no
navegador em vez de no banco, não replique a conta no agente: exponha a
conta em uma função do banco e faça a tela e o agente lerem dela.

Pronto quando: há uma tabela "tela → função → parâmetros → tool" e nenhum
número de card fica sem tool.

### 8.4 Escreva o glossário do negócio

Texto corrido, em português, com os fatos fixos: o que conta como um evento,
como um status é derivado, quais são as metas, o que significa cada estado,
regras de fuso e de datas em texto. Entra no prompt e como evidência
`regras` do verificador.

Pronto quando: um analista do cliente lê e confirma cada linha.

### 8.5 Defina papéis, nome e persona

Quem conversa, quem treina, quem vê o radar. Nome do agente (fixo, curto),
para quem responde, quais telas conhece. A persona cita as telas por nome.

### 8.6 Ordem de implementação (marcos)

| marco | entrega | critério de aceite |
| --- | --- | --- |
| M0 | Migration do banco: memórias + recall, chats, sandbox, seed | queries de verificação do 02 §I.5 passam; sandbox como usuário da área lê dados; `SELECT * FROM profiles` no sandbox dá erro de permissão |
| M1 | Função/route com `ping` e porteiro | `ping` diz se a chave está configurada; sem JWT → 401; papel errado → 403 |
| M2 | Loop com 1 tool de painel + `consultar_banco` + verificador | pergunta sobre um card devolve o mesmo número da tela, cita fonte e período; `done` chega mesmo com erro forçado |
| M3 | Todas as tools de painel + `gerar_grafico` + `listar_*` + conteúdo editorial | cada tela tem tool; gráfico aparece sem pedir quando há comparação |
| M4 | Cérebro: treinador, modo treino, recall no prompt | uma memória `feedback` muda a próxima resposta; correção no modo treino atualiza o slug em vez de duplicar |
| M5 | Front: tela cheia + balão + histórico | trocar de conversa no meio da resposta não perde nem mistura; reabrir mostra gráficos |
| M6 | Tela do cérebro: ticker + grafo + treinar + seed | memória nova nasce animada sem os outros nós saltarem; "Remover exemplos" apaga só seed |
| M7 (opcional) | Radar + eval | relatório diário gerado pelo cron; eval passa no caso-ouro |

### 8.7 Testes de aceitação obrigatórios antes de entregar

- **Recusa de escrita**: peça ao agente para apagar/alterar algo; ele não
  consegue (sandbox read-only, nenhuma tool de escrita).
- **Permissão**: com um perfil restrito, peça um dado de tela restrita; a
  tool devolve "acesso negado" e o agente explica, em vez de vazar ou quebrar.
- **Número da tela**: 5 perguntas sobre cards diferentes, mesmo período da
  barra lateral; os números batem com a tela.
- **Determinismo**: a mesma pergunta 3 vezes; os números são iguais.
- **Ausência**: pergunte por algo que não existe; o agente consulta a fonte
  antes de dizer que não há, e o verificador não aponta ressalva alta.
- **Treino**: cadastre uma `feedback` de formato; a próxima resposta obedece.
  Corrija-a pelo modo treino; o slug é o mesmo.
- **Stream**: force um erro de tool; a interface recebe `error` e `done`.
- **Chave**: grave um secret com caractere inválido; a mensagem diz a posição
  e a interface mostra frase, não código.

---

## 9. Lições que custaram caro (consolidadas)

| sintoma | causa | correção adotada |
| --- | --- | --- |
| A mesma pergunta dá respostas diferentes | `temperature` padrão 1.0; caminho até o dado não fixo | `temperature 0` onde o modelo aceita; cálculo só no SQL/painel; cabeçalho de fonte e recorte em toda tool |
| Treino nunca é aplicado | tokenização quebrava acentos e siglas, substring match, `para` casava com 92 % da base | recall no Postgres: FTS português com OR, tags no índice, wikilinks, desempate por `name` |
| Recall da RPC devolvia zero | `websearch_to_tsquery` combina com AND; tags fora do índice | `' & ' → ' \| '` no texto do tsquery; índice com a expressão IDÊNTICA à da consulta |
| 252 memórias disputavam 6 vagas e o desempate era a ordem de edição | caps baixos + sort estável | caps 50 comportamento / 12 busca + 8 wikilinks; ordenação determinística |
| Regra de estilo ignorada | salva como `nota` (só entra por palavra-chave) | treinador força `feedback`; prompt do treinador explica o recall |
| Correção virava memória duplicada | slug derivado da nova descrição | modo treino lista memórias existentes com slug; upsert por slug |
| "O banco não separa Angra I de Angra II" (falso) | tabela fora do catálogo; valores em minúsculas sem acento; verificador não pega ausência | regra 8 do prompt (ausência só depois de consultar); catálogo com valores exatos; tool para descobrir grafia |
| Sandbox devolvia `[]` em tabela com dados | role fora das policies de RLS | policy `FOR SELECT TO <role> USING (true)` por tabela (ou BYPASSRLS quando o projeto permite) |
| Preâmbulo colado na resposta | tokens de duas etapas na mesma mensagem | `pendingBreak` injeta `\n\n` antes do próximo token após tool-use |
| Interface "pensando" para sempre | função morta pela plataforma antes do `done` | orçamento de parede; última rodada força síntese; verificador pulado perto do teto |
| Turno terminava em silêncio ao esgotar etapas | loop encerrava ainda em `tool_use` | `tool_choice: none` na última rodada; `error` explícito se não houve texto |
| Chave "inválida" sem explicação | caractere fora do ASCII no secret | validação por posição; cliente amarrado ao valor da chave |
| Conversa gravada sem a resposta | save lia o estado da tela ao trocar de conversa | turno em voo fora do React, indexado pela conversa; `Symbol` por turno |
| Save antigo sobrescrevia o novo | dois saves por turno, por substituição | fila por conversa; descarte de payload já coberto |
| Histórico estourava o localStorage | PDFs em base64 | histórico no banco por usuário; anexos só com metadado |
| Resposta destreinada lida como treinada | recall falhou em silêncio | evento `aviso` visível |
| Tool de treino confirmava e nada era salvo | enum da tool ≠ taxonomia do banco (422) | mapa `correcao/preferencia → feedback`, `fato/nota → nota` |
| Grafo saltava a cada atualização | `setGraph(buildGraph())` reiniciava a simulação | fundir preservando os objetos de nó |
| Rótulo crescia com o zoom | `Math.max(piso, 12/scale)` | `12 / scale` sem piso |
| Novelo preto de linhas | tags ligando todos com todos | cadeia por tag |

---

## 10. Glossário

- **Agente**: loop em que o modelo pede ferramentas, o servidor executa e devolve, até o modelo responder.
- **Tool / ferramenta**: função com nome, descrição, schema de entrada e execução; devolve texto ao modelo.
- **Tool de painel**: tool que chama a mesma função da tela.
- **Sandbox SQL**: função do banco que executa um SELECT do modelo sob uma role restrita.
- **Catálogo**: descrição em texto das tabelas liberadas, com armadilhas.
- **Glossário do negócio / regras do sistema**: fatos fixos do domínio; prompt + evidência.
- **Cérebro**: tabela de memórias treinadas pelo usuário.
- **Recall**: seleção das memórias relevantes para uma pergunta.
- **Treinador**: IA que classifica e enriquece uma memória antes de gravar.
- **Modo treino**: modo do chat em que o agente só aprende.
- **Verificador**: IA que revisa o rascunho contra as evidências, fail-open.
- **Evidência**: saída de uma tool com `origem` (painel, banco, base, regras; no Daniel também documentos e web).
- **Contexto da tela**: período, filtros, usuário, papel e tela que o navegador manda com a pergunta.
- **Seed**: memórias de exemplo marcadas para remoção em bloco.
- **Radar de demanda**: relatório do que os usuários perguntam e onde o agente falhou; fila de treino.
- **Wikilink**: `[[Nome da memória]]` no corpo; vira aresta no grafo e salto no recall.

---

## Anexo A — Variáveis de ambiente e dependências

Servidor (Edge Function ou backend):

| variável | obrigatória | padrão |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | sim | — (sem ela: 503 e a UI mostra a mensagem) |
| `AGENTE_MODEL` | não | `claude-opus-5` |
| `AGENTE_TRAINER_MODEL` | não | `claude-opus-5` |
| `AGENTE_VERIFIER_MODEL` | não | `claude-haiku-4-5` |
| `AGENTE_EFFORT` | não | `medium` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | sim (Edge Function já injeta) | — |

Front (Vite): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Front (Next.js): `NEXT_PUBLIC_API_URL`.

Dependências novas no front: `react-markdown`, `remark-gfm`, `recharts`,
`react-force-graph-2d@1.29.1`, `@tanstack/react-query` (ou zustand na
variante Daniel). No servidor Deno: `npm:@anthropic-ai/sdk@0.124.0`,
`npm:@supabase/supabase-js@2`. No FastAPI: `anthropic`, `supabase`.

## Anexo B — O que entregar ao final

1. Migration(s) SQL idempotente(s) do 02 §I, com o array de tabelas do cliente.
2. Função/route com os seis arquivos do 02 §II adaptados (nome, persona, glossário, catálogo, tools de painel).
3. Front do 03 com as três superfícies e a tela do cérebro.
4. Seed de 30–50 memórias do domínio do cliente, alinhadas ao prompt.
5. Documento curto para o usuário final: como perguntar, como treinar, o que a memória não faz (a decisão da seção 5.4).
6. Resultado dos testes de aceitação da seção 8.7.
