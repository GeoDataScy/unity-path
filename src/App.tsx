import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ManagerLayout from "./layouts/ManagerLayout";
import DashboardRefunds from "./pages/DashboardRefunds";
import DashboardAcompanhamento from "./pages/DashboardAcompanhamento";
import DashboardInteracoes from "./pages/DashboardInteracoes";
import DashboardAlertas from "./pages/DashboardAlertas";
import AgentLayout from "./layouts/AgentLayout";
import Atendimentos from "./pages/agent/Atendimentos";
import Reembolsos from "./pages/agent/Reembolsos";
import MinhasMetricas from "./pages/agent/MinhasMetricas";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<ManagerLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="reembolsos" element={<DashboardRefunds />} />
            <Route path="acompanhamento" element={<DashboardAcompanhamento />} />
            <Route path="interacoes" element={<DashboardInteracoes />} />
            <Route path="alertas" element={<DashboardAlertas />} />
          </Route>
          <Route path="/workspace" element={<AgentLayout />}>
            <Route index element={<Atendimentos />} />
            <Route path="reembolsos" element={<Reembolsos />} />
             <Route path="metricas" element={<MinhasMetricas />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
