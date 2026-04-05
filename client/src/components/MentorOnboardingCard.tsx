import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  MessageCircle,
  ShieldCheck,
  Target,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatPercent } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/StatusBadge";

type OnboardingChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
};

type OnboardingStep = {
  key: string;
  title: string;
  description: string;
  status: string;
  progressPercent: number;
  completedItems: number;
  totalItems: number;
  summary: string;
  checklist: OnboardingChecklistItem[];
};

const DEFAULT_SETTINGS_FORM = {
  companyName: "",
  taxPercent: "6",
  proLaboreGross: "0",
  companyReserveMonths: 3,
  personalReserveMonths: 6,
  companyMinCashMonths: "1",
  personalMinCashMonths: "1",
};

const DEFAULT_WHATSAPP_FORM = {
  instanceId: "",
  apiBaseUrl: "https://api.uazapi.com",
  apiToken: "",
  authorizedPhone: "",
  enabled: true,
  automationHour: 8,
  timezone: "America/Sao_Paulo",
};

function getStepBadgeStatus(status?: string) {
  if (status === "complete") return "healthy";
  if (status === "attention") return "attention";
  return "pendente";
}

function getOverallBadgeStatus(status?: string) {
  if (status === "ready") return "healthy";
  if (status === "attention") return "attention";
  return "pendente";
}

function StepChecklist({ items }: { items?: OnboardingChecklistItem[] }) {
  if (!items?.length) {
    return (
      <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        Nenhum criterio carregado para esta etapa.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div
          key={item.id}
          className="flex items-start gap-2 rounded-2xl border bg-zinc-50/70 px-3 py-2 text-sm"
        >
          {item.completed ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          )}
          <span className={item.completed ? "text-zinc-700" : "text-muted-foreground"}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MentorOnboardingCard() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: onboarding, isLoading } = trpc.financialAdvisor.getOnboarding.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();
  const { data: currentPlan } = trpc.assistantPlans.getCurrent.useQuery();
  const { data: whatsappIntegration } = trpc.whatsappIntegration.get.useQuery();

  const [settingsForm, setSettingsForm] = useState(DEFAULT_SETTINGS_FORM);
  const [whatsappForm, setWhatsappForm] = useState(DEFAULT_WHATSAPP_FORM);

  useEffect(() => {
    if (!settings) {
      setSettingsForm(DEFAULT_SETTINGS_FORM);
      return;
    }

    setSettingsForm({
      companyName: settings.companyName || "",
      taxPercent: settings.taxPercent || "6",
      proLaboreGross: settings.proLaboreGross || "0",
      companyReserveMonths: settings.companyReserveMonths || 3,
      personalReserveMonths: settings.personalReserveMonths || 6,
      companyMinCashMonths: settings.companyMinCashMonths || "1",
      personalMinCashMonths: settings.personalMinCashMonths || "1",
    });
  }, [settings]);

  useEffect(() => {
    if (!whatsappIntegration) {
      setWhatsappForm(DEFAULT_WHATSAPP_FORM);
      return;
    }

    setWhatsappForm({
      instanceId: whatsappIntegration.instanceId || "",
      apiBaseUrl: whatsappIntegration.apiBaseUrl || "https://api.uazapi.com",
      apiToken: "",
      authorizedPhone: whatsappIntegration.authorizedPhone || "",
      enabled: whatsappIntegration.enabled ?? true,
      automationHour: whatsappIntegration.automationHour ?? 8,
      timezone: whatsappIntegration.timezone || "America/Sao_Paulo",
    });
  }, [whatsappIntegration]);

  async function refreshOnboardingData() {
    await Promise.all([
      utils.settings.get.invalidate(),
      utils.financialAdvisor.getOnboarding.invalidate(),
      utils.financialAdvisor.getSnapshot.invalidate(),
      utils.financialAdvisor.getDailyDigest.invalidate(),
      utils.financialAdvisor.getMonthClose.invalidate(),
      utils.assistantPlans.getCurrent.invalidate(),
      utils.assistantPlans.list.invalidate(),
      utils.assistantAutomation.list.invalidate(),
      utils.whatsappIntegration.get.invalidate(),
      utils.whatsappIntegration.syncStatus.invalidate(),
      utils.assistantInbox.list.invalidate(),
    ]);
  }

  const saveMentorBaseMut = trpc.settings.upsert.useMutation({
    onSuccess: async () => {
      await refreshOnboardingData();
      toast.success("Base do mentor salva.");
    },
    onError: error => toast.error(error.message),
  });

  const saveWhatsAppMut = trpc.whatsappIntegration.upsert.useMutation({
    onSuccess: async () => {
      await refreshOnboardingData();
      toast.success("Canal do mentor salvo.");
    },
    onError: error => toast.error(error.message),
  });

  const testWhatsAppMut = trpc.whatsappIntegration.testConnection.useMutation({
    onSuccess: async data => {
      await refreshOnboardingData();
      toast.success(data.message);
    },
    onError: error => toast.error(error.message),
  });

  const generatePlanMut = trpc.financialAdvisor.generateMonthlyPlan.useMutation({
    onSuccess: async () => {
      await refreshOnboardingData();
      toast.success("Plano do mentor gerado com a base atual.");
    },
    onError: error => toast.error(error.message),
  });

  const steps = ((onboarding?.steps ?? []) as OnboardingStep[]).reduce<Record<string, OnboardingStep>>(
    (acc, step) => {
      acc[step.key] = step;
      return acc;
    },
    {}
  );

  const profileStep = steps.profile;
  const guardrailsStep = steps.guardrails;
  const dataFoundationStep = steps.data_foundation;
  const whatsappStep = steps.whatsapp_channel;
  const monthlyPlanStep = steps.monthly_plan;
  const dataChecklist = dataFoundationStep?.checklist ?? [];
  const isCompanyRevenueReady = dataChecklist.find(item => item.id === "company_revenue")?.completed ?? false;
  const isCompanyCostsReady = dataChecklist.find(item => item.id === "company_costs")?.completed ?? false;
  const isPersonalCommitmentsReady =
    dataChecklist.find(item => item.id === "personal_commitments")?.completed ?? false;
  const isReserveReady = dataChecklist.find(item => item.id === "reserves")?.completed ?? false;
  const isCalendarReady = dataChecklist.find(item => item.id === "calendar")?.completed ?? false;
  const canSaveWhatsApp = Boolean(
    whatsappForm.instanceId && whatsappForm.apiBaseUrl && whatsappForm.authorizedPhone
  );
  const statementScope =
    !isCompanyRevenueReady || !isCompanyCostsReady
      ? ("empresa" as const)
      : !isPersonalCommitmentsReady || !isReserveReady
        ? ("pessoal" as const)
        : ("misto" as const);
  const recommendedStep = onboarding?.recommendedStepKey
    ? steps[onboarding.recommendedStepKey]
    : undefined;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Carregando onboarding do mentor...
        </CardContent>
      </Card>
    );
  }

  const openImportPreset = (preset: string) => {
    setLocation(`/importador?preset=${preset}&source=mentor-onboarding`);
  };

  const openStatementFlow = (sourceKind: "bank_account" | "credit_card" = "bank_account") => {
    setLocation(
      `/importador?mode=statement&scope=${statementScope}&sourceKind=${sourceKind}&source=mentor-onboarding`
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Onboarding guiado do mentor</CardTitle>
            <CardDescription>
              Feche a base financeira, ligue o canal real e gere o primeiro plano sem ficar
              pulando entre telas soltas.
            </CardDescription>
          </div>
          <StatusBadge status={getOverallBadgeStatus(onboarding?.status)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-3xl border bg-zinc-50/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-zinc-900">
                {onboarding?.headline || "Vamos montar a base do mentor"}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {onboarding?.summary ||
                  "Complete os parametros, protecoes, canal e plano do mes para a mentoria operar com mais profundidade."}
              </p>
              {recommendedStep ? (
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-zinc-400">
                  Proximo melhor passo: {recommendedStep.title}
                </p>
              ) : null}
            </div>
            <div className="min-w-[220px] rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Progresso do onboarding</span>
                <span className="font-medium text-zinc-900">
                  {onboarding?.progressPercent ?? 0}%
                </span>
              </div>
              <Progress value={onboarding?.progressPercent ?? 0} className="mt-3 h-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                {onboarding?.completedSteps ?? 0}/{onboarding?.totalSteps ?? 5} etapas concluídas
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                Cobertura da empresa
              </p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {onboarding?.metrics.companyCoverageCount ?? 0}/3
              </p>
            </div>
            <div className="rounded-2xl border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                Cobertura pessoal
              </p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {onboarding?.metrics.personalCoverageCount ?? 0}/3
              </p>
            </div>
            <div className="rounded-2xl border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                Confianca do snapshot
              </p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">
                {formatPercent(onboarding?.metrics.confidenceScore ?? 0)}
              </p>
            </div>
            <div className="rounded-2xl border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                Canal e plano
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge
                  status={onboarding?.metrics.hasWhatsAppReady ? "healthy" : "attention"}
                />
                <StatusBadge
                  status={onboarding?.metrics.hasCurrentPlan ? "healthy" : "pendente"}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-orange-500" />
                  <p className="text-sm font-medium text-zinc-900">1. Parametros do mentor</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {profileStep?.summary || "Defina empresa, pro-labore e imposto base."}
                </p>
              </div>
              <StatusBadge status={getStepBadgeStatus(profileStep?.status)} />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Nome da empresa</Label>
                <Input
                  value={settingsForm.companyName}
                  onChange={event =>
                    setSettingsForm(current => ({ ...current, companyName: event.target.value }))
                  }
                  placeholder="Minha empresa"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pro-labore bruto</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={settingsForm.proLaboreGross}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      proLaboreGross: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Imposto (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={settingsForm.taxPercent}
                  onChange={event =>
                    setSettingsForm(current => ({ ...current, taxPercent: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                onClick={() =>
                  saveMentorBaseMut.mutate({
                    companyName: settingsForm.companyName,
                    proLaboreGross: settingsForm.proLaboreGross,
                    taxPercent: settingsForm.taxPercent,
                    companyReserveMonths: settingsForm.companyReserveMonths,
                    personalReserveMonths: settingsForm.personalReserveMonths,
                    companyMinCashMonths: settingsForm.companyMinCashMonths,
                    personalMinCashMonths: settingsForm.personalMinCashMonths,
                  })
                }
                disabled={saveMentorBaseMut.isPending}
              >
                {saveMentorBaseMut.isPending ? "Salvando..." : "Salvar parametros"}
              </Button>
            </div>

            <div className="mt-4">
              <StepChecklist items={profileStep?.checklist} />
            </div>
          </div>

          <div className="rounded-3xl border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-orange-500" />
                  <p className="text-sm font-medium text-zinc-900">2. Protecoes de caixa</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {guardrailsStep?.summary ||
                    "Configure reserva e caixa minimo para o mentor parar de olhar so saldo."}
                </p>
              </div>
              <StatusBadge status={getStepBadgeStatus(guardrailsStep?.status)} />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Reserva empresa (meses)</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={settingsForm.companyReserveMonths}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      companyReserveMonths: Number(event.target.value || 3),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reserva pessoal (meses)</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={settingsForm.personalReserveMonths}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      personalReserveMonths: Number(event.target.value || 6),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Caixa minimo empresa</Label>
                <Input
                  type="number"
                  min={0.5}
                  max={12}
                  step="0.5"
                  value={settingsForm.companyMinCashMonths}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      companyMinCashMonths: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Caixa minimo pessoal</Label>
                <Input
                  type="number"
                  min={0.5}
                  max={12}
                  step="0.5"
                  value={settingsForm.personalMinCashMonths}
                  onChange={event =>
                    setSettingsForm(current => ({
                      ...current,
                      personalMinCashMonths: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                onClick={() =>
                  saveMentorBaseMut.mutate({
                    companyName: settingsForm.companyName,
                    proLaboreGross: settingsForm.proLaboreGross,
                    taxPercent: settingsForm.taxPercent,
                    companyReserveMonths: settingsForm.companyReserveMonths,
                    personalReserveMonths: settingsForm.personalReserveMonths,
                    companyMinCashMonths: settingsForm.companyMinCashMonths,
                    personalMinCashMonths: settingsForm.personalMinCashMonths,
                  })
                }
                disabled={saveMentorBaseMut.isPending}
                variant="outline"
              >
                {saveMentorBaseMut.isPending ? "Salvando..." : "Salvar protecoes"}
              </Button>
            </div>

            <div className="mt-4">
              <StepChecklist items={guardrailsStep?.checklist} />
            </div>
          </div>

          <div className="rounded-3xl border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Database className="size-4 text-orange-500" />
                  <p className="text-sm font-medium text-zinc-900">3. Base do mes</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {dataFoundationStep?.summary ||
                    "Quanto melhor a base de dados do mes, mais util fica o mentor."}
                </p>
              </div>
              <StatusBadge status={getStepBadgeStatus(dataFoundationStep?.status)} />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border bg-zinc-50/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Empresa</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">
                  {onboarding?.metrics.companyCoverageCount ?? 0}/3
                </p>
              </div>
              <div className="rounded-2xl border bg-zinc-50/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Pessoal</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">
                  {onboarding?.metrics.personalCoverageCount ?? 0}/3
                </p>
              </div>
              <div className="rounded-2xl border bg-zinc-50/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Cobertura total</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">
                  {onboarding?.metrics.dataCoverageCount ?? 0}/5
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border bg-zinc-50/70 p-4">
              <p className="text-sm font-medium text-zinc-900">Fluxo guiado de importacao</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Se sua base vier de banco, cartao ou planilha, abra o preset certo e suba tudo em lote.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {!isCompanyRevenueReady ? (
                  <Button variant="outline" onClick={() => openImportPreset("revenues")}>
                    Importar receitas do mes
                  </Button>
                ) : null}
                {!isCompanyCostsReady ? (
                  <Button
                    variant="outline"
                    onClick={() => openImportPreset("company_variable_costs")}
                  >
                    Importar custos da empresa
                  </Button>
                ) : null}
                {!isPersonalCommitmentsReady ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => openImportPreset("personal_variable_costs")}
                    >
                      Importar gastos pessoais
                    </Button>
                    <Button variant="outline" onClick={() => openImportPreset("debts")}>
                      Importar dividas
                    </Button>
                  </>
                ) : null}
                {!isReserveReady ? (
                  <>
                    <Button variant="outline" onClick={() => openImportPreset("investments")}>
                      Importar investimentos
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openImportPreset("reserve_company")}
                    >
                      Importar reserva da empresa
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openImportPreset("reserve_personal")}
                    >
                      Importar reserva pessoal
                    </Button>
                  </>
                ) : null}
                <Button variant="outline" onClick={() => setLocation("/importador")}>
                  Abrir importador completo
                </Button>
                <Button variant="outline" onClick={() => openStatementFlow()}>
                  Conciliar extrato bancario
                </Button>
                <Button variant="outline" onClick={() => openStatementFlow("credit_card")}>
                  Conciliar fatura do cartao
                </Button>
                <Button variant="outline" onClick={() => setLocation("/calendario")}>
                  {isCalendarReady ? "Revisar calendario" : "Completar calendario"}
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <StepChecklist items={dataFoundationStep?.checklist} />
            </div>
          </div>

          <div className="rounded-3xl border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MessageCircle className="size-4 text-orange-500" />
                  <p className="text-sm font-medium text-zinc-900">4. Canal no WhatsApp</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {whatsappStep?.summary ||
                    "Conecte o numero principal para receber a mentoria fora do painel."}
                </p>
              </div>
              <StatusBadge status={getStepBadgeStatus(whatsappStep?.status)} />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Instance ID</Label>
                <Input
                  value={whatsappForm.instanceId}
                  onChange={event =>
                    setWhatsappForm(current => ({ ...current, instanceId: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>API base URL</Label>
                <Input
                  value={whatsappForm.apiBaseUrl}
                  onChange={event =>
                    setWhatsappForm(current => ({ ...current, apiBaseUrl: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Token da instancia</Label>
                <Input
                  type="password"
                  placeholder={
                    whatsappIntegration?.maskedApiToken || "Cole aqui o token da instancia"
                  }
                  value={whatsappForm.apiToken}
                  onChange={event =>
                    setWhatsappForm(current => ({ ...current, apiToken: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Numero autorizado</Label>
                <Input
                  placeholder="5511999999999"
                  value={whatsappForm.authorizedPhone}
                  onChange={event =>
                    setWhatsappForm(current => ({
                      ...current,
                      authorizedPhone: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hora da automacao</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={whatsappForm.automationHour}
                  onChange={event =>
                    setWhatsappForm(current => ({
                      ...current,
                      automationHour: Number(event.target.value || 8),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Input
                  value={whatsappForm.timezone}
                  onChange={event =>
                    setWhatsappForm(current => ({ ...current, timezone: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3">
              <input
                id="mentor-onboarding-whatsapp-enabled"
                type="checkbox"
                checked={whatsappForm.enabled}
                onChange={event =>
                  setWhatsappForm(current => ({ ...current, enabled: event.target.checked }))
                }
              />
              <Label htmlFor="mentor-onboarding-whatsapp-enabled" className="cursor-pointer">
                Assistente habilitado
              </Label>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  testWhatsAppMut.mutate({
                    instanceId: whatsappForm.instanceId,
                    apiBaseUrl: whatsappForm.apiBaseUrl,
                    apiToken: whatsappForm.apiToken || undefined,
                  })
                }
                disabled={testWhatsAppMut.isPending || !whatsappForm.instanceId || !whatsappForm.apiBaseUrl}
              >
                {testWhatsAppMut.isPending ? "Testando..." : "Testar conexao"}
              </Button>
              <Button
                onClick={() =>
                  saveWhatsAppMut.mutate({
                    instanceId: whatsappForm.instanceId,
                    apiBaseUrl: whatsappForm.apiBaseUrl,
                    apiToken: whatsappForm.apiToken || undefined,
                    authorizedPhone: whatsappForm.authorizedPhone,
                    enabled: whatsappForm.enabled,
                    automationHour: whatsappForm.automationHour,
                    timezone: whatsappForm.timezone,
                  })
                }
                disabled={saveWhatsAppMut.isPending || !canSaveWhatsApp}
              >
                {saveWhatsAppMut.isPending ? "Salvando..." : "Salvar canal"}
              </Button>
            </div>

            <div className="mt-4">
              <StepChecklist items={whatsappStep?.checklist} />
            </div>
          </div>

          <div className="rounded-3xl border p-5 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Target className="size-4 text-orange-500" />
                  <p className="text-sm font-medium text-zinc-900">5. Primeiro plano do mes</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {monthlyPlanStep?.summary ||
                    "Transforme a base atual em um plano com prioridades e limite seguro."}
                </p>
              </div>
              <StatusBadge status={getStepBadgeStatus(monthlyPlanStep?.status)} />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border bg-zinc-50/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                    Confianca da leitura atual
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-900">
                    {formatPercent(onboarding?.metrics.confidenceScore ?? 0)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Quanto maior a base e a cobertura do mes, mais firme fica a recomendacao do mentor.
                  </p>
                </div>

                <div className="rounded-2xl border bg-zinc-50/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                    Plano vigente
                  </p>
                  <p className="mt-1 text-lg font-semibold text-zinc-900">
                    {currentPlan
                      ? `${String(currentPlan.periodMonth).padStart(2, "0")}/${currentPlan.periodYear}`
                      : "Nenhum plano do mes"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {currentPlan?.summary ||
                      "Gere o plano do mes para o mentor organizar prioridades, caixa e proxima acao."}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <StepChecklist items={monthlyPlanStep?.checklist} />

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setLocation("/whatsapp/conversas")}>
                    Abrir inbox do mentor
                  </Button>
                  <Button
                    onClick={() => generatePlanMut.mutate()}
                    disabled={generatePlanMut.isPending}
                  >
                    {generatePlanMut.isPending
                      ? "Gerando..."
                      : currentPlan
                        ? "Atualizar plano do mes"
                        : "Gerar primeiro plano"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
