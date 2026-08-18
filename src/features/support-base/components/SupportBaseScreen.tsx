import { BookOpen, ExternalLink, HandCoins, Mail, MessageSquare, Package } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmailTemplatesPanel } from "@/features/support-base/components/EmailTemplatesPanel";
import { ProductsPanel } from "@/features/support-base/components/ProductsPanel";
import { RefundPlaybookPanel } from "@/features/support-base/components/RefundPlaybookPanel";
import { SmsBrandsPanel } from "@/features/support-base/components/SmsBrandsPanel";
import { SmsRepliesPanel } from "@/features/support-base/components/SmsRepliesPanel";
import { LINKS_RAPIDOS } from "@/features/support-base/data/refundPlaybook";

/**
 * A base em modo consulta. Mesma tela para o agente (/workspace/base-suporte) e
 * para o copy (/copy/base-suporte) — o conteúdo é o mesmo e quem edita é a
 * gestora em /dashboard/base. Produtos, brands e respostas vêm do banco; e-mails
 * Clickbank e o playbook de reembolso são fixos em src/features/support-base/data.
 */
export function SupportBaseScreen() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Base de Suporte</h1>
          <p className="text-sm text-muted-foreground">
            Produtos, mensagens prontas e procedimentos — sempre a versão mais atual.
          </p>
        </div>
      </header>

      <Tabs defaultValue="produtos">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="produtos" className="gap-1.5 text-xs">
            <Package className="h-3.5 w-3.5" />
            Produtos (E-mail)
          </TabsTrigger>
          <TabsTrigger value="sms" className="gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            Produtos (SMS)
          </TabsTrigger>
          <TabsTrigger value="respostas" className="gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            Respostas SMS
          </TabsTrigger>
          <TabsTrigger value="emails" className="gap-1.5 text-xs">
            <Mail className="h-3.5 w-3.5" />
            E-mails Clickbank
          </TabsTrigger>
          <TabsTrigger value="reembolso" className="gap-1.5 text-xs">
            <HandCoins className="h-3.5 w-3.5" />
            Reembolso
          </TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="mt-6">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="sms" className="mt-6">
          <SmsBrandsPanel />
        </TabsContent>
        <TabsContent value="respostas" className="mt-6">
          <SmsRepliesPanel />
        </TabsContent>
        <TabsContent value="emails" className="mt-6">
          <EmailTemplatesPanel />
        </TabsContent>
        <TabsContent value="reembolso" className="mt-6">
          <RefundPlaybookPanel />
        </TabsContent>
      </Tabs>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Links rápidos</h2>
        <div className="flex flex-wrap gap-2">
          {LINKS_RAPIDOS.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              {link.label}
              <span className="text-[10px] opacity-60">{link.grupo}</span>
            </a>
          ))}
        </div>
      </Card>
    </main>
  );
}
