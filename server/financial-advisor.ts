import { TRPCError } from "@trpc/server";
import { invokeLLM, type Message } from "./_core/llm";
import {
  detectFinancialAssistantIntent,
  extractDecisionAmount,
  extractInstallmentCount,
  type FinancialAssistantIntent,
} from "./_core/financialAssistantIntent";
import * as db from "./db";
import * as advisorDb from "./db/financial-advisor";
import * as whatsappDb from "./db/whatsapp";

type AnyRecord = Record<string, any>;

export type RevenueFollowUpTarget = {
  revenueId: number;
  description: string;
  clientName?: string | null;
  status: string;
  dueDate: string;
  value: number;
};

export type RevenueReceiptTarget = {
  revenueId: number;
  description: string;
  clientName?: string | null;
  dueDate: string;
  value: number;
};

export type DebtRenegotiationTarget = {
  debtId: number;
  creditor: string;
  description: string;
  currentBalance: number;
  monthlyPayment: number;
  priority: "alta" | "media" | "baixa";
  status: string;
};

export type PaymentPrioritySourceType =
  | "company_fixed_cost"
  | "company_variable_cost"
  | "personal_fixed_cost"
  | "personal_variable_cost"
  | "debt"
  | "employee_payroll";

export type PaymentPriorityItem = {
  id: string;
  title: string;
  source: "calendar" | "debt" | "company" | "personal";
  dueDate: string;
  amount: number;
  status: string;
  urgency: "overdue" | "before_next_income" | "due_soon" | "planned";
  recommendedAction: string;
  sourceId?: number | null;
  sourceType?: PaymentPrioritySourceType | null;
  actionable?: boolean;
};

export type FinancialRecommendation = {
  kind:
    | "freeze_discretionary"
    | "charge_follow_up"
    | "register_revenue_receipt"
    | "renegotiate_debt"
    | "transfer_company_reserve"
    | "transfer_personal_reserve"
    | "protect_tax_provision"
    | "pay_priority_items"
    | "review_variable_costs";
  title: string;
  description: string;
  amount?: number;
  requiresConfirmation?: boolean;
  metadata?: AnyRecord;
};

export type FinancialBudgetGuardrails = {
  company: {
    grossRevenue: number;
    netRevenue: number;
    fixedCosts: number;
    variableCosts: number;
    employeeCosts: number;
    purchaseCosts: number;
    taxProvision: number;
    proLabore: number;
    essentialMonthly: number;
    projectedCash: number;
    reserveTotal: number;
    reserveGoal: number;
    reserveShortfall: number;
    reserveRecommendation: number;
    minCashTarget: number;
  };
  personal: {
    proLaboreGross: number;
    availableIncome: number;
    titheAmount: number;
    investmentAmount: number;
    fixedCosts: number;
    variableCosts: number;
    debtMonthly: number;
    essentialMonthly: number;
    projectedCash: number;
    reserveTotal: number;
    reserveGoal: number;
    reserveShortfall: number;
    reserveRecommendation: number;
    minCashTarget: number;
  };
};

export type FinancialGovernanceSnapshot = {
  generatedAt: string;
  referenceDate: string;
  month: number;
  year: number;
  safeToSpendNow: number;
  safeToSpendMonth: number;
  protectedCash: number;
  taxProvision: number;
  companyReserveRecommendation: number;
  personalReserveRecommendation: number;
  paymentPriority: PaymentPriorityItem[];
  cashRiskLevel: "healthy" | "attention" | "critical";
  confidenceScore: number;
  nextIncomingDate: string | null;
  counts: {
    overdueItems: number;
    dueThisWeek: number;
    overdueCharges: number;
    pendingCharges: number;
    pendingPlanActions: number;
  };
  guardrails: FinancialBudgetGuardrails;
  summary: string;
  topRecommendations: FinancialRecommendation[];
};

export type FinancialPlanSummary = {
  plan: Awaited<ReturnType<typeof whatsappDb.upsertFinancialPlan>>;
  actions: Awaited<ReturnType<typeof whatsappDb.replaceFinancialPlanActions>>;
  snapshot: FinancialGovernanceSnapshot;
  messageToUser: string;
};

export type FinancialDecisionKind =
  | "withdrawal"
  | "personal_spend"
  | "monthly_cost"
  | "hiring"
  | "installment_purchase"
  | "recurring_withdrawal";

export type FinancialDecisionMetric = {
  label: string;
  value: number;
  format: "currency" | "percent" | "number";
};

export type FinancialDecisionAssessment = {
  kind: FinancialDecisionKind;
  tone: FinancialGovernanceSnapshot["cashRiskLevel"];
  amount: number;
  summary: string;
  note: string;
  consumptionPercent: number;
  metrics: FinancialDecisionMetric[];
  metadata?: AnyRecord;
};

export type FinancialDecisionScenarioSet = {
  headrooms: {
    company: number;
    personal: number;
    personalUsable: number;
    total: number;
  };
  scenarios: {
    withdrawal: FinancialDecisionAssessment;
    personalSpend: FinancialDecisionAssessment;
    monthlyCost: FinancialDecisionAssessment;
    hiring: FinancialDecisionAssessment;
    installmentPurchase: FinancialDecisionAssessment;
    recurringWithdrawal: FinancialDecisionAssessment;
  };
};

export type FinancialAdvisorOnboardingChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
};

export type FinancialAdvisorOnboardingStepKey =
  | "profile"
  | "guardrails"
  | "data_foundation"
  | "whatsapp_channel"
  | "monthly_plan";

export type FinancialAdvisorOnboardingStep = {
  key: FinancialAdvisorOnboardingStepKey;
  title: string;
  description: string;
  status: "complete" | "attention" | "pending";
  progressPercent: number;
  completedItems: number;
  totalItems: number;
  summary: string;
  checklist: FinancialAdvisorOnboardingChecklistItem[];
};

export type FinancialAdvisorOnboardingState = {
  status: "ready" | "attention" | "setup";
  headline: string;
  summary: string;
  progressPercent: number;
  completedSteps: number;
  totalSteps: number;
  recommendedStepKey: FinancialAdvisorOnboardingStepKey | null;
  steps: FinancialAdvisorOnboardingStep[];
  metrics: {
    confidenceScore: number;
    companyCoverageCount: number;
    personalCoverageCount: number;
    dataCoverageCount: number;
    hasWhatsAppReady: boolean;
    hasCurrentPlan: boolean;
  };
};

export type FinancialAdvisorMemorySignal = {
  id: string;
  label: string;
  status: "healthy" | "attention" | "critical";
  value: string;
};

export type FinancialAdvisorMemoryState = {
  headline: string;
  summary: string;
  profileLabel: string;
  consistencyScore: number;
  executionScore: number;
  recurringRiskLevel: "healthy" | "attention" | "critical";
  trendDirection: "improving" | "stable" | "worsening";
  historyMonths: number;
  signals: FinancialAdvisorMemorySignal[];
};

export type FinancialAdvisorMentorMode =
  | "execution_short"
  | "strategic"
  | "calibration";

type FinancialAdvisorContext = {
  generatedAt: string;
  referenceDate: string;
  month: number;
  year: number;
  settings: AnyRecord | null;
  company: AnyRecord | null;
  personal: AnyRecord | null;
  calendarItems: Array<{
    day: number;
    description: string;
    amount: string;
    type: string;
    status: string;
    sourceId?: number;
    sourceType?: string;
    actionable?: boolean;
  }>;
  debts: AnyRecord[];
  investments: AnyRecord[];
  reserveFunds: AnyRecord[];
  receivables: AnyRecord[];
};

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function toNumber(value: string | number | null | undefined) {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampCurrency(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function clampPercent(value: number) {
  return Math.max(
    0,
    Math.min(100, Math.round(Number.isFinite(value) ? value : 0))
  );
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function diffInDays(from: Date, to: Date) {
  const day = 24 * 60 * 60 * 1000;
  return Math.floor(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      day
  );
}

function getPartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    iso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildIsoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysRemainingInMonth(referenceDate: Date, timeZone: string) {
  const parts = getPartsInTimeZone(referenceDate, timeZone);
  return Math.max(
    getLastDayOfMonth(parts.year, parts.month) - parts.day + 1,
    1
  );
}

function buildSummary(snapshot: Omit<FinancialGovernanceSnapshot, "summary">) {
  if (snapshot.cashRiskLevel === "critical") {
    return "Caixa crítico: priorize vencidos, proteja o caixa mínimo e congele gastos discricionários até recuperar folga.";
  }
  if (snapshot.cashRiskLevel === "attention") {
    return "Caixa em atenção: siga a ordem de pagamento, recomponha a reserva com moderação e evite ampliar gastos variáveis.";
  }
  return "Caixa saudável: mantenha a disciplina dos vencimentos, proteja a reserva e use o limite seguro como teto de gasto do período.";
}

function buildOnboardingStep(params: {
  key: FinancialAdvisorOnboardingStepKey;
  title: string;
  description: string;
  checklist: FinancialAdvisorOnboardingChecklistItem[];
  emptySummary: string;
  partialSummary: string;
  completeSummary: string;
}) {
  const completedItems = params.checklist.filter(item => item.completed).length;
  const totalItems = params.checklist.length;
  const progressPercent =
    totalItems > 0 ? clampPercent((completedItems / totalItems) * 100) : 0;
  const status =
    completedItems === totalItems
      ? ("complete" as const)
      : completedItems > 0
        ? ("attention" as const)
        : ("pending" as const);

  return {
    key: params.key,
    title: params.title,
    description: params.description,
    status,
    progressPercent,
    completedItems,
    totalItems,
    summary:
      status === "complete"
        ? params.completeSummary
        : status === "attention"
          ? params.partialSummary
          : params.emptySummary,
    checklist: params.checklist,
  } satisfies FinancialAdvisorOnboardingStep;
}

function parseActionMetadata(value?: string | null) {
  if (!value) return {} as AnyRecord;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as AnyRecord)
      : ({} as AnyRecord);
  } catch {
    return {} as AnyRecord;
  }
}

function buildExecutedActionMetadata(base: AnyRecord, extra: AnyRecord) {
  return JSON.stringify({
    ...base,
    execution: {
      ...(base.execution && typeof base.execution === "object"
        ? base.execution
        : {}),
      ...extra,
    },
  });
}

function isActionablePaymentPriorityItem(
  item?: Pick<
    PaymentPriorityItem,
    "sourceId" | "sourceType" | "actionable"
  > | null
) {
  return Boolean(
    item &&
      item.actionable !== false &&
      typeof item.sourceId === "number" &&
      item.sourceId > 0 &&
      item.sourceType &&
      item.sourceType !== "employee_payroll"
  );
}

function normalizePaymentPriorityItem(
  value?: AnyRecord | null
): PaymentPriorityItem | null {
  if (!value || typeof value !== "object") return null;

  const sourceId =
    typeof value.sourceId === "number"
      ? value.sourceId
      : Number.isFinite(Number(value.sourceId))
        ? Number(value.sourceId)
        : null;
  const sourceType =
    typeof value.sourceType === "string"
      ? (value.sourceType as PaymentPrioritySourceType)
      : null;

  return {
    id: String(value.id ?? ""),
    title: String(value.title ?? value.description ?? "Prioridade financeira"),
    source:
      value.source === "company" ||
      value.source === "personal" ||
      value.source === "debt" ||
      value.source === "calendar"
        ? value.source
        : "calendar",
    dueDate: String(value.dueDate ?? ""),
    amount: clampCurrency(toNumber(value.amount ?? 0)),
    status: String(value.status ?? ""),
    urgency:
      value.urgency === "overdue" ||
      value.urgency === "before_next_income" ||
      value.urgency === "due_soon" ||
      value.urgency === "planned"
        ? value.urgency
        : "planned",
    recommendedAction: String(
      value.recommendedAction ?? "Acompanhar no calendario do mes."
    ),
    sourceId,
    sourceType,
    actionable:
      value.actionable !== false &&
      Boolean(sourceId && sourceType && sourceType !== "employee_payroll"),
  };
}

function findFirstActionablePaymentPriorityItem(
  paymentPriority: PaymentPriorityItem[]
) {
  return (
    paymentPriority.find(item => isActionablePaymentPriorityItem(item)) ?? null
  );
}

function normalizeRevenueFollowUpTarget(
  value?: AnyRecord | null
): RevenueFollowUpTarget | null {
  if (!value || typeof value !== "object") return null;
  const revenueId = Number(value.revenueId ?? value.id);
  if (!Number.isFinite(revenueId) || revenueId <= 0) return null;

  const dueDate = String(value.dueDate ?? "").trim();
  if (!dueDate) return null;
  const clientName = value.clientName ?? value.client ?? null;

  return {
    revenueId,
    description: String(value.description ?? "Receita pendente"),
    clientName: clientName ? String(clientName) : null,
    status: String(value.status ?? "pendente"),
    dueDate,
    value: clampCurrency(
      toNumber(value.value ?? value.netAmount ?? value.grossAmount ?? 0)
    ),
  };
}

function pickChargeFollowUpTarget(
  revenues: AnyRecord[],
  referenceDate?: string
) {
  return (
    revenues
      .map(revenue => normalizeRevenueFollowUpTarget(revenue))
      .filter((revenue): revenue is RevenueFollowUpTarget => Boolean(revenue))
      .filter(revenue => {
        const status = revenue.status.toLowerCase();
        return status !== "recebido" && status !== "cancelado";
      })
      .sort((left, right) => {
        const priority = (item: RevenueFollowUpTarget) => {
          const status = item.status.toLowerCase();
          if (status.includes("atras")) return 0;
          if (referenceDate && item.dueDate < referenceDate) return 0;
          return 1;
        };

        if (priority(left) !== priority(right)) {
          return priority(left) - priority(right);
        }

        return String(left.dueDate || "").localeCompare(
          String(right.dueDate || "")
        );
      })[0] ?? null
  );
}

function normalizeRevenueReceiptTarget(
  value?: AnyRecord | null
): RevenueReceiptTarget | null {
  if (!value || typeof value !== "object") return null;
  const revenueId = Number(value.revenueId);
  if (!Number.isFinite(revenueId) || revenueId <= 0) return null;

  const dueDate = String(value.dueDate ?? "").trim();
  if (!dueDate) return null;

  return {
    revenueId,
    description: String(value.description ?? "Receita pendente"),
    clientName: value.clientName ? String(value.clientName) : null,
    dueDate,
    value: clampCurrency(toNumber(value.value ?? 0)),
  };
}

function pickRevenueReceiptTarget(
  revenues: AnyRecord[],
  referenceDate: string
) {
  return (
    revenues
      .map<RevenueReceiptTarget | null>(revenue => {
        const revenueId = Number(revenue.id);
        const status = String(revenue.status ?? "").toLowerCase();
        const dueDate = String(revenue.dueDate ?? "").trim();
        if (!Number.isFinite(revenueId) || revenueId <= 0) return null;
        if (!dueDate) return null;
        if (status === "recebido" || status === "cancelado") return null;
        if (String(revenue.receivedDate ?? "").trim()) return null;

        return {
          revenueId,
          description: String(revenue.description ?? "Receita pendente"),
          clientName: revenue.client ? String(revenue.client) : null,
          dueDate,
          value: clampCurrency(
            toNumber(revenue.netAmount ?? revenue.grossAmount ?? 0)
          ),
        };
      })
      .filter((item): item is RevenueReceiptTarget => Boolean(item))
      .filter(item => item.value > 0 && item.dueDate <= referenceDate)
      .sort((left, right) => {
        if (left.dueDate !== right.dueDate)
          return left.dueDate.localeCompare(right.dueDate);
        return right.value - left.value;
      })[0] ?? null
  );
}

function normalizeDebtRenegotiationTarget(
  value?: AnyRecord | null
): DebtRenegotiationTarget | null {
  if (!value || typeof value !== "object") return null;
  const debtId = Number(value.debtId);
  if (!Number.isFinite(debtId) || debtId <= 0) return null;

  const priority =
    value.priority === "alta" || value.priority === "baixa"
      ? value.priority
      : "media";

  return {
    debtId,
    creditor: String(value.creditor ?? ""),
    description: String(value.description ?? "Divida pressionada"),
    currentBalance: clampCurrency(toNumber(value.currentBalance ?? 0)),
    monthlyPayment: clampCurrency(toNumber(value.monthlyPayment ?? 0)),
    priority,
    status: String(value.status ?? "ativa"),
  };
}

function pickDebtRenegotiationTarget(debts: AnyRecord[]) {
  return (
    debts
      .map<DebtRenegotiationTarget | null>(debt => {
        const debtId = Number(debt.id);
        if (!Number.isFinite(debtId) || debtId <= 0) return null;
        const status = String(debt.status ?? "ativa");
        if (status === "quitada" || status === "renegociada") return null;

        return {
          debtId,
          creditor: String(debt.creditor ?? ""),
          description: String(
            debt.description ?? debt.creditor ?? "Divida pressionada"
          ),
          currentBalance: clampCurrency(toNumber(debt.currentBalance ?? 0)),
          monthlyPayment: clampCurrency(toNumber(debt.monthlyPayment ?? 0)),
          priority:
            debt.priority === "alta" || debt.priority === "baixa"
              ? debt.priority
              : "media",
          status,
        };
      })
      .filter((item): item is DebtRenegotiationTarget => Boolean(item))
      .filter(item => item.currentBalance > 0)
      .sort((left, right) => {
        const priorityWeight = (value: DebtRenegotiationTarget["priority"]) =>
          value === "alta" ? 0 : value === "media" ? 1 : 2;
        const statusWeight = (value: string) => (value === "atrasada" ? 0 : 1);
        if (statusWeight(left.status) !== statusWeight(right.status)) {
          return statusWeight(left.status) - statusWeight(right.status);
        }
        if (priorityWeight(left.priority) !== priorityWeight(right.priority)) {
          return priorityWeight(left.priority) - priorityWeight(right.priority);
        }
        return right.currentBalance - left.currentBalance;
      })[0] ?? null
  );
}

function buildTopRecommendations(args: {
  snapshotBase: Omit<FinancialGovernanceSnapshot, "summary">;
  companyVariableRatio: number;
  personalVariableRatio: number;
  companyRevenues: AnyRecord[];
  debts: AnyRecord[];
}) {
  const {
    snapshotBase,
    companyVariableRatio,
    personalVariableRatio,
    companyRevenues,
    debts,
  } = args;
  const recommendations: FinancialRecommendation[] = [];
  const actionablePriority = findFirstActionablePaymentPriorityItem(
    snapshotBase.paymentPriority
  );
  const chargeTarget = pickChargeFollowUpTarget(
    companyRevenues,
    snapshotBase.referenceDate
  );
  const revenueReceiptTarget = pickRevenueReceiptTarget(
    companyRevenues,
    snapshotBase.referenceDate
  );
  const debtRenegotiationTarget = pickDebtRenegotiationTarget(debts);

  if (snapshotBase.counts.overdueItems > 0) {
    recommendations.push({
      kind: "pay_priority_items",
      title: "Regularizar vencidos imediatamente",
      description: `Existem ${snapshotBase.counts.overdueItems} itens vencidos ou muito pressionados no fluxo atual.`,
      metadata: actionablePriority
        ? {
            targetItem: actionablePriority,
            overdueItems: snapshotBase.counts.overdueItems,
            dueThisWeek: snapshotBase.counts.dueThisWeek,
          }
        : {
            overdueItems: snapshotBase.counts.overdueItems,
            dueThisWeek: snapshotBase.counts.dueThisWeek,
          },
    });
  }

  if (
    snapshotBase.counts.overdueCharges > 0 ||
    snapshotBase.counts.pendingCharges > 0
  ) {
    recommendations.push({
      kind: "charge_follow_up",
      title: "Cobrar recebimentos em aberto",
      description: `Há ${snapshotBase.counts.pendingCharges} recebimento(s) pendente(s) e ${snapshotBase.counts.overdueCharges} em atraso pedindo acompanhamento manual.`,
      metadata: chargeTarget
        ? {
            targetRevenue: chargeTarget,
            pendingCharges: snapshotBase.counts.pendingCharges,
            overdueCharges: snapshotBase.counts.overdueCharges,
          }
        : {
            pendingCharges: snapshotBase.counts.pendingCharges,
            overdueCharges: snapshotBase.counts.overdueCharges,
          },
    });
  }

  if (revenueReceiptTarget) {
    recommendations.push({
      kind: "register_revenue_receipt",
      title: "Registrar recebimento pendente",
      description: `A receita ${revenueReceiptTarget.description} ja pode virar caixa recebido no sistema.`,
      metadata: {
        targetRevenue: revenueReceiptTarget,
      },
    });
  }

  if (debtRenegotiationTarget) {
    recommendations.push({
      kind: "renegotiate_debt",
      title: "Renegociar divida pressionada",
      description: `A divida ${debtRenegotiationTarget.description} ainda pressiona o caixa e merece renegociacao formal no sistema.`,
      metadata: {
        targetDebt: debtRenegotiationTarget,
      },
    });
  }

  if (snapshotBase.companyReserveRecommendation > 0) {
    recommendations.push({
      kind: "transfer_company_reserve",
      title: "Separar valor para reserva da empresa",
      description:
        "O caixa do mês comporta uma recomposição parcial da reserva empresarial sem comprometer os vencimentos.",
      amount: snapshotBase.companyReserveRecommendation,
      requiresConfirmation: true,
      metadata: { target: "empresa" },
    });
  }

  if (snapshotBase.personalReserveRecommendation > 0) {
    recommendations.push({
      kind: "transfer_personal_reserve",
      title: "Separar valor para reserva pessoal",
      description:
        "Há espaço para reforçar a reserva pessoal depois das obrigações protegidas do mês.",
      amount: snapshotBase.personalReserveRecommendation,
      requiresConfirmation: true,
      metadata: { target: "pessoal" },
    });
  }

  if (snapshotBase.safeToSpendMonth <= 0) {
    recommendations.push({
      kind: "freeze_discretionary",
      title: "Congelar gastos discricionários",
      description:
        "O limite seguro do mês foi consumido; novos gastos só deveriam entrar com compensação clara.",
    });
  }

  if (snapshotBase.taxProvision > 0) {
    recommendations.push({
      kind: "protect_tax_provision",
      title: "Proteger provisão de impostos",
      description:
        "Mantenha a provisão tributária intocada até o fechamento do ciclo financeiro da empresa.",
      amount: snapshotBase.taxProvision,
    });
  }

  if (companyVariableRatio >= 0.45 || personalVariableRatio >= 0.35) {
    recommendations.push({
      kind: "review_variable_costs",
      title: "Revisar custos variáveis do mês",
      description:
        "O peso dos gastos variáveis está acima do ideal para o momento do caixa e merece corte ou adiamento.",
      metadata: { companyVariableRatio, personalVariableRatio },
    });
  }

  return recommendations.slice(0, 6);
}

function escalateDecisionTone(
  tone: FinancialGovernanceSnapshot["cashRiskLevel"],
  globalRisk: FinancialGovernanceSnapshot["cashRiskLevel"]
): FinancialGovernanceSnapshot["cashRiskLevel"] {
  if (globalRisk === "critical") return "critical";
  if (globalRisk === "attention" && tone === "healthy") return "attention";
  return tone;
}

function getDecisionSummary(
  tone: FinancialGovernanceSnapshot["cashRiskLevel"],
  kind: FinancialDecisionKind,
  amount: number,
  metadata?: AnyRecord
) {
  const amountLabel = `R$ ${clampCurrency(amount).toFixed(2)}`;

  if (kind === "withdrawal") {
    if (tone === "healthy")
      return `Retirar ${amountLabel} parece viavel hoje sem estourar a folga operacional da empresa.`;
    if (tone === "attention")
      return `Retirar ${amountLabel} e possivel, mas ja pressiona a folga da empresa e pede mais disciplina no mes.`;
    return `Retirar ${amountLabel} agora aumenta demais o risco e tende a apertar o caixa operacional.`;
  }

  if (kind === "personal_spend") {
    if (tone === "healthy")
      return `Esse gasto extra de ${amountLabel} cabe no plano atual sem desorganizar o mes.`;
    if (tone === "attention")
      return `Esse gasto extra de ${amountLabel} consome boa parte da folga pessoal e merece cautela.`;
    return `Esse gasto extra de ${amountLabel} tende a furar a folga do mes e reduzir sua seguranca financeira.`;
  }

  if (kind === "monthly_cost") {
    if (tone === "healthy")
      return `Assumir ${amountLabel}/mes como novo custo parece suportavel no cenario atual.`;
    if (tone === "attention")
      return `Adicionar ${amountLabel}/mes ja encurta bastante a folga de caixa e pede validacao extra.`;
    return `Adicionar ${amountLabel}/mes agora deixa o plano muito apertado e aumenta o risco do caixa.`;
  }

  if (kind === "hiring") {
    if (tone === "healthy")
      return `Contratar com um impacto mensal de ${amountLabel} parece viavel sem apertar demais o caixa da empresa.`;
    if (tone === "attention")
      return `Essa contratacao de ${amountLabel}/mes e possivel, mas ja encurta a folga e pede acompanhamento proximo.`;
    return `Essa contratacao de ${amountLabel}/mes aumenta demais a pressao sobre o caixa para o momento atual.`;
  }

  if (kind === "installment_purchase") {
    const months = Number(metadata?.installments ?? 0);
    const total = clampCurrency(Number(metadata?.totalAmount ?? amount));
    const parcelLabel = `R$ ${clampCurrency(amount).toFixed(2)}`;
    const totalLabel = `R$ ${total.toFixed(2)}`;
    if (tone === "healthy") {
      return `Comprar ${totalLabel} em ${months}x de ${parcelLabel} parece caber no fluxo atual sem desorganizar o mes.`;
    }
    if (tone === "attention") {
      return `Parcelar ${totalLabel} em ${months}x de ${parcelLabel} e possivel, mas ja consome uma parte sensivel da folga.`;
    }
    return `Parcelar ${totalLabel} em ${months}x de ${parcelLabel} aperta demais o fluxo para o momento atual.`;
  }

  if (tone === "healthy")
    return `Tirar ${amountLabel}/mes da empresa de forma recorrente parece suportavel no cenario atual.`;
  if (tone === "attention")
    return `Tirar ${amountLabel}/mes da empresa de forma recorrente exige mais disciplina para nao encurtar demais a folga.`;
  return `Tirar ${amountLabel}/mes da empresa de forma recorrente agora aumenta demais o risco do caixa.`;
}

function buildDecisionAssessment(args: {
  snapshot: FinancialGovernanceSnapshot;
  kind: FinancialDecisionKind;
  amount: number;
  headroom: number;
  healthyLimit: number;
  attentionLimit: number;
  note: string;
  metrics: FinancialDecisionMetric[];
  metadata?: AnyRecord;
}) {
  const amount = clampCurrency(Math.max(args.amount, 0));
  const consumptionPercent =
    args.headroom > 0
      ? clampPercent((amount / args.headroom) * 100)
      : amount > 0
        ? 100
        : 0;

  let tone: FinancialGovernanceSnapshot["cashRiskLevel"] =
    amount <= 0
      ? "healthy"
      : args.headroom <= 0
        ? "critical"
        : consumptionPercent <= args.healthyLimit
          ? "healthy"
          : consumptionPercent <= args.attentionLimit
            ? "attention"
            : "critical";

  tone = escalateDecisionTone(tone, args.snapshot.cashRiskLevel);

  return {
    kind: args.kind,
    tone,
    amount,
    summary: getDecisionSummary(tone, args.kind, amount, args.metadata),
    note: args.note,
    consumptionPercent,
    metrics: args.metrics,
    metadata: args.metadata,
  } satisfies FinancialDecisionAssessment;
}

export function evaluateFinancialDecisionScenariosFromSnapshot(
  snapshot: FinancialGovernanceSnapshot,
  input?: {
    withdrawalAmount?: number;
    personalSpendAmount?: number;
    monthlyCostAmount?: number;
    hiringCostAmount?: number;
    installmentPurchaseAmount?: number;
    installmentPurchaseMonths?: number;
    recurringWithdrawalAmount?: number;
  }
): FinancialDecisionScenarioSet {
  const withdrawalAmount = clampCurrency(
    Math.max(input?.withdrawalAmount ?? 0, 0)
  );
  const personalSpendAmount = clampCurrency(
    Math.max(input?.personalSpendAmount ?? 0, 0)
  );
  const monthlyCostAmount = clampCurrency(
    Math.max(input?.monthlyCostAmount ?? 0, 0)
  );
  const hiringCostAmount = clampCurrency(
    Math.max(input?.hiringCostAmount ?? 0, 0)
  );
  const installmentPurchaseAmount = clampCurrency(
    Math.max(input?.installmentPurchaseAmount ?? 0, 0)
  );
  const installmentPurchaseMonths = Math.max(
    Math.round(input?.installmentPurchaseMonths ?? 12),
    1
  );
  const recurringWithdrawalAmount = clampCurrency(
    Math.max(input?.recurringWithdrawalAmount ?? 0, 0)
  );

  const companyHeadroom = clampCurrency(
    Math.max(
      snapshot.guardrails.company.projectedCash -
        snapshot.guardrails.company.reserveRecommendation,
      0
    )
  );
  const personalHeadroom = clampCurrency(
    Math.max(
      snapshot.guardrails.personal.projectedCash -
        snapshot.guardrails.personal.reserveRecommendation,
      0
    )
  );
  const totalHeadroom = clampCurrency(Math.max(snapshot.safeToSpendMonth, 0));
  const personalUsable = clampCurrency(
    Math.min(
      personalHeadroom > 0 ? personalHeadroom : totalHeadroom,
      totalHeadroom
    )
  );
  const installmentMonthlyAmount = clampCurrency(
    installmentPurchaseMonths > 0
      ? installmentPurchaseAmount / installmentPurchaseMonths
      : installmentPurchaseAmount
  );
  const employeeCostBase = snapshot.guardrails.company.employeeCosts;
  const companyNetRevenue = Math.max(snapshot.guardrails.company.netRevenue, 0);

  const withdrawal = buildDecisionAssessment({
    snapshot,
    kind: "withdrawal",
    amount: withdrawalAmount,
    headroom: companyHeadroom,
    healthyLimit: 50,
    attentionLimit: 100,
    note: "A leitura usa a folga operacional estimada da empresa neste mes, depois da recomendacao de reserva.",
    metrics: [
      {
        label: "Folga operacional atual",
        value: companyHeadroom,
        format: "currency",
      },
      {
        label: "Folga apos retirada",
        value: clampCurrency(Math.max(companyHeadroom - withdrawalAmount, 0)),
        format: "currency",
      },
      {
        label: "Caixa projetado empresa",
        value: clampCurrency(
          snapshot.guardrails.company.projectedCash - withdrawalAmount
        ),
        format: "currency",
      },
      {
        label: "Caixa minimo de referencia",
        value: snapshot.guardrails.company.minCashTarget,
        format: "currency",
      },
    ],
  });

  const personalSpend = buildDecisionAssessment({
    snapshot,
    kind: "personal_spend",
    amount: personalSpendAmount,
    headroom: personalUsable,
    healthyLimit: 50,
    attentionLimit: 100,
    note: "A simulacao cruza sua folga pessoal com o limite seguro total do mes para nao te enganar pelo saldo bruto.",
    metrics: [
      {
        label: "Folga pessoal atual",
        value: personalHeadroom,
        format: "currency",
      },
      {
        label: "Limite seguro do mes",
        value: totalHeadroom,
        format: "currency",
      },
      {
        label: "Folga pessoal apos gasto",
        value: clampCurrency(
          Math.max(personalHeadroom - personalSpendAmount, 0)
        ),
        format: "currency",
      },
      {
        label: "Caixa pessoal projetado",
        value: clampCurrency(
          snapshot.guardrails.personal.projectedCash - personalSpendAmount
        ),
        format: "currency",
      },
    ],
  });

  const monthlyCost = buildDecisionAssessment({
    snapshot,
    kind: "monthly_cost",
    amount: monthlyCostAmount,
    headroom: companyHeadroom,
    healthyLimit: 35,
    attentionLimit: 70,
    note: "Essa leitura trata o valor como um novo compromisso mensal recorrente, como aluguel, ferramenta ou assinatura fixa.",
    metrics: [
      {
        label: "Caixa projetado apos custo",
        value: clampCurrency(
          snapshot.guardrails.company.projectedCash - monthlyCostAmount
        ),
        format: "currency",
      },
      {
        label: "Limite seguro apos custo",
        value: clampCurrency(
          Math.max(snapshot.safeToSpendMonth - monthlyCostAmount, 0)
        ),
        format: "currency",
      },
      {
        label: "Folga operacional atual",
        value: companyHeadroom,
        format: "currency",
      },
      {
        label: "Reforco de reserva previsto",
        value: snapshot.guardrails.company.reserveRecommendation,
        format: "currency",
      },
    ],
  });

  const hiring = buildDecisionAssessment({
    snapshot,
    kind: "hiring",
    amount: hiringCostAmount,
    headroom: companyHeadroom,
    healthyLimit: 30,
    attentionLimit: 60,
    note: "Essa leitura trata a contratacao como um compromisso mensal continuo e pesa mais a disciplina do caixa operacional.",
    metrics: [
      {
        label: "Custo mensal da contratacao",
        value: hiringCostAmount,
        format: "currency",
      },
      {
        label: "Folga apos contratacao",
        value: clampCurrency(Math.max(companyHeadroom - hiringCostAmount, 0)),
        format: "currency",
      },
      {
        label: "Folha total estimada",
        value: clampCurrency(employeeCostBase + hiringCostAmount),
        format: "currency",
      },
      {
        label: "Peso da folha na receita liquida",
        value:
          companyNetRevenue > 0
            ? clampPercent(
                ((employeeCostBase + hiringCostAmount) / companyNetRevenue) *
                  100
              )
            : 100,
        format: "percent",
      },
    ],
  });

  const installmentPurchase = buildDecisionAssessment({
    snapshot,
    kind: "installment_purchase",
    amount: installmentMonthlyAmount,
    headroom: companyHeadroom,
    healthyLimit: 25,
    attentionLimit: 60,
    note: "A compra parcelada entra na analise pelo peso da parcela mensal, nao pelo valor cheio, para refletir o impacto real do fluxo.",
    metrics: [
      {
        label: "Valor total da compra",
        value: installmentPurchaseAmount,
        format: "currency",
      },
      {
        label: "Parcela mensal",
        value: installmentMonthlyAmount,
        format: "currency",
      },
      {
        label: "Quantidade de parcelas",
        value: installmentPurchaseMonths,
        format: "number",
      },
      {
        label: "Folga apos parcela",
        value: clampCurrency(
          Math.max(companyHeadroom - installmentMonthlyAmount, 0)
        ),
        format: "currency",
      },
    ],
    metadata: {
      totalAmount: installmentPurchaseAmount,
      installments: installmentPurchaseMonths,
    },
  });

  const recurringWithdrawal = buildDecisionAssessment({
    snapshot,
    kind: "recurring_withdrawal",
    amount: recurringWithdrawalAmount,
    headroom: companyHeadroom,
    healthyLimit: 35,
    attentionLimit: 70,
    note: "A retirada recorrente pesa como um novo compromisso fixo entre empresa e vida pessoal, entao a leitura e mais conservadora do que uma retirada pontual.",
    metrics: [
      {
        label: "Folga apos retirada recorrente",
        value: clampCurrency(
          Math.max(companyHeadroom - recurringWithdrawalAmount, 0)
        ),
        format: "currency",
      },
      {
        label: "Caixa projetado empresa",
        value: clampCurrency(
          snapshot.guardrails.company.projectedCash - recurringWithdrawalAmount
        ),
        format: "currency",
      },
      {
        label: "Caixa pessoal projetado",
        value: clampCurrency(
          snapshot.guardrails.personal.projectedCash + recurringWithdrawalAmount
        ),
        format: "currency",
      },
      {
        label: "Limite seguro apos retirada",
        value: clampCurrency(
          Math.max(snapshot.safeToSpendMonth - recurringWithdrawalAmount, 0)
        ),
        format: "currency",
      },
    ],
  });

  return {
    headrooms: {
      company: companyHeadroom,
      personal: personalHeadroom,
      personalUsable,
      total: totalHeadroom,
    },
    scenarios: {
      withdrawal,
      personalSpend,
      monthlyCost,
      hiring,
      installmentPurchase,
      recurringWithdrawal,
    },
  };
}

export async function buildFinancialAdvisorContext(
  userId: number,
  timezone = DEFAULT_TIMEZONE,
  referenceDate = new Date()
): Promise<FinancialAdvisorContext> {
  const { month, year, iso } = getPartsInTimeZone(referenceDate, timezone);
  const [
    settings,
    company,
    personal,
    calendar,
    debts,
    investments,
    reserveFunds,
  ] = await Promise.all([
    db.getSettings(userId).catch(() => null),
    db.getCompanyDashboardData(userId, month, year).catch(() => null),
    db.getPersonalDashboardData(userId, month, year).catch(() => null),
    db.getCalendarData(userId, month, year).catch(() => []),
    db.getDebts(userId).catch(() => []),
    db.getInvestments(userId).catch(() => []),
    db.getReserveFunds(userId).catch(() => []),
  ]);

  const receivables = Array.isArray(company?.revenue?.items)
    ? company.revenue.items
    : [];

  return {
    generatedAt: iso,
    referenceDate: iso,
    month,
    year,
    settings: settings ?? null,
    company: company ?? null,
    personal: personal ?? null,
    calendarItems: Array.isArray(calendar) ? calendar : [],
    debts: Array.isArray(debts) ? debts : [],
    investments: Array.isArray(investments) ? investments : [],
    reserveFunds: Array.isArray(reserveFunds) ? reserveFunds : [],
    receivables,
  };
}

export function calculateFinancialGovernanceSnapshot(
  context: FinancialAdvisorContext,
  options?: { timezone?: string; referenceDate?: Date }
): FinancialGovernanceSnapshot {
  const timezone = options?.timezone || DEFAULT_TIMEZONE;
  const referenceDate =
    options?.referenceDate ?? parseIsoDate(context.referenceDate) ?? new Date();
  const settings = context.settings ?? {};

  const taxPercent = toNumber(settings.taxPercent ?? "6");
  const tithePercent = toNumber(settings.tithePercent ?? "10");
  const investmentPercent = toNumber(settings.investmentPercent ?? "10");
  const proLaboreGross = toNumber(settings.proLaboreGross ?? "0");
  const companyReserveMonths = Math.max(
    toNumber(settings.companyReserveMonths ?? 3),
    1
  );
  const personalReserveMonths = Math.max(
    toNumber(settings.personalReserveMonths ?? 6),
    1
  );
  const companyMinCashMonths = Math.max(
    toNumber(settings.companyMinCashMonths ?? 1),
    0.5
  );
  const personalMinCashMonths = Math.max(
    toNumber(settings.personalMinCashMonths ?? 1),
    0.5
  );

  const companyGrossRevenue = toNumber(
    context.company?.summary?.current?.grossRevenue ??
      context.company?.revenue?.totalGross
  );
  const companyNetRevenue = toNumber(
    context.company?.summary?.current?.netRevenue ??
      context.company?.revenue?.totalNet
  );
  const companyTaxProvision = Math.max(
    toNumber(
      context.company?.summary?.current?.taxAmount ??
        context.company?.revenue?.totalTax
    ),
    clampCurrency(companyGrossRevenue * (taxPercent / 100))
  );
  const companyFixedCosts = toNumber(
    context.company?.summary?.current?.fixedCosts ??
      context.company?.fixedCosts?.total
  );
  const companyVariableCosts = toNumber(
    context.company?.summary?.current?.variableCosts ??
      context.company?.variableCosts?.total
  );
  const companyEmployeeCosts = toNumber(
    context.company?.summary?.current?.employeeCosts ??
      context.company?.employees?.totalCost
  );
  const companyPurchaseCosts = toNumber(
    context.company?.summary?.current?.purchases ??
      context.company?.purchases?.total
  );
  const companyReserveTotal = toNumber(
    context.company?.summary?.current?.reserve ??
      context.company?.reserve?.total
  );
  const companyEssentialMonthly =
    companyFixedCosts +
    companyEmployeeCosts +
    companyPurchaseCosts +
    proLaboreGross;
  const companyProjectedCash =
    companyNetRevenue - (companyEssentialMonthly + companyVariableCosts);
  const companyMinCashTarget = companyEssentialMonthly * companyMinCashMonths;
  const companyReserveGoal = companyEssentialMonthly * companyReserveMonths;
  const companyReserveShortfall = Math.max(
    companyReserveGoal - companyReserveTotal,
    0
  );
  const companyReserveRecommendation =
    companyProjectedCash > 0
      ? Math.min(companyReserveShortfall, companyProjectedCash * 0.4)
      : 0;

  const personalFixedCosts = toNumber(context.personal?.fixedCosts?.total);
  const personalVariableCosts = toNumber(
    context.personal?.variableCosts?.total
  );
  const personalDebtMonthly = toNumber(context.personal?.debts?.totalMonthly);
  const titheAmount = clampCurrency(proLaboreGross * (tithePercent / 100));
  const personalInvestmentAmount = clampCurrency(
    proLaboreGross * (investmentPercent / 100)
  );
  const personalAvailableIncome = Math.max(
    proLaboreGross - titheAmount - personalInvestmentAmount,
    0
  );
  const personalReserveTotal = toNumber(context.personal?.reserve?.total);
  const personalEssentialMonthly =
    personalFixedCosts +
    personalDebtMonthly +
    titheAmount +
    personalInvestmentAmount;
  const personalProjectedCash =
    personalAvailableIncome -
    (personalFixedCosts + personalDebtMonthly + personalVariableCosts);
  const personalMinCashTarget =
    personalEssentialMonthly * personalMinCashMonths;
  const personalReserveGoal = personalEssentialMonthly * personalReserveMonths;
  const personalReserveShortfall = Math.max(
    personalReserveGoal - personalReserveTotal,
    0
  );
  const personalReserveRecommendation =
    personalProjectedCash > 0
      ? Math.min(personalReserveShortfall, personalProjectedCash * 0.4)
      : 0;

  const incomingDates = context.receivables
    .filter(item => {
      const status = String(item.status || "").toLowerCase();
      return status !== "cancelado" && status !== "recebido";
    })
    .map(item => String(item.dueDate || ""))
    .map(value => parseIsoDate(value))
    .filter((value): value is Date => Boolean(value))
    .filter(date => diffInDays(referenceDate, date) >= 0)
    .sort((left, right) => left.getTime() - right.getTime());

  const nextIncomingDate = incomingDates[0]
    ? toIsoDate(incomingDates[0])
    : null;
  const nextIncoming = nextIncomingDate ? parseIsoDate(nextIncomingDate) : null;

  const paymentPriority: PaymentPriorityItem[] = context.calendarItems
    .map(item => {
      const dueDate = buildIsoDate(
        context.year,
        context.month,
        Math.max(
          Math.min(
            Number(item.day) || 1,
            getLastDayOfMonth(context.year, context.month)
          ),
          1
        )
      );
      const dueDateObj = parseIsoDate(dueDate) ?? referenceDate;
      const isOverdue =
        String(item.status || "")
          .toLowerCase()
          .includes("atras") || diffInDays(referenceDate, dueDateObj) < 0;
      const beforeNextIncome =
        !isOverdue && nextIncoming
          ? dueDateObj.getTime() <= nextIncoming.getTime()
          : false;
      const dueSoon = !isOverdue && diffInDays(referenceDate, dueDateObj) <= 7;
      const urgency: PaymentPriorityItem["urgency"] = isOverdue
        ? "overdue"
        : beforeNextIncome
          ? "before_next_income"
          : dueSoon
            ? "due_soon"
            : "planned";

      return {
        id: `${item.type}:${dueDate}:${item.description}`,
        title: item.description,
        source: (item.type.startsWith("empresa")
          ? "company"
          : item.type.startsWith("pessoal")
            ? "personal"
            : item.type === "divida"
              ? "debt"
              : "calendar") as PaymentPriorityItem["source"],
        dueDate,
        amount: clampCurrency(toNumber(item.amount)),
        status: item.status,
        urgency,
        sourceId: Number.isFinite(Number(item.sourceId))
          ? Number(item.sourceId)
          : null,
        sourceType:
          typeof item.sourceType === "string"
            ? (item.sourceType as PaymentPrioritySourceType)
            : null,
        actionable:
          item.actionable !== false &&
          Number.isFinite(Number(item.sourceId)) &&
          typeof item.sourceType === "string" &&
          item.sourceType !== "employee_payroll",
        recommendedAction:
          urgency === "overdue"
            ? "Pagar ou renegociar imediatamente."
            : urgency === "before_next_income"
              ? "Priorizar antes do próximo recebimento."
              : urgency === "due_soon"
                ? "Reservar caixa nesta semana."
                : "Acompanhar no calendário do mês.",
      };
    })
    .filter(item => item.amount > 0)
    .sort((left, right) => {
      const urgencyScore: Record<PaymentPriorityItem["urgency"], number> = {
        overdue: 0,
        before_next_income: 1,
        due_soon: 2,
        planned: 3,
      };
      if (urgencyScore[left.urgency] !== urgencyScore[right.urgency]) {
        return urgencyScore[left.urgency] - urgencyScore[right.urgency];
      }
      return right.amount - left.amount;
    })
    .slice(0, 8);

  const overdueItems = paymentPriority.filter(
    item => item.urgency === "overdue"
  ).length;
  const dueThisWeek = paymentPriority.filter(
    item => item.urgency === "before_next_income" || item.urgency === "due_soon"
  ).length;
  const openReceivables = context.receivables.filter(item => {
    const status = String(item.status || "").toLowerCase();
    return status !== "recebido" && status !== "cancelado";
  });
  const overdueCharges = openReceivables.filter(item => {
    const status = String(item.status || "").toLowerCase();
    const dueDate = String(item.dueDate || "");
    return (
      status.includes("atras") ||
      Boolean(dueDate && dueDate < context.referenceDate)
    );
  }).length;
  const pendingCharges = Math.max(openReceivables.length - overdueCharges, 0);

  const totalProjectedCash = companyProjectedCash + personalProjectedCash;
  const totalReserveRecommendation =
    companyReserveRecommendation + personalReserveRecommendation;
  const safeToSpendMonth = Math.max(
    totalProjectedCash - totalReserveRecommendation,
    0
  );
  const safeToSpendNow =
    safeToSpendMonth / daysRemainingInMonth(referenceDate, timezone);
  const protectedCash =
    companyTaxProvision +
    proLaboreGross +
    titheAmount +
    personalInvestmentAmount +
    companyMinCashTarget +
    personalMinCashTarget +
    totalReserveRecommendation;

  let cashRiskLevel: FinancialGovernanceSnapshot["cashRiskLevel"] = "healthy";
  if (totalProjectedCash < 0 || overdueItems > 0) {
    cashRiskLevel = "critical";
  } else if (safeToSpendMonth <= 0 || dueThisWeek >= 3 || overdueCharges > 0) {
    cashRiskLevel = "attention";
  }

  let confidenceScore = 1;
  if (!context.settings) confidenceScore -= 0.2;
  if (!context.company) confidenceScore -= 0.2;
  if (!context.personal) confidenceScore -= 0.2;
  if (
    !Array.isArray(context.calendarItems) ||
    context.calendarItems.length === 0
  )
    confidenceScore -= 0.1;
  confidenceScore = Math.max(0.4, confidenceScore);

  const snapshotBase = {
    generatedAt: context.generatedAt,
    referenceDate: context.referenceDate,
    month: context.month,
    year: context.year,
    safeToSpendNow: clampCurrency(safeToSpendNow),
    safeToSpendMonth: clampCurrency(safeToSpendMonth),
    protectedCash: clampCurrency(protectedCash),
    taxProvision: clampCurrency(companyTaxProvision),
    companyReserveRecommendation: clampCurrency(companyReserveRecommendation),
    personalReserveRecommendation: clampCurrency(personalReserveRecommendation),
    paymentPriority,
    cashRiskLevel,
    confidenceScore: clampCurrency(confidenceScore),
    nextIncomingDate,
    counts: {
      overdueItems,
      dueThisWeek,
      overdueCharges,
      pendingCharges,
      pendingPlanActions: 0,
    },
    guardrails: {
      company: {
        grossRevenue: clampCurrency(companyGrossRevenue),
        netRevenue: clampCurrency(companyNetRevenue),
        fixedCosts: clampCurrency(companyFixedCosts),
        variableCosts: clampCurrency(companyVariableCosts),
        employeeCosts: clampCurrency(companyEmployeeCosts),
        purchaseCosts: clampCurrency(companyPurchaseCosts),
        taxProvision: clampCurrency(companyTaxProvision),
        proLabore: clampCurrency(proLaboreGross),
        essentialMonthly: clampCurrency(companyEssentialMonthly),
        projectedCash: clampCurrency(companyProjectedCash),
        reserveTotal: clampCurrency(companyReserveTotal),
        reserveGoal: clampCurrency(companyReserveGoal),
        reserveShortfall: clampCurrency(companyReserveShortfall),
        reserveRecommendation: clampCurrency(companyReserveRecommendation),
        minCashTarget: clampCurrency(companyMinCashTarget),
      },
      personal: {
        proLaboreGross: clampCurrency(proLaboreGross),
        availableIncome: clampCurrency(personalAvailableIncome),
        titheAmount: clampCurrency(titheAmount),
        investmentAmount: clampCurrency(personalInvestmentAmount),
        fixedCosts: clampCurrency(personalFixedCosts),
        variableCosts: clampCurrency(personalVariableCosts),
        debtMonthly: clampCurrency(personalDebtMonthly),
        essentialMonthly: clampCurrency(personalEssentialMonthly),
        projectedCash: clampCurrency(personalProjectedCash),
        reserveTotal: clampCurrency(personalReserveTotal),
        reserveGoal: clampCurrency(personalReserveGoal),
        reserveShortfall: clampCurrency(personalReserveShortfall),
        reserveRecommendation: clampCurrency(personalReserveRecommendation),
        minCashTarget: clampCurrency(personalMinCashTarget),
      },
    },
    topRecommendations: [] as FinancialRecommendation[],
  };

  const topRecommendations = buildTopRecommendations({
    snapshotBase,
    companyVariableRatio:
      companyNetRevenue > 0
        ? companyVariableCosts / Math.max(companyNetRevenue, 1)
        : 0,
    personalVariableRatio:
      personalAvailableIncome > 0
        ? personalVariableCosts / Math.max(personalAvailableIncome, 1)
        : 0,
    companyRevenues: context.receivables,
    debts: context.debts,
  });

  const completed = { ...snapshotBase, topRecommendations };
  return { ...completed, summary: buildSummary(completed) };
}

export function calculateFinancialAdvisorOnboarding(args: {
  context: FinancialAdvisorContext;
  snapshot?: FinancialGovernanceSnapshot | null;
  whatsappIntegration?: AnyRecord | null;
  hasCurrentPlan?: boolean;
}): FinancialAdvisorOnboardingState {
  const { context } = args;
  const snapshot =
    args.snapshot ?? calculateFinancialGovernanceSnapshot(context);
  const settings = context.settings ?? {};
  const whatsappIntegration = args.whatsappIntegration ?? null;
  const hasCurrentPlan = Boolean(args.hasCurrentPlan);

  const companyRevenueCoverage =
    Number(context.company?.revenue?.count ?? 0) > 0 ||
    context.receivables.length > 0;
  const companyCostCoverage =
    Number(context.company?.fixedCosts?.count ?? 0) > 0 ||
    Number(context.company?.variableCosts?.count ?? 0) > 0 ||
    Number(context.company?.employees?.count ?? 0) > 0 ||
    Number(context.company?.purchases?.count ?? 0) > 0;
  const personalCommitmentsCoverage =
    toNumber(context.personal?.fixedCosts?.total) > 0 ||
    toNumber(context.personal?.variableCosts?.total) > 0 ||
    toNumber(context.personal?.debts?.totalMonthly) > 0 ||
    Number(context.personal?.debts?.count ?? 0) > 0;
  const reserveCoverage =
    context.reserveFunds.length > 0 ||
    toNumber(context.personal?.reserve?.total) > 0 ||
    toNumber(context.company?.reserve?.total) > 0 ||
    context.investments.length > 0;
  const calendarCoverage = context.calendarItems.length > 0;

  const companyCoverageCount = [
    companyRevenueCoverage,
    companyCostCoverage,
    Number(context.company?.employees?.count ?? 0) > 0,
  ].filter(Boolean).length;
  const personalCoverageCount = [
    personalCommitmentsCoverage,
    reserveCoverage,
    toNumber(context.personal?.variableCosts?.total) > 0,
  ].filter(Boolean).length;
  const dataCoverageCount = [
    companyRevenueCoverage,
    companyCostCoverage,
    personalCommitmentsCoverage,
    reserveCoverage,
    calendarCoverage,
  ].filter(Boolean).length;

  const profileStep = buildOnboardingStep({
    key: "profile",
    title: "Parametros do mentor",
    description:
      "Define a base que o mentor usa para separar empresa, pro-labore e impostos.",
    checklist: [
      {
        id: "company_name",
        label: "Nome da empresa definido",
        completed: String(settings.companyName ?? "").trim().length > 0,
      },
      {
        id: "pro_labore",
        label: "Pro-labore configurado",
        completed: toNumber(settings.proLaboreGross ?? "0") > 0,
      },
      {
        id: "tax_percent",
        label: "Percentual de imposto configurado",
        completed: toNumber(settings.taxPercent ?? "0") > 0,
      },
    ],
    emptySummary:
      "Sem essa base, o mentor cai em valores padrao e perde contexto sobre sua operacao.",
    partialSummary:
      "A base ja existe, mas ainda faltam alguns parametros para o mentor decidir com mais seguranca.",
    completeSummary:
      "Perfil financeiro principal configurado para o mentor operar com contexto real.",
  });

  const guardrailsStep = buildOnboardingStep({
    key: "guardrails",
    title: "Protecoes de caixa",
    description:
      "Cria os limites que impedem o mentor de olhar apenas para saldo em conta.",
    checklist: [
      {
        id: "company_reserve",
        label: "Meta de reserva da empresa definida",
        completed: toNumber(settings.companyReserveMonths ?? 0) >= 1,
      },
      {
        id: "personal_reserve",
        label: "Meta de reserva pessoal definida",
        completed: toNumber(settings.personalReserveMonths ?? 0) >= 1,
      },
      {
        id: "company_min_cash",
        label: "Caixa minimo da empresa definido",
        completed: toNumber(settings.companyMinCashMonths ?? 0) >= 0.5,
      },
      {
        id: "personal_min_cash",
        label: "Caixa minimo pessoal definido",
        completed: toNumber(settings.personalMinCashMonths ?? 0) >= 0.5,
      },
    ],
    emptySummary:
      "Ainda faltam as protecoes que transformam saldo bruto em limite seguro de gasto.",
    partialSummary:
      "As protecoes comecaram a ser configuradas, mas o mentor ainda pode operar com folga incompleta.",
    completeSummary:
      "Caixa minimo e metas de reserva prontos para orientar gasto seguro e recomendacoes.",
  });

  const dataFoundationStep = buildOnboardingStep({
    key: "data_foundation",
    title: "Base do mes",
    description:
      "Mede se a empresa e a vida pessoal ja deram insumo suficiente para o mentor trabalhar.",
    checklist: [
      {
        id: "company_revenue",
        label: "Receitas ou cobrancas da empresa registradas",
        completed: companyRevenueCoverage,
      },
      {
        id: "company_costs",
        label: "Custos ou folha da empresa mapeados",
        completed: companyCostCoverage,
      },
      {
        id: "personal_commitments",
        label: "Compromissos pessoais ou dividas informados",
        completed: personalCommitmentsCoverage,
      },
      {
        id: "reserves",
        label: "Reserva ou investimentos registrados",
        completed: reserveCoverage,
      },
      {
        id: "calendar",
        label: "Calendario financeiro com vencimentos ativos",
        completed: calendarCoverage,
      },
    ],
    emptySummary:
      "Ainda falta materia-prima para o mentor enxergar o mes com profundidade.",
    partialSummary:
      "Ja existe contexto financeiro, mas ainda vale completar o que falta para aumentar a confianca do mentor.",
    completeSummary:
      "A base do mes esta consistente para gerar prioridades, limites e alertas com mais qualidade.",
  });

  const whatsappReady =
    Boolean(whatsappIntegration?.enabled) &&
    String(whatsappIntegration?.instanceId ?? "").trim().length > 0 &&
    String(whatsappIntegration?.apiBaseUrl ?? "").trim().length > 0 &&
    String(whatsappIntegration?.authorizedPhone ?? "").trim().length > 0 &&
    String(whatsappIntegration?.lastConnectionStatus ?? "") === "sincronizado";

  const whatsappStep = buildOnboardingStep({
    key: "whatsapp_channel",
    title: "Canal no WhatsApp",
    description:
      "Conecta o mentor ao seu numero principal para virar rotina, nao so painel.",
    checklist: [
      {
        id: "instance",
        label: "Instancia conectada",
        completed:
          String(whatsappIntegration?.instanceId ?? "").trim().length > 0,
      },
      {
        id: "authorized_phone",
        label: "Numero autorizado definido",
        completed:
          String(whatsappIntegration?.authorizedPhone ?? "").trim().length > 0,
      },
      {
        id: "enabled",
        label: "Assistente habilitado",
        completed: Boolean(whatsappIntegration?.enabled),
      },
      {
        id: "synced",
        label: "Sessao sincronizada",
        completed:
          String(whatsappIntegration?.lastConnectionStatus ?? "") ===
          "sincronizado",
      },
    ],
    emptySummary:
      "Sem o canal pronto, a mentoria ainda fica presa ao painel e perde rotina.",
    partialSummary:
      "O canal ja esta em preparacao, mas ainda falta fechar a sincronizacao para usar no dia a dia.",
    completeSummary:
      "WhatsApp pronto para receber alertas, resumos e orientacoes executivas do mentor.",
  });

  const monthlyPlanStep = buildOnboardingStep({
    key: "monthly_plan",
    title: "Primeiro plano do mes",
    description:
      "Consolida limites, prioridades e acoes praticas para o ciclo atual.",
    checklist: [
      {
        id: "confidence",
        label: "Snapshot com confianca minima",
        completed: snapshot.confidenceScore >= 0.55,
      },
      {
        id: "current_plan",
        label: "Plano do mes gerado",
        completed: hasCurrentPlan,
      },
    ],
    emptySummary:
      "Ainda falta transformar a base atual em um plano acionavel do mes.",
    partialSummary:
      "A leitura do mentor ja existe, mas ainda falta consolidar o plano do ciclo atual.",
    completeSummary:
      "Plano do mes pronto para orientar prioridades, limites e execucao.",
  });

  const steps = [
    profileStep,
    guardrailsStep,
    dataFoundationStep,
    whatsappStep,
    monthlyPlanStep,
  ];
  const totalChecklistItems = steps.reduce(
    (sum, step) => sum + step.totalItems,
    0
  );
  const completedChecklistItems = steps.reduce(
    (sum, step) => sum + step.completedItems,
    0
  );
  const completedSteps = steps.filter(
    step => step.status === "complete"
  ).length;
  const progressPercent =
    totalChecklistItems > 0
      ? clampPercent((completedChecklistItems / totalChecklistItems) * 100)
      : 0;

  const status = steps.every(step => step.status === "complete")
    ? ("ready" as const)
    : progressPercent >= 55
      ? ("attention" as const)
      : ("setup" as const);
  const recommendedStepKey =
    steps.find(step => step.status !== "complete")?.key ?? null;
  const recommendedStep = recommendedStepKey
    ? (steps.find(step => step.key === recommendedStepKey) ?? null)
    : null;

  const headline =
    status === "ready"
      ? "Mentor pronto para operar seu mes"
      : status === "attention"
        ? "Mentor quase pronto para a rotina completa"
        : "Vamos montar a base do mentor";
  const summary =
    status === "ready"
      ? "Empresa, vida pessoal, protecoes, canal e plano do mes estao alinhados para a mentoria operar com contexto real."
      : recommendedStep
        ? `O proximo melhor passo e concluir "${recommendedStep.title.toLowerCase()}". Isso aumenta a qualidade das recomendacoes e reduz decisoes no escuro.`
        : "Ainda faltam algumas etapas para a mentoria operar com profundidade.";

  return {
    status,
    headline,
    summary,
    progressPercent,
    completedSteps,
    totalSteps: steps.length,
    recommendedStepKey,
    steps,
    metrics: {
      confidenceScore: snapshot.confidenceScore,
      companyCoverageCount,
      personalCoverageCount,
      dataCoverageCount,
      hasWhatsAppReady: whatsappReady,
      hasCurrentPlan,
    },
  };
}

function parseStoredSnapshotPayload(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<FinancialGovernanceSnapshot>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getRecurringRiskLevel(counts: {
  critical: number;
  attention: number;
  healthy: number;
}) {
  if (counts.critical >= 2) return "critical" as const;
  if (counts.critical >= 1 || counts.attention >= 2)
    return "attention" as const;
  return "healthy" as const;
}

export async function getFinancialAdvisorMemory(
  userId: number,
  options?: { currentSnapshot?: FinancialGovernanceSnapshot | null }
): Promise<FinancialAdvisorMemoryState> {
  const currentSnapshot = options?.currentSnapshot ?? null;
  const [storedSnapshots, assistantRuns, planActions] = await Promise.all([
    advisorDb.listFinancialAdvisorSnapshots(userId, "daily"),
    whatsappDb.listAssistantRuns(userId),
    whatsappDb.listFinancialPlanActions(userId),
  ]);
  const history = storedSnapshots
    .map(item => parseStoredSnapshotPayload(item.snapshotPayload))
    .filter((item): item is FinancialGovernanceSnapshot => Boolean(item))
    .slice(0, 6);

  const snapshots = currentSnapshot ? [currentSnapshot, ...history] : history;
  const uniqueMonths = new Set(
    snapshots.map(item => `${item.year}-${item.month}`)
  );
  const riskCounts = snapshots.reduce(
    (acc, item) => {
      acc[item.cashRiskLevel] += 1;
      return acc;
    },
    { healthy: 0, attention: 0, critical: 0 }
  );
  const averageSafeToSpend = average(
    snapshots.map(item => item.safeToSpendMonth)
  );
  const averageOverdue = average(
    snapshots.map(item => item.counts.overdueItems)
  );
  const averageChargePressure = average(
    snapshots.map(
      item => item.counts.overdueCharges + item.counts.pendingCharges
    )
  );
  const averageReserveCoverage = average(
    snapshots.map(item => {
      const totalRecommendation =
        item.companyReserveRecommendation + item.personalReserveRecommendation;
      return totalRecommendation <= 0 ? 1 : 0;
    })
  );
  const newest = snapshots[0] ?? null;
  const oldest = snapshots[snapshots.length - 1] ?? null;
  const safeToSpendDelta =
    newest && oldest
      ? clampCurrency(newest.safeToSpendMonth - oldest.safeToSpendMonth)
      : 0;
  const trendDirection =
    safeToSpendDelta > 250
      ? ("improving" as const)
      : safeToSpendDelta < -250
        ? ("worsening" as const)
        : ("stable" as const);
  const recurringRiskLevel = getRecurringRiskLevel(riskCounts);
  const consistencyScore = clampPercent(
    Math.max(
      0,
      100 -
        riskCounts.critical * 26 -
        riskCounts.attention * 12 -
        Math.min(averageOverdue * 8, 24) -
        Math.min(averageChargePressure * 4, 18) +
        averageReserveCoverage * 18
    )
  );

  const confirmationRuns = assistantRuns.filter(
    run => run.requiresConfirmation
  );
  const executedRuns = assistantRuns.filter(run => run.status === "executado");
  const snoozedRuns = assistantRuns.filter(run => {
    const payload = String(run.executedActions ?? "");
    return payload.includes("snoozed");
  });
  const executedPlanActions = planActions.filter(
    action => action.status === "concluida"
  );
  const snoozedPlanActions = planActions.filter(
    action => action.status === "adiada"
  );
  const totalBehaviorSignals = Math.max(
    confirmationRuns.length + planActions.length,
    1
  );
  const executionScore = clampPercent(
    Math.max(
      0,
      Math.min(
        100,
        ((executedRuns.length + executedPlanActions.length * 1.2) /
          totalBehaviorSignals) *
          100 -
          ((snoozedRuns.length + snoozedPlanActions.length) /
            totalBehaviorSignals) *
            28
      )
    )
  );

  const profileLabel =
    executionScore >= 72 && trendDirection === "improving"
      ? "mentor vendo disciplina de execucao crescer"
      : recurringRiskLevel === "critical"
        ? "mentor em modo recuperacao"
        : trendDirection === "improving" && consistencyScore >= 72
          ? "mentor vendo consistencia crescente"
          : executionScore <= 42
            ? "mentor vendo boas intencoes, mas pouca execucao"
            : averageChargePressure >= 2
              ? "mentor atento a cobrancas e previsibilidade"
              : "mentor com rotina financeira em construcao";

  const headline =
    uniqueMonths.size >= 3
      ? "Memoria recente do mentor"
      : "Memoria inicial do mentor";
  const summary =
    uniqueMonths.size >= 3
      ? recurringRiskLevel === "critical"
        ? "O historico recente mostra repeticao de meses apertados. O mentor deve agir de forma mais conservadora ate a previsibilidade melhorar."
        : executionScore <= 42
          ? "Os dados mostram contexto suficiente, mas a execucao ainda fica para depois. O mentor deve insistir em proximas acoes mais simples e diretas."
          : trendDirection === "improving"
            ? "Os ultimos ciclos mostram melhora de folga e mais consistencia. O mentor pode subir o nivel de refinamento sem perder prudencia."
            : "Ja existe historico suficiente para o mentor reconhecer padroes, mas o comportamento ainda oscila entre meses."
      : "O mentor comecou a formar memoria. Quanto mais ciclos e snapshots, mais personalizadas ficam as orientacoes.";

  const signals: FinancialAdvisorMemorySignal[] = [
    {
      id: "discipline",
      label: "Consistencia do mes",
      status:
        consistencyScore >= 72
          ? "healthy"
          : consistencyScore >= 48
            ? "attention"
            : "critical",
      value: `${consistencyScore}%`,
    },
    {
      id: "execution",
      label: "Execucao das acoes",
      status:
        executionScore >= 72
          ? "healthy"
          : executionScore >= 48
            ? "attention"
            : "critical",
      value: `${executionScore}%`,
    },
    {
      id: "trend",
      label: "Tendencia da folga",
      status:
        trendDirection === "improving"
          ? "healthy"
          : trendDirection === "stable"
            ? "attention"
            : "critical",
      value:
        trendDirection === "improving"
          ? "melhora"
          : trendDirection === "stable"
            ? "estavel"
            : "piora",
    },
    {
      id: "overdue-pattern",
      label: "Media de vencidos",
      status:
        averageOverdue <= 0.5
          ? "healthy"
          : averageOverdue <= 2
            ? "attention"
            : "critical",
      value: averageOverdue.toFixed(1),
    },
    {
      id: "charge-pressure",
      label: "Pressao de cobrancas",
      status:
        averageChargePressure <= 1
          ? "healthy"
          : averageChargePressure <= 3
            ? "attention"
            : "critical",
      value: averageChargePressure.toFixed(1),
    },
  ];

  return {
    headline,
    summary,
    profileLabel,
    consistencyScore,
    executionScore,
    recurringRiskLevel,
    trendDirection,
    historyMonths: uniqueMonths.size,
    signals,
  };
}

export function personalizeFinancialRecommendations(
  snapshot: FinancialGovernanceSnapshot,
  memory: FinancialAdvisorMemoryState
) {
  const lowExecution = memory.executionScore <= 42;
  const highExecution = memory.executionScore >= 72;
  const strategicMoment =
    highExecution && memory.trendDirection === "improving";
  const orderWeight: Record<FinancialRecommendation["kind"], number> =
    lowExecution
      ? {
          pay_priority_items: 0,
          register_revenue_receipt: 1,
          charge_follow_up: 2,
          renegotiate_debt: 3,
          freeze_discretionary: 4,
          protect_tax_provision: 5,
          transfer_company_reserve: 6,
          transfer_personal_reserve: 7,
          review_variable_costs: 8,
        }
      : strategicMoment
        ? {
            transfer_company_reserve: 0,
            transfer_personal_reserve: 1,
            review_variable_costs: 2,
            protect_tax_provision: 3,
            register_revenue_receipt: 4,
            pay_priority_items: 5,
            charge_follow_up: 6,
            renegotiate_debt: 7,
            freeze_discretionary: 8,
          }
        : {
            pay_priority_items: 0,
            register_revenue_receipt: 1,
            charge_follow_up: 2,
            renegotiate_debt: 3,
            transfer_company_reserve: 4,
            transfer_personal_reserve: 5,
            review_variable_costs: 6,
            protect_tax_provision: 7,
            freeze_discretionary: 8,
          };

  return snapshot.topRecommendations
    .map(recommendation => {
      if (lowExecution) {
        const lowExecutionMessage =
          recommendation.kind === "pay_priority_items" ||
          recommendation.kind === "charge_follow_up" ||
          recommendation.kind === "register_revenue_receipt" ||
          recommendation.kind === "renegotiate_debt"
            ? "Foque em executar esta unica frente antes de abrir novas decisoes."
            : "O mentor simplificou a orientacao para aumentar a chance de execucao real.";
        return {
          ...recommendation,
          description:
            `${recommendation.description} ${lowExecutionMessage}`.trim(),
        };
      }

      if (strategicMoment) {
        const strategicMessage =
          recommendation.kind === "transfer_company_reserve" ||
          recommendation.kind === "transfer_personal_reserve"
            ? "Sua memoria recente permite subir o nivel e transformar folga em protecao de longo prazo."
            : "Como a execucao esta mais consistente, o mentor pode ampliar a ambicao desta recomendacao.";
        return {
          ...recommendation,
          description:
            `${recommendation.description} ${strategicMessage}`.trim(),
        };
      }

      return recommendation;
    })
    .sort((left, right) => {
      const leftWeight = orderWeight[left.kind] ?? 99;
      const rightWeight = orderWeight[right.kind] ?? 99;
      return leftWeight - rightWeight;
    });
}

export function personalizeFinancialAdvisorSummary(
  snapshot: FinancialGovernanceSnapshot,
  memory: FinancialAdvisorMemoryState
) {
  if (memory.executionScore <= 42) {
    return `${snapshot.summary} O mentor vai priorizar passos menores e mais executaveis ate a disciplina de execucao subir.`;
  }

  if (memory.executionScore >= 72 && memory.trendDirection === "improving") {
    return `${snapshot.summary} Como sua execucao recente esta consistente, o mentor pode subir o foco para protecao, margem e reserva.`;
  }

  return `${snapshot.summary} O mentor esta calibrando as proximas recomendacoes com base no seu padrao recente de execucao.`;
}

export function getFinancialAdvisorMentorMode(
  memory: Pick<FinancialAdvisorMemoryState, "executionScore" | "trendDirection">
): FinancialAdvisorMentorMode {
  if (memory.executionScore <= 42) return "execution_short";
  if (memory.executionScore >= 72 && memory.trendDirection === "improving") {
    return "strategic";
  }
  return "calibration";
}

async function buildNarrative(params: {
  kind: "snapshot" | "daily" | "monthly_plan" | "month_close";
  snapshot: FinancialGovernanceSnapshot;
  extra?: string;
}) {
  const fallbackMap = {
    snapshot: params.snapshot.summary,
    daily: `Hoje voce pode gastar ate R$ ${params.snapshot.safeToSpendNow.toFixed(2)} sem apertar o restante do mes. Priorize ${params.snapshot.paymentPriority[0]?.title || "os vencimentos mais proximos"} e mantenha R$ ${params.snapshot.protectedCash.toFixed(2)} protegidos.`,
    monthly_plan: `Seu plano do mes deve operar com limite seguro de R$ ${params.snapshot.safeToSpendMonth.toFixed(2)}, provisao tributaria de R$ ${params.snapshot.taxProvision.toFixed(2)} e reforco total de reserva de R$ ${(params.snapshot.companyReserveRecommendation + params.snapshot.personalReserveRecommendation).toFixed(2)}.`,
    month_close: `Fechamento do mes: o limite seguro encerra em R$ ${params.snapshot.safeToSpendMonth.toFixed(2)} com risco ${params.snapshot.cashRiskLevel}. O foco agora e ajustar excessos, proteger caixa e preparar o proximo ciclo.`,
  } as const;

  try {
    const messages: Message[] = [
      {
        role: "system",
        content:
          "Voce e um consultor financeiro gerencial. Responda em portugues do Brasil, de forma curta, pratica e executiva. Use apenas os dados fornecidos e nao invente numeros.",
      },
      {
        role: "user",
        content: JSON.stringify(
          { kind: params.kind, snapshot: params.snapshot, extra: params.extra },
          null,
          2
        ),
      },
    ];
    const response = await invokeLLM({ messages });
    const rawContent = response.choices[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map(part => ("text" in part ? part.text : "")).join("\n")
      : String(rawContent || "");
    return content.trim() || fallbackMap[params.kind];
  } catch {
    return fallbackMap[params.kind];
  }
}

async function persistSnapshot(params: {
  userId: number;
  integrationId?: number | null;
  relatedPlanId?: number | null;
  snapshotType: string;
  referenceDate: string;
  snapshot: FinancialGovernanceSnapshot;
  status?: string;
  confirmedAt?: Date | null;
  executedAt?: Date | null;
}) {
  return advisorDb.upsertFinancialAdvisorSnapshot({
    userId: params.userId,
    integrationId: params.integrationId ?? null,
    relatedPlanId: params.relatedPlanId ?? null,
    snapshotType: params.snapshotType,
    referenceDate: params.referenceDate,
    periodMonth: params.snapshot.month,
    periodYear: params.snapshot.year,
    status: params.status ?? "generated",
    cashRiskLevel: params.snapshot.cashRiskLevel,
    summary: params.snapshot.summary,
    confidenceScore: params.snapshot.confidenceScore.toFixed(2),
    snapshotPayload: JSON.stringify(params.snapshot),
    recommendationsPayload: JSON.stringify(params.snapshot.topRecommendations),
    confirmedAt: params.confirmedAt ?? null,
    executedAt: params.executedAt ?? null,
  });
}

export async function getFinancialAdvisorSnapshot(
  userId: number,
  options?: {
    timezone?: string;
    referenceDate?: Date;
    integrationId?: number | null;
    persist?: boolean;
  }
) {
  const context = await buildFinancialAdvisorContext(
    userId,
    options?.timezone || DEFAULT_TIMEZONE,
    options?.referenceDate
  );
  const snapshot = calculateFinancialGovernanceSnapshot(context, {
    timezone: options?.timezone || DEFAULT_TIMEZONE,
    referenceDate: options?.referenceDate,
  });
  const currentPlan = await whatsappDb.getFinancialPlanByPeriod(
    userId,
    snapshot.month,
    snapshot.year
  );
  const planActions = currentPlan
    ? await whatsappDb.listFinancialPlanActions(userId, currentPlan.id)
    : [];
  const enriched = {
    ...snapshot,
    counts: {
      ...snapshot.counts,
      pendingPlanActions: planActions.filter(
        action => action.status === "pendente"
      ).length,
    },
  };
  const baseFinalized = { ...enriched, summary: buildSummary(enriched) };
  const memory = await getFinancialAdvisorMemory(userId, {
    currentSnapshot: baseFinalized,
  });
  const finalized = {
    ...baseFinalized,
    topRecommendations: personalizeFinancialRecommendations(
      baseFinalized,
      memory
    ),
    summary: personalizeFinancialAdvisorSummary(baseFinalized, memory),
  };

  if (options?.persist !== false) {
    await persistSnapshot({
      userId,
      integrationId: options?.integrationId,
      snapshotType: "daily",
      referenceDate: finalized.referenceDate,
      snapshot: finalized,
    });
  }

  return finalized;
}

export async function getFinancialAdvisorOnboarding(
  userId: number,
  options?: {
    timezone?: string;
    referenceDate?: Date;
  }
) {
  const context = await buildFinancialAdvisorContext(
    userId,
    options?.timezone || DEFAULT_TIMEZONE,
    options?.referenceDate
  );
  const snapshot = calculateFinancialGovernanceSnapshot(context, {
    timezone: options?.timezone || DEFAULT_TIMEZONE,
    referenceDate: options?.referenceDate,
  });
  const [whatsappIntegration, currentPlan] = await Promise.all([
    whatsappDb.getWhatsAppIntegration(userId),
    whatsappDb.getFinancialPlanByPeriod(userId, snapshot.month, snapshot.year),
  ]);

  return calculateFinancialAdvisorOnboarding({
    context,
    snapshot,
    whatsappIntegration,
    hasCurrentPlan: Boolean(currentPlan),
  });
}

export async function evaluateFinancialDecisionScenarios(params: {
  userId: number;
  withdrawalAmount?: number;
  personalSpendAmount?: number;
  monthlyCostAmount?: number;
  hiringCostAmount?: number;
  installmentPurchaseAmount?: number;
  installmentPurchaseMonths?: number;
  recurringWithdrawalAmount?: number;
  timezone?: string;
  referenceDate?: Date;
}) {
  const snapshot = await getFinancialAdvisorSnapshot(params.userId, {
    timezone: params.timezone,
    referenceDate: params.referenceDate,
    persist: false,
  });

  return evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
    withdrawalAmount: params.withdrawalAmount,
    personalSpendAmount: params.personalSpendAmount,
    monthlyCostAmount: params.monthlyCostAmount,
    hiringCostAmount: params.hiringCostAmount,
    installmentPurchaseAmount: params.installmentPurchaseAmount,
    installmentPurchaseMonths: params.installmentPurchaseMonths,
    recurringWithdrawalAmount: params.recurringWithdrawalAmount,
  });
}

function buildPlanActions(snapshot: FinancialGovernanceSnapshot) {
  const actions = snapshot.topRecommendations.map(recommendation => ({
    actionType: recommendation.kind,
    title: recommendation.title,
    description: recommendation.description,
    priority:
      recommendation.kind === "pay_priority_items" ||
      recommendation.kind === "freeze_discretionary"
        ? ("alta" as const)
        : recommendation.kind === "review_variable_costs"
          ? ("media" as const)
          : ("baixa" as const),
    dueDate:
      recommendation.kind === "pay_priority_items" &&
      snapshot.paymentPriority[0]
        ? snapshot.paymentPriority[0].dueDate
        : null,
    status: "pendente" as const,
    metadata: JSON.stringify({
      ...recommendation.metadata,
      amount: recommendation.amount ?? null,
      safeToSpendMonth: snapshot.safeToSpendMonth,
      safeToSpendNow: snapshot.safeToSpendNow,
    }),
    snoozedUntil: null,
  }));

  if (actions.length >= 3) return actions;

  return [
    ...actions,
    {
      actionType: "protect_tax_provision",
      title: "Separar a provisão de impostos",
      description:
        "Garantir que o valor tributário do mês não entre no caixa disponível para gasto.",
      priority: "alta" as const,
      dueDate: null,
      status: "pendente" as const,
      metadata: JSON.stringify({ taxProvision: snapshot.taxProvision }),
      snoozedUntil: null,
    },
    {
      actionType: "review_variable_costs",
      title: "Revisar gastos variáveis do mês",
      description:
        "Mapear o que pode ser cortado, renegociado ou adiado antes do próximo ciclo.",
      priority: "media" as const,
      dueDate: null,
      status: "pendente" as const,
      metadata: JSON.stringify({
        paymentPriorityCount: snapshot.paymentPriority.length,
      }),
      snoozedUntil: null,
    },
  ].slice(0, 4);
}

export async function generateFinancialAdvisorMonthlyPlan(params: {
  userId: number;
  integrationId?: number | null;
  threadId?: number | null;
  timezone?: string;
  referenceDate?: Date;
  confirmed?: boolean;
}) {
  const snapshot = await getFinancialAdvisorSnapshot(params.userId, {
    timezone: params.timezone,
    referenceDate: params.referenceDate,
    integrationId: params.integrationId,
  });
  const actions = buildPlanActions(snapshot);
  const messageToUser = await buildNarrative({
    kind: "monthly_plan",
    snapshot,
    extra:
      "Monte um plano mensal executivo com foco em disciplina de caixa, ordem de pagamento e recomposição de reserva.",
  });

  const plan = await whatsappDb.upsertFinancialPlan({
    userId: params.userId,
    threadId: params.threadId ?? null,
    periodMonth: snapshot.month,
    periodYear: snapshot.year,
    status: "ativo",
    summary: messageToUser,
    targetBalance: snapshot.safeToSpendMonth.toFixed(2),
    recommendedCashAction:
      snapshot.topRecommendations[0]?.description ||
      "Seguir a ordem de proteção do caixa antes de assumir novos gastos.",
    rawAnalysis: JSON.stringify({ snapshot, actions, summary: messageToUser }),
    confirmedAt: params.confirmed === false ? null : new Date(),
  });
  const storedActions = await whatsappDb.replaceFinancialPlanActions(
    params.userId,
    plan.id,
    actions
  );

  await persistSnapshot({
    userId: params.userId,
    integrationId: params.integrationId,
    relatedPlanId: plan.id,
    snapshotType: "monthly_plan",
    referenceDate: snapshot.referenceDate,
    snapshot,
    status: params.confirmed === false ? "generated" : "confirmed",
    confirmedAt: params.confirmed === false ? null : new Date(),
  });

  return {
    plan,
    actions: storedActions,
    snapshot,
    messageToUser,
  } satisfies FinancialPlanSummary;
}

export async function getFinancialAdvisorDailyDigest(params: {
  userId: number;
  integrationId?: number | null;
  timezone?: string;
  referenceDate?: Date;
}) {
  const snapshot = await getFinancialAdvisorSnapshot(params.userId, {
    timezone: params.timezone,
    referenceDate: params.referenceDate,
    integrationId: params.integrationId,
  });
  const currentPlan = await whatsappDb.getFinancialPlanByPeriod(
    params.userId,
    snapshot.month,
    snapshot.year
  );
  const planActions = currentPlan
    ? await whatsappDb.listFinancialPlanActions(params.userId, currentPlan.id)
    : [];
  const message = await buildNarrative({ kind: "daily", snapshot });
  const alerts = [
    snapshot.counts.overdueItems > 0
      ? `${snapshot.counts.overdueItems} item(ns) vencido(s) exigem regularização hoje.`
      : null,
    snapshot.counts.overdueCharges > 0
      ? `${snapshot.counts.overdueCharges} recebimento(s) estão em atraso.`
      : null,
    snapshot.counts.dueThisWeek > 0
      ? `${snapshot.counts.dueThisWeek} compromisso(s) pressionam o caixa nesta semana.`
      : null,
  ].filter(Boolean) as string[];

  await persistSnapshot({
    userId: params.userId,
    integrationId: params.integrationId,
    snapshotType: "daily",
    referenceDate: snapshot.referenceDate,
    snapshot: { ...snapshot, summary: message },
  });

  return {
    snapshot,
    message,
    alerts,
    actions: planActions
      .filter(action => action.status === "pendente")
      .slice(0, 3),
  };
}

export async function getFinancialAdvisorMonthClose(params: {
  userId: number;
  integrationId?: number | null;
  timezone?: string;
  referenceDate?: Date;
}) {
  const snapshot = await getFinancialAdvisorSnapshot(params.userId, {
    timezone: params.timezone,
    referenceDate: params.referenceDate,
    integrationId: params.integrationId,
  });
  const currentPlan = await whatsappDb.getFinancialPlanByPeriod(
    params.userId,
    snapshot.month,
    snapshot.year
  );
  const targetBalance = toNumber(currentPlan?.targetBalance);
  const deviation = clampCurrency(snapshot.safeToSpendMonth - targetBalance);
  const excessSignals = [
    snapshot.guardrails.company.variableCosts >
    snapshot.guardrails.company.fixedCosts * 0.75
      ? "Custos variáveis da empresa pesaram acima do ideal."
      : null,
    snapshot.guardrails.personal.variableCosts >
    snapshot.guardrails.personal.fixedCosts * 0.65
      ? "Gastos variáveis pessoais ficaram acima do ponto de conforto."
      : null,
    snapshot.counts.overdueCharges > 0
      ? "Recebimentos em atraso reduziram a previsibilidade do caixa."
      : null,
  ].filter(Boolean) as string[];
  const focusNextMonth =
    snapshot.cashRiskLevel === "critical"
      ? "Fechar cortes, renegociar pressões e recompor fôlego do caixa."
      : snapshot.cashRiskLevel === "attention"
        ? "Aumentar disciplina de gastos e executar as prioridades do plano sem atrasos."
        : "Manter regularidade de cobrança, reserva e disciplina de execução do plano.";
  const message = await buildNarrative({
    kind: "month_close",
    snapshot,
    extra: JSON.stringify({
      targetBalance,
      deviation,
      focusNextMonth,
      excessSignals,
    }),
  });

  await persistSnapshot({
    userId: params.userId,
    integrationId: params.integrationId,
    snapshotType: "month_close",
    referenceDate: snapshot.referenceDate,
    snapshot: { ...snapshot, summary: message },
  });

  return {
    snapshot,
    targetBalance,
    deviation,
    focusNextMonth,
    excessSignals,
    message,
  };
}

async function resolvePriorityItemForExecution(
  userId: number,
  metadata: AnyRecord
) {
  const fromMetadata = normalizePaymentPriorityItem(
    metadata.targetItem && typeof metadata.targetItem === "object"
      ? metadata.targetItem
      : null
  );
  if (isActionablePaymentPriorityItem(fromMetadata)) return fromMetadata;

  const snapshot = await getFinancialAdvisorSnapshot(userId, {
    persist: false,
  });
  return findFirstActionablePaymentPriorityItem(snapshot.paymentPriority);
}

async function executePaymentPriorityAction(params: {
  userId: number;
  item: PaymentPriorityItem;
  executedAt: Date;
}) {
  const { userId, item, executedAt } = params;

  if (!isActionablePaymentPriorityItem(item)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Nao encontrei uma prioridade executavel para concluir no plano atual.",
    });
  }

  const sourceId = item.sourceId;
  if (typeof sourceId !== "number") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Essa prioridade nao possui um registro financeiro vinculavel.",
    });
  }

  if (item.sourceType === "company_fixed_cost") {
    await db.updateCompanyFixedCost(sourceId, userId, { status: "pago" });
    return {
      executionKind: "payment_status_update" as const,
      message: `${item.title} foi marcado como pago no financeiro da empresa.`,
      targetItem: item,
      updatedStatus: "pago",
    };
  }

  if (item.sourceType === "company_variable_cost") {
    await db.updateCompanyVariableCost(sourceId, userId, { status: "pago" });
    return {
      executionKind: "payment_status_update" as const,
      message: `${item.title} foi marcado como pago nos custos variaveis da empresa.`,
      targetItem: item,
      updatedStatus: "pago",
    };
  }

  if (item.sourceType === "personal_fixed_cost") {
    await db.updatePersonalFixedCost(sourceId, userId, { status: "pago" });
    return {
      executionKind: "payment_status_update" as const,
      message: `${item.title} foi marcado como pago nas contas pessoais.`,
      targetItem: item,
      updatedStatus: "pago",
    };
  }

  if (item.sourceType === "personal_variable_cost") {
    await db.updatePersonalVariableCost(sourceId, userId, { status: "pago" });
    return {
      executionKind: "payment_status_update" as const,
      message: `${item.title} foi marcado como pago nos gastos pessoais.`,
      targetItem: item,
      updatedStatus: "pago",
    };
  }

  if (item.sourceType === "debt") {
    const debts = await db.getDebts(userId);
    const debt = debts.find(current => current.id === sourceId);
    if (!debt) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Nao encontrei a divida vinculada a essa prioridade.",
      });
    }

    const currentBalance = clampCurrency(
      Math.max(toNumber(debt.currentBalance), 0)
    );
    const installmentAmount = clampCurrency(
      Math.max(toNumber(debt.monthlyPayment), 0) || currentBalance
    );
    const nextBalance = clampCurrency(
      Math.max(currentBalance - installmentAmount, 0)
    );
    const nextPaidInstallments = Math.max(
      0,
      Math.min(
        (Number(debt.paidInstallments ?? 0) || 0) + 1,
        Math.max(Number(debt.totalInstallments ?? 1) || 1, 1)
      )
    );
    const nextStatus =
      nextBalance <= 0 ? ("quitada" as const) : ("ativa" as const);

    await db.updateDebt(sourceId, userId, {
      currentBalance: nextBalance.toFixed(2),
      paidInstallments: nextPaidInstallments,
      status: nextStatus,
    });

    return {
      executionKind: "payment_status_update" as const,
      message:
        nextStatus === "quitada"
          ? `${item.title} foi quitada. Saldo restante: R$ 0,00.`
          : `${item.title} recebeu a parcela do periodo. Saldo restante: R$ ${nextBalance.toFixed(2)}.`,
      targetItem: item,
      updatedStatus: nextStatus,
      nextBalance,
      paidInstallments: nextPaidInstallments,
      executedAt: executedAt.toISOString(),
    };
  }

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Essa prioridade ainda nao tem execucao automatica disponivel no painel.",
  });
}

async function resolveChargeFollowUpTarget(
  userId: number,
  metadata: AnyRecord
) {
  const fromMetadata = normalizeRevenueFollowUpTarget(
    metadata.targetRevenue && typeof metadata.targetRevenue === "object"
      ? metadata.targetRevenue
      : null
  );
  if (fromMetadata) return fromMetadata;

  const revenues = (
    (await db.getRevenues(userId).catch(() => null))?.data ?? []
  ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return pickChargeFollowUpTarget(revenues);
}

async function resolveRevenueReceiptTarget(
  userId: number,
  metadata: AnyRecord,
  referenceDate: string
) {
  const fromMetadata = normalizeRevenueReceiptTarget(
    metadata.targetRevenue && typeof metadata.targetRevenue === "object"
      ? metadata.targetRevenue
      : null
  );
  if (fromMetadata) return fromMetadata;

  const revenues = (
    (await db.getRevenues(userId).catch(() => null))?.data ?? []
  ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return pickRevenueReceiptTarget(revenues, referenceDate);
}

async function resolveDebtRenegotiationTarget(
  userId: number,
  metadata: AnyRecord
) {
  const fromMetadata = normalizeDebtRenegotiationTarget(
    metadata.targetDebt && typeof metadata.targetDebt === "object"
      ? metadata.targetDebt
      : null
  );
  if (fromMetadata) return fromMetadata;

  const debts = await db.getDebts(userId).catch(() => []);
  return pickDebtRenegotiationTarget(debts);
}

export async function confirmFinancialAdvisorAction(
  userId: number,
  actionId: number
) {
  const action = await whatsappDb.getFinancialPlanActionById(userId, actionId);
  if (!action) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Acao do plano nao encontrada.",
    });
  }
  if (action.status === "concluida") {
    return {
      success: true,
      message: "Acao ja estava concluida.",
      executionKind: "noop" as const,
    };
  }

  const metadata = parseActionMetadata(action.metadata);
  const executedAt = new Date();

  if (action.actionType === "pay_priority_items") {
    const targetItem = await resolvePriorityItemForExecution(userId, metadata);
    if (!targetItem) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Nao encontrei uma prioridade executavel para concluir agora.",
      });
    }

    const execution = await executePaymentPriorityAction({
      userId,
      item: targetItem,
      executedAt,
    });

    await whatsappDb.updateFinancialPlanAction(actionId, userId, {
      status: "concluida",
      metadata: buildExecutedActionMetadata(metadata, {
        kind: execution.executionKind,
        targetItem: targetItem,
        updatedStatus: execution.updatedStatus,
        nextBalance:
          "nextBalance" in execution ? execution.nextBalance : undefined,
        paidInstallments:
          "paidInstallments" in execution
            ? execution.paidInstallments
            : undefined,
        executedAt: executedAt.toISOString(),
      }),
    });

    return {
      success: true,
      message: execution.message,
      executionKind: execution.executionKind,
      targetItem,
    };
  }

  if (action.actionType === "charge_follow_up") {
    const targetRevenue = await resolveChargeFollowUpTarget(userId, metadata);
    if (!targetRevenue) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Nao encontrei um recebimento aberto para acompanhar agora.",
      });
    }

    const revenue = await db.getRevenueById(userId, targetRevenue.revenueId);
    if (!revenue) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "A receita selecionada para acompanhamento nao existe mais.",
      });
    }

    const dueDate = String(revenue.dueDate || targetRevenue.dueDate || "");
    const value = clampCurrency(
      toNumber(revenue.netAmount ?? revenue.grossAmount ?? targetRevenue.value)
    );

    await whatsappDb.updateFinancialPlanAction(actionId, userId, {
      status: "concluida",
      metadata: buildExecutedActionMetadata(metadata, {
        kind: "charge_follow_up",
        targetRevenue: {
          revenueId: revenue.id,
          description: revenue.description,
          clientName: revenue.client ?? targetRevenue.clientName ?? null,
          status: revenue.status,
          dueDate,
          value,
        },
        executedAt: executedAt.toISOString(),
      }),
    });

    return {
      success: true,
      message: `Follow-up manual registrado para ${revenue.description} (${dueDate}), no valor de R$ ${value.toFixed(2)}. O recebimento continua pendente e sera monitorado.`,
      executionKind: "charge_follow_up" as const,
      revenueId: revenue.id,
      dueDate,
      value,
    };
  }

  if (action.actionType === "register_revenue_receipt") {
    const executedDate = getPartsInTimeZone(executedAt, DEFAULT_TIMEZONE).iso;
    const targetRevenue = await resolveRevenueReceiptTarget(
      userId,
      metadata,
      executedDate
    );
    if (!targetRevenue) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Nao encontrei uma receita elegivel para registrar recebimento agora.",
      });
    }

    const revenue = await db.getRevenueById(userId, targetRevenue.revenueId);
    if (!revenue) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "A receita selecionada nao existe mais.",
      });
    }
    if (String(revenue.status ?? "").toLowerCase() === "recebido") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Essa receita ja esta marcada como recebida.",
      });
    }

    await db.updateRevenue(revenue.id, userId, {
      status: "recebido",
      receivedDate: executedDate,
    });

    await whatsappDb.updateFinancialPlanAction(actionId, userId, {
      status: "concluida",
      metadata: buildExecutedActionMetadata(metadata, {
        kind: "register_revenue_receipt",
        targetRevenue: {
          revenueId: revenue.id,
          description: revenue.description,
          clientName: revenue.client ?? null,
          dueDate: revenue.dueDate,
          value: clampCurrency(
            toNumber(revenue.netAmount ?? revenue.grossAmount)
          ),
        },
        receivedDate: executedDate,
        executedAt: executedAt.toISOString(),
      }),
    });

    return {
      success: true,
      message: `Recebimento registrado para ${revenue.description} em ${executedDate}. O caixa do mes agora reflete essa entrada como recebida.`,
      executionKind: "register_revenue_receipt" as const,
      revenueId: revenue.id,
      receivedDate: executedDate,
      value: clampCurrency(toNumber(revenue.netAmount ?? revenue.grossAmount)),
    };
  }

  if (action.actionType === "renegotiate_debt") {
    const targetDebt = await resolveDebtRenegotiationTarget(userId, metadata);
    if (!targetDebt) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Nao encontrei uma divida elegivel para renegociar agora.",
      });
    }

    const debts = await db.getDebts(userId);
    const debt = debts.find(current => current.id === targetDebt.debtId);
    if (!debt) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "A divida selecionada nao existe mais.",
      });
    }
    if (String(debt.status ?? "").toLowerCase() === "quitada") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Essa divida ja esta quitada e nao precisa de renegociacao.",
      });
    }

    const renegotiationNote = `Renegociacao iniciada pelo mentor em ${executedAt.toISOString()}. Rever prazo, parcela e condicoes com ${debt.creditor}.`;
    const nextNotes = [String(debt.notes ?? "").trim(), renegotiationNote]
      .filter(Boolean)
      .join(" | ");

    await db.updateDebt(debt.id, userId, {
      status: "renegociada",
      notes: nextNotes,
    });

    await whatsappDb.updateFinancialPlanAction(actionId, userId, {
      status: "concluida",
      metadata: buildExecutedActionMetadata(metadata, {
        kind: "renegotiate_debt",
        targetDebt: {
          debtId: debt.id,
          creditor: debt.creditor,
          description: debt.description,
          currentBalance: clampCurrency(toNumber(debt.currentBalance)),
          monthlyPayment: clampCurrency(toNumber(debt.monthlyPayment)),
          priority:
            debt.priority === "alta" || debt.priority === "baixa"
              ? debt.priority
              : "media",
          status: "renegociada",
        },
        executedAt: executedAt.toISOString(),
      }),
    });

    return {
      success: true,
      message: `A divida ${debt.description} foi marcada como renegociada e ganhou trilha de acompanhamento no sistema.`,
      executionKind: "renegotiate_debt" as const,
      debtId: debt.id,
      currentBalance: clampCurrency(toNumber(debt.currentBalance)),
      monthlyPayment: clampCurrency(toNumber(debt.monthlyPayment)),
    };
  }

  if (
    action.actionType === "transfer_company_reserve" ||
    action.actionType === "transfer_personal_reserve"
  ) {
    const target =
      metadata.target === "pessoal" ||
      action.actionType === "transfer_personal_reserve"
        ? ("pessoal" as const)
        : ("empresa" as const);
    const amount = clampCurrency(Math.max(toNumber(metadata.amount ?? 0), 0));

    if (amount <= 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Nao encontrei valor valido para executar o aporte de reserva.",
      });
    }

    const referenceDate = getPartsInTimeZone(executedAt, DEFAULT_TIMEZONE).iso;
    const reserveRecord = await db.createReserveFund({
      userId,
      type: target,
      depositAmount: amount.toFixed(2),
      date: referenceDate,
      description:
        target === "empresa"
          ? "Aporte executado pelo mentor na reserva da empresa"
          : "Aporte executado pelo mentor na reserva pessoal",
      notes: `Origem: ${action.title}`,
    });

    await whatsappDb.updateFinancialPlanAction(actionId, userId, {
      status: "concluida",
      metadata: buildExecutedActionMetadata(metadata, {
        kind: "reserve_transfer",
        reserveFundId: reserveRecord.id,
        target,
        amount,
        executedAt: executedAt.toISOString(),
      }),
    });

    return {
      success: true,
      message:
        target === "empresa"
          ? `Aporte de R$ ${amount.toFixed(2)} registrado na reserva da empresa.`
          : `Aporte de R$ ${amount.toFixed(2)} registrado na reserva pessoal.`,
      executionKind: "reserve_transfer" as const,
      amount,
      target,
      reserveFundId: reserveRecord.id,
    };
  }

  await whatsappDb.updateFinancialPlanAction(actionId, userId, {
    status: "concluida",
    metadata: buildExecutedActionMetadata(metadata, {
      kind: "manual_completion",
      executedAt: executedAt.toISOString(),
    }),
  });

  return {
    success: true,
    message: "Acao marcada como concluida.",
    executionKind: "manual_completion" as const,
  };
}

export async function snoozeFinancialAdvisorAlert(
  userId: number,
  eventId: number,
  hours = 24
) {
  const event = await whatsappDb.getNotificationEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Alerta nao encontrado.",
    });
  }
  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  await whatsappDb.updateNotificationEvent(eventId, userId, {
    status: "adiado",
    snoozedUntil,
  });
  return { success: true, snoozedUntil };
}

export async function refreshFinancialAdvisorState(params: {
  userId: number;
  integrationId?: number | null;
  timezone?: string;
  referenceDate?: Date;
}) {
  const snapshot = await getFinancialAdvisorSnapshot(params.userId, {
    integrationId: params.integrationId,
    timezone: params.timezone,
    referenceDate: params.referenceDate,
  });
  const dailyDigest = await getFinancialAdvisorDailyDigest({
    userId: params.userId,
    integrationId: params.integrationId,
    timezone: params.timezone,
    referenceDate: params.referenceDate,
  });
  const monthClose = await getFinancialAdvisorMonthClose({
    userId: params.userId,
    integrationId: params.integrationId,
    timezone: params.timezone,
    referenceDate: params.referenceDate,
  });

  return {
    success: true,
    snapshot,
    dailyDigest,
    monthClose,
  };
}

export async function buildFinancialAdvisorAssistantReply(params: {
  intent: FinancialAssistantIntent;
  userId: number;
  timezone?: string;
  referenceDate?: Date;
  decisionAmount?: number | null;
  decisionInstallments?: number | null;
  messageText?: string;
}) {
  const snapshot = await getFinancialAdvisorSnapshot(params.userId, {
    timezone: params.timezone,
    referenceDate: params.referenceDate,
    persist: false,
  });
  const memory = await getFinancialAdvisorMemory(params.userId, {
    currentSnapshot: snapshot,
  });
  const mentorMode = getFinancialAdvisorMentorMode(memory);
  const memoryAlert =
    memory.historyMonths >= 2
      ? `Memoria do mentor: ${memory.profileLabel}.`
      : null;

  if (params.intent === "monthly_plan_request") {
    return {
      snapshot,
      reply:
        "Posso registrar agora seu plano financeiro do mês com metas, limites de gasto, reservas e prioridades. Responda CONFIRMAR para eu criar esse plano no sistema.",
      summary: snapshot.summary,
      alerts: snapshot.counts.overdueItems
        ? [
            `${snapshot.counts.overdueItems} item(ns) vencido(s) devem entrar na primeira linha do plano.`,
          ]
        : memoryAlert
          ? [memoryAlert]
          : [],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: true,
      mentorMode,
      memory,
    };
  }

  if (params.intent === "spending_limit" || params.intent === "cash_advice") {
    return {
      snapshot,
      reply: `Hoje o limite seguro está em R$ ${snapshot.safeToSpendNow.toFixed(2)} e, no mês, ainda há até R$ ${snapshot.safeToSpendMonth.toFixed(2)} de espaço sem furar as proteções do caixa.`,
      summary: snapshot.summary,
      alerts: [
        snapshot.counts.overdueItems
          ? "Existem vencidos pressionando o orçamento antes de qualquer gasto novo."
          : null,
        memoryAlert,
      ].filter(Boolean) as string[],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
      mentorMode,
      memory,
    };
  }

  if (
    params.intent === "company_withdrawal_decision" ||
    params.intent === "recurring_withdrawal_decision" ||
    params.intent === "personal_spend_decision" ||
    params.intent === "monthly_cost_decision" ||
    params.intent === "hiring_decision" ||
    params.intent === "installment_purchase_decision"
  ) {
    const amount = clampCurrency(Math.max(params.decisionAmount ?? 0, 0));
    const installments = Math.max(
      Math.round(params.decisionInstallments ?? 0),
      0
    );
    if (amount <= 0) {
      const prompt =
        params.intent === "company_withdrawal_decision"
          ? "Posso avaliar isso, mas me diga o valor exato da retirada. Exemplo: 'Posso tirar R$ 3.000 da empresa hoje?'"
          : params.intent === "recurring_withdrawal_decision"
            ? "Me diga o valor mensal dessa retirada recorrente para eu medir o impacto no caixa. Exemplo: 'Posso tirar R$ 5.000 todo mes da empresa?'"
            : params.intent === "personal_spend_decision"
              ? "Me diga o valor exato do gasto para eu medir o impacto no seu mês. Exemplo: 'Posso gastar R$ 1.200 no pessoal este mês?'"
              : params.intent === "monthly_cost_decision"
                ? "Me diga o valor mensal desse novo custo para eu avaliar o impacto. Exemplo: 'Posso assumir um custo mensal de R$ 2.500?'"
                : params.intent === "hiring_decision"
                  ? "Me diga o custo mensal dessa contratacao para eu avaliar o impacto. Exemplo: 'Posso contratar alguem por R$ 4.000 por mes?'"
                  : "Me diga o valor total da compra parcelada. Exemplo: 'Posso comprar um notebook de R$ 12.000 em 12x?'";

      return {
        snapshot,
        reply: prompt,
        summary: snapshot.summary,
        alerts: [
          snapshot.counts.overdueItems
            ? "Existem vencidos pressionando o caixa antes de assumir novas saídas."
            : null,
          memoryAlert,
        ].filter(Boolean) as string[],
        suggestedActions: snapshot.topRecommendations,
        requiresConfirmation: false,
        mentorMode,
        memory,
      };
    }

    if (
      params.intent === "installment_purchase_decision" &&
      installments <= 0
    ) {
      return {
        snapshot,
        reply:
          "Consigo avaliar essa compra parcelada, mas preciso da quantidade de parcelas. Exemplo: 'Posso comprar um notebook de R$ 12.000 em 12x?'",
        summary: snapshot.summary,
        alerts: [
          snapshot.counts.overdueItems
            ? "Existem vencidos pressionando o caixa antes de assumir novas saídas."
            : null,
          memoryAlert,
        ].filter(Boolean) as string[],
        suggestedActions: snapshot.topRecommendations,
        requiresConfirmation: false,
        mentorMode,
        memory,
      };
    }

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      withdrawalAmount:
        params.intent === "company_withdrawal_decision" ? amount : 0,
      recurringWithdrawalAmount:
        params.intent === "recurring_withdrawal_decision" ? amount : 0,
      personalSpendAmount:
        params.intent === "personal_spend_decision" ? amount : 0,
      monthlyCostAmount: params.intent === "monthly_cost_decision" ? amount : 0,
      hiringCostAmount: params.intent === "hiring_decision" ? amount : 0,
      installmentPurchaseAmount:
        params.intent === "installment_purchase_decision" ? amount : 0,
      installmentPurchaseMonths:
        params.intent === "installment_purchase_decision" ? installments : 0,
    });
    const assessment =
      params.intent === "company_withdrawal_decision"
        ? scenarios.scenarios.withdrawal
        : params.intent === "recurring_withdrawal_decision"
          ? scenarios.scenarios.recurringWithdrawal
          : params.intent === "personal_spend_decision"
            ? scenarios.scenarios.personalSpend
            : params.intent === "monthly_cost_decision"
              ? scenarios.scenarios.monthlyCost
              : params.intent === "hiring_decision"
                ? scenarios.scenarios.hiring
                : scenarios.scenarios.installmentPurchase;
    const metricMap = Object.fromEntries(
      assessment.metrics.map(metric => [metric.label, metric.value])
    ) as Record<string, number>;

    const reply =
      params.intent === "company_withdrawal_decision"
        ? `${assessment.summary} Depois disso, a folga operacional estimada ficaria em R$ ${(metricMap["Folga apos retirada"] ?? 0).toFixed(2)} e o caixa projetado da empresa em R$ ${(metricMap["Caixa projetado empresa"] ?? 0).toFixed(2)}.`
        : params.intent === "recurring_withdrawal_decision"
          ? `${assessment.summary} Com essa retirada fixa, a folga operacional cairia para R$ ${(metricMap["Folga apos retirada recorrente"] ?? 0).toFixed(2)}, o caixa projetado da empresa ficaria em R$ ${(metricMap["Caixa projetado empresa"] ?? 0).toFixed(2)} e o pessoal iria para R$ ${(metricMap["Caixa pessoal projetado"] ?? 0).toFixed(2)}.`
          : params.intent === "personal_spend_decision"
            ? `${assessment.summary} Depois desse gasto, sua folga pessoal estimada ficaria em R$ ${(metricMap["Folga pessoal apos gasto"] ?? 0).toFixed(2)} e o caixa pessoal projetado em R$ ${(metricMap["Caixa pessoal projetado"] ?? 0).toFixed(2)}.`
            : params.intent === "monthly_cost_decision"
              ? `${assessment.summary} Depois disso, o caixa projetado da empresa iria para R$ ${(metricMap["Caixa projetado apos custo"] ?? 0).toFixed(2)} e o limite seguro do mês cairia para R$ ${(metricMap["Limite seguro apos custo"] ?? 0).toFixed(2)}.`
              : params.intent === "hiring_decision"
                ? `${assessment.summary} Depois da contratacao, a folga operacional cairia para R$ ${(metricMap["Folga apos contratacao"] ?? 0).toFixed(2)} e a folha total estimada iria para R$ ${(metricMap["Folha total estimada"] ?? 0).toFixed(2)}.`
                : `${assessment.summary} Nesse parcelamento, a parcela mensal ficaria em R$ ${(metricMap["Parcela mensal"] ?? 0).toFixed(2)} por ${Math.round(metricMap["Quantidade de parcelas"] ?? installments)} mes(es), deixando a folga em R$ ${(metricMap["Folga apos parcela"] ?? 0).toFixed(2)}.`;

    const alerts = [
      assessment.tone !== "healthy"
        ? `Essa decisão consome ${assessment.consumptionPercent.toFixed(1)}% da folga usada nesta análise.`
        : null,
      snapshot.counts.overdueItems > 0
        ? "Existem vencidos pressionando o caixa antes de assumir novas saídas."
        : null,
      memoryAlert,
    ].filter(Boolean) as string[];

    return {
      snapshot,
      reply,
      summary: assessment.summary,
      alerts,
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
      mentorMode,
      memory,
    };
  }

  if (params.intent === "reserve_transfer") {
    return {
      snapshot,
      reply: `A recomendação atual é separar R$ ${snapshot.companyReserveRecommendation.toFixed(2)} para a reserva da empresa e R$ ${snapshot.personalReserveRecommendation.toFixed(2)} para a reserva pessoal, desde que você confirme essa alocação.`,
      summary: snapshot.summary,
      alerts: memoryAlert ? [memoryAlert] : [],
      suggestedActions: snapshot.topRecommendations.filter(
        action =>
          action.kind === "transfer_company_reserve" ||
          action.kind === "transfer_personal_reserve"
      ),
      requiresConfirmation: true,
      mentorMode,
      memory,
    };
  }

  if (
    params.intent === "payment_priority" ||
    params.intent === "upcoming_bills" ||
    params.intent === "overdue_items"
  ) {
    const topItems = snapshot.paymentPriority.slice(0, 3);
    return {
      snapshot,
      reply: topItems.length
        ? `Sua ordem de pagamento agora é: ${topItems.map(item => `${item.title} (${item.dueDate})`).join(", ")}.`
        : "Nao encontrei pagamentos pressionando o caixa agora, mas sigo monitorando o calendário do mês.",
      summary: snapshot.summary,
      alerts: snapshot.counts.overdueItems
        ? [
            `${snapshot.counts.overdueItems} item(ns) vencido(s) estão no topo da prioridade.`,
          ]
        : memoryAlert
          ? [memoryAlert]
          : [],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
      mentorMode,
      memory,
    };
  }

  if (
    params.intent === "financial_health" ||
    params.intent === "consolidated_analysis"
  ) {
    const label =
      snapshot.cashRiskLevel === "critical"
        ? "crítico"
        : snapshot.cashRiskLevel === "attention"
          ? "em atenção"
          : "saudável";
    return {
      snapshot,
      reply: `Sua saúde financeira consolidada está ${label}. Caixa protegido em R$ ${snapshot.protectedCash.toFixed(2)} e provisão tributária em R$ ${snapshot.taxProvision.toFixed(2)}.`,
      summary: snapshot.summary,
      alerts: [
        snapshot.counts.overdueCharges
          ? `${snapshot.counts.overdueCharges} cobrança(s) em atraso reduzem previsibilidade do caixa.`
          : null,
        memoryAlert,
      ].filter(Boolean) as string[],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
      mentorMode,
      memory,
    };
  }

  return {
    snapshot,
    reply:
      "Consigo te orientar sobre quanto pode gastar, quais contas pagar primeiro, quanto separar para reserva e como está a saúde financeira da empresa e do pessoal.",
    summary: snapshot.summary,
    alerts: memoryAlert ? [memoryAlert] : [],
    suggestedActions: snapshot.topRecommendations,
    requiresConfirmation: false,
    mentorMode,
    memory,
  };
}

export async function askFinancialAdvisorQuestion(params: {
  userId: number;
  message: string;
  timezone?: string;
  referenceDate?: Date;
}) {
  const detectedIntent = detectFinancialAssistantIntent(params.message);
  const decisionAmount = extractDecisionAmount(params.message);
  const decisionInstallments = extractInstallmentCount(params.message);
  const reply = await buildFinancialAdvisorAssistantReply({
    intent: detectedIntent,
    userId: params.userId,
    timezone: params.timezone,
    referenceDate: params.referenceDate,
    decisionAmount,
    decisionInstallments,
    messageText: params.message,
  });

  return {
    ...reply,
    detectedIntent,
    decisionAmount,
    decisionInstallments,
  };
}
