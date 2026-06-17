import { useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { ManagerUser } from "@/features/dashboard/useManagerUsersQuery";
import { useAssignHeldOrdersMutation } from "./useManagerHeldOrdersQuery";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  agents: ManagerUser[];
  onAssigned?: () => void;
};

export function AssignHeldOrdersDialog({ open, onOpenChange, orderIds, agents, onAssigned }: Props) {
  const { toast } = useToast();
  const assignMutation = useAssignHeldOrdersMutation();
  const [agentId, setAgentId] = useState<string>("");

  // Só agentes ativos e não-excluídos podem receber pedidos.
  const assignableAgents = useMemo(
    () =>
      agents.filter(
        (a) => a.role !== "manager" && a.is_active && !a.auth_account_deleted,
      ),
    [agents],
  );

  const handleAssign = async () => {
    if (!agentId) {
      toast({ title: "Selecione um agente", variant: "destructive" });
      return;
    }
    try {
      const count = await assignMutation.mutateAsync({ orderIds, agentId });
      toast({
        title: "Pedidos distribuídos",
        description: `${count} pedido(s) atribuído(s) ao agente.`,
      });
      setAgentId("");
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
        if (!next) setAgentId("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" /> Distribuir pedidos
          </DialogTitle>
          <DialogDescription>
            Atribuir <span className="font-medium text-foreground">{orderIds.length}</span> pedido(s) em espera a um
            agente. Apenas pedidos pendentes são movidos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o agente..." />
            </SelectTrigger>
            <SelectContent>
              {assignableAgents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.full_name ?? a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={assignMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleAssign} disabled={!agentId || orderIds.length === 0 || assignMutation.isPending}>
            {assignMutation.isPending ? (
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
