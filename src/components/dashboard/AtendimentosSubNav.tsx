import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/dashboard", label: "Performance por agente", end: true },
  { to: "/dashboard/visao-geral", label: "Visão Geral Atendimentos", end: false },
];

/**
 * Sub-navegação da área de Atendimentos, no mesmo esquema de Reembolsos:
 * visual de abas, mas cada aba é uma rota própria — a performance por agente
 * não continua montada (e consultando) enquanto a gestora olha a visão geral.
 */
export function AtendimentosSubNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Seções de atendimentos"
      className={cn("inline-flex h-[34px] items-center rounded-[9px] bg-subtle p-[3px] text-ink-secondary", className)}
    >
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "inline-flex h-7 items-center justify-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive ? "bg-background text-foreground shadow-[var(--shadow-sm),0_0_0_1px_hsl(var(--line))]" : "hover:text-foreground",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
