import { useSearchParams } from "react-router-dom";
import { HandCoins, Mail, MessageSquareText, Package, Smartphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EMAIL_TEMPLATES } from "../data/emailTemplates";
import {
  useSupportProductsQuery,
  useSupportSmsBrandsQuery,
  useSupportSmsRepliesQuery,
} from "../useSupportBaseQuery";
import { EmailTemplatesPanel } from "./EmailTemplatesPanel";
import { ProductsPanel } from "./ProductsPanel";
import { QuickLinksMenu } from "./QuickLinksMenu";
import { RefundPlaybookPanel } from "./RefundPlaybookPanel";
import { SmsBrandsPanel } from "./SmsBrandsPanel";
import { SmsRepliesPanel } from "./SmsRepliesPanel";

/**
 * Duas famílias de conteúdo: catálogo (o que existe e onde está) e mensagens
 * prontas (o que enviar). O playbook de reembolso fica sozinho no fim porque é
 * procedimento, não consulta.
 */
const GRUPOS = [
  {
    titulo: "Catálogo",
    abas: [
      { valor: "produtos", rotulo: "Produtos (E-mail)", icone: Package },
      { valor: "sms", rotulo: "Produtos (SMS)", icone: Smartphone },
    ],
  },
  {
    titulo: "Mensagens prontas",
    abas: [
      { valor: "respostas", rotulo: "Respostas SMS", icone: MessageSquareText },
      { valor: "emails", rotulo: "E-mails Clickbank", icone: Mail },
    ],
  },
  {
    titulo: "Procedimento",
    abas: [{ valor: "reembolso", rotulo: "Reembolso", icone: HandCoins }],
  },
] as const;

const ABAS_VALIDAS = GRUPOS.flatMap((g) => g.abas.map((a) => a.valor)) as string[];
const ABA_PADRAO = "produtos";

/**
 * A base em modo consulta do agente (/workspace/base-suporte). Quem edita é a
 * gestora em /dashboard/base. Produtos, brands e respostas vêm do banco; e-mails
 * Clickbank e o playbook de reembolso são fixos em src/features/support-base/data.
 */
export function SupportBaseScreen() {
  // Aba na URL: o agente pode deixar "Respostas SMS" fixa numa outra guia do
  // navegador e o F5 não joga ele de volta para Produtos.
  const [searchParams, setSearchParams] = useSearchParams();
  const abaUrl = searchParams.get("aba");
  const aba = abaUrl && ABAS_VALIDAS.includes(abaUrl) ? abaUrl : ABA_PADRAO;

  const trocarAba = (valor: string) => {
    const proximo = new URLSearchParams(searchParams);
    proximo.set("aba", valor);
    setSearchParams(proximo, { replace: true });
  };

  // Contagens no rótulo das abas — o cache é compartilhado com os painéis, então
  // isso não gera requisição extra depois da primeira carga.
  const produtos = useSupportProductsQuery();
  const brands = useSupportSmsBrandsQuery();
  const respostas = useSupportSmsRepliesQuery();

  const contagens: Record<string, number | undefined> = {
    produtos: produtos.data?.length,
    sms: brands.data?.length,
    respostas: respostas.data?.length,
    emails: EMAIL_TEMPLATES.length,
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Base de Suporte</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Produtos, mensagens prontas e procedimentos — sempre a versão mais atual.
          </p>
        </div>
        <QuickLinksMenu />
      </header>

      <Tabs value={aba} onValueChange={trocarAba}>
        {/* Grupos rotulados no lugar de cinco abas soltas: dá para achar a aba
            pelo tipo de conteúdo sem ler todos os rótulos. */}
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          {GRUPOS.map((grupo) => (
            <div key={grupo.titulo} className="flex flex-col gap-1.5">
              <span className="px-1 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                {grupo.titulo}
              </span>
              <TabsList className="h-auto flex-wrap justify-start gap-1 p-1">
                {grupo.abas.map((item) => {
                  const Icone = item.icone;
                  const total = contagens[item.valor];
                  return (
                    <TabsTrigger key={item.valor} value={item.valor} className="gap-1.5 text-xs">
                      <Icone className="h-3.5 w-3.5" />
                      {item.rotulo}
                      {total !== undefined && (
                        <Badge
                          variant="secondary"
                          className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px] font-medium"
                        >
                          {total}
                        </Badge>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          ))}
        </div>

        <TabsContent value="produtos" className="mt-0">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="sms" className="mt-0">
          <SmsBrandsPanel />
        </TabsContent>
        <TabsContent value="respostas" className="mt-0">
          <SmsRepliesPanel />
        </TabsContent>
        <TabsContent value="emails" className="mt-0">
          <EmailTemplatesPanel />
        </TabsContent>
        <TabsContent value="reembolso" className="mt-0">
          <RefundPlaybookPanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}
