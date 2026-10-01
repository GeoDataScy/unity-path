# Frontend v2 — inventário exaustivo da área do agente

> Trilha: **frontend**. Normativo acima deste arquivo: `00-CONTRATO.md`.
> Este documento é o inventário de paridade da área do agente (`role = agent`,
> rotas `/workspace/*`). Prioridade máxima do contrato (seção 8): é daqui que vem
> o dado que alimenta a plataforma. Nada aqui pode desaparecer sem decisão do dono
> do projeto.
>
> Data: 26/09/2026 · Base lida: branch `feat/area-produtos`, `src/` em produção.

## Como ler

Cada tela tem: **Propósito / Quem vê**, **Elementos** (campo por campo, botão por
botão), **Validação no cliente**, **Estados** (carregando, vazio, erro, otimismo),
**Textos** (toasts e mensagens com o texto literal de hoje) e **Paridade v2** (o
que muda e o que não pode mudar). Onde o texto aparece entre aspas, é o texto
literal que está em produção hoje — ele é contrato de interface, não sugestão.

Convenção de marcação:
- `[MANTER]` — comportamento que a v2 reproduz igual.
- `[SERVIDOR]` — hoje é calculado no cliente e passa a vir pronto da API.
- `[DECIDIDO]` — o dono do projeto já decidiu; a decisão está em `00-CONTRATO.md` §8-A.
- `[BACKLOG]` — levantado e adiado; a discussão vive em `90-BACKLOG.md`, não aqui.

> **Reconciliado com `00-CONTRATO.md` §8-A em 26/09/2026.** As decisões que mudaram
> este documento: **D1** (a regra das 18h deixa de bloquear), **D4** (todo valor é
> dólar), **D5** (`platform` preserva "Nenhum" e vazio como coisas diferentes) e
> **D6** (e-mail fica como foi digitado). Onde o texto antigo descrevia bloqueio de
> interação, ele foi reescrito — não há mais bloqueio em lugar nenhum.

---

## 1. Shell da área — `AgentLayout`

**Arquivo:** `src/layouts/AgentLayout.tsx` · **Rota:** `/workspace` (layout de todas
as filhas).

### 1.1 Guarda de acesso (ordem exata de hoje)

1. `supabase.auth.getSession()`. Sem sessão ou com erro → `signOut({scope:"local"})`
   e `navigate("/login", {replace:true})`.
2. `me_status` RPC. `is_active === false` → `signOut` local + `/blocked`.
   Falha de rede no `me_status` **não** desloga (cai para o passo 3).
3. `profiles` (`role, full_name, can_view_all_tickets, can_register_duplicate_emails,
   can_claim_tickets`) por `id = session.user.id`. Erro → `signOut` + `/login`.
4. `profile.role` presente e diferente de `agent`:
   - role **desconhecida neste bundle** (`isKnownRole === false`) → tela
     "Área em construção" (ver 1.4), sem redirect. Isto existe porque o banco pode
     ganhar uma role antes do deploy do front e o fallback para agente causava loop
     em `/workspace`. `[MANTER]`
   - role conhecida → `navigate(homePathForRole(role))`.
   - perfil **sem linha / sem role** continua entrando como agente. `[DECISÃO]` — é
     um buraco silencioso hoje; a v2 com `GET /me` deveria devolver role explícita
     e o front recusar o desconhecido.
5. `onAuthStateChange`: evento `SIGNED_OUT` ou sessão nula → limpa **todas** as
   chaves `localStorage` que começam com `sb-` e vai para `/login`.

### 1.2 Revalidação e presença (o que o contrato manda substituir)

| Hoje | Cadência | v2 |
|---|---|---|
| `setInterval(revalidate, 30_000)` | 30 s | removido (contrato §4: sem `setInterval` de rede) |
| `visibilitychange` → `revalidate` | ao voltar o foco | revalidação no reconnect do socket |
| `window.focus` → `revalidate` | idem | idem |
| `revalidate` = `auth.getUser()` + `me_status` + `sendHeartbeat` | 30 s | Realtime Presence no canal `managers` |
| `sendHeartbeat()` imediato no mount | 1× | Presence `track()` no mount |
| bloqueio detectado → `record_auth_event("force_logout", {reason})` + `/blocked` | — | evento no canal `user:{userId}` empurra o bloqueio `[SERVIDOR]` |

`[DECISÃO]` Se o socket cair e o usuário for desativado, hoje ele é expulso em ≤30 s.
Com push puro, ele segue na tela até a próxima requisição receber
`403 ACCOUNT_BLOCKED`. O contrato já prevê esse código; o front deve tratar
`ACCOUNT_BLOCKED` em **qualquer** resposta como "limpa sessão e vai para /blocked".
Isso substitui o polling sem perder a garantia.

### 1.3 Cabeçalho e cromo

- Logo `logo-xmx.png` + rótulo textual "Workspace".
- `SidebarTrigger` (recolhe/expande a sidebara; `SidebarProvider defaultOpen`).
- `NotificationsBell` (seção 9).
- `ThemeToggle` (claro/escuro/sistema; `next-themes`, `attribute="class"`).
- Botão "Sair": `record_auth_event("logout")` → limpa chaves `sb-*` →
  `window.location.href = "/login"` (recarga dura, não SPA — proposital para matar
  qualquer estado em memória). `[MANTER]`
- Fundo `bg-dashboard-surface`; cabeçalho `bg-dashboard-sidebar`.

Montados no layout (aparecem em **todas** as telas do agente):
- `PendingRefundsAlert` (seção 10.1)
- `AgentCheckInController` (seção 10.2)
- `AgentNotepad` (seção 8)

### 1.4 Estados do shell

| Estado | Texto / aparência |
|---|---|
| Carregando | centralizado, "Carregando..." em `text-muted-foreground` |
| Role sem área | logo + "Área em construção" + "Sua conta é do time **{role}**, e a área desse time ainda não está publicada nesta versão do app. Assim que ela subir, o login já cai direto lá." + botão "Sair" |
| Sessão perdida | redirect silencioso para `/login` |
| Conta desativada | redirect para `/blocked` |

### 1.5 Contexto publicado para as filhas

`AgentOutletContext = { userId, fullName, canViewAllTickets,
canRegisterDuplicateEmails, canClaimTickets }`.

v2: o mesmo objeto passa a vir de `GET /me` num provider (`useSession()`), com
`role`, capacidades e `fullName`. O layout não faz mais três requisições em
sequência para montar. `[SERVIDOR]`

---

## 2. Sidebar do agente — `AgentSidebar`

**Arquivo:** `src/components/agent/AgentSidebar.tsx`

Grupo único, rótulo "Painel". Itens, na ordem exata (a ordem é a que o time
decorou — não reordenar):

| # | Rótulo | Rota | Ícone (lucide) |
|---|---|---|---|
| 1 | Comece por aqui | `/workspace/comece-aqui` | `GraduationCap` |
| 2 | Atendimentos | `/workspace` | `ClipboardList` |
| 3 | Pedidos em Espera | `/workspace/pedidos-espera` | `PackageSearch` |
| 4 | Reembolsos | `/workspace/reembolsos` | `HandCoins` |
| 5 | Transferências | `/workspace/transferencias` | `Send` |
| 6 | Radar | `/workspace/radar` | `Radar` |
| 7 | Minhas métricas | `/workspace/metricas` | `LineChart` |
| 8 | Base de Suporte | `/workspace/base-suporte` | `BookOpen` |

Ativo por igualdade exata de `pathname` (`NavLink ... end`).

**Badge do Radar** — único alerta persistente da área:
- fonte: `my_radar_summary` (`useRadarBadgeQuery`), campos `overdue` e `due_today`.
- valor exibido: `overdue + due_today` ("o que precisa de atenção hoje"; o total em
  aberto não é usado de propósito — "vira paisagem e o agente para de olhar").
- cor: `bg-destructive` quando `overdue > 0`, senão `bg-status-open`.
- sidebar recolhida: o número desaparece (limitação do shadcn) e um ponto de 2 px
  aparece sobre o ícone, com a mesma regra de cor.
- tooltip: `"{título} — {n} para hoje"` quando há badge, senão só o título.
- `aria-label`: `"{n} acompanhamentos para hoje"`.
- **não** tem polling; atualiza por invalidação após o agente registrar algo.
  v2: invalidação por evento `user:{userId}`. `[MANTER a regra, trocar o gatilho]`

---

## 3. `/workspace` — Atendimentos

**Arquivo:** `src/pages/agent/Atendimentos.tsx` (1397 linhas) · a tela mais
importante do sistema. Toda a base de dados de atendimento nasce aqui.

**Propósito:** registrar um atendimento novo, ver os atendimentos recentes,
registrar interação, concluir, editar, excluir, buscar por e-mail, e resolver
duplicidade de cliente (assumir / encaminhar / pedir aprovação).

**Quem vê:** `role = agent`. Variações por capacidade em 3.9.

### 3.1 Saudação e selo de canal

- `h1`: `"Vamos lá, {fullName} 🚀"`. `fullName` vazio → `"Time"`.
- Selo ao lado: `"SMS"` (fundo violeta, `bg-violet-500/15 text-violet-700 /
  dark:text-violet-400`) ou `"EMAIL"` (fundo azul, `bg-blue-500/15
  text-blue-700 / dark:text-blue-400`).
- O selo vem de um cálculo no cliente `[SERVIDOR]`:
  `supportChannel = smsCount > outrosCount ? "sms" : "email"`, onde `smsCount` é
  `services.filter(channel === "SMS").length` **sobre a janela de 30 dias já
  carregada**. Ou seja: hoje o selo (e a meta) dependem de quantos tickets
  couberam no cache. Isso é bug latente e precisa virar campo do servidor.
- Botão `"Simular meta batida (DEV)"` — só em `import.meta.env.DEV`. Dispara
  confete + som por 9600 ms com contagem forçada igual à meta. `[MANTER]` (é
  ferramenta de teste real do time, não sobra de código).

### 3.2 Cartões de métrica do dia — `AgentDailyMetricsSection`

**Arquivo:** `src/features/agent/components/AgentDailyMetricsSection.tsx`
**Fonte:** RPC `agent_daily_metrics(target_date = hoje-SP)` →
`{ my_count, leader_count, leader_name, leader_id, is_leader }`.

Três cartões em `md:grid-cols-3`:

| Cartão | Conteúdo | Vazio / carregando |
|---|---|---|
| "Total de atendimentos hoje" | `my_count` em `text-4xl tabular-nums`, formatado `pt-BR`. Badge `success` `"🏆 Meta Batida!"` quando `count >= goal` | `Skeleton h-10 w-24` |
| "Distância do líder" | se `is_leader`: ícone `Trophy` + "**Parabéns! Você está na liderança**". senão: "Você está **{leader_count - count}** atendimentos atrás de **{leader_name}**." (`leader_name` vazio → "Sem nome") | sem dado: "Ainda não há atendimentos registrados hoje." · carregando: 2 skeletons |
| "Atendimentos para alcançar a meta" | `max(0, goal - count)`; rodapé "Meta diária: {goal}" | `Skeleton h-10 w-24` |

**Barra de progresso** abaixo: rótulo "Progresso da meta" à esquerda, `"{count}/{goal}"`
à direita. Cor do indicador por faixa — é semântica, não decoração:

| Faixa | Classe | Significado |
|---|---|---|
| `< 60%` da meta | `bg-destructive` | atrasado |
| `60% – 89%` | `bg-status-open` | no caminho |
| `>= 90%` | `bg-status-success` | perto/batido |

Ao bater a meta, o card ganha `shadow-[0_0_0_3px_hsl(var(--status-success)/0.22)]`
e a barra ganha glow verde.

**Celebração da meta** (detalhe que o time reconhece e não pode sumir):
- gatilho: `prevCount < goal && count >= goal`.
- guarda: `localStorage["goalHit:{userId}:{data-SP}"]` — uma vez por dia por agente.
- efeitos: `ConfettiBurst pieces={64}`, classe `pulse` no número, e som
  `/sounds/clap.mp3` a `volume 0.7`.
- duração: 9600 ms.
- destrave de áudio: no primeiro `pointerdown` da sessão o áudio é carregado e
  tocado/pausado para burlar o bloqueio de autoplay.
- v2: a guarda diária continua em `localStorage` (é preferência por navegador, não
  dado). `[MANTER]`

**Meta diária:** `supportChannel === "sms" ? 150 : 100`. Hoje derivada no cliente
(3.1). `[SERVIDOR]` — precisa vir em `GET /metrics/me` como `dailyGoal` e
`supportChannel`.

`myCountOverride` existe na prop da seção (substitui `my_count` por contagem do
cliente) e **não é usado** por `Atendimentos.tsx`. `[DECISÃO]` remover na v2.

### 3.3 Formulário "Novo registro de atendimento"

Linha de cima do cartão, fora do `<form>`:

**Canal** — três botões alternados (não é `select`): `Clickbank`, `Email`, `SMS`.
- padrão: `Email`.
- variante `default` no selecionado, `outline` nos demais.
- **efeito colateral obrigatório:** trocar entre "é SMS" e "não é SMS" **limpa o
  campo de e-mail/telefone** (`if ((ch === "SMS") !== (channel === "SMS"))
  setClientEmail("")`). Sem isso um telefone mascarado iria para uma coluna de
  e-mail. `[MANTER]`

**Cód. Rastreio** — `Switch` (`id="tracking-code-toggle"`), rótulo clicável
"Cód. Rastreio", padrão desligado. Grava `services.has_tracking_code`. Esse
booleano é o que o dashboard usa para não contar a mesma conversa duas vezes.
(Até 26/09/2026 ele também liberava a exceção da regra das 18h; com **D1** não há
mais regra para excetuar, e o campo passa a servir só à métrica.)

Campos do `<form>` (grid `lg:grid-cols-6 lg:items-end`):

| Campo | id | Tipo | Obrigatório | Valores / máscara | Padrão |
|---|---|---|---|---|---|
| E-mail do Cliente | `clientEmail` | `email` quando canal ≠ SMS, `text` quando SMS | sim (`required`) | SMS: máscara `999-999-9999` via `formatPhone` (só dígitos, corta em 10, insere hífens). Não-SMS: validação nativa de e-mail do browser | vazio |
| Data do Atendimento | — | **não editável** | — | caixa cinza com "Hoje ({dd/mm/aaaa})" | hoje-SP |
| Produto | — | `Select` | sim | 75 produtos, lista em 3.11 | vazio, placeholder "Selecione" |
| Plataforma | — | `Select` | sim | 9 valores, lista em 3.10 | vazio, placeholder "Selecione" |
| Motivo de contato | — `Select` com bolinha de cor | sim | 11 motivos, lista em 3.10 | vazio, placeholder "Selecione" |
| Descrição (condicional) | `contactReasonNote` | `Textarea` 2 linhas | sim quando visível | máx. 200 caracteres (corte no `onChange` **e** `maxLength`) | vazio |
| Número do pedido (condicional) | `order-id` | `text` | sim quando visível | livre, `placeholder "Ex: 12345"` | vazio |

Sublegenda do e-mail: quando canal = SMS aparece "ou número de telefone" em
`text-[11px]`. Placeholder muda: `"954-662-8786"` (SMS) vs `"cliente@email.com"`.

**Campo de descrição** aparece só para os motivos `outro` e `reclamacao_vsl`, com
textos diferentes por motivo:

| Motivo | Rótulo | Placeholder | Dica |
|---|---|---|---|
| `outro` | "Descreva o motivo" | "Ex.: cliente confundiu cápsula com gummy" | "Use para situações que não se encaixam nos motivos da lista." |
| `reclamacao_vsl` | "Descreva a reclamação" | "Ex.: anúncio prometia resultado em 7 dias" | "Diga o que o cliente cobrou do anúncio/VSL — qual promessa ou informação." |

Contador `"{n}/200"` ao lado da dica. Trocar o motivo para um que não pede nota
**descarta** o texto digitado (o CHECK do banco também recusaria).

**Número do pedido** aparece só quando motivo = `reembolso`, com a dica: "Com o
número do pedido, o reembolso é criado sozinho na aba Reembolsos — não precisa
cadastrar de novo." O valor só é enviado quando o motivo é `reembolso` (senão
`null`).

**Botões:**

| Botão | Quando aparece | Rótulo / estado | Ação |
|---|---|---|---|
| Registrar | sempre | "Registrar" → "Registrando..." | cria com `status: "registered"` |
| Concluir | **só quando canal = SMS** | ícone `CheckCircle2` + "Concluir" → "Concluindo..." | cria já com `status: "concluido"`, sem inserir follow-up (evita contagem dupla na métrica do dia). Borda e texto verdes (`border-green-600 text-green-700`, dark: `green-500/400`) |

Ambos desabilitados quando `!canSubmit || createMutation.isPending`.

### 3.4 Validação no cliente hoje (`canSubmit`)

```
emailOk   = canal === "SMS" ? /^\d{3}-\d{3}-\d{4}$/.test(clientEmail) : Boolean(clientEmail)
orderOk   = motivo !== "reembolso" || orderId.trim() !== ""
reasonOk  = Boolean(motivo) && (!pedeNota(motivo) || nota.trim() !== "")
canSubmit = emailOk && serviceDate && product && platform && reasonOk && orderOk
```

Quando falha, **não há mensagem**: os botões ficam apenas desabilitados. `[DECISÃO]`
A v2 deveria mostrar o motivo do bloqueio por campo (hoje o agente com um telefone
incompleto não sabe por que o botão não responde). Isso é melhoria, não paridade —
depende do dono.

### 3.5 Fluxo de criação — a máquina de estados que não pode mudar

`createMutation` tem três desfechos. A ordem das checagens é regra de negócio:

1. RPC `find_ticket_by_email(p_email)` — `SECURITY DEFINER`, devolve o ticket **não
   concluído** mais recente daquele e-mail, de qualquer agente.
2. Se achou:
   - `found.current_owner_id === meuId` **ou** `canViewAllTickets` →
     `kind: "mine"`. Toast **"E-mail já cadastrado" / "Abrindo o acompanhamento do
     atendimento existente."** e abre o `StatusTrackingDialog` do ticket existente.
     Se o ticket não está no cache local, busca por `id` e invalida
     `["services","me"]` para ele aparecer na tabela depois.
   - senão, se **não** tem `canRegisterDuplicateEmails` → `kind: "other_agent"`,
     abre o `TransferTicketDialog` (3.7).
   - senão (tem a capacidade) → segue e cria o ticket próprio mesmo com
     duplicidade no banco.
3. `INSERT services` com: `client_email` (só `trim`, **sem normalizar caixa** —
   `[DECIDIDO — D6]`: o valor é gravado como foi digitado), `service_date =
   "{hoje-SP}T00:00:00-03:00"`, `product`, `platform`, `channel`,
   `has_tracking_code`, `contact_reason`, `contact_reason_note` (normalizado),
   `order_id` (só se reembolso), `status` (`"concluido"` se veio do botão Concluir,
   senão `"registered"`), `user_id`.
   Retorna 13 colunas, incluindo `current_owner_id`.

Pós-sucesso de criação:
- limpa **todos** os campos (canal volta para `Email`, rastreio para desligado).
- **atualização otimista:** `setQueriesData(["services","me"])` inserindo o ticket
  no topo, deduplicando por `id`.
- invalida `["services","me"]` e `["agent","daily-metrics"]`.
- `emitAgentInteraction()` (ancora o timer de check-in, 10.2).
- se motivo = `reembolso`, invalida `["refunds","me"]` (o banco já criou o
  reembolso pelo trigger `sync_refund_from_service`).
- toast, com quatro textos possíveis:

| Situação | Título | Descrição |
|---|---|---|
| registrado, sem reembolso | "Atendimento registrado" | "Seu registro foi salvo com sucesso." |
| registrado, com reembolso | "Atendimento registrado" | "Registro salvo. O reembolso já está na aba Reembolsos, aguardando você assumir." |
| concluído, sem reembolso | "Atendimento concluído" | "Ticket registrado e marcado como concluído." |
| concluído, com reembolso | "Atendimento concluído" | "Ticket registrado e concluído. O reembolso já está na aba Reembolsos, aguardando você assumir." |

Erro: `console.error` + toast destrutivo "Erro ao registrar" / mensagem real do
erro (`error.message`), fallback "Não foi possível registrar o atendimento."

v2: um único `POST /tickets` com `Idempotency-Key` decide os três desfechos no
servidor e devolve `{ outcome: "created" | "mine" | "other_agent", ticket }`. O
front deixa de fazer a checagem de duplicidade e deixa de saber a regra.
`[SERVIDOR]`

### 3.6 Tabela "Meus Atendimentos Recentes"

**Fonte:** RPC `my_recent_services(p_days_back = 30)` (`useMyServicesQuery`).
A janela de 30 dias é cap operacional — sem ela a UI travava. A janela considera
data de criação **e** última interação, para ticket antigo redistribuído voltar a
aparecer.

**Colunas** (na ordem):

| Coluna | Conteúdo | Detalhe |
|---|---|---|
| Data de abertura | bolinha do motivo + `dd/MM/yyyy` | bolinha: cor do motivo (3.10); sem motivo → transparente com `ring-1 ring-border`. `title`/`aria-label` = "Motivo: {rótulo — nota}" ou "Sem motivo registrado" |
| Hora | `HH:mm` de `created_at` em SP, `tabular-nums` | timestamps ingênuos (sem fuso) são tratados como UTC antes de converter. `—` quando inválido |
| Agente | **só com `can_view_all_tickets`** | "Você" (muted) quando `user_id === userId`, senão `full_name` do mapa, `—` se ausente |
| E-mail do Cliente | `client_email`, `font-medium` | |
| Produto | `product` | |
| Plataforma | `platform ?? "—"` + **botão de concluir rápido** | ícone `CheckCircle2` verde 24 px, `title`/`aria-label` "Concluir atendimento", aparece só quando o status **não** é "Concluído"; desabilitado enquanto conclui aquele id |
| Canal | `channel ?? "—"` + ícone `Package` (cor `primary`) quando `has_tracking_code` | |
| Status | badge clicável + `#N` | ver abaixo |
| Ações | lápis (editar) + lixeira (excluir) | lixeira **só** quando `current_owner_id === userId` |

Linhas ímpares recebem `bg-muted/40` (zebra).

**Badge de status** (`getAgentStatus`) — a área do agente renomeia um estado:

| Estado interno | Rótulo no agente | Variante |
|---|---|---|
| sem follow-up e `status !== "concluido"` | **"Novo"** (o gestor vê "Em Aberto") | `new` |
| `status === "concluido"` sem follow-ups | "Concluído" | `done` |
| último follow-up `concluido` | "Concluído" | `done` |
| 1 follow-up `em_andamento` | "Em Andamento" | `in-progress` |
| N>1 follow-ups `em_andamento` | "Em Andamento {N}" | `in-progress` |

O badge tem `cursor-pointer` e `hover:scale-105 active:scale-95`; clicar abre o
`StatusTrackingDialog`. Ao lado, `#{contagem}` em `text-[10px]`, onde
`contagem = follow-ups + 1` (a criação do ticket conta como interação #1).

**Guarda anti-bug (não remover):** quando `allFollowUps.length === 0` e a query de
follow-ups está `pending` ou em `error`, a célula de status mostra
`Skeleton h-5 w-24` em vez do badge. Foi exatamente isso que causou o incidente
"todo ticket aparece como Novo": mapa vazio colapsava tudo para "Novo".
Na v2 o problema desaparece na raiz — `status` e `interactionCount` vêm no próprio
ticket `[SERVIDOR]` — mas a regra "falha de leitura nunca vira dado plausível"
continua valendo (contrato §3).

### 3.7 Filtros, busca, contador, exportação

Barra acima da tabela, título "Meus Atendimentos Recentes", e:

| Controle | Padrão | Comportamento |
|---|---|---|
| Busca por e-mail | vazio | `Input` com ícone `Search`, placeholder "Buscar por e-mail...", botão `X` para limpar. Filtro `includes` case-insensitive **em memória** (na v2 vai para o servidor, casando pela coluna normalizada — `[DECIDIDO — D6]`, ver Lacuna 16). **Quando há busca, o filtro de data é ignorado de propósito** ("buscar deve achar o ticket por mais antigo que seja") |
| Data inicial / final | **hoje / hoje** | dois `input type="date"`, `title` "Data inicial"/"Data final", separador "até". Ícone `CalendarDays` |
| Limpar datas | aparece se alguma data preenchida | `X`, `title` "Ver tudo (limpar datas)" |
| Voltar para hoje | aparece quando o período **não** é hoje–hoje | Botão ghost "Hoje", `title` "Voltar para o dia de hoje" |
| Total de atendimentos | — | caixa `bg-muted/40` "Total de atendimentos: **{n}**" |
| Cód. Rastreio | desligado | botão alterna `default`/`outline`, ícone `Package`, mostra `X` quando ativo. Filtra `has_tracking_code === true` |
| Exportar (Excel) | — | ícone `Download` → `Loader2` girando, "Exportar (Excel)" → "Exportando...". Desabilitado sem as duas datas. `title` muda: "Selecione a data inicial e final para exportar" / "Exportar os atendimentos do período para Excel" |
| "Atualizando..." | — | texto à direita enquanto a lista carrega ou uma criação está em voo |

**A regra de contagem do "Total de atendimentos"** é sutil e precisa sobreviver:
- sem busca e sem filtro de rastreio → vem da RPC `agent_my_metrics(from,to)`,
  campo `total_count` (mesma fonte do card do dia e do dashboard do gestor, para os
  números baterem).
- com busca por e-mail **ou** filtro de rastreio ativo → a RPC não conhece esses
  filtros, então o número passa a ser `filteredServices.length` ("resultados
  encontrados").
- período vazio usa `from = "2025-01-01"` e `to = hoje-SP` como limites.

**O filtro de data é mais esperto do que parece** `[SERVIDOR]`: um ticket entra no
período se `service_date` está no intervalo **ou** se **este agente** registrou um
follow-up no intervalo (`followUpServiceIds`). Isso espelha `dashboard_metrics`:
a interação é atribuída a quem a fez, não ao dono do ticket. O cálculo de hoje
percorre todos os follow-ups no cliente, normalizando `recorded_at`
(`replace(/\.\d+/, "")` porque o Supabase devolve microssegundos que alguns
browsers recusam) e formatando em `sv-SE` no fuso SP.

**Paginação:** 15 por página, em memória. Rodapé só aparece com mais de 15
registros: "Página {p} de {total} • {n} registros" + `Pagination` com no máximo
**7** links numéricos (`.slice(0, 7)` — páginas 8+ só são alcançáveis pelo
"próximo"). Qualquer mudança de filtro reseta para a página 1.

**Exportação:** `exportAgentServices({fromISO, toISO})` (seção 11), toast
"Exportação concluída" / "{n} atendimento(s) exportado(s) para a planilha." Erro:
"Erro ao exportar" + mensagem real. Sem período: "Selecione o período" / "Escolha a
data inicial e final antes de exportar."

**Estados vazios** (três textos diferentes — todos precisam existir):

| Condição | Texto |
|---|---|
| período = hoje, sem busca, sem filtro de rastreio | "**Pronto para começar o dia 🚀**" + "Seu primeiro atendimento de hoje aparecerá aqui assim que registrado." |
| algum filtro aplicado | "Nenhum atendimento encontrado com os filtros aplicados." |
| nenhum filtro e nada no banco | "Nenhum atendimento registrado ainda." |

`colSpan` é 9 com `can_view_all_tickets` e 8 sem.

### 3.8 Registrar interação — `StatusTrackingDialog`

**Arquivo:** `src/features/services/StatusTrackingDialog.tsx`
Abre por: clique no badge de status, `?openTicket={id}` na URL (vindo do sino), ou
como desfecho `"mine"` da criação.

Cabeçalho: ícone `FileText` + "Acompanhamento do Atendimento"; descrição
"Cliente: **{client_email}**".

Bloco de status atual: "Status atual:" + badge + (se houver entradas) ícone `Hash`
+ "{n} interação"/"{n} interações" (singular/plural correto).

**Histórico** (só se houver entradas; `max-h-40` com scroll, borda esquerda
`border-primary/30`): por entrada, badge pequeno ("Concluído" / "Em Andamento" /
"Em Andamento {follow_up_number}"), ícone `Clock` + `dd/MM/aaaa HH:mm` em SP, e a
observação em `text-xs` quando existe.

**Formulário de novo registro** (visível quando o ticket não está concluído, ou
quando está e o agente clicou em "Reabrir Ticket"):
- título "Novo registro de acompanhamento"
- `Select` **Status**: `em_andamento` → "Em Andamento" (padrão) · `concluido` →
  "Concluído"
- `Textarea` **Observação**, 3 linhas, placeholder "Descreva o que foi feito nesta
  interação...", **sem limite de caracteres e não obrigatória**

**A regra das 18h sai** `[DECIDIDO — D1]`

Como era até 26/09/2026 (fica registrado porque é o que o time conhece, e porque
explica por que a interface tinha um aviso vermelho):

| Situação | Comportamento antigo |
|---|---|
| sem follow-up ainda | permitido (a criação do ticket não é interação) |
| `has_tracking_code === true` | permitido (exceção de rastreio) |
| caso contrário | **bloqueado** até `18:00 -03:00` do dia do último `recorded_at` |
| concluir | passava sempre, mesmo bloqueado |

O bloqueio existia **só no cliente** (`canAddInteraction`) e de forma incoerente:
concluir pelo ícone da lista chamava a checagem e podia recusar; concluir pelo
diálogo passava direto. **D1 resolve igualando pelo lado permissivo: nenhum dos dois
bloqueia.** Sai da interface, na v2:

- a caixa de aviso `border-destructive/40 bg-destructive/10` com
  "**Interação bloqueada**" + "A próxima interação com este atendimento só pode ser
  registrada no dia seguinte. Você ainda pode concluir o ticket.";
- o toast destrutivo "Interação bloqueada" com a mesma razão;
- o estado desabilitado do botão "Registrar" que vinha dessa checagem (o `canSubmit`
  do diálogo passa a depender **só** de a mutação não estar em voo);
- a checagem inteira, tanto no diálogo quanto no ícone de concluir rápido (3.9).

**O que NÃO sai:** o banco continua marcando `is_same_day_repeat`. A marcação não é
o bloqueio — é o que permite a métrica não contar a mesma conversa duas vezes, e
perdê-la distorceria todos os dashboards (contrato §8-A, D1). Nenhuma tela do agente
exibe essa marcação hoje; a única que exibiria é a seção de repetições no mesmo dia
da gestora, que está importada e nunca renderizada
(`21-frontend-outras-areas.md` §6.3, item **B19** do backlog). Se ela for religada,
o KPI "Furaram a regra das 18h" precisa de novo significado — não existe mais regra
para furar.

Consequência esperada, e que a interface **não** deve tratar como erro: mais
interações no mesmo dia. A definição das métricas não muda, então o número de
"atendimentos" não infla; cresce o de interações marcadas como repetição.

**Ticket concluído** (e não reabrindo): caixa `border-status-done/30
bg-status-done/10` com "Este atendimento foi concluído com **{n}** interação(ões)."
+ "Reabra o ticket para registrar uma nova interação."

**Rodapé:** "Fechar" (sempre) · "Reabrir Ticket" com ícone `RotateCcw` (só quando
concluído e não reabrindo; é só estado local — não escreve nada) · "Registrar" →
"Registrando...".

Sucesso: toast "Acompanhamento registrado" com descrição "Atendimento marcado como
concluído." ou "Nova interação registrada com sucesso."; reseta status para
`em_andamento`, limpa observação, sai do modo reabrir e fecha o diálogo.
Erro: toast destrutivo "Erro ao registrar" + mensagem real.

**Escrita e otimismo** (`useStatusTracking.addEntryMutation`):
- `INSERT service_follow_ups { service_id, user_id, follow_up_number =
  existentes+1, status, observation }`. `recorded_at` é fixado por trigger no banco.
- `onMutate` insere uma linha otimista com `id = "optimistic-{serviceId}-{iso}"`
  para o badge e o `#N` mudarem na hora (com milhares de follow-ups o refetch
  levava segundos e o agente achava que não salvou).
- `onError` restaura o cache anterior e mostra toast destrutivo "Erro ao registrar
  interação" + mensagem real.
- `onSettled` invalida `["service-follow-ups"]`, `["agent","daily-metrics"]`,
  `["services","me"]`.
- `onSuccess` dispara `emitAgentInteraction()`.

`[SERVIDOR]` Na v2: `POST /tickets/:id/interactions` com `Idempotency-Key`. O
`follow_up_number` (`seq`) é do banco (contrato §6) — o cliente **não** calcula
mais `existentes+1`, que hoje é corrida esperando acontecer. A rota **não valida
janela de horário** (D1): valida dono, permissão e status, e nada mais. Portanto
não existe `FOLLOW_UP_BLOCKED`, não existe `details.unlocksAt` e o front não tem
mensagem de bloqueio para escrever.

### 3.9 Concluir rápido, editar, excluir

**Concluir rápido** (ícone verde na coluna Plataforma): insere follow-up
`status: "concluido"` com observação **vazia** e mostra "Atendimento concluído" /
"Ticket registrado como concluído.". Erro: "Erro ao concluir" + mensagem real.
O botão fica desabilitado só enquanto **aquele** id está concluindo.

`[DECIDIDO — D1]` Some daqui a checagem `canAddInteraction` e o toast destrutivo
"Não permitido" + razão, que era a metade incoerente do bloqueio: este caminho
recusava e o do diálogo não.

**Editar** (`EditServiceDialog`): título "Editar atendimento", descrição "Atualize
os dados do registro e salve."

| Campo | Editável | Observação |
|---|---|---|
| E-mail do Cliente | sim (`type="email"`) | **sem máscara de telefone aqui**, mesmo em ticket de SMS |
| Produto | sim | mesma lista de 75 |
| Plataforma | sim | mesma lista de 9 |
| Canal | sim | lista **diferente** do formulário: `Nenhum`, `Clickbank`, `Email`, `SMS`. Valor ausente cai em "Nenhum" |
| Motivo de contato | sim | mesma lista de 11 |
| Descrição | condicional | igual ao formulário, mas **sem `required`** no elemento (só o `canSave` barra) |
| Número do pedido | condicional (motivo = reembolso) | dica: "Usado no registro da aba Reembolsos, que é criado e mantido em dia a partir deste atendimento." |
| Data do atendimento | **não** | fixada por trigger; correção do gestor via `manager_correct_service_date` |

`order_id` **não vem** em `my_recent_services`, então o diálogo faz um `SELECT
order_id` próprio ao abrir — sem isso, salvar apagava o número do pedido.
`[SERVIDOR]` Na v2 `GET /tickets/:id` devolve o recurso completo e esse remendo
morre.

`canSave = clientEmail && product && platform && orderOk && reasonOk && !saving`.
Botões "Cancelar" e "Salvar" → "Salvando...".
Sucesso (na página): "Atendimento atualizado" / "As alterações foram salvas.",
invalida `["services","me"]` **e** `["refunds","me"]` (a edição pode ter criado ou
atualizado o reembolso vinculado). Erro: "Erro ao atualizar" + mensagem real.

**Excluir** (`DeleteServiceAlert`): lixeira ghost, `aria-label` "Excluir
atendimento", `title` "Excluir". `AlertDialog` "Excluir atendimento?" / "Esta ação
não pode ser desfeita. O registro será removido permanentemente." Botões "Cancelar"
/ "Excluir". Sucesso: "Atendimento excluído" / "O registro foi removido.", invalida
`["services","me"]` e `["agent","daily-metrics"]`. Erro: "Erro ao excluir" +
mensagem real. Só aparece para `current_owner_id === userId` — o supervisor que vê
tickets alheios **não** pode excluí-los pela UI.

### 3.10 Duplicidade: assumir, encaminhar, pedir aprovação

`TransferTicketDialog` (`src/features/transfers/TransferTicketDialog.tsx`), aberto
quando `find_ticket_by_email` acha ticket aberto de outro agente e o agente não tem
`can_register_duplicate_emails`.

Título: "Cliente já possui ticket aberto". A descrição tem **duas versões**:

| Condição | Texto |
|---|---|
| `current_owner_is_available !== false` | "Esse cliente já está sendo atendido por outro agente. Você pode **assumir o atendimento** (passa a ser seu e você registra a interação) ou **encaminhar** uma mensagem para o agente responsável continuar." |
| `current_owner_is_available === false` (dono de folga) | "O responsável por este cliente está **de folga/indisponível**. Para assumir o atendimento, solicite a **aprovação da gestora**. Assim que autorizado, o ticket passa a ser seu." |

Ficha do ticket (`grid-cols-3`, rótulo + valor): Agente (`current_owner_name ??
agent_name ?? "—"`), Cliente, Produto, Plataforma (`?? "—"`), Aberto em
(`dd/mm/aaaa` em SP), Status (badge `outline` com o valor **cru** do banco — hoje
aparece "registered" para o agente). `[DECISÃO]` Isso é vazamento de valor interno
na interface; a v2 deveria rotular.

Campo de texto: `Textarea` 3 linhas, **máx. 500**, com rótulo e placeholder que
mudam:

| Condição | Rótulo | Placeholder |
|---|---|---|
| dono disponível | "Mensagem para o agente (opcional)" | "Ex.: cliente voltou a entrar em contato, pedindo atualização do reembolso." |
| dono de folga | "Observação para a gestora (opcional)" | "Ex.: cliente aguardando retorno urgente sobre o reembolso." |

**Três ações possíveis:**

1. **Encaminhar** (só quando o dono está disponível) — `INSERT ticket_transfers
   {service_id, from_user_id = eu, to_user_id = current_owner_id ?? user_id,
   message, status: "pending"}`. Código `23505` (índice parcial único) vira a
   mensagem "Você já tem um pedido pendente para esse ticket." Sucesso: invalida
   `["ticket_transfers"]`, toast "Encaminhado" / "Pedido enviado para {nome}." e
   **limpa o formulário da página** (o ticket fica com o dono original). Erro:
   "Erro ao encaminhar" + mensagem.
2. **Assumir atendimento** (só quando `canClaimTickets`) — RPC
   `claim_ticket(p_service_id)`. Sucesso: invalida `["services","me"]`, fecha o
   diálogo, **abre o acompanhamento do ticket assumido**, toast "Atendimento
   assumido" / "Agora você é o responsável. Registre a interação." Erro: "Erro ao
   assumir" + mensagem, fallback "Não foi possível assumir o atendimento."
3. **Solicitar aprovação da gestora** (só quando o dono está de folga) — RPC
   `request_ticket_takeover(p_service_id, p_note)`. Sucesso: fecha, **limpa o
   formulário**, toast "Pedido enviado" / "A gestora foi notificada. Assim que
   aprovado, o atendimento aparecerá na sua lista." Erro: "Erro ao solicitar" +
   mensagem.

Rodapé: "Cancelar" (ghost, desabilitado enquanto qualquer ação está em voo) à
esquerda; à direita "Encaminhar" → "Enviando..." **ou** "Solicitar aprovação da
gestora" → "Enviando...", e "Assumir atendimento" → "Assumindo...". O diálogo
**não fecha** por clique fora enquanto uma ação está em voo.

**Matriz de capacidade** — o que muda na tela por permissão:

| Capacidade | Efeito visível |
|---|---|
| `can_view_all_tickets` | coluna "Agente" na tabela; query extra `profiles` para o mapa de nomes; duplicidade de **qualquer** agente é tratada como "minha" (abre o acompanhamento em vez do diálogo) |
| `can_register_duplicate_emails` | duplicidade cross-agent é **ignorada**: cria o ticket próprio sem abrir diálogo |
| `can_claim_tickets` | botão "Assumir atendimento" aparece no diálogo |
| nenhuma | só "Encaminhar" (ou "Solicitar aprovação", se o dono está de folga) |

### 3.11 Catálogos com os valores reais

**Produtos (75)** — `services.product` tem CHECK no banco: produto novo exige
migration. Duplicados em `Atendimentos.tsx` e `EditServiceDialog.tsx` (mesma lista
copiada; ver 23-frontend-estrutura, isso vira um único módulo).

```
Arialief · Alphacur · Blinzador · Feilaira · Garaherb · Karylief · Kymezol ·
Jertaris · Laellium · Memyts · Presgera · Biografa · Cetacondor · Cetadusse ·
Sciatilief · Goldenfrib · Felaromi · Tenurima · Ariovira · CucuDrops · Zalovira ·
Xelovita · Cerami · NATHUREX · Mahgryn · Levhyn · Ariomyx · Alitoryn · Athentys ·
Velynivo · Mioralab · Vergolief · Olisteren · Halegryn · Danmyts · Maizkidor ·
Basmontex · Fraganief · Ceramiri · Shapeon · Nexburn · Memoryon · Korvizol ·
Erectozyn · Thewellnesswize · VIP.Shipping · VisualEase · NerveEase · Steelpower ·
Gluco Off · Cognivex · Nad Dermal+ · Alpharock · Hair Bloom · Guardon · Joint Mend ·
Keskara · Lipolegs · LipoShape · Mind Recall · Mind Wake · Prostate Vital ·
Quiet Nerves · Quiet Rest · RingSilence · FlowStrong · Youth Within ·
Thermo Ignite · Glyco Barrier · Gluco Mild · Horsefil · Honeyfil · Clear Gaze ·
PagAmerican · Jellyrock
```

**Plataformas (9):** `Nenhum` · `Cartpanda` · `CartCandy` · `Buygoods` ·
`ClickBank` · `Digistore24` · `SalesBound` · `LogiCall` · `PagAmerican`

**Canais:** criação — `Clickbank`, `Email`, `SMS`. Edição — `Nenhum`, `Clickbank`,
`Email`, `SMS`. (A diferença é real e intencional: o `Nenhum` existe para não
apagar dado histórico sem canal.)

**Motivos de contato (11)** — `code` deve continuar igual ao CHECK
`services_contact_reason_check`:

| code | label | bolinha | pede nota |
|---|---|---|---|
| `duvida_de_uso` | Dúvida de uso | `bg-blue-500` | |
| `reembolso` | Reembolso | `bg-red-500` | exige nº do pedido |
| `cancelamento_de_compra` | Cancelamento de compra | `bg-orange-500` | |
| `cancelamento_de_assinatura` | Cancelamento de assinatura | `bg-amber-500` | |
| `reclamacao_vsl` | Reclamação VSL | `bg-purple-500` | **sim** |
| `troca_de_endereco` | Troca de endereço | `bg-cyan-500` | |
| `embalagem_danificada` | Embalagem danificada | `bg-rose-500` | |
| `duvida_de_envio` | Dúvida de envio | `bg-indigo-500` | |
| `ingredientes` | Ingredientes | `bg-emerald-500` | |
| `duvidas_geral` | Dúvidas geral | `bg-slate-400` | |
| `outro` | Outro (descrever) | `bg-lime-500` | **sim** |

Regras de formatação (`formatContactReason`): motivo ausente ou `nao_informado` →
"Não informado"; motivo com nota → `"{label} — {nota}"`; **`outro` vira "Outro"**
em relatório (o "(descrever)" é instrução de formulário, não rótulo). Limite da
nota: 200, espelhando `services_contact_reason_note_check`.

---

## 4. `/workspace/reembolsos` — Meus Reembolsos

**Arquivo:** `src/pages/agent/Reembolsos.tsx` · **Fonte:** RPC
`my_refunds_with_refunded_value()` (`useMyRefundsQuery`), que já traz
`refunded_value` calculado no banco (vem como `string` ou `number` e o hook
normaliza para `number`).

**Cabeçalho:** "Meus Reembolsos" + subtítulo "Acompanhe seus pedidos em aberto e o
histórico de reembolsos concluídos." + botão `Plus` "Novo Reembolso".

Cartão "Visão geral" com "Carregando..." no canto enquanto carrega, e duas abas
(`Tabs defaultValue="open"`):

### 4.1 Filtros (compartilhados pelas duas abas)

| Controle | Padrão | Comportamento |
|---|---|---|
| Buscar por e-mail | vazio | ícone `Search`, placeholder "Buscar por e-mail...", `includes` em memória |
| Data inicial | vazio | `title` "Data inicial (solicitação)" |
| Data final | vazio | `title` "Data final (solicitação)" |
| Limpar | aparece com qualquer filtro | ghost, ícone `X`, "Limpar" |

**Detalhe que importa:** na aba "Em Aberto" as datas filtram `request_date`; na
aba "Histórico/Concluídos" filtram `completion_date`. O `title` do campo continua
dizendo "solicitação" nas duas — é uma imprecisão de hoje. `[DECISÃO]`

Contador por aba: "{n} registro(s)" e, quando há filtro escondendo linhas,
"(de {total})" em `opacity-60`.

### 4.2 Aba "Em Aberto" (`completion_date` nulo)

Colunas: Solicitação (`dd/MM/yyyy`) · E-mail · Plataforma · Produto (`?? "—"`) ·
Pedido (`|| "—"`) · Status · Ações.

Status: badge `open` "Em Aberto"; quando o reembolso nasceu de um atendimento
(`service_id` presente) ganha um segundo badge `outline` com ícone `Headset` e o
texto "Do atendimento".

**Regra do "apagado até assumir":** `waiting = service_id && !picked_up_at`. A
linha inteira recebe `opacity-50 hover:opacity-100` e a ação muda:

| Estado | Botão |
|---|---|
| `waiting` | `secondary`, ícone `Hand`, "Assumir" → RPC `pick_up_refund(p_refund_id)` |
| já assumido, ou criado direto na aba | `default`, ícone `CheckCircle2`, "Concluir Reembolso" |

Toasts: "Reembolso assumido" / "Agora é com você — confira os dados e conclua
quando resolver."; erro "Erro ao assumir" + mensagem real.

Vazio: "Nenhum reembolso em aberto." ou, com filtro, "Nenhum reembolso encontrado
com os filtros aplicados."

### 4.3 Aba "Histórico/Concluídos"

Colunas: Solicitação · Conclusão · E-mail · Plataforma · Produto · Pedido · Tipo ·
Valor reembolsado · Motivo · Itens · Status · Ações.

- Valor: `formatUsdPtBr` = `"$ " + Intl.NumberFormat("pt-BR")` com 2 casas
  (**cifrão de dólar com separador brasileiro**). `null` → `—`. `[DECIDIDO — D4]`
  esta tela já estava certa: todo valor monetário do sistema é **dólar**. Na v2 a
  API devolve `{ amount, currency }` com `currency` fixo em `"USD"`, e o front
  formata pela moeda recebida — assim rótulo e dado não podem divergir. As duas
  contradições reais estavam do lado da gestora e já foram corrigidas no legado em
  26/09/2026 (ver `21-frontend-outras-areas.md` §3.6).
- Motivo: truncado em `max-w-[360px]`, com `title` completo no hover.
- Itens: "Sim" / "Não".
- Status: badge padrão "Concluído".
- Total: no topo direito da aba, "Total reembolgado: {valor}" — literalmente
  "Total reembolsado: {formatUsdPtBr(soma)}", somando
  `refunded_value ?? refund_value ?? 0` **das linhas filtradas**. `[SERVIDOR]`
- Ações: lápis (reabre o `CompleteRefundDialog` em modo edição) e lixeira com
  `AlertDialog` "Excluir reembolso?" / "Esta ação não pode ser desfeita. O registro
  será removido permanentemente."

Vazio: "Nenhum reembolso concluído ainda." / com filtro, mesma mensagem da outra aba.

**Paginação:** 15 por página, independente por aba, em memória, com reset ao
mudar filtro e *clamp* defensivo se a página ativa passar do total. Rodapé
"Página {p} de {t} • {n} registros" e no máximo 7 links numéricos.

### 4.4 `NewRefundDialog` — "Novo reembolso"

Validação com `zod` + `react-hook-form`, `mode: "onChange"`; o botão "Salvar" só
habilita com o formulário válido. Descrição: "Registre um novo pedido de reembolso."

| Campo | id | Tipo | Obrigatório | Regra / mensagem de erro |
|---|---|---|---|---|
| E-mail | `refund-email` | `email` | sim | `trim().email()` máx. 255 → "E-mail inválido". `[DECIDIDO — D6]` o `trim` fica; **caixa alta e baixa não são normalizadas** — o valor vai como digitado, e é a coluna gerada do banco que serve à busca e à duplicidade |
| Data da solicitação | `refund-request-date` | `date` | sim | `^\d{4}-\d{2}-\d{2}$` → "Data inválida". **Padrão: hoje-SP** |
| Produto | — | `Select` | sim | 75 produtos (`REFUND_PRODUCTS`) → "Selecione o produto" |
| Plataforma de venda | — | `Select` | sim | `SALES_PLATFORMS` (8 valores) → "Selecione a plataforma". **Padrão: "Nenhum"** |
| Número do pedido | `refund-order-id` | `text` | sim | mín. 1, máx. 100, placeholder "Ex: 12345" → "Informe o número do pedido" |
| Canal | — | `Select` | não | `Nenhum`, `Clickbank`, `Email`, `SMS`. Padrão "Nenhum" |

`SALES_PLATFORMS` do reembolso **não tem `PagAmerican`**: `Nenhum`, `Cartpanda`,
`CartCandy`, `Buygoods`, `ClickBank`, `Digistore24`, `SalesBound`, `LogiCall`.
Divergência real com a lista de plataformas do atendimento (que tem 9). `[DECISÃO]`

Escrita: RPC `create_refund(p_customer_email, p_request_date, p_sales_platform,
p_order_id, p_product, p_channel)`; "Nenhum" é convertido em `null` para plataforma
e canal. `[DECIDIDO — D5]` Isso **conflita** com a decisão de preservar "Nenhum" e
vazio como coisas diferentes: a conversão apaga a distinção nos registros novos. A
v2 deve enviar o valor escolhido como texto; o que fazer com a diferença é decisão
posterior, mas destruí-la na escrita não é. Ver Lacuna 17. Sucesso: "Reembolso registrado" / "Seu registro foi salvo com sucesso.".
Erro: "Erro ao registrar" + mensagem real. O diálogo reseta ao fechar.

### 4.5 `CompleteRefundDialog` — concluir e editar

Mesmo componente para concluir e para editar (`title`/`description` são props;
o padrão é "Concluir reembolso" / "Defina a data de conclusão e ajuste o tipo final
do reembolso."). Bloco "Resumo" no topo: `{customer_email} • Pedido {order_id}`,
e, quando quem conclui não é o dono, "Agente: {ownerName}" (usado pela aba Alertas
da gestora).

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| Data de conclusão | `date` | sim | `^\d{4}-\d{2}-\d{2}$` → "Informe a data de conclusão" |
| Valor do reembolso | texto com prefixo `$` e `inputMode="decimal"` | sim | máscara `sanitizeUsdInput`: só dígitos e **um** ponto, máx. 2 decimais. Regex `^\d+(\.\d{1,2})?$` → "Use somente números (ex: 25 ou 25.50)". Placeholder "0.00" |
| Tipo final | `Select` | sim | **20 opções de 5% em 5%**: `05%`, `10%`, … `100%` (dois dígitos com zero à esquerda). Placeholder "Selecione (ex: 25%)" → "Selecione um percentual válido" |
| Motivo | `Select` | sim | 15 opções, lista abaixo. Placeholder "Selecione o motivo" → "Selecione um motivo" |
| Itens | `Switch` | — | rótulo "Itens" + "Habilitado = Sim • Desabilitado = Não", `aria-label` "Itens devolvidos" |

**Motivos de reembolso (15, ordem exata):** Insatisfação com o produto ·
Não reconhece a compra · Compra duplicada · Cobrança recorrente · Produto não
funcionou como esperado · Atraso na entrega/acesso · Arrependimento de compra ·
Dificuldade de uso · Problemas técnicos · Compra em excesso · Indicação médica /
efeitos colaterais · Risco de chargeback · Reclamação VSL / Propaganda ·
Follow up (sem motivo declarado) · Outros.

Valor pré-existente fora das listas (dado histórico) cai para vazio, obrigando a
reescolher. Botões "Cancelar" / "Concluir" → "Salvando...".

Escrita: `UPDATE refunds { completion_date, refund_value, refund_type, reason,
items_returned }`. Concluir → "Reembolso concluído" / "O registro foi atualizado.";
editar → "Reembolso atualizado" / "As alterações foram salvas.". Erros: "Erro ao
concluir" / "Erro ao atualizar" + mensagem real. As duas mutações escrevem
**exatamente os mesmos campos** — a diferença é só o toast.

---

## 5. `/workspace/metricas` — Minhas Métricas

**Arquivo:** `src/pages/agent/MinhasMetricas.tsx` · **Fonte:** RPC
`agent_my_metrics(from_date, to_date)` (um único objeto com ~30 campos).
Tela de leitura: não escreve nada.

### 5.1 Período

- Presets (ordem): "Hoje" · "Esta semana" (semana começa **segunda**) · "Este mês"
  · "Últimos 30 dias" (**padrão**, `today-29 … today`).
- `DateRangePicker` à direita para intervalo livre.
- Preset ativo é detectado comparando as datas, não guardando a escolha.
- Rodapé do cabeçalho: "Mostrando {dd/MM/aaaa} até {dd/MM/aaaa}".
- Saudação: "Olá, {primeiro nome}!" (`fullName` vazio → "Agente"), título
  "Minhas Métricas".

### 5.2 Cartão principal — "Seu ritmo"

- Número grande `text-5xl`: `my_rate` com **uma casa decimal e vírgula**
  (`fmtRate` = `toFixed(1).replace(".", ",")`), legenda "atendimentos por dia
  trabalhado".
- "{total} no total, em **{n} dia(s)**  que você trabalhou."
- Nota fixa: "Contamos por dia trabalhado, não pelo total do mês — assim folga e
  férias não contam contra você."
- Coluna direita: duas `RateBar` — "Você" (verde `bg-emerald-500` quando
  `my_rate >= team_median_rate`, senão `bg-primary`) e "Metade do time faz até"
  (`bg-muted-foreground/50`). Escala comum = `max(myRate, medianRate, 0.1) * 1.15`.
- Explicação da mediana (texto fixo, importante porque foi decisão de produto):
  "A referência é a **mediana**: metade do time está acima dela e metade abaixo.
  Usamos ela no lugar da média porque um único colega muito acima não distorce o
  alvo de todo mundo." + quando não é líder: "Quem mais atendeu no período foi
  **{team_leader_name}**, com {team_leader_count}."

**Faixa de ação (`getHeadline`)** — cinco tons, com cor de fundo e ícone próprios.
A regra de produto é: *toda mensagem termina em algo contável que a pessoa pode
fazer*. Textos literais:

| Tom | Condição | Título | Mensagem |
|---|---|---|---|
| `empty` | `total === 0` | "Nada registrado neste período" | "Escolha outro período acima, ou comece a registrar — o primeiro atendimento do dia é o que destrava o resto." |
| `leader` | `is_leader` | "Você foi quem mais atendeu no período" | "{total} atendimentos em {n} dia(s) trabalhado(s). Seu ritmo é {rate} por dia. Segura esse ritmo." |
| `onpar` | `median <= 0` | "Seu ritmo é {rate} por dia trabalhado" | "{total} atendimentos em {n} dia(s). Ainda não dá para comparar com o time neste período." |
| `onpar` | `gap <= 0` e `aheadPct <= 0` | "Você está no mesmo ritmo do time" | "{rate} por dia trabalhado, igual à metade do time. Mais 1 por dia já te coloca na frente." |
| `ahead` | `gap <= 0` e `aheadPct > 0` | "Você está {aheadPct}% acima do time" | "Seu ritmo é {rate} por dia trabalhado. A metade do time faz {median}. Continue assim." |
| `action` | `gap > 0` | "Faltam {gap} por dia para alcançar o time" | "Você faz {rate} por dia trabalhado e a metade do time faz {median}." + se `days_remaining >= 2`: " São cerca de {ceil(gap*restantes)} atendimentos nos {restantes} dias que faltam no período." |

Cores dos tons: `leader` âmbar, `ahead` esmeralda, `onpar` neutro, `action`
destaque/primário, `empty` neutro. Ícones por tom (`Trophy`/`TrendingUp`/`Minus`/
`Target`-equivalente/`BarChart3`).

### 5.3 Três KPIs de apoio

| KPI | Valor | Dica |
|---|---|---|
| Total no período | `total_interactions` | "{new_services} atendimentos novos e {follow_ups} follow-ups (retornos em tickets que já existiam)." |
| Seu melhor dia | `best_day_count` (ou `—`) | "Foi em {dd/MM}. É a prova de que esse número cabe no seu dia." / sem dado: "Sem nenhum dia com atendimento neste período." |
| Como você vem indo | `trend_label` ("Evoluindo"/"Estável"/"Regredindo") ou **"Sem leitura"** quando `trend_reliable === false` | confiável: "A segunda metade do período está {|trend_pct|}% acima/abaixo da primeira, comparando ritmo por dia trabalhado." · não confiável: "Poucos dias trabalhados para comparar o começo com o fim do período sem virar chute." |

Cor da tendência: `trend_pct >= 10` esmeralda com `TrendingUp`; `<= -10`
`text-destructive` com `TrendingDown`; entre os dois, neutro com `Minus`.

### 5.4 Gráfico "Seus dias no período"

- Legenda: "Cada barra é um dia. A altura é quanto você fez; a linha tracejada é
  o ritmo do time."
- `BarChart` empilhado (recharts), `stackId="dia"`, duas séries: `novos`
  (`--chart-1`, roxo) e `followups` (`--chart-6`, turquesa), com `stroke` na cor
  do card (separador de 1,5 px) e `maxBarSize 38`.
- `ReferenceLine` horizontal em `team_median_rate` quando > 0, tracejada, rótulo
  "Ritmo do time: {rate}".
- Legenda traduzida: "Novos atendimentos" / "Follow-ups".
- Altura fixa 320 px; carregando → `Skeleton`; vazio → "Nenhum dado no período".

### 5.5 Reembolsos (3 KPIs)

| KPI | Campo | Dica |
|---|---|---|
| Em aberto | `refunds_open` | "Pedidos que você abriu no período e ainda não foram concluídos." |
| Concluídos | `refunds_done` | "Pedidos que receberam baixa dentro do período." |
| Valor devolvido | `refunds_total_value` (formato USD) | "Soma dos reembolsos concluídos no período." |

### 5.6 Acordeão "Ver detalhes — canal, plataforma e dia a dia" (fechado por padrão)

Aviso de produto no topo (não remover, é o que evita o mal-entendido de cobrança):
"Esses cortes descrevem de onde vieram os atendimentos. Quem escolhe o canal e a
plataforma é o cliente, então eles servem para entender o período — não para
cobrar de você."

- "Por canal" e "Por plataforma": `RankingChart` — barras horizontais em **uma
  única matiz** (`--chart-1`), decisão consciente de acessibilidade para
  daltonismo (ranking de magnitude não precisa de cor categórica). 240 px.
- "Dia a dia": tabela Data · Total · Novos · Follow-ups · **Leitura**, 10 linhas
  por página. A "Leitura" compara o dia contra o **próprio** ritmo:

| Condição | Texto | Badge |
|---|---|---|
| `value === 0` | "Sem atividade" (linha com `opacity-50`) | `open` |
| `myRate <= 0` | "—" | `secondary` |
| `value > myRate * 1.2` | "Dia forte" | `success` |
| `value < myRate * 0.8` | "Dia fraco" | `destructive` |
| resto | "No seu ritmo" | `secondary` |

Rodapé: "Mostrando {a}–{b} de {n} dia(s)" + "Anterior" / "Página {p} de {t}" /
"Próxima" (`aria-label` "Página anterior" / "Próxima página").

---

## 6. `/workspace/transferencias` — Transferências

**Arquivo:** `src/pages/agent/Transferencias.tsx` · **Fonte:** RPC
`my_transfer_history()`.

Cabeçalho: "Transferências" + "Tickets que você recebeu e o histórico completo de
encaminhamentos."

Três cartões de contagem (calculados no cliente sobre o array `[SERVIDOR]`):
"A resolver" (destacado com `border-primary/40 bg-primary/5` quando > 0, ícone
`Inbox`) · "Recebidos" (`ArrowDownLeft`) · "Enviados" (`Send`).

### 6.1 Aba "A resolver" (padrão)

Lógica (hoje no cliente, `[SERVIDOR]`): transferências com `role === "received"`,
`transfer_status === "accepted"`, cujo **status efetivo do ticket** (via
`useStatusTracking`, ou seja via follow-ups) não é "Concluído". Quando há várias
transferências para o mesmo `service_id` (peer-to-peer + reassign do gestor
depois), mantém só a mais recente. Ordenação: `created_at` desc.

Título do cartão: "Tickets recebidos para você atender". Colunas: Recebido em
(`dd/MM/aaaa HH:mm` SP) · Cliente · Produto · De · **Origem** · Ação.

Origem distingue quem mandou:

| Condição | Badge |
|---|---|
| `assigned_by_manager_id` presente | `outline` azul, ícone `Shield`, "Gestor" |
| senão | `outline` neutro, ícone `ArrowDownLeft`, "Agente" |

Ação: botão "Acompanhar" com ícone `PlayCircle` → abre o `StatusTrackingDialog`
do ticket (mesmo diálogo da tela de Atendimentos).

Vazio: "Nenhum ticket pendente para resolver. Tudo em dia. 🎉" · carregando:
"Carregando..." na própria linha da tabela.

### 6.2 Aba "Histórico"

Filtros: Buscar (placeholder "E-mail do cliente ou nome do agente", casa nos dois
campos) · Tipo (`Todos` / `Eu enviei` / `Recebidos`) · Status (`Todos` /
`Pendente` / `Aceito` / `Recusado` / `Cancelado`) · botão ghost "Limpar" quando há
filtro. Rótulos dos campos em `text-xs`: "Buscar", "Tipo", "Status".

Colunas: Data · Tipo · Cliente · Produto · Com · Status · Mensagem / Resposta.

- Tipo: badge `outline` com `ArrowUpRight` "Enviado" ou `ArrowDownLeft` "Recebido".
- Status (cores fixas, semânticas):

| status | rótulo | classes |
|---|---|---|
| `pending` | Pendente | `bg-amber-500/15 text-amber-700 dark:text-amber-400` |
| `accepted` | Aceito | `bg-emerald-500/15 text-emerald-700 dark:text-emerald-400` |
| `declined` | Recusado | `bg-red-500/15 text-red-700 dark:text-red-400` |
| `cancelled` | Cancelado | `bg-muted text-muted-foreground` |

- Mensagem/Resposta: "**Msg:** {message}" e/ou "**Resp:** {response_note}",
  truncados com `title` completo; nada → `—`.

Vazio: "Nenhuma transferência encontrada." Sem paginação nesta tela (a lista vem
inteira). `[SERVIDOR]`

---

## 7. `/workspace/radar` — Radar de pendências

**Arquivo:** `src/pages/agent/Radar.tsx` · **Fontes:** `my_radar_items()` (itens +
`summary` + `today` do servidor) e `my_radar_summary()` (badge da sidebar).

Cabeçalho: ícone `Radar` + "Radar", com a explicação (texto de produto, mantém-se):
"Todo cliente que depende de uma ação sua entra aqui — devolução, RMA, reenvio,
endereço, rastreio, On Hold, retorno da logística. Cada caso tem uma data de
próximo acompanhamento: enquanto não for resolvido, ele não sai do radar."
Botões: "Exportar" (`Download`, desabilitado enquanto carrega) e "Novo caso" (`Plus`).

### 7.1 Quatro cartões clicáveis (trocam o recorte)

| Cartão | Fonte | Cor |
|---|---|---|
| Atrasados | `summary.overdue` | `text-destructive`, ícone `AlertTriangle` |
| Para hoje | `summary.due_today` | `text-status-open`, ícone `CalendarClock` |
| Próximos 7 dias | `summary.due_week` | `text-primary`, ícone `CalendarDays` |
| Em aberto | `summary.open` | `text-muted-foreground`, ícone `Inbox` |

Os três primeiros são **disjuntos** (atrasado, hoje e futuro não se sobrepõem).
Cartão é `role="button" tabIndex=0 aria-pressed`, responde a Enter e Espaço, e
ganha `border-primary ring-1 ring-primary/30` quando ativo.

### 7.2 Recortes de prazo (`Bucket`) e filtros

Rótulos: `Atrasados` · `Para hoje` · `Próximos 7 dias` · `Todos em aberto`
(**padrão**) · `Fechados (30 dias)` · `Todos`.

Regra de cada recorte (hoje no cliente `[SERVIDOR]`): `overdue` = aberto e
`is_overdue`; `today` = aberto e `is_due_today`; `week` = aberto com
`days_overdue` entre `-7` e `-1`; `open` = status aberto; `closed` = status
fechado; `all` = tudo.

Outros filtros: busca livre (placeholder "Buscar por e-mail, pedido, produto ou
ação...", procura em `client_email`, `order_number`, `product`, `action_needed`,
**`notes`**) · Tipo (`aria-label` "Tipo de acompanhamento", "Todos os tipos" + 9
tipos) · Status (`aria-label` "Status", "Todos os status" + 6 status).

### 7.3 Tabela

Colunas: Prazo (150 px) · Cliente / Pedido · Tipo (`hidden lg:table-cell`) ·
Ação necessária (`hidden xl:table-cell`) · Status (170 px) · menu (52 px).

- Prazo usa `dueLabel(next_follow_up_date, today)` — **relativo ao "hoje" que o
  servidor mandou, não ao relógio do browser**: "Atrasado {n} dia(s)" · "Hoje" ·
  "Amanhã" · "Em {n} dias" · `—`. Caso fechado mostra "Fora do radar".
- Ação necessária truncada com `title`; a última ação aparece abaixo, também com
  `title`.
- Status: `Badge` com a variante do vocabulário (7.5).
- Menu `MoreHorizontal` (`aria-label` "Ações do caso") com: "Registrar ação"
  (ícone `Radar`), "Editar cadastro" (`Pencil`), "Excluir" (`Trash2`, em vermelho).

**Estados:** carregando → 4 `Skeleton` de 12 px; **erro** → parágrafo em
`text-destructive` com a mensagem do Supabase (é uma das poucas telas que já
mostra erro de leitura — a v2 generaliza isso); vazio com radar limpo → ícone +
"Seu radar está limpo." + "Registre o primeiro cliente que depende de uma ação
sua." + botão "Novo caso"; vazio por filtro → "Nenhum caso com os filtros
aplicados." + "Troque o recorte de prazo ou limpe a busca."

Rodapé: "Mostrando {n} de {total} casos · {recorte em minúsculas}. Casos resolvidos
ou cancelados há mais de 30 dias saem desta lista." Sem paginação. `[SERVIDOR]`

### 7.4 `RadarItemDialog` — novo caso / editar cadastro

Título "Novo caso no Radar" ou "Editar caso" (ícone `Radar`). Descrições
diferentes:
- novo: "Registre o cliente que depende de uma ação sua. Data de criação, agente e
  status saem do sistema."
- edição: "Corrija os dados do cliente e do pedido. Para mudar o status ou a data,
  registre uma ação."

| Campo | id | Obrigatório | Detalhe |
|---|---|---|---|
| E-mail do cliente * | `radar-email` | sim | validação `^[^\s@]+@[^\s@]+\.[^\s@]+$`, placeholder "cliente@email.com" |
| Nº do pedido | `radar-order` | **sim, exceto quando o tipo é "Outra pendência"** | placeholder "Ex.: 1234567" |
| Produto | `radar-product` | não | `Select` com o catálogo de produtos |
| Tipo de acompanhamento * | `radar-kind` | sim | 9 tipos com bolinha de cor; **padrão `logistica`**; a dica do tipo aparece abaixo |
| Ação necessária * | `radar-action` | sim | `Textarea` 2 linhas, "O que precisa ser feito para fechar este caso?" |
| Data do próximo acompanhamento * | `radar-next` | sim **só na criação** | `type=date`, `min = hoje-SP`. **Sugerida automaticamente** por dias úteis do tipo; ao trocar o tipo a sugestão recalcula, a menos que o agente já tenha mexido na data. Dica: `suggestionHint(tipo)` ou "Data definida por você." |
| Observações | `radar-notes` | não | `Textarea` 2 linhas, "Contexto que o próximo acompanhamento precisa saber (opcional)" |

Na **edição a data não aparece de propósito**: mudar prazo tem de deixar rastro no
histórico, e isso só acontece registrando uma ação. `[MANTER]`

Botões "Cancelar" / "Registrar no Radar" (ou "Salvar") → "Salvando...".
Toasts: criação "Caso no Radar" / "Próximo acompanhamento em {dd/mm/aaaa}.";
edição "Caso atualizado" / "Os dados do cadastro foram salvos."; erro "Erro ao
registrar" ou "Erro ao salvar" + mensagem do Supabase.

### 7.5 Vocabulário do Radar (valores reais)

**Tipos (9)** — `code`, rótulo, cor, dias úteis sugeridos, dica:

| code | rótulo | cor | dias | dica |
|---|---|---|---|---|
| `devolucao` | Devolução de produto | `bg-amber-500` | 5 | "Cliente vai devolver ou já postou a devolução — acompanhar até chegar." |
| `rma` | Envio/acompanhamento de RMA | `bg-orange-500` | 3 | "RMA solicitado ou emitido — acompanhar até o parceiro processar." |
| `reenvio` | Reenvio de produto | `bg-blue-500` | 5 | "Reenvio prometido ao cliente — acompanhar até postar e entregar." |
| `reenvio_endereco` | Reenvio por endereço incorreto ou incompleto | `bg-cyan-500` | 3 | "Pedido voltou ou parou por endereço ruim — confirmar dados e reenviar." |
| `correcao_endereco` | Alteração/correção de endereço | `bg-teal-500` | 2 | "Endereço a corrigir antes do envio — confirmar com a logística." |
| `novo_rastreio` | Acompanhamento de novo código de rastreio | `bg-indigo-500` | 3 | "Código novo emitido — acompanhar movimentação até a entrega." |
| `on_hold` | Cliente da lista de On Hold | `bg-purple-500` | 2 | "Pedido retido — acompanhar até liberar ou cancelar." |
| `logistica` | Aguardando retorno da logística/parceiros | `bg-rose-500` | 2 | "Bola está com o parceiro — cobrar até a resposta chegar." |
| `outros` | Outra pendência | `bg-slate-400` | 3 | "Qualquer pendência que precise de acompanhamento e não se encaixe acima." |

**Status (6):** `aberto` "Aberto" (`new`, aberto) · `em_andamento` "Em andamento"
(`in-progress`, aberto) · `aguardando_cliente` "Aguardando cliente" (`open`,
aberto) · `aguardando_logistica` "Aguardando logística" (`open`, aberto) ·
`resolvido` "Resolvido" (`success`, **fecha**) · `cancelado` "Cancelado"
(`secondary`, **fecha**).

### 7.6 `RadarActionDialog` — registrar ação

Mostra ficha do caso (tipo, status atual, prazo com `dueLabel`) e a **timeline**
(`radar_item_events`, carregada só ao abrir): por evento, badge do status, ação,
data/hora SP e autor.

| Campo | Obrigatório | Detalhe |
|---|---|---|
| Status | sim | `Select` com os 6 status; inicial = status atual se aberto, senão `em_andamento` |
| O que foi feito * | sim | `Textarea` 3 linhas, "Ex.: cobrei o parceiro pelo status do RMA, sem resposta ainda." |
| Data do próximo acompanhamento * | sim **só se o status escolhido mantém o caso aberto** | `min = hoje-SP`, sugestão por tipo, dica "Data definida por você." |

Quando o status fecha o caso, o campo de data desaparece e no lugar aparece:
"Caso {status} sai do radar e não pede mais data de acompanhamento. Se voltar,
basta registrar outra ação com status em aberto."

Toast: "Ação registrada" + "Próximo acompanhamento em {data}." ou "Caso {status}
e fora do radar." Erro: "Erro ao registrar" + mensagem.

### 7.7 Exclusão

`AlertDialog` "Excluir este caso do Radar?" com a descrição composta:
"{e-mail}{ · pedido N}. O histórico de acompanhamento vai junto e não há como
recuperar. Se o caso terminou, prefira registrar uma ação como \"Resolvido\" —
assim fica o rastro do que foi feito." Botão vermelho "Excluir" → "Excluindo...".
Sucesso: "Caso excluído" / "O caso e o histórico dele foram removidos."

### 7.8 Exportação do Radar

`exportRadar` gera `.xlsx` **no cliente** com 15 colunas (E-mail, Nº do pedido,
Produto, Tipo, Ação necessária, Criado em, Próximo acompanhamento, Prazo, Status,
Observações, Agente, Última ação, Última ação em, Nº de eventos, Fechado em),
4 linhas de cabeçalho mescladas (título, filtros aplicados, total, "Gerado em"),
larguras de coluna definidas, e nome de arquivo
`radar_{agente}_{recorte}_{tipo}_{aaaa-mm-dd}.xlsx`. Exporta **exatamente o que
está filtrado na tela**. Toast: "Planilha gerada" / "{n} caso(s) exportado(s)."
`[SERVIDOR]` na v2 (contrato §7, módulo `exports`) — mas o conteúdo e o cabeçalho
têm de ser idênticos.

---

## 8. `/workspace/pedidos-espera` — Pedidos em Espera

**Arquivo:** `src/pages/agent/PedidosEspera.tsx` · **Fontes:** `my_held_orders(p_status)`
e `my_held_orders_daily_metrics()`.

Cabeçalho: ícone `PackageSearch` + "Pedidos em Espera" + "Gerencie cada pedido
retido atribuído a você. Clique em um pedido para mudar o status, marcar uma
pendência e registrar o que foi feito. Concluir um pedido conta para a sua meta
diária."

### 8.1 Métricas do dia (meta própria, separada de Atendimentos)

| Cartão | Fonte | Detalhe |
|---|---|---|
| Concluídos hoje | `confirmed_today` | badge `success` "🏆 Meta Batida!" quando `>= goal` |
| Faltam para a meta | `max(0, goal - confirmed_today)` | |
| Pendentes | `pending` | rodapé "Ainda não concluídos" |

**Meta vem do servidor** (`metrics.goal`, padrão 30) — diferente da meta de
Atendimentos, que é derivada no cliente. Barra "Progresso da meta" com as mesmas
três faixas de cor (`<60%` destrutivo, `<90%` `status-open`, resto
`status-success`). **Esta tela não tem confete nem som** — a celebração é só de
Atendimentos. `[DECISÃO]` se deve ganhar.

### 8.2 Filtros

- Status, como botões com contagem: `Todos` (**padrão**) · `Novo` ·
  `Em Andamento` · `Concluído`, cada um com o número ao lado em `opacity-70`.
- "Motivo do On Hold": `Select` montado **dinamicamente** dos motivos presentes nos
  pedidos do agente, com contagem, ordenado por contagem desc e depois alfabético
  pt-BR. Primeira opção "Todos os motivos". `[SERVIDOR]`
- "Pendência": `Select` com "Todas as pendências", "Com pendência (n)",
  "Sem pendência (n)" e as 4 tags com contagem.
- Botão ghost "Limpar filtros" (`RotateCcw`) quando motivo ou pendência estão ativos.
- Contador no cabeçalho do cartão: "{n} pedido(s)" ou "{n} de {total} pedido(s)".

### 8.3 Cartão de pedido (cada pedido é um `<button>` que abre o diálogo)

Quatro linhas, nessa ordem de importância:
1. Número do pedido em `font-mono text-xl font-bold` (ou "Sem número"), badge
   `secondary` com o `dyna_code` (ou "Devolução" quando é o código de devoluções),
   "RMA: {rma}" quando existe; à direita, badge `destructive` com `Flag` +
   tag de pendência, e badge de status.
2. Motivos do On Hold como badges `outline` âmbar + idade do pedido com ícone `Clock`.
3. Dois blocos lado a lado: **Produtos** ("({n} item(ns) · {u} un.)", cada item com
   `{qty}×`, nome e SKU em `font-mono`) e **Endereço** (`<address>` com rua,
   localidade e país).
4. Cliente: nome + e-mail em muted, e contagem de eventos com ícone
   `MessageSquare` quando > 0.

Badges de status: `novo` → `new` "Novo" · `em_andamento` → `in-progress` "Em
Andamento" · `concluido` → `done` "Concluído".

**Estados:** carregando → 3 `Skeleton` de 32; erro → ícone `AlertCircle` + "Não foi
possível carregar os pedidos."; vazio → `CheckCircle2` verde + "Nenhum pedido
atribuído a você." ou "Nenhum pedido neste filtro."

### 8.4 `HeldOrderTrackingDialog`

Ficha completa do pedido (motivos, idade, RMA, produtos, endereço, campos extras de
devolução: "Recolocados:", "Danificados:" em vermelho, "Obs.:"), bloco "Status
atual:" com badges, **histórico** (`held_order_events_for`, com status, tag, data/hora
SP, autor e observação; vazio → "Nenhum registro ainda. Adicione o primeiro abaixo.")
e o formulário "Novo registro":

| Campo | Padrão | Valores |
|---|---|---|
| Status | `em_andamento` | Novo · Em Andamento · Concluído |
| Pendência | "Sem pendência" | Sem pendência · Pedido não encontrado · Aguardando cliente · Aguardando transportadora · Outra pendência |
| Observação | vazio | `Textarea` 3 linhas, "Descreva o que foi feito neste pedido..." |

O valor de pendência enviado **sempre sobrescreve** a tag atual. Escrita:
`set_held_order_status(p_order_id, p_status, p_note, p_pending_tag)`; invalida
`["held-orders","mine"]`, as métricas e a timeline do pedido.
Toast: "Registro salvo" + "Pedido marcado como concluído." ou "Status atualizado
para \"{rótulo}\"." Erro: "Erro ao registrar" + mensagem.

**Dicas das tags** (`HELD_ORDER_PENDING_TAG_HINT`) existem no código e hoje **não
são exibidas** nesta tela: "Não localizei o pedido do cliente", "Cliente ainda não
respondeu à confirmação de endereço", "Aguardando retorno da transportadora",
"Outra pendência operacional (detalhe na observação)". `[DECISÃO]` mostrar ou remover.

---

## 9. `/workspace/base-suporte` — Base de Suporte (consulta)

**Arquivos:** `src/pages/agent/BaseSuporte.tsx` (5 linhas) →
`src/features/support-base/components/SupportBaseScreen.tsx`. A mesma tela é usada
pelo time de copy; quem **edita** é a gestora em `/dashboard/base`.

Cabeçalho: "Base de Suporte" + "Produtos, mensagens prontas e procedimentos —
sempre a versão mais atual." + menu "Links rápidos" (`Link2`), um dropdown com os
links agrupados por categoria, abertos em nova aba (`target="_blank"
rel="noopener noreferrer"`).

**Abas agrupadas** em três famílias rotuladas, com contagem em badge:

| Grupo | Aba | valor | ícone | contagem |
|---|---|---|---|---|
| Catálogo | Produtos (E-mail) | `produtos` (**padrão**) | `Package` | nº de produtos ativos |
| Catálogo | Produtos (SMS) | `sms` | `Smartphone` | nº de brands ativas |
| Mensagens prontas | Respostas SMS | `respostas` | `MessageSquareText` | nº de respostas ativas |
| Mensagens prontas | E-mails Clickbank | `emails` | `Mail` | nº de templates (fixo no código) |
| Procedimento | Reembolso | `reembolso` | `HandCoins` | — |

**A aba escolhida vive na URL** (`?aba=...`, `setSearchParams` com `replace`), para
o agente poder deixar "Respostas SMS" fixa em outra guia e o F5 não voltar para
Produtos. Valor inválido cai no padrão. `[MANTER]` — e a v2 tem de preservar o
nome do parâmetro (`aba`) e os valores, porque são links salvos.

**Fontes:** `support_products`, `support_sms_brands`, `support_sms_replies` via
`supabase.from(...)` com `.eq("ativo", true)` e ordenação `sort_order, nome`
(RLS em vez de RPC). `staleTime` de 5 minutos (conteúdo editorial).
E-mails Clickbank e o playbook de reembolso são **fixos no código**
(`src/features/support-base/data/emailTemplates.ts` e `refundPlaybook.ts`).

**Cada painel** tem: `PanelToolbar` (busca com placeholder próprio), filtros,
`PanelStates` (carregando / vazio com descrição), `PanelPagination` (rótulo
singular/plural por tipo: "produto/produtos", "brand/brands",
"mensagem/mensagens", "template/templates") e `CopyButton` nos textos.

| Painel | Busca | Filtros | Ordenação |
|---|---|---|---|
| Produtos (E-mail) | "Buscar produto, função, plataforma ou nicho…" | Estrutura (`nova`/`antiga`, com contagem) + Nicho ("Todos os nichos") | nova antes de antiga, depois `sort_order`/nome |
| Produtos (SMS) | "Buscar brand, nome no sistema ou número…" | Estrutura | idem |
| Respostas SMS | "Buscar mensagem ou situação…" | Categoria ("Todas as categorias") | `sort_order` |
| E-mails Clickbank | "Buscar template ou situação…" | Categoria | ordem do arquivo |
| Reembolso | — | — | procedimento em passos |

Avisos de conteúdo (textos de produto, precisam sobreviver):
- Produtos: "**Confira a estrutura antes de enviar links:** … **Antiga** (CartPanda /
  ClickBank / Digistore). O selo …"
- Produtos (SMS): "**Nome no sistema** é como a brand aparece no sistema de
  suporte. Sempre …"

**Estrutura** (`Estrutura`): `nova` → "Nova estrutura", `antiga` → "Estrutura
antiga", com `EstruturaBadge` (versão curta e longa, `title` com o rótulo longo) e
`EstruturaFilter` (`aria-label` "Filtrar por estrutura"). **Bônus**: `simples` →
"Bônus simples", `super` → "Super bônus".

Vazio filtrado: "Ajuste a busca ou o filtro de estrutura." / "Ajuste a busca ou os
filtros de estrutura e nicho."

---

## 10. `/workspace/comece-aqui` — treinamento

> **Alterado — decisão D8 (01/10/2026).** Passa a se chamar **"Guia da plataforma"**, sem o
> bloco de progresso do `TrainingHero`; a seção `rotinas` saiu (as 2 linhas seguem no banco, filtradas
> na leitura); e o check-in da seção 10.2 foi removido. A v2 não reconstrói nenhum dos três.
>
> **02/10/2026:** o guia passa a mostrar só vídeo com link — sem cards "Em breve" — e sem o selo
> "Visto" e a barrinha de progresso do card. `watchedSeconds`/`completed` continuam, só para o player
> retomar de onde o agente parou.

**Arquivo:** `src/pages/agent/ComeceAqui.tsx` · **Fonte:** `useTrainingVideosQuery(userId)`.

Layout no estilo "prateleiras" (`TrainingHero` + uma `TrainingRow` por seção).

**Seções, na ordem, com subtítulo próprio:**

| seção | título | subtítulo |
|---|---|---|
| `welcome` | Boas-vindas | "Comece por aqui" |
| `atendimentos` | Atendimentos | "Tudo sobre o registro de atendimentos" |
| `reembolsos` | Reembolsos | "Como tratar reembolsos do começo ao fim" |
| `metricas` | Minhas métricas | "Entenda o seu desempenho" |
| `rotinas` | Rotinas do dia a dia | "Pequenas rotinas que fazem diferença" |

Seção sem vídeo é omitida. `TrainingHero` recebe total de vídeos, quantos foram
concluídos e o nome do agente.

`TrainingVideoDialog` toca o vídeo, grava progresso (`watchedSeconds`,
`completed`, `progressPct`) e oferece **"próximo vídeo"** — o próximo da lista
plana que tenha `videoUrl`.

**Estados:** carregando → hero de 280 px + 3 prateleiras de cards 280×200 em
`Skeleton`; erro → caixa vermelha "Não foi possível carregar os treinamentos.
Atualize a página em alguns instantes."; vazio → ícone `GraduationCap` +
"Nenhum vídeo publicado ainda" + "Os treinamentos aparecerão aqui assim que forem
disponibilizados."

> Nota: os estados desta tela usam cores Tailwind fixas (`bg-white`,
> `text-slate-800`, `border-red-200`) em vez dos tokens do tema — **quebra no modo
> escuro**. Correção de paridade visual, listada em "Propostas de emenda".

---

## 11. Componentes globais da área do agente

### 11.1 `PendingRefundsAlert` — modal bloqueante de reembolso atrasado

**Arquivo:** `src/features/refunds/PendingRefundsAlert.tsx`. Montado no layout, ou
seja **aparece em qualquer tela do workspace**.

- Regra (hoje no cliente `[SERVIDOR]`): reembolsos sem `completion_date` cuja
  `request_date` tem **≥ 24 h**.
- Abre **automaticamente** na primeira detecção e **não fecha** por Esc nem por
  clique fora (`onInteractOutside`/`onEscapeKeyDown` prevenidos) até o agente
  confirmar.
- Título "Reembolsos pendentes há mais de 24h"; descrição "Você tem **{n}**
  reembolso(s) aguardando atenção." (singular/plural correto).
- Lista com scroll (máx. 400 px): e-mail (ícone `Mail`), plataforma
  (`ShoppingBag`), produto (`Package`), "Pedido: {order_id}" em `font-mono`,
  "Canal: {canal}", "Solicitado em {dd/mm/aaaa}", e badge `destructive` com
  "Hoje" ou "{n}d atrás".
- Botão único: "Entendi, vou resolver". O reconhecimento é **estado em memória** —
  recarregar a página mostra o modal de novo. `[DECISÃO]` se deve virar
  persistência por dia, como a celebração da meta.

### 11.2 `AgentCheckInController` + `AgentCheckInDialog` — check-in de 2 h

**Arquivos:** `src/features/agent/check-in/*`.

Máquina de estados por dia-SP, persistida em
`localStorage["xmx:agent-checkin:{userId}"]` = `{firstInteractionAt,
acknowledgedCount, spDate}`:
- o **primeiro** evento `agent:interaction` do dia grava `firstInteractionAt`;
- o próximo check-in vence em `firstInteractionAt + 2h × (acknowledgedCount + 1)`;
- avaliação a cada 30 s (`setInterval`); vencido → busca o snapshot e abre;
- confirmar incrementa `acknowledgedCount`;
- virada de dia-SP zera tudo.

**Reembolso não dispara o evento de propósito** — só atendimento e follow-up
ancoram o timer.

O diálogo é **não dispensável**: renderiza primitivos Radix direto para suprimir o
X, o clique fora e o Esc. Toca `playWhoosh()` 80 ms depois de abrir.

Conteúdo: "Check-in" (rótulo) · "Olá {nome} 👋" · "Aqui está seu progresso recente.
Confirme para continuar." · bloco "Últimas 2 horas" com quatro contadores
(Atendimentos, Interações, Reembolsos, Concluídos) · bloco "No dia inteiro" com
"{n} atendimentos • {n} interações • {n} reembolsos • {n} concluídos" · botão
"Os dados estão corretos, vamos prosseguir" (desabilitado enquanto carrega,
mostrando `Loader2` + "Carregando…").

**Snapshot de hoje** (`useCheckInSnapshot`) faz **8 consultas `count` em paralelo**
contra `services`, `service_follow_ups` e `refunds`, com janela de 2 h e janela do
dia-SP (meia-noite SP = 03:00 UTC). "Reembolsos concluídos nas últimas 2 h" é
aproximação declarada, porque `completion_date` é `date` sem hora. `[SERVIDOR]`
Na v2 isso é **um** endpoint (`GET /metrics/me?window=checkin`), e o problema da
aproximação pode ser resolvido de verdade se o schema novo guardar o instante da
conclusão. `[DECISÃO]`

Em `DEV` existe um botão flutuante "🧪 Testar Check-In" (removido do bundle de
produção por `import.meta.env.DEV`).

### 11.3 `NotificationsBell` — o sino

**Arquivo:** `src/features/transfers/NotificationsBell.tsx` · **Fonte:** RPC
`my_transfer_notifications()`, com **`refetchInterval: 30_000`** (o contrato §4
manda trocar por push).

- Botão `Bell` com `aria-label` "Notificações"; contador vermelho no canto,
  mostrando "9+" acima de 9.
- **Som** (`playNotificationSound`) quando a contagem **aumenta**; a primeira carga
  é silenciosa de propósito (não dá "ding" no que já existia ao abrir o app).
- Popover 384 px: cabeçalho "Notificações" + "Encaminhamentos de tickets dos seus
  colegas"; lista com `divide-y`; carregando "Carregando..."; vazio "Nada por aqui."

**Dois tipos de item:**

`role === "inbox"` (alguém pediu para você continuar):
- "**{nome}** pediu pra continuar o ticket" + "{e-mail} · {produto}" + tempo
  relativo ("agora", "há {n}min", "há {n}h", "há {n}d").
- mensagem do colega, quando existe, em itálico entre aspas.
- ações: "Recusar" (ghost, `X`) e "Aceitar" (`Check`) → "Abrindo...".
- **Aceitar** faz `UPDATE ticket_transfers {status:"accepted", responded_at,
  recipient_seen_at}`, invalida `["transfer_notifications"]`, fecha o popover,
  toast "Aceito" / "Abrindo o atendimento do cliente {e-mail}." e navega para
  `/workspace?openTicket={service_id}` — o que abre o `StatusTrackingDialog` na
  outra tela. Esse contrato de URL é usado pelo produto e precisa continuar.
- **Recusar** abre um `Textarea` "Motivo (opcional)" (máx. **300**), com
  "Cancelar" e "Confirmar recusa" → "Enviando...". Grava `status:"declined"`,
  `response_note`. Toast "Recusado" / "Pedido marcado como recusado."
- Erros: toast "Erro" + mensagem (fallback "Não foi possível aceitar." /
  "Não foi possível recusar.").

`role === "response"` (resposta ao que **você** encaminhou):
- "**{nome}** aceitou seu encaminhamento" ou "…recusou seu encaminhamento" + badge
  "Aceito" (`default`) ou "Recusado" (`outline`).
- observação da resposta em itálico, quando existe.
- tempo relativo de `responded_at ?? created_at` e botão "Marcar como lido"
  (`ArrowRight`) → grava `requester_seen_at`.

### 11.4 `AgentNotepad` + `NotepadPanel` — o caderno

**Arquivos:** `src/features/notepad/*`. Montado no layout: a anotação nasce no meio
de qualquer tela.

**Marcador** (canto inferior direito, `bottom-6 right-0`): botão
`bg-dashboard-sidebar` com ícone `NotebookPen` + "Caderno" (texto só em `sm+`) e
badge com o nº de pendências abertas ("99+" acima de 99). `aria-expanded` e
`aria-label` compostos: "Abrir meu caderno — {n} pendência(s) em aberto".

**Painel:** `aside aria-label="Bloco de notas"`, fixo à direita, 100% da altura,
`w-full sm:w-[400px]` e `sm:w-[620px]` no modo largo. Animação de 300 ms, e o
painel é **montado/desmontado** em volta dela — um painel invisível no DOM
continuaria capturando Tab.

**Preferências em `localStorage`** (`notepadPrefs`): `open` (o caderno aberto
continua aberto no próximo login — "é o comportamento de um caderno em cima da
mesa") e `wide`.

**Navegação:** escopo `dia` / `semana` / `mês` (botões com `aria-pressed`), setas
anterior/seguinte com `aria-label` variável ("Dia anterior" / "Semana anterior" /
"Mês anterior" …), título e subtítulo do período gerados por `notepadDates`
(capitaliza só a primeira letra — **não** usar `capitalize` do CSS), e
"Ir para hoje" quando o cursor não é hoje.

**Busca:** ativa a partir de `MIN_SEARCH_LENGTH` caracteres, placeholder "Buscar em
todas as datas…", `aria-label` "Buscar no caderno", botão "Limpar busca". Busca
em todas as datas (query separada).

**Faixa de pendências atrasadas** (`NotepadCarryOver`): só no escopo `dia` e só
quando o cursor é hoje; lista pendências de dias anteriores ainda abertas, com
ações de concluir, **mover para hoje** (`note_date = today`) e abrir o dia de origem.

**Escrita** (`NotepadComposer`): `textarea` de 1 linha que cresce em múltiplos da
entrelinha; placeholder "Nova pendência…" ou "Escreva uma anotação rápida…" conforme
o tipo; `aria-label` "Nova anotação em {dia}". **Enter** salva (Shift+Enter quebra
linha), **Esc** limpa o rascunho se houver texto e, só se estiver vazio, fecha o
caderno. Depois de salvar mantém o tipo e o foco ("escrever três pendências
seguidas é o caso comum no começo do turno").

**Cada linha** (`NotepadNote`): alternar concluída (`aria-label` "Concluir
pendência" / "Reabrir pendência"), fixar, alternar entre nota e pendência (sair de
pendência concluída para nota também limpa a conclusão, porque o banco só permite
conclusão em tarefa), editar o corpo em linha, excluir.

**Exclusão com desfazer:** `sonner` mostra "Anotação apagada." com ação
"Desfazer", que **reinsere** a nota. `[MANTER]` — é a única operação com undo no
sistema.

**Otimismo:** criar, atualizar e excluir são otimistas com snapshot/rollback sobre
todas as queries do caderno.

**Estados:** erro de leitura → "Não foi possível carregar o caderno." + mensagem +
botão "Tentar de novo" (padrão que a v2 generaliza); dia vazio → "Página em branco"
+ "Escreva na linha acima o que não pode esquecer hoje."

**Rodapé:** "{n} anotação/anotações", "· {n} pendente(s)" em `text-status-open`, e
indicador de gravação (`Loader2` girando).

Detalhe visual: nove "blocagens" decorativas no topo do papel
(`aria-hidden`) — o que faz o objeto ler como um bloco de papel.

---

## 12. Sons, efeitos e ativos

| Ativo | Onde | Gatilho |
|---|---|---|
| `/sounds/clap.mp3` | meta diária batida | uma vez por dia por agente, `volume 0.7` |
| `playWhoosh()` | check-in de 2 h | 80 ms após abrir o diálogo |
| `playNotificationSound()` | sino | contagem de notificações aumenta |
| `ConfettiBurst` (64 peças) | meta diária batida | junto com o som, 9,6 s |
| classe `pulse` | número do contador de hoje | enquanto a celebração dura |
| `logo-xmx.png` | cabeçalho e tela de role sem área | sempre |

Todos precisam continuar existindo, incluindo o destrave de áudio no primeiro
`pointerdown` (sem ele o som falha por política de autoplay).

---

## Lacunas

O que a interface do agente precisa e a linha de base de rotas (contrato §7) não
cobre. Nenhuma foi resolvida por iniciativa desta trilha.

1. **Catálogos de domínio.** Não existe rota que sirva produtos (75), plataformas
   (9), canais, motivos de contato (11, com cor e regra de nota), tipos e status do
   Radar, motivos de reembolso (15), percentuais de reembolso (20) e tags de
   pendência. Hoje estão *hardcoded* em quatro arquivos diferentes, e
   `services.product` tem CHECK no banco — produto novo exige migration **e** dois
   deploys do front. Falta algo como `GET /catalogs` (ou por recurso), com cache
   longo. Sem isso a v2 repete o acoplamento.
2. **Meta diária e canal do agente.** `GET /metrics/me` precisa devolver
   `dailyGoal` e `supportChannel`; hoje os dois saem de uma maioria contada sobre a
   janela de 30 dias carregada no cliente — número que muda conforme o cache.
3. **Snapshot do check-in.** Nenhuma rota devolve os 8 contadores das janelas de
   2 h e do dia. Hoje são 8 `count` paralelos do browser.
4. **Alerta de reembolso pendente há 24 h.** A regra é do cliente; falta a lista
   pronta (ou um contador) numa rota de reembolsos ou de notificações.
5. **Radar.** A linha de base diz "CRUD + registro de ação + resumo", mas a tela
   também precisa da **timeline de um caso** (`radar_item_events`) e do
   **"hoje do servidor"** (`today`), que é o que faz o rótulo de prazo não depender
   do relógio do browser.
6. **Pedidos em espera do agente.** A linha de base cobre "CRUD + importação +
   distribuição" (visão da gestora). Falta explicitar: lista do agente, métricas
   diárias do agente (com a meta), mudança de status com nota e tag, e a timeline
   do pedido.
7. **Caderno.** "CRUD do caderno" não cobre: consulta por intervalo (dia/semana/mês),
   busca em todas as datas, lista de pendências abertas de dias anteriores (badge do
   marcador e faixa de atrasadas), mover uma nota de dia, e **restaurar** uma nota
   apagada (o "Desfazer").
8. **Transferências.** Falta a rota que responde "o que eu recebi e ainda não
   resolvi" já filtrada e desduplicada por ticket, e a marcação de resposta lida
   (`requester_seen_at`) — hoje é `UPDATE` direto na tabela.
9. **Tomada de ticket (folga).** `POST /takeovers` existe na linha de base, mas a
   tela precisa saber **antes** se o dono está indisponível
   (`current_owner_is_available`) para escolher entre "Encaminhar" e "Solicitar
   aprovação". Isso tem de vir no resultado da busca por e-mail
   (`GET /tickets/lookup`).
10. **Exportações do agente.** O módulo `exports` existe, mas não estão nomeadas as
    duas exportações da área do agente: "Meus Atendimentos" (2 abas) e "Radar"
    (1 aba, com os filtros aplicados no cabeçalho).
11. **Base de Suporte.** "leitura para agente e copy" não diz se os e-mails
    Clickbank e o playbook de reembolso (hoje fixos no código) passam para o banco.
    Precisa de decisão, porque muda quem edita.
12. **Treinamento.** "vídeos e progresso" não cobre a agregação que a tela usa
    (agrupado por seção, na ordem fixa, com `progressPct` e `completed` por vídeo)
    nem a escrita de progresso parcial durante a reprodução.
13. **Mapa de nomes de agentes.** Com `can_view_all_tickets` a tabela mostra o nome
    do dono; hoje isso é um `SELECT` em `profiles`. Ou o ticket traz `ownerName`, ou
    falta uma rota de diretório mínimo.
14. **Códigos de erro que mudam o comportamento da tela.** Com **D1** não existe mais
    `FOLLOW_UP_BLOCKED` — a rota de interação não valida horário. Continuam faltando
    os códigos de: duplicidade cross-agent (para o front abrir o diálogo em vez de
    mostrar erro), pedido de transferência já pendente (hoje detectado pelo código
    Postgres `23505`), tentativa de assumir sem `can_claim_tickets`, e produto fora
    do catálogo (o CHECK de `services.product`).
15. **Realtime.** O contrato define `user:{userId}` e `managers`. Falta dizer que
    evento invalida o quê para: transferência recebida/respondida, aprovação de
    tomada, reembolso criado por trigger a partir de um atendimento, e badge do Radar.
16. **Busca de e-mail sobre a coluna normalizada (D6).** O original passa a ser
    preservado e uma coluna gerada normalizada serve a índice e comparação. O front
    precisa saber **qual** das duas a rota usa em cada caso: `GET /tickets/lookup`
    (duplicidade) e a busca textual da lista devem casar pela normalizada, e a tela
    exibe sempre o original. Sem isso escrito, a busca por "Cliente@X.com" deixa de
    achar "cliente@x.com" — que é o comportamento de hoje, feito no cliente com
    `toLowerCase().includes()`.
17. **"Nenhum" versus vazio em `platform` (D5).** A decisão preserva os dois como
    coisas diferentes no dado histórico. Falta definir o que a **escrita nova** faz:
    hoje o formulário de reembolso converte "Nenhum" em `null` antes de enviar
    (4.4), ou seja, apaga a distinção justamente nos registros novos. Precisa ficar
    decidido se "Nenhum" passa a ser gravado como texto, e se a lista de plataformas
    do atendimento (9, com `PagAmerican`) e a do reembolso (8, sem) se unificam.

## Propostas de emenda

### 1. "A estrutura de pastas fica" não pode valer como está — mas não é `src/` que muda de forma

O documento de arquitetura diz que a estrutura de pastas fica. Na prática ela
**já é** por feature (`src/features/<domínio>/`), e isso funciona. O que está
errado hoje, e o dono do projeto pediu para organizar, é outra coisa:

- **Catálogo duplicado.** A lista de 75 produtos existe **três** vezes (byte a byte idêntica nos três)
  (`Atendimentos.tsx`, `EditServiceDialog.tsx`, `refunds/types.ts`) — byte a byte
  idêntica nos três — e a de plataformas **duas**, com conteúdo **divergente**
  (o reembolso não tem `PagAmerican`).
  Isso não é estilo, é bug esperando. Proposta: um módulo de catálogo por domínio
  em `packages/contract` (ou servido por API, ver Lacuna 1) e **zero** literal de
  domínio dentro de página.
- **Página de 1397 linhas.** `Atendimentos.tsx` mistura formulário, tabela, filtros,
  quatro mutações e a regra de duplicidade. Proposta: a página passa a ser
  composição; formulário, tabela e diálogos viram componentes da feature `tickets`,
  e nenhuma regra de negócio sobra no front (o contrato §6 já manda isso).
- **Regra de negócio dentro de hook de UI.** `useStatusTracking` carrega hoje a
  derivação de status, a contagem de interações, o cálculo do `follow_up_number` e
  carregava a regra das 18h. A última **deixa de existir** (D1); as três primeiras
  saem para o servidor (§6). O que resta é um hook de mutação.
- **Vizinhança errada.** `PendingRefundsAlert` mora em `features/refunds` mas é
  cromo do layout do agente; `StatusTrackingDialog` é usado por três telas de duas
  features. Proposta: o que atravessa features vive na API pública da feature dona
  (`features/tickets/index.ts`), nunca em import profundo — o que também é a regra
  contra import cruzado (ver `23-frontend-estrutura.md`).

Ou seja: a emenda não é "reescrever a arquitetura de pastas", é **"a organização por
feature passa a ser obrigatória e verificável, com API pública por feature e
proibição de literal de domínio em página"**. A decisão de aceitar é do dono.

### 2. Telas que dependem de cálculo em memória e o que as substitui

A v2 move filtro, busca, ordenação e paginação para o servidor (§6). Isso **remove**
comportamento que hoje existe só porque a lista inteira está no cliente. Caso a caso:

| Hoje | O que se perde | Substituição proposta |
|---|---|---|
| Busca por e-mail em Atendimentos **ignora o filtro de data** | achar ticket antigo digitando o e-mail, sem mexer em nada | `GET /tickets/lookup?email=` separado da listagem, e a UI continua ignorando as datas quando há termo de busca |
| Filtro de data inclui ticket cuja **interação** caiu no período | atendimento aparece no dia em que foi trabalhado, não no dia em que nasceu | parâmetro explícito na rota (ex.: `activityFrom`/`activityTo`), porque é a mesma regra do dashboard da gestora |
| "Total de atendimentos" troca de fonte quando há filtro | o número deixa de bater com o card do dia | a rota de listagem devolve `totalCount` sob os mesmos filtros; a troca de semântica desaparece |
| Contagem de interações `#N` e badge de status | tudo | `interactionCount` e `status` materializados no ticket (§6) |
| Paginação de 15 com 7 links numéricos | ir direto para a página 9 | keyset: "anterior/próxima" + "carregar mais". **O front perde o salto para página arbitrária.** É perda real de funcionalidade e precisa de aceite explícito. `[DECISÃO]` |
| Reembolsos: soma "Total reembolsado" das linhas filtradas | total do recorte | a rota devolve o total agregado do filtro |
| Reembolsos: contagem "(de {total})" | comparar filtrado vs total | rota devolve `totalCount` e `filteredCount` |
| Radar: recortes por prazo e busca em `notes` | filtro instantâneo, sem ida ao servidor | `?bucket=`, `?kind=`, `?status=`, `?q=` na rota; `summary` já vem do servidor hoje |
| Transferências "A resolver": desduplicação por ticket + status efetivo | a fila operacional correta | rota dedicada (Lacuna 8) |
| Pedidos em Espera: `Select` de motivos montado dos dados carregados | descobrir os motivos que **você** tem, com contagem | facetas na resposta da listagem (`facets.reasons[]` com contagem) |
| Alerta de reembolso 24 h e selo SMS/EMAIL | o alerta e a meta | campos prontos (Lacunas 2 e 4) |

### 3. Duas regras do contrato que a área do agente precisa endurecer

- **§4, fim do polling.** Concordo com a direção, mas o polling de 30 s do
  `AgentLayout` também é o mecanismo de **expulsar conta desativada**. A emenda é:
  o front trata `403 ACCOUNT_BLOCKED` em **qualquer** resposta como logout
  imediato, e não só uma rota de status. Sem isso, trocar polling por push abre
  janela para uma conta bloqueada continuar operando offline do socket.
- **§3, "nunca mais erro silencioso".** Hoje **todas** as páginas do agente usam
  `const { data = [] }`. O padrão `Radar` (estado de erro visível) e o do caderno
  ("Tentar de novo") são os modelos. A emenda é tornar isso verificável: um
  componente de erro obrigatório por consulta, e lint proibindo o default `[]` em
  `useQuery`.

### 4. Incoerências de hoje que a v2 herda se ninguém decidir

Três itens desta lista **já foram decididos** em `00-CONTRATO.md` §8-A e saíram daqui:
a regra das 18h incoerente (D1: nenhum caminho bloqueia), a moeda do reembolso
(D4: tudo dólar, e o legado já foi corrigido) e a paginação numerada
(D7: continua existindo). Os itens abaixo seguem sem resposta.

Estas **não** são propostas de remoção — são perguntas de paridade que precisam de
resposta do dono do projeto antes de a implementação escolher sozinha:

1. `SALES_PLATFORMS` (reembolso, 8) ≠ `PLATFORMS` (atendimento, 9 — tem
   `PagAmerican`). Unificar ou manter duas listas? **D5 torna isso mais urgente:**
   se "Nenhum" e vazio são coisas diferentes, a lista que oferece "Nenhum" e a que
   não oferece produzem dados diferentes para o mesmo fato.
2. Canal no cadastro (3 opções) ≠ canal na edição (4, com "Nenhum"). Manter?
3. `TransferTicketDialog` mostra `status` cru (`registered`) para o agente.
   Rotular?
4. `EditServiceDialog` não aplica máscara de telefone em ticket de SMS.
5. Filtro de data em Reembolsos diz "(solicitação)" nas duas abas, mas na aba de
   concluídos filtra `completion_date`.
6. `PendingRefundsAlert` reaparece a cada recarga (reconhecimento só em memória).
7. `ComeceAqui` usa cores fixas nos estados de erro/vazio → quebra no tema escuro.
8. `myCountOverride` em `AgentDailyMetricsSection` não tem consumidor.
9. `useMyServicesQuery` recebe `_canViewAllTickets` e ignora (a RPC resolve no
   servidor) — parâmetro morto.
9-b. O formulário de reembolso converte "Nenhum" em `null` ao enviar plataforma e
   canal (4.4). Com **D5**, isso apaga nos registros **novos** a mesma distinção que
   a decisão manda preservar nos antigos. Ver Lacuna 17.
10. Dicas de tag de pendência (`HELD_ORDER_PENDING_TAG_HINT`) existem e não são
    exibidas.
11. Formulário de criação não explica **por que** o botão está desabilitado.
12. `PedidosEspera` tem meta e barra de progresso, mas não tem celebração.

> **Propostas de remoção** (exigidas pelo contrato §8) estão consolidadas numa
> única lista em `22-frontend-mapa-api.md`, no fim do arquivo — junto com a
> evidência de cada item.
>
> Itens que esta trilha levantou e que o dono **adiou** vivem em
> `90-BACKLOG.md`, não aqui: seção pronta e nunca renderizada (**B19**), contas de
> teste escondidas por nome (**B20**), código morto confirmado (**B21**) e o
> streaming da Lya fora do envelope do §3 (**B23**).
