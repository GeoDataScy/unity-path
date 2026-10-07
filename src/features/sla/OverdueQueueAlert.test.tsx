import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OverdueQueueAlert } from "./OverdueQueueAlert";
import type { OverdueQueueItem } from "./types";

let items: OverdueQueueItem[] = [];
vi.mock("./useOverdueQueueItemsQuery", () => ({
  useOverdueQueueItemsQuery: () => ({ data: items }),
}));

function renderAlert() {
  return render(
    <MemoryRouter initialEntries={["/workspace"]}>
      <Routes>
        <Route path="/workspace" element={<OverdueQueueAlert userId="u-1" />} />
        <Route path="/workspace/radar" element={<p>tela do radar</p>} />
        <Route path="/workspace/reembolsos" element={<p>tela de reembolsos</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OverdueQueueAlert", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    items = [
      { caso_id: "aaaaaaaa-1111", tipo: "radar", rotulo_tipo: "Radar sem acompanhamento", prazo_horas: 48, vencido_ha_horas: 30 },
      { caso_id: "bbbbbbbb-2222", tipo: "reembolso_conclusao", rotulo_tipo: "Conclusão de reembolso", prazo_horas: 48, vencido_ha_horas: 6 },
    ];
  });

  it("mostra os casos vencidos como informação, sem pedir confirmação", () => {
    renderAlert();
    expect(screen.getByText("Itens da sua fila com prazo contratual vencido")).toBeInTheDocument();
    expect(screen.getByText(/2 casos ultrapassaram o prazo previsto no pacote/)).toBeInTheDocument();
    expect(screen.getByText("#aaaaaaaa")).toBeInTheDocument();
    expect(screen.getByText("Vencido há 1 dia")).toBeInTheDocument();
    expect(screen.getByText("Vencido há 6h")).toBeInTheDocument();
    expect(screen.getAllByText("48h úteis")).toHaveLength(2);
    expect(screen.queryByText(/Entendi/)).not.toBeInTheDocument();
  });

  it("fecha com ESC", () => {
    renderAlert();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abre só uma vez por sessão", () => {
    const first = renderAlert();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    first.unmount();
    renderAlert();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Ver fila leva à tela do caso mais antigo", () => {
    renderAlert();
    fireEvent.click(screen.getByRole("button", { name: "Ver fila" }));
    expect(screen.getByText("tela do radar")).toBeInTheDocument();
  });

  it("não renderiza nada sem itens vencidos", () => {
    items = [];
    renderAlert();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
