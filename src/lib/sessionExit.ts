// Saída de sessão dos layouts (agente, gestora, copy, produtos).
//
// Por que existe: os layouts chamavam `supabase.auth.signOut()` DENTRO do
// `onAuthStateChange` ao receber SIGNED_OUT. No auth-js (2.90.1), o signOut
// emite SIGNED_OUT de novo, e a chamada aninhada entra na fila interna da trava
// (`pendingInLock`), que o dono da trava drena sem nunca ceder ao event loop.
// Resultado: loop infinito só de microtasks — a aba congela por completo (o
// React nunca desmonta o layout) e, como cada volta faz broadcast do logout,
// as outras abas do sistema entram no mesmo loop. Disparava depois de tempo
// parado: o revalidate falhava (rede voltando, token expirado) e chamava o
// signOut, que reacendia o listener.
//
// Regras daqui:
// 1. a saída roda UMA vez por layout montado (`leaving`);
// 2. quem reage ao SIGNED_OUT não chama signOut — a sessão já foi removida.

export type SessionExitTarget = "login" | "blocked";

type AuthSignOut = {
  signOut: (options: { scope: "local" }) => Promise<unknown>;
};

export function createSessionExit(auth: AuthSignOut, onExit: (target: SessionExitTarget) => void) {
  let leaving = false;

  const exit = async (target: SessionExitTarget, { signOut }: { signOut: boolean }) => {
    if (leaving) return;
    leaving = true;
    if (signOut) await auth.signOut({ scope: "local" }).catch(() => {});
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
    onExit(target);
  };

  return { exit };
}
