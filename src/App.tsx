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
const DashboardAcompanhamento = lazy(() => import("./pages/DashboardAcompanhamento"));
const DashboardInteracoes = lazy(() => import("./pages/DashboardInteracoes"));
const DashboardAlertas = lazy(() => import("./pages/DashboardAlertas"));
const DashboardUsers = lazy(() => import("./pages/DashboardUsers"));
const AgentLayout = lazy(() => import("./layouts/AgentLayout"));
const Atendimentos = lazy(() => import("./pages/agent/Atendimentos"));
const PedidosEspera = lazy(() => import("./pages/agent/PedidosEspera"));
const Reembolsos = lazy(() => import("./pages/agent/Reembolsos"));
const MinhasMetricas = lazy(() => import("./pages/agent/MinhasMetricas"));
const ComeceAqui = lazy(() => import("./pages/agent/ComeceAqui"));
const Transferencias = lazy(() => import("./pages/agent/Transferencias"));
const Blocked = lazy(() => import("./pages/Blocked"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

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
          <Route path="/dashboard" element={<ManagerLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="reembolsos" element={<DashboardRefunds />} />
            <Route path="acompanhamento" element={<DashboardAcompanhamento />} />
            <Route path="interacoes" element={<DashboardInteracoes />} />
            <Route path="alertas" element={<DashboardAlertas />} />
            <Route path="usuarios" element={<DashboardUsers />} />
          </Route>
          <Route path="/workspace" element={<AgentLayout />}>
            <Route index element={<Atendimentos />} />
            <Route path="pedidos-espera" element={<PedidosEspera />} />
            <Route path="comece-aqui" element={<ComeceAqui />} />
            <Route path="reembolsos" element={<Reembolsos />} />
            <Route path="metricas" element={<MinhasMetricas />} />
            <Route path="transferencias" element={<Transferencias />} />
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
