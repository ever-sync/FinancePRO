import { createHmac } from "node:crypto";
import { z } from "zod";
import { ENV } from "./_core/env";
import { isStrongSecret, secretsMatch } from "./_core/secrets";
import * as agentDb from "./db/agent";
import * as whatsappDb from "./db/whatsapp";
import * as financialAdvisor from "./financial-advisor";
import * as canonicalDb from "./db/financial-core";
import * as operationsDb from "./db/financial-operations";
import * as lifelongDb from "./db/lifelong-plan";
import {
  getCanonicalBudgetStatus,
  getCanonicalFinancialSnapshot,
  listCanonicalCashflow,
  simulateCanonicalCar,
  simulateCanonicalPurchase,
} from "./financial-core";
import { parseBrazilianMoneyExpression } from "../shared/financial-core";

const CANONICAL_AGENT_ACTIONS = [
  "get_financial_snapshot",
  "get_registration_context",
  "list_financial_items",
  "list_financial_calendar",
  "get_upcoming_cashflow",
  "get_budget_status",
  "list_financial_transactions",
  "set_financial_account_balance",
  "record_financial_transaction",
  "record_expense",
  "record_income",
  "record_financial_transfer",
  "create_transfer",
  "undo_financial_transaction",
  "create_financial_account",
  "update_financial_account",
  "archive_financial_account",
  "create_payable",
  "create_receivable",
  "create_recurrence",
  "create_installment_plan",
  "create_card_purchase",
  "settle_payable",
  "settle_receivable",
  "update_financial_item",
  "update_recurrence",
  "cancel_financial_item",
  "undo_financial_action",
  "categorize_financial_transaction",
  "allocate_income",
  "create_financial_goal",
  "update_financial_goal_item",
  "update_recurring_cashflow",
  "update_financial_debt",
  "update_financial_task",
  "create_financial_project",
  "confirm_project_payment",
  "simulate_purchase",
  "simulate_car",
  "get_lifelong_plan",
  "propose_income_allocation",
  "confirm_income_allocation",
  "confirm_financial_phase",
  "set_income_2027_confirmation",
  "record_credit_health",
  "update_credit_cleanup_task",
  "upsert_asset",
  "record_car_quote",
  "set_investment_policy",
  "upsert_investment_position",
  "record_dividend",
  "create_reminder",
  "pause_notifications",
  "set_notification_preference",
] as const;

const entityTypeSchema = z.enum(agentDb.AGENT_ENTITY_TYPES);
const operationSchema = z.enum(["create", "update", "delete"]);
const positiveIdSchema = z.number().int().positive();
const monthSchema = z.number().int().min(1).max(12);
const yearSchema = z.number().int().min(1900).max(2200);
const daySchema = z.number().int().min(1).max(31);
const shortText = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(2_000).optional();
const nullableText = z.string().trim().max(2_000).nullable().optional();
const moneySchema = z.preprocess(
  value =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : value,
  z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, "valor monetario invalido")
);
const signedMoneySchema = z.preprocess(
  value =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : value,
  z
    .string()
    .trim()
    .regex(/^-?(0|[1-9]\d{0,9})(\.\d{1,2})?$/, "valor monetario invalido")
);
const percentageSchema = z.preprocess(
  value =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : value,
  z
    .string()
    .trim()
    .refine(
      value =>
        /^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(value) && Number(value) <= 100,
      "percentual invalido"
    )
);
const isoDateSchema = z
  .string()
  .trim()
  .refine(value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      year >= 1900 &&
      year <= 2200 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    );
  }, "data invalida; use AAAA-MM-DD");

function createUpdateSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .strict()
    .partial()
    .refine(value => Object.keys(value).length > 0, {
      message: "informe pelo menos um campo para atualizar",
    });
}

const recordSchemas = {
  revenue: {
    create: z
      .object({
        description: shortText,
        category: z.string().trim().min(1).max(100),
        grossAmount: moneySchema,
        taxAmount: moneySchema,
        netAmount: moneySchema,
        client: z.string().trim().max(255).optional(),
        dueDate: isoDateSchema,
        receivedDate: isoDateSchema.nullable().optional(),
        status: z
          .enum(["pendente", "recebido", "atrasado", "cancelado"])
          .optional(),
        seriesId: z.string().trim().max(64).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      description: shortText,
      category: z.string().trim().min(1).max(100),
      grossAmount: moneySchema,
      taxAmount: moneySchema,
      netAmount: moneySchema,
      client: z.string().trim().max(255).nullable(),
      dueDate: isoDateSchema,
      receivedDate: isoDateSchema.nullable(),
      status: z.enum(["pendente", "recebido", "atrasado", "cancelado"]),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  company_fixed_cost: {
    create: z
      .object({
        description: shortText,
        category: z.string().trim().min(1).max(100),
        amount: moneySchema,
        dueDay: daySchema,
        dueDate: isoDateSchema.nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        month: monthSchema,
        year: yearSchema,
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      description: shortText,
      category: z.string().trim().min(1).max(100),
      amount: moneySchema,
      dueDay: daySchema,
      dueDate: isoDateSchema.nullable(),
      status: z.enum(["pago", "pendente", "atrasado"]),
      month: monthSchema,
      year: yearSchema,
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  company_variable_cost: {
    create: z
      .object({
        description: shortText,
        category: z.string().trim().min(1).max(100),
        amount: moneySchema,
        date: isoDateSchema,
        supplier: z.string().trim().max(255).optional(),
        installmentCount: z.literal(1).optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      description: shortText,
      category: z.string().trim().min(1).max(100),
      amount: moneySchema,
      date: isoDateSchema,
      supplier: z.string().trim().max(255).nullable(),
      status: z.enum(["pago", "pendente", "atrasado"]),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  employee: {
    create: z
      .object({
        name: z.string().trim().min(1).max(255),
        role: z.string().trim().min(1).max(255),
        contractType: z.enum(["clt", "pj"]).optional(),
        salary: moneySchema,
        fgtsAmount: moneySchema,
        thirteenthProvision: moneySchema,
        vacationProvision: moneySchema,
        totalCost: moneySchema,
        paymentDay: daySchema.optional(),
        admissionDate: isoDateSchema.nullable().optional(),
        status: z.enum(["ativo", "inativo"]).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      name: z.string().trim().min(1).max(255),
      role: z.string().trim().min(1).max(255),
      contractType: z.enum(["clt", "pj"]),
      salary: moneySchema,
      fgtsAmount: moneySchema,
      thirteenthProvision: moneySchema,
      vacationProvision: moneySchema,
      totalCost: moneySchema,
      paymentDay: daySchema,
      admissionDate: isoDateSchema.nullable(),
      status: z.enum(["ativo", "inativo"]),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  supplier: {
    create: z
      .object({
        name: z.string().trim().min(1).max(255),
        cnpj: z.string().trim().max(20).optional(),
        category: z.string().trim().max(100).optional(),
        contact: z.string().trim().max(255).optional(),
        phone: z.string().trim().max(20).optional(),
        email: z.string().trim().email().max(320).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      name: z.string().trim().min(1).max(255),
      cnpj: z.string().trim().max(20).nullable(),
      category: z.string().trim().max(100).nullable(),
      contact: z.string().trim().max(255).nullable(),
      phone: z.string().trim().max(20).nullable(),
      email: z.string().trim().email().max(320).nullable(),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  supplier_purchase: {
    create: z
      .object({
        supplierId: positiveIdSchema,
        description: shortText,
        amount: moneySchema,
        dueDate: isoDateSchema,
        paidDate: isoDateSchema.nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        paymentMethod: z.string().trim().max(100).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      supplierId: positiveIdSchema,
      description: shortText,
      amount: moneySchema,
      dueDate: isoDateSchema,
      paidDate: isoDateSchema.nullable(),
      status: z.enum(["pago", "pendente", "atrasado"]),
      paymentMethod: z.string().trim().max(100).nullable(),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  personal_fixed_cost: {
    create: z
      .object({
        description: shortText,
        category: z.string().trim().min(1).max(100),
        amount: moneySchema,
        dueDay: daySchema,
        dueDate: isoDateSchema.nullable().optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        month: monthSchema,
        year: yearSchema,
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      description: shortText,
      category: z.string().trim().min(1).max(100),
      amount: moneySchema,
      dueDay: daySchema,
      dueDate: isoDateSchema.nullable(),
      status: z.enum(["pago", "pendente", "atrasado"]),
      month: monthSchema,
      year: yearSchema,
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  personal_variable_cost: {
    create: z
      .object({
        description: shortText,
        category: z.string().trim().min(1).max(100),
        amount: moneySchema,
        date: isoDateSchema,
        installmentCount: z.literal(1).optional(),
        status: z.enum(["pago", "pendente", "atrasado"]).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      description: shortText,
      category: z.string().trim().min(1).max(100),
      amount: moneySchema,
      date: isoDateSchema,
      status: z.enum(["pago", "pendente", "atrasado"]),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  debt: {
    create: z
      .object({
        creditor: z.string().trim().min(1).max(255),
        description: shortText,
        originalAmount: moneySchema,
        currentBalance: moneySchema,
        monthlyPayment: moneySchema,
        interestRate: percentageSchema.optional(),
        totalInstallments: z.number().int().min(1).max(1_200),
        paidInstallments: z.number().int().min(0).max(1_200).optional(),
        dueDay: daySchema,
        status: z
          .enum(["ativa", "atrasada", "quitada", "renegociada"])
          .optional(),
        priority: z.enum(["alta", "media", "baixa"]).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      creditor: z.string().trim().min(1).max(255),
      description: shortText,
      originalAmount: moneySchema,
      currentBalance: moneySchema,
      monthlyPayment: moneySchema,
      interestRate: percentageSchema,
      totalInstallments: z.number().int().min(1).max(1_200),
      paidInstallments: z.number().int().min(0).max(1_200),
      dueDay: daySchema,
      status: z.enum(["ativa", "atrasada", "quitada", "renegociada"]),
      priority: z.enum(["alta", "media", "baixa"]),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  investment: {
    create: z
      .object({
        description: shortText,
        institution: z.string().trim().min(1).max(255),
        type: z.string().trim().min(1).max(100),
        depositAmount: moneySchema,
        currentBalance: moneySchema.optional(),
        yieldAmount: signedMoneySchema.optional(),
        date: isoDateSchema,
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      description: shortText,
      institution: z.string().trim().min(1).max(255),
      type: z.string().trim().min(1).max(100),
      depositAmount: moneySchema,
      currentBalance: moneySchema,
      yieldAmount: signedMoneySchema,
      date: isoDateSchema,
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  reserve_fund: {
    create: z
      .object({
        type: z.enum(["empresa", "pessoal"]),
        depositAmount: moneySchema,
        date: isoDateSchema,
        description: z.string().trim().max(500).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      type: z.enum(["empresa", "pessoal"]),
      depositAmount: moneySchema,
      date: isoDateSchema,
      description: z.string().trim().max(500).nullable(),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  client: {
    create: z
      .object({
        name: z.string().trim().min(1).max(255),
        document: z.string().trim().max(20).optional(),
        category: z.string().trim().max(100).optional(),
        contact: z.string().trim().max(255).optional(),
        phone: z.string().trim().max(20).optional(),
        email: z.string().trim().email().max(320).optional(),
        address: z.string().trim().max(500).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      name: z.string().trim().min(1).max(255),
      document: z.string().trim().max(20).nullable(),
      category: z.string().trim().max(100).nullable(),
      contact: z.string().trim().max(255).nullable(),
      phone: z.string().trim().max(20).nullable(),
      email: z.string().trim().email().max(320).nullable(),
      address: z.string().trim().max(500).nullable(),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
  service: {
    create: z
      .object({
        name: z.string().trim().min(1).max(255),
        description: z.string().trim().max(2_000).optional(),
        category: z.string().trim().max(100).optional(),
        basePrice: moneySchema,
        unit: z.string().trim().max(50).optional(),
        recurrence: z.string().trim().max(20).optional(),
        status: z.string().trim().max(20).optional(),
        notes: optionalText,
      })
      .strict(),
    update: createUpdateSchema({
      name: z.string().trim().min(1).max(255),
      description: z.string().trim().max(2_000).nullable(),
      category: z.string().trim().max(100).nullable(),
      basePrice: moneySchema,
      unit: z.string().trim().max(50),
      recurrence: z.string().trim().max(20).nullable(),
      status: z.string().trim().max(20),
      notes: z.string().trim().max(2_000).nullable(),
    }),
  },
} satisfies Record<
  agentDb.AgentEntityType,
  { create: z.ZodType; update: z.ZodType }
>;

const AGENT_TOOL_ACTIONS = [
  "health",
  "get_context",
  "list_records",
  "propose_change",
  "execute_change",
  "cancel_change",
  ...CANONICAL_AGENT_ACTIONS,
] as const;

export const agentToolRequestSchema = z
  .object({
    action: z.enum(AGENT_TOOL_ACTIONS),
    integrationId: positiveIdSchema.optional(),
    threadId: positiveIdSchema.nullable().optional(),
    entityType: entityTypeSchema.optional(),
    operation: operationSchema.optional(),
    entityId: positiveIdSchema.nullable().optional(),
    payload: z.unknown().optional(),
    summary: z.string().trim().min(1).max(1_000).optional(),
    requestId: z.string().trim().min(1).max(160).optional(),
    commandId: positiveIdSchema.optional(),
    confirmationCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type AgentToolRequest = z.infer<typeof agentToolRequestSchema>;

export class AgentToolError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string
  ) {
    super(message);
  }
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new AgentToolError(400, message, "INVALID_REQUEST");
  return value;
}

function parsePayload(payload: unknown) {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw new AgentToolError(
        400,
        "payload deve ser um objeto JSON valido",
        "INVALID_PAYLOAD"
      );
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AgentToolError(
      400,
      "payload deve ser um objeto JSON",
      "INVALID_PAYLOAD"
    );
  }
  return payload as Record<string, unknown>;
}

function createConfirmationCode(userId: number, requestId: string) {
  const digest = createHmac("sha256", ENV.n8nAgentSecret)
    .update(`code:${userId}:${requestId}`)
    .digest();
  return String(100_000 + (digest.readUInt32BE(0) % 900_000));
}

function hashConfirmationCode(userId: number, requestId: string, code: string) {
  return createHmac("sha256", ENV.n8nAgentSecret)
    .update(`confirmation:${userId}:${requestId}:${code}`)
    .digest("hex");
}

function sanitizeRecord(record: Record<string, unknown>) {
  const blocked = new Set([
    "userId",
    "apiToken",
    "asaasPaymentId",
    "asaasSubscriptionId",
    "asaasInvoiceUrl",
    "asaasBankSlipUrl",
    "asaasExternalReference",
  ]);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !blocked.has(key))
  );
}

async function resolveScope(integrationId: number, threadId?: number | null) {
  const integration =
    await whatsappDb.getWhatsAppIntegrationById(integrationId);
  if (!integration || !integration.enabled) {
    throw new AgentToolError(
      404,
      "Integracao WhatsApp ativa nao encontrada",
      "INTEGRATION_NOT_FOUND"
    );
  }
  if (threadId != null) {
    const thread = await whatsappDb.getAssistantThreadById(
      integration.userId,
      integration.id,
      threadId
    );
    if (!thread) {
      throw new AgentToolError(
        404,
        "Conversa nao encontrada para esta integracao",
        "THREAD_NOT_FOUND"
      );
    }
  }
  return integration;
}

export function isN8nAgentReady() {
  return isStrongSecret(ENV.n8nAgentSecret);
}

const canonicalCentsSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const canonicalPositiveCentsSchema = canonicalCentsSchema.refine(
  value => value > 0,
  "valor deve ser maior que zero"
);
const canonicalDateSchema = z
  .string()
  .trim()
  .refine(value => !Number.isNaN(Date.parse(value)), "data invalida");
const canonicalIsoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");

function canonicalPayload(input: AgentToolRequest) {
  return parsePayload(input.payload);
}

function resolveCanonicalAmount(payload: Record<string, unknown>) {
  if (typeof payload.amountCents === "number") {
    return canonicalPositiveCentsSchema.parse(payload.amountCents);
  }
  if (typeof payload.amountText === "string") {
    const parsed = parseBrazilianMoneyExpression(payload.amountText);
    if (parsed.kind === "value")
      return canonicalPositiveCentsSchema.parse(parsed.amountCents);
    if (parsed.kind === "ambiguous") {
      const [first, second] = parsed.alternativesCents;
      throw new AgentToolError(
        409,
        `Valor ambiguo. Confirme se quis dizer ${first} ou ${second} centavos.`,
        "AMBIGUOUS_MONEY"
      );
    }
  }
  throw new AgentToolError(
    400,
    "Informe amountCents (inteiro) ou amountText",
    "INVALID_AMOUNT"
  );
}

function canonicalActor(integrationId: number, threadId?: number | null) {
  return {
    type: "assistant" as const,
    id: `n8n:${integrationId}:${threadId ?? "no-thread"}`,
  };
}

function operationalWriteContext(
  input: AgentToolRequest,
  integrationId: number,
  actor: ReturnType<typeof canonicalActor>
) {
  const request = requireValue(input.requestId, "requestId e obrigatorio");
  return {
    actor,
    idempotencyKey: `n8n:${integrationId}:${request}`,
    conversationId:
      input.threadId == null ? null : `whatsapp-thread:${input.threadId}`,
    messageId: request,
  };
}

const financialItemScopeSchema = z.enum([
  "THIS_OCCURRENCE",
  "THIS_AND_FUTURE",
  "ALL_OCCURRENCES",
]);

const incomeKindSchema = z.enum([
  "salary_fixed",
  "owner_draw",
  "profit_distribution",
  "project_payment",
  "saas_recurring_revenue",
  "asset_sale",
  "refund",
  "bonus",
  "tax_refund",
  "dividend",
  "interest",
  "gift",
  "loan_proceeds",
  "transfer_between_own_accounts",
  "unknown",
]);

async function handleCanonicalAgentAction(
  input: AgentToolRequest,
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegrationById>>
  >
) {
  const scope = await canonicalDb.resolveFinancialScope(integration.userId);
  const actor = canonicalActor(integration.id, input.threadId);

  if (input.action === "get_registration_context") {
    return {
      ok: true,
      context: await operationsDb.getRegistrationContextV3(scope),
    };
  }
  if (
    input.action === "list_financial_items" ||
    input.action === "list_financial_calendar"
  ) {
    const parsed = z
      .object({
        kind: z.enum(["payable", "receivable"]).optional(),
        status: z.string().trim().min(1).max(32).optional(),
        startDate: canonicalIsoDateSchema.optional(),
        endDate: canonicalIsoDateSchema.optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .strict()
      .refine(
        value =>
          !value.startDate ||
          !value.endDate ||
          value.startDate <= value.endDate,
        "periodo invalido"
      )
      .parse(input.payload == null ? {} : canonicalPayload(input));
    const items = await operationsDb.listFinancialItemsV3(scope, parsed);
    return { ok: true, count: items.length, items };
  }
  if (input.action === "get_lifelong_plan") {
    return {
      ok: true,
      plan: await lifelongDb.getLifelongPlanData(scope),
    };
  }

  if (input.action === "get_financial_snapshot") {
    return {
      ok: true,
      snapshot: await getCanonicalFinancialSnapshot(integration.userId, {
        expectedTenantId: scope.tenantId,
      }),
    };
  }
  if (input.action === "create_financial_account") {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(255),
        code: z.string().trim().min(1).max(120).nullable().optional(),
        ownerType: z.enum(["personal", "business"]),
        accountType: z.enum([
          "checking",
          "savings",
          "reserve",
          "credit_card",
          "cash",
          "investment",
          "goal_wallet",
          "other",
        ]),
        institution: z.string().trim().max(255).nullable().optional(),
        currency: z.string().trim().length(3).default("BRL"),
        initialBalanceCents: z
          .number()
          .int()
          .min(-Number.MAX_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER)
          .nullable()
          .optional(),
        balanceAsOf: canonicalDateSchema.nullable().optional(),
        includeInOperatingCash: z.boolean().optional(),
        protected: z.boolean().optional(),
        needsConfirmation: z.boolean().optional(),
        closingDay: z.number().int().min(1).max(31).nullable().optional(),
        dueDay: z.number().int().min(1).max(31).nullable().optional(),
        creditLimitCents: canonicalCentsSchema.nullable().optional(),
        paymentAccountId: positiveIdSchema.nullable().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.createFinancialAccountV3(
        scope,
        {
          ...parsed,
          balanceAsOf: parsed.balanceAsOf ? new Date(parsed.balanceAsOf) : null,
        },
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "update_financial_account") {
    const parsed = z
      .object({
        accountId: positiveIdSchema,
        patch: z
          .object({
            name: z.string().trim().min(1).max(255).optional(),
            code: z.string().trim().min(1).max(120).nullable().optional(),
            institution: z.string().trim().max(255).nullable().optional(),
            includeInOperatingCash: z.boolean().optional(),
            protected: z.boolean().optional(),
            needsConfirmation: z.boolean().optional(),
            closingDay: z.number().int().min(1).max(31).nullable().optional(),
            dueDay: z.number().int().min(1).max(31).nullable().optional(),
            creditLimitCents: canonicalCentsSchema.nullable().optional(),
            paymentAccountId: positiveIdSchema.nullable().optional(),
          })
          .strict()
          .refine(value => Object.keys(value).length > 0, "patch vazio"),
        confirmation: z.literal("CONFIRMO ALTERACAO DE PROTECAO").optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (
          value.patch.protected === false &&
          value.confirmation !== "CONFIRMO ALTERACAO DE PROTECAO"
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confirmation"],
            message: "confirmacao explicita obrigatoria",
          });
      })
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.updateFinancialAccountV3(
        scope,
        { accountId: parsed.accountId, patch: parsed.patch },
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "archive_financial_account") {
    const parsed = z
      .object({
        accountId: positiveIdSchema,
        reason: z.string().trim().min(1).max(1_000),
        confirmation: z.literal("CONFIRMO ARQUIVAMENTO DA CONTA"),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.archiveFinancialAccountV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (
    input.action === "create_payable" ||
    input.action === "create_receivable"
  ) {
    const payload = canonicalPayload(input);
    const parsed = z
      .object({
        amountCents: canonicalPositiveCentsSchema.optional(),
        amountText: z.string().trim().min(1).max(120).optional(),
        description: shortText,
        dueDate: canonicalIsoDateSchema,
        competenceDate: canonicalIsoDateSchema.optional(),
        ownerType: z.enum(["personal", "business"]),
        counterparty: z.string().trim().max(255).nullable().optional(),
        categoryId: positiveIdSchema.nullable().optional(),
        expectedAccountId: positiveIdSchema.nullable().optional(),
        estimated: z.boolean().default(false),
        needsConfirmation: z.boolean().default(false),
        draft: z.boolean().default(false),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .strict()
      .parse(payload);
    return {
      ok: true,
      ...(await operationsDb.createFinancialItemV3(
        scope,
        {
          ...parsed,
          kind: input.action === "create_payable" ? "payable" : "receivable",
          amountCents: resolveCanonicalAmount(parsed),
          origin: "whatsapp",
          sourceMessageId: input.requestId,
        },
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "create_recurrence") {
    const payload = canonicalPayload(input);
    const parsed = z
      .object({
        itemKind: z.enum(["payable", "receivable"]),
        ownerType: z.enum(["personal", "business"]),
        description: shortText,
        frequency: z.enum([
          "daily",
          "weekly",
          "monthly",
          "yearly",
          "business_day_rule",
        ]),
        interval: z.number().int().min(1).max(365).default(1),
        byWeekday: z
          .array(z.number().int().min(0).max(6))
          .nullable()
          .optional(),
        byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
        businessDayOrdinal: z
          .number()
          .int()
          .min(1)
          .max(31)
          .nullable()
          .optional(),
        startDate: canonicalIsoDateSchema,
        endDate: canonicalIsoDateSchema.nullable().optional(),
        timezone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"),
        amountMode: z.enum(["fixed", "estimated", "variable"]).default("fixed"),
        baseAmountCents: canonicalPositiveCentsSchema.optional(),
        amountCents: canonicalPositiveCentsSchema.optional(),
        amountText: z.string().trim().min(1).max(120).optional(),
        expectedAccountId: positiveIdSchema.nullable().optional(),
        categoryId: positiveIdSchema.nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .strict()
      .parse(payload);
    const baseAmountCents =
      parsed.baseAmountCents ?? resolveCanonicalAmount(parsed);
    return {
      ok: true,
      ...(await operationsDb.createRecurrenceV3(
        scope,
        {
          ...parsed,
          baseAmountCents,
          sourceMessageId: input.requestId,
        },
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "create_installment_plan") {
    const parsed = z
      .object({
        description: shortText,
        planType: z
          .enum(["purchase", "income", "debt", "card_purchase"])
          .default("purchase"),
        kind: z.enum(["payable", "receivable"]),
        ownerType: z.enum(["personal", "business"]),
        totalAmountCents: canonicalPositiveCentsSchema,
        installmentCount: z.number().int().min(1).max(240),
        firstDueDate: canonicalIsoDateSchema,
        accountId: positiveIdSchema.nullable().optional(),
        creditCardId: positiveIdSchema.nullable().optional(),
        categoryId: positiveIdSchema.nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.createInstallmentPlanV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "create_card_purchase") {
    const parsed = z
      .object({
        creditCardId: positiveIdSchema,
        paymentAccountId: positiveIdSchema,
        totalAmountCents: canonicalPositiveCentsSchema,
        description: shortText,
        occurredAt: canonicalDateSchema,
        installmentCount: z.number().int().min(1).max(240),
        firstDueDate: canonicalIsoDateSchema,
        ownerType: z.enum(["personal", "business"]),
        categoryId: positiveIdSchema.nullable().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.createCardPurchaseV3(
        scope,
        { ...parsed, occurredAt: new Date(parsed.occurredAt) },
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (
    input.action === "settle_payable" ||
    input.action === "settle_receivable"
  ) {
    const payload = canonicalPayload(input);
    const parsed = z
      .object({
        itemId: positiveIdSchema,
        amountCents: canonicalPositiveCentsSchema.optional(),
        amountText: z.string().trim().min(1).max(120).optional(),
        settledAt: canonicalDateSchema,
        accountId: positiveIdSchema,
        protectedWithdrawalConfirmation: z
          .literal("CONFIRMO USO DA RESERVA")
          .optional(),
        incomeKind: incomeKindSchema.default("unknown"),
      })
      .strict()
      .parse(payload);
    const expectedKind =
      input.action === "settle_payable" ? "payable" : "receivable";
    const matched = (
      await operationsDb.listFinancialItemsV3(scope, { limit: 500 })
    ).find(candidate => candidate.id === parsed.itemId);
    if (!matched || matched.kind !== expectedKind)
      throw new AgentToolError(
        404,
        expectedKind === "payable"
          ? "Conta a pagar nao encontrada"
          : "Conta a receber nao encontrada",
        "FINANCIAL_ITEM_NOT_FOUND"
      );
    const context = operationalWriteContext(input, integration.id, actor);
    const settlement = await operationsDb.settleFinancialItemV3(
      scope,
      {
        itemId: parsed.itemId,
        amountCents: resolveCanonicalAmount(parsed),
        settledAt: new Date(parsed.settledAt),
        accountId: parsed.accountId,
        protectedWithdrawalConfirmed:
          parsed.protectedWithdrawalConfirmation === "CONFIRMO USO DA RESERVA",
      },
      context
    );
    const transactionId =
      "transaction" in settlement
        ? settlement.transaction.id
        : Number(
            (settlement.result as unknown as Record<string, unknown>)
              .transactionId
          );
    const allocation =
      expectedKind === "receivable" &&
      Number.isInteger(transactionId) &&
      transactionId > 0
        ? await lifelongDb.proposeIncomeAllocationV3(scope, {
            transactionId,
            incomeKind: parsed.incomeKind,
            idempotencyKey: `${context.idempotencyKey}:allocation`,
            actor,
            conversationId: context.conversationId,
            messageId: context.messageId,
          })
        : null;
    return {
      ok: true,
      ...settlement,
      allocation,
      externalBankMovement: false,
    };
  }
  if (input.action === "update_financial_item") {
    const parsed = z
      .object({
        itemId: positiveIdSchema,
        scope: financialItemScopeSchema,
        patch: z
          .object({
            amountCents: canonicalPositiveCentsSchema.optional(),
            description: shortText.optional(),
            counterparty: z.string().trim().max(255).nullable().optional(),
            categoryId: positiveIdSchema.nullable().optional(),
            expectedAccountId: positiveIdSchema.nullable().optional(),
            dueDate: canonicalIsoDateSchema.optional(),
            competenceDate: canonicalIsoDateSchema.optional(),
            estimated: z.boolean().optional(),
            needsConfirmation: z.boolean().optional(),
          })
          .strict()
          .refine(
            value => Object.keys(value).length > 0,
            "informe o que editar"
          ),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.updateFinancialItemV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "update_recurrence") {
    const parsed = z
      .object({
        recurrenceId: positiveIdSchema,
        effectiveFrom: canonicalIsoDateSchema,
        patch: z
          .object({
            description: shortText.optional(),
            baseAmountCents: canonicalPositiveCentsSchema.optional(),
            frequency: z
              .enum([
                "daily",
                "weekly",
                "monthly",
                "yearly",
                "business_day_rule",
              ])
              .optional(),
            interval: z.number().int().min(1).max(365).optional(),
            byWeekday: z
              .array(z.number().int().min(0).max(6))
              .nullable()
              .optional(),
            byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
            businessDayOrdinal: z
              .number()
              .int()
              .min(1)
              .max(31)
              .nullable()
              .optional(),
            endDate: canonicalIsoDateSchema.nullable().optional(),
            amountMode: z.enum(["fixed", "estimated", "variable"]).optional(),
            expectedAccountId: positiveIdSchema.nullable().optional(),
            categoryId: positiveIdSchema.nullable().optional(),
            status: z.enum(["active", "paused", "cancelled"]).optional(),
          })
          .strict()
          .refine(
            value => Object.keys(value).length > 0,
            "informe o que editar"
          ),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.updateRecurrenceRuleV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "cancel_financial_item") {
    const parsed = z
      .object({
        itemId: positiveIdSchema,
        scope: financialItemScopeSchema,
        reason: z.string().trim().min(1).max(500),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.cancelFinancialItemV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "undo_financial_action") {
    const parsed = z
      .object({
        actionId: positiveIdSchema.nullable().optional(),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .parse(input.payload == null ? {} : canonicalPayload(input));
    return {
      ok: true,
      ...(await operationsDb.undoFinancialActionV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
      externalBankMovement: false,
    };
  }
  if (input.action === "get_upcoming_cashflow") {
    const parsed = z
      .object({
        startDate: canonicalIsoDateSchema,
        endDate: canonicalIsoDateSchema,
        scenario: z
          .enum(["conservative", "base", "growth", "aggressive"])
          .default("base"),
      })
      .strict()
      .refine(value => value.startDate <= value.endDate, "periodo invalido")
      .parse(canonicalPayload(input));
    return {
      ok: true,
      cashflow: await listCanonicalCashflow(integration.userId, {
        ...parsed,
        expectedTenantId: scope.tenantId,
      }),
    };
  }
  if (input.action === "get_budget_status") {
    const parsed = z
      .object({
        period: z.string().regex(/^\d{4}-\d{2}$/, "use AAAA-MM"),
        categoryId: positiveIdSchema.nullable().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      budget: await getCanonicalBudgetStatus(integration.userId, {
        ...parsed,
        expectedTenantId: scope.tenantId,
      }),
    };
  }
  if (input.action === "list_financial_transactions") {
    const payload = input.payload == null ? {} : canonicalPayload(input);
    const parsed = z
      .object({
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).default(0),
        needsReview: z.boolean().optional(),
      })
      .strict()
      .parse(payload);
    const records = await canonicalDb.listFinancialTransactions(scope, parsed);
    return { ok: true, count: records.length, records };
  }
  if (input.action === "set_financial_account_balance") {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const parsed = z
      .object({
        accountId: positiveIdSchema,
        balanceCents: z
          .number()
          .int()
          .min(-Number.MAX_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER),
        balanceAsOf: canonicalDateSchema.optional(),
        protectedReductionConfirmation: z
          .literal("CONFIRMO REDUCAO DA RESERVA")
          .optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    const result = await canonicalDb.setFinancialAccountBalance(scope, {
      accountId: parsed.accountId,
      balanceCents: parsed.balanceCents,
      balanceAsOf: parsed.balanceAsOf
        ? new Date(parsed.balanceAsOf)
        : new Date(),
      protectedReductionConfirmed:
        parsed.protectedReductionConfirmation === "CONFIRMO REDUCAO DA RESERVA",
      idempotencyKey: `n8n:${integration.id}:${requestId}`,
      actor,
    });
    return {
      ok: true,
      ...result,
      externalBankMovement: false,
    };
  }
  if (
    input.action === "record_financial_transaction" ||
    input.action === "record_expense" ||
    input.action === "record_income"
  ) {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const payload = canonicalPayload(input);
    const parsed = z
      .object({
        accountId: positiveIdSchema,
        type: z.enum(["income", "expense"]).optional(),
        amountCents: canonicalPositiveCentsSchema.optional(),
        amountText: z.string().trim().min(1).max(120).optional(),
        occurredAt: canonicalDateSchema.optional(),
        description: shortText,
        categoryId: positiveIdSchema.nullable().optional(),
        status: z
          .enum(["confirmed", "expected", "paid", "received"])
          .default("confirmed"),
        counterparty: z.string().trim().max(255).nullable().optional(),
        documentNumber: z.string().trim().max(120).nullable().optional(),
        incomeKind: incomeKindSchema.default("unknown"),
      })
      .strict()
      .parse(payload);
    const amountCents = resolveCanonicalAmount(parsed);
    const type =
      input.action === "record_expense"
        ? "expense"
        : input.action === "record_income"
          ? "income"
          : parsed.type;
    if (!type)
      throw new AgentToolError(
        400,
        "Informe o tipo income ou expense",
        "INVALID_TRANSACTION_TYPE"
      );
    const result = await canonicalDb.recordFinancialTransaction(scope, {
      accountId: parsed.accountId,
      type,
      amountCents,
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : new Date(),
      description: parsed.description,
      categoryId: parsed.categoryId,
      status:
        input.action === "record_income"
          ? "received"
          : input.action === "record_expense"
            ? "paid"
            : parsed.status,
      counterparty: parsed.counterparty,
      documentNumber: parsed.documentNumber,
      source: "whatsapp",
      idempotencyKey: `n8n:${integration.id}:${requestId}`,
      actor,
    });
    const allocation =
      type === "income" &&
      ["confirmed", "received"].includes(result.transaction.status)
        ? await lifelongDb.proposeIncomeAllocationV3(scope, {
            transactionId: result.transaction.id,
            incomeKind: parsed.incomeKind,
            idempotencyKey: `n8n:${integration.id}:${requestId}:allocation`,
            actor,
            conversationId:
              input.threadId == null
                ? null
                : `whatsapp-thread:${input.threadId}`,
            messageId: requestId,
          })
        : null;
    return {
      ok: true,
      ...result,
      allocation,
      externalBankMovement: false,
      undoAvailableUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
      message: result.alreadyProcessed
        ? "Lancamento ja estava registrado."
        : "Lancamento registrado no FinancePRO. Se precisar, diga 'desfazer' em ate 15 minutos.",
    };
  }
  if (
    input.action === "record_financial_transfer" ||
    input.action === "create_transfer"
  ) {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const payload = canonicalPayload(input);
    const parsed = z
      .object({
        fromAccountId: positiveIdSchema,
        toAccountId: positiveIdSchema,
        amountCents: canonicalPositiveCentsSchema.optional(),
        amountText: z.string().trim().min(1).max(120).optional(),
        occurredAt: canonicalDateSchema.optional(),
        description: shortText.default("Transferencia interna manual"),
        protectedWithdrawalConfirmation: z
          .literal("CONFIRMO RETIRADA DA RESERVA")
          .optional(),
      })
      .strict()
      .parse(payload);
    const result = await canonicalDb.recordFinancialTransfer(scope, {
      fromAccountId: parsed.fromAccountId,
      toAccountId: parsed.toAccountId,
      amountCents: resolveCanonicalAmount(parsed),
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : new Date(),
      description: parsed.description,
      idempotencyKey: `n8n:${integration.id}:${requestId}`,
      source: "whatsapp",
      actor,
      protectedWithdrawalConfirmed:
        parsed.protectedWithdrawalConfirmation ===
        "CONFIRMO RETIRADA DA RESERVA",
    });
    return {
      ok: true,
      ...result,
      externalBankMovement: false,
      message:
        "Transferencia registrada somente no FinancePRO; nenhum dinheiro foi movimentado no banco.",
    };
  }
  if (input.action === "undo_financial_transaction") {
    const parsed = z
      .object({
        transactionId: positiveIdSchema,
        reason: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .default("Desfeito pelo usuario"),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await canonicalDb.reverseFinancialTransaction(scope, {
        ...parsed,
        actor,
        undoWindowMinutes: 15,
      })),
    };
  }
  if (input.action === "categorize_financial_transaction") {
    const parsed = z
      .object({
        transactionId: positiveIdSchema,
        categoryId: positiveIdSchema,
        createMerchantRule: z.boolean().default(true),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      transaction: await canonicalDb.categorizeFinancialTransaction(scope, {
        ...parsed,
        actor,
      }),
    };
  }
  if (input.action === "allocate_income") {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const parsed = z
      .object({
        transactionId: positiveIdSchema,
        allocations: z
          .array(
            z
              .object({
                allocationType: z.string().trim().min(1).max(32),
                amountCents: canonicalPositiveCentsSchema,
                envelopeId: positiveIdSchema.nullable().optional(),
                goalId: positiveIdSchema.nullable().optional(),
              })
              .strict()
              .refine(
                value => !(value.envelopeId && value.goalId),
                "use envelopeId ou goalId, nunca ambos"
              )
          )
          .min(1)
          .max(50),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await canonicalDb.allocateConfirmedIncome(scope, {
        ...parsed,
        requestId: `n8n:${integration.id}:${requestId}`,
        actor,
      })),
      externalBankMovement: false,
      message:
        "Receita separada no plano do FinancePRO; nenhuma transferencia bancaria foi executada.",
    };
  }
  if (input.action === "create_financial_goal") {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(255),
        goalType: z.string().trim().min(1).max(40).default("custom"),
        targetCents: canonicalPositiveCentsSchema,
        fundedCents: canonicalCentsSchema.default(0),
        targetDate: canonicalIsoDateSchema.nullable().optional(),
        priority: z
          .enum(["critical", "essential", "important", "optional"])
          .default("important"),
        protected: z.boolean().default(false),
        status: z.string().trim().max(24).default("planned"),
        notes: z.string().trim().max(2_000).nullable().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      goal: await canonicalDb.createFinancialGoal(scope, parsed, actor),
    };
  }
  if (input.action === "update_recurring_cashflow") {
    const parsed = z
      .object({
        cashflowId: positiveIdSchema,
        amountCents: canonicalCentsSchema.optional(),
        nextDueDate: canonicalIsoDateSchema.nullable().optional(),
        status: z.string().trim().min(1).max(24).optional(),
        estimated: z.boolean().optional(),
        needsConfirmation: z.boolean().optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .refine(value => Object.keys(value).length > 1, "informe o que atualizar")
      .parse(canonicalPayload(input));
    const { cashflowId, ...data } = parsed;
    return {
      ok: true,
      cashflow: await canonicalDb.updateRecurringCashflow(
        scope,
        cashflowId,
        data,
        actor
      ),
    };
  }
  if (input.action === "update_financial_debt") {
    const parsed = z
      .object({
        debtId: positiveIdSchema,
        balanceCents: canonicalCentsSchema.optional(),
        dueDate: canonicalIsoDateSchema.nullable().optional(),
        minimumPaymentCents: canonicalCentsSchema.nullable().optional(),
        priority: z.string().trim().min(1).max(24).optional(),
        status: z.string().trim().min(1).max(24).optional(),
        needsConfirmation: z.boolean().optional(),
        notes: z.string().trim().max(2_000).nullable().optional(),
      })
      .strict()
      .refine(value => Object.keys(value).length > 1, "informe o que atualizar")
      .parse(canonicalPayload(input));
    const { debtId, ...data } = parsed;
    return {
      ok: true,
      debt: await canonicalDb.updateFinancialDebt(scope, debtId, data, actor),
    };
  }
  if (input.action === "update_financial_task") {
    const parsed = z
      .object({
        taskId: positiveIdSchema,
        status: z
          .enum(["open", "in_progress", "completed", "cancelled"])
          .optional(),
        dueAt: canonicalDateSchema.nullable().optional(),
      })
      .strict()
      .refine(value => Object.keys(value).length > 1, "informe o que atualizar")
      .parse(canonicalPayload(input));
    const { taskId, dueAt, ...data } = parsed;
    return {
      ok: true,
      task: await canonicalDb.updateFinancialTask(
        scope,
        taskId,
        {
          ...data,
          ...(dueAt !== undefined
            ? { dueAt: dueAt == null ? null : new Date(dueAt) }
            : {}),
        },
        actor
      ),
    };
  }
  if (input.action === "update_financial_goal_item") {
    const parsed = z
      .object({
        itemId: positiveIdSchema,
        status: z
          .enum(["planned", "funded", "purchased", "cancelled"])
          .optional(),
        actualCostCents: canonicalCentsSchema.nullable().optional(),
        desiredDate: canonicalIsoDateSchema.nullable().optional(),
        notes: z.string().trim().max(2_000).nullable().optional(),
        priority: z.enum(["essential", "important", "optional"]).optional(),
      })
      .strict()
      .refine(value => Object.keys(value).length > 1, "informe o que atualizar")
      .parse(canonicalPayload(input));
    const { itemId, ...data } = parsed;
    return {
      ok: true,
      item: await canonicalDb.updateFinancialGoalItem(
        scope,
        itemId,
        data,
        actor
      ),
    };
  }
  if (input.action === "create_financial_project") {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(255),
        clientName: z.string().trim().max(255).nullable().optional(),
        stage: z.string().trim().min(1).max(32).default("lead"),
        grossValueCents: canonicalCentsSchema,
        expectedCostCents: canonicalCentsSchema.nullable().optional(),
        taxBasisPoints: z.number().int().min(0).max(10_000).default(1_500),
        costBasisPoints: z.number().int().min(0).max(10_000).default(1_000),
        probabilityPercent: z.number().int().min(0).max(100).default(0),
        startedAt: canonicalIsoDateSchema.nullable().optional(),
        expectedDeliveryAt: canonicalIsoDateSchema.nullable().optional(),
        status: z.string().trim().min(1).max(24).default("active"),
        notes: z.string().trim().max(2_000).nullable().optional(),
        installments: z
          .array(
            z.object({
              amountCents: canonicalPositiveCentsSchema,
              expectedAt: canonicalIsoDateSchema.nullable().optional(),
            })
          )
          .max(120)
          .default([]),
      })
      .strict()
      .refine(
        value => value.taxBasisPoints + value.costBasisPoints <= 10_000,
        "impostos e custos nao podem ultrapassar 100%"
      )
      .parse(canonicalPayload(input));
    const { installments, ...project } = parsed;
    return {
      ok: true,
      ...(await canonicalDb.createFinancialProject(
        scope,
        project,
        installments,
        actor
      )),
    };
  }
  if (input.action === "confirm_project_payment") {
    const parsed = z
      .object({
        installmentId: positiveIdSchema,
        accountId: positiveIdSchema,
        receivedAt: canonicalDateSchema.optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await canonicalDb.confirmProjectInstallmentReceived(scope, {
        installmentId: parsed.installmentId,
        accountId: parsed.accountId,
        receivedAt: parsed.receivedAt
          ? new Date(parsed.receivedAt)
          : new Date(),
        actor,
      })),
      externalBankMovement: false,
    };
  }
  if (input.action === "simulate_purchase") {
    const payload = canonicalPayload(input);
    const parsed = z
      .object({
        amountCents: canonicalPositiveCentsSchema.optional(),
        amountText: z.string().trim().min(1).max(120).optional(),
        desiredDate: canonicalIsoDateSchema,
        nextIncomeDate: canonicalIsoDateSchema.nullable().optional(),
      })
      .strict()
      .parse(payload);
    return {
      ok: true,
      simulation: await simulateCanonicalPurchase(integration.userId, {
        amountCents: resolveCanonicalAmount(parsed),
        desiredDate: parsed.desiredDate,
        nextIncomeDate: parsed.nextIncomeDate,
        expectedTenantId: scope.tenantId,
      }),
    };
  }
  if (input.action === "simulate_car") {
    const parsed = z
      .object({
        vehiclePriceCents: canonicalCentsSchema.nullable(),
        downPaymentCents: canonicalCentsSchema.nullable(),
        installmentCents: canonicalCentsSchema.nullable(),
        termMonths: z.number().int().min(1).max(120).nullable(),
        cetAnnualBasisPoints: z.number().int().min(0).max(100_000).nullable(),
        insuranceMonthlyCents: canonicalCentsSchema.nullable(),
        fuelMonthlyCents: canonicalCentsSchema.nullable(),
        ipvaAnnualCents: canonicalCentsSchema.nullable(),
        maintenanceMonthlyCents: canonicalCentsSchema.nullable(),
        licensingAnnualCents: canonicalCentsSchema.default(0),
        expensiveDebtCents: canonicalCentsSchema.default(0),
        downPaymentSeparated: z.boolean(),
        futureIncomeConfirmed: z.boolean(),
        overdraftUsedCents: canonicalCentsSchema.default(0),
        fixedCostsConfirmed: z.boolean().optional(),
        priorityAPlanComplete: z.boolean().optional(),
        overdueDebtCents: canonicalCentsSchema.optional(),
        creditIssueResolved: z.boolean().optional(),
        cleanCreditMonths: z.number().int().min(0).max(600).optional(),
        minimumCleanCreditMonths: z.number().int().min(1).max(24).optional(),
        income2027Confirmed: z.boolean().optional(),
        minimumReserveTargetCents: canonicalCentsSchema.optional(),
        cashDownPaymentCents: canonicalCentsSchema.optional(),
        cashDownPaymentTargetCents: canonicalCentsSchema.optional(),
        acquisitionCostFundCents: canonicalCentsSchema.optional(),
        acquisitionCostFundTargetCents: canonicalCentsSchema.optional(),
        tradeInNetCents: canonicalCentsSchema.optional(),
        tradeInTargetCents: canonicalCentsSchema.optional(),
        financedAmountCents: canonicalCentsSchema.optional(),
        financedAmountTargetMaxCents: canonicalCentsSchema.optional(),
        quotesComplete: z.boolean().optional(),
        reconciledDays: z.number().int().min(0).max(3650).optional(),
        concurrentFormalProposals: z.number().int().min(0).max(20).optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      simulation: await simulateCanonicalCar(integration.userId, {
        ...parsed,
        expectedTenantId: scope.tenantId,
      }),
    };
  }
  if (input.action === "propose_income_allocation") {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const parsed = z
      .object({
        transactionId: positiveIdSchema,
        incomeKind: incomeKindSchema,
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.proposeIncomeAllocationV3(scope, {
        ...parsed,
        idempotencyKey: `n8n:${integration.id}:${requestId}:allocation`,
        actor,
        conversationId:
          input.threadId == null ? null : `whatsapp-thread:${input.threadId}`,
        messageId: requestId,
      })),
      externalBankMovement: false,
    };
  }
  if (input.action === "confirm_income_allocation") {
    const parsed = z
      .object({ executionId: positiveIdSchema })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.confirmIncomeAllocationV3(scope, {
        ...parsed,
        ...operationalWriteContext(input, integration.id, actor),
      })),
      externalBankMovement: false,
    };
  }
  if (input.action === "confirm_financial_phase") {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const parsed = z
      .object({
        phase: z.enum([
          "CLEANUP",
          "CAR_PREPARATION",
          "CAR_PURCHASE_READY",
          "POST_CAR_RESERVE",
          "WEALTH_WITH_CAR_DEBT",
          "WEALTH_ACCUMULATION",
          "FINANCIAL_INDEPENDENCE",
        ]),
        reason: z.string().trim().min(1).max(1_000),
        confirmation: z.literal("CONFIRMO MUDANCA DE FASE"),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.confirmFinancialPhaseV3(scope, {
        phase: parsed.phase,
        reason: parsed.reason,
        idempotencyKey: `n8n:${integration.id}:${requestId}:phase`,
        actor,
        conversationId:
          input.threadId == null ? null : `whatsapp-thread:${input.threadId}`,
        messageId: requestId,
      })),
    };
  }
  if (input.action === "set_income_2027_confirmation") {
    const parsed = z
      .object({ confirmed: z.boolean() })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.setIncome2027ConfirmationV3(scope, {
        ...parsed,
        ...operationalWriteContext(input, integration.id, actor),
      })),
    };
  }
  if (input.action === "record_credit_health") {
    const parsed = z
      .object({
        sourceMonth: z.string().regex(/^\d{4}-\d{2}$/, "use AAAA-MM"),
        currentDebtCents: canonicalCentsSchema,
        overdueCents: canonicalCentsSchema,
        unusedLimitsCents: canonicalCentsSchema,
        overdraftUsedCents: canonicalCentsSchema,
        revolvingCreditCents: canonicalCentsSchema,
        cleanMonths: z.number().int().min(0).max(600),
        status: z
          .enum(["confirmed", "needs_confirmation"])
          .default("confirmed"),
        issues: z.unknown().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.recordCreditHealthSnapshotV3(scope, {
        ...parsed,
        ...operationalWriteContext(input, integration.id, actor),
      })),
    };
  }
  if (input.action === "update_credit_cleanup_task") {
    const parsed = z
      .object({
        taskId: positiveIdSchema,
        status: z.enum([
          "needs_confirmation",
          "open",
          "in_progress",
          "paid",
          "completed",
          "cancelled",
        ]),
        currentAmountCents: canonicalCentsSchema.nullable().optional(),
        proof: z.unknown().optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.updateCreditCleanupTaskV3(scope, {
        ...parsed,
        ...operationalWriteContext(input, integration.id, actor),
      })),
    };
  }
  if (input.action === "upsert_asset") {
    const parsed = z
      .object({
        assetId: positiveIdSchema.optional(),
        description: z.string().trim().min(1).max(500),
        assetType: z.string().trim().min(1).max(40),
        ownerType: z.enum(["personal", "business"]),
        estimatedValueCents: canonicalCentsSchema,
        debtBalanceCents: canonicalCentsSchema.default(0),
        incomeGenerating: z.boolean().default(false),
        intendedUse: z.string().trim().max(80).nullable().optional(),
        status: z
          .enum(["estimated", "confirmed", "owned", "sold", "archived"])
          .default("estimated"),
        needsConfirmation: z.boolean().default(true),
        valuationSource: z.string().trim().max(160).nullable().optional(),
        valuedAt: canonicalDateSchema.optional(),
        metadata: z.unknown().optional(),
        confirmation: z.literal("CONFIRMO ARQUIVAMENTO DO ATIVO").optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (
          ["sold", "archived"].includes(value.status) &&
          value.confirmation !== "CONFIRMO ARQUIVAMENTO DO ATIVO"
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confirmation"],
            message: "confirmacao explicita obrigatoria",
          });
      })
      .parse(canonicalPayload(input));
    const { confirmation: _confirmation, ...asset } = parsed;
    return {
      ok: true,
      ...(await lifelongDb.upsertAssetV3(
        scope,
        {
          ...asset,
          valuedAt: asset.valuedAt ? new Date(asset.valuedAt) : undefined,
        },
        operationalWriteContext(input, integration.id, actor)
      )),
    };
  }
  if (input.action === "record_car_quote") {
    const expiresAt = canonicalDateSchema.nullable().optional();
    const parsed = z
      .object({
        description: z.string().trim().min(1).max(500),
        seller: z.string().trim().max(255).nullable().optional(),
        priceCents: canonicalPositiveCentsSchema,
        cashDiscountCents: canonicalCentsSchema.default(0),
        initialCostsCents: canonicalCentsSchema.default(0),
        expiresAt,
        metadata: z.unknown().optional(),
        tradeIn: z
          .object({
            assetId: positiveIdSchema,
            dealer: z.string().trim().min(1).max(255),
            offeredCents: canonicalPositiveCentsSchema,
            deductionsCents: canonicalCentsSchema.default(0),
            expiresAt,
          })
          .strict()
          .nullable()
          .optional(),
        insurance: z
          .object({
            insurer: z.string().trim().min(1).max(255),
            annualPremiumCents: canonicalPositiveCentsSchema,
            deductibleCents: canonicalCentsSchema.nullable().optional(),
            coverage: z.unknown().optional(),
            expiresAt,
          })
          .strict()
          .nullable()
          .optional(),
        financing: z
          .object({
            lender: z.string().trim().min(1).max(255),
            downPaymentCents: canonicalCentsSchema,
            tradeInCents: canonicalCentsSchema.default(0),
            financedCents: canonicalPositiveCentsSchema,
            nominalMonthlyBasisPoints: z
              .number()
              .int()
              .min(0)
              .max(1_000_000)
              .nullable()
              .optional(),
            cetAnnualBasisPoints: z.number().int().min(0).max(1_000_000),
            termMonths: z.number().int().min(1).max(240),
            installmentCents: canonicalPositiveCentsSchema,
            totalPaidCents: canonicalPositiveCentsSchema,
            feesCents: canonicalCentsSchema.default(0),
            hardCreditInquiry: z.boolean().default(false),
            expiresAt,
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.recordCarQuoteV3(
        scope,
        {
          ...parsed,
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          tradeIn: parsed.tradeIn
            ? {
                ...parsed.tradeIn,
                expiresAt: parsed.tradeIn.expiresAt
                  ? new Date(parsed.tradeIn.expiresAt)
                  : null,
              }
            : parsed.tradeIn,
          insurance: parsed.insurance
            ? {
                ...parsed.insurance,
                expiresAt: parsed.insurance.expiresAt
                  ? new Date(parsed.insurance.expiresAt)
                  : null,
              }
            : parsed.insurance,
          financing: parsed.financing
            ? {
                ...parsed.financing,
                expiresAt: parsed.financing.expiresAt
                  ? new Date(parsed.financing.expiresAt)
                  : null,
              }
            : parsed.financing,
        },
        operationalWriteContext(input, integration.id, actor)
      )),
    };
  }
  if (input.action === "set_investment_policy") {
    const parsed = z
      .object({
        riskProfile: z.string().trim().min(1).max(40),
        horizonYears: z.number().int().min(1).max(100).nullable().optional(),
        liquidityNeeds: z.string().trim().max(2_000).nullable().optional(),
        targetAllocationBasisPoints: z.record(
          z.string().trim().min(1).max(80),
          z.number().int().min(0).max(10_000)
        ),
        concentrationLimits: z.unknown().optional(),
        suitabilityConfirmed: z.boolean(),
        version: z.string().trim().min(1).max(40),
        status: z.enum(["draft", "active"]),
        confirmation: z.literal("CONFIRMO SUITABILITY E POLITICA").optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (
          value.status === "active" &&
          value.confirmation !== "CONFIRMO SUITABILITY E POLITICA"
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confirmation"],
            message: "confirmacao explicita obrigatoria",
          });
      })
      .parse(canonicalPayload(input));
    const { confirmation: _confirmation, ...policy } = parsed;
    return {
      ok: true,
      ...(await lifelongDb.setInvestmentPolicyV3(
        scope,
        policy,
        operationalWriteContext(input, integration.id, actor)
      )),
    };
  }
  if (input.action === "upsert_investment_position") {
    const parsed = z
      .object({
        institution: z.string().trim().min(1).max(255),
        bucket: z.enum(["emergency", "long_term", "other"]),
        currency: z.string().trim().length(3).default("BRL"),
        assetCode: z.string().trim().min(1).max(80),
        assetClass: z.string().trim().min(1).max(80),
        quantityMicrounits: canonicalCentsSchema,
        costBasisCents: canonicalCentsSchema,
        marketValueCents: canonicalCentsSchema,
        valuedAt: canonicalDateSchema,
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.upsertInvestmentPositionV3(
        scope,
        { ...parsed, valuedAt: new Date(parsed.valuedAt) },
        operationalWriteContext(input, integration.id, actor)
      )),
    };
  }
  if (input.action === "record_dividend") {
    const parsed = z
      .object({
        investmentPositionId: positiveIdSchema.nullable().optional(),
        assetCode: z.string().trim().min(1).max(80),
        exDate: canonicalIsoDateSchema.nullable().optional(),
        paymentDate: canonicalIsoDateSchema,
        grossCents: canonicalPositiveCentsSchema,
        withholdingCents: canonicalCentsSchema.default(0),
        netCents: canonicalCentsSchema,
        reinvestedCents: canonicalCentsSchema.default(0),
        status: z
          .enum(["expected", "received", "reinvested"])
          .default("received"),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await lifelongDb.recordDividendV3(
        scope,
        parsed,
        operationalWriteContext(input, integration.id, actor)
      )),
    };
  }
  if (input.action === "create_reminder") {
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(500),
        dueAt: canonicalDateSchema,
        recurrenceRule: z.string().trim().max(255).nullable().optional(),
        channel: z.literal("whatsapp").default("whatsapp"),
      })
      .strict()
      .parse(canonicalPayload(input));
    return {
      ok: true,
      ...(await canonicalDb.createFinancialReminder(
        scope,
        {
          title: parsed.title,
          dueAt: new Date(parsed.dueAt),
          recurrenceRule: parsed.recurrenceRule,
          idempotencyKey: `n8n:${integration.id}:${requestId}`,
        },
        actor
      )),
    };
  }
  if (input.action === "pause_notifications") {
    const parsed = z
      .object({ until: canonicalDateSchema.nullable() })
      .strict()
      .parse(canonicalPayload(input));
    const profile = await canonicalDb.pauseFinancialNotifications(
      scope,
      parsed.until ? new Date(parsed.until) : null,
      actor
    );
    return {
      ok: true,
      notificationsPausedUntil: profile.notificationsPausedUntil,
      message: parsed.until
        ? `Mensagens proativas pausadas ate ${parsed.until}.`
        : "Pausa removida. As mensagens proativas seguem o seu opt-in.",
    };
  }
  if (input.action === "set_notification_preference") {
    const parsed = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(canonicalPayload(input));
    const profile = await canonicalDb.setFinancialNotificationOptIn(
      scope,
      parsed.enabled,
      actor
    );
    return {
      ok: true,
      notificationsOptIn: profile.notificationsOptIn,
      message: parsed.enabled
        ? "Mensagens proativas reativadas."
        : "Mensagens proativas pausadas. Voce ainda pode falar comigo quando quiser.",
    };
  }
  throw new AgentToolError(400, "Acao financeira invalida", "INVALID_ACTION");
}

export async function handleAgentTool(input: AgentToolRequest) {
  if (input.action === "health") {
    return {
      ok: true,
      service: "financepro-agent-tools",
      ready: isN8nAgentReady(),
      confirmationRequiredForDestructiveMutations: true,
      lowRiskCanonicalWritesAreDirect: true,
      externalBankMovement: false,
      entityTypes: agentDb.AGENT_ENTITY_TYPES,
      canonicalActions: CANONICAL_AGENT_ACTIONS,
    };
  }

  const integrationId = requireValue(
    input.integrationId,
    "integrationId e obrigatorio"
  );
  const integration = await resolveScope(integrationId, input.threadId);
  await agentDb.expirePendingAgentCommands();

  if (
    CANONICAL_AGENT_ACTIONS.includes(
      input.action as (typeof CANONICAL_AGENT_ACTIONS)[number]
    )
  ) {
    return handleCanonicalAgentAction(input, integration);
  }

  if (input.action === "get_context") {
    const [snapshot, canonicalSnapshot, messages, pendingCommands] =
      await Promise.all([
        financialAdvisor.getFinancialAdvisorSnapshot(integration.userId, {
          timezone: integration.timezone,
          integrationId: integration.id,
          persist: false,
        }),
        getCanonicalFinancialSnapshot(integration.userId),
        input.threadId
          ? whatsappDb.listWhatsAppMessages(integration.userId, input.threadId)
          : Promise.resolve([]),
        agentDb.listPendingAgentCommands(
          integration.userId,
          integration.id,
          input.threadId,
          10
        ),
      ]);
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      timezone: integration.timezone,
      snapshot,
      canonicalSnapshot,
      canonicalToolActions: CANONICAL_AGENT_ACTIONS,
      safetyPolicy: {
        valuesAreIntegerCents: true,
        externalBankMovement: false,
        lowRiskExplicitWrites: "execute_directly_and_offer_undo",
        destructiveOrProtectedActions: "require_explicit_confirmation",
      },
      recentConversation: messages
        .slice(0, 12)
        .reverse()
        .map(message => ({
          direction: message.direction,
          text: message.textContent.slice(0, 2_000),
          createdAt: message.createdAt,
        })),
      pendingCommands,
    };
  }

  if (input.action === "list_records") {
    const entityType = requireValue(
      input.entityType,
      "entityType e obrigatorio"
    );
    const records = await agentDb.listAgentRecords(
      integration.userId,
      entityType,
      input.limit ?? 20
    );
    return {
      ok: true,
      entityType,
      count: records.length,
      records: records.map(record =>
        sanitizeRecord(record as Record<string, unknown>)
      ),
    };
  }

  if (input.action === "propose_change") {
    const entityType = requireValue(
      input.entityType,
      "entityType e obrigatorio"
    );
    const operation = requireValue(input.operation, "operation e obrigatorio");
    const requestId = requireValue(input.requestId, "requestId e obrigatorio");
    const summary = requireValue(input.summary, "summary e obrigatorio");
    const entityId = input.entityId ?? null;

    if (operation !== "create" && !entityId) {
      throw new AgentToolError(
        400,
        "entityId e obrigatorio para editar ou excluir",
        "INVALID_REQUEST"
      );
    }
    if (operation === "create" && entityId) {
      throw new AgentToolError(
        400,
        "entityId nao deve ser enviado em uma criacao",
        "INVALID_REQUEST"
      );
    }

    const rawPayload =
      operation === "delete" ? {} : parsePayload(input.payload);
    const schema =
      recordSchemas[entityType][operation === "create" ? "create" : "update"];
    const parsedPayload =
      operation === "delete" ? {} : schema.parse(rawPayload);
    const canonicalPayload = JSON.stringify(parsedPayload);
    const confirmationCode = createConfirmationCode(
      integration.userId,
      requestId
    );
    const confirmationCodeHash = hashConfirmationCode(
      integration.userId,
      requestId,
      confirmationCode
    );
    const command = await agentDb.createAgentCommandIdempotently({
      userId: integration.userId,
      integrationId: integration.id,
      threadId: input.threadId ?? null,
      requestId,
      operation,
      entityType,
      entityId,
      payload: canonicalPayload,
      summary,
      confirmationCodeHash,
      status: "pending",
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    });
    if (!command) throw new Error("Nao foi possivel criar o comando do agente");
    if (
      command.operation !== operation ||
      command.entityType !== entityType ||
      command.entityId !== entityId ||
      command.payload !== canonicalPayload
    ) {
      throw new AgentToolError(
        409,
        "requestId ja foi usado para outra alteracao",
        "IDEMPOTENCY_CONFLICT"
      );
    }

    if (command.status !== "pending") {
      return {
        ok: true,
        commandId: command.id,
        status: command.status,
        summary: command.summary,
        alreadyProcessed: true,
      };
    }

    return {
      ok: true,
      commandId: command.id,
      status: command.status,
      summary: command.summary,
      confirmationCode,
      expiresAt: command.expiresAt,
      confirmationInstruction: `Para confirmar, responda exatamente: CONFIRMAR ${confirmationCode}`,
      warning:
        entityType === "reserve_fund" || entityType === "investment"
          ? "A confirmacao registra a movimentacao manual no FinancePRO; nao movimenta dinheiro no banco."
          : "Nada foi alterado ainda.",
    };
  }

  const commandId = requireValue(input.commandId, "commandId e obrigatorio");
  const command = await agentDb.getAgentCommand(
    integration.userId,
    integration.id,
    commandId
  );
  if (
    !command ||
    (input.threadId != null && command.threadId !== input.threadId)
  ) {
    throw new AgentToolError(
      404,
      "Comando nao encontrado",
      "COMMAND_NOT_FOUND"
    );
  }

  if (input.action === "cancel_change") {
    if (command.status === "cancelled")
      return { ok: true, commandId, status: "cancelled" };
    const cancelled = await agentDb.cancelAgentCommand(
      integration.userId,
      integration.id,
      commandId,
      input.threadId
    );
    if (!cancelled) {
      throw new AgentToolError(
        409,
        "Somente comandos pendentes podem ser cancelados",
        "COMMAND_NOT_PENDING"
      );
    }
    return { ok: true, commandId, status: "cancelled" };
  }

  if (command.status === "executed") {
    return {
      ok: true,
      commandId,
      status: "executed",
      alreadyProcessed: true,
      result: command.resultPayload ? JSON.parse(command.resultPayload) : null,
    };
  }
  if (command.status !== "pending") {
    throw new AgentToolError(
      409,
      `O comando esta com status ${command.status}`,
      "COMMAND_NOT_PENDING"
    );
  }

  const confirmationCode = requireValue(
    input.confirmationCode,
    "confirmationCode e obrigatorio"
  );
  const suppliedHash = hashConfirmationCode(
    integration.userId,
    command.requestId,
    confirmationCode
  );
  if (!secretsMatch(suppliedHash, command.confirmationCodeHash)) {
    throw new AgentToolError(
      409,
      "Codigo de confirmacao invalido",
      "INVALID_CONFIRMATION"
    );
  }

  try {
    const result = await agentDb.executeConfirmedAgentCommand({
      userId: integration.userId,
      integrationId: integration.id,
      threadId: input.threadId,
      commandId,
      confirmationCodeHash: suppliedHash,
    });
    if (!result) {
      const latest = await agentDb.getAgentCommand(
        integration.userId,
        integration.id,
        commandId
      );
      if (latest?.status === "executed") {
        return {
          ok: true,
          commandId,
          status: "executed",
          alreadyProcessed: true,
          result: latest.resultPayload
            ? JSON.parse(latest.resultPayload)
            : null,
        };
      }
      throw new AgentToolError(
        409,
        "Comando expirado ou ja processado",
        "COMMAND_NOT_PENDING"
      );
    }
    return {
      ok: true,
      commandId,
      status: "executed",
      result,
      message: result.manualOnly
        ? "Registro manual concluido no FinancePRO. Nenhuma movimentacao bancaria foi executada."
        : "Alteracao confirmada e concluida no FinancePRO.",
    };
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    const message =
      error instanceof Error ? error.message : "Falha ao executar alteracao";
    await agentDb
      .markAgentCommandFailed(commandId, message)
      .catch(() => undefined);
    throw new AgentToolError(409, message, "EXECUTION_FAILED");
  }
}
