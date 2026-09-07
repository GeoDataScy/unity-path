// Agente treinador do cérebro da Lya.
//
// Fica atrás da tela "Cérebro da Lya" e do modo treino do chat: recebe o que a
// gestora escreveu (muitas vezes uma frase solta, sem tipo), classifica no tipo
// certo e enriquece o texto para que o recall (lya_recall_memories) realmente
// encontre e aplique a memória depois.
//
// Regras de recall que este agente precisa respeitar ao escrever:
//   - `feedback` e `user` entram SEMPRE no prompt → regras de comportamento
//     (saudação, tom, formato, o que evitar) DEVEM ser um desses.
//   - `nota`/`project`/`reference` só entram se palavras da pergunta baterem na
//     description/tags/body (FTS português) → precisam de tags e body ricos em
//     palavras-chave prováveis.
import { anthropic, TRAINER_MODEL } from "./anthropic.ts";

export const TIPOS_VALIDOS = ["user", "feedback", "project", "reference", "nota"] as const;
export type TipoMemoria = (typeof TIPOS_VALIDOS)[number];

export interface MemoriaRefinada {
  type: TipoMemoria;
  description: string;
  body: string;
  tags: string[];
}

const TOOL = {
  name: "salvar_memoria",
  description: "Salva a memória classificada e enriquecida no cérebro da Lya.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: { type: "string", enum: [...TIPOS_VALIDOS], description: "Tipo da memória segundo a taxonomia do cérebro." },
      description: { type: "string", description: "Título curto e claro, em PT-BR." },
      body: { type: "string", description: "Corpo enriquecido da memória. Preserva [[wikilinks]] do original." },
      tags: { type: "array", items: { type: "string" }, description: "3 a 6 tags minúsculas, sem acento, estilo slug." },
    },
    required: ["type", "description", "body", "tags"],
  },
};

const SYSTEM = `Você é o agente treinador do cérebro da Lya, a assistente do Painel da Gestora do suporte da XMX.
A gestora cadastra memórias numa tela de treino, muitas vezes escrevendo pouco e sem escolher o tipo. Seu
trabalho: classificar a memória no tipo certo e melhorar o texto para que ela funcione de verdade quando a Lya
for responder.

TAXONOMIA (campo type):
- feedback → COMO a Lya deve agir: saudações, tom, estilo, formato de resposta, o que evitar, correções de
  comportamento. Inclui TAMBÉM o formato/estrutura de um ENTREGÁVEL recorrente — resumo diário, relatório
  semanal, ranking: quais blocos tem, em que ordem, quais gráficos gerar, o que nunca incluir. Regra de COMO
  montar algo é feedback, mesmo quando fala de um assunto específico.
- user → QUEM é a Lya / para quem ela responde: papel, perfil, preferências estáveis da gestora.
- project → trabalho em andamento, metas do time, contexto de um projeto (ex.: "campanha do produto X em
  setembro", "meta de reduzir reembolso integral").
- reference → link, planilha, painel externo, onde encontrar algo.
- nota → fato ou anotação solta de conhecimento do suporte (um produto, um processo, uma exceção de regra,
  um acontecimento). Só o CONTEÚDO em si — nunca a regra de como apresentá-lo.

COMO O RECALL FUNCIONA (isso muda como você escreve):
- Memórias feedback e user entram em TODAS as respostas. Toda regra de comportamento precisa ser um desses
  dois tipos, senão nunca é aplicada.
- Memórias nota/project/reference só são recuperadas se palavras da pergunta do usuário aparecerem na
  description, nas tags ou no body (busca textual em português). Então escreva description/body/tags com as
  palavras que a gestora provavelmente usaria ao perguntar (inclua sinônimos e variações: "reembolso",
  "estorno", "devolução"; "ticket", "atendimento"; nome do agente com e sem sobrenome).
- Na dúvida entre feedback e nota para uma REGRA, escolha feedback.

COMO ENRIQUECER:
- Reescreva a description como uma frase curta e inequívoca.
- No body, torne a instrução acionável: para feedback/user, deixe explícito quando e como aplicar (ex.: "Em
  TODA resposta com ranking de agentes, mostrar também a meta diária de cada um"). Para conhecimento, complete
  o contexto com o porquê quando estiver implícito.
- NÃO invente fatos, números ou nomes que não estejam no texto original. Enriquecer é explicitar a intenção,
  não criar conteúdo novo.
- Preserve intactos os [[wikilinks]] presentes no original.
- Gere 3 a 6 tags minúsculas, sem acento, estilo slug (ex.: reembolso, ranking-agentes, formato).
- Escreva em PT-BR.

Se a gestora já escolheu um tipo, respeite-o (apenas enriqueça o texto) — a menos que seja claramente um erro
que impediria a memória de funcionar (ex.: regra de comportamento salva como nota); nesse caso corrija o tipo.`;

export async function refinarMemoria(
  description: string,
  body = "",
  tags: string[] = [],
  typeHint?: string | null,
  signal?: AbortSignal,
): Promise<MemoriaRefinada | null> {
  const entrada = {
    description,
    body: body || "",
    tags: tags || [],
    tipo_escolhido_pela_gestora: typeHint || "(nenhum — classifique você)",
  };
  try {
    const resp = await anthropic().messages.create(
      {
        model: TRAINER_MODEL,
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "salvar_memoria" },
        messages: [
          {
            role: "user",
            content: "Memória cadastrada na tela Cérebro da Lya:\n" + JSON.stringify(entrada, null, 2),
          },
        ],
      },
      { signal },
    );
    const bloco = resp.content.find((b) => b.type === "tool_use");
    if (!bloco || bloco.type !== "tool_use") return null;
    const saida = bloco.input as Record<string, unknown>;
    const type = String(saida.type ?? "");
    const desc = String(saida.description ?? "").trim();
    if (!(TIPOS_VALIDOS as readonly string[]).includes(type) || !desc) return null;
    return {
      type: type as TipoMemoria,
      description: desc,
      body: String(saida.body ?? "").trim(),
      tags: (Array.isArray(saida.tags) ? saida.tags : []).map((t) => String(t).trim()).filter(Boolean),
    };
  } catch {
    return null; // quem chama salva o original
  }
}
