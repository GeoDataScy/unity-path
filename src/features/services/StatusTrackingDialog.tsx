import { useState } from "react";
import { format } from "date-fns";
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
import {
  useStatusTracking,
  type ServiceStatus,
} from "@/features/services/useStatusTracking";

type Props = {
  serviceId: string;
  clientEmail: string;
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

export function StatusTrackingDialog({ serviceId, clientEmail, open, onOpenChange }: Props) {
  const { getTracking, getCurrentStatus, addEntry } = useStatusTracking();

  const tracking = getTracking(serviceId);
  const currentStatus = getCurrentStatus(serviceId);
  const entries = tracking?.entries ?? [];
  const isConcluded = currentStatus.variant === "done";

  // Form state
  const [status, setStatus] = useState<ServiceStatus>("em_andamento");
  const [date, setDate] = useState(nowDate);
  const [time, setTime] = useState(nowTime);
  const [observation, setObservation] = useState("");

  const handleSubmit = () => {
    addEntry(serviceId, { status, date, time, observation });
    // Reset form
    setStatus("em_andamento");
    setDate(nowDate());
    setTime(nowTime());
    setObservation("");
    onOpenChange(false);
  };

  const canSubmit = Boolean(date) && Boolean(time);

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
              {entries.length} {entries.length === 1 ? "interacao" : "interacoes"}
            </span>
          )}
        </div>

        {/* History */}
        {entries.length > 0 && (
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Historico</p>
            {entries.map((e, i) => (
              <div key={i} className="flex items-start gap-2 border-l-2 border-primary/30 pl-3 text-sm">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={e.status === "concluido" ? "done" : "in-progress"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {e.status === "concluido"
                        ? "Concluido"
                        : e.followUp <= 1
                          ? "Em Andamento"
                          : `Em Andamento ${e.followUp}`}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {e.date.split("-").reverse().join("/")} {e.time}
                    </span>
                  </div>
                  {e.observation && (
                    <p className="mt-1 text-xs text-muted-foreground">{e.observation}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New entry form */}
        {!isConcluded && (
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
                  <SelectItem value="concluido">Concluido</SelectItem>
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
              <Label>Observacao</Label>
              <Textarea
                placeholder="Descreva o que foi feito nesta interacao..."
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        {isConcluded && (
          <div className="rounded-lg border border-status-done/30 bg-status-done/10 p-4 text-center text-sm text-muted-foreground">
            Este atendimento foi concluido com <strong>{entries.length}</strong>{" "}
            {entries.length === 1 ? "interacao" : "interacoes"}.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {!isConcluded && (
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              Registrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
