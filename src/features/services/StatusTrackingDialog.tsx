import { useState } from "react";
import { Clock, FileText, Hash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useStatusTracking,
  type ServiceStatus,
} from "@/features/services/useStatusTracking";

type Props = {
  serviceId: string;
  clientEmail: string;
  serviceCreatedAt: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function nowDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function StatusTrackingDialog({ serviceId, clientEmail, serviceCreatedAt, open, onOpenChange }: Props) {
  const { getEntries, getCurrentStatus, addEntryMutation, canAddInteraction } = useStatusTracking();
  const { toast } = useToast();

  const entries = getEntries(serviceId);
  const currentStatus = getCurrentStatus(serviceId);
  const isConcluded = currentStatus.variant === "done";
  const interactionCheck = canAddInteraction(serviceId, serviceCreatedAt);

  // Form state
  const [status, setStatus] = useState<ServiceStatus>("em_andamento");
  const [date, setDate] = useState(nowDate);
  const [time, setTime] = useState(nowTime);
  const [observation, setObservation] = useState("");

  const handleSubmit = async () => {
    if (!interactionCheck.allowed) {
      toast({
        title: "Aguarde 24h",
        description: interactionCheck.reason ?? "Já houve uma interação nas últimas 24h.",
        variant: "destructive",
      });
      return;
    }

    const recordedAt = `${date}T${time}:00-03:00`;

    try {
      await addEntryMutation.mutateAsync({
        serviceId,
        status,
        recordedAt,
        observation,
      });

      toast({
        title: "Acompanhamento registrado",
        description: status === "concluido"
          ? "Atendimento marcado como concluído."
          : "Nova interação registrada com sucesso.",
      });

      // Reset form
      setStatus("em_andamento");
      setDate(nowDate());
      setTime(nowTime());
      setObservation("");
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Erro ao registrar",
        description: error?.message ?? "Não foi possível registrar o acompanhamento.",
        variant: "destructive",
      });
    }
  };

  const canSubmit = Boolean(date) && Boolean(time) && !addEntryMutation.isPending && interactionCheck.allowed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Acompanhamento do Atendimento
          </DialogTitle>
          <DialogDescription>
            Cliente: <span className="font-medium text-foreground">{clientEmail}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Current status */}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Status atual:</span>
          <Badge variant={currentStatus.variant}>{currentStatus.label}</Badge>
          {entries.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Hash className="h-3 w-3" />
              {entries.length} {entries.length === 1 ? "interação" : "interações"}
            </span>
          )}
        </div>

        {/* History */}
        {entries.length > 0 && (
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Histórico</p>
            {entries.map((e) => {
              const dt = new Date(e.recorded_at);
              const dateStr = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
              const timeStr = dt.toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });

              return (
                <div key={e.id} className="flex items-start gap-2 border-l-2 border-primary/30 pl-3 text-sm">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={e.status === "concluido" ? "done" : "in-progress"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {e.status === "concluido"
                          ? "Concluído"
                          : e.follow_up_number <= 1
                            ? "Em Andamento"
                            : `Em Andamento ${e.follow_up_number}`}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {dateStr} {timeStr}
                      </span>
                    </div>
                    {e.observation && (
                      <p className="mt-1 text-xs text-muted-foreground">{e.observation}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 24h block warning */}
        {!isConcluded && !interactionCheck.allowed && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-semibold">Bloqueado por 24h</p>
            <p className="mt-1 text-xs">{interactionCheck.reason}</p>
          </div>
        )}

        {/* New entry form */}
        {!isConcluded && interactionCheck.allowed && (
          <div className="grid gap-4 rounded-lg border bg-card p-4">
            <p className="text-sm font-semibold">Novo registro de acompanhamento</p>

            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ServiceStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="concluido">Concluído</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Hora</Label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Observação</Label>
              <Textarea
                placeholder="Descreva o que foi feito nesta interação..."
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        {isConcluded && (
          <div className="rounded-lg border border-status-done/30 bg-status-done/10 p-4 text-center text-sm text-muted-foreground">
            Este atendimento foi concluído com <strong>{entries.length}</strong>{" "}
            {entries.length === 1 ? "interação" : "interações"}.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {!isConcluded && (
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {addEntryMutation.isPending ? "Registrando..." : "Registrar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
