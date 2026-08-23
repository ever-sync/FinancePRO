import { eq, and, sql, desc, asc, ne, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "crypto";
import postgres from "postgres";
import {
  InsertUser,
  users,
  tenants,
  settings,
  InsertSettings,
  bankConnections,
  InsertBankConnection,
  revenues,
  InsertRevenue,
  companyFixedCosts,
  InsertCompanyFixedCost,
  companyVariableCosts,
  InsertCompanyVariableCost,
  employees,
  InsertEmployee,
  suppliers,
  InsertSupplier,
  supplierPurchases,
  InsertSupplierPurchase,
  personalFixedCosts,
  InsertPersonalFixedCost,
  personalVariableCosts,
  InsertPersonalVariableCost,
  debts,
  InsertDebt,
  investments,
  InsertInvestment,
  reserveFunds,
  InsertReserveFund,
  clients,
  InsertClient,
  services,
  InsertService,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import type {
  PaginationParams,
  PaginatedResult,
  PaginatedResultWithSummary,
} from "./db/utils/pagination";
import { calculatePagination, resolvePagination } from "./db/utils/pagination";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _client = postgres(process.env.DATABASE_URL);
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _client = null;
      _db = null;
    }
  }
  return _db;
}

export async function closeDb() {
  const client = _client;
  _client = null;
  _db = null;
  if (client) await client.end({ timeout: 5 });
}

function normalizeInstallmentCount(value?: number | null) {
  const count = Number(value ?? 1);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.floor(count);
}

function splitAmountIntoInstallments(
  totalAmount: string,
  installmentCount: number
) {
  const parsed = Number(totalAmount);
  const totalCents = Number.isFinite(parsed)
    ? Math.max(0, Math.round(parsed * 100))
    : 0;
  const baseCents = Math.floor(totalCents / installmentCount);
  const remainder = totalCents % installmentCount;

  return Array.from({ length: installmentCount }, (_, index) => {
    const cents = baseCents + (index < remainder ? 1 : 0);
    return (cents / 100).toFixed(2);
  });
}

function addMonthsToIsoDate(dateStr: string, offset: number) {
  const [yearPart, monthPart, dayPart] = dateStr.split("-").map(Number);
  if (!yearPart || !monthPart || !dayPart) return dateStr;

  const monthIndex = monthPart - 1 + offset;
  const targetYear = yearPart + Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0)
  ).getUTCDate();
  const targetDay = Math.min(dayPart, lastDay);

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

const DASHBOARD_MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function toNumber(value: string | number | null | undefined) {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowsFromResult<T>(
  value: T[] | PaginatedResult<T> | null | undefined
): T[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function parseDateParts(value?: string | null) {
  if (!value) return null;
  const [yearPart, monthPart, dayPart] = value.split("-").map(Number);
  if (!yearPart || !monthPart || !dayPart) return null;
  return { year: yearPart, month: monthPart, day: dayPart };
}

function monthSerial(year: number, month: number) {
  return year * 12 + month;
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(month: number, year: number, offset: number) {
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

function buildRollingMonths(month: number, year: number, count = 8) {
  return Array.from({ length: count }, (_, index) => {
    const shifted = shiftMonth(month, year, index - count + 1);
    return {
      ...shifted,
      key: monthKey(shifted.year, shifted.month),
      label: DASHBOARD_MONTH_LABELS[shifted.month - 1] ?? `M${shifted.month}`,
    };
  });
}

function buildYearMonths(year: number) {
  return Array.from({ length: 12 }, (_, index) => ({
    year,
    month: index + 1,
    key: monthKey(year, index + 1),
    label: DASHBOARD_MONTH_LABELS[index] ?? `M${index + 1}`,
  }));
}

function isSameMonthYear(
  value: string | null | undefined,
  month: number,
  year: number
) {
  const parts = parseDateParts(value);
  return parts ? parts.month === month && parts.year === year : false;
}

function isOnOrBeforeMonthYear(
  value: string | null | undefined,
  month: number,
  year: number
) {
  const parts = parseDateParts(value);
  return parts
    ? monthSerial(parts.year, parts.month) <= monthSerial(year, month)
    : false;
}

function formatDashboardDate(month: number, year: number, day: number) {
  return `${String(day).padStart(2, "0")} ${DASHBOARD_MONTH_LABELS[month - 1] ?? `M${month}`}, ${year}`;
}

type DashboardWallet = {
  code: string;
  label: string;
  amount: number;
  status: "Ativa" | "Inativa";
  tone: "emerald" | "amber" | "slate";
  progress: number;
};

type DashboardActivity = {
  orderId: string;
  activity: string;
  price: number;
  status: "Concluído" | "Pendente" | "Em andamento";
  date: string;
  kind:
    | "revenue"
    | "fixedCost"
    | "variableCost"
    | "purchase"
    | "payroll"
    | "reserve";
  tone: "emerald" | "rose" | "amber" | "blue";
  sortKey: number;
};

function getActivitySortKey(year: number, month: number, day: number) {
  return monthSerial(year, month) * 100 + day;
}

// ==================== USERS ====================
type UpsertUserInput = Omit<InsertUser, "tenantId"> & {
  tenantId?: number;
};

export async function upsertUser(user: UpsertUserInput): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    await db.transaction(async tx => {
      const [existingUser] = await tx
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(eq(users.openId, user.openId))
        .limit(1);

      let tenantId = user.tenantId ?? existingUser?.tenantId;
      if (!tenantId) {
        const [createdTenant] = await tx
          .insert(tenants)
          .values({
            ownerOpenId: user.openId,
            name: user.name?.trim() || "Minha conta",
          })
          .onConflictDoNothing()
          .returning({ id: tenants.id });
        if (createdTenant) {
          tenantId = createdTenant.id;
        } else {
          const [existingTenant] = await tx
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.ownerOpenId, user.openId))
            .limit(1);
          tenantId = existingTenant?.id;
        }
      }
      if (!tenantId) throw new Error("Could not resolve user tenant");

      const values: InsertUser = { openId: user.openId, tenantId };
      const updateSet: Record<string, unknown> = { tenantId };
      const textFields = ["name", "email", "loginMethod"] as const;
      type TextField = (typeof textFields)[number];
      const assignNullable = (field: TextField) => {
        const value = user[field];
        if (value === undefined) return;
        const normalized = value ?? null;
        values[field] = normalized;
        updateSet[field] = normalized;
      };
      textFields.forEach(assignNullable);
      if (user.lastSignedIn !== undefined) {
        values.lastSignedIn = user.lastSignedIn;
        updateSet.lastSignedIn = user.lastSignedIn;
      }
      if (user.role !== undefined) {
        values.role = user.role;
        updateSet.role = user.role;
      } else if (user.openId === ENV.ownerOpenId) {
        values.role = "admin";
        updateSet.role = "admin";
      }
      if (!values.lastSignedIn) values.lastSignedIn = new Date();
      await tx
        .insert(users)
        .values(values)
        .onConflictDoUpdate({ target: users.openId, set: updateSet });
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== SETTINGS ====================
export async function getSettings(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertSettings(data: InsertSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getSettings(data.userId);
  if (existing) {
    await db.update(settings).set(data).where(eq(settings.userId, data.userId));
    return { ...existing, ...data };
  } else {
    await db.insert(settings).values(data);
    return data;
  }
}

// ==================== BANK CONNECTIONS ====================
export async function listBankConnections(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.userId, userId))
    .orderBy(desc(bankConnections.updatedAt));
}

export async function getBankConnectionById(
  userId: number,
  connectionId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.userId, userId),
        eq(bankConnections.id, connectionId)
      )
    )
    .limit(1);
  return record;
}

export async function upsertBankConnection(
  userId: number,
  data: Partial<InsertBankConnection> & {
    id?: number;
    label: string;
    institution: string;
    provider: string;
    sourceKind: string;
    scope: string;
    syncMode: string;
    status: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.id) {
    await db
      .update(bankConnections)
      .set({
        label: data.label,
        institution: data.institution,
        provider: data.provider,
        sourceKind: data.sourceKind,
        scope: data.scope,
        syncMode: data.syncMode,
        status: data.status,
        notes: data.notes ?? null,
        lastSyncStatus: data.lastSyncStatus ?? undefined,
        lastSyncError: data.lastSyncError ?? undefined,
      })
      .where(
        and(eq(bankConnections.id, data.id), eq(bankConnections.userId, userId))
      );
    return getBankConnectionById(userId, data.id);
  }

  const [created] = await db
    .insert(bankConnections)
    .values({
      userId,
      label: data.label,
      institution: data.institution,
      provider: data.provider,
      sourceKind: data.sourceKind,
      scope: data.scope,
      syncMode: data.syncMode,
      status: data.status,
      notes: data.notes ?? null,
      lastSyncStatus: data.lastSyncStatus ?? null,
      lastSyncError: data.lastSyncError ?? null,
    })
    .returning();
  return created;
}

export async function deleteBankConnection(
  userId: number,
  connectionId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(bankConnections)
    .where(
      and(
        eq(bankConnections.userId, userId),
        eq(bankConnections.id, connectionId)
      )
    );
}

export async function markBankConnectionImported(
  userId: number,
  connectionId: number,
  importedAt = new Date()
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bankConnections)
    .set({
      lastImportedAt: importedAt,
      status: "pronta",
      lastSyncStatus: "imported",
      lastSyncError: null,
    })
    .where(
      and(
        eq(bankConnections.userId, userId),
        eq(bankConnections.id, connectionId)
      )
    );
  return getBankConnectionById(userId, connectionId);
}

export async function requestBankConnectionSync(
  userId: number,
  connectionId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bankConnections)
    .set({
      lastSyncRequestedAt: new Date(),
      lastSyncStatus: "pending_provider_setup",
      lastSyncError: null,
    })
    .where(
      and(
        eq(bankConnections.userId, userId),
        eq(bankConnections.id, connectionId)
      )
    );
  return getBankConnectionById(userId, connectionId);
}

export async function updateBankConnectionSyncState(
  userId: number,
  connectionId: number,
  data: {
    status?: string;
    lastSyncStatus?: string | null;
    lastSyncError?: string | null;
    lastSyncRequestedAt?: Date | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(bankConnections)
    .set({
      status: data.status ?? undefined,
      lastSyncStatus: data.lastSyncStatus ?? undefined,
      lastSyncError: data.lastSyncError ?? undefined,
      lastSyncRequestedAt: data.lastSyncRequestedAt ?? undefined,
    })
    .where(
      and(
        eq(bankConnections.userId, userId),
        eq(bankConnections.id, connectionId)
      )
    );
  return getBankConnectionById(userId, connectionId);
}

// ==================== REVENUES ====================
export async function getRevenues(
  userId: number,
  month?: number,
  year?: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof revenues.$inferSelect,
    {
      totalGross: string;
      totalNet: string;
      totalReceived: string;
    }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: {
        totalGross: "0.00",
        totalNet: "0.00",
        totalReceived: "0.00",
      },
    };

  const conditions = [eq(revenues.userId, userId)];
  if (month !== undefined && year !== undefined) {
    conditions.push(
      sql`EXTRACT(MONTH FROM ${revenues.dueDate}::date) = ${month}`
    );
    conditions.push(
      sql`EXTRACT(YEAR FROM ${revenues.dueDate}::date) = ${year}`
    );
  }

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      totalGross: sql<string>`COALESCE(SUM(${revenues.grossAmount}), 0)`,
      totalNet: sql<string>`COALESCE(SUM(${revenues.netAmount}), 0)`,
      totalReceived: sql<string>`COALESCE(SUM(CASE WHEN ${revenues.status} = 'recebido' THEN ${revenues.grossAmount} ELSE 0 END), 0)`,
    })
    .from(revenues)
    .where(and(...conditions));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "dueDate";
  const sortOrder = pagination?.sortOrder ?? "desc";

  const orderByColumn = (revenues as any)[sortBy] || revenues.dueDate;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const data = await db
    .select()
    .from(revenues)
    .where(and(...conditions))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      totalGross: String(summaryResult[0]?.totalGross ?? "0.00"),
      totalNet: String(summaryResult[0]?.totalNet ?? "0.00"),
      totalReceived: String(summaryResult[0]?.totalReceived ?? "0.00"),
    },
  };
}

export async function getRevenueById(userId: number, revenueId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(revenues)
    .where(and(eq(revenues.userId, userId), eq(revenues.id, revenueId)))
    .limit(1);
  return record;
}

export async function createRevenue(data: InsertRevenue) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(revenues)
    .values(data)
    .returning({ id: revenues.id });
  return { id: inserted.id, ...data };
}

export async function updateRevenue(
  id: number,
  userId: number,
  data: Partial<InsertRevenue>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(revenues)
    .set(data)
    .where(and(eq(revenues.id, id), eq(revenues.userId, userId)));
}

export async function deleteRevenue(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(revenues)
    .where(and(eq(revenues.id, id), eq(revenues.userId, userId)));
}

export async function deleteRevenueSeries(seriesId: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(revenues)
    .where(and(eq(revenues.seriesId, seriesId), eq(revenues.userId, userId)));
}

export async function updateRevenueSeries(
  seriesId: string,
  userId: number,
  data: Partial<InsertRevenue>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(revenues)
    .set(data)
    .where(and(eq(revenues.seriesId, seriesId), eq(revenues.userId, userId)));
}

// ==================== COMPANY FIXED COSTS ====================
export async function getCompanyFixedCosts(
  userId: number,
  month?: number,
  year?: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof companyFixedCosts.$inferSelect,
    { totalAmount: string; paidAmount: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: { totalAmount: "0.00", paidAmount: "0.00" },
    };

  const conditions = [eq(companyFixedCosts.userId, userId)];
  if (month !== undefined) conditions.push(eq(companyFixedCosts.month, month));
  if (year !== undefined) conditions.push(eq(companyFixedCosts.year, year));

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      totalAmount: sql<string>`COALESCE(SUM(${companyFixedCosts.amount}), 0)`,
      paidAmount: sql<string>`COALESCE(SUM(CASE WHEN ${companyFixedCosts.status} = 'pago' THEN ${companyFixedCosts.amount} ELSE 0 END), 0)`,
    })
    .from(companyFixedCosts)
    .where(and(...conditions));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "dueDay";
  const sortOrder = pagination?.sortOrder ?? "asc";

  const orderByColumn =
    (companyFixedCosts as any)[sortBy] || companyFixedCosts.dueDay;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const existing = await db
    .select()
    .from(companyFixedCosts)
    .where(and(...conditions))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  // Auto-propagate: if querying a specific month with no records, copy from most recent month
  if (
    existing.length === 0 &&
    month !== undefined &&
    year !== undefined &&
    page === 1
  ) {
    const allRecords = await db
      .select()
      .from(companyFixedCosts)
      .where(eq(companyFixedCosts.userId, userId))
      .orderBy(desc(companyFixedCosts.year), desc(companyFixedCosts.month));
    if (allRecords.length > 0) {
      const srcYear = allRecords[0].year;
      const srcMonth = allRecords[0].month;
      if (year * 12 + month > srcYear * 12 + srcMonth) {
        const templates = allRecords.filter(
          r => r.year === srcYear && r.month === srcMonth
        );
        await db.insert(companyFixedCosts).values(
          templates.map(t => ({
            userId,
            description: t.description,
            category: t.category,
            amount: t.amount,
            dueDay: t.dueDay,
            month,
            year,
            status: "pendente" as const,
          }))
        );
        const newSummaryResult = await db
          .select({
            count: count(),
            totalAmount: sql<string>`COALESCE(SUM(${companyFixedCosts.amount}), 0)`,
            paidAmount: sql<string>`COALESCE(SUM(CASE WHEN ${companyFixedCosts.status} = 'pago' THEN ${companyFixedCosts.amount} ELSE 0 END), 0)`,
          })
          .from(companyFixedCosts)
          .where(and(...conditions));
        const newTotal = Number(newSummaryResult[0]?.count ?? 0);
        const hydratedPagination = resolvePagination(pagination, newTotal);
        const newData = await db
          .select()
          .from(companyFixedCosts)
          .where(and(...conditions))
          .orderBy(orderFunc(orderByColumn))
          .limit(hydratedPagination.limit)
          .offset((hydratedPagination.page - 1) * hydratedPagination.limit);

        return {
          data: newData,
          pagination: calculatePagination(
            hydratedPagination.page,
            hydratedPagination.limit,
            newTotal
          ),
          summary: {
            totalAmount: String(newSummaryResult[0]?.totalAmount ?? "0.00"),
            paidAmount: String(newSummaryResult[0]?.paidAmount ?? "0.00"),
          },
        };
      }
    }
  }

  return {
    data: existing,
    pagination: calculatePagination(page, limit, total),
    summary: {
      totalAmount: String(summaryResult[0]?.totalAmount ?? "0.00"),
      paidAmount: String(summaryResult[0]?.paidAmount ?? "0.00"),
    },
  };
}

export async function createCompanyFixedCost(data: InsertCompanyFixedCost) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(companyFixedCosts)
    .values(data)
    .returning({ id: companyFixedCosts.id });
  return { id: inserted.id, ...data };
}

export async function updateCompanyFixedCost(
  id: number,
  userId: number,
  data: Partial<InsertCompanyFixedCost>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(companyFixedCosts)
    .set(data)
    .where(
      and(eq(companyFixedCosts.id, id), eq(companyFixedCosts.userId, userId))
    );
}

export async function deleteCompanyFixedCost(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(companyFixedCosts)
    .where(
      and(eq(companyFixedCosts.id, id), eq(companyFixedCosts.userId, userId))
    );
}

// ==================== COMPANY VARIABLE COSTS ====================
export async function getCompanyVariableCosts(
  userId: number,
  month?: number,
  year?: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof companyVariableCosts.$inferSelect,
    { totalAmount: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: { totalAmount: "0.00" },
    };

  const conditions = [eq(companyVariableCosts.userId, userId)];
  if (month !== undefined && year !== undefined) {
    conditions.push(
      sql`EXTRACT(MONTH FROM ${companyVariableCosts.date}::date) = ${month}`
    );
    conditions.push(
      sql`EXTRACT(YEAR FROM ${companyVariableCosts.date}::date) = ${year}`
    );
  }

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      totalAmount: sql<string>`COALESCE(SUM(${companyVariableCosts.amount}), 0)`,
    })
    .from(companyVariableCosts)
    .where(and(...conditions));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "date";
  const sortOrder = pagination?.sortOrder ?? "desc";

  const orderByColumn =
    (companyVariableCosts as any)[sortBy] || companyVariableCosts.date;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const data = await db
    .select()
    .from(companyVariableCosts)
    .where(and(...conditions))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      totalAmount: String(summaryResult[0]?.totalAmount ?? "0.00"),
    },
  };
}

export async function createCompanyVariableCost(
  data: InsertCompanyVariableCost
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const installmentCount = normalizeInstallmentCount(data.installmentCount);
  const installmentSeriesId = installmentCount > 1 ? randomUUID() : null;
  const installmentAmounts = splitAmountIntoInstallments(
    data.amount,
    installmentCount
  );
  const rows = installmentAmounts.map((amount, index) => ({
    ...data,
    amount,
    date: addMonthsToIsoDate(data.date, index),
    installmentSeriesId,
    installmentCount,
    installmentNumber: index + 1,
  }));
  const inserted = await db
    .insert(companyVariableCosts)
    .values(rows)
    .returning({ id: companyVariableCosts.id });
  return { id: inserted[0].id, ...rows[0] };
}

export async function updateCompanyVariableCost(
  id: number,
  userId: number,
  data: Partial<InsertCompanyVariableCost>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(companyVariableCosts)
    .set(data)
    .where(
      and(
        eq(companyVariableCosts.id, id),
        eq(companyVariableCosts.userId, userId)
      )
    );
}

export async function deleteCompanyVariableCost(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(companyVariableCosts)
    .where(
      and(
        eq(companyVariableCosts.id, id),
        eq(companyVariableCosts.userId, userId)
      )
    );
}

// ==================== EMPLOYEES ====================
export async function getEmployees(
  userId: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof employees.$inferSelect,
    {
      activeCount: number;
      totalActiveSalary: string;
      totalActiveCost: string;
    }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: {
        activeCount: 0,
        totalActiveSalary: "0.00",
        totalActiveCost: "0.00",
      },
    };

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      activeCount: sql<number>`COUNT(*) FILTER (WHERE ${employees.status} = 'ativo')`,
      totalActiveSalary: sql<string>`COALESCE(SUM(CASE WHEN ${employees.status} = 'ativo' THEN ${employees.salary} ELSE 0 END), 0)`,
      totalActiveCost: sql<string>`COALESCE(SUM(CASE WHEN ${employees.status} = 'ativo' THEN ${employees.totalCost} ELSE 0 END), 0)`,
    })
    .from(employees)
    .where(eq(employees.userId, userId));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "name";
  const sortOrder = pagination?.sortOrder ?? "asc";

  const orderByColumn = (employees as any)[sortBy] || employees.name;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const data = await db
    .select()
    .from(employees)
    .where(eq(employees.userId, userId))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      activeCount: Number(summaryResult[0]?.activeCount ?? 0),
      totalActiveSalary: String(summaryResult[0]?.totalActiveSalary ?? "0.00"),
      totalActiveCost: String(summaryResult[0]?.totalActiveCost ?? "0.00"),
    },
  };
}

export async function createEmployee(data: InsertEmployee) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(employees)
    .values(data)
    .returning({ id: employees.id });
  return { id: inserted.id, ...data };
}

export async function updateEmployee(
  id: number,
  userId: number,
  data: Partial<InsertEmployee>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(employees)
    .set(data)
    .where(and(eq(employees.id, id), eq(employees.userId, userId)));
}

export async function deleteEmployee(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(employees)
    .where(and(eq(employees.id, id), eq(employees.userId, userId)));
}

// ==================== SUPPLIERS ====================
export async function getSuppliers(
  userId: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof suppliers.$inferSelect,
    { categoryCount: number }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: { categoryCount: 0 },
    };

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      categoryCount: sql<number>`COUNT(DISTINCT ${suppliers.category}) FILTER (WHERE ${suppliers.category} IS NOT NULL AND ${suppliers.category} <> '')`,
    })
    .from(suppliers)
    .where(eq(suppliers.userId, userId));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "name";
  const sortOrder = pagination?.sortOrder ?? "asc";

  const orderByColumn = (suppliers as any)[sortBy] || suppliers.name;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const data = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.userId, userId))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      categoryCount: Number(summaryResult[0]?.categoryCount ?? 0),
    },
  };
}

export async function createSupplier(data: InsertSupplier) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(suppliers)
    .values(data)
    .returning({ id: suppliers.id });
  return { id: inserted.id, ...data };
}

export async function updateSupplier(
  id: number,
  userId: number,
  data: Partial<InsertSupplier>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(suppliers)
    .set(data)
    .where(and(eq(suppliers.id, id), eq(suppliers.userId, userId)));
}

export async function deleteSupplier(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.userId, userId)));
}

// ==================== SUPPLIER PURCHASES ====================
export async function getSupplierPurchases(
  userId: number,
  month?: number,
  year?: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResult<typeof supplierPurchases.$inferSelect> & {
    totalAmount: string;
  }
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      totalAmount: "0.00",
    };

  const conditions = [eq(supplierPurchases.userId, userId)];
  if (month !== undefined && year !== undefined) {
    conditions.push(
      sql`EXTRACT(MONTH FROM ${supplierPurchases.dueDate}::date) = ${month}`
    );
    conditions.push(
      sql`EXTRACT(YEAR FROM ${supplierPurchases.dueDate}::date) = ${year}`
    );
  }

  // Contagem total
  const countResult = await db
    .select({
      count: count(),
      totalAmount: sql<string>`COALESCE(SUM(${supplierPurchases.amount}), 0)`,
    })
    .from(supplierPurchases)
    .where(and(...conditions));
  const total = Number(countResult[0]?.count ?? 0);
  const totalAmount = String(countResult[0]?.totalAmount ?? "0.00");

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "dueDate";
  const sortOrder = pagination?.sortOrder ?? "desc";

  const orderByColumn =
    (supplierPurchases as any)[sortBy] || supplierPurchases.dueDate;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const data = await db
    .select()
    .from(supplierPurchases)
    .where(and(...conditions))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    totalAmount,
  };
}

export async function createSupplierPurchase(data: InsertSupplierPurchase) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(supplierPurchases)
    .values(data)
    .returning({ id: supplierPurchases.id });
  return { id: inserted.id, ...data };
}

export async function updateSupplierPurchase(
  id: number,
  userId: number,
  data: Partial<InsertSupplierPurchase>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(supplierPurchases)
    .set(data)
    .where(
      and(eq(supplierPurchases.id, id), eq(supplierPurchases.userId, userId))
    );
}

export async function deleteSupplierPurchase(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(supplierPurchases)
    .where(
      and(eq(supplierPurchases.id, id), eq(supplierPurchases.userId, userId))
    );
}

// ==================== PERSONAL FIXED COSTS ====================
export async function getPersonalFixedCosts(
  userId: number,
  month?: number,
  year?: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof personalFixedCosts.$inferSelect,
    { totalAmount: string; paidAmount: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: { totalAmount: "0.00", paidAmount: "0.00" },
    };

  const conditions = [eq(personalFixedCosts.userId, userId)];
  if (month !== undefined) conditions.push(eq(personalFixedCosts.month, month));
  if (year !== undefined) conditions.push(eq(personalFixedCosts.year, year));

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      totalAmount: sql<string>`COALESCE(SUM(${personalFixedCosts.amount}), 0)`,
      paidAmount: sql<string>`COALESCE(SUM(CASE WHEN ${personalFixedCosts.status} = 'pago' THEN ${personalFixedCosts.amount} ELSE 0 END), 0)`,
    })
    .from(personalFixedCosts)
    .where(and(...conditions));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "dueDay";
  const sortOrder = pagination?.sortOrder ?? "asc";

  const orderByColumn =
    (personalFixedCosts as any)[sortBy] || personalFixedCosts.dueDay;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const existing = await db
    .select()
    .from(personalFixedCosts)
    .where(and(...conditions))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  // Auto-propagate: if querying a specific month with no records, copy from most recent month
  if (
    existing.length === 0 &&
    month !== undefined &&
    year !== undefined &&
    page === 1
  ) {
    const allRecords = await db
      .select()
      .from(personalFixedCosts)
      .where(eq(personalFixedCosts.userId, userId))
      .orderBy(desc(personalFixedCosts.year), desc(personalFixedCosts.month));
    if (allRecords.length > 0) {
      const srcYear = allRecords[0].year;
      const srcMonth = allRecords[0].month;
      if (year * 12 + month > srcYear * 12 + srcMonth) {
        const templates = allRecords.filter(
          r => r.year === srcYear && r.month === srcMonth
        );
        await db.insert(personalFixedCosts).values(
          templates.map(t => ({
            userId,
            description: t.description,
            category: t.category,
            amount: t.amount,
            dueDay: t.dueDay,
            month,
            year,
            status: "pendente" as const,
          }))
        );
        const newSummaryResult = await db
          .select({
            count: count(),
            totalAmount: sql<string>`COALESCE(SUM(${personalFixedCosts.amount}), 0)`,
            paidAmount: sql<string>`COALESCE(SUM(CASE WHEN ${personalFixedCosts.status} = 'pago' THEN ${personalFixedCosts.amount} ELSE 0 END), 0)`,
          })
          .from(personalFixedCosts)
          .where(and(...conditions));
        const newTotal = Number(newSummaryResult[0]?.count ?? 0);
        const hydratedPagination = resolvePagination(pagination, newTotal);
        const newData = await db
          .select()
          .from(personalFixedCosts)
          .where(and(...conditions))
          .orderBy(orderFunc(orderByColumn))
          .limit(hydratedPagination.limit)
          .offset((hydratedPagination.page - 1) * hydratedPagination.limit);

        return {
          data: newData,
          pagination: calculatePagination(
            hydratedPagination.page,
            hydratedPagination.limit,
            newTotal
          ),
          summary: {
            totalAmount: String(newSummaryResult[0]?.totalAmount ?? "0.00"),
            paidAmount: String(newSummaryResult[0]?.paidAmount ?? "0.00"),
          },
        };
      }
    }
  }

  return {
    data: existing,
    pagination: calculatePagination(page, limit, total),
    summary: {
      totalAmount: String(summaryResult[0]?.totalAmount ?? "0.00"),
      paidAmount: String(summaryResult[0]?.paidAmount ?? "0.00"),
    },
  };
}

export async function createPersonalFixedCost(data: InsertPersonalFixedCost) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(personalFixedCosts)
    .values(data)
    .returning({ id: personalFixedCosts.id });
  return { id: inserted.id, ...data };
}

export async function updatePersonalFixedCost(
  id: number,
  userId: number,
  data: Partial<InsertPersonalFixedCost>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(personalFixedCosts)
    .set(data)
    .where(
      and(eq(personalFixedCosts.id, id), eq(personalFixedCosts.userId, userId))
    );
}

export async function deletePersonalFixedCost(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(personalFixedCosts)
    .where(
      and(eq(personalFixedCosts.id, id), eq(personalFixedCosts.userId, userId))
    );
}

// ==================== PERSONAL VARIABLE COSTS ====================
export async function getPersonalVariableCosts(
  userId: number,
  month?: number,
  year?: number,
  pagination?: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof personalVariableCosts.$inferSelect,
    { totalAmount: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, 20, 0),
      summary: { totalAmount: "0.00" },
    };

  const conditions = [eq(personalVariableCosts.userId, userId)];
  if (month !== undefined && year !== undefined) {
    conditions.push(
      sql`EXTRACT(MONTH FROM ${personalVariableCosts.date}::date) = ${month}`
    );
    conditions.push(
      sql`EXTRACT(YEAR FROM ${personalVariableCosts.date}::date) = ${year}`
    );
  }

  // Contagem total
  const summaryResult = await db
    .select({
      count: count(),
      totalAmount: sql<string>`COALESCE(SUM(${personalVariableCosts.amount}), 0)`,
    })
    .from(personalVariableCosts)
    .where(and(...conditions));
  const total = Number(summaryResult[0]?.count ?? 0);

  // Paginação e ordenação
  const { page, limit } = resolvePagination(pagination, total);
  const sortBy = pagination?.sortBy ?? "date";
  const sortOrder = pagination?.sortOrder ?? "desc";

  const orderByColumn =
    (personalVariableCosts as any)[sortBy] || personalVariableCosts.date;
  const orderFunc = sortOrder === "asc" ? asc : desc;

  const data = await db
    .select()
    .from(personalVariableCosts)
    .where(and(...conditions))
    .orderBy(orderFunc(orderByColumn))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      totalAmount: String(summaryResult[0]?.totalAmount ?? "0.00"),
    },
  };
}

export async function createPersonalVariableCost(
  data: InsertPersonalVariableCost
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const installmentCount = normalizeInstallmentCount(data.installmentCount);
  const installmentSeriesId = installmentCount > 1 ? randomUUID() : null;
  const installmentAmounts = splitAmountIntoInstallments(
    data.amount,
    installmentCount
  );
  const rows = installmentAmounts.map((amount, index) => ({
    ...data,
    amount,
    date: addMonthsToIsoDate(data.date, index),
    installmentSeriesId,
    installmentCount,
    installmentNumber: index + 1,
  }));
  const inserted = await db
    .insert(personalVariableCosts)
    .values(rows)
    .returning({ id: personalVariableCosts.id });
  return { id: inserted[0].id, ...rows[0] };
}

export async function updatePersonalVariableCost(
  id: number,
  userId: number,
  data: Partial<InsertPersonalVariableCost>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(personalVariableCosts)
    .set(data)
    .where(
      and(
        eq(personalVariableCosts.id, id),
        eq(personalVariableCosts.userId, userId)
      )
    );
}

export async function deletePersonalVariableCost(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(personalVariableCosts)
    .where(
      and(
        eq(personalVariableCosts.id, id),
        eq(personalVariableCosts.userId, userId)
      )
    );
}

// ==================== DEBTS ====================
export async function getDebts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(debts)
    .where(eq(debts.userId, userId))
    .orderBy(desc(debts.interestRate));
}

export async function getDebtsPage(
  userId: number,
  pagination: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof debts.$inferSelect,
    { openCount: number; totalBalance: string; totalMonthly: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, pagination.limit, 0),
      summary: { openCount: 0, totalBalance: "0.00", totalMonthly: "0.00" },
    };

  const [summary] = await db
    .select({
      count: count(),
      openCount: sql<number>`COUNT(*) FILTER (WHERE ${debts.status} <> 'quitada')`,
      totalBalance: sql<string>`COALESCE(SUM(CASE WHEN ${debts.status} <> 'quitada' THEN ${debts.currentBalance} ELSE 0 END), 0)`,
      totalMonthly: sql<string>`COALESCE(SUM(CASE WHEN ${debts.status} <> 'quitada' THEN ${debts.monthlyPayment} ELSE 0 END), 0)`,
    })
    .from(debts)
    .where(eq(debts.userId, userId));
  const total = Number(summary?.count ?? 0);
  const { page, limit } = resolvePagination(pagination, total);
  const data = await db
    .select()
    .from(debts)
    .where(eq(debts.userId, userId))
    .orderBy(desc(debts.interestRate), asc(debts.creditor))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      openCount: Number(summary?.openCount ?? 0),
      totalBalance: String(summary?.totalBalance ?? "0.00"),
      totalMonthly: String(summary?.totalMonthly ?? "0.00"),
    },
  };
}

export async function createDebt(data: InsertDebt) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(debts)
    .values(data)
    .returning({ id: debts.id });
  return { id: inserted.id, ...data };
}

export async function updateDebt(
  id: number,
  userId: number,
  data: Partial<InsertDebt>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(debts)
    .set(data)
    .where(and(eq(debts.id, id), eq(debts.userId, userId)));
}

export async function deleteDebt(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(debts).where(and(eq(debts.id, id), eq(debts.userId, userId)));
}

// ==================== INVESTMENTS ====================
export async function getInvestments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(investments)
    .where(eq(investments.userId, userId))
    .orderBy(desc(investments.date));
}

export async function getInvestmentsPage(
  userId: number,
  pagination: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof investments.$inferSelect,
    { totalDeposited: string; totalBalance: string; totalYield: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, pagination.limit, 0),
      summary: {
        totalDeposited: "0.00",
        totalBalance: "0.00",
        totalYield: "0.00",
      },
    };

  const [summary] = await db
    .select({
      count: count(),
      totalDeposited: sql<string>`COALESCE(SUM(${investments.depositAmount}), 0)`,
      totalBalance: sql<string>`COALESCE(SUM(${investments.currentBalance}), 0)`,
      totalYield: sql<string>`COALESCE(SUM(${investments.yieldAmount}), 0)`,
    })
    .from(investments)
    .where(eq(investments.userId, userId));
  const total = Number(summary?.count ?? 0);
  const { page, limit } = resolvePagination(pagination, total);
  const data = await db
    .select()
    .from(investments)
    .where(eq(investments.userId, userId))
    .orderBy(desc(investments.date), asc(investments.description))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      totalDeposited: String(summary?.totalDeposited ?? "0.00"),
      totalBalance: String(summary?.totalBalance ?? "0.00"),
      totalYield: String(summary?.totalYield ?? "0.00"),
    },
  };
}

export async function createInvestment(data: InsertInvestment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(investments)
    .values(data)
    .returning({ id: investments.id });
  return { id: inserted.id, ...data };
}

export async function updateInvestment(
  id: number,
  userId: number,
  data: Partial<InsertInvestment>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(investments)
    .set(data)
    .where(and(eq(investments.id, id), eq(investments.userId, userId)));
}

export async function deleteInvestment(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(investments)
    .where(and(eq(investments.id, id), eq(investments.userId, userId)));
}

// ==================== RESERVE FUNDS ====================
export async function getReserveFunds(
  userId: number,
  type?: "empresa" | "pessoal"
) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(reserveFunds.userId, userId)];
  if (type) conditions.push(eq(reserveFunds.type, type));
  return db
    .select()
    .from(reserveFunds)
    .where(and(...conditions))
    .orderBy(desc(reserveFunds.date));
}

export async function getReserveFundsPage(
  userId: number,
  type: "empresa" | "pessoal" | undefined,
  pagination: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof reserveFunds.$inferSelect,
    { totalAmount: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, pagination.limit, 0),
      summary: { totalAmount: "0.00" },
    };

  const conditions = [eq(reserveFunds.userId, userId)];
  if (type) conditions.push(eq(reserveFunds.type, type));
  const [summary] = await db
    .select({
      count: count(),
      totalAmount: sql<string>`COALESCE(SUM(${reserveFunds.depositAmount}), 0)`,
    })
    .from(reserveFunds)
    .where(and(...conditions));
  const total = Number(summary?.count ?? 0);
  const { page, limit } = resolvePagination(pagination, total);
  const data = await db
    .select()
    .from(reserveFunds)
    .where(and(...conditions))
    .orderBy(desc(reserveFunds.date), desc(reserveFunds.id))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: { totalAmount: String(summary?.totalAmount ?? "0.00") },
  };
}

export async function createReserveFund(data: InsertReserveFund) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(reserveFunds)
    .values(data)
    .returning({ id: reserveFunds.id });
  return { id: inserted.id, ...data };
}

export async function updateReserveFund(
  id: number,
  userId: number,
  data: Partial<InsertReserveFund>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(reserveFunds)
    .set(data)
    .where(and(eq(reserveFunds.id, id), eq(reserveFunds.userId, userId)));
}

export async function deleteReserveFund(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(reserveFunds)
    .where(and(eq(reserveFunds.id, id), eq(reserveFunds.userId, userId)));
}

// ==================== CLIENTS ====================
export async function getClients(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(clients)
    .where(eq(clients.userId, userId))
    .orderBy(asc(clients.name));
}

export async function getClientsPage(
  userId: number,
  pagination: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof clients.$inferSelect,
    { categoryCount: number }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, pagination.limit, 0),
      summary: { categoryCount: 0 },
    };

  const [summary] = await db
    .select({
      count: count(),
      categoryCount: sql<number>`COUNT(DISTINCT ${clients.category}) FILTER (WHERE ${clients.category} IS NOT NULL AND ${clients.category} <> '')`,
    })
    .from(clients)
    .where(eq(clients.userId, userId));
  const total = Number(summary?.count ?? 0);
  const { page, limit } = resolvePagination(pagination, total);
  const data = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, userId))
    .orderBy(asc(clients.name), asc(clients.id))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: { categoryCount: Number(summary?.categoryCount ?? 0) },
  };
}

export async function createClient(data: InsertClient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(clients)
    .values(data)
    .returning({ id: clients.id });
  return { id: inserted.id, ...data };
}

export async function updateClient(
  id: number,
  userId: number,
  data: Partial<InsertClient>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(clients)
    .set(data)
    .where(and(eq(clients.id, id), eq(clients.userId, userId)));
}

export async function deleteClient(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(clients)
    .where(and(eq(clients.id, id), eq(clients.userId, userId)));
}

// ==================== SERVICES ====================
export async function getServices(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(services)
    .where(eq(services.userId, userId))
    .orderBy(asc(services.name));
}

export async function getServicesPage(
  userId: number,
  pagination: PaginationParams
): Promise<
  PaginatedResultWithSummary<
    typeof services.$inferSelect,
    { activeCount: number; totalPortfolio: string }
  >
> {
  const db = await getDb();
  if (!db)
    return {
      data: [],
      pagination: calculatePagination(1, pagination.limit, 0),
      summary: { activeCount: 0, totalPortfolio: "0.00" },
    };

  const [summary] = await db
    .select({
      count: count(),
      activeCount: sql<number>`COUNT(*) FILTER (WHERE ${services.status} = 'ativo')`,
      totalPortfolio: sql<string>`COALESCE(SUM(${services.basePrice}), 0)`,
    })
    .from(services)
    .where(eq(services.userId, userId));
  const total = Number(summary?.count ?? 0);
  const { page, limit } = resolvePagination(pagination, total);
  const data = await db
    .select()
    .from(services)
    .where(eq(services.userId, userId))
    .orderBy(asc(services.name), asc(services.id))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    data,
    pagination: calculatePagination(page, limit, total),
    summary: {
      activeCount: Number(summary?.activeCount ?? 0),
      totalPortfolio: String(summary?.totalPortfolio ?? "0.00"),
    },
  };
}

export async function createService(data: InsertService) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(services)
    .values(data)
    .returning({ id: services.id });
  return { id: inserted.id, ...data };
}

export async function updateService(
  id: number,
  userId: number,
  data: Partial<InsertService>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(services)
    .set(data)
    .where(and(eq(services.id, id), eq(services.userId, userId)));
}

export async function deleteService(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(services)
    .where(and(eq(services.id, id), eq(services.userId, userId)));
}

// ==================== DASHBOARD SUMMARIES ====================
export async function getCompanyDashboardData(
  userId: number,
  month: number,
  year: number
) {
  const db = await getDb();
  if (!db) return null;

  // Ensure month-specific fixed costs are hydrated before we read the broader timeline.
  const currentFixedCosts = rowsFromResult(
    await getCompanyFixedCosts(userId, month, year)
  );

  const [
    revenueData,
    allFixedCostsData,
    variableCostData,
    employeeData,
    purchaseData,
    reserveRows,
    supplierData,
    userSettings,
  ] = await Promise.all([
    getRevenues(userId),
    getCompanyFixedCosts(userId),
    getCompanyVariableCosts(userId),
    getEmployees(userId),
    getSupplierPurchases(userId),
    getReserveFunds(userId, "empresa"),
    getSuppliers(userId),
    getSettings(userId),
  ]);
  const revenueRows = rowsFromResult(revenueData);
  const allFixedCosts = rowsFromResult(allFixedCostsData);
  const variableCostRows = rowsFromResult(variableCostData);
  const employeeRows = rowsFromResult(employeeData);
  const purchaseRows = rowsFromResult(purchaseData);
  const supplierRows = rowsFromResult(supplierData);

  const selectedSerial = monthSerial(year, month);
  const currentDate = new Date();
  const currentSerial = monthSerial(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1
  );
  const proLabore = toNumber(userSettings?.proLaboreGross);
  const supplierById = new Map(
    supplierRows.map(supplier => [supplier.id, supplier.name])
  );

  const activeEmployees = employeeRows
    .filter(employee => employee.status === "ativo")
    .map(employee => {
      const admissionParts = parseDateParts(employee.admissionDate);
      return {
        employee,
        admissionSerial: admissionParts
          ? monthSerial(admissionParts.year, admissionParts.month)
          : null,
      };
    });

  const summarizeMonth = (
    targetMonth: number,
    targetYear: number,
    label: string
  ) => {
    const targetSerial = monthSerial(targetYear, targetMonth);
    const monthRevenueRows = revenueRows.filter(
      row =>
        isSameMonthYear(row.dueDate, targetMonth, targetYear) &&
        row.status !== "cancelado"
    );
    const monthFixedRows = allFixedCosts.filter(
      row => row.month === targetMonth && row.year === targetYear
    );
    const monthVariableRows = variableCostRows.filter(row =>
      isSameMonthYear(row.date, targetMonth, targetYear)
    );
    const monthPurchaseRows = purchaseRows.filter(row =>
      isSameMonthYear(row.dueDate, targetMonth, targetYear)
    );
    const employeesForMonth = activeEmployees.filter(
      snapshot =>
        snapshot.admissionSerial === null ||
        snapshot.admissionSerial <= targetSerial
    );
    const reserveBalance = reserveRows.reduce((sum, row) => {
      const parts = parseDateParts(row.date);
      if (!parts) return sum;
      return monthSerial(parts.year, parts.month) <= targetSerial
        ? sum + toNumber(row.depositAmount)
        : sum;
    }, 0);

    const grossRevenue = monthRevenueRows.reduce(
      (sum, row) => sum + toNumber(row.grossAmount),
      0
    );
    const taxAmount = monthRevenueRows.reduce(
      (sum, row) => sum + toNumber(row.taxAmount),
      0
    );
    const netRevenue = monthRevenueRows.reduce(
      (sum, row) => sum + toNumber(row.netAmount),
      0
    );
    const fixedCostsTotal = monthFixedRows.reduce(
      (sum, row) => sum + toNumber(row.amount),
      0
    );
    const variableCostsTotal = monthVariableRows.reduce(
      (sum, row) => sum + toNumber(row.amount),
      0
    );
    const employeeCosts = employeesForMonth.reduce(
      (sum, snapshot) => sum + toNumber(snapshot.employee.totalCost),
      0
    );
    const purchaseCosts = monthPurchaseRows.reduce(
      (sum, row) => sum + toNumber(row.amount),
      0
    );
    const spending =
      fixedCostsTotal +
      variableCostsTotal +
      employeeCosts +
      purchaseCosts +
      proLabore;
    const profit = netRevenue - spending;
    const balance = profit + reserveBalance;

    return {
      key: `${targetYear}-${String(targetMonth).padStart(2, "0")}`,
      month: label,
      grossRevenue,
      taxAmount,
      netRevenue,
      fixedCosts: fixedCostsTotal,
      variableCosts: variableCostsTotal,
      employeeCosts,
      purchases: purchaseCosts,
      reserve: reserveBalance,
      spending,
      profit,
      balance,
    };
  };

  const monthlySnapshots = buildRollingMonths(month, year, 8).map(
    ({ year: targetYear, month: targetMonth, label }) =>
      summarizeMonth(targetMonth, targetYear, label)
  );

  const resultSeries = buildYearMonths(year).reduce<
    Array<{
      key: string;
      month: string;
      monthlyResult: number;
      previousAccumulatedResult: number;
      accumulatedResult: number;
      passiveCarryResult: number;
    }>
  >((series, { year: targetYear, month: targetMonth, label, key }) => {
    const snapshot = summarizeMonth(targetMonth, targetYear, label);
    const previousAccumulated =
      series[series.length - 1]?.accumulatedResult ?? 0;
    const accumulatedResult = previousAccumulated + snapshot.profit;

    series.push({
      key,
      month: label,
      monthlyResult: snapshot.profit,
      previousAccumulatedResult: previousAccumulated,
      accumulatedResult,
      passiveCarryResult: previousAccumulated,
    });

    return series;
  }, []);

  const currentSnapshot = monthlySnapshots[monthlySnapshots.length - 1];
  const previousSnapshot =
    monthlySnapshots[monthlySnapshots.length - 2] ?? currentSnapshot;

  const currentRevenueRows = revenueRows.filter(
    row =>
      isSameMonthYear(row.dueDate, month, year) && row.status !== "cancelado"
  );
  const currentVariableRows = variableCostRows.filter(row =>
    isSameMonthYear(row.date, month, year)
  );
  const currentPurchaseRows = purchaseRows.filter(row =>
    isSameMonthYear(row.dueDate, month, year)
  );
  const currentReserveRows = reserveRows.filter(row =>
    isSameMonthYear(row.date, month, year)
  );
  const currentEmployees = activeEmployees.filter(
    snapshot =>
      snapshot.admissionSerial === null ||
      snapshot.admissionSerial <= selectedSerial
  );

  const currentFixedCostsTotal = currentFixedCosts.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0
  );
  const currentFixedCostsPaid = currentFixedCosts.reduce(
    (sum, row) => sum + (row.status === "pago" ? toNumber(row.amount) : 0),
    0
  );
  const currentRevenueGross = currentRevenueRows.reduce(
    (sum, row) => sum + toNumber(row.grossAmount),
    0
  );
  const currentRevenueTax = currentRevenueRows.reduce(
    (sum, row) => sum + toNumber(row.taxAmount),
    0
  );
  const currentRevenueNet = currentRevenueRows.reduce(
    (sum, row) => sum + toNumber(row.netAmount),
    0
  );
  const currentVariableCostsTotal = currentVariableRows.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0
  );
  const currentEmployeeTotalCost = currentEmployees.reduce(
    (sum, snapshot) => sum + toNumber(snapshot.employee.totalCost),
    0
  );
  const currentPurchaseTotal = currentPurchaseRows.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0
  );
  const currentReserveBalance = currentSnapshot?.reserve ?? 0;
  const currentSpending =
    currentFixedCostsTotal +
    currentVariableCostsTotal +
    currentEmployeeTotalCost +
    currentPurchaseTotal +
    proLabore;
  const currentProfit = currentRevenueNet - currentSpending;
  const currentBalance = currentProfit + currentReserveBalance;
  const currentAccumulatedResult =
    resultSeries.find(
      snapshot =>
        snapshot.month === (DASHBOARD_MONTH_LABELS[month - 1] ?? `M${month}`)
    )?.accumulatedResult ?? currentProfit;
  const currentPassiveCarryResult =
    resultSeries.find(
      snapshot =>
        snapshot.month === (DASHBOARD_MONTH_LABELS[month - 1] ?? `M${month}`)
    )?.passiveCarryResult ?? 0;

  const previousRevenueGross = previousSnapshot?.grossRevenue ?? 0;
  const previousRevenueTax = previousSnapshot?.taxAmount ?? 0;
  const previousRevenueNet = previousSnapshot?.netRevenue ?? 0;
  const previousFixedCostsTotal = previousSnapshot?.fixedCosts ?? 0;
  const previousVariableCostsTotal = previousSnapshot?.variableCosts ?? 0;
  const previousEmployeeTotalCost = previousSnapshot?.employeeCosts ?? 0;
  const previousPurchaseTotal = previousSnapshot?.purchases ?? 0;
  const previousReserveBalance = previousSnapshot?.reserve ?? 0;
  const previousSpending = previousSnapshot?.spending ?? 0;
  const previousProfit = previousSnapshot?.profit ?? 0;
  const previousBalance = previousSnapshot?.balance ?? 0;
  const previousAccumulatedResult =
    month > 1
      ? (resultSeries[month - 2]?.accumulatedResult ?? previousProfit)
      : 0;
  const previousPassiveCarryResult =
    month > 1 ? (resultSeries[month - 2]?.passiveCarryResult ?? 0) : 0;

  const walletBase: DashboardWallet[] = [
    {
      code: "CX",
      label: "Saldo operacional",
      amount: currentProfit,
      status: currentProfit >= 0 ? "Ativa" : "Inativa",
      tone: "emerald",
      progress: 0,
    },
    {
      code: "RES",
      label: "Fundo de reserva",
      amount: currentReserveBalance,
      status: currentReserveBalance > 0 ? "Ativa" : "Inativa",
      tone: "amber",
      progress: 0,
    },
    {
      code: "CMP",
      label: "Compromissos em aberto",
      amount: currentSpending,
      status: currentSpending > 0 ? "Inativa" : "Ativa",
      tone: "slate",
      progress: 0,
    },
  ];
  const walletScale = Math.max(
    ...walletBase.map(wallet => Math.abs(wallet.amount)),
    1
  );
  const wallets = walletBase.map(wallet => ({
    ...wallet,
    progress: Math.min((Math.abs(wallet.amount) / walletScale) * 100, 100),
  }));

  const activityPriority: Record<DashboardActivity["kind"], number> = {
    revenue: 5,
    reserve: 4,
    payroll: 3,
    purchase: 2,
    fixedCost: 1,
    variableCost: 0,
  };
  const activities: DashboardActivity[] = [];

  const toStatus = (
    status: string | null | undefined
  ): DashboardActivity["status"] => {
    if (status === "pago" || status === "recebido") return "Concluído";
    if (status === "atrasado") return "Em andamento";
    return "Pendente";
  };

  for (const row of currentRevenueRows) {
    const parts = parseDateParts(row.receivedDate ?? row.dueDate);
    if (!parts) continue;
    activities.push({
      orderId: `REV-${String(row.id).padStart(6, "0")}`,
      kind: "revenue",
      activity: row.client
        ? `${row.description} - ${row.client}`
        : row.description,
      price: toNumber(row.netAmount),
      status: toStatus(row.status),
      date: formatDashboardDate(parts.month, parts.year, parts.day),
      tone:
        row.status === "atrasado"
          ? "amber"
          : row.status === "recebido"
            ? "emerald"
            : "emerald",
      sortKey:
        getActivitySortKey(parts.year, parts.month, parts.day) * 10 +
        activityPriority.revenue,
    });
  }

  for (const row of currentFixedCosts) {
    const parts = {
      year,
      month,
      day: Math.min(
        row.dueDay,
        new Date(Date.UTC(year, month, 0)).getUTCDate()
      ),
    };
    activities.push({
      orderId: `FIX-${String(row.id).padStart(6, "0")}`,
      kind: "fixedCost",
      activity: row.description,
      price: toNumber(row.amount),
      status: toStatus(row.status),
      date: formatDashboardDate(parts.month, parts.year, parts.day),
      tone:
        row.status === "atrasado"
          ? "amber"
          : row.status === "pago"
            ? "blue"
            : "blue",
      sortKey:
        getActivitySortKey(parts.year, parts.month, parts.day) * 10 +
        activityPriority.fixedCost,
    });
  }

  for (const row of currentVariableRows) {
    const parts = parseDateParts(row.date);
    if (!parts) continue;
    const installmentSuffix =
      row.installmentCount > 1
        ? ` (${row.installmentNumber}/${row.installmentCount})`
        : "";
    activities.push({
      orderId: `VAR-${String(row.id).padStart(6, "0")}`,
      kind: "variableCost",
      activity: `${row.description}${installmentSuffix}`,
      price: toNumber(row.amount),
      status: toStatus(row.status),
      date: formatDashboardDate(parts.month, parts.year, parts.day),
      tone:
        row.status === "atrasado"
          ? "amber"
          : row.status === "pago"
            ? "amber"
            : "amber",
      sortKey:
        getActivitySortKey(parts.year, parts.month, parts.day) * 10 +
        activityPriority.variableCost,
    });
  }

  const supplierMap = supplierById;
  for (const row of currentPurchaseRows) {
    const parts = parseDateParts(row.dueDate);
    if (!parts) continue;
    const supplierName = supplierMap.get(row.supplierId);
    activities.push({
      orderId: `PUR-${String(row.id).padStart(6, "0")}`,
      kind: "purchase",
      activity: supplierName
        ? `${supplierName} - ${row.description}`
        : row.description,
      price: toNumber(row.amount),
      status: toStatus(row.status),
      date: formatDashboardDate(parts.month, parts.year, parts.day),
      tone:
        row.status === "atrasado"
          ? "amber"
          : row.status === "pago"
            ? "rose"
            : "rose",
      sortKey:
        getActivitySortKey(parts.year, parts.month, parts.day) * 10 +
        activityPriority.purchase,
    });
  }

  for (const snapshot of currentEmployees) {
    const paymentDay = Math.min(
      snapshot.employee.paymentDay ?? 5,
      new Date(Date.UTC(year, month, 0)).getUTCDate()
    );
    const payrollStatus =
      selectedSerial < currentSerial
        ? "Concluído"
        : selectedSerial > currentSerial
          ? "Pendente"
          : paymentDay < currentDate.getDate()
            ? "Em andamento"
            : "Pendente";
    activities.push({
      orderId: `PAY-${String(snapshot.employee.id).padStart(6, "0")}`,
      kind: "payroll",
      activity: `Folha de pagamento - ${snapshot.employee.name}`,
      price: toNumber(snapshot.employee.totalCost),
      status: payrollStatus,
      date: formatDashboardDate(year, month, paymentDay),
      tone: payrollStatus === "Concluído" ? "emerald" : "amber",
      sortKey:
        getActivitySortKey(year, month, paymentDay) * 10 +
        activityPriority.payroll,
    });
  }

  for (const row of currentReserveRows) {
    const parts = parseDateParts(row.date);
    if (!parts) continue;
    activities.push({
      orderId: `RES-${String(row.id).padStart(6, "0")}`,
      kind: "reserve",
      activity: row.description || "Depósito na reserva",
      price: toNumber(row.depositAmount),
      status: "Concluído",
      date: formatDashboardDate(parts.month, parts.year, parts.day),
      tone: "emerald",
      sortKey:
        getActivitySortKey(parts.year, parts.month, parts.day) * 10 +
        activityPriority.reserve,
    });
  }

  activities.sort((left, right) => {
    if (right.sortKey !== left.sortKey) return right.sortKey - left.sortKey;
    return right.price - left.price;
  });

  const chartSeries = monthlySnapshots.map(snapshot => ({
    month: snapshot.month,
    profit: snapshot.netRevenue,
    loss: snapshot.spending,
  }));

  const currentTotalFixedCosts =
    currentSnapshot?.fixedCosts ?? currentFixedCostsTotal;
  const currentTotalVariableCosts =
    currentSnapshot?.variableCosts ?? currentVariableCostsTotal;
  const currentTotalEmployees =
    currentSnapshot?.employeeCosts ?? currentEmployeeTotalCost;
  const currentTotalPurchases =
    currentSnapshot?.purchases ?? currentPurchaseTotal;

  return {
    revenue: {
      items: currentRevenueRows,
      totalGross: currentRevenueGross.toFixed(2),
      totalTax: currentRevenueTax.toFixed(2),
      totalNet: currentRevenueNet.toFixed(2),
      count: currentRevenueRows.length,
    },
    fixedCosts: {
      items: currentFixedCosts,
      total: currentTotalFixedCosts.toFixed(2),
      paid: currentFixedCostsPaid.toFixed(2),
      count: currentFixedCosts.length,
    },
    variableCosts: {
      items: currentVariableRows,
      total: currentTotalVariableCosts.toFixed(2),
      count: currentVariableRows.length,
    },
    employees: {
      items: currentEmployees.map(snapshot => snapshot.employee),
      totalCost: currentTotalEmployees.toFixed(2),
      count: currentEmployees.length,
    },
    purchases: {
      items: currentPurchaseRows,
      total: currentTotalPurchases.toFixed(2),
      count: currentPurchaseRows.length,
    },
    reserve: {
      items: currentReserveRows,
      total: currentReserveBalance.toFixed(2),
      count: currentReserveRows.length,
    },
    resultSeries,
    wallets,
    activities: activities
      .slice(0, 6)
      .map(({ sortKey, ...activity }) => activity),
    chartSeries,
    summary: {
      current: {
        grossRevenue: currentRevenueGross,
        taxAmount: currentRevenueTax,
        netRevenue: currentRevenueNet,
        fixedCosts: currentTotalFixedCosts,
        variableCosts: currentTotalVariableCosts,
        employeeCosts: currentTotalEmployees,
        purchases: currentTotalPurchases,
        reserve: currentReserveBalance,
        spending: currentSpending,
        profit: currentProfit,
        balance: currentBalance,
        accumulatedResult: currentAccumulatedResult,
        passiveCarryResult: currentPassiveCarryResult,
      },
      previous: {
        grossRevenue: previousRevenueGross,
        taxAmount: previousRevenueTax,
        netRevenue: previousRevenueNet,
        fixedCosts: previousFixedCostsTotal,
        variableCosts: previousVariableCostsTotal,
        employeeCosts: previousEmployeeTotalCost,
        purchases: previousPurchaseTotal,
        reserve: previousReserveBalance,
        spending: previousSpending,
        profit: previousProfit,
        balance: previousBalance,
        accumulatedResult: previousAccumulatedResult,
        passiveCarryResult: previousPassiveCarryResult,
      },
    },
    settings: userSettings,
  };
}

export async function getPersonalDashboardData(
  userId: number,
  month: number,
  year: number
) {
  const db = await getDb();
  if (!db) return null;

  const [fixedCostsData] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${personalFixedCosts.amount}), 0)`,
      paid: sql<string>`COALESCE(SUM(CASE WHEN ${personalFixedCosts.status} = 'pago' THEN ${personalFixedCosts.amount} ELSE 0 END), 0)`,
    })
    .from(personalFixedCosts)
    .where(
      and(
        eq(personalFixedCosts.userId, userId),
        eq(personalFixedCosts.month, month),
        eq(personalFixedCosts.year, year)
      )
    );

  const [varCostsData] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${personalVariableCosts.amount}), 0)`,
    })
    .from(personalVariableCosts)
    .where(
      and(
        eq(personalVariableCosts.userId, userId),
        sql`EXTRACT(MONTH FROM ${personalVariableCosts.date}::date) = ${month}`,
        sql`EXTRACT(YEAR FROM ${personalVariableCosts.date}::date) = ${year}`
      )
    );

  const [debtsData] = await db
    .select({
      totalBalance: sql<string>`COALESCE(SUM(${debts.currentBalance}), 0)`,
      totalMonthly: sql<string>`COALESCE(SUM(${debts.monthlyPayment}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(debts)
    .where(and(eq(debts.userId, userId), ne(debts.status, "quitada")));

  const [investmentsData] = await db
    .select({
      totalDeposited: sql<string>`COALESCE(SUM(${investments.depositAmount}), 0)`,
      totalBalance: sql<string>`COALESCE(SUM(${investments.currentBalance}), 0)`,
    })
    .from(investments)
    .where(eq(investments.userId, userId));

  const [reserveData] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${reserveFunds.depositAmount}), 0)`,
    })
    .from(reserveFunds)
    .where(
      and(eq(reserveFunds.userId, userId), eq(reserveFunds.type, "pessoal"))
    );

  const userSettings = await getSettings(userId);

  return {
    fixedCosts: fixedCostsData,
    variableCosts: varCostsData,
    debts: debtsData,
    investments: investmentsData,
    reserve: reserveData,
    settings: userSettings,
  };
}

// ==================== CALENDAR DATA ====================
export async function getCalendarData(
  userId: number,
  month: number,
  year: number
) {
  const db = await getDb();
  if (!db) return [];

  const items: Array<{
    day: number;
    description: string;
    amount: string;
    type: string;
    status: string;
    sourceId?: number;
    sourceType?: string;
    actionable?: boolean;
  }> = [];
  const today = new Date().getDate();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const isCurrentMonth = month === currentMonth && year === currentYear;

  const fixedCo = rowsFromResult(
    await getCompanyFixedCosts(userId, month, year)
  );
  fixedCo.forEach(c =>
    items.push({
      day: c.dueDay,
      description: `[EMP] ${c.description}`,
      amount: c.amount,
      type: "empresa-fixo",
      status: c.status,
      sourceId: c.id,
      sourceType: "company_fixed_cost",
      actionable: c.status !== "pago",
    })
  );

  const variableCo = rowsFromResult(
    await getCompanyVariableCosts(userId, month, year)
  );
  variableCo.forEach(c =>
    items.push({
      day: Number(c.date.slice(8, 10)),
      description: `[EMP] ${c.description}`,
      amount: c.amount,
      type: "empresa-variavel",
      status: c.status,
      sourceId: c.id,
      sourceType: "company_variable_cost",
      actionable: c.status !== "pago",
    })
  );

  const fixedPe = rowsFromResult(
    await getPersonalFixedCosts(userId, month, year)
  );
  fixedPe.forEach(c =>
    items.push({
      day: c.dueDay,
      description: `[PES] ${c.description}`,
      amount: c.amount,
      type: "pessoal-fixo",
      status: c.status,
      sourceId: c.id,
      sourceType: "personal_fixed_cost",
      actionable: c.status !== "pago",
    })
  );

  const variablePe = rowsFromResult(
    await getPersonalVariableCosts(userId, month, year)
  );
  variablePe.forEach(c =>
    items.push({
      day: Number(c.date.slice(8, 10)),
      description: `[PES] ${c.description}`,
      amount: c.amount,
      type: "pessoal-variavel",
      status: c.status,
      sourceId: c.id,
      sourceType: "personal_variable_cost",
      actionable: c.status !== "pago",
    })
  );

  const employees = rowsFromResult(await getEmployees(userId));
  employees
    .filter(e => e.status === "ativo")
    .forEach(e =>
      items.push({
        day: e.paymentDay ?? 5,
        description: `[EMP] Salário - ${e.name}`,
        amount: e.totalCost,
        type: "empresa-folha",
        status:
          isCurrentMonth && (e.paymentDay ?? 5) < today
            ? "atrasada"
            : "pendente",
        sourceId: e.id,
        sourceType: "employee_payroll",
        actionable: false,
      })
    );

  const activeDebts = await getDebts(userId);
  activeDebts
    .filter(d => d.status !== "quitada")
    .forEach(d =>
      items.push({
        day: d.dueDay,
        description: `[DIV] ${d.creditor}`,
        amount: d.monthlyPayment,
        type: "divida",
        status:
          d.status === "atrasada" || (isCurrentMonth && d.dueDay < today)
            ? "atrasada"
            : "pendente",
        sourceId: d.id,
        sourceType: "debt",
        actionable: true,
      })
    );

  return items.sort((a, b) => a.day - b.day);
}
