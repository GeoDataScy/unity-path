import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSidebarTone } from "./sidebarTone";

describe("useSidebarTone", () => {
  beforeEach(() => window.localStorage.clear());

  it("começa no verde, que é o padrão", () => {
    const { result } = renderHook(() => useSidebarTone("u1"));
    expect(result.current[0]).toBe("verde");
  });

  it("guarda a escolha por usuário", () => {
    const { result } = renderHook(() => useSidebarTone("u1"));
    act(() => result.current[1]("rosa"));
    expect(result.current[0]).toBe("rosa");

    expect(renderHook(() => useSidebarTone("u1")).result.current[0]).toBe("rosa");
    expect(renderHook(() => useSidebarTone("u2")).result.current[0]).toBe("verde");
  });

  it("valor desconhecido no armazenamento volta para o verde", () => {
    window.localStorage.setItem("agent-sidebar-tone:u1", "roxo");
    expect(renderHook(() => useSidebarTone("u1")).result.current[0]).toBe("verde");
  });

  it("lê a cor quando o userId chega depois do primeiro render", () => {
    window.localStorage.setItem("agent-sidebar-tone:u1", "azul");
    const { result, rerender } = renderHook(({ id }) => useSidebarTone(id), {
      initialProps: { id: null as string | null },
    });
    expect(result.current[0]).toBe("verde");
    rerender({ id: "u1" });
    expect(result.current[0]).toBe("azul");
  });
});
