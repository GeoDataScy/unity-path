import { BarChart3, Table2 } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HeldOrdersManagerTab } from "@/features/held-orders/HeldOrdersManagerTab";
import { ProdutosHeldOrdersAnalytics } from "@/features/held-orders/ProdutosHeldOrdersAnalytics";

// Pedidos em Espera na Área de Produtos, em duas leituras:
//
//   Visão geral — como a fila se comporta: fluxo diário, backlog acumulado,
//     envelhecimento, Pareto de motivos, concentração por loja e saúde do sync do
//     Wall-E. Tudo agregado na RPC produtos_held_orders_analytics.
//
//   Pedidos — exatamente a mesma lista que a gestora vê em Data Analytics (mesma
//     RPC, mesmos números, mesmos filtros), sem as ações da operação: importar
//     planilha e distribuir continuam sendo dela. Ver HeldOrdersManagerTab e a
//     guarda de manager_list_held_orders (is_manager() OR is_produtos_team()).
//
// A tabela também é a "visão em tabela" dos gráficos: todo número da Visão geral
// pode ser conferido linha a linha aqui, e exportado em planilha.
export default function ProdutosPedidosEspera() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Pedidos em espera</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Os mesmos pedidos que a gestora acompanha, com todos os status e agentes. Somente leitura.
        </p>
      </header>

      <Tabs defaultValue="visao" className="space-y-6">
        <TabsList>
          <TabsTrigger value="visao" className="gap-1.5">
            <BarChart3 className="h-4 w-4" aria-hidden /> Visão geral
          </TabsTrigger>
          <TabsTrigger value="pedidos" className="gap-1.5">
            <Table2 className="h-4 w-4" aria-hidden /> Pedidos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="space-y-6">
          <ProdutosHeldOrdersAnalytics />
        </TabsContent>

        <TabsContent value="pedidos" className="space-y-6">
          <HeldOrdersManagerTab readOnly />
        </TabsContent>
      </Tabs>
    </div>
  );
}
