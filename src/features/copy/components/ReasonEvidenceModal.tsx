import { useMemo } from "react";
import { Info, MessageSquareQuote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShareBar } from "@/features/copy/components/ShareBar";
import { fmtInt, fmtISODate, fmtPct } from "@/features/copy/format";
import { useCopyReasonEvidenceQuery } from "@/features/copy/useCopyReasonEvidenceQuery";
import { supabaseErrorMessage } from "@/lib/supabaseError";

type Props = {
  category: string | null;
  onClose: () => void;
  from: string;
  to: string;
  product: string;
  platform: string;
  channel: string;
};

export function ReasonEvidenceModal({ category, onClose, from, to, product, platform, channel }: Props) {
  const query = useCopyReasonEvidenceQuery({ from, to, category, product, platform, channel });
  const data = query.data;

  const maxProduto = useMemo(
    () => Math.max(1, ...(data?.por_produto ?? []).map((r) => r.n)),
    [data?.por_produto],
  );
  const maxCanal = useMemo(() => Math.max(1, ...(data?.por_canal ?? []).map((r) => r.n)), [data?.por_canal]);
  const maxTermo = useMemo(() => Math.max(1, ...(data?.termos ?? []).map((r) => r.n)), [data?.termos]);

  return (
    <Dialog open={Boolean(category)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4 text-primary" />
            {category ?? ""}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Reembolsos concluídos entre {fmtISODate(from)} e {fmtISODate(to)} classificados neste motivo. Sem
          e-mail, número de pedido ou nome de agente: a tela do copy é agregada de propósito.
        </p>

        {query.isLoading ? (
          <div className="space-y-3 pt-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <p className="py-8 text-center text-sm text-destructive">
            {supabaseErrorMessage(query.error, "Não foi possível carregar o detalhe do motivo.")}
          </p>
        ) : !data ? null : (
          <div className="space-y-6 pt-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Reembolsos no motivo</p>
                <p className="text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]">{fmtInt(data.total)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Com algum texto no motivo</p>
                <p className="text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]">{fmtInt(data.com_texto)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Texto escrito à mão</p>
                <p className="text-2xl font-normal font-mono tabular-nums tracking-[-0.03em]">{fmtInt(data.texto_livre)}</p>
              </div>
            </div>

            {data.texto_livre === 0 && (
              <div className="flex gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Neste período o motivo foi registrado 100% por menu suspenso — o campo guarda o próprio
                  rótulo, sem frase do cliente. Texto escrito à mão existe em reembolsos concluídos até
                  maio/2026; para ler a linguagem do cliente, selecione um período que alcance esses meses.
                </p>
              </div>
            )}

            {data.textos.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Texto registrado no motivo</h3>
                <div className="overflow-x-auto rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Texto</TableHead>
                        <TableHead className="w-24 text-right">Reembolsos</TableHead>
                        <TableHead className="w-20 text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.textos.map((row) => (
                        <TableRow key={row.texto}>
                          <TableCell className="max-w-[520px] align-top text-sm">
                            <span className="whitespace-pre-wrap break-words">{row.texto}</span>
                            {row.padrao && (
                              <Badge variant="secondary" className="ml-2 align-middle text-[10px]">
                                rótulo padrão
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{fmtInt(row.n)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{fmtPct(row.share)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            {data.termos.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Palavras mais frequentes no texto escrito à mão</h3>
                <div className="flex flex-wrap gap-2">
                  {data.termos.map((row) => (
                    <span
                      key={row.termo}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
                      title={`${row.n} ocorrência(s)`}
                    >
                      {row.termo}
                      <span className="font-mono tabular-nums text-muted-foreground">{fmtInt(row.n)}</span>
                      <ShareBar value={row.n} max={maxTermo} className="w-10" />
                    </span>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Produtos com mais casos deste motivo</h3>
                <p className="text-xs text-muted-foreground">
                  O percentual é a fatia deste motivo dentro do produto: de todos os reembolsos que o
                  produto teve no período, quantos foram por este motivo.
                </p>
                <ul className="space-y-2">
                  {data.por_produto.map((row) => (
                    <li key={row.produto} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 truncate" title={row.produto}>
                        {row.produto}
                      </span>
                      <ShareBar value={row.n} max={maxProduto} />
                      <span className="w-12 shrink-0 text-right font-mono tabular-nums">{fmtInt(row.n)}</span>
                      <span
                        className="w-14 shrink-0 text-right font-mono tabular-nums text-muted-foreground"
                        title={
                          row.total_produto
                            ? `${fmtInt(row.n)} de ${fmtInt(row.total_produto)} reembolsos do ${row.produto} no período`
                            : undefined
                        }
                      >
                        {fmtPct(row.share_no_produto)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Canal de atendimento</h3>
                <ul className="space-y-2">
                  {data.por_canal.map((row) => (
                    <li key={row.canal} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 truncate" title={row.canal}>
                        {row.canal}
                      </span>
                      <ShareBar value={row.n} max={maxCanal} />
                      <span className="w-12 shrink-0 text-right font-mono tabular-nums">{fmtInt(row.n)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
