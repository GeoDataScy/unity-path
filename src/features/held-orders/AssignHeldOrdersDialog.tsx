import { useMemo, useState } from "react";
import { Loader2, Send, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ManagerUser } from "@/features/dashboard/useManagerUsersQuery";
import { useDistributeHeldOrdersMutation } from "./useManagerHeldOrdersQuery";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  agents: ManagerUser[];
  onAssigned?: () => void;
};

export function AssignHeldOrdersDialog({ open, onOpenChange, orderIds, agents, onAssigned }: Props) {
  const { toast } = useToast();
  const distributeMutation = useDistributeHeldOrdersMutation();
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());

  // Só agentes ativos e não-excluídos podem receber pedidos.
  const assignableAgents = useMemo(
    () => agents.filter((a) => a.role !== "manager" && a.is_active && !a.auth_account_deleted),
    [agents],
  );

  const selectedAgentIds = useMemo(() => Array.from(selectedAgents), [selectedAgents]);
  const nAgents = selectedAgentIds.length;

  // Pré-visualização do round-robin: como os pedidos serão divididos.
  const perAgent = useMemo(() => {
    if (nAgents === 0) return { base: 0, extra: 0 };
    return { base: Math.floor(orderIds.length / nAgents), extra: orderIds.length % nAgents };
  }, [orderIds.length, nAgents]);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => setSelectedAgents(new Set());

  const handleDistribute = async () => {
    if (nAgents === 0) {
      toast({ title: "Selecione ao menos um agente", variant: "destructive" });
      return;
    }
    try {
      const result = await distributeMutation.mutateAsync({ orderIds, agentIds: selectedAgentIds });
      const breakdown = result.by_agent
        .map((a) => `${a.full_name ?? "Sem nome"}: ${a.count}`)
        .join(" · ");
      toast({
        title: "Pedidos distribuídos",
        description: breakdown
          ? `${result.moved} pedido(s) — ${breakdown}`
          : `${result.moved} pedido(s) distribuído(s).`,
      });
      reset();
      onAssigned?.();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Erro ao distribuir",
        description: e instanceof Error ? e.message : "Não foi possível distribuir.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" /> Distribuir pedidos
          </DialogTitle>
          <DialogDescription>
            Atribuir <span className="font-medium text-foreground">{orderIds.length}</span> pedido(s) em espera. Marque
            um ou mais agentes — os pedidos são divididos automaticamente entre eles (round-robin). Apenas pedidos não
            concluídos são movidos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 max-h-72 overflow-y-auto rounded-md border p-1">
          {assignableAgents.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">Nenhum agente disponível.</p>
          ) : (
            assignableAgents.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox checked={selectedAgents.has(a.id)} onCheckedChange={() => toggleAgent(a.id)} />
                <span className="text-sm">{a.full_name ?? a.email}</span>
              </label>
            ))
          )}
        </div>

        {nAgents > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4 shrink-0" />
            <span>
              {nAgents} agente(s) — ~
              <span className="font-medium text-foreground">{perAgent.base}</span>
              {perAgent.extra > 0 ? (
                <>
                  {" "}
                  pedido(s) cada ({perAgent.extra} recebe(m) +1)
                </>
              ) : (
                <> pedido(s) cada</>
              )}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={distributeMutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleDistribute}
            disabled={nAgents === 0 || orderIds.length === 0 || distributeMutation.isPending}
          >
            {distributeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Distribuindo...
              </>
            ) : (
              <>Distribuir</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
