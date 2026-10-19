import { beforeEach, describe, expect, it, vi } from "vitest";

// A coluna pode não existir em prod quando o front sobe: qualquer erro da
// consulta tem que virar "sem acesso", nunca exceção (que derrubaria o layout).

const resposta: { data: unknown; error: unknown; lanca?: boolean } = { data: null, error: null };
const colunasPedidas: string[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: (cols: string) => {
      colunasPedidas.push(cols);
      return chain;
    },
    eq: () => chain,
    maybeSingle: () =>
      resposta.lanca ? Promise.reject(new Error("rede")) : Promise.resolve({ data: resposta.data, error: resposta.error }),
  });
  return { supabase: { from: () => chain } };
});

import { fetchGeovaniAnalysesGrant } from "./geovaniAnalysesGrant";

describe("fetchGeovaniAnalysesGrant", () => {
  beforeEach(() => {
    resposta.data = null;
    resposta.error = null;
    resposta.lanca = false;
    colunasPedidas.length = 0;
  });

  it("pede só a coluna da flag, numa consulta à parte", async () => {
    resposta.data = { can_view_geovani_analyses: true };
    expect(await fetchGeovaniAnalysesGrant("u1")).toBe(true);
    expect(colunasPedidas).toEqual(["can_view_geovani_analyses"]);
  });

  it("flag false ou nula nega", async () => {
    resposta.data = { can_view_geovani_analyses: false };
    expect(await fetchGeovaniAnalysesGrant("u1")).toBe(false);
    resposta.data = { can_view_geovani_analyses: null };
    expect(await fetchGeovaniAnalysesGrant("u1")).toBe(false);
  });

  it("coluna inexistente (erro do PostgREST) nega sem lançar", async () => {
    resposta.error = { code: "42703", message: "column profiles.can_view_geovani_analyses does not exist" };
    expect(await fetchGeovaniAnalysesGrant("u1")).toBe(false);
  });

  it("falha de rede nega sem lançar", async () => {
    resposta.lanca = true;
    expect(await fetchGeovaniAnalysesGrant("u1")).toBe(false);
  });

  it("sem usuário nem consulta", async () => {
    expect(await fetchGeovaniAnalysesGrant(null)).toBe(false);
    expect(colunasPedidas).toEqual([]);
  });
});
