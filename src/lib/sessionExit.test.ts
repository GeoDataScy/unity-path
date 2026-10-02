import { GoTrueClient } from "@supabase/auth-js";
import { describe, expect, it, vi } from "vitest";

import { createSessionExit } from "./sessionExit";

// Usa o cliente de auth REAL (mesma versão de produção) com storage em memória:
// o loop só aparece com a fila de trava de verdade do auth-js.
let clientSeq = 0;
function makeClient() {
  const mem: Record<string, string> = {};
  return new GoTrueClient({
    url: "http://127.0.0.1:9",
    storageKey: `sb-test-${++clientSeq}-auth-token`,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storage: {
      getItem: (k) => mem[k] ?? null,
      setItem: (k, v) => {
        mem[k] = v;
      },
      removeItem: (k) => {
        delete mem[k];
      },
    },
  });
}

/** Resolve quando uma macrotask consegue rodar — ou seja, quando o event loop não está preso. */
const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createSessionExit", () => {
  it("padrão antigo (signOut dentro do onAuthStateChange) entra em loop sem ceder ao event loop", async () => {
    const client = makeClient();
    await client.initialize();

    let calls = 0;
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);

    let stop = false;
    const oldHandler = async () => {
      if (stop) return;
      calls++;
      if (calls >= 2000) {
        // freio do teste: em produção não existe — a aba congelava aqui
        stop = true;
        expect(macrotaskRan).toBe(false);
        return;
      }
      await client.signOut({ scope: "local" }).catch(() => {});
    };
    client.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) oldHandler();
    });

    oldHandler();
    await nextMacrotask();
    await nextMacrotask();
    expect(calls).toBe(2000);
  });

  it("saída pelo revalidate chama signOut uma vez e termina", async () => {
    const client = makeClient();
    await client.initialize();
    const signOutSpy = vi.spyOn(client, "signOut");
    const onExit = vi.fn();

    const sessionExit = createSessionExit(client, onExit);
    client.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) sessionExit.exit("login", { signOut: false });
    });

    await sessionExit.exit("login", { signOut: true });
    await nextMacrotask();

    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith("login");
  });

  it("SIGNED_OUT vindo de fora (outra aba, refresh falho) sai sem chamar signOut", async () => {
    const client = makeClient();
    await client.initialize();
    const onExit = vi.fn();

    const sessionExit = createSessionExit(client, onExit);
    client.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) sessionExit.exit("login", { signOut: false });
    });
    const signOutSpy = vi.spyOn(client, "signOut");

    // simula o logout disparado por outro caminho do auth-js
    await (client as unknown as { _removeSession: () => Promise<void> })._removeSession();
    await nextMacrotask();

    expect(signOutSpy).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("limpa as chaves sb-* do localStorage e preserva as demais", async () => {
    localStorage.setItem("sb-abc-auth-token", "x");
    localStorage.setItem("xmx:sidebar-collapsed", "1");
    const sessionExit = createSessionExit({ signOut: async () => undefined }, () => {});

    await sessionExit.exit("blocked", { signOut: true });

    expect(localStorage.getItem("sb-abc-auth-token")).toBeNull();
    expect(localStorage.getItem("xmx:sidebar-collapsed")).toBe("1");
  });
});
