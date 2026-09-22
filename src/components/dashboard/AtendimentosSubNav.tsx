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
      className={cn("inline-flex h-10 items-center rounded-md bg-muted p-1 text-muted-foreground", className)}
    >
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
