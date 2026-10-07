import { Copy, LogIn, LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { enderecoLinha, formatDateTime, formatDay, motivoLabel, paisLabel, parseItems } from "../format";
import { useLateHunterHistoryQuery } from "../useLateHunterQueries";
import type { LateHunterEvento, LateHunterOrder } from "../types";
import { DiasEmEspera, SituacaoBadge } from "./LateHunterTable";

const EVENTO: Record<LateHunterEvento["evento"], { label: string; icon: typeof LogIn }> = {
  criado: { label: "Entrou no on-hold", icon: LogIn },
  encerrado: { label: "Saiu do on-hold", icon: LogOut },
  reaberto: { label: "Voltou ao on-hold", icon: RotateCcw },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

async function copiar(texto: string, oque: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oque} copiado`);
  } catch {
    toast.error("Não foi possível copiar");
  }
}

type Props = {
  order: LateHunterOrder | null;
  onClose: () => void;
};

export function LateHunterOrderSheet({ order, onClose }: Props) {
  const history = useLateHunterHistoryQuery(order?.id ?? null);
  const itens = parseItems(order?.itens ?? null);
  const endereco = enderecoLinha(order?.endereco ?? null);

  return (
    <Sheet open={order != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {order && (
          <>
            <SheetHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <SheetTitle className="font-mono text-xl">{order.pedido}</SheetTitle>
                <SituacaoBadge o={order} />
              </div>
              <SheetDescription>
                Loja <span className="font-mono">{order.loja}</span>
                {order.loja_nome ? ` · ${order.loja_nome}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Motivo do on-hold</h3>
                <div className="flex flex-wrap gap-1.5">
                  {order.motivos.map((m) => (
                    <Badge key={m} variant="secondary" className="font-normal">
                      {motivoLabel(m)}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-ink-tertiary">Como veio da ShipOffers: {order.motivo}</p>
              </section>

              <dl className="grid grid-cols-2 gap-4">
                <Field label="Em espera">
                  <DiasEmEspera dias={order.dias_em_espera} />
                </Field>
                <Field label="Data do pedido">{formatDay(order.data_pedido)}</Field>
                <Field label="No Late Hunter desde">{formatDay(order.primeira_referencia)}</Field>
                <Field label="Última varredura com o pedido">{formatDateTime(order.ultimo_lote)}</Field>
              </dl>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Cliente</h3>
                <dl className="space-y-3">
                  <Field label="Nome">{order.cliente_nome || "—"}</Field>
                  <Field label="E-mail">
                    {order.cliente_email ? (
                      <span className="inline-flex items-center gap-1">
                        {order.cliente_email}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="Copiar e-mail"
                          onClick={() => copiar(order.cliente_email, "E-mail")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Não informado pela ShipOffers</span>
                    )}
                  </Field>
                  <Field label="Endereço">
                    {endereco ? (
                      <span className="inline-flex items-start gap-1">
                        <span>{endereco}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          aria-label="Copiar endereço"
                          onClick={() => copiar(endereco, "Endereço")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Field>
                  {order.pais && <Field label="País">{paisLabel(order.pais)}</Field>}
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Itens</h3>
                {itens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem itens informados.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {itens.map((i, idx) => (
                      <li key={`${i.sku}-${idx}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block font-medium">{i.product}</span>
                          <span className="block truncate font-mono text-xs text-ink-tertiary">{i.sku}</span>
                        </span>
                        <span className="font-mono tabular-nums">× {i.qty}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Linha do tempo</h3>
                {history.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : history.isError ? (
                  <p className="text-sm text-muted-foreground">Não foi possível carregar o histórico.</p>
                ) : (
                  <ol className="space-y-2">
                    {(history.data ?? []).map((e, idx) => {
                      const meta = EVENTO[e.evento];
                      const Icon = meta.icon;
                      return (
                        <li key={idx} className="flex items-center gap-2 text-sm">
                          <Icon className="h-4 w-4 text-ink-tertiary" aria-hidden />
                          <span>{meta.label}</span>
                          <span className="ml-auto font-mono text-xs tabular-nums text-ink-tertiary">
                            varredura de {formatDateTime(e.lote)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
