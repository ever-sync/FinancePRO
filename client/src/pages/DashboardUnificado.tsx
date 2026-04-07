import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useMonthYear } from "@/hooks/useMonthYear";
<<<<<<< ours
import { formatCurrency, formatPercent } from "@/lib/format";
=======
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
>>>>>>> theirs
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  ChevronDown,
  CreditCard,
  PiggyBank,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const panelClass =
  "rounded-[28px] border border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]";

const distributionColors = ["#1f1f1f", "#f97316", "#ef4444", "#10b981"];

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMentorModeLabel(mode?: string) {
  if (mode === "execution_short") return "Execucao curta";
  if (mode === "strategic") return "Estrategico";
  return "Calibracao";
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Wallet;
}) {
  return (
    <Card className="rounded-[28px] border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="mt-2 text-2xl">{value}</CardTitle>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
            <Icon className="size-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

<<<<<<< ours
=======
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-900">{value}</span>
    </div>
  );
}

function HeaderPill({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition",
        active ? "bg-zinc-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)]" : "text-zinc-500"
      )}
    >
      {label}
    </div>
  );
}

function HeaderIconButton({
  icon: Icon,
  title,
  badge = false,
}: {
  icon: typeof Sparkles;
  title: string;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="relative flex size-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
    >
      <Icon className="size-4" />
      {badge ? <span className="absolute right-1 top-1 size-2 rounded-full bg-orange-500 ring-2 ring-white" /> : null}
    </button>
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

function MetricCard({
  label,
  value,
  icon: Icon,
  highlighted = false,
  caption,
}: {
  label: string;
  value: number;
  icon: typeof Wallet;
  highlighted?: boolean;
  caption: string;
}) {
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
            <p className={cn("text-sm", highlighted ? "text-white/80" : "text-zinc-500")}>{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{formatCurrency(value)}</p>
            <p className={cn("mt-2 text-sm", highlighted ? "text-white/80" : "text-zinc-500")}>{caption}</p>
          </div>
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-2xl",
              highlighted ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-700"
            )}
          >
            <Icon className="size-4" />
          </div>
        </div>
      </CardContent>
    </Card>
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
            formatCurrency(Number(value)),
            name === "profit" ? "Receita" : "Despesa",
          ]}
        />
        <Bar dataKey="profit" fill="#1f1f1f" radius={[10, 10, 0, 0]} barSize={18} />
        <Bar dataKey="loss" fill="#f97316" radius={[10, 10, 0, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
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
          formatter={(value: number | string, name: string) => [formatCurrency(Number(value)), name]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

>>>>>>> theirs
export default function DashboardUnificado() {
  const [, setLocation] = useLocation();
  const { month, year, monthName } = useMonthYear();
  const companyQuery = trpc.dashboard.company.useQuery({ month, year });
  const personalQuery = trpc.dashboard.personal.useQuery({ month, year });
  const advisorSnapshotQuery = trpc.financialAdvisor.getSnapshot.useQuery();
  const advisorMemoryQuery = trpc.financialAdvisor.getMemory.useQuery();
  const dailyDigestQuery = trpc.financialAdvisor.getDailyDigest.useQuery();

  const isLoading =
    companyQuery.isLoading ||
    personalQuery.isLoading ||
    advisorSnapshotQuery.isLoading ||
    advisorMemoryQuery.isLoading ||
    dailyDigestQuery.isLoading;

  const company = companyQuery.data;
  const personal = personalQuery.data;
  const advisorSnapshot = advisorSnapshotQuery.data;
  const advisorMemory = advisorMemoryQuery.data;
  const dailyDigest = dailyDigestQuery.data;

  const companyCurrent = company?.summary?.current;
  const companyChartData = company?.chartSeries ?? [];
  const companyNetRevenue = asNumber(companyCurrent?.netRevenue ?? company?.revenue?.totalNet);
  const companySpending = asNumber(companyCurrent?.spending);
  const companyProfit = asNumber(companyCurrent?.profit);
  const companyReserve = asNumber(companyCurrent?.reserve ?? company?.reserve?.total);
  const companyBalance = asNumber(companyCurrent?.balance ?? companyProfit + companyReserve);

  const proLaboreGross = asNumber(personal?.settings?.proLaboreGross);
  const tithePercent = asNumber(personal?.settings?.tithePercent || "10");
  const investmentPercent = asNumber(personal?.settings?.investmentPercent || "10");
  const personalTithe = proLaboreGross * (tithePercent / 100);
  const personalInvestmentProvision = proLaboreGross * (investmentPercent / 100);
  const proLaboreNet = proLaboreGross - personalTithe - personalInvestmentProvision;
  const personalFixed = asNumber(personal?.fixedCosts?.total);
  const personalVariable = asNumber(personal?.variableCosts?.total);
  const personalDebtsMonthly = asNumber(personal?.debts?.totalMonthly);
  const personalExpenses = personalFixed + personalVariable + personalDebtsMonthly;
  const personalBalance = proLaboreNet - personalExpenses;
  const personalReserve = asNumber(personal?.reserve?.total);
  const personalInvestments = asNumber(personal?.investments?.totalBalance);
  const personalPatrimony = personalReserve + personalInvestments;

  const totalReserve = companyReserve + personalReserve;
  const consolidatedBalance = companyBalance + personalBalance;
  const safeToSpendNow = asNumber(advisorSnapshot?.safeToSpendNow);
  const topRecommendations = advisorSnapshot?.topRecommendations ?? [];
  const advisorAlerts = dailyDigest?.alerts ?? [];
  const personalDistribution = [
    { name: "Contas Fixas", value: personalFixed },
    { name: "Contas Variaveis", value: personalVariable },
    { name: "Dividas", value: personalDebtsMonthly },
    { name: "Disponivel", value: Math.max(personalBalance, 0) },
  ].filter(item => item.value > 0);

  const financialFocus = useMemo(
    () => [
      {
        label: "Empresa",
        value: formatCurrency(companyBalance),
        note: `Lucro estimado de ${formatCurrency(companyProfit)} no mes.`,
      },
      {
        label: "Pessoal",
        value: formatCurrency(personalBalance),
        note: `Despesas pessoais em ${formatCurrency(personalExpenses)} no mes.`,
      },
      {
        label: "Reserva total",
        value: formatCurrency(totalReserve),
        note: `Empresa + pessoal protegidos em um unico lugar.`,
      },
      {
        label: "Patrimonio pessoal",
        value: formatCurrency(personalPatrimony),
        note: `Reserva e investimentos da pessoa fisica.`,
      },
    ],
    [companyBalance, companyProfit, personalBalance, personalExpenses, totalReserve, personalPatrimony]
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-[28px]" />
        <div className="grid gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40 rounded-[28px]" />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-[420px] rounded-[28px]" />
          <Skeleton className="h-[420px] rounded-[28px]" />
        </div>
      </div>
    );
  }

  return (
<<<<<<< ours
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-[32px] border-zinc-200 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.16),_transparent_36%),linear-gradient(135deg,#18181b_0%,#27272a_55%,#3f3f46_100%)] text-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
        <CardContent className="space-y-6 p-6 md:p-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-white/80">
                <ArrowUpRight className="size-3.5" />
                Dashboard unico
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                  Tudo da empresa e da pessoa fisica em uma unica visao
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70 md:text-base">
                  Veja caixa, pro-labore, reserva, dividas, patrimonio e orientacoes do mentor no mesmo painel.
                </p>
              </div>
=======
    <div className="-mx-4 -my-4 min-h-full bg-[#f4f4f2] text-zinc-900 md:-mx-6 md:-my-6">
      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="flex size-8 items-center justify-center rounded-full bg-orange-500 text-white shadow-[0_10px_24px_rgba(249,115,22,0.24)]">
              <ArrowUpRight className="size-4 stroke-[2.5]" />
>>>>>>> theirs
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-900">FinancePro</span>
          </div>

          <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <HeaderPill label="Central executiva" active />
            <HeaderPill label="Empresa + pessoa fisica" />
            <HeaderPill label={`${monthName} ${year}`} />
          </div>

          <div className="flex items-center gap-2 self-end xl:self-auto">
            <HeaderIconButton icon={Sparkles} title="Mentor" />
            <HeaderIconButton icon={Bell} title="Alertas" badge={financialPressureCount > 0} />
            <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
                FP
              </div>
<<<<<<< ours
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">Pode gastar agora</p>
                <p className="mt-2 text-2xl font-semibold">{formatCurrency(safeToSpendNow)}</p>
                <p className="mt-2 text-sm text-white/65">
                  Perfil do mentor: {advisorMemory?.profileLabel || getMentorModeLabel()}
                </p>
=======
              <div className="hidden text-left sm:block">
                <p className="text-[13px] font-medium text-zinc-900">Painel central</p>
                <p className="text-[11px] text-zinc-500">Tudo em um lugar</p>
>>>>>>> theirs
              </div>
              <ChevronDown className="size-4 text-zinc-400" />
            </div>
          </div>
        </header>

        <section className="space-y-2 pt-1">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
            Um dashboard para decidir o que fazer agora
          </h1>
          <p className="max-w-3xl text-sm text-zinc-500 md:text-base">
            Veja empresa e pessoa fisica juntas, entenda o que pressiona o caixa e use o painel como a central do app.
          </p>
        </section>

        <section className={cn(panelClass, "p-5")}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-zinc-400">
                Copiloto financeiro
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                Guardrails consolidados do mes
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-zinc-500">
                {advisorMemory?.summary || dailyDigest?.message || "Leitura consolidada do mes em empresa e pessoa fisica."}
              </p>
            </div>
            <div className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-700">
              {advisorMemory?.profileLabel || "Calibracao"}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {decisionCards.map(card => (
              <AdvisorMetricCard
                key={card.title}
                label={card.title}
                value={card.value}
                note={card.description}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1.05fr]">
          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-500">Saldo consolidado</p>
                  <p
                    className={cn(
                      "mt-2 text-3xl font-semibold tracking-tight xl:text-4xl",
                      consolidatedBalance >= 0 ? "text-zinc-900" : "text-rose-600"
                    )}
                  >
                    {formatCurrency(consolidatedBalance)}
                  </p>
                  <p
                    className={cn(
                      "mt-2 flex items-center gap-1.5 text-sm font-medium",
                      consolidatedBalance >= 0 ? "text-emerald-600" : "text-rose-600"
                    )}
                  >
                    {consolidatedBalance >= 0 ? (
                      <ArrowUpRight className="size-4" />
                    ) : (
                      <ArrowDownRight className="size-4" />
                    )}
                    {financialPressureCount} sinal(is) pressionando a operacao
                  </p>
                </div>

                <div className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
                  {monthName} {year}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button className="rounded-full bg-zinc-900 px-5 text-white shadow-sm hover:bg-zinc-800" onClick={() => setLocation("/whatsapp/planos")}>
                  Mentor
                </Button>
                <Button className="rounded-full border border-zinc-200 bg-white px-5 text-zinc-700 shadow-sm hover:bg-zinc-50" onClick={() => setLocation("/importador")}>
                  Importar dados
                </Button>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {financialFocus.slice(0, 4).map(item => (
                  <div key={item.label} className="rounded-[24px] border border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-sm font-medium text-zinc-900">{item.label}</p>
                    <p className="mt-2 text-xl font-semibold text-zinc-950">{item.value}</p>
                    <p className="mt-2 text-xs text-zinc-500">{item.note}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Receita liquida"
              value={companyNetRevenue}
              caption={`empresa`}
              icon={Briefcase}
              highlighted
            />
            <MetricCard
              label="Pro-labore liquido"
              value={proLaboreNet}
              caption={`pessoa fisica`}
              icon={Wallet}
            />
            <MetricCard
              label="Dividas mensais"
              value={personalDebtsMonthly}
              caption={`${personalDebtCount} ativa(s)`}
              icon={TrendingDown}
            />
            <MetricCard
              label="Reserva + investimentos"
              value={totalReserve + personalInvestments}
              caption="protecao total"
              icon={PiggyBank}
            />
          </div>

<<<<<<< ours
=======
          <Card className={cn(panelClass, "border-zinc-200 py-0")}>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Receita e despesa da empresa
                  </CardTitle>
                  <p className="mt-1 text-sm text-zinc-500">
                    Reaproveitando a leitura visual do dashboard original.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="h-[320px]">
                <ResponsiveBarChart data={companyChartData} />
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <Card className={cn(panelClass, "border-zinc-200 py-0")}>
          <CardHeader>
            <CardTitle>Centro de decisao</CardTitle>
            <CardDescription>Os numeros que precisam aparecer antes de qualquer gasto, retirada ou novo compromisso.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {decisionCards.map(card => (
              <div key={card.title} className="rounded-[24px] border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{card.title}</p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-950">{card.value}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{card.description}</p>
                  </div>
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-white text-zinc-700 shadow-sm">
                    <card.icon className="size-4" />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className={cn(panelClass, "border-zinc-200 py-0")}>
          <CardHeader>
            <CardTitle>Fluxo pessoal do mes</CardTitle>
            <CardDescription>Distribuicao visual da pessoa fisica reaproveitando seu grafico original.</CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {personalDistribution.length > 0 ? (
              <>
                <div className="h-[280px]">
                  <PersonalDistributionChart data={personalDistribution} />
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  {personalDistribution.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-1.5 text-xs">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: distributionColors[index % distributionColors.length] }}
                      />
                      <span className="text-muted-foreground">
                        {item.name}: {formatCurrency(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[280px] items-center justify-center text-sm text-zinc-500">
                Configure seu pro-labore para ver a distribuicao pessoal.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={cn(panelClass, "border-zinc-200 py-0")}>
        <CardHeader>
          <CardTitle>Painel de pressao financeira</CardTitle>
          <CardDescription>Resumo unificado do que mais aperta caixa, rotina e previsibilidade.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pressureRows.map(item => (
            <div key={item.label} className="rounded-[24px] border border-zinc-200 p-4">
              <p className="text-sm font-medium text-zinc-900">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-950">{item.value}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{item.note}</p>
            </div>
          ))}
        </CardContent>
      </Card>

>>>>>>> theirs
      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <Card className={cn(panelClass, "border-zinc-200 py-0")}>
          <CardHeader>
            <CardTitle>Visao consolidada do mes</CardTitle>
            <CardDescription>Empresa e pessoal separados nas contas, mas juntos na leitura executiva.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center gap-2 text-zinc-800">
                  <Briefcase className="size-4" />
                  <p className="font-medium">Empresa</p>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <DataRow label="Receita liquida" value={formatCurrency(companyNetRevenue)} />
                  <DataRow label="Gastos operacionais" value={formatCurrency(companySpending)} />
                  <DataRow label="Lucro estimado" value={formatCurrency(companyProfit)} />
                  <DataRow label="Caixa + reserva" value={formatCurrency(companyBalance)} />
                </div>
              </div>

              <div className="rounded-[24px] border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center gap-2 text-zinc-800">
                  <CreditCard className="size-4" />
                  <p className="font-medium">Pessoa fisica</p>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <DataRow label="Pro-labore liquido" value={formatCurrency(proLaboreNet)} />
                  <DataRow label="Despesas totais" value={formatCurrency(personalExpenses)} />
                  <DataRow label="Saldo pessoal" value={formatCurrency(personalBalance)} />
                  <DataRow label="Patrimonio" value={formatCurrency(personalPatrimony)} />
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-zinc-200 p-4">
              <p className="text-sm font-medium text-zinc-900">Leitura do mentor para agora</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {dailyDigest?.message ||
                  advisorMemory?.summary ||
                  "Assim que o mentor consolidar o mes, a leitura diaria aparecera aqui."}
              </p>
              {advisorAlerts.length ? (
                <div className="mt-4 grid gap-2">
                  {advisorAlerts.slice(0, 3).map((alert: string) => (
                    <div
                      key={alert}
                      className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                    >
                      {alert}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className={cn(panelClass, "border-zinc-200 py-0")}>
          <CardHeader>
            <CardTitle>Prioridades do mentor</CardTitle>
            <CardDescription>As proximas acoes mais importantes para manter empresa e vida pessoal sob controle.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topRecommendations.length ? (
              topRecommendations.slice(0, 5).map((recommendation, index) => (
                <div key={`${recommendation.kind}-${index}`} className="rounded-[24px] border border-zinc-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-zinc-900">{recommendation.title}</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-600">{recommendation.description}</p>
                    </div>
                    <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                      #{index + 1}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-zinc-200 p-6 text-sm text-muted-foreground">
                O mentor ainda nao gerou recomendacoes fortes para este ciclo.
              </div>
            )}

            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              {quickActions.map(action => (
                <Button
                  key={action.path}
                  variant="outline"
                  className="justify-start rounded-2xl"
                  onClick={() => setLocation(action.path)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-900">{value}</span>
    </div>
  );
}
