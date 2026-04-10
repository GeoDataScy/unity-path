import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Mail, Package, ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMyRefundsQuery } from "@/features/refunds/useMyRefundsQuery";

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(value);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatBR(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

function daysAgo(d: Date): number {
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

type Props = {
  enabled: boolean;
};

export function PendingRefundsAlert({ enabled }: Props) {
  const { data: refunds = [] } = useMyRefundsQuery(enabled);
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const pending = useMemo(() => {
    const now = new Date();
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
    return refunds.filter((r) => {
      if (r.completion_date) return false;
      const reqDate = parseDate(r.request_date);
      if (!reqDate) return false;
      return now.getTime() - reqDate.getTime() >= TWENTY_FOUR_H;
    });
  }, [refunds]);

  // Open the dialog once when pending refunds are detected
  useEffect(() => {
    if (acknowledged) return;
    if (pending.length > 0) {
      setOpen(true);
    }
  }, [pending.length, acknowledged]);

  const handleAcknowledge = () => {
    setAcknowledged(true);
    setOpen(false);
  };

  if (pending.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block closing by ESC/click outside until acknowledged
        if (!next && !acknowledged) return;
        setOpen(next);
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-500/15 p-2.5">
              <AlertCircle className="h-6 w-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl">Reembolsos pendentes há mais de 24h</DialogTitle>
              <DialogDescription className="mt-1">
                Você tem <span className="font-semibold text-foreground">{pending.length}</span>{" "}
                {pending.length === 1 ? "reembolso aguardando" : "reembolsos aguardando"} atenção.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] pr-3">
          <div className="space-y-2.5">
            {pending.map((r) => {
              const reqDate = parseDate(r.request_date);
              const days = reqDate ? daysAgo(reqDate) : 0;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{r.customer_email}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <ShoppingBag className="h-3 w-3" />
                          {r.sales_platform}
                        </span>
                        {r.product && (
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {r.product}
                          </span>
                        )}
                        <span>Pedido: <span className="font-mono text-foreground">{r.order_id}</span></span>
                        {r.channel && <span>Canal: <span className="text-foreground">{r.channel}</span></span>}
                      </div>
                      {reqDate && (
                        <div className="text-xs text-muted-foreground">
                          Solicitado em <span className="font-medium text-foreground">{formatBR(reqDate)}</span>
                        </div>
                      )}
                    </div>
                    <Badge variant="destructive" className="shrink-0">
                      {days === 0 ? "Hoje" : `${days}d atrás`}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={handleAcknowledge} className="w-full sm:w-auto">
            Entendi, vou resolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
