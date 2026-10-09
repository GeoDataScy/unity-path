import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ALL = "all";
const ALL_LABEL = "Todos com reembolso externo";

type Props = {
  value: string;
  onChange: (next: string) => void;
  options: string[];
};

/**
 * Filtro de produto do comparativo: lista em ordem alfabética com busca (a
 * lupa vem do CommandInput). "all" continua sendo o valor de "todos".
 */
export function ProductFilterCombobox({ value, onChange, options }: Props) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...options].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })),
    [options],
  );

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Filtrar por produto"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs ring-offset-background transition-colors hover:border-ink-tertiary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className="line-clamp-1 text-left">{value === ALL ? ALL_LABEL : value}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar produto…" />
          <CommandList>
            <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={ALL_LABEL} onSelect={() => pick(ALL)}>
                <Check className={cn("mr-2 h-4 w-4", value === ALL ? "opacity-100" : "opacity-0")} />
                {ALL_LABEL}
              </CommandItem>
              {sorted.map((p) => (
                <CommandItem key={p} value={p} onSelect={() => pick(p)}>
                  <Check className={cn("mr-2 h-4 w-4", value === p ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{p}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
