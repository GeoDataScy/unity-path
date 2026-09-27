---
name: cerebro-grafo
description: Constrói a tela "cérebro" de um agente de IA como um grafo ao vivo no estilo Obsidian — cada memória é um nó, ligações por wikilinks e tags, nós arrastáveis, painel de forças, filtro por tipo, busca, e memórias novas que nascem animadas. Use quando alguém pedir para visualizar a memória de um agente, um grafo de conhecimento, um "Obsidian graph view" em React, ou a tela de treino de um agente.
---

# Cérebro em grafo (estilo Obsidian)

Esta skill constrói a tela onde o usuário **vê e treina** a memória de um agente
de IA: um grafo ao vivo em canvas, cada bolinha é uma memória, cada linha é uma
relação. Vem do `LyaBrainGraph` do XMX Suporte, em produção desde 07/09/2026.

O ponto da tela não é ser bonita: é o usuário **enxergar o que o agente já sabe**
— o que está denso, o que está solto, o que ninguém ensinou ainda.

## Quando usar

- "quero ver a memória do meu agente"
- "faz um grafo tipo Obsidian"
- "a tela de treino do agente"
- "grafo de conhecimento em React"

## O que construir

Uma tela com três partes:

1. **Faixa de métricas** no topo: quantas memórias, quantas de cada tipo, qual a
   mais recente, há quanto tempo.
2. **O grafo** ocupando o resto da tela, em fundo escuro.
3. **Uma aba de treino** ao lado, onde o usuário escreve uma memória nova.

---

## Passo 1 — Dependência e montagem

```bash
npm i react-force-graph-2d@1.29.1
```

Importe **preguiçosamente**. A biblioteca é pesada e toca `window` no topo do
módulo: importada direto, ela quebra o build de SSR e pesa no bundle de todo
mundo que nunca abre essa tela.

```tsx
const ForceGraph2D = lazy(() => import("react-force-graph-2d"));
```

O canvas precisa de largura e altura em número, não em CSS. Meça com um
`ResizeObserver`:

```tsx
useEffect(() => {
  if (!wrapRef.current) return;
  const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }));
  ro.observe(wrapRef.current);
  return () => ro.disconnect();
}, []);
```

---

## Passo 2 — Montar o grafo a partir das memórias

**Não crie tabela de arestas.** As relações são derivadas da própria memória, no
navegador. Isso mantém o banco simples e o grafo sempre coerente com o conteúdo.

Duas fontes de aresta:

1. **`[[wikilinks]]` no corpo** — relação explícita, escrita pelo usuário.
2. **Tags em comum** — relação implícita, por assunto.

```ts
export interface GraphNode {
  id: string;          // o slug da memória
  label: string;       // a descrição curta
  type: MemoryType;    // feedback | user | project | reference | nota
  tags: string[];
  val: number;         // 1 + grau: nós mais conectados ficam maiores
  updated_at: string;
  created_at: string;
}
export interface GraphLink { source: string; target: string; kind: "link" | "tag"; }

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Precisa ser IDÊNTICO ao slugify do backend e do banco. */
export function slugify(s: string, n = 60): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n);
}

export function buildGraph(memorias: Memory[]): BrainGraph {
  const nomes = new Set(memorias.map((m) => m.name));
  const nodes = new Map<string, GraphNode>();
  for (const m of memorias) {
    nodes.set(m.name, {
      id: m.name, label: m.description || m.name, type: m.type,
      tags: m.tags ?? [], val: 1, updated_at: m.updated_at, created_at: m.created_at,
    });
  }

  const links: GraphLink[] = [];
  const vistos = new Set<string>();
  const addLink = (a: string, b: string, kind: GraphLink["kind"]) => {
    if (a === b) return;                                   // sem laço no próprio nó
    const key = [a, b].sort().join("|") + kind;            // sem aresta duplicada
    if (vistos.has(key)) return;
    vistos.add(key);
    links.push({ source: a, target: b, kind });
  };

  // 1) wikilinks explícitos
  for (const m of memorias) {
    for (const match of (m.body || "").matchAll(WIKILINK)) {
      const alvo = slugify(match[1]);
      if (nomes.has(alvo)) addLink(m.name, alvo, "link");   // ignora link para memória inexistente
    }
  }

  // 2) tags em comum → CADEIA por tag (a → b → c), nunca todos com todos
  const porTag = new Map<string, string[]>();
  for (const m of memorias) for (const t of m.tags ?? []) {
    const lista = porTag.get(t) ?? []; lista.push(m.name); porTag.set(t, lista);
  }
  for (const arr of porTag.values()) {
    for (let i = 0; i < arr.length - 1; i++) addLink(arr[i], arr[i + 1], "tag");
  }

  // val proporcional ao grau
  const grau = new Map<string, number>();
  for (const l of links) {
    grau.set(l.source, (grau.get(l.source) ?? 0) + 1);
    grau.set(l.target, (grau.get(l.target) ?? 0) + 1);
  }
  for (const [id, n] of nodes) n.val = 1 + (grau.get(id) ?? 0);

  return { nodes: [...nodes.values()], links };
}
```

> **A regra da cadeia é obrigatória.** Ligar todas as memórias que compartilham
> uma tag umas às outras cresce ao quadrado: 20 memórias com a mesma tag viram
> 190 arestas e o grafo vira um novelo preto. A cadeia dá 19 e lê igual.

---

## Passo 3 — Ao vivo, preservando as posições

Repuxe a lista de memórias a cada poucos segundos (TanStack Query com
`refetchInterval: 4000` resolve). O erro fácil é chamar `setGraph(buildGraph(...))`
a cada volta: a simulação reinicia e **todos os nós saltam de lugar**.

Funda o grafo fresco no atual, reaproveitando os objetos de nó já simulados:

```ts
const fresh = buildGraph(memorias);
const prev = graphRef.current;

const conhecidos = new Map(prev.nodes.map((n) => [n.id, n]));
const freshIds = new Set(fresh.nodes.map((n) => n.id));
const nodes = prev.nodes.filter((n) => freshIds.has(n.id));   // some quem foi apagado
const nascidos: GraphNode[] = [];

for (const fn of fresh.nodes) {
  const velho = conhecidos.get(fn.id);
  if (velho) {
    // atualiza o CONTEÚDO no mesmo objeto: x, y e vx, vy ficam preservados
    velho.val = fn.val; velho.label = fn.label; velho.tags = fn.tags;
    velho.type = fn.type; velho.updated_at = fn.updated_at;
  } else {
    nodes.push({ ...fn, _born: performance.now() });          // marca para a animação
    nascidos.push(fn);
  }
}

const chave = (l) => [idOf(l.source), idOf(l.target)].sort().join("|") + l.kind;
const frescas = new Set(fresh.links.map(chave));
const links = prev.links.filter((l) => frescas.has(chave(l)));
const conhecidas = new Set(links.map(chave));
for (const l of fresh.links) if (!conhecidas.has(chave(l))) links.push(l);

if (nascidos.length) fgRef.current?.d3ReheatSimulation();
```

`idOf` existe porque a biblioteca **muta** `source` e `target`: começam string e
viram o objeto do nó depois da primeira simulação.

```ts
const idOf = (v) => (typeof v === "object" && v ? String(v.id ?? "") : String(v ?? ""));
```

---

## Passo 4 — Desenhar o nó no canvas

Use `nodeCanvasObject`. Cor por tipo, raio pela raiz do grau (raiz, não linear,
senão um nó muito conectado domina a tela).

```ts
const COR_TIPO: Record<MemoryType, string> = {
  feedback:  "#fbbf24",  // âmbar — preferências
  user:      "#60a5fa",  // azul — sobre o agente
  project:   "#a78bfa",  // roxo — projetos
  reference: "#34d399",  // verde — referências
  nota:      "#cbd5e1",  // cinza claro — notas
};

const raio = (n) => (2 + Math.sqrt(n.val) * 1.6) * ajustes.tamanho;
```

### O erro do rótulo que cresce junto com o zoom

O `scale` que a biblioteca passa é o zoom atual. Para o texto ter tamanho
**constante na tela**, divida por ele — e **não coloque piso**:

```ts
// certo: o rótulo mantém o mesmo tamanho aparente em qualquer zoom
ctx.font = `${12 / scale}px Inter, sans-serif`;

// errado: com Math.max o texto volta a crescer junto com o zoom
ctx.font = `${Math.max(3, 12 / scale)}px Inter, sans-serif`;
```

Três modos de rótulo valem a pena: `auto` (só o nó em foco e a vizinhança),
`sempre` e `nunca`.

### Foco e busca

Passar o mouse ou clicar num nó acende ele e os vizinhos; o resto apaga.

```ts
const vizinhos = useMemo(() => {
  if (!focoId) return new Set<string>();
  const s = new Set([focoId]);
  for (const l of visivel.links) {
    const src = idOf(l.source), tgt = idOf(l.target);
    if (src === focoId) s.add(tgt);
    if (tgt === focoId) s.add(src);
  }
  return s;
}, [focoId, visivel.links]);
```

A busca funciona igual: casa rótulo e tags, acende quem casou, apaga o resto.
Não filtre os nós na busca — **apagar é melhor que sumir**, porque o usuário
mantém a referência espacial do grafo.

---

## Passo 5 — Memória nova nasce animada

É o detalhe que faz a tela parecer viva, e o único enfeite que vale o custo:
quando o usuário ensina algo, ele **vê a memória entrar no cérebro**.

Guarde `_born = performance.now()` no nó novo e desenhe, por ~2,4 s:

- um brilho radial que cresce e some (`easeOutCubic`);
- três ondas concêntricas defasadas, cada uma com opacidade caindo ao quadrado;
- o nó chegando com `easeOutBack` (passa do tamanho e volta).

```ts
const NASC_MS = 2400;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

let bp = -1;
if (n._born != null) {
  bp = (performance.now() - n._born) / NASC_MS;
  if (bp >= 1) { n._born = undefined; bp = -1; }   // limpa: a animação é única
}
```

Respeite `prefers-reduced-motion`: nesse caso, desenhe o nó direto no tamanho
final, sem ondas.

---

## Passo 6 — O painel de ajustes (as "Forces" do Obsidian)

Guarde em `localStorage` — a pessoa arruma o grafo do jeito dela uma vez.

```ts
interface Ajustes {
  repulsao: number;     // 170  — força que afasta os nós
  distancia: number;    // 60   — comprimento das ligações
  centro: number;       // 0.06 — força que puxa tudo para o meio
  tamanho: number;      // 1    — multiplicador do raio
  espessura: number;    // 1    — multiplicador da linha
  rotulos: "auto" | "sempre" | "nunca";
  fixar: boolean;       // nó arrastado fica onde soltar
  orfaos: boolean;      // mostrar nós sem conexão
  tipos: Record<MemoryType, boolean>;   // filtro por tipo
}
```

Aplique nas forças do d3 e reaqueça a simulação:

```ts
const charge = fg.d3Force("charge");
charge?.strength?.(-ajustes.repulsao);
charge?.distanceMax?.(800);                      // sem teto, grafo grande fica lento

const link = fg.d3Force("link");
link?.distance?.((l) => (l.kind === "link" ? ajustes.distancia * 1.15 : ajustes.distancia * 0.7));
// wikilink é relação forte: linha um pouco mais longa e mais visível que tag

fg.d3Force("center")?.strength?.(ajustes.centro);
fg.d3ReheatSimulation();
```

Filtrar por tipo tem de reusar **os mesmos objetos de nó**, não cópias, ou as
posições se perdem a cada clique na legenda:

```ts
const visivel = useMemo(() => {
  const ok = new Set(graph.nodes.filter((n) => ajustes.tipos[n.type]).map((n) => String(n.id)));
  const links = graph.links.filter((l) => ok.has(idOf(l.source)) && ok.has(idOf(l.target)));
  let nodes = graph.nodes.filter((n) => ok.has(String(n.id)));
  if (!ajustes.orfaos) {
    const comLigacao = new Set<string>();
    for (const l of links) { comLigacao.add(idOf(l.source)); comLigacao.add(idOf(l.target)); }
    nodes = nodes.filter((n) => comLigacao.has(String(n.id)));
  }
  return { nodes, links };
}, [graph, ajustes.tipos, ajustes.orfaos]);
```

Clicar num item da legenda liga e desliga aquele tipo. É o filtro mais usado e
não precisa de menu.

---

## Passo 7 — Enquadrar

```ts
// o canvas nasce com tamanho padrão e só depois recebe o real;
// sem isto, o grafo abre deslocado
useEffect(() => {
  const t = setTimeout(() => fgRef.current?.zoomToFit(400, 90), 50);
  return () => clearTimeout(t);
}, [dims]);
```

**Ponha teto no zoom.** Com três ou quatro memórias, o `zoomToFit` amplia até os
nós virarem bolhas gigantes. Limite em torno de `2.2`.

---

## Passo 8 — O painel do nó

Clicar num nó abre um painel lateral com: título, tipo, tags, corpo em Markdown,
"atualizado há X", e as ações de **editar** e **apagar**. Os `[[wikilinks]]` do
corpo viram links clicáveis que selecionam o nó de destino.

Um relativo curto ajuda mais que uma data:

```ts
export function desde(iso: string, agora = Date.now()): string {
  const ms = agora - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `há ${d} d` : `há ${Math.floor(d / 30)} m`;
}
```

---

## Passo 9 — Memórias de exemplo

Um cérebro vazio não ensina nada: o usuário abre a tela, vê um fundo escuro e
fecha. Semeie 30 a 50 memórias de exemplo ligadas entre si por wikilinks e tags,
marcadas com uma coluna `seed = true`, e ofereça um botão **"Remover exemplos"**
que apaga só elas.

Cuidado real: memórias dos tipos que entram em **toda** resposta (`feedback` e
`user`) mudam o comportamento do agente desde o primeiro dia. Escreva as de
exemplo alinhadas ao prompt do sistema, ou o agente nasce se contradizendo.

---

## Armadilhas, em resumo

| sintoma | causa | conserto |
| --- | --- | --- |
| Os nós saltam a cada atualização | `buildGraph` substituindo o estado | fundir preservando os objetos de nó |
| Rótulo cresce ao dar zoom | `Math.max(piso, 12/scale)` | `12 / scale`, sem piso |
| Grafo abre gigante com poucas memórias | `zoomToFit` sem teto | limitar o zoom em ~2.2 |
| Novelo preto de linhas | tags ligando todos com todos | cadeia por tag |
| Grafo abre deslocado | canvas medido depois do primeiro desenho | reenquadrar quando as dimensões mudarem |
| Trava com muitos nós | `charge` sem `distanceMax` | `distanceMax(800)` |
| `source` às vezes é string, às vezes objeto | a biblioteca muta os links | sempre normalizar com `idOf` |
| Build de SSR quebra | import direto da biblioteca | `lazy(() => import(...))` |

## Verificação final

- [ ] Abrir a tela com o cérebro vazio, com 3 memórias e com 50: os três casos
      enquadram bem.
- [ ] Cadastrar uma memória com a tela aberta: ela nasce animada, sem os outros
      nós saltarem.
- [ ] Arrastar um nó, recarregar a página: os ajustes voltam do `localStorage`.
- [ ] Clicar num tipo na legenda: os nós somem e voltam sem embaralhar o resto.
- [ ] Buscar por uma palavra: os que casam acendem, os outros apagam sem sumir.
