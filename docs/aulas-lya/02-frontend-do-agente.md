# Planta do front-end de um agente (modelo: Lya)

> **Como usar este arquivo.** Entregue-o a um assistente de código junto com a
> planta do backend (`01-backend-do-agente.md`). Ele descreve a interface de
> chat que conversa com aquele backend: como receber a resposta ao vivo, como
> guardar a conversa, e os erros que só aparecem depois de a coisa estar rodando.
>
> A pilha aqui é React + TypeScript + TanStack Query + Tailwind/shadcn. As ideias
> valem em qualquer pilha; os trechos de código são de um app React.

---

## O que você vai construir

Três superfícies sobre o mesmo motor:

| superfície | onde | persiste? |
| --- | --- | --- |
| **Tela cheia** | uma rota própria, com lista de conversas | sim |
| **Balão flutuante** | montado no layout, disponível em todas as telas | não, é da sessão |
| **Tela do cérebro** | onde o usuário treina e vê as memórias | sim (é o cérebro) |

A tela cheia e o balão compartilham **o mesmo hook de conversa**. Só mudam duas
opções: se persiste, e qual conversa está aberta.

---

## Estrutura de arquivos

```
src/features/<agente>/
├── api.ts                 fala com a Edge Function (stream) e com as RPCs
├── types.ts               os tipos dos eventos e das mensagens — o contrato
├── use<Agente>Conversation.ts   o estado de UMA conversa
├── use<Agente>Chats.ts    histórico (TanStack Query)
├── use<Agente>Memories.ts o cérebro (TanStack Query)
└── components/
    ├── Chat.tsx           a composição da tela cheia
    ├── Widget.tsx         o balão
    ├── Messages.tsx       a lista de mensagens
    ├── Composer.tsx       a caixa de envio
    ├── ChartCard.tsx      o gráfico que o agente pede
    ├── Markdown.tsx       renderização do texto
    └── ChatActivity.tsx   o avatar e o indicador de "trabalhando"
```

---

## 1. O contrato: os eventos do stream

Este é o coração da integração. O backend não devolve um JSON no fim: ele manda
uma sequência de eventos enquanto trabalha. Declare-os como um tipo — é o que
mantém as duas pontas honestas.

```ts
export type AgentEvent =
  | { type: "token";   text: string }                    // um pedaço do texto
  | { type: "tool";    name: string; input?: unknown }   // começou a usar uma ferramenta
  | { type: "chart";   chart: AgentChart }               // um gráfico para renderizar
  | { type: "memoria"; memoria: MemoriaSalva }           // gravou uma memória (modo treino)
  | { type: "aviso";   codigo?: string; message?: string } // degradação, não erro
  | { type: "revisao"; revisao: Revisao }                // o veredito do verificador
  | { type: "error";   message?: string }
  | { type: "done" };                                    // fim do turno — SEMPRE chega
```

Três decisões embutidas aí:

- **`tool` existe para o usuário ver o trabalho acontecendo.** Sem ele, uma
  pergunta que leva 20 segundos parece travada. Mostre o nome da ferramenta em
  linguagem de gente ("consultando os atendimentos…"), não o identificador.
- **`aviso` não é `error`.** Quando o recall de memórias falha, a resposta ainda
  sai — mas sem o treino. O usuário precisa saber disso, senão lê uma resposta
  destreinada achando que é a treinada.
- **`done` é obrigatório.** É o único sinal confiável para tirar a interface do
  estado de "carregando". O backend garante que ele sai mesmo em erro.

---

## 2. Consumir o stream (`api.ts`)

Não use uma biblioteca de SSE: o `EventSource` do navegador só faz GET e não
manda cabeçalho de autorização. Use `fetch` e leia o corpo.

```ts
const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agente`;

async function callFunction(body: Record<string, unknown>, signal?: AbortSignal) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão inválida. Entre de novo.");
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,   // o crachá do usuário
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
    signal,
  });
}
```

### O pedaço com lógica própria: quebrar o buffer

Um chunk da rede pode trazer meio evento, ou três eventos e meio. Separe isso
numa função pura e **escreva um teste para ela** — é o único ponto do transporte
que erra sozinho.

```ts
/** Quebra o buffer em eventos completos e devolve o resto. */
export function parseSseBuffer(buffer: string): { events: AgentEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";          // o último pedaço pode estar incompleto
  const events: AgentEvent[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as AgentEvent);
    } catch {
      // linha malformada: ignora e segue — nunca derrube o stream por isso
    }
  }
  return { events, rest };
}

export async function streamChat({ messages, contexto, onEvent, signal }: StreamParams) {
  const res = await callFunction({ action: "chat", messages, contexto }, signal);
  if (!res.ok) throw await erroDaResposta(res, "O agente não respondeu");
  if (!res.body) throw new Error("Sem resposta do servidor.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const evt of parsed.events) onEvent(evt);
  }
  // resto sem "\n\n" final (raro): tenta fechar
  for (const evt of parseSseBuffer(buffer + "\n\n").events) onEvent(evt);
}
```

### Erro do servidor vira frase, não código

```ts
async function erroDaResposta(res: Response, fallback: string): Promise<Error> {
  const payload = await res.json().catch(() => null);
  const msg = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "";
  return new Error(msg || `${fallback} (HTTP ${res.status})`);
}
```

O backend devolve mensagens já escritas para o usuário final ("a chave não está
configurada", "este agente atende só a área X"). Mostre-as. Um "HTTP 503" na
tela não ajuda ninguém.

---

## 3. O estado de uma conversa (o hook)

Aqui mora a parte difícil, e ela não é óbvia: **a resposta em voo não pode viver
só no estado do React**.

O cenário que quebra: o usuário pergunta algo, a resposta começa a chegar, e ele
clica em outra conversa da lista. Se o save usar o estado atual da tela, você
grava a pergunta **sem** a resposta, e a resposta em voo se perde ou vai parar na
conversa errada.

A solução: espelhar o turno numa cópia própria, fora do React, indexada pela
conversa dona dele.

```ts
const turnoNaTelaRef = useRef<symbol | null>(null);
// conversa -> { token do turno, mensagens do turno }
const emVooRef = useRef(new Map<string, { token: symbol; turno: AgentMessage[] }>());
```

Regras que caem daí:

1. **Todo save deste envio sai da cópia**, nunca do estado da tela.
2. **Trocar de conversa** limpa a tela; se houver turno em voo para a conversa
   que está sendo aberta, reata a ele em vez de reler o parcial do banco.
3. **O hidratar do banco** só roda quando não há turno em voo para aquela conversa.
4. **Um `Symbol` por turno** identifica de quem é cada evento que chega. Sem ele,
   duas respostas simultâneas se misturam.

```ts
export function useAgentConversation({ chatId = null, persist = false, onNeedChatId, contexto, modoTreino }: Options) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // ...
}
```

### Montar a mensagem a partir dos eventos

```ts
onEvent: (evt) => {
  switch (evt.type) {
    case "token":   aplicar((m) => ({ ...m, content: m.content + evt.text })); break;
    case "tool":    aplicar((m) => ({ ...m, tools: [...(m.tools ?? []), { name: evt.name }] })); break;
    case "chart":   aplicar((m) => ({ ...m, charts: [...(m.charts ?? []), evt.chart] })); break;
    case "memoria": aplicar((m) => ({ ...m, memorias: [...(m.memorias ?? []), evt.memoria] })); break;
    case "revisao": aplicar((m) => ({ ...m, revisao: evt.revisao })); break;
    case "aviso":   setAviso(evt.message ?? null); break;
    case "error":   /* vira uma mensagem de erro visível na conversa */ break;
    case "done":    /* encerra o turno e dispara o save */ break;
  }
}
```

Uma mensagem do agente não é uma string: é texto **mais** os blocos ricos.
Guarde tudo, para a conversa reabrir exatamente como a pessoa viu.

```ts
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string }[];
  charts?: AgentChart[];
  memorias?: MemoriaSalva[];
  revisao?: Revisao | null;
}
```

---

## 4. O contexto da tela

O que faz o agente entender "e nesse período?" sem repetir as datas: o layout
monta um objeto de contexto e manda junto com **cada** pergunta.

```ts
export interface AgentContexto {
  de?: string;              // período selecionado na barra lateral
  ate?: string;
  filtro_id?: string | null; // o filtro ativo (agente, loja, categoria…)
  filtro_nome?: string | null;
  usuario_nome?: string | null;
  usuario_role?: string | null;
  tela?: string | null;      // qual tela está aberta agora
}
```

No layout:

```tsx
const contexto = useMemo<AgentContexto>(() => ({
  de: dateRange.from, ate: dateRange.to,
  filtro_id: agentFilter, filtro_nome: agentName,
  usuario_nome: fullName, usuario_role: role,
  tela: pathname,
}), [dateRange, agentFilter, agentName, fullName, role, pathname]);

// ...
<AgentWidget contexto={contexto} />
```

Custa quase nada e muda a experiência: sem isso, toda pergunta precisa carregar
as datas dentro dela.

---

## 5. O histórico

Guarde a conversa inteira em duas tabelas, e proteja por RLS pelo dono:

```sql
CREATE POLICY "chats_own" ON public.agente_chats
  FOR ALL TO authenticated
  USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
```

Cada pessoa vê só as próprias conversas — inclusive quem administra o sistema.
Conversa é trabalho pessoal, não relatório da equipe.

Três decisões que evitam dor de cabeça:

- **O id da conversa nasce no cliente** (um UUID). Assim a primeira mensagem já
  tem para onde ir, sem uma ida ao servidor antes de começar a responder.
- **O save é por substituição**: manda a lista inteira de mensagens no lugar de
  fazer append. Um turno que falha no meio não deixa metade gravada.
- **Uma fila por conversa**: dois saves da mesma conversa não podem correr em
  paralelo, ou o mais lento sobrescreve o mais novo.

```ts
export async function saveChat(id: string, mensagens: AgentMessage[]) {
  const { data, error } = await rpc("agente_save_chat", {
    p_chat_id: id,
    p_mensagens: mensagens.map((m) => ({
      role: m.role, content: m.content,
      tools: m.tools ?? [], charts: m.charts ?? [],
      memorias: m.memorias ?? [], revisao: m.revisao ?? null,
    })),
  });
  if (error) throw new Error("Não foi possível salvar a conversa.");
  return data;
}
```

---

## 6. Renderizar a resposta

### Texto

Markdown com suporte a tabela (`react-markdown` + `remark-gfm`). O agente é
instruído a usar tabelas curtas para números, então o suporte a GFM não é
opcional. Estilize os elementos por um wrapper — não confie no `prose` do
Tailwind sem revisar tabela e código.

### Gráficos

O agente pede o gráfico por uma ferramenta; a interface desenha. O formato é
deliberadamente pobre — categorias e séries, nada de configuração de biblioteca:

```ts
export interface AgentChart {
  tipo: "barras" | "linha" | "area" | "pizza";
  titulo: string;
  subtitulo?: string;
  eixoX?: string;
  eixoY?: string;
  categorias: string[];
  series: { nome: string; valores: number[] }[];
}
```

Normalize no servidor antes de emitir: corte séries com tamanho diferente do
número de categorias, force uma série só quando o tipo for pizza, limite a
quantidade de séries. Um gráfico malformado é pior que nenhum gráfico.

### As ferramentas usadas

Mostre em linguagem de gente, colapsado por padrão. `painel_atendimentos` vira
"consultou a tela Atendimentos". É o que dá ao usuário a chance de conferir de
onde veio o número.

### A revisão

Só divergências e ressalvas de gravidade **alta** merecem espaço na conversa. O
resto fica no detalhe da mensagem, para quem quiser abrir.

---

## 7. O balão

```tsx
export function AgentWidget({ contexto }: { contexto: AgentContexto }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const conv = useAgentConversation({ persist: false, contexto });

  // Na tela cheia o próprio agente já ocupa a página — esconde o balão.
  if (pathname.startsWith("/dashboard/agente")) return null;
  // ...
}
```

Detalhes que fazem diferença:

- **Some na tela dele.** Um balão sobre a tela cheia do próprio agente é ruído.
- **Sugestões na primeira abertura.** Três perguntas prontas que representam o
  que ele faz de melhor. Ninguém sabe o que perguntar a uma caixa vazia.
- **`aria-label` que muda com o estado** ("Perguntar ao agente" / "Fechar").
- **A conversa é da sessão.** Se a pessoa quiser guardar, o botão de maximizar
  leva para a tela cheia.

---

## 8. Erros que só aparecem depois

| sintoma | causa | conserto |
| --- | --- | --- |
| Texto do preâmbulo colado na resposta | tool-use no meio do turno | o backend injeta `\n\n`; não tente consertar no front |
| A interface fica "carregando" para sempre | o stream morreu sem `done` | orçamento de tempo no backend + timeout no front |
| Duas respostas se misturam | falta de token por turno | um `Symbol` por envio, comparado antes de aplicar cada evento |
| A conversa reabre sem gráficos | o save guardou só o texto | persistir os blocos ricos junto |
| Resposta parece destreinada | o recall falhou e ninguém avisou | o evento `aviso` visível na conversa |
| Acentos errados no texto | decodificação por chunk sem `stream: true` | `decoder.decode(value, { stream: true })` |

---

## 9. Checklist

- [ ] O tipo dos eventos existe e as duas pontas o respeitam.
- [ ] `parseSseBuffer` tem teste com chunk partido no meio de um evento.
- [ ] O turno em voo vive fora do estado do React.
- [ ] Trocar de conversa no meio de uma resposta não perde nem mistura nada.
- [ ] O contexto da tela vai em toda pergunta.
- [ ] O histórico tem RLS pelo dono.
- [ ] Erro do servidor aparece como frase, não como código HTTP.
- [ ] O balão some na tela cheia e traz sugestões quando a conversa está vazia.
