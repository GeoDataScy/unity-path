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
};

export function DateRangePicker({ value, onChange, className }: Props) {
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
          className={cn(
            "w-full justify-start gap-2 border border-input bg-surface font-normal text-ink shadow-xs hover:bg-subtle",
            !value?.from && "opacity-80",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-auto p-0 z-50 bg-popover text-popover-foreground border")}
        align="start"
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
