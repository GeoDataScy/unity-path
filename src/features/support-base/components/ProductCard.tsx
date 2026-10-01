import { ExternalLink, Gift, Link2, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SupportProduct } from "../types";
import { CopyButton } from "./CopyButton";
import { EstruturaBadge } from "./EstruturaBadge";

const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

const isVsl = (label: string, url: string) =>
  label.toLowerCase().includes("vsl") || url.toLowerCase().includes("vsl");

/** Título das faixas internas do card (links extras, bônus, SMS). */
function BlocoLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
      {children}
    </div>
  );
}

/** Link + botão de copiar: a linha que o agente usa dezenas de vezes por turno. */
function LinkRow({
  url,
  sufixo,
  className,
}: {
  url: string;
  sufixo?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-xs text-primary hover:underline",
          className,
        )}
      >
        <ExternalLink className="h-3 w-3 shrink-0" />
        <span className="truncate">{hostOf(url)}</span>
      </a>
      {sufixo}
      <CopyButton value={url} size="icon" />
    </div>
  );
}

export function ProductCard({ product }: { product: SupportProduct }) {
  return (
    <Card className="flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-medium leading-tight">{product.nome}</h3>
          <EstruturaBadge estrutura={product.estrutura} curto />
        </div>

        {product.funcao && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {product.funcao}
          </p>
        )}

        {(product.nicho || product.plataforma) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {product.nicho && (
              <Badge variant="secondary" className="text-[10px] font-medium">
                {product.nicho}
              </Badge>
            )}
            {product.plataforma && (
              <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {product.plataforma}
              </span>
            )}
          </div>
        )}
      </div>

      {product.url && (
        <div className="border-t pt-2">
          <LinkRow url={product.url} />
        </div>
      )}

      {product.links.length > 0 && (
        <div className="border-t border-dashed pt-2">
          <BlocoLabel>
            <Link2 className="h-3 w-3" />
            Outras páginas de venda
          </BlocoLabel>
          <div className="space-y-1">
            {product.links.map((link) => (
              <LinkRow
                key={link.url + link.label}
                url={link.url}
                className="text-[11px]"
                sufixo={
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    {link.label}
                    {isVsl(link.label, link.url) && (
                      <Badge variant="outline" className="px-1 py-0 text-[9px] font-medium">
                        VSL
                      </Badge>
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}

      {product.bonus_url && (
        <div className="border-t border-dashed pt-2">
          <BlocoLabel>
            <Gift className="h-3 w-3" />
            {product.bonus_tipo === "super" ? "Super bônus" : "Bônus"}
          </BlocoLabel>
          <LinkRow
            url={product.bonus_url}
            className={cn(
              "text-[11px]",
              product.bonus_tipo === "super" && "text-signal",
            )}
          />
        </div>
      )}

      {product.sms_number && (
        <div className="mt-auto flex items-center gap-1 border-t border-dashed pt-2">
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
