import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Estrutura } from "../types";

export const TODOS = "todos";
export type EstruturaFiltro = Estrutura | typeof TODOS;

/**
 * Filtro de estrutura reaproveitado por Produtos (E-mail) e Produtos (SMS) — as
 * duas abas tinham o mesmo toggle escrito duas vezes, com contagens montadas de
 * formas diferentes.
 */
export function EstruturaFilter({
  value,
  onChange,
  contagem,
}: {
  value: EstruturaFiltro;
  onChange: (v: EstruturaFiltro) => void;
  contagem: { todos: number; nova: number; antiga: number };
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as EstruturaFiltro)}
      className="justify-start rounded-md border bg-background p-0.5"
      aria-label="Filtrar por estrutura"
    >
      <ToggleGroupItem value={TODOS} className="h-8 px-3 text-xs">
        Todas ({contagem.todos})
      </ToggleGroupItem>
      <ToggleGroupItem value="nova" className="h-8 px-3 text-xs">
        Nova ({contagem.nova})
      </ToggleGroupItem>
      <ToggleGroupItem value="antiga" className="h-8 px-3 text-xs">
        Antiga ({contagem.antiga})
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
