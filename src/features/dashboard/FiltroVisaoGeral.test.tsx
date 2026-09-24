import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { FiltroVisaoGeral, TODOS } from "./FiltroVisaoGeral";
import { SEM_VALOR } from "./useDashboardDailyTicketsQuery";

function abrir() {
  // O jsdom não tem PointerEvent, então o Select abre pelo teclado.
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
}

describe("FiltroVisaoGeral", () => {
  beforeAll(() => {
    // jsdom não implementa o que o Radix usa para posicionar e rolar a lista.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("lista Todos + as opções do período, com rótulo próprio para ticket sem valor", () => {
    render(
      <FiltroVisaoGeral
        label="Plataforma"
        semValorLabel="Sem plataforma"
        value={TODOS}
        onChange={() => {}}
        options={["Buygoods", "Cartpanda", SEM_VALOR]}
      />,
    );
    expect(screen.getByLabelText("Plataforma")).toBeTruthy();
    abrir();
    const nomes = screen.getAllByRole("option").map((o) => o.textContent);
    expect(nomes).toEqual(["Todos", "Buygoods", "Cartpanda", "Sem plataforma"]);
  });

  it("escolher uma opção devolve o valor gravado no banco", () => {
    const onChange = vi.fn();
    render(
      <FiltroVisaoGeral
        label="Produto"
        semValorLabel="Sem produto"
        value={TODOS}
        onChange={onChange}
        options={["Horsefil", "Honeyfil"]}
      />,
    );
    abrir();
    fireEvent.click(screen.getByRole("option", { name: "Honeyfil" }));
    expect(onChange).toHaveBeenCalledWith("Honeyfil");
  });

  it("mantém na lista o valor escolhido que não existe no período novo", () => {
    render(
      <FiltroVisaoGeral
        label="Produto"
        semValorLabel="Sem produto"
        value="Jellyrock"
        onChange={() => {}}
        options={["Horsefil"]}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toBe("Jellyrock");
    abrir();
    expect(screen.getByRole("option", { name: "Jellyrock" })).toBeTruthy();
  });
});
