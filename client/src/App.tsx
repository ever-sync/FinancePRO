import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

const DashboardEmpresa = lazy(() => import("./pages/DashboardEmpresa"));
const DashboardPessoal = lazy(() => import("./pages/DashboardPessoal"));
const Receitas = lazy(() => import("./pages/Receitas"));
const CustosFixos = lazy(() => import("./pages/CustosFixos"));
const CustosVariaveis = lazy(() => import("./pages/CustosVariaveis"));
const Funcionarios = lazy(() => import("./pages/Funcionarios"));
const Fornecedores = lazy(() => import("./pages/Fornecedores"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Servicos = lazy(() => import("./pages/Servicos"));
const ContasFixas = lazy(() => import("./pages/ContasFixas"));
const ContasVariaveis = lazy(() => import("./pages/ContasVariaveis"));
const Dividas = lazy(() => import("./pages/Dividas"));
const Investimentos = lazy(() => import("./pages/Investimentos"));
const FundoReserva = lazy(() => import("./pages/FundoReserva"));
const ImportadorFinanceiro = lazy(() => import("./pages/ImportadorFinanceiro"));
const IntegracoesBancarias = lazy(() => import("./pages/IntegracoesBancarias"));
const DRE = lazy(() => import("./pages/DRE"));
const Calendario = lazy(() => import("./pages/Calendario"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const AsaasIntegracao = lazy(() => import("./pages/AsaasIntegracao"));
const AsaasCobrancas = lazy(() => import("./pages/AsaasCobrancas"));
const AsaasAssinaturas = lazy(() => import("./pages/AsaasAssinaturas"));
const AsaasNotas = lazy(() => import("./pages/AsaasNotas"));
const AsaasTransferencias = lazy(() => import("./pages/AsaasTransferencias"));
const AsaasExtrato = lazy(() => import("./pages/AsaasExtrato"));
const AsaasEventos = lazy(() => import("./pages/AsaasEventos"));
const WhatsAppIntegracao = lazy(() => import("./pages/WhatsAppIntegracao"));
const WhatsAppConversas = lazy(() => import("./pages/WhatsAppConversas"));
const WhatsAppAutomacao = lazy(() => import("./pages/WhatsAppAutomacao"));
const WhatsAppPlanos = lazy(() => import("./pages/WhatsAppPlanos"));
const WhatsAppAuditoria = lazy(() => import("./pages/WhatsAppAuditoria"));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center rounded-[28px] border border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-3 text-sm font-medium text-zinc-500">
        <span className="size-2.5 animate-pulse rounded-full bg-orange-500" />
        Carregando tela...
      </div>
    </div>
  );
}

function Router() {
  return (
    <DashboardLayout>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={DashboardEmpresa} />
          <Route path="/pessoal" component={DashboardPessoal} />
          <Route path="/receitas" component={Receitas} />
          <Route path="/custos-fixos" component={CustosFixos} />
          <Route path="/custos-variaveis" component={CustosVariaveis} />
          <Route path="/funcionarios" component={Funcionarios} />
          <Route path="/fornecedores" component={Fornecedores} />
          <Route path="/clientes" component={Clientes} />
          <Route path="/servicos" component={Servicos} />
          <Route path="/contas-fixas" component={ContasFixas} />
          <Route path="/contas-variaveis" component={ContasVariaveis} />
          <Route path="/dividas" component={Dividas} />
          <Route path="/investimentos" component={Investimentos} />
          <Route path="/fundo-reserva" component={FundoReserva} />
          <Route path="/importador" component={ImportadorFinanceiro} />
          <Route path="/integracoes-bancarias" component={IntegracoesBancarias} />
          <Route path="/dre" component={DRE} />
          <Route path="/calendario" component={Calendario} />
          <Route path="/configuracoes" component={Configuracoes} />
          <Route path="/asaas/integracao" component={AsaasIntegracao} />
          <Route path="/asaas/cobrancas" component={AsaasCobrancas} />
          <Route path="/asaas/assinaturas" component={AsaasAssinaturas} />
          <Route path="/asaas/notas" component={AsaasNotas} />
          <Route path="/asaas/transferencias" component={AsaasTransferencias} />
          <Route path="/asaas/extrato" component={AsaasExtrato} />
          <Route path="/asaas/eventos" component={AsaasEventos} />
          <Route path="/whatsapp/integracao" component={WhatsAppIntegracao} />
          <Route path="/whatsapp/conversas" component={WhatsAppConversas} />
          <Route path="/whatsapp/automacao" component={WhatsAppAutomacao} />
          <Route path="/whatsapp/planos" component={WhatsAppPlanos} />
          <Route path="/whatsapp/auditoria" component={WhatsAppAuditoria} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
