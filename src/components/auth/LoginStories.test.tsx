import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginStories } from "./LoginStories";

// rAF controlado: cada chamada de frame(ms) avança o relógio e roda os callbacks.
let now = 0;
let nextId = 1;
let callbacks = new Map<number, FrameRequestCallback>();
function frame(ms: number) {
  now += ms;
  const run = [...callbacks.values()];
  callbacks = new Map();
  act(() => run.forEach((cb) => cb(now)));
}

beforeEach(() => {
  now = 0;
  callbacks = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  // jsdom não toca vídeo: play() rejeita, então o vídeo é cronometrado como imagem.
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new Error("sem mídia")));
  HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

function current() {
  return screen.getAllByRole("button").findIndex((b) => b.getAttribute("aria-current") === "step");
}

describe("LoginStories", () => {
  it("mostra só as barrinhas com rótulo, sem título", () => {
    render(<LoginStories />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver: hubi" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Ver: IA Treinada" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver: Dados & Insights" })).toBeInTheDocument();
  });

  it("enche a barra em 8 s e passa para o próximo", async () => {
    render(<LoginStories />);
    await act(async () => {}); // deixa o play() rejeitar
    for (let i = 0; i < 40; i++) frame(100); // 4 s
    const width = parseFloat(screen.getByTestId("story-bar-0").style.width);
    expect(width).toBeGreaterThan(45);
    expect(width).toBeLessThan(55);
    for (let i = 0; i < 41; i++) frame(100); // passa dos 8 s
    expect(current()).toBe(1);
    expect(screen.getByTestId("story-bar-0").style.width).toBe("100%");
  });

  it("depois do último volta para o primeiro", async () => {
    render(<LoginStories />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Ver: Dados & Insights" }));
    await act(async () => {});
    for (let i = 0; i < 81; i++) frame(100);
    expect(current()).toBe(0);
  });

  it("vídeo travado sem carregar passa a contar pelo relógio", () => {
    // play() resolve, mas o vídeo nunca sai do segundo 0 (rede parada).
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    render(<LoginStories />);
    for (let i = 0; i < 20; i++) frame(100); // 2 s: ainda esperando o vídeo
    expect(screen.getByTestId("story-bar-0").style.width).toBe("0%");
    for (let i = 0; i < 90; i++) frame(100); // passou do limite e o relógio andou 8 s
    expect(current()).toBe(1);
  });

  it("clicar na barrinha pula para aquele slide", () => {
    render(<LoginStories />);
    fireEvent.click(screen.getByRole("button", { name: "Ver: IA Treinada" }));
    expect(current()).toBe(1);
  });
});
