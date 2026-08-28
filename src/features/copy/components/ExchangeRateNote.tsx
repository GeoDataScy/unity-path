import { useState } from "react";
import { CircleDollarSign } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { fmtRate } from "@/features/copy/format";
import { useUsdRateMutation } from "@/features/copy/useUsdRateMutation";
import { supabaseErrorMessage } from "@/lib/supabaseError";

type Props = {
  /** Reais por US$ 1 usada pela RPC nesta carga. */
  rate: number | null;
  /** Quando a cotação foi editada pela última vez (timestamptz). */
  updatedAt: string | null;
  /** Só a gestora edita; o time de copy apenas lê qual cotação foi usada. */
  canEdit: boolean;
};

function fmtWhen(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR");
}

/**
 * Sem isto o número em dólar não é conferível: quem lê a tela precisa saber por
 * qual cotação o valor em real foi dividido, e desde quando ela está valendo.
 */
export function ExchangeRateNote({ rate, updatedAt, canEdit }: Props) {
  const { toast } = useToast();
  const mutation = useUsdRateMutation();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const when = fmtWhen(updatedAt);

  const openDialog = () => {
    setDraft(rate ? String(rate) : "");
    setOpen(true);
  };

  const save = async () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({
        variant: "destructive",
        title: "Cotação inválida",
        description: "Informe quantos reais valem US$ 1 — por exemplo, 5,40.",
      });
      return;
    }

    try {
      await mutation.mutateAsync(parsed);
      setOpen(false);
      toast({
        title: "Cotação atualizada",
        description: `Os valores da tela passam a usar ${fmtRate(parsed)} por US$ 1.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Não foi possível salvar",
        description: supabaseErrorMessage(error, "Tente de novo em instantes."),
      });
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <CircleDollarSign className="h-3.5 w-3.5 shrink-0" />
        <span>
          Valores em dólar, convertidos de real a {fmtRate(rate)} por US$ 1
          {when ? ` (cotação registrada em ${when})` : ""}.
        </span>
        {canEdit && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={openDialog}>
            Atualizar cotação
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cotação do dólar</DialogTitle>
            <DialogDescription>
              Quantos reais valem US$ 1. Vale para todos os valores da tela do copy, e passa a valer
              para todo mundo assim que você salvar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="usd-rate">Reais por US$ 1</Label>
            <Input
              id="usd-rate"
              inputMode="decimal"
              placeholder="5,40"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
