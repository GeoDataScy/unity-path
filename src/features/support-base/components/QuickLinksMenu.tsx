import { ExternalLink, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LINKS_RAPIDOS } from "../data/refundPlaybook";

/**
 * Links rápidos moram no cabeçalho, não num card no pé da página: antes ficavam
 * abaixo de todas as abas, ou seja, o agente precisava rolar a lista inteira
 * (agora paginada) para chegar num link de checkout. Aqui ficam a um clique de
 * qualquer aba.
 */
export function QuickLinksMenu() {
  const grupos = LINKS_RAPIDOS.reduce<Record<string, typeof LINKS_RAPIDOS>>((acc, link) => {
    (acc[link.grupo] ??= []).push(link);
    return acc;
  }, {});

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-background">
          <Link2 className="h-3.5 w-3.5" />
          Links rápidos
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {Object.entries(grupos).map(([grupo, links], idx) => (
          <div key={grupo}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {grupo}
            </DropdownMenuLabel>
            {links.map((link) => (
              <DropdownMenuItem key={link.url} asChild className="text-xs">
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-3 w-3 shrink-0" />
                  {link.label}
                </a>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
