import * as db from "./db";
import { and, eq } from "drizzle-orm";
import {
  companyVariableCosts,
  debts,
  investments,
  personalVariableCosts,
  reserveFunds,
  revenues,
} from "../drizzle/schema";
import {
  type FinancialImportReserveType,
  type FinancialImportTarget,
  parseImportAmount,
  parseImportInteger,
  normalizeImportDate,
  normalizeImportLookup,
  suggestFinancialImportCategory,
  suggestInvestmentType,
  suggestReserveFundType,
} from "../shared/financial-import";

export type FinancialImportRow = {
  date?: string | null;
  description?: string | null;
  amount?: string | number | null;
  category?: string | null;
  counterparty?: string | null;
  status?: string | null;
  notes?: string | null;
  balance?: string | number | null;
  monthlyPayment?: string | number | null;
  interestRate?: string | number | null;
  totalInstallments?: string | number | null;
  paidInstallments?: string | number | null;
  dueDay?: string | number | null;
  institution?: string | null;
  investmentType?: string | null;
  yieldAmount?: string | number | null;
  reserveType?: string | null;
};

export type FinancialImportResult = {
  imported: number;
  updatedExisting: number;
  skippedDuplicates: number;
  totalAmount: string;
  target: FinancialImportTarget;
  categories: string[];
  importedAt: string;
};

export type FinancialImportReconciliationInput = {
  mode?: "create" | "update";
  existingId?: number;
};

export type MixedFinancialImportItem = {
  target: FinancialImportTarget;
  reserveFundType?: FinancialImportReserveType | null;
  defaultCategory?: string | null;
  defaultStatus?: string | null;
  reconciliation?: FinancialImportReconciliationInput | null;
  row: FinancialImportRow;
};

function normalizeText(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

function normalizeRevenueStatus(value?: string | null) {
  const normalized = normalizeImportLookup(value || "");
  if (!normalized) return "recebido" as const;
  if (normalized.includes("cancel")) return "cancelado" as const;
  if (normalized.includes("atras") || normalized.includes("overdue")) return "atrasado" as const;
  if (
    normalized.includes("receb") ||
    normalized.includes("pago") ||
    normalized.includes("paid") ||
    normalized.includes("credit")
  ) {
    return "recebido" as const;
  }
  return "pendente" as const;
}

function normalizeCostStatus(value?: string | null) {
  const normalized = normalizeImportLookup(value || "");
  if (!normalized) return "pago" as const;
  if (normalized.includes("atras") || normalized.includes("overdue")) return "atrasado" as const;
  if (
    normalized.includes("pago") ||
    normalized.includes("paid") ||
    normalized.includes("debit") ||
    normalized.includes("quitado")
  ) {
    return "pago" as const;
  }
  return "pendente" as const;
}

function normalizeDebtStatus(value?: string | null) {
  const normalized = normalizeImportLookup(value || "");
  if (!normalized) return "ativa" as const;
  if (normalized.includes("quit")) return "quitada" as const;
  if (normalized.includes("reneg")) return "renegociada" as const;
  if (normalized.includes("atras") || normalized.includes("venc")) return "atrasada" as const;
  return "ativa" as const;
}

function normalizeDebtPriority(value?: string | null) {
  const normalized = normalizeImportLookup(value || "");
  if (normalized.includes("alta") || normalized.includes("high")) return "alta" as const;
  if (normalized.includes("baixa") || normalized.includes("low")) return "baixa" as const;
  return "media" as const;
}

function buildImportedNotes(row: FinancialImportRow, sourceLabel?: string | null) {
  const parts = [
    sourceLabel ? `Importado via CSV: ${sourceLabel}` : "Importado via CSV",
    normalizeText(row.notes),
  ].filter(Boolean);
  return parts.join(" | ") || null;
}

function ensureAmount(value: string | number | null | undefined, index: number, label = "valor") {
  const parsed = parseImportAmount(value);
  if (parsed == null || parsed <= 0) {
    throw new Error(`Linha ${index + 1}: ${label} invalido.`);
  }
  return parsed;
}

function ensureDate(value: string | null | undefined, index: number, label = "data") {
  const parsed = normalizeImportDate(value);
  if (!parsed) {
    throw new Error(`Linha ${index + 1}: ${label} invalida.`);
  }
  return parsed;
}

function normalizeCommonDescription(row: FinancialImportRow, index: number) {
  return (
    normalizeText(row.description) ||
    normalizeText(row.counterparty) ||
    `Lancamento importado ${index + 1}`
  );
}

async function isDuplicateImport(params: {
  userId: number;
  target: FinancialImportTarget;
  date?: string | null;
  description?: string | null;
  amount?: string | null;
  counterparty?: string | null;
  reserveFundType?: FinancialImportReserveType | null;
  balance?: string | null;
}) {
  const database = await db.getDb();
  if (!database) return false;

  const description = normalizeText(params.description);

  if (params.target === "revenues" && params.date && description && params.amount) {
    const existing = await database
      .select({ id: revenues.id })
      .from(revenues)
      .where(
        and(
          eq(revenues.userId, params.userId),
          eq(revenues.dueDate, params.date),
          eq(revenues.description, description),
          eq(revenues.netAmount, params.amount)
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  if (params.target === "company_variable_costs" && params.date && description && params.amount) {
    const existing = await database
      .select({ id: companyVariableCosts.id })
      .from(companyVariableCosts)
      .where(
        and(
          eq(companyVariableCosts.userId, params.userId),
          eq(companyVariableCosts.date, params.date),
          eq(companyVariableCosts.description, description),
          eq(companyVariableCosts.amount, params.amount)
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  if (params.target === "personal_variable_costs" && params.date && description && params.amount) {
    const existing = await database
      .select({ id: personalVariableCosts.id })
      .from(personalVariableCosts)
      .where(
        and(
          eq(personalVariableCosts.userId, params.userId),
          eq(personalVariableCosts.date, params.date),
          eq(personalVariableCosts.description, description),
          eq(personalVariableCosts.amount, params.amount)
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  if (params.target === "investments" && params.date && description && params.amount) {
    const institution = normalizeText(params.counterparty) || "Instituicao importada";
    const existing = await database
      .select({ id: investments.id })
      .from(investments)
      .where(
        and(
          eq(investments.userId, params.userId),
          eq(investments.date, params.date),
          eq(investments.description, description),
          eq(investments.institution, institution),
          eq(investments.depositAmount, params.amount)
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  if (params.target === "reserve_funds" && params.date && description && params.amount && params.reserveFundType) {
    const existing = await database
      .select({ id: reserveFunds.id })
      .from(reserveFunds)
      .where(
        and(
          eq(reserveFunds.userId, params.userId),
          eq(reserveFunds.type, params.reserveFundType),
          eq(reserveFunds.date, params.date),
          eq(reserveFunds.description, description),
          eq(reserveFunds.depositAmount, params.amount)
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  if (params.target === "debts" && description && params.balance) {
    const creditor = normalizeText(params.counterparty) || description;
    const existing = await database
      .select({ id: debts.id })
      .from(debts)
      .where(
        and(
          eq(debts.userId, params.userId),
          eq(debts.creditor, creditor),
          eq(debts.description, description),
          eq(debts.currentBalance, params.balance)
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  return false;
}

export async function importFinancialRows(input: {
  userId: number;
  target: FinancialImportTarget;
  rows: FinancialImportRow[];
  defaultCategory?: string | null;
  defaultStatus?: string | null;
  sourceLabel?: string | null;
  reserveFundType?: FinancialImportReserveType | null;
  reconciliation?: FinancialImportReconciliationInput | null;
}): Promise<FinancialImportResult> {
  const categories = new Set<string>();
  let totalAmount = 0;
  let imported = 0;
  let updatedExisting = 0;
  let skippedDuplicates = 0;

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const notes = buildImportedNotes(row, input.sourceLabel);

    if (input.target === "revenues") {
      const amount = ensureAmount(row.amount, index);
      const date = ensureDate(row.date, index);
      const description = normalizeCommonDescription(row, index);
      const category =
        normalizeText(row.category) ||
        normalizeText(input.defaultCategory) ||
        suggestFinancialImportCategory({
          target: input.target,
          description,
          counterparty: row.counterparty,
        }) ||
        "Receita importada";
      const status = normalizeRevenueStatus(row.status ?? input.defaultStatus);
      const amountValue = amount.toFixed(2);

      if (input.reconciliation?.mode === "update" && Number.isFinite(Number(input.reconciliation.existingId))) {
        await db.updateRevenue(Number(input.reconciliation.existingId), input.userId, {
          description,
          category,
          grossAmount: amountValue,
          taxAmount: "0.00",
          netAmount: amountValue,
          client: normalizeText(row.counterparty),
          dueDate: date,
          receivedDate: status === "recebido" ? date : null,
          status,
          notes,
        });

        updatedExisting += 1;
        totalAmount += amount;
        categories.add(category);
        continue;
      }

      if (
        await isDuplicateImport({
          userId: input.userId,
          target: input.target,
          date,
          description,
          amount: amountValue,
        })
      ) {
        skippedDuplicates += 1;
        continue;
      }

      await db.createRevenue({
        userId: input.userId,
        description,
        category,
        grossAmount: amountValue,
        taxAmount: "0.00",
        netAmount: amountValue,
        client: normalizeText(row.counterparty),
        dueDate: date,
        receivedDate: status === "recebido" ? date : null,
        status,
        notes,
      });

      imported += 1;
      totalAmount += amount;
      categories.add(category);
      continue;
    }

    if (
      input.target === "company_variable_costs" ||
      input.target === "personal_variable_costs"
    ) {
      const amount = ensureAmount(row.amount, index);
      const date = ensureDate(row.date, index);
      const description = normalizeCommonDescription(row, index);
      const category =
        normalizeText(row.category) ||
        normalizeText(input.defaultCategory) ||
        suggestFinancialImportCategory({
          target: input.target,
          description,
          counterparty: row.counterparty,
        }) ||
        (input.target === "company_variable_costs"
          ? "Despesa importada"
          : "Gasto importado");
      const status = normalizeCostStatus(row.status ?? input.defaultStatus);
      const amountValue = amount.toFixed(2);
      const installmentCount = Math.max(parseImportInteger(row.totalInstallments) ?? 1, 1);

      if (input.reconciliation?.mode === "update" && Number.isFinite(Number(input.reconciliation.existingId))) {
        if (input.target === "company_variable_costs") {
          await db.updateCompanyVariableCost(Number(input.reconciliation.existingId), input.userId, {
            description,
            category,
            amount: amountValue,
            date,
            supplier: normalizeText(row.counterparty),
            status,
            notes,
          });
        } else {
          await db.updatePersonalVariableCost(Number(input.reconciliation.existingId), input.userId, {
            description,
            category,
            amount: amountValue,
            date,
            status,
            notes,
          });
        }

        updatedExisting += 1;
        totalAmount += amount;
        categories.add(category);
        continue;
      }

      if (
        await isDuplicateImport({
          userId: input.userId,
          target: input.target,
          date,
          description,
          amount: amountValue,
        })
      ) {
        skippedDuplicates += 1;
        continue;
      }

      if (input.target === "company_variable_costs") {
        await db.createCompanyVariableCost({
          userId: input.userId,
          description,
          category,
          amount: amountValue,
          date,
          installmentCount,
          supplier: normalizeText(row.counterparty) ?? undefined,
          status,
          notes,
        });
      } else {
        await db.createPersonalVariableCost({
          userId: input.userId,
          description,
          category,
          amount: amountValue,
          date,
          installmentCount,
          status,
          notes,
        });
      }

      imported += 1;
      totalAmount += amount;
      categories.add(category);
      continue;
    }

    if (input.target === "debts") {
      const currentBalance = ensureAmount(row.balance ?? row.amount, index, "saldo atual");
      const originalAmount = parseImportAmount(row.amount) ?? currentBalance;
      const monthlyPayment = parseImportAmount(row.monthlyPayment) ?? currentBalance;
      const dueDate = normalizeImportDate(row.date);
      const dueDay = parseImportInteger(row.dueDay) ?? (dueDate ? Number(dueDate.slice(-2)) : 1);
      const totalInstallments = Math.max(parseImportInteger(row.totalInstallments) ?? 1, 1);
      const paidInstallments = Math.max(parseImportInteger(row.paidInstallments) ?? 0, 0);
      const interestRate = parseImportAmount(row.interestRate) ?? 0;
      const creditor = normalizeText(row.counterparty) || normalizeText(row.description) || `Credor ${index + 1}`;
      const description = normalizeText(row.description) || creditor;
      const status = normalizeDebtStatus(row.status ?? input.defaultStatus);
      const priority = normalizeDebtPriority(row.category);
      const balanceValue = currentBalance.toFixed(2);

      if (input.reconciliation?.mode === "update" && Number.isFinite(Number(input.reconciliation.existingId))) {
        await db.updateDebt(Number(input.reconciliation.existingId), input.userId, {
          creditor,
          description,
          originalAmount: originalAmount.toFixed(2),
          currentBalance: balanceValue,
          monthlyPayment: monthlyPayment.toFixed(2),
          interestRate: interestRate.toFixed(2),
          totalInstallments,
          paidInstallments,
          dueDay: Math.min(Math.max(dueDay, 1), 31),
          status,
          priority,
          notes,
        });

        updatedExisting += 1;
        totalAmount += currentBalance;
        continue;
      }

      if (
        await isDuplicateImport({
          userId: input.userId,
          target: input.target,
          description,
          counterparty: creditor,
          balance: balanceValue,
        })
      ) {
        skippedDuplicates += 1;
        continue;
      }

      await db.createDebt({
        userId: input.userId,
        creditor,
        description,
        originalAmount: originalAmount.toFixed(2),
        currentBalance: balanceValue,
        monthlyPayment: monthlyPayment.toFixed(2),
        interestRate: interestRate.toFixed(2),
        totalInstallments,
        paidInstallments,
        dueDay: Math.min(Math.max(dueDay, 1), 31),
        status,
        priority,
        notes,
      });

      imported += 1;
      totalAmount += currentBalance;
      continue;
    }

    if (input.target === "investments") {
      const depositAmount = ensureAmount(row.amount ?? row.balance, index, "valor aportado");
      const date = ensureDate(row.date, index);
      const currentBalance = parseImportAmount(row.balance) ?? depositAmount;
      const yieldAmount = parseImportAmount(row.yieldAmount) ?? Math.max(currentBalance - depositAmount, 0);
      const institution =
        normalizeText(row.institution) ||
        normalizeText(row.counterparty) ||
        "Instituicao importada";
      const description = normalizeText(row.description) || `Investimento ${index + 1}`;
      const investmentType =
        normalizeText(row.investmentType) ||
        suggestInvestmentType({ description, institution });
      const amountValue = depositAmount.toFixed(2);

      if (input.reconciliation?.mode === "update" && Number.isFinite(Number(input.reconciliation.existingId))) {
        await db.updateInvestment(Number(input.reconciliation.existingId), input.userId, {
          description,
          institution,
          type: investmentType,
          depositAmount: amountValue,
          currentBalance: currentBalance.toFixed(2),
          yieldAmount: yieldAmount.toFixed(2),
          date,
          notes,
        });

        updatedExisting += 1;
        totalAmount += depositAmount;
        continue;
      }

      if (
        await isDuplicateImport({
          userId: input.userId,
          target: input.target,
          date,
          description,
          amount: amountValue,
          counterparty: institution,
        })
      ) {
        skippedDuplicates += 1;
        continue;
      }

      await db.createInvestment({
        userId: input.userId,
        description,
        institution,
        type: investmentType,
        depositAmount: amountValue,
        currentBalance: currentBalance.toFixed(2),
        yieldAmount: yieldAmount.toFixed(2),
        date,
        notes,
      });

      imported += 1;
      totalAmount += depositAmount;
      continue;
    }

    const depositAmount = ensureAmount(row.amount, index);
    const date = ensureDate(row.date, index);
    const description =
      normalizeText(row.description) || `Aporte de reserva ${index + 1}`;
    const reserveType =
      input.reserveFundType ||
      suggestReserveFundType({
        description,
        explicitType: row.reserveType,
      });
    const amountValue = depositAmount.toFixed(2);

    if (input.reconciliation?.mode === "update" && Number.isFinite(Number(input.reconciliation.existingId))) {
      await db.updateReserveFund(Number(input.reconciliation.existingId), input.userId, {
        type: reserveType,
        depositAmount: amountValue,
        date,
        description,
        notes,
      });

      updatedExisting += 1;
      totalAmount += depositAmount;
      continue;
    }

    if (
      await isDuplicateImport({
        userId: input.userId,
        target: input.target,
        date,
        description,
        amount: amountValue,
        reserveFundType: reserveType,
      })
    ) {
      skippedDuplicates += 1;
      continue;
    }

    await db.createReserveFund({
      userId: input.userId,
      type: reserveType,
      depositAmount: amountValue,
      date,
      description,
      notes,
    });

    imported += 1;
    totalAmount += depositAmount;
  }

  return {
    imported,
    updatedExisting,
    skippedDuplicates,
    totalAmount: totalAmount.toFixed(2),
    target: input.target,
    categories: Array.from(categories),
    importedAt: new Date().toISOString(),
  };
}

export async function importMixedFinancialRows(input: {
  userId: number;
  items: MixedFinancialImportItem[];
  sourceLabel?: string | null;
}) {
  let imported = 0;
  let updatedExisting = 0;
  let skippedDuplicates = 0;
  let totalAmount = 0;
  const categories = new Set<string>();
  const touchedTargets = new Set<FinancialImportTarget>();

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    const result = await importFinancialRows({
      userId: input.userId,
      target: item.target,
      reserveFundType: item.reserveFundType,
      defaultCategory: item.defaultCategory,
      defaultStatus: item.defaultStatus,
      reconciliation: item.reconciliation,
      sourceLabel: input.sourceLabel,
      rows: [item.row],
    });

    imported += result.imported;
    updatedExisting += result.updatedExisting;
    skippedDuplicates += result.skippedDuplicates;
    totalAmount += Number(result.totalAmount);
    result.categories.forEach(category => {
      if (category) categories.add(category);
    });
    touchedTargets.add(item.target);
  }

  return {
    imported,
    updatedExisting,
    skippedDuplicates,
    totalAmount: totalAmount.toFixed(2),
    targets: Array.from(touchedTargets),
    categories: Array.from(categories),
    importedAt: new Date().toISOString(),
  };
}
