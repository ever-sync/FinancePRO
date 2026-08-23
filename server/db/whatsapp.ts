import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import {
  assistantRuns,
  assistantThreads,
  financialPlanActions,
  financialPlans,
  notificationEvents,
  whatsappContacts,
  whatsappIntegrations,
  whatsappMessages,
  whatsappOutbox,
  type InsertAssistantRun,
  type InsertAssistantThread,
  type InsertFinancialPlan,
  type InsertFinancialPlanAction,
  type InsertNotificationEvent,
  type InsertWhatsAppContact,
  type InsertWhatsAppIntegration,
  type InsertWhatsAppMessage,
  type InsertWhatsAppOutboxItem,
} from "../../drizzle/schema";
import { getDb } from "../db";

export async function getWhatsAppIntegration(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(whatsappIntegrations)
    .where(eq(whatsappIntegrations.userId, userId))
    .limit(1);
  return record;
}

export async function getWhatsAppIntegrationById(integrationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(whatsappIntegrations)
    .where(eq(whatsappIntegrations.id, integrationId))
    .limit(1);
  return record;
}

export async function listEnabledWhatsAppIntegrations() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(whatsappIntegrations)
    .where(eq(whatsappIntegrations.enabled, true))
    .orderBy(asc(whatsappIntegrations.userId));
}

export async function getWhatsAppIntegrationByInstanceId(instanceId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(whatsappIntegrations)
    .where(eq(whatsappIntegrations.instanceId, instanceId))
    .limit(1);
  return record;
}

export async function getWhatsAppIntegrationByApiToken(apiToken: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalizedToken = apiToken.trim();
  if (!normalizedToken) return undefined;

  const [record] = await db
    .select()
    .from(whatsappIntegrations)
    .where(eq(whatsappIntegrations.apiToken, normalizedToken))
    .limit(1);
  return record;
}

export async function upsertWhatsAppIntegration(
  userId: number,
  data: Partial<InsertWhatsAppIntegration> &
    Pick<
      InsertWhatsAppIntegration,
      "provider" | "instanceId" | "apiBaseUrl" | "authorizedPhone"
    >
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getWhatsAppIntegration(userId);
  if (existing) {
    const updatePayload = {
      ...data,
      apiToken: data.apiToken?.trim() ? data.apiToken : existing.apiToken,
    };
    await db
      .update(whatsappIntegrations)
      .set(updatePayload)
      .where(eq(whatsappIntegrations.id, existing.id));
    return { ...existing, ...updatePayload };
  }

  const insertPayload: InsertWhatsAppIntegration = {
    userId,
    provider: data.provider,
    instanceId: data.instanceId,
    apiBaseUrl: data.apiBaseUrl,
    apiToken: data.apiToken ?? "",
    authorizedPhone: data.authorizedPhone,
    enabled: data.enabled ?? true,
    automationHour: data.automationHour ?? 8,
    timezone: data.timezone ?? "America/Sao_Paulo",
    webhookUrl: data.webhookUrl ?? null,
    lastConnectionStatus: data.lastConnectionStatus ?? "pendente",
    lastConnectionMessage: data.lastConnectionMessage ?? null,
    lastConnectionCheckedAt: data.lastConnectionCheckedAt ?? null,
    lastWebhookReceivedAt: data.lastWebhookReceivedAt ?? null,
    lastMessageReceivedAt: data.lastMessageReceivedAt ?? null,
    lastMessageSentAt: data.lastMessageSentAt ?? null,
  };
  const [created] = await db
    .insert(whatsappIntegrations)
    .values(insertPayload)
    .returning();
  return created;
}

export async function markWhatsAppConnection(
  integrationId: number,
  status: string,
  message?: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(whatsappIntegrations)
    .set({
      lastConnectionStatus: status,
      lastConnectionMessage: message ?? null,
      lastConnectionCheckedAt: new Date(),
    })
    .where(eq(whatsappIntegrations.id, integrationId));
}

export async function touchWhatsAppWebhook(integrationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(whatsappIntegrations)
    .set({ lastWebhookReceivedAt: new Date() })
    .where(eq(whatsappIntegrations.id, integrationId));
}

export async function touchWhatsAppInbound(integrationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(whatsappIntegrations)
    .set({ lastMessageReceivedAt: new Date() })
    .where(eq(whatsappIntegrations.id, integrationId));
}

export async function touchWhatsAppOutbound(integrationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(whatsappIntegrations)
    .set({ lastMessageSentAt: new Date() })
    .where(eq(whatsappIntegrations.id, integrationId));
}

export async function getWhatsAppContactByPhone(
  userId: number,
  phoneNumber: string
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(whatsappContacts)
    .where(
      and(
        eq(whatsappContacts.userId, userId),
        eq(whatsappContacts.phoneNumber, phoneNumber)
      )
    )
    .limit(1);
  return record;
}

export async function upsertWhatsAppContact(
  userId: number,
  data: Pick<InsertWhatsAppContact, "integrationId" | "phoneNumber"> &
    Partial<InsertWhatsAppContact>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getWhatsAppContactByPhone(userId, data.phoneNumber);
  if (existing) {
    await db
      .update(whatsappContacts)
      .set(data)
      .where(eq(whatsappContacts.id, existing.id));
    return { ...existing, ...data };
  }

  const [created] = await db
    .insert(whatsappContacts)
    .values({
      userId,
      integrationId: data.integrationId,
      phoneNumber: data.phoneNumber,
      displayName: data.displayName ?? null,
      isAuthorized: data.isAuthorized ?? false,
      lastSeenAt: data.lastSeenAt ?? null,
    })
    .returning();
  return created;
}

export async function getAssistantThread(
  userId: number,
  integrationId: number,
  contactId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.integrationId, integrationId),
        eq(assistantThreads.contactId, contactId)
      )
    )
    .limit(1);
  return record;
}

export async function getAssistantThreadById(
  userId: number,
  integrationId: number,
  threadId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.id, threadId),
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.integrationId, integrationId)
      )
    )
    .limit(1);
  return record;
}

export async function getOrCreateAssistantThread(
  userId: number,
  integrationId: number,
  contactId: number,
  data?: Partial<InsertAssistantThread>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getAssistantThread(userId, integrationId, contactId);
  if (existing) {
    await db
      .update(assistantThreads)
      .set({ lastMessageAt: data?.lastMessageAt ?? new Date() })
      .where(eq(assistantThreads.id, existing.id));
    return { ...existing, lastMessageAt: data?.lastMessageAt ?? new Date() };
  }

  const [created] = await db
    .insert(assistantThreads)
    .values({
      userId,
      integrationId,
      contactId,
      channel: data?.channel ?? "whatsapp",
      status: data?.status ?? "active",
      lastMessageAt: data?.lastMessageAt ?? new Date(),
    })
    .returning();
  return created;
}

export async function listAssistantThreads(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assistantThreads)
    .where(eq(assistantThreads.userId, userId))
    .orderBy(
      desc(assistantThreads.lastMessageAt),
      desc(assistantThreads.updatedAt)
    );
}

export async function createWhatsAppMessage(data: InsertWhatsAppMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(whatsappMessages).values(data).returning();
  return created;
}

export async function createInboundWhatsAppMessageIfNew(
  data: InsertWhatsAppMessage
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db
    .insert(whatsappMessages)
    .values(data)
    .onConflictDoNothing()
    .returning();
  return created;
}

export async function updateWhatsAppMessage(
  messageId: number,
  data: Partial<InsertWhatsAppMessage>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(whatsappMessages)
    .set(data)
    .where(eq(whatsappMessages.id, messageId));
}

export async function getWhatsAppMessageById(
  userId: number,
  messageId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [message] = await db
    .select()
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.id, messageId),
        eq(whatsappMessages.userId, userId)
      )
    )
    .limit(1);
  return message;
}

export async function createWhatsAppOutboxItem(data: InsertWhatsAppOutboxItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db
    .insert(whatsappOutbox)
    .values(data)
    .onConflictDoNothing()
    .returning();
  if (created) return { item: created, alreadyQueued: false };
  const [existing] = await db
    .select()
    .from(whatsappOutbox)
    .where(
      and(
        eq(whatsappOutbox.tenantId, data.tenantId),
        eq(whatsappOutbox.userId, data.userId),
        eq(whatsappOutbox.idempotencyKey, data.idempotencyKey)
      )
    )
    .limit(1);
  if (!existing) throw new Error("Falha de idempotencia da fila WhatsApp");
  return { item: existing, alreadyQueued: true };
}

export async function getWhatsAppOutboxItem(outboxId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [item] = await db
    .select()
    .from(whatsappOutbox)
    .where(eq(whatsappOutbox.id, outboxId))
    .limit(1);
  return item;
}

export async function listDueWhatsAppOutbox(now = new Date(), limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(whatsappOutbox)
    .where(
      and(
        or(
          eq(whatsappOutbox.status, "pending"),
          eq(whatsappOutbox.status, "failed"),
          eq(whatsappOutbox.status, "processing")
        ),
        lte(whatsappOutbox.nextAttemptAt, now)
      )
    )
    .orderBy(asc(whatsappOutbox.nextAttemptAt), asc(whatsappOutbox.id))
    .limit(Math.max(1, Math.min(limit, 200)));
}

export async function claimWhatsAppOutboxItem(
  outboxId: number,
  now = new Date()
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [claimed] = await db
    .update(whatsappOutbox)
    .set({
      status: "processing",
      attempts: sql`${whatsappOutbox.attempts} + 1`,
      nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      updatedAt: now,
    })
    .where(
      and(
        eq(whatsappOutbox.id, outboxId),
        or(
          eq(whatsappOutbox.status, "pending"),
          eq(whatsappOutbox.status, "failed"),
          eq(whatsappOutbox.status, "processing")
        ),
        lte(whatsappOutbox.nextAttemptAt, now)
      )
    )
    .returning();
  return claimed;
}

export async function markWhatsAppOutboxSent(
  outboxId: number,
  input: { providerMessageId: string; messageId: number }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [sent] = await db
    .update(whatsappOutbox)
    .set({
      status: "sent",
      providerMessageId: input.providerMessageId,
      messageId: input.messageId,
      lastError: null,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(whatsappOutbox.id, outboxId))
    .returning();
  return sent;
}

export async function markWhatsAppOutboxFailed(
  outboxId: number,
  attempts: number,
  error: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const nextAttemptAt = new Date(
    Date.now() + Math.min(24 * 60, 2 ** Math.max(1, attempts) * 2) * 60_000
  );
  const [failed] = await db
    .update(whatsappOutbox)
    .set({
      status: attempts >= 8 ? "dead_letter" : "failed",
      nextAttemptAt,
      lastError: error.slice(0, 2_000),
      updatedAt: new Date(),
    })
    .where(eq(whatsappOutbox.id, outboxId))
    .returning();
  return failed;
}

export async function listWhatsAppMessages(userId: number, threadId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(whatsappMessages.userId, userId)];
  if (threadId != null)
    conditions.push(eq(whatsappMessages.threadId, threadId));
  return db
    .select()
    .from(whatsappMessages)
    .where(and(...conditions))
    .orderBy(desc(whatsappMessages.createdAt));
}

export async function listRecentWhatsAppMessages(
  userId: number,
  threadId: number,
  limit = 12
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      direction: whatsappMessages.direction,
      textContent: whatsappMessages.textContent,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.userId, userId),
        eq(whatsappMessages.threadId, threadId)
      )
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(Math.max(1, Math.min(limit, 20)));
}

export async function createAssistantRun(data: InsertAssistantRun) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(assistantRuns).values(data).returning();
  return created;
}

export async function updateAssistantRun(
  runId: number,
  data: Partial<InsertAssistantRun>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(assistantRuns).set(data).where(eq(assistantRuns.id, runId));
}

export async function getAssistantRunById(userId: number, runId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(assistantRuns)
    .where(and(eq(assistantRuns.userId, userId), eq(assistantRuns.id, runId)))
    .limit(1);
  return record;
}

export async function getLatestPendingAssistantRun(
  userId: number,
  threadId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(assistantRuns)
    .where(
      and(
        eq(assistantRuns.userId, userId),
        eq(assistantRuns.threadId, threadId),
        eq(assistantRuns.status, "aguardando_confirmacao")
      )
    )
    .orderBy(desc(assistantRuns.createdAt))
    .limit(1);
  return record;
}

export async function listAssistantRuns(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.userId, userId))
    .orderBy(desc(assistantRuns.createdAt));
}

export async function getFinancialPlanByPeriod(
  userId: number,
  periodMonth: number,
  periodYear: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.userId, userId),
        eq(financialPlans.periodMonth, periodMonth),
        eq(financialPlans.periodYear, periodYear)
      )
    )
    .limit(1);
  return record;
}

export async function upsertFinancialPlan(data: InsertFinancialPlan) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getFinancialPlanByPeriod(
    data.userId,
    data.periodMonth,
    data.periodYear
  );
  if (existing) {
    await db
      .update(financialPlans)
      .set(data)
      .where(eq(financialPlans.id, existing.id));
    return { ...existing, ...data };
  }
  const [created] = await db.insert(financialPlans).values(data).returning();
  return created;
}

export async function updateFinancialPlan(
  planId: number,
  userId: number,
  data: Partial<InsertFinancialPlan>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(financialPlans)
    .set(data)
    .where(
      and(eq(financialPlans.id, planId), eq(financialPlans.userId, userId))
    );
}

export async function listFinancialPlans(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(financialPlans)
    .where(eq(financialPlans.userId, userId))
    .orderBy(desc(financialPlans.periodYear), desc(financialPlans.periodMonth));
}

export async function listFinancialPlanActions(
  userId: number,
  planId?: number
) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(financialPlanActions.userId, userId)];
  if (planId != null) conditions.push(eq(financialPlanActions.planId, planId));
  return db
    .select()
    .from(financialPlanActions)
    .where(and(...conditions))
    .orderBy(asc(financialPlanActions.createdAt));
}

export async function replaceFinancialPlanActions(
  userId: number,
  planId: number,
  actions: Array<Omit<InsertFinancialPlanAction, "userId" | "planId">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(financialPlanActions)
    .where(
      and(
        eq(financialPlanActions.userId, userId),
        eq(financialPlanActions.planId, planId)
      )
    );
  if (actions.length === 0) return [];
  return db
    .insert(financialPlanActions)
    .values(actions.map(action => ({ ...action, userId, planId })))
    .returning();
}

export async function updateFinancialPlanAction(
  actionId: number,
  userId: number,
  data: Partial<InsertFinancialPlanAction>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(financialPlanActions)
    .set(data)
    .where(
      and(
        eq(financialPlanActions.id, actionId),
        eq(financialPlanActions.userId, userId)
      )
    );
}

export async function getFinancialPlanActionById(
  userId: number,
  actionId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(financialPlanActions)
    .where(
      and(
        eq(financialPlanActions.userId, userId),
        eq(financialPlanActions.id, actionId)
      )
    )
    .limit(1);
  return record;
}

export async function createNotificationEvent(data: InsertNotificationEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db
    .insert(notificationEvents)
    .values(data)
    .returning();
  return created;
}

export async function getNotificationEventByDedupeKey(
  integrationId: number,
  dedupeKey: string
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.integrationId, integrationId),
        eq(notificationEvents.dedupeKey, dedupeKey)
      )
    )
    .limit(1);
  return record;
}

export async function listNotificationEvents(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.userId, userId))
    .orderBy(desc(notificationEvents.createdAt));
}

export async function updateNotificationEvent(
  eventId: number,
  userId: number,
  data: Partial<InsertNotificationEvent>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(notificationEvents)
    .set(data)
    .where(
      and(
        eq(notificationEvents.id, eventId),
        eq(notificationEvents.userId, userId)
      )
    );
}

export async function getNotificationEventById(
  userId: number,
  eventId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const [record] = await db
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.userId, userId),
        eq(notificationEvents.id, eventId)
      )
    )
    .limit(1);
  return record;
}
