// Edge Function `lya` — o motor do agente de IA do Painel da Gestora.
//
// Por que aqui: o app é 100% browser e a chave da Anthropic não pode ir para o
// bundle. Ela fica nos secrets do projeto (ANTHROPIC_API_KEY) e só sai daqui —
// mesmo desenho da função `zendesk`. Os dados são lidos com o JWT do próprio
// usuário: cada RPC de painel aplica o mesmo guard que aplica na tela.
//
// Ações (body JSON `{ action, ... }`):
//   chat           → turno do agente com TOOL CALLING, resposta em SSE
//                    (eventos: tool, token, chart, memoria, aviso, revisao, error, done)
//   memoria_salvar → grava uma memória no cérebro (treinador + RPC); só gestora
//   ping           → saúde + se a chave está configurada
//
// Arquitetura do turno (espelho do Daniel/CBIE):
//   recall das memórias → system (estático cacheado + contexto da tela + memórias)
//   → loop de tool-use com stream → passe verificador anti-fakenews (fail-open)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anthropic, apiKeyConfigurada, CHAT_EFFORT, CHAT_MODEL, MAX_TOKENS, type Anthropic } from "./anthropic.ts";
import { blocoContexto, blocoMemorias, type ContextoTela, type Recall, SYSTEM, systemTreinoComMemorias } from "./prompt.ts";
import { REGRAS_DO_SISTEMA } from "./prompt.ts";
import { anthropicToolDefs, anthropicTrainingToolDefs, getTool, salvarMemoriaNoCerebro, type ToolContext } from "./tools.ts";
import { type Evidencia, revisar } from "./verificador.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Trava anti-loop: rodadas de tool-use por turno. Na última o modelo é
// FORÇADO a sintetizar (tool_choice: none) com o que já coletou.
const MAX_STEPS = 10;
// Orçamento de parede do turno. A Edge Function tem teto de duração; ao cruzar
// isto a próxima rodada já sintetiza, para o stream não morrer sem `done`.
const TURN_BUDGET_MS = 95_000;
// Perto do teto, pula o verificador (outra chamada à API) para GARANTIR o `done`.
const VERIFIER_SKIP_AFTER_MS = 115_000;
const VERIFIER_TIMEOUT_MS = 25_000;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  action?: string;
  messages?: ChatMessage[];
  modoTreino?: boolean;
  contexto?: ContextoTela;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Memórias relevantes para a pergunta (RPC lya_recall_memories). Falha aqui
// nunca derruba o chat — mas o usuário precisa saber que a resposta saiu sem o
// treino (evento `aviso`), senão lê uma resposta destreinada como se fosse a
// treinada.
async function recallMemorias(supabase: SupabaseClient, pergunta: string): Promise<Recall> {
  try {
    const { data, error } = await supabase.rpc("lya_recall_memories", { p_query: pergunta, p_limit: 12 });
    if (error) return { comportamento: [], conhecimento: [], falha: String(error.message || "erro no recall") };
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      comportamento: Array.isArray(d.comportamento) ? (d.comportamento as Recall["comportamento"]) : [],
      conhecimento: Array.isArray(d.conhecimento) ? (d.conhecimento as Recall["conhecimento"]) : [],
    };
  } catch (err) {
    return { comportamento: [], conhecimento: [], falha: err instanceof Error ? err.message : "rede" };
  }
}

function streamChat(supabase: SupabaseClient, body: ChatBody, role: string): Response {
  const history = Array.isArray(body.messages) ? body.messages.filter((m) => m && (m.role === "user" || m.role === "assistant")) : [];
  const modoTreino = body.modoTreino === true && role === "manager";
  const last = [...history].reverse().find((m) => m.role === "user");
  const pergunta = (last?.content ?? "").trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fechado = false;
      const sse = (obj: unknown) => {
        if (fechado) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          fechado = true; // cliente desconectou
        }
      };
      const fechar = () => {
        if (fechado) return;
        fechado = true;
        try {
          controller.close();
        } catch { /* já fechado */ }
      };

      const ctx: ToolContext = {
        supabase,
        onChart: (chart) => sse({ type: "chart", chart }),
        onMemory: (memoria) => sse({ type: "memoria", memoria }),
      };

      const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

      try {
        const client = anthropic();
        const recall = await recallMemorias(supabase, pergunta);
        if (recall.falha) {
          sse({
            type: "aviso",
            codigo: "memoria_indisponivel",
            message: "Não foi possível carregar as memórias treinadas da Lya. Esta resposta ignora o treino da gestora — tente de novo em instantes.",
          });
        }

        let tools: Anthropic.Tool[];
        let system: Anthropic.TextBlockParam[];
        if (modoTreino) {
          tools = anthropicTrainingToolDefs() as Anthropic.Tool[];
          system = [{ type: "text", text: systemTreinoComMemorias(recall) }];
        } else {
          tools = anthropicToolDefs() as Anthropic.Tool[];
          // Bloco 1 (estático, cacheado): persona + regras + catálogo.
          // Bloco 2 (por turno): contexto da tela + memórias treinadas.
          const dinamico = [blocoContexto(body.contexto, hojeSaoPaulo()), blocoMemorias(recall)].filter(Boolean).join("\n\n");
          system = [
            { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
            { type: "text", text: dinamico },
          ];
        }

        // Separação entre os trechos de texto de cada etapa do tool-use — sem
        // isso o preâmbulo ("Vou consultar...") cola no texto final.
        let emittedText = false;
        let pendingBreak = false;

        // Insumos do verificador: texto integral + tudo que as tools retornaram.
        let fullText = "";
        let completed = false;
        const evidencias: Evidencia[] = [{ origem: "regras", titulo: "Regras fixas do sistema XMX Suporte", conteudo: REGRAS_DO_SISTEMA }];

        const turnStartedAt = Date.now();

        for (let step = 0; step < MAX_STEPS; step++) {
          const estourou = Date.now() - turnStartedAt > TURN_BUDGET_MS;
          const ultimaRodada = step === MAX_STEPS - 1 || estourou;

          const ai = client.messages.stream({
            model: CHAT_MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: "adaptive" },
            output_config: { effort: CHAT_EFFORT },
            system,
            tools,
            ...(ultimaRodada ? { tool_choice: { type: "none" as const } } : {}),
            messages,
          });

          ai.on("text", (t) => {
            if (pendingBreak) {
              sse({ type: "token", text: "\n\n" });
              fullText += "\n\n";
              pendingBreak = false;
            }
            emittedText = true;
            fullText += t;
            sse({ type: "token", text: t });
          });

          const final = await ai.finalMessage();

          if (final.stop_reason === "tool_use") {
            if (emittedText) pendingBreak = true;
            const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
            // guarda a mensagem inteira (inclui blocos de thinking — precisam voltar intactos)
            messages.push({ role: "assistant", content: final.content });
            for (const tu of toolUses) sse({ type: "tool", name: tu.name, input: tu.input });

            const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
              toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
                const tool = getTool(tu.name);
                if (!tool) {
                  return { type: "tool_result", tool_use_id: tu.id, content: `Ferramenta desconhecida: ${tu.name}`, is_error: true };
                }
                try {
                  const out = await tool.execute((tu.input ?? {}) as Record<string, unknown>, ctx);
                  if (tool.origem) evidencias.push({ origem: tool.origem, titulo: tu.name, conteudo: out.slice(0, 5000) });
                  return { type: "tool_result", tool_use_id: tu.id, content: out };
                } catch (err) {
                  const message = err instanceof Error ? err.message : "erro na ferramenta";
                  return { type: "tool_result", tool_use_id: tu.id, content: message, is_error: true };
                }
              }),
            );
            messages.push({ role: "user", content: results });
            continue;
          }

          if (final.stop_reason === "max_tokens") {
            sse({ type: "error", message: "A resposta excedeu o teto de tokens antes de concluir. Peça o conteúdo por partes ou um recorte mais enxuto." });
            break;
          }

          if (final.stop_reason === "refusal") {
            sse({ type: "error", message: "A Lya não pôde responder a esta pergunta. Reformule ou peça de outra forma." });
            break;
          }

          completed = true;
          break;
        }

        if (!completed && !fullText.trim()) {
          sse({ type: "error", message: "A resposta atingiu o limite de etapas de coleta antes de ser concluída. Tente de novo ou peça por partes." });
        }

        // ── Passe anti-fakenews ──────────────────────────────────────────
        if (!modoTreino && completed && fullText.trim() && Date.now() - turnStartedAt < VERIFIER_SKIP_AFTER_MS) {
          const revisao = await revisar(pergunta, fullText, evidencias, AbortSignal.timeout(VERIFIER_TIMEOUT_MS));
          sse({ type: "revisao", revisao });
          const notas = [
            ...revisao.divergencias.map((d) => `- Fontes divergem: ${d}`),
            ...revisao.ressalvas.filter((r) => r.gravidade === "alta").map((r) => `- ${r.afirmacao}: ${r.motivo}`),
          ];
          if (notas.length) sse({ type: "token", text: `\n\n⚠️ **Revisão automática**\n${notas.join("\n")}` });
        }

        sse({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro desconhecido";
        sse({ type: "error", message });
      } finally {
        fechar();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Não autenticado." }, 401);

  // Client com o JWT do usuário: RLS e guards dos RPCs valem como na tela.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Não autenticado." }, 401);

  const { data: profile } = await supabase.from("profiles").select("role, full_name, is_active").eq("id", user.id).maybeSingle();
  const role = String(profile?.role ?? "");
  if (profile?.is_active === false) return json({ error: "Conta desativada." }, 403);
  if (role !== "manager" && role !== "copy_grup") {
    return json({ error: "A Lya atende só a área de Data Analytics do Suporte." }, 403);
  }

  let body: ChatBody & Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "chat");

  if (action === "ping") {
    return json({ ok: true, chave_configurada: apiKeyConfigurada(), modelo: CHAT_MODEL, role });
  }

  if (!apiKeyConfigurada()) {
    return json({ error: "A chave da Anthropic (ANTHROPIC_API_KEY) não está configurada nos secrets do projeto. A Lya ainda não consegue responder." }, 503);
  }

  if (action === "memoria_salvar") {
    if (role !== "manager") return json({ error: "Só a gestora pode treinar a Lya." }, 403);
    const description = String(body.description ?? "").trim();
    if (!description) return json({ error: "Informe o título da memória." }, 400);
    try {
      const row = await salvarMemoriaNoCerebro({ supabase }, {
        name: body.name ? String(body.name) : undefined,
        description,
        body: String(body.body ?? ""),
        tags: Array.isArray(body.tags) ? (body.tags as unknown[]).map(String) : [],
        type: body.type ? String(body.type) : null,
        refinar: body.refinar !== false,
      });
      return json(row, 201);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Falha ao salvar a memória." }, 400);
    }
  }

  if (action === "chat") {
    const history = Array.isArray(body.messages) ? body.messages : [];
    const last = [...history].reverse().find((m) => m?.role === "user");
    if (!last?.content?.trim()) return json({ error: "Nenhuma pergunta do usuário." }, 400);
    return streamChat(supabase, body, role);
  }

  return json({ error: `Ação desconhecida: ${action}` }, 400);
});
