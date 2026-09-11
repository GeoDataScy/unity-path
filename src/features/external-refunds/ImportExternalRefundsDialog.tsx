import { useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Upload, X } from "lucide-react";

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
import { REFUND_PRODUCTS } from "@/features/refunds/types";

import { countOutsideMonth, parseExternalRefundsCsv, type ParsedExternalRefunds } from "./parseExternalRefundsCsv";
import {
  DEFAULT_PLATFORM,
  EXTERNAL_PLATFORMS,
  fmtMonth,
  type ExternalPlatform,
  type ImportExternalRefundsResult,
} from "./types";
import { useImportExternalRefundsMutation } from "./useExternalRefundComparisonQuery";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ParsedFile = ParsedExternalRefunds & { name: string; error?: string };

/** Últimos 12 meses como 'YYYY-MM-01', do mais recente para o mais antigo. */
function recentMonths(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

function describeImport(r: ImportExternalRefundsResult): string {
  const parts = [`${r.inserted} linha(s) nova(s)`, `${r.orders} pedido(s) no arquivo`];
  if (r.updated > 0) parts.push(`${r.updated} atualizada(s)`);
  if (r.skipped > 0) parts.push(`${r.skipped} ignorada(s)`);
  const sample = (r.skipped_samples ?? []).map((s) => s.order_name ?? "?").slice(0, 5).join(", ");
  return `${parts.join(" · ")}.${sample ? ` Ignoradas: ${sample}` : ""}`;
}

/**
 * Importa o arquivo de reembolsos externos de UM produto para UM mês. O arquivo
 * não diz qual produto é nem qual mês cobre, então a gestora informa os dois;
 * a pré-visualização mostra quantas linhas caem fora do mês para pegar engano.
 */
export function ImportExternalRefundsDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const importMutation = useImportExternalRefundsMutation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const months = useMemo(recentMonths, []);
  const [platform, setPlatform] = useState<ExternalPlatform>(DEFAULT_PLATFORM);
  const [product, setProduct] = useState<string>("");
  const [monthRef, setMonthRef] = useState<string>(months[1] ?? months[0]);
  const [file, setFile] = useState<ParsedFile | null>(null);

  const outsideMonth = file && monthRef ? countOutsideMonth(file.rows, monthRef) : 0;
  const canImport = Boolean(product) && Boolean(monthRef) && Boolean(file?.rows.length) && !importMutation.isPending;

  const reset = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleSelect = async (fileList: FileList | null) => {
    const f = fileList?.[0];
    if (!f) return;
    try {
      const parsed = parseExternalRefundsCsv(await f.arrayBuffer());
      setFile({
        name: f.name,
        ...parsed,
        error: parsed.recognized ? undefined : "Cabeçalho não reconhecido (esperado: arquivo orders_export de reembolsos externos).",
      });
    } catch (e) {
      setFile({ name: f.name, rows: [], orders: 0, invalidDates: 0, recognized: false, error: e instanceof Error ? e.message : "Falha ao ler" });
    }
  };

  const handleImport = async () => {
    if (!file || file.rows.length === 0 || !product || !monthRef) return;
    try {
      const result = await importMutation.mutateAsync({
        platform,
        product,
        monthRef,
        sourceFile: file.name,
        rows: file.rows,
      });
      toast({
        title: result.inserted === 0 && result.updated === 0 ? "Nada importado" : "Importação concluída",
        description: describeImport(result),
      });
      if (result.inserted === 0 && result.updated === 0) return;
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Erro ao importar",
        description: e instanceof Error ? e.message : "Não foi possível importar.",
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
            <FileUp className="h-5 w-5 text-primary" /> Importar reembolso externo
          </DialogTitle>
          <DialogDescription>
            Um arquivo de reembolsos externos por plataforma, produto e mês. Pedido já importado é atualizado, não
            duplicado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plataforma</div>
              <Select value={platform} onValueChange={(v) => setPlatform(v as ExternalPlatform)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Plataforma" />
                </SelectTrigger>
                <SelectContent>
                  {EXTERNAL_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Produto</div>
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha o produto" />
                </SelectTrigger>
                <SelectContent>
                  {REFUND_PRODUCTS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mês do arquivo</div>
              <Select value={monthRef} onValueChange={setMonthRef}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {fmtMonth(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => handleSelect(e.target.files)}
          />
          <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Escolher arquivo (CSV ou Excel)
          </Button>

          {file && (
            <div className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={reset}
                  aria-label="Remover arquivo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {file.error ? (
                <p className="mt-1 text-xs text-destructive">{file.error}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {file.rows.length} linha(s) · {file.orders} pedido(s)
                  {file.invalidDates > 0 && <> · {file.invalidDates} com data ilegível (serão ignoradas)</>}
                  {outsideMonth > 0 && (
                    <span className="text-amber-700 dark:text-amber-400"> · {outsideMonth} fora de {fmtMonth(monthRef)}</span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={!canImport}>
            {importMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importando...
              </>
            ) : (
              <>Importar {file?.rows.length ? `(${file.rows.length})` : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
