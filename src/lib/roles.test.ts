import { describe, expect, it } from "vitest";

import {
  areasForRole,
  canAccessArea,
  defaultAreaForRole,
  hasAreaChoice,
  homePathForRole,
} from "./roles";

describe("homePathForRole", () => {
  it("manda a gestora para a escolha de área (ela tem duas)", () => {
    expect(homePathForRole("manager")).toBe("/areas");
  });

  it("manda o time de copy para a escolha de área (também tem duas)", () => {
    expect(homePathForRole("copy_grup")).toBe("/areas");
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

  it("só quem tem duas áreas precisa escolher", () => {
    expect(hasAreaChoice("manager")).toBe(true);
    expect(hasAreaChoice("copy_grup")).toBe(true);
  });
});
