import { useRef, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useImportHeldOrdersMutation } from "./useManagerHeldOrdersQuery";
import { parseHeldOrdersCsv } from "./parseHeldOrdersCsv";
import type { HeldOrderImportRow } from "./types";

type ParsedFile = {
  name: string;
  rows: HeldOrderImportRow[];
  error?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImportHeldOrdersDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const importMutation = useImportHeldOrdersMutation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ParsedFile[]>([]);

  const totalRows = files.reduce((acc, f) => acc + f.rows.length, 0);

  const reset = () => {
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const parsed: ParsedFile[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const buffer = await file.arrayBuffer();
        const rows = parseHeldOrdersCsv(buffer, file.name);
        parsed.push({ name: file.name, rows });
      } catch (e) {
        parsed.push({ name: file.name, rows: [], error: e instanceof Error ? e.message : "Falha ao ler" });
      }
    }
    // Acumula com os já selecionados, evitando duplicar o mesmo arquivo pelo nome.
    setFiles((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      for (const f of parsed) byName.set(f.name, f);
      return Array.from(byName.values());
    });
  };

  const handleImport = async () => {
    const rows = files.flatMap((f) => f.rows);
    if (rows.length === 0) {
      toast({ title: "Nada para importar", description: "Selecione um arquivo CSV ou Excel válido.", variant: "destructive" });
      return;
    }
    try {
      const result = await importMutation.mutateAsync(rows);
      toast({
        title: "Importação concluída",
        description: `${result.inserted} pedido(s) importado(s).${result.skipped ? ` ${result.skipped} linha(s) vazia(s) ignorada(s).` : ""}`,
      });
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
            <FileUp className="h-5 w-5 text-primary" /> Importar pedidos em espera
          </DialogTitle>
          <DialogDescription>
            Selecione um ou mais arquivos <code>On_Holds_Details</code> ou de devoluções (CSV ou Excel <code>.xlsx</code>/<code>.xls</code>).
            Todas as linhas são importadas, repetidas ou não — apenas linhas em branco são ignoradas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet"
            multiple
            className="hidden"
            onChange={(e) => handleSelect(e.target.files)}
          />
          <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Escolher arquivos (CSV ou Excel)
          </Button>

          {files.length > 0 && (
            <div className="rounded-md border divide-y">
              {files.map((f) => (
                <div key={f.name} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">{f.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.error ? (
                      <span className="text-destructive text-xs">{f.error}</span>
                    ) : (
                      <span className="text-muted-foreground tabular-nums text-xs">{f.rows.length} pedidos</span>
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setFiles((prev) => prev.filter((p) => p.name !== f.name))}
                      aria-label="Remover arquivo"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalRows > 0 && (
            <p className="text-sm text-muted-foreground">
              Total a importar: <span className="font-medium text-foreground tabular-nums">{totalRows}</span> pedidos.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={totalRows === 0 || importMutation.isPending}>
            {importMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importando...
              </>
            ) : (
              <>Importar {totalRows > 0 ? `(${totalRows})` : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
