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

import {
  countOutsideMonth,
  parseBuygoodsRefunds,
  parseExternalRefundsCsv,
  parsePagAmericanRefunds,
  type ExternalRefundBatch,
  type ParsedBuygoodsRefunds,
  type ParsedExternalRefunds,
  type ParsedPagAmericanRefunds,
} from "./parseExternalRefundsCsv";
import {
  DEFAULT_PLATFORM,
  EXTERNAL_PLATFORMS,
  fmtMonth,
  type ExternalPlatform,
} from "./types";
import { useImportExternalRefundsMutation } from "./useExternalRefundComparisonQuery";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Plataformas cujo arquivo já traz produto e data do reembolso, e por isso são
 * importadas em lote, sem a gestora escolher produto nem mês.
 */
const AUTO_SPLIT: ExternalPlatform[] = ["PagAmerican"];

/**
 * Plataformas em que a gestora escolhe o produto (um arquivo por produto), mas
 * o mês sai da data do reembolso de cada linha: um arquivo vira um lote por mês.
 */
const MONTH_SPLIT: ExternalPlatform[] = ["Buygoods"];

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

function describeImport(r: {
  inserted: number;
  updated: number;
  skipped: number;
  orders: number;
  lotes: number;
  chargebacks: number;
  samples: string[];
}): string {
  // "linha", não "pedido": na Cartpanda o arquivo repete o pedido por item e o
  // RPC grava uma linha por item. Na PagAmerican é uma linha por pedido.
  const parts = [`${r.inserted} linha(s) nova(s)`, `${r.orders} pedido(s) no arquivo`];
  if (r.updated > 0) parts.push(`${r.updated} atualizada(s)`);
  if (r.skipped > 0) parts.push(`${r.skipped} ignorada(s)`);
  if (r.lotes > 1) parts.push(`${r.lotes} lotes (produto × mês)`);
  if (r.chargebacks > 0) parts.push(`${r.chargebacks} chargeback(s) fora da conta`);
  const sample = r.samples.slice(0, 5).join(", ");
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
  const [picked, setPicked] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const autoSplit = AUTO_SPLIT.includes(platform);
  const monthSplit = MONTH_SPLIT.includes(platform);
  const manual = !autoSplit && !monthSplit;

  // O arquivo é lido de novo quando a plataforma muda: trocar de plataforma troca
  // o formato esperado, sem a gestora ter que escolher o arquivo outra vez.
  const cartpanda: ParsedExternalRefunds | null = useMemo(
    () => (picked && manual ? parseExternalRefundsCsv(picked.bytes) : null),
    [picked, manual],
  );
  const pagamerican: ParsedPagAmericanRefunds | null = useMemo(
    () => (picked && autoSplit ? parsePagAmericanRefunds(picked.bytes) : null),
    [picked, autoSplit],
  );
  const buygoods: ParsedBuygoodsRefunds | null = useMemo(
    () => (picked && monthSplit ? parseBuygoodsRefunds(picked.bytes, product) : null),
    [picked, monthSplit, product],
  );

  const recognized = autoSplit ? pagamerican?.recognized : monthSplit ? buygoods?.recognized : cartpanda?.recognized;
  const parseError = !picked
    ? null
    : readError ??
      (recognized
        ? null
        : autoSplit
          ? "Cabeçalho não reconhecido. Esperado o export da PagAmerican (Order ID, Order Status, first refund date)."
          : monthSplit
            ? "Cabeçalho não reconhecido. Esperado o relatório de reembolsos da Buygoods (Order ID, Refund Date, Product Codename)."
            : "Cabeçalho não reconhecido. Esperado o orders_export da loja (order_name, Payment status).");

  const batches: ExternalRefundBatch[] = (autoSplit ? pagamerican?.batches : buygoods?.batches) ?? [];
  const totalRows = autoSplit
    ? (pagamerican?.refunds ?? 0)
    : monthSplit
      ? (buygoods?.refunds ?? 0)
      : (cartpanda?.rows.length ?? 0);
  const outsideMonth = manual && cartpanda && monthRef ? countOutsideMonth(cartpanda.rows, monthRef) : 0;

  const canImport =
    !parseError &&
    totalRows > 0 &&
    !importMutation.isPending &&
    (autoSplit
      ? batches.length > 0
      : monthSplit
        ? Boolean(product) && batches.length > 0
        : Boolean(product) && Boolean(monthRef));

  const reset = () => {
    setPicked(null);
    setReadError(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleSelect = async (fileList: FileList | null) => {
    const f = fileList?.[0];
    if (!f) return;
    setReadError(null);
    try {
      setPicked({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    } catch (e) {
      setPicked({ name: f.name, bytes: new Uint8Array() });
      setReadError(e instanceof Error ? e.message : "Falha ao ler");
    }
  };

  const handleImport = async () => {
    if (!canImport || !picked) return;
    try {
      // O RPC recebe um produto e um mês por chamada. Na Cartpanda a gestora
      // informa os dois; na PagAmerican eles saem do próprio arquivo e na Buygoods
      // o mês sai do arquivo, então é uma chamada por lote. O upsert torna a repetição segura se algo falhar
      // no meio: reimportar o arquivo inteiro atualiza, não duplica.
      const lotes = !manual
        ? batches.map((b) => ({ product: b.product, monthRef: b.monthRef, rows: b.rows }))
        : [{ product, monthRef, rows: cartpanda!.rows }];

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let orders = 0;
      const samples: string[] = [];
      setProgress({ done: 0, total: lotes.length });
      for (const [i, lote] of lotes.entries()) {
        const r = await importMutation.mutateAsync({
          platform,
          product: lote.product,
          monthRef: lote.monthRef,
          sourceFile: picked.name,
          rows: lote.rows,
        });
        inserted += r.inserted;
        updated += r.updated;
        skipped += r.skipped;
        orders += r.orders;
        for (const sm of r.skipped_samples ?? []) if (sm.order_name) samples.push(sm.order_name);
        setProgress({ done: i + 1, total: lotes.length });
      }

      const nada = inserted === 0 && updated === 0;
      toast({
        title: nada ? "Nada importado" : "Importação concluída",
        description: describeImport({
          inserted,
          updated,
          skipped,
          orders,
          lotes: lotes.length,
          chargebacks: pagamerican?.chargebacks ?? 0,
          samples,
        }),
      });
      setProgress(null);
      if (nada) return;
      reset();
      onOpenChange(false);
    } catch (e) {
      setProgress(null);
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
            {autoSplit
              ? "O arquivo da PagAmerican já traz o produto e a data do reembolso, então produto e mês saem dele. Pedido já importado é atualizado, não duplicado."
              : monthSplit
                ? "Um arquivo da Buygoods por produto. O mês sai da data do reembolso de cada pedido. Pedido já importado é atualizado, não duplicado."
                : "Um arquivo de reembolsos externos por plataforma, produto e mês. Pedido já importado é atualizado, não duplicado."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className={autoSplit ? "grid gap-3" : monthSplit ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-3"}>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Plataforma</div>
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
            {!autoSplit && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Produto</div>
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
            )}
            {manual && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Mês do arquivo</div>
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
            )}
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

          {picked && (
            <div className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{picked.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={reset}
                  aria-label="Remover arquivo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {parseError ? (
                <p className="mt-1 text-xs text-destructive">{parseError}</p>
              ) : autoSplit ? (
                <>
                  <p className="mt-1 text-xs text-muted-foreground font-mono tabular-nums">
                    {pagamerican!.refunds} reembolso(s) em {batches.length} lote(s)
                    {pagamerican!.chargebacks > 0 && <> · {pagamerican!.chargebacks} chargeback(s) fora da conta</>}
                    {pagamerican!.unspecified > 0 && <> · {pagamerican!.unspecified} sem tipo no arquivo</>}
                  </p>
                  {pagamerican!.unknownProducts.length > 0 && (
                    <p className="mt-1 text-xs text-warning">
                      Fora do catálogo: {pagamerican!.unknownProducts.join(", ")}. Vão entrar com esse nome e não vão
                      casar com o interno.
                    </p>
                  )}
                  <BatchTable batches={batches} />
                </>
              ) : monthSplit ? (
                <>
                  <p className="mt-1 text-xs text-muted-foreground font-mono tabular-nums">
                    {buygoods!.refunds} pedido(s) reembolsado(s) em {batches.length} mês(es) · {buygoods!.lines} estorno(s)
                    no arquivo
                    {buygoods!.invalid > 0 && <> · {buygoods!.invalid} linha(s) ilegível(is) (serão ignoradas)</>}
                  </p>
                  {product ? (
                    <BatchTable batches={batches} />
                  ) : (
                    <p className="mt-1 text-xs text-warning">Escolha o produto do arquivo.</p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground font-mono tabular-nums">
                  {cartpanda!.rows.length} linha(s) · {cartpanda!.orders} pedido(s)
                  {cartpanda!.invalidDates > 0 && <> · {cartpanda!.invalidDates} com data ilegível (serão ignoradas)</>}
                  {outsideMonth > 0 && (
                    <span className="text-warning"> · {outsideMonth} fora de {fmtMonth(monthRef)}</span>
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {progress && progress.total > 1 ? `Importando ${progress.done}/${progress.total}...` : "Importando..."}
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

/** Prévia dos lotes (produto × mês) que viram uma chamada do RPC cada. */
function BatchTable({ batches }: { batches: ExternalRefundBatch[] }) {
  return (
    <div className="mt-2 max-h-40 overflow-y-auto rounded border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Produto</th>
            <th className="px-2 py-1 text-left font-medium">Mês</th>
            <th className="px-2 py-1 text-right font-medium">Pedidos</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={`${b.product}-${b.monthRef}`} className="border-t">
              <td className="px-2 py-1">
                {b.product}
                {b.sourceProduct !== b.product && (
                  <span className="text-muted-foreground"> (arquivo: {b.sourceProduct})</span>
                )}
              </td>
              <td className="px-2 py-1">{fmtMonth(b.monthRef)}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{b.rows.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
