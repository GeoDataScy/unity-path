import { describe, expect, it } from "vitest";

import {
  CONTACT_REASONS,
  CONTACT_REASON_NOTE_MAX_LENGTH,
  formatContactReason,
  getContactReasonNoteCopy,
  normalizeContactReasonNote,
  requiresContactReasonNote,
} from "@/features/services/contact-reasons";

describe("requiresContactReasonNote", () => {
  it("exige nota nos motivos 'outro' e 'reclamacao_vsl'", () => {
    expect(requiresContactReasonNote("outro")).toBe(true);
    expect(requiresContactReasonNote("reclamacao_vsl")).toBe(true);
    expect(requiresContactReasonNote("duvida_de_uso")).toBe(false);
    expect(requiresContactReasonNote(null)).toBe(false);
  });
});

describe("getContactReasonNoteCopy", () => {
  it("dá textos próprios a cada motivo que pede descrição", () => {
    const outro = getContactReasonNoteCopy("outro");
    const vsl = getContactReasonNoteCopy("reclamacao_vsl");
    expect(outro?.label).toBe("Descreva o motivo");
    expect(vsl?.label).toBe("Descreva a reclamação");
    expect(vsl?.placeholder).not.toBe(outro?.placeholder);
  });

  it("não devolve nada nos motivos sem descrição", () => {
    expect(getContactReasonNoteCopy("reembolso")).toBeNull();
    expect(getContactReasonNoteCopy(null)).toBeNull();
  });
});

describe("normalizeContactReasonNote", () => {
  it("descarta a nota quando o motivo não é 'outro'", () => {
    expect(normalizeContactReasonNote("reembolso", "texto qualquer")).toBeNull();
  });

  it("apara espaços e devolve null quando só sobra vazio", () => {
    expect(normalizeContactReasonNote("outro", "  cápsula x gummy  ")).toBe("cápsula x gummy");
    expect(normalizeContactReasonNote("reclamacao_vsl", "  prometia 7 dias  ")).toBe("prometia 7 dias");
    expect(normalizeContactReasonNote("outro", "   ")).toBeNull();
    expect(normalizeContactReasonNote("outro", undefined)).toBeNull();
  });

  it("corta no limite aceito pelo CHECK do banco", () => {
    const long = "a".repeat(CONTACT_REASON_NOTE_MAX_LENGTH + 50);
    expect(normalizeContactReasonNote("outro", long)).toHaveLength(CONTACT_REASON_NOTE_MAX_LENGTH);
  });
});

describe("formatContactReason", () => {
  it("mostra o rótulo do catálogo nos motivos fixos", () => {
    expect(formatContactReason("duvida_de_uso")).toBe("Dúvida de uso");
    expect(formatContactReason("duvida_de_uso", "ignorada")).toBe("Dúvida de uso");
  });

  it("anexa a descrição no motivo 'outro'", () => {
    expect(formatContactReason("outro", "cliente confundiu cápsula com gummy")).toBe(
      "Outro — cliente confundiu cápsula com gummy",
    );
    expect(formatContactReason("outro", null)).toBe("Outro");
  });

  it("anexa a descrição no motivo 'reclamacao_vsl'", () => {
    expect(formatContactReason("reclamacao_vsl", "anúncio prometia 7 dias")).toBe(
      "Reclamação VSL — anúncio prometia 7 dias",
    );
    expect(formatContactReason("reclamacao_vsl", null)).toBe("Reclamação VSL");
  });

  it("trata código ausente e desconhecido", () => {
    expect(formatContactReason(null)).toBe("Não informado");
    expect(formatContactReason("nao_informado")).toBe("Não informado");
    expect(formatContactReason("codigo_legado")).toBe("codigo_legado");
  });
});

describe("catálogo", () => {
  it("mantém 'outro' como último item do dropdown", () => {
    expect(CONTACT_REASONS[CONTACT_REASONS.length - 1].code).toBe("outro");
  });
});
