import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/dashboard/reembolsos", label: "Visão geral", end: true },
  { to: "/dashboard/reembolsos/comparativo", label: "Comparativo com reembolso externo", end: false },
];

/**
 * Sub-navegação da área de Reembolsos. Visual de abas, mas cada aba é uma rota
 * própria: a visão geral tem polling de 15 s e não deve continuar montada
 * enquanto a gestora olha o comparativo.
 */
export function RefundsSubNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Seções de reembolsos"
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
