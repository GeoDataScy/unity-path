import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LyaMark } from "./LyaMark";

// As regras de aplicação do símbolo que não podem regredir sem alguém notar:
// congelar abaixo de 24px, tamanho vindo do CSS (nunca do SVG) e estado
// trocado por atributo (nunca remontando o SVG).

function marca(container: HTMLElement) {
  return container.querySelector(".lya") as HTMLElement;
}

describe("LyaMark", () => {
  it("congela abaixo de 24px — movimento minúsculo é ruído", () => {
    const { container } = render(<LyaMark size={16} />);
    expect(marca(container)).toHaveAttribute("data-lya-static", "true");
  });

  it("anima a partir de 24px", () => {
    const { container } = render(<LyaMark size={24} />);
    expect(marca(container)).not.toHaveAttribute("data-lya-static");
  });

  it("congela sob demanda mesmo grande (mensagens antigas da thread)", () => {
    const { container } = render(<LyaMark size={72} congelado />);
    expect(marca(container)).toHaveAttribute("data-lya-static", "true");
  });

  it("troca de estado sem remontar o SVG", () => {
    const { container, rerender } = render(<LyaMark estado="pensando" />);
    const svg = container.querySelector("svg");
    rerender(<LyaMark estado="respondendo" />);
    expect(marca(container)).toHaveAttribute("data-lya-state", "respondendo");
    expect(container.querySelector("svg")).toBe(svg);
  });

  it("o tamanho vem do CSS, não de width/height no SVG", () => {
    const { container } = render(<LyaMark size={40} />);
    expect(marca(container).style.width).toBe("40px");
    const svg = container.querySelector("svg")!;
    expect(svg.hasAttribute("width")).toBe(false);
    expect(svg.hasAttribute("height")).toBe(false);
  });

  it("é decorativo quando já há texto ao lado", () => {
    const { container } = render(<LyaMark label={null} />);
    const el = marca(container);
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).not.toHaveAttribute("role");
  });

  it("usa a monocromática branca sobre fundo roxo", () => {
    const { container } = render(<LyaMark tone="branco" />);
    expect(marca(container)).toHaveAttribute("data-lya-tone", "branco");
  });

  it("aceita o tom neon da bolha flutuante", () => {
    const { container } = render(<LyaMark tone="neon" />);
    expect(marca(container)).toHaveAttribute("data-lya-tone", "neon");
  });
});
