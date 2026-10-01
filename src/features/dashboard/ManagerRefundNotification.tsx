import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDashboardRefundAlertsQuery } from "./useDashboardRefundAlertsQuery";

const SESSION_KEY = "manager_refund_alert_acked";

export function ManagerRefundNotification() {
  const { data } = useDashboardRefundAlertsQuery();
  const [visible, setVisible] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!data?.total_overdue) return;
    if (!sessionStorage.getItem(SESSION_KEY)) setVisible(true);
  }, [data?.total_overdue]);

  const acknowledge = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setVisible(false);
  };

  if (!visible || !data?.total_overdue) return null;

  return (
    <>
      {/* Sem "fechar" no canto: o X fazia exatamente o mesmo que o "Ciente"
          logo abaixo, e dois jeitos de dispensar o mesmo aviso só dividem a
          atenção de quem precisa decidir se vai ver os agentes. */}
      <div className="fixed top-4 right-4 z-50 w-[320px]">
        <div className="rounded-lg border border-warning/40 bg-raised shadow-md p-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-full bg-amber-soft p-1.5">
              <AlertTriangle className="h-4 w-4 text-warning" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">Reembolsos em atraso</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{data.total_overdue}</span> pendentes há +24h —{" "}
                <span className="font-medium text-foreground">{data.agents_affected}</span>{" "}
                {data.agents_affected === 1 ? "agente" : "agentes"}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={acknowledge}
            >
              Ciente
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={() => setDetailsOpen(true)}
            >
              Ver agentes
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="w-[400px] sm:w-[460px]">
          <SheetHeader className="pb-4 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Agentes com reembolsos em atraso
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              {data.total_overdue} reembolsos pendentes há mais de 24h
            </p>
          </SheetHeader>

          <ScrollArea className="mt-4 h-[calc(100vh-140px)] pr-1">
            <div className="space-y-2">
              {data.by_agent.map((group) => (
                <div
                  key={group.agent_id}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{group.agent_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.overdue_count}{" "}
                      {group.overdue_count === 1 ? "reembolso em atraso" : "reembolsos em atraso"}
                    </p>
                  </div>
                  <Badge
                    className={
                      group.overdue_count >= 4
                        ? "bg-destructive text-destructive-foreground"
                        : group.overdue_count >= 2
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-warning text-warning-foreground"
                    }
                  >
                    {group.overdue_count}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
