import { and, desc, eq, gt, lte } from "drizzle-orm";
import {
  agentCommands,
  clients,
  companyFixedCosts,
  companyVariableCosts,
  debts,
  employees,
  investments,
  personalFixedCosts,
  personalVariableCosts,
  reserveFunds,
  revenues,
  services,
  supplierPurchases,
  suppliers,
  type InsertAgentCommand,
} from "../../drizzle/schema";
import { getDb } from "../db";

export const AGENT_ENTITY_TYPES = [
  "revenue",
  "company_fixed_cost",
  "company_variable_cost",
  "employee",
  "supplier",
  "supplier_purchase",
  "personal_fixed_cost",
  "personal_variable_cost",
  "debt",
  "investment",
  "reserve_fund",
  "client",
  "service",
] as const;

export type AgentEntityType = (typeof AGENT_ENTITY_TYPES)[number];
export type AgentMutationOperation = "create" | "update" | "delete";

export async function listAgentRecords(
  userId: number,
  entityType: AgentEntityType,
  limit: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  switch (entityType) {
    case "revenue":
      return db
        .select()
        .from(revenues)
        .where(eq(revenues.userId, userId))
        .orderBy(desc(revenues.createdAt))
        .limit(safeLimit);
    case "company_fixed_cost":
      return db
        .select()
        .from(companyFixedCosts)
        .where(eq(companyFixedCosts.userId, userId))
        .orderBy(desc(companyFixedCosts.createdAt))
        .limit(safeLimit);
    case "company_variable_cost":
      return db
        .select()
        .from(companyVariableCosts)
        .where(eq(companyVariableCosts.userId, userId))
        .orderBy(desc(companyVariableCosts.createdAt))
        .limit(safeLimit);
    case "employee":
      return db
        .select()
        .from(employees)
        .where(eq(employees.userId, userId))
        .orderBy(desc(employees.createdAt))
        .limit(safeLimit);
    case "supplier":
      return db
        .select()
        .from(suppliers)
        .where(eq(suppliers.userId, userId))
        .orderBy(desc(suppliers.createdAt))
        .limit(safeLimit);
    case "supplier_purchase":
      return db
        .select()
        .from(supplierPurchases)
        .where(eq(supplierPurchases.userId, userId))
        .orderBy(desc(supplierPurchases.createdAt))
        .limit(safeLimit);
    case "personal_fixed_cost":
      return db
        .select()
        .from(personalFixedCosts)
        .where(eq(personalFixedCosts.userId, userId))
        .orderBy(desc(personalFixedCosts.createdAt))
        .limit(safeLimit);
    case "personal_variable_cost":
      return db
        .select()
        .from(personalVariableCosts)
        .where(eq(personalVariableCosts.userId, userId))
        .orderBy(desc(personalVariableCosts.createdAt))
        .limit(safeLimit);
    case "debt":
      return db
        .select()
        .from(debts)
        .where(eq(debts.userId, userId))
        .orderBy(desc(debts.createdAt))
        .limit(safeLimit);
    case "investment":
      return db
        .select()
        .from(investments)
        .where(eq(investments.userId, userId))
        .orderBy(desc(investments.createdAt))
        .limit(safeLimit);
    case "reserve_fund":
      return db
        .select()
        .from(reserveFunds)
        .where(eq(reserveFunds.userId, userId))
        .orderBy(desc(reserveFunds.createdAt))
        .limit(safeLimit);
    case "client":
      return db
        .select()
        .from(clients)
        .where(eq(clients.userId, userId))
        .orderBy(desc(clients.createdAt))
        .limit(safeLimit);
    case "service":
      return db
        .select()
        .from(services)
        .where(eq(services.userId, userId))
        .orderBy(desc(services.createdAt))
        .limit(safeLimit);
  }
}

export async function createAgentCommandIdempotently(data: InsertAgentCommand) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [created] = await db
    .insert(agentCommands)
    .values(data)
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(agentCommands)
    .where(
      and(
        eq(agentCommands.userId, data.userId),
        eq(agentCommands.requestId, data.requestId)
      )
    )
    .limit(1);
  return existing;
}

export async function getAgentCommand(
  userId: number,
  integrationId: number,
  commandId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [record] = await db
    .select()
    .from(agentCommands)
    .where(
      and(
        eq(agentCommands.id, commandId),
        eq(agentCommands.userId, userId),
        eq(agentCommands.integrationId, integrationId)
      )
    )
    .limit(1);
  return record;
}

export async function listPendingAgentCommands(
  userId: number,
  integrationId: number,
  threadId?: number | null,
  limit = 10
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(agentCommands.userId, userId),
    eq(agentCommands.integrationId, integrationId),
    eq(agentCommands.status, "pending"),
    gt(agentCommands.expiresAt, new Date()),
  ];
  if (threadId != null) conditions.push(eq(agentCommands.threadId, threadId));

  return db
    .select({
      id: agentCommands.id,
      operation: agentCommands.operation,
      entityType: agentCommands.entityType,
      entityId: agentCommands.entityId,
      summary: agentCommands.summary,
      expiresAt: agentCommands.expiresAt,
      createdAt: agentCommands.createdAt,
    })
    .from(agentCommands)
    .where(and(...conditions))
    .orderBy(desc(agentCommands.createdAt))
    .limit(Math.max(1, Math.min(limit, 20)));
}

export async function expirePendingAgentCommands() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(agentCommands)
    .set({ status: "expired" })
    .where(
      and(
        eq(agentCommands.status, "pending"),
        lte(agentCommands.expiresAt, new Date())
      )
    );
}

export async function cancelAgentCommand(
  userId: number,
  integrationId: number,
  commandId: number,
  threadId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(agentCommands.id, commandId),
    eq(agentCommands.userId, userId),
    eq(agentCommands.integrationId, integrationId),
    eq(agentCommands.status, "pending"),
  ];
  if (threadId != null) conditions.push(eq(agentCommands.threadId, threadId));
  const [cancelled] = await db
    .update(agentCommands)
    .set({ status: "cancelled" })
    .where(and(...conditions))
    .returning({ id: agentCommands.id, status: agentCommands.status });
  return cancelled;
}

export async function markAgentCommandFailed(
  commandId: number,
  errorMessage: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(agentCommands)
    .set({ status: "failed", errorMessage: errorMessage.slice(0, 2_000) })
    .where(
      and(eq(agentCommands.id, commandId), eq(agentCommands.status, "pending"))
    );
}

export async function executeConfirmedAgentCommand(params: {
  userId: number;
  integrationId: number;
  threadId?: number | null;
  commandId: number;
  confirmationCodeHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const conditions = [
      eq(agentCommands.id, params.commandId),
      eq(agentCommands.userId, params.userId),
      eq(agentCommands.integrationId, params.integrationId),
      eq(agentCommands.status, "pending"),
      eq(agentCommands.confirmationCodeHash, params.confirmationCodeHash),
      gt(agentCommands.expiresAt, new Date()),
    ];
    if (params.threadId != null)
      conditions.push(eq(agentCommands.threadId, params.threadId));

    const [command] = await tx
      .update(agentCommands)
      .set({ status: "executing", confirmedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!command) return null;

    const payload = JSON.parse(command.payload) as Record<string, unknown>;
    const entityId = command.entityId ?? 0;
    let affectedId: number | null = null;

    const requireAffected = (rows: Array<{ id: number }>) => {
      const id = rows[0]?.id;
      if (!id)
        throw new Error(
          "Registro financeiro nao encontrado ou fora do escopo autorizado."
        );
      return id;
    };

    if (
      command.entityType === "supplier_purchase" &&
      command.operation !== "delete" &&
      Object.prototype.hasOwnProperty.call(payload, "supplierId")
    ) {
      const supplierId = Number(payload.supplierId);
      if (!Number.isInteger(supplierId) || supplierId <= 0) {
        throw new Error("Fornecedor invalido para a compra.");
      }

      const [ownedSupplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(eq(suppliers.id, supplierId), eq(suppliers.userId, params.userId))
        )
        .limit(1);
      if (!ownedSupplier) {
        throw new Error(
          "Fornecedor nao encontrado ou fora do escopo autorizado."
        );
      }
    }

    switch (command.entityType as AgentEntityType) {
      case "revenue":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(revenues)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof revenues.$inferInsert)
              .returning({ id: revenues.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(revenues)
              .set(payload)
              .where(
                and(
                  eq(revenues.id, entityId),
                  eq(revenues.userId, params.userId)
                )
              )
              .returning({ id: revenues.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(revenues)
              .where(
                and(
                  eq(revenues.id, entityId),
                  eq(revenues.userId, params.userId)
                )
              )
              .returning({ id: revenues.id })
          );
        break;
      case "company_fixed_cost":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(companyFixedCosts)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof companyFixedCosts.$inferInsert)
              .returning({ id: companyFixedCosts.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(companyFixedCosts)
              .set(payload)
              .where(
                and(
                  eq(companyFixedCosts.id, entityId),
                  eq(companyFixedCosts.userId, params.userId)
                )
              )
              .returning({ id: companyFixedCosts.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(companyFixedCosts)
              .where(
                and(
                  eq(companyFixedCosts.id, entityId),
                  eq(companyFixedCosts.userId, params.userId)
                )
              )
              .returning({ id: companyFixedCosts.id })
          );
        break;
      case "company_variable_cost":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(companyVariableCosts)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof companyVariableCosts.$inferInsert)
              .returning({ id: companyVariableCosts.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(companyVariableCosts)
              .set(payload)
              .where(
                and(
                  eq(companyVariableCosts.id, entityId),
                  eq(companyVariableCosts.userId, params.userId)
                )
              )
              .returning({ id: companyVariableCosts.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(companyVariableCosts)
              .where(
                and(
                  eq(companyVariableCosts.id, entityId),
                  eq(companyVariableCosts.userId, params.userId)
                )
              )
              .returning({ id: companyVariableCosts.id })
          );
        break;
      case "employee":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(employees)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof employees.$inferInsert)
              .returning({ id: employees.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(employees)
              .set(payload)
              .where(
                and(
                  eq(employees.id, entityId),
                  eq(employees.userId, params.userId)
                )
              )
              .returning({ id: employees.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(employees)
              .where(
                and(
                  eq(employees.id, entityId),
                  eq(employees.userId, params.userId)
                )
              )
              .returning({ id: employees.id })
          );
        break;
      case "supplier":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(suppliers)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof suppliers.$inferInsert)
              .returning({ id: suppliers.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(suppliers)
              .set(payload)
              .where(
                and(
                  eq(suppliers.id, entityId),
                  eq(suppliers.userId, params.userId)
                )
              )
              .returning({ id: suppliers.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(suppliers)
              .where(
                and(
                  eq(suppliers.id, entityId),
                  eq(suppliers.userId, params.userId)
                )
              )
              .returning({ id: suppliers.id })
          );
        break;
      case "supplier_purchase":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(supplierPurchases)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof supplierPurchases.$inferInsert)
              .returning({ id: supplierPurchases.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(supplierPurchases)
              .set(payload)
              .where(
                and(
                  eq(supplierPurchases.id, entityId),
                  eq(supplierPurchases.userId, params.userId)
                )
              )
              .returning({ id: supplierPurchases.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(supplierPurchases)
              .where(
                and(
                  eq(supplierPurchases.id, entityId),
                  eq(supplierPurchases.userId, params.userId)
                )
              )
              .returning({ id: supplierPurchases.id })
          );
        break;
      case "personal_fixed_cost":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(personalFixedCosts)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof personalFixedCosts.$inferInsert)
              .returning({ id: personalFixedCosts.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(personalFixedCosts)
              .set(payload)
              .where(
                and(
                  eq(personalFixedCosts.id, entityId),
                  eq(personalFixedCosts.userId, params.userId)
                )
              )
              .returning({ id: personalFixedCosts.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(personalFixedCosts)
              .where(
                and(
                  eq(personalFixedCosts.id, entityId),
                  eq(personalFixedCosts.userId, params.userId)
                )
              )
              .returning({ id: personalFixedCosts.id })
          );
        break;
      case "personal_variable_cost":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(personalVariableCosts)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof personalVariableCosts.$inferInsert)
              .returning({ id: personalVariableCosts.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(personalVariableCosts)
              .set(payload)
              .where(
                and(
                  eq(personalVariableCosts.id, entityId),
                  eq(personalVariableCosts.userId, params.userId)
                )
              )
              .returning({ id: personalVariableCosts.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(personalVariableCosts)
              .where(
                and(
                  eq(personalVariableCosts.id, entityId),
                  eq(personalVariableCosts.userId, params.userId)
                )
              )
              .returning({ id: personalVariableCosts.id })
          );
        break;
      case "debt":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(debts)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof debts.$inferInsert)
              .returning({ id: debts.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(debts)
              .set(payload)
              .where(
                and(eq(debts.id, entityId), eq(debts.userId, params.userId))
              )
              .returning({ id: debts.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(debts)
              .where(
                and(eq(debts.id, entityId), eq(debts.userId, params.userId))
              )
              .returning({ id: debts.id })
          );
        break;
      case "investment":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(investments)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof investments.$inferInsert)
              .returning({ id: investments.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(investments)
              .set(payload)
              .where(
                and(
                  eq(investments.id, entityId),
                  eq(investments.userId, params.userId)
                )
              )
              .returning({ id: investments.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(investments)
              .where(
                and(
                  eq(investments.id, entityId),
                  eq(investments.userId, params.userId)
                )
              )
              .returning({ id: investments.id })
          );
        break;
      case "reserve_fund":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(reserveFunds)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof reserveFunds.$inferInsert)
              .returning({ id: reserveFunds.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(reserveFunds)
              .set(payload)
              .where(
                and(
                  eq(reserveFunds.id, entityId),
                  eq(reserveFunds.userId, params.userId)
                )
              )
              .returning({ id: reserveFunds.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(reserveFunds)
              .where(
                and(
                  eq(reserveFunds.id, entityId),
                  eq(reserveFunds.userId, params.userId)
                )
              )
              .returning({ id: reserveFunds.id })
          );
        break;
      case "client":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(clients)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof clients.$inferInsert)
              .returning({ id: clients.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(clients)
              .set(payload)
              .where(
                and(eq(clients.id, entityId), eq(clients.userId, params.userId))
              )
              .returning({ id: clients.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(clients)
              .where(
                and(eq(clients.id, entityId), eq(clients.userId, params.userId))
              )
              .returning({ id: clients.id })
          );
        break;
      case "service":
        if (command.operation === "create")
          affectedId = requireAffected(
            await tx
              .insert(services)
              .values({
                ...payload,
                userId: params.userId,
              } as typeof services.$inferInsert)
              .returning({ id: services.id })
          );
        else if (command.operation === "update")
          affectedId = requireAffected(
            await tx
              .update(services)
              .set(payload)
              .where(
                and(
                  eq(services.id, entityId),
                  eq(services.userId, params.userId)
                )
              )
              .returning({ id: services.id })
          );
        else
          affectedId = requireAffected(
            await tx
              .delete(services)
              .where(
                and(
                  eq(services.id, entityId),
                  eq(services.userId, params.userId)
                )
              )
              .returning({ id: services.id })
          );
        break;
      default:
        throw new Error("Tipo de registro nao suportado.");
    }

    const result = {
      commandId: command.id,
      operation: command.operation,
      entityType: command.entityType,
      entityId: affectedId,
      manualOnly:
        command.entityType === "reserve_fund" ||
        command.entityType === "investment",
      executedAt: new Date().toISOString(),
    };
    await tx
      .update(agentCommands)
      .set({
        status: "executed",
        resultPayload: JSON.stringify(result),
        executedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(agentCommands.id, command.id));

    return result;
  });
}
