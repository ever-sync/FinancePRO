import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSupabaseAuth } from "@/lib/auth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMobile";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  DollarSign,
  FileText,
  FileSpreadsheet,
  Landmark,
  MessageCircle,
  LayoutDashboard,
  Loader2,
  LogOut,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useLocation } from "wouter";
import AuthPage from "@/pages/Auth";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { LanguageSwitcher } from "./language-switcher";

type SidebarItem = {
  icon: LucideIcon;
  label: string;
  path: string;
};

type SidebarSection = {
  label: string;
  items: SidebarItem[];
};

const SIDEBAR_STYLE = {
  "--sidebar-width": "17.5rem",
  "--sidebar-width-mobile": "min(86vw, 20rem)",
  "--sidebar-width-icon": "3.75rem",
  "--sidebar": "oklch(0.985 0.003 260)",
  "--sidebar-foreground": "oklch(0.32 0.01 260)",
  "--sidebar-primary": "oklch(0.18 0.01 260)",
  "--sidebar-primary-foreground": "oklch(0.985 0 0)",
  "--sidebar-accent": "oklch(0.95 0.004 260)",
  "--sidebar-accent-foreground": "oklch(0.18 0.01 260)",
  "--sidebar-border": "oklch(0.92 0.004 260)",
  "--sidebar-ring": "oklch(0.58 0.02 260)",
} as CSSProperties;

const useSidebarSections = () => {
  const { t } = useTranslation();

  const getLabel = (key: string, fallback: string) => {
    const translated = t(key, { defaultValue: fallback });
    return translated === key ? fallback : translated;
  };

  return useMemo(
    () => [
      {
        label: getLabel("navigation.dashboard", "Dashboard"),
        items: [{ icon: LayoutDashboard, label: "Painel consolidado", path: "/" }],
      },
      {
        label: "Empresa",
        items: [
          { icon: DollarSign, label: getLabel("navigation.revenues", "Receitas"), path: "/receitas" },
          { icon: Building2, label: getLabel("costs.fixedCosts", "Custos fixos"), path: "/custos-fixos" },
          { icon: Receipt, label: getLabel("costs.variableCosts", "Custos variaveis"), path: "/custos-variaveis" },
          { icon: Users, label: getLabel("navigation.employees", "Funcionarios"), path: "/funcionarios" },
          { icon: Truck, label: getLabel("navigation.suppliers", "Fornecedores"), path: "/fornecedores" },
          { icon: UserCheck, label: getLabel("navigation.clients", "Clientes"), path: "/clientes" },
          { icon: Briefcase, label: getLabel("navigation.services", "Servicos"), path: "/servicos" },
        ],
      },
      {
        label: "Pessoal",
        items: [
          { icon: Wallet, label: getLabel("costs.fixedCosts", "Custos fixos"), path: "/contas-fixas" },
          { icon: Receipt, label: getLabel("costs.variableCosts", "Custos variaveis"), path: "/contas-variaveis" },
          { icon: TrendingDown, label: getLabel("navigation.debts", "Dividas"), path: "/dividas" },
          { icon: TrendingUp, label: getLabel("navigation.investments", "Investimentos"), path: "/investimentos" },
          { icon: PiggyBank, label: getLabel("dashboard.reservedFund", "Fundo de reserva"), path: "/fundo-reserva" },
        ],
      },
      {
        label: "Asaas",
        items: [
          { icon: ShieldCheck, label: "Integracao Asaas", path: "/asaas/integracao" },
          { icon: Receipt, label: "Cobrancas", path: "/asaas/cobrancas" },
          { icon: Repeat, label: "Assinaturas", path: "/asaas/assinaturas" },
          { icon: FileSpreadsheet, label: "Notas fiscais", path: "/asaas/notas" },
          { icon: Repeat, label: "Transferencias", path: "/asaas/transferencias" },
          { icon: FileText, label: "Extrato", path: "/asaas/extrato" },
          { icon: FileText, label: "Eventos", path: "/asaas/eventos" },
        ],
      },
      {
        label: "WhatsApp IA",
        items: [
          { icon: MessageCircle, label: "Integracao", path: "/whatsapp/integracao" },
          { icon: MessageCircle, label: "Inbox do mentor", path: "/whatsapp/conversas" },
          { icon: Repeat, label: "Automacao", path: "/whatsapp/automacao" },
          { icon: Sparkles, label: "Mentoria financeira", path: "/whatsapp/planos" },
          { icon: FileText, label: "Auditoria", path: "/whatsapp/auditoria" },
        ],
      },
      {
        label: getLabel("navigation.tools", "Ferramentas"),
        items: [
          { icon: FileSpreadsheet, label: "Importador CSV", path: "/importador" },
          { icon: Landmark, label: "Integracoes bancarias", path: "/integracoes-bancarias" },
          { icon: FileText, label: "DRE", path: "/dre" },
          { icon: CalendarDays, label: getLabel("navigation.calendar", "Calendario"), path: "/calendario" },
          { icon: Settings, label: getLabel("navigation.settings", "Configuracoes"), path: "/configuracoes" },
        ],
      },
    ],
    [t]
  );
};

function getInitialSidebarOpen() {
  if (typeof document === "undefined") return false;

  const cookie = document.cookie
    .split("; ")
    .find(entry => entry.startsWith("sidebar_state="));

  if (!cookie) return false;

  return cookie.split("=").slice(1).join("=") !== "false";
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarDefaultOpen] = useState(getInitialSidebarOpen);
  const { loading, user, signOut } = useSupabaseAuth();
  const appUserQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !loading && !!user,
    retry: 2,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) return <AuthPage />;

  if (appUserQuery.error || !appUserQuery.data) {
    if (appUserQuery.isLoading) {
      return (
        <SidebarProvider defaultOpen={sidebarDefaultOpen} style={SIDEBAR_STYLE}>
          <DashboardLayoutContent>{children}</DashboardLayoutContent>
        </SidebarProvider>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f4f2] p-4">
        <div className="w-full max-w-lg rounded-[28px] border border-zinc-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <AlertCircle className="size-7" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900">
            Sessao sem sincronizacao
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Seu login existe no navegador, mas o servidor nao conseguiu validar o usuario da
            aplicacao. Enquanto isso acontecer, os dados protegidos podem aparecer vazios no
            front-end.
          </p>
          {appUserQuery.error ? (
            <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {appUserQuery.error.message}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              className="sm:flex-1"
              onClick={() => appUserQuery.refetch()}
              disabled={appUserQuery.isFetching}
            >
              {appUserQuery.isFetching ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Tentando novamente...
                </>
              ) : (
                "Tentar novamente"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="sm:flex-1"
              onClick={() => signOut()}
            >
              Sair e entrar de novo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen} style={SIDEBAR_STYLE}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useSupabaseAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const sidebarSections = useSidebarSections();

  const activeMenuItem = useMemo(
    () => sidebarSections.flatMap(section => section.items).find(item => item.path === location),
    [location, sidebarSections]
  );

  return (
    <>
      <DashboardSidebar
        sections={sidebarSections}
        location={location}
        onNavigate={setLocation}
        onLogout={signOut}
        userName={user?.user_metadata?.name ?? user?.email?.split("@")[0] ?? "Usuario"}
        userEmail={user?.email ?? ""}
      />

      <SidebarInset className="bg-[#f4f4f2]">
        {isMobile && (
          <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="max-w-[60vw] truncate text-sm font-medium tracking-tight text-foreground">
                {activeMenuItem?.label ?? "Menu"}
              </span>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 text-zinc-900 md:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </>
  );
}

function DashboardSidebar({
  sections,
  location,
  onNavigate,
  onLogout,
  userName,
  userEmail,
}: {
  sections: SidebarSection[];
  location: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "U";

  return (
    <Sidebar collapsible="icon" variant="floating" className="border-0 bg-transparent">
      <SidebarHeader className="px-3 pb-2 pt-3">
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-[24px] border border-zinc-200 bg-white px-3 py-2 shadow-[0_18px_40px_rgba(15,23,42,0.06)] transition-all",
            "group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:shadow-none"
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 via-orange-500 to-amber-400 text-white shadow-[0_10px_24px_rgba(249,115,22,0.28)]">
            <DollarSign className="size-4" />
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
              FinancePro
            </p>
            <p className="truncate text-[11px] text-zinc-500">Dashboard financeiro</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggleSidebar}
            className="size-8 rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label={isCollapsed ? "Expandir sidebar" : "Recolher sidebar"}
            title={isCollapsed ? "Expandir sidebar" : "Recolher sidebar"}
          >
            {isCollapsed ? (
              <ChevronsRight className="size-4" />
            ) : (
              <ChevronsLeft className="size-4" />
            )}
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 pb-6">
        <div className="space-y-5">
        {sections.map(section => (
          <section key={section.label} className="space-y-2">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 group-data-[collapsible=icon]:hidden">
              {section.label}
            </p>
            <div className="space-y-1.5">
                {section.items.map(item => {
                  const isActive = location === item.path;

                  return (
                    <button
                      key={item.path}
                      type="button"
                        onClick={() => {
                          onNavigate(item.path);
                          if (isMobile) {
                            toggleSidebar();
                          }
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-3 rounded-[22px] px-3.5 py-2.5 text-left text-[13px] font-medium leading-snug text-zinc-500 transition-all sm:text-sm",
                          "hover:bg-zinc-100 hover:text-zinc-900",
                          isActive && "bg-zinc-900 text-white shadow-[0_14px_32px_rgba(15,23,42,0.18)]",
                          "group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:!px-0"
                        )}
                      >
                        <item.icon
                          className={cn(
                            "size-4 shrink-0 transition-colors",
                            isActive ? "text-white" : "text-zinc-500"
                          )}
                        />
                        <span className="min-w-0 whitespace-normal text-left leading-snug group-data-[collapsible=icon]:hidden">
                          {item.label}
                        </span>
                    </button>
                  );
                })}
            </div>
          </section>
        ))}
        </div>
      </SidebarContent>

      <SidebarFooter className="p-3 pt-2">
        <div
          className={cn(
            "rounded-[24px] border border-zinc-200 bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.06)]",
            "group-data-[collapsible=icon]:px-2"
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-3",
              "group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-2"
            )}
          >
            <div
              className={cn(
                "flex items-center gap-3",
                "group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center"
              )}
            >
              <Avatar className="size-9 border border-zinc-200 group-data-[collapsible=icon]:hidden">
                <AvatarFallback className="bg-zinc-100 text-xs font-semibold text-zinc-700">
                  {initials}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-medium text-zinc-900">{userName}</p>
                <p className="truncate text-[11px] text-zinc-500">{userEmail || " "}</p>
              </div>
            </div>

            <div
              className={cn(
                "flex items-center gap-2",
                "group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2"
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  onNavigate("/configuracoes");
                  if (isMobile) {
                    toggleSidebar();
                  }
                }}
                className="size-8 shrink-0 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="Abrir configuracoes"
                title="Configuracoes"
              >
                <Settings className="size-4" />
              </Button>

              <LanguageSwitcher className="min-w-0 flex-1 group-data-[collapsible=icon]:w-full" />

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  onLogout();
                  if (isMobile) {
                    toggleSidebar();
                  }
                }}
                className="size-8 shrink-0 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="Sair da conta"
                title="Sair"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail className="after:bg-zinc-200 hover:after:bg-zinc-400" />
    </Sidebar>
  );
}
