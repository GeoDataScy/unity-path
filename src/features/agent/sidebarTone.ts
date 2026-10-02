import { useCallback, useEffect, useState } from "react";

// Cor da sidebar do agente. Verde é o padrão da marca; azul e rosa são o mesmo
// desenho com outro matiz (tokens em src/index.css, `.hubi-sidebar[data-tone]`).
export type SidebarTone = "verde" | "azul" | "rosa";

export const SIDEBAR_TONES: { value: SidebarTone; label: string }[] = [
  { value: "verde", label: "Verde (padrão)" },
  { value: "azul", label: "Azul" },
  { value: "rosa", label: "Rosa" },
];

const DEFAULT_TONE: SidebarTone = "verde";

// Por usuário: no mesmo computador, cada agente vê a cor que escolheu.
function storageKey(userId: string) {
  return `agent-sidebar-tone:${userId}`;
}

export function isSidebarTone(value: unknown): value is SidebarTone {
  return value === "verde" || value === "azul" || value === "rosa";
}

function readTone(userId: string | null): SidebarTone {
  if (!userId) return DEFAULT_TONE;
  try {
    const saved = window.localStorage.getItem(storageKey(userId));
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
