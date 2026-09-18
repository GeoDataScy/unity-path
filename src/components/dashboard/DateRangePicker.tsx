import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;
  className?: string;
  /** Só o ícone — usado quando a sidebar está encolhida e não há largura para o texto. */
  compact?: boolean;
};

export function DateRangePicker({ value, onChange, className, compact = false }: Props) {
  const label = React.useMemo(() => {
    if (!value?.from) return "Selecione um período";
    if (!value.to) return format(value.from, "dd/MM/yyyy");
    return `${format(value.from, "dd/MM/yyyy")} — ${format(value.to, "dd/MM/yyyy")}`;
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          aria-label={compact ? `Período: ${label}` : undefined}
          className={cn(
            "w-full bg-white/10 text-dashboard-sidebar-foreground hover:bg-white/15",
            compact ? "h-9 justify-center px-0" : "justify-start gap-2",
            !value?.from && "opacity-80",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          {!compact && <span className="truncate">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "w-auto p-0 z-50 bg-popover text-popover-foreground border",
          // Em tela baixa o calendário de 2 meses não cabe acima nem abaixo do
          // gatilho: rola dentro do popover em vez de ficar cortado.
          "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto",
        )}
        align="start"
        collisionPadding={8}
      >
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
