import { describe, expect, it } from "vitest";

import { buildGraph, desde, slugify } from "./graph";
import type { LyaMemory } from "./types";

const mem = (name: string, extra: Partial<LyaMemory> = {}): LyaMemory => ({
  id: 1,
  name,
  description: name,
  type: "nota",
  tags: [],
  body: "",
  author_id: null,
  seed: false,
  origem: "treino",
  file_id: null,
  created_at: "2026-09-07T10:00:00Z",
  updated_at: "2026-09-07T10:00:00Z",
  ...extra,
});

describe("buildGraph", () => {
  it("liga por wikilink (resolvendo o slug) e por tags em cadeia", () => {
    const g = buildGraph([
      mem("meta-de-reembolso", { tags: ["reembolso"] }),
      mem("parciais", { body: "Ver [[Meta de Reembolso]].", tags: ["reembolso", "parcial"] }),
      mem("canal-sms", { tags: ["parcial"] }),
      mem("solta"),
    ]);
    expect(g.links).toEqual([
      { source: "parciais", target: "meta-de-reembolso", kind: "link" },
      { source: "meta-de-reembolso", target: "parciais", kind: "tag" },
      { source: "parciais", target: "canal-sms", kind: "tag" },
    ]);
    const val = Object.fromEntries(g.nodes.map((n) => [n.id, n.val]));
    expect(val).toEqual({ "meta-de-reembolso": 3, parciais: 4, "canal-sms": 2, solta: 1 });
  });

  it("não duplica aresta nem liga um nó a ele mesmo", () => {
    const g = buildGraph([mem("a", { body: "[[a]] [[b]] [[b]]", tags: ["x", "x"] }), mem("b", { tags: ["x"] })]);
    expect(g.links).toEqual([
      { source: "a", target: "b", kind: "link" },
      { source: "a", target: "b", kind: "tag" },
    ]);
  });

  it("ignora wikilink para memória que não existe", () => {
    const g = buildGraph([mem("a", { body: "[[nao-existe]]" })]);
    expect(g.links).toEqual([]);
  });
});

describe("slugify", () => {
  it("espelha o lya_slugify do banco", () => {
    expect(slugify("  Reembolsos Parciais são a prioridade! ")).toBe("reembolsos-parciais-sao-a-prioridade");
  });
});

describe("desde", () => {
  it("formata a idade de forma curta", () => {
    const agora = Date.parse("2026-09-07T12:00:00Z");
    expect(desde("2026-09-07T11:59:40Z", agora)).toBe("agora");
    expect(desde("2026-09-07T11:30:00Z", agora)).toBe("há 30 min");
    expect(desde("2026-09-07T09:00:00Z", agora)).toBe("há 3 h");
    expect(desde("2026-09-01T09:00:00Z", agora)).toBe("há 6 d");
  });
});
