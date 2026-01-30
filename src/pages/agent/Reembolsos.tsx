import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Plus } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import type { AgentOutletContext } from "@/layouts/AgentLayout";
import { useMyRefundsQuery } from "@/features/refunds/useMyRefundsQuery";
import type { RefundItem } from "@/features/refunds/types";
import { NewRefundDialog, type NewRefundValues } from "@/features/refunds/NewRefundDialog";
import { CompleteRefundDialog, type CompleteRefundValues } from "@/features/refunds/CompleteRefundDialog";

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

export default function Reembolsos() {
  const { userId } = useOutletContext<AgentOutletContext>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newOpen, setNewOpen] = useState(false);
  const [completing, setCompleting] = useState<RefundItem | null>(null);

  const { data: refunds = [], isLoading } = useMyRefundsQuery(Boolean(userId));

  const openRefunds = useMemo(() => refunds.filter((r) => !r.completion_date), [refunds]);
  const doneRefunds = useMemo(() => refunds.filter((r) => Boolean(r.completion_date)), [refunds]);

  const createMutation = useMutation({
    mutationFn: async (values: NewRefundValues) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const { error } = await supabase.from("refunds").insert({
        user_id: session.user.id,
        customer_email: values.customer_email,
        request_date: values.request_date,
        // Sempre cria como “Em aberto” no cadastro inicial
        completion_date: null,
        reason: null,
        refund_type: null,
        items_returned: false,
        sales_platform: values.sales_platform,
        order_id: values.order_id,
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
    onError: (error: any) => {
      toast({
        title: "Erro ao registrar",
        description: error?.message ?? "Não foi possível salvar o reembolso.",
        variant: "destructive",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (payload: { id: string; values: CompleteRefundValues }) => {
      const { error } = await supabase
        .from("refunds")
        .update({
          completion_date: payload.values.completion_date,
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
    onError: (error: any) => {
      toast({
        title: "Erro ao concluir",
        description: error?.message ?? "Não foi possível atualizar o reembolso.",
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
            <TabsList>
              <TabsTrigger value="open">Em Aberto</TabsTrigger>
              <TabsTrigger value="done">Histórico/Concluídos</TabsTrigger>
            </TabsList>

            <TabsContent value="open">
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Solicitação</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[170px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openRefunds.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          Nenhum reembolso em aberto.
                        </TableCell>
                      </TableRow>
                    ) : (
                      openRefunds.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            {(() => {
                              const dt = parseDateForDisplay(r.request_date);
                              return dt ? format(dt, "dd/MM/yyyy") : "—";
                            })()}
                          </TableCell>
                          <TableCell className="font-medium">{r.customer_email}</TableCell>
                          <TableCell>{r.sales_platform}</TableCell>
                          <TableCell>{r.order_id}</TableCell>
                          <TableCell>
                            <Badge variant="open">Em Aberto</Badge>
                          </TableCell>
                          <TableCell className="text-right">
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
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="done">
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Solicitação</TableHead>
                      <TableHead>Conclusão</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Itens</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {doneRefunds.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground">
                          Nenhum reembolso concluído ainda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      doneRefunds.map((r) => (
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
                          <TableCell>{r.order_id}</TableCell>
                          <TableCell>{r.refund_type}</TableCell>
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
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
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
    </main>
  );
}
