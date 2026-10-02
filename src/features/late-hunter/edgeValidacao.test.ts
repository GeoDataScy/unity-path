import { describe, expect, it } from "vitest";

// Regras puras da porta (Edge Function late-hunter-sync). Ficam num módulo sem
// Deno justamente para serem testadas aqui.
import { ambienteDoToken, iguais, validarEnvelope } from "../../../supabase/functions/late-hunter-sync/validacao";

const PROD = "p".repeat(40);
const HOMOLOG = "h".repeat(40);
const tokens = { producao: PROD, homologacao: HOMOLOG };

const lote = (extra: Record<string, unknown> = {}) => ({
  fonte: "walle",
  referencia: "2026-09-16",
  geradoEm: "2026-09-17T02:00:00Z",
  completo: true,
  itens: [],
  ...extra,
});

describe("ambienteDoToken", () => {
  it("o token decide o ambiente", () => {
    expect(ambienteDoToken(`Bearer ${PROD}`, tokens)).toBe("producao");
    expect(ambienteDoToken(`Bearer ${HOMOLOG}`, tokens)).toBe("homologacao");
  });

  it("recusa token errado, ausente ou sem Bearer", () => {
    expect(ambienteDoToken(`Bearer ${"x".repeat(40)}`, tokens)).toBeNull();
    expect(ambienteDoToken(null, tokens)).toBeNull();
    expect(ambienteDoToken(PROD, tokens)).toBeNull();
  });

  it("secret vazio ou curto nunca autentica ninguém", () => {
    expect(ambienteDoToken("Bearer ", { producao: "", homologacao: "" })).toBeNull();
    expect(ambienteDoToken("Bearer abc", { producao: "abc", homologacao: "" })).toBeNull();
  });
});

describe("iguais", () => {
  it("compara strings sem curto-circuito", () => {
    expect(iguais("abc", "abc")).toBe(true);
    expect(iguais("abc", "abd")).toBe(false);
    expect(iguais("abc", "abcd")).toBe(false);
  });
});

describe("validarEnvelope", () => {
  it("aceita o envelope da especificação, inclusive itens vazio", () => {
    expect(validarEnvelope(lote())).toBeNull();
    expect(validarEnvelope(lote({ pagina: 1, totalPaginas: 4 }))).toBeNull();
  });

  it("recusa o que a especificação manda devolver como 400", () => {
    expect(validarEnvelope([])).toMatch(/objeto/);
    expect(validarEnvelope(lote({ referencia: "2026-02-30" }))).toMatch(/referencia/);
    expect(validarEnvelope(lote({ referencia: "16/09/2026" }))).toMatch(/referencia/);
    expect(validarEnvelope(lote({ geradoEm: "ontem" }))).toMatch(/geradoEm/);
    expect(validarEnvelope(lote({ completo: "true" }))).toMatch(/completo/);
    expect(validarEnvelope(lote({ itens: {} }))).toMatch(/itens/);
    expect(validarEnvelope(lote({ fonte: "" }))).toMatch(/fonte/);
  });

  it("acima de 1.000 itens pede paginação", () => {
    expect(validarEnvelope(lote({ itens: Array.from({ length: 1001 }, () => ({})) }))).toMatch(/paginas/);
  });

  it("paginação precisa ser coerente", () => {
    expect(validarEnvelope(lote({ pagina: 5, totalPaginas: 4 }))).toMatch(/pagina/);
    expect(validarEnvelope(lote({ pagina: 0, totalPaginas: 1 }))).toMatch(/pagina/);
    expect(validarEnvelope(lote({ pagina: 1 }))).toMatch(/pagina/);
  });
});
