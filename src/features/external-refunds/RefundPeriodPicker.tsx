import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { fmtMonth } from "./types";

type Props = {
  /** Intervalo escolhido. undefined = todo o período importado. */
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;
  /** Meses com arquivo importado, 'YYYY-MM', para os atalhos. */
  months: string[];
  /** O que mostrar quando nada foi escolhido: o intervalo real dos dados. */
  fallbackLabel: string;
  /** Primeiro dia com dado, 'YYYY-MM-DD'. O calendário abre nesse mês. */
  firstDate?: string;
};

function monthRange(month: string): DateRange {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
}

/**
 * Seletor de período do comparativo, com a cara da pílula "período" do layout
 * de referência: o rótulo é o próprio botão.
 *
 * Não reaproveita `components/dashboard/DateRangePicker` porque aquele é
 * estilizado para a barra lateral escura da gestora (fundo branco translúcido,
 * cor da sidebar) e brigaria com os tokens deste painel. O que importa
 * reaproveitar — Calendar e Popover — é o mesmo.
 *
 * Os atalhos de mês existem para não perder o que o antigo select de "Mês"
 * fazia em um clique.
 */
export function RefundPeriodPicker({ value, onChange, months, fallbackLabel, firstDate }: Props) {
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    if (!value?.from) return fallbackLabel;
    if (!value.to) return `${format(value.from, "dd/MM/yyyy")} – …`;
    return `${format(value.from, "dd/MM/yyyy")} – ${format(value.to, "dd/MM/yyyy")}`;
  }, [value, fallbackLabel]);

  const atalhos = useMemo(
    () => [{ lab: "Todo o período importado", range: undefined as DateRange | undefined }].concat(
      months.map((m) => ({ lab: fmtMonth(m), range: monthRange(m) })),
    ),
    [months],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] transition-colors"
          style={{
            background: "var(--rf-panel)",
            borderColor: value?.from ? "var(--rf-line-strong)" : "var(--rf-line)",
            color: "var(--rf-ink-soft)",
            boxShadow: "var(--rf-shadow)",
          }}
          aria-label="Escolher o período"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          período{" "}
          <b className="rf-display font-semibold" style={{ color: "var(--rf-ink)" }}>
            {label}
          </b>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex flex-wrap gap-1.5 border-b p-3">
          {atalhos.map((a) => (
            <button
              key={a.lab}
              type="button"
              onClick={() => {
                onChange(a.range);
                setOpen(false);
              }}
              className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {a.lab}
            </button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          // Sem escolha, abre onde os dados estão — não no mês de hoje, que pode
          // estar vazio e obrigaria o gestor a navegar para trás.
          defaultMonth={value?.from ?? (firstDate ? new Date(`${firstDate}T12:00:00`) : undefined)}
          locale={ptBR}
          initialFocus
          className="p-3 pointer-events-auto"
        />
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Clique no primeiro dia e depois no último. O recorte vale para os cards, os gráficos e a lista.
        </p>
      </PopoverContent>
    </Popover>
  );
}
