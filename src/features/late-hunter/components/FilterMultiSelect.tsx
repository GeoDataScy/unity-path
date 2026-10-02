import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FilterOption = {
  value: string;
  label: string;
  /** Quantos abertos têm este valor — ajuda a escolher sem abrir a tabela. */
  count?: number;
};

type Props = {
  /** Nome do filtro no botão quando nada está marcado ("Motivo"). */
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
};

/**
 * Filtro de múltipla escolha: pedido entra se tiver QUALQUER um dos valores
 * marcados. O botão diz o que está ativo ("Motivo: 2") para o filtro nunca ficar
 * escondido atrás de um menu fechado.
 */
export function FilterMultiSelect({ label, options, selected, onChange, searchPlaceholder }: Props) {
  const [open, setOpen] = useState(false);
  const active = selected.length > 0;
  const single = selected.length === 1 ? options.find((o) => o.value === selected[0])?.label ?? selected[0] : null;

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          role="combobox"
          aria-expanded={open}
          aria-label={`Filtrar por ${label.toLowerCase()}`}
          className="h-9 max-w-[220px] justify-between gap-1.5"
        >
          <span className="truncate">
            {!active ? label : single ? `${label}: ${single}` : `${label}: ${selected.length}`}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? `Buscar ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const checked = selected.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => toggle(o.value)}
                    aria-selected={checked}
                  >
                    <span
                      className={cn(
                        "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-line-control",
                        checked && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.count != null && (
                      <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{o.count}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {active && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
                Limpar {label.toLowerCase()}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
