import { useCallback, useEffect, useState } from "react";

// Cor da sidebar, escolhida em Configurações → Personalize sua tela, nas quatro
// áreas (agente, gestora, copy e produtos). Verde é o padrão da marca; azul e
// rosa são o mesmo desenho com outro matiz (tokens em src/index.css,
// `.hubi-sidebar[data-tone]`).
export type SidebarTone = "verde" | "azul" | "rosa";

export const SIDEBAR_TONES: { value: SidebarTone; label: string }[] = [
  { value: "verde", label: "Verde (padrão)" },
  { value: "azul", label: "Azul" },
  { value: "rosa", label: "Rosa" },
];

const DEFAULT_TONE: SidebarTone = "verde";

// Por usuário, e a mesma em todas as áreas: quem tem duas (gestora, copy) não
// precisa escolher duas vezes. No mesmo computador, cada pessoa vê a sua.
function storageKey(userId: string) {
  return `sidebar-tone:${userId}`;
}

// Chave da primeira versão, que só existia na área do agente. Lida como
// reserva para o agente não perder a cor que já tinha escolhido.
function legacyStorageKey(userId: string) {
  return `agent-sidebar-tone:${userId}`;
}

export function isSidebarTone(value: unknown): value is SidebarTone {
  return value === "verde" || value === "azul" || value === "rosa";
}

function readTone(userId: string | null): SidebarTone {
  if (!userId) return DEFAULT_TONE;
  try {
    const saved =
      window.localStorage.getItem(storageKey(userId)) ?? window.localStorage.getItem(legacyStorageKey(userId));
    return isSidebarTone(saved) ? saved : DEFAULT_TONE;
  } catch {
    return DEFAULT_TONE;
  }
}

export function useSidebarTone(userId: string | null) {
  const [tone, setToneState] = useState<SidebarTone>(() => readTone(userId));

  // O userId chega depois do primeiro render (o layout espera a sessão).
  useEffect(() => {
    setToneState(readTone(userId));
  }, [userId]);

  const setTone = useCallback(
    (next: SidebarTone) => {
      setToneState(next);
      if (!userId) return;
      try {
        window.localStorage.setItem(storageKey(userId), next);
      } catch {
        // Armazenamento bloqueado: a cor vale só até recarregar.
      }
    },
    [userId],
  );

  return [tone, setTone] as const;
}
