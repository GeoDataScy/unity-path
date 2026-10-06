import { useNavigate } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AREA_PATH,
  AREA_SHORT_LABEL,
  LAST_AREA_KEY,
  areasForRole,
  type AppArea,
  type AreaGrants,
} from "@/lib/roles";

type Props = {
  /** profiles.role do usuário logado. */
  role: string | null | undefined;
  /** Área em que a sidebar está montada. */
  currentArea: AppArea;
  collapsed: boolean;
  /** Liberações individuais do perfil (ex.: copy com acesso ao Data Analytics). */
  grants?: AreaGrants;
};

// Bloco de troca de área na sidebar. Só aparece para quem tem acesso a mais de
// uma área (gestora e copy); para o agente não renderiza nada. Com duas áreas
// o botão leva direto para a outra — um clique em vez de passar por /areas.
export function AreaSwitcher({ role, currentArea, collapsed, grants }: Props) {
  const navigate = useNavigate();
  const others = areasForRole(role, grants).filter((a) => a !== currentArea);

  if (others.length === 0) return null;

  const go = (area: AppArea) => {
    window.localStorage.setItem(LAST_AREA_KEY, area);
    navigate(AREA_PATH[area]);
  };

  if (collapsed) {
    return (
      <div className="space-y-1">
        {others.map((area) => (
          <Tooltip key={area}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => go(area)}
                aria-label={`Ir para ${AREA_SHORT_LABEL[area]}`}
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink-secondary transition-colors hover:bg-subtle hover:text-ink"
              >
                <ArrowLeftRight className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Ir para {AREA_SHORT_LABEL[area]}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-2 space-y-2">
      <div className="px-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Área atual</div>
        <div className="text-xs font-medium text-ink truncate">{AREA_SHORT_LABEL[currentArea]}</div>
      </div>
      {others.map((area) => (
        <button
          key={area}
          type="button"
          onClick={() => go(area)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium",
            "bg-subtle text-ink-secondary hover:bg-line hover:text-ink transition-colors",
          )}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Ir para {AREA_SHORT_LABEL[area]}</span>
        </button>
      ))}
    </div>
  );
}
