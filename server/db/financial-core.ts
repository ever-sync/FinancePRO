import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  budgetEnvelopes,
  budgetPeriods,
  businessCalendarHolidays,
  dataSubjectRequests,
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
  incomeAllocations,
  projectActivities,
  projectInstallments,
  privacyConsents,
  recurringCashflows,
  scheduledNotifications,
  statementImports,
  users,
  type InsertFinancialAccount,
  type InsertFinancialCategory,
  type InsertFinancialDebt,
  type InsertFinancialGoal,
  type InsertFinancialGoalItem,
  type InsertFinancialProfile,
  type InsertFinancialProject,
  type InsertFinancialTransaction,
} from "../../drizzle/schema";
import {
  assertNonNegativeCents,
  calculateProjectSplit,
  getNthBusinessDay,
} from "../../shared/financial-core";
import {
  createSantanderRowHash,
  normalizeStatementDescription,
  type SantanderStatement,
} from "../finance/santander-statement";
import { getDb } from "../db";

export type FinancialScope = {
  tenantId: number;
  userId: number;
};

export type FinancialActor = {
  type: "user" | "assistant" | "system" | "import";
  id?: string | null;
};

export type RecordFinancialTransactionInput = {
  accountId: number;
  type: "income" | "expense";
  amountCents: number;
  occurredAt: Date;
  description: string;
  categoryId?: number | null;
  status: "confirmed" | "expected" | "paid" | "received";
  counterparty?: string | null;
  documentNumber?: string | null;
  source: "whatsapp" | "web" | "import" | "api" | "system";
  externalId?: string | null;
  importId?: number | null;
  confidence?: number | null;
  needsReview?: boolean;
  idempotencyKey: string;
  actor: FinancialActor;
};

const CONFIRMED_STATUSES = new Set(["confirmed", "paid", "received"]);

function normalizeDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function assertScope(scope: FinancialScope) {
  if (!Number.isInteger(scope.tenantId) || scope.tenantId <= 0)
    throw new Error("Tenant invalido");
  if (!Number.isInteger(scope.userId) || scope.userId <= 0)
    throw new Error("Usuario invalido");
}

export async function resolveFinancialScope(
  userId: number,
  expectedTenantId?: number
): Promise<FinancialScope> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [user] = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error("Usuario financeiro nao encontrado");
  if (expectedTenantId != null && user.tenantId !== expectedTenantId)
    throw new Error("Tenant nao corresponde ao usuario autenticado");
  return { tenantId: user.tenantId, userId };
}

export async function getFinancialProfile(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [profile] = await db
    .select()
    .from(financialProfiles)
    .where(
      and(
        eq(financialProfiles.tenantId, scope.tenantId),
        eq(financialProfiles.userId, scope.userId)
      )
    )
    .limit(1);
  return profile;
}

export async function upsertFinancialProfile(
  scope: FinancialScope,
  data: Omit<InsertFinancialProfile, "tenantId" | "userId">
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [profile] = await db
    .insert(financialProfiles)
    .values({ ...data, ...scope })
    .onConflictDoUpdate({
      target: [financialProfiles.tenantId, financialProfiles.userId],
      set: { ...data, updatedAt: new Date() },
    })
    .returning();
  return profile;
}

export async function listFinancialAccounts(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.tenantId, scope.tenantId),
        eq(financialAccounts.userId, scope.userId),
        eq(financialAccounts.active, true)
      )
    )
    .orderBy(asc(financialAccounts.ownerType), asc(financialAccounts.name));
}

export async function getFinancialAccount(
  scope: FinancialScope,
  accountId: number
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [account] = await db
    .select()
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.id, accountId),
        eq(financialAccounts.tenantId, scope.tenantId),
        eq(financialAccounts.userId, scope.userId)
      )
    )
    .limit(1);
  return account;
}

export async function setFinancialAccountBalance(
  scope: FinancialScope,
  input: {
    accountId: number;
    balanceCents: number;
    balanceAsOf: Date;
    protectedReductionConfirmed?: boolean;
    actor: FinancialActor;
  }
) {
  assertScope(scope);
  if (!Number.isSafeInteger(input.balanceCents))
    throw new Error("balanceCents deve ser um inteiro seguro");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, input.accountId),
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      )
      .limit(1);
    if (!before) throw new Error("Conta financeira nao encontrada");
    if (
      before.protected &&
      input.balanceCents < before.currentBalanceCents &&
      !input.protectedReductionConfirmed
    ) {
      throw new Error(
        "Reducao de saldo protegido exige confirmacao explicita adicional"
      );
    }
    const [after] = await tx
      .update(financialAccounts)
      .set({
        currentBalanceCents: input.balanceCents,
        balanceAsOf: input.balanceAsOf,
        updatedAt: new Date(),
      })
      .where(eq(financialAccounts.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "account.balance_confirmed",
      entityType: "financial_account",
      entityId: String(before.id),
      before: {
        currentBalanceCents: before.currentBalanceCents,
        balanceAsOf: before.balanceAsOf,
      },
      after: {
        currentBalanceCents: after.currentBalanceCents,
        balanceAsOf: after.balanceAsOf,
      },
    });
    return after;
  });
}

export async function upsertSeedAccount(
  scope: FinancialScope,
  data: Omit<InsertFinancialAccount, "tenantId" | "userId">
) {
  assertScope(scope);
  if (!data.seedKey) throw new Error("seedKey obrigatoria");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [account] = await db
    .insert(financialAccounts)
    .values({ ...data, ...scope })
    .onConflictDoUpdate({
      target: [
        financialAccounts.tenantId,
        financialAccounts.userId,
        financialAccounts.seedKey,
      ],
      set: {
        name: data.name,
        ownerType: data.ownerType,
        accountType: data.accountType,
        institution: data.institution ?? null,
        includeInOperatingCash: data.includeInOperatingCash ?? true,
        protected: data.protected ?? false,
        active: data.active ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();
  return account;
}

export async function listFinancialCategories(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.tenantId, scope.tenantId),
        eq(financialCategories.userId, scope.userId),
        eq(financialCategories.active, true)
      )
    )
    .orderBy(asc(financialCategories.group), asc(financialCategories.name));
}

export async function getCategoryByKey(scope: FinancialScope, key: string) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [category] = await db
    .select()
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.tenantId, scope.tenantId),
        eq(financialCategories.userId, scope.userId),
        eq(financialCategories.key, key)
      )
    )
    .limit(1);
  return category;
}

export async function upsertFinancialCategory(
  scope: FinancialScope,
  data: Omit<InsertFinancialCategory, "tenantId" | "userId">
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [category] = await db
    .insert(financialCategories)
    .values({ ...data, ...scope })
    .onConflictDoUpdate({
      target: [
        financialCategories.tenantId,
        financialCategories.userId,
        financialCategories.key,
      ],
      set: { ...data, updatedAt: new Date() },
    })
    .returning();
  return category;
}

export async function listFinancialTransactions(
  scope: FinancialScope,
  options: {
    limit?: number;
    offset?: number;
    start?: Date;
    end?: Date;
    needsReview?: boolean;
  } = {}
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(financialTransactions.tenantId, scope.tenantId),
    eq(financialTransactions.userId, scope.userId),
  ];
  if (options.start)
    conditions.push(gte(financialTransactions.occurredAt, options.start));
  if (options.end)
    conditions.push(lte(financialTransactions.occurredAt, options.end));
  if (options.needsReview != null)
    conditions.push(eq(financialTransactions.needsReview, options.needsReview));
  return db
    .select()
    .from(financialTransactions)
    .where(and(...conditions))
    .orderBy(
      desc(financialTransactions.occurredAt),
      desc(financialTransactions.id)
    )
    .limit(Math.max(1, Math.min(options.limit ?? 50, 10_000)))
    .offset(Math.max(0, options.offset ?? 0));
}

async function validateCategoryScope(
  tx: Parameters<
    Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
  >[0],
  scope: FinancialScope,
  categoryId?: number | null
) {
  if (!categoryId) return;
  const [category] = await tx
    .select({ id: financialCategories.id })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.id, categoryId),
        eq(financialCategories.tenantId, scope.tenantId),
        eq(financialCategories.userId, scope.userId)
      )
    )
    .limit(1);
  if (!category) throw new Error("Categoria financeira nao encontrada");
}

function transactionBalanceEffect(input: {
  type: string;
  transferDirection?: string | null;
  amountCents: number;
  status: string;
}) {
  if (!CONFIRMED_STATUSES.has(input.status)) return 0;
  if (input.type === "income") return input.amountCents;
  if (input.type === "expense") return -input.amountCents;
  if (input.type === "transfer")
    return input.transferDirection === "in"
      ? input.amountCents
      : -input.amountCents;
  return 0;
}

function isoDateInSaoPaulo(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function adjustBudgetSpend(
  tx: Parameters<
    Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
  >[0],
  scope: FinancialScope,
  categoryId: number | null | undefined,
  occurredAt: Date,
  deltaCents: number
) {
  if (!categoryId || deltaCents === 0) return;
  const occurredOn = isoDateInSaoPaulo(occurredAt);
  const [category] = await tx
    .select({ group: financialCategories.group })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.id, categoryId),
        eq(financialCategories.tenantId, scope.tenantId),
        eq(financialCategories.userId, scope.userId)
      )
    )
    .limit(1);
  const [period] = await tx
    .select({ id: budgetPeriods.id })
    .from(budgetPeriods)
    .where(
      and(
        eq(budgetPeriods.tenantId, scope.tenantId),
        eq(budgetPeriods.userId, scope.userId),
        lte(budgetPeriods.periodStart, occurredOn),
        gte(budgetPeriods.periodEnd, occurredOn)
      )
    )
    .limit(1);
  if (!period) return;

  const preferredName =
    category?.group === "personal_fixed"
      ? "Contas fixas e essenciais"
      : category?.group === "personal_variable"
        ? "Despesas variáveis"
        : null;
  const candidates = await tx
    .select()
    .from(budgetEnvelopes)
    .where(
      and(
        eq(budgetEnvelopes.tenantId, scope.tenantId),
        eq(budgetEnvelopes.userId, scope.userId),
        eq(budgetEnvelopes.budgetPeriodId, period.id)
      )
    );
  const envelope =
    candidates.find(item => item.categoryId === categoryId) ??
    candidates.find(
      item => preferredName != null && item.name === preferredName
    );
  if (!envelope) return;
  await tx
    .update(budgetEnvelopes)
    .set({
      spentCents: sql`greatest(0, ${budgetEnvelopes.spentCents} + ${deltaCents})`,
      updatedAt: new Date(),
    })
    .where(eq(budgetEnvelopes.id, envelope.id));
}

export async function recordFinancialTransaction(
  scope: FinancialScope,
  input: RecordFinancialTransactionInput
) {
  assertScope(scope);
  assertNonNegativeCents(input.amountCents, "amountCents");
  if (input.amountCents === 0)
    throw new Error("amountCents deve ser maior que zero");
  if (!input.description.trim()) throw new Error("Descricao obrigatoria");
  if (!input.idempotencyKey.trim())
    throw new Error("Chave idempotente obrigatoria");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, input.accountId),
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      )
      .limit(1);
    if (!account) throw new Error("Conta financeira nao encontrada");
    await validateCategoryScope(tx, scope, input.categoryId);

    const insert: InsertFinancialTransaction = {
      ...scope,
      accountId: input.accountId,
      type: input.type,
      status: input.status,
      amountCents: input.amountCents,
      occurredAt: input.occurredAt,
      description: input.description.trim(),
      normalizedDescription: normalizeDescription(input.description),
      categoryId: input.categoryId ?? null,
      counterparty: input.counterparty?.trim() || null,
      documentNumber: input.documentNumber?.trim() || null,
      source: input.source,
      externalId: input.externalId?.trim() || null,
      importId: input.importId ?? null,
      confidence: input.confidence ?? null,
      needsReview: input.needsReview ?? false,
      idempotencyKey: input.idempotencyKey.trim(),
    };
    const [created] = await tx
      .insert(financialTransactions)
      .values(insert)
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const [existing] = await tx
        .select()
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.tenantId, scope.tenantId),
            eq(financialTransactions.userId, scope.userId),
            eq(
              financialTransactions.idempotencyKey,
              input.idempotencyKey.trim()
            )
          )
        )
        .limit(1);
      if (!existing) throw new Error("Falha de idempotencia da transacao");
      return { transaction: existing, alreadyProcessed: true };
    }

    const effect = transactionBalanceEffect(created);
    if (effect !== 0) {
      await tx
        .update(financialAccounts)
        .set({
          currentBalanceCents: sql`${financialAccounts.currentBalanceCents} + ${effect}`,
          balanceAsOf: input.occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, account.id));
    }
    if (created.type === "expense" && effect < 0) {
      await adjustBudgetSpend(
        tx,
        scope,
        created.categoryId,
        created.occurredAt,
        created.amountCents
      );
    }
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "transaction.recorded",
      entityType: "financial_transaction",
      entityId: String(created.id),
      before: null,
      after: created,
      requestId: input.idempotencyKey,
    });
    return { transaction: created, alreadyProcessed: false };
  });
}

export async function recordFinancialTransfer(
  scope: FinancialScope,
  input: {
    fromAccountId: number;
    toAccountId: number;
    amountCents: number;
    occurredAt: Date;
    description: string;
    idempotencyKey: string;
    source: RecordFinancialTransactionInput["source"];
    actor: FinancialActor;
    protectedWithdrawalConfirmed?: boolean;
  }
) {
  assertScope(scope);
  assertNonNegativeCents(input.amountCents, "amountCents");
  if (input.amountCents === 0)
    throw new Error("amountCents deve ser maior que zero");
  if (input.fromAccountId === input.toAccountId)
    throw new Error("Contas de origem e destino devem ser diferentes");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const accounts = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      );
    const sourceAccount = accounts.find(
      item => item.id === input.fromAccountId
    );
    const destinationAccount = accounts.find(
      item => item.id === input.toAccountId
    );
    if (!sourceAccount || !destinationAccount)
      throw new Error("Conta de origem ou destino nao encontrada");
    if (sourceAccount.protected && !input.protectedWithdrawalConfirmed) {
      throw new Error(
        "Retirada de conta protegida exige confirmacao explicita adicional"
      );
    }
    if (sourceAccount.currentBalanceCents < input.amountCents) {
      throw new Error("Saldo insuficiente na conta de origem");
    }

    const [existing] = await tx
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.tenantId, scope.tenantId),
          eq(financialTransactions.userId, scope.userId),
          eq(
            financialTransactions.idempotencyKey,
            `${input.idempotencyKey}:out`
          )
        )
      )
      .limit(1);
    if (existing)
      return { sourceTransaction: existing, alreadyProcessed: true };

    const base = {
      ...scope,
      type: "transfer",
      status: "confirmed",
      amountCents: input.amountCents,
      occurredAt: input.occurredAt,
      description: input.description.trim(),
      normalizedDescription: normalizeDescription(input.description),
      source: input.source,
      needsReview: false,
    };
    const [outgoing] = await tx
      .insert(financialTransactions)
      .values({
        ...base,
        accountId: sourceAccount.id,
        transferDirection: "out",
        idempotencyKey: `${input.idempotencyKey}:out`,
      })
      .returning();
    const [incoming] = await tx
      .insert(financialTransactions)
      .values({
        ...base,
        accountId: destinationAccount.id,
        transferDirection: "in",
        idempotencyKey: `${input.idempotencyKey}:in`,
        transferPairId: outgoing.id,
      })
      .returning();
    await tx
      .update(financialTransactions)
      .set({ transferPairId: incoming.id })
      .where(eq(financialTransactions.id, outgoing.id));
    await tx
      .update(financialAccounts)
      .set({
        currentBalanceCents: sql`${financialAccounts.currentBalanceCents} - ${input.amountCents}`,
        balanceAsOf: input.occurredAt,
        updatedAt: new Date(),
      })
      .where(eq(financialAccounts.id, sourceAccount.id));
    await tx
      .update(financialAccounts)
      .set({
        currentBalanceCents: sql`${financialAccounts.currentBalanceCents} + ${input.amountCents}`,
        balanceAsOf: input.occurredAt,
        updatedAt: new Date(),
      })
      .where(eq(financialAccounts.id, destinationAccount.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "transfer.recorded",
      entityType: "financial_transfer",
      entityId: `${outgoing.id}:${incoming.id}`,
      after: {
        fromAccountId: sourceAccount.id,
        toAccountId: destinationAccount.id,
        amountCents: input.amountCents,
      },
      requestId: input.idempotencyKey,
    });
    return {
      sourceTransaction: { ...outgoing, transferPairId: incoming.id },
      destinationTransaction: incoming,
      alreadyProcessed: false,
    };
  });
}

export async function reverseFinancialTransaction(
  scope: FinancialScope,
  input: {
    transactionId: number;
    reason: string;
    actor: FinancialActor;
    undoWindowMinutes?: number;
    allowOutsideUndoWindow?: boolean;
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [original] = await tx
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
    if (!original) throw new Error("Transacao nao encontrada");
    if (original.reversedAt) throw new Error("Transacao ja foi revertida");
    if (original.reconciledAt)
      throw new Error("Transacao conciliada exige confirmacao adicional");
    if (original.type === "transfer")
      throw new Error("Use a reversao de transferencia vinculada");
    const undoWindowMs = (input.undoWindowMinutes ?? 15) * 60_000;
    if (
      !input.allowOutsideUndoWindow &&
      Date.now() - original.createdAt.getTime() > undoWindowMs
    ) {
      throw new Error("O prazo para desfazer expirou");
    }
    const idempotencyKey = `reverse:${original.id}`;
    const [existing] = await tx
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.tenantId, scope.tenantId),
          eq(financialTransactions.userId, scope.userId),
          eq(financialTransactions.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (existing) return { reversal: existing, alreadyProcessed: true };

    const originalEffect = transactionBalanceEffect(original);
    const [reversal] = await tx
      .insert(financialTransactions)
      .values({
        ...scope,
        accountId: original.accountId,
        reversalOfId: original.id,
        type: "reversal",
        status: "confirmed",
        amountCents: original.amountCents,
        occurredAt: new Date(),
        description: `Reversao: ${input.reason.trim() || original.description}`,
        normalizedDescription: normalizeDescription(
          `Reversao ${original.description}`
        ),
        source: original.source,
        idempotencyKey,
        needsReview: false,
      })
      .returning();
    if (originalEffect !== 0) {
      await tx
        .update(financialAccounts)
        .set({
          currentBalanceCents: sql`${financialAccounts.currentBalanceCents} - ${originalEffect}`,
          balanceAsOf: reversal.occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, original.accountId));
    }
    if (original.type === "expense" && originalEffect < 0) {
      await adjustBudgetSpend(
        tx,
        scope,
        original.categoryId,
        original.occurredAt,
        -original.amountCents
      );
    }
    await tx
      .update(financialTransactions)
      .set({ reversedAt: reversal.occurredAt, updatedAt: new Date() })
      .where(eq(financialTransactions.id, original.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "transaction.reversed",
      entityType: "financial_transaction",
      entityId: String(original.id),
      before: original,
      after: { reversedAt: reversal.occurredAt, reversalId: reversal.id },
      requestId: idempotencyKey,
    });
    return { reversal, alreadyProcessed: false };
  });
}

export async function categorizeFinancialTransaction(
  scope: FinancialScope,
  input: {
    transactionId: number;
    categoryId: number;
    createMerchantRule: boolean;
    actor: FinancialActor;
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
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
    if (!transaction) throw new Error("Transacao nao encontrada");
    await validateCategoryScope(tx, scope, input.categoryId);
    if (
      transaction.type === "expense" &&
      CONFIRMED_STATUSES.has(transaction.status) &&
      !transaction.reversedAt &&
      !transaction.reversalOfId &&
      transaction.categoryId !== input.categoryId
    ) {
      await adjustBudgetSpend(
        tx,
        scope,
        transaction.categoryId,
        transaction.occurredAt,
        -transaction.amountCents
      );
      await adjustBudgetSpend(
        tx,
        scope,
        input.categoryId,
        transaction.occurredAt,
        transaction.amountCents
      );
    }
    await tx
      .update(financialTransactions)
      .set({
        categoryId: input.categoryId,
        needsReview: false,
        confidence: 100,
        updatedAt: new Date(),
      })
      .where(eq(financialTransactions.id, transaction.id));

    if (input.createMerchantRule) {
      const pattern =
        transaction.counterparty?.trim() || transaction.normalizedDescription;
      if (pattern) {
        await tx
          .insert(financialTransactionRules)
          .values({
            ...scope,
            pattern,
            matchType: "contains",
            categoryId: input.categoryId,
            ownerType: null,
            priority: 10,
            createdBy: input.actor.type,
            active: true,
          })
          .onConflictDoUpdate({
            target: [
              financialTransactionRules.tenantId,
              financialTransactionRules.userId,
              financialTransactionRules.pattern,
              financialTransactionRules.ownerType,
            ],
            set: {
              categoryId: input.categoryId,
              active: true,
              updatedAt: new Date(),
            },
          });
      }
    }
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "transaction.categorized",
      entityType: "financial_transaction",
      entityId: String(transaction.id),
      before: { categoryId: transaction.categoryId },
      after: { categoryId: input.categoryId, needsReview: false },
    });
    return { ...transaction, categoryId: input.categoryId, needsReview: false };
  });
}

export async function listRecurringCashflows(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(recurringCashflows)
    .where(
      and(
        eq(recurringCashflows.tenantId, scope.tenantId),
        eq(recurringCashflows.userId, scope.userId),
        eq(recurringCashflows.active, true)
      )
    )
    .orderBy(asc(recurringCashflows.nextDueDate), asc(recurringCashflows.name));
}

export async function updateRecurringCashflow(
  scope: FinancialScope,
  cashflowId: number,
  data: Partial<{
    amountCents: number;
    nextDueDate: string | null;
    status: string;
    estimated: boolean;
    needsConfirmation: boolean;
    active: boolean;
  }>,
  actor: FinancialActor
) {
  assertScope(scope);
  if (data.amountCents != null)
    assertNonNegativeCents(data.amountCents, "amountCents");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(recurringCashflows)
      .where(
        and(
          eq(recurringCashflows.id, cashflowId),
          eq(recurringCashflows.tenantId, scope.tenantId),
          eq(recurringCashflows.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Fluxo recorrente nao encontrado");
    const [after] = await tx
      .update(recurringCashflows)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(recurringCashflows.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "recurring_cashflow.updated",
      entityType: "recurring_cashflow",
      entityId: String(before.id),
      before,
      after,
    });
    return after;
  });
}

export async function listFinancialGoals(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialGoals)
    .where(
      and(
        eq(financialGoals.tenantId, scope.tenantId),
        eq(financialGoals.userId, scope.userId)
      )
    )
    .orderBy(asc(financialGoals.priority), asc(financialGoals.name));
}

export async function listFinancialGoalItems(
  scope: FinancialScope,
  goalId?: number
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(financialGoalItems.tenantId, scope.tenantId),
    eq(financialGoalItems.userId, scope.userId),
  ];
  if (goalId != null) conditions.push(eq(financialGoalItems.goalId, goalId));
  return db
    .select()
    .from(financialGoalItems)
    .where(and(...conditions))
    .orderBy(
      asc(financialGoalItems.priority),
      asc(financialGoalItems.personOrGroup),
      asc(financialGoalItems.name)
    );
}

export async function createFinancialGoal(
  scope: FinancialScope,
  data: Omit<InsertFinancialGoal, "tenantId" | "userId">,
  actor: FinancialActor
) {
  assertScope(scope);
  assertNonNegativeCents(data.targetCents, "targetCents");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [goal] = await tx
      .insert(financialGoals)
      .values({ ...data, ...scope })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "goal.created",
      entityType: "financial_goal",
      entityId: String(goal.id),
      after: goal,
    });
    return goal;
  });
}

export async function updateFinancialGoalItem(
  scope: FinancialScope,
  itemId: number,
  data: Partial<
    Pick<
      InsertFinancialGoalItem,
      "status" | "actualCostCents" | "desiredDate" | "notes" | "priority"
    >
  >,
  actor: FinancialActor
) {
  assertScope(scope);
  if (data.actualCostCents != null)
    assertNonNegativeCents(data.actualCostCents, "actualCostCents");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(financialGoalItems)
      .where(
        and(
          eq(financialGoalItems.id, itemId),
          eq(financialGoalItems.tenantId, scope.tenantId),
          eq(financialGoalItems.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Item de meta nao encontrado");
    const [after] = await tx
      .update(financialGoalItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(financialGoalItems.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "goal_item.updated",
      entityType: "financial_goal_item",
      entityId: String(before.id),
      before,
      after,
    });
    return after;
  });
}

export async function listFinancialDebts(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialDebts)
    .where(
      and(
        eq(financialDebts.tenantId, scope.tenantId),
        eq(financialDebts.userId, scope.userId)
      )
    )
    .orderBy(asc(financialDebts.priority), asc(financialDebts.dueDate));
}

export async function updateFinancialDebt(
  scope: FinancialScope,
  debtId: number,
  data: Partial<{
    balanceCents: number;
    dueDate: string | null;
    minimumPaymentCents: number | null;
    priority: string;
    status: string;
    needsConfirmation: boolean;
    notes: string | null;
  }>,
  actor: FinancialActor
) {
  assertScope(scope);
  if (data.balanceCents != null)
    assertNonNegativeCents(data.balanceCents, "balanceCents");
  if (data.minimumPaymentCents != null)
    assertNonNegativeCents(data.minimumPaymentCents, "minimumPaymentCents");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(financialDebts)
      .where(
        and(
          eq(financialDebts.id, debtId),
          eq(financialDebts.tenantId, scope.tenantId),
          eq(financialDebts.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Divida financeira nao encontrada");
    const normalized = {
      ...data,
      ...(data.balanceCents === 0
        ? { status: "paid", needsConfirmation: false }
        : {}),
      updatedAt: new Date(),
    };
    const [after] = await tx
      .update(financialDebts)
      .set(normalized)
      .where(eq(financialDebts.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "debt.updated",
      entityType: "financial_debt",
      entityId: String(before.id),
      before,
      after,
    });
    return after;
  });
}

export async function listFinancialProjects(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialProjects)
    .where(
      and(
        eq(financialProjects.tenantId, scope.tenantId),
        eq(financialProjects.userId, scope.userId)
      )
    )
    .orderBy(desc(financialProjects.updatedAt));
}

export async function listProjectInstallments(
  scope: FinancialScope,
  projectId?: number
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(projectInstallments.tenantId, scope.tenantId),
    eq(projectInstallments.userId, scope.userId),
  ];
  if (projectId != null)
    conditions.push(eq(projectInstallments.projectId, projectId));
  return db
    .select()
    .from(projectInstallments)
    .where(and(...conditions))
    .orderBy(asc(projectInstallments.expectedAt));
}

export async function createFinancialProject(
  scope: FinancialScope,
  data: Omit<InsertFinancialProject, "tenantId" | "userId">,
  installments: Array<{ amountCents: number; expectedAt?: string | null }>,
  actor: FinancialActor
) {
  assertScope(scope);
  assertNonNegativeCents(data.grossValueCents ?? 0, "grossValueCents");
  const installmentTotal = installments.reduce((sum, item) => {
    assertNonNegativeCents(item.amountCents, "installmentAmountCents");
    return sum + item.amountCents;
  }, 0);
  if (installments.length > 0 && installmentTotal !== data.grossValueCents)
    throw new Error(
      "A soma das parcelas deve ser igual ao valor bruto do projeto"
    );
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [project] = await tx
      .insert(financialProjects)
      .values({ ...data, ...scope })
      .returning();
    const createdInstallments = installments.length
      ? await tx
          .insert(projectInstallments)
          .values(
            installments.map(item => ({
              ...scope,
              projectId: project.id,
              amountCents: item.amountCents,
              expectedAt: item.expectedAt ?? null,
              status: "expected",
            }))
          )
          .returning()
      : [];
    await tx.insert(projectActivities).values({
      ...scope,
      projectId: project.id,
      type: "created",
      notes: `Projeto criado no estágio ${project.stage}`,
    });
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "project.created",
      entityType: "financial_project",
      entityId: String(project.id),
      after: { project, installments: createdInstallments },
    });
    return { project, installments: createdInstallments };
  });
}

export async function confirmProjectInstallmentReceived(
  scope: FinancialScope,
  input: {
    installmentId: number;
    accountId: number;
    receivedAt: Date;
    actor: FinancialActor;
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [installment] = await tx
      .select()
      .from(projectInstallments)
      .where(
        and(
          eq(projectInstallments.id, input.installmentId),
          eq(projectInstallments.tenantId, scope.tenantId),
          eq(projectInstallments.userId, scope.userId)
        )
      )
      .limit(1);
    if (!installment) throw new Error("Parcela de projeto nao encontrada");
    if (installment.status === "received" && installment.transactionId) {
      const [existingTransaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, installment.transactionId))
        .limit(1);
      return {
        installment,
        transaction: existingTransaction,
        allocations: [],
        alreadyProcessed: true,
      };
    }
    const [project] = await tx
      .select()
      .from(financialProjects)
      .where(
        and(
          eq(financialProjects.id, installment.projectId),
          eq(financialProjects.tenantId, scope.tenantId),
          eq(financialProjects.userId, scope.userId)
        )
      )
      .limit(1);
    if (!project) throw new Error("Projeto financeiro nao encontrado");
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, input.accountId),
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      )
      .limit(1);
    if (!account) throw new Error("Conta financeira nao encontrada");

    const idempotencyKey = `project-installment:${installment.id}:received`;
    const [transaction] = await tx
      .insert(financialTransactions)
      .values({
        ...scope,
        accountId: account.id,
        type: "income",
        status: "received",
        amountCents: installment.amountCents,
        occurredAt: input.receivedAt,
        description: `Recebimento do projeto ${project.name}`,
        normalizedDescription: normalizeDescription(
          `Recebimento do projeto ${project.name}`
        ),
        source: input.actor.type === "assistant" ? "whatsapp" : "web",
        idempotencyKey,
        needsReview: false,
      })
      .onConflictDoNothing()
      .returning();
    if (!transaction) throw new Error("Recebimento do projeto ja processado");

    const goalBasisPoints =
      10_000 - project.taxBasisPoints - project.costBasisPoints;
    const split = calculateProjectSplit(
      installment.amountCents,
      project.taxBasisPoints,
      project.costBasisPoints,
      goalBasisPoints
    );
    const [priorityGoal] = await tx
      .select()
      .from(financialGoals)
      .where(
        and(
          eq(financialGoals.tenantId, scope.tenantId),
          eq(financialGoals.userId, scope.userId),
          eq(financialGoals.status, "planned")
        )
      )
      .orderBy(asc(financialGoals.priority), asc(financialGoals.id))
      .limit(1);
    const allocations = await tx
      .insert(incomeAllocations)
      .values([
        {
          ...scope,
          transactionId: transaction.id,
          allocationType: "taxes",
          amountCents: split.taxesCents,
        },
        {
          ...scope,
          transactionId: transaction.id,
          allocationType: "delivery_costs",
          amountCents: split.deliveryCostsCents,
        },
        {
          ...scope,
          transactionId: transaction.id,
          goalId: priorityGoal?.id ?? null,
          allocationType: "priority_goals",
          amountCents: split.goalsCents,
        },
      ])
      .returning();
    if (priorityGoal) {
      await tx
        .update(financialGoals)
        .set({
          fundedCents: sql`${financialGoals.fundedCents} + ${split.goalsCents}`,
          updatedAt: new Date(),
        })
        .where(eq(financialGoals.id, priorityGoal.id));
    }
    await tx
      .update(financialAccounts)
      .set({
        currentBalanceCents: sql`${financialAccounts.currentBalanceCents} + ${installment.amountCents}`,
        balanceAsOf: input.receivedAt,
        updatedAt: new Date(),
      })
      .where(eq(financialAccounts.id, account.id));
    const [updatedInstallment] = await tx
      .update(projectInstallments)
      .set({
        status: "received",
        receivedAt: input.receivedAt,
        transactionId: transaction.id,
        updatedAt: new Date(),
      })
      .where(eq(projectInstallments.id, installment.id))
      .returning();
    await tx.insert(projectActivities).values({
      ...scope,
      projectId: project.id,
      type: "payment_received",
      occurredAt: input.receivedAt,
      notes: `Parcela de ${installment.amountCents} centavos recebida e alocada em 15/10/75.`,
    });
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "project.installment_received",
      entityType: "project_installment",
      entityId: String(installment.id),
      before: installment,
      after: { installment: updatedInstallment, transaction, split },
      requestId: idempotencyKey,
    });
    return {
      installment: updatedInstallment,
      transaction,
      allocations,
      split,
      alreadyProcessed: false,
    };
  });
}

export async function allocateConfirmedIncome(
  scope: FinancialScope,
  input: {
    transactionId: number;
    allocations: Array<{
      allocationType: string;
      amountCents: number;
      envelopeId?: number | null;
      goalId?: number | null;
    }>;
    requestId: string;
    actor: FinancialActor;
  }
) {
  assertScope(scope);
  if (!input.requestId.trim()) throw new Error("requestId obrigatorio");
  if (input.allocations.length === 0 || input.allocations.length > 50)
    throw new Error("Informe entre 1 e 50 alocacoes");
  for (const allocation of input.allocations) {
    assertNonNegativeCents(allocation.amountCents, "allocationAmountCents");
    if (allocation.amountCents === 0)
      throw new Error("O valor de cada alocacao deve ser maior que zero");
    if (!allocation.allocationType.trim())
      throw new Error("O tipo da alocacao e obrigatorio");
    if (allocation.envelopeId && allocation.goalId)
      throw new Error("Uma alocacao nao pode apontar para envelope e meta");
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
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
    if (!transaction) throw new Error("Receita financeira nao encontrada");
    if (
      transaction.type !== "income" ||
      !CONFIRMED_STATUSES.has(transaction.status) ||
      transaction.reversedAt ||
      transaction.reversalOfId
    ) {
      throw new Error("Somente uma receita confirmada pode ser alocada");
    }

    const requestId = input.requestId.trim();
    const [auditReservation] = await tx
      .insert(financialAuditEvents)
      .values({
        ...scope,
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        action: "income.allocated",
        entityType: "financial_transaction",
        entityId: String(transaction.id),
        after: { status: "processing" },
        requestId,
      })
      .onConflictDoNothing({
        target: [
          financialAuditEvents.tenantId,
          financialAuditEvents.userId,
          financialAuditEvents.action,
          financialAuditEvents.requestId,
        ],
      })
      .returning();
    if (!auditReservation) {
      const [existingAudit] = await tx
        .select()
        .from(financialAuditEvents)
        .where(
          and(
            eq(financialAuditEvents.tenantId, scope.tenantId),
            eq(financialAuditEvents.userId, scope.userId),
            eq(financialAuditEvents.action, "income.allocated"),
            eq(financialAuditEvents.requestId, requestId)
          )
        )
        .limit(1);
      if (existingAudit?.entityId !== String(transaction.id))
        throw new Error("requestId ja usado em outra alocacao");
      const existingAllocations = await tx
        .select()
        .from(incomeAllocations)
        .where(
          and(
            eq(incomeAllocations.tenantId, scope.tenantId),
            eq(incomeAllocations.userId, scope.userId),
            eq(incomeAllocations.transactionId, transaction.id)
          )
        );
      return {
        transaction,
        allocations: existingAllocations,
        alreadyProcessed: true,
      };
    }

    const previousAllocations = await tx
      .select()
      .from(incomeAllocations)
      .where(
        and(
          eq(incomeAllocations.tenantId, scope.tenantId),
          eq(incomeAllocations.userId, scope.userId),
          eq(incomeAllocations.transactionId, transaction.id)
        )
      );
    const previousTotal = previousAllocations.reduce(
      (sum, allocation) => sum + allocation.amountCents,
      0
    );
    const requestedTotal = input.allocations.reduce(
      (sum, allocation) => sum + allocation.amountCents,
      0
    );
    if (previousTotal + requestedTotal > transaction.amountCents) {
      throw new Error("As alocacoes ultrapassam o valor da receita");
    }

    const values = [];
    for (const allocation of input.allocations) {
      let envelopeId = allocation.envelopeId ?? null;
      let goalId = allocation.goalId ?? null;
      if (envelopeId) {
        const [envelope] = await tx
          .select({ id: budgetEnvelopes.id })
          .from(budgetEnvelopes)
          .where(
            and(
              eq(budgetEnvelopes.id, envelopeId),
              eq(budgetEnvelopes.tenantId, scope.tenantId),
              eq(budgetEnvelopes.userId, scope.userId)
            )
          )
          .limit(1);
        if (!envelope) throw new Error("Envelope financeiro nao encontrado");
        await tx
          .update(budgetEnvelopes)
          .set({
            reservedCents: sql`${budgetEnvelopes.reservedCents} + ${allocation.amountCents}`,
            updatedAt: new Date(),
          })
          .where(eq(budgetEnvelopes.id, envelope.id));
      }
      if (goalId) {
        const [goal] = await tx
          .select({ id: financialGoals.id })
          .from(financialGoals)
          .where(
            and(
              eq(financialGoals.id, goalId),
              eq(financialGoals.tenantId, scope.tenantId),
              eq(financialGoals.userId, scope.userId)
            )
          )
          .limit(1);
        if (!goal) throw new Error("Meta financeira nao encontrada");
        await tx
          .update(financialGoals)
          .set({
            fundedCents: sql`${financialGoals.fundedCents} + ${allocation.amountCents}`,
            updatedAt: new Date(),
          })
          .where(eq(financialGoals.id, goal.id));
      }
      values.push({
        ...scope,
        transactionId: transaction.id,
        envelopeId,
        goalId,
        allocationType: allocation.allocationType.trim().slice(0, 32),
        amountCents: allocation.amountCents,
      });
    }
    const createdAllocations = await tx
      .insert(incomeAllocations)
      .values(values)
      .returning();
    await tx
      .update(financialAuditEvents)
      .set({
        after: {
          amountCents: transaction.amountCents,
          allocatedCents: requestedTotal,
          allocations: createdAllocations,
        },
      })
      .where(eq(financialAuditEvents.id, auditReservation.id));
    return {
      transaction,
      allocations: createdAllocations,
      allocatedCents: requestedTotal,
      remainingCents: transaction.amountCents - previousTotal - requestedTotal,
      alreadyProcessed: false,
    };
  });
}

export async function importSantanderStatement(
  scope: FinancialScope,
  input: {
    accountId: number;
    fileName: string;
    statement: SantanderStatement;
    actor: FinancialActor;
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, input.accountId),
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      )
      .limit(1);
    if (!account) throw new Error("Conta financeira nao encontrada");

    const [statementImport] = await tx
      .insert(statementImports)
      .values({
        ...scope,
        accountId: account.id,
        fileName: input.fileName.trim().slice(0, 255) || "extrato.csv",
        fileHash: input.statement.fileHash,
        format: "santander_pj_csv",
        encoding: input.statement.encoding,
        status: "processing",
        rowCount: input.statement.rows.length,
      })
      .onConflictDoNothing()
      .returning();
    if (!statementImport) {
      const [existing] = await tx
        .select()
        .from(statementImports)
        .where(
          and(
            eq(statementImports.tenantId, scope.tenantId),
            eq(statementImports.accountId, account.id),
            eq(statementImports.fileHash, input.statement.fileHash)
          )
        )
        .limit(1);
      return {
        import: existing,
        importedCount: 0,
        duplicateCount: input.statement.rows.length,
        reviewCount: 0,
        totals: input.statement.totals,
        alreadyProcessed: true,
      };
    }

    const rules = await tx
      .select()
      .from(financialTransactionRules)
      .where(
        and(
          eq(financialTransactionRules.tenantId, scope.tenantId),
          eq(financialTransactionRules.userId, scope.userId),
          eq(financialTransactionRules.active, true)
        )
      )
      .orderBy(asc(financialTransactionRules.priority));
    let importedCount = 0;
    let duplicateCount = 0;
    let reviewCount = 0;
    for (const row of input.statement.rows) {
      const matchedRule = rules.find(rule => {
        if (
          rule.ownerType &&
          rule.ownerType !== "both" &&
          rule.ownerType !== account.ownerType
        ) {
          return false;
        }
        const pattern = normalizeStatementDescription(rule.pattern);
        if (rule.matchType === "equals")
          return row.normalizedDescription === pattern;
        if (rule.matchType === "starts_with")
          return row.normalizedDescription.startsWith(pattern);
        return row.normalizedDescription.includes(pattern);
      });
      const rowHash = createSantanderRowHash(scope.tenantId, account.id, row);
      const [created] = await tx
        .insert(financialTransactions)
        .values({
          ...scope,
          accountId: account.id,
          type: row.amountCents >= 0 ? "income" : "expense",
          status: "confirmed",
          amountCents: Math.abs(row.amountCents),
          occurredAt: row.occurredAt,
          description: row.description,
          normalizedDescription: row.normalizedDescription,
          documentNumber: row.documentNumber,
          balanceAfterCents: row.balanceAfterCents,
          categoryId: matchedRule?.categoryId ?? null,
          source: "import",
          externalId: rowHash,
          importId: statementImport.id,
          confidence: matchedRule ? 90 : null,
          needsReview: !matchedRule,
          idempotencyKey: `santander:${rowHash}`,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        importedCount += 1;
        if (created.needsReview) reviewCount += 1;
      } else {
        duplicateCount += 1;
      }
    }

    if (input.statement.totals.endingBalanceCents != null) {
      await tx
        .update(financialAccounts)
        .set({
          currentBalanceCents: input.statement.totals.endingBalanceCents,
          balanceAsOf: input.statement.rows[0]?.occurredAt ?? new Date(),
          institution: account.institution ?? "Santander",
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, account.id));
    }
    const [completedImport] = await tx
      .update(statementImports)
      .set({
        status: "completed",
        importedCount,
        duplicateCount,
        errorCount: 0,
        errorReport: null,
        updatedAt: new Date(),
      })
      .where(eq(statementImports.id, statementImport.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: "statement.imported",
      entityType: "statement_import",
      entityId: String(statementImport.id),
      after: {
        fileName: completedImport.fileName,
        rowCount: input.statement.rows.length,
        importedCount,
        duplicateCount,
        reviewCount,
        totals: input.statement.totals,
      },
      requestId: `statement:${input.statement.fileHash}`,
    });
    return {
      import: completedImport,
      importedCount,
      duplicateCount,
      reviewCount,
      totals: input.statement.totals,
      alreadyProcessed: false,
    };
  });
}

export async function listBudgetPeriods(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(budgetPeriods)
    .where(
      and(
        eq(budgetPeriods.tenantId, scope.tenantId),
        eq(budgetPeriods.userId, scope.userId)
      )
    )
    .orderBy(desc(budgetPeriods.periodStart));
}

export async function listBudgetEnvelopes(
  scope: FinancialScope,
  periodId?: number
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(budgetEnvelopes.tenantId, scope.tenantId),
    eq(budgetEnvelopes.userId, scope.userId),
  ];
  if (periodId != null)
    conditions.push(eq(budgetEnvelopes.budgetPeriodId, periodId));
  return db
    .select()
    .from(budgetEnvelopes)
    .where(and(...conditions))
    .orderBy(asc(budgetEnvelopes.priority), asc(budgetEnvelopes.name));
}

export async function listFinancialTasks(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialTasks)
    .where(
      and(
        eq(financialTasks.tenantId, scope.tenantId),
        eq(financialTasks.userId, scope.userId)
      )
    )
    .orderBy(asc(financialTasks.status), asc(financialTasks.priority));
}

export async function updateFinancialTask(
  scope: FinancialScope,
  taskId: number,
  data: Partial<{ status: string; dueAt: Date | null }>,
  actor: FinancialActor
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(financialTasks)
      .where(
        and(
          eq(financialTasks.id, taskId),
          eq(financialTasks.tenantId, scope.tenantId),
          eq(financialTasks.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Tarefa financeira nao encontrada");
    const [after] = await tx
      .update(financialTasks)
      .set({
        ...data,
        completedAt: data.status === "completed" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(financialTasks.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "task.updated",
      entityType: "financial_task",
      entityId: String(before.id),
      before,
      after,
    });
    return after;
  });
}

export async function listFinancialAuditEvents(
  scope: FinancialScope,
  limit = 100
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialAuditEvents)
    .where(
      and(
        eq(financialAuditEvents.tenantId, scope.tenantId),
        eq(financialAuditEvents.userId, scope.userId)
      )
    )
    .orderBy(desc(financialAuditEvents.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)));
}

export async function listBusinessHolidays(
  scope: FinancialScope,
  start: string,
  end: string
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(businessCalendarHolidays)
    .where(
      and(
        eq(businessCalendarHolidays.tenantId, scope.tenantId),
        eq(businessCalendarHolidays.userId, scope.userId),
        gte(businessCalendarHolidays.date, start),
        lte(businessCalendarHolidays.date, end)
      )
    )
    .orderBy(asc(businessCalendarHolidays.date));
}

export async function upsertBusinessHoliday(
  scope: FinancialScope,
  input: { date: string; name: string; holidayScope?: string; source?: string },
  actor: FinancialActor
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [holiday] = await tx
      .insert(businessCalendarHolidays)
      .values({
        ...scope,
        date: input.date,
        name: input.name.trim(),
        scope: input.holidayScope ?? "custom",
        source: input.source ?? "user",
      })
      .onConflictDoUpdate({
        target: [
          businessCalendarHolidays.tenantId,
          businessCalendarHolidays.userId,
          businessCalendarHolidays.date,
          businessCalendarHolidays.scope,
        ],
        set: { name: input.name.trim(), source: input.source ?? "user" },
      })
      .returning();
    const [year, month] = input.date.split("-").map(Number);
    const monthStart = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const calendar = await tx
      .select({ date: businessCalendarHolidays.date })
      .from(businessCalendarHolidays)
      .where(
        and(
          eq(businessCalendarHolidays.tenantId, scope.tenantId),
          eq(businessCalendarHolidays.userId, scope.userId),
          gte(businessCalendarHolidays.date, monthStart),
          lte(businessCalendarHolidays.date, monthEnd)
        )
      );
    const recalculatedFifthBusinessDay = getNthBusinessDay(
      year,
      month,
      5,
      calendar.map(item => item.date)
    );
    await tx
      .update(recurringCashflows)
      .set({
        nextDueDate: recalculatedFifthBusinessDay,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recurringCashflows.tenantId, scope.tenantId),
          eq(recurringCashflows.userId, scope.userId),
          eq(
            recurringCashflows.seedKey,
            "income-complement-fifth-business-day"
          ),
          gte(recurringCashflows.nextDueDate, monthStart),
          lte(recurringCashflows.nextDueDate, monthEnd)
        )
      );
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "business_holiday.upserted",
      entityType: "business_calendar_holiday",
      entityId: String(holiday.id),
      after: { holiday, recalculatedFifthBusinessDay },
    });
    return holiday;
  });
}

export async function pauseFinancialNotifications(
  scope: FinancialScope,
  until: Date | null,
  actor: FinancialActor
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
    const [after] = await tx
      .update(financialProfiles)
      .set({ notificationsPausedUntil: until, updatedAt: new Date() })
      .where(eq(financialProfiles.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: until ? "notifications.paused" : "notifications.resumed",
      entityType: "financial_profile",
      entityId: String(before.id),
      before: { notificationsPausedUntil: before.notificationsPausedUntil },
      after: { notificationsPausedUntil: until },
    });
    return after;
  });
}

export async function setFinancialNotificationOptIn(
  scope: FinancialScope,
  enabled: boolean,
  actor: FinancialActor
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
    if (!before) {
      const [created] = await tx
        .insert(financialProfiles)
        .values({
          ...scope,
          displayName: "Cliente",
          profileKey: "custom",
          notificationsOptIn: enabled,
        })
        .returning();
      await tx.insert(financialAuditEvents).values({
        ...scope,
        actorType: actor.type,
        actorId: actor.id ?? null,
        action: enabled ? "notifications.opted_in" : "notifications.opted_out",
        entityType: "financial_profile",
        entityId: String(created.id),
        after: { notificationsOptIn: enabled },
      });
      return created;
    }
    const [after] = await tx
      .update(financialProfiles)
      .set({
        notificationsOptIn: enabled,
        notificationsPausedUntil: enabled
          ? null
          : before.notificationsPausedUntil,
        updatedAt: new Date(),
      })
      .where(eq(financialProfiles.id, before.id))
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: enabled ? "notifications.opted_in" : "notifications.opted_out",
      entityType: "financial_profile",
      entityId: String(before.id),
      before: { notificationsOptIn: before.notificationsOptIn },
      after: { notificationsOptIn: enabled },
    });
    return after;
  });
}

export async function scheduleNotificationIdempotently(
  scope: FinancialScope,
  input: {
    templateKey: string;
    scheduledAt: Date;
    idempotencyKey: string;
    payload?: Record<string, unknown> | null;
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db
    .insert(scheduledNotifications)
    .values({
      ...scope,
      templateKey: input.templateKey,
      scheduledAt: input.scheduledAt,
      nextAttemptAt: input.scheduledAt,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? null,
      status: "scheduled",
    })
    .onConflictDoNothing()
    .returning();
  if (created) return { notification: created, alreadyScheduled: false };
  const [existing] = await db
    .select()
    .from(scheduledNotifications)
    .where(
      and(
        eq(scheduledNotifications.tenantId, scope.tenantId),
        eq(scheduledNotifications.userId, scope.userId),
        eq(scheduledNotifications.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  return { notification: existing, alreadyScheduled: true };
}

export async function createFinancialReminder(
  scope: FinancialScope,
  input: {
    title: string;
    dueAt: Date;
    recurrenceRule?: string | null;
    idempotencyKey: string;
  },
  actor: FinancialActor
) {
  assertScope(scope);
  const title = input.title.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!title) throw new Error("Titulo do lembrete obrigatorio");
  if (!idempotencyKey) throw new Error("Chave idempotente obrigatoria");
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("Data invalida");
  const result = await scheduleNotificationIdempotently(scope, {
    templateKey: "custom_reminder",
    scheduledAt: input.dueAt,
    idempotencyKey,
    payload: {
      text: `Lembrete: ${title}`,
      title,
      recurrenceRule: input.recurrenceRule?.trim() || null,
      rootIdempotencyKey: idempotencyKey,
    },
  });
  if (!result.alreadyScheduled && result.notification) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .insert(financialAuditEvents)
      .values({
        ...scope,
        actorType: actor.type,
        actorId: actor.id ?? null,
        action: "reminder.created",
        entityType: "scheduled_notification",
        entityId: String(result.notification.id),
        after: {
          title,
          dueAt: input.dueAt.toISOString(),
          recurrenceRule: input.recurrenceRule ?? null,
        },
        requestId: idempotencyKey,
      })
      .onConflictDoNothing();
  }
  return result;
}

export async function listDueScheduledNotifications(now: Date, limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(scheduledNotifications)
    .where(
      and(
        or(
          eq(scheduledNotifications.status, "scheduled"),
          eq(scheduledNotifications.status, "failed")
        ),
        lte(scheduledNotifications.scheduledAt, now),
        lte(scheduledNotifications.nextAttemptAt, now)
      )
    )
    .orderBy(asc(scheduledNotifications.nextAttemptAt))
    .limit(Math.max(1, Math.min(limit, 200)));
}

export async function claimScheduledNotification(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [claimed] = await db
    .update(scheduledNotifications)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(scheduledNotifications.id, notificationId),
        or(
          eq(scheduledNotifications.status, "scheduled"),
          eq(scheduledNotifications.status, "failed")
        )
      )
    )
    .returning();
  return claimed;
}

export async function markScheduledNotificationSent(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [sent] = await db
    .update(scheduledNotifications)
    .set({
      status: "sent",
      sentAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(scheduledNotifications.id, notificationId))
    .returning();
  return sent;
}

export async function deferScheduledNotification(
  notificationId: number,
  nextAttemptAt: Date
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [deferred] = await db
    .update(scheduledNotifications)
    .set({ status: "scheduled", nextAttemptAt, updatedAt: new Date() })
    .where(eq(scheduledNotifications.id, notificationId))
    .returning();
  return deferred;
}

export async function markScheduledNotificationFailed(
  notificationId: number,
  attempts: number,
  error: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const boundedAttempts = Math.max(1, attempts);
  const nextAttemptAt = new Date(
    Date.now() + Math.min(24 * 60, 2 ** boundedAttempts * 5) * 60_000
  );
  const [failed] = await db
    .update(scheduledNotifications)
    .set({
      status: boundedAttempts >= 8 ? "dead_letter" : "failed",
      attempts: boundedAttempts,
      nextAttemptAt,
      lastError: error.slice(0, 2_000),
      updatedAt: new Date(),
    })
    .where(eq(scheduledNotifications.id, notificationId))
    .returning();
  return failed;
}

export async function getStatementImportByHash(
  scope: FinancialScope,
  accountId: number,
  fileHash: string
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [record] = await db
    .select()
    .from(statementImports)
    .where(
      and(
        eq(statementImports.tenantId, scope.tenantId),
        eq(statementImports.userId, scope.userId),
        eq(statementImports.accountId, accountId),
        eq(statementImports.fileHash, fileHash)
      )
    )
    .limit(1);
  return record;
}

export async function listUncategorizedTransactions(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(financialTransactions)
    .where(
      and(
        eq(financialTransactions.tenantId, scope.tenantId),
        eq(financialTransactions.userId, scope.userId),
        isNull(financialTransactions.categoryId),
        eq(financialTransactions.needsReview, true)
      )
    )
    .orderBy(desc(financialTransactions.occurredAt));
}

export async function recordPrivacyConsent(
  scope: FinancialScope,
  input: {
    purpose: string;
    legalBasis: string;
    policyVersion: string;
    accepted: boolean;
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const [consent] = await db
    .insert(privacyConsents)
    .values({
      ...scope,
      purpose: input.purpose.trim(),
      legalBasis: input.legalBasis.trim(),
      policyVersion: input.policyVersion.trim(),
      acceptedAt: now,
      revokedAt: input.accepted ? null : now,
    })
    .onConflictDoUpdate({
      target: [
        privacyConsents.tenantId,
        privacyConsents.userId,
        privacyConsents.purpose,
        privacyConsents.policyVersion,
      ],
      set: {
        legalBasis: input.legalBasis.trim(),
        revokedAt: input.accepted ? null : now,
      },
    })
    .returning();
  return consent;
}

export async function createDataSubjectRequest(
  scope: FinancialScope,
  type: "export" | "deletion",
  metadata: Record<string, unknown> | null,
  actor: FinancialActor
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [request] = await tx
      .insert(dataSubjectRequests)
      .values({ ...scope, type, status: "requested", metadata })
      .returning();
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: `privacy.${type}_requested`,
      entityType: "data_subject_request",
      entityId: String(request.id),
      after: { type, status: request.status },
    });
    return request;
  });
}

export async function exportCanonicalFinancialData(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const whereScope = <T extends { tenantId: AnyPgColumn; userId: AnyPgColumn }>(
    table: T
  ) => and(eq(table.tenantId, scope.tenantId), eq(table.userId, scope.userId));
  const [
    profiles,
    accounts,
    categories,
    transactions,
    rules,
    periods,
    envelopes,
    recurring,
    goals,
    goalItems,
    debts,
    projects,
    installments,
    activities,
    allocations,
    tasks,
    notifications,
    imports,
    holidays,
    consents,
    requests,
    audit,
  ] = await Promise.all([
    db.select().from(financialProfiles).where(whereScope(financialProfiles)),
    db.select().from(financialAccounts).where(whereScope(financialAccounts)),
    db
      .select()
      .from(financialCategories)
      .where(whereScope(financialCategories)),
    db
      .select()
      .from(financialTransactions)
      .where(whereScope(financialTransactions)),
    db
      .select()
      .from(financialTransactionRules)
      .where(whereScope(financialTransactionRules)),
    db.select().from(budgetPeriods).where(whereScope(budgetPeriods)),
    db.select().from(budgetEnvelopes).where(whereScope(budgetEnvelopes)),
    db.select().from(recurringCashflows).where(whereScope(recurringCashflows)),
    db.select().from(financialGoals).where(whereScope(financialGoals)),
    db.select().from(financialGoalItems).where(whereScope(financialGoalItems)),
    db.select().from(financialDebts).where(whereScope(financialDebts)),
    db.select().from(financialProjects).where(whereScope(financialProjects)),
    db
      .select()
      .from(projectInstallments)
      .where(whereScope(projectInstallments)),
    db.select().from(projectActivities).where(whereScope(projectActivities)),
    db.select().from(incomeAllocations).where(whereScope(incomeAllocations)),
    db.select().from(financialTasks).where(whereScope(financialTasks)),
    db
      .select()
      .from(scheduledNotifications)
      .where(whereScope(scheduledNotifications)),
    db.select().from(statementImports).where(whereScope(statementImports)),
    db
      .select()
      .from(businessCalendarHolidays)
      .where(whereScope(businessCalendarHolidays)),
    db.select().from(privacyConsents).where(whereScope(privacyConsents)),
    db
      .select()
      .from(dataSubjectRequests)
      .where(whereScope(dataSubjectRequests)),
    db
      .select()
      .from(financialAuditEvents)
      .where(whereScope(financialAuditEvents)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    tenantId: scope.tenantId,
    userId: scope.userId,
    data: {
      profiles,
      accounts,
      categories,
      transactions,
      rules,
      budgetPeriods: periods,
      budgetEnvelopes: envelopes,
      recurringCashflows: recurring,
      goals,
      goalItems,
      debts,
      projects,
      projectInstallments: installments,
      projectActivities: activities,
      incomeAllocations: allocations,
      tasks,
      scheduledNotifications: notifications,
      statementImports: imports,
      businessHolidays: holidays,
      privacyConsents: consents,
      dataSubjectRequests: requests,
      auditEvents: audit,
    },
  };
}
