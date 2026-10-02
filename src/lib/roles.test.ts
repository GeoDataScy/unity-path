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
  it("manda a gestora para a escolha de área (ela tem duas)", () => {
    expect(homePathForRole("manager")).toBe("/areas");
  });

  it("manda o time de copy para a escolha de área (também tem duas)", () => {
    expect(homePathForRole("copy_grup")).toBe("/areas");
  });

  it("manda o time de produtos para a tela de cards, como todo mundo", () => {
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

describe("acesso por área", () => {
  it("gestora entra nas duas áreas, e o analytics é a casa dela", () => {
    expect(canAccessArea("manager", "analytics")).toBe(true);
    expect(canAccessArea("manager", "copy")).toBe(true);
    expect(defaultAreaForRole("manager")).toBe("analytics");
  });

  it("a área de produtos é só da role produto — nem a gestora entra", () => {
    expect(areasForRole("produto")).toEqual(["produtos"]);
    expect(canAccessArea("produto", "produtos")).toBe(true);
    expect(canAccessArea("manager", "produtos")).toBe(false);
    expect(canAccessArea("copy_grup", "produtos")).toBe(false);
    expect(canAccessArea("agent", "produtos")).toBe(false);
  });

  it("o time de produtos não entra em nenhuma outra área", () => {
    expect(canAccessArea("produto", "analytics")).toBe(false);
    expect(canAccessArea("produto", "copy")).toBe(false);
    expect(canAccessArea("produto", "workspace")).toBe(false);
  });

  it("o time de produtos vê os três cards, mas o acesso continua só em produtos", () => {
    expect(areaCardsForRole("produto")).toEqual(["analytics", "copy", "produtos"]);
    expect(areasForRole("produto")).toEqual(["produtos"]);
  });

  it("os outros perfis veem exatamente as áreas que podem acessar", () => {
    expect(areaCardsForRole("manager")).toEqual(areasForRole("manager"));
    expect(areaCardsForRole("copy_grup")).toEqual(areasForRole("copy_grup"));
    expect(areaCardsForRole("agent")).toEqual(["workspace"]);
  });

  it("copy entra nas duas áreas, e a casa dele é a área de copy", () => {
    expect(canAccessArea("copy_grup", "copy")).toBe(true);
    expect(canAccessArea("copy_grup", "analytics")).toBe(true);
    expect(defaultAreaForRole("copy_grup")).toBe("copy");
  });

  it("gestora e copy não entram no workspace do agente", () => {
    expect(canAccessArea("manager", "workspace")).toBe(false);
    expect(canAccessArea("copy_grup", "workspace")).toBe(false);
  });

  it("agente só entra no próprio workspace", () => {
    expect(areasForRole("agent")).toEqual(["workspace"]);
    expect(canAccessArea("agent", "analytics")).toBe(false);
    expect(canAccessArea("agent", "copy")).toBe(false);
    expect(hasAreaChoice("agent")).toBe(false);
  });

  it("role desconhecida é tratada como agente", () => {
    expect(canAccessArea(null, "analytics")).toBe(false);
    expect(canAccessArea("role_que_nao_existe", "copy")).toBe(false);
    expect(areasForRole(undefined)).toEqual(["workspace"]);
  });

  it("só quem tem mais de uma área precisa escolher", () => {
    expect(hasAreaChoice("manager")).toBe(true);
    expect(hasAreaChoice("copy_grup")).toBe(true);
    expect(hasAreaChoice("produto")).toBe(true);
    expect(hasAreaChoice("agent")).toBe(false);
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
