import { trpc } from "@/lib/trpc";
import { useSupabaseAuth } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useMonthYear } from "@/hooks/useMonthYear";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  ChevronDown,
  CreditCard,
  DollarSign,
  EllipsisVertical,
  Info,
  LayoutDashboard,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
  Wallet,
  PiggyBank,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TabItem = {
  label: string;
};

type WalletItem = {
  code: string;
  label: string;
  amount: number;
  status: "Ativa" | "Inativa";
  tone: "emerald" | "amber" | "slate";
  progress: number;
};

type ActivityItem = {
  orderId: string;
  activity: string;
  price: number;
  status: "Concluído" | "Pendente" | "Em andamento";
  date: string;
  kind: "revenue" | "fixedCost" | "variableCost" | "purchase" | "payroll" | "reserve";
  tone: "emerald" | "rose" | "amber" | "blue";
};

const panelClass =
  "rounded-[28px] border border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]";

function formatMoney(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const dashboardTabs: TabItem[] = [
  { label: "Visão geral" },
  { label: "Movimentações" },
  { label: "Gerenciar" },
  { label: "Programa" },
  { label: "Conta" },
  { label: "Relatórios" },
];

export default function DashboardEmpresa() {
  const { user } = useSupabaseAuth();
  const { month, year } = useMonthYear();
  const { data, isLoading } = trpc.dashboard.company.useQuery({ month, year });
  const { data: advisorSnapshot } = trpc.financialAdvisor.getSnapshot.useQuery();
  const [activeTab, setActiveTab] = useState("Visão geral");
  const [searchQuery, setSearchQuery] = useState("");

  const userName =
    String(user?.user_metadata?.name || user?.email?.split("@")[0] || "")
      .trim() || "Usuário";
  const userEmail = user?.email?.trim() || "";

  const currentSummary = data?.summary?.current;
  const previousSummary = data?.summary?.previous;

  const grossRevenue = asNumber(currentSummary?.grossRevenue ?? data?.revenue?.totalGross);
  const netRevenue = asNumber(currentSummary?.netRevenue ?? data?.revenue?.totalNet);
  const totalFixedCosts = asNumber(currentSummary?.fixedCosts ?? data?.fixedCosts?.total);
  const totalVarCosts = asNumber(currentSummary?.variableCosts ?? data?.variableCosts?.total);
  const totalEmployees = asNumber(currentSummary?.employeeCosts ?? data?.employees?.totalCost);
  const totalPurchases = asNumber(currentSummary?.purchases ?? data?.purchases?.total);
  const proLabore = asNumber(data?.settings?.proLaboreGross);
  const reserveTotal = asNumber(currentSummary?.reserve ?? data?.reserve?.total);

  const totalSpendingReal = asNumber(
    currentSummary?.spending ??
      totalFixedCosts + totalVarCosts + totalEmployees + totalPurchases + proLabore
  );
  const profitReal = asNumber(currentSummary?.profit ?? netRevenue - totalSpendingReal);
  const balanceReal = asNumber(currentSummary?.balance ?? profitReal + reserveTotal);

  const chartData = data?.chartSeries ?? [];
  const wallets = data?.wallets ?? [];
  const activities = data?.activities ?? [];

  const displayGrossRevenue = grossRevenue;
  const displayNetRevenue = netRevenue;
  const displaySpending = totalSpendingReal;
  const displayProfit = profitReal;
  const displayBalance = balanceReal;

  const spendingLimit = Math.max(totalSpendingReal * 1.25, 5500);
  const spendingProgress = Math.min((displaySpending / spendingLimit) * 100, 100);

  const visibleActivities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activities;
    return activities.filter(item => {
      return (
        item.orderId.toLowerCase().includes(query) ||
        item.activity.toLowerCase().includes(query) ||
        item.status.toLowerCase().includes(query) ||
        item.date.toLowerCase().includes(query)
      );
    });
  }, [activities, searchQuery]);

  if (isLoading) {
    return <DashboardPageSkeleton />;
  }

  const displayDeltaProfit = percentageChange(displayProfit, asNumber(previousSummary?.profit));
  const displayDeltaBalance = percentageChange(displayBalance, asNumber(previousSummary?.balance));
  const displayDeltaSpending = percentageChange(asNumber(previousSummary?.spending), displaySpending);
  const displayDeltaIncome = percentageChange(displayNetRevenue, asNumber(previousSummary?.netRevenue));
  const displayDeltaRevenue = percentageChange(displayGrossRevenue, asNumber(previousSummary?.grossRevenue));

  return (
    <div className="-mx-4 -my-4 min-h-full bg-[#f4f4f2] text-zinc-900 md:-mx-6 md:-my-6">
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="flex size-8 items-center justify-center rounded-full bg-orange-500 text-white shadow-[0_10px_24px_rgba(249,115,22,0.24)]">
              <ArrowUpRight className="size-4 stroke-[2.5]" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-900">
              Finexy
            </span>
          </div>

          <div className="flex flex-1 justify-center">
            <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-zinc-200 bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              {dashboardTabs.map(tab => {
                const isActive = tab.label === activeTab;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setActiveTab(tab.label)}
                    className={cn(
                      "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition",
                      isActive
                        ? "bg-zinc-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)]"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end xl:self-auto">
            <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <HeaderIconButton icon={Search} title="Pesquisar" />
              <HeaderIconButton icon={Bell} title="Notificações" badge />
              <HeaderIconButton icon={Info} title="Informações" />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:bg-zinc-50">
                  <Avatar className="size-8 border border-zinc-200">
                    <AvatarFallback className="bg-zinc-100 text-xs font-semibold text-zinc-700">
                      {userName
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part: string) => part[0]?.toUpperCase())
                        .join("") || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden min-w-0 text-left sm:block">
                    <p className="truncate text-[13px] font-medium text-zinc-900">
                      {userName}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {userEmail}
                    </p>
                  </div>
                  <ChevronDown className="size-4 text-zinc-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 rounded-2xl border-zinc-200 bg-white p-1 shadow-xl"
              >
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-zinc-900">{userName}</p>
                  <p className="text-xs text-zinc-500">{userEmail}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2 text-sm text-zinc-700 focus:bg-zinc-100">
                  <Settings className="mr-2 size-4" />
                  Configurações
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2 text-sm text-zinc-700 focus:bg-zinc-100">
                  <LayoutDashboard className="mr-2 size-4" />
                  Relatórios
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <section className="space-y-2 pt-1">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
            Bom dia, {userName.split(" ")[0] || "Sajibur"}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-500 md:text-base">
            Acompanhe suas tarefas, monitore o progresso e acompanhe os status.
          </p>
        </section>

        {advisorSnapshot ? (
          <section className={cn(panelClass, "p-5")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-zinc-400">
                  Copiloto Financeiro
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                  Guardrails consolidados do mês
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-zinc-500">{advisorSnapshot.summary}</p>
              </div>
              <div
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em]",
                  advisorSnapshot.cashRiskLevel === "critical"
                    ? "bg-rose-50 text-rose-600"
                    : advisorSnapshot.cashRiskLevel === "attention"
                      ? "bg-amber-50 text-amber-600"
                      : "bg-emerald-50 text-emerald-600"
                )}
              >
                {advisorSnapshot.cashRiskLevel}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <AdvisorMetricCard
                label="Gasto seguro hoje"
                value={formatMoney(advisorSnapshot.safeToSpendNow)}
                note="Teto diário sem apertar o restante do mês"
              />
              <AdvisorMetricCard
                label="Gasto seguro mês"
                value={formatMoney(advisorSnapshot.safeToSpendMonth)}
                note="Espaço restante após reservas e proteções"
              />
              <AdvisorMetricCard
                label="Caixa protegido"
                value={formatMoney(advisorSnapshot.protectedCash)}
                note="Impostos, caixa mínimo e parcelas protegidas"
              />
              <AdvisorMetricCard
                label="Reserva recomendada"
                value={formatMoney(advisorSnapshot.companyReserveRecommendation + advisorSnapshot.personalReserveRecommendation)}
                note="Sugestão consolidada para reforço de reserva"
              />
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1.05fr]">
          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-500">Saldo total</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 xl:text-4xl">
                    {formatMoney(displayBalance)}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                    <ArrowUpRight className="size-4" />
                    +{Math.abs(displayDeltaBalance)}% em relação ao mês anterior
                  </p>
                </div>

                <div className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
                  R$
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button className="rounded-full bg-zinc-900 px-5 text-white shadow-sm hover:bg-zinc-800">
                  Transferir
                </Button>
                <Button className="rounded-full border border-zinc-200 bg-white px-5 text-zinc-700 shadow-sm hover:bg-zinc-50">
                  Solicitar
                </Button>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      Carteiras
                    </p>
                    <p className="text-xs text-zinc-500">
                      Total de {wallets.length} carteiras
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {wallets.map(wallet => (
                    <WalletMiniCard key={wallet.code} wallet={wallet} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Lucro total"
              value={displayProfit}
              delta={displayDeltaProfit}
              icon={Sparkles}
              highlighted
            />
            <MetricCard
              label="Gastos totais"
              value={displaySpending}
              delta={displayDeltaSpending}
              icon={TrendingDown}
            />
            <MetricCard
              label="Receita líquida"
              value={displayNetRevenue}
              delta={displayDeltaIncome}
              icon={TrendingUp}
            />
            <MetricCard
              label="Receita bruta"
              value={displayGrossRevenue}
              delta={displayDeltaRevenue}
              icon={DollarSign}
            />
          </div>

          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Receita do período
                  </CardTitle>
                  <p className="mt-1 text-sm text-zinc-500">
                    Visualize a receita em um período específico.
                  </p>
                </div>
                <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-zinc-900" />
                    Receita
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-orange-500" />
                    Despesa
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="h-[320px]">
                <ResponsiveBarChart data={chartData} />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <Card className={cn(panelClass, "border-zinc-200 py-0")}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      Limite mensal de gastos
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {formatMoney(displaySpending)} gastos de{" "}
                      {formatMoney(spendingLimit)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-orange-500 to-orange-400"
                    style={{ width: `${spendingProgress}%` }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                  <span>{formatMoney(displaySpending)} gastos de</span>
                  <span>{formatMoney(spendingLimit)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(panelClass, "border-zinc-200 py-0")}>
              <CardHeader className="p-5 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold text-zinc-900">
                      Meus cartões
                    </CardTitle>
                    <p className="mt-1 text-sm text-zinc-500">
                      Cartões ativos e destacados.
                    </p>
                  </div>
                  <Button className="rounded-full border border-zinc-200 bg-white px-4 text-zinc-700 shadow-sm hover:bg-zinc-50">
                    + Adicionar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <div className="grid gap-3 sm:grid-cols-2">
                  <CreditCardMock
                    tone="dark"
                    active
                    number="•••• •••• •••• 6782"
                    exp="09/29"
                    cvv="611"
                  />
                  <CreditCardMock
                    tone="orange"
                    active
                    number="•••• •••• •••• 4356"
                    exp="09/29"
                    cvv="611"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardHeader className="p-5 pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold text-zinc-900">
                    Atividades recentes
                  </CardTitle>
                  <p className="mt-1 text-sm text-zinc-500">
                    Acompanhe receitas, custos, folha e movimentações da reserva.
                  </p>
                </div>

                <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:flex-none">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      value={searchQuery}
                      onChange={event => setSearchQuery(event.target.value)}
                      placeholder="Pesquisar"
                      className="h-10 rounded-full border-zinc-200 bg-white pl-9 text-sm text-zinc-900 placeholder:text-zinc-400 shadow-sm"
                    />
                  </div>
                  <Button className="h-10 rounded-full border border-zinc-200 bg-white px-4 text-zinc-700 shadow-sm hover:bg-zinc-50">
                    <SlidersHorizontal className="mr-2 size-4" />
                    Filtrar
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-5 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-200 hover:bg-transparent">
                      <TableHead className="w-10 px-2 text-zinc-400">
                        <Checkbox className="border-zinc-300 data-[state=checked]:border-zinc-900 data-[state=checked]:bg-zinc-900" />
                    </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        ID
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        Lançamento
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        Valor
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        Status
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        Data
                      </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleActivities.length === 0 ? (
                    <TableRow className="border-zinc-100 hover:bg-transparent">
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-zinc-500">
                        Nenhuma atividade encontrada neste período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleActivities.map(activity => (
                      <TableRow
                        key={activity.orderId + activity.activity}
                        className="border-zinc-100 hover:bg-zinc-50/80"
                      >
                        <TableCell className="px-2">
                          <Checkbox className="border-zinc-300 data-[state=checked]:border-zinc-900 data-[state=checked]:bg-zinc-900" />
                        </TableCell>
                        <TableCell className="text-sm font-medium text-zinc-700">
                          {activity.orderId}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ActivityIcon kind={activity.kind} tone={activity.tone} />
                            <div>
                              <p className="text-sm font-medium text-zinc-900">
                                {activity.activity}
                              </p>
                              <p className="text-xs text-zinc-500">Lançamento</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium text-zinc-900">
                          {formatMoney(activity.price)}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={activity.status} />
                        </TableCell>
                        <TableCell className="text-sm text-zinc-500">
                          {activity.date}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-8 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                          >
                            <EllipsisVertical className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function AdvisorMetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-[24px] border border-zinc-200 bg-white/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
      <p className="mt-2 text-xs text-zinc-500">{note}</p>
    </div>
  );
}

function DashboardPageSkeleton() {
  return (
    <div className="-mx-4 -my-4 min-h-full bg-[#f4f4f2] md:-mx-6 md:-my-6">
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <Skeleton className="h-12 w-36 rounded-full" />
          <div className="flex flex-1 justify-center">
            <Skeleton className="h-12 w-[min(34rem,100%)] rounded-full" />
          </div>
          <div className="flex items-center gap-2 self-end xl:self-auto">
            <Skeleton className="h-12 w-28 rounded-full" />
            <Skeleton className="h-12 w-56 rounded-full" />
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <Skeleton className="h-14 w-[min(34rem,100%)] rounded-[28px]" />
          <Skeleton className="h-5 w-[min(28rem,100%)] rounded-full" />
        </div>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1.05fr]">
          <Skeleton className="h-[22rem] rounded-[28px]" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-44 rounded-[24px]" />
            <Skeleton className="h-44 rounded-[24px]" />
            <Skeleton className="h-44 rounded-[24px]" />
            <Skeleton className="h-44 rounded-[24px]" />
          </div>
          <Skeleton className="h-[22rem] rounded-[28px]" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-[28px]" />
            <Skeleton className="h-60 rounded-[28px]" />
          </div>
          <Skeleton className="h-[31rem] rounded-[28px]" />
        </section>
      </div>
    </div>
  );
}

function HeaderIconButton({
  icon: Icon,
  title,
  badge = false,
}: {
  icon: LucideIcon;
  title: string;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="relative flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
    >
      <Icon className="size-4" />
      {badge ? (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-orange-500 ring-2 ring-white" />
      ) : null}
    </button>
  );
}

function MetricCard({
  label,
  value,
  delta,
  icon: Icon,
  highlighted = false,
}: {
  label: string;
  value: number;
  delta: number;
  icon: LucideIcon;
  highlighted?: boolean;
}) {
  const positive = delta >= 0;
  const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight;
  const deltaLabel = `${positive ? "+" : "-"}${Math.round(Math.abs(delta))}%`;

  return (
    <Card
      className={cn(
        "overflow-hidden border-zinc-200 py-0",
        highlighted
          ? "border-orange-200 bg-gradient-to-br from-orange-500 via-orange-500 to-amber-400 text-white shadow-[0_18px_45px_rgba(249,115,22,0.24)]"
          : "bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)]"
      )}
    >
      <CardContent className="flex h-full flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p
              className={cn(
                "text-sm",
                highlighted ? "text-orange-50/90" : "text-zinc-500"
              )}
            >
              {label}
            </p>
            <p
              className={cn(
                "mt-3 text-3xl font-semibold tracking-tight",
                highlighted ? "text-white" : "text-zinc-900"
              )}
            >
              {formatMoney(value)}
            </p>
          </div>

          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-2xl",
              highlighted ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-500"
            )}
          >
            <Icon className="size-5" />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              highlighted
                ? "bg-white/15 text-white"
                : positive
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-rose-50 text-rose-600"
            )}
          >
            <DeltaIcon className="size-3.5" />
            {deltaLabel}
          </span>
          <span className={highlighted ? "text-xs text-orange-50/90" : "text-xs text-zinc-400"}>
            Neste mês
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function WalletMiniCard({ wallet }: { wallet: WalletItem }) {
  const toneClasses: Record<
    WalletItem["tone"],
    { badge: string; icon: string; status: string; bg: string }
  > = {
    emerald: {
      badge: "border-emerald-100 bg-emerald-50 text-emerald-600",
      icon: "border-emerald-100 bg-emerald-50 text-emerald-600",
      status: "bg-emerald-50 text-emerald-600",
      bg: "bg-emerald-500/10",
    },
    amber: {
      badge: "border-amber-100 bg-amber-50 text-amber-600",
      icon: "border-amber-100 bg-amber-50 text-amber-600",
      status: "bg-amber-50 text-amber-600",
      bg: "bg-amber-500/10",
    },
    slate: {
      badge: "border-zinc-200 bg-zinc-100 text-zinc-600",
      icon: "border-zinc-200 bg-zinc-100 text-zinc-600",
      status: "bg-zinc-100 text-zinc-500",
      bg: "bg-zinc-500/10",
    },
  };

  const tone = toneClasses[wallet.tone];

  return (
    <div className="rounded-[22px] border border-zinc-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl border text-sm font-semibold",
            tone.icon
          )}
        >
          {wallet.code}
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            tone.status
          )}
        >
          {wallet.status}
        </span>
      </div>

      <div className="mt-4 space-y-1">
        <p className="text-sm font-medium text-zinc-900">{wallet.label}</p>
        <p className="text-lg font-semibold tracking-tight text-zinc-900">
          {formatMoney(wallet.amount)}
        </p>
      </div>

      <div className="mt-4 h-1.5 rounded-full bg-zinc-100">
        <div
          className={cn("h-1.5 rounded-full", tone.bg)}
          style={{ width: `${Math.max(0, Math.min(wallet.progress, 100))}%` }}
        />
      </div>
    </div>
  );
}

function CreditCardMock({
  tone,
  active,
  number,
  exp,
  cvv,
}: {
  tone: "dark" | "orange";
  active: boolean;
  number: string;
  exp: string;
  cvv: string;
}) {
  const isDark = tone === "dark";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[24px] border p-5 shadow-[0_20px_40px_rgba(15,23,42,0.12)]",
        isDark
          ? "border-zinc-900/80 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 text-white"
          : "border-orange-200 bg-gradient-to-br from-orange-500 via-orange-500 to-amber-400 text-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white/90">
          {active ? "Ativo" : "Inativo"}
        </span>

        <div className="relative size-10">
          <span className="absolute left-0 top-0 size-7 rounded-full bg-white/25" />
          <span className="absolute right-0 top-0 size-7 rounded-full bg-black/15" />
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="h-10 w-12 rounded-xl border border-white/20 bg-gradient-to-br from-white/70 to-white/30" />
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.28em] text-white/60">
              Número do cartão
            </p>
            <p className="mt-1 text-base font-semibold tracking-[0.18em] text-white">
              {number}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/55">
            Val.
          </p>
          <p className="mt-1 text-sm font-medium text-white">{exp}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/55">
            CVV
          </p>
          <p className="mt-1 text-sm font-medium text-white">{cvv}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/55">
            Cartão
          </p>
          <p className="mt-1 text-sm font-medium text-white">Débito</p>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ActivityItem["status"] }) {
  const tone =
    status === "Concluído"
      ? "bg-emerald-50 text-emerald-600"
      : status === "Pendente"
        ? "bg-rose-50 text-rose-600"
        : "bg-amber-50 text-amber-600";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
        tone
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "Concluído"
            ? "bg-emerald-500"
            : status === "Pendente"
              ? "bg-rose-500"
              : "bg-amber-500"
        )}
      />
      {status}
    </span>
  );
}

const activityIconMap: Record<
  ActivityItem["kind"],
  { icon: LucideIcon }
> = {
  revenue: { icon: DollarSign },
  fixedCost: { icon: Wallet },
  variableCost: { icon: Receipt },
  purchase: { icon: ShoppingCart },
  payroll: { icon: CreditCard },
  reserve: { icon: PiggyBank },
};

function ActivityIcon({
  kind,
  tone,
}: {
  kind: ActivityItem["kind"];
  tone: ActivityItem["tone"];
}) {
  const colors: Record<
    ActivityItem["tone"],
    { bg: string; text: string; border: string }
  > = {
    emerald: {
      bg: "bg-emerald-50",
      text: "text-emerald-600",
      border: "border-emerald-100",
    },
    rose: {
      bg: "bg-rose-50",
      text: "text-rose-600",
      border: "border-rose-100",
    },
    amber: {
      bg: "bg-amber-50",
      text: "text-amber-600",
      border: "border-amber-100",
    },
    blue: {
      bg: "bg-blue-50",
      text: "text-blue-600",
      border: "border-blue-100",
    },
  };

  const color = colors[tone];
  const Icon = activityIconMap[kind].icon;

  return (
    <div
      className={cn(
        "flex size-10 items-center justify-center rounded-2xl border",
        color.bg,
        color.text,
        color.border
      )}
    >
      <Icon className="size-4" />
    </div>
  );
}

function ResponsiveBarChart({
  data,
}: {
  data: Array<{
    month: string;
    profit: number;
    loss: number;
  }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap={14} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e7e5e4" strokeDasharray="4 10" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={12}
          stroke="#a1a1aa"
          fontSize={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={38}
          stroke="#a1a1aa"
          fontSize={12}
          tickFormatter={value => `${Math.round(Number(value) / 1000)} mil`}
        />
        <Tooltip
          cursor={{ fill: "transparent" }}
          contentStyle={{
            borderRadius: "16px",
            border: "1px solid #e4e4e7",
            background: "#ffffff",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
          }}
          labelStyle={{ color: "#09090b", fontWeight: 600 }}
          itemStyle={{ color: "#52525b" }}
          formatter={(value: number | string, name: string) => [
            formatMoney(Number(value)),
            name === "profit" ? "Receita" : "Despesa",
          ]}
        />
        <Bar dataKey="profit" fill="#1f1f1f" radius={[10, 10, 0, 0]} barSize={18} />
        <Bar dataKey="loss" fill="#f97316" radius={[10, 10, 0, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
