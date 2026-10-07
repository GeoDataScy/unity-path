import { describe, expect, it } from "vitest";

import { ENCAMINHADO_PELA_GESTAO, encaminhadoPor } from "./encaminhadoPor";

describe("encaminhadoPor", () => {
  it("gestora vira a área de suporte, sem nome de pessoa", () => {
    expect(encaminhadoPor({ assigned_by_manager_id: "gestora-1", other_agent_name: "Jessica Machado" })).toBe(
      ENCAMINHADO_PELA_GESTAO,
    );
    expect(ENCAMINHADO_PELA_GESTAO).toBe("Imperium (área de suporte)");
  });

  it("outro prestador aparece pelo nome", () => {
    expect(encaminhadoPor({ assigned_by_manager_id: null, other_agent_name: "Giovanna Godoy" })).toBe("Giovanna Godoy");
  });

  it("sem nome nem gestora mostra traço", () => {
    expect(encaminhadoPor({ assigned_by_manager_id: null, other_agent_name: null })).toBe("—");
  });
});
