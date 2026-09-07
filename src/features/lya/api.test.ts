import { describe, expect, it } from "vitest";

import { parseSseBuffer } from "./api";

describe("parseSseBuffer", () => {
  it("devolve os eventos completos e guarda o resto do chunk", () => {
    const buffer =
      'data: {"type":"tool","name":"painel_atendimentos"}\n\n' +
      'data: {"type":"token","text":"Olá"}\n\n' +
      'data: {"type":"tok';
    const { events, rest } = parseSseBuffer(buffer);
    expect(events).toEqual([
      { type: "tool", name: "painel_atendimentos" },
      { type: "token", text: "Olá" },
    ]);
    expect(rest).toBe('data: {"type":"tok');
  });

  it("ignora linhas que não são data: e JSON quebrado", () => {
    const { events, rest } = parseSseBuffer(': comentario\n\ndata: {nao-e-json}\n\ndata: {"type":"done"}\n\n');
    expect(events).toEqual([{ type: "done" }]);
    expect(rest).toBe("");
  });

  it("junta o resto com o chunk seguinte sem perder o evento", () => {
    const primeiro = parseSseBuffer('data: {"type":"token","te');
    expect(primeiro.events).toEqual([]);
    const segundo = parseSseBuffer(primeiro.rest + 'xt":"fim"}\n\n');
    expect(segundo.events).toEqual([{ type: "token", text: "fim" }]);
  });
});
