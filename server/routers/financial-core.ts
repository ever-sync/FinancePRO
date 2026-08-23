import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as coreDb from "../db/financial-core";
import {
  bootstrapRaphaelFinancialProfile,
  getCanonicalBudgetStatus,
  getCanonicalFinancialSnapshot,
  getCanonicalFifthBusinessDay,
  listCanonicalCashflow,
  simulateCanonicalCar,
  simulateCanonicalPurchase,
} from "../financial-core";
import {
  SantanderStatementError,
  parseSantanderStatement,
} from "../finance/santander-statement";

const positiveId = z.number().int().positive();
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveCents = cents.refine(
  value => value > 0,
  "O valor deve ser maior que zero"
);
const basisPoints = z.number().int().min(0).max(10_000);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD")
  .refine(
    value => !Number.isNaN(Date.parse(`${value}T12:00:00.000Z`)),
    "Data invalida"
  );
const occurredAt = z.coerce.date();
const requestId = z.string().trim().min(8).max(255);
const actor = { type: "user" as const };

async function scopeFor(user: { id: number; tenantId: number }) {
  return coreDb.resolveFinancialScope(user.id, user.tenantId);
}

function asBadRequest(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      error instanceof Error ? error.message : "Operacao financeira invalida",
    cause: error,
  });
}

export const financialCoreRouter = router({
  bootstrapRaphael: protectedProcedure.mutation(({ ctx }) =>
    bootstrapRaphaelFinancialProfile(ctx.user.id, ctx.user.tenantId)
  ),

  snapshot: protectedProcedure.query(({ ctx }) =>
    getCanonicalFinancialSnapshot(ctx.user.id, {
      expectedTenantId: ctx.user.tenantId,
    })
  ),

  accounts: protectedProcedure.query(async ({ ctx }) =>
    coreDb.listFinancialAccounts(await scopeFor(ctx.user))
  ),

  setAccountBalance: protectedProcedure
    .input(
      z.object({
        accountId: positiveId,
        balanceCents: z
          .number()
          .int()
          .min(-Number.MAX_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER),
        balanceAsOf: occurredAt,
        protectedReductionConfirmation: z
          .literal("CONFIRMAR REDUCAO DA RESERVA")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.setFinancialAccountBalance(
          await scopeFor(ctx.user),
          {
            accountId: input.accountId,
            balanceCents: input.balanceCents,
            balanceAsOf: input.balanceAsOf,
            protectedReductionConfirmed:
              input.protectedReductionConfirmation ===
              "CONFIRMAR REDUCAO DA RESERVA",
            actor,
          }
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  categories: protectedProcedure.query(async ({ ctx }) =>
    coreDb.listFinancialCategories(await scopeFor(ctx.user))
  ),

  transactions: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
          start: occurredAt.optional(),
          end: occurredAt.optional(),
          needsReview: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      coreDb.listFinancialTransactions(await scopeFor(ctx.user), input ?? {})
    ),

  uncategorized: protectedProcedure.query(async ({ ctx }) =>
    coreDb.listUncategorizedTransactions(await scopeFor(ctx.user))
  ),

  recordTransaction: protectedProcedure
    .input(
      z.object({
        accountId: positiveId,
        type: z.enum(["income", "expense"]),
        amountCents: positiveCents,
        occurredAt,
        description: z.string().trim().min(1).max(500),
        categoryId: positiveId.nullable().optional(),
        status: z.enum(["confirmed", "expected", "paid", "received"]),
        counterparty: z.string().trim().max(255).nullable().optional(),
        documentNumber: z.string().trim().max(120).nullable().optional(),
        requestId,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.recordFinancialTransaction(
          await scopeFor(ctx.user),
          {
            ...input,
            source: "web",
            idempotencyKey: `web:${input.requestId}`,
            actor,
          }
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  recordTransfer: protectedProcedure
    .input(
      z.object({
        fromAccountId: positiveId,
        toAccountId: positiveId,
        amountCents: positiveCents,
        occurredAt,
        description: z.string().trim().min(1).max(500),
        requestId,
        protectedWithdrawalConfirmation: z
          .literal("RETIRAR DA RESERVA")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.recordFinancialTransfer(await scopeFor(ctx.user), {
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountCents: input.amountCents,
          occurredAt: input.occurredAt,
          description: input.description,
          idempotencyKey: `web:${input.requestId}`,
          source: "web",
          actor,
          protectedWithdrawalConfirmed:
            input.protectedWithdrawalConfirmation === "RETIRAR DA RESERVA",
        });
      } catch (error) {
        asBadRequest(error);
      }
    }),

  undoTransaction: protectedProcedure
    .input(
      z.object({
        transactionId: positiveId,
        reason: z.string().trim().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.reverseFinancialTransaction(
          await scopeFor(ctx.user),
          { ...input, actor, undoWindowMinutes: 15 }
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  categorizeTransaction: protectedProcedure
    .input(
      z.object({
        transactionId: positiveId,
        categoryId: positiveId,
        createMerchantRule: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.categorizeFinancialTransaction(
          await scopeFor(ctx.user),
          { ...input, actor }
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  goals: protectedProcedure.query(async ({ ctx }) => {
    const scope = await scopeFor(ctx.user);
    const [goals, items] = await Promise.all([
      coreDb.listFinancialGoals(scope),
      coreDb.listFinancialGoalItems(scope),
    ]);
    return { goals, items };
  }),

  updateRecurringCashflow: protectedProcedure
    .input(
      z.object({
        cashflowId: positiveId,
        amountCents: cents.optional(),
        nextDueDate: isoDate.nullable().optional(),
        status: z.string().trim().min(1).max(24).optional(),
        estimated: z.boolean().optional(),
        needsConfirmation: z.boolean().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { cashflowId, ...data } = input;
      try {
        return await coreDb.updateRecurringCashflow(
          await scopeFor(ctx.user),
          cashflowId,
          data,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  updateDebt: protectedProcedure
    .input(
      z.object({
        debtId: positiveId,
        balanceCents: cents.optional(),
        dueDate: isoDate.nullable().optional(),
        minimumPaymentCents: cents.nullable().optional(),
        priority: z.string().trim().min(1).max(24).optional(),
        status: z.string().trim().min(1).max(24).optional(),
        needsConfirmation: z.boolean().optional(),
        notes: z.string().trim().max(2_000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { debtId, ...data } = input;
      try {
        return await coreDb.updateFinancialDebt(
          await scopeFor(ctx.user),
          debtId,
          data,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  updateTask: protectedProcedure
    .input(
      z.object({
        taskId: positiveId,
        status: z
          .enum(["open", "in_progress", "completed", "cancelled"])
          .optional(),
        dueAt: occurredAt.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { taskId, ...data } = input;
      try {
        return await coreDb.updateFinancialTask(
          await scopeFor(ctx.user),
          taskId,
          data,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  audit: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(500).default(100) })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      coreDb.listFinancialAuditEvents(
        await scopeFor(ctx.user),
        input?.limit ?? 100
      )
    ),

  setPrivacyConsent: protectedProcedure
    .input(
      z.object({
        purpose: z.string().trim().min(1).max(120),
        legalBasis: z.string().trim().min(1).max(80),
        policyVersion: z.string().trim().min(1).max(40),
        accepted: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      coreDb.recordPrivacyConsent(await scopeFor(ctx.user), input)
    ),

  exportData: protectedProcedure.mutation(async ({ ctx }) => {
    const scope = await scopeFor(ctx.user);
    const request = await coreDb.createDataSubjectRequest(
      scope,
      "export",
      { channel: "web" },
      actor
    );
    const exportData = await coreDb.exportCanonicalFinancialData(scope);
    return { request, export: exportData };
  }),

  requestDataDeletion: protectedProcedure
    .input(
      z.object({
        confirmation: z.literal("EXCLUIR MEUS DADOS FINANCEIROS"),
      })
    )
    .mutation(async ({ ctx }) =>
      coreDb.createDataSubjectRequest(
        await scopeFor(ctx.user),
        "deletion",
        {
          channel: "web",
          statusNote:
            "Aguardando revisao segura; nenhuma exclusao automatica executada.",
        },
        actor
      )
    ),

  createGoal: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        goalType: z.string().trim().min(1).max(40),
        targetCents: positiveCents,
        fundedCents: cents.default(0),
        targetDate: isoDate.nullable().optional(),
        priority: z.enum(["critical", "essential", "important", "optional"]),
        protected: z.boolean().default(false),
        status: z
          .enum(["planned", "active", "funded", "completed", "blocked"])
          .default("planned"),
        notes: z.string().trim().max(2_000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.createFinancialGoal(
          await scopeFor(ctx.user),
          input,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  updateGoalItem: protectedProcedure
    .input(
      z.object({
        itemId: positiveId,
        status: z
          .enum(["planned", "funded", "purchased", "cancelled"])
          .optional(),
        actualCostCents: cents.nullable().optional(),
        desiredDate: isoDate.nullable().optional(),
        notes: z.string().trim().max(2_000).nullable().optional(),
        priority: z.enum(["essential", "important", "optional"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { itemId, ...data } = input;
      try {
        return await coreDb.updateFinancialGoalItem(
          await scopeFor(ctx.user),
          itemId,
          data,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  projects: protectedProcedure.query(async ({ ctx }) => {
    const scope = await scopeFor(ctx.user);
    const [projects, installments] = await Promise.all([
      coreDb.listFinancialProjects(scope),
      coreDb.listProjectInstallments(scope),
    ]);
    return { projects, installments };
  }),

  createProject: protectedProcedure
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(255),
          clientName: z.string().trim().max(255).nullable().optional(),
          stage: z.enum([
            "lead",
            "proposal",
            "negotiation",
            "won",
            "delivery",
            "completed",
            "lost",
          ]),
          grossValueCents: cents,
          expectedCostCents: cents.nullable().optional(),
          taxBasisPoints: basisPoints.default(1_500),
          costBasisPoints: basisPoints.default(1_000),
          probabilityPercent: z.number().int().min(0).max(100).default(0),
          startedAt: isoDate.nullable().optional(),
          expectedDeliveryAt: isoDate.nullable().optional(),
          status: z
            .enum(["active", "completed", "cancelled"])
            .default("active"),
          notes: z.string().trim().max(2_000).nullable().optional(),
          installments: z
            .array(
              z.object({
                amountCents: positiveCents,
                expectedAt: isoDate.nullable().optional(),
              })
            )
            .max(120)
            .default([]),
        })
        .refine(
          value => value.taxBasisPoints + value.costBasisPoints <= 10_000,
          "Impostos e custos nao podem ultrapassar 100%"
        )
    )
    .mutation(async ({ ctx, input }) => {
      const { installments, ...project } = input;
      try {
        return await coreDb.createFinancialProject(
          await scopeFor(ctx.user),
          project,
          installments,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  confirmProjectPayment: protectedProcedure
    .input(
      z.object({
        installmentId: positiveId,
        accountId: positiveId,
        receivedAt: occurredAt,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.confirmProjectInstallmentReceived(
          await scopeFor(ctx.user),
          { ...input, actor }
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  simulatePurchase: protectedProcedure
    .input(
      z.object({
        amountCents: positiveCents,
        desiredDate: isoDate,
        nextIncomeDate: isoDate.nullable().optional(),
      })
    )
    .query(({ ctx, input }) =>
      simulateCanonicalPurchase(ctx.user.id, {
        ...input,
        expectedTenantId: ctx.user.tenantId,
      })
    ),

  simulateCar: protectedProcedure
    .input(
      z.object({
        vehiclePriceCents: cents.nullable(),
        downPaymentCents: cents.nullable(),
        installmentCents: cents.nullable(),
        termMonths: z.number().int().positive().max(120).nullable(),
        cetAnnualBasisPoints: basisPoints.nullable(),
        insuranceMonthlyCents: cents.nullable(),
        fuelMonthlyCents: cents.nullable(),
        ipvaAnnualCents: cents.nullable(),
        maintenanceMonthlyCents: cents.nullable(),
        licensingAnnualCents: cents.default(0),
        expensiveDebtCents: cents.default(0),
        downPaymentSeparated: z.boolean(),
        futureIncomeConfirmed: z.boolean(),
        overdraftUsedCents: cents.default(0),
        fixedCostsConfirmed: z.boolean().optional(),
        priorityAPlanComplete: z.boolean().optional(),
      })
    )
    .query(({ ctx, input }) =>
      simulateCanonicalCar(ctx.user.id, {
        ...input,
        expectedTenantId: ctx.user.tenantId,
      })
    ),

  cashflow: protectedProcedure
    .input(
      z.object({
        startDate: isoDate,
        endDate: isoDate,
        scenario: z.enum(["conservative", "base", "growth", "aggressive"]),
      })
    )
    .query(({ ctx, input }) =>
      listCanonicalCashflow(ctx.user.id, {
        ...input,
        expectedTenantId: ctx.user.tenantId,
      })
    ),

  budgetStatus: protectedProcedure
    .input(
      z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/, "Use AAAA-MM"),
        categoryId: positiveId.nullable().optional(),
      })
    )
    .query(({ ctx, input }) =>
      getCanonicalBudgetStatus(ctx.user.id, {
        ...input,
        expectedTenantId: ctx.user.tenantId,
      })
    ),

  allocateIncome: protectedProcedure
    .input(
      z.object({
        transactionId: positiveId,
        allocations: z
          .array(
            z.object({
              allocationType: z.string().trim().min(1).max(32),
              amountCents: positiveCents,
              envelopeId: positiveId.nullable().optional(),
              goalId: positiveId.nullable().optional(),
            })
          )
          .min(1)
          .max(50),
        requestId,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.allocateConfirmedIncome(await scopeFor(ctx.user), {
          ...input,
          requestId: `web:${input.requestId}`,
          actor,
        });
      } catch (error) {
        asBadRequest(error);
      }
    }),

  createReminder: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(500),
        dueAt: occurredAt,
        recurrenceRule: z.string().trim().max(255).nullable().optional(),
        requestId,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.createFinancialReminder(
          await scopeFor(ctx.user),
          {
            title: input.title,
            dueAt: input.dueAt,
            recurrenceRule: input.recurrenceRule,
            idempotencyKey: `web:${input.requestId}`,
          },
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  fifthBusinessDay: protectedProcedure
    .input(
      z.object({
        year: z.number().int().min(1900).max(2200),
        month: z.number().int().min(1).max(12),
      })
    )
    .query(({ ctx, input }) =>
      getCanonicalFifthBusinessDay(ctx.user.id, {
        ...input,
        expectedTenantId: ctx.user.tenantId,
      })
    ),

  addBusinessHoliday: protectedProcedure
    .input(
      z.object({
        date: isoDate,
        name: z.string().trim().min(1).max(255),
        scope: z.string().trim().min(1).max(24).default("custom"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.upsertBusinessHoliday(
          await scopeFor(ctx.user),
          {
            date: input.date,
            name: input.name,
            holidayScope: input.scope,
            source: "user",
          },
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  pauseNotifications: protectedProcedure
    .input(z.object({ until: occurredAt.nullable() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.pauseFinancialNotifications(
          await scopeFor(ctx.user),
          input.until,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  setNotificationOptIn: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await coreDb.setFinancialNotificationOptIn(
          await scopeFor(ctx.user),
          input.enabled,
          actor
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  importSantander: protectedProcedure
    .input(
      z.object({
        accountId: positiveId,
        fileName: z.string().trim().min(1).max(255),
        contentBase64: z.string().min(1).max(7_000_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const buffer = Buffer.from(input.contentBase64, "base64");
        if (
          buffer.byteLength === 0 ||
          buffer.toString("base64") !== input.contentBase64.replace(/\s/g, "")
        ) {
          throw new Error("Conteudo Base64 invalido");
        }
        const statement = parseSantanderStatement(buffer);
        return await coreDb.importSantanderStatement(await scopeFor(ctx.user), {
          accountId: input.accountId,
          fileName: input.fileName,
          statement,
          actor: { type: "import", id: `user:${ctx.user.id}` },
        });
      } catch (error) {
        if (error instanceof SantanderStatementError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error.details,
          });
        }
        asBadRequest(error);
      }
    }),
});
