import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  budgetEnvelopes,
  budgetPeriods,
  financialAccounts,
  financialActions,
  financialAuditEvents,
  financialCategories,
  financialDebts,
  financialItems,
  financialSettlements,
  financialTransactions,
  installmentPlans,
  recurrenceRules,
  type FinancialAction,
  type FinancialItem,
  type InsertFinancialAccount,
  type InsertFinancialItem,
  type InsertRecurrenceRule,
} from "../../drizzle/schema";
import {
  assertNonNegativeCents,
  formatBRLCents,
  getNthBusinessDay,
} from "../../shared/financial-core";
import { getDb } from "../db";
import type { FinancialActor, FinancialScope } from "./financial-core";

export type FinancialItemKind = "payable" | "receivable";
export type FinancialItemScope =
  | "THIS_OCCURRENCE"
  | "THIS_AND_FUTURE"
  | "ALL_OCCURRENCES";

export type FinancialWriteResult = {
  success: true;
  action_id: string;
  entity_type: string;
  entity_id: string;
  operation: "created" | "updated" | "settled" | "cancelled" | "reversed";
  human_summary: string;
  financial_impact: {
    confirmed_balance_delta_cents: number;
    projected_balance_delta_cents: number;
    free_balance_delta_cents: number;
  };
  warnings: string[];
  undo_available_until: string | null;
  external_bank_movement: false;
};

type WriteContext = {
  actor: FinancialActor;
  idempotencyKey: string;
  conversationId?: string | null;
  messageId?: string | null;
};

const PAYABLE_OPEN_STATUSES = [
  "draft",
  "scheduled",
  "pending",
  "partially_paid",
  "overdue",
];
const RECEIVABLE_OPEN_STATUSES = [
  "draft",
  "expected",
  "pending",
  "partially_received",
  "overdue",
];

function assertScope(scope: FinancialScope) {
  if (!Number.isInteger(scope.tenantId) || scope.tenantId <= 0)
    throw new Error("Tenant invalido");
  if (!Number.isInteger(scope.userId) || scope.userId <= 0)
    throw new Error("Usuario invalido");
}

function requireIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 255)
    throw new Error("Chave idempotente invalida");
  return normalized;
}

function normalizeDescription(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Descricao obrigatoria");
  return normalized;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(iso: string, months: number, requestedDay?: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  const day = requestedDay ?? date.getUTCDate();
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth()
  );
}

function recurrenceMatches(
  rule: {
    frequency: string;
    interval: number;
    startDate: string;
    byMonthDay: number | null;
    businessDayOrdinal: number | null;
    byWeekday: unknown;
  },
  candidate: string,
  holidays: Iterable<string>
) {
  const start = new Date(`${rule.startDate}T12:00:00.000Z`);
  const date = new Date(`${candidate}T12:00:00.000Z`);
  if (date < start) return false;
  const dayDiff = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  const interval = Math.max(1, rule.interval);
  if (rule.frequency === "daily") return dayDiff % interval === 0;
  if (rule.frequency === "weekly") {
    const weekDiff = Math.floor(dayDiff / 7);
    const weekdays = Array.isArray(rule.byWeekday)
      ? rule.byWeekday.filter(value => Number.isInteger(value)).map(Number)
      : [start.getUTCDay()];
    return weekDiff % interval === 0 && weekdays.includes(date.getUTCDay());
  }
  if (rule.frequency === "business_day_rule") {
    const ordinal = rule.businessDayOrdinal ?? 5;
    return (
      candidate ===
      getNthBusinessDay(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        ordinal,
        holidays
      )
    );
  }
  if (rule.frequency === "yearly") {
    const yearDiff = date.getUTCFullYear() - start.getUTCFullYear();
    return (
      yearDiff % interval === 0 &&
      date.getUTCMonth() === start.getUTCMonth() &&
      candidate === addMonthsClamped(rule.startDate, yearDiff * 12)
    );
  }
  const monthDiff = monthsBetween(rule.startDate, candidate);
  if (monthDiff < 0 || monthDiff % interval !== 0) return false;
  const requestedDay = rule.byMonthDay ?? start.getUTCDate();
  return (
    candidate === addMonthsClamped(rule.startDate, monthDiff, requestedDay)
  );
}

export function recurrenceDatesInWindow(
  rule: {
    frequency: string;
    interval: number;
    startDate: string;
    endDate?: string | null;
    byMonthDay: number | null;
    businessDayOrdinal: number | null;
    byWeekday: unknown;
  },
  windowStart: string,
  windowEnd: string,
  holidays: Iterable<string> = []
) {
  const start = windowStart < rule.startDate ? rule.startDate : windowStart;
  const end =
    rule.endDate && rule.endDate < windowEnd ? rule.endDate : windowEnd;
  if (start > end) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (recurrenceMatches(rule, cursor, holidays)) dates.push(cursor);
  }
  return dates;
}

function createWriteResult(input: {
  actionId: number;
  entityType: string;
  entityId: string | number;
  operation: FinancialWriteResult["operation"];
  summary: string;
  confirmedDelta?: number;
  projectedDelta?: number;
  freeDelta?: number;
  warnings?: string[];
  reversibleUntil?: Date | null;
}): FinancialWriteResult {
  return {
    success: true,
    action_id: String(input.actionId),
    entity_type: input.entityType,
    entity_id: String(input.entityId),
    operation: input.operation,
    human_summary: input.summary,
    financial_impact: {
      confirmed_balance_delta_cents: input.confirmedDelta ?? 0,
      projected_balance_delta_cents: input.projectedDelta ?? 0,
      free_balance_delta_cents: input.freeDelta ?? 0,
    },
    warnings: input.warnings ?? [],
    undo_available_until: input.reversibleUntil?.toISOString() ?? null,
    external_bank_movement: false,
  };
}

async function existingActionResult(
  scope: FinancialScope,
  idempotencyKey: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [action] = await db
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
  return action?.resultSnapshot as FinancialWriteResult | undefined;
}

function openStatuses(kind: FinancialItemKind) {
  return kind === "payable" ? PAYABLE_OPEN_STATUSES : RECEIVABLE_OPEN_STATUSES;
}

function initialItemStatus(kind: FinancialItemKind, draft = false) {
  if (draft) return "draft";
  return kind === "payable" ? "pending" : "expected";
}

export async function listFinancialItemsV3(
  scope: FinancialScope,
  input: {
    kind?: FinancialItemKind;
    status?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const filters = [
    eq(financialItems.tenantId, scope.tenantId),
    eq(financialItems.userId, scope.userId),
  ];
  if (input.kind) filters.push(eq(financialItems.kind, input.kind));
  if (input.status) filters.push(eq(financialItems.status, input.status));
  if (input.startDate)
    filters.push(gte(financialItems.dueDate, input.startDate));
  if (input.endDate) filters.push(lte(financialItems.dueDate, input.endDate));
  return db
    .select()
    .from(financialItems)
    .where(and(...filters))
    .orderBy(asc(financialItems.dueDate), asc(financialItems.id))
    .limit(Math.max(1, Math.min(input.limit ?? 200, 500)));
}

export async function getRegistrationContextV3(scope: FinancialScope) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [accounts, items, actions, rules] = await Promise.all([
    db
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true)
        )
      )
      .orderBy(asc(financialAccounts.ownerType), asc(financialAccounts.name)),
    listFinancialItemsV3(scope, { limit: 100 }),
    db
      .select()
      .from(financialActions)
      .where(
        and(
          eq(financialActions.tenantId, scope.tenantId),
          eq(financialActions.userId, scope.userId)
        )
      )
      .orderBy(desc(financialActions.createdAt))
      .limit(20),
    db
      .select()
      .from(recurrenceRules)
      .where(
        and(
          eq(recurrenceRules.tenantId, scope.tenantId),
          eq(recurrenceRules.userId, scope.userId),
          eq(recurrenceRules.status, "active")
        )
      )
      .orderBy(asc(recurrenceRules.description)),
  ]);
  return {
    accounts,
    open_payables: items.filter(
      item =>
        item.kind === "payable" && openStatuses("payable").includes(item.status)
    ),
    open_receivables: items.filter(
      item =>
        item.kind === "receivable" &&
        openStatuses("receivable").includes(item.status)
    ),
    recurrence_rules: rules,
    recent_actions: actions,
    defaults: {
      currency: "BRL",
      timezone: "America/Sao_Paulo",
      owner_type: "personal",
    },
  };
}

export async function createFinancialAccountV3(
  scope: FinancialScope,
  input: {
    name: string;
    code?: string | null;
    ownerType: "personal" | "business";
    accountType:
      | "checking"
      | "savings"
      | "reserve"
      | "credit_card"
      | "cash"
      | "investment"
      | "goal_wallet"
      | "other";
    institution?: string | null;
    currency?: string;
    initialBalanceCents?: number | null;
    balanceAsOf?: Date | null;
    includeInOperatingCash?: boolean;
    protected?: boolean;
    needsConfirmation?: boolean;
    closingDay?: number | null;
    dueDay?: number | null;
    creditLimitCents?: number | null;
    paymentAccountId?: number | null;
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const initialBalanceCents = input.initialBalanceCents ?? 0;
  if (!Number.isSafeInteger(initialBalanceCents))
    throw new Error("Saldo inicial deve ser inteiro em centavos");
  if (input.creditLimitCents != null)
    assertNonNegativeCents(input.creditLimitCents, "creditLimitCents");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    if (input.paymentAccountId != null) {
      const [paymentAccount] = await tx
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, input.paymentAccountId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId),
            eq(financialAccounts.active, true)
          )
        )
        .limit(1);
      if (!paymentAccount) throw new Error("Conta de pagamento nao encontrada");
    }
    const values: InsertFinancialAccount = {
      ...scope,
      name: normalizeDescription(input.name),
      code: input.code?.trim() || null,
      ownerType: input.ownerType,
      accountType: input.accountType,
      institution: input.institution?.trim() || null,
      currency: input.currency ?? "BRL",
      currentBalanceCents: initialBalanceCents,
      balanceAsOf: input.balanceAsOf ?? null,
      includeInOperatingCash:
        input.includeInOperatingCash ??
        !["reserve", "investment", "goal_wallet", "credit_card"].includes(
          input.accountType
        ),
      protected: input.protected ?? input.accountType === "reserve",
      needsConfirmation: input.needsConfirmation ?? input.balanceAsOf == null,
      closingDay: input.closingDay ?? null,
      dueDay: input.dueDay ?? null,
      creditLimitCents: input.creditLimitCents ?? null,
      paymentAccountId: input.paymentAccountId ?? null,
      active: true,
      seedKey: null,
    };
    const [account] = await tx
      .insert(financialAccounts)
      .values(values)
      .returning();
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "account.create",
        entityType: "financial_account",
        entityId: String(account.id),
        beforeSnapshot: null,
        afterSnapshot: account,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_account",
      entityId: account.id,
      operation: "created",
      summary: `${account.name} cadastrada com saldo inicial de ${formatBRLCents(initialBalanceCents)}.`,
      reversibleUntil,
      warnings:
        account.balanceAsOf == null
          ? ["O saldo inicial ainda precisa ser confirmado."]
          : [],
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "account.created",
      entityType: "financial_account",
      entityId: String(account.id),
      after: account,
      requestId: idempotencyKey,
    });
    return { account, result, alreadyProcessed: false };
  });
}

export async function updateFinancialAccountV3(
  scope: FinancialScope,
  input: {
    accountId: number;
    patch: {
      name?: string;
      code?: string | null;
      institution?: string | null;
      includeInOperatingCash?: boolean;
      protected?: boolean;
      needsConfirmation?: boolean;
      closingDay?: number | null;
      dueDay?: number | null;
      creditLimitCents?: number | null;
      paymentAccountId?: number | null;
    };
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  if (Object.keys(input.patch).length === 0)
    throw new Error("Informe ao menos um campo para atualizar");
  if (input.patch.creditLimitCents != null)
    assertNonNegativeCents(input.patch.creditLimitCents, "creditLimitCents");
  for (const day of [input.patch.closingDay, input.patch.dueDay]) {
    if (day != null && (!Number.isInteger(day) || day < 1 || day > 31))
      throw new Error("Dia de fechamento ou vencimento invalido");
  }
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
      .limit(1)
      .for("update");
    if (!before) throw new Error("Conta financeira nao encontrada");
    if (input.patch.paymentAccountId === before.id)
      throw new Error("Conta de pagamento nao pode ser a propria conta");
    if (input.patch.paymentAccountId != null) {
      const [paymentAccount] = await tx
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, input.patch.paymentAccountId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId),
            eq(financialAccounts.active, true)
          )
        )
        .limit(1);
      if (!paymentAccount) throw new Error("Conta de pagamento nao encontrada");
    }
    const [account] = await tx
      .update(financialAccounts)
      .set({
        ...(input.patch.name !== undefined
          ? { name: normalizeDescription(input.patch.name) }
          : {}),
        ...(input.patch.code !== undefined
          ? { code: input.patch.code?.trim() || null }
          : {}),
        ...(input.patch.institution !== undefined
          ? { institution: input.patch.institution?.trim() || null }
          : {}),
        ...(input.patch.includeInOperatingCash !== undefined
          ? { includeInOperatingCash: input.patch.includeInOperatingCash }
          : {}),
        ...(input.patch.protected !== undefined
          ? { protected: input.patch.protected }
          : {}),
        ...(input.patch.needsConfirmation !== undefined
          ? { needsConfirmation: input.patch.needsConfirmation }
          : {}),
        ...(input.patch.closingDay !== undefined
          ? { closingDay: input.patch.closingDay }
          : {}),
        ...(input.patch.dueDay !== undefined
          ? { dueDay: input.patch.dueDay }
          : {}),
        ...(input.patch.creditLimitCents !== undefined
          ? { creditLimitCents: input.patch.creditLimitCents }
          : {}),
        ...(input.patch.paymentAccountId !== undefined
          ? { paymentAccountId: input.patch.paymentAccountId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(financialAccounts.id, before.id))
      .returning();
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "account.update",
        entityType: "financial_account",
        entityId: String(account.id),
        beforeSnapshot: before,
        afterSnapshot: account,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_account",
      entityId: account.id,
      operation: "updated",
      summary: `${account.name} atualizada.`,
      reversibleUntil,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "account.updated",
      entityType: "financial_account",
      entityId: String(account.id),
      before,
      after: account,
      requestId: idempotencyKey,
    });
    return { account, result, alreadyProcessed: false };
  });
}

export async function archiveFinancialAccountV3(
  scope: FinancialScope,
  input: {
    accountId: number;
    reason: string;
    confirmation: "CONFIRMO ARQUIVAMENTO DA CONTA";
  },
  context: WriteContext
) {
  assertScope(scope);
  if (input.confirmation !== "CONFIRMO ARQUIVAMENTO DA CONTA")
    throw new Error("Confirmacao explicita obrigatoria");
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
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
      .limit(1)
      .for("update");
    if (!before) throw new Error("Conta financeira nao encontrada");
    const [{ count: openItems }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(financialItems)
      .where(
        and(
          eq(financialItems.tenantId, scope.tenantId),
          eq(financialItems.userId, scope.userId),
          eq(financialItems.expectedAccountId, before.id),
          inArray(financialItems.status, [
            ...PAYABLE_OPEN_STATUSES,
            ...RECEIVABLE_OPEN_STATUSES,
          ])
        )
      );
    if (openItems > 0)
      throw new Error(
        "Reatribua ou cancele os itens abertos antes de arquivar a conta"
      );
    const [account] = await tx
      .update(financialAccounts)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(financialAccounts.id, before.id))
      .returning();
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "account.archive",
        entityType: "financial_account",
        entityId: String(account.id),
        beforeSnapshot: before,
        afterSnapshot: account,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_account",
      entityId: account.id,
      operation: "cancelled",
      summary: `${account.name} arquivada: ${normalizeDescription(input.reason)}.`,
      reversibleUntil,
      warnings:
        account.currentBalanceCents === 0
          ? []
          : [
              `O ultimo saldo registrado, ${formatBRLCents(account.currentBalanceCents)}, foi preservado no historico.`,
            ],
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "account.archived",
      entityType: "financial_account",
      entityId: String(account.id),
      before,
      after: account,
      requestId: idempotencyKey,
    });
    return { account, result, alreadyProcessed: false };
  });
}

export async function createFinancialItemV3(
  scope: FinancialScope,
  input: {
    kind: FinancialItemKind;
    origin?:
      | "manual"
      | "whatsapp"
      | "web"
      | "import"
      | "project"
      | "card_invoice";
    ownerType: "personal" | "business";
    amountCents: number;
    description: string;
    counterparty?: string | null;
    categoryId?: number | null;
    expectedAccountId?: number | null;
    dueDate: string;
    competenceDate?: string;
    status?: string;
    draft?: boolean;
    estimated?: boolean;
    needsConfirmation?: boolean;
    sourceMessageId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  context: WriteContext
) {
  assertScope(scope);
  assertNonNegativeCents(input.amountCents, "amountCents");
  if (input.amountCents === 0) throw new Error("Valor deve ser maior que zero");
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    if (input.expectedAccountId != null) {
      const [account] = await tx
        .select({
          id: financialAccounts.id,
          ownerType: financialAccounts.ownerType,
        })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, input.expectedAccountId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId),
            eq(financialAccounts.active, true)
          )
        )
        .limit(1);
      if (!account) throw new Error("Conta financeira nao encontrada");
      if (account.ownerType !== input.ownerType)
        throw new Error("A conta nao pertence ao dominio PF/PJ informado");
    }
    if (input.categoryId != null) {
      const [category] = await tx
        .select({ id: financialCategories.id })
        .from(financialCategories)
        .where(
          and(
            eq(financialCategories.id, input.categoryId),
            eq(financialCategories.tenantId, scope.tenantId),
            eq(financialCategories.userId, scope.userId),
            eq(financialCategories.active, true)
          )
        )
        .limit(1);
      if (!category) throw new Error("Categoria financeira nao encontrada");
    }
    const values: InsertFinancialItem = {
      ...scope,
      kind: input.kind,
      origin: input.origin ?? "whatsapp",
      ownerType: input.ownerType,
      status:
        input.status ?? initialItemStatus(input.kind, input.draft ?? false),
      amountCents: input.amountCents,
      openAmountCents: input.amountCents,
      description: normalizeDescription(input.description),
      counterparty: input.counterparty?.trim() || null,
      categoryId: input.categoryId ?? null,
      expectedAccountId: input.expectedAccountId ?? null,
      dueDate: input.dueDate,
      competenceDate: input.competenceDate ?? input.dueDate,
      recurrenceId: null,
      installmentPlanId: null,
      installmentNumber: null,
      parentItemId: null,
      sourceMessageId: input.sourceMessageId ?? context.messageId ?? null,
      idempotencyKey,
      estimated: input.estimated ?? false,
      needsConfirmation: input.needsConfirmation ?? false,
      metadata: input.metadata ?? null,
    };
    const [item] = await tx.insert(financialItems).values(values).returning();
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "item.create",
        entityType: "financial_item",
        entityId: String(item.id),
        beforeSnapshot: null,
        afterSnapshot: item,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const projectedDelta =
      item.kind === "payable" ? -item.amountCents : item.amountCents;
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_item",
      entityId: item.id,
      operation: "created",
      summary: `${item.kind === "payable" ? "Conta a pagar" : "Conta a receber"} de ${formatBRLCents(item.amountCents)} cadastrada para ${item.dueDate}.`,
      projectedDelta,
      freeDelta: item.kind === "payable" ? -item.amountCents : 0,
      reversibleUntil,
      warnings: item.needsConfirmation
        ? ["Valor ou data ainda precisa de confirmacao."]
        : [],
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "financial_item.created",
      entityType: "financial_item",
      entityId: String(item.id),
      after: item,
      requestId: idempotencyKey,
    });
    return { item, result, alreadyProcessed: false };
  });
}

async function insertOccurrences(
  tx: any,
  scope: FinancialScope,
  rule: typeof recurrenceRules.$inferSelect,
  dates: string[]
) {
  const created: FinancialItem[] = [];
  for (const dueDate of dates) {
    const [item] = await tx
      .insert(financialItems)
      .values({
        ...scope,
        kind: rule.itemKind,
        origin: "recurrence",
        ownerType: rule.ownerType,
        status: initialItemStatus(rule.itemKind as FinancialItemKind),
        amountCents: rule.baseAmountCents,
        openAmountCents: rule.baseAmountCents,
        description: rule.description,
        categoryId: rule.categoryId,
        expectedAccountId: rule.expectedAccountId,
        dueDate,
        competenceDate: dueDate,
        recurrenceId: rule.id,
        idempotencyKey: `recurrence:${rule.id}:${dueDate}`,
        estimated: rule.amountMode !== "fixed",
        needsConfirmation: rule.amountMode !== "fixed",
        metadata: { recurrenceVersion: rule.updatedAt.toISOString() },
      })
      .onConflictDoNothing()
      .returning();
    if (item) created.push(item);
  }
  return created;
}

async function validateOperationalReferences(
  tx: any,
  scope: FinancialScope,
  input: {
    ownerType: "personal" | "business";
    accountIds?: Array<number | null | undefined>;
    categoryId?: number | null;
  }
) {
  const accountIds = Array.from(
    new Set(
      (input.accountIds ?? []).filter((value): value is number => value != null)
    )
  );
  if (accountIds.length > 0) {
    const accounts = await tx
      .select({
        id: financialAccounts.id,
        ownerType: financialAccounts.ownerType,
      })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          eq(financialAccounts.active, true),
          inArray(financialAccounts.id, accountIds)
        )
      );
    if (accounts.length !== accountIds.length)
      throw new Error("Conta financeira nao encontrada");
    if (
      accounts.some(
        (account: { ownerType: string }) =>
          account.ownerType !== input.ownerType
      )
    )
      throw new Error("A conta nao pertence ao dominio PF/PJ informado");
  }
  if (input.categoryId != null) {
    const [category] = await tx
      .select({ id: financialCategories.id })
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.id, input.categoryId),
          eq(financialCategories.tenantId, scope.tenantId),
          eq(financialCategories.userId, scope.userId),
          eq(financialCategories.active, true)
        )
      )
      .limit(1);
    if (!category) throw new Error("Categoria financeira nao encontrada");
  }
}

export async function createRecurrenceV3(
  scope: FinancialScope,
  input: {
    itemKind: FinancialItemKind;
    ownerType: "personal" | "business";
    description: string;
    frequency: "daily" | "weekly" | "monthly" | "yearly" | "business_day_rule";
    interval?: number;
    byWeekday?: number[] | null;
    byMonthDay?: number | null;
    businessDayOrdinal?: number | null;
    startDate: string;
    endDate?: string | null;
    timezone?: string;
    amountMode?: "fixed" | "estimated" | "variable";
    baseAmountCents: number;
    expectedAccountId?: number | null;
    categoryId?: number | null;
    sourceMessageId?: string | null;
    metadata?: Record<string, unknown> | null;
    generationWindowDays?: number;
  },
  context: WriteContext
) {
  assertScope(scope);
  assertNonNegativeCents(input.baseAmountCents, "baseAmountCents");
  if (input.baseAmountCents === 0)
    throw new Error("Valor deve ser maior que zero");
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const interval = input.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365)
    throw new Error("Intervalo de recorrencia invalido");
  if (
    input.frequency === "monthly" &&
    (input.byMonthDay == null || input.byMonthDay < 1 || input.byMonthDay > 31)
  )
    throw new Error("Informe o dia do mes entre 1 e 31");
  if (
    input.frequency === "business_day_rule" &&
    (input.businessDayOrdinal == null ||
      input.businessDayOrdinal < 1 ||
      input.businessDayOrdinal > 31)
  )
    throw new Error("Informe o ordinal do dia util");
  const windowDays = Math.max(
    1,
    Math.min(input.generationWindowDays ?? 90, 370)
  );
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await validateOperationalReferences(tx, scope, {
      ownerType: input.ownerType,
      accountIds: [input.expectedAccountId],
      categoryId: input.categoryId,
    });
    const values: InsertRecurrenceRule = {
      ...scope,
      itemKind: input.itemKind,
      ownerType: input.ownerType,
      description: normalizeDescription(input.description),
      frequency: input.frequency,
      interval,
      byWeekday: input.byWeekday ?? null,
      byMonthDay: input.byMonthDay ?? null,
      businessDayOrdinal: input.businessDayOrdinal ?? null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      timezone: input.timezone ?? "America/Sao_Paulo",
      amountMode: input.amountMode ?? "fixed",
      baseAmountCents: input.baseAmountCents,
      expectedAccountId: input.expectedAccountId ?? null,
      categoryId: input.categoryId ?? null,
      nextGenerationAt: new Date(),
      status: "active",
      sourceMessageId: input.sourceMessageId ?? context.messageId ?? null,
      idempotencyKey,
      metadata: input.metadata ?? null,
    };
    const [rule] = await tx.insert(recurrenceRules).values(values).returning();
    const dates = recurrenceDatesInWindow(
      rule,
      rule.startDate,
      addDays(rule.startDate, windowDays)
    );
    const occurrences = await insertOccurrences(tx, scope, rule, dates);
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "recurrence.create",
        entityType: "recurrence_rule",
        entityId: String(rule.id),
        beforeSnapshot: null,
        afterSnapshot: {
          rule,
          occurrenceIds: occurrences.map(item => item.id),
        },
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const projectedDelta = occurrences.reduce(
      (sum, item) =>
        sum + (item.kind === "payable" ? -item.amountCents : item.amountCents),
      0
    );
    const result = createWriteResult({
      actionId: action.id,
      entityType: "recurrence_rule",
      entityId: rule.id,
      operation: "created",
      summary: `${rule.description} cadastrada como recorrencia; ${occurrences.length} ocorrencia(s) gerada(s).`,
      projectedDelta,
      freeDelta:
        input.itemKind === "payable"
          ? -occurrences.reduce((sum, item) => sum + item.amountCents, 0)
          : 0,
      reversibleUntil,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "recurrence.created",
      entityType: "recurrence_rule",
      entityId: String(rule.id),
      after: { rule, occurrences: occurrences.length },
      requestId: idempotencyKey,
    });
    return { rule, occurrences, result, alreadyProcessed: false };
  });
}

function splitCents(totalCents: number, count: number) {
  assertNonNegativeCents(totalCents, "totalAmountCents");
  if (totalCents === 0) throw new Error("Valor deve ser maior que zero");
  if (!Number.isInteger(count) || count < 1 || count > 240)
    throw new Error("Quantidade de parcelas invalida");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0)
  );
}

export async function createInstallmentPlanV3(
  scope: FinancialScope,
  input: {
    description: string;
    planType?: "purchase" | "debt" | "income" | "card_purchase";
    kind: FinancialItemKind;
    ownerType: "personal" | "business";
    totalAmountCents: number;
    installmentCount: number;
    firstDueDate: string;
    accountId?: number | null;
    creditCardId?: number | null;
    categoryId?: number | null;
    metadata?: Record<string, unknown> | null;
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const amounts = splitCents(input.totalAmountCents, input.installmentCount);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await validateOperationalReferences(tx, scope, {
      ownerType: input.ownerType,
      accountIds: [input.accountId, input.creditCardId],
      categoryId: input.categoryId,
    });
    const [plan] = await tx
      .insert(installmentPlans)
      .values({
        ...scope,
        description: normalizeDescription(input.description),
        planType: input.planType ?? "purchase",
        totalAmountCents: input.totalAmountCents,
        installmentCount: input.installmentCount,
        firstDueDate: input.firstDueDate,
        accountId: input.accountId ?? null,
        creditCardId: input.creditCardId ?? null,
        status: "active",
        idempotencyKey,
        metadata: input.metadata ?? null,
      })
      .returning();
    const occurrences: FinancialItem[] = [];
    for (let index = 0; index < amounts.length; index += 1) {
      const dueDate = addMonthsClamped(input.firstDueDate, index);
      const [item] = await tx
        .insert(financialItems)
        .values({
          ...scope,
          kind: input.kind,
          origin:
            input.planType === "card_purchase" ? "card_invoice" : "manual",
          ownerType: input.ownerType,
          status: initialItemStatus(input.kind),
          amountCents: amounts[index],
          openAmountCents: amounts[index],
          description: `${normalizeDescription(input.description)} — ${index + 1}/${amounts.length}`,
          categoryId: input.categoryId ?? null,
          expectedAccountId: input.accountId ?? null,
          dueDate,
          competenceDate: dueDate,
          installmentPlanId: plan.id,
          installmentNumber: index + 1,
          idempotencyKey: `${idempotencyKey}:installment:${index + 1}`,
          metadata: {
            ...(input.metadata ?? {}),
            settlementMode:
              input.planType === "card_purchase" ? "card_transfer" : undefined,
            creditCardId: input.creditCardId ?? undefined,
          },
        })
        .returning();
      occurrences.push(item);
    }
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "installment_plan.create",
        entityType: "installment_plan",
        entityId: String(plan.id),
        beforeSnapshot: null,
        afterSnapshot: {
          plan,
          occurrenceIds: occurrences.map(item => item.id),
        },
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const projectedDelta =
      input.kind === "payable"
        ? -input.totalAmountCents
        : input.totalAmountCents;
    const result = createWriteResult({
      actionId: action.id,
      entityType: "installment_plan",
      entityId: plan.id,
      operation: "created",
      summary: `${plan.description} cadastrada em ${plan.installmentCount} parcela(s), total ${formatBRLCents(plan.totalAmountCents)}.`,
      projectedDelta,
      freeDelta: input.kind === "payable" ? -input.totalAmountCents : 0,
      reversibleUntil,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "installment_plan.created",
      entityType: "installment_plan",
      entityId: String(plan.id),
      after: { plan, occurrences: occurrences.length },
      requestId: idempotencyKey,
    });
    return { plan, occurrences, result, alreadyProcessed: false };
  });
}

async function adjustBudgetSpendV3(
  tx: any,
  scope: FinancialScope,
  categoryId: number | null,
  occurredAt: Date,
  deltaCents: number
) {
  const iso = occurredAt.toISOString().slice(0, 10);
  const [period] = await tx
    .select()
    .from(budgetPeriods)
    .where(
      and(
        eq(budgetPeriods.tenantId, scope.tenantId),
        eq(budgetPeriods.userId, scope.userId),
        lte(budgetPeriods.periodStart, iso),
        gte(budgetPeriods.periodEnd, iso)
      )
    )
    .limit(1);
  if (!period) return;
  const envelopes = await tx
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
    envelopes.find((item: { categoryId: number | null }) =>
      categoryId != null ? item.categoryId === categoryId : false
    ) ??
    envelopes.find(
      (item: { name: string }) => item.name === "Despesas variáveis"
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

export async function createCardPurchaseV3(
  scope: FinancialScope,
  input: {
    creditCardId: number;
    paymentAccountId: number;
    totalAmountCents: number;
    description: string;
    occurredAt: Date;
    installmentCount: number;
    firstDueDate: string;
    ownerType: "personal" | "business";
    categoryId?: number | null;
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const amounts = splitCents(input.totalAmountCents, input.installmentCount);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await validateOperationalReferences(tx, scope, {
      ownerType: input.ownerType,
      accountIds: [input.creditCardId, input.paymentAccountId],
      categoryId: input.categoryId,
    });
    const accounts = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, scope.tenantId),
          eq(financialAccounts.userId, scope.userId),
          inArray(financialAccounts.id, [
            input.creditCardId,
            input.paymentAccountId,
          ])
        )
      );
    const card = accounts.find(
      (item: { id: number }) => item.id === input.creditCardId
    );
    const paymentAccount = accounts.find(
      (item: { id: number }) => item.id === input.paymentAccountId
    );
    if (!card || card.accountType !== "credit_card")
      throw new Error("Cartao de credito nao encontrado");
    if (!paymentAccount) throw new Error("Conta de pagamento nao encontrada");
    const [purchase] = await tx
      .insert(financialTransactions)
      .values({
        ...scope,
        accountId: card.id,
        type: "expense",
        status: "confirmed",
        amountCents: input.totalAmountCents,
        occurredAt: input.occurredAt,
        description: normalizeDescription(input.description),
        normalizedDescription: normalizeDescription(
          input.description
        ).toLowerCase(),
        categoryId: input.categoryId ?? null,
        source: "whatsapp",
        idempotencyKey: `${idempotencyKey}:purchase`,
        needsReview: input.categoryId == null,
      })
      .returning();
    await tx
      .update(financialAccounts)
      .set({
        currentBalanceCents: sql`${financialAccounts.currentBalanceCents} - ${input.totalAmountCents}`,
        balanceAsOf: input.occurredAt,
        updatedAt: new Date(),
      })
      .where(eq(financialAccounts.id, card.id));
    await adjustBudgetSpendV3(
      tx,
      scope,
      input.categoryId ?? null,
      input.occurredAt,
      input.totalAmountCents
    );
    const [plan] = await tx
      .insert(installmentPlans)
      .values({
        ...scope,
        description: normalizeDescription(input.description),
        planType: "card_purchase",
        totalAmountCents: input.totalAmountCents,
        installmentCount: input.installmentCount,
        firstDueDate: input.firstDueDate,
        accountId: paymentAccount.id,
        creditCardId: card.id,
        status: "active",
        idempotencyKey,
        metadata: { purchaseTransactionId: purchase.id },
      })
      .returning();
    const invoices: FinancialItem[] = [];
    for (let index = 0; index < amounts.length; index += 1) {
      const dueDate = addMonthsClamped(input.firstDueDate, index);
      const [invoice] = await tx
        .insert(financialItems)
        .values({
          ...scope,
          kind: "payable",
          origin: "card_invoice",
          ownerType: input.ownerType,
          status: "pending",
          amountCents: amounts[index],
          openAmountCents: amounts[index],
          description: `Fatura ${card.name}: ${input.description} — ${index + 1}/${amounts.length}`,
          categoryId: null,
          expectedAccountId: paymentAccount.id,
          dueDate,
          competenceDate: dueDate,
          installmentPlanId: plan.id,
          installmentNumber: index + 1,
          idempotencyKey: `${idempotencyKey}:invoice:${index + 1}`,
          metadata: {
            settlementMode: "card_transfer",
            creditCardId: card.id,
            purchaseTransactionId: purchase.id,
          },
        })
        .returning();
      invoices.push(invoice);
    }
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "card_purchase.create",
        entityType: "installment_plan",
        entityId: String(plan.id),
        beforeSnapshot: null,
        afterSnapshot: {
          plan,
          purchaseTransactionId: purchase.id,
          invoiceIds: invoices.map(item => item.id),
        },
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const result = createWriteResult({
      actionId: action.id,
      entityType: "installment_plan",
      entityId: plan.id,
      operation: "created",
      summary: `${input.description} registrada no ${card.name} em ${input.installmentCount} parcela(s). A despesa foi contabilizada uma unica vez.`,
      confirmedDelta: -input.totalAmountCents,
      projectedDelta: -input.totalAmountCents,
      freeDelta: -input.totalAmountCents,
      reversibleUntil,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "card_purchase.created",
      entityType: "installment_plan",
      entityId: String(plan.id),
      after: { purchase, plan, invoiceCount: invoices.length },
      requestId: idempotencyKey,
    });
    return { purchase, plan, invoices, result, alreadyProcessed: false };
  });
}

export async function settleFinancialItemV3(
  scope: FinancialScope,
  input: {
    itemId: number;
    amountCents: number;
    settledAt: Date;
    accountId: number;
    protectedWithdrawalConfirmed?: boolean;
  },
  context: WriteContext
) {
  assertScope(scope);
  assertNonNegativeCents(input.amountCents, "amountCents");
  if (input.amountCents === 0) throw new Error("Valor deve ser maior que zero");
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [item] = await tx
      .select()
      .from(financialItems)
      .where(
        and(
          eq(financialItems.id, input.itemId),
          eq(financialItems.tenantId, scope.tenantId),
          eq(financialItems.userId, scope.userId)
        )
      )
      .limit(1)
      .for("update");
    if (!item) throw new Error("Conta a pagar/receber nao encontrada");
    if (!openStatuses(item.kind as FinancialItemKind).includes(item.status))
      throw new Error("O item nao esta aberto para liquidacao");
    if (input.amountCents > item.openAmountCents)
      throw new Error("Liquidacao nao pode ultrapassar o valor aberto");
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
      .limit(1)
      .for("update");
    if (!account) throw new Error("Conta financeira nao encontrada");
    if (account.ownerType !== item.ownerType)
      throw new Error("A conta nao pertence ao dominio PF/PJ do item");
    if (
      item.kind === "payable" &&
      account.protected &&
      !input.protectedWithdrawalConfirmed
    )
      throw new Error("Pagamento com conta protegida exige confirmacao dupla");
    if (
      item.kind === "payable" &&
      account.currentBalanceCents < input.amountCents
    )
      throw new Error("Saldo confirmado insuficiente na conta pagadora");

    const metadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {};
    const cardTransfer =
      item.kind === "payable" && metadata.settlementMode === "card_transfer";
    let transaction: typeof financialTransactions.$inferSelect;
    let pairedTransaction: typeof financialTransactions.$inferSelect | null =
      null;
    let confirmedDelta = 0;

    if (cardTransfer) {
      const creditCardId = Number(metadata.creditCardId);
      if (!Number.isInteger(creditCardId) || creditCardId <= 0)
        throw new Error("Cartao vinculado a fatura nao encontrado");
      const [card] = await tx
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, creditCardId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId),
            eq(financialAccounts.accountType, "credit_card")
          )
        )
        .limit(1)
        .for("update");
      if (!card) throw new Error("Cartao vinculado a fatura nao encontrado");
      const [outgoing] = await tx
        .insert(financialTransactions)
        .values({
          ...scope,
          accountId: account.id,
          type: "transfer",
          transferDirection: "out",
          status: "confirmed",
          amountCents: input.amountCents,
          occurredAt: input.settledAt,
          description: `Pagamento de ${item.description}`,
          normalizedDescription: `pagamento ${item.description}`.toLowerCase(),
          source: "whatsapp",
          idempotencyKey: `${idempotencyKey}:out`,
          needsReview: false,
        })
        .returning();
      const [incoming] = await tx
        .insert(financialTransactions)
        .values({
          ...scope,
          accountId: card.id,
          type: "transfer",
          transferDirection: "in",
          transferPairId: outgoing.id,
          status: "confirmed",
          amountCents: input.amountCents,
          occurredAt: input.settledAt,
          description: `Pagamento de ${item.description}`,
          normalizedDescription: `pagamento ${item.description}`.toLowerCase(),
          source: "whatsapp",
          idempotencyKey: `${idempotencyKey}:in`,
          needsReview: false,
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
          balanceAsOf: input.settledAt,
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, account.id));
      await tx
        .update(financialAccounts)
        .set({
          currentBalanceCents: sql`${financialAccounts.currentBalanceCents} + ${input.amountCents}`,
          balanceAsOf: input.settledAt,
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, card.id));
      transaction = { ...outgoing, transferPairId: incoming.id };
      pairedTransaction = incoming;
    } else {
      const type = item.kind === "payable" ? "expense" : "income";
      const status = item.kind === "payable" ? "paid" : "received";
      const [created] = await tx
        .insert(financialTransactions)
        .values({
          ...scope,
          accountId: account.id,
          type,
          status,
          amountCents: input.amountCents,
          occurredAt: input.settledAt,
          description: item.description,
          normalizedDescription: item.description.toLowerCase(),
          counterparty: item.counterparty,
          categoryId: item.categoryId,
          source: "whatsapp",
          idempotencyKey: `${idempotencyKey}:transaction`,
          needsReview: item.categoryId == null,
        })
        .returning();
      const direction = item.kind === "payable" ? -1 : 1;
      confirmedDelta = direction * input.amountCents;
      await tx
        .update(financialAccounts)
        .set({
          currentBalanceCents: sql`${financialAccounts.currentBalanceCents} + ${confirmedDelta}`,
          balanceAsOf: input.settledAt,
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, account.id));
      if (item.kind === "payable")
        await adjustBudgetSpendV3(
          tx,
          scope,
          item.categoryId,
          input.settledAt,
          input.amountCents
        );
      transaction = created;
    }

    const settlementType = item.kind === "payable" ? "payment" : "receipt";
    const [settlement] = await tx
      .insert(financialSettlements)
      .values({
        ...scope,
        financialItemId: item.id,
        transactionId: transaction.id,
        amountCents: input.amountCents,
        settledAt: input.settledAt,
        settlementType,
        idempotencyKey,
      })
      .returning();
    const openAmountCents = item.openAmountCents - input.amountCents;
    const status =
      openAmountCents === 0
        ? item.kind === "payable"
          ? "paid"
          : "received"
        : item.kind === "payable"
          ? "partially_paid"
          : "partially_received";
    const [updatedItem] = await tx
      .update(financialItems)
      .set({ openAmountCents, status, updatedAt: new Date() })
      .where(eq(financialItems.id, item.id))
      .returning();

    if (metadata.debtSeedKey && item.kind === "payable") {
      await tx
        .update(financialDebts)
        .set({
          balanceCents: openAmountCents,
          status: openAmountCents === 0 ? "paid" : "outstanding",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(financialDebts.tenantId, scope.tenantId),
            eq(financialDebts.userId, scope.userId),
            eq(financialDebts.seedKey, String(metadata.debtSeedKey))
          )
        );
    }

    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "item.settle",
        entityType: "financial_item",
        entityId: String(item.id),
        beforeSnapshot: item,
        afterSnapshot: updatedItem,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const projectedDelta =
      item.kind === "payable" ? input.amountCents : -input.amountCents;
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_item",
      entityId: item.id,
      operation: "settled",
      summary: `${formatBRLCents(input.amountCents)} ${item.kind === "payable" ? "pagos" : "recebidos"} em ${account.name}; saldo aberto ${formatBRLCents(openAmountCents)}.`,
      confirmedDelta,
      projectedDelta,
      freeDelta: cardTransfer ? 0 : confirmedDelta + projectedDelta,
      reversibleUntil,
      warnings: cardTransfer
        ? [
            "Pagamento da fatura registrado como transferencia; a despesa nao foi duplicada.",
          ]
        : [],
    });
    await tx
      .update(financialActions)
      .set({
        resultSnapshot: {
          ...result,
          settlementId: settlement.id,
          transactionId: transaction.id,
          pairedTransactionId: pairedTransaction?.id ?? null,
        },
      })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "financial_item.settled",
      entityType: "financial_item",
      entityId: String(item.id),
      before: item,
      after: {
        item: updatedItem,
        settlementId: settlement.id,
        transactionId: transaction.id,
      },
      requestId: idempotencyKey,
    });
    return {
      item: updatedItem,
      settlement,
      transaction,
      pairedTransaction,
      result,
      alreadyProcessed: false,
    };
  });
}

export async function updateFinancialItemV3(
  scope: FinancialScope,
  input: {
    itemId: number;
    scope: FinancialItemScope;
    patch: {
      amountCents?: number;
      description?: string;
      counterparty?: string | null;
      categoryId?: number | null;
      expectedAccountId?: number | null;
      dueDate?: string;
      competenceDate?: string;
      estimated?: boolean;
      needsConfirmation?: boolean;
    };
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  if (Object.keys(input.patch).length === 0)
    throw new Error("Informe pelo menos um campo para atualizar");
  if (input.patch.amountCents != null) {
    assertNonNegativeCents(input.patch.amountCents, "amountCents");
    if (input.patch.amountCents === 0)
      throw new Error("Use cancelamento para zerar uma obrigacao");
  }
  if (input.scope !== "THIS_OCCURRENCE" && input.patch.dueDate)
    throw new Error(
      "Alteracao de data em massa exige atualizar a regra de recorrencia"
    );
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [item] = await tx
      .select()
      .from(financialItems)
      .where(
        and(
          eq(financialItems.id, input.itemId),
          eq(financialItems.tenantId, scope.tenantId),
          eq(financialItems.userId, scope.userId)
        )
      )
      .limit(1);
    if (!item) throw new Error("Conta a pagar/receber nao encontrada");
    if (["paid", "received", "cancelled"].includes(item.status))
      throw new Error("Item liquidado ou cancelado nao pode ser reescrito");
    if (input.patch.expectedAccountId != null) {
      const [account] = await tx
        .select({
          id: financialAccounts.id,
          ownerType: financialAccounts.ownerType,
        })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, input.patch.expectedAccountId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId),
            eq(financialAccounts.active, true)
          )
        )
        .limit(1);
      if (!account) throw new Error("Conta financeira nao encontrada");
      if (account.ownerType !== item.ownerType)
        throw new Error("A conta nao pertence ao dominio PF/PJ do item");
    }
    if (input.patch.categoryId != null) {
      const [category] = await tx
        .select({ id: financialCategories.id })
        .from(financialCategories)
        .where(
          and(
            eq(financialCategories.id, input.patch.categoryId),
            eq(financialCategories.tenantId, scope.tenantId),
            eq(financialCategories.userId, scope.userId),
            eq(financialCategories.active, true)
          )
        )
        .limit(1);
      if (!category) throw new Error("Categoria financeira nao encontrada");
    }

    const baseFilters = [
      eq(financialItems.tenantId, scope.tenantId),
      eq(financialItems.userId, scope.userId),
      eq(financialItems.kind, item.kind),
      inArray(
        financialItems.status,
        openStatuses(item.kind as FinancialItemKind)
      ),
    ];
    if (input.scope === "THIS_OCCURRENCE" || item.recurrenceId == null) {
      baseFilters.push(eq(financialItems.id, item.id));
    } else {
      baseFilters.push(eq(financialItems.recurrenceId, item.recurrenceId));
      if (input.scope === "THIS_AND_FUTURE")
        baseFilters.push(gte(financialItems.dueDate, item.dueDate));
    }
    const targets = await tx
      .select()
      .from(financialItems)
      .where(and(...baseFilters))
      .orderBy(asc(financialItems.dueDate));
    if (targets.length === 0)
      throw new Error("Nenhuma ocorrencia editavel encontrada");
    const [recurrenceBefore] = item.recurrenceId
      ? await tx
          .select()
          .from(recurrenceRules)
          .where(eq(recurrenceRules.id, item.recurrenceId))
          .limit(1)
      : [];

    const after: FinancialItem[] = [];
    let projectedDelta = 0;
    for (const target of targets) {
      const settledCents = target.amountCents - target.openAmountCents;
      const nextAmount = input.patch.amountCents ?? target.amountCents;
      if (nextAmount < settledCents)
        throw new Error(
          "Novo valor nao pode ser menor que o total ja liquidado"
        );
      const nextOpen = nextAmount - settledCents;
      const [updated] = await tx
        .update(financialItems)
        .set({
          ...(input.patch.amountCents !== undefined
            ? { amountCents: nextAmount, openAmountCents: nextOpen }
            : {}),
          ...(input.patch.description !== undefined
            ? { description: normalizeDescription(input.patch.description) }
            : {}),
          ...(input.patch.counterparty !== undefined
            ? { counterparty: input.patch.counterparty?.trim() || null }
            : {}),
          ...(input.patch.categoryId !== undefined
            ? { categoryId: input.patch.categoryId }
            : {}),
          ...(input.patch.expectedAccountId !== undefined
            ? { expectedAccountId: input.patch.expectedAccountId }
            : {}),
          ...(input.patch.dueDate !== undefined
            ? { dueDate: input.patch.dueDate }
            : {}),
          ...(input.patch.competenceDate !== undefined
            ? { competenceDate: input.patch.competenceDate }
            : {}),
          ...(input.patch.estimated !== undefined
            ? { estimated: input.patch.estimated }
            : {}),
          ...(input.patch.needsConfirmation !== undefined
            ? { needsConfirmation: input.patch.needsConfirmation }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(financialItems.id, target.id))
        .returning();
      const sign = target.kind === "payable" ? -1 : 1;
      projectedDelta +=
        sign * (updated.openAmountCents - target.openAmountCents);
      after.push(updated);
    }
    if (item.recurrenceId && input.scope !== "THIS_OCCURRENCE") {
      await tx
        .update(recurrenceRules)
        .set({
          ...(input.patch.amountCents !== undefined
            ? { baseAmountCents: input.patch.amountCents }
            : {}),
          ...(input.patch.description !== undefined
            ? { description: normalizeDescription(input.patch.description) }
            : {}),
          ...(input.patch.categoryId !== undefined
            ? { categoryId: input.patch.categoryId }
            : {}),
          ...(input.patch.expectedAccountId !== undefined
            ? { expectedAccountId: input.patch.expectedAccountId }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recurrenceRules.id, item.recurrenceId),
            eq(recurrenceRules.tenantId, scope.tenantId),
            eq(recurrenceRules.userId, scope.userId)
          )
        );
    }
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "item.update",
        entityType: "financial_item",
        entityId: String(item.id),
        beforeSnapshot: {
          items: targets,
          recurrence: recurrenceBefore ?? null,
        },
        afterSnapshot: after,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_item",
      entityId: item.id,
      operation: "updated",
      summary: `${after.length} ocorrencia(s) de ${item.description} atualizada(s).`,
      projectedDelta,
      freeDelta: item.kind === "payable" ? projectedDelta : 0,
      reversibleUntil,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "financial_item.updated",
      entityType: "financial_item",
      entityId: String(item.id),
      before: targets,
      after,
      requestId: idempotencyKey,
    });
    return { items: after, result, alreadyProcessed: false };
  });
}

export async function cancelFinancialItemV3(
  scope: FinancialScope,
  input: {
    itemId: number;
    scope: FinancialItemScope;
    reason: string;
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const reason = normalizeDescription(input.reason);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [item] = await tx
      .select()
      .from(financialItems)
      .where(
        and(
          eq(financialItems.id, input.itemId),
          eq(financialItems.tenantId, scope.tenantId),
          eq(financialItems.userId, scope.userId)
        )
      )
      .limit(1);
    if (!item) throw new Error("Conta a pagar/receber nao encontrada");
    if (["paid", "received"].includes(item.status))
      throw new Error("Item liquidado deve ser estornado, nao cancelado");
    const filters = [
      eq(financialItems.tenantId, scope.tenantId),
      eq(financialItems.userId, scope.userId),
      inArray(
        financialItems.status,
        openStatuses(item.kind as FinancialItemKind)
      ),
    ];
    if (input.scope === "THIS_OCCURRENCE" || item.recurrenceId == null)
      filters.push(eq(financialItems.id, item.id));
    else {
      filters.push(eq(financialItems.recurrenceId, item.recurrenceId));
      if (input.scope === "THIS_AND_FUTURE")
        filters.push(gte(financialItems.dueDate, item.dueDate));
    }
    const targets = await tx
      .select()
      .from(financialItems)
      .where(and(...filters));
    const [recurrenceBefore] = item.recurrenceId
      ? await tx
          .select()
          .from(recurrenceRules)
          .where(eq(recurrenceRules.id, item.recurrenceId))
          .limit(1)
      : [];
    const releasedCents = targets.reduce(
      (sum, target) => sum + target.openAmountCents,
      0
    );
    const cancelledAt = new Date();
    const cancelled = await tx
      .update(financialItems)
      .set({
        status: "cancelled",
        openAmountCents: 0,
        cancelledAt,
        metadata: sql`coalesce(${financialItems.metadata}, '{}'::jsonb) || ${JSON.stringify({ cancellationReason: reason })}::jsonb`,
        updatedAt: cancelledAt,
      })
      .where(and(...filters))
      .returning();
    if (item.recurrenceId && input.scope !== "THIS_OCCURRENCE") {
      await tx
        .update(recurrenceRules)
        .set({
          status: input.scope === "ALL_OCCURRENCES" ? "cancelled" : "active",
          endDate:
            input.scope === "THIS_AND_FUTURE"
              ? addDays(item.dueDate, -1)
              : null,
          updatedAt: cancelledAt,
        })
        .where(eq(recurrenceRules.id, item.recurrenceId));
    }
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "item.cancel",
        entityType: "financial_item",
        entityId: String(item.id),
        beforeSnapshot: {
          items: targets,
          recurrence: recurrenceBefore ?? null,
        },
        afterSnapshot: cancelled,
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const projectedDelta =
      item.kind === "payable" ? releasedCents : -releasedCents;
    const result = createWriteResult({
      actionId: action.id,
      entityType: "financial_item",
      entityId: item.id,
      operation: "cancelled",
      summary: `${cancelled.length} ocorrencia(s) de ${item.description} cancelada(s).`,
      projectedDelta,
      freeDelta: item.kind === "payable" ? releasedCents : 0,
      reversibleUntil,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "financial_item.cancelled",
      entityType: "financial_item",
      entityId: String(item.id),
      before: targets,
      after: { cancelledIds: cancelled.map(target => target.id), reason },
      requestId: idempotencyKey,
    });
    return { items: cancelled, result, alreadyProcessed: false };
  });
}

export async function updateRecurrenceRuleV3(
  scope: FinancialScope,
  input: {
    recurrenceId: number;
    effectiveFrom: string;
    patch: {
      description?: string;
      baseAmountCents?: number;
      frequency?:
        | "daily"
        | "weekly"
        | "monthly"
        | "yearly"
        | "business_day_rule";
      interval?: number;
      byWeekday?: number[] | null;
      byMonthDay?: number | null;
      businessDayOrdinal?: number | null;
      endDate?: string | null;
      amountMode?: "fixed" | "estimated" | "variable";
      expectedAccountId?: number | null;
      categoryId?: number | null;
      status?: "active" | "paused" | "cancelled";
    };
    generationWindowDays?: number;
  },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  if (Object.keys(input.patch).length === 0)
    throw new Error("Informe pelo menos um campo da recorrencia");
  if (input.patch.baseAmountCents != null) {
    assertNonNegativeCents(input.patch.baseAmountCents, "baseAmountCents");
    if (input.patch.baseAmountCents === 0)
      throw new Error("Use cancelamento para encerrar a recorrencia");
  }
  const scheduleChanged = [
    "frequency",
    "interval",
    "byWeekday",
    "byMonthDay",
    "businessDayOrdinal",
  ].some(key => key in input.patch);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [before] = await tx
      .select()
      .from(recurrenceRules)
      .where(
        and(
          eq(recurrenceRules.id, input.recurrenceId),
          eq(recurrenceRules.tenantId, scope.tenantId),
          eq(recurrenceRules.userId, scope.userId)
        )
      )
      .limit(1);
    if (!before) throw new Error("Regra de recorrencia nao encontrada");
    if (input.patch.expectedAccountId != null) {
      const [account] = await tx
        .select({
          id: financialAccounts.id,
          ownerType: financialAccounts.ownerType,
        })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, input.patch.expectedAccountId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId),
            eq(financialAccounts.active, true)
          )
        )
        .limit(1);
      if (!account) throw new Error("Conta financeira nao encontrada");
      if (account.ownerType !== before.ownerType)
        throw new Error("A conta nao pertence ao dominio PF/PJ da recorrencia");
    }
    if (input.patch.categoryId != null) {
      const [category] = await tx
        .select({ id: financialCategories.id })
        .from(financialCategories)
        .where(
          and(
            eq(financialCategories.id, input.patch.categoryId),
            eq(financialCategories.tenantId, scope.tenantId),
            eq(financialCategories.userId, scope.userId),
            eq(financialCategories.active, true)
          )
        )
        .limit(1);
      if (!category) throw new Error("Categoria financeira nao encontrada");
    }
    const occurrencesBefore = await tx
      .select()
      .from(financialItems)
      .where(
        and(
          eq(financialItems.recurrenceId, before.id),
          gte(financialItems.dueDate, input.effectiveFrom),
          inArray(
            financialItems.status,
            openStatuses(before.itemKind as FinancialItemKind)
          )
        )
      )
      .orderBy(asc(financialItems.dueDate));
    let rule: typeof recurrenceRules.$inferSelect;
    let cancelledOccurrences: FinancialItem[] = [];
    let generated: FinancialItem[] = [];
    if (scheduleChanged) {
      await tx
        .update(recurrenceRules)
        .set({
          status: "ended",
          endDate: addDays(input.effectiveFrom, -1),
          updatedAt: new Date(),
        })
        .where(eq(recurrenceRules.id, before.id));
      cancelledOccurrences = await tx
        .update(financialItems)
        .set({
          status: "cancelled",
          openAmountCents: 0,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(financialItems.recurrenceId, before.id),
            gte(financialItems.dueDate, input.effectiveFrom),
            inArray(
              financialItems.status,
              openStatuses(before.itemKind as FinancialItemKind)
            )
          )
        )
        .returning();
      const [versioned] = await tx
        .insert(recurrenceRules)
        .values({
          ...scope,
          itemKind: before.itemKind,
          ownerType: before.ownerType,
          description:
            input.patch.description != null
              ? normalizeDescription(input.patch.description)
              : before.description,
          frequency: input.patch.frequency ?? before.frequency,
          interval: input.patch.interval ?? before.interval,
          byWeekday:
            input.patch.byWeekday !== undefined
              ? input.patch.byWeekday
              : before.byWeekday,
          byMonthDay:
            input.patch.byMonthDay !== undefined
              ? input.patch.byMonthDay
              : before.byMonthDay,
          businessDayOrdinal:
            input.patch.businessDayOrdinal !== undefined
              ? input.patch.businessDayOrdinal
              : before.businessDayOrdinal,
          startDate: input.effectiveFrom,
          endDate:
            input.patch.endDate !== undefined
              ? input.patch.endDate
              : before.endDate,
          timezone: before.timezone,
          amountMode: input.patch.amountMode ?? before.amountMode,
          baseAmountCents:
            input.patch.baseAmountCents ?? before.baseAmountCents,
          expectedAccountId:
            input.patch.expectedAccountId !== undefined
              ? input.patch.expectedAccountId
              : before.expectedAccountId,
          categoryId:
            input.patch.categoryId !== undefined
              ? input.patch.categoryId
              : before.categoryId,
          nextGenerationAt: new Date(),
          status: input.patch.status ?? "active",
          sourceMessageId: context.messageId ?? before.sourceMessageId,
          idempotencyKey: `${idempotencyKey}:version`,
          metadata: {
            previousRecurrenceId: before.id,
            changedByAction: idempotencyKey,
          },
        })
        .returning();
      rule = versioned;
      if (rule.status === "active") {
        const end = addDays(
          input.effectiveFrom,
          Math.max(1, Math.min(input.generationWindowDays ?? 90, 370))
        );
        generated = await insertOccurrences(
          tx,
          scope,
          rule,
          recurrenceDatesInWindow(rule, input.effectiveFrom, end)
        );
      }
    } else {
      if (input.patch.baseAmountCents !== undefined) {
        const invalid = occurrencesBefore.find(
          occurrence =>
            occurrence.amountCents - occurrence.openAmountCents >
            (input.patch.baseAmountCents as number)
        );
        if (invalid)
          throw new Error(
            "Novo valor da recorrencia nao pode ser menor que o total ja liquidado"
          );
      }
      const [updated] = await tx
        .update(recurrenceRules)
        .set({
          ...(input.patch.description !== undefined
            ? { description: normalizeDescription(input.patch.description) }
            : {}),
          ...(input.patch.baseAmountCents !== undefined
            ? { baseAmountCents: input.patch.baseAmountCents }
            : {}),
          ...(input.patch.endDate !== undefined
            ? { endDate: input.patch.endDate }
            : {}),
          ...(input.patch.amountMode !== undefined
            ? { amountMode: input.patch.amountMode }
            : {}),
          ...(input.patch.expectedAccountId !== undefined
            ? { expectedAccountId: input.patch.expectedAccountId }
            : {}),
          ...(input.patch.categoryId !== undefined
            ? { categoryId: input.patch.categoryId }
            : {}),
          ...(input.patch.status !== undefined
            ? { status: input.patch.status }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(recurrenceRules.id, before.id))
        .returning();
      rule = updated;
      await tx
        .update(financialItems)
        .set({
          ...(input.patch.description !== undefined
            ? { description: normalizeDescription(input.patch.description) }
            : {}),
          ...(input.patch.baseAmountCents !== undefined
            ? {
                amountCents: input.patch.baseAmountCents,
                openAmountCents: sql`greatest(0, ${input.patch.baseAmountCents} - (${financialItems.amountCents} - ${financialItems.openAmountCents}))`,
              }
            : {}),
          ...(input.patch.expectedAccountId !== undefined
            ? { expectedAccountId: input.patch.expectedAccountId }
            : {}),
          ...(input.patch.categoryId !== undefined
            ? { categoryId: input.patch.categoryId }
            : {}),
          ...(input.patch.amountMode !== undefined
            ? {
                estimated: input.patch.amountMode !== "fixed",
                needsConfirmation: input.patch.amountMode !== "fixed",
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(financialItems.recurrenceId, before.id),
            gte(financialItems.dueDate, input.effectiveFrom),
            inArray(
              financialItems.status,
              openStatuses(before.itemKind as FinancialItemKind)
            )
          )
        );
    }
    const reversibleUntil = new Date(Date.now() + 15 * 60_000);
    const [action] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? null,
        messageId: context.messageId ?? null,
        actionType: "recurrence.update",
        entityType: "recurrence_rule",
        entityId: String(rule.id),
        beforeSnapshot: { rule: before, items: occurrencesBefore },
        afterSnapshot: {
          rule,
          cancelledOccurrenceIds: cancelledOccurrences.map(item => item.id),
          generatedOccurrenceIds: generated.map(item => item.id),
        },
        idempotencyKey,
        reversibleUntil,
      })
      .returning();
    const result = createWriteResult({
      actionId: action.id,
      entityType: "recurrence_rule",
      entityId: rule.id,
      operation: "updated",
      summary: `${rule.description} atualizada a partir de ${input.effectiveFrom}.`,
      reversibleUntil,
      warnings: scheduleChanged
        ? [
            "Ocorrencias liquidadas foram preservadas; apenas o futuro foi versionado.",
          ]
        : [],
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, action.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "recurrence.updated",
      entityType: "recurrence_rule",
      entityId: String(rule.id),
      before,
      after: rule,
      requestId: idempotencyKey,
    });
    return { rule, generated, result, alreadyProcessed: false };
  });
}

export async function generateFinancialOccurrencesV3(
  scope: FinancialScope,
  input: {
    windowStart: string;
    windowEnd: string;
    holidays?: string[];
  }
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const rules = await tx
      .select()
      .from(recurrenceRules)
      .where(
        and(
          eq(recurrenceRules.tenantId, scope.tenantId),
          eq(recurrenceRules.userId, scope.userId),
          eq(recurrenceRules.status, "active"),
          lte(recurrenceRules.startDate, input.windowEnd),
          or(
            isNull(recurrenceRules.endDate),
            gte(recurrenceRules.endDate, input.windowStart)
          )
        )
      );
    let created = 0;
    for (const rule of rules) {
      const rows = await insertOccurrences(
        tx,
        scope,
        rule,
        recurrenceDatesInWindow(
          rule,
          input.windowStart,
          input.windowEnd,
          input.holidays ?? []
        )
      );
      created += rows.length;
      await tx
        .update(recurrenceRules)
        .set({
          nextGenerationAt: new Date(`${input.windowEnd}T23:59:59.999Z`),
          updatedAt: new Date(),
        })
        .where(eq(recurrenceRules.id, rule.id));
    }
    return { rules: rules.length, created };
  });
}

export async function markFinancialItemsOverdueV3(
  scope: FinancialScope,
  today: string
) {
  assertScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const overdue = await db
    .update(financialItems)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(
      and(
        eq(financialItems.tenantId, scope.tenantId),
        eq(financialItems.userId, scope.userId),
        lte(financialItems.dueDate, addDays(today, -1)),
        inArray(financialItems.status, [
          "scheduled",
          "pending",
          "partially_paid",
          "expected",
          "partially_received",
        ])
      )
    )
    .returning({ id: financialItems.id });
  return { markedOverdue: overdue.length };
}

function transactionEffect(transaction: {
  type: string;
  transferDirection: string | null;
  amountCents: number;
  status?: string;
}) {
  if (
    transaction.status &&
    !["confirmed", "paid", "received"].includes(transaction.status)
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

async function reverseTransactionInsideAction(
  tx: any,
  scope: FinancialScope,
  transactionId: number,
  idempotencyKey: string,
  reason: string
) {
  const [transaction] = await tx
    .select()
    .from(financialTransactions)
    .where(
      and(
        eq(financialTransactions.id, transactionId),
        eq(financialTransactions.tenantId, scope.tenantId),
        eq(financialTransactions.userId, scope.userId)
      )
    )
    .limit(1)
    .for("update");
  if (!transaction) throw new Error("Transacao da acao nao encontrada");
  if (transaction.reversedAt) return { transaction, alreadyReversed: true };
  const reversedAt = new Date();
  const effect = transactionEffect(transaction);
  if (effect !== 0) {
    await tx
      .update(financialAccounts)
      .set({
        currentBalanceCents: sql`${financialAccounts.currentBalanceCents} - ${effect}`,
        balanceAsOf: reversedAt,
        updatedAt: reversedAt,
      })
      .where(eq(financialAccounts.id, transaction.accountId));
  }
  if (transaction.type === "expense")
    await adjustBudgetSpendV3(
      tx,
      scope,
      transaction.categoryId,
      transaction.occurredAt,
      -transaction.amountCents
    );
  const [reversal] = await tx
    .insert(financialTransactions)
    .values({
      ...scope,
      accountId: transaction.accountId,
      reversalOfId: transaction.id,
      type: "reversal",
      status: "confirmed",
      amountCents: transaction.amountCents,
      occurredAt: reversedAt,
      description: `Reversao: ${reason}`,
      normalizedDescription: `reversao ${reason}`.toLowerCase(),
      source: transaction.source,
      idempotencyKey,
      needsReview: false,
    })
    .returning();
  await tx
    .update(financialTransactions)
    .set({ reversedAt, updatedAt: reversedAt })
    .where(eq(financialTransactions.id, transaction.id));
  return { transaction, reversal, alreadyReversed: false };
}

function itemSnapshotList(value: unknown): FinancialItem[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "items" in value
      ? (value as { items: unknown }).items
      : [];
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(
    (item): item is FinancialItem =>
      Boolean(item) &&
      typeof item === "object" &&
      "id" in item &&
      Number.isInteger((item as { id: unknown }).id)
  );
}

function recurrenceSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record.recurrence ?? record.rule;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("id" in candidate) ||
    !Number.isInteger((candidate as { id: unknown }).id)
  )
    return null;
  return candidate as typeof recurrenceRules.$inferSelect;
}

async function restoreRecurrenceSnapshot(
  tx: any,
  snapshot: typeof recurrenceRules.$inferSelect
) {
  const [restored] = await tx
    .update(recurrenceRules)
    .set({
      itemKind: snapshot.itemKind,
      ownerType: snapshot.ownerType,
      description: snapshot.description,
      frequency: snapshot.frequency,
      interval: snapshot.interval,
      byWeekday: snapshot.byWeekday,
      byMonthDay: snapshot.byMonthDay,
      businessDayOrdinal: snapshot.businessDayOrdinal,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      timezone: snapshot.timezone,
      amountMode: snapshot.amountMode,
      baseAmountCents: snapshot.baseAmountCents,
      expectedAccountId: snapshot.expectedAccountId,
      categoryId: snapshot.categoryId,
      nextGenerationAt: snapshot.nextGenerationAt,
      status: snapshot.status,
      metadata: snapshot.metadata,
      updatedAt: new Date(),
    })
    .where(eq(recurrenceRules.id, snapshot.id))
    .returning();
  return restored;
}

async function restoreItemSnapshots(tx: any, snapshots: FinancialItem[]) {
  const restored: FinancialItem[] = [];
  for (const item of snapshots) {
    const [row] = await tx
      .update(financialItems)
      .set({
        status: item.status,
        amountCents: item.amountCents,
        openAmountCents: item.openAmountCents,
        description: item.description,
        counterparty: item.counterparty,
        categoryId: item.categoryId,
        expectedAccountId: item.expectedAccountId,
        dueDate: item.dueDate,
        competenceDate: item.competenceDate,
        estimated: item.estimated,
        needsConfirmation: item.needsConfirmation,
        metadata: item.metadata,
        cancelledAt:
          item.cancelledAt == null ? null : new Date(item.cancelledAt),
        updatedAt: new Date(),
      })
      .where(eq(financialItems.id, item.id))
      .returning();
    if (row) restored.push(row);
  }
  return restored;
}

export async function undoFinancialActionV3(
  scope: FinancialScope,
  input: { actionId?: number | null; reason?: string },
  context: WriteContext
) {
  assertScope(scope);
  const idempotencyKey = requireIdempotencyKey(context.idempotencyKey);
  const cached = await existingActionResult(scope, idempotencyKey);
  if (cached) return { result: cached, alreadyProcessed: true };
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const actionFilters = [
      eq(financialActions.tenantId, scope.tenantId),
      eq(financialActions.userId, scope.userId),
      isNull(financialActions.reversedAt),
      gte(financialActions.reversibleUntil, new Date()),
    ];
    if (input.actionId != null)
      actionFilters.push(eq(financialActions.id, input.actionId));
    const [action] = await tx
      .select()
      .from(financialActions)
      .where(and(...actionFilters))
      .orderBy(desc(financialActions.createdAt))
      .limit(1)
      .for("update");
    if (!action) throw new Error("Nenhuma acao reversivel encontrada");
    if (action.actionType === "action.undo")
      throw new Error("Uma reversao nao pode ser desfeita automaticamente");
    const reason = normalizeDescription(
      input.reason ?? "Desfeito pelo usuario"
    );
    let confirmedDelta = 0;
    let projectedDelta = 0;
    let freeDeltaOverride: number | null = null;
    const warnings: string[] = [];

    if (action.actionType === "item.create") {
      const [item] = await tx
        .select()
        .from(financialItems)
        .where(eq(financialItems.id, Number(action.entityId)))
        .limit(1);
      if (!item) throw new Error("Item criado nao encontrado");
      if (item.openAmountCents !== item.amountCents)
        throw new Error(
          "Item ja possui liquidacao e nao pode ser cancelado diretamente"
        );
      await tx
        .update(financialItems)
        .set({
          status: "cancelled",
          openAmountCents: 0,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(financialItems.id, item.id));
      projectedDelta =
        item.kind === "payable" ? item.amountCents : -item.amountCents;
    } else if (
      action.actionType === "item.update" ||
      action.actionType === "item.cancel"
    ) {
      const snapshots = itemSnapshotList(action.beforeSnapshot);
      if (snapshots.length === 0)
        throw new Error("Snapshot anterior indisponivel");
      await restoreItemSnapshots(tx, snapshots);
      const recurrence = recurrenceSnapshot(action.beforeSnapshot);
      if (recurrence) await restoreRecurrenceSnapshot(tx, recurrence);
    } else if (action.actionType === "item.settle") {
      const result =
        action.resultSnapshot && typeof action.resultSnapshot === "object"
          ? (action.resultSnapshot as Record<string, unknown>)
          : {};
      const settlementId = Number(result.settlementId);
      const transactionId = Number(result.transactionId);
      if (!Number.isInteger(settlementId) || !Number.isInteger(transactionId))
        throw new Error("Dados da liquidacao indisponiveis");
      const [settlement] = await tx
        .select()
        .from(financialSettlements)
        .where(
          and(
            eq(financialSettlements.id, settlementId),
            eq(financialSettlements.tenantId, scope.tenantId),
            eq(financialSettlements.userId, scope.userId)
          )
        )
        .limit(1);
      if (!settlement || settlement.reversedAt)
        throw new Error("Liquidacao ja revertida ou inexistente");
      const first = await reverseTransactionInsideAction(
        tx,
        scope,
        transactionId,
        `${idempotencyKey}:transaction`,
        reason
      );
      confirmedDelta -= transactionEffect(first.transaction);
      const pairedTransactionId = Number(result.pairedTransactionId);
      if (Number.isInteger(pairedTransactionId) && pairedTransactionId > 0) {
        await reverseTransactionInsideAction(
          tx,
          scope,
          pairedTransactionId,
          `${idempotencyKey}:paired`,
          reason
        );
        confirmedDelta = 0;
        warnings.push(
          "Transferencia da fatura revertida sem duplicar despesa."
        );
      }
      await tx
        .update(financialSettlements)
        .set({ reversedAt: new Date() })
        .where(eq(financialSettlements.id, settlement.id));
      const beforeItem =
        action.beforeSnapshot && typeof action.beforeSnapshot === "object"
          ? (action.beforeSnapshot as FinancialItem)
          : null;
      if (!beforeItem) throw new Error("Snapshot da obrigacao indisponivel");
      await restoreItemSnapshots(tx, [beforeItem]);
      projectedDelta =
        beforeItem.kind === "payable"
          ? -settlement.amountCents
          : settlement.amountCents;
    } else if (action.actionType === "recurrence.update") {
      const beforeRule = recurrenceSnapshot(action.beforeSnapshot);
      if (!beforeRule)
        throw new Error("Snapshot anterior da recorrencia indisponivel");
      const afterRule = recurrenceSnapshot(action.afterSnapshot);
      if (afterRule && afterRule.id !== beforeRule.id) {
        const settlements = await tx
          .select({ id: financialSettlements.id })
          .from(financialSettlements)
          .innerJoin(
            financialItems,
            eq(financialSettlements.financialItemId, financialItems.id)
          )
          .where(eq(financialItems.recurrenceId, afterRule.id))
          .limit(1);
        if (settlements.length > 0)
          throw new Error(
            "A nova versao ja possui liquidacao e nao pode ser desfeita"
          );
        await tx
          .update(recurrenceRules)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(recurrenceRules.id, afterRule.id));
        await tx
          .update(financialItems)
          .set({
            status: "cancelled",
            openAmountCents: 0,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(financialItems.recurrenceId, afterRule.id),
              inArray(
                financialItems.status,
                openStatuses(afterRule.itemKind as FinancialItemKind)
              )
            )
          );
      }
      await restoreRecurrenceSnapshot(tx, beforeRule);
      await restoreItemSnapshots(tx, itemSnapshotList(action.beforeSnapshot));
      warnings.push("Regra e ocorrencias futuras foram restauradas.");
    } else if (action.actionType === "transaction.create") {
      const result =
        action.resultSnapshot && typeof action.resultSnapshot === "object"
          ? (action.resultSnapshot as Record<string, unknown>)
          : {};
      const transactionId = Number(
        result.transactionId ?? Number(action.entityId)
      );
      if (!Number.isInteger(transactionId) || transactionId <= 0)
        throw new Error("Transacao da acao indisponivel");
      const reversed = await reverseTransactionInsideAction(
        tx,
        scope,
        transactionId,
        `${idempotencyKey}:transaction`,
        reason
      );
      confirmedDelta = -transactionEffect(reversed.transaction);
      const impact =
        result.financial_impact && typeof result.financial_impact === "object"
          ? (result.financial_impact as Record<string, unknown>)
          : {};
      projectedDelta = -Number(
        impact.projected_balance_delta_cents ?? confirmedDelta * -1
      );
      freeDeltaOverride = -Number(
        impact.free_balance_delta_cents ?? confirmedDelta * -1
      );
    } else if (action.actionType === "transfer.create") {
      const result =
        action.resultSnapshot && typeof action.resultSnapshot === "object"
          ? (action.resultSnapshot as Record<string, unknown>)
          : {};
      const sourceTransactionId = Number(result.sourceTransactionId);
      const destinationTransactionId = Number(result.destinationTransactionId);
      if (
        !Number.isInteger(sourceTransactionId) ||
        sourceTransactionId <= 0 ||
        !Number.isInteger(destinationTransactionId) ||
        destinationTransactionId <= 0
      )
        throw new Error("Par da transferencia indisponivel");
      const sourceReversal = await reverseTransactionInsideAction(
        tx,
        scope,
        sourceTransactionId,
        `${idempotencyKey}:source`,
        reason
      );
      const destinationReversal = await reverseTransactionInsideAction(
        tx,
        scope,
        destinationTransactionId,
        `${idempotencyKey}:destination`,
        reason
      );
      confirmedDelta =
        -transactionEffect(sourceReversal.transaction) -
        transactionEffect(destinationReversal.transaction);
      const impact =
        result.financial_impact && typeof result.financial_impact === "object"
          ? (result.financial_impact as Record<string, unknown>)
          : {};
      projectedDelta = -Number(impact.projected_balance_delta_cents ?? 0);
      freeDeltaOverride = -Number(impact.free_balance_delta_cents ?? 0);
      warnings.push("Transferencia interna revertida nas duas contas.");
    } else if (action.actionType === "account.balance.update") {
      const before =
        action.beforeSnapshot && typeof action.beforeSnapshot === "object"
          ? (action.beforeSnapshot as Record<string, unknown>)
          : null;
      const after =
        action.afterSnapshot && typeof action.afterSnapshot === "object"
          ? (action.afterSnapshot as Record<string, unknown>)
          : null;
      const accountId = Number(action.entityId);
      const beforeBalance = Number(before?.currentBalanceCents);
      const afterBalance = Number(after?.currentBalanceCents);
      if (
        !before ||
        !after ||
        !Number.isInteger(accountId) ||
        !Number.isSafeInteger(beforeBalance) ||
        !Number.isSafeInteger(afterBalance)
      )
        throw new Error("Snapshot anterior do saldo indisponivel");
      const [current] = await tx
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, accountId),
            eq(financialAccounts.tenantId, scope.tenantId),
            eq(financialAccounts.userId, scope.userId)
          )
        )
        .limit(1)
        .for("update");
      if (!current) throw new Error("Conta financeira nao encontrada");
      if (current.currentBalanceCents !== afterBalance)
        throw new Error(
          "O saldo mudou depois da confirmacao; desfazer poderia apagar movimentos posteriores"
        );
      await tx
        .update(financialAccounts)
        .set({
          currentBalanceCents: beforeBalance,
          balanceAsOf:
            typeof before.balanceAsOf === "string"
              ? new Date(before.balanceAsOf)
              : null,
          needsConfirmation: Boolean(before.needsConfirmation),
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, accountId));
      confirmedDelta = beforeBalance - afterBalance;
      freeDeltaOverride =
        current.includeInOperatingCash && !current.protected
          ? confirmedDelta
          : 0;
    } else if (
      action.actionType === "account.update" ||
      action.actionType === "account.archive"
    ) {
      const before =
        action.beforeSnapshot && typeof action.beforeSnapshot === "object"
          ? (action.beforeSnapshot as Record<string, unknown>)
          : null;
      const accountId = Number(action.entityId);
      if (!before || !Number.isInteger(accountId))
        throw new Error("Snapshot anterior da conta indisponivel");
      if (action.actionType === "account.archive") {
        await tx
          .update(financialAccounts)
          .set({ active: true, updatedAt: new Date() })
          .where(
            and(
              eq(financialAccounts.id, accountId),
              eq(financialAccounts.tenantId, scope.tenantId),
              eq(financialAccounts.userId, scope.userId)
            )
          );
      } else {
        await tx
          .update(financialAccounts)
          .set({
            name: String(before.name),
            code: typeof before.code === "string" ? before.code : null,
            institution:
              typeof before.institution === "string"
                ? before.institution
                : null,
            includeInOperatingCash: Boolean(before.includeInOperatingCash),
            protected: Boolean(before.protected),
            needsConfirmation: Boolean(before.needsConfirmation),
            closingDay:
              typeof before.closingDay === "number" ? before.closingDay : null,
            dueDay: typeof before.dueDay === "number" ? before.dueDay : null,
            creditLimitCents:
              typeof before.creditLimitCents === "number"
                ? before.creditLimitCents
                : null,
            paymentAccountId:
              typeof before.paymentAccountId === "number"
                ? before.paymentAccountId
                : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(financialAccounts.id, accountId),
              eq(financialAccounts.tenantId, scope.tenantId),
              eq(financialAccounts.userId, scope.userId)
            )
          );
      }
    } else if (action.actionType === "account.create") {
      const accountId = Number(action.entityId);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(financialTransactions)
        .where(eq(financialTransactions.accountId, accountId));
      if (count > 0)
        throw new Error(
          "Conta com movimentacoes nao pode ser arquivada por desfazer"
        );
      await tx
        .update(financialAccounts)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(financialAccounts.id, accountId));
    } else if (action.actionType === "recurrence.create") {
      const ruleId = Number(action.entityId);
      const settled = await tx
        .select({ id: financialSettlements.id })
        .from(financialSettlements)
        .innerJoin(
          financialItems,
          eq(financialSettlements.financialItemId, financialItems.id)
        )
        .where(eq(financialItems.recurrenceId, ruleId))
        .limit(1);
      if (settled.length > 0)
        throw new Error("Recorrencia com liquidacao exige cancelamento futuro");
      await tx
        .update(recurrenceRules)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(recurrenceRules.id, ruleId));
      await tx
        .update(financialItems)
        .set({
          status: "cancelled",
          openAmountCents: 0,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(financialItems.recurrenceId, ruleId));
    } else if (
      action.actionType === "installment_plan.create" ||
      action.actionType === "card_purchase.create"
    ) {
      const planId = Number(action.entityId);
      const settled = await tx
        .select({ id: financialSettlements.id })
        .from(financialSettlements)
        .innerJoin(
          financialItems,
          eq(financialSettlements.financialItemId, financialItems.id)
        )
        .where(eq(financialItems.installmentPlanId, planId))
        .limit(1);
      if (settled.length > 0)
        throw new Error("Plano com parcela liquidada exige estorno individual");
      await tx
        .update(financialItems)
        .set({
          status: "cancelled",
          openAmountCents: 0,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(financialItems.installmentPlanId, planId));
      const [plan] = await tx
        .update(installmentPlans)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(installmentPlans.id, planId))
        .returning();
      if (action.actionType === "card_purchase.create") {
        const metadata =
          plan?.metadata && typeof plan.metadata === "object"
            ? (plan.metadata as Record<string, unknown>)
            : {};
        const purchaseTransactionId = Number(metadata.purchaseTransactionId);
        if (Number.isInteger(purchaseTransactionId)) {
          const reversed = await reverseTransactionInsideAction(
            tx,
            scope,
            purchaseTransactionId,
            `${idempotencyKey}:purchase`,
            reason
          );
          confirmedDelta -= transactionEffect(reversed.transaction);
        }
      }
    } else {
      throw new Error(
        `Acao ${action.actionType} ainda nao possui reversao segura`
      );
    }

    const reversedAt = new Date();
    await tx
      .update(financialActions)
      .set({ reversedAt })
      .where(eq(financialActions.id, action.id));
    const [undoAction] = await tx
      .insert(financialActions)
      .values({
        ...scope,
        conversationId: context.conversationId ?? action.conversationId,
        messageId: context.messageId ?? null,
        actionType: "action.undo",
        entityType: action.entityType,
        entityId: action.entityId,
        beforeSnapshot: action.afterSnapshot,
        afterSnapshot: action.beforeSnapshot,
        idempotencyKey,
        reversibleUntil: null,
      })
      .returning();
    const result = createWriteResult({
      actionId: undoAction.id,
      entityType: action.entityType,
      entityId: action.entityId,
      operation: "reversed",
      summary: `Acao ${action.id} revertida com trilha de auditoria.`,
      confirmedDelta,
      projectedDelta,
      freeDelta: freeDeltaOverride ?? confirmedDelta + projectedDelta,
      warnings,
    });
    await tx
      .update(financialActions)
      .set({ resultSnapshot: result })
      .where(eq(financialActions.id, undoAction.id));
    await tx.insert(financialAuditEvents).values({
      ...scope,
      actorType: context.actor.type,
      actorId: context.actor.id ?? null,
      action: "financial_action.reversed",
      entityType: action.entityType,
      entityId: action.entityId,
      before: action.afterSnapshot,
      after: action.beforeSnapshot,
      requestId: idempotencyKey,
    });
    return { reversedAction: action, result, alreadyProcessed: false };
  });
}
