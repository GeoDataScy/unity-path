import { describe, expect, it } from "vitest";

import { homePathForRole } from "./roles";

describe("homePathForRole", () => {
  it("manda a gestora para o dashboard", () => {
    expect(homePathForRole("manager")).toBe("/dashboard");
  });

  it("manda o time de copy para /copy", () => {
    expect(homePathForRole("copy_grup")).toBe("/copy");
  });

  it("manda o agente para o workspace", () => {
    expect(homePathForRole("agent")).toBe("/workspace");
  });

  it("cai no workspace quando a role é desconhecida ou ausente", () => {
    expect(homePathForRole(null)).toBe("/workspace");
    expect(homePathForRole(undefined)).toBe("/workspace");
    expect(homePathForRole("role_que_nao_existe")).toBe("/workspace");
  });
});
