# Frontend v2 — estrutura de `apps/web` e convenções

> Trilha: **frontend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Este documento define como `apps/web` é organizado e quais regras valem para
> quem escreve código nele. É o par de `13-backend-estrutura.md`.
>
> Data: 26/09/2026.
>
> **Reconciliado com `00-CONTRATO.md` §8-A.** Decisões que mudaram este documento:
> **D1** (não existe mais `FOLLOW_UP_BLOCKED` — a regra das 18h deixou de bloquear),
> **D3** (a avaliação disciplinar ganha componentes próprios em `features/metrics/`),
> **D4** (moeda é dado: `{ amount, currency }`) e **D7** (a paginação numerada
> continua existindo, então o componente de paginação não é só cursor).

---

## 1. Árvore de pastas

```
apps/web/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── components.json                  # shadcn/ui: style default, base slate, sem prefixo
├── public/
│   └── sounds/
│       ├── clap.mp3                 # meta diária batida
│       ├── whoosh.mp3               # check-in de 2h
│       └── notify.mp3               # sino
└── src/
    ├── main.tsx                     # monta o App, nada mais
    ├── app/
    │   ├── App.tsx                  # providers + <Routes>
    │   ├── routes.tsx               # a árvore de rotas, com a capacidade exigida por rota
    │   ├── providers.tsx            # QueryClient, Theme, Tooltip, Toaster, SessionProvider
    │   └── query-client.ts          # defaults do TanStack Query, com o comentário do incidente
    ├── lib/
    │   ├── api/
    │   │   ├── client.ts            # o ÚNICO ponto de rede
    │   │   ├── errors.ts            # ApiError + mapa code → texto pt-BR
    │   │   ├── idempotency.ts
    │   │   └── realtime.ts          # canais user:{id} e managers → invalidação
    │   ├── auth/
    │   │   ├── supabase.ts          # cliente do Supabase Auth (só auth)
    │   │   └── session.ts           # SessionProvider + useSession()
    │   ├── format/                  # data, moeda, número, plural, tempo relativo
    │   ├── time.ts                  # helpers de fuso (America/Sao_Paulo) para EXIBIÇÃO
    │   └── utils.ts                 # cn()
    ├── components/
    │   ├── ui/                      # shadcn/ui — rastreado no repo, editável
    │   ├── feedback/                # QueryBoundary, ErrorState, EmptyState, Skeletons
    │   ├── data/                    # DataTable, NumberedPager, CursorPager, FilterBar
    │   ├── charts/                  # wrappers de recharts + tokens + paleta
    │   └── layout/                  # AppShell, Sidebar, SidebarNavItem, AreaSwitcher, ThemeToggle
    ├── features/
    │   ├── tickets/
    │   ├── interactions/            # ou dentro de tickets/ — ver §3
    │   ├── refunds/
    │   ├── radar/
    │   ├── held-orders/
    │   ├── transfers/
    │   ├── takeovers/
    │   ├── notes/
    │   ├── support-base/
    │   ├── training/
    │   ├── metrics/                 # inclui o Acompanhamento (D3): ComplianceTable,
    │   │                            # ComplianceWeekBadge, ComplianceAgentChart,
    │   │                            # ComplianceRules, useComplianceQuery
    │   ├── users/
    │   ├── copy-analytics/
    │   ├── zendesk/
    │   └── lya/
    ├── areas/
    │   ├── workspace/               # rotas do agente (/workspace/*)
    │   ├── analytics/               # rotas da gestora (/dashboard/*)
    │   ├── copy/                    # /copy
    │   ├── produtos/                # /produtos
    │   └── public/                  # /, /login, /areas, /blocked, 404
    └── styles/
        └── index.css                # tokens de tema (claro e escuro)
```

### O que muda em relação a hoje, e por quê

| Hoje | v2 | Motivo |
|---|---|---|
| `src/pages/` com `Dashboard*.tsx` soltos na raiz | `src/areas/<área>/` | hoje não se sabe, pelo caminho, se uma página é da gestora ou do copy; `DashboardBaseSuporte.tsx` e `pages/agent/BaseSuporte.tsx` são o mesmo assunto em dois lugares |
| `src/layouts/` separado das páginas | o layout mora na área que ele serve | o layout **é** a área: publica o contexto, define os filtros globais e a navegação |
| `src/integrations/supabase/` com `types.ts` gerado de 1369 linhas | `packages/contract` (tipos da API) + `lib/auth/supabase.ts` (só auth) | o front deixa de conhecer o schema do banco; é o que torna a separação real (contrato §1) |
| catálogo de produtos duplicado em 3 arquivos | um lugar só (ver §4) | a mesma lista de 75 produtos existe em `Atendimentos.tsx`, `EditServiceDialog.tsx` e `refunds/types.ts`; a de plataformas existe em duas versões **divergentes** |
| `lib/reportExport.ts` de 921 linhas no cliente | nada: exportação é do servidor | tira `xlsx` do bundle |

**Nota ao documento de arquitetura.** Ele diz "estrutura de pastas fica". A trilha
concorda com o espírito (a organização por feature já existe e funciona) e **não**
propõe reinventá-la — mas o dono do projeto pediu separação e organização de cada
funcionalidade, e há três problemas concretos que "fica como está" preserva:
literal de domínio duplicado, página de 1397 linhas com regra de negócio dentro, e
`pages/` misturando quatro áreas. A proposta acima é a menor mudança que resolve os
três. Ver "Propostas de emenda" §1.

---

## 2. Regra de dependência

Herdada do contrato §1 e endurecida dentro de `apps/web`:

```
areas/*  ──>  features/*  ──>  components/*, lib/*  ──>  packages/contract
```

- `areas/*` compõe. Não tem hook de rede, não tem regra, não tem literal de domínio.
- `features/*` é dona do seu domínio: hooks, diálogos, formulários, tipos de
  interface.
- `components/*` e `lib/*` não sabem o que é um ticket.
- Ninguém importa de `apps/api` nem de `packages/db` (contrato §1).

### Por que não pode haver import cruzado entre features

`features/a` **nunca** importa de `features/b`. Cada feature expõe uma API pública:

```
features/tickets/
├── index.ts                 # a API pública — a ÚNICA porta
├── api/                     # hooks de query e mutation
├── components/              # o que outras features podem usar (exportado pelo index)
├── internal/                # o que ninguém de fora pode tocar
└── model/                   # tipos de interface do domínio
```

`index.ts` exporta um punhado de coisas nomeadas e nada mais:

```ts
export { useTicketsQuery, useTicketQuery, useCreateTicketMutation } from "./api";
export { StatusTrackingDialog, TicketStatusBadge } from "./components";
export type { Ticket, TicketStatus } from "./model";
```

Três razões, todas com cicatriz no código de hoje:

1. **Ciclo real.** `features/services` importa `features/agent/check-in`
   (`emitAgentInteraction`) e `features/agent` importa métricas que dependem de
   serviços. Isso é um ciclo, e ele existe porque não há porta: qualquer arquivo
   importa qualquer arquivo por caminho profundo.
2. **Mudança que vaza.** `StatusTrackingDialog` é usado por três telas de duas
   features. Hoje quem mexe nele não tem como saber quem depende. Com `index.ts`, o
   que é público é uma lista curta e revisável.
3. **Divisão de bundle.** Só é possível separar recharts (ou o grafo da Lya) em
   pedaço próprio se a fronteira do import for previsível. Import profundo arrasta
   módulos junto.

**Como isso é verificado, e não só combinado:** regra de ESLint
(`import/no-restricted-paths` ou `no-restricted-imports` com padrão
`@/features/*/!(index)`), falhando o CI. Combinação sem verificação vira comentário
em PR e depois vira exceção.

Quando duas features precisam do mesmo pedaço, ele **sobe** para `components/` ou
`lib/` — não atravessa de lado.

---

## 3. Padrão dos hooks de query e mutation

Um arquivo por recurso em `features/<x>/api/`, sempre sobre o cliente tipado.

```ts
// features/tickets/api/useTicketsQuery.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { TicketListParams, TicketListResponse } from "@repo/contract";

export const ticketKeys = {
  all: ["tickets"] as const,
  list: (p: TicketListParams) => [...ticketKeys.all, "list", p] as const,
  detail: (id: string) => [...ticketKeys.all, "detail", id] as const,
  interactions: (id: string) => [...ticketKeys.all, "interactions", id] as const,
};

export function useTicketsQuery(params: TicketListParams) {
  return useQuery({
    queryKey: ticketKeys.list(params),
    queryFn: ({ signal }) => api.get<TicketListResponse>("/tickets", { params, signal }),
  });
}
```

Regras, cada uma existindo por causa de algo que aconteceu:

1. **Chaves em um objeto `<recurso>Keys` exportado pela feature.** Hoje as chaves são
   strings escritas à mão em 20 arquivos (`["services","me",daysBack]`,
   `["service-follow-ups"]`, `["dashboard","refunds","audit",{…}]`) e a invalidação
   depende de alguém acertar a string. Chave errada = tela que não atualiza.
2. **`queryFn` recebe e repassa o `signal`.** Nenhuma query de hoje repassa; trocar
   de filtro rápido deixa requisições obsoletas em voo.
3. **Proibido `const { data = [] }`.** É literalmente a causa do incidente de julho
   (contrato §3): falha de leitura virou lista vazia e a tela do agente colapsou para
   "todo ticket é Novo". A regra é: `data` é `undefined` enquanto não chega, e o
   componente trata isso explicitamente (§6). Verificado por lint
   (`no-restricted-syntax` sobre destructuring com default em `useQuery`).
4. **Proibido `refetchInterval` e `setInterval` de rede** (contrato §4). Verificado
   por lint. Atualização vem de invalidação e de evento.
5. **`staleTime` declarado por natureza do dado**, não copiado: 0 para o que a
   própria pessoa acabou de escrever, 30 s para lista operacional, 5 min para
   conteúdo editorial (Base de Suporte), 60 min para catálogo.
6. **Mutation declara `invalidates`** como lista de chaves, no próprio arquivo, junto
   da escrita. Hoje a invalidação está espalhada nos `onSuccess` das páginas e é
   impossível auditar o que uma escrita afeta.
7. **`Idempotency-Key`** é responsabilidade do cliente HTTP, não do chamador: a
   rota está marcada no contrato e o cliente gera a chave e a reutiliza no retry.
8. **Otimismo com `onMutate` + snapshot + rollback**, como já é hoje em
   `useStatusTracking` e no caderno. O padrão fica em um helper
   (`lib/api/optimistic.ts`) para não ser reescrito a cada feature.

```ts
// features/tickets/api/useCreateTicketMutation.ts
export function useCreateTicketMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => api.post<CreateTicketResult>("/tickets", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.all });
      qc.invalidateQueries({ queryKey: metricsKeys.me() });
    },
  });
}
```

---

## 4. Catálogos de domínio (produtos, motivos, canais, plataformas)

Hoje: a lista de 75 produtos está em **três** arquivos, a de plataformas em **dois**
(divergentes: o reembolso não tem `PagAmerican`), e produto novo exige migration
(`services.product` tem CHECK) **mais** editar dois arquivos do front. Já deu bug
(Jellyrock).

v2, em ordem de preferência:

1. **Do servidor** (`GET /catalogs`, `[LACUNA 1 de 20-]`), com `staleTime` longo. É
   o certo: produto novo entra sem deploy do front.
2. Se o dono preferir manter no bundle: **um** módulo em `packages/contract`
   (`catalogs/products.ts`, `catalogs/contactReasons.ts`, …), importado por
   `features/*`. Nunca literal dentro de página.

O que o **front** continua sendo dono, em qualquer dos dois casos (contrato §6:
"texto que o usuário lê é do front"):

- o rótulo pt-BR de cada código;
- a cor da bolinha de cada motivo de contato (11 cores, em `20-frontend-agente.md`
  §3.11);
- os textos do campo de descrição por motivo ("Descreva o motivo" vs "Descreva a
  reclamação", com placeholder e dica próprios);
- os rótulos de status e as variantes de badge.

O que o **servidor** é dono: o conjunto de códigos válidos, a obrigatoriedade da
nota, o limite de 200 caracteres, e o limite de 500 da mensagem de transferência.

---

## 5. Erros: onde vive o mapa `code → texto pt-BR`

Um arquivo: `src/lib/api/errors.ts`.

```ts
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) { super(code); }
}

const MENSAGENS: Record<string, string> = {
  // Não existe FOLLOW_UP_BLOCKED: a regra das 18h deixou de bloquear (§8-A, D1).
  TICKET_DUPLICATE_OTHER_AGENT:
    "Esse cliente já está sendo atendido por outro agente.",
  TRANSFER_ALREADY_PENDING:
    "Você já tem um pedido pendente para esse ticket.",
  DUPLICATE_NAME:
    "Já existe um item com esse nome.",
  ACCOUNT_BLOCKED:
    "O acesso ao sistema foi bloqueado para este usuário.",
  // …
};

export function mensagemDoErro(e: unknown, fallback: string): string { /* … */ }
```

Regras:

- **O `message` da API nunca é mostrado ao usuário.** Ele é técnico e serve para log
  (contrato §3). Hoje **todo** toast de erro do sistema mostra `error.message` cru —
  inclusive mensagem de RLS do Postgres.
- Cada tela passa um `fallback` próprio, que é o texto de hoje ("Não foi possível
  registrar o atendimento.", "Não foi possível assumir o reembolso."). Esses
  fallbacks estão transcritos em `20-` e `21-` e são o ponto de partida.
- Alguns códigos mudam **comportamento**, não texto: `TICKET_DUPLICATE_OTHER_AGENT`
  abre o diálogo de duplicidade em vez de mostrar erro; `ACCOUNT_BLOCKED` desloga
  globalmente. Isso fica em `lib/api/errors.ts` + no cliente, nunca espalhado.
- **O contrato §3 usa `FOLLOW_UP_BLOCKED` como exemplo do formato de erro, e esse
  código deixou de existir com D1.** O exemplo do contrato precisa ser trocado; o
  formato em si não muda. Registrado como emenda §5 deste documento.
- Erro sem `code` conhecido: mostra o `fallback` e loga o `code` real. Nunca mostra
  "undefined" nem a mensagem técnica.

---

## 6. Carregamento, erro e vazio

Três estados, sempre os três, em toda leitura. O componente que garante isso:

```tsx
<QueryBoundary
  query={ticketsQuery}
  loading={<TicketTableSkeleton rows={15} />}
  error={(e, retry) => (
    <ErrorState
      titulo="Não foi possível carregar os atendimentos."
      detalhe={mensagemDoErro(e, "Tente de novo em alguns instantes.")}
      onRetry={retry}
    />
  )}
  empty={(dados) => dados.items.length === 0 && <EmptyState {...} />}
>
  {(dados) => <TicketTable items={dados.items} />}
</QueryBoundary>
```

Padrões herdados de hoje, que ficam:

- **Estado vazio contextual, não genérico.** A tabela de atendimentos tem **três**
  textos diferentes (dia de hoje limpo / filtro sem resultado / nada no banco), e o
  primeiro é uma boas-vindas ("Pronto para começar o dia 🚀"). `EmptyState` aceita
  título, descrição, ícone e ação opcional.
- **Erro com "Tentar de novo".** O caderno e o Radar já fazem; passa a ser universal
  (contrato §3).
- **Skeleton com a forma do conteúdo**, não um retângulo genérico: a tabela usa 15
  linhas, os KPIs usam `h-10 w-24`, o gráfico usa a altura final.
- **A guarda que não pode desaparecer:** quando o dado que decide um rótulo ainda não
  chegou, a interface mostra placeholder — **nunca** um valor plausível. É a lição do
  badge "Novo" (`20-frontend-agente.md` §3.6). Na v2 o status vem no ticket e o
  problema não existe; a regra continua valendo para qualquer campo derivado.
- **Erro em escrita é toast**; erro em leitura é estado na tela. Nunca o contrário.

---

## 7. Rotas do browser em pt-BR — idênticas

O contrato §2 é explícito: as rotas visíveis não mudam. A árvore da v2 é a de hoje,
verbatim:

```
/                        /login                  /blocked                /areas
/workspace               /workspace/pedidos-espera   /workspace/comece-aqui
/workspace/reembolsos    /workspace/metricas     /workspace/transferencias
/workspace/radar         /workspace/base-suporte
/dashboard               /dashboard/reembolsos   /dashboard/acompanhamento
/dashboard/interacoes    /dashboard/alertas      /dashboard/usuarios
/dashboard/base          /dashboard/zendesk      /dashboard/lya
/dashboard/lya/cerebro
/copy                    /produtos               *  (404)
```

Também são contrato, porque estão em links salvos e em redirecionamento interno:

| Parâmetro | Onde | Função |
|---|---|---|
| `?openTicket=<id>` | `/workspace` | o sino manda para cá ao aceitar uma transferência; abre o acompanhamento e limpa a URL |
| `?aba=produtos\|sms\|respostas\|emails\|reembolso` | `/workspace/base-suporte` | mantém a aba no F5 e permite deixar "Respostas SMS" fixa em outra guia |

Nomes internos (arquivos, componentes, tipos, rotas de API) em inglês; **tudo o que
o usuário lê e digita, em pt-BR** (contrato §2).

`vercel.json` continua reescrevendo tudo para `index.html`. O único ajuste é o
diretório de saída, que passa a ser o de `apps/web`.

---

## 8. Divisão de bundle

O que sai do bundle inicial, e o que sobra.

| Dependência | Peso relativo | v2 |
|---|---|---|
| `xlsx` | a maior do cliente hoje | **sai inteira** — exportação e importação passam a ser do servidor (§6.4 de `22-`) |
| `recharts` | grande | só nas rotas com gráfico, por `lazy()`: `/dashboard`, `/dashboard/reembolsos`, `/dashboard/acompanhamento`, `/dashboard/interacoes`, `/workspace/metricas`, `/copy` |
| `react-force-graph-2d` | grande | só em `/dashboard/lya/cerebro` |
| `react-markdown` + `remark-gfm` | médio | só nas telas da Lya |
| `react-day-picker` | médio | só onde há `DateRangePicker` (layout da gestora, do copy, e `/workspace/metricas`) |
| `@supabase/supabase-js` | médio | **só o módulo de auth**; o resto da API é `fetch` |
| shadcn/ui + radix | distribuído | fica: é a base de toda tela |

Rotas continuam em `lazy()` com um `Suspense` de fallback (já é assim hoje e o
comentário no `App.tsx` explica o motivo: tirar os dashboards e o parser de planilha
do primeiro carregamento, "especialmente em máquinas fracas").

Regra de verificação: a rota `/workspace` (a tela que o time usa o dia inteiro) **não
pode** carregar `recharts`, `xlsx`, `react-force-graph-2d` nem `react-markdown`.
Isso é checado por um teste sobre o relatório do build, não por inspeção.

Uma coisa **não** muda: o alias e o `dedupe` de `react`, `react-dom` e dos dois
runtimes de JSX no `vite.config.ts`. Existe para impedir "Invalid hook call" por
duas cópias de React vindas do `lovable-tagger`. O `CLAUDE.md` do projeto diz "não
'consertar' isso" e a v2 mantém, ajustando só os caminhos para o novo `node_modules`.

---

## 9. Acessibilidade

O que hoje já está certo e passa a ser obrigatório:

- **`aria-label` em botão de ícone.** Já existe em muitos ("Excluir atendimento",
  "Concluir atendimento", "Notificações", "Ações do caso", "Página anterior"). Passa
  a ser lint (`jsx-a11y/control-has-associated-label`).
- **`aria-label` composto quando o botão carrega número:** "Abrir meu caderno — 3
  pendências em aberto", "{n} acompanhamentos para hoje". Badge numérico é
  `aria-hidden`; o número vive no rótulo.
- **Cartão clicável é botão de verdade:** os cartões do Radar já têm `role="button"`,
  `tabIndex={0}`, `aria-pressed` e tratam Enter e Espaço. É o padrão.
- **Cor nunca sozinha.** Todo estado tem rótulo em texto além da cor: os badges de
  status, as faixas da barra de meta, o `DelayBadge` ("{n}d de atraso"), a leitura
  do dia ("Dia forte"/"Dia fraco").
- **Gráfico não depende de matiz para distinguir série.** Decisão já registrada no
  projeto: 4+ séries com `--chart-*` são indistinguíveis em protanopia (roxo ↔ azul).
  Onde o gráfico é ranking de magnitude, usa-se **uma** matiz (`RankingChart` do
  agente); onde precisa comparar categorias ao longo do tempo, **small multiples**
  (a evolução do mix no copy). `ChannelEfficiencyCard` documenta a escolha de azul e
  laranja em vez de verde e vermelho.
- **Diálogo não dispensável é exceção justificada.** Dois existem (check-in de 2 h e
  alerta de reembolso de 24 h) e os dois suprimem Esc e clique fora de propósito.
  Ficam, mas com `DialogTitle`/`DialogDescription` e foco preso — e nenhum novo é
  criado sem decisão do dono.
- **Tabela com cabeçalho semântico**, `scope` nas colunas, e coluna *sticky* onde
  hoje é (o nome do agente no Acompanhamento).
- **`tabular-nums` em todo número** que pode mudar — já é o padrão e evita o texto
  "pulando".

Verificação: `eslint-plugin-jsx-a11y` no CI, e `@testing-library` consultando por
papel e rótulo acessível (`getByRole("button", { name: "Concluir" })`) em vez de
classe CSS — o que torna o teste um teste de acessibilidade também.

---

## 10. Tema claro e escuro

`next-themes` com `attribute="class"`, `defaultTheme="system"`, `enableSystem` e
`disableTransitionOnChange` — igual a hoje. `ThemeToggle` no cabeçalho de cada área.

**Regra dura: nenhuma cor literal em componente.** Só tokens de `styles/index.css`,
que já existem e cobrem o vocabulário do produto:

| Grupo | Tokens |
|---|---|
| Base (shadcn) | `--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--accent`, `--ring`, `--border`, `--destructive` |
| Cromo das áreas | `--dashboard-sidebar`, `--dashboard-sidebar-foreground`, `--dashboard-surface` |
| Status | `--status-open`, `--status-success`, `--status-in-progress`, `--status-done`, `--status-new` (+ `-foreground` de cada) |
| Gráficos | `--chart-1` … `--chart-8`, `--chart-success`, `--chart-warning`, `--chart-danger`, `--chart-info`, `--chart-neutral`, `--chart-grid`, `--chart-axis` |
| Caderno | `--notepad-paper`, `--notepad-rule`, `--notepad-margin` |

Todos têm variante escura declarada. Duas dívidas de hoje que a v2 paga:

1. **Cores literais que quebram no escuro.** `ComeceAqui.tsx` usa `bg-white`,
   `text-slate-800`, `border-red-200`. Um punhado de outros lugares usa
   `text-amber-600 dark:text-amber-400` à mão, em vez de token — funciona, mas
   espalha a decisão de cor.
2. **Mesma categoria com cor diferente em telas diferentes.** "Novos em aberto" é
   `--chart-neutral` em `/dashboard/interacoes` e `--chart-1` no modal de canal.
   A v2 tem **um** mapa `status → token` em `components/charts/`, importado pelas
   duas.

O bloco `.lya` é a exceção conhecida: a identidade visual da Lya usa hex próprio,
confinado a esse bloco. `[MANTER]`

---

## 11. Testes

`Vitest` + `@testing-library/react` + `jsdom`, com `src/test/setup.ts` (que já mocka
`window.matchMedia`). Teste ao lado da unidade, como `*.test.ts(x)`.

Hoje existem 20 arquivos de teste, concentrados no que é lógica pura (`roles`,
`contact-reasons`, `nextFollowUp`, `notepadDates`, `parseHeldOrdersCsv`,
`exportRadar`, `supabaseError`, `usePanelPagination`) mais cinco de componente. O
padrão é bom; o problema é cobertura.

Três camadas, com o que cada uma cobre:

**1. Função pura — sempre.** Formatação de data e moeda, plural, tempo relativo,
`dueLabel`, `formatContactReason`, o mapa `code → texto`, e os catálogos (um teste
que garante que todo código tem rótulo e cor).

**2. Componente com o servidor fingido — nas telas que escrevem.** MSW (ou um mock
do cliente `api`) na frente do `lib/api/client`, **nunca** mock do TanStack Query:

```tsx
it("abre o diálogo de duplicidade em vez de mostrar erro", async () => {
  server.use(
    http.post("/api/v1/tickets", () =>
      HttpResponse.json(
        { error: { code: "TICKET_DUPLICATE_OTHER_AGENT", message: "…",
                   details: { ticketId: "…", ownerName: "Ana",
                              ownerIsAvailable: false } } },
        { status: 409 },
      ),
    ),
  );
  render(<NovoAtendimentoForm {...props} />);
  await user.click(screen.getByRole("button", { name: "Registrar" }));
  // dono de folga => o caminho é pedir aprovação, não encaminhar
  expect(await screen.findByRole("button",
    { name: "Solicitar aprovação da gestora" })).toBeVisible();
});
```

Consulta sempre por papel e rótulo acessível. Nunca por classe.

**3. Testes de paridade — a camada nova, e a razão de existir deste documento.**
Um por item do inventário que decide dado ou dinheiro:

| O que garantir | Por quê |
|---|---|
| `POST /tickets` envia os 9 campos, e `serviceDate` **não** é enviado na edição | é o dado que alimenta a plataforma; campo perdido é dado perdido |
| os 75 produtos, as 9 plataformas, os 11 motivos e as 15 razões de reembolso batem com o catálogo | listas divergentes já causaram bug |
| nota obrigatória em `outro` e `reclamacao_vsl`, com o teto de 200 | regra de formulário que o banco também impõe |
| número do pedido obrigatório quando o motivo é reembolso | é o que faz o reembolso nascer sozinho |
| máscara de telefone só em SMS, e a troca de canal **limpa** o campo | sem isso um telefone entra na coluna de e-mail |
| as três mensagens de estado vazio da tabela de atendimentos | cada uma tem função diferente |
| **nenhum** caminho bloqueia uma interação por horário (nem o diálogo, nem o ícone de concluir rápido) | D1: o bloqueio saiu, e saiu dos **dois** lugares — era a incoerência que motivou a decisão |
| todo valor monetário é renderizado a partir de `{ amount, currency }`, nunca com moeda fixa no componente | D4: as duas contradições do legado nasceram de a moeda ser escolhida no componente |
| as quatro listas de D7 mostram "Página {p} de {t} • {n} registros"; "Meus Atendimentos" usa cursor | D7 é paridade de funcionalidade, não detalhe de implementação |
| a tela de Acompanhamento não contém nenhuma constante de meta nem limiar | D3: a política sai do front e passa a ter histórico |
| celebração da meta dispara uma vez por dia por agente | a chave de `localStorage` é a guarda |
| a exportação leva os mesmos filtros da tela | a garantia "a planilha é o que está na tela" |
| nenhuma query usa `const { data = [] }` | o incidente de julho |
| nenhum `refetchInterval` nem `setInterval` de rede em `apps/web` | contrato §4 |
| nenhum import profundo entre features | §2 |
| `/workspace` não carrega `recharts`, `xlsx`, `react-force-graph-2d` | §8 |

Os quatro últimos são verificações estáticas (lint ou análise do build), não testes
de comportamento — e é de propósito: regra que depende de alguém lembrar não é regra.

**Sem `strict: false`.** O projeto de hoje roda com `strict: false`,
`strictNullChecks: false` e `noImplicitAny: false`, e é por isso que
`?? "—"` aparece em todo lugar sem o compilador ajudar. `apps/web` nasce com
`strict: true`; migrar `src/` inteiro seria outro trabalho, mas código novo não
começa devendo.

---

## Lacunas

1. **Quem serve o `apps/web`.** O contrato coloca `apps/web` e `apps/api` no mesmo
   repositório, mas não diz se a Vercel continua servindo o SPA e a API vira outra
   coisa, se as duas viram um projeto só, ou se a API mora em Edge Functions. Isso
   decide o `vite.config.ts` (proxy de `/api` em desenvolvimento), o `vercel.json` e
   como o `Authorization` chega. **Bloqueia o primeiro commit de `apps/web`.**
2. **Formato de `packages/contract`.** Precisa ficar definido se são tipos
   TypeScript à mão, schemas Zod que geram tipo, ou OpenAPI que gera cliente. O
   padrão dos hooks (§3) muda conforme a resposta, e o front hoje já usa `zod` nos
   formulários (`NewRefundDialog`, `CompleteRefundDialog`) — reaproveitar os schemas
   de validação seria natural.
3. **Autenticação em desenvolvimento.** O JWT continua sendo do Supabase Auth, então
   `apps/web` em `localhost:8080` precisa de token válido para bater na API local.
   Falta dizer como (proxy, chave de dev, conta de teste).
4. **Tabela virtualizada.** A redistribuição de tickets já avisa acima de 500 linhas
   ("Considere redistribuir em lotes menores") porque a tabela não é virtualizada.
   Com keyset isso melhora, mas o `ReassignTicketsDialog` continua precisando da
   lista inteira para atribuir destino um por um. Precisa de decisão: virtualizar
   (dependência nova) ou paginar o diálogo.
5. **Internacionalização.** Não é pedida e a v2 não a faz. Mas se o texto sai do
   componente para um mapa `code → texto` (§5), metade do caminho está feito. Falta
   dizer se o resto do texto de interface vai para arquivo de mensagens ou continua
   em JSX. **Recomendação: continua em JSX** — i18n sem necessidade é custo puro.
6. **Ambiente de teste com Realtime.** Trocar polling por push (contrato §4) precisa
   de um jeito de testar "evento chegou → query invalidou". Falta definir se é um
   mock do canal, um servidor de teste, ou se isso não é testado.

## Propostas de emenda

### 1. "A estrutura de pastas fica" — o que de fato deve mudar

O documento de arquitetura diz que a estrutura fica; o dono do projeto pediu que cada
funcionalidade fique devidamente separada e organizada. Não é contradição: a
organização **por feature** já existe e deve ficar. O que precisa mudar é menor e
específico:

1. **`src/pages/` deixa de ser plana.** Hoje `Dashboard.tsx`, `DashboardRefunds.tsx`,
   … `Login.tsx`, `AreaSelect.tsx` e `NotFound.tsx` convivem na mesma pasta, com
   `pages/agent/`, `pages/copy/` e `pages/produtos/` como subpastas. Ou seja: três
   áreas são subpastas e **uma** (a maior, a da gestora) está na raiz. Isso vira
   `areas/analytics/`, `areas/workspace/`, `areas/copy/`, `areas/produtos/`,
   `areas/public/`.
2. **Cada feature ganha `index.ts` e uma pasta `internal/`.** Sem porta pública, a
   separação é decorativa: hoje qualquer arquivo importa qualquer arquivo por caminho
   profundo, e já existe ciclo real entre `services` e `agent/check-in`.
3. **Zero literal de domínio em página.** A regra concreta: nenhum array de produto,
   plataforma, canal, motivo ou percentual dentro de `areas/`. Hoje `Atendimentos.tsx`
   abre com 75 nomes de produto **antes** do primeiro componente.
4. **Zero regra de negócio em hook de UI.** `useStatusTracking` carrega hoje a regra
   das 18h, a derivação de status, a contagem de interações e o cálculo do
   `follow_up_number`. Os quatro saem (contrato §6) e o que resta é um hook de
   mutação.
5. **`src/integrations/supabase/types.ts` (1369 linhas, geradas do schema) sai do
   front.** É o acoplamento mais direto entre interface e banco, e é o que o contrato
   §1 quer eliminar.

O que **não** muda: `components/ui/` continua rastreado no repositório e editável
(não é dependência); o alias `@/*`; `next-themes` com classe; `useToast` e `sonner`
convivendo; TanStack Query como única fonte de estado de servidor.

### 2. Três verificações automáticas como critério de saída

O contrato tem três regras que, hoje, dependem de alguém lembrar — e o histórico
mostra que não funciona. Proponho que virem verificação de CI, e que a v2 não seja
considerada pronta sem elas:

| Regra do contrato | Verificação |
|---|---|
| §3 "nunca mais erro silencioso" | lint proibindo default em destructuring de `useQuery`, e um teste que garante estado de erro visível por consulta |
| §4 "push, não polling" | lint proibindo `refetchInterval` e `setInterval` com chamada de rede |
| §1 "`apps/web` nunca importa de `apps/api` nem de `packages/db`" | regra de caminho no ESLint, mais a proibição de import profundo entre features |

### 3. `strict: true` em `apps/web`, sem migrar o legado

`src/` roda com `strict: false`. Propor migrar tudo seria propor outro projeto. Mas
`apps/web` é código **novo**: nasce com `strict: true` e `strictNullChecks: true`.
Isso muda o desenho dos tipos do `packages/contract` (campos anuláveis têm de ser
declarados como tal), então precisa estar combinado **antes** da primeira rota.

### 4. Dois componentes de paginação, não um `[DECIDIDO — D7]`

A primeira versão deste documento assumia keyset em toda lista. **D7 decidiu o
contrário para quatro das cinco listas**, então `components/data/` tem dois
componentes, e a escolha entre eles é do contrato da rota, não do gosto de quem
implementa:

| Componente | Usado por | O que mostra |
|---|---|---|
| `CursorPager` | `GET /tickets` (Meus Atendimentos) | "anterior / próxima", sem número |
| `NumberedPager` | Reembolsos (2 abas), as duas auditorias, detalhe de motivo | links numerados (hoje: no máximo 7) + "Página {p} de {t} • {n} registros" |

`NumberedPager` recebe `page`, `pageCount` e `totalCount` da resposta — **nunca**
calcula o total a partir do tamanho do array, que é o erro que a versão em memória
de hoje esconde. Enquanto o `totalCount` da primeira página de um filtro novo está
sendo calculado, o rodapé mostra a página sem o total, em vez de mostrar zero.

### 5. O exemplo de erro do contrato §3 precisa ser trocado

O contrato §3 ilustra o formato de erro com `FOLLOW_UP_BLOCKED` e
`details.unlocksAt`. Com **D1** esse código deixou de existir: a rota de interação
não valida janela de horário. O **formato** está certo e não muda; só o exemplo
ficou órfão. Sugestão de substituto, que exercita `details` de verdade e é um caso
em que o front muda de comportamento e não só de texto:

```json
{
  "error": {
    "code": "TICKET_DUPLICATE_OTHER_AGENT",
    "message": "Open ticket for this e-mail belongs to another agent.",
    "details": { "ticketId": "…", "ownerName": "Ana",
                 "ownerIsAvailable": false }
  }
}
```

`ownerIsAvailable` é o que decide se a interface oferece "Encaminhar" ou "Solicitar
aprovação da gestora" — hoje essa informação vem de uma RPC de busca separada.

### 6. Sobre "otimismo de UI é do front" (§6) — com um limite

Concordo, e a v2 mantém o otimismo dos dois lugares onde ele foi conquistado por
dor: o ticket recém-criado entrando no topo da lista, e a interação entrando no
histórico antes da resposta. Mas hoje a linha otimista **inventa o
`follow_up_number`** (`existentes + 1`), e o contrato §6 diz que o número é do banco.

Emenda: o otimismo pode antecipar a **presença** de um item, nunca um **identificador
ou número de sequência**. A linha otimista mostra "gravando…" no lugar do `#N` até a
resposta trazer o `seq` real. É uma linha de diferença visual e fecha uma corrida que
existe hoje.
