import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  budgetEnvelopes,
  budgetPeriods,
  financialAccounts,
  financialAuditEvents,
  financialCategories,
  financialDebts,
  financialGoalItems,
  financialGoals,
  financialProfiles,
  financialProjects,
  financialTasks,
  financialTransactionRules,
  financialTransactions,
  projectInstallments,
  recurringCashflows,
} from "../drizzle/schema";
import {
  calculateCarReadiness,
  calculatePurchaseDecision,
  calculateReserveMonths,
  getNthBusinessDay,
  savingsRatePercent,
  type CarSimulationInput,
  type PurchaseDecisionInput,
} from "../shared/financial-core";
import { getDb } from "./db";
import * as coreDb from "./db/financial-core";
import {
  RAPHAEL_ACCOUNTS,
  RAPHAEL_CATEGORIES,
  RAPHAEL_GOALS,
  RAPHAEL_GOAL_ITEMS,
  RAPHAEL_INITIAL_TASKS,
  RAPHAEL_MERCHANT_RULES,
  RAPHAEL_PROFILE,
  RAPHAEL_PROFILE_KEY,
  RAPHAEL_RECURRING_CASHFLOWS,
} from "./finance/raphael-template";

const CONFIRMED_STATUSES = new Set(["confirmed", "paid", "received"]);
const ACTIVE_DEBT_STATUSES = new Set(["outstanding", "overdue", "active"]);

function monthBounds(referenceDate: Date, timezone = "America/Sao_Paulo") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month] = formatter.format(referenceDate).split("-").map(Number);
  const periodStart = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { year, month, periodStart, periodEnd };
}

function nextMonth(year: number, month: number) {
  const date = new Date(Date.UTC(year, month, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function nextDayThirty(referenceDate: Date, timezone: string) {
  const { year, month } = monthBounds(referenceDate, timezone);
  const today = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      day: "2-digit",
    }).format(referenceDate)
  );
  const target = today <= 30 ? { year, month } : nextMonth(year, month);
  const lastDay = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
  return `${target.year}-${String(target.month).padStart(2, "0")}-${String(Math.min(30, lastDay)).padStart(2, "0")}`;
}

function nextFifthBusinessDay(referenceDate: Date, timezone: string) {
  const { year, month } = monthBounds(referenceDate, timezone);
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate);
  const current = getNthBusinessDay(year, month, 5);
  if (todayIso <= current) return current;
  const target = nextMonth(year, month);
  return getNthBusinessDay(target.year, target.month, 5);
}

function nextOccurrenceForSeed(
  seedKey: string,
  referenceDate: Date,
  timezone: string
) {
  if (seedKey === "income-main-day-30")
    return nextDayThirty(referenceDate, timezone);
  if (seedKey === "income-complement-fifth-business-day")
    return nextFifthBusinessDay(referenceDate, timezone);
  if (seedKey === "one-off-2500-receivable")
    return monthBounds(referenceDate, timezone).periodEnd;
  return null;
}

function priorityRank(value: string) {
  const ranks: Record<string, number> = {
    critical: 0,
    essential: 1,
    high: 1,
    important: 2,
    medium: 2,
    optional: 3,
    low: 3,
  };
  return ranks[value] ?? 9;
}

export async function bootstrapRaphaelFinancialProfile(
  userId: number,
  expectedTenantId?: number,
  referenceDate = new Date()
) {
  const scope = await coreDb.resolveFinancialScope(userId, expectedTenantId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existingProfile = await coreDb.getFinancialProfile(scope);
  const firstBootstrap = existingProfile?.profileKey !== RAPHAEL_PROFILE_KEY;

  if (!existingProfile) {
    await coreDb.upsertFinancialProfile(scope, {
      ...RAPHAEL_PROFILE,
      profileKey: RAPHAEL_PROFILE_KEY,
      onboardingState: {
        version: 1,
        completed: false,
        answers: {},
        nextQuestion: "asaas_due_date",
      },
    });
  } else if (firstBootstrap) {
    await db
      .update(financialProfiles)
      .set({
        ...RAPHAEL_PROFILE,
        profileKey: RAPHAEL_PROFILE_KEY,
        onboardingState: {
          version: 1,
          completed: false,
          answers: {},
          nextQuestion: "asaas_due_date",
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialProfiles.tenantId, scope.tenantId),
          eq(financialProfiles.userId, scope.userId)
        )
      );
  }

  const accountEntries = await Promise.all(
    RAPHAEL_ACCOUNTS.map(account =>
      coreDb.upsertSeedAccount(scope, {
        ...account,
        currency: "BRL",
        currentBalanceCents: 0,
        balanceAsOf: null,
        active: true,
      })
    )
  );
  const accountBySeed = new Map(
    accountEntries.map(account => [account.seedKey, account])
  );

  const categoryEntries = await Promise.all(
    RAPHAEL_CATEGORIES.map(category =>
      coreDb.upsertFinancialCategory(scope, category)
    )
  );
  const categoryByKey = new Map(
    categoryEntries.map(category => [category.key, category])
  );

  await db.transaction(async tx => {
    for (const cashflow of RAPHAEL_RECURRING_CASHFLOWS) {
      const account = accountBySeed.get(cashflow.accountSeedKey);
      const category = categoryByKey.get(cashflow.categoryKey);
      if (!account || !category)
        throw new Error(`Seed financeiro incompleto: ${cashflow.seedKey}`);
      await tx
        .insert(recurringCashflows)
        .values({
          ...scope,
          seedKey: cashflow.seedKey,
          type: cashflow.type,
          ownerType: cashflow.ownerType,
          name: cashflow.name,
          amountCents: cashflow.amountCents,
          recurrenceRule: cashflow.recurrenceRule,
          nextDueDate: nextOccurrenceForSeed(
            cashflow.seedKey,
            referenceDate,
            RAPHAEL_PROFILE.timezone
          ),
          accountId: account.id,
          categoryId: category.id,
          status: cashflow.status,
          estimated: cashflow.estimated,
          needsConfirmation: cashflow.needsConfirmation,
          active: true,
        })
        .onConflictDoUpdate({
          target: [
            recurringCashflows.tenantId,
            recurringCashflows.userId,
            recurringCashflows.seedKey,
          ],
          set: {
            name: cashflow.name,
            amountCents: cashflow.amountCents,
            recurrenceRule: cashflow.recurrenceRule,
            accountId: account.id,
            categoryId: category.id,
            updatedAt: new Date(),
          },
        });
    }

    const goalBySeed = new Map<string, { id: number }>();
    for (const goal of RAPHAEL_GOALS) {
      const [upserted] = await tx
        .insert(financialGoals)
        .values({
          ...scope,
          ...goal,
          fundedCents: 0,
          status: goal.targetCents === 0 ? "blocked" : "planned",
        })
        .onConflictDoUpdate({
          target: [
            financialGoals.tenantId,
            financialGoals.userId,
            financialGoals.seedKey,
          ],
          set: {
            name: goal.name,
            goalType: goal.goalType,
            targetCents: goal.targetCents,
            priority: goal.priority,
            protected: goal.protected,
            notes: "notes" in goal ? goal.notes : null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: financialGoals.id, seedKey: financialGoals.seedKey });
      if (upserted.seedKey) goalBySeed.set(upserted.seedKey, upserted);
    }

    const purchaseGoal = goalBySeed.get("goal-family-purchases");
    if (!purchaseGoal) throw new Error("Meta de compras nao foi criada");
    for (const goalItem of RAPHAEL_GOAL_ITEMS) {
      await tx
        .insert(financialGoalItems)
        .values({
          ...scope,
          goalId: purchaseGoal.id,
          ...goalItem,
          actualCostCents: null,
          status: "planned",
          estimated: true,
          needsConfirmation: goalItem.needsConfirmation ?? false,
          notes: goalItem.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [
            financialGoalItems.tenantId,
            financialGoalItems.userId,
            financialGoalItems.seedKey,
          ],
          set: {
            personOrGroup: goalItem.personOrGroup,
            name: goalItem.name,
            estimatedCostCents: goalItem.estimatedCostCents,
            priority: goalItem.priority,
            needsConfirmation: goalItem.needsConfirmation ?? false,
            notes: goalItem.notes ?? null,
            updatedAt: new Date(),
          },
        });
    }

    await tx
      .insert(financialDebts)
      .values({
        ...scope,
        creditor: "Asaas",
        balanceCents: 70_000,
        dueDate: null,
        minimumPaymentCents: 70_000,
        priority: "critical",
        status: "outstanding",
        needsConfirmation: true,
        seedKey: "debt-asaas-card",
        notes: "Confirmar vencimento e registrar quitação manualmente.",
      })
      .onConflictDoUpdate({
        target: [
          financialDebts.tenantId,
          financialDebts.userId,
          financialDebts.seedKey,
        ],
        set: {
          creditor: "Asaas",
          priority: "critical",
          notes: "Confirmar vencimento e registrar quitação manualmente.",
          updatedAt: new Date(),
        },
      });

    for (const [seedKey, title, priority] of RAPHAEL_INITIAL_TASKS) {
      await tx
        .insert(financialTasks)
        .values({ ...scope, seedKey, title, priority, status: "open" })
        .onConflictDoUpdate({
          target: [
            financialTasks.tenantId,
            financialTasks.userId,
            financialTasks.seedKey,
          ],
          set: { title, priority, updatedAt: new Date() },
        });
    }

    for (const [pattern, categoryKey, ownerType] of RAPHAEL_MERCHANT_RULES) {
      const category = categoryByKey.get(categoryKey);
      if (!category) continue;
      await tx
        .insert(financialTransactionRules)
        .values({
          ...scope,
          pattern,
          matchType: "contains",
          categoryId: category.id,
          ownerType,
          priority: 100,
          createdBy: "system",
          active: true,
        })
        .onConflictDoUpdate({
          target: [
            financialTransactionRules.tenantId,
            financialTransactionRules.userId,
            financialTransactionRules.pattern,
            financialTransactionRules.ownerType,
          ],
          set: { categoryId: category.id, active: true, updatedAt: new Date() },
        });
    }

    const period = monthBounds(referenceDate, RAPHAEL_PROFILE.timezone);
    const [budgetPeriod] = await tx
      .insert(budgetPeriods)
      .values({
        ...scope,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [
          budgetPeriods.tenantId,
          budgetPeriods.userId,
          budgetPeriods.periodStart,
          budgetPeriods.periodEnd,
        ],
        set: { status: "active", updatedAt: new Date() },
      })
      .returning();
    for (const envelope of [
      {
        name: "Contas fixas e essenciais",
        plannedCents: 818_000,
        priority: "essential",
      },
      {
        name: "Despesas variáveis",
        plannedCents: 300_000,
        priority: "important",
      },
    ]) {
      await tx
        .insert(budgetEnvelopes)
        .values({
          ...scope,
          budgetPeriodId: budgetPeriod.id,
          categoryId: null,
          ...envelope,
          spentCents: 0,
          reservedCents: 0,
        })
        .onConflictDoUpdate({
          target: [budgetEnvelopes.budgetPeriodId, budgetEnvelopes.name],
          set: {
            plannedCents: envelope.plannedCents,
            priority: envelope.priority,
            updatedAt: new Date(),
          },
        });
    }

    if (firstBootstrap) {
      await tx.insert(financialAuditEvents).values({
        ...scope,
        actorType: "system",
        actorId: "raphael-profile-seed",
        action: "profile.bootstrapped",
        entityType: "financial_profile",
        entityId: RAPHAEL_PROFILE_KEY,
        after: {
          accounts: RAPHAEL_ACCOUNTS.length,
          categories: RAPHAEL_CATEGORIES.length,
          recurringCashflows: RAPHAEL_RECURRING_CASHFLOWS.length,
          goals: RAPHAEL_GOALS.length,
          goalItems: RAPHAEL_GOAL_ITEMS.length,
          tasks: RAPHAEL_INITIAL_TASKS.length,
        },
        requestId: `seed:${RAPHAEL_PROFILE_KEY}:${scope.userId}`,
      });
    }
  });

  return {
    ok: true,
    scope,
    firstBootstrap,
    counts: {
      accounts: RAPHAEL_ACCOUNTS.length,
      categories: RAPHAEL_CATEGORIES.length,
      recurringCashflows: RAPHAEL_RECURRING_CASHFLOWS.length,
      goals: RAPHAEL_GOALS.length,
      goalItems: RAPHAEL_GOAL_ITEMS.length,
      tasks: RAPHAEL_INITIAL_TASKS.length,
      merchantRules: RAPHAEL_MERCHANT_RULES.length,
    },
  };
}

function confirmedTransactionEffect(transaction: {
  type: string;
  transferDirection: string | null;
  status: string;
  amountCents: number;
  reversedAt: Date | null;
  reversalOfId: number | null;
}) {
  if (
    transaction.reversedAt ||
    transaction.reversalOfId ||
    !CONFIRMED_STATUSES.has(transaction.status)
  )
    return 0;
  if (transaction.type === "income") return transaction.amountCents;
  if (transaction.type === "expense") return -transaction.amountCents;
  if (transaction.type === "transfer")
    return transaction.transferDirection === "in"
      ? transaction.amountCents
      : -transaction.amountCents;
  return 0;
}

export async function getCanonicalFinancialSnapshot(
  userId: number,
  options: { expectedTenantId?: number; asOf?: Date } = {}
) {
  const scope = await coreDb.resolveFinancialScope(
    userId,
    options.expectedTenantId
  );
  const asOf = options.asOf ?? new Date();
  const profile = await coreDb.getFinancialProfile(scope);
  if (!profile) {
    return {
      configured: false as const,
      scope,
      generatedAt: asOf.toISOString(),
    };
  }
  const month = monthBounds(asOf, profile.timezone);
  const monthStart = new Date(`${month.periodStart}T00:00:00.000Z`);
  const monthEnd = new Date(`${month.periodEnd}T23:59:59.999Z`);
  const [
    accounts,
    categories,
    transactions,
    recurring,
    goals,
    goalItems,
    debts,
    projects,
    installments,
    budgetPeriodsList,
    tasks,
  ] = await Promise.all([
    coreDb.listFinancialAccounts(scope),
    coreDb.listFinancialCategories(scope),
    coreDb.listFinancialTransactions(scope, {
      start: monthStart,
      end: monthEnd,
      limit: 10_000,
    }),
    coreDb.listRecurringCashflows(scope),
    coreDb.listFinancialGoals(scope),
    coreDb.listFinancialGoalItems(scope),
    coreDb.listFinancialDebts(scope),
    coreDb.listFinancialProjects(scope),
    coreDb.listProjectInstallments(scope),
    coreDb.listBudgetPeriods(scope),
    coreDb.listFinancialTasks(scope),
  ]);
  const currentBudgetPeriod = budgetPeriodsList.find(
    period =>
      period.periodStart === month.periodStart &&
      period.periodEnd === month.periodEnd
  );
  const envelopes = currentBudgetPeriod
    ? await coreDb.listBudgetEnvelopes(scope, currentBudgetPeriod.id)
    : [];

  const personalBalanceCents = accounts
    .filter(account => account.ownerType === "personal")
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const businessBalanceCents = accounts
    .filter(account => account.ownerType === "business")
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const operatingBalanceCents = accounts
    .filter(account => account.includeInOperatingCash && !account.protected)
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const reserveBalanceCents = accounts
    .filter(
      account =>
        account.accountType === "reserve" ||
        account.seedKey === "account-reserve"
    )
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const confirmedIncomeCents = transactions
    .filter(transaction => transaction.type === "income")
    .reduce(
      (sum, transaction) =>
        sum + Math.max(0, confirmedTransactionEffect(transaction)),
      0
    );
  const confirmedExpenseCents = transactions
    .filter(transaction => transaction.type === "expense")
    .reduce(
      (sum, transaction) =>
        sum + Math.max(0, -confirmedTransactionEffect(transaction)),
      0
    );
  const expectedIncomeCents = recurring
    .filter(item => item.type === "income" && item.status !== "received")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const monthlyFixedCostCents = recurring
    .filter(item => item.type === "expense" && item.active)
    .reduce((sum, item) => sum + item.amountCents, 0);
  const totalLivingCostCents =
    monthlyFixedCostCents + profile.monthlyVariableBudgetCents;
  const activeDebtBalanceCents = debts
    .filter(debt => ACTIVE_DEBT_STATUSES.has(debt.status))
    .reduce((sum, debt) => sum + debt.balanceCents, 0);
  const urgentDebtCents = debts
    .filter(
      debt =>
        ACTIVE_DEBT_STATUSES.has(debt.status) &&
        ["critical", "high"].includes(debt.priority)
    )
    .reduce((sum, debt) => sum + debt.balanceCents, 0);
  const essentialGoalsPendingCents = goalItems
    .filter(
      item =>
        item.priority === "essential" &&
        !["purchased", "cancelled"].includes(item.status)
    )
    .reduce(
      (sum, item) => sum + (item.actualCostCents ?? item.estimatedCostCents),
      0
    );
  const optionalGoalsPendingCents = goalItems
    .filter(
      item =>
        item.priority === "optional" &&
        !["purchased", "cancelled"].includes(item.status)
    )
    .reduce(
      (sum, item) => sum + (item.actualCostCents ?? item.estimatedCostCents),
      0
    );
  const projectReceivedCents = installments
    .filter(item => item.status === "received")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const projectExpectedCents = installments
    .filter(item => item.status === "expected")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const lastBalanceAsOf = accounts
    .map(account => account.balanceAsOf)
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const emergencyGoal = goals.find(
    goal => goal.seedKey === "goal-emergency-min-current"
  );
  const postCarGoal = goals.find(
    goal => goal.seedKey === "goal-emergency-min-post-car"
  );
  const reserveMonths = calculateReserveMonths(
    reserveBalanceCents,
    profile.emergencyFundReferenceCents
  );
  const reserveContributionsCents = transactions
    .filter(transaction => {
      const account = accounts.find(item => item.id === transaction.accountId);
      return (
        account?.accountType === "reserve" && transaction.type === "income"
      );
    })
    .reduce(
      (sum, transaction) =>
        sum + Math.max(0, confirmedTransactionEffect(transaction)),
      0
    );
  const goalContributionsCents = goals.reduce(
    (sum, goal) => sum + goal.fundedCents,
    0
  );
  const savingsRate = savingsRatePercent(
    confirmedIncomeCents,
    reserveContributionsCents,
    goalContributionsCents,
    0
  );
  const monthlyBaseNet = expectedIncomeCents - totalLivingCostCents;
  const scenarios = {
    conservative: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      endingBalanceCents:
        operatingBalanceCents - totalLivingCostCents * (index + 1),
    })),
    base: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      endingBalanceCents: operatingBalanceCents + monthlyBaseNet * (index + 1),
    })),
    growth: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      endingBalanceCents:
        operatingBalanceCents + (monthlyBaseNet + 750_000) * (index + 1),
    })),
    aggressive: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      endingBalanceCents:
        operatingBalanceCents + (monthlyBaseNet + 900_000) * (index + 1),
    })),
  };

  return {
    configured: true as const,
    scope,
    generatedAt: asOf.toISOString(),
    profile,
    balances: {
      personalCents: personalBalanceCents,
      businessCents: businessBalanceCents,
      operatingCents: operatingBalanceCents,
      reserveCents: reserveBalanceCents,
      consolidatedCents: personalBalanceCents + businessBalanceCents,
    },
    cashflow: {
      confirmedIncomeCents,
      confirmedExpenseCents,
      expectedIncomeCents,
      monthlyFixedCostCents,
      monthlyVariableBudgetCents: profile.monthlyVariableBudgetCents,
      totalLivingCostCents,
      monthlyBaseSurplusCents: monthlyBaseNet,
    },
    emergencyFund: {
      balanceCents: reserveBalanceCents,
      minimumTargetCents: emergencyGoal?.targetCents ?? 0,
      postCarTargetCents: postCarGoal?.targetCents ?? 0,
      monthsCovered: reserveMonths,
      protected: true,
    },
    debts: {
      totalOutstandingCents: activeDebtBalanceCents,
      urgentCents: urgentDebtCents,
      items: debts,
    },
    goals: {
      items: goals,
      purchaseItems: goalItems,
      essentialPendingCents: essentialGoalsPendingCents,
      optionalPendingCents: optionalGoalsPendingCents,
    },
    budgets: {
      period: currentBudgetPeriod ?? null,
      envelopes,
    },
    projects: {
      items: projects,
      installments,
      receivedCents: projectReceivedCents,
      expectedCents: projectExpectedCents,
      monthlyGrossTargetCents: 1_000_000,
    },
    recurringCashflows: recurring,
    tasks,
    accounts,
    categories,
    recentTransactions: transactions.slice(0, 50),
    dataFreshness: {
      lastBalanceConfirmedAt: lastBalanceAsOf?.toISOString() ?? null,
      hasConfirmedBalance: Boolean(lastBalanceAsOf),
    },
    metrics: {
      savingsRatePercent: savingsRate,
      budgetUsedPercent:
        profile.monthlyVariableBudgetCents > 0
          ? Math.round(
              (confirmedExpenseCents / profile.monthlyVariableBudgetCents) *
                10_000
            ) / 100
          : 0,
      reserveMonths,
    },
    scenarios,
  };
}

export async function simulateCanonicalPurchase(
  userId: number,
  input: {
    amountCents: number;
    desiredDate: string;
    nextIncomeDate?: string | null;
    expectedTenantId?: number;
  }
) {
  const snapshot = await getCanonicalFinancialSnapshot(userId, {
    expectedTenantId: input.expectedTenantId,
  });
  if (!snapshot.configured)
    return calculatePurchaseDecision({
      amountCents: input.amountCents,
      operatingBalanceCents: null,
      billsDueBeforeNextIncomeCents: 0,
      essentialEnvelopesRemainingCents: 0,
      urgentDebtCents: 0,
      operatingBufferCents: 0,
      confirmedCommitmentsCents: 0,
      desiredDate: input.desiredDate,
      missingData: ["perfil financeiro"],
    });
  const essentialEnvelopeRemaining = snapshot.budgets.envelopes
    .filter(envelope => ["critical", "essential"].includes(envelope.priority))
    .reduce(
      (sum, envelope) =>
        sum +
        Math.max(
          0,
          envelope.plannedCents - envelope.spentCents - envelope.reservedCents
        ),
      0
    );
  const missingData = snapshot.dataFreshness.hasConfirmedBalance
    ? []
    : ["data do ultimo saldo confirmado"];
  const purchaseInput: PurchaseDecisionInput = {
    amountCents: input.amountCents,
    operatingBalanceCents: snapshot.balances.operatingCents,
    billsDueBeforeNextIncomeCents: 0,
    essentialEnvelopesRemainingCents: essentialEnvelopeRemaining,
    urgentDebtCents: snapshot.debts.urgentCents,
    operatingBufferCents: snapshot.profile.operatingBufferCents,
    confirmedCommitmentsCents: 0,
    adjustableDiscretionaryCents: snapshot.goals.optionalPendingCents,
    desiredDate: input.desiredDate,
    nextIncomeDate: input.nextIncomeDate,
    missingData,
  };
  return calculatePurchaseDecision(purchaseInput);
}

export async function simulateCanonicalCar(
  userId: number,
  input: Omit<
    CarSimulationInput,
    | "asaasDebtCents"
    | "overdraftUsedCents"
    | "reserveCents"
    | "postCarReserveTargetCents"
    | "monthlyCarLimitCents"
    | "installmentLimitCents"
    | "confirmedMonthlyIncomeCents"
    | "livingCostAfterCarCents"
    | "currentOperatingBalanceCents"
    | "fixedCostsConfirmed"
    | "priorityAPlanComplete"
  > & {
    expectedTenantId?: number;
    overdraftUsedCents?: number;
    fixedCostsConfirmed?: boolean;
    priorityAPlanComplete?: boolean;
  }
) {
  const snapshot = await getCanonicalFinancialSnapshot(userId, {
    expectedTenantId: input.expectedTenantId,
  });
  if (!snapshot.configured)
    throw new Error("Perfil financeiro nao configurado");
  const asaasDebtCents = snapshot.debts.items
    .filter(debt => debt.creditor.toLowerCase().includes("asaas"))
    .filter(debt => ACTIVE_DEBT_STATUSES.has(debt.status))
    .reduce((sum, debt) => sum + debt.balanceCents, 0);
  const fixedCostsConfirmed =
    input.fixedCostsConfirmed ??
    (await coreDb.listRecurringCashflows(snapshot.scope))
      .filter(item => item.type === "expense")
      .every(item => !item.needsConfirmation);
  const priorityAPlanComplete =
    input.priorityAPlanComplete ??
    snapshot.goals.purchaseItems
      .filter(item => item.priority === "essential")
      .every(item => ["funded", "purchased"].includes(item.status));
  return calculateCarReadiness({
    ...input,
    asaasDebtCents,
    overdraftUsedCents: input.overdraftUsedCents ?? 0,
    reserveCents: snapshot.emergencyFund.balanceCents,
    postCarReserveTargetCents: snapshot.emergencyFund.postCarTargetCents,
    monthlyCarLimitCents: snapshot.profile.carMonthlyLimitCents,
    installmentLimitCents: snapshot.profile.carInstallmentLimitCents,
    confirmedMonthlyIncomeCents: snapshot.cashflow.confirmedIncomeCents,
    livingCostAfterCarCents: 1_538_000,
    currentOperatingBalanceCents: snapshot.balances.operatingCents,
    fixedCostsConfirmed,
    priorityAPlanComplete,
  });
}

export async function listCanonicalCashflow(
  userId: number,
  input: {
    startDate: string;
    endDate: string;
    scenario: "conservative" | "base" | "growth" | "aggressive";
    expectedTenantId?: number;
  }
) {
  const snapshot = await getCanonicalFinancialSnapshot(userId, {
    expectedTenantId: input.expectedTenantId,
  });
  if (!snapshot.configured) return { configured: false as const, items: [] };
  const scope = snapshot.scope;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const items = await db
    .select()
    .from(recurringCashflows)
    .where(
      and(
        eq(recurringCashflows.tenantId, scope.tenantId),
        eq(recurringCashflows.userId, scope.userId),
        gte(recurringCashflows.nextDueDate, input.startDate),
        lte(recurringCashflows.nextDueDate, input.endDate),
        eq(recurringCashflows.active, true)
      )
    )
    .orderBy(asc(recurringCashflows.nextDueDate));
  const allowed = items.filter(item => {
    if (input.scenario === "conservative") return item.status === "confirmed";
    if (input.scenario === "base")
      return item.seedKey?.startsWith("income-") || item.type === "expense";
    return true;
  });
  return {
    configured: true as const,
    scenario: input.scenario,
    startDate: input.startDate,
    endDate: input.endDate,
    items: allowed,
    totals: {
      incomeCents: allowed
        .filter(item => item.type === "income")
        .reduce((sum, item) => sum + item.amountCents, 0),
      expenseCents: allowed
        .filter(item => item.type === "expense")
        .reduce((sum, item) => sum + item.amountCents, 0),
    },
  };
}

export async function getCanonicalBudgetStatus(
  userId: number,
  input: {
    period: string;
    categoryId?: number | null;
    expectedTenantId?: number;
  }
) {
  const scope = await coreDb.resolveFinancialScope(
    userId,
    input.expectedTenantId
  );
  const periods = await coreDb.listBudgetPeriods(scope);
  const period = periods.find(item =>
    item.periodStart.startsWith(input.period)
  );
  if (!period) {
    return {
      configured: true as const,
      period: null,
      envelopes: [],
      totals: { plannedCents: 0, spentCents: 0, reservedCents: 0 },
    };
  }
  const allEnvelopes = await coreDb.listBudgetEnvelopes(scope, period.id);
  const envelopes =
    input.categoryId == null
      ? allEnvelopes
      : allEnvelopes.filter(item => item.categoryId === input.categoryId);
  return {
    configured: true as const,
    period,
    envelopes,
    totals: {
      plannedCents: envelopes.reduce(
        (sum, envelope) => sum + envelope.plannedCents,
        0
      ),
      spentCents: envelopes.reduce(
        (sum, envelope) => sum + envelope.spentCents,
        0
      ),
      reservedCents: envelopes.reduce(
        (sum, envelope) => sum + envelope.reservedCents,
        0
      ),
    },
  };
}

export async function getCanonicalFifthBusinessDay(
  userId: number,
  input: { year: number; month: number; expectedTenantId?: number }
) {
  const scope = await coreDb.resolveFinancialScope(
    userId,
    input.expectedTenantId
  );
  const start = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const end = `${input.year}-${String(input.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const holidays = await coreDb.listBusinessHolidays(scope, start, end);
  return {
    date: getNthBusinessDay(
      input.year,
      input.month,
      5,
      holidays.map(holiday => holiday.date)
    ),
    customHolidays: holidays,
  };
}

export function sortFinancialPriorities<T extends { priority: string }>(
  items: T[]
) {
  return items.slice().sort((left, right) => {
    const rank = priorityRank(left.priority) - priorityRank(right.priority);
    return rank || left.priority.localeCompare(right.priority, "pt-BR");
  });
}
