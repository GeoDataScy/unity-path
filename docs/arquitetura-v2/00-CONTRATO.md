# Contrato da arquitetura v2 — XMX Suporte

> Documento normativo. Backend e frontend são desenhados por trilhas separadas; este
> arquivo é a única fonte de verdade sobre o que as une. Nenhuma trilha pode contrariá-lo
> em silêncio: divergência vira item na seção "Lacunas" do próprio documento da trilha.

Data: 26/09/2026 · Baseia-se em `Arquitetura XMX Suporte v2` (documento aprovado).

---

## 0. Estado desta fase

**Esta fase produz especificação, não código.** Motivos:

1. O banco de dados é a última etapa por decisão do dono do projeto, e há um backup em
   andamento neste momento. Nada no banco pode ser tocado: sem migration nova, sem DDL,
   sem query de escrita, sem `supabase db push`.
2. A API depende do schema alvo. Escrever implementação antes do schema existir produz
   retrabalho.

O critério de saída desta fase: as especificações estão detalhadas o suficiente para que a
implementação seja mecânica, e a soma delas prova que **nenhuma funcionalidade de hoje foi
perdida**.

### Proibições absolutas nesta fase

- Não alterar nada em `supabase/migrations/` (schema legado está congelado).
- Não modificar arquivos em `src/` (o app atual continua em produção).
- Não instalar dependências nem mexer em `package.json`.
- Escrever **apenas** dentro de `docs/arquitetura-v2/`.

### Acesso ao banco — atualizado em 26/09/2026

O backup foi concluído. A partir de agora:

- **Leitura em produção é permitida** e necessária, porque as migrations não descrevem o
  schema real: a conversão de `uuid`/`timestamptz` para `text` aconteceu fora do repositório
  e não existe `ALTER COLUMN TYPE` em migration nenhuma.
- **Escrita continua proibida**, sem exceção: nenhum `INSERT`, `UPDATE`, `DELETE`, `ALTER`,
  `CREATE`, `DROP`, `GRANT`, `TRUNCATE`, `VACUUM`, nem `supabase db push`.
- Produção roda em `t4g.micro` e já caiu por sobrecarga de CPU em 24/07/2026. Consulta de
  levantamento não pode ser a causa de um segundo incidente. Regras:
  - Catálogo (`information_schema`, `pg_catalog`, `pg_indexes`, `pg_policies`) é barato: use à
    vontade.
  - Contagem aproximada de linha vem de `pg_class.reltuples`, não de `COUNT(*)`.
  - Agregação sobre `services`, `service_follow_ups` ou `refunds` roda **uma por vez**, com
    `SET LOCAL statement_timeout = '15s'`, e de preferência com recorte de período.
  - Nenhuma consulta devolve mais que algumas centenas de linhas.
- Se o acesso for barrado, o SQL pronto vai para `docs/arquitetura-v2/sql/` para o dono do
  projeto executar. Nunca para `/tmp`, que a limpeza noturna do macOS esvazia.

---

## 1. Separação de backend e frontend

Backend e frontend passam a ser projetos separados, com fronteira explícita, dentro do
**mesmo repositório git** (`unity-path`). Repositório novo foi avaliado e rejeitado: o
risco de perda está no banco, não no git, e um repo novo descartaria histórico, PRs,
vínculo com a Vercel e configuração de ambiente.

```
unity-path/
├── apps/
│   ├── web/          # frontend React (migrado de src/)
│   └── api/          # backend TypeScript (novo)
├── packages/
│   ├── contract/     # tipos e schemas compartilhados — a fronteira
│   └── db/           # schema Drizzle + migrations do modelo novo
├── src/              # LEGADO, intocado até o corte
├── supabase/         # LEGADO, congelado
└── docs/arquitetura-v2/
```

Regra de dependência, sem exceção:

```
apps/web  ──depende──>  packages/contract  <──depende──  apps/api
                                                              │
                                                     packages/db
```

`apps/web` nunca importa de `apps/api` nem de `packages/db`. Se o front precisa de um tipo,
ele vive em `packages/contract`. Isso é o que torna a separação real e não decorativa.

---

## 2. Idioma

| Camada | Idioma | Exemplo |
|---|---|---|
| Tabelas, colunas, rotas, código, tipos | inglês | `tickets`, `interaction_count`, `GET /api/v1/tickets` |
| Rotas visíveis no browser | pt-BR (inalteradas) | `/workspace/atendimentos`, `/dashboard/reembolsos` |
| Textos de interface, rótulos, toasts | pt-BR | "Registrar interação" |
| Mensagens de erro para o usuário | pt-BR, vindas do front | ver seção 6 |

As rotas do navegador **não mudam**. Ninguém do time precisa reaprender endereço.

---

## 3. Contrato HTTP

### Base e versão

```
/api/v1/<recurso>
```

Versão no caminho. Quebra de contrato exige `/api/v2` convivendo, nunca alteração
silenciosa de `/api/v1`.

### Autenticação

- O JWT continua sendo emitido pelo Supabase Auth. Login, refresh e logout não mudam.
- Toda requisição autenticada envia `Authorization: Bearer <access_token>`.
- A API valida assinatura via JWKS, resolve o perfil (role e capacidades) com cache de 60
  segundos por usuário, e recusa conta inativa com `403 ACCOUNT_BLOCKED`.
- O front nunca decide permissão para autorizar: decide apenas o que **exibe**. A API
  recusa de novo, sempre.

### Métodos e semântica

| Método | Uso | Idempotente |
|---|---|---|
| `GET` | leitura, sem efeito colateral | sim |
| `POST` | criação, ou ação nomeada (`/claim`, `/accept`) | não |
| `PATCH` | atualização parcial | não |
| `DELETE` | remoção | sim |

Ação que não é CRUD vira sub-recurso no imperativo: `POST /tickets/:id/claim`,
`POST /refunds/:id/complete`. Não existe `POST /do?action=...`.

### Resposta de sucesso

Recurso único devolve o objeto na raiz:

```json
{ "id": "...", "clientEmail": "...", "status": "concluido" }
```

Coleção devolve envelope com cursor:

```json
{
  "items": [ /* ... */ ],
  "nextCursor": "eyJjIjoiMjAyNi0wOS0yNlQxMjowMCIsImkiOiI4YS4uLiJ9",
  "hasMore": true
}
```

`totalCount` só aparece onde a tela realmente mostra o total, e nunca em consulta de
página quente (contar exige varredura).

### Paginação

- **Keyset (cursor), nunca OFFSET.** `?cursor=<opaco>&limit=<n>`.
- `limit` padrão 25, máximo 100.
- O cursor é opaco para o front: string base64 que a API decodifica. O front só devolve o
  que recebeu.
- Ordenação é fixa por rota e documentada. Mudar ordenação invalida cursores antigos, o
  que a API responde com `400 INVALID_CURSOR`.

### Campos em JSON

`camelCase` no JSON, `snake_case` no banco. A conversão é responsabilidade da API.
Datas e instantes em ISO 8601 com fuso: `"2026-09-26"` para `date`,
`"2026-09-26T14:32:10.123Z"` para `timestamptz`.

### Erros

Formato único, em toda rota, sempre:

```json
{
  "error": {
    "code": "TICKET_DUPLICATE_OTHER_AGENT",
    "message": "Já existe ticket aberto para este e-mail com outro agente.",
    "details": {
      "ticketId": "8a3f...",
      "ownerName": "Ana Carolina",
      "ownerIsAvailable": false
    }
  }
}
```

> O exemplo anterior usava `FOLLOW_UP_BLOCKED`, extinto pela decisão D1.

- `code` é `SCREAMING_SNAKE_CASE`, estável, e faz parte do contrato: o front reage a ele.
- `message` é técnica e serve para log. **O texto que o usuário lê é escolhido pelo front**
  a partir do `code`, para manter o pt-BR e o tom da interface no lugar onde ele pertence.
- `details` é opcional e tipado por código de erro.

Códigos HTTP: `400` validação, `401` sem token ou token inválido, `403` sem permissão ou
conta bloqueada, `404` não existe ou não é visível para quem pediu, `409` conflito de
estado (duplicidade, corrida), `422` regra de negócio recusou, `429` limite, `500`
inesperado.

**Nunca mais erro silencioso.** A regra que quebrou a tela do agente em julho foi um
`const { data = [] }` transformando falha em lista vazia. Proibido: toda falha de leitura
vira estado de erro visível com opção de tentar de novo.

### Idempotência em escrita

Rotas que criam algo sob risco de clique duplo ou retry aceitam
`Idempotency-Key: <uuid>` e devolvem a mesma resposta para a mesma chave dentro de 24h.
Obrigatório em: criar ticket, criar interação, criar reembolso, importar pedidos em espera.

---

## 4. Tempo real

- **Push, não polling.** Nenhum `refetchInterval` e nenhum `setInterval` de rede no front.
- Canal por usuário: `user:{userId}` — notificações (transferência, tomada de ticket,
  alerta de reembolso).
- Canal por área: `managers` — eventos que a gestora acompanha ao vivo.
- Presença ("quem está online") usa Realtime Presence, que não grava no banco.
- O front reage a um evento invalidando a query correspondente do TanStack Query. O evento
  carrega o mínimo para decidir o que invalidar, nunca o dado inteiro.
- Se o socket cair, o front revalida ao reconectar. Isso substitui o heartbeat.

---

## 5. Fuso horário

Regra única: **America/Sao_Paulo é o fuso de negócio**. Toda conversão acontece na API.

- `timestamptz` é armazenado em UTC e convertido na borda.
- "Dia" em métrica, meta diária e regra das 18h significa dia em São Paulo.
- O front nunca calcula dia a partir de instante. Se a tela precisa de um dia, a API manda
  um `date`.

---

## 6. Divisão de responsabilidade

| Decisão | Quem manda |
|---|---|
| Regra de negócio (regra das 18h, o que bloqueia duplicidade, o que conta como atendimento) | API |
| Autorização | API, com o front espelhando para esconder o que não cabe |
| Estado derivado (status do ticket, contagem de interações, última interação) | banco, materializado; API só entrega |
| Número da interação (`seq`) | banco |
| Agregação de métrica | API, sobre rollups |
| Paginação, filtro, ordenação, busca | API |
| Texto que o usuário lê | front |
| Formatação de data, moeda e número na tela | front |
| Estado de interface (aba aberta, filtro escolhido, rascunho) | front |
| Otimismo de UI | front, com o servidor como verdade final |

Quem escreve o front não implementa regra de negócio. Quem escreve a API não escolhe
palavra de interface.

---

## 7. Superfície de rotas — linha de base

Esta é a linha de base herdada do documento de arquitetura. A trilha de backend é a **dona**
desta lista: pode acrescentar, dividir e detalhar, e deve justificar cada mudança. A trilha
de frontend **consome** e, quando faltar algo, registra na seção "Lacunas" em vez de
inventar endpoint.

| Módulo | Rotas |
|---|---|
| `session` | `GET /me` |
| `tickets` | `GET /tickets`, `POST /tickets`, `GET /tickets/:id`, `PATCH /tickets/:id`, `DELETE /tickets/:id`, `GET /tickets/:id/interactions`, `POST /tickets/:id/interactions`, `GET /tickets/lookup`, `POST /tickets/:id/claim` |
| `transfers` | `POST /transfers`, `GET /transfers`, `POST /transfers/:id/accept`, `POST /transfers/:id/decline`, `POST /takeovers`, `GET /takeovers`, `POST /takeovers/:id/approve`, `POST /takeovers/:id/reject` |
| `refunds` | `GET /refunds`, `POST /refunds`, `PATCH /refunds/:id`, `POST /refunds/:id/pickup`, `POST /refunds/:id/complete` |
| `metrics` | `GET /metrics/me`, `GET /metrics/dashboard`, `GET /metrics/refunds`, `GET /metrics/channels`, `GET /metrics/hourly`, `GET /metrics/follow-ups`, `GET /audit` |
| `notifications` | `GET /notifications`, `POST /notifications/:id/seen` |
| `held-orders` | CRUD + importação + distribuição |
| `radar` | CRUD + registro de ação + resumo |
| `notes` | CRUD do caderno do agente |
| `support-base` | leitura para agente e copy, escrita para gestora |
| `training` | vídeos e progresso |
| `users` | administração de contas e capacidades |
| `copy-analytics` | análises do time de copy |
| `exports` | geração de planilha no servidor |
| `integrations` | `/zendesk/*`, `/lya/*` |

---

## 8. Regra que vale mais que qualquer outra

**Nenhuma funcionalidade existente pode desaparecer.** Nem a menor, nem a que parece
esquecida, nem a que só uma pessoa usa.

Prioridade máxima: **a área do agente** (`role = agent`). É de lá que vem o dado que
alimenta a plataforma inteira. Um campo de formulário perdido ali é dado perdido para
sempre, e nenhum dashboard consegue inventá-lo depois.

Cada trilha entrega, junto com o desenho, um **inventário de paridade**: lista de tudo que
existe hoje, onde está no código atual, e onde passa a estar. Item sem destino é bloqueio,
não detalhe. Item que a trilha acha que deveria morrer vai para uma seção "Propostas de
remoção" com justificativa, e a decisão é do dono do projeto, nunca da trilha.

Funcionalidade inclui, e não se limita a: campo de formulário, validação, mensagem,
atalho, filtro, ordenação, badge, cor, tooltip, estado vazio, confirmação, exportação,
permissão, comportamento em erro e comportamento offline.

---

## 8-A. Decisões tomadas pelo dono do projeto — 26/09/2026

Sete questões levantadas pelas três trilhas foram decididas. São normativas: onde um
documento de trilha disser o contrário, ele está desatualizado e deve ser corrigido.

### D1 — A regra das 18 horas deixa de bloquear

**Decisão: o bloqueio sai.** Nem no servidor, nem no browser. Hoje ele existia só no
cliente e de forma incoerente (concluir pela lista bloqueava, concluir pelo diálogo
passava); a incoerência se resolve igualando pelo lado permissivo.

Consequências que precisam estar escritas, porque não são óbvias:

- O banco **continua marcando** `is_same_day_repeat`. A marcação não é o bloqueio: ela é o
  que permite a métrica não contar a mesma conversa duas vezes. Perder a marcação
  distorceria todo dashboard.
- `POST /tickets/:id/interactions` não valida janela de horário. Valida dono, permissão e
  status, e nada mais.
- Espera-se aumento no volume de interações registradas no mesmo dia. A definição das
  métricas não muda, então o número de "atendimentos" não infla; o que cresce é o de
  interações marcadas como repetição.

### D2 — A API conecta com o token do usuário, e a proteção por linha continua existindo

**Decisão: seguir a recomendação, com exigência de fluidez.** A API não usa credencial de
superusuário. Cada requisição abre transação e assume a identidade de quem chamou, e as
policies do banco permanecem como rede de segurança.

O que garante que isso não fique lento, que era a condição imposta:

- **A policy é rede, não filtro.** Todo recorte real (agente, período, status) vai no
  `WHERE` da consulta, servido por índice. A policy só confirma. Ela nunca é a responsável
  por reduzir o conjunto.
- **Os helpers continuam envolvidos em `(SELECT ...)`.** A correção de 27/07/2026 é
  pré-requisito e não pode regredir: sem ela, a função roda uma vez por linha varrida.
- **Transação curta.** A identidade é aplicada com escopo local à transação, o que é
  compatível com pooler em modo transação e com execução serverless.
- **Toda tabela nova nasce com proteção por linha ligada.** Medido em produção: `anon` e
  `authenticated` têm privilégio de escrita nas 32 tabelas, então tabela sem policy nasce
  gravável pelo mundo.

### D3 — A avaliação disciplinar sai do browser

**Decisão: preservar a funcionalidade inteira, movendo-a para o servidor.** Código e
arquivos novos estão autorizados.

- Metas, faixas e a regra de acúmulo viram **configuração com vigência**, não constante em
  componente. Assim é possível responder "qual era a meta em agosto".
- A avaliação roda em `GET /metrics/compliance`.
- Os valores iniciais são **idênticos aos de hoje** (e-mail 500 por semana, SMS 750, faixas
  de alerta, dois alertas viram uma advertência, três advertências indicam risco
  contratual), para que o corte não mude a avaliação de ninguém.
- Ganho: a política passa a ter histórico e deixa de mudar por deploy de front.

### D4 — Todo valor monetário é dólar

**Decisão: dólar, em todo o sistema.** O levantamento achou duas contradições reais no
código atual, ambas **corrigidas em 26/09/2026** no app legado:

| Onde | Estava | Ficou |
|---|---|---|
| `src/components/dashboard/RefundReasonDetailModal.tsx:35` | formatava em `BRL` | formata em `USD` |
| `src/lib/reportExport.ts` (4 ocorrências) | coluna "Valor (R$)" | coluna "Valor (US$)" |

Na v2 a API devolve `{ amount, currency }` com `currency` fixo em `USD`, para que o rótulo
nunca mais possa divergir do dado. A suspeita de unidade em centavos fica no backlog: o
dono confirmou dólar, e os 88 valores acima de 2.000 são qualidade de dado, não unidade.

### D5 — `platform` preserva "Nenhum" e vazio como coisas diferentes

**Decisão: não unificar, não apagar.** Os 10.666 registros com "Nenhum" e os 26.764 vazios
permanecem distintos no backfill. A diferença entre "verifiquei e não há" e "ninguém
preencheu" é informação, e a decisão sobre o que fazer com ela fica para depois.

### D6 — E-mails ficam como foram digitados

**Decisão: preservar todos os dados.** As 179 colisões por caixa alta e baixa não são
resolvidas agora. O backfill grava o valor original intacto.

Para que busca e regra de duplicidade funcionem sem alterar o dado, a tabela ganha uma
**coluna gerada** com a versão normalizada, usada só para índice e comparação. O original
nunca é sobrescrito.

### D7 — A paginação numerada continua existindo, por outro caminho

**Decisão: manter a funcionalidade.** As cinco tabelas que hoje mostram "Página 3 de 12"
continuam mostrando.

O caminho é diferente porque o diagnóstico estava incompleto: **o custo de hoje não é o
`OFFSET`, é o predicado não indexável** que o `OFFSET` percorre. Filtrar por
`service_date` em texto, convertido e com fuso aplicado por linha, obriga varredura. Sobre
uma tabela de fatos com índice por dia e agente, saltar alguns milhares de linhas é barato.

Portanto:

| Lista | Paginação | Por quê |
|---|---|---|
| Meus Atendimentos (agente) | cursor, sem número de página | lista quente, aberta o dia todo, o agente navega pelo começo |
| Reembolsos, duas abas | numerada, com total | o agente precisa saber quantos faltam |
| Auditoria de atendimentos e de reembolsos | numerada, com total | consulta fria, o total é a informação |
| Detalhe de motivo de reembolso | numerada, com total | idem |

O total é contado sobre a tabela de fatos e guardado em cache por combinação de filtro, de
modo que trocar de página não recontar. A seção 3 deste contrato fica emendada: `totalCount`
é devolvido nas listas acima, e não apenas onde a consulta é fria.

---

## 8-B. Toda mudança de schema entra por migration versionada

Regra redigida pela trilha de dados e acatada em 26/09/2026. É a garantia G6.1 de
`01-GARANTIAS.md`, e existe porque a ausência dela produziu a maior parte das divergências
que o levantamento encontrou.

Nenhuma alteração de estrutura pode ser aplicada por painel, MCP, Management API ou conexão
direta. Isso vale para `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, policy, índice, trigger,
função e tipo, em qualquer schema do projeto.

A regra é: **o arquivo de migration vem primeiro, e é o executor que aplica.** Um objeto que
existe no banco e não existe em migration é um incidente, não um atalho.

Três consequências operacionais:

1. **Emergência não abre exceção, abre prazo.** Se uma correção urgente for aplicada à mão, a
   migration correspondente é escrita e registrada **no mesmo dia**, e a reconciliação é
   pré-requisito do próximo deploy. Urgência justifica inverter a ordem; nunca omitir o
   arquivo.
2. **Todo deploy confere.** Um passo automatizado compara o catálogo do banco com o que as
   migrations descrevem, no mínimo tabelas, colunas e tipos, e falha quando divergem. A
   divergência de hoje sobreviveu porque ninguém a media; medir é o que impede a repetição.
3. **`supabase db push` continua proibido neste repositório**, e a proibição vale também para
   o schema novo. O registro de migrations do legado não descreve o legado, e por isso o push
   reaplicaria dezenas de arquivos.

O que motivou a regra, medido em 26/09/2026: 15 colunas mudaram de tipo sem nenhum
`ALTER ... TYPE` em 153 migrations; 33 arquivos locais nunca foram registrados; 3 migrations
existem só no banco; e **4 objetos de produção não têm fonte em lugar nenhum**
(`external_refunds` com 4.026 linhas, `normalize_order_number`, `lya_files`, `lya_file_rows`).

> O caso mais instrutivo é `normalize_order_number`: uma coluna gerada e um índice de
> expressão dependem dela, e ela não existe no repositório. Recriar o banco a partir das
> migrations produziria um schema que não funciona.

### Nota sobre o revoke de 26/09/2026

O `REVOKE` que fechou a exposição da view `lya_agentes` foi aplicado pela Management API,
antes desta regra existir, e por ser correção de segurança urgente. Pela consequência 1, ele
precisa de arquivo de migration correspondente no schema novo. Está registrado como pendência
em `90-BACKLOG.md`.

---

## 9. Lacunas e conflitos

Cada documento de trilha termina com duas seções obrigatórias:

- **Lacunas** — o que a trilha precisa e o contrato ainda não define.
- **Propostas de emenda** — onde a trilha discorda do contrato ou do documento de
  arquitetura, com o motivo.

Nada é resolvido por iniciativa da trilha. A reconciliação é feita depois, em conjunto, e
o resultado volta para este arquivo.

---

## 10. Arquivos desta pasta

| Arquivo | Trilha | Conteúdo |
|---|---|---|
| `00-CONTRATO.md` | comum | este documento |
| `01-GARANTIAS.md` | comum | as 12 classes de erro e a garantia mecânica que impede cada uma |
| `90-BACKLOG.md` | comum | o que foi decidido resolver depois, com número medido |
| `91-MEDICOES.md` | comum | agregações executadas em produção que fecharam itens abertos |
| `10-backend-regras-atuais.md` | backend | inventário de toda regra de negócio viva hoje |
| `11-backend-api.md` | backend | superfície completa da API |
| `12-backend-schema-alvo.md` | backend | especificação do schema novo (sem migration) |
| `13-backend-estrutura.md` | backend | estrutura de `apps/api` e convenções |
| `20-frontend-agente.md` | frontend | inventário exaustivo da área do agente |
| `21-frontend-outras-areas.md` | frontend | gestora, copy, produtos, login |
| `22-frontend-mapa-api.md` | frontend | cada interação de tela e o endpoint que ela usa |
| `23-frontend-estrutura.md` | frontend | estrutura de `apps/web` e convenções |
| `30-banco-estado-real.md` | dados | schema como ele está em produção, e onde divergiu das migrations |
| `31-banco-perfil-dados.md` | dados | volume, valores reais por coluna e inventário quantificado de dado sujo |
| `32-banco-migracao.md` | dados | backfill, rejeitos, reconciliação, ordem de execução e volta atrás |

### Divisão entre as trilhas de backend e de dados

Para não duplicarem trabalho: a trilha de **backend** é dona do schema **alvo**
(`12-backend-schema-alvo.md`), derivado das regras de negócio. A trilha de **dados** é dona
da **realidade atual** e da **travessia** de uma para a outra. Conflito entre as duas é
registrado como emenda, nunca resolvido editando o arquivo da outra trilha.
