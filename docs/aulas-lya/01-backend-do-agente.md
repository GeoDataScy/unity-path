# Planta do backend de um agente (modelo: Lya)

> **Como usar este arquivo.** Entregue-o inteiro a um assistente de código
> (Claude Code, Cursor, etc.) junto com uma descrição do SEU domínio: quais telas
> o seu sistema tem, quais números aparecem nelas e quais tabelas existem no
> banco. Ele tem tudo o que é preciso para montar um agente com a mesma
> arquitetura da Lya, que está em produção no XMX Suporte desde 07/09/2026.
>
> Você não precisa entender o código para usar o arquivo. Precisa entender as
> seis decisões que ele carrega — elas estão explicadas em português antes de
> cada bloco.

---

## O que você vai construir

Um agente de IA que responde perguntas em linguagem natural sobre os dados de um
sistema, usando **as mesmas contas que desenham as telas** — nunca contas novas.

Ele roda inteiro no servidor (uma Edge Function do Supabase, em Deno). O browser
só manda a pergunta e recebe a resposta em pedaços, ao vivo.

```
navegador ──POST + crachá do usuário──► Edge Function ──► API da Anthropic
                                             │
                                             └──► Postgres (as mesmas RPCs das telas)
```

### As seis decisões que sustentam tudo

1. **A chave da IA nunca vai para o navegador.** Ela vive num secret do
   servidor. Se ela estivesse no site, qualquer visitante poderia copiá-la.
2. **O agente entra com o crachá de quem perguntou**, não com um crachá de
   administrador. Quem não pode ver um dado na tela também não vê pelo agente.
3. **As ferramentas chamam as mesmas funções das telas.** É o que garante que o
   número do agente é igual ao número do card.
4. **Toda conta acontece no banco**, nunca "de cabeça" do modelo. Duas
   execuções da mesma pergunta têm de dar o mesmo número.
5. **SQL livre só dentro de um sandbox** que só sabe ler, e só sabe ler o que
   foi liberado.
6. **Uma segunda IA revisa** toda resposta contra as evidências coletadas, e
   falha para o lado seguro: se a revisão quebrar, a resposta sai assim mesmo,
   com uma ressalva.

---

## Estrutura de arquivos

```
supabase/functions/<agente>/
├── index.ts        porteiro + o loop do turno + o stream para o navegador
├── prompt.ts       personalidade, regras duras, glossário do negócio, catálogo do banco
├── tools.ts        as ferramentas (uma função por pergunta que o agente pode fazer)
├── anthropic.ts    cliente da API e a escolha dos três modelos
├── verificador.ts  a segunda IA que revisa a resposta
└── treinador.ts    a IA que organiza as memórias que o usuário ensina
```

Na Lya isso dá 1.636 linhas no total. Não é um projeto grande.

---

## 1. O porteiro (`index.ts`)

Antes de qualquer coisa: quem está falando, e essa pessoa pode falar com o agente?

```ts
// O client é criado com o JWT de quem perguntou — e não com a service_role.
// É isto que faz a RLS e os guards do banco valerem dentro do agente.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!,
  { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
);

const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) return json({ error: "Não autenticado." }, 401);

const { data: profile } = await supabase
  .from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();

if (profile?.is_active === false) return json({ error: "Conta desativada." }, 403);
if (!PAPEIS_PERMITIDOS.includes(String(profile?.role))) {
  return json({ error: "Este agente atende só a área X." }, 403);
}
```

**Nunca use a `service_role` aqui.** É o atalho mais tentador e o mais perigoso:
com ela o agente passa a enxergar tudo, e uma pergunta bem formulada vira um
vazamento de dado que a pessoa não teria na tela.

A função aceita três ações num JSON (`{ action, ... }`):

| ação | o que faz |
| --- | --- |
| `chat` | um turno do agente; devolve um stream de eventos |
| `memoria_salvar` | grava uma memória no cérebro (só quem pode treinar) |
| `ping` | diz se está no ar e se a chave da IA está configurada |

A ação `ping` parece supérflua e não é: quando a chave está errada, é ela que
permite descobrir isso pela interface, sem abrir log de servidor.

---

## 2. O loop do turno — o coração

Isto é o que separa um **agente** de um chatbot. O modelo responde; se ele pedir
ferramentas, o servidor executa, devolve o resultado e chama o modelo de novo.
Repete até ele parar de pedir.

```ts
const MAX_STEPS = 10;              // trava anti-loop
const TURN_BUDGET_MS = 95_000;     // orçamento de parede do turno

for (let step = 0; step < MAX_STEPS; step++) {
  const estourouTempo = Date.now() - turnStartedAt > TURN_BUDGET_MS;
  const ultimaRodada = step === MAX_STEPS - 1 || estourouTempo;

  const ai = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: CHAT_EFFORT },
    system,
    tools,
    // Na última rodada o modelo é OBRIGADO a sintetizar com o que já tem.
    ...(ultimaRodada ? { tool_choice: { type: "none" as const } } : {}),
    messages,
  });

  ai.on("text", (t) => sse({ type: "token", text: t }));   // stream para o navegador
  const final = await ai.finalMessage();

  if (final.stop_reason === "tool_use") {
    const toolUses = final.content.filter((b) => b.type === "tool_use");

    // Guarde a mensagem INTEIRA, incluindo os blocos de thinking:
    // eles precisam voltar intactos na próxima chamada.
    messages.push({ role: "assistant", content: final.content });
    for (const tu of toolUses) sse({ type: "tool", name: tu.name, input: tu.input });

    // Ferramentas do mesmo passo rodam em paralelo.
    const results = await Promise.all(toolUses.map(async (tu) => {
      const tool = getTool(tu.name);
      if (!tool) return { type: "tool_result", tool_use_id: tu.id, content: `Ferramenta desconhecida: ${tu.name}`, is_error: true };
      try {
        const out = await tool.execute(tu.input ?? {}, ctx);
        if (tool.origem) evidencias.push({ origem: tool.origem, titulo: tu.name, conteudo: out.slice(0, 5000) });
        return { type: "tool_result", tool_use_id: tu.id, content: out };
      } catch (err) {
        return { type: "tool_result", tool_use_id: tu.id, content: String(err?.message ?? "erro"), is_error: true };
      }
    }));

    messages.push({ role: "user", content: results });
    continue;
  }

  if (final.stop_reason === "max_tokens") { sse({ type: "error", message: "A resposta excedeu o teto de tokens." }); break; }
  if (final.stop_reason === "refusal")    { sse({ type: "error", message: "O agente não pôde responder." }); break; }

  completed = true;
  break;
}
```

### As três travas, e por que cada uma existe

- **`MAX_STEPS = 10`** — sem isso, um modelo confuso pode pedir ferramenta para
  sempre. Na última rodada, `tool_choice: none` obriga a resposta.
- **Orçamento de tempo (95 s)** — a Edge Function tem teto de duração. Ao cruzar
  o orçamento, a próxima rodada já é a de síntese, para o stream não morrer sem
  o evento final.
- **Pular a revisão perto do teto (115 s)** — entregar a resposta vale mais do
  que revisá-la.

### O detalhe do parágrafo colado

Quando o modelo escreve um preâmbulo ("Vou consultar…"), pede a ferramenta e
depois escreve a resposta, os dois textos chegam grudados no navegador. Guarde
um `pendingBreak` e injete `\n\n` antes do próximo token quando houve ferramenta
no meio. Sem isso o Markdown final quebra.

---

## 3. O contrato das ferramentas (`tools.ts`)

Uma ferramenta é um objeto com nome, descrição, formato de entrada, a **origem
da evidência** que ela produz e uma função que devolve **texto**.

```ts
export interface AgentTool {
  name: string;
  description: string;   // é ISTO que o modelo lê para decidir quando usar
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  origem: "painel" | "banco" | "base" | "regras" | null;  // null = tool de entrega
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}
```

O campo `origem` não serve ao modelo: serve ao **verificador** da seção 6. Toda
ferramenta que traz fato declara de onde ele veio; ferramentas que só entregam
algo à interface (um gráfico, por exemplo) declaram `null`.

### As quatro famílias

| família | o que faz | origem |
| --- | --- | --- |
| **painel** (`painel_*`, `listar_*`) | chama a MESMA RPC que alimenta a tela | `painel` |
| **banco** (`consultar_banco`) | SELECT livre no sandbox | `banco` |
| **conteúdo** (`buscar_*`) | tabelas editoriais, textos, catálogos | `base` |
| **entrega** (`gerar_grafico`, `salvar_memoria`) | produz um artefato para a interface | `null` |

### O molde de uma ferramenta de painel

```ts
const painelAtendimentos: AgentTool = {
  name: "painel_atendimentos",
  origem: "painel",
  description:
    "Tela ATENDIMENTOS (RPC dashboard_metrics): total de eventos do período, quebra por agente, " +
    "por produto, por dia, por plataforma e por canal. É o número dos cards e gráficos da tela. " +
    "Use para 'quantos atendimentos', 'quem mais atendeu', 'evolução por dia'.",
  input_schema: {
    type: "object",
    properties: { de: P_DE, ate: P_ATE, agente_id: P_AGENTE },
    required: ["de", "ate"],
  },
  async execute(input, ctx) {
    const de = dataISO(input.de, "de");          // valida ANTES de virar parâmetro
    const ate = dataISO(input.ate, "ate");
    const ag = agenteId(input.agente_id);
    const data = await rpc(ctx, "dashboard_metrics", { from_date: de, to_date: ate, agent_id: ag });
    // O cabeçalho diz a fonte e o recorte; o modelo repete isso na resposta.
    return cabecalho("tela Atendimentos — dashboard_metrics", { de, ate, agente_id: ag }) + clip(data);
  },
};
```

Três hábitos que valem para toda ferramenta:

1. **Valide a entrada** antes de passá-la ao banco (data no formato certo, id
   existente, enum conhecido).
2. **Comece o retorno com um cabeçalho de fonte e recorte.** É o que faz o
   agente escrever "na tela Atendimentos, de 01/09 a 07/09" em vez de largar um
   número solto.
3. **Corte o resultado** com aviso, em vez de estourar o contexto:

```ts
export function clip(data: unknown, max = 36_000): string {
  let json = JSON.stringify(data);
  if (json.length <= max) return json;
  if (Array.isArray(data)) {
    let kept = data as unknown[];
    while (kept.length > 1 && JSON.stringify(kept).length > max) kept = kept.slice(0, Math.floor(kept.length * 0.7));
    return JSON.stringify({
      _aviso: `Resultado truncado: mostrando ${kept.length} de ${data.length} registros. Refine o recorte ou agregue no SQL.`,
      registros: kept,
    });
  }
  return json.slice(0, max) + "…(truncado — refine o recorte)";
}
```

### Erro de permissão é mensagem, não exceção

Quando um perfil mais restrito chama uma ferramenta que não pode, o certo é o
modelo **saber** disso e explicar, em vez de o turno quebrar:

```ts
async function rpc(ctx: ToolContext, fn: string, args: Record<string, unknown>) {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) {
    const msg = String(error.message || "");
    if (/forbidden|permission denied|42501/i.test(msg)) {
      throw new Error(`Acesso negado a ${fn}: este conteúdo é restrito (o perfil atual não pode vê-lo).`);
    }
    throw new Error(`${fn} falhou: ${msg.slice(0, 300)}`);
  }
  return data;
}
```

---

## 4. O sandbox de SQL

O painel não responde tudo. Para o resto, o modelo escreve SQL e o Postgres
executa. É a parte mais delicada do projeto, e por isso tem **cinco camadas**.

```
1. filtro na Edge Function   só SELECT/WITH, uma instrução, lista negra de tabelas
2. guard de negócio          a função exige a permissão da área
3. restrições da função      transação read-only, timeout de 8 s, LIMIT por fora
4. dona da função            uma role NOLOGIN dedicada: a função roda como ela
5. o que a role enxerga      GRANT SELECT só nas tabelas de dados; nada de auth, logs ou PII
```

A camada 4 é a que torna as outras redundantes — e redundância aqui é o objetivo.

```sql
-- A role que o SQL do modelo "vira" quando executa.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agente_sql_ro') THEN
    CREATE ROLE agente_sql_ro NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO agente_sql_ro;
GRANT agente_sql_ro TO postgres;  -- o dono precisa assumir a role para o ALTER OWNER

-- Uma view sem PII: o agente conhece pessoas por nome e papel, nunca por e-mail de login.
CREATE OR REPLACE VIEW public.agente_pessoas AS
  SELECT p.id, p.full_name, p.role::text AS role, p.is_active FROM public.profiles p;

-- Libere UMA A UMA as tabelas de dados. Nunca `GRANT ... ON ALL TABLES`.
DO $$
DECLARE t text;
  tabelas text[] := ARRAY['services', 'refunds', 'products'];  -- <<< as SUAS tabelas
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT SELECT ON public.%I TO agente_sql_ro', t);
    -- Tabela com RLS ligada precisa de uma policy para a role nova;
    -- ela só é alcançável por dentro da função guardada.
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'agente_sql_ro read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO agente_sql_ro USING (true)', 'agente_sql_ro read', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.agente_exec_sql(p_sql text, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
  v_out   jsonb;
BEGIN
  IF NOT public.pode_ver_analytics() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- \y é fronteira de palavra no Postgres; \b seria backspace.
  IF v_sql !~* '^\s*(select|with)\y' THEN
    RAISE EXCEPTION 'Apenas consultas SELECT/WITH sao permitidas.';
  END IF;
  IF position(';' IN v_sql) > 0 THEN
    RAISE EXCEPTION 'Instrucao unica: remova o(s) ";" da consulta.';
  END IF;

  PERFORM set_config('statement_timeout', '8000', true);
  PERFORM set_config('transaction_read_only', 'on', true);

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) q LIMIT %s) t',
    v_sql, v_limit) INTO v_out;
  RETURN v_out;
END; $$;

-- A troca de dono é o que fecha o cerco.
GRANT CREATE ON SCHEMA public TO agente_sql_ro;
ALTER FUNCTION public.agente_exec_sql(text, integer) OWNER TO agente_sql_ro;
REVOKE CREATE ON SCHEMA public FROM agente_sql_ro;

REVOKE ALL ON FUNCTION public.agente_exec_sql(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agente_exec_sql(text, integer) TO authenticated, service_role;
```

### O catálogo é escrito à mão — não introspectado

Esta é uma lição cara. Se você deixar o modelo descobrir o schema sozinho, ele
escreve SQL **plausível e errado**: compara uma data guardada como texto sem
converter, confia numa coluna de status que na prática é derivada de outra
tabela, ignora o fuso do negócio.

A solução é um texto escrito por quem conhece o sistema, entregue na descrição
da ferramenta, com as armadilhas explícitas:

```
- services(id text, user_id text, service_date TEXT [timestamp escolhido pelo agente;
  cast ::timestamptz; o dia é o de São Paulo], status ['novo'|'em_andamento'|'concluido'
  — NÃO confie só nele: o status vivo é o do último follow-up], ...)

CONVENÇÕES:
- Dia local: (col AT TIME ZONE 'America/Sao_Paulo')::date
- Faça TODO cálculo no SQL (percentual, média, variação, ranking) — nunca "de cabeça".
- Máx. 200 linhas. Agregue em vez de listar tudo.
- Descubra valores com SELECT DISTINCT antes de filtrar por texto.
- Nunca consulte tabelas fora desta lista.
```

Do lado do TypeScript, filtre antes de mandar ao banco:

```ts
if (!/^\s*(select|with)\b/i.test(sql)) throw new Error("Apenas consultas SELECT/WITH são permitidas.");
if (sql.includes(";")) throw new Error("Envie UMA instrução, sem ';'.");
if (/\b(profiles|auth\.|storage\.|vault\.|pg_catalog|information_schema)\b/i.test(sql)) {
  throw new Error("A consulta referencia uma tabela fora do catálogo liberado.");
}
```

---

## 5. O prompt (`prompt.ts`)

Duas partes com ciclos de vida diferentes, e isso é deliberado:

```ts
system = [
  // Bloco estático: persona + regras + glossário + catálogo. Vai com cache.
  { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  // Bloco por turno: contexto da tela + memórias recuperadas. Separado para
  // não invalidar o cache do prefixo a cada pergunta.
  { type: "text", text: blocoContexto(contexto, hoje) + "\n\n" + blocoMemorias(recall) },
];
```

### As regras duras — copie e adapte

Estas linhas são o que impede o agente de inventar. Elas foram testadas em
produção; mudar o tom delas muda o comportamento.

```
- PROIBIDO responder com base no seu conhecimento próprio/treinamento. Se a informação
  não veio de uma ferramenta nem das regras do sistema, você NÃO a possui. Nunca use
  expressões como "com base no conhecimento consolidado" ou "é sabido que".
- PROIBIDO fazer aritmética "de cabeça" sobre os dados (percentual, média, variação):
  peça o número pronto ou escreva a conta dentro do SQL. Duas execuções da mesma
  pergunta DEVEM dar os mesmos números.
- Se nenhuma ferramenta trouxer a informação, diga apenas: "Não encontrei isso nos
  dados disponíveis." e pare. Não complemente com suposições.
- Afirmação de AUSÊNCIA ("não há registro de X") só depois de CONSULTAR a fonte que
  teria X — nunca deduza ausência do que não foi consultado.
- Se uma ferramenta falhar ou vier vazia, TENTE outra antes de dizer que não existe.
- Diga sempre de onde veio cada número e o período/recorte usado.
- NUNCA pergunte se pode consultar ("Deseja que eu consulte?" é PROIBIDO) — se a
  resposta exigir dados, consulte imediatamente e responda.
```

A regra da **ausência** é a menos óbvia e uma das mais importantes: sem ela, o
modelo responde "não há nenhum caso" sobre uma fonte que nunca abriu.

### O glossário do negócio

Um bloco em texto corrido com os fatos fixos do sistema: o que conta como um
evento, como um status é derivado, qual é a meta, o que significa cada estado.
Ele vai no prompt **e** entra como evidência de origem `regras` para o
verificador — assim o revisor sabe distinguir "regra do sistema" de "invenção".

### O contexto da tela

O que o navegador manda junto com cada pergunta: data de hoje no fuso do
negócio, quem está falando e qual o papel, o período e o filtro selecionados na
barra lateral, qual tela está aberta. É isto que permite perguntar "e nesse
período?" sem repetir as datas.

---

## 6. O verificador (`verificador.ts`)

Depois que a resposta terminou de ser transmitida, uma segunda IA — menor e mais
barata — confere o rascunho frase por frase contra as evidências que as
ferramentas coletaram.

Como o texto já foi para o navegador, o veredito **não reescreve nada**: vira um
bloco "Revisão automática" no fim e um evento que a interface guarda.

```ts
const resp = await anthropic().messages.create({
  model: VERIFIER_MODEL,          // um modelo pequeno: roda em toda resposta
  max_tokens: 4096,
  temperature: 0,                 // duas revisões do mesmo rascunho = mesmo veredito
  system: SYSTEM_VERIFICADOR,
  tools: [TOOL_EMITIR_REVISAO],
  tool_choice: { type: "tool", name: "emitir_revisao" },   // saída estruturada garantida
  messages: [{ role: "user", content: entrada }],
}, { signal });
```

Formato do veredito:

```ts
{
  aprovado: boolean,
  ressalvas: { afirmacao: string; motivo: string; gravidade: "alta" | "media" | "baixa" }[],
  divergencias: string[],
}
// alta  = fato sem nenhuma base, ou ausência afirmada sem consultar a fonte
// media = conta derivada no texto que não aparece pronta em nenhuma evidência
// baixa = número sem período quando a evidência permitia datá-lo
```

Regras do prompt do verificador que valem a pena copiar:

- **Hierarquia de confiança** explícita: tela > banco > regras > conteúdo
  editorial. Conflito entre fontes vira uma "divergência" reportada, nunca uma
  escolha silenciosa.
- **Ausência de evidência não é evidência de ausência** — ressalva alta.
- Resposta puramente conversacional (saudação, explicação de uma regra, "não
  encontrei") é aprovada sem ressalva.

### Fail-open, sempre

```ts
function failOpen(motivo: string): Revisao {
  return { aprovado: true, ressalvas: [{ afirmacao: "(verificador indisponível)", motivo, gravidade: "baixa" }], divergencias: [] };
}
```

O verificador é camada de qualidade, nunca ponto de falha. Timeout, erro de
rede, resposta sem veredito: devolve o rascunho intacto com uma ressalva baixa.
Só as divergências e as ressalvas **altas** aparecem para o usuário.

---

## 7. O cérebro e o treinador

O prompt fixo é do desenvolvedor. O **cérebro** é do usuário: uma tabela de
memórias que ele cadastra em português e que entram no prompt a cada pergunta.
Sem deploy, sem programador. (A aula 2 explica isso em linguagem de gente.)

### A tabela

```sql
CREATE TABLE IF NOT EXISTS public.agente_memories (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL UNIQUE,          -- slug: corrigir = sobrescrever
  description text NOT NULL DEFAULT '',
  type        text NOT NULL DEFAULT 'nota'
              CHECK (type IN ('user','feedback','project','reference','nota')),
  tags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  body        text NOT NULL DEFAULT '',      -- [[wikilinks]] ligam memórias
  author_id   text REFERENCES public.profiles(id) ON DELETE SET NULL,
  seed        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- O índice de busca precisa ter a expressão IDÊNTICA à da consulta de recall,
-- senão o planner o ignora. E as tags TÊM de entrar: elas existem para o recall.
CREATE INDEX IF NOT EXISTS idx_agente_memories_fts ON public.agente_memories
  USING GIN (to_tsvector('portuguese',
    coalesce(description,'') || ' ' || coalesce(body,'') || ' ' || coalesce(tags::text,'')));
```

### Os dois grupos de memória

| tipo | é | quando entra no prompt |
| --- | --- | --- |
| `feedback` | como responder: estilo, formato, o que evitar | **sempre** |
| `user` | quem o agente é e para quem responde | **sempre** |
| `nota` | um fato do domínio | por relevância |
| `project` | trabalho em andamento, meta, campanha | por relevância |
| `reference` | link, planilha, painel externo | por relevância |

**Toda regra de comportamento tem de ser `feedback` ou `user`.** Uma regra de
estilo salva como `nota` só entra quando a pergunta por acaso bate com as
palavras dela — ou seja, quase nunca. Foi um dos erros herdados que a Lya já
nasceu corrigindo.

### A busca (recall)

```sql
-- ' & ' -> ' | ': a busca do Postgres exige TODAS as palavras por padrão.
-- Com AND, uma pergunta de cinco palavras nunca casa com memória nenhuma.
v_tsq := nullif(
  regexp_replace(websearch_to_tsquery('portuguese', coalesce(p_query,''))::text, ' & ', ' | ', 'g'),
  '')::tsquery;
```

Depois: ranqueia as memórias de conhecimento por relevância (até 12), segue
**um salto** de `[[wikilinks]]` a partir das encontradas (até 8) e junta as de
comportamento, que entram sem filtro. Devolve um único JSON
`{ comportamento, conhecimento }`.

### O treinador

Uma IA que recebe o que o usuário escreveu — em geral uma frase solta, sem tipo
— e devolve a memória **classificada e enriquecida**, com tool forçada:

```ts
tool_choice: { type: "tool", name: "salvar_memoria" }   // saída estruturada, sempre
```

O que o prompt do treinador precisa dizer, e o motivo:

- **Explique como o recall funciona.** O treinador escreve para ser encontrado
  depois: description, body e tags têm de conter as palavras que o usuário
  provavelmente usaria ao perguntar, com sinônimos ("reembolso", "estorno",
  "devolução"; nome com e sem sobrenome).
- **Regra de comportamento vira `feedback`.** Na dúvida entre `feedback` e
  `nota` para uma regra, escolha `feedback`.
- **Não invente.** Enriquecer é explicitar a intenção, não criar conteúdo novo.
- **Preserve os `[[wikilinks]]`** do original.
- **3 a 6 tags** minúsculas, sem acento, estilo slug.

### O modo treino no chat

Além da tela de cadastro, vale ter um modo em que o agente **não consulta nada**:
só aprende. Cada mensagem vira uma chamada a `salvar_memoria`. O detalhe que
evita duplicar: o prompt desse modo lista as memórias que o agente **já tem**
sobre o assunto, cada uma com o seu slug, e pede que uma correção passe o slug
exato — assim o upsert atualiza a memória certa em vez de criar uma segunda,
contraditória.

---

## 8. Os modelos e a configuração

Três papéis, três modelos independentes, todos por variável de ambiente:

```ts
export const CHAT_MODEL     = Deno.env.get("AGENTE_MODEL")          || "claude-opus-5";
export const TRAINER_MODEL  = Deno.env.get("AGENTE_TRAINER_MODEL")  || "claude-opus-5";
export const VERIFIER_MODEL = Deno.env.get("AGENTE_VERIFIER_MODEL") || "claude-haiku-4-5";
export const CHAT_EFFORT    = (Deno.env.get("AGENTE_EFFORT") || "medium") as "low" | "medium" | "high";
export const MAX_TOKENS     = 16000;   // é um teto, não um gasto
```

- O **chat** precisa do modelo mais capaz: é ele que escolhe ferramentas e
  escreve SQL.
- O **treinador** roda pouco (uma vez por memória): pode ser caro.
- O **verificador** roda em toda resposta: precisa ser barato e determinístico.
  `temperature: 0` funciona no Haiku; nos modelos maiores de raciocínio o
  parâmetro é rejeitado com erro 400.

### Duas armadilhas reais da chave da API

1. **Cliente amarrado ao valor da chave.** Sem isso, uma instância quente da
   função continua usando a chave velha depois que você regrava o secret.

```ts
let _client: Anthropic | null = null;
let _clientKey: string | null = null;
export function anthropic(): Anthropic {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY não configurada nos secrets do projeto.");
  if (!_client || _clientKey !== key) { _client = new Anthropic({ apiKey: key }); _clientKey = key; }
  return _client;
}
```

2. **Valide a chave caractere a caractere.** Uma chave colada com aspas curvas,
   espaço especial ou quebra de linha derruba o turno com um
   `"Argument 2 is not a valid ByteString"` completamente opaco. Transforme isso
   numa mensagem que diga **onde** está o problema, sem expor a chave:

```ts
const invalidos: string[] = [];
for (let i = 0; i < key.length; i++) {
  const c = key.charCodeAt(i);
  if (c < 0x21 || c > 0x7e) invalidos.push(`posição ${i + 1} (código U+${c.toString(16).toUpperCase().padStart(4, "0")})`);
}
if (invalidos.length) throw new Error(`O secret contém caractere inválido em ${invalidos.join(", ")} — regrave a chave limpa.`);
```

Aconteceu duas vezes na Lya: uma com a chave gravada como o texto do exemplo
(`SUA_CHAVE`), outra com a chave copiada de um chat que mascarava os caracteres
com `•`.

---

## 9. Checklist para adaptar ao seu domínio

- [ ] Liste as telas do seu sistema. Cada tela vira uma ferramenta `painel_*`
      que chama a MESMA função que a tela chama.
- [ ] Escreva o glossário do negócio: o que cada número significa, como cada
      status é derivado, quais são as regras e metas.
- [ ] Escreva o catálogo do banco à mão, com as armadilhas de tipo e fuso.
- [ ] Escolha as tabelas que o sandbox pode ler. Nunca inclua tabelas de
      autenticação, logs de sessão, memórias do agente ou PII.
- [ ] Defina quem conversa e quem treina — são permissões diferentes.
- [ ] Crie o secret da chave e confira com a ação `ping` antes de testar o chat.
- [ ] Teste a recusa: peça ao agente para apagar algo e confirme que ele não
      consegue; peça um dado restrito com um perfil limitado e confirme que ele
      explica em vez de vazar.

---

## Como estender depois

| você quer | onde mexer |
| --- | --- |
| Tela nova no agente | uma ferramenta `painel_*` chamando a RPC dela + citar a tela na persona |
| Tabela nova no SQL | adicionar ao array da migration (GRANT + policy) **e** ao catálogo do prompt |
| Regra de negócio nova | uma linha no glossário — vale para o prompt e para o verificador de uma vez |
| Comportamento novo, sem deploy | o usuário cadastra uma memória do tipo `feedback` |
| Trocar de modelo | só a variável de ambiente; os três papéis são independentes |
