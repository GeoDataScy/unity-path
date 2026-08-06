import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Hand, Headset, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useToast } from "@/hooks/use-toast";
import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { useMyRefundsQuery } from "@/features/refunds/useMyRefundsQuery";
import type { RefundItem } from "@/features/refunds/types";
import { NewRefundDialog, type NewRefundValues } from "@/features/refunds/NewRefundDialog";
import { CompleteRefundDialog, type CompleteRefundValues } from "@/features/refunds/CompleteRefundDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function parseDateForDisplay(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map((n) => Number(n));
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatUsdPtBr(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (
    "$ " +
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  );
}

export default function Reembolsos() {
  const { userId } = useOutletContext<AgentOutletContext>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newOpen, setNewOpen] = useState(false);
  const [completing, setCompleting] = useState<RefundItem | null>(null);
  const [editing, setEditing] = useState<RefundItem | null>(null);

  const [emailSearch, setEmailSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: refunds = [], isLoading } = useMyRefundsQuery(Boolean(userId));

  const openRefunds = useMemo(() => refunds.filter((r) => !r.completion_date), [refunds]);
  const doneRefunds = useMemo(() => refunds.filter((r) => Boolean(r.completion_date)), [refunds]);

  const filteredOpenRefunds = useMemo(() => {
    let result = openRefunds;
    if (emailSearch) {
      const term = emailSearch.toLowerCase();
      result = result.filter((r) => r.customer_email.toLowerCase().includes(term));
    }
    if (dateFrom) result = result.filter((r) => r.request_date >= dateFrom);
    if (dateTo) result = result.filter((r) => r.request_date <= dateTo);
    return result;
  }, [openRefunds, emailSearch, dateFrom, dateTo]);

  const filteredDoneRefunds = useMemo(() => {
    let result = doneRefunds;
    if (emailSearch) {
      const term = emailSearch.toLowerCase();
      result = result.filter((r) => r.customer_email.toLowerCase().includes(term));
    }
    if (dateFrom) result = result.filter((r) => r.completion_date != null && r.completion_date >= dateFrom);
    if (dateTo) result = result.filter((r) => r.completion_date != null && r.completion_date <= dateTo);
    return result;
  }, [doneRefunds, emailSearch, dateFrom, dateTo]);

  const doneTotalValue = useMemo(
    () => filteredDoneRefunds.reduce((sum, r) => sum + (r.refunded_value ?? r.refund_value ?? 0), 0),
    [filteredDoneRefunds],
  );

  const hasFilters = Boolean(emailSearch || dateFrom || dateTo);

  // Pagination — same client-side paging applied to both tabs (15 rows/page),
  // reset on filter change, defensive clamp if the active page exceeds the
  // total after filtering.
  const PAGE_SIZE = 15;

  const [openPage, setOpenPage] = useState(1);
  const openTotalPages = Math.max(1, Math.ceil(filteredOpenRefunds.length / PAGE_SIZE));

  const [donePage, setDonePage] = useState(1);
  const doneTotalPages = Math.max(1, Math.ceil(filteredDoneRefunds.length / PAGE_SIZE));

  useEffect(() => {
    setOpenPage(1);
    setDonePage(1);
  }, [emailSearch, dateFrom, dateTo]);

  useEffect(() => {
    if (openPage > openTotalPages) setOpenPage(openTotalPages);
  }, [openPage, openTotalPages]);

  useEffect(() => {
    if (donePage > doneTotalPages) setDonePage(doneTotalPages);
  }, [donePage, doneTotalPages]);

  const paginatedOpenRefunds = useMemo(() => {
    const start = (openPage - 1) * PAGE_SIZE;
    return filteredOpenRefunds.slice(start, start + PAGE_SIZE);
  }, [filteredOpenRefunds, openPage]);

  const paginatedDoneRefunds = useMemo(() => {
    const start = (donePage - 1) * PAGE_SIZE;
    return filteredDoneRefunds.slice(start, start + PAGE_SIZE);
  }, [filteredDoneRefunds, donePage]);

  const createMutation = useMutation({
    mutationFn: async (values: NewRefundValues) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const { error } = await supabase.rpc("create_refund", {
        p_customer_email: values.customer_email,
        p_request_date: values.request_date,
        p_sales_platform: values.sales_platform === "Nenhum" ? null : values.sales_platform,
        p_order_id: values.order_id,
        p_product: values.product,
        p_channel: values.channel === "Nenhum" ? null : values.channel,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      toast({
        title: "Reembolso registrado",
        description: "Seu registro foi salvo com sucesso.",
      });
    },
    onError: (error: unknown) => {
      console.error("[create-refund] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível salvar o reembolso.";
      toast({
        title: "Erro ao registrar",
        description: message,
        variant: "destructive",
      });
    },
  });

  // Reembolso criado pelo atendimento entra apagado; assumir acende a linha e
  // registra quem pegou.
  const pickUpMutation = useMutation({
    mutationFn: async (id: string) => {
      // pick_up_refund ainda não está nos tipos gerados do Supabase (types.ts é gerado).
      const rpc = supabase.rpc.bind(supabase) as (
        fn: string,
        args?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { error } = await rpc("pick_up_refund", { p_refund_id: id });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      toast({
        title: "Reembolso assumido",
        description: "Agora é com você — confira os dados e conclua quando resolver.",
      });
    },
    onError: (error: unknown) => {
      console.error("[pick-up-refund] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível assumir o reembolso.";
      toast({ title: "Erro ao assumir", description: message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (payload: { id: string; values: CompleteRefundValues }) => {
      const refundValue = Number(payload.values.refund_value);
      if (!Number.isFinite(refundValue)) throw new Error("Valor do reembolso inválido");

      const { error } = await supabase
        .from("refunds")
        .update({
          completion_date: payload.values.completion_date,
          refund_value: refundValue,
          refund_type: payload.values.refund_type,
          reason: payload.values.reason,
          items_returned: payload.values.items_returned,
        })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      toast({
        title: "Reembolso concluído",
        description: "O registro foi atualizado.",
      });
    },
    onError: (error: unknown) => {
      console.error("[complete-refund] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível atualizar o reembolso.";
      toast({
        title: "Erro ao concluir",
        description: message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("refunds").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      toast({ title: "Reembolso excluído", description: "O registro foi removido." });
    },
    onError: (error: unknown) => {
      console.error("[delete-refund] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível excluir o reembolso.";
      toast({
        title: "Erro ao excluir",
        description: message,
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (payload: { id: string; values: CompleteRefundValues }) => {
      const refundValue = Number(payload.values.refund_value);
      if (!Number.isFinite(refundValue)) throw new Error("Valor inválido");

      const { error } = await supabase
        .from("refunds")
        .update({
          completion_date: payload.values.completion_date,
          refund_value: refundValue,
          refund_type: payload.values.refund_type,
          reason: payload.values.reason,
          items_returned: payload.values.items_returned,
        })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["refunds", "me"] });
      toast({ title: "Reembolso atualizado", description: "As alterações foram salvas." });
    },
    onError: (error: unknown) => {
      console.error("[edit-refund] failed:", error);
      const message = error instanceof Error ? error.message : "Não foi possível atualizar o reembolso.";
      toast({
        title: "Erro ao atualizar",
        description: message,
        variant: "destructive",
      });
    },
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Meus Reembolsos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe seus pedidos em aberto e o histórico de reembolsos concluídos.
          </p>
        </div>

        <Button onClick={() => setNewOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Reembolso
        </Button>
      </header>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Visão geral</CardTitle>
          {isLoading && <span className="text-sm text-muted-foreground">Carregando...</span>}
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="open" className="w-full">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList className="self-start">
                <TabsTrigger value="open">Em Aberto</TabsTrigger>
                <TabsTrigger value="done">Histórico/Concluídos</TabsTrigger>
              </TabsList>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Buscar por e-mail..."
                    value={emailSearch}
                    onChange={(e) => setEmailSearch(e.target.value)}
                    className="h-9 w-56 pl-8 text-sm"
                  />
                </div>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 w-36 text-sm"
                  title="Data inicial (solicitação)"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 w-36 text-sm"
                  title="Data final (solicitação)"
                />
                {hasFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1.5 text-xs"
                    onClick={() => { setEmailSearch(""); setDateFrom(""); setDateTo(""); }}
                  >
                    <X className="h-3 w-3" />
                    Limpar
                  </Button>
                )}
              </div>
            </div>

            <TabsContent value="open">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {filteredOpenRefunds.length} registro{filteredOpenRefunds.length !== 1 ? "s" : ""}
                  {hasFilters && openRefunds.length !== filteredOpenRefunds.length && (
                    <span className="ml-1 text-xs opacity-60">(de {openRefunds.length})</span>
                  )}
                </span>
              </div>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Solicitação</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[170px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOpenRefunds.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          {hasFilters ? "Nenhum reembolso encontrado com os filtros aplicados." : "Nenhum reembolso em aberto."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedOpenRefunds.map((r) => {
                        // Veio do atendimento e ninguém pegou ainda: linha apagada,
                        // sem ação de concluir — primeiro o agente assume.
                        const waiting = Boolean(r.service_id) && !r.picked_up_at;
                        return (
                        <TableRow key={r.id} className={waiting ? "opacity-50 hover:opacity-100" : undefined}>
                          <TableCell>
                            {(() => {
                              const dt = parseDateForDisplay(r.request_date);
                              return dt ? format(dt, "dd/MM/yyyy") : "—";
                            })()}
                          </TableCell>
                          <TableCell className="font-medium">{r.customer_email}</TableCell>
                          <TableCell>{r.sales_platform}</TableCell>
                          <TableCell>{r.product ?? "—"}</TableCell>
                          <TableCell>{r.order_id || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="open">Em Aberto</Badge>
                              {r.service_id && (
                                <Badge variant="outline" className="gap-1 font-normal">
                                  <Headset className="h-3 w-3" />
                                  Do atendimento
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {waiting ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="transition-transform active:translate-y-px active:scale-[0.98]"
                                onClick={() => pickUpMutation.mutate(r.id)}
                                disabled={pickUpMutation.isPending}
                              >
                                <Hand className="mr-2 h-4 w-4" />
                                Assumir
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="default"
                                className="transition-transform active:translate-y-px active:scale-[0.98]"
                                onClick={() => setCompleting(r)}
                                disabled={completeMutation.isPending}
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Concluir Reembolso
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {filteredOpenRefunds.length > PAGE_SIZE && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Página {openPage} de {openTotalPages} • {filteredOpenRefunds.length} registros
                  </p>
                  <Pagination className="sm:justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setOpenPage((p) => Math.max(1, p - 1));
                          }}
                        />
                      </PaginationItem>

                      {Array.from({ length: openTotalPages }).slice(0, 7).map((_, idx) => {
                        const p = idx + 1;
                        return (
                          <PaginationItem key={p}>
                            <PaginationLink
                              href="#"
                              isActive={p === openPage}
                              onClick={(e) => {
                                e.preventDefault();
                                setOpenPage(p);
                              }}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      })}

                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setOpenPage((p) => Math.min(openTotalPages, p + 1));
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </TabsContent>

            <TabsContent value="done">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {filteredDoneRefunds.length} registro{filteredDoneRefunds.length !== 1 ? "s" : ""}
                  {hasFilters && doneRefunds.length !== filteredDoneRefunds.length && (
                    <span className="ml-1 text-xs opacity-60">(de {doneRefunds.length})</span>
                  )}
                </span>
                {filteredDoneRefunds.length > 0 && (
                  <span className="text-sm font-semibold">
                    Total reembolsado: {formatUsdPtBr(doneTotalValue)}
                  </span>
                )}
              </div>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Solicitação</TableHead>
                      <TableHead>Conclusão</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Valor reembolsado</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Itens</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[96px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDoneRefunds.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-muted-foreground">
                          {hasFilters ? "Nenhum reembolso encontrado com os filtros aplicados." : "Nenhum reembolso concluído ainda."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedDoneRefunds.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            {(() => {
                              const dt = parseDateForDisplay(r.request_date);
                              return dt ? format(dt, "dd/MM/yyyy") : "—";
                            })()}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const dt = parseDateForDisplay(r.completion_date);
                              return dt ? format(dt, "dd/MM/yyyy") : "—";
                            })()}
                          </TableCell>
                          <TableCell className="font-medium">{r.customer_email}</TableCell>
                          <TableCell>{r.sales_platform}</TableCell>
                          <TableCell>{r.product ?? "—"}</TableCell>
                          <TableCell>{r.order_id}</TableCell>
                          <TableCell>{r.refund_type}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatUsdPtBr(r.refunded_value ?? null)}
                          </TableCell>
                          <TableCell>
                            <span
                              className="block max-w-[360px] truncate"
                              title={r.reason ?? ""}
                            >
                              {r.reason ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>{r.items_returned ? "Sim" : "Não"}</TableCell>
                          <TableCell>
                            <Badge>Concluído</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditing(r)}
                                title="Editar"
                              >
                                <Pencil className="text-muted-foreground" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    disabled={deleteMutation.isPending}
                                    title="Excluir"
                                  >
                                    <Trash2 className="text-muted-foreground" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir reembolso?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Esta ação não pode ser desfeita. O registro será removido permanentemente.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => void deleteMutation.mutateAsync(r.id)}>
                                      Excluir
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {filteredDoneRefunds.length > PAGE_SIZE && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Página {donePage} de {doneTotalPages} • {filteredDoneRefunds.length} registros
                  </p>
                  <Pagination className="sm:justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setDonePage((p) => Math.max(1, p - 1));
                          }}
                        />
                      </PaginationItem>

                      {Array.from({ length: doneTotalPages }).slice(0, 7).map((_, idx) => {
                        const p = idx + 1;
                        return (
                          <PaginationItem key={p}>
                            <PaginationLink
                              href="#"
                              isActive={p === donePage}
                              onClick={(e) => {
                                e.preventDefault();
                                setDonePage(p);
                              }}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      })}

                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setDonePage((p) => Math.min(doneTotalPages, p + 1));
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <NewRefundDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        submitting={createMutation.isPending}
        onSubmit={async (values) => {
          await createMutation.mutateAsync(values);
        }}
      />

      {completing && (
        <CompleteRefundDialog
          open={Boolean(completing)}
          refund={completing}
          submitting={completeMutation.isPending}
          onOpenChange={(open) => {
            if (!open) setCompleting(null);
          }}
          onSubmit={async (values) => {
            await completeMutation.mutateAsync({ id: completing.id, values });
          }}
        />
      )}

      {editing && (
        <CompleteRefundDialog
          open={Boolean(editing)}
          refund={editing}
          submitting={editMutation.isPending}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSubmit={async (values) => {
            await editMutation.mutateAsync({ id: editing.id, values });
          }}
        />
      )}
    </main>
  );
}
