import { describe, expect, it } from "vitest";

import { buildGraph, desde, idArquivo, idSistema, slugify, termosDoSistema, type LyaSistemaNo } from "./graph";
import type { LyaArquivo, LyaMemory } from "./types";

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

const arq = (id: string, extra: Partial<LyaArquivo> = {}): LyaArquivo => ({
  id,
  nome: id,
  arquivo: `${id}.csv`,
  tipo: "csv",
  status: "pronto",
  colunas: [],
  total_linhas: 0,
  resumo: "",
  tags: [],
  erro: null,
  bytes: 0,
  uploaded_by: null,
  uploaded_by_nome: null,
  created_at: "2026-09-21T10:00:00Z",
  updated_at: "2026-09-21T10:00:00Z",
  ...extra,
});

const sis = (id: string, extra: Partial<LyaSistemaNo> = {}): LyaSistemaNo => ({
  id,
  label: id,
  camada: "tabela",
  detalhe: "",
  total: null,
  liga: [],
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

  it("liga a memória que a Lya escreveu ao arquivo que a gerou", () => {
    const g = buildGraph(
      [mem("arquivo-planilha", { origem: "arquivo", file_id: "f1" }), mem("treinada")],
      [arq("f1")],
    );
    expect(g.links).toEqual([{ source: "arquivo-planilha", target: idArquivo("f1"), kind: "arquivo" }]);
    expect(g.nodes.find((n) => n.id === idArquivo("f1"))?.camada).toBe("arquivo");
  });

  it("não inventa a aresta quando o arquivo da memória não está na lista", () => {
    const g = buildGraph([mem("arquivo-sumido", { origem: "arquivo", file_id: "f9" })], []);
    expect(g.links).toEqual([]);
  });

  it("liga arquivo a sistema só pelo identificador de banco, não pela prosa", () => {
    const sistema = [
      sis("tabela:services", { detalhe: "services — um ticket por linha" }),
      sis("tela:atendimentos", { camada: "tela", detalhe: "dashboard_metrics" }),
      sis("tabela:refunds", { detalhe: "refunds — um reembolso por linha" }),
    ];
    const arquivos = [
      // cita `services` no resumo e `dashboard_metrics` numa tag
      arq("f1", { resumo: "Cruza com services pelo e-mail.", tags: ["dashboard_metrics"] }),
      // fala de "ticket" e "linha": prosa do detalhe, que NÃO pode ligar
      arq("f2", { resumo: "Uma linha por ticket do mês." }),
    ];
    const g = buildGraph([], arquivos, sistema);
    const citacoes = g.links.filter((l) => l.kind === "cita");
    expect(citacoes).toEqual([
      { source: idArquivo("f1"), target: idSistema("tabela:services"), kind: "cita" },
      { source: idArquivo("f1"), target: idSistema("tela:atendimentos"), kind: "cita" },
    ]);
  });

  it("liga os nós de sistema entre si pelo campo liga, ignorando alvo inexistente", () => {
    const g = buildGraph([], [], [
      sis("tabela:services", { liga: ["tabela:service_follow_ups", "tabela:fantasma"] }),
      sis("tabela:service_follow_ups"),
    ]);
    expect(g.links).toEqual([
      { source: idSistema("tabela:services"), target: idSistema("tabela:service_follow_ups"), kind: "liga" },
    ]);
  });

  it("não deixa memória colidir com nó de arquivo ou de sistema", () => {
    // "arquivo" é um id real do catálogo e poderia ser o slug de uma memória
    const g = buildGraph([mem("arquivo")], [arq("arquivo")], [sis("arquivo")]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["arquivo", "arquivo:arquivo", "sistema:arquivo"]);
  });
});

describe("termosDoSistema", () => {
  it("pega identificador de banco e o sufixo do id, e descarta a prosa", () => {
    expect(termosDoSistema(sis("tabela:services", { detalhe: "services — um ticket aberto por um agente" })))
      .toEqual(["services"]);
    expect(termosDoSistema(sis("tela:atendimentos", { camada: "tela", detalhe: "dashboard_metrics, por dia e por agente" })))
      .toEqual(["dashboard_metrics"]);
  });

  it("descarta termo curto demais para ser identificador", () => {
    expect(termosDoSistema(sis("tabela:rma", { detalhe: "rma — devolucoes" }))).toEqual([]);
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
