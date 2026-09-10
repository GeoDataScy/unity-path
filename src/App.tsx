import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Loader2 } from "lucide-react";
import Index from "./pages/Index";
import Login from "./pages/Login";

// Páginas/layouts carregados sob demanda (code-splitting): tira do bundle
// inicial os dashboards do gestor (recharts) e o parser de planilhas (xlsx),
// acelerando o primeiro carregamento — especialmente em máquinas fracas.
const ManagerLayout = lazy(() => import("./layouts/ManagerLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DashboardRefunds = lazy(() => import("./pages/DashboardRefunds"));
const DashboardRefundsComparativo = lazy(() => import("./pages/DashboardRefundsComparativo"));
const DashboardAcompanhamento = lazy(() => import("./pages/DashboardAcompanhamento"));
const DashboardInteracoes = lazy(() => import("./pages/DashboardInteracoes"));
const DashboardAlertas = lazy(() => import("./pages/DashboardAlertas"));
const DashboardUsers = lazy(() => import("./pages/DashboardUsers"));
const DashboardBaseSuporte = lazy(() => import("./pages/DashboardBaseSuporte"));
const DashboardZendesk = lazy(() => import("./pages/DashboardZendesk"));
const DashboardLya = lazy(() => import("./pages/DashboardLya"));
const DashboardLyaCerebro = lazy(() => import("./pages/DashboardLyaCerebro"));
const AgentLayout = lazy(() => import("./layouts/AgentLayout"));
const Atendimentos = lazy(() => import("./pages/agent/Atendimentos"));
const PedidosEspera = lazy(() => import("./pages/agent/PedidosEspera"));
const Reembolsos = lazy(() => import("./pages/agent/Reembolsos"));
const MinhasMetricas = lazy(() => import("./pages/agent/MinhasMetricas"));
const ComeceAqui = lazy(() => import("./pages/agent/ComeceAqui"));
const Transferencias = lazy(() => import("./pages/agent/Transferencias"));
const BaseSuporte = lazy(() => import("./pages/agent/BaseSuporte"));
const Radar = lazy(() => import("./pages/agent/Radar"));
const CopyLayout = lazy(() => import("./layouts/CopyLayout"));
const CopyMotivos = lazy(() => import("./pages/copy/CopyMotivos"));
const AreaSelect = lazy(() => import("./pages/AreaSelect"));
const Blocked = lazy(() => import("./pages/Blocked"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Defaults explícitos: sem eles o TanStack Query usa `staleTime: 0` +
// `refetchOnWindowFocus: true`, ou seja, TODA volta de foco na janela refazia
// TODAS as queries montadas. Medido em produção (156 dias): agent_daily_metrics
// com 272.590 chamadas (13 h de CPU) e my_refunds_with_refunded_value com
// 161.772 (17,7 h) — a maior parte era refetch por foco, não navegação.
//
// 30 s de staleTime não atrasa nada que o agente faça: toda mutação invalida a
// query correspondente explicitamente, e invalidação força refetch imediato
// independente do staleTime. O polling real (sino de notificações, dashboards do
// gestor) usa `refetchInterval`, que também é independente do staleTime.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/blocked" element={<Blocked />} />
          {/* Escolha de área (gestora e copy têm acesso a duas) */}
          <Route path="/areas" element={<AreaSelect />} />
          <Route path="/dashboard" element={<ManagerLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="reembolsos" element={<DashboardRefunds />} />
            <Route path="reembolsos/comparativo" element={<DashboardRefundsComparativo />} />
            <Route path="acompanhamento" element={<DashboardAcompanhamento />} />
            <Route path="interacoes" element={<DashboardInteracoes />} />
            <Route path="alertas" element={<DashboardAlertas />} />
            <Route path="usuarios" element={<DashboardUsers />} />
            <Route path="base" element={<DashboardBaseSuporte />} />
            <Route path="zendesk" element={<DashboardZendesk />} />
            <Route path="lya" element={<DashboardLya />} />
            <Route path="lya/cerebro" element={<DashboardLyaCerebro />} />
          </Route>
          <Route path="/workspace" element={<AgentLayout />}>
            <Route index element={<Atendimentos />} />
            <Route path="pedidos-espera" element={<PedidosEspera />} />
            <Route path="comece-aqui" element={<ComeceAqui />} />
            <Route path="reembolsos" element={<Reembolsos />} />
            <Route path="metricas" element={<MinhasMetricas />} />
            <Route path="transferencias" element={<Transferencias />} />
            <Route path="radar" element={<Radar />} />
            <Route path="base-suporte" element={<BaseSuporte />} />
          </Route>
          <Route path="/copy" element={<CopyLayout />}>
            <Route index element={<CopyMotivos />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
