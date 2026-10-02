// Regras puras da porta do Late Hunter (sem Deno), para poderem ser testadas
// fora do runtime da Edge Function. Ver index.ts.

// ~500 itens ≈ 400 KB no lote real; 1.000 itens com folga cabem em 2 MB.
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_ITENS = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Ambiente = "producao" | "homologacao";

/** Comparação em tempo constante — não vaza, pelo tempo, quantos caracteres bateram. */
export function iguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function ambienteDoToken(
  authorization: string | null,
  tokens: { producao: string; homologacao: string },
): Ambiente | null {
  const match = (authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  const { producao, homologacao } = tokens;
  // Token vazio nos secrets nunca autentica ninguém.
  if (producao.length >= 32 && iguais(token, producao)) return "producao";
  if (homologacao.length >= 32 && iguais(token, homologacao)) return "homologacao";
  return null;
}

function dataValida(v: unknown): boolean {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function inteiroPositivo(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 1;
}

/** Valida o envelope. Itens são validados um a um no SQL (viram `rejeitados`). */
export function validarEnvelope(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "corpo deve ser um objeto JSON";
  const b = body as Record<string, unknown>;
  if (typeof b.fonte !== "string" || b.fonte.trim() === "") return "fonte obrigatoria";
  if (!dataValida(b.referencia)) return "referencia deve ser uma data AAAA-MM-DD";
  if (typeof b.geradoEm !== "string" || Number.isNaN(Date.parse(b.geradoEm))) return "geradoEm deve ser ISO 8601";
  if (typeof b.completo !== "boolean") return "completo deve ser boolean";
  if (!Array.isArray(b.itens)) return "itens deve ser um array";
  if (b.itens.length > MAX_ITENS) return `itens acima de ${MAX_ITENS}: envie em paginas`;
  const temPagina = b.pagina !== undefined || b.totalPaginas !== undefined;
  if (temPagina) {
    if (!inteiroPositivo(b.pagina) || !inteiroPositivo(b.totalPaginas)) return "pagina e totalPaginas devem ser inteiros >= 1";
    if ((b.pagina as number) > (b.totalPaginas as number)) return "pagina maior que totalPaginas";
  }
  return null;
}

