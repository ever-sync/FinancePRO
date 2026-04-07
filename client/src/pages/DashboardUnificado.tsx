import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useMonthYear } from "@/hooks/useMonthYear";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  ArrowUpRight,
  Briefcase,
  CreditCard,
  PiggyBank,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

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
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">Saldo consolidado</p>
                <p className="mt-2 text-2xl font-semibold">{formatCurrency(consolidatedBalance)}</p>
                <p className="mt-2 text-sm text-white/65">{monthName} {year}</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">Pode gastar agora</p>
                <p className="mt-2 text-2xl font-semibold">{formatCurrency(safeToSpendNow)}</p>
                <p className="mt-2 text-sm text-white/65">
                  Perfil do mentor: {advisorMemory?.profileLabel || getMentorModeLabel()}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {financialFocus.map(item => (
              <div key={item.label} className="rounded-[24px] border border-white/10 bg-black/15 p-4">
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                <p className="mt-2 text-sm text-white/65">{item.note}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        <SummaryCard
          title="Receita liquida da empresa"
          value={formatCurrency(companyNetRevenue)}
          description={`Gastos operacionais atuais em ${formatCurrency(companySpending)}.`}
          icon={Briefcase}
        />
        <SummaryCard
          title="Pro-labore liquido"
          value={formatCurrency(proLaboreNet)}
          description={`Depois de dizimo (${formatPercent(tithePercent / 100)}) e provisao de investimento.`}
          icon={Wallet}
        />
        <SummaryCard
          title="Dividas mensais"
          value={formatCurrency(personalDebtsMonthly)}
          description="Pressao mensal das parcelas pessoais em aberto."
          icon={TrendingDown}
        />
        <SummaryCard
          title="Reserva + investimentos"
          value={formatCurrency(totalReserve + personalInvestments)}
          description="Protecao total somando reservas e carteira pessoal."
          icon={PiggyBank}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <Card className="rounded-[28px] border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
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

        <Card className="rounded-[28px] border-zinc-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
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

            <div className="flex flex-wrap gap-3 pt-2">
              <Button onClick={() => setLocation("/whatsapp/planos")}>
                <Sparkles className="mr-2 size-4" />
                Abrir mentoria financeira
              </Button>
              <Button variant="outline" onClick={() => setLocation("/whatsapp/conversas")}>
                <TrendingUp className="mr-2 size-4" />
                Abrir inbox do mentor
              </Button>
            </div>
          </CardContent>
        </Card>
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
