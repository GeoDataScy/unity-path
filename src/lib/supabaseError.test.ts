import { describe, expect, it } from "vitest";

import { supabaseErrorMessage, toError } from "./supabaseError";

describe("supabaseErrorMessage", () => {
  it("lê o objeto simples devolvido pelo supabase-js (sem throwOnError)", () => {
    const error = {
      code: "P0001",
      details: null,
      hint: null,
      message: "reembolso ja concluido em 2026-04-10",
    };
    expect(supabaseErrorMessage(error, "genérico")).toBe(
      "reembolso ja concluido em 2026-04-10 (P0001)",
    );
  });

  it("cai em details quando message vem vazia", () => {
    const error = { code: "23503", message: "", details: "Key (refund_id) is not present" };
    expect(supabaseErrorMessage(error, "genérico")).toBe(
      "Key (refund_id) is not present (23503)",
    );
  });

  it("usa a mensagem de Error nativo (ex: falha de rede)", () => {
    expect(supabaseErrorMessage(new TypeError("Failed to fetch"), "genérico")).toBe(
      "Failed to fetch",
    );
  });

  it("usa o fallback quando não há nada legível", () => {
    expect(supabaseErrorMessage(null, "genérico")).toBe("genérico");
    expect(supabaseErrorMessage({}, "genérico")).toBe("genérico");
    expect(supabaseErrorMessage(new Error(""), "genérico")).toBe("genérico");
  });
});

describe("toError", () => {
  it("normaliza objeto do PostgREST em Error preservando o original em cause", () => {
    const original = { code: "PGRST202", message: "Could not find the function", details: null };
    const error = toError(original, "genérico");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Could not find the function (PGRST202)");
    expect((error as { cause?: unknown }).cause).toBe(original);
  });

  it("mantém o Error original quando já é um Error com mensagem", () => {
    const original = new Error("Failed to fetch");
    expect(toError(original, "genérico")).toBe(original);
  });
});
