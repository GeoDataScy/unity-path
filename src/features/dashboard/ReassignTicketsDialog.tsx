import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";

import { useOpenTicketsByAgentQuery } from "./useOpenTicketsByAgentQuery";
import {
  useReassignTicketsMutation,
  type ReassignPair,
} from "./useReassignTicketsMutation";
import type { ManagerUser } from "./useManagerUsersQuery";

type Destination = {
  id: string;
  name: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Agente cujos tickets serão redistribuídos. */
  sourceAgent: ManagerUser | null;
  /** Lista completa de usuários do dashboard (para popular destino). */
  allUsers: ManagerUser[];
};

const LARGE_BATCH_WARNING_THRESHOLD = 500;

function formatServiceDate(value: string): string {
  if (!value) return "—";
  // service_date é text ISO "YYYY-MM-DDT..."; pegamos só a data.
  const datePart = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return value;
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}`;
}

function statusVariant(effective: string): "default" | "secondary" | "outline" {
  if (effective === "em_andamento") return "default";
  if (effective === "concluido") return "secondary";
  return "outline";
}

function AgentCombobox({
  value,
  onChange,
  destinations,
  placeholder = "Escolher agente…",
  size = "sm",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  destinations: Destination[];
  placeholder?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => destinations.find((d) => d.id === value) ?? null,
    [destinations, value],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar agente…" />
          <CommandList>
            <CommandEmpty>Nenhum agente encontrado.</CommandEmpty>
            <CommandGroup>
              {destinations.map((d) => (
                <CommandItem
                  key={d.id}
                  value={d.name}
                  onSelect={() => {
                    onChange(d.id === value ? null : d.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === d.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {d.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ReassignTicketsDialog({ open, onOpenChange, sourceAgent, allUsers }: Props) {
  const { toast } = useToast();

  const sourceAgentId = sourceAgent?.id ?? null;

  const ticketsQuery = useOpenTicketsByAgentQuery(sourceAgentId, open);
  const reassignMutation = useReassignTicketsMutation();

  const tickets = ticketsQuery.data ?? [];

  // Selecionados e destinos por service_id.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [bulkTarget, setBulkTarget] = useState<string | null>(null);

  // Reset state quando muda o agente fonte ou abre/fecha o dialog.
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setDestinations({});
      setBulkTarget(null);
    }
  }, [open, sourceAgentId]);

  const destinationOptions = useMemo<Destination[]>(() => {
    return allUsers
      .filter(
        (u) =>
          u.is_active &&
          u.role === "agent" &&
          u.id !== sourceAgentId,
      )
      .map((u) => ({
        id: u.id,
        name: u.full_name?.trim() ? u.full_name : u.email,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [allUsers, sourceAgentId]);

  const ticketIds = useMemo(() => tickets.map((t) => t.service_id), [tickets]);
  const allSelected = ticketIds.length > 0 && selected.size === ticketIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(ticketIds));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function applyBulkDestination() {
    if (!bulkTarget) return;
    if (selected.size === 0) {
      toast({
        title: "Selecione tickets",
        description: "Marque pelo menos um ticket para aplicar o destino em lote.",
        variant: "destructive",
      });
      return;
    }
    setDestinations((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        next[id] = bulkTarget;
      });
      return next;
    });
  }

  // Pares prontos para enviar: só os com destino definido.
  const pairs = useMemo<ReassignPair[]>(() => {
    return tickets
      .filter((t) => destinations[t.service_id])
      .map((t) => ({
        service_id: t.service_id,
        to_user_id: destinations[t.service_id],
      }));
  }, [tickets, destinations]);

  const sourceLabel = sourceAgent?.full_name?.trim() || sourceAgent?.email || "—";

  async function handleSubmit() {
    if (pairs.length === 0) {
      toast({
        title: "Nada para enviar",
        description: "Defina o destino de pelo menos um ticket.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await reassignMutation.mutateAsync(pairs);
      toast({
        title: `${res.moved} ticket(s) redistribuído(s)`,
        description:
          res.skipped > 0
            ? `${res.skipped} já pertenciam ao destino e foram ignorados.`
            : undefined,
      });
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Falha ao redistribuir.";
      toast({
        title: "Erro",
        description: message,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Redistribuir tickets de {sourceLabel}</DialogTitle>
          <DialogDescription>
            Atribua um agente de destino para cada ticket. A redistribuição é imediata —
            o destinatário recebe o ticket em &quot;Meus Atendimentos&quot; sem precisar aceitar.
          </DialogDescription>
        </DialogHeader>

        {ticketsQuery.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando tickets…</div>
        ) : ticketsQuery.isError ? (
          <div className="py-10 text-center text-sm text-destructive">
            Erro ao carregar tickets.
          </div>
        ) : tickets.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Este agente não tem tickets em aberto.
          </div>
        ) : (
          <>
            {tickets.length > LARGE_BATCH_WARNING_THRESHOLD && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong>{tickets.length} tickets em aberto.</strong> Considere redistribuir em
                  lotes menores selecionando subconjuntos com filtro.
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-y py-3">
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todos"
                />
                <span>
                  {selected.size} de {tickets.length} selecionado{selected.size === 1 ? "" : "s"}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Atribuir selecionados a</span>
                <div className="w-[220px]">
                  <AgentCombobox
                    value={bulkTarget}
                    onChange={setBulkTarget}
                    destinations={destinationOptions}
                    placeholder="Escolher agente…"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={applyBulkDestination}
                  disabled={!bulkTarget || selected.size === 0}
                >
                  Aplicar
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[420px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">F.U.</TableHead>
                    <TableHead className="w-[240px]">Destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((t) => (
                    <TableRow key={t.service_id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(t.service_id)}
                          onCheckedChange={() => toggleOne(t.service_id)}
                          aria-label={`Selecionar ${t.client_email}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{t.client_email}</TableCell>
                      <TableCell>{t.product}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatServiceDate(t.service_date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.effective_status)}>
                          {t.effective_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">
                        {t.follow_up_count}
                      </TableCell>
                      <TableCell>
                        <AgentCombobox
                          value={destinations[t.service_id] ?? null}
                          onChange={(id) =>
                            setDestinations((prev) => {
                              const next = { ...prev };
                              if (id === null) {
                                delete next[t.service_id];
                              } else {
                                next[t.service_id] = id;
                              }
                              return next;
                            })
                          }
                          destinations={destinationOptions}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {pairs.length} ticket{pairs.length === 1 ? "" : "s"} com destino definido
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={pairs.length === 0 || reassignMutation.isPending}
            >
              {reassignMutation.isPending ? "Enviando…" : `Enviar (${pairs.length})`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
