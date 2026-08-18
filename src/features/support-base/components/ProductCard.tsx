import { ExternalLink, Gift, Link2, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SupportProduct } from "../types";
import { CopyButton } from "./CopyButton";

const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

const isVsl = (label: string, url: string) =>
  label.toLowerCase().includes("vsl") || url.toLowerCase().includes("vsl");

export function ProductCard({ product }: { product: SupportProduct }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-tight">{product.nome}</h3>
          {product.funcao && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.funcao}</p>
          )}
        </div>
        {product.nicho && (
          <Badge variant="secondary" className="shrink-0 text-[10px] font-medium">
            {product.nicho}
          </Badge>
        )}
      </div>

      {product.plataforma && (
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {product.plataforma}
        </p>
      )}

      {product.url && (
        <div className="flex items-center gap-1 border-t pt-2">
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{hostOf(product.url)}</span>
          </a>
          <CopyButton value={product.url} size="icon" />
        </div>
      )}

      {product.links.length > 0 && (
        <div className="border-t border-dashed pt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Link2 className="h-3 w-3" />
            Outras páginas de venda
          </div>
          <div className="space-y-1">
            {product.links.map((link) => (
              <div key={link.url + link.label} className="flex items-center gap-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{hostOf(link.url)}</span>
                </a>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  {link.label}
                  {isVsl(link.label, link.url) && (
                    <Badge variant="outline" className="px-1 py-0 text-[9px] font-bold">
                      VSL
                    </Badge>
                  )}
                </span>
                <CopyButton value={link.url} size="icon" />
              </div>
            ))}
          </div>
        </div>
      )}

      {product.bonus_url && (
        <div className="border-t border-dashed pt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Gift className="h-3 w-3" />
            {product.bonus_tipo === "super" ? "Super bônus" : "Bônus"}
          </div>
          <div className="flex items-center gap-1">
            <a
              href={product.bonus_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 text-[11px] hover:underline",
                product.bonus_tipo === "super" ? "text-fuchsia-600" : "text-primary",
              )}
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{hostOf(product.bonus_url)}</span>
            </a>
            <CopyButton value={product.bonus_url} size="icon" />
          </div>
        </div>
      )}

      {product.sms_number && (
        <div className="flex items-center gap-1 border-t border-dashed pt-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate font-mono">{product.sms_number}</span>
          </span>
          <CopyButton value={product.sms_number} size="icon" />
        </div>
      )}
    </Card>
  );
}
