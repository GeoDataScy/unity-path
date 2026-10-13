import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Confirmação do "Exportar resumo (sem dados pessoais)", conforme a tela
// proposta pelo Jurídico (ajuste 6): mostra o que entra e o que fica de fora
// antes de baixar.
export type ExportSummaryField = { label: string; included: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: ExportSummaryField[];
  onConfirm: () => void;
  loading?: boolean;
};

export function ExportSummaryDialog({ open, onOpenChange, fields, onConfirm, loading = false }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar resumo</DialogTitle>
          <DialogDescription>
            O arquivo contém apenas os seus registros, sem identificação de clientes.
          </DialogDescription>
        </DialogHeader>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-normal">Campo</th>
              <th className="py-2 font-normal">Incluído</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.label} className="border-b last:border-0">
                <td className="py-2.5 pr-3">{f.label}</td>
                <td className="py-2.5">
                  {f.included ? (
                    <span className="rounded-full bg-status-success/15 px-2 py-0.5 text-xs font-medium text-status-success">
                      Sim
                    </span>
                  ) : (
                    <span className="rounded-full bg-status-open/15 px-2 py-0.5 text-xs font-medium text-status-open">
                      Não — dado pessoal (LGPD)
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Baixar resumo (.xlsx)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
