import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReasonEvidenceModal } from "@/features/copy/components/ReasonEvidenceModal";
import type { CopyReasonEvidence } from "@/features/copy/types";

const evidencia: CopyReasonEvidence = {
  category: "Insatisfação com o produto",
  total: 822,
  com_texto: 822,
  texto_livre: 0,
  textos: [],
  termos: [],
  por_produto: [
    // Steelpower tem mais casos, mas o motivo pesa menos dentro dele do que
    // dentro do NerveEase — é justamente o que o percentual precisa revelar.
    { produto: "Steelpower", n: 200, total_produto: 500, share_no_produto: 40 },
    { produto: "NerveEase", n: 191, total_produto: 300, share_no_produto: 63.7 },
    { produto: "Sem base", n: 10, total_produto: null, share_no_produto: null },
  ],
  por_canal: [{ canal: "Email", n: 459 }],
};

vi.mock("@/features/copy/useCopyReasonEvidenceQuery", () => ({
  useCopyReasonEvidenceQuery: () => ({
    data: evidencia,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

function renderModal() {
  return render(
    <ReasonEvidenceModal
      category="Insatisfação com o produto"
      onClose={() => {}}
      from="2026-05-31"
      to="2026-08-28"
      product="all"
      platform="all"
      channel="all"
    />,
  );
}

describe("ReasonEvidenceModal", () => {
  it("mostra, ao lado do número, quanto o motivo pesa dentro do produto", () => {
    renderModal();

    const steel = screen.getByText("Steelpower").closest("li") as HTMLElement;
    expect(steel).not.toBeNull();
    expect(steel.textContent).toContain("200");
    expect(steel.textContent).toContain("40,0%");
    expect(screen.getByTitle("200 de 500 reembolsos do Steelpower no período")).toBeInTheDocument();

    // Menos casos, fatia maior: a lista segue ordenada por volume.
    const nerve = screen.getByText("NerveEase").closest("li") as HTMLElement;
    expect(nerve.textContent).toContain("63,7%");
  });

  it("não inventa percentual quando o total do produto não veio", () => {
    renderModal();

    const semBase = screen.getByText("Sem base").closest("li") as HTMLElement;
    expect(semBase.textContent).toContain("—");
  });
});
