// Bloco de notas — preferências de tela (não são dado do agente).
//
// Aberto/fechado, largura e recorte moram no localStorage do NAVEGADOR, não na
// conta: é estado de janela, e sincronizar isso pelo banco geraria escrita a cada
// clique de "Semana". O CONTEÚDO das anotações vai para o Postgres — quem guarda
// o quê está descrito na migration 20260826120000_agent_notepad.sql.
//
// Todo acesso é protegido: em modo privado, ou com cookies de site bloqueados, o
// localStorage lança em vez de devolver null — e uma exceção aqui derrubaria a
// área do agente inteira.

type PrefKey = "open" | "scope" | "wide" | "carry";

const PREFIX = "xmx.notepad.";

export function readPref(key: PrefKey): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: PrefKey, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Sem persistência de preferência: a sessão atual continua funcionando.
  }
}
