import { RefundsSubNav } from "@/components/dashboard/RefundsSubNav";

/**
 * Aba de Reembolsos de uma plataforma de checkout que ainda não está conectada.
 * Só a casca: os dados virão quando a conexão com a plataforma existir.
 */
export default function DashboardRefundsAguardando({ plataforma }: { plataforma: string }) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[15px] text-ink-tertiary">Analytics</p>
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em]">Reembolsos</h1>
        <RefundsSubNav />
      </header>

      <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center text-sm text-muted-foreground">
        Aguardando conexão com a plataforma {plataforma}.
      </div>
    </div>
  );
}
