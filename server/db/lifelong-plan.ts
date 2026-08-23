import { and, asc, desc, eq } from "drizzle-orm";
import {
  allocationExecutions,
  allocationPolicies,
  assetValuations,
  assets,
  carQuotes,
  creditCleanupTasks,
  creditHealthSnapshots,
  dividendEvents,
  financialAccounts,
  financialActions,
  financialAuditEvents,
  financialIndependenceTargets,
  financialItems,
  financialPhases,
  financialProfiles,
  financialTasks,
  financialTransactions,
  financingContracts,
  financingQuotes,
  incomeEvents,
  insuranceQuotes,
  investmentAccounts,
  investmentCashflows,
  investmentPolicyStatements,
  investmentPositions,
  operatingBuffers,
  portfolioSnapshots,
  riskProtocolEvents,
  sinkingFunds,
  tradeInQuotes,
} from "../../drizzle/schema";
import {
  FINANCIAL_PHASES,
  calculateFinancialIndependence,
  calculateV3IncomeAllocation,
  calculateYearsToFinancialTarget,
  determineFinancialPhase,
  determineFinancialRiskLevel,
  type FinancialPhase,
  type IncomeKind,
} from "../../shared/financial-core";
import { getDb } from "../db";
import type { FinancialActor, FinancialScope } from "./financial-core";

const OPEN_PAYABLE_STATUSES = [
  "draft",
  "scheduled",
  "pending",
  "partially_paid",
  "overdue",
];
const CONFIRMED_INCOME_STATUSES = new Set(["confirmed", "received", "paid"]);

export type LifelongWriteContext = {
  idempotencyKey: string;
  actor: FinancialActor;
  conversationId?: string | null;
  messageId?: string | null;
};

function assertScope(scope: FinancialScope) {
  if (!Number.isInteger(scope.tenantId) || scope.tenantId <= 0)
    throw new Error("Tenant invalido");
  if (!Number.isInteger(scope.userId) || scope.userId <= 0)
    throw new Error("Usuario invalido");
}

function validPhase(value: string): value is FinancialPhase {
  return FINANCIAL_PHASES.includes(value as FinancialPhase);
}

function assertCents(value: number, label: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0))
    throw new Error(`${label} deve ser inteiro em centavos`);
}

function assertWriteContext(context: LifelongWriteContext) {
  const key = context.idempotencyKey.trim();
  if (key.length < 8 || key.length > 255)
    throw new Error("Chave idempotente invalida");
  return key;
}

function actionReplay(action: typeof financialActions.$inferSelect) {
  const snapshot =
    action.resultSnapshot && typeof action.resultSnapshot === "object"
      ? (action.resultSnapshot as Record<string, unknown>)
      : {};
  const result = {
    ...snapshot,
    action_id: String(action.id),
    entity_id: action.entityId,
    external_bank_movement: false as const,
  };
  return {
    ...result,
    result,
    alreadyProcessed: true,
    already_processed: true,
  };
}

function actionResponse<T extends Record<string, unknown>>(
  result: T,
  alreadyProcessed: boolean
) {
  return {
    result,
    ...result,
    alreadyProcessed,
    already_processed: alreadyProcessed,
  };
}

function lifelongWriteResult(
  input: {
    entityType: string;
    entityId: number;
    operation: "created" | "updated" | "cancelled";
    summary: string;
    projectedDeltaCents?: number;
    warnings?: string[];
  },
  data: Record<string, unknown>
) {
  return {
    success: true as const,
    entity_type: input.entityType,
    entity_id: String(input.entityId),
    operation: input.operation,
    human_summary: input.summary,
    financial_impact: {
      confirmed_balance_delta_cents: 0,
      projected_balance_delta_cents: input.projectedDeltaCents ?? 0,
      free_balance_delta_cents: 0,
    },
    warnings: input.warnings ?? [],
    undo_available_until: null,
    external_bank_movement: false as const,
    ...data,
  };
}

function todayIso(reference: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

function onboardingAnswers(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const answers = (value as Record<string, unknown>).answers;
  return answers && typeof answers === "object"
    ? (answers as Record<string, unknown>)
    : {};
}

export async function getLifelongPlanData(
  scope: FinancialScope,
  referenceDate = new Date()
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [
    profileRows,
    accounts,
    phases,
    policies,
    executions,
    buffers,
    funds,
    assetRows,
    creditRows,
    cleanupTasks,
    vehicleQuotes,
    tradeQuotes,
    insuranceRows,
    financeQuotes,
    financeContracts,
    investmentPolicies,
    investmentAccountRows,
    positions,
    dividends,
    portfolioHistory,
    targets,
    riskEvents,
    items,
    tasks,
  ] = await Promise.all([
    db
      .select()
      .from(financialProfiles)
      .where(
        and(
          eq(financialProfiles.tenantId, scope.tenantId),
          eq(financialProfiles.userId, scope.userId)
        )
      )
      .limit(1),
    db
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      ),
    db
      .select()
      .from(financialPhases)
      .where(
        and(
          eq(financialPhases.tenantId, scope.tenantId),
          eq(financialPhases.userId, scope.userId)
        )
      )
      .orderBy(desc(financialPhases.startedAt)),
    db
      .select()
      .from(allocationPolicies)
      .where(
        and(
          eq(allocationPolicies.tenantId, scope.tenantId),
          eq(allocationPolicies.userId, scope.userId),
          eq(allocationPolicies.active, true)
        )
      )
      .orderBy(
        asc(allocationPolicies.phase),
        asc(allocationPolicies.incomeKind)
      ),
    db
      .select()
      .from(allocationExecutions)
      .where(
        and(
          eq(allocationExecutions.tenantId, scope.tenantId),
          eq(allocationExecutions.userId, scope.userId)
        )
      )
      .orderBy(desc(allocationExecutions.createdAt))
      .limit(20),
    db
      .select()
      .from(operatingBuffers)
      .where(
        and(
          eq(operatingBuffers.tenantId, scope.tenantId),
          eq(operatingBuffers.userId, scope.userId),
          eq(operatingBuffers.status, "active")
        )
      ),
    db
      .select()
      .from(sinkingFunds)
      .where(
        and(
          eq(sinkingFunds.tenantId, scope.tenantId),
          eq(sinkingFunds.userId, scope.userId),
          eq(sinkingFunds.status, "active")
        )
      ),
    db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.tenantId, scope.tenantId),
          eq(assets.userId, scope.userId)
        )
      )
      .orderBy(desc(assets.updatedAt)),
    db
      .select()
      .from(creditHealthSnapshots)
      .where(
        and(
          eq(creditHealthSnapshots.tenantId, scope.tenantId),
          eq(creditHealthSnapshots.userId, scope.userId)
        )
      )
      .orderBy(desc(creditHealthSnapshots.observedAt)),
    db
      .select()
      .from(creditCleanupTasks)
      .where(
        and(
          eq(creditCleanupTasks.tenantId, scope.tenantId),
          eq(creditCleanupTasks.userId, scope.userId)
        )
      )
      .orderBy(asc(creditCleanupTasks.priority), asc(creditCleanupTasks.id)),
    db
      .select()
      .from(carQuotes)
      .where(
        and(
          eq(carQuotes.tenantId, scope.tenantId),
          eq(carQuotes.userId, scope.userId)
        )
      )
      .orderBy(desc(carQuotes.createdAt)),
    db
      .select()
      .from(tradeInQuotes)
      .where(
        and(
          eq(tradeInQuotes.tenantId, scope.tenantId),
          eq(tradeInQuotes.userId, scope.userId)
        )
      )
      .orderBy(desc(tradeInQuotes.createdAt)),
    db
      .select()
      .from(insuranceQuotes)
      .where(
        and(
          eq(insuranceQuotes.tenantId, scope.tenantId),
          eq(insuranceQuotes.userId, scope.userId)
        )
      )
      .orderBy(desc(insuranceQuotes.createdAt)),
    db
      .select()
      .from(financingQuotes)
      .where(
        and(
          eq(financingQuotes.tenantId, scope.tenantId),
          eq(financingQuotes.userId, scope.userId)
        )
      )
      .orderBy(asc(financingQuotes.cetAnnualBasisPoints)),
    db
      .select()
      .from(financingContracts)
      .where(
        and(
          eq(financingContracts.tenantId, scope.tenantId),
          eq(financingContracts.userId, scope.userId)
        )
      )
      .orderBy(desc(financingContracts.createdAt)),
    db
      .select()
      .from(investmentPolicyStatements)
      .where(
        and(
          eq(investmentPolicyStatements.tenantId, scope.tenantId),
          eq(investmentPolicyStatements.userId, scope.userId)
        )
      )
      .orderBy(desc(investmentPolicyStatements.createdAt)),
    db
      .select()
      .from(investmentAccounts)
      .where(
        and(
          eq(investmentAccounts.tenantId, scope.tenantId),
          eq(investmentAccounts.userId, scope.userId)
        )
      )
      .orderBy(asc(investmentAccounts.institution)),
    db
      .select()
      .from(investmentPositions)
      .where(
        and(
          eq(investmentPositions.tenantId, scope.tenantId),
          eq(investmentPositions.userId, scope.userId)
        )
      ),
    db
      .select()
      .from(dividendEvents)
      .where(
        and(
          eq(dividendEvents.tenantId, scope.tenantId),
          eq(dividendEvents.userId, scope.userId)
        )
      )
      .orderBy(desc(dividendEvents.paymentDate))
      .limit(100),
    db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.tenantId, scope.tenantId),
          eq(portfolioSnapshots.userId, scope.userId)
        )
      )
      .orderBy(desc(portfolioSnapshots.capturedAt))
      .limit(24),
    db
      .select()
      .from(financialIndependenceTargets)
      .where(
        and(
          eq(financialIndependenceTargets.tenantId, scope.tenantId),
          eq(financialIndependenceTargets.userId, scope.userId),
          eq(financialIndependenceTargets.status, "active")
        )
      )
      .orderBy(desc(financialIndependenceTargets.updatedAt)),
    db
      .select()
      .from(riskProtocolEvents)
      .where(
        and(
          eq(riskProtocolEvents.tenantId, scope.tenantId),
          eq(riskProtocolEvents.userId, scope.userId)
        )
      )
      .orderBy(desc(riskProtocolEvents.createdAt))
      .limit(20),
    db
      .select()
      .from(financialItems)
      .where(
        and(
          eq(financialItems.tenantId, scope.tenantId),
          eq(financialItems.userId, scope.userId)
        )
      )
      .orderBy(asc(financialItems.dueDate)),
    db
      .select()
      .from(financialTasks)
      .where(
        and(
          eq(financialTasks.tenantId, scope.tenantId),
          eq(financialTasks.userId, scope.userId)
        )
      ),
  ]);
  const profile = profileRows[0];
  if (!profile) return null;
  const today = todayIso(referenceDate, profile.timezone);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const operatingBalanceCents = accounts
    .filter(account => account.includeInOperatingCash && !account.protected)
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const emergencyFundCents = accounts
    .filter(account => account.accountType === "reserve")
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const bufferTargetCents =
    buffers.reduce((sum, buffer) => sum + buffer.targetCents, 0) ||
    profile.operatingBufferCents;
  const fundValue = (purpose: string) =>
    funds
      .filter(fund => fund.purpose === purpose)
      .reduce((sum, fund) => {
        const accountBalance = fund.accountId
          ? accountById.get(fund.accountId)?.currentBalanceCents
          : null;
        return sum + Math.max(fund.fundedCents, accountBalance ?? 0);
      }, 0);
  const fundTarget = (purpose: string, fallback: number) =>
    funds
      .filter(fund => fund.purpose === purpose)
      .reduce((sum, fund) => sum + fund.targetCents, 0) || fallback;
  const carCashCents = fundValue("car_cash");
  const carCostsCents = fundValue("car_costs");
  const carCashTargetCents = fundTarget("car_cash", 3_000_000);
  const carCostsTargetCents = fundTarget("car_costs", 300_000);
  const openPayables = items.filter(
    item =>
      item.kind === "payable" && OPEN_PAYABLE_STATUSES.includes(item.status)
  );
  const overduePayables = openPayables.filter(
    item => item.status === "overdue" || item.dueDate < today
  );
  const overdueCents = overduePayables.reduce(
    (sum, item) => sum + item.openAmountCents,
    0
  );
  const openPayableCents = openPayables.reduce(
    (sum, item) => sum + item.openAmountCents,
    0
  );
  const openReceivableCents = items
    .filter(
      item =>
        item.kind === "receivable" &&
        [
          "draft",
          "expected",
          "pending",
          "partially_received",
          "overdue",
        ].includes(item.status)
    )
    .reduce((sum, item) => sum + item.openAmountCents, 0);
  const latestCredit = creditRows[0] ?? null;
  const unresolvedCreditTasks = cleanupTasks.filter(
    task => !["completed", "paid", "cancelled"].includes(task.status)
  );
  const investableNetWorthCents = positions.reduce(
    (sum, position) => sum + position.marketValueCents,
    0
  );
  const fiTarget = targets[0] ?? null;
  const fi = calculateFinancialIndependence({
    monthlySpendingCents:
      fiTarget?.monthlySpendingCentsToday ??
      profile.emergencyFundReferenceCents + profile.monthlyVariableBudgetCents,
    investableNetWorthCents,
    withdrawalRateBasisPoints: fiTarget?.withdrawalRateBasisPoints ?? 350,
  });
  const activeContract = financeContracts.find(row => row.status === "active");
  const purchasedVehicle = assetRows.find(
    asset =>
      asset.assetType === "vehicle" &&
      asset.intendedUse === "primary_vehicle" &&
      asset.status === "owned"
  );
  const bestFinance = financeQuotes[0] ?? null;
  const latestInsurance = insuranceRows[0] ?? null;
  const carAllInMonthlyCents =
    (bestFinance?.installmentCents ?? activeContract?.installmentCents ?? 0) +
    Math.ceil((latestInsurance?.annualPremiumCents ?? 0) / 12);
  const suggestedPhase = determineFinancialPhase({
    overdueDebtCents: overdueCents + (latestCredit?.overdueCents ?? 0),
    overdraftUsedCents: latestCredit?.overdraftUsedCents ?? 0,
    operatingBufferCents: Math.max(0, operatingBalanceCents),
    operatingBufferTargetCents: bufferTargetCents,
    emergencyFundCents,
    minimumEmergencyFundCents: 4_908_000,
    postCarEmergencyFundCents: 7_428_000,
    carCashCents,
    carCashTargetCents,
    carCostsCents,
    carCostsTargetCents,
    cleanCreditMonths: latestCredit?.cleanMonths ?? 0,
    futureIncomeConfirmed: profile.income2027Confirmed,
    vehiclePurchased: Boolean(purchasedVehicle),
    carAllInMonthlyCents,
    carMonthlyLimitCents: profile.carMonthlyLimitCents,
    carDebtCents: activeContract?.currentBalanceCents ?? 0,
    financialIndependenceRatioBasisPoints: fi.ratioBasisPoints,
  });
  const storedPhase = phases.find(row => row.status === "active")?.phase;
  const phaseCandidate = storedPhase ?? profile.currentPhase;
  const currentPhase: FinancialPhase = validPhase(phaseCandidate)
    ? phaseCandidate
    : "CLEANUP";
  const answers = onboardingAnswers(profile.onboardingState);
  const reconciledSince =
    typeof answers.reconciledSince === "string"
      ? answers.reconciledSince
      : null;
  const reconciledDays = reconciledSince
    ? Math.max(
        0,
        Math.floor(
          (new Date(`${today}T12:00:00.000Z`).getTime() -
            new Date(`${reconciledSince}T12:00:00.000Z`).getTime()) /
            86_400_000
        )
      )
    : 0;
  const reserveMonths =
    profile.emergencyFundReferenceCents > 0
      ? emergencyFundCents / profile.emergencyFundReferenceCents
      : 0;
  const riskLevel = determineFinancialRiskLevel({
    overdueCents: overdueCents + (latestCredit?.overdueCents ?? 0),
    overdraftUsedCents: latestCredit?.overdraftUsedCents ?? 0,
    reserveMonths,
    variableBudgetUsedPercent: 0,
  });
  const recentConfirmedExecutions = executions
    .filter(execution => execution.status === "confirmed")
    .slice(0, 6);
  const recentInvestmentContributionsCents = recentConfirmedExecutions.reduce(
    (sum, execution) => {
      const allocations = Array.isArray(execution.allocations)
        ? execution.allocations
        : [];
      return (
        sum +
        allocations
          .filter(
            (row): row is { destination: string; amountCents: number } =>
              Boolean(row) &&
              typeof row === "object" &&
              "destination" in row &&
              "amountCents" in row &&
              (row as { destination: unknown }).destination === "investments" &&
              Number.isSafeInteger(
                (row as { amountCents: unknown }).amountCents
              )
          )
          .reduce((subtotal, row) => subtotal + row.amountCents, 0)
      );
    },
    0
  );
  const monthlyContributionCents =
    recentConfirmedExecutions.length > 0
      ? Math.floor(
          recentInvestmentContributionsCents / recentConfirmedExecutions.length
        )
      : 0;

  return {
    currentPhase,
    suggestedPhase,
    phaseChangePending: currentPhase !== suggestedPhase,
    phaseHistory: phases,
    allocationPolicies: policies,
    recentAllocationExecutions: executions,
    operatingBuffer: {
      currentCents: operatingBalanceCents,
      targetCents: bufferTargetCents,
      gapCents: Math.max(0, bufferTargetCents - operatingBalanceCents),
      records: buffers,
    },
    emergencyFund: {
      currentCents: emergencyFundCents,
      minimumTargetCents: 4_908_000,
      postCarTargetCents: 7_428_000,
    },
    sinkingFunds: funds,
    operations: {
      openPayableCents,
      openReceivableCents,
      overdueCents,
      overduePayables,
      conservativeFreeBalanceCents: Math.max(
        0,
        operatingBalanceCents - openPayableCents - bufferTargetCents
      ),
    },
    creditHealth: {
      latest: latestCredit,
      history: creditRows,
      cleanupTasks,
      unresolvedTasks: unresolvedCreditTasks,
      resolved:
        (latestCredit?.overdueCents ?? 0) === 0 &&
        (latestCredit?.overdraftUsedCents ?? 0) === 0 &&
        unresolvedCreditTasks.length === 0,
    },
    carPlan: {
      assets: assetRows,
      currentVehicle:
        assetRows.find(asset => asset.intendedUse === "trade_in") ?? null,
      purchasedVehicle: purchasedVehicle ?? null,
      carCashCents,
      carCashTargetCents,
      carCostsCents,
      carCostsTargetCents,
      vehicleQuotes,
      tradeInQuotes: tradeQuotes,
      insuranceQuotes: insuranceRows,
      financingQuotes: financeQuotes,
      financingContracts: financeContracts,
      bestFinancingQuote: bestFinance,
      allInMonthlyCents: carAllInMonthlyCents,
      quotesComplete:
        vehicleQuotes.length > 0 &&
        tradeQuotes.length > 0 &&
        insuranceRows.length > 0 &&
        financeQuotes.length > 0,
      reconciledDays,
    },
    wealth: {
      investmentPolicy:
        investmentPolicies.find(policy => policy.status === "active") ??
        investmentPolicies[0] ??
        null,
      investmentAccounts: investmentAccountRows,
      positions,
      dividends,
      portfolioHistory,
      investableNetWorthCents,
      target: fiTarget,
      annualSpendingCents: fi.annualSpendingCents,
      targetRealCents: fi.targetRealCents,
      sustainableMonthlyCents: fi.sustainableMonthlyCents,
      ratioBasisPoints: fi.ratioBasisPoints,
      projectedYearsAtRecentContribution: calculateYearsToFinancialTarget({
        targetCents: fi.targetRealCents,
        currentCents: investableNetWorthCents,
        monthlyContributionCents,
      }),
    },
    income2027Confirmed: profile.income2027Confirmed,
    riskLevel,
    riskEvents,
    openItems: items,
    tasks,
  };
}

export async function proposeIncomeAllocationV3(
  scope: FinancialScope,
  input: {
    transactionId: number;
    incomeKind: IncomeKind;
    idempotencyKey: string;
    actor: FinancialActor;
    conversationId?: string | null;
    messageId?: string | null;
  }
) {
  assertScope(scope);
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 255)
    throw new Error("Chave idempotente invalida");
  const plan = await getLifelongPlanData(scope);
  if (!plan) throw new Error("Plano financeiro nao configurado");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(allocationExecutions)
      .where(
        and(
          eq(allocationExecutions.tenantId, scope.tenantId),
          eq(allocationExecutions.userId, scope.userId),
          eq(allocationExecutions.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (existing) {
      const [action] = await tx
        .select()
        .from(financialActions)
        .where(
          and(
            eq(financialActions.tenantId, scope.tenantId),
            eq(financialActions.userId, scope.userId),
            eq(financialActions.idempotencyKey, `${idempotencyKey}:action`)
          )
        )
        .limit(1);
      return action
        ? { execution: existing, ...actionReplay(action) }
        : { execution: existing, alreadyProcessed: true };
    }
    const [transaction] = await tx
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.id, input.transactionId),
          eq(financialTransactions.tenantId, scope.tenantId),
          eq(financialTransactions.userId, scope.userId)
        )
      )
      .limit(1);
    if (!transaction || transaction.type !== "income")
      throw new Error("Receita confirmada nao encontrada");
    if (
      !CONFIRMED_INCOME_STATUSES.has(transaction.status) ||
      transaction.reversedAt ||
      transaction.reversalOfId
    )
      throw new Error("A receita ainda nao esta confirmada");
    const emergencyTarget = [
      "POST_CAR_RESERVE",
      "WEALTH_WITH_CAR_DEBT",
    ].includes(plan.currentPhase)
      ? 7_428_000
      : 4_908_000;
    const allocation = calculateV3IncomeAllocation({
      amountCents: transaction.amountCents,
      incomeKind: input.incomeKind,
      phase: plan.currentPhase,
      overdueCents: plan.operations.overdueCents,
      essentialGapCents: plan.operations.openPayableCents,
      operatingBufferGapCents: plan.operatingBuffer.gapCents,
      emergencyGapCents: Math.max(
        0,
        emergencyTarget - plan.emergencyFund.currentCents
      ),
      carCashGapCents: Math.max(
        0,
        plan.carPlan.carCashTargetCents - plan.carPlan.carCashCents
      ),
      carCostsGapCents: Math.max(
        0,
        plan.carPlan.carCostsTargetCents - plan.carPlan.carCostsCents
      ),
    });
    const policy = plan.allocationPolicies.find(
      row =>
        row.phase === plan.currentPhase &&
        (row.incomeKind === input.incomeKind || row.incomeKind === "any")
    );
    await tx
      .insert(incomeEvents)
      .values({
        ...scope,
        transactionId: transaction.id,
        incomeKind: input.incomeKind,
        availableCents: transaction.amountCents,
        allocatedCents: 0,
        status: "allocation_proposed",
      })
      .onConflictDoUpdate({
        target: [
          incomeEvents.tenantId,
          incomeEvents.userId,
          incomeEvents.transactionId,
        ],
        set: {
          incomeKind: input.incomeKind,
          availableCents: transaction.amountCents,
          status: "allocation_proposed",
        },
      });
    const [execution] = await tx
      .insert(allocationExecutions)
      .values({
        ...scope,
        incomeTransactionId: transaction.id,
        phase: plan.currentPhase,
        policyVersion: policy?.version ?? "v3-deterministic-engine",
        totalCents: transaction.amountCents,
        allocations: allocation.allocations,
        status: "proposed",
        idempotencyKey,
      })
      .returning();
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actionType: "allocation.propose",
        entityType: "allocation_execution",
        entityId: String(execution.id),
        beforeSnapshot: null,
        afterSnapshot: execution,
        resultSnapshot: {
          executionId: execution.id,
          allocations: allocation.allocations,
        },
        idempotencyKey: `${idempotencyKey}:action`,
      })
      .returning();
    const result = {
      ...lifelongWriteResult(
        {
          entityType: "allocation_execution",
          entityId: execution.id,
          operation: "created",
          summary: `Proposta de alocacao criada para ${transaction.amountCents} centavos.`,
          warnings: [
            "A proposta ainda precisa de confirmacao e nao movimentou dinheiro.",
          ],
        },
        { allocation: allocation.allocations }
      ),
      action_id: String(action.id),
      external_bank_movement: false,
    };
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "allocation.proposed",
      entityType: "allocation_execution",
      entityId: String(execution.id),
      after: execution,
      requestId: idempotencyKey,
    });
    return { execution, allocation, ...actionResponse(result, false) };
  });
}

export async function confirmIncomeAllocationV3(
  scope: FinancialScope,
  input: { executionId: number } & LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(allocationExecutions)
      .where(
        and(
          eq(allocationExecutions.id, input.executionId),
          eq(allocationExecutions.tenantId, scope.tenantId),
          eq(allocationExecutions.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Proposta de alocacao nao encontrada");
    if (before.status === "confirmed") {
      const [confirmationAction] = await tx
        .select()
        .from(financialActions)
        .where(
          and(
            eq(financialActions.tenantId, scope.tenantId),
            eq(financialActions.userId, scope.userId),
            eq(financialActions.actionType, "allocation.confirm"),
            eq(financialActions.entityId, String(before.id))
          )
        )
        .orderBy(desc(financialActions.createdAt))
        .limit(1);
      if (confirmationAction)
        return {
          execution: before,
          ...actionReplay(confirmationAction),
        };
      throw new Error("A proposta ja foi confirmada sem acao rastreavel");
    }
    if (before.status !== "proposed")
      throw new Error("A proposta nao esta disponivel para confirmacao");
    const now = new Date();
    const [execution] = await tx
      .update(allocationExecutions)
      .set({ status: "confirmed", confirmedByUserAt: now, updatedAt: now })
      .where(eq(allocationExecutions.id, before.id))
      .returning();
    await tx
      .update(incomeEvents)
      .set({
        allocatedCents: before.totalCents,
        status: "allocated",
      })
      .where(
        and(
          eq(incomeEvents.tenantId, scope.tenantId),
          eq(incomeEvents.userId, scope.userId),
          eq(incomeEvents.transactionId, before.incomeTransactionId)
        )
      );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actionType: "allocation.confirm",
        entityType: "allocation_execution",
        entityId: String(execution.id),
        beforeSnapshot: before,
        afterSnapshot: execution,
        idempotencyKey,
      })
      .returning();
    const result = {
      ...lifelongWriteResult(
        {
          entityType: "allocation_execution",
          entityId: execution.id,
          operation: "updated",
          summary: `Alocacao ${execution.id} confirmada no plano.`,
          warnings: ["Nenhuma transferencia bancaria foi executada."],
        },
        { execution }
      ),
      action_id: String(action.id),
      external_bank_movement: false,
    };
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "allocation.confirmed",
      entityType: "allocation_execution",
      entityId: String(before.id),
      before,
      after: execution,
      requestId: idempotencyKey,
    });
    return { execution, ...actionResponse(result, false) };
  });
}

export async function confirmFinancialPhaseV3(
  scope: FinancialScope,
  input: {
    phase: FinancialPhase;
    reason: string;
  } & LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(input);
  if (!validPhase(input.phase)) throw new Error("Fase financeira invalida");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);
  const plan = await getLifelongPlanData(scope);
  if (!plan) throw new Error("Plano financeiro nao configurado");
  if (plan.suggestedPhase !== input.phase)
    throw new Error("A fase informada nao corresponde aos dados atuais");
  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(financialPhases)
      .where(
        and(
          eq(financialPhases.tenantId, scope.tenantId),
          eq(financialPhases.userId, scope.userId),
          eq(financialPhases.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (existing)
      throw new Error("Fase confirmada sem acao rastreavel correspondente");
    const now = new Date();
    await tx
      .update(financialPhases)
      .set({ status: "completed", endedAt: now })
      .where(
        and(
          eq(financialPhases.tenantId, scope.tenantId),
          eq(financialPhases.userId, scope.userId),
          eq(financialPhases.status, "active")
        )
      );
    const [phase] = await tx
      .insert(financialPhases)
      .values({
        ...scope,
        phase: input.phase,
        status: "active",
        reason: input.reason.trim(),
        snapshot: {
          previousPhase: plan.currentPhase,
          suggestedPhase: plan.suggestedPhase,
          riskLevel: plan.riskLevel,
        },
        idempotencyKey,
      })
      .returning();
    await tx
      .update(financialProfiles)
      .set({ currentPhase: input.phase, updatedAt: now })
      .where(
        and(
          eq(financialProfiles.tenantId, scope.tenantId),
          eq(financialProfiles.userId, scope.userId)
        )
      );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actionType: "financial_phase.confirm",
        entityType: "financial_phase",
        entityId: String(phase.id),
        beforeSnapshot: { phase: plan.currentPhase },
        afterSnapshot: phase,
        idempotencyKey,
      })
      .returning();
    const result = {
      ...lifelongWriteResult(
        {
          entityType: "financial_phase",
          entityId: phase.id,
          operation: "updated",
          summary: `Fase financeira alterada para ${phase.phase}.`,
          warnings: [
            "Mudanca interna do plano; nenhum dinheiro foi movimentado.",
          ],
        },
        { phase }
      ),
      action_id: String(action.id),
      external_bank_movement: false,
    };
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "financial_phase.confirmed",
      entityType: "financial_phase",
      entityId: String(phase.id),
      before: { phase: plan.currentPhase },
      after: phase,
      requestId: idempotencyKey,
    });
    return { phase, ...actionResponse(result, false) };
  });
}

export async function setIncome2027ConfirmationV3(
  scope: FinancialScope,
  input: { confirmed: boolean } & LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(financialProfiles)
      .where(
        and(
          eq(financialProfiles.tenantId, scope.tenantId),
          eq(financialProfiles.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Perfil financeiro nao encontrado");
    const [profile] = await tx
      .update(financialProfiles)
      .set({ income2027Confirmed: input.confirmed, updatedAt: new Date() })
      .where(eq(financialProfiles.id, before.id))
      .returning();
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actionType: "income_2027.confirmation.update",
        entityType: "financial_profile",
        entityId: String(profile.id),
        beforeSnapshot: {
          income2027Confirmed: before.income2027Confirmed,
        },
        afterSnapshot: {
          income2027Confirmed: profile.income2027Confirmed,
        },
        idempotencyKey,
      })
      .returning();
    const result = {
      ...lifelongWriteResult(
        {
          entityType: "financial_profile",
          entityId: profile.id,
          operation: "updated",
          summary: input.confirmed
            ? "Renda de 2027 marcada como confirmada."
            : "Confirmacao da renda de 2027 removida.",
          warnings: input.confirmed
            ? ["A confirmacao cadastral nao antecipa dinheiro no saldo."]
            : [],
        },
        { profile }
      ),
      action_id: String(action.id),
      external_bank_movement: false,
    };
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "income_2027.confirmation_updated",
      entityType: "financial_profile",
      entityId: String(profile.id),
      before: { income2027Confirmed: before.income2027Confirmed },
      after: { income2027Confirmed: profile.income2027Confirmed },
      requestId: idempotencyKey,
    });
    return { profile, ...actionResponse(result, false) };
  });
}

export async function recordCreditHealthSnapshotV3(
  scope: FinancialScope,
  input: {
    sourceMonth: string;
    currentDebtCents: number;
    overdueCents: number;
    unusedLimitsCents: number;
    overdraftUsedCents: number;
    revolvingCreditCents: number;
    cleanMonths: number;
    status: "confirmed" | "needs_confirmation";
    issues?: unknown;
  } & LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(input);
  const values = [
    input.currentDebtCents,
    input.overdueCents,
    input.unusedLimitsCents,
    input.overdraftUsedCents,
    input.revolvingCreditCents,
  ];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0))
    throw new Error("Valores de credito devem ser inteiros em centavos");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(creditHealthSnapshots)
      .where(
        and(
          eq(creditHealthSnapshots.tenantId, scope.tenantId),
          eq(creditHealthSnapshots.userId, scope.userId),
          eq(creditHealthSnapshots.sourceMonth, input.sourceMonth)
        )
      )
      .limit(1);
    const [snapshot] = await tx
      .insert(creditHealthSnapshots)
      .values({
        ...scope,
        sourceMonth: input.sourceMonth,
        currentDebtCents: input.currentDebtCents,
        overdueCents: input.overdueCents,
        unusedLimitsCents: input.unusedLimitsCents,
        overdraftUsedCents: input.overdraftUsedCents,
        revolvingCreditCents: input.revolvingCreditCents,
        cleanMonths: input.cleanMonths,
        status: input.status,
        issues: input.issues ?? null,
      })
      .onConflictDoUpdate({
        target: [
          creditHealthSnapshots.tenantId,
          creditHealthSnapshots.userId,
          creditHealthSnapshots.sourceMonth,
        ],
        set: {
          currentDebtCents: input.currentDebtCents,
          overdueCents: input.overdueCents,
          unusedLimitsCents: input.unusedLimitsCents,
          overdraftUsedCents: input.overdraftUsedCents,
          revolvingCreditCents: input.revolvingCreditCents,
          cleanMonths: input.cleanMonths,
          status: input.status,
          issues: input.issues ?? null,
          observedAt: new Date(),
        },
      })
      .returning();
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actionType: "credit_health.upsert",
        entityType: "credit_health_snapshot",
        entityId: String(snapshot.id),
        beforeSnapshot: before ?? null,
        afterSnapshot: snapshot,
        idempotencyKey,
      })
      .returning();
    const result = {
      ...lifelongWriteResult(
        {
          entityType: "credit_health_snapshot",
          entityId: snapshot.id,
          operation: before ? "updated" : "created",
          summary: `Fotografia de credito ${snapshot.sourceMonth} registrada.`,
          warnings: ["O registro nao promete aprovacao de credito."],
        },
        { snapshot }
      ),
      action_id: String(action.id),
      external_bank_movement: false,
    };
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "credit_health.recorded",
      entityType: "credit_health_snapshot",
      entityId: String(snapshot.id),
      before: before ?? null,
      after: snapshot,
      requestId: idempotencyKey,
    });
    return { snapshot, ...actionResponse(result, false) };
  });
}

export async function updateCreditCleanupTaskV3(
  scope: FinancialScope,
  input: {
    taskId: number;
    status:
      | "needs_confirmation"
      | "open"
      | "in_progress"
      | "paid"
      | "completed"
      | "cancelled";
    currentAmountCents?: number | null;
    proof?: unknown;
  } & LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(creditCleanupTasks)
      .where(
        and(
          eq(creditCleanupTasks.id, input.taskId),
          eq(creditCleanupTasks.tenantId, scope.tenantId),
          eq(creditCleanupTasks.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Tarefa de credito nao encontrada");
    const [task] = await tx
      .update(creditCleanupTasks)
      .set({
        status: input.status,
        ...(input.currentAmountCents !== undefined
          ? { currentAmountCents: input.currentAmountCents }
          : {}),
        ...(input.proof !== undefined ? { proof: input.proof } : {}),
        updatedAt: new Date(),
      })
      .where(eq(creditCleanupTasks.id, before.id))
      .returning();
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actionType: "credit_cleanup.update",
        entityType: "credit_cleanup_task",
        entityId: String(task.id),
        beforeSnapshot: before,
        afterSnapshot: task,
        idempotencyKey,
      })
      .returning();
    const result = {
      ...lifelongWriteResult(
        {
          entityType: "credit_cleanup_task",
          entityId: task.id,
          operation: "updated",
          summary: `Tarefa de credito ${task.id} atualizada para ${task.status}.`,
          warnings: [
            "Concluir a tarefa nao equivale a aprovacao de credito; mantenha a evidencia.",
          ],
        },
        { task }
      ),
      action_id: String(action.id),
      external_bank_movement: false,
    };
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "credit_cleanup.updated",
      entityType: "credit_cleanup_task",
      entityId: String(task.id),
      before,
      after: task,
      requestId: idempotencyKey,
    });
    return { task, ...actionResponse(result, false) };
  });
}

export async function upsertAssetV3(
  scope: FinancialScope,
  input: {
    assetId?: number;
    description: string;
    assetType: string;
    ownerType: "personal" | "business";
    estimatedValueCents: number;
    debtBalanceCents: number;
    incomeGenerating: boolean;
    intendedUse?: string | null;
    status: "estimated" | "confirmed" | "owned" | "sold" | "archived";
    needsConfirmation: boolean;
    valuationSource?: string | null;
    valuedAt?: Date;
    metadata?: unknown;
  },
  context: LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(context);
  assertCents(input.estimatedValueCents, "Valor estimado");
  assertCents(input.debtBalanceCents, "Saldo devedor");
  if (!input.description.trim() || !input.assetType.trim())
    throw new Error("Descricao e tipo do ativo sao obrigatorios");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);

  return db.transaction(async tx => {
    const [before] = input.assetId
      ? await tx
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.id, input.assetId),
              eq(assets.tenantId, scope.tenantId),
              eq(assets.userId, scope.userId)
            )
          )
          .limit(1)
      : [undefined];
    if (input.assetId && !before) throw new Error("Ativo nao encontrado");
    const values = {
      description: input.description.trim(),
      assetType: input.assetType.trim(),
      ownerType: input.ownerType,
      estimatedValueCents: input.estimatedValueCents,
      debtBalanceCents: input.debtBalanceCents,
      incomeGenerating: input.incomeGenerating,
      intendedUse: input.intendedUse?.trim() || null,
      status: input.status,
      needsConfirmation: input.needsConfirmation,
      metadata: input.metadata ?? null,
      updatedAt: new Date(),
    };
    const [asset] = before
      ? await tx
          .update(assets)
          .set(values)
          .where(eq(assets.id, before.id))
          .returning()
      : await tx
          .insert(assets)
          .values({ ...scope, ...values })
          .returning();
    let valuation: typeof assetValuations.$inferSelect | null = null;
    if (input.valuationSource) {
      [valuation] = await tx
        .insert(assetValuations)
        .values({
          ...scope,
          assetId: asset.id,
          source: input.valuationSource.trim(),
          grossValueCents: input.estimatedValueCents,
          deductionsCents: input.debtBalanceCents,
          netValueCents: Math.max(
            0,
            input.estimatedValueCents - input.debtBalanceCents
          ),
          valuedAt: input.valuedAt ?? new Date(),
        })
        .returning();
    }
    const humanSummary = `${before ? "Ativo atualizado" : "Ativo cadastrado"}: ${asset.description}.`;
    const resultSnapshot = lifelongWriteResult(
      {
        entityType: "asset",
        entityId: asset.id,
        operation: before ? "updated" : "created",
        summary: humanSummary,
        warnings: ["Cadastro patrimonial; nenhum dinheiro foi movimentado."],
      },
      { asset, valuation }
    );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: before ? "asset.update" : "asset.create",
        entityType: "asset",
        entityId: String(asset.id),
        beforeSnapshot: before ?? null,
        afterSnapshot: { asset, valuation },
        resultSnapshot,
        idempotencyKey,
      })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: before ? "asset.updated" : "asset.created",
      entityType: "asset",
      entityId: String(asset.id),
      before: before ?? null,
      after: { asset, valuation },
      requestId: idempotencyKey,
    });
    const result = {
      ...resultSnapshot,
      action_id: String(action.id),
      entity_id: String(asset.id),
      external_bank_movement: false,
    };
    return actionResponse(result, false);
  });
}

export async function recordCarQuoteV3(
  scope: FinancialScope,
  input: {
    description: string;
    seller?: string | null;
    priceCents: number;
    cashDiscountCents: number;
    initialCostsCents: number;
    expiresAt?: Date | null;
    metadata?: unknown;
    tradeIn?: {
      assetId: number;
      dealer: string;
      offeredCents: number;
      deductionsCents: number;
      expiresAt?: Date | null;
    } | null;
    insurance?: {
      insurer: string;
      annualPremiumCents: number;
      deductibleCents?: number | null;
      coverage?: unknown;
      expiresAt?: Date | null;
    } | null;
    financing?: {
      lender: string;
      downPaymentCents: number;
      tradeInCents: number;
      financedCents: number;
      nominalMonthlyBasisPoints?: number | null;
      cetAnnualBasisPoints: number;
      termMonths: number;
      installmentCents: number;
      totalPaidCents: number;
      feesCents: number;
      hardCreditInquiry: boolean;
      expiresAt?: Date | null;
    } | null;
  },
  context: LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(context);
  assertCents(input.priceCents, "Preco do veiculo", false);
  assertCents(input.cashDiscountCents, "Desconto");
  assertCents(input.initialCostsCents, "Custos iniciais");
  if (input.cashDiscountCents > input.priceCents)
    throw new Error("Desconto nao pode superar o preco do veiculo");
  if (input.tradeIn) {
    assertCents(input.tradeIn.offeredCents, "Oferta da troca", false);
    assertCents(input.tradeIn.deductionsCents, "Deducoes da troca");
    if (input.tradeIn.deductionsCents > input.tradeIn.offeredCents)
      throw new Error("Deducoes da troca nao podem superar a oferta");
  }
  if (input.insurance) {
    assertCents(input.insurance.annualPremiumCents, "Premio do seguro", false);
    if (input.insurance.deductibleCents != null)
      assertCents(input.insurance.deductibleCents, "Franquia");
  }
  if (input.financing) {
    for (const [label, value] of [
      ["Entrada", input.financing.downPaymentCents],
      ["Troca", input.financing.tradeInCents],
      ["Valor financiado", input.financing.financedCents],
      ["Parcela", input.financing.installmentCents],
      ["Total pago", input.financing.totalPaidCents],
      ["Tarifas", input.financing.feesCents],
    ] as const)
      assertCents(
        value,
        label,
        label !== "Valor financiado" && label !== "Parcela" ? true : false
      );
    if (
      !Number.isInteger(input.financing.cetAnnualBasisPoints) ||
      input.financing.cetAnnualBasisPoints < 0 ||
      !Number.isInteger(input.financing.termMonths) ||
      input.financing.termMonths < 1
    )
      throw new Error("CET e prazo do financiamento sao invalidos");
    if (input.financing.totalPaidCents < input.financing.financedCents)
      throw new Error("Total pago nao pode ser menor que o valor financiado");
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);

  return db.transaction(async tx => {
    if (input.tradeIn) {
      const [ownedAsset] = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, input.tradeIn.assetId),
            eq(assets.tenantId, scope.tenantId),
            eq(assets.userId, scope.userId)
          )
        )
        .limit(1);
      if (!ownedAsset) throw new Error("Ativo de troca nao encontrado");
    }
    const tradeInNetCents = input.tradeIn
      ? input.tradeIn.offeredCents - input.tradeIn.deductionsCents
      : 0;
    const [carQuote] = await tx
      .insert(carQuotes)
      .values({
        ...scope,
        description: input.description.trim(),
        seller: input.seller?.trim() || null,
        priceCents: input.priceCents,
        cashDiscountCents: input.cashDiscountCents,
        tradeInCents: tradeInNetCents,
        initialCostsCents: input.initialCostsCents,
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    const [tradeInQuote] = input.tradeIn
      ? await tx
          .insert(tradeInQuotes)
          .values({
            ...scope,
            assetId: input.tradeIn.assetId,
            dealer: input.tradeIn.dealer.trim(),
            offeredCents: input.tradeIn.offeredCents,
            deductionsCents: input.tradeIn.deductionsCents,
            netCents: tradeInNetCents,
            expiresAt: input.tradeIn.expiresAt ?? input.expiresAt ?? null,
          })
          .returning()
      : [null];
    const [insuranceQuote] = input.insurance
      ? await tx
          .insert(insuranceQuotes)
          .values({
            ...scope,
            carQuoteId: carQuote.id,
            insurer: input.insurance.insurer.trim(),
            annualPremiumCents: input.insurance.annualPremiumCents,
            deductibleCents: input.insurance.deductibleCents ?? null,
            coverage: input.insurance.coverage ?? null,
            expiresAt: input.insurance.expiresAt ?? input.expiresAt ?? null,
          })
          .returning()
      : [null];
    const [financingQuote] = input.financing
      ? await tx
          .insert(financingQuotes)
          .values({
            ...scope,
            carQuoteId: carQuote.id,
            lender: input.financing.lender.trim(),
            vehiclePriceCents: input.priceCents - input.cashDiscountCents,
            downPaymentCents: input.financing.downPaymentCents,
            tradeInCents: input.financing.tradeInCents,
            financedCents: input.financing.financedCents,
            nominalMonthlyBasisPoints:
              input.financing.nominalMonthlyBasisPoints ?? null,
            cetAnnualBasisPoints: input.financing.cetAnnualBasisPoints,
            termMonths: input.financing.termMonths,
            installmentCents: input.financing.installmentCents,
            totalPaidCents: input.financing.totalPaidCents,
            feesCents: input.financing.feesCents,
            hardCreditInquiry: input.financing.hardCreditInquiry,
            expiresAt: input.financing.expiresAt ?? input.expiresAt ?? null,
          })
          .returning()
      : [null];
    const warnings = [
      "Cotacao registrada para comparacao; nenhuma compra ou proposta foi executada.",
      ...(input.financing?.hardCreditInquiry
        ? [
            "A cotacao foi marcada como consulta dura informada pelo usuario; o sistema nao solicitou credito.",
          ]
        : []),
    ];
    const humanSummary = `Cotacao do veiculo registrada: ${carQuote.description}.`;
    const resultSnapshot = lifelongWriteResult(
      {
        entityType: "car_quote",
        entityId: carQuote.id,
        operation: "created",
        summary: humanSummary,
        projectedDeltaCents: -(
          (financingQuote?.installmentCents ?? 0) +
          Math.ceil((insuranceQuote?.annualPremiumCents ?? 0) / 12)
        ),
        warnings,
      },
      {
        car_quote: carQuote,
        trade_in_quote: tradeInQuote,
        insurance_quote: insuranceQuote,
        financing_quote: financingQuote,
      }
    );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "car_quote.create",
        entityType: "car_quote",
        entityId: String(carQuote.id),
        beforeSnapshot: null,
        afterSnapshot: resultSnapshot,
        resultSnapshot,
        idempotencyKey,
      })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "car_quote.created",
      entityType: "car_quote",
      entityId: String(carQuote.id),
      after: resultSnapshot,
      requestId: idempotencyKey,
    });
    const result = {
      ...resultSnapshot,
      action_id: String(action.id),
      entity_id: String(carQuote.id),
      external_bank_movement: false,
    };
    return actionResponse(result, false);
  });
}

export async function setInvestmentPolicyV3(
  scope: FinancialScope,
  input: {
    riskProfile: string;
    horizonYears?: number | null;
    liquidityNeeds?: string | null;
    targetAllocationBasisPoints: Record<string, number>;
    concentrationLimits?: unknown;
    suitabilityConfirmed: boolean;
    version: string;
    status: "draft" | "active";
  },
  context: LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(context);
  const allocations = Object.entries(input.targetAllocationBasisPoints);
  if (allocations.length === 0)
    throw new Error("Informe pelo menos uma classe de ativo");
  if (
    allocations.some(
      ([name, value]) =>
        !name.trim() || !Number.isInteger(value) || value < 0 || value > 10_000
    )
  )
    throw new Error("Alocacao alvo invalida");
  const allocationTotal = allocations.reduce(
    (sum, [, value]) => sum + value,
    0
  );
  if (input.status === "active" && allocationTotal !== 10_000)
    throw new Error("Politica ativa deve totalizar 10000 pontos-base");
  if (input.status === "active" && !input.suitabilityConfirmed)
    throw new Error(
      "Suitability deve ser confirmado antes de ativar a politica"
    );
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);

  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(investmentPolicyStatements)
      .where(
        and(
          eq(investmentPolicyStatements.tenantId, scope.tenantId),
          eq(investmentPolicyStatements.userId, scope.userId),
          eq(investmentPolicyStatements.status, "active")
        )
      )
      .orderBy(desc(investmentPolicyStatements.createdAt))
      .limit(1);
    if (input.status === "active") {
      await tx
        .update(investmentPolicyStatements)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(investmentPolicyStatements.tenantId, scope.tenantId),
            eq(investmentPolicyStatements.userId, scope.userId),
            eq(investmentPolicyStatements.status, "active")
          )
        );
    }
    const [policy] = await tx
      .insert(investmentPolicyStatements)
      .values({
        ...scope,
        riskProfile: input.riskProfile.trim(),
        horizonYears: input.horizonYears ?? null,
        liquidityNeeds: input.liquidityNeeds?.trim() || null,
        targetAllocation: input.targetAllocationBasisPoints,
        concentrationLimits: input.concentrationLimits ?? null,
        suitabilityConfirmedAt: input.suitabilityConfirmed ? new Date() : null,
        version: input.version.trim(),
        status: input.status,
      })
      .returning();
    const humanSummary = `Politica de investimentos ${input.status === "active" ? "ativada" : "salva como rascunho"}.`;
    const resultSnapshot = lifelongWriteResult(
      {
        entityType: "investment_policy",
        entityId: policy.id,
        operation: "created",
        summary: humanSummary,
        warnings: [
          "Politica interna, sem ordem de investimento.",
          "Projecoes sao cenarios e retorno passado nao garante retorno futuro.",
        ],
      },
      { policy }
    );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "investment_policy.create",
        entityType: "investment_policy",
        entityId: String(policy.id),
        beforeSnapshot: before ?? null,
        afterSnapshot: policy,
        resultSnapshot,
        idempotencyKey,
      })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "investment_policy.created",
      entityType: "investment_policy",
      entityId: String(policy.id),
      before: before ?? null,
      after: policy,
      requestId: idempotencyKey,
    });
    const result = {
      ...resultSnapshot,
      action_id: String(action.id),
      entity_id: String(policy.id),
      external_bank_movement: false,
    };
    return actionResponse(result, false);
  });
}

export async function upsertInvestmentPositionV3(
  scope: FinancialScope,
  input: {
    institution: string;
    bucket: "emergency" | "long_term" | "other";
    currency: string;
    assetCode: string;
    assetClass: string;
    quantityMicrounits: number;
    costBasisCents: number;
    marketValueCents: number;
    valuedAt: Date;
  },
  context: LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(context);
  assertCents(input.quantityMicrounits, "Quantidade em microunidades");
  assertCents(input.costBasisCents, "Custo de aquisicao");
  assertCents(input.marketValueCents, "Valor de mercado");
  if (
    !input.institution.trim() ||
    !input.assetCode.trim() ||
    !input.assetClass.trim()
  )
    throw new Error("Instituicao, codigo e classe do ativo sao obrigatorios");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);

  return db.transaction(async tx => {
    let [account] = await tx
      .select()
      .from(investmentAccounts)
      .where(
        and(
          eq(investmentAccounts.tenantId, scope.tenantId),
          eq(investmentAccounts.userId, scope.userId),
          eq(investmentAccounts.institution, input.institution.trim()),
          eq(investmentAccounts.bucket, input.bucket),
          eq(investmentAccounts.active, true)
        )
      )
      .limit(1);
    if (!account) {
      [account] = await tx
        .insert(investmentAccounts)
        .values({
          ...scope,
          institution: input.institution.trim(),
          bucket: input.bucket,
          currency: input.currency.toUpperCase(),
        })
        .returning();
    }
    const [before] = await tx
      .select()
      .from(investmentPositions)
      .where(
        and(
          eq(investmentPositions.investmentAccountId, account.id),
          eq(
            investmentPositions.assetCode,
            input.assetCode.trim().toUpperCase()
          ),
          eq(investmentPositions.tenantId, scope.tenantId),
          eq(investmentPositions.userId, scope.userId)
        )
      )
      .limit(1);
    const [position] = await tx
      .insert(investmentPositions)
      .values({
        ...scope,
        investmentAccountId: account.id,
        assetCode: input.assetCode.trim().toUpperCase(),
        assetClass: input.assetClass.trim(),
        quantityMicrounits: input.quantityMicrounits,
        costBasisCents: input.costBasisCents,
        marketValueCents: input.marketValueCents,
        valuedAt: input.valuedAt,
      })
      .onConflictDoUpdate({
        target: [
          investmentPositions.investmentAccountId,
          investmentPositions.assetCode,
        ],
        set: {
          assetClass: input.assetClass.trim(),
          quantityMicrounits: input.quantityMicrounits,
          costBasisCents: input.costBasisCents,
          marketValueCents: input.marketValueCents,
          valuedAt: input.valuedAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    const allPositions = await tx
      .select()
      .from(investmentPositions)
      .where(
        and(
          eq(investmentPositions.tenantId, scope.tenantId),
          eq(investmentPositions.userId, scope.userId)
        )
      );
    const allocation = allPositions.reduce<Record<string, number>>(
      (totals, row) => {
        totals[row.assetClass] =
          (totals[row.assetClass] ?? 0) + row.marketValueCents;
        return totals;
      },
      {}
    );
    const totalValueCents = allPositions.reduce(
      (sum, row) => sum + row.marketValueCents,
      0
    );
    const [portfolioSnapshot] = await tx
      .insert(portfolioSnapshots)
      .values({
        ...scope,
        totalValueCents,
        investableNetWorthCents: totalValueCents,
        allocation,
        capturedAt: new Date(),
      })
      .returning();
    const humanSummary = `${before ? "Posicao atualizada" : "Posicao cadastrada"}: ${position.assetCode}.`;
    const resultSnapshot = lifelongWriteResult(
      {
        entityType: "investment_position",
        entityId: position.id,
        operation: before ? "updated" : "created",
        summary: humanSummary,
        warnings: [
          "Registro de carteira; nenhuma ordem de compra ou venda foi enviada.",
        ],
      },
      {
        investment_account: account,
        position,
        portfolio_snapshot: portfolioSnapshot,
      }
    );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: before
          ? "investment_position.update"
          : "investment_position.create",
        entityType: "investment_position",
        entityId: String(position.id),
        beforeSnapshot: before ?? null,
        afterSnapshot: position,
        resultSnapshot,
        idempotencyKey,
      })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: before
        ? "investment_position.updated"
        : "investment_position.created",
      entityType: "investment_position",
      entityId: String(position.id),
      before: before ?? null,
      after: position,
      requestId: idempotencyKey,
    });
    const result = {
      ...resultSnapshot,
      action_id: String(action.id),
      entity_id: String(position.id),
      external_bank_movement: false,
    };
    return actionResponse(result, false);
  });
}

export async function recordDividendV3(
  scope: FinancialScope,
  input: {
    investmentPositionId?: number | null;
    assetCode: string;
    exDate?: string | null;
    paymentDate: string;
    grossCents: number;
    withholdingCents: number;
    netCents: number;
    reinvestedCents: number;
    status: "expected" | "received" | "reinvested";
  },
  context: LifelongWriteContext
) {
  assertScope(scope);
  const idempotencyKey = assertWriteContext(context);
  assertCents(input.grossCents, "Dividendo bruto", false);
  assertCents(input.withholdingCents, "Retencao");
  assertCents(input.netCents, "Dividendo liquido");
  assertCents(input.reinvestedCents, "Valor reinvestido");
  if (input.netCents !== input.grossCents - input.withholdingCents)
    throw new Error("Valor liquido deve ser igual ao bruto menos retencoes");
  if (input.reinvestedCents > input.netCents)
    throw new Error("Reinvestimento nao pode superar o valor liquido");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const plan = await getLifelongPlanData(scope);
  const [existingAction] = await db
    .select()
    .from(financialActions)
    .where(
      and(
        eq(financialActions.tenantId, scope.tenantId),
        eq(financialActions.userId, scope.userId),
        eq(financialActions.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingAction) return actionReplay(existingAction);

  return db.transaction(async tx => {
    const [position] = input.investmentPositionId
      ? await tx
          .select()
          .from(investmentPositions)
          .where(
            and(
              eq(investmentPositions.id, input.investmentPositionId),
              eq(investmentPositions.tenantId, scope.tenantId),
              eq(investmentPositions.userId, scope.userId)
            )
          )
          .limit(1)
      : [undefined];
    if (input.investmentPositionId && !position)
      throw new Error("Posicao de investimento nao encontrada");
    const [dividend] = await tx
      .insert(dividendEvents)
      .values({
        ...scope,
        investmentPositionId: position?.id ?? null,
        assetCode: input.assetCode.trim().toUpperCase(),
        exDate: input.exDate ?? null,
        paymentDate: input.paymentDate,
        grossCents: input.grossCents,
        withholdingCents: input.withholdingCents,
        netCents: input.netCents,
        reinvestedCents: input.reinvestedCents,
        status: input.status,
      })
      .returning();
    let cashflow: typeof investmentCashflows.$inferSelect | null = null;
    if (position && input.status !== "expected") {
      [cashflow] = await tx
        .insert(investmentCashflows)
        .values({
          ...scope,
          investmentAccountId: position.investmentAccountId,
          type: "dividend",
          amountCents: input.netCents,
          occurredAt: new Date(`${input.paymentDate}T12:00:00.000Z`),
          metadata: {
            dividendEventId: dividend.id,
            reinvestedCents: input.reinvestedCents,
          },
        })
        .returning();
    }
    const accumulation =
      plan?.currentPhase !== "FINANCIAL_INDEPENDENCE" &&
      input.status !== "expected";
    const warnings = [
      "Registro informativo; nenhuma ordem de reinvestimento foi executada.",
      ...(accumulation && input.reinvestedCents < input.netCents
        ? [
            `Na fase de acumulacao, ainda faltam ${input.netCents - input.reinvestedCents} centavos para registrar como reinvestidos.`,
          ]
        : []),
    ];
    const humanSummary = `Dividendo de ${dividend.assetCode} registrado.`;
    const resultSnapshot = lifelongWriteResult(
      {
        entityType: "dividend_event",
        entityId: dividend.id,
        operation: "created",
        summary: humanSummary,
        projectedDeltaCents: input.status === "expected" ? input.netCents : 0,
        warnings,
      },
      { dividend, investment_cashflow: cashflow }
    );
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "dividend.create",
        entityType: "dividend_event",
        entityId: String(dividend.id),
        beforeSnapshot: null,
        afterSnapshot: { dividend, cashflow },
        resultSnapshot,
        idempotencyKey,
      })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "dividend.recorded",
      entityType: "dividend_event",
      entityId: String(dividend.id),
      after: { dividend, cashflow },
      requestId: idempotencyKey,
    });
    const result = {
      ...resultSnapshot,
      action_id: String(action.id),
      entity_id: String(dividend.id),
      external_bank_movement: false,
    };
    return actionResponse(result, false);
  });
}

export async function syncRiskProtocolV3(scope: FinancialScope) {
  assertScope(scope);
  const plan = await getLifelongPlanData(scope);
  if (!plan) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await tx
      .select({ id: financialProfiles.id })
      .from(financialProfiles)
      .where(
        and(
          eq(financialProfiles.tenantId, scope.tenantId),
          eq(financialProfiles.userId, scope.userId)
        )
      )
      .limit(1)
      .for("update");
    const [active] = await tx
      .select()
      .from(riskProtocolEvents)
      .where(
        and(
          eq(riskProtocolEvents.tenantId, scope.tenantId),
          eq(riskProtocolEvents.userId, scope.userId),
          eq(riskProtocolEvents.status, "active")
        )
      )
      .orderBy(desc(riskProtocolEvents.createdAt))
      .limit(1)
      .for("update");
    if (active?.level === plan.riskLevel)
      return { event: active, changed: false };
    const now = new Date();
    await tx
      .update(riskProtocolEvents)
      .set({ status: "resolved", resolvedAt: now })
      .where(
        and(
          eq(riskProtocolEvents.tenantId, scope.tenantId),
          eq(riskProtocolEvents.userId, scope.userId),
          eq(riskProtocolEvents.status, "active")
        )
      );
    const trigger =
      plan.riskLevel === "red"
        ? "overdue_or_reserve_critical"
        : plan.riskLevel === "yellow"
          ? "financial_attention_required"
          : "financial_health_stable";
    const actions =
      plan.riskLevel === "red"
        ? [
            "freeze_optional_goals",
            "prioritize_overdue_and_essentials",
            "block_car_purchase",
          ]
        : plan.riskLevel === "yellow"
          ? ["reduce_variable_spending", "rebuild_operating_buffer"]
          : ["maintain_plan", "continue_phase_allocations"];
    const [event] = await tx
      .insert(riskProtocolEvents)
      .values({
        ...scope,
        level: plan.riskLevel,
        trigger,
        snapshot: {
          overdueCents: plan.operations.overdueCents,
          operatingBufferGapCents: plan.operatingBuffer.gapCents,
          emergencyFundCents: plan.emergencyFund.currentCents,
          phase: plan.currentPhase,
        },
        actions,
      })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: "system",
      actorId: "financial-automation",
      action: "risk_protocol.changed",
      entityType: "risk_protocol_event",
      entityId: String(event.id),
      before: active ?? null,
      after: event,
    });
    return { event, changed: true };
  });
}
