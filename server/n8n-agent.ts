import { createHmac } from "node:crypto";
import { z } from "zod";
import { ENV } from "./_core/env";
import { isStrongSecret, secretsMatch } from "./_core/secrets";
import * as agentDb from "./db/agent";
import * as whatsappDb from "./db/whatsapp";
import * as financialAdvisor from "./financial-advisor";

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

export const agentToolRequestSchema = z
  .object({
    action: z.enum([
      "health",
      "get_context",
      "list_records",
      "propose_change",
      "execute_change",
      "cancel_change",
    ]),
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

export async function handleAgentTool(input: AgentToolRequest) {
  if (input.action === "health") {
    return {
      ok: true,
      service: "financepro-agent-tools",
      ready: isN8nAgentReady(),
      confirmationRequiredForMutations: true,
      externalBankMovement: false,
      entityTypes: agentDb.AGENT_ENTITY_TYPES,
    };
  }

  const integrationId = requireValue(
    input.integrationId,
    "integrationId e obrigatorio"
  );
  const integration = await resolveScope(integrationId, input.threadId);
  await agentDb.expirePendingAgentCommands();

  if (input.action === "get_context") {
    const [snapshot, messages, pendingCommands] = await Promise.all([
      financialAdvisor.getFinancialAdvisorSnapshot(integration.userId, {
        timezone: integration.timezone,
        integrationId: integration.id,
        persist: false,
      }),
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
