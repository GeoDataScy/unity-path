// Bloco de notas — botão de ícone das ações do caderno.
//
// Não usa o <Button variant="ghost"> do shadcn de propósito: naquele variant o
// hover é `bg-accent` (roxo cheio, texto branco), o que num ícone de 24px sobre
// papel pautado vira um borrão colorido. Aqui o hover é só um realce discreto.

import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  /** Vira o `aria-label` e o texto do tooltip — sempre obrigatório. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  tone?: "default" | "danger";
  className?: string;
  disabled?: boolean;
};

export function NotepadAction({
  label,
  onClick,
  children,
  tone = "default",
  className,
  disabled,
}: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
            "transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-40",
            tone === "danger" && "hover:bg-destructive/10 hover:text-destructive",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
