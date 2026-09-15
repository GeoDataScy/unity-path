import { useOutletContext } from "react-router-dom";
import { Package } from "lucide-react";

import type { ProdutosOutletContext } from "@/layouts/ProdutosLayout";

// Casca da Área de Produtos: por ora a tela é intencionalmente vazia — a área
// existe para o time entrar por ela (ícone em /areas + troca de área na
// sidebar) enquanto as primeiras leituras de produto são definidas.
export default function ProdutosVisaoGeral() {
  const { fullName } = useOutletContext<ProdutosOutletContext>();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Produtos
          {fullName ? <span className="ml-2 text-base font-normal text-muted-foreground">Olá, {fullName}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Área do time de produtos. Ainda sem indicadores — em construção.
        </p>
      </header>

      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card p-8 text-center">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Package className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">Nada por aqui ainda</p>
        <p className="max-w-md text-sm text-muted-foreground">
          As primeiras telas do time de produtos entram nesta área.
        </p>
      </div>
    </div>
  );
}
