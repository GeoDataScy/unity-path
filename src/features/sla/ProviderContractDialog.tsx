import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/supabaseError";

import { formatMesPorExtenso, saoPauloMonthStart } from "./format";
import { useSlaAderenciaQuery } from "./useSlaAderenciaQuery";

const CAPACIDADE_PADRAO = 100;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: { id: string; full_name: string | null } | null;
};

/**
 * Gestora: pacote e capacidade por dia útil do contrato do prestador
 * (provider_contracts) e lançamento da aderência à Base de Suporte apurada
 * pela Imperium (sla_aderencia_mensal). As escritas passam pela RLS de manager.
 */
export function ProviderContractDialog({ open, onOpenChange, provider }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userId = provider?.id ?? null;

  const contrato = useQuery({
    queryKey: ["sla", "contrato", userId],
    enabled: open && Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_contracts")
        .select("pacote_nome, capacidade_dia_util")
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [pacote, setPacote] = useState("");
  const [capacidade, setCapacidade] = useState(String(CAPACIDADE_PADRAO));

  useEffect(() => {
    if (!open || contrato.isLoading) return;
    setPacote(contrato.data?.pacote_nome ?? "");
    setCapacidade(String(contrato.data?.capacidade_dia_util ?? CAPACIDADE_PADRAO));
  }, [open, contrato.isLoading, contrato.data]);

  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => saoPauloMonthStart(-(i + 1))), []);
  const [mes, setMes] = useState(meses[0]);
  const aderencia = useSlaAderenciaQuery({ enabled: open, month: mes, userId });
  const [pct, setPct] = useState("");

  useEffect(() => {
    if (!open || aderencia.isLoading) return;
    setPct(aderencia.data == null ? "" : String(aderencia.data));
  }, [open, mes, aderencia.isLoading, aderencia.data]);

  const capacidadeNum = Number(capacidade);
  const capacidadeOk = Number.isInteger(capacidadeNum) && capacidadeNum > 0;
  const pctNum = Number(pct.replace(",", "."));
  const pctOk = pct.trim() !== "" && Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100;

  const salvarContrato = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("provider_contracts").upsert({
        user_id: userId as string,
        pacote_nome: pacote.trim() || null,
        capacidade_dia_util: capacidadeNum,
      });
      if (error) throw toError(error, "Não foi possível salvar o contrato.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sla"] });
      toast({ title: "Contrato salvo", description: "A capacidade do pacote foi atualizada." });
    },
    onError: (e: Error) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const lancarAderencia = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sla_aderencia_mensal")
        .upsert({ user_id: userId as string, mes, pct: pctNum });
      if (error) throw toError(error, "Não foi possível lançar a aderência.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sla", "aderencia"] });
      toast({ title: "Aderência lançada", description: `${formatMesPorExtenso(mes.slice(0, 7))}: ${pctNum}%` });
    },
    onError: (e: Error) => toast({ title: "Erro ao lançar", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Contrato do prestador</DialogTitle>
          <DialogDescription>{provider?.full_name ?? "Prestador"}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="contrato-pacote">Pacote</Label>
            <Input
              id="contrato-pacote"
              value={pacote}
              onChange={(e) => setPacote(e.target.value)}
              placeholder="Nome do pacote contratado"
              disabled={contrato.isLoading}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contrato-capacidade">Capacidade por dia útil</Label>
            <Input
              id="contrato-capacidade"
              inputMode="numeric"
              value={capacidade}
              onChange={(e) => setCapacidade(e.target.value.replace(/\D/g, ""))}
              disabled={contrato.isLoading}
            />
            <p className="text-sm text-muted-foreground">
              Média de atendimentos por dia útil, apurada no mês. Capacidade do mês = dias úteis × este valor.
              Sem contrato cadastrado vale {CAPACIDADE_PADRAO}.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => salvarContrato.mutate()}
              disabled={!capacidadeOk || contrato.isLoading || salvarContrato.isPending}
            >
              {salvarContrato.isPending ? "Salvando..." : "Salvar contrato"}
            </Button>
          </div>

          <Separator />

          <div className="grid gap-2">
            <Label>Aderência à Base de Suporte</Label>
            <p className="text-sm text-muted-foreground">
              Percentual apurado pela Imperium no mês. A plataforma só exibe. Meta contratual: 95%.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={mes} onValueChange={setMes}>
                <SelectTrigger className="sm:w-56" aria-label="Mês da aderência">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {meses.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatMesPorExtenso(m.slice(0, 7))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Percentual de aderência"
                inputMode="decimal"
                placeholder="Ex.: 96,5"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                disabled={aderencia.isLoading}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={() => lancarAderencia.mutate()} disabled={!pctOk || lancarAderencia.isPending}>
            {lancarAderencia.isPending ? "Lançando..." : "Lançar aderência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
