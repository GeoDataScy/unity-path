import { describe, expect, it } from "vitest";

import {
  areasForRole,
  canAccessArea,
  areaCardsForRole,
  defaultAreaForRole,
  hasAreaChoice,
  homePathForRole,
  isKnownRole,
} from "./roles";

describe("homePathForRole", () => {
  it("gestora, copy e produtos passam pela tela dos três cards", () => {
    expect(homePathForRole("manager")).toBe("/areas");
    expect(homePathForRole("copy_grup")).toBe("/areas");
    expect(homePathForRole("produto")).toBe("/areas");
  });

  it("manda o agente direto para o workspace", () => {
    expect(homePathForRole("agent")).toBe("/workspace");
  });

  it("cai no workspace quando a role é desconhecida ou ausente", () => {
    expect(homePathForRole(null)).toBe("/workspace");
    expect(homePathForRole(undefined)).toBe("/workspace");
    expect(homePathForRole("role_que_nao_existe")).toBe("/workspace");
  });
});

// Regra do dono (02/10/2026): os três cards aparecem para todo perfil de gestão;
// produtos só entra em Produtos, copy só em Copy, a gestora em tudo.
describe("cards da tela /areas", () => {
  it("gestora, copy e produtos veem os mesmos três cards, na mesma ordem", () => {
    for (const role of ["manager", "copy_grup", "produto"]) {
      expect(areaCardsForRole(role)).toEqual(["analytics", "copy", "produtos"]);
    }
  });

  it("o agente não vê cards: só tem o workspace", () => {
    expect(areaCardsForRole("agent")).toEqual(["workspace"]);
    expect(hasAreaChoice("agent")).toBe(false);
  });
});

describe("acesso por área", () => {
  it("a gestora entra em todas as áreas de gestão, e o analytics é a casa dela", () => {
    expect(areasForRole("manager")).toEqual(["analytics", "copy", "produtos"]);
    expect(defaultAreaForRole("manager")).toBe("analytics");
  });

  it("copy entra só em Copy", () => {
    expect(areasForRole("copy_grup")).toEqual(["copy"]);
    expect(canAccessArea("copy_grup", "analytics")).toBe(false);
    expect(canAccessArea("copy_grup", "produtos")).toBe(false);
  });

  it("produtos entra só em Produtos", () => {
    expect(areasForRole("produto")).toEqual(["produtos"]);
    expect(canAccessArea("produto", "analytics")).toBe(false);
    expect(canAccessArea("produto", "copy")).toBe(false);
  });

  it("ninguém de gestão entra no workspace do agente", () => {
    for (const role of ["manager", "copy_grup", "produto"]) {
      expect(canAccessArea(role, "workspace")).toBe(false);
    }
  });

  it("agente só entra no próprio workspace", () => {
    expect(areasForRole("agent")).toEqual(["workspace"]);
    expect(canAccessArea("agent", "analytics")).toBe(false);
    expect(canAccessArea("agent", "copy")).toBe(false);
    expect(canAccessArea("agent", "produtos")).toBe(false);
  });

  it("role desconhecida é tratada como agente", () => {
    expect(canAccessArea(null, "analytics")).toBe(false);
    expect(canAccessArea("role_que_nao_existe", "copy")).toBe(false);
    expect(areasForRole(undefined)).toEqual(["workspace"]);
  });
});

describe("isKnownRole", () => {
  it("reconhece as quatro roles do app", () => {
    expect(isKnownRole("agent")).toBe(true);
    expect(isKnownRole("manager")).toBe(true);
    expect(isKnownRole("copy_grup")).toBe(true);
    expect(isKnownRole("produto")).toBe(true);
  });

  // O banco pode ganhar uma role antes do deploy do front. Sem isso, o guard do
  // AgentLayout mandaria a conta para /workspace em loop (tela "Carregando...").
  it("não reconhece role que este bundle ainda não tem", () => {
    expect(isKnownRole("area_que_ainda_nao_subiu")).toBe(false);
    expect(isKnownRole(null)).toBe(false);
    expect(isKnownRole(undefined)).toBe(false);
  });
});
