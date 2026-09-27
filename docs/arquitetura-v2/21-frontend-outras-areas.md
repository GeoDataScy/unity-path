# Frontend v2 — inventário das outras áreas

> Trilha: **frontend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Companheiro de `20-frontend-agente.md` (que tem a área do agente em detalhe
> maior, por decisão do contrato §8). Aqui: gestora (`/dashboard/*`), copy
> (`/copy`), produtos (`/produtos`), login, seleção de área e tela de bloqueado.
>
> Data: 26/09/2026 · Base lida: branch `feat/area-produtos`.

Mesma convenção de marcação de `20-frontend-agente.md`: `[MANTER]`, `[SERVIDOR]`,
`[DECISÃO]`, `[DECIDIDO]` (já resolvido em `00-CONTRATO.md` §8-A) e `[BACKLOG]`
(adiado; a discussão vive em `90-BACKLOG.md`). Texto entre aspas é literal de
produção.

> **Reconciliado com `00-CONTRATO.md` §8-A em 26/09/2026.** Decisões que mudaram este
> documento: **D3** (a avaliação disciplinar sai do browser para
> `GET /metrics/compliance`, com metas datadas), **D4** (todo valor é dólar — as duas
> contradições de moeda desta área **já foram corrigidas no legado**) e **D7** (a
> paginação numerada continua existindo). Itens adiados apontam para `90-BACKLOG.md`.

---

## 1. Shell da gestora — `ManagerLayout`

**Arquivo:** `src/layouts/ManagerLayout.tsx` · **Rota:** `/dashboard`.

### 1.1 Guarda de acesso

Mesma sequência do `AgentLayout` (sessão → `me_status` → `profiles`), com duas
diferenças:

- lê `role, full_name, **can_approve_takeovers**`;
- a barreira é por **área**, não por role: `canAccessArea(role, "analytics")`.
  Quem não tem a área vai para `homePathForRole(role)`.

**Duas roles entram nesta área:** `manager` (gestora) e `copy_grup` (time de copy,
que entra só para ler os números). A diferença é `isManager = role === "manager"`:

```
MANAGER_ONLY_PATHS = ["/dashboard/alertas", "/dashboard/usuarios",
                      "/dashboard/base", "/dashboard/lya/cerebro"]
```

Acesso direto por URL a uma dessas rotas sem ser gestora → `navigate("/dashboard",
{replace:true})`. O Postgres guarda de novo com `is_manager()`. `[MANTER]` — na v2
o espelho continua no front e a recusa real vira `403` na API (contrato §3).

> **Curiosidade que é regra hoje:** `setFullName(role === "manager" ? "Ester" :
> full_name)`. O nome da gestora está **fixo no código**. `[DECISÃO]` — precisa sair,
> mas a saudação depende disso.

Revalidação de 30 s + `focus` + `visibilitychange` + `agent_heartbeat`: idêntica ao
`AgentLayout`, e o contrato §4 manda trocar por Realtime Presence.

### 1.2 Filtros globais (é o que define o restante da área)

Ficam na sidebar, publicados via `ManagerOutletContext = { fullName, role, range,
setRange, agentId, setAgentId, fromISO, toISO }`:

| Filtro | Padrão | Detalhe |
|---|---|---|
| **Período** | **1º dia do mês atual → hoje** | `DateRangePicker`; rótulo "Período"; legenda "Default: mês atual até hoje". `fromISO`/`toISO` derivados com `toISODate` (data **local**, sem fuso explícito) |
| **Agente** | "Todos" (`agentId = "all"`) | `Select` alimentado por `useAgentsQuery` (`profiles` com `role = "agent"`) |

Os dois só aparecem com a sidebar **expandida** — recolhida, o período e o agente
ficam inacessíveis. `[DECISÃO]` (é a lacuna que o PR de sidebar em tela baixa deixou).

`toISO` usa `range.to ?? range.from`, então um único dia clicado vira período de um
dia. `[MANTER]`

### 1.3 Navegação

| Rótulo | Rota | Ícone | Quem vê |
|---|---|---|---|
| Atendimentos | `/dashboard` (end) | `BarChart3` | manager + copy |
| Reembolsos | `/dashboard/reembolsos` | `RefreshCcw` | manager + copy |
| Acompanhamento | `/dashboard/acompanhamento` | `ClipboardCheck` | manager + copy |
| Interacoes *(sem acento, como está hoje)* | `/dashboard/interacoes` | `Activity` | manager + copy |
| Lya | `/dashboard/lya` (end) | `LyaMark size=16 tone="branco"` | manager + copy |
| Alertas | `/dashboard/alertas` | `AlertTriangle` + badge | **só manager** |
| Usuários | `/dashboard/usuarios` | `Users` | **só manager** |
| Base de Suporte | `/dashboard/base` | `BookOpen` | **só manager** |
| Zendesk | `/dashboard/zendesk` | `Headset` | **só manager** |
| Cérebro da Lya | `/dashboard/lya/cerebro` | `Brain` | **só manager** |

**Badge de Alertas:** `manager_refund_alerts().total_overdue`; expandida mostra o
número, recolhida mostra "9+" acima de 9, sempre `bg-destructive`. A query
(`useDashboardRefundAlertsQuery`) roda **só para a gestora**.

**Cabeçalho da sidebar:** logo + "Painel da Gestora"/"Analytics" para `manager`,
"Data Analytics"/"Suporte" para `copy_grup`. Botão de recolher com `aria-label`
"Expandir menu lateral"/"Encolher menu lateral" e tooltip "Expandir menu"/"Encolher
menu". Estado recolhido persiste em `localStorage["manager-sidebar-collapsed"]`.

`AreaSwitcher role currentArea="analytics"` logo abaixo — quem tem duas áreas troca
por ali.

### 1.4 Rodapé da sidebar

- **"Extrair Relatório"** (`FileSpreadsheet`, pulsa enquanto exporta → "Extraindo...")
  — **só gestora**. Chama `exportManagerReport(fromISO, toISO, agentId, agentName)`.
  Erro: toast "Erro ao extrair relatório" + mensagem real (fallback "Não foi
  possível gerar o relatório.").
- **"Logout"** — `record_auth_event("logout")`, limpa `sb-*`, `window.location.href`.
- Linha "Visualizando: {aba}" (Atendimentos / Reembolsos / Acompanhamento /
  Interacoes / Alertas / Zendesk), derivada do `pathname`.
- Recolhida, os dois botões viram ícones com tooltip ("Extraindo..." / "Extrair
  relatório", "Sair").

### 1.5 Elementos flutuantes do layout

| Componente | Quem vê | O que é |
|---|---|---|
| `ManagerRefundNotification` | só manager | aviso de reembolso em atraso |
| `LyaWidget contexto={lyaContexto}` | manager + copy | balão da Lya; recebe `{de, ate, agente_id, agente_nome, usuario_nome, usuario_role, tela}` — ou seja, **a Lya sabe o período, o agente filtrado e a tela atual** |
| `ManagerApprovalsBell` | `isManager && can_approve_takeovers` | sino de aprovação de tomada de ticket |
| `ThemeToggle` | todos | fixo em `top-4 right-4` |

### 1.6 Relatório do gestor (`exportManagerReport`)

Uma planilha `.xlsx` gerada **no cliente** (`xlsx`), com **6 RPCs em paralelo**
(`dashboard_metrics`, `dashboard_status_summary`, `dashboard_refund_metrics`,
`dashboard_export_extras`, `dashboard_channel_detail`,
`dashboard_contact_reason_notes`) e uma aba por assunto (`SHEET_SPECS`): visão
geral, canal/detalhamento, status de tickets, resumo e detalhe de reembolsos,
eficiência por canal, valores. Nome: `relatorio-suporte_{from}_a_{to}.xlsx`.
`[SERVIDOR]` — contrato §7, módulo `exports`. As abas, as colunas e o cabeçalho
mesclado de cada aba são contrato de interface com quem recebe a planilha.

### 1.7 Paleta dos gráficos (comum à área)

Categórica: `--chart-1` … `--chart-8`, ciclando por `i % 8`.
Semântica: `--chart-success` (ok), `--chart-warning` (alerta),
`--chart-danger` (crítico), `--chart-info` (azul), `--chart-neutral` (cinza),
`--chart-axis` (eixo e linha de referência), `--chart-grid`.

> Decisão de acessibilidade já registrada no projeto: séries categóricas com 4+
> cores `--chart-*` não passam em protanopia (roxo ↔ azul). Onde o gráfico é
> ranking de magnitude, o padrão é **uma matiz** (ver `RankingChart` do agente e
> `ChannelEfficiencyCard`). `[MANTER]` como regra de desenho na v2.

---

## 2. `/dashboard` — Atendimentos

**Arquivo:** `src/pages/Dashboard.tsx`

Cabeçalho: "Olá {fullName}!" → h1 "Atendimentos" → "Período: {dd/MM/yyyy} —
{dd/MM/yyyy} • Agente: Todos|Selecionado". Botão local **"Atualizar Métricas"**
que refaz só `dashboard_metrics` (agente + benchmark) e `dashboard_audit` — **não**
refaz o padrão de horários nem o detalhe de follow-ups. `[DECISÃO]`

### 2.1 KPIs

| Cartão | Fonte | Cálculo |
|---|---|---|
| "Total de atendimentos (todos)" / "Atendimentos — {agente}" | `dashboard_metrics.total_count` | rótulo muda com o filtro |
| "Média diária" | **cliente** | `total_count / (differenceInCalendarDays(to,from)+1)` `[SERVIDOR]` |
| "Top agente" (todos) / "Distância do Líder" (agente único) | `by_agent` + 2ª chamada de `dashboard_metrics` sem agente | ver abaixo |
| "Produto + saída" | `by_product[0].name` | assume a RPC já ordenada desc |

**Distância do líder:** quando um agente está filtrado, a página faz uma **segunda**
chamada de `dashboard_metrics` para "todos" só para achar o líder, e calcula
`gap = 100 - (selecionado/líder)*100`. Se o filtrado é o líder, rótulo fixo
"Líder do grupo 🏆" + "0% de gap"; senão "{gap}%" + "Líder: {nome} ({total}
atendimentos)" + "abaixo da referência", em `orange-600`. `[SERVIDOR]`

**Agentes escondidos no cliente** (afeta KPI e gráfico):
`HIDDEN_AGENT_NAME_PATTERNS = ["geovani", "agente teste"]`, casando por substring
sem diferenciar maiúsculas em `by_agent[].name`. É um filtro de conta de teste
**embutido na UI, por nome**. Na v2 vira uma marca no perfil, não um literal no
front. `[BACKLOG — B20]`: a lista atual precisa ser conferida antes, para não
esconder alguém real.

### 2.2 Gráficos

| Gráfico | Tipo | Série | Campo | Cor | Vazio |
|---|---|---|---|---|---|
| Atendimentos por agente | Bar | nome × valor | `by_agent` (filtrado) | `--primary` | "Nenhum dado encontrado neste período" |
| Mix de produtos | Donut (55/95) | produto | `by_product.slice(0,10)` | categórica | idem |
| Atendimentos por plataforma | Bar | nome × valor | `by_platform` | `--accent` | idem |
| Atendimentos por canal | Bar, **clicável** | nome × valor | `by_channel` | `--ring` | idem |

O donut tem legenda lateral própria com **% calculado no cliente**
(`valor / soma`). O card de canal tem a dica "Clique para detalhar" e abre o
`ChannelDetailModal` (2.5).

Embutidos: `TendenciaTemporal byDay={metrics.by_day} movingWindow={15}
forecastDays={7}` (seção 7) e `PadraoHorarios data={hourly}` (seção 6).

### 2.3 Tabela "Auditoria (registros)"

Colunas: **Data** (data + hora SP) · **Tipo** (badge `secondary` "Abertura" quando
`kind === "service"`, senão `outline` "Follow-up #{n}") · **Agente** (`—` se
ausente) · **E-mail Cliente** · **Produto** · **Plataforma** · **Canal**.

Paginação **no servidor**: `dashboard_audit(page_size = 10, page_offset)`. Rodapé
"Página {p} de {t} • {n} registros", até 7 links numéricos. Vazio: "Nenhum dado
encontrado neste período".

Esta tabela é o espelho de `_interaction_events` — uma linha por **interação**, não
por ticket. `[MANTER]` (foi correção deliberada; ver histórico do projeto).

### 2.4 Fontes

| Query | RPC | Args | Query key |
|---|---|---|---|
| métricas do filtro | `dashboard_metrics` | `from_date, to_date, agent_id` | `["dashboard","metrics",{from,to,agentId}]` |
| benchmark (todos) | `dashboard_metrics` | sem `agent_id` | idem com `agentId:"all"` |
| horários | `dashboard_hourly_pattern` | `from_date, to_date, agent_id` | `["dashboard","hourly-pattern",{…}]` |
| auditoria | `dashboard_audit` | `+ page_size, page_offset` | `["dashboard","audit",{…,page,pageSize}]` |
| follow-ups | `dashboard_follow_up_detail` | `p_from_date, p_to_date` | `["follow-up-insights",from,to]` |

**Dois desperdícios confirmados, para a v2 não copiar:**
- `dashboard_follow_up_detail` é buscada aqui **só** para compor `isLoading`/`error`
  — o `data` é descartado (quem usa é `/dashboard/interacoes`, que compartilha a
  chave de cache). `[DECISÃO]`
- `byDaySeries` é calculado num `useMemo` (preenchendo dias faltantes com zero) e
  **nunca renderizado**. Código morto.

Erro exibido: o primeiro não-nulo entre métricas, auditoria e follow-ups; fallback
"Erro ao carregar dados." Sem toast, sem confirmação, sem export local.

### 2.5 `ChannelDetailModal`

**Arquivo:** `src/components/dashboard/ChannelDetailModal.tsx` · Título
"Atendimentos por Canal — Detalhamento".

Controles **próprios do modal**: um `DateRangePicker` iniciado com o período da
página (mas alterável sem afetar a página — o período do modal pode divergir do
global) e um alternador "Por Agente" / "Por Tipo".

Fonte: `dashboard_channel_detail(p_from_date, p_to_date, p_agent_id)`, chave
`["dashboard","channel-detail",{from,to,agentId}]`, `enabled: open`.

Três cartões, todos somados no cliente `[SERVIDOR]`: "Total no período"
(+"{n} canal(is) ativos"), "Canal mais ativo", "Melhor taxa de conclusão" (maior
`rate` entre canais com `new_tickets > 0`).

Gráfico Bar empilhado por canal:
- **Por Agente:** uma série por agente (pivot montado no cliente), paleta categórica.
- **Por Tipo:** três séries — "Novos em aberto" = `max(0, new_tickets − done)`
  (`--chart-1`), "Interações" (`--chart-info`), "Concluídos" (`--chart-success`).

Tabela: Canal · Agente · Tickets Novos · Interações · Concluídos · Total ·
% Conclusão; linha de resumo por canal em negrito e as linhas por agente ordenadas
desc por total, cada uma com a própria % (`done/new*100`, `—` se `new = 0`). Sem
paginação e sem export. Vazio: "Nenhum dado encontrado neste período".

---

## 3. `/dashboard/reembolsos` — Reembolsos

**Arquivo:** `src/pages/DashboardRefunds.tsx`

Cabeçalho: rótulo "Analytics" → h1 "Reembolsos" → "Período: … • Agente: …". Badge
decorativo `Filter` + "Filtros" (não é controle).

### 3.1 Filtros locais

| Filtro | Opções | Origem |
|---|---|---|
| Status | "Todos" / "Em aberto" / "Concluídos" (`all`/`open`/`done`) | fixo |
| Tipo de reembolso | "Todos" / "Não informado" + dinâmicos | **`metrics.by_refund_type` deduplicado no cliente** |
| Produto | "Todos" / "Não informado" + dinâmicos | **`metrics.by_product` deduplicado e ordenado `localeCompare`** |

Isso cria um efeito colateral que a v2 tem de resolver: **se o período não tem
dado, os selects de filtro ficam vazios** — as opções vêm do próprio resultado.
`[SERVIDOR]` (facetas na resposta, ou rota de opções).

`productLabel`: `"all"` → nada; `"null"` → "Sem produto informado"; senão o nome.
Trocar qualquer filtro (local ou global) volta para a página 1.

`[DECIDIDO — D5]` **Plataforma "Nenhum" e plataforma vazia continuam sendo coisas
diferentes** (10.666 registros com "Nenhum", 26.764 vazios). Consequência direta
nesta área: o gráfico "Reembolsos por plataforma" e o filtro de plataforma do copy
passam a ter **duas** entradas distintas onde hoje alguém poderia esperar uma. O
front não junta as duas por conta própria: são informações diferentes ("verifiquei e
não há" versus "ninguém preencheu"). Falta decidir só o **rótulo** de cada uma na
tela — "Nenhum" e "Não informado" são a proposta natural, e é texto, portanto do
front (contrato §6).

### 3.2 KPIs

"Total de reembolsos" (`total_count`) · "Em aberto" (`open_count`) · "Concluídos"
(`done_count`) · "Taxa de conclusão" (**cliente**: `done/total*100`, sem decimais)
`[SERVIDOR]`.

### 3.3 Gráficos

| Gráfico | Tipo | Campo | Cálculo no cliente |
|---|---|---|---|
| Reembolsos por agente | Bar | `by_agent` | — |
| Status | Donut | `by_status` | — |
| Reembolsos por canal | Bar | `by_channel` | — |
| Reembolsos por produto | Bar (rótulos a −35°) | `by_product` | tooltip "{valor} Reembolsos" |
| Tipos de reembolso (concluídos) | Bar | `by_refund_type` | **ordenado por `parseFloat(nome)`** — os nomes são "25%", "50%"… |
| Reembolsos por plataforma | Bar horizontal | `by_platform` | total somado no cliente; tooltip com "{valor} ({pct}%)"; título mostra "Produto: {label}" quando filtrado; cartão "Total" no canto |
| Motivos de reembolso (2 colunas, **clicável**) | Bar horizontal | `by_reason` | total e % por item no cliente; ordenado desc; chips "Mais comum" e "Classificados" |
| `ChannelEfficiencyCard` (2 colunas) | ver seção 8 | `by_channel_efficiency` + `channel_efficiency_total` | **nada** — vem pronto da RPC |

Subtítulo do card de motivos (literal, explica a normalização histórica):
"Histórico normalizado em 15 categorias — texto livre antigo reclassificado
automaticamente." + "Clique numa barra para ver os reembolsos." (em `text-primary`).
Vazio da plataforma: "Nenhum reembolso encontrado{ para \"X\"} neste período".

### 3.4 Tabela "Auditoria (reembolsos)"

Colunas: Solicitação · Agente · E-mail · Plataforma · Produto · Pedido (mono) ·
Canal · **Status** (derivado no cliente: `completion_date ? "Concluído" : "Em
aberto"`) · Tipo (`—`). Paginação no servidor, 10/página
(`dashboard_refund_audit`). Rodapé "Página {p} de {t} • {n} registros".

### 3.5 Fontes e polling

| Query | RPC | Args |
|---|---|---|
| métricas | `dashboard_refund_metrics` | `from_date, to_date, agent_id, status_filter, refund_type_filter, product_filter` |
| auditoria | `dashboard_refund_audit` | idem + `page_size, page_offset` |

**As duas têm `refetchInterval: 15_000`** — atualização silenciosa a cada 15 s numa
instância `t4g.micro`. É exatamente o que o contrato §4 proíbe. `[SERVIDOR]`

### 3.6 `RefundReasonDetailModal`

**Arquivo:** `src/components/dashboard/RefundReasonDetailModal.tsx` · Título
"Motivos de reembolso — {categoria}".

Fonte: `dashboard_refund_reason_detail(from_date, to_date, reason_category,
agent_id, status_filter, refund_type_filter, product_filter, page_size,
page_offset)`; `PAGE_SIZE = 50`; paginação no servidor; `refetchInterval` 15 s;
volta para a página 1 quando qualquer filtro muda.

Resumo: chip "Reembolsos nesta categoria" ({total}) e chip "Período".

Tabela (11 colunas, mesma ordem do export): Solicitação · Conclusão ("Em aberto"
quando nula) · Agente · E-mail · Produto · Loja · Pedido (mono) · Canal · Tipo ·
Valor (`toLocaleString("pt-BR", {style:"currency", currency:"USD"})` — era `BRL` até
26/09/2026, **corrigido no legado** por `[DECIDIDO — D4]`) · Motivo
original (truncado com `title`). Vazio: "Nenhum reembolso encontrado nesta
categoria".

**Botão "Baixar relatório"** → `exportRefundReasonDetail`:
- pagina a **mesma** RPC em blocos de 200 até esgotar — baixa o conjunto inteiro,
  não a página visível;
- aba única "Reembolsos"; 4 linhas de cabeçalho mescladas ("Motivos de reembolso —
  {categoria}", "Período: … até …", "Total de reembolsos: {n}", vazia);
- colunas: Solicitação, Conclusão, Agente, E-mail, Produto, Loja, Pedido, Canal,
  Tipo, **"Valor (US$)"** (era "Valor (R$)" em 4 colunas de `reportExport.ts`,
  **corrigido no legado** em 26/09/2026 por `[DECIDIDO — D4]`), Motivo original;
- arquivo `reembolsos_{slug-da-categoria}_{from}_a_{to}.xlsx`;
- sem linhas: placeholder "Sem registros no período";
- toast (sonner) de sucesso: "Relatório gerado com {n} reembolso(s)."; erro: "Não
  foi possível gerar o relatório. Tente novamente."

`[DECIDIDO — D4]` **Todo valor monetário do sistema é dólar.** Esta tela tinha as
duas únicas contradições reais do código, e as duas já foram corrigidas no app
legado em 26/09/2026:

| Onde | Estava | Ficou |
|---|---|---|
| `RefundReasonDetailModal.tsx:35` | formatava em `BRL` | formata em `USD` |
| `reportExport.ts` (4 colunas) | "Valor (R$)" | "Valor (US$)" |

Na v2 a API devolve `{ amount, currency }` com `currency` fixo em `"USD"`, e o front
formata **pela moeda recebida** — rótulo e dado deixam de poder divergir, porque
param de ser escolhidos em lugares diferentes. A suspeita de unidade em centavos
ficou no backlog (**B12**): o dono confirmou dólar, e os 88 valores acima de 2.000
são qualidade de dado, não unidade.

---

## 4. `/dashboard/acompanhamento` — Acompanhamento

**Arquivo:** `src/pages/DashboardAcompanhamento.tsx`

h1 "Acompanhamento" + "Controle semanal de performance dos agentes — Últimas 8
semanas". **Esta tela ignora os dois filtros globais** (período e agente): sempre
olha as 8 últimas semanas fechadas (segunda→domingo) e todos os agentes.
`[MANTER]`, mas é surpresa de UX. `[DECISÃO]` se os filtros globais deveriam ficar
desabilitados aqui.

### 4.1 Fontes — hoje sem RPC própria, na v2 uma só

Hoje (para registro do que se está substituindo):

| Query | Fonte | Observação |
|---|---|---|
| agentes | `profiles` (`id, full_name, email`, `role = "agent"`) | chave `["dashboard","agents"]` |
| métricas semanais | **8 chamadas paralelas** de `dashboard_metrics`, uma por semana, sem `agent_id` | chave `["acompanhamento","weekly", semanas]` |
| canal dominante | `services` (`user_id, channel`, janela das 8 semanas, `channel not null`) | chave `["acompanhamento","agent-channels",from,to]` |

Na v2: **uma** chamada, `GET /metrics/compliance?weeks=8` `[DECIDIDO — D3]`.

### 4.2 O motor de regras — sai do navegador `[DECIDIDO — D3]`

Era o achado mais grave do levantamento: as metas, os limiares, o escalonamento e o
risco de contrato viviam em `evaluateAgents`, dentro do componente React. **D3
resolve:** a avaliação passa a rodar no servidor, as metas e faixas viram
**configuração com vigência** (dá para responder "qual era a meta em agosto"), e os
valores iniciais são **idênticos aos de hoje**, para que o corte não mude a
avaliação de ninguém.

A regra, como fica registrada (e como o servidor a aplica):

1. Canal dominante do agente: SMS vs outros nas 8 semanas; empate ou maioria de
   outros → `email`.
2. Meta semanal por canal: **e-mail 500**, **SMS 750**.
3. Classificação por semana: `ok` / `alerta` / `advertencia`.
4. **2 `alerta` acumulados viram 1 `advertência`** e zeram o contador.
5. `contractRisk = totalWarnings >= 3`.

Texto literal do card "Regras de acompanhamento:":

| Canal | OK | Alerta | Advertência |
|---|---|---|---|
| Email (meta 500/semana) | 500+ | 450–499 | 400–449 e < 400 |
| SMS (meta 750/semana) | 750+ | 675–749 | 600–674 e < 600 |

+ "2 alertas acumulados = 1 advertência" · "3 advertências em 8 semanas → contrato
não renovado" · "Apuração recorrente: sexta-feira".

**Os números deste card passam a vir de `rules` na resposta**, não de constante no
componente — senão o card pode dizer uma coisa e o servidor aplicar outra quando a
configuração mudar. O **texto** ao redor continua sendo do front (contrato §6).

### 4.3 KPIs e tabela

KPIs derivados do resultado do motor: "Total de agentes" · "Sem ocorrências"
(verde) · "Com advertências" (âmbar) · "Risco de não renovação" (vermelho).

Tabela "Desempenho semanal por agente": **Agente** (nome + badge do canal,
"EMAIL · 500/sem" ou "SMS · 750/sem", coluna *sticky*) · **uma coluna por semana**
(`dd/MM - dd/MM`, com a contagem e o badge de status; tooltip "{semana}: {n}
atendimentos" e "Status: {label}") · **Advertências** (total, cor por faixa) ·
**Situação** ("Não renovar" `destructive` / "Atenção (n)" `outline` âmbar /
"Regular" `outline` verde). Sem paginação: renderiza todos os agentes.

Rótulos de status: "OK", "Alerta", "Advertência".

Um `BarChart` por agente, com `ReferenceLine` tracejada na meta (rótulo "Meta {n}")
e cor de barra por faixa (`--chart-success` / `--chart-warning` / `--chart-danger`).

Sem modal, sem export, sem toast, sem filtro local.

### 4.4 Como a tela fica sem a lógica dentro dela `[DECIDIDO — D3]`

**Para o usuário, nada muda.** Mesmo título, mesmos KPIs, mesma tabela, mesmos
gráficos, mesmos rótulos, mesmas cores, mesmo card de regras. O que muda é a origem
do número. O dono autorizou arquivos e componentes novos para isso.

**A resposta de `GET /metrics/compliance?weeks=8`** entrega tudo o que a tela desenha:

```
{
  "generatedAt": "2026-09-26T…",
  "rules": {
    "effectiveFrom": "2026-01-01",
    "escalation": { "alertsPerWarning": 2, "warningsForContractRisk": 3 },
    "byChannel": {
      "email": { "goal": 500, "bands": [ {"status":"ok","min":500},
                 {"status":"alerta","min":450,"max":499},
                 {"status":"advertencia","max":449} ] },
      "sms":   { "goal": 750, "bands": [ … ] }
    }
  },
  "weeks":  [ { "from":"2026-08-04","to":"2026-08-10","label":"04/08 - 10/08" }, … ],
  "agents": [ {
      "agentId":"…", "agentName":"…",
      "channel":"email", "weeklyGoal":500,
      "byWeek":[ { "count":512, "status":"ok", "statusLabel":"OK" }, … ],
      "accumulatedAlerts":1, "totalWarnings":2,
      "contractRisk": false, "situation":"atencao"
  } ]
}
```

**Divisão de responsabilidade na tela:**

| Elemento | De onde vem |
|---|---|
| contagem de cada semana | `agents[].byWeek[].count` |
| status da semana e seu rótulo | `byWeek[].status` + `statusLabel` |
| cor do badge e da barra | **front**, por `status` → token (`--chart-success` / `--chart-warning` / `--chart-danger`) |
| total de advertências e a cor da faixa | `totalWarnings`, cor no front |
| "Não renovar" / "Atenção (n)" / "Regular" | `situation` + `contractRisk`; **o texto é do front** |
| badge do canal ("EMAIL · 500/sem") | `channel` + `weeklyGoal`, montado no front |
| `ReferenceLine` "Meta {n}" | `weeklyGoal` |
| rótulo da coluna da semana (`dd/MM - dd/MM`) | `weeks[].label` (ou formatado no front a partir de `from`/`to`) |
| os 4 KPIs do topo | contados no front sobre `agents[]` — é agregação trivial de uma lista já pronta, e manter no front evita um segundo bloco na resposta `[DECISÃO]` |
| card "Regras de acompanhamento" | números de `rules`, texto do front |

**Componentes novos** (em `features/metrics/`, expostos pelo `index.ts`):
`ComplianceTable`, `ComplianceWeekBadge`, `ComplianceAgentChart`, `ComplianceRules`
e `useComplianceQuery`. A página em `areas/analytics/` só compõe — **zero** constante
de meta, zero limiar, zero `evaluateAgents`.

**O que desaparece do front:** `GOALS`, `evaluateAgents`, `barColor` por limiar, as
8 chamadas paralelas de `dashboard_metrics`, o `SELECT` em `services` para descobrir
o canal dominante, e as três chaves de cache
(`["acompanhamento","weekly",…]`, `["acompanhamento","agent-channels",…]`,
`["dashboard","agents"]` nesta tela).

**Cache:** `staleTime` de 5 min, sem `refetchInterval` — é apuração semanal, e a
própria tela diz "Apuração recorrente: sexta-feira". Sem tempo real.

**Vazio e erro:** a tela hoje não tem nenhum dos dois de forma explícita (com a lista
de agentes vazia, renderiza cabeçalho e nada). Na v2 entra no padrão de
`23-frontend-estrutura.md` §6: `ErrorState` com "Tentar de novo" e um vazio dizendo
que não houve atividade nas 8 semanas.

---

## 5. `/dashboard/interacoes` — Interacoes dos Agentes

**Arquivo:** `src/pages/DashboardInteracoes.tsx` · Fonte única:
`dashboard_follow_up_detail(p_from_date, p_to_date)` (chave
`["follow-up-insights",from,to]`, compartilhada com `/dashboard`).

h1 (ícone `Activity`) "Interacoes dos Agentes" + "Visao detalhada dos status e
interacoes registradas pelos agentes no periodo selecionado. Cada abertura de
ticket e cada interacao valem 1 — mesma regra da tela de Atendimentos."

> Os textos desta tela estão **sem acento** ("Interacoes", "Visao", "periodo",
> "Concluido"). É como está em produção; a v2 deve corrigir a acentuação — é a
> exceção prevista pelo princípio "só corrigir texto que passaria a mentir"? Não:
> é erro de digitação, não muda sentido. `[DECISÃO]` do dono.

### 5.1 Cálculo no cliente (a tela mais "computada" da área) `[SERVIDOR]`

- `filteredAgents`: filtra `by_agent` pelo agente global.
- **`kpi` é recalculado no cliente** quando há agente filtrado (somando
  `filteredAgents`), porque `data.kpi` é sempre "todos".
- `recentFollowUps` é filtrado por agente com **join manual por nome**:
  `recent_follow_ups` só traz `agent_name`, então casa com `by_agent` para achar o
  id. Homônimo quebra. `[SERVIDOR]`
- `pieData` (3 fatias): "Novos em aberto" = `max(0, new_tickets_count −
  done_count)`, "Interações" = `interactions_count`, "Concluido" = `done_count`;
  fatias zeradas são removidas. O comentário no código explica que rotular a
  primeira como "Tickets Novos" (sem subtrair concluídos) fazia o gráfico não bater
  com o cartão nem com a tabela.
- `stackedBarData`: a mesma decomposição por agente + total.
- `sortedAgents`: ordena `completion_rate` asc (pior primeiro), mas empurra quem
  tem `total_tickets === 0` para o fim.
- Cor da taxa: `≥80` verde, `≥50` âmbar, `>0` vermelho, `0` cinza.

### 5.2 KPIs (5)

| Cartão | Valor | Subtítulo |
|---|---|---|
| Total de Atendimentos | `kpi.total_services` | "aberturas + interações" |
| Tickets Novos | `kpi.new_tickets_count` | % sobre o total |
| Interações | `kpi.interactions_count` | — |
| Concluidos | `kpi.done_count` | "{pct}% dos tickets novos" |
| Interações por Ticket | `interactions/new_tickets` (1 decimal) | "média no período" |

### 5.3 Gráficos, insights, tabela e feed

- **"Distribuicao de Status"** — donut de 3 fatias, rótulos "{nome} {pct}%", cores
  `open = --chart-neutral`, `in_progress = --chart-warning`,
  `done = --chart-success`. Vazio: "Sem dados no periodo".
- **"Tickets por Agente"** — Bar empilhado das 3 séries com tooltip próprio (3
  valores + total), legenda e `LabelList` dentro das barras e o total no topo.
  Botões locais "Todos" / "Novos em aberto" / "Interações" / "Concluído" trocam
  entre empilhado e série única.
- **Cartões de insight** (de `data.insights`, condicionais): "Destaque do Periodo"
  (esmeralda, `Award`) "{rate}% de conclusao ({done}/{total} tickets)" · "Mais
  Tickets Novos" (âmbar, `FolderOpen`) "{n} tickets novos" · "Mais Produtivo"
  (violeta, `Zap`) "{n} interacoes registradas".
- **Tabela "Detalhamento por Agente"**: Agente · Total · Tickets Novos ·
  Interações · Concluidos · Media Int/Ticket (`avg_interactions_to_close`, `-` sem
  tickets) · Taxa de Conclusao (`Progress` + %). Sem paginação. Vazio: "Nenhum
  agente encontrado no periodo".
- **Feed "Atividade Recente"**: lista com borda esquerda colorida por status, nome,
  badge "Concluido"/"Em Andamento", badge "#{n}" quando `follow_up_number > 1`,
  e-mail, produto, hora SP e observação truncada em 2 linhas. Só `max-h-[400px]`
  com scroll, sem paginação. Vazio: "Nenhuma interacao registrada no periodo".

Erro: "Erro ao carregar dados." Sem modal, sem export, sem toast.

**Incoerência de cor entre telas para o mesmo conceito:** aqui "Novos em aberto" é
`--chart-neutral`; no `ChannelDetailModal` a mesma categoria é `--chart-1`.
`[DECISÃO]` — a v2 precisa de um mapa único de cor por status.

---

## 6. `/dashboard/alertas` — Alertas (só gestora)

**Arquivo:** `src/pages/DashboardAlertas.tsx`

Ícone `AlertTriangle` em círculo `destructive` → h1 "Alertas" → "Reembolsos em
aberto há mais de 24 horas — atualizado a cada 60s". Botão "Atualizar" (`RefreshCw`
girando enquanto busca).

Fonte: `manager_refund_alerts()` **sem argumentos**, chave
`["dashboard","refund-alerts"]`, `staleTime` 30 s, `refetchInterval` **60 s**,
`refetchOnWindowFocus`. Sem sessão devolve objeto vazio sem chamar a RPC.

### 6.1 KPIs e filtros

KPIs: "Total em atraso" (`total_overdue`; vermelho > 0, verde = 0) · "Agentes com
atraso" (`agents_affected`) · "Mais crítico" (`by_agent[0]`: nome + "{n}
reembolsos", senão "Nenhum" em verde).

Filtros **100% no cliente** sobre `by_agent` `[SERVIDOR]`: input "Buscar agente...",
`Select` "Todos os agentes" (opções derivadas do resultado), botão "Limpar filtros"
e contador "{filtrados} de {total} agente(s)".

### 6.2 Cartão por agente

Cor da borda por gravidade: `≥5` `destructive`, `≥3` laranja, senão âmbar.
Cabeçalho: nome + badge "{n} reembolso(s) em atraso".

Tabela interna: E-mail cliente · Plataforma · Produto (`—`) · Pedido (mono) ·
Canal (`—`) · Solicitado em (`dd/MM/yyyy`) · **Atraso** · Ação.

`DelayBadge` tem três níveis: `≥4d` `destructive`, `≥2d` laranja, senão âmbar,
texto "{d}d de atraso".

Ação: botão "Dar baixa" → "Dando baixa..." (desabilita **só a linha em voo**).
Abre o mesmo `CompleteRefundDialog` do agente, com título "Dar baixa no reembolso"
e descrição "Conclui o reembolso em nome do agente. A baixa fica registrada com o
seu usuário.", e com "Agente: {ownerName}" no resumo. Padrões ao abrir daqui:
`completion_date = hoje`, os demais vazios.

Escrita: `manager_complete_refund(p_refund_id, p_completion_date, p_refund_value,
p_refund_type, p_reason, p_items_returned)` com **atualização otimista** no cache
de alertas (remove a linha e decrementa os contadores antes da resposta), rollback
em erro, e invalidação de `["dashboard","refund-alerts"]` **e**
`["dashboard","refunds"]` ao final.

Toasts: "Baixa registrada" / "Reembolso de {e-mail} ({agente}) concluído."; erro
"Erro ao dar baixa" + mensagem (fallback "Não foi possível dar baixa no
reembolso."). Erro de leitura aparece como banner, não toast: fallback "Erro ao
carregar alertas."

Vazios: sem alertas → `CheckCircle2` verde + "Sem alertas" + "Todos os reembolsos
estão dentro do prazo de 24 horas."; filtro sem resultado → `Search` + "Nenhum
agente encontrado com os filtros aplicados." + "Limpar filtros".

### 6.3 Componente órfão — `SameDayRepeatsSection`

`src/components/dashboard/SameDayRepeatsSection.tsx` é **importado** por
`DashboardAlertas.tsx` e **nunca renderizado**. Hoje nenhum usuário o vê.
`[BACKLOG — B19]` — religar ou remover é decisão adiada. Está pronto e olha um
problema real, com uma ressalva nova: com **D1** a regra das 18h deixou de existir,
então o KPI "Furaram a regra das 18h" perdeu o referente. A marcação
`is_same_day_repeat` continua no banco (é o que evita contar a conversa duas vezes
na métrica), então a seção continua tendo o que mostrar — precisa de outro nome:

- Fonte: `dashboard_same_day_repeats(from_date, to_date, agent_id)`, chave
  `["dashboard","same-day-repeats",{from,to,agentId}]`.
- Título "Interações repetidas no mesmo dia" + "Mais de uma interação no mesmo
  ticket no mesmo dia. Não é bloqueado — cada caso pode ter motivo legítimo. Serve
  para você conferir o número."
- KPIs: "Contagens duplicadas no período" (`same_day_extra`, âmbar > 0) +
  "interações a mais do que atendimentos-dia" · "Furaram a regra das 18h"
  (`rule_violations`) + "registradas antes das 18h do dia da interação anterior" ·
  "Maior proporção" (`by_agent[0]`: "{repeat_count} de {total_count} ({pct}%)").
- Tabela "Por agente": Agente · Repetidas · Total de interações · Proporção (badge
  `destructive` quando `pct >= 5`).
- Detalhe expansível "Ver detalhe (N)" / "Ocultar detalhe": Cliente · Produto ·
  Agente · Anterior · Esta · Intervalo (`{n}h` ou `—`) · Observação. Mostra
  **só as 50 primeiras** (`.slice(0,50)`), sem próxima página, com a nota
  "Mostrando as 50 mais recentes de {total}. Reduza o período para ver o resto."
- Vazio: "Nenhuma interação repetida no mesmo dia neste período."

---

## 7. `PadraoHorarios` e `TendenciaTemporal` (embutidos em `/dashboard`)

Os dois têm uma camada didática grande que é **copy estática no componente** —
nenhuma vem do backend. Isso é patrimônio de produto e não pode ser perdido na
migração.

### 7.1 `PadraoHorarios` (`src/features/dashboard/PadraoHorarios.tsx`)

Título "Padrão de horários" + "(quando o time está mais ativo)" + "Cada quadradinho
mostra quantos atendimentos foram feitos naquele dia da semana e naquela hora. Mais
escuro = mais movimento. Clique nos cards para entender cada número."

- **Heatmap 7×24** em tabela HTML (não recharts), dias reordenados Seg→Dom, montado
  no cliente a partir de `by_dow_hour` (168 células já zeradas pela RPC). Opacidade
  da célula = `0.15 + (count/max) * 0.85` sobre `--primary`; `title` nativo
  "{Dia} {h}h — {n} ação(ões)"; clique abre o diálogo explicativo. Vazio: "Sem
  dados de atividade no período selecionado."
- **Quatro KPIs clicáveis:** "Hora de pico" (`peak.hour`h + "{dow} • {n} ações") ·
  "Começa às" (`shift.start_hour` em HH:MM + "início típico do dia") · "Termina às"
  (`shift.end_hour` + "fim típico do dia") · "Bate meta às" (`goal_hit.hour` + "em
  {days_hit} de {total_active_days} dias (meta: {threshold})").
- **Donut "Distribuição por turno"**, 4 fatias montadas no cliente de
  `shifts_share`: Manhã 5–12 (`--chart-warning`), Tarde 12–18 (`--chart-info`),
  Noite 18–22 (`--chart-1`), Madrugada 22–5 (`--chart-neutral`); fatias zeradas
  removidas; barra de % ao lado.
- **Insights automáticos** (até 4 frases, limiares fixos no cliente): pico da
  semana; "{pct}% de toda a atividade acontece no horário comercial (8h–18h)";
  frase sobre bater a meta; e alerta quando a madrugada passa de 5%: "{pct}% da
  atividade ocorre na madrugada (22h–5h). Confirme se isso é esperado."
- **Seis diálogos explicativos** (`peak`, `start`, `end`, `goal`, `heatmap`,
  `shift`), cada um com as seções fixas "Em poucas palavras", "Como o sistema
  coleta esses horários", "Por que esse número apareceu aqui", "Como ler o
  resultado" e, quando cabe, "Vale lembrar:". Explicam mediana vs média e a meta
  por canal (SMS 150/dia, Email-Clickbank 100/dia por agente).

### 7.2 `TendenciaTemporal` (`src/features/dashboard/TendenciaTemporal.tsx`)

Recebe `byDay` por prop; **toda a estatística é feita no navegador** `[SERVIDOR]`:
- `linearRegression` (mínimos quadrados: `slope`, `intercept`, `r2`);
- `rollingMean(values, window)` — janela 15 dias por padrão;
- projeção: a mesma reta estendida 7 dias além do último dia observado;
- veredito: `significant = r2 >= 0.2 && |slope|/médiaY >= 0.005`; sem significância
  força "stable" mesmo com inclinação ≠ 0;
- qualidade do R²: alta `≥0.7`, moderada `≥0.4`, baixa `≥0.2`, "muito baixa" abaixo.

Título "Tendência temporal" + "(regressão linear · média móvel 15d · projeção +7d)".

`ComposedChart`: `Area` do valor real (gradiente `--primary`), `Line` da média móvel
(tracejada, `--chart-info`), `Line` da regressão (verde subindo / `--chart-danger`
caindo) e `Line` da projeção (tracejada âmbar, `--chart-warning`, só no futuro).
Tooltip renomeia: "Atendimentos", "Média móvel 15d", "Tendência (regressão)",
"Projeção". Vazio: "Nenhum dado encontrado neste período".

Quatro KPIs clicáveis: "Tendência" ("{±slope} /dia" + "Crescendo"/"Caindo"/
"Estável") · "Confiança (R²)" (2 decimais + "qualidade {label}") · "Projeção (+7d)"
("~{valor} /dia" + "se o ritmo continuar") · "Média móvel 15d" ("linha azul
tracejada").

Legenda literal (4 itens): "Atendimentos por dia (real)", "Média móvel 15 dias",
"Tendência (regressão linear)", "Projeção +7 dias".

Diálogos (`trend`, `r2`, `forecast`, `ma`) com "O que isso significa, sem
matematiquês:", "Como o sistema chega nesse número:", **"A fórmula matemática:"**
(bloco `<pre>` com `slope = (n·Σ(x·y) − Σx·Σy) / (n·Σx² − (Σx)²)` e
`R² = 1 − Σ(y−ŷ)²/Σ(y−ȳ)²`), "Como ler o resultado:" e ressalvas (a projeção assume
que nada muda).

`[DECISÃO]` Na v2 a estatística vai para a API (contrato §6: "agregação de métrica
é da API, sobre rollups"). As **explicações** continuam no front (§6: "texto que o
usuário lê é do front"), inclusive as fórmulas.

---

## 8. `ChannelEfficiencyCard` (embutido em `/dashboard/reembolsos`)

**Arquivo:** `src/components/dashboard/ChannelEfficiencyCard.tsx`. É a única peça
da área que **não recalcula nada**: recebe `by_channel_efficiency` e
`channel_efficiency_total` já prontos da RPC. Modelo a seguir na v2.

Título "Eficiência por canal" + "Reembolsos concluídos no período. Taxa de conversão
é a fatia dos concluídos do canal que ficou em reembolso parcial (<100%) ou integral
(100%)."

**Cores com significado, escolhidas por acessibilidade** (comentário do autor no
código): parcial = `--chart-2` (azul, "a conversão que a operação persegue"),
integral = `--chart-8` (laranja). **Deliberadamente não usa verde/vermelho** porque
não passa em daltonismo. `[MANTER]`

Gráfico: Bar horizontal 100% empilhado, domínio `[0,100]`, ticks 0/25/50/75/100 com
"%", séries `partial_rate` + `full_rate`. Uma linha sintética **"Todos os canais"**
é adicionada no cliente quando há total e pelo menos 2 canais. `LabelList` central
só escreve o rótulo se o segmento tem `≥ 12` (evita texto sobreposto). Tooltip com
nome, `total_done`, contagem e taxa parcial e integral. Vazio: "Nenhum dado
encontrado neste período".

Tabela: Canal · Concluídos · Parciais · % dos parciais · Integrais · % dos
integrais · Conv. parcial · Conv. integral (a linha "Todos os canais" mostra `—` nas
duas colunas de participação). Rodapé: "“% dos parciais” e “% dos integrais” mostram
quanto cada canal representa do total de reembolsos parciais e integrais do período."

`efficiency_score` existe no tipo (comentado como "igual a `partial_rate`, mantido
por compatibilidade") e **nunca é lido**. `[DECISÃO]` remover na v2.

---

---

## 9. `/dashboard/usuarios` — Usuários (só gestora)

**Arquivo:** `src/pages/DashboardUsers.tsx` · **Fonte:** `manager_list_users()`,
chave `["dashboard","users"]`, **`refetchInterval: 15_000`**.

Duas abas: **"Usuários"** (conteúdo próprio) e **"Pedidos em Espera"**
(`HeldOrdersManagerTab`, seção 10).

### 9.1 Cartões de contagem (todos derivados no cliente `[SERVIDOR]`)

| Cartão | Regra |
|---|---|
| Total de usuários | `users.length` |
| Ativos | `is_active && !auth_account_deleted` |
| Inativos | `!is_active && !auth_account_deleted` |
| Online agora | `is_online && is_active` |

### 9.2 Filtros (no cliente)

- Busca: `Input` "Buscar por nome ou e-mail..." — casa em `full_name + email`.
- `Select` de status: "Todos" / "Ativos" / "Online agora" / "Inativos" /
  "Conta excluída" (`all|active|online|inactive|deleted`).

### 9.3 Tabela "Lista de usuários"

| Coluna | Conteúdo |
|---|---|
| Status | bolinha com tooltip: "Conta excluída" · "Inativo" + "Desde {data} • por {email}" ou "Acesso bloqueado" · "Online" · "Offline" + "Visto {relativo}" ou "Nunca visto". Agente com `is_available = false` ganha o chip **"De folga"** |
| Usuário | nome + e-mail |
| Papel | badge via `roleLabel`: Manager / Agente / Copy / Produtos |
| Em aberto | badge com `open_tickets_count`; chip verde "{n} autorizado(s)" com tooltip "Tickets assumidos com autorização da gestora (dono estava de folga)." quando `authorized_open_count > 0` |
| Último login | relativo + tooltip absoluto |
| Última saída | idem |
| Ações | ver abaixo |

Sem paginação (lista inteira, no cliente) e sem seleção múltipla. Vazio: "Nenhum
usuário encontrado." Erro: "Não foi possível carregar os usuários." Carregando:
3 `Skeleton`.

### 9.4 Ações por linha

| Ação | Condição | Escrita |
|---|---|---|
| "Redistribuir" | agente com `open_tickets_count > 0` (**mesmo com conta já excluída**) | abre `ReassignTicketsDialog` (9.6) |
| "De folga" / "Disponível" | só agente | `manager_set_agent_availability(p_target_user_id, p_available)` |
| "Inativar" / "Reativar" | desabilitado para manager, tooltip "Managers não podem ser inativados aqui." | `manager_set_user_active(p_target_user_id, p_active)` |
| Lixeira "Excluir conta" | desabilitado para manager, tooltip "Managers não podem ser excluídos aqui." | `manager_delete_auth_user(p_target_user_id, p_confirm_email)` |
| — | conta já excluída sem tickets | texto em itálico "Sem ações disponíveis" |

**Confirmação de exclusão de conta** (o diálogo mais protegido do sistema):
título "Excluir conta de login"; "Esta ação remove o acesso de **{nome/e-mail}** ao
sistema."; caixa verde "O histórico (atendimentos, reembolsos, transferências) será
**preservado**. Apenas a conta de login é removida."; "Para confirmar, digite o
e-mail do usuário abaixo:" + o e-mail em `<code>` + `Input` "Digite o e-mail aqui".
**O botão só habilita quando o texto digitado (trim + lowercase) é igual ao e-mail.**
Botões "Cancelar" / "Excluir definitivamente" → "Excluindo...". `[MANTER]` inteiro.

**Toasts:**

| Ação | Título | Descrição |
|---|---|---|
| ativar/inativar (ok) | "Usuário inativado" / "Usuário reativado" | nome ou e-mail |
| disponibilidade (ok) | "Marcado como de folga" / "Marcado como disponível" | nome ou e-mail |
| excluir (ok) | "Conta excluída" | "{e-mail} foi removido do login. Histórico preservado." |
| ativar/disponibilidade (erro) | "Erro" | mensagem ou "Não foi possível atualizar." |
| excluir (erro) | "Erro ao excluir" | mensagem ou "Não foi possível excluir." |

Toda escrita invalida `["dashboard","users"]`.

### 9.5 `ReassignTicketsDialog` — redistribuir tickets

**Arquivo:** `src/features/dashboard/ReassignTicketsDialog.tsx`. Título
"Redistribuir tickets de {nome}"; descrição "Atribua um agente de destino para cada
ticket. A redistribuição é imediata — o destinatário recebe o ticket em \"Meus
Atendimentos\" sem precisar aceitar."

- Fonte: `manager_list_open_tickets_by_agent(p_agent_id)`, chave
  `["dashboard","open-tickets-by-agent",agentId]`.
- Estados: "Carregando tickets…" · "Erro ao carregar tickets." · "Este agente não
  tem tickets em aberto." · aviso âmbar acima de 500 tickets: "**N tickets em
  aberto.** Considere redistribuir em lotes menores selecionando subconjuntos com
  filtro."
- Controles: busca "Pesquisar ticket pelo email do cliente…" (no cliente, com botão
  de limpar) · checkbox "selecionar todos" (estado indeterminado quando parcial) +
  "{sel} de {total} selecionado(s) [(filtrado)]" · combobox "Escolher agente…" com
  busca + botão "Aplicar" (destino em lote).
- Tabela (em `ScrollArea` de 420 px): checkbox · Cliente · Produto · Data (parte de
  data de `service_date`) · Status (badge por `effective_status`) · **"F.U."**
  (`follow_up_count`) · Destino (combobox por linha). Vazio com busca:
  'Nenhum ticket em aberto para o email "{busca}".'
- Rodapé: "{n} ticket(s) com destino definido" + "Cancelar" / "Enviar ({n})" →
  "Enviando…".
- Destinos elegíveis, no cliente: `is_active && role === "agent" && id !== origem`,
  ordenados por nome pt-BR.
- Escrita: `manager_reassign_tickets(p_assignments: [{service_id, to_user_id}])`.
  Invalida `["dashboard","users"]`, `["dashboard","open-tickets-by-agent"]`,
  **`["services","me"]`**, `["transfer_history"]`, `["transfer_notifications"]` —
  ou seja, mexe no cache da área do agente.
- Toasts: sem destino → "Nada para enviar" / "Defina o destino de pelo menos um
  ticket."; lote sem seleção → "Selecione tickets" / "Marque pelo menos um ticket
  para aplicar o destino em lote."; sucesso → "{moved} ticket(s) redistribuído(s)"
  + (se houver) "{skipped} já pertenciam ao destino e foram ignorados."; erro →
  "Erro" / mensagem ou "Falha ao redistribuir."

### 9.6 `ManagerApprovalsBell` — aprovação de tomada de ticket

**Arquivo:** `src/features/takeovers/ManagerApprovalsBell.tsx`. Sino fixo em
`top-4 right-16`, só monta com `isManager && can_approve_takeovers` (hoje uma
pessoa). Badge vermelho com contagem ("9+" acima de 9) e **som quando a contagem
sobe** (silencioso na primeira carga, igual ao sino do agente).

Popover: "Aprovações pendentes" / "Atendimentos de clientes cujo responsável está de
folga". Itens: "{requester_name ou \"Um agente\"} quer assumir um ticket de
{owner_name ou \"colega de folga\"}", "{client_email} · {product}", tempo relativo e
a nota do pedido em itálico. Rodapé fixo: "Autorizar transfere o atendimento para o
agente que solicitou." Carregando "Carregando..."; vazio "Nenhum pedido pendente."

Ações: "Recusar" abre `Textarea` "Motivo (opcional)" (máx. **300**) com "Cancelar" /
"Confirmar recusa" → "Enviando..."; "Autorizar" → "Autorizando...".

Fontes: `manager_takeover_notifications()` (chave `["takeover_notifications"]`,
**`refetchInterval` 30 s**), `approve_ticket_takeover(p_request_id)` e
`reject_ticket_takeover(p_request_id, p_note)`; as duas invalidam
`["takeover_notifications"]` e `["dashboard","users"]`.

Toasts: "Autorizado" / "{requester_name ou \"O agente\"} agora atende o ticket de
{client_email}."; "Recusado" / "O pedido foi recusado."; erros "Erro" + mensagem
("Não foi possível autorizar." / "Não foi possível recusar.").

---

## 10. `/dashboard/usuarios` → aba "Pedidos em Espera" (só gestora)

**Arquivo:** `src/features/held-orders/HeldOrdersManagerTab.tsx` — não tem rota
própria. **Fonte:** `manager_list_held_orders(from_date: null, to_date: null,
agent_id, status_filter)`, chave `["dashboard","held-orders",{agentId,statusFilter}]`
(**ignora o período global**), mais `manager_list_users` para o select de agente.

### 10.1 Resumo e filtros

Cinco cartões, todos no cliente `[SERVIDOR]`, sobre as linhas **não duplicadas**:
"Total" · "Aguardando" (`pending` e não em andamento) · "Em andamento" · "Confirmados"
· "Sem agente" (`!assigned_to`). Card "Por agente" com chips de pendentes/em
andamento/confirmados — este vem pronto (`summary_by_agent`).

Filtros: busca (pedido / e-mail / loja, **no cliente**) · Status ("Todos status" /
"Aguardando" / "Em andamento" / "Confirmados", **no servidor**) · Produto (opções =
miolo do SKU dos itens, montadas no cliente com contagem "(N)") · Agente ("Todos
agentes" / **"Sem agente"** que é filtro de cliente / lista de agentes, no servidor)
· alternador "Ver/Ocultar repetidos (N)" quando há duplicata.

### 10.2 Seleção em lote

Caixa "Selecionar as primeiras" + `Select` de quantidade (10 / 15 / 20 / 30 / 50 /
"Todas") + botão "Selecionar" (marca os N primeiros pendentes selecionáveis **na
ordem exibida**). Checkbox do cabeçalho marca/desmarca todos os pendentes visíveis.
Contadores "{n} pendente(s) na lista", "{n} selecionado(s)" e botão "Limpar".

### 10.3 Tabela "Pedidos em espera"

Colunas: checkbox · Pedido (nº + RMA) · Loja (`heldOrderStoreLabel`, "Devolução"
para retornos) · Motivo · Cliente (nome + e-mail) · Data · Agente · Status.
Badges de status: "Confirmado" / "Em andamento" / "Novo" / "Pendente N" /
**"Repetido"**. Linha duplicada fica com opacidade reduzida e checkbox desabilitado.
Sem paginação. Vazio: "Nenhum pedido encontrado." Erro: "Não foi possível carregar
os pedidos."

Botões do cabeçalho: "Ver/Ocultar repetidos (N)" · "Exportar (N)" · "Importar
arquivo" · "Distribuir (N)" (desabilitado sem seleção).

### 10.4 Importar (`ImportHeldOrdersDialog`)

Título "Importar pedidos em espera"; a descrição explica que aceita
`On_Holds_Details` ou devoluções, em CSV/`.xlsx`/`.xls`, e que pedido **já em aberto
não entra de novo**. Botão "Escolher arquivos (CSV ou Excel)" (múltiplo, aceita
`.csv,.xlsx,.xls,.ods`), lista dos arquivos com contagem de linhas ou erro de
leitura e um `X` por arquivo, e "Total a importar: N pedidos." Botões "Cancelar" /
"Importar (N)" → "Importando...".

Escrita: `manager_import_held_orders(p_rows)`. Toasts: nada selecionado → "Nada para
importar" / "Selecione um arquivo CSV ou Excel válido."; sucesso → título
"Importação concluída" **ou "Nada novo para importar"** quando `inserted === 0`, com
descrição composta por `describeImport()`, ex.: "12 pedido(s) novo(s) · 3 já em
aberto (repetido) · 1 linha(s) vazia(s). Repetidos: 1023, 1024, …" (lista até 5).
Quando `inserted === 0` o diálogo **não fecha** (mantém os arquivos para conferência).
Erro → "Erro ao importar" + mensagem.

**Parser (`parseHeldOrdersCsv.ts`)** — detecta o formato pelo cabeçalho normalizado:

| Formato | Detecção | Mapa de colunas |
|---|---|---|
| On Holds Details | tem `dyna_code` | `dyna_code`, `order_number`, `merged_orders`, `reason`, `order_date`, `email`, `name`, `city`, `streetaddress1→street1`, `streetaddress2→street2`, `streetaddress3→street3`, `state`, `country`, `postalcode→postal_code`, `age`, `items` |
| Returned Shipments | sem `dyna_code`, tem `ordernumber` | `ordernumber→order_number`, `returndate→order_date`, `rma#`/`rma→rma`, `shipname→name`, `email`, `returneditems→items`, `restockeditems→restocked_items`, `damaged→damaged_items`, `reason`, `comments`; `dyna_code` recebe a constante sintética `"RETURNS"` para a dedupe por `(dyna_code, order_number)` continuar valendo |

Datas normalizadas para `YYYY-MM-DD` (objeto `Date` de planilha via UTC, serial
numérico via `XLSX.SSF`, ou string crua). A linha entra se tiver **qualquer** coluna
mapeada preenchida — `order_number` não é obrigatório. `source_file` = nome do
arquivo. `[SERVIDOR]` o parsing vira upload para a API na v2, mas **estes dois mapas
de colunas são o contrato com o fornecedor do arquivo e têm de ser preservados
literalmente**.

### 10.5 Distribuir (`AssignHeldOrdersDialog`)

Descrição literal: "Atribuir N pedido(s) em espera [de M cliente(s)]. Marque um ou
mais agentes — a divisão é por cliente: todos os pedidos em aberto de um mesmo
cliente ficam com o mesmo agente, e cliente que já está sendo atendido continua com
o agente dele. Apenas pedidos não concluídos são movidos."

Checkboxes dos agentes elegíveis (`role === "agent" && is_active &&
!auth_account_deleted`, no cliente); vazio "Nenhum agente disponível.". Prévia do
rateio calculada no cliente (round-robin): "{n} agente(s) — ~{base} cliente(s) cada
({extra} recebe(m) +1)". Botões "Cancelar" / "Distribuir" → "Distribuindo...".

Escrita: `manager_distribute_held_orders(p_order_ids, p_agent_ids)`.
(`manager_assign_held_orders` existe e **não é usada por esta tela** — `[DECISÃO]`.)

Toasts: sem agente → "Selecione ao menos um agente"; sucesso → "Pedidos
distribuídos" / "{moved} pedido(s) — {agente}: {n} · …" mais as notas opcionais "{n}
ficou(aram) com o agente que já atendia o cliente" e "{n} pedido(s) do mesmo cliente
foi(ram) junto"; erro → "Erro ao distribuir" + mensagem.

### 10.6 Exportar (`exportHeldOrders.ts`)

Gera `.xlsx` com **exatamente as linhas da tela, na mesma ordem** (o array `rows`
filtrado é o mesmo passado para a tabela e para o export — garantia explícita).

- Arquivo: `pedidos-em-espera[_status][_loja][_produto][_agente]_{aaaa-mm-dd em SP}.xlsx`
  (só os filtros ativos entram, slugificados).
- Aba única "Pedidos em Espera"; cabeçalho mesclado: "Pedidos em Espera" ·
  "Filtros — Status: … | Loja: … | Produto: … | Agente: … [| Busca: \"…\"] [| Inclui
  linhas repetidas]" · "Total de pedidos: {n}" · "Gerado em: {data/hora SP}".
- **27 colunas, nesta ordem:** Pedido · Pedidos mesclados · Loja · Produtos · Itens
  (arquivo) · RMA · Motivo · Data do pedido · Idade · Cliente · E-mail · Endereço ·
  Cidade · Estado · CEP · País · Agente · Situação · Status · Pendência ·
  Distribuições · Concluído em · Itens reestocados · Itens danificados · Comentários
  · Importado em · Arquivo de origem · ID do pedido.
- Zero linhas: "Nenhum pedido com os filtros aplicados".
- Toast: "Relatório gerado" / "{n} pedido(s) na planilha — exatamente os que estão
  na tela."; erro "Erro ao exportar" / "Não foi possível gerar a planilha."

`format.ts` fornece `heldOrderStoreLabel`, `parseReasons` (7 motivos conhecidos com
rótulo pt-BR; motivo desconhecido aparece como veio), `parseAddress` (deduplica
street1/2/3 e monta `oneLine`) e `parseItems`/`totalUnits` (regex
`^(.*?)(?:\s*[x×]\s*(\d+))?$`).

---

## 11. `/dashboard/base` — Base de Suporte (admin, só gestora)

**Arquivo:** `src/pages/DashboardBaseSuporte.tsx`. É o lado de escrita do que o
agente e o copy leem (seção 9 de `20-frontend-agente.md`). **Usa RLS direta, sem
RPC.**

Três abas com contagem: "Produtos (N)" · "Brands SMS (N)" · "Respostas SMS (N)".
**Uma única busca no topo** ("Buscar em produtos, brands e mensagens…") filtra as
três listas ao mesmo tempo, no cliente.

| Tabela | Colunas | Vazio |
|---|---|---|
| Produtos | Produto (nome + função) · Estrutura · Nicho · Links ("{n} extra(s)" ou "—") · Status ("Visível"/"Oculto") · Ações | "Nenhum produto encontrado." |
| Brands SMS | Brand · Nome no sistema · Estrutura · Número · Status · Ações | "Nenhuma brand encontrada." |
| Respostas SMS | Situação · Categoria · Texto (EN), truncado · Status · Ações | "Nenhuma mensagem encontrada." |

Sem paginação; carregando = 6 `Skeleton` por tabela. Botões "Novo produto" / "Nova
brand" / "Nova mensagem"; lápis edita no mesmo diálogo; lixeira confirma.

**Confirmação de exclusão** (texto que ensina o caminho certo — manter):
título `Excluir "{nome}"?`; corpo "A exclusão é definitiva e some na hora para todos
os agentes. Se a ideia é só tirar da tela por enquanto, feche isto e desative o item
na edição — assim ele volta depois sem precisar ser recadastrado."; "Cancelar" /
"Excluir". Toast: sucesso `"{nome}" foi excluído.`; erro "Não foi possível excluir."
+ mensagem.

### 11.1 `ProductFormDialog`

Descrição: 'Aparece no painel "Produtos (E-mail)" da Base de Suporte dos agentes.'

| Campo | Tipo | Obrigatório | Valores / placeholder | Padrão |
|---|---|---|---|---|
| Nome * | text | sim | "Ex: Presgera" | vazio |
| Função | text | não | "Ex: Neuropatia" | vazio |
| Página principal | text (url) | não | "https://…" | vazio |
| Estrutura * | select | sim | "Nova (lojas independentes)" / "Antiga (CartPanda / ClickBank / Digistore)" | `nova` |
| Plataforma | text | não | "Ex: CartPanda · BuyGoods" | vazio |
| Nicho | text | não | "Ex: Pain Relief" | vazio |
| Número de SMS | text | não | "Ex: 833-762-2450" | vazio |
| Página de bônus | text (url) | não | "https://…/bonus/" | vazio |
| Tipo de bônus | select | não | "Sem bônus" / "Bônus simples" / "Super bônus" | `nenhum` |
| Outras páginas de venda | lista dinâmica `{label, url}` com "Adicionar" e lixeira | não | — | vazia |
| Visível para os agentes | switch | — | — | ligado |

Validação: nome vazio → toast "O nome do produto é obrigatório." (destrutivo, sem
chamar a API). Link sem URL é descartado no envio. Botões "Cancelar" / "Salvar" →
"Salvando…". Toasts: "Produto atualizado." / "Produto criado."; erro "Não foi
possível salvar." com descrição **"Já existe um produto com esse nome."** quando a
mensagem contém `support_products_nome_uniq`, senão a mensagem crua.

### 11.2 `SmsBrandFormDialog`

Descrição: 'Aparece no painel "Produtos (SMS)" da Base de Suporte dos agentes.'
Campos: "Nome *" ("Ex: GlucoOff") · "Nome no sistema *" ("Ex: Integrated Center for
Wellbeing & Health", com a dica "Como a brand aparece no sistema de suporte — é o
que o agente confere antes de responder.") · "Estrutura *" · "Número de SMS"
("Ex: 844-526-1914") · "Visível para os agentes" (ligado).
Validação: nome ou sistema vazio → "Nome e nome no sistema são obrigatórios."
Toasts: "Brand atualizada." / "Brand criada."; erro + "Já existe uma brand com esse
nome." quando `support_sms_brands_nome_uniq`.

### 11.3 `SmsReplyFormDialog`

Descrição: 'Aparece no painel "Respostas SMS" da Base de Suporte dos agentes.'
Campos: "Categoria *" (text com `datalist` das categorias existentes, "Ex:
Atendimento Geral") · "Situação *" ("Ex: Localizar pedido / Pedir e-mail") ·
"Texto em inglês *" (textarea 4 linhas, "Hi (cliente), …") · "Texto em português *"
(textarea 4 linhas, "Olá (cliente), …") · "Visível para os agentes" (ligado).
Validação: qualquer vazio → "Preencha categoria, situação e os dois idiomas." /
"O agente alterna entre EN e PT no mesmo card — os dois textos são exigidos."
Toasts: "Mensagem atualizada." / "Mensagem criada."; erro + mensagem crua.

### 11.4 Escrita e cache

`from("support_products" | "support_sms_brands" | "support_sms_replies")` com
`insert`/`update` conforme o `id` e `.select().single()`; `delete().eq("id", id)`.
Cada mutação invalida a chave **base** (ex.: `["support-base","products"]`), o que
por correspondência parcial atinge as duas variantes `includeInactive: true/false`
de uma vez. `[MANTER]` o efeito; a v2 faz o equivalente com as chaves da API.

No cliente: `filtrar()` (busca nas três listas), `proximaOrdem()` =
`max(sort_order) + 1` para item novo, e o conjunto de categorias existentes para o
`datalist`. `[SERVIDOR]` os dois últimos.

---

## 12. `/dashboard/zendesk` — Zendesk (nav só gestora)

**Arquivo:** `src/pages/DashboardZendesk.tsx`. Usa o período global. **Todo o acesso
passa pela Edge Function `zendesk`** (`supabase.functions.invoke`), então o token do
Zendesk nunca chega ao browser. `[MANTER]` esse desenho: na v2 vira
`/api/v1/integrations/zendesk/*`.

> **Falha de guarda a decidir:** `/dashboard/zendesk` **não está** em
> `MANAGER_ONLY_PATHS`. O item de menu só aparece para a gestora, mas um
> `copy_grup` que digite a URL entra. `[DECISÃO]` — fechar ou abrir de propósito.

| Ação | Args | Query key | Cache |
|---|---|---|---|
| `status` | `from, to` | `["zendesk","status",from,to]` | `staleTime` 60 s, `refetchInterval` **5 min** |
| `tickets` | `status, group_id, q, from, to, page, per_page: 25` | `["zendesk","tickets",status,groupId,q,from,to,page]` | `staleTime` 60 s, `placeholderData` mantém a página anterior |
| `ticket` | `id` | `["zendesk","ticket",id]` | `staleTime` 30 s |
| `groups` | — | `["zendesk","groups"]` | `staleTime`/`gcTime` **60 min** |

Erro da função (payload `{error}` em pt-BR) é relançado como `Error`.

**Card "Status da integração":** "Conectado a **{subdomain}.zendesk.com** como
{account_name}{ (email) }. {total_tickets} tickets na conta inteira." ou o erro em
`destructive` (fallback "Não foi possível verificar a conexão."). Badge
"Conectado" / "Não conectado" / "Verificando…" e botão de refresh (refaz status +
tickets).

**Tiles clicáveis** (números **prontos da função**, não agregação de cliente):
"No período" (destaque; clicar limpa o filtro) + um tile por status
(`ZENDESK_STATUS_LABEL`: Novo · Aberto · Pendente · Em espera · Resolvido ·
Fechado).

**Filtros:** busca "E-mail do cliente, nº do ticket ou palavra do assunto…" com
**debounce de 500 ms** no cliente (e reset de página) · "Status" ("Todos os status"
+ os 6) · "Produto" ("Todos os produtos" + grupos do Zendesk). Trocar o período
global também volta para a página 1.

**Tabela:** `#` (id) · Cliente (nome + e-mail) · Assunto (+ tags concatenadas) ·
Produto (nome do grupo) · Canal · Status · Responsável · Criado · Atualizado (+
relativo) · **"Últ. ação do time"** (+ tooltip explicando a diferença em relação à
última resposta pública, + relativo) · link externo "Abrir ticket {id} no Zendesk".
Clique na linha abre o `TicketDetailSheet`. Vazio: "Nenhum tickets neste filtro."
**Paginação no servidor, `per_page: 25` fixo** (não configurável), botões "◀"/"▶" e
"{total} ticket(s) no filtro · página {page}".

**Painel "Como ler esta tela"** (`Collapsible`): 11 itens fixos explicando Cliente,
Produto, Canal, Status, Tags, Criado/Atualizado, Últ. ação do time, Última resposta
do time, Nota interna, Busca e Período. É copy estática, e é o que torna a tela
usável por quem não é do Zendesk — precisa ir junto. `[MANTER]`

**`TicketDetailSheet`** (drawer): ficha com Cliente · Produto · Canal (+ caixa que
recebeu) · Responsável · Criado em · Última atualização · **Última resposta do
time** (destacada) · Última mensagem do cliente · Última nota interna · "1ª resposta
em" · "Resolvido em" · Mensagens (total + quebra cliente/time/notas). Lista de tags
ou "Nenhuma tag." Seção "Conversa" (mais recente primeiro) com switch "Notas
internas ({n})" que filtra no cliente; cada mensagem tem badge Cliente / Nota
interna / Time, autor, data + relativo, canal, corpo e anexos com link. Vazio:
"Nenhuma mensagem neste filtro."

---

## 13. `/dashboard/lya` e `/dashboard/lya/cerebro` — a Lya

### 13.1 `/dashboard/lya` (manager + copy)

Chat de tela cheia (`LyaChat`). O contexto enviado em cada pergunta é o
`LyaContexto` do layout (período, agente filtrado, nome e role do usuário) com
`tela: "Lya (tela cheia)"`. `canTrain` (mostra o alternador "Treinar" no compositor)
só para `manager`.

Controles: barra de conversas (lista + "Nova conversa" + apagar por item),
compositor, 6 chips de sugestão (Atendimentos · Reembolsos · Interações · Alertas ·
Pedidos em espera · Time), alternador "Treinar", e avisos em linha ("Não foi
possível salvar esta conversa no histórico…" e os avisos vindos do stream).

Rodapé fixo (texto de produto, mantém): "A Lya responde só com o que está no painel,
no banco e na Base de Suporte, e diz de onde tirou cada número…" e "A Lya pode
cometer erros. Confira informações importantes na tela correspondente."

Transporte: Edge Function `lya` por **`fetch` cru** (não `functions.invoke`) em
`${VITE_SUPABASE_URL}/functions/v1/lya`, `action: "chat"` em **SSE** (eventos
`tokens`, `tool`, `chart`, `memoria`, `aviso`, `revisao`, `error`, `done`); mais
`action: "ping"` e `action: "memoria_salvar"`. RPCs: `lya_list_chats`
(`["lya","chats"]`), `lya_get_chat` (`["lya","chat",id]`), `lya_save_chat`,
`lya_delete_chat`. **O id da conversa nasce no cliente** (UUID v4) e o salvamento
usa fila/substituição no cliente para preservar a ordem. `[BACKLOG — B23]` — o
streaming SSE é a única rota do sistema que não se encaixa no envelope do contrato
§3, e está no backlog com status "emenda pendente".

### 13.2 `/dashboard/lya/cerebro` (só gestora)

Duas abas: **"Grafo"** (`LyaBrainGraph`, força-dirigido estilo Obsidian, com
**polling de 4 s só nessa aba**) e **"Treinar"** (`LyaTreinar`). Faixa `ticker` no
topo (`LyaCerebroTicker`) com métricas **todas derivadas no cliente** da lista de
memórias: total, treinadas hoje, conexões, "mais conectada", contagem por tipo, tags
únicas e último treino. `[SERVIDOR]`

Grafo: busca · filtro por tipo (Preferência · Sobre a Lya · Projeto · Referência ·
Nota) · "Ajustes" (forças e exibição, persistido em
`localStorage["lya-grafo-ajustes"]`) · "Enquadrar tudo" · "Reorganizar" · botão
flutuante "Ensinar algo novo" · painel lateral com o detalhe da memória ("Editar" /
"Apagar") ou "Últimos treinos" · botão "Remover exemplos" (só quando há memórias de
semente) com confirmação "Remover as memórias de exemplo?" / "Apaga só o que veio
marcado como exemplo. Tudo que você ensinou à Lya continua. Não dá para desfazer." e
toast "{n} memória(s) de exemplo removida(s)."

Treinar: formulário "Ensinar algo novo à Lya" / "Editar memória" (descrição; Tipo em
chips **Automático** / Preferência / Sobre a Lya / Projeto / Referência / Nota;
Detalhe em textarea; Tags) e botão "Ensinar à Lya" / "Salvar alterações". Lista com
busca e chips de filtro, cada card com "Editar" / "Apagar" (confirmação em linha
"Apagar? Sim/Não"). Painel colapsável "Como treinar a Lya" com exemplos e passo a
passo.

RPCs: `lya_list_memories` (`["lya","memories"]`), `lya_delete_memory`,
`lya_delete_seed_memories`; a gravação passa pela Edge Function (`memoria_salvar`,
que classifica e enriquece). Toasts: "Memória removida." / "Não consegui remover." ·
"Memória atualizada · {tipo}" ou "A Lya aprendeu: \"{descrição}\" · {tipo}" /
"Não consegui salvar."

---

## 14. `/copy` — área do time de copy

**Layout:** `src/layouts/CopyLayout.tsx` · **Página:** `src/pages/copy/CopyMotivos.tsx`
· **Quem vê:** `canAccessArea(role, "copy")` → `manager` e `copy_grup`.

### 14.1 `CopyLayout` e `ProdutosLayout`

Os dois são o mesmo molde, com o mesmo guard (sessão → `me_status` → `profiles` →
`canAccessArea`) e o mesmo `OutletContext` (`{userId, fullName, range, setRange,
fromISO, toISO}`):

| | CopyLayout | ProdutosLayout |
|---|---|---|
| Área | `copy` | `produtos` |
| Título da sidebar | "Painel do Copy" / "Conteúdo" | "Painel de Produtos" / "Produtos" |
| Navegação (1 item) | "Motivos de reembolso" → `/copy` | "Visão geral" → `/produtos` |
| Período padrão | **últimos 90 dias** (hoje − 89) | **últimos 90 dias** |
| `localStorage` do recolhido | `copy-sidebar-collapsed` | `produtos-sidebar-collapsed` |
| Rodapé | "Sair" + "Logado como {fullName}" | idem |

Ambos têm `AreaSwitcher`, `DateRangePicker` e `ThemeToggle` fixo; **nenhum** tem
exportação de relatório nem sino. `handleLogout` idêntico ao das outras áreas.

### 14.2 `CopyMotivos` — Motivos de reembolso

Cabeçalho "Motivos de reembolso" + "Olá, {fullName}", com subtítulo explicando que
entram **só reembolsos concluídos** no período e que a comparação usa o período
anterior de mesma duração.

**Fonte:** `copy_refund_reason_analytics(from_date, to_date, product_filter,
platform_filter, channel_filter)`, chave `["copy","refund-analytics",{…}]`,
`staleTime` 5 min, **sem `refetchInterval`** ("não é tela de tempo real" —
comportamento correto, serve de modelo).

**Filtros ("Recorte"):** Produto · Plataforma · Canal, **cada um populado por
`data.filters.*`**, ou seja pela própria RPC (não pelo cliente, ao contrário de
`/dashboard/reembolsos`). Botão "Limpar" quando há filtro. Um `useEffect` devolve o
filtro para "all" quando o valor escolhido desaparece do novo período — evita filtro
fantasma. `[MANTER]`

**Vazio:** "Nenhum reembolso concluído neste recorte" com dica para ampliar o período
ou limpar filtros (+ contagem de "em aberto" quando houver). **Erro:** card "Não foi
possível carregar os motivos" com a mensagem do Supabase e botão "Tentar de novo" —
é o padrão que a v2 generaliza.

**Cinco KPIs, todos prontos da RPC** (o cliente só formata): "Reembolsos
concluídos" (+ Δ do período anterior, com seta ↑/↓/— e sinal explícito) · "Valor
devolvido" (+ % dos pedidos) · "Ticket médio do pedido" (+ retenção %) · "Motivo
declarado" (% de cobertura + quantidade sem motivo real) · "Tempo até a baixa"
(mediana em dias + quantidade em aberto).

**Tabela "Mix de motivos"** (clique na linha abre a evidência): Motivo (+ badge
"sem motivo declarado" para "Outros" e "Follow up (sem motivo declarado)") ·
Participação (`ShareBar`) · Share % · Reembolsos · **Δ vs anterior** (p.p., com
seta) · Valor devolvido · % devolvido · Até a baixa (dias). Sem paginação.

**"Evolução do mix, mês a mês"** (`MixEvolutionPanels`): **small multiples de
linha** — um painel por categoria, para as **4 maiores** (slice no cliente); eixo X
= mês ("jan/26"), eixo Y = participação % com domínio compartilhado 0–`yMax`
(`ceil((max+5)/10)*10`, teto 100, calculado no cliente), série = `share` mensal de
`data.reason_monthly`; tooltip "{share}% · {n} reembolso(s)"; cada painel mostra Δ
p.p. desde o primeiro mês. Período de um único mês → "O período selecionado cobre um
único mês — escolha um intervalo maior para ver a evolução do mix." (sem gráfico).
**Small multiples de uma cor é decisão de acessibilidade registrada no projeto**
(4+ séries `--chart-*` são indistinguíveis em protanopia). `[MANTER]`

**Tabela "Produtos que mais devolvem":** Produto · Volume (`ShareBar`) ·
Reembolsos · Share % · Valor devolvido · % devolvido · Motivo dominante (+ share).
Cliente faz `slice(0,12)` e calcula a escala das barras. `[SERVIDOR]`

**Tabela "Sinais de copy"** — a mais analítica da tela e **hoje 100% no cliente**
`[SERVIDOR]`: sobre `data.reason_by_product`, filtra `n >= 8` (`LIFT_MIN_N`) e
`lift >= 1.3` (`LIFT_MIN`), exclui motivos não declarados, ordena por lift desc e
corta em 12. Colunas: Produto · Motivo · Reembolsos · "No produto"
(`share_in_product`) · "Média geral" (`baseline_share`) · **"Índice"** (lift com 2
decimais + "×"). Clique abre a evidência. Vazio: "Nenhum produto concentra um motivo
acima da média neste recorte — o mix de motivos está parecido entre os produtos."

**Duas listas lado a lado:** "Plataforma de venda" e "Canal de atendimento", cada
linha com `ShareBar` (escala = `max(n)` do próprio grupo, no cliente) e
"{n} ({share}%)".

**`ReasonEvidenceModal`** (abre ao clicar num motivo): título = o motivo; aviso de
privacidade **"Sem e-mail, número de pedido ou nome de agente: a tela do copy é
agregada de propósito."** `[MANTER]` — é regra de privacidade, não estilo. Três
cartões (Reembolsos no motivo / Com algum texto no motivo / Texto escrito à mão);
quando `texto_livre === 0`, caixa explicando que o motivo é 100% menu suspenso (com
o corte de maio/2026 para texto livre); tabela "Texto registrado no motivo" (Texto +
badge "rótulo padrão" quando é o próprio rótulo / Reembolsos / Share);
"Palavras mais frequentes no texto escrito à mão" (chips com `ShareBar`); e as duas
listas "Produtos com mais casos deste motivo" e "Canal de atendimento".
Fonte: `copy_refund_reason_evidence(from_date, to_date, reason_category,
product_filter, platform_filter, channel_filter, max_rows: 25)`, chave
`["copy","reason-evidence",{…}]`, `enabled` só com categoria, `staleTime` 5 min.

`ShareBar` não é gráfico: é barra dentro da célula, `value/max*100` limitado a
0–100, cor fixa `--chart-2`.

Formatação (`src/features/copy/format.ts`): `fmtInt`, **`fmtMoney` em USD sem
conversão** (`refunds.refund_value` já é dólar), `fmtPct`, `fmtSigned` (com + / −
explícito), `fmtDays`, `fmtMonth`, `fmtISODate` — todos com `—` para nulo.

> Esta tela já estava certa e virou a referência: `[DECIDIDO — D4]` todo valor é
> dólar, e o lado da gestora foi corrigido para bater com ela (§3.6).

---

## 15. `/produtos` — área do time de produtos

**Arquivo:** `src/pages/produtos/ProdutosVisaoGeral.tsx` · **Quem vê:** só
`role = "produto"` (área exclusiva; nem a gestora entra).

Tela **intencionalmente vazia**. Cabeçalho "Produtos" + "Olá, {fullName}" +
"Área do time de produtos. Ainda sem indicadores — em construção." Bloco central
tracejado: ícone de pacote, "Nada por aqui ainda", "As primeiras telas do time de
produtos entram nesta área." Zero formulário, zero tabela, zero chamada ao
Supabase. `[MANTER]` como placeholder — é uma área real com conta de teste em
produção.

---

## 16. Login, `/`, seleção de área, bloqueado, 404

### 16.1 `/login` — `Login.tsx`

Textos: "Bem-vindo de volta" / "Faça login para continuar".

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|---|---|
| Email | `email` | sim | placeholder "seu@email.com" |
| Senha | `password` | sim | `minLength = 6`, placeholder "••••••••" |

Botão "Entrar" → "Carregando...". Escrita:
`supabase.auth.signInWithPassword({email, password})`.

**Validação no cliente:** `navigator.onLine === false` → toast "Sem conexão" /
"Você parece estar offline. Verifique sua internet e tente novamente." **sem chamar
a API**.

**Healthcheck próprio:** `fetch("${VITE_SUPABASE_URL}/auth/v1/health")` com timeout
de 5 s no mount. Falhando, mostra um banner âmbar **antes** de a pessoa tentar
entrar: "Não conseguimos alcançar o servidor." + "Sua rede está bloqueando o acesso.
Desative VPN/antivírus, troque o DNS para 1.1.1.1 ou 8.8.8.8, ou tente em outra rede
(ex.: 4G do celular)." `[MANTER]` — isto existe porque aconteceu de verdade.

**Redirecionamento (`redirectUser`)**: `me_status` → `!is_active` → `signOut` local
+ `/blocked`. Senão `profiles.role` → `record_auth_event("login")` (best-effort, não
bloqueia) → `navigate(homePathForRole(role))` (**sem `replace`**). Falha ao ler o
perfil → toast "Erro" / "Não foi possível carregar o perfil do usuário."
Também escuta `onAuthStateChange` (`SIGNED_IN`) e verifica sessão existente no mount.

**Toasts:** sucesso "Bem-vindo!" / "Login realizado com sucesso."; erro de rede →
título "Falha de conexão" e descrição literal **"Não conseguimos conectar ao
servidor. Verifique sua internet, desative VPN/antivírus/extensões e tente
novamente. Se persistir, troque o DNS da sua rede para 1.1.1.1 ou 8.8.8.8."**; erro
comum → "Erro" + `error.message` (fallback "Ocorreu um erro durante a
autenticação."). `isNetworkError()` detecta por
`failed to fetch|network|load failed` na mensagem, ou `name` igual a
`AuthRetryableFetchError`/`TypeError`.

### 16.2 `/` — `Index.tsx`

Só redireciona: `getSession()` → sem sessão vai para `/login` (com `signOut` local
apenas quando houve erro); com sessão lê `profiles.role` (erro → `signOut` +
`/login`) e vai para `homePathForRole(role)` com `replace`. Mostra "Carregando...".

### 16.3 `/areas` — `AreaSelect.tsx`

`getSession()` → `me_status` (bloqueado → `/blocked`) → `profiles(role, full_name)`
→ **se `!hasAreaChoice(role)` redireciona direto** para `homePathForRole(role)`, sem
mostrar a tela. Senão mostra um card por área de `areasForRole(role)`, na ordem do
mapa, e lê `localStorage["xmx-last-area"]` para marcar "última usada".

| Card | Bullets |
|---|---|
| Data Analytics do Suporte | Atendimentos e canais · Reembolsos e motivos · Acompanhamento semanal · Interações e follow-ups |
| Área de Copy | Motivos de reembolso · Palavras do cliente · Recortes por produto e canal |
| Área de Produtos | — |
| Meus Atendimentos | — (nunca aparece: agente não tem escolha) |

Clicar grava `localStorage["xmx-last-area"]` e navega com `replace`. Textos: "Olá,
{primeiro nome}" ou "Bem-vindo de volta"; "Escolha a área que você quer acessar
agora."; badge "última usada"; "Entrar" em cada card; rodapé "Você pode trocar de
área depois pelo menu lateral, sem sair da conta." + "Sair da conta".

### 16.4 `/blocked` — `Blocked.tsx`

No mount faz `signOut({scope:"local"})` (silencioso) e limpa as chaves `sb-*`.
**Texto único:** "O acesso ao sistema foi bloqueado para este usuário." **Sem nenhum
botão** — nem "voltar ao login". `[DECISÃO]` — a pessoa desativada por engano fica
sem caminho.

### 16.5 `*` — `NotFound.tsx`

Sem chamada ao Supabase. Faz `console.error("404 Error: User attempted to access
non-existent route:", pathname)`. Textos "404" / "Oops! Page not found" / link
"Return to Home" (`href="/"`). **É o único texto em inglês do app** — sobra do
template. `[DECISÃO]` traduzir.

### 16.6 `AreaSwitcher`

`src/components/layout/AreaSwitcher.tsx` — bloco de sidebar reutilizado pelos três
layouts. Só renderiza quando existe alguma área além da atual (ou seja, só para
`manager` e `copy_grup`; para `agent` e `produto` devolve `null`). Expandido:
"Área atual" + nome curto + um botão por área alternativa ("Ir para {área}", ícone
`ArrowLeftRight`). Recolhido: só ícones com tooltip. Clicar grava
`localStorage["xmx-last-area"]` e navega **sem `replace`** (mantém histórico).
Nenhuma chamada de rede.

---

## Lacunas

O que estas áreas precisam e a linha de base de rotas (contrato §7) não cobre.

1. ~~**Acompanhamento semanal.**~~ **`RESOLVIDA` por D3:** a rota é
   `GET /metrics/compliance`, com metas e faixas em configuração datada. O formato
   que a tela consome está especificado em §4.4. O que resta de aberto é menor e
   está lá: se os 4 KPIs do topo vêm na resposta ou continuam somados no front.
2. **Estatística da tendência temporal.** `GET /metrics/dashboard` não devolve
   `slope`, `intercept`, `r2`, média móvel nem projeção. Hoje é tudo regressão no
   browser.
3. **Padrão de horários.** `GET /metrics/hourly` cobre a matriz, mas não está dito
   que devolve `peak`, `shift.start_hour`/`end_hour`, `goal_hit` e `shifts_share` —
   que é o que a tela mostra.
4. **Opções de filtro (facetas).** `/dashboard/reembolsos` monta os selects de tipo
   e produto **do próprio resultado**, e `/dashboard/usuarios` → Pedidos em Espera
   monta o select de produto do SKU. As rotas precisam devolver facetas (valor +
   contagem) ou existir uma rota de opções.
5. **Comparação com o líder.** O KPI "Distância do líder" hoje faz uma **segunda**
   chamada de métricas sem filtro de agente. `GET /metrics/dashboard` deveria trazer
   o benchmark junto quando um agente está filtrado.
6. **Contas de teste.** O front esconde agentes por **nome** (`"geovani"`,
   `"agente teste"`). A v2 precisa de um campo no perfil (ex.: `isTestAccount`) e de
   um parâmetro de rota para incluir/excluir. **Adiado: item B20 do
   `90-BACKLOG.md`** — a lista atual precisa ser conferida para não esconder alguém
   real, e a discussão fica lá.
7. **Usuários.** `users` está na linha de base, mas não estão nomeados: listagem com
   presença e contagem de tickets em aberto (e a contagem de "autorizados"),
   alternar `is_active`, alternar `is_available` (de folga), **excluir a conta de
   login preservando histórico** (com confirmação por e-mail), listar tickets em
   aberto de um agente, e redistribuir tickets em lote.
8. **Pedidos em espera (gestora).** "CRUD + importação + distribuição" não cobre:
   resumo por agente, marcação de duplicata (`duplicate_of`), o resultado detalhado
   da importação (`inserted` / repetidos / linhas vazias / lista dos repetidos), e o
   rateio **por cliente** da distribuição, com o retorno que a tela usa para o toast
   ("ficou com quem já atendia", "pedido do mesmo cliente foi junto").
9. **Aprovação de tomada de ticket.** `POST /takeovers/:id/approve|reject` existe;
   falta a rota de listagem para o sino da gestora
   (`manager_takeover_notifications`).
10. **Alertas de reembolso.** Falta a rota de `manager_refund_alerts` (a lista
    agrupada por agente **e** o `total_overdue` que alimenta o badge da sidebar) e a
    de "dar baixa em nome do agente" (`manager_complete_refund`), que é diferente de
    `POST /refunds/:id/complete` porque registra quem deu a baixa.
11. **Base de Suporte (escrita).** "escrita para gestora" precisa nomear o CRUD das
    três coleções (produtos, brands SMS, respostas SMS) com `ativo` e `sort_order`,
    e o conflito de nome único (`support_products_nome_uniq`,
    `support_sms_brands_nome_uniq`) precisa de **código de erro próprio** — hoje o
    front procura a string do índice dentro da mensagem do Postgres.
12. **Zendesk.** `integrations /zendesk/*` precisa enumerar as 5 ações atuais
    (`status`, `tickets`, `ticket`, `groups`, e a que o pré-preenchimento do agente
    usa) e manter a paginação própria do Zendesk, que **não** é keyset.
13. **Lya.** Faltam as rotas de histórico de conversa e de memórias do cérebro. O
    streaming em si (o chat é **SSE**, não JSON, e não cabe no envelope do §3) é o
    item **B23** do `90-BACKLOG.md`, com status "emenda pendente": precisa de
    exceção escrita no contrato antes da implementação do módulo de integrações.
14. **Repetições no mesmo dia.** `dashboard_same_day_repeats` não tem rota na linha
    de base, e o componente que a consome não é renderizado — item **B19** do
    `90-BACKLOG.md`. Com **D1**, se ele for religado o KPI "Furaram a regra das 18h"
    perde o referente: não existe mais regra para furar. A marcação
    `is_same_day_repeat` **continua** no banco (é o que evita contar a conversa duas
    vezes na métrica), então a seção continua tendo o que mostrar — só precisa de
    outro nome e outro texto.
15. **Exportações.** O módulo `exports` precisa nomear: relatório do gestor (várias
    abas), detalhe de motivo de reembolso (o conjunto inteiro, não a página),
    pedidos em espera (27 colunas), "Meus Atendimentos" e Radar do agente.
16. **Auditoria.** `GET /audit` está na linha de base; falta dizer que existem
    **duas** (interações e reembolsos), as duas paginadas, com ordenação fixa.
17. ~~**Contagem total.**~~ **`RESOLVIDA` por D7:** as cinco tabelas continuam
    mostrando "Página {p} de {t} • {n} registros", e o §3 do contrato foi emendado —
    `totalCount` é devolvido nelas. O total é contado sobre a tabela de fatos e
    guardado em cache por combinação de filtro, de modo que trocar de página não
    reconte. O diagnóstico antigo estava incompleto: o custo não era o `OFFSET`, era
    o predicado de data em texto que ele percorria.

## Propostas de emenda

### 1. Regra de negócio dentro de componente React — o pior caso do sistema

`DashboardAcompanhamento.tsx` decide, em código de interface, quem entra em risco de
**não renovação de contrato**: metas por canal, três faixas de classificação,
conversão de 2 alertas em 1 advertência e o corte em 3 advertências. Nada disso
existe em tabela ou RPC. Qualquer pessoa que edite o componente muda a avaliação de
desempenho do time, e não há histórico da regra que valia numa data.

**`ACEITA` por `00-CONTRATO.md` §8-A, D3.** A funcionalidade é preservada inteira e
migra para `GET /metrics/compliance`; as metas e faixas viram **configuração com
vigência**, com valores iniciais idênticos aos de hoje para que o corte não mude a
avaliação de ninguém. Como a tela fica sem a lógica dentro dela está em §4.4.
Ganho registrado: a política passa a ter histórico e deixa de mudar por deploy de
front.

### 2. Polling que o contrato §4 proíbe, e o custo real

Levantamento do que existe hoje nesta área:

| Onde | Intervalo |
|---|---|
| `/dashboard/reembolsos` — métricas **e** auditoria | 15 s |
| `/dashboard/usuarios` — `manager_list_users` | 15 s |
| `ManagerApprovalsBell` | 30 s |
| `NotificationsBell` (agente) | 30 s |
| `/dashboard/alertas` | 60 s |
| `/dashboard/lya/cerebro` — grafo | **4 s** |
| `/dashboard/zendesk` — status | 5 min |
| os quatro layouts — `getUser` + `me_status` + heartbeat | 30 s |

Num `t4g.micro` que já caiu por CPU. Concordo com a direção do contrato e proponho
que o corte do polling seja **critério de aceite da v2**, não melhoria posterior:
uma verificação automática que falha se `refetchInterval` ou `setInterval` de rede
aparecer em `apps/web`.

### 3. Duas autoridades de permissão dentro da mesma área

Hoje há o guard por **área** (`canAccessArea`) e uma **lista de strings**
(`MANAGER_ONLY_PATHS`) dentro do `ManagerLayout`. A consequência já apareceu:
`/dashboard/zendesk` ficou fora da lista, o item de menu esconde mas a URL não
barra. Emenda: na v2 a capacidade exigida é declarada **na definição da rota** (um
campo por rota, verificado por um único componente de guarda), e a API recusa de
novo com `403`. Nenhuma lista de caminhos solta em layout.

### 4. Moeda: escolher uma verdade

**`RESOLVIDO` por `00-CONTRATO.md` §8-A, D4.** A emenda foi aceita: todo valor é
dólar, o legado já foi corrigido nos dois pontos (§3.6), e na v2 a API devolve
`{ amount, currency }` com `currency` fixo em `"USD"`, formatado no front pela moeda
recebida. Fica registrada porque o motivo continua valendo como regra de desenho:
**moeda é dado, não rótulo** — nenhuma tela escolhe a moeda por conta própria.

### 5. O nome da gestora está no código

`setFullName(role === "manager" ? "Ester" : full_name)`. Emenda: `GET /me` devolve
`fullName`, e a saudação usa o que vier. Trivial, mas é dado de pessoa em literal de
código.

### 6. Padronizar a leitura de erro (e é pré-requisito do contrato §3)

A maioria das telas faz `error instanceof Error ? error.message : "fallback"`, o que
**nunca** captura o `code` do Postgres — o erro do `supabase-js` não é instância de
`Error`. Só o módulo `copy` acerta (`src/lib/supabaseError.ts`). Como o contrato §3
manda o front reagir ao `code`, a v2 precisa de **um** cliente HTTP que devolva
`{code, message, details}` tipado, e de um mapa `code → texto pt-BR` (ver
`23-frontend-estrutura.md`). Sem isso, "o front escolhe o texto a partir do código"
não acontece na prática.

### 7. Telas que dependem de cálculo em memória nesta área

| Hoje | O que se perde | Substituição |
|---|---|---|
| Filtros de `/dashboard/usuarios` (busca + status) sobre a lista inteira | filtro instantâneo em ~30 usuários | a lista é pequena: manter uma rota sem paginação e filtrar no cliente é aceitável aqui. `[DECISÃO]` |
| `/dashboard/alertas` filtra agentes no cliente | idem | idem |
| Pedidos em Espera: busca textual, filtro "Sem agente" e filtro de produto | filtro sem ir ao servidor, e o **export que bate com a tela** | parâmetros na rota + facetas; e o export passa a ser do servidor recebendo **os mesmos filtros** — é a única forma de manter a garantia "a planilha é o que está na tela" |
| "Sinais de copy" (lift) | a tabela inteira | a RPC passa a devolver `lift` já filtrado por `n >= 8` e `lift >= 1.3`, com os limiares como parâmetro |
| `ChannelDetailModal` com período próprio | analisar um recorte sem mexer no filtro global | manter: é estado de interface (§6) |
| Ticker do Cérebro da Lya | 7 números | a rota de memórias devolve o resumo |

### 8. Duas peças que já estão certas e devem ser o modelo

Vale registrar, porque a v2 tende a nivelar tudo por baixo:

- **`ChannelEfficiencyCard`** não recalcula nada: recebe taxas e participações
  prontas e só decide o que mostrar (inclusive a regra de só escrever o rótulo em
  segmento `>= 12`).
- **`CopyMotivos`** tem as opções de filtro vindas da própria resposta
  (`data.filters`), não tem polling, tem estado de erro com "Tentar de novo", e tem
  aviso de privacidade explícito. É o padrão de tela de análise da v2.

> **Propostas de remoção** (exigidas pelo contrato §8) estão consolidadas numa
> única lista em `22-frontend-mapa-api.md`, no fim do arquivo — junto com a
> evidência de cada item. A decisão é do dono do projeto.
