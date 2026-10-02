import { useId, useMemo } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEM_VALOR } from "@/features/dashboard/useDashboardDailyTicketsQuery";

/** Valor do select quando o filtro está desligado. */
export const TODOS = "all";

type Props = {
  /** Rótulo em cima do select ("Plataforma", "Produto"). */
  label: string;
  /** Texto da opção para ticket sem valor gravado ("Sem plataforma"). */
  semValorLabel: string;
  value: string;
  onChange: (next: string) => void;
  /** Valores vindos da RPC para o período; `SEM_VALOR` pode estar entre eles. */
  options: string[] | undefined;
  disabled?: boolean;
};

/**
 * Select de um filtro da Visão Geral. As opções são as que existem no
 * período (vêm do banco), não o catálogo do agente: o histórico tem valores
 * que o catálogo não tem mais.
 *
 * Se a gestora troca o período e o valor escolhido não aparece nele, a opção
 * continua na lista — sumir com ela deixaria o select mostrando "Todos"
 * enquanto o gráfico segue filtrado (e zerado).
 */
export function FiltroVisaoGeral({ label, semValorLabel, value, onChange, options, disabled }: Props) {
  const id = useId();

  const lista = useMemo(() => {
    const base = options ?? [];
    return value !== TODOS && !base.includes(value) ? [...base, value] : base;
  }, [options, value]);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full bg-background">
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent className="z-50 max-h-[320px]">
          <SelectItem value={TODOS}>Todos</SelectItem>
          {lista.map((opcao) => (
            <SelectItem key={opcao} value={opcao}>
              {opcao === SEM_VALOR ? semValorLabel : opcao}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
