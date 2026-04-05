import { trpc } from "@/lib/trpc";
import { useSupabaseAuth } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMonthYear } from "@/hooks/useMonthYear";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  ChevronDown,
  CreditCard,
  DollarSign,
  Info,
  PiggyBank,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type TabItem = { label: string };

type SnapshotItem = {
  title: string;
  amount: number;
  status: string;
  icon: LucideIcon;
  tone: "emerald" | "amber" | "rose";
  share: number;
};

type SummaryItem = {
  label: string;
  amount: number;
  share: number;
  icon: LucideIcon;
  tone: "emerald" | "amber" | "rose" | "blue" | "slate";
  note: string;
};

const panelClass =
  "rounded-[28px] border border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]";

const dashboardTabs: TabItem[] = [
  { label: "Visao geral" },
  { label: "Fluxo" },
  { label: "Metas" },
  { label: "Dividas" },
  { label: "Investimentos" },
  { label: "Relatorios" },
];

const distributionColors = ["#1f1f1f", "#f97316", "#ef4444", "#10b981"];

export default function DashboardPessoal() {
  const { user } = useSupabaseAuth();
  const { month, year, monthName } = useMonthYear();
  const { data, isLoading } = trpc.dashboard.personal.useQuery({ month, year });
  const [activeTab, setActiveTab] = useState("Visao geral");

  const userName =
    String(user?.user_metadata?.name || user?.email?.split("@")[0] || "")
      .trim() || "Usuário";
  const userEmail = user?.email?.trim() || "";

  const proLaboreGross = parseFloat(data?.settings?.proLaboreGross || "0");
  const tithePercent = parseFloat(data?.settings?.tithePercent || "10");
  const investPercent = parseFloat(data?.settings?.investmentPercent || "10");
  const tithe = proLaboreGross * (tithePercent / 100);
  const investPersonal = proLaboreGross * (investPercent / 100);
  const proLaboreNet = proLaboreGross - tithe - investPersonal;

  const totalFixed = parseFloat(data?.fixedCosts?.total || "0");
  const totalVar = parseFloat(data?.variableCosts?.total || "0");
  const totalDebtsMonthly = parseFloat(data?.debts?.totalMonthly || "0");
  const totalExpenses = totalFixed + totalVar + totalDebtsMonthly;
  const spendingLimit = proLaboreNet > 0 ? proLaboreNet : proLaboreGross;
  const spendingProgress =
    spendingLimit > 0 ? Math.min((totalExpenses / spendingLimit) * 100, 100) : 0;
  const balance = proLaboreNet - totalExpenses;

  const totalInvested = parseFloat(data?.investments?.totalBalance || "0");
  const reserveTotal = parseFloat(data?.reserve?.total || "0");
  const reserveMonths = data?.settings?.personalReserveMonths || 6;
  const reserveGoal = totalExpenses * reserveMonths;
  const reserveProgress =
    reserveGoal > 0 ? Math.min((reserveTotal / reserveGoal) * 100, 100) : 0;
  const patrimonio = totalInvested + reserveTotal;

  const grossShare = proLaboreGross > 0 ? 100 : 0;
  const titheShare = proLaboreGross > 0 ? (tithe / proLaboreGross) * 100 : 0;
  const investShare = proLaboreGross > 0 ? (investPersonal / proLaboreGross) * 100 : 0;
  const netShare = proLaboreGross > 0 ? (proLaboreNet / proLaboreGross) * 100 : 0;
  const debtShare = totalExpenses > 0 ? (totalDebtsMonthly / totalExpenses) * 100 : 0;
  const fixedShare = totalExpenses > 0 ? (totalFixed / totalExpenses) * 100 : 0;
  const variableShare = totalExpenses > 0 ? (totalVar / totalExpenses) * 100 : 0;
  const reserveShare = reserveGoal > 0 ? (reserveTotal / reserveGoal) * 100 : 0;
  const patrimonioShare = proLaboreGross > 0 ? (patrimonio / proLaboreGross) * 100 : 0;
  const balanceShare =
    proLaboreGross > 0 ? (Math.max(balance, 0) / proLaboreGross) * 100 : 0;

  const distribution = [
    { name: "Contas Fixas", value: totalFixed },
    { name: "Contas Variaveis", value: totalVar },
    { name: "Dividas", value: totalDebtsMonthly },
    { name: "Disponivel", value: Math.max(balance, 0) },
  ].filter(item => item.value > 0);

  const summaryRows: SummaryItem[] = [
    {
      label: "Pro-labore bruto",
      amount: proLaboreGross,
      share: grossShare,
      icon: DollarSign,
      tone: "slate",
      note: "Base mensal",
    },
    {
      label: "Dizimo",
      amount: tithe,
      share: titheShare,
      icon: Sparkles,
      tone: "rose",
      note: "Separacao automatica",
    },
    {
      label: "Investimento",
      amount: investPersonal,
      share: investShare,
      icon: PiggyBank,
      tone: "blue",
      note: "Reserva de longo prazo",
    },
    {
      label: "Despesas fixas",
      amount: totalFixed,
      share: fixedShare,
      icon: Wallet,
      tone: "amber",
      note: "Compromissos recorrentes",
    },
    {
      label: "Despesas variaveis",
      amount: totalVar,
      share: variableShare,
      icon: CreditCard,
      tone: "amber",
      note: "Gastos do mes",
    },
    {
      label: "Dividas mensais",
      amount: totalDebtsMonthly,
      share: debtShare,
      icon: TrendingDown,
      tone: "rose",
      note: "Parcelas em aberto",
    },
    {
      label: "Saldo liquido",
      amount: balance,
      share: balanceShare,
      icon: TrendingUp,
      tone: balance >= 0 ? "emerald" : "rose",
      note: "Apos despesas",
    },
    {
      label: "Reserva",
      amount: reserveTotal,
      share: reserveShare,
      icon: PiggyBank,
      tone: "emerald",
      note: "Fundo de emergencia",
    },
    {
      label: "Patrimonio",
      amount: patrimonio,
      share: patrimonioShare,
      icon: PiggyBank,
      tone: "emerald",
      note: "Investimentos + reserva",
    },
  ];

  if (isLoading) {
    return <DashboardPageSkeleton />;
  }

  return (
    <div className="-mx-4 -my-4 min-h-full bg-[#f4f4f2] text-zinc-900 md:-mx-6 md:-my-6">
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="flex size-8 items-center justify-center rounded-full bg-orange-500 text-white shadow-[0_10px_24px_rgba(249,115,22,0.24)]">
              <ArrowUpRight className="size-4 stroke-[2.5]" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-900">
              FinancePro
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
              <HeaderIconButton icon={Search} title="Search" />
              <HeaderIconButton icon={Bell} title="Notifications" badge />
              <HeaderIconButton icon={Info} title="Information" />
            </div>

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
                <p className="truncate text-[11px] text-zinc-500">{userEmail}</p>
              </div>
              <ChevronDown className="size-4 text-zinc-400" />
            </button>
          </div>
        </header>

        <section className="space-y-2 pt-1">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
            Bom dia, {userName.split(" ")[0] || "Dev"}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-500 md:text-base">
            Acompanhe seu saldo, metas e distribuicao mensal com uma leitura rapida.
          </p>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1.05fr]">
          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-500">Saldo do mes</p>
                  <p
                    className={cn(
                      "mt-2 text-3xl font-semibold tracking-tight xl:text-4xl",
                      balance >= 0 ? "text-zinc-900" : "text-rose-600"
                    )}
                  >
                    {formatCurrency(balance)}
                  </p>
                  <p
                    className={cn(
                      "mt-2 flex items-center gap-1.5 text-sm font-medium",
                      balance >= 0 ? "text-emerald-600" : "text-rose-600"
                    )}
                  >
                    {balance >= 0 ? (
                      <ArrowUpRight className="size-4" />
                    ) : (
                      <ArrowDownRight className="size-4" />
                    )}
                    {formatPercent(spendingProgress)} do limite utilizado
                  </p>
                </div>

                <div className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
                  {monthName} {year}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button className="rounded-full bg-zinc-900 px-5 text-white shadow-sm hover:bg-zinc-800">
                  Transferir
                </Button>
                <Button className="rounded-full border border-zinc-200 bg-white px-5 text-zinc-700 shadow-sm hover:bg-zinc-50">
                  Reservar
                </Button>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Despesas</p>
                    <p className="text-xs text-zinc-500">Total 3 categorias</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <SnapshotCard
                    title="Fixas"
                    amount={totalFixed}
                    status="Pago"
                    icon={Wallet}
                    tone="emerald"
                    share={fixedShare}
                  />
                  <SnapshotCard
                    title="Variaveis"
                    amount={totalVar}
                    status="Aberto"
                    icon={CreditCard}
                    tone="amber"
                    share={variableShare}
                  />
                  <SnapshotCard
                    title="Dividas"
                    amount={totalDebtsMonthly}
                    status="Mensal"
                    icon={TrendingDown}
                    tone="rose"
                    share={debtShare}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Liquido Disponivel"
              value={proLaboreNet}
              delta={netShare}
              icon={Sparkles}
              highlighted
              caption="apos separacoes"
            />
            <MetricCard
              label="Pro-labore Bruto"
              value={proLaboreGross}
              delta={grossShare}
              icon={DollarSign}
              caption="base mensal"
            />
            <MetricCard
              label="Dizimo"
              value={tithe}
              delta={titheShare}
              icon={TrendingDown}
              caption="do bruto"
            />
            <MetricCard
              label="Investimento"
              value={investPersonal}
              delta={investShare}
              icon={PiggyBank}
              caption="do bruto"
            />
          </div>

          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Fluxo do mes
                  </CardTitle>
                  <p className="mt-1 text-sm text-zinc-500">
                    Como o saldo foi distribuido entre despesas e disponibilidade
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              {distribution.length > 0 ? (
                <>
                  <div className="h-[320px]">
                    <PersonalDistributionChart data={distribution} />
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center gap-3">
                    {distribution.map((item, index) => (
                      <div key={item.name} className="flex items-center gap-1.5 text-xs">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              distributionColors[index % distributionColors.length],
                          }}
                        />
                        <span className="text-muted-foreground">
                          {item.name}: {formatCurrency(item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-[320px] items-center justify-center text-sm text-zinc-500">
                  Configure seu pro-labore para ver a distribuicao
                </div>
              )}
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
                      Limite de gastos mensal
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {formatCurrency(totalExpenses)} gasto de{" "}
                      {formatCurrency(spendingLimit)}
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
                  <span>{formatCurrency(totalExpenses)} gasto de</span>
                  <span>{formatCurrency(spendingLimit)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(panelClass, "border-zinc-200 py-0")}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Reserva pessoal</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Meta: {formatCurrency(reserveGoal)} ({reserveMonths} meses de despesas)
                    </p>
                  </div>
                </div>

                <div className="mt-5 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                    style={{ width: `${reserveProgress}%` }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                  <span>{formatCurrency(reserveTotal)} acumulado</span>
                  <span>{formatPercent(reserveProgress)} da meta</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardHeader className="p-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Resumo financeiro
                  </CardTitle>
                  <p className="mt-1 text-sm text-zinc-500">
                    Visao consolidada das principais alocacoes
                  </p>
                </div>
                <div className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
                  {monthName} {year}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-5 pt-0">
              <div className="space-y-3">
                {summaryRows.map(row => (
                  <SummaryRow key={row.label} row={row} />
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
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
            <Skeleton className="h-36 rounded-[28px]" />
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
  caption = "do bruto",
}: {
  label: string;
  value: number;
  delta: number;
  icon: LucideIcon;
  highlighted?: boolean;
  caption?: string;
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
              {formatCurrency(value)}
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
          <span
            className={
              highlighted ? "text-xs text-orange-50/90" : "text-xs text-zinc-400"
            }
          >
            {caption}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotCard({
  title,
  amount,
  status,
  icon: Icon,
  tone,
  share,
}: SnapshotItem) {
  const toneClasses: Record<
    SnapshotItem["tone"],
    { icon: string; status: string; fill: string }
  > = {
    emerald: {
      icon: "border-emerald-100 bg-emerald-50 text-emerald-600",
      status: "bg-emerald-50 text-emerald-600",
      fill: "bg-emerald-500/10",
    },
    amber: {
      icon: "border-amber-100 bg-amber-50 text-amber-600",
      status: "bg-amber-50 text-amber-600",
      fill: "bg-amber-500/10",
    },
    rose: {
      icon: "border-rose-100 bg-rose-50 text-rose-600",
      status: "bg-rose-50 text-rose-600",
      fill: "bg-rose-500/10",
    },
  };

  const currentTone = toneClasses[tone];

  return (
    <div className="rounded-[22px] border border-zinc-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl border text-sm font-semibold",
            currentTone.icon
          )}
        >
          <Icon className="size-4" />
        </div>
        <span
          className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", currentTone.status)}
        >
          {status}
        </span>
      </div>

      <div className="mt-4 space-y-1">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="text-lg font-semibold tracking-tight text-zinc-900">
          {formatCurrency(amount)}
        </p>
      </div>

      <div className="mt-4 h-1.5 rounded-full bg-zinc-100">
        <div
          className={cn("h-1.5 rounded-full", currentTone.fill)}
          style={{ width: `${Math.min(share, 100)}%` }}
        />
      </div>
    </div>
  );
}

function SummaryRow({ row }: { row: SummaryItem }) {
  const toneClasses: Record<
    SummaryItem["tone"],
    { icon: string; badge: string }
  > = {
    emerald: {
      icon: "border-emerald-100 bg-emerald-50 text-emerald-600",
      badge: "bg-emerald-50 text-emerald-600",
    },
    amber: {
      icon: "border-amber-100 bg-amber-50 text-amber-600",
      badge: "bg-amber-50 text-amber-600",
    },
    rose: {
      icon: "border-rose-100 bg-rose-50 text-rose-600",
      badge: "bg-rose-50 text-rose-600",
    },
    blue: {
      icon: "border-blue-100 bg-blue-50 text-blue-600",
      badge: "bg-blue-50 text-blue-600",
    },
    slate: {
      icon: "border-zinc-200 bg-zinc-100 text-zinc-600",
      badge: "bg-zinc-100 text-zinc-500",
    },
  };

  const currentTone = toneClasses[row.tone];
  const Icon = row.icon;

  return (
    <div className="flex items-center justify-between gap-4 rounded-[22px] border border-zinc-200 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl border",
            currentTone.icon
          )}
        >
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-900">{row.label}</p>
          <p className="text-xs text-zinc-500">{row.note}</p>
        </div>
      </div>

      <div className="text-right">
        <p className="text-sm font-semibold text-zinc-900">
          {formatCurrency(row.amount)}
        </p>
        <span
          className={cn(
            "mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            currentTone.badge
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              row.tone === "emerald"
                ? "bg-emerald-500"
                : row.tone === "amber"
                  ? "bg-amber-500"
                  : row.tone === "rose"
                    ? "bg-rose-500"
                    : row.tone === "blue"
                      ? "bg-blue-500"
                      : "bg-zinc-500"
            )}
          />
          {formatPercent(row.share)}
        </span>
      </div>
    </div>
  );
}

function PersonalDistributionChart({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  const chartData = data.map((item, index) => ({
    ...item,
    fill: distributionColors[index % distributionColors.length],
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={92}
          paddingAngle={3}
        >
          {chartData.map(item => (
            <Cell key={item.name} fill={item.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#ffffff",
            border: "1px solid #e4e4e7",
            borderRadius: "16px",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
          }}
          labelStyle={{ color: "#09090b", fontWeight: 600 }}
          itemStyle={{ color: "#52525b" }}
          formatter={(value: number | string, name: string) => [
            formatCurrency(Number(value)),
            name,
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
