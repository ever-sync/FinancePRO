import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import * as db from "./db";
import * as asaas from "./asaas";
import * as bankSync from "./bank-sync";
import * as whatsapp from "./whatsapp";
import * as financialAdvisor from "./financial-advisor";
import * as financialImport from "./financial-import";
import { COOKIE_NAME } from "../shared/const";

function getRequestOrigin(headers: Record<string, unknown>) {
  const host = String(headers["x-forwarded-host"] || headers.host || "");
  if (!host) return null;
  const protocol = String(headers["x-forwarded-proto"] || "https");
  return `${protocol}://${host}`;
}

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
      .input(z.object({
        taxPercent: z.string().optional(),
        tithePercent: z.string().optional(),
        investmentPercent: z.string().optional(),
        proLaboreGross: z.string().optional(),
        companyReserveMonths: z.number().optional(),
        personalReserveMonths: z.number().optional(),
        companyMinCashMonths: z.string().optional(),
        personalMinCashMonths: z.string().optional(),
        companyName: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.upsertSettings({ userId: ctx.user.id, ...input })),
  }),

  bankConnections: router({
    list: protectedProcedure.query(({ ctx }) => db.listBankConnections(ctx.user.id)),
    providers: protectedProcedure.query(() => bankSync.listBankProviderReadiness()),
    upsert: protectedProcedure
      .input(
        z.object({
          id: z.number().optional(),
          label: z.string().min(1),
          institution: z.string().min(1),
          provider: z.enum(["open_finance", "pluggy", "belvo", "manual_upload"]),
          sourceKind: z.enum(["bank_account", "credit_card"]),
          scope: z.enum(["empresa", "pessoal", "misto"]),
          syncMode: z.enum(["api", "file"]),
          status: z.enum(["pronta", "atencao", "rascunho"]),
          notes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) => db.upsertBankConnection(ctx.user.id, input)),
    remove: protectedProcedure
      .input(z.object({ connectionId: z.number() }))
      .mutation(({ ctx, input }) => db.deleteBankConnection(ctx.user.id, input.connectionId)),
    markImported: protectedProcedure
      .input(z.object({ connectionId: z.number() }))
      .mutation(({ ctx, input }) => db.markBankConnectionImported(ctx.user.id, input.connectionId)),
    requestSync: protectedProcedure
      .input(z.object({ connectionId: z.number() }))
      .mutation(({ ctx, input }) => bankSync.requestBankConnectionSync(ctx.user.id, input.connectionId)),
  }),

  financialImports: router({
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
                    existingId: z.number().optional(),
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
                  totalInstallments: z.union([z.string(), z.number()]).optional(),
                  paidInstallments: z.union([z.string(), z.number()]).optional(),
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
      .input(z.object({ month: z.number().optional(), year: z.number().optional() }))
      .query(({ ctx, input }) => db.getRevenues(ctx.user.id, input.month, input.year)),
    create: protectedProcedure
      .input(z.object({
        description: z.string().min(1),
        category: z.string().min(1),
        grossAmount: z.string(),
        taxAmount: z.string(),
        netAmount: z.string(),
        client: z.string().optional(),
        dueDate: z.string(),
        receivedDate: z.string().nullable().optional(),
        status: z.enum(["pendente", "recebido", "atrasado", "cancelado"]).optional(),
        seriesId: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createRevenue({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        category: z.string().optional(),
        grossAmount: z.string().optional(),
        taxAmount: z.string().optional(),
        netAmount: z.string().optional(),
        client: z.string().nullable().optional(),
        dueDate: z.string().optional(),
        receivedDate: z.string().nullable().optional(),
        status: z.enum(["pendente", "recebido", "atrasado", "cancelado"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateRevenue(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteRevenue(input.id, ctx.user.id)),
    deleteSeries: protectedProcedure
      .input(z.object({ seriesId: z.string() }))
      .mutation(({ ctx, input }) => db.deleteRevenueSeries(input.seriesId, ctx.user.id)),
    updateSeries: protectedProcedure
      .input(z.object({
        seriesId: z.string(),
        description: z.string().optional(),
        category: z.string().optional(),
        grossAmount: z.string().optional(),
        taxAmount: z.string().optional(),
        netAmount: z.string().optional(),
        client: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { seriesId, ...data } = input;
        return db.updateRevenueSeries(seriesId, ctx.user.id, data);
      }),
  }),

  // ==================== COMPANY FIXED COSTS ====================
  companyFixedCosts: router({
    list: protectedProcedure
      .input(z.object({ month: z.number().optional(), year: z.number().optional() }))
      .query(({ ctx, input }) => db.getCompanyFixedCosts(ctx.user.id, input.month, input.year)),
    create: protectedProcedure
      .input(z.object({
        description: z.string().min(1),
        category: z.string().min(1),
        amount: z.string(),
        dueDay: z.number().min(1).max(31),
        dueDate: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        month: z.number(),
        year: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createCompanyFixedCost({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        category: z.string().optional(),
        amount: z.string().optional(),
        dueDay: z.number().optional(),
        dueDate: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateCompanyFixedCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteCompanyFixedCost(input.id, ctx.user.id)),
  }),

  // ==================== COMPANY VARIABLE COSTS ====================
  companyVariableCosts: router({
    list: protectedProcedure
      .input(z.object({ month: z.number().optional(), year: z.number().optional() }))
      .query(({ ctx, input }) => db.getCompanyVariableCosts(ctx.user.id, input.month, input.year)),
    create: protectedProcedure
      .input(z.object({
        description: z.string().min(1),
        category: z.string().min(1),
        amount: z.string(),
        date: z.string(),
        supplier: z.string().optional(),
        installmentCount: z.number().min(1).max(120).optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createCompanyVariableCost({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        category: z.string().optional(),
        amount: z.string().optional(),
        date: z.string().optional(),
        supplier: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateCompanyVariableCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteCompanyVariableCost(input.id, ctx.user.id)),
  }),

  // ==================== EMPLOYEES ====================
  employees: router({
    list: protectedProcedure.query(({ ctx }) => db.getEmployees(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        contractType: z.enum(["clt", "pj"]).optional(),
        salary: z.string(),
        fgtsAmount: z.string(),
        thirteenthProvision: z.string(),
        vacationProvision: z.string(),
        totalCost: z.string(),
        paymentDay: z.number().min(1).max(31).optional(),
        admissionDate: z.string().nullable().optional(),
        status: z.enum(["ativo", "inativo"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createEmployee({ userId: ctx.user.id, ...input, paymentDay: input.paymentDay ?? 5 })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        role: z.string().optional(),
        contractType: z.enum(["clt", "pj"]).optional(),
        salary: z.string().optional(),
        fgtsAmount: z.string().optional(),
        thirteenthProvision: z.string().optional(),
        vacationProvision: z.string().optional(),
        totalCost: z.string().optional(),
        paymentDay: z.number().min(1).max(31).optional(),
        admissionDate: z.string().nullable().optional(),
        status: z.enum(["ativo", "inativo"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateEmployee(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteEmployee(input.id, ctx.user.id)),
  }),

  // ==================== SUPPLIERS ====================
  suppliers: router({
    list: protectedProcedure.query(({ ctx }) => db.getSuppliers(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        cnpj: z.string().optional(),
        category: z.string().optional(),
        contact: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createSupplier({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        cnpj: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        contact: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateSupplier(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteSupplier(input.id, ctx.user.id)),
  }),

  // ==================== SUPPLIER PURCHASES ====================
  supplierPurchases: router({
    list: protectedProcedure
      .input(z.object({ 
        month: z.number().optional(), 
        year: z.number().optional(),
        page: z.number().optional().default(1),
        limit: z.number().optional().default(50),
        orderBy: z.string().optional().default("dueDate"),
        orderDirection: z.enum(["asc", "desc"]).optional().default("asc")
      }))
      .query(({ ctx, input }) =>
        db.getSupplierPurchases(ctx.user.id, input.month, input.year, {
          page: input.page,
          limit: input.limit,
          sortBy: input.orderBy,
          sortOrder: input.orderDirection,
        })
      ),
    create: protectedProcedure
      .input(z.object({
        supplierId: z.number(),
        description: z.string().min(1),
        amount: z.string(),
        dueDate: z.string(),
        paidDate: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        paymentMethod: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createSupplierPurchase({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        supplierId: z.number().optional(),
        description: z.string().optional(),
        amount: z.string().optional(),
        dueDate: z.string().optional(),
        paidDate: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        paymentMethod: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateSupplierPurchase(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteSupplierPurchase(input.id, ctx.user.id)),
  }),

  // ==================== PERSONAL FIXED COSTS ====================
  personalFixedCosts: router({
    list: protectedProcedure
      .input(z.object({ month: z.number().optional(), year: z.number().optional() }))
      .query(({ ctx, input }) => db.getPersonalFixedCosts(ctx.user.id, input.month, input.year)),
    create: protectedProcedure
      .input(z.object({
        description: z.string().min(1),
        category: z.string().min(1),
        amount: z.string(),
        dueDay: z.number().min(1).max(31),
        dueDate: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        month: z.number(),
        year: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createPersonalFixedCost({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        category: z.string().optional(),
        amount: z.string().optional(),
        dueDay: z.number().optional(),
        dueDate: z.string().nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updatePersonalFixedCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deletePersonalFixedCost(input.id, ctx.user.id)),
  }),

  // ==================== PERSONAL VARIABLE COSTS ====================
  personalVariableCosts: router({
    list: protectedProcedure
      .input(z.object({ month: z.number().optional(), year: z.number().optional() }))
      .query(({ ctx, input }) => db.getPersonalVariableCosts(ctx.user.id, input.month, input.year)),
    create: protectedProcedure
      .input(z.object({
        description: z.string().min(1),
        category: z.string().min(1),
        amount: z.string(),
        date: z.string(),
        installmentCount: z.number().min(1).max(120).optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createPersonalVariableCost({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        category: z.string().optional(),
        amount: z.string().optional(),
        date: z.string().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updatePersonalVariableCost(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deletePersonalVariableCost(input.id, ctx.user.id)),
  }),

  // ==================== DEBTS ====================
  debts: router({
    list: protectedProcedure.query(({ ctx }) => db.getDebts(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        creditor: z.string().min(1),
        description: z.string().min(1),
        originalAmount: z.string(),
        currentBalance: z.string(),
        monthlyPayment: z.string(),
        interestRate: z.string().optional(),
        totalInstallments: z.number(),
        paidInstallments: z.number().optional(),
        dueDay: z.number().min(1).max(31),
        status: z.enum(["ativa", "atrasada", "quitada", "renegociada"]).optional(),
        priority: z.enum(["alta", "media", "baixa"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createDebt({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        creditor: z.string().optional(),
        description: z.string().optional(),
        originalAmount: z.string().optional(),
        currentBalance: z.string().optional(),
        monthlyPayment: z.string().optional(),
        interestRate: z.string().optional(),
        totalInstallments: z.number().optional(),
        paidInstallments: z.number().optional(),
        dueDay: z.number().optional(),
        status: z.enum(["ativa", "atrasada", "quitada", "renegociada"]).optional(),
        priority: z.enum(["alta", "media", "baixa"]).optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateDebt(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteDebt(input.id, ctx.user.id)),
  }),

  // ==================== INVESTMENTS ====================
  investments: router({
    list: protectedProcedure.query(({ ctx }) => db.getInvestments(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        description: z.string().min(1),
        institution: z.string().min(1),
        type: z.string().min(1),
        depositAmount: z.string(),
        currentBalance: z.string().optional(),
        yieldAmount: z.string().optional(),
        date: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createInvestment({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        institution: z.string().optional(),
        type: z.string().optional(),
        depositAmount: z.string().optional(),
        currentBalance: z.string().optional(),
        yieldAmount: z.string().optional(),
        date: z.string().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateInvestment(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteInvestment(input.id, ctx.user.id)),
  }),

  // ==================== RESERVE FUNDS ====================
  reserveFunds: router({
    list: protectedProcedure
      .input(z.object({ type: z.enum(["empresa", "pessoal"]).optional() }))
      .query(({ ctx, input }) => db.getReserveFunds(ctx.user.id, input.type)),
    create: protectedProcedure
      .input(z.object({
        type: z.enum(["empresa", "pessoal"]),
        depositAmount: z.string(),
        date: z.string(),
        description: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createReserveFund({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        type: z.enum(["empresa", "pessoal"]).optional(),
        depositAmount: z.string().optional(),
        date: z.string().optional(),
        description: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateReserveFund(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteReserveFund(input.id, ctx.user.id)),
  }),

  // ==================== CLIENTS ====================
  clients: router({
    list: protectedProcedure.query(({ ctx }) => db.getClients(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        document: z.string().optional(),
        category: z.string().optional(),
        contact: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createClient({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        document: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        contact: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return db.updateClient(id, ctx.user.id, data);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteClient(input.id, ctx.user.id)),
  }),

  // ==================== SERVICES ====================
  services: router({
    list: protectedProcedure.query(({ ctx }) => db.getServices(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        basePrice: z.string(),
        unit: z.string().optional(),
        recurrence: z.string().optional(),
        status: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => db.createService({ userId: ctx.user.id, ...input })),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        basePrice: z.string().optional(),
        unit: z.string().optional(),
        recurrence: z.string().nullable().optional(),
        status: z.string().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, recurrence, ...data } = input;
        return db.updateService(id, ctx.user.id, {
          ...data,
          ...(recurrence != null ? { recurrence } : {}),
        });
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.deleteService(input.id, ctx.user.id)),
  }),

  // ==================== ASAAS INTEGRATION ====================
  asaasIntegration: router({
    get: protectedProcedure.query(({ ctx }) =>
      asaas.getAsaasIntegration(ctx.user.id, getRequestOrigin(ctx.req.headers as Record<string, unknown>))
    ),
    upsert: protectedProcedure
      .input(
        z.object({
          accountName: z.string().min(1).optional(),
          environment: z.enum(["sandbox", "production"]),
          apiKey: z.string().min(1).optional(),
          webhookAuthToken: z.string().optional(),
          enabled: z.boolean().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        asaas.upsertAsaasIntegration(
          ctx.user.id,
          input,
          getRequestOrigin(ctx.req.headers as Record<string, unknown>)
        )
      ),
    testConnection: protectedProcedure.mutation(({ ctx }) => asaas.testAsaasConnection(ctx.user.id)),
    syncStatus: protectedProcedure.query(({ ctx }) => asaas.getAsaasSyncStatus(ctx.user.id)),
    importHistory: protectedProcedure
      .input(
        z
          .object({
            charges: z.boolean().optional(),
            subscriptions: z.boolean().optional(),
            invoices: z.boolean().optional(),
            transfers: z.boolean().optional(),
            financialTransactions: z.boolean().optional(),
          })
          .optional()
      )
      .mutation(({ ctx, input }) => asaas.importAsaasHistory(ctx.user.id, input)),
  }),

  asaasCustomers: router({
    syncOne: protectedProcedure
      .input(z.object({ clientId: z.number() }))
      .mutation(({ ctx, input }) => asaas.syncAsaasCustomer(ctx.user.id, input.clientId)),
    syncAll: protectedProcedure.mutation(({ ctx }) => asaas.syncAllAsaasCustomers(ctx.user.id)),
  }),

  asaasCharges: router({
    list: protectedProcedure.query(({ ctx }) => asaas.listAsaasCharges(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          revenueId: z.number().optional(),
          serviceId: z.number().optional(),
          description: z.string().optional(),
          value: z.string().optional(),
          dueDate: z.string(),
          billingType: z.enum(["PIX", "BOLETO"]),
        })
      )
      .mutation(({ ctx, input }) => asaas.createAsaasCharge(ctx.user.id, input)),
    resend: protectedProcedure
      .input(z.object({ chargeId: z.number() }))
      .mutation(({ ctx, input }) => asaas.resendAsaasCharge(ctx.user.id, input.chargeId)),
    syncOne: protectedProcedure
      .input(z.object({ asaasChargeId: z.string().min(1) }))
      .mutation(({ ctx, input }) => asaas.syncAsaasChargeByExternalId(ctx.user.id, input.asaasChargeId)),
    cancel: protectedProcedure
      .input(z.object({ chargeId: z.number() }))
      .mutation(({ ctx, input }) => asaas.cancelAsaasCharge(ctx.user.id, input.chargeId)),
  }),

  asaasSubscriptions: router({
    list: protectedProcedure.query(({ ctx }) => asaas.listAsaasSubscriptions(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          serviceId: z.number().optional(),
          description: z.string().optional(),
          value: z.string().optional(),
          nextDueDate: z.string(),
          billingType: z.enum(["PIX", "BOLETO"]),
          cycle: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUALLY", "YEARLY"]),
        })
      )
      .mutation(({ ctx, input }) => asaas.createAsaasSubscription(ctx.user.id, input)),
    cancel: protectedProcedure
      .input(z.object({ subscriptionId: z.number() }))
      .mutation(({ ctx, input }) => asaas.cancelAsaasSubscription(ctx.user.id, input.subscriptionId)),
  }),

  asaasInvoices: router({
    list: protectedProcedure.query(({ ctx }) => asaas.listAsaasInvoices(ctx.user.id)),
    issue: protectedProcedure
      .input(
        z.object({
          chargeId: z.number().optional(),
          revenueId: z.number().optional(),
          serviceDescription: z.string().min(1),
          value: z.string(),
          effectiveDate: z.string().optional(),
          observations: z.string().optional(),
          municipalServiceId: z.string().optional(),
          municipalServiceCode: z.string().optional(),
          municipalServiceName: z.string().optional(),
          deductions: z.string().optional(),
          retainIss: z.boolean().optional(),
          iss: z.string().optional(),
          cofins: z.string().optional(),
          csll: z.string().optional(),
          inss: z.string().optional(),
          ir: z.string().optional(),
          pis: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) => asaas.issueAsaasInvoice(ctx.user.id, input)),
    resend: protectedProcedure
      .input(z.object({ invoiceId: z.number() }))
      .mutation(({ ctx, input }) => asaas.resendAsaasInvoice(ctx.user.id, input.invoiceId)),
  }),

  asaasTransfers: router({
    list: protectedProcedure.query(({ ctx }) => asaas.listAsaasTransfers(ctx.user.id)),
  }),

  asaasFinancialTransactions: router({
    list: protectedProcedure.query(({ ctx }) =>
      asaas.listAsaasFinancialTransactions(ctx.user.id)
    ),
  }),

  asaasEvents: router({
    list: protectedProcedure.query(({ ctx }) => asaas.listAsaasEvents(ctx.user.id)),
    reprocess: protectedProcedure
      .input(z.object({ eventId: z.number() }))
      .mutation(({ ctx, input }) => asaas.reprocessAsaasEvent(ctx.user.id, input.eventId)),
  }),

  whatsappIntegration: router({
    get: protectedProcedure.query(({ ctx }) =>
      whatsapp.getWhatsAppIntegration(
        ctx.user.id,
        getRequestOrigin(ctx.req.headers as Record<string, unknown>)
      )
    ),
    upsert: protectedProcedure
      .input(
        z.object({
          provider: z.literal("uazapi").optional(),
          instanceId: z.string().min(1),
          apiBaseUrl: z.string().min(1),
          apiToken: z.string().optional(),
          authorizedPhone: z.string().min(8),
          enabled: z.boolean().optional(),
          automationHour: z.number().min(0).max(23).optional(),
          timezone: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.upsertWhatsAppIntegration(
          ctx.user.id,
          input,
          getRequestOrigin(ctx.req.headers as Record<string, unknown>)
        )
      ),
    testConnection: protectedProcedure
      .input(
        z
          .object({
            instanceId: z.string().min(1).optional(),
            apiBaseUrl: z.string().min(1).optional(),
            apiToken: z.string().optional(),
          })
          .optional()
      )
      .mutation(({ ctx, input }) =>
        whatsapp.testWhatsAppConnection(
          ctx.user.id,
          getRequestOrigin(ctx.req.headers as Record<string, unknown>),
          input
        )
      ),
    syncStatus: protectedProcedure.query(({ ctx }) => whatsapp.getWhatsAppSyncStatus(ctx.user.id)),
    sendTestMessage: protectedProcedure.mutation(({ ctx }) => whatsapp.sendWhatsAppTestMessage(ctx.user.id)),
    sendAdvisorPreview: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        whatsapp.sendFinancialAdvisorPreviewMessage(ctx.user.id, input.message)
      ),
  }),

  assistantInbox: router({
    list: protectedProcedure.query(({ ctx }) => whatsapp.listAssistantInbox(ctx.user.id)),
    confirmRun: protectedProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(({ ctx, input }) => whatsapp.confirmAssistantRunFromApp(ctx.user.id, input.runId)),
    snoozeRun: protectedProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(({ ctx, input }) => whatsapp.snoozeAssistantRunFromApp(ctx.user.id, input.runId)),
  }),

  assistantAutomation: router({
    list: protectedProcedure.query(({ ctx }) => whatsapp.listNotificationEvents(ctx.user.id)),
    summary: protectedProcedure.query(({ ctx }) => whatsapp.getAssistantOperationsSummary(ctx.user.id)),
    diagnostics: protectedProcedure.query(({ ctx }) => whatsapp.getAssistantCronDiagnostics(ctx.user.id)),
    runEligibleNow: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.runEligibleAssistantAutomationsForUser(ctx.user.id)
    ),
    rerunLatestFailure: protectedProcedure.mutation(({ ctx }) =>
      whatsapp.rerunLatestOperationalFailure(ctx.user.id)
    ),
    runDaily: protectedProcedure.mutation(({ ctx }) => whatsapp.runFinancialDailyForUser(ctx.user.id)),
    runMonthStart: protectedProcedure.mutation(({ ctx }) => whatsapp.runFinancialMonthStartForUser(ctx.user.id)),
    runMonthEnd: protectedProcedure.mutation(({ ctx }) => whatsapp.runFinancialMonthEndForUser(ctx.user.id)),
    dismissEvent: protectedProcedure
      .input(z.object({ eventId: z.number() }))
      .mutation(({ ctx, input }) => whatsapp.dismissNotificationEvent(ctx.user.id, input.eventId)),
  }),

  assistantPlans: router({
    list: protectedProcedure.query(({ ctx }) => whatsapp.listAssistantPlans(ctx.user.id)),
    getCurrent: protectedProcedure.query(({ ctx }) => whatsapp.getCurrentAssistantPlan(ctx.user.id)),
    confirmAction: protectedProcedure
      .input(z.object({ actionId: z.number() }))
      .mutation(({ ctx, input }) => whatsapp.confirmAssistantPlanAction(ctx.user.id, input.actionId)),
    snoozeAlert: protectedProcedure
      .input(z.object({ eventId: z.number(), hours: z.number().min(1).max(168).optional() }))
      .mutation(({ ctx, input }) => whatsapp.snoozeNotificationAlert(ctx.user.id, input.eventId, input.hours)),
  }),

  assistantAudit: router({
    list: protectedProcedure.query(({ ctx }) => whatsapp.listAssistantRuns(ctx.user.id)),
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
          installmentPurchaseMonths: z.number().min(1).max(60).optional(),
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
      .input(z.object({ actionId: z.number() }))
      .mutation(({ ctx, input }) =>
        financialAdvisor.confirmFinancialAdvisorAction(ctx.user.id, input.actionId)
      ),
    snoozeAlert: protectedProcedure
      .input(z.object({ eventId: z.number(), hours: z.number().min(1).max(168).optional() }))
      .mutation(({ ctx, input }) =>
        financialAdvisor.snoozeFinancialAdvisorAlert(ctx.user.id, input.eventId, input.hours)
      ),
  }),

  // ==================== DASHBOARDS ====================
  dashboard: router({
    company: protectedProcedure
      .input(z.object({ month: z.number(), year: z.number() }))
      .query(({ ctx, input }) => db.getCompanyDashboardData(ctx.user.id, input.month, input.year)),
    personal: protectedProcedure
      .input(z.object({ month: z.number(), year: z.number() }))
      .query(({ ctx, input }) => db.getPersonalDashboardData(ctx.user.id, input.month, input.year)),
  }),

  // ==================== CALENDAR ====================
  calendar: router({
    data: protectedProcedure
      .input(z.object({ month: z.number(), year: z.number() }))
      .query(({ ctx, input }) => db.getCalendarData(ctx.user.id, input.month, input.year)),
  }),

  // ==================== FINANCIAL ANALYSIS (IA) ====================
  financialAnalysis: router({
    analyze: protectedProcedure
      .input(z.object({ 
        month: z.number().optional(), 
        year: z.number().optional() 
      }))
      .query(async ({ ctx, input }) => {
        const { analyzeFinancialData } = await import("./db/repositories/financial-analysis");
        return analyzeFinancialData(ctx.user.id, input.month, input.year);
      }),
    
    sendWhatsApp: protectedProcedure
      .input(z.object({ 
        phoneNumber: z.string().min(10),
        month: z.number().optional(), 
        year: z.number().optional() 
      }))
      .mutation(async ({ ctx, input }) => {
        const { analyzeFinancialData, sendFinancialAlertToWhatsApp } = await import("./db/repositories/financial-analysis");
        const analysis = await analyzeFinancialData(ctx.user.id, input.month, input.year);
        return sendFinancialAlertToWhatsApp(ctx.user.id, input.phoneNumber, analysis);
      }),
  }),
});

export type AppRouter = typeof appRouter;
