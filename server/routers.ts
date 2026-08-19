import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import * as db from "./db";
import * as bankSync from "./bank-sync";
import * as whatsapp from "./whatsapp";
import * as financialAdvisor from "./financial-advisor";
import * as financialImport from "./financial-import";
import { COOKIE_NAME } from "../shared/const";
import { getConfiguredAppOrigin } from "./_core/env";

const monthSchema = z.number().int().min(1).max(12);
const yearSchema = z.number().int().min(1900).max(2200);
const entityIdSchema = z.number().int().positive();
const pageSchema = z.number().int().min(1).default(1);
const pageSizeSchema = z.number().int().min(1).max(100).default(25);
const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, "Informe um valor monetario valido");
const signedMoneySchema = z
  .string()
  .trim()
  .regex(
    /^-?(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
    "Informe um valor monetario valido"
  );
const percentageSchema = z
  .string()
  .trim()
  .refine(value => {
    if (!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(value)) return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  }, "Informe um percentual entre 0 e 100");
const isoDateSchema = z
  .string()
  .trim()
  .refine(value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      year >= 1900 &&
      year <= 2200 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    );
  }, "Informe uma data valida no formato AAAA-MM-DD");

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: protectedProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      return { success: true };
    }),
  }),

  // ==================== SETTINGS ====================
  settings: router({
    get: protectedProcedure.query(({ ctx }) => db.getSettings(ctx.user.id)),
    upsert: protectedProcedure
      .input(
        z.object({
          taxPercent: percentageSchema.optional(),
          tithePercent: percentageSchema.optional(),
          investmentPercent: percentageSchema.optional(),
          proLaboreGross: moneySchema.optional(),
          companyReserveMonths: z.number().int().min(0).max(120).optional(),
          personalReserveMonths: z.number().int().min(0).max(120).optional(),
          companyMinCashMonths: moneySchema.optional(),
          personalMinCashMonths: moneySchema.optional(),
          companyName: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.upsertSettings({ userId: ctx.user.id, ...input })
      ),
  }),

  bankConnections: router({
    list: protectedProcedure.query(({ ctx }) =>
      db.listBankConnections(ctx.user.id)
    ),
    providers: protectedProcedure.query(() =>
      bankSync.listBankProviderReadiness()
    ),
    upsert: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema.optional(),
          label: z.string().min(1),
          institution: z.string().min(1),
          provider: z.enum([
            "open_finance",
            "pluggy",
            "belvo",
            "manual_upload",
          ]),
          sourceKind: z.enum(["bank_account", "credit_card"]),
          scope: z.enum(["empresa", "pessoal", "misto"]),
          syncMode: z.enum(["api", "file"]),
          status: z.enum(["pronta", "atencao", "rascunho"]),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.upsertBankConnection(ctx.user.id, input)
      ),
    remove: protectedProcedure
      .input(z.object({ connectionId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deleteBankConnection(ctx.user.id, input.connectionId)
      ),
    markImported: protectedProcedure
      .input(z.object({ connectionId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.markBankConnectionImported(ctx.user.id, input.connectionId)
      ),
    requestSync: protectedProcedure
      .input(z.object({ connectionId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        bankSync.requestBankConnectionSync(ctx.user.id, input.connectionId)
      ),
  }),

  financialImports: router({
    reconciliationData: protectedProcedure.query(async ({ ctx }) => {
      const [
        revenuesResult,
        companyVariableCostsResult,
        personalVariableCostsResult,
        debtsResult,
        investmentsResult,
        reserveFundsResult,
      ] = await Promise.all([
        db.getRevenues(ctx.user.id),
        db.getCompanyVariableCosts(ctx.user.id),
        db.getPersonalVariableCosts(ctx.user.id),
        db.getDebts(ctx.user.id),
        db.getInvestments(ctx.user.id),
        db.getReserveFunds(ctx.user.id),
      ]);
      const limit = 2_000;

      return {
        revenues: revenuesResult.data.slice(0, limit),
        companyVariableCosts: companyVariableCostsResult.data.slice(0, limit),
        personalVariableCosts: personalVariableCostsResult.data.slice(0, limit),
        debts: debtsResult.slice(0, limit),
        investments: investmentsResult.slice(0, limit),
        reserveFunds: reserveFundsResult.slice(0, limit),
        truncated:
          revenuesResult.pagination.total > limit ||
          companyVariableCostsResult.pagination.total > limit ||
          personalVariableCostsResult.pagination.total > limit ||
          debtsResult.length > limit ||
          investmentsResult.length > limit ||
          reserveFundsResult.length > limit,
      };
    }),
    importCsv: protectedProcedure
      .input(
        z.object({
          target: z.enum([
            "revenues",
            "company_variable_costs",
            "personal_variable_costs",
            "debts",
            "investments",
            "reserve_funds",
          ]),
          reserveFundType: z.enum(["empresa", "pessoal"]).optional(),
          defaultCategory: z.string().optional(),
          defaultStatus: z.string().optional(),
          sourceLabel: z.string().optional(),
          rows: z
            .array(
              z.object({
                date: z.string().optional(),
                description: z.string().optional(),
                amount: z.union([z.string(), z.number()]).optional(),
                category: z.string().optional(),
                counterparty: z.string().optional(),
                status: z.string().optional(),
                notes: z.string().optional(),
                balance: z.union([z.string(), z.number()]).optional(),
                monthlyPayment: z.union([z.string(), z.number()]).optional(),
                interestRate: z.union([z.string(), z.number()]).optional(),
                totalInstallments: z.union([z.string(), z.number()]).optional(),
                paidInstallments: z.union([z.string(), z.number()]).optional(),
                dueDay: z.union([z.string(), z.number()]).optional(),
                institution: z.string().optional(),
                investmentType: z.string().optional(),
                yieldAmount: z.union([z.string(), z.number()]).optional(),
                reserveType: z.string().optional(),
              })
            )
            .min(1)
            .max(1000),
        })
      )
      .mutation(({ ctx, input }) =>
        financialImport.importFinancialRows({
          userId: ctx.user.id,
          ...input,
        })
      ),
    importMixed: protectedProcedure
      .input(
        z.object({
          sourceLabel: z.string().optional(),
          items: z
            .array(
              z.object({
                target: z.enum([
                  "revenues",
                  "company_variable_costs",
                  "personal_variable_costs",
                  "debts",
                  "investments",
                  "reserve_funds",
                ]),
                reserveFundType: z.enum(["empresa", "pessoal"]).optional(),
                defaultCategory: z.string().optional(),
                defaultStatus: z.string().optional(),
                reconciliation: z
                  .object({
                    mode: z.enum(["create", "update"]).optional(),
                    existingId: entityIdSchema.optional(),
                  })
                  .optional(),
                row: z.object({
                  date: z.string().optional(),
                  description: z.string().optional(),
                  amount: z.union([z.string(), z.number()]).optional(),
                  category: z.string().optional(),
                  counterparty: z.string().optional(),
                  status: z.string().optional(),
                  notes: z.string().optional(),
                  balance: z.union([z.string(), z.number()]).optional(),
                  monthlyPayment: z.union([z.string(), z.number()]).optional(),
                  interestRate: z.union([z.string(), z.number()]).optional(),
                  totalInstallments: z
                    .union([z.string(), z.number()])
                    .optional(),
                  paidInstallments: z
                    .union([z.string(), z.number()])
                    .optional(),
                  dueDay: z.union([z.string(), z.number()]).optional(),
                  institution: z.string().optional(),
                  investmentType: z.string().optional(),
                  yieldAmount: z.union([z.string(), z.number()]).optional(),
                  reserveType: z.string().optional(),
                }),
              })
            )
            .min(1)
            .max(1000),
        })
      )
      .mutation(({ ctx, input }) =>
        financialImport.importMixedFinancialRows({
          userId: ctx.user.id,
          ...input,
        })
      ),
  }),

  // ==================== REVENUES ====================
  revenues: router({
    list: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
          page: pageSchema,
          limit: pageSizeSchema,
        })
      )
      .query(({ ctx, input }) =>
        db.getRevenues(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          description: z.string().min(1),
          category: z.string().min(1),
          grossAmount: moneySchema,
          taxAmount: moneySchema,
          netAmount: moneySchema,
          client: z.string().optional(),
          dueDate: isoDateSchema,
          receivedDate: isoDateSchema.nullable().optional(),
          status: z
            .enum(["pendente", "recebido", "atrasado", "cancelado"])
            .optional(),
          seriesId: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createRevenue({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          description: z.string().optional(),
          category: z.string().optional(),
          grossAmount: moneySchema.optional(),
          taxAmount: moneySchema.optional(),
          netAmount: moneySchema.optional(),
          client: z.string().nullable().optional(),
          dueDate: isoDateSchema.optional(),
          receivedDate: isoDateSchema.nullable().optional(),
          status: z
            .enum(["pendente", "recebido", "atrasado", "cancelado"])
            .optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateRevenue(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteRevenue(input.id, ctx.user.id)),
    deleteSeries: protectedProcedure
      .input(z.object({ seriesId: z.string() }))
      .mutation(({ ctx, input }) =>
        db.deleteRevenueSeries(input.seriesId, ctx.user.id)
      ),
    updateSeries: protectedProcedure
      .input(
        z.object({
          seriesId: z.string(),
          description: z.string().optional(),
          category: z.string().optional(),
          grossAmount: moneySchema.optional(),
          taxAmount: moneySchema.optional(),
          netAmount: moneySchema.optional(),
          client: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { seriesId, ...data } = input;
        return db.updateRevenueSeries(seriesId, ctx.user.id, data);
      }),
  }),

  // ==================== COMPANY FIXED COSTS ====================
  companyFixedCosts: router({
    list: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
          page: pageSchema,
          limit: pageSizeSchema,
        })
      )
      .query(({ ctx, input }) =>
        db.getCompanyFixedCosts(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          description: z.string().min(1),
          category: z.string().min(1),
          amount: moneySchema,
          dueDay: z.number().int().min(1).max(31),
          dueDate: isoDateSchema.nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          month: monthSchema,
          year: yearSchema,
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createCompanyFixedCost({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          description: z.string().optional(),
          category: z.string().optional(),
          amount: moneySchema.optional(),
          dueDay: z.number().int().min(1).max(31).optional(),
          dueDate: isoDateSchema.nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateCompanyFixedCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deleteCompanyFixedCost(input.id, ctx.user.id)
      ),
  }),

  // ==================== COMPANY VARIABLE COSTS ====================
  companyVariableCosts: router({
    list: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
          page: pageSchema,
          limit: pageSizeSchema,
        })
      )
      .query(({ ctx, input }) =>
        db.getCompanyVariableCosts(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          description: z.string().min(1),
          category: z.string().min(1),
          amount: moneySchema,
          date: isoDateSchema,
          supplier: z.string().optional(),
          installmentCount: z.number().int().min(1).max(120).optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createCompanyVariableCost({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          description: z.string().optional(),
          category: z.string().optional(),
          amount: moneySchema.optional(),
          date: isoDateSchema.optional(),
          supplier: z.string().nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateCompanyVariableCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deleteCompanyVariableCost(input.id, ctx.user.id)
      ),
  }),

  // ==================== EMPLOYEES ====================
  employees: router({
    list: protectedProcedure
      .input(z.object({ page: pageSchema, limit: pageSizeSchema }).optional())
      .query(({ ctx, input }) =>
        db.getEmployees(ctx.user.id, {
          page: input?.page ?? 1,
          limit: input?.limit ?? 25,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          role: z.string().min(1),
          contractType: z.enum(["clt", "pj"]).optional(),
          salary: moneySchema,
          fgtsAmount: moneySchema,
          thirteenthProvision: moneySchema,
          vacationProvision: moneySchema,
          totalCost: moneySchema,
          paymentDay: z.number().int().min(1).max(31).optional(),
          admissionDate: isoDateSchema.nullable().optional(),
          status: z.enum(["ativo", "inativo"]).optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createEmployee({
          userId: ctx.user.id,
          ...input,
          paymentDay: input.paymentDay ?? 5,
        })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          name: z.string().optional(),
          role: z.string().optional(),
          contractType: z.enum(["clt", "pj"]).optional(),
          salary: moneySchema.optional(),
          fgtsAmount: moneySchema.optional(),
          thirteenthProvision: moneySchema.optional(),
          vacationProvision: moneySchema.optional(),
          totalCost: moneySchema.optional(),
          paymentDay: z.number().int().min(1).max(31).optional(),
          admissionDate: isoDateSchema.nullable().optional(),
          status: z.enum(["ativo", "inativo"]).optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateEmployee(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteEmployee(input.id, ctx.user.id)),
  }),

  // ==================== SUPPLIERS ====================
  suppliers: router({
    list: protectedProcedure
      .input(z.object({ page: pageSchema, limit: pageSizeSchema }).optional())
      .query(({ ctx, input }) =>
        db.getSuppliers(ctx.user.id, {
          page: input?.page ?? 1,
          limit: input?.limit ?? 25,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          cnpj: z.string().optional(),
          category: z.string().optional(),
          contact: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createSupplier({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          name: z.string().optional(),
          cnpj: z.string().nullable().optional(),
          category: z.string().nullable().optional(),
          contact: z.string().nullable().optional(),
          phone: z.string().nullable().optional(),
          email: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateSupplier(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteSupplier(input.id, ctx.user.id)),
  }),

  // ==================== SUPPLIER PURCHASES ====================
  supplierPurchases: router({
    list: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
          page: z.number().int().min(1).optional().default(1),
          limit: z.number().int().min(1).max(100).optional().default(50),
          orderBy: z
            .enum(["supplierId", "description", "amount", "dueDate", "status"])
            .optional()
            .default("dueDate"),
          orderDirection: z.enum(["asc", "desc"]).optional().default("asc"),
        })
      )
      .query(({ ctx, input }) =>
        db.getSupplierPurchases(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
          sortBy: input.orderBy,
          sortOrder: input.orderDirection,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          supplierId: entityIdSchema,
          description: z.string().min(1),
          amount: moneySchema,
          dueDate: isoDateSchema,
          paidDate: isoDateSchema.nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          paymentMethod: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createSupplierPurchase({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          supplierId: entityIdSchema.optional(),
          description: z.string().optional(),
          amount: moneySchema.optional(),
          dueDate: isoDateSchema.optional(),
          paidDate: isoDateSchema.nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          paymentMethod: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateSupplierPurchase(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deleteSupplierPurchase(input.id, ctx.user.id)
      ),
  }),

  // ==================== PERSONAL FIXED COSTS ====================
  personalFixedCosts: router({
    list: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
          page: pageSchema,
          limit: pageSizeSchema,
        })
      )
      .query(({ ctx, input }) =>
        db.getPersonalFixedCosts(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          description: z.string().min(1),
          category: z.string().min(1),
          amount: moneySchema,
          dueDay: z.number().int().min(1).max(31),
          dueDate: isoDateSchema.nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          month: monthSchema,
          year: yearSchema,
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createPersonalFixedCost({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          description: z.string().optional(),
          category: z.string().optional(),
          amount: moneySchema.optional(),
          dueDay: z.number().int().min(1).max(31).optional(),
          dueDate: isoDateSchema.nullable().optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updatePersonalFixedCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deletePersonalFixedCost(input.id, ctx.user.id)
      ),
  }),

  // ==================== PERSONAL VARIABLE COSTS ====================
  personalVariableCosts: router({
    list: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
          page: pageSchema,
          limit: pageSizeSchema,
        })
      )
      .query(({ ctx, input }) =>
        db.getPersonalVariableCosts(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          description: z.string().min(1),
          category: z.string().min(1),
          amount: moneySchema,
          date: isoDateSchema,
          installmentCount: z.number().int().min(1).max(120).optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createPersonalVariableCost({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          description: z.string().optional(),
          category: z.string().optional(),
          amount: moneySchema.optional(),
          date: isoDateSchema.optional(),
          status: z.enum(["pago", "pendente", "atrasado"]).optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updatePersonalVariableCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deletePersonalVariableCost(input.id, ctx.user.id)
      ),
  }),

  // ==================== DEBTS ====================
  debts: router({
    list: protectedProcedure
      .input(z.object({ page: pageSchema, limit: pageSizeSchema }).optional())
      .query(({ ctx, input }) =>
        db.getDebtsPage(ctx.user.id, {
          page: input?.page ?? 1,
          limit: input?.limit ?? 25,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          creditor: z.string().min(1),
          description: z.string().min(1),
          originalAmount: moneySchema,
          currentBalance: moneySchema,
          monthlyPayment: moneySchema,
          interestRate: percentageSchema.optional(),
          totalInstallments: z.number().int().min(1).max(1_200),
          paidInstallments: z.number().int().min(0).max(1_200).optional(),
          dueDay: z.number().int().min(1).max(31),
          status: z
            .enum(["ativa", "atrasada", "quitada", "renegociada"])
            .optional(),
          priority: z.enum(["alta", "media", "baixa"]).optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createDebt({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          creditor: z.string().optional(),
          description: z.string().optional(),
          originalAmount: moneySchema.optional(),
          currentBalance: moneySchema.optional(),
          monthlyPayment: moneySchema.optional(),
          interestRate: percentageSchema.optional(),
          totalInstallments: z.number().int().min(1).max(1_200).optional(),
          paidInstallments: z.number().int().min(0).max(1_200).optional(),
          dueDay: z.number().int().min(1).max(31).optional(),
          status: z
            .enum(["ativa", "atrasada", "quitada", "renegociada"])
            .optional(),
          priority: z.enum(["alta", "media", "baixa"]).optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateDebt(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteDebt(input.id, ctx.user.id)),
  }),

  // ==================== INVESTMENTS ====================
  investments: router({
    list: protectedProcedure
      .input(z.object({ page: pageSchema, limit: pageSizeSchema }).optional())
      .query(({ ctx, input }) =>
        db.getInvestmentsPage(ctx.user.id, {
          page: input?.page ?? 1,
          limit: input?.limit ?? 25,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          description: z.string().min(1),
          institution: z.string().min(1),
          type: z.string().min(1),
          depositAmount: moneySchema,
          currentBalance: moneySchema.optional(),
          yieldAmount: signedMoneySchema.optional(),
          date: isoDateSchema,
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createInvestment({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          description: z.string().optional(),
          institution: z.string().optional(),
          type: z.string().optional(),
          depositAmount: moneySchema.optional(),
          currentBalance: moneySchema.optional(),
          yieldAmount: signedMoneySchema.optional(),
          date: isoDateSchema.optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateInvestment(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteInvestment(input.id, ctx.user.id)),
  }),

  // ==================== RESERVE FUNDS ====================
  reserveFunds: router({
    list: protectedProcedure
      .input(
        z.object({
          type: z.enum(["empresa", "pessoal"]).optional(),
          page: pageSchema,
          limit: pageSizeSchema,
        })
      )
      .query(({ ctx, input }) =>
        db.getReserveFundsPage(ctx.user.id, input.type, {
          page: input.page,
          limit: input.limit,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          type: z.enum(["empresa", "pessoal"]),
          depositAmount: moneySchema,
          date: isoDateSchema,
          description: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createReserveFund({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          type: z.enum(["empresa", "pessoal"]).optional(),
          depositAmount: moneySchema.optional(),
          date: isoDateSchema.optional(),
          description: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateReserveFund(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        db.deleteReserveFund(input.id, ctx.user.id)
      ),
  }),

  // ==================== CLIENTS ====================
  clients: router({
    list: protectedProcedure
      .input(z.object({ page: pageSchema, limit: pageSizeSchema }).optional())
      .query(({ ctx, input }) =>
        db.getClientsPage(ctx.user.id, {
          page: input?.page ?? 1,
          limit: input?.limit ?? 25,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          document: z.string().optional(),
          category: z.string().optional(),
          contact: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createClient({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          name: z.string().optional(),
          document: z.string().nullable().optional(),
          category: z.string().nullable().optional(),
          contact: z.string().nullable().optional(),
          phone: z.string().nullable().optional(),
          email: z.string().nullable().optional(),
          address: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateClient(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteClient(input.id, ctx.user.id)),
  }),

  // ==================== SERVICES ====================
  services: router({
    list: protectedProcedure
      .input(z.object({ page: pageSchema, limit: pageSizeSchema }).optional())
      .query(({ ctx, input }) =>
        db.getServicesPage(ctx.user.id, {
          page: input?.page ?? 1,
          limit: input?.limit ?? 25,
        })
      ),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          category: z.string().optional(),
          basePrice: moneySchema,
          unit: z.string().optional(),
          recurrence: z.string().optional(),
          status: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createService({ userId: ctx.user.id, ...input })
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: entityIdSchema,
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          category: z.string().nullable().optional(),
          basePrice: moneySchema.optional(),
          unit: z.string().optional(),
          recurrence: z.string().nullable().optional(),
          status: z.string().optional(),
          notes: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, recurrence, ...data } = input;
        return db.updateService(id, ctx.user.id, {
          ...data,
          ...(recurrence != null ? { recurrence } : {}),
        });
      }),
    delete: protectedProcedure
      .input(z.object({ id: entityIdSchema }))
      .mutation(({ ctx, input }) => db.deleteService(input.id, ctx.user.id)),
  }),

  whatsappIntegration: router({
    gatewayConfig: protectedProcedure.query(() =>
      whatsapp.getWhatsAppGatewayConfig()
    ),
    get: protectedProcedure.query(({ ctx }) =>
      whatsapp.getWhatsAppIntegration(ctx.user.id, getConfiguredAppOrigin())
    ),
    upsert: protectedProcedure
      .input(
        z.object({
          provider: z.enum(["uazapi", "baileys"]).optional(),
          instanceId: z.string().trim().min(1).max(120),
          apiBaseUrl: z.string().url().max(255),
          apiToken: z.string().trim().max(4096).optional(),
          authorizedPhone: z.string().trim().min(8).max(32),
          enabled: z.boolean().optional(),
          automationHour: z.number().int().min(0).max(23).optional(),
          timezone: z.string().trim().min(1).max(80).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.upsertWhatsAppIntegration(
          ctx.user.id,
          input,
          getConfiguredAppOrigin()
        )
      ),
    testConnection: protectedProcedure
      .input(
        z
          .object({
            provider: z.enum(["uazapi", "baileys"]).optional(),
            instanceId: z.string().trim().min(1).max(120).optional(),
            apiBaseUrl: z.string().url().max(255).optional(),
            apiToken: z.string().trim().max(4096).optional(),
          })
          .optional()
      )
      .mutation(({ ctx, input }) =>
        whatsapp.testWhatsAppConnection(
          ctx.user.id,
          getConfiguredAppOrigin(),
          input
        )
      ),
    syncStatus: protectedProcedure.query(({ ctx }) =>
      whatsapp.getWhatsAppSyncStatus(ctx.user.id)
    ),
    sendTestMessage: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.sendWhatsAppTestMessage(ctx.user.id)
    ),
    requestPairingCode: protectedProcedure
      .input(
        z.object({
          phoneNumber: z.string().trim().min(8).max(32),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.requestBaileysPairingCode(ctx.user.id, input.phoneNumber)
      ),
    sendAdvisorPreview: protectedProcedure
      .input(
        z.object({
          message: z.string().trim().min(1).max(4_000),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.sendFinancialAdvisorPreviewMessage(ctx.user.id, input.message)
      ),
  }),

  assistantInbox: router({
    list: protectedProcedure.query(({ ctx }) =>
      whatsapp.listAssistantInbox(ctx.user.id)
    ),
    confirmRun: protectedProcedure
      .input(z.object({ runId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        whatsapp.confirmAssistantRunFromApp(ctx.user.id, input.runId)
      ),
    snoozeRun: protectedProcedure
      .input(z.object({ runId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        whatsapp.snoozeAssistantRunFromApp(ctx.user.id, input.runId)
      ),
  }),

  assistantAutomation: router({
    list: protectedProcedure.query(({ ctx }) =>
      whatsapp.listNotificationEvents(ctx.user.id)
    ),
    summary: protectedProcedure.query(({ ctx }) =>
      whatsapp.getAssistantOperationsSummary(ctx.user.id)
    ),
    diagnostics: protectedProcedure.query(({ ctx }) =>
      whatsapp.getAssistantCronDiagnostics(ctx.user.id)
    ),
    runEligibleNow: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.runEligibleAssistantAutomationsForUser(ctx.user.id)
    ),
    rerunLatestFailure: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.rerunLatestOperationalFailure(ctx.user.id)
    ),
    runDaily: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.runFinancialDailyForUser(ctx.user.id)
    ),
    runMonthStart: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.runFinancialMonthStartForUser(ctx.user.id)
    ),
    runMonthEnd: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.runFinancialMonthEndForUser(ctx.user.id)
    ),
    dismissEvent: protectedProcedure
      .input(z.object({ eventId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        whatsapp.dismissNotificationEvent(ctx.user.id, input.eventId)
      ),
  }),

  assistantPlans: router({
    list: protectedProcedure.query(({ ctx }) =>
      whatsapp.listAssistantPlans(ctx.user.id)
    ),
    getCurrent: protectedProcedure.query(({ ctx }) =>
      whatsapp.getCurrentAssistantPlan(ctx.user.id)
    ),
    confirmAction: protectedProcedure
      .input(z.object({ actionId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        whatsapp.confirmAssistantPlanAction(ctx.user.id, input.actionId)
      ),
    snoozeAlert: protectedProcedure
      .input(
        z.object({
          eventId: entityIdSchema,
          hours: z.number().int().min(1).max(168).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.snoozeNotificationAlert(
          ctx.user.id,
          input.eventId,
          input.hours
        )
      ),
  }),

  assistantAudit: router({
    list: protectedProcedure.query(({ ctx }) =>
      whatsapp.listAssistantRuns(ctx.user.id)
    ),
  }),

  financialAdvisor: router({
    getSnapshot: protectedProcedure.query(({ ctx }) =>
      financialAdvisor.getFinancialAdvisorSnapshot(ctx.user.id)
    ),
    getMemory: protectedProcedure.query(({ ctx }) =>
      financialAdvisor.getFinancialAdvisorMemory(ctx.user.id)
    ),
    getOnboarding: protectedProcedure.query(({ ctx }) =>
      financialAdvisor.getFinancialAdvisorOnboarding(ctx.user.id)
    ),
    ask: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.askFinancialAdvisorFromDashboard(ctx.user.id, input.message)
      ),
    evaluateDecisionScenarios: protectedProcedure
      .input(
        z.object({
          withdrawalAmount: z.number().min(0).optional(),
          personalSpendAmount: z.number().min(0).optional(),
          monthlyCostAmount: z.number().min(0).optional(),
          hiringCostAmount: z.number().min(0).optional(),
          installmentPurchaseAmount: z.number().min(0).optional(),
          installmentPurchaseMonths: z.number().int().min(1).max(60).optional(),
          recurringWithdrawalAmount: z.number().min(0).optional(),
        })
      )
      .query(({ ctx, input }) =>
        financialAdvisor.evaluateFinancialDecisionScenarios({
          userId: ctx.user.id,
          withdrawalAmount: input.withdrawalAmount,
          personalSpendAmount: input.personalSpendAmount,
          monthlyCostAmount: input.monthlyCostAmount,
          hiringCostAmount: input.hiringCostAmount,
          installmentPurchaseAmount: input.installmentPurchaseAmount,
          installmentPurchaseMonths: input.installmentPurchaseMonths,
          recurringWithdrawalAmount: input.recurringWithdrawalAmount,
        })
      ),
    generateMonthlyPlan: protectedProcedure.mutation(({ ctx }) =>
      financialAdvisor.generateFinancialAdvisorMonthlyPlan({
        userId: ctx.user.id,
        confirmed: true,
      })
    ),
    getDailyDigest: protectedProcedure.query(({ ctx }) =>
      financialAdvisor.getFinancialAdvisorDailyDigest({ userId: ctx.user.id })
    ),
    getMonthClose: protectedProcedure.query(({ ctx }) =>
      financialAdvisor.getFinancialAdvisorMonthClose({ userId: ctx.user.id })
    ),
    refreshState: protectedProcedure.mutation(({ ctx }) =>
      financialAdvisor.refreshFinancialAdvisorState({ userId: ctx.user.id })
    ),
    confirmAction: protectedProcedure
      .input(z.object({ actionId: entityIdSchema }))
      .mutation(({ ctx, input }) =>
        financialAdvisor.confirmFinancialAdvisorAction(
          ctx.user.id,
          input.actionId
        )
      ),
    snoozeAlert: protectedProcedure
      .input(
        z.object({
          eventId: entityIdSchema,
          hours: z.number().int().min(1).max(168).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        financialAdvisor.snoozeFinancialAdvisorAlert(
          ctx.user.id,
          input.eventId,
          input.hours
        )
      ),
  }),

  // ==================== DASHBOARDS ====================
  dashboard: router({
    company: protectedProcedure
      .input(z.object({ month: monthSchema, year: yearSchema }))
      .query(({ ctx, input }) =>
        db.getCompanyDashboardData(ctx.user.id, input.month, input.year)
      ),
    personal: protectedProcedure
      .input(z.object({ month: monthSchema, year: yearSchema }))
      .query(({ ctx, input }) =>
        db.getPersonalDashboardData(ctx.user.id, input.month, input.year)
      ),
  }),

  // ==================== CALENDAR ====================
  calendar: router({
    data: protectedProcedure
      .input(z.object({ month: monthSchema, year: yearSchema }))
      .query(({ ctx, input }) =>
        db.getCalendarData(ctx.user.id, input.month, input.year)
      ),
  }),

  // ==================== FINANCIAL ANALYSIS (IA) ====================
  financialAnalysis: router({
    analyze: protectedProcedure
      .input(
        z.object({
          month: monthSchema.optional(),
          year: yearSchema.optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { analyzeFinancialData } = await import(
          "./db/repositories/financial-analysis"
        );
        return analyzeFinancialData(ctx.user.id, input.month, input.year);
      }),

    sendWhatsApp: protectedProcedure
      .input(
        z.object({
          phoneNumber: z.string().min(10),
          month: monthSchema.optional(),
          year: yearSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { analyzeFinancialData, sendFinancialAlertToWhatsApp } =
          await import("./db/repositories/financial-analysis");
        const analysis = await analyzeFinancialData(
          ctx.user.id,
          input.month,
          input.year
        );
        return sendFinancialAlertToWhatsApp(
          ctx.user.id,
          input.phoneNumber,
          analysis
        );
      }),
  }),
});

export type AppRouter = typeof appRouter;
