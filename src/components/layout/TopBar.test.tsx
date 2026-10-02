import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TopBar } from "./TopBar";

describe("TopBar", () => {
  it("põe o tema e os controles extras na mesma faixa, sem nada fixo", () => {
    render(
      <TopBar>
        <button type="button">Notificações</button>
      </TopBar>,
    );
    const banner = screen.getByRole("banner");
    expect(banner.contains(screen.getByRole("button", { name: "Notificações" }))).toBe(true);
    expect(banner.contains(screen.getByRole("button", { name: /Mudar para modo/ }))).toBe(true);
    expect(banner.querySelector(".fixed")).toBeNull();
  });
});
