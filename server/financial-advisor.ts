import { TRPCError } from "@trpc/server";
import { invokeLLM, type Message } from "./_core/llm";
import {
  detectFinancialAssistantIntent,
  extractDecisionAmount,
  extractInstallmentCount,
  type FinancialAssistantIntent,
} from "./_core/financialAssistantIntent";
import * as db from "./db";
import * as asaasDb from "./db/asaas";
import * as advisorDb from "./db/financial-advisor";
import * as whatsappDb from "./db/whatsapp";

type AnyRecord = Record<string, any>;

export type PaymentPriorityItem = {
  id: string;
  title: string;
  source: "calendar" | "debt" | "company" | "personal";
  dueDate: string;
  amount: number;
  status: string;
  urgency: "overdue" | "before_next_income" | "due_soon" | "planned";
  recommendedAction: string;
};

export type FinancialRecommendation = {
  kind:
    | "freeze_discretionary"
    | "charge_follow_up"
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
  }>;
  debts: AnyRecord[];
  investments: AnyRecord[];
  reserveFunds: AnyRecord[];
  asaasCharges: AnyRecord[];
};

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function toNumber(value: string | number | null | undefined) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampCurrency(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
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
  return Math.max(getLastDayOfMonth(parts.year, parts.month) - parts.day + 1, 1);
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

function buildTopRecommendations(args: {
  snapshotBase: Omit<FinancialGovernanceSnapshot, "summary">;
  companyVariableRatio: number;
  personalVariableRatio: number;
}) {
  const { snapshotBase, companyVariableRatio, personalVariableRatio } = args;
  const recommendations: FinancialRecommendation[] = [];

  if (snapshotBase.counts.overdueItems > 0) {
    recommendations.push({
      kind: "pay_priority_items",
      title: "Regularizar vencidos imediatamente",
      description: `Existem ${snapshotBase.counts.overdueItems} itens vencidos ou muito pressionados no fluxo atual.`,
    });
  }

  if (snapshotBase.counts.overdueCharges > 0 || snapshotBase.counts.pendingCharges > 0) {
    recommendations.push({
      kind: "charge_follow_up",
      title: "Atuar nas cobranças abertas do Asaas",
      description: `Há ${snapshotBase.counts.pendingCharges} cobrança(s) pendente(s) e ${snapshotBase.counts.overdueCharges} em atraso pedindo acompanhamento.`,
    });
  }

  if (snapshotBase.companyReserveRecommendation > 0) {
    recommendations.push({
      kind: "transfer_company_reserve",
      title: "Separar valor para reserva da empresa",
      description: "O caixa do mês comporta uma recomposição parcial da reserva empresarial sem comprometer os vencimentos.",
      amount: snapshotBase.companyReserveRecommendation,
      requiresConfirmation: true,
      metadata: { target: "empresa" },
    });
  }

  if (snapshotBase.personalReserveRecommendation > 0) {
    recommendations.push({
      kind: "transfer_personal_reserve",
      title: "Separar valor para reserva pessoal",
      description: "Há espaço para reforçar a reserva pessoal depois das obrigações protegidas do mês.",
      amount: snapshotBase.personalReserveRecommendation,
      requiresConfirmation: true,
      metadata: { target: "pessoal" },
    });
  }

  if (snapshotBase.safeToSpendMonth <= 0) {
    recommendations.push({
      kind: "freeze_discretionary",
      title: "Congelar gastos discricionários",
      description: "O limite seguro do mês foi consumido; novos gastos só deveriam entrar com compensação clara.",
    });
  }

  if (snapshotBase.taxProvision > 0) {
    recommendations.push({
      kind: "protect_tax_provision",
      title: "Proteger provisão de impostos",
      description: "Mantenha a provisão tributária intocada até o fechamento do ciclo financeiro da empresa.",
      amount: snapshotBase.taxProvision,
    });
  }

  if (companyVariableRatio >= 0.45 || personalVariableRatio >= 0.35) {
    recommendations.push({
      kind: "review_variable_costs",
      title: "Revisar custos variáveis do mês",
      description: "O peso dos gastos variáveis está acima do ideal para o momento do caixa e merece corte ou adiamento.",
      metadata: { companyVariableRatio, personalVariableRatio },
    });
  }

  return recommendations.slice(0, 6);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(clampCurrency(value), 100));
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
    if (tone === "healthy") return `Retirar ${amountLabel} parece viavel hoje sem estourar a folga operacional da empresa.`;
    if (tone === "attention") return `Retirar ${amountLabel} e possivel, mas ja pressiona a folga da empresa e pede mais disciplina no mes.`;
    return `Retirar ${amountLabel} agora aumenta demais o risco e tende a apertar o caixa operacional.`;
  }

  if (kind === "personal_spend") {
    if (tone === "healthy") return `Esse gasto extra de ${amountLabel} cabe no plano atual sem desorganizar o mes.`;
    if (tone === "attention") return `Esse gasto extra de ${amountLabel} consome boa parte da folga pessoal e merece cautela.`;
    return `Esse gasto extra de ${amountLabel} tende a furar a folga do mes e reduzir sua seguranca financeira.`;
  }

  if (kind === "monthly_cost") {
    if (tone === "healthy") return `Assumir ${amountLabel}/mes como novo custo parece suportavel no cenario atual.`;
    if (tone === "attention") return `Adicionar ${amountLabel}/mes ja encurta bastante a folga de caixa e pede validacao extra.`;
    return `Adicionar ${amountLabel}/mes agora deixa o plano muito apertado e aumenta o risco do caixa.`;
  }

  if (kind === "hiring") {
    if (tone === "healthy") return `Contratar com um impacto mensal de ${amountLabel} parece viavel sem apertar demais o caixa da empresa.`;
    if (tone === "attention") return `Essa contratacao de ${amountLabel}/mes e possivel, mas ja encurta a folga e pede acompanhamento proximo.`;
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

  if (tone === "healthy") return `Tirar ${amountLabel}/mes da empresa de forma recorrente parece suportavel no cenario atual.`;
  if (tone === "attention") return `Tirar ${amountLabel}/mes da empresa de forma recorrente exige mais disciplina para nao encurtar demais a folga.`;
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
    args.headroom > 0 ? clampPercent((amount / args.headroom) * 100) : amount > 0 ? 100 : 0;

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
  const withdrawalAmount = clampCurrency(Math.max(input?.withdrawalAmount ?? 0, 0));
  const personalSpendAmount = clampCurrency(Math.max(input?.personalSpendAmount ?? 0, 0));
  const monthlyCostAmount = clampCurrency(Math.max(input?.monthlyCostAmount ?? 0, 0));
  const hiringCostAmount = clampCurrency(Math.max(input?.hiringCostAmount ?? 0, 0));
  const installmentPurchaseAmount = clampCurrency(Math.max(input?.installmentPurchaseAmount ?? 0, 0));
  const installmentPurchaseMonths = Math.max(Math.round(input?.installmentPurchaseMonths ?? 12), 1);
  const recurringWithdrawalAmount = clampCurrency(Math.max(input?.recurringWithdrawalAmount ?? 0, 0));

  const companyHeadroom = clampCurrency(
    Math.max(
      snapshot.guardrails.company.projectedCash - snapshot.guardrails.company.reserveRecommendation,
      0
    )
  );
  const personalHeadroom = clampCurrency(
    Math.max(
      snapshot.guardrails.personal.projectedCash - snapshot.guardrails.personal.reserveRecommendation,
      0
    )
  );
  const totalHeadroom = clampCurrency(Math.max(snapshot.safeToSpendMonth, 0));
  const personalUsable = clampCurrency(
    Math.min(personalHeadroom > 0 ? personalHeadroom : totalHeadroom, totalHeadroom)
  );
  const installmentMonthlyAmount = clampCurrency(
    installmentPurchaseMonths > 0 ? installmentPurchaseAmount / installmentPurchaseMonths : installmentPurchaseAmount
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
      { label: "Folga operacional atual", value: companyHeadroom, format: "currency" },
      {
        label: "Folga apos retirada",
        value: clampCurrency(Math.max(companyHeadroom - withdrawalAmount, 0)),
        format: "currency",
      },
      {
        label: "Caixa projetado empresa",
        value: clampCurrency(snapshot.guardrails.company.projectedCash - withdrawalAmount),
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
      { label: "Folga pessoal atual", value: personalHeadroom, format: "currency" },
      { label: "Limite seguro do mes", value: totalHeadroom, format: "currency" },
      {
        label: "Folga pessoal apos gasto",
        value: clampCurrency(Math.max(personalHeadroom - personalSpendAmount, 0)),
        format: "currency",
      },
      {
        label: "Caixa pessoal projetado",
        value: clampCurrency(snapshot.guardrails.personal.projectedCash - personalSpendAmount),
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
        value: clampCurrency(snapshot.guardrails.company.projectedCash - monthlyCostAmount),
        format: "currency",
      },
      {
        label: "Limite seguro apos custo",
        value: clampCurrency(Math.max(snapshot.safeToSpendMonth - monthlyCostAmount, 0)),
        format: "currency",
      },
      { label: "Folga operacional atual", value: companyHeadroom, format: "currency" },
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
      { label: "Custo mensal da contratacao", value: hiringCostAmount, format: "currency" },
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
            ? clampPercent(((employeeCostBase + hiringCostAmount) / companyNetRevenue) * 100)
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
      { label: "Valor total da compra", value: installmentPurchaseAmount, format: "currency" },
      { label: "Parcela mensal", value: installmentMonthlyAmount, format: "currency" },
      { label: "Quantidade de parcelas", value: installmentPurchaseMonths, format: "number" },
      {
        label: "Folga apos parcela",
        value: clampCurrency(Math.max(companyHeadroom - installmentMonthlyAmount, 0)),
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
        value: clampCurrency(Math.max(companyHeadroom - recurringWithdrawalAmount, 0)),
        format: "currency",
      },
      {
        label: "Caixa projetado empresa",
        value: clampCurrency(snapshot.guardrails.company.projectedCash - recurringWithdrawalAmount),
        format: "currency",
      },
      {
        label: "Caixa pessoal projetado",
        value: clampCurrency(snapshot.guardrails.personal.projectedCash + recurringWithdrawalAmount),
        format: "currency",
      },
      {
        label: "Limite seguro apos retirada",
        value: clampCurrency(Math.max(snapshot.safeToSpendMonth - recurringWithdrawalAmount, 0)),
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
  const [settings, company, personal, calendar, debts, investments, reserveFunds, asaasCharges] =
    await Promise.all([
      db.getSettings(userId).catch(() => null),
      db.getCompanyDashboardData(userId, month, year).catch(() => null),
      db.getPersonalDashboardData(userId, month, year).catch(() => null),
      db.getCalendarData(userId, month, year).catch(() => []),
      db.getDebts(userId).catch(() => []),
      db.getInvestments(userId).catch(() => []),
      db.getReserveFunds(userId).catch(() => []),
      asaasDb.listAsaasCharges(userId).catch(() => []),
    ]);

  return {
    generatedAt: iso,
    referenceDate: iso,
    month,
    year,
    settings,
    company,
    personal,
    calendarItems: Array.isArray(calendar) ? calendar : [],
    debts: Array.isArray(debts) ? debts : [],
    investments: Array.isArray(investments) ? investments : [],
    reserveFunds: Array.isArray(reserveFunds) ? reserveFunds : [],
    asaasCharges: Array.isArray(asaasCharges) ? asaasCharges : [],
  };
}

export function calculateFinancialGovernanceSnapshot(
  context: FinancialAdvisorContext,
  options?: { timezone?: string; referenceDate?: Date }
): FinancialGovernanceSnapshot {
  const timezone = options?.timezone || DEFAULT_TIMEZONE;
  const referenceDate = options?.referenceDate ?? parseIsoDate(context.referenceDate) ?? new Date();
  const settings = context.settings ?? {};

  const taxPercent = toNumber(settings.taxPercent ?? "6");
  const tithePercent = toNumber(settings.tithePercent ?? "10");
  const investmentPercent = toNumber(settings.investmentPercent ?? "10");
  const proLaboreGross = toNumber(settings.proLaboreGross ?? "0");
  const companyReserveMonths = Math.max(toNumber(settings.companyReserveMonths ?? 3), 1);
  const personalReserveMonths = Math.max(toNumber(settings.personalReserveMonths ?? 6), 1);
  const companyMinCashMonths = Math.max(toNumber(settings.companyMinCashMonths ?? 1), 0.5);
  const personalMinCashMonths = Math.max(toNumber(settings.personalMinCashMonths ?? 1), 0.5);

  const companyGrossRevenue = toNumber(context.company?.summary?.current?.grossRevenue ?? context.company?.revenue?.totalGross);
  const companyNetRevenue = toNumber(context.company?.summary?.current?.netRevenue ?? context.company?.revenue?.totalNet);
  const companyTaxProvision = Math.max(
    toNumber(context.company?.summary?.current?.taxAmount ?? context.company?.revenue?.totalTax),
    clampCurrency(companyGrossRevenue * (taxPercent / 100))
  );
  const companyFixedCosts = toNumber(context.company?.summary?.current?.fixedCosts ?? context.company?.fixedCosts?.total);
  const companyVariableCosts = toNumber(context.company?.summary?.current?.variableCosts ?? context.company?.variableCosts?.total);
  const companyEmployeeCosts = toNumber(context.company?.summary?.current?.employeeCosts ?? context.company?.employees?.totalCost);
  const companyPurchaseCosts = toNumber(context.company?.summary?.current?.purchases ?? context.company?.purchases?.total);
  const companyReserveTotal = toNumber(context.company?.summary?.current?.reserve ?? context.company?.reserve?.total);
  const companyEssentialMonthly = companyFixedCosts + companyEmployeeCosts + companyPurchaseCosts + proLaboreGross;
  const companyProjectedCash = companyNetRevenue - (companyEssentialMonthly + companyVariableCosts);
  const companyMinCashTarget = companyEssentialMonthly * companyMinCashMonths;
  const companyReserveGoal = companyEssentialMonthly * companyReserveMonths;
  const companyReserveShortfall = Math.max(companyReserveGoal - companyReserveTotal, 0);
  const companyReserveRecommendation =
    companyProjectedCash > 0 ? Math.min(companyReserveShortfall, companyProjectedCash * 0.4) : 0;

  const personalFixedCosts = toNumber(context.personal?.fixedCosts?.total);
  const personalVariableCosts = toNumber(context.personal?.variableCosts?.total);
  const personalDebtMonthly = toNumber(context.personal?.debts?.totalMonthly);
  const titheAmount = clampCurrency(proLaboreGross * (tithePercent / 100));
  const personalInvestmentAmount = clampCurrency(proLaboreGross * (investmentPercent / 100));
  const personalAvailableIncome = Math.max(proLaboreGross - titheAmount - personalInvestmentAmount, 0);
  const personalReserveTotal = toNumber(context.personal?.reserve?.total);
  const personalEssentialMonthly = personalFixedCosts + personalDebtMonthly + titheAmount + personalInvestmentAmount;
  const personalProjectedCash =
    personalAvailableIncome - (personalFixedCosts + personalDebtMonthly + personalVariableCosts);
  const personalMinCashTarget = personalEssentialMonthly * personalMinCashMonths;
  const personalReserveGoal = personalEssentialMonthly * personalReserveMonths;
  const personalReserveShortfall = Math.max(personalReserveGoal - personalReserveTotal, 0);
  const personalReserveRecommendation =
    personalProjectedCash > 0 ? Math.min(personalReserveShortfall, personalProjectedCash * 0.4) : 0;

  const incomingDates = [
    ...(Array.isArray(context.company?.revenue?.items) ? context.company.revenue.items : [])
      .filter((item: AnyRecord) => item.status !== "cancelado" && item.status !== "recebido")
      .map((item: AnyRecord) => String(item.dueDate || "")),
    ...context.asaasCharges
      .filter(charge => {
        const status = String(charge.status || "").toUpperCase();
        return status === "PENDING" || status === "CONFIRMED" || status === "RECEIVED";
      })
      .map(charge => String(charge.dueDate || "")),
  ]
    .map(value => parseIsoDate(value))
    .filter((value): value is Date => Boolean(value))
    .filter(date => diffInDays(referenceDate, date) >= 0)
    .sort((left, right) => left.getTime() - right.getTime());

  const nextIncomingDate = incomingDates[0] ? toIsoDate(incomingDates[0]) : null;
  const nextIncoming = nextIncomingDate ? parseIsoDate(nextIncomingDate) : null;

  const paymentPriority: PaymentPriorityItem[] = context.calendarItems
    .map(item => {
      const dueDate = buildIsoDate(
        context.year,
        context.month,
        Math.max(Math.min(Number(item.day) || 1, getLastDayOfMonth(context.year, context.month)), 1)
      );
      const dueDateObj = parseIsoDate(dueDate) ?? referenceDate;
      const isOverdue =
        String(item.status || "").toLowerCase().includes("atras") || diffInDays(referenceDate, dueDateObj) < 0;
      const beforeNextIncome = !isOverdue && nextIncoming ? dueDateObj.getTime() <= nextIncoming.getTime() : false;
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
        source: item.type.startsWith("empresa")
          ? "company"
          : item.type.startsWith("pessoal")
            ? "personal"
            : item.type === "divida"
              ? "debt"
              : "calendar",
        dueDate,
        amount: clampCurrency(toNumber(item.amount)),
        status: item.status,
        urgency,
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

  const overdueItems = paymentPriority.filter(item => item.urgency === "overdue").length;
  const dueThisWeek = paymentPriority.filter(
    item => item.urgency === "before_next_income" || item.urgency === "due_soon"
  ).length;
  const overdueCharges = context.asaasCharges.filter(charge =>
    String(charge.status || "").toUpperCase().includes("OVERDUE")
  ).length;
  const pendingCharges = context.asaasCharges.filter(charge => {
    const status = String(charge.status || "").toUpperCase();
    return status === "PENDING" || status === "CONFIRMED";
  }).length;

  const totalProjectedCash = companyProjectedCash + personalProjectedCash;
  const totalReserveRecommendation = companyReserveRecommendation + personalReserveRecommendation;
  const safeToSpendMonth = Math.max(totalProjectedCash - totalReserveRecommendation, 0);
  const safeToSpendNow = safeToSpendMonth / daysRemainingInMonth(referenceDate, timezone);
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
  if (!Array.isArray(context.calendarItems) || context.calendarItems.length === 0) confidenceScore -= 0.1;
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
    companyVariableRatio: companyNetRevenue > 0 ? companyVariableCosts / Math.max(companyNetRevenue, 1) : 0,
    personalVariableRatio:
      personalAvailableIncome > 0 ? personalVariableCosts / Math.max(personalAvailableIncome, 1) : 0,
  });

  const completed = { ...snapshotBase, topRecommendations };
  return { ...completed, summary: buildSummary(completed) };
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
  const currentPlan = await whatsappDb.getFinancialPlanByPeriod(userId, snapshot.month, snapshot.year);
  const planActions = currentPlan ? await whatsappDb.listFinancialPlanActions(userId, currentPlan.id) : [];
  const enriched = {
    ...snapshot,
    counts: {
      ...snapshot.counts,
      pendingPlanActions: planActions.filter(action => action.status === "pendente").length,
    },
  };
  const finalized = { ...enriched, summary: buildSummary(enriched) };

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
      recommendation.kind === "pay_priority_items" || recommendation.kind === "freeze_discretionary"
        ? ("alta" as const)
        : recommendation.kind === "review_variable_costs"
          ? ("media" as const)
          : ("baixa" as const),
    dueDate:
      recommendation.kind === "pay_priority_items" && snapshot.paymentPriority[0]
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
      description: "Garantir que o valor tributário do mês não entre no caixa disponível para gasto.",
      priority: "alta" as const,
      dueDate: null,
      status: "pendente" as const,
      metadata: JSON.stringify({ taxProvision: snapshot.taxProvision }),
      snoozedUntil: null,
    },
    {
      actionType: "review_variable_costs",
      title: "Revisar gastos variáveis do mês",
      description: "Mapear o que pode ser cortado, renegociado ou adiado antes do próximo ciclo.",
      priority: "media" as const,
      dueDate: null,
      status: "pendente" as const,
      metadata: JSON.stringify({ paymentPriorityCount: snapshot.paymentPriority.length }),
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
    extra: "Monte um plano mensal executivo com foco em disciplina de caixa, ordem de pagamento e recomposição de reserva.",
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
  const storedActions = await whatsappDb.replaceFinancialPlanActions(params.userId, plan.id, actions);

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

  return { plan, actions: storedActions, snapshot, messageToUser } satisfies FinancialPlanSummary;
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
  const currentPlan = await whatsappDb.getFinancialPlanByPeriod(params.userId, snapshot.month, snapshot.year);
  const planActions = currentPlan ? await whatsappDb.listFinancialPlanActions(params.userId, currentPlan.id) : [];
  const message = await buildNarrative({ kind: "daily", snapshot });
  const alerts = [
    snapshot.counts.overdueItems > 0
      ? `${snapshot.counts.overdueItems} item(ns) vencido(s) exigem regularização hoje.`
      : null,
    snapshot.counts.overdueCharges > 0
      ? `${snapshot.counts.overdueCharges} cobrança(s) do Asaas estão em atraso.`
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
    actions: planActions.filter(action => action.status === "pendente").slice(0, 3),
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
  const currentPlan = await whatsappDb.getFinancialPlanByPeriod(params.userId, snapshot.month, snapshot.year);
  const targetBalance = toNumber(currentPlan?.targetBalance);
  const deviation = clampCurrency(snapshot.safeToSpendMonth - targetBalance);
  const excessSignals = [
    snapshot.guardrails.company.variableCosts > snapshot.guardrails.company.fixedCosts * 0.75
      ? "Custos variáveis da empresa pesaram acima do ideal."
      : null,
    snapshot.guardrails.personal.variableCosts > snapshot.guardrails.personal.fixedCosts * 0.65
      ? "Gastos variáveis pessoais ficaram acima do ponto de conforto."
      : null,
    snapshot.counts.overdueCharges > 0
      ? "Cobranças em atraso do Asaas reduziram previsibilidade do caixa."
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
    extra: JSON.stringify({ targetBalance, deviation, focusNextMonth, excessSignals }),
  });

  await persistSnapshot({
    userId: params.userId,
    integrationId: params.integrationId,
    snapshotType: "month_close",
    referenceDate: snapshot.referenceDate,
    snapshot: { ...snapshot, summary: message },
  });

  return { snapshot, targetBalance, deviation, focusNextMonth, excessSignals, message };
}

export async function confirmFinancialAdvisorAction(userId: number, actionId: number) {
  const action = await whatsappDb.getFinancialPlanActionById(userId, actionId);
  if (!action) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Acao do plano nao encontrada." });
  }
  await whatsappDb.updateFinancialPlanAction(actionId, userId, { status: "concluida" });
  return { success: true };
}

export async function snoozeFinancialAdvisorAlert(userId: number, eventId: number, hours = 24) {
  const event = await whatsappDb.getNotificationEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alerta nao encontrado." });
  }
  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  await whatsappDb.updateNotificationEvent(eventId, userId, { status: "adiado", snoozedUntil });
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

  if (params.intent === "monthly_plan_request") {
    return {
      snapshot,
      reply:
        "Posso registrar agora seu plano financeiro do mês com metas, limites de gasto, reservas e prioridades. Responda CONFIRMAR para eu criar esse plano no sistema.",
      summary: snapshot.summary,
      alerts: snapshot.counts.overdueItems
        ? [`${snapshot.counts.overdueItems} item(ns) vencido(s) devem entrar na primeira linha do plano.`]
        : [],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: true,
    };
  }

  if (params.intent === "spending_limit" || params.intent === "cash_advice") {
    return {
      snapshot,
      reply: `Hoje o limite seguro está em R$ ${snapshot.safeToSpendNow.toFixed(2)} e, no mês, ainda há até R$ ${snapshot.safeToSpendMonth.toFixed(2)} de espaço sem furar as proteções do caixa.`,
      summary: snapshot.summary,
      alerts: snapshot.counts.overdueItems
        ? ["Existem vencidos pressionando o orçamento antes de qualquer gasto novo."]
        : [],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
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
    const installments = Math.max(Math.round(params.decisionInstallments ?? 0), 0);
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
        alerts: snapshot.counts.overdueItems
          ? ["Existem vencidos pressionando o caixa antes de assumir novas saídas."]
          : [],
        suggestedActions: snapshot.topRecommendations,
        requiresConfirmation: false,
      };
    }

    if (params.intent === "installment_purchase_decision" && installments <= 0) {
      return {
        snapshot,
        reply:
          "Consigo avaliar essa compra parcelada, mas preciso da quantidade de parcelas. Exemplo: 'Posso comprar um notebook de R$ 12.000 em 12x?'",
        summary: snapshot.summary,
        alerts: snapshot.counts.overdueItems
          ? ["Existem vencidos pressionando o caixa antes de assumir novas saídas."]
          : [],
        suggestedActions: snapshot.topRecommendations,
        requiresConfirmation: false,
      };
    }

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      withdrawalAmount: params.intent === "company_withdrawal_decision" ? amount : 0,
      recurringWithdrawalAmount: params.intent === "recurring_withdrawal_decision" ? amount : 0,
      personalSpendAmount: params.intent === "personal_spend_decision" ? amount : 0,
      monthlyCostAmount: params.intent === "monthly_cost_decision" ? amount : 0,
      hiringCostAmount: params.intent === "hiring_decision" ? amount : 0,
      installmentPurchaseAmount: params.intent === "installment_purchase_decision" ? amount : 0,
      installmentPurchaseMonths: params.intent === "installment_purchase_decision" ? installments : 0,
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
    ].filter(Boolean) as string[];

    return {
      snapshot,
      reply,
      summary: assessment.summary,
      alerts,
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
    };
  }

  if (params.intent === "reserve_transfer") {
    return {
      snapshot,
      reply: `A recomendação atual é separar R$ ${snapshot.companyReserveRecommendation.toFixed(2)} para a reserva da empresa e R$ ${snapshot.personalReserveRecommendation.toFixed(2)} para a reserva pessoal, desde que você confirme essa alocação.`,
      summary: snapshot.summary,
      alerts: [],
      suggestedActions: snapshot.topRecommendations.filter(action =>
        action.kind === "transfer_company_reserve" || action.kind === "transfer_personal_reserve"
      ),
      requiresConfirmation: true,
    };
  }

  if (params.intent === "payment_priority" || params.intent === "upcoming_bills" || params.intent === "overdue_items") {
    const topItems = snapshot.paymentPriority.slice(0, 3);
    return {
      snapshot,
      reply: topItems.length
        ? `Sua ordem de pagamento agora é: ${topItems.map(item => `${item.title} (${item.dueDate})`).join(", ")}.`
        : "Nao encontrei pagamentos pressionando o caixa agora, mas sigo monitorando o calendário do mês.",
      summary: snapshot.summary,
      alerts: snapshot.counts.overdueItems
        ? [`${snapshot.counts.overdueItems} item(ns) vencido(s) estão no topo da prioridade.`]
        : [],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
    };
  }

  if (params.intent === "financial_health" || params.intent === "consolidated_analysis") {
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
      alerts: snapshot.counts.overdueCharges
        ? [`${snapshot.counts.overdueCharges} cobrança(s) em atraso reduzem previsibilidade do caixa.`]
        : [],
      suggestedActions: snapshot.topRecommendations,
      requiresConfirmation: false,
    };
  }

  return {
    snapshot,
    reply:
      "Consigo te orientar sobre quanto pode gastar, quais contas pagar primeiro, quanto separar para reserva e como está a saúde financeira da empresa e do pessoal.",
    summary: snapshot.summary,
    alerts: [],
    suggestedActions: snapshot.topRecommendations,
    requiresConfirmation: false,
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
