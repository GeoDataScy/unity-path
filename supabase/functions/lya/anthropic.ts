// Cliente da Anthropic e escolha de modelos da Lya.
//
// Três modelos, três papéis (mesma separação do Daniel):
//   LYA_MODEL          — o agente do chat (default Claude Opus 5)
//   LYA_TRAINER_MODEL  — classifica e enriquece memórias (default Opus 5)
//   LYA_VERIFIER_MODEL — passe anti-fakenews em TODA resposta (Haiku 4.5, barato)
// Trocar um não muda o comportamento dos outros. Os três leem ANTHROPIC_API_KEY
// dos secrets do projeto Supabase — a chave nunca chega ao browser.
import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";

export const CHAT_MODEL = Deno.env.get("LYA_MODEL") || "claude-opus-5";
export const TRAINER_MODEL = Deno.env.get("LYA_TRAINER_MODEL") || "claude-opus-5";
export const VERIFIER_MODEL = Deno.env.get("LYA_VERIFIER_MODEL") || "claude-haiku-4-5";

// Esforço do agente do chat. `medium` segura o custo de thinking por turno sem
// perder qualidade em perguntas de dados; suba para `high` se a Lya começar a
// pular etapas de coleta em relatórios longos.
export const CHAT_EFFORT = (Deno.env.get("LYA_EFFORT") || "medium") as "low" | "medium" | "high";

// Teto de saída por etapa. É um CAP, não um gasto.
export const MAX_TOKENS = 16000;

// Cache do cliente amarrado ao VALOR da chave: uma instância quente da função
// que viu a chave antiga (ou um placeholder) passa a usar a nova no instante
// em que o secret é regravado, sem esperar a instância reciclar.
let _client: Anthropic | null = null;
let _clientKey: string | null = null;

export function apiKeyConfigurada(): boolean {
  return Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
}

export function anthropic(): Anthropic {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY não configurada nos secrets do projeto Supabase — a Lya não consegue responder.",
    );
  }
  // Um secret colado com caractere fora do ASCII (aspas curvas, espaço
  // especial, quebra de linha) derruba o turno com um "Argument 2 is not a
  // valid ByteString" opaco na hora de montar o header x-api-key. Aqui a
  // falha vira uma mensagem que diz ONDE está o caractere, sem expor a chave.
  const invalidos: string[] = [];
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) invalidos.push(`posição ${i + 1} (código U+${c.toString(16).toUpperCase().padStart(4, "0")})`);
  }
  if (invalidos.length) {
    throw new Error(
      `O secret ANTHROPIC_API_KEY contém caractere inválido em ${invalidos.slice(0, 3).join(", ")} — ` +
        `regrave o secret com a chave limpa (sem aspas, espaços ou quebra de linha).`,
    );
  }
  if (!_client || _clientKey !== key) {
    _client = new Anthropic({ apiKey: key });
    _clientKey = key;
  }
  return _client;
}

export type { Anthropic };
