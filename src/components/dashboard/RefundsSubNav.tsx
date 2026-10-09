import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/dashboard/reembolsos", label: "Visão geral", end: true },
  { to: "/dashboard/reembolsos/comparativo", label: "Comparativo com reembolso externo", end: false },
  { to: "/dashboard/reembolsos/sistema-xmx", label: "Comparativo sistema XMX", end: false },
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
