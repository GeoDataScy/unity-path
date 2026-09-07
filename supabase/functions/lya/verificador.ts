// Verificador anti-fakenews da Lya (passe de revisão pós-geração).
//
// Roda DEPOIS do turno: confere o rascunho afirmação por afirmação contra as
// evidências que as tools coletaram (painel, banco, Base de Suporte) e contra
// as regras do sistema. Como o texto já foi streamado, o veredito não reescreve
// a resposta: vira um bloco "Revisão automática" ao final + evento `revisao`.
//
// FAIL-OPEN por princípio: o verificador é camada de qualidade, nunca ponto de
// falha — qualquer erro devolve o rascunho intacto com uma ressalva "baixa".
import { anthropic, VERIFIER_MODEL } from "./anthropic.ts";

export interface Evidencia {
  origem: "painel" | "banco" | "base" | "regras";
  titulo: string;
  conteudo: string;
}

export interface Revisao {
  aprovado: boolean;
  ressalvas: { afirmacao: string; motivo: string; gravidade: "alta" | "media" | "baixa" }[];
  divergencias: string[];
}

const MAX_CHARS_EVIDENCIA = 2500;

const TOOL = {
  name: "emitir_revisao",
  description:
    "Emite o veredito da revisão anti-fakenews: se o rascunho está sustentado, as ressalvas e as divergências entre fontes.",
  input_schema: {
    type: "object" as const,
    properties: {
      aprovado: {
        type: "boolean",
        description: "true se o rascunho está sustentado pelas evidências; false se depende centralmente de afirmações sem base.",
      },
      ressalvas: {
        type: "array",
        description: "Afirmações problemáticas encontradas no rascunho.",
        items: {
          type: "object",
          properties: {
            afirmacao: { type: "string", description: "A afirmação do rascunho em questão (curta)." },
            motivo: { type: "string", description: "Por que é problemática." },
            gravidade: {
              type: "string",
              enum: ["alta", "media", "baixa"],
              description: "alta = factual sem nenhuma base; media = base parcial/dúvida; baixa = detalhe menor (ex.: falta de data).",
            },
          },
          required: ["afirmacao", "motivo", "gravidade"],
        },
      },
      divergencias: {
        type: "array",
        items: { type: "string" },
        description: "Conflitos entre fontes (uma string por conflito). Vazio se não houver.",
      },
    },
    required: ["aprovado", "ressalvas", "divergencias"],
  },
};

const SYSTEM = `Você é o revisor anti-fakenews da Lya, a assistente do Painel da Gestora do suporte da XMX. Você
recebe a pergunta do usuário, o RASCUNHO de resposta da Lya e as EVIDÊNCIAS coletadas pelas ferramentas
durante a geração (painel = RPCs das telas, banco = SQL, base = Base de Suporte, regras = regras fixas do
sistema). Verifique o rascunho afirmação por afirmação e emita a revisão pela ferramenta emitir_revisao.

REGRAS DE VERIFICAÇÃO:
1. Toda afirmação factual (números, percentuais, datas, nomes de agentes, produtos, clientes, status) precisa
   estar sustentada por alguma evidência OU ser uma regra do sistema listada nas evidências de origem "regras".
2. Hierarquia de confiança: painel (é o número da tela) > banco (SQL) > regras > base de suporte. Use-a para
   pesar evidências que apontem em direções diferentes.
3. Conflito entre fontes: reporte em divergencias, identificando cada fonte. Nunca escolha uma em silêncio.
4. Afirmação de AUSÊNCIA ("não há X", "nenhum agente fez Y") só é sustentada se alguma evidência consultou a
   fonte que teria X e voltou vazia. Ausência de evidência NÃO é evidência de ausência — registre ressalva "alta".
5. Dados de operação devem estar datados/recortados no texto (período, agente). Se o rascunho traz um número
   sem período e a evidência permite datá-lo, registre ressalva "baixa".
6. Aritmética derivada no texto (percentual, média, diferença) que NÃO apareça pronta em nenhuma evidência é
   ressalva "media" — a regra da Lya é calcular no SQL/painel, não na resposta.
7. Na dúvida (evidência parcial, ambígua, indireta), registre ressalva "media".
8. Se NÃO houver evidência de dados e o rascunho tiver números ou fatos, seja conservador: ressalvas "alta"
   para as afirmações factuais não notórias. Nunca invente evidência nem valide sem base.
9. Respostas puramente conversacionais (saudação, explicação de uma regra do sistema, "não encontrei isso nos
   dados disponíveis") são aprovadas sem ressalvas.
10. aprovado = true quando o rascunho está sustentado (ressalvas baixas/médias não o reprovam); false quando
    depende de forma central de afirmações sem base.

Responda SEMPRE chamando emitir_revisao. Textos em PT-BR, curtos.`;

function truncar(texto: string): string {
  const t = texto || "";
  return t.length <= MAX_CHARS_EVIDENCIA ? t : t.slice(0, MAX_CHARS_EVIDENCIA) + "\n[... evidência truncada pelo verificador ...]";
}

function formatarEvidencias(evidencias: Evidencia[]): string {
  if (!evidencias.length) return "(nenhuma evidência foi coletada pelas ferramentas)";
  return evidencias
    .map((ev, i) => `[evidência ${i + 1} | origem: ${ev.origem}] ${ev.titulo}\n${truncar(ev.conteudo)}`)
    .join("\n\n");
}

function failOpen(motivo: string): Revisao {
  return {
    aprovado: true,
    ressalvas: [{ afirmacao: "(verificador indisponível)", motivo, gravidade: "baixa" }],
    divergencias: [],
  };
}

const GRAVIDADES = new Set(["alta", "media", "baixa"]);

function sanear(saida: Record<string, unknown>): Revisao {
  const ressalvas: Revisao["ressalvas"] = [];
  for (const r of (saida.ressalvas as unknown[]) || []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const gravidade = GRAVIDADES.has(String(o.gravidade)) ? (String(o.gravidade) as Revisao["ressalvas"][number]["gravidade"]) : "media";
    ressalvas.push({
      afirmacao: String(o.afirmacao ?? "").trim(),
      motivo: String(o.motivo ?? "").trim(),
      gravidade,
    });
  }
  const divergencias = ((saida.divergencias as unknown[]) || []).map((d) => String(d).trim()).filter(Boolean);
  return { aprovado: saida.aprovado !== false, ressalvas, divergencias };
}

export async function revisar(
  pergunta: string,
  rascunho: string,
  evidencias: Evidencia[],
  signal?: AbortSignal,
): Promise<Revisao> {
  try {
    const entrada =
      `PERGUNTA DO USUÁRIO:\n${pergunta}\n\n` +
      `RASCUNHO DA LYA (a revisar):\n${rascunho}\n\n` +
      `EVIDÊNCIAS COLETADAS PELAS FERRAMENTAS:\n${formatarEvidencias(evidencias)}`;

    const resp = await anthropic().messages.create(
      {
        model: VERIFIER_MODEL,
        max_tokens: 4096,
        // Haiku 4.5 ainda aceita temperature; duas revisões do mesmo rascunho
        // devem dar o mesmo veredito. NÃO portar para Opus/Fable (retorna 400).
        temperature: 0,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "emitir_revisao" },
        messages: [{ role: "user", content: entrada }],
      },
      { signal },
    );
    const bloco = resp.content.find((b) => b.type === "tool_use");
    if (!bloco || bloco.type !== "tool_use") return failOpen("O verificador não devolveu um veredito.");
    return sanear(bloco.input as Record<string, unknown>);
  } catch (err) {
    const nome = err instanceof Error ? err.name : "erro";
    return failOpen(`Falha ao executar o verificador (${nome}); a resposta foi entregue sem revisão anti-fakenews.`);
  }
}
