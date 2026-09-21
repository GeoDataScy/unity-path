import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";

import { useAgentsQuery } from "@/features/dashboard/useAgentsQuery";
import { LyaChat } from "@/features/lya/components/LyaChat";
import type { LyaContexto } from "@/features/lya/types";
import type { ManagerOutletContext } from "@/layouts/ManagerLayout";

/**
 * Tela cheia da Lya (/dashboard/lya). O período e o agente da barra lateral
 * vão junto com cada pergunta como contexto — "quantos atendimentos no
 * período?" resolve sem repetir datas.
 */
export default function DashboardLya() {
  const { fromISO, toISO, agentId, fullName, role } = useOutletContext<ManagerOutletContext>();
  const agents = useAgentsQuery(true);

  const contexto = useMemo<LyaContexto>(() => {
    const agente = (agents.data ?? []).find((a) => a.id === agentId);
    return {
      de: fromISO,
      ate: toISO,
      agente_id: agentId === "all" ? null : agentId,
      agente_nome: agente?.label ?? null,
      usuario_nome: fullName,
      usuario_role: role,
      tela: "Lya (tela cheia)",
    };
  }, [fromISO, toISO, agentId, agents.data, fullName, role]);

  // Sem nome no perfil, a saudação fica só "Boa tarde" — melhor que
  // "Boa tarde, olá". Há conta de gestora com full_name nulo no banco.
  const firstName = (fullName ?? "").trim().split(" ")[0] || null;

  return <LyaChat contexto={contexto} canTrain={role === "manager"} firstName={firstName} />;
}
