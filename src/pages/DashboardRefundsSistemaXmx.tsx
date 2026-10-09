import { RefundsSubNav } from "@/components/dashboard/RefundsSubNav";

/**
 * Comparativo com o sistema externo da XMX. Por enquanto só a casca da aba:
 * os dados virão de uma API que ainda não está conectada.
 */
export default function DashboardRefundsSistemaXmx() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[15px] text-ink-tertiary">Analytics</p>
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Reembolsos</h1>
        <RefundsSubNav />
      </header>

      <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">
        Aguardando conexão com o sistema XMX.
      </div>
    </div>
  );
}
