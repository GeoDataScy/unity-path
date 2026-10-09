import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ProductCombobox } from "@/features/services/ProductCombobox";
import { PRODUCTS } from "@/features/services/products";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

describe("ProductCombobox", () => {
  it("lista os produtos em ordem alfabética", () => {
    render(<ProductCombobox value="" onChange={() => {}} options={["Zalovira", "arialief", "Beautycell"]} />);
    fireEvent.click(screen.getByRole("combobox"));
    const items = screen.getAllByRole("option").map((el) => el.textContent);
    expect(items).toEqual(["arialief", "Beautycell", "Zalovira"]);
  });

  it("filtra pela busca e devolve o produto escolhido", () => {
    const onChange = vi.fn();
    render(<ProductCombobox value="" onChange={onChange} options={PRODUCTS} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Buscar produto…"), { target: { value: "Vitahear" } });
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(1);
    fireEvent.click(items[0]);
    expect(onChange).toHaveBeenCalledWith("Vitahear");
  });

  it("mostra o placeholder sem valor e o produto quando há valor", () => {
    const { rerender } = render(<ProductCombobox value="" onChange={() => {}} options={PRODUCTS} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Selecione");
    rerender(<ProductCombobox value="Red Horse" onChange={() => {}} options={PRODUCTS} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Red Horse");
  });
});
