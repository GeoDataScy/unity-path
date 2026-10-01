import { HeldOrdersManagerTab } from "@/features/held-orders/HeldOrdersManagerTab";

// Pedidos em Espera na Área de Produtos: exatamente a mesma leitura que a
// gestora tem em Data Analytics (mesma RPC, mesmos números, mesmos filtros),
// só que sem as ações da operação — importar planilha e distribuir pedidos
// continuam sendo dela. Ver HeldOrdersManagerTab e a guarda da RPC
// manager_list_held_orders (is_manager() OR is_produtos_team()).
export default function ProdutosPedidosEspera() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Pedidos em espera</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Os mesmos pedidos que a gestora acompanha, com todos os status e agentes. Somente leitura.
        </p>
      </header>

      <HeldOrdersManagerTab readOnly />
    </div>
  );
}
