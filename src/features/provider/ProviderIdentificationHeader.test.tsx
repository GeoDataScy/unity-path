import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderIdentificationHeader } from "./ProviderIdentificationHeader";
import type { ProviderContract } from "./useMyProviderContractQuery";

let contrato: ProviderContract | null = null;
vi.mock("./useMyProviderContractQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useMyProviderContractQuery")>()),
  useMyProviderContractQuery: () => ({ data: contrato, isLoading: false }),
}));

const COMPLETO: ProviderContract = {
  razao_social: "GIOVANNA GODOY AQUINO",
  cnpj: "62.826.853/0001-34",
  contrato_numero: "0042/2026",
  pacote_nome: "Suporte Premium",
  capacidade_dia_util: 120,
  vigencia_inicio: "2026-01-01",
  vigencia_fim: "2026-12-31",
};

function renderHeader() {
  render(
    <ProviderIdentificationHeader
      userId="u-1"
      fullName="Giovanna Godoy"
      channelBadge={<span>EMAIL</span>}
    />,
  );
  return screen.getByRole("region", { name: "Identificação do prestador" });
}

const placeholders = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[data-placeholder="true"]')).map((el) => el.textContent);

describe("ProviderIdentificationHeader", () => {
  beforeEach(() => {
    contrato = null;
  });

  it("mostra o nome como título, sem saudação, e o canal", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Giovanna Godoy");
    expect(screen.queryByText(/Vamos lá/)).not.toBeInTheDocument();
    expect(screen.getByText("EMAIL")).toBeInTheDocument();
  });

  it("contrato completo: todos os dados, nenhum placeholder", () => {
    contrato = COMPLETO;
    const root = renderHeader();
    const q = within(root);
    expect(q.getByText("Prestadora")).toBeInTheDocument();
    expect(q.getByText("GIOVANNA GODOY AQUINO")).toBeInTheDocument();
    expect(q.getByText("62.826.853/0001-34")).toBeInTheDocument();
    expect(q.getByText("Titular / responsável")).toBeInTheDocument();
    expect(root).toHaveTextContent("Contrato de prestação de serviços nº 0042/2026");
    expect(root).toHaveTextContent("Suporte Premium — 120 atendimentos por dia útil");
    expect(root).toHaveTextContent("Vigência: 01/01/2026 a 31/12/2026");
    expect(placeholders(root)).toEqual([]);
  });

  it("contrato com campos vazios: placeholders em cinza e capacidade real", () => {
    contrato = {
      razao_social: null,
      cnpj: null,
      contrato_numero: null,
      pacote_nome: null,
      capacidade_dia_util: 100,
      vigencia_inicio: null,
      vigencia_fim: null,
    };
    const root = renderHeader();
    expect(placeholders(root)).toEqual([
      "[Razão social a cadastrar]",
      "00.000.000/0000-00",
      "nº 0000/2026",
      "Suporte",
      "Vigência a definir",
    ]);
    for (const el of root.querySelectorAll('[data-placeholder="true"]')) {
      expect(el).toHaveClass("text-ink-tertiary");
    }
    expect(root).toHaveTextContent("100 atendimentos por dia útil");
  });

  it("sem linha de contrato: mesmos placeholders e capacidade padrão 100", () => {
    contrato = null;
    const root = renderHeader();
    expect(placeholders(root)).toHaveLength(5);
    expect(root).toHaveTextContent("Suporte — 100 atendimentos por dia útil");
  });

  it("contrato só com razão social e CNPJ (como o seed): o resto em placeholder", () => {
    contrato = { ...COMPLETO, contrato_numero: null, pacote_nome: null, capacidade_dia_util: 100, vigencia_inicio: null, vigencia_fim: null };
    const root = renderHeader();
    expect(within(root).getByText("GIOVANNA GODOY AQUINO")).not.toHaveAttribute("data-placeholder");
    expect(placeholders(root)).toEqual(["nº 0000/2026", "Suporte", "Vigência a definir"]);
  });
});
