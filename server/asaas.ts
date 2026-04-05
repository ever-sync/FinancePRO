import { createHash, randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import type {
  InsertAsaasCharge,
  InsertAsaasFinancialTransaction,
  InsertAsaasInvoice,
  InsertAsaasSubscription,
  InsertAsaasTransfer,
} from "../drizzle/schema";
import {
  AsaasClient,
  type AsaasBillingType,
  type AsaasCustomerRecord,
  type AsaasEnvironment,
  type AsaasFinancialTransactionRecord,
  type AsaasInvoiceRecord,
  type AsaasPaymentRecord,
  type AsaasPixQrCodeRecord,
  type AsaasSubscriptionCycle,
  type AsaasSubscriptionRecord,
  type AsaasTransferRecord,
  getAsaasBaseUrl,
  mapClientToAsaasCustomer,
} from "./_core/asaas";
import * as asaasDb from "./db/asaas";

type AnyRecord = Record<string, any>;

function toDecimalString(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function normalizeAmount(value: unknown) {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateOnly(value: unknown) {
  if (!value) return null;
  const raw = String(value);
  const directDate = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (directDate) return directDate;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function getNestedString(value: unknown, path: string[]) {
  let current: any = value;
  for (const key of path) {
    if (current == null || typeof current !== "object") return null;
    current = current[key];
  }
  return current == null ? null : String(current);
}

function buildSyntheticExternalId(prefix: string, payload: unknown) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)}`;
}

function getPaymentReceivedDate(payment: AsaasPaymentRecord) {
  return (
    toDateOnly(payment.clientPaymentDate) ??
    toDateOnly(payment.paymentDate) ??
    toDateOnly(payment.confirmedDate) ??
    toDateOnly(payment.creditDate) ??
    toDateOnly(payment.receivedDate)
  );
}

function getFinancialTransactionId(transaction: AsaasFinancialTransactionRecord) {
  return transaction.id != null
    ? String(transaction.id)
    : buildSyntheticExternalId("txn", transaction);
}

function getTransferId(transfer: AsaasTransferRecord) {
  return transfer.id != null ? String(transfer.id) : buildSyntheticExternalId("trf", transfer);
}

function getWebhookUrl(origin?: string | null) {
  if (!origin) return undefined;
  return `${origin.replace(/\/$/, "")}/api/asaas/webhook`;
}

function maskSecret(secret?: string | null) {
  if (!secret) return "";
  if (secret.length <= 8) return "********";
  return `${secret.slice(0, 4)}${"*".repeat(Math.max(secret.length - 8, 4))}${secret.slice(-4)}`;
}

function getAsaasClient(account: {
  apiKey: string;
  environment: AsaasEnvironment;
  apiBaseUrl?: string | null;
}) {
  return new AsaasClient(account.apiKey, account.environment, account.apiBaseUrl);
}

async function requireAsaasAccount(userId: number) {
  const account = await asaasDb.getAsaasAccount(userId);
  if (!account || !account.enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Configure a integracao do Asaas antes de usar o modulo de faturamento.",
    });
  }
  return account;
}

function mapPaymentToLocalStatus(eventType?: string | null, status?: string | null) {
  const normalizedEvent = String(eventType || "").toUpperCase();
  const normalizedStatus = String(status || "").toUpperCase();

  if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(normalizedEvent)) return "recebido";
  if (["PAYMENT_OVERDUE"].includes(normalizedEvent)) return "atrasado";
  if (
    [
      "PAYMENT_DELETED",
      "PAYMENT_REFUNDED",
      "PAYMENT_PARTIALLY_REFUNDED",
      "PAYMENT_RECEIVED_IN_CASH_UNDONE",
      "PAYMENT_BANK_SLIP_CANCELLED",
    ].includes(normalizedEvent)
  ) {
    return "cancelado";
  }

  if (["RECEIVED", "CONFIRMED"].includes(normalizedStatus)) return "recebido";
  if (["OVERDUE"].includes(normalizedStatus)) return "atrasado";
  if (["DELETED", "REFUNDED", "RECEIVED_IN_CASH_UNDONE"].includes(normalizedStatus)) {
    return "cancelado";
  }
  return "pendente";
}

function buildChargeMirror(input: {
  userId: number;
  accountId: number;
  clientId?: number | null;
  serviceId?: number | null;
  revenueId?: number | null;
  payment: AsaasPaymentRecord;
  pix?: AsaasPixQrCodeRecord | null;
  lastEvent?: string | null;
}): InsertAsaasCharge {
  return {
    userId: input.userId,
    accountId: input.accountId,
    clientId: input.clientId ?? null,
    serviceId: input.serviceId ?? null,
    revenueId: input.revenueId ?? null,
    asaasChargeId: String(input.payment.id),
    asaasCustomerId: String(input.payment.customer),
    asaasSubscriptionId: input.payment.subscription ? String(input.payment.subscription) : null,
    status: String(input.payment.status ?? "PENDING"),
    billingType: String(input.payment.billingType ?? "PIX"),
    description: String(input.payment.description ?? "Cobranca Asaas"),
    value: toDecimalString(normalizeAmount(input.payment.value)),
    dueDate: String(input.payment.dueDate),
    externalReference: input.payment.externalReference
      ? String(input.payment.externalReference)
      : null,
    invoiceUrl: input.payment.invoiceUrl ? String(input.payment.invoiceUrl) : null,
    bankSlipUrl: input.payment.bankSlipUrl ? String(input.payment.bankSlipUrl) : null,
    pixQrCodeUrl: input.pix?.encodedImage ? String(input.pix.encodedImage) : null,
    pixCopyAndPaste:
      input.pix?.payload || input.pix?.copyPasteKey
        ? String(input.pix.payload ?? input.pix.copyPasteKey)
        : null,
    lastEvent: input.lastEvent ? String(input.lastEvent) : null,
    lastSyncedAt: new Date(),
    deletedAt:
      String(input.payment.deleted ?? "false") === "true" || String(input.payment.status ?? "") === "DELETED"
        ? new Date()
        : null,
    rawPayload: JSON.stringify({ payment: input.payment, pix: input.pix ?? null }),
  };
}

function buildSubscriptionMirror(input: {
  userId: number;
  accountId: number;
  clientId?: number | null;
  serviceId?: number | null;
  subscription: AsaasSubscriptionRecord;
}): InsertAsaasSubscription {
  return {
    userId: input.userId,
    accountId: input.accountId,
    clientId: input.clientId ?? null,
    serviceId: input.serviceId ?? null,
    asaasSubscriptionId: String(input.subscription.id),
    asaasCustomerId: String(input.subscription.customer),
    status: String(input.subscription.status ?? "ACTIVE"),
    billingType: String(input.subscription.billingType ?? "PIX"),
    cycle: String(input.subscription.cycle ?? "MONTHLY"),
    description: String(input.subscription.description ?? "Assinatura Asaas"),
    value: toDecimalString(normalizeAmount(input.subscription.value)),
    nextDueDate: String(input.subscription.nextDueDate),
    externalReference: input.subscription.externalReference
      ? String(input.subscription.externalReference)
      : null,
    deletedAt:
      ["INACTIVE", "REMOVED", "DELETED"].includes(String(input.subscription.status ?? "").toUpperCase())
        ? new Date()
        : null,
    lastSyncedAt: new Date(),
    rawPayload: JSON.stringify(input.subscription),
  };
}

function buildInvoiceMirror(input: {
  userId: number;
  accountId: number;
  chargeId?: number | null;
  revenueId?: number | null;
  asaasChargeId?: string | null;
  invoice: AsaasInvoiceRecord;
}): InsertAsaasInvoice {
  return {
    userId: input.userId,
    accountId: input.accountId,
    chargeId: input.chargeId ?? null,
    revenueId: input.revenueId ?? null,
    asaasChargeId: input.asaasChargeId ?? null,
    asaasInvoiceId: String(input.invoice.id),
    status: String(input.invoice.status ?? "SCHEDULED"),
    value: input.invoice.value != null ? toDecimalString(normalizeAmount(input.invoice.value)) : null,
    effectiveDate: input.invoice.effectiveDate ? String(input.invoice.effectiveDate) : null,
    invoiceNumber: input.invoice.invoiceNumber ? String(input.invoice.invoiceNumber) : null,
    serviceDescription: input.invoice.serviceDescription
      ? String(input.invoice.serviceDescription)
      : null,
    pdfUrl: input.invoice.pdfUrl ? String(input.invoice.pdfUrl) : null,
    xmlUrl: input.invoice.xmlUrl ? String(input.invoice.xmlUrl) : null,
    validationCode: input.invoice.verificationCode
      ? String(input.invoice.verificationCode)
      : input.invoice.validationCode
        ? String(input.invoice.validationCode)
        : null,
    lastError:
      input.invoice.errorDescription || input.invoice.observations
        ? String(input.invoice.errorDescription ?? input.invoice.observations)
        : null,
    authorizedAt: input.invoice.authorizedAt ? new Date(String(input.invoice.authorizedAt)) : null,
    cancelledAt: input.invoice.cancelledAt ? new Date(String(input.invoice.cancelledAt)) : null,
    lastSyncedAt: new Date(),
    rawPayload: JSON.stringify(input.invoice),
  };
}

function buildTransferMirror(input: {
  userId: number;
  accountId: number;
  transfer: AsaasTransferRecord;
}): InsertAsaasTransfer {
  return {
    userId: input.userId,
    accountId: input.accountId,
    asaasTransferId: getTransferId(input.transfer),
    status: String(input.transfer.status ?? "PENDING"),
    transferType:
      input.transfer.transferType != null ? String(input.transfer.transferType) : null,
    operationType:
      input.transfer.operationType != null ? String(input.transfer.operationType) : null,
    value: toDecimalString(normalizeAmount(input.transfer.value ?? input.transfer.amount)),
    netValue:
      input.transfer.netValue != null
        ? toDecimalString(normalizeAmount(input.transfer.netValue))
        : null,
    transferDate: toDateOnly(input.transfer.transferDate ?? input.transfer.dateCreated),
    scheduledDate: toDateOnly(input.transfer.scheduledDate ?? input.transfer.scheduleDate),
    effectiveDate: toDateOnly(input.transfer.effectiveDate),
    bankName:
      getNestedString(input.transfer.bankAccount, ["bank", "name"]) ??
      getNestedString(input.transfer.bankAccount, ["bank", "code"]) ??
      getNestedString(input.transfer, ["bank", "name"]),
    recipientName:
      getNestedString(input.transfer.bankAccount, ["ownerName"]) ??
      getNestedString(input.transfer.bankAccount, ["accountName"]) ??
      getNestedString(input.transfer, ["recipient", "name"]),
    externalReference:
      input.transfer.externalReference != null ? String(input.transfer.externalReference) : null,
    lastSyncedAt: new Date(),
    cancelledAt:
      ["CANCELLED", "FAILED"].includes(String(input.transfer.status ?? "").toUpperCase())
        ? new Date()
        : null,
    rawPayload: JSON.stringify(input.transfer),
  };
}

function buildFinancialTransactionMirror(input: {
  userId: number;
  accountId: number;
  transaction: AsaasFinancialTransactionRecord;
}): InsertAsaasFinancialTransaction {
  const paymentRef = input.transaction.payment;
  const transferRef = input.transaction.transfer;
  const invoiceRef = input.transaction.invoice;

  return {
    userId: input.userId,
    accountId: input.accountId,
    asaasTransactionId: getFinancialTransactionId(input.transaction),
    transactionType:
      input.transaction.transactionType != null
        ? String(input.transaction.transactionType)
        : input.transaction.type != null
          ? String(input.transaction.type)
          : null,
    entryType:
      input.transaction.entryType != null ? String(input.transaction.entryType) : null,
    status: input.transaction.status != null ? String(input.transaction.status) : null,
    description:
      input.transaction.description != null ? String(input.transaction.description) : null,
    value: toDecimalString(normalizeAmount(input.transaction.value ?? input.transaction.amount)),
    balance:
      input.transaction.balance != null
        ? toDecimalString(normalizeAmount(input.transaction.balance))
        : null,
    transactionDate: toDateOnly(
      input.transaction.transactionDate ?? input.transaction.date ?? input.transaction.effectiveDate
    ),
    effectiveDate: toDateOnly(input.transaction.effectiveDate ?? input.transaction.date),
    asaasChargeId:
      paymentRef == null
        ? null
        : typeof paymentRef === "object"
          ? getNestedString(paymentRef, ["id"])
          : String(paymentRef),
    asaasTransferId:
      transferRef == null
        ? null
        : typeof transferRef === "object"
          ? getNestedString(transferRef, ["id"])
          : String(transferRef),
    asaasInvoiceId:
      invoiceRef == null
        ? null
        : typeof invoiceRef === "object"
          ? getNestedString(invoiceRef, ["id"])
          : String(invoiceRef),
    lastSyncedAt: new Date(),
    rawPayload: JSON.stringify(input.transaction),
  };
}

async function ensureCustomerSynced(userId: number, clientId: number) {
  const account = await requireAsaasAccount(userId);
  const localClient = await asaasDb.getClientForSync(userId, clientId);
  if (!localClient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente nao encontrado." });
  }

  const client = getAsaasClient(account);
  const payload = mapClientToAsaasCustomer(localClient);

  try {
    if (localClient.asaasCustomerId) {
      const updated = await client.updateCustomer(localClient.asaasCustomerId, payload);
      await asaasDb.updateClientAsaasBinding(userId, clientId, {
        asaasCustomerId: String(updated.id ?? localClient.asaasCustomerId),
        asaasSyncStatus: "sincronizado",
        asaasLastSyncError: null,
        asaasLastSyncedAt: new Date(),
      });
      return {
        localClientId: localClient.id,
        asaasCustomerId: String(updated.id ?? localClient.asaasCustomerId),
        synced: true,
      };
    }

    const found = localClient.document
      ? await client.listCustomers({ cpfCnpj: localClient.document.replace(/\D/g, "") })
      : null;
    const existingCustomer: AsaasCustomerRecord | undefined = found?.data?.[0];
    const createdOrFound =
      existingCustomer ??
      (await client.createCustomer(payload));

    await asaasDb.updateClientAsaasBinding(userId, clientId, {
      asaasCustomerId: String(createdOrFound.id),
      asaasSyncStatus: "sincronizado",
      asaasLastSyncError: null,
      asaasLastSyncedAt: new Date(),
    });

    return {
      localClientId: localClient.id,
      asaasCustomerId: String(createdOrFound.id),
      synced: true,
    };
  } catch (error) {
    await asaasDb.updateClientAsaasBinding(userId, clientId, {
      asaasSyncStatus: "erro",
      asaasLastSyncError: error instanceof Error ? error.message : "Erro ao sincronizar cliente",
      asaasLastSyncedAt: new Date(),
    });
    throw error;
  }
}

async function ensureRevenueForPayment(input: {
  userId: number;
  clientId?: number | null;
  serviceId?: number | null;
  revenueId?: number | null;
  payment: AsaasPaymentRecord;
  lastEvent?: string | null;
}) {
  const existing = await asaasDb.getRevenueByAsaasPaymentId(input.userId, String(input.payment.id));
  const localStatus = mapPaymentToLocalStatus(input.lastEvent, input.payment.status);
  const receivedDate = getPaymentReceivedDate(input.payment);

  if (existing) {
    await asaasDb.updateRevenueAsaasState(input.userId, existing.id, {
      status: localStatus,
      receivedDate: localStatus === "recebido" ? receivedDate ?? existing.receivedDate : null,
      asaasPaymentId: String(input.payment.id),
      asaasSubscriptionId: input.payment.subscription ? String(input.payment.subscription) : null,
      asaasBillingType: input.payment.billingType ? String(input.payment.billingType) : null,
      asaasInvoiceUrl: input.payment.invoiceUrl ? String(input.payment.invoiceUrl) : null,
      asaasBankSlipUrl: input.payment.bankSlipUrl ? String(input.payment.bankSlipUrl) : null,
      asaasLastEvent: input.lastEvent ? String(input.lastEvent) : null,
      asaasExternalReference: input.payment.externalReference
        ? String(input.payment.externalReference)
        : null,
      asaasSyncedAt: new Date(),
    });
    return existing.id;
  }

  if (input.revenueId != null) {
    const linkedRevenue = await asaasDb.getRevenueById(input.userId, input.revenueId);
    if (linkedRevenue) {
      await asaasDb.updateRevenueAsaasState(input.userId, linkedRevenue.id, {
        description: String(input.payment.description ?? linkedRevenue.description),
        dueDate: String(input.payment.dueDate || linkedRevenue.dueDate),
        status: localStatus,
        receivedDate: localStatus === "recebido" ? receivedDate ?? linkedRevenue.receivedDate : null,
        asaasPaymentId: String(input.payment.id),
        asaasSubscriptionId: input.payment.subscription ? String(input.payment.subscription) : null,
        asaasBillingType: input.payment.billingType ? String(input.payment.billingType) : null,
        asaasInvoiceUrl: input.payment.invoiceUrl ? String(input.payment.invoiceUrl) : null,
        asaasBankSlipUrl: input.payment.bankSlipUrl ? String(input.payment.bankSlipUrl) : null,
        asaasLastEvent: input.lastEvent ? String(input.lastEvent) : null,
        asaasExternalReference: input.payment.externalReference
          ? String(input.payment.externalReference)
          : null,
        asaasSyncedAt: new Date(),
      });
      return linkedRevenue.id;
    }
  }

  const userSettings = await asaasDb.getSettingsForRevenue(input.userId);
  const taxRate = normalizeAmount(userSettings?.taxPercent ?? "6") / 100;
  const grossAmount = normalizeAmount(input.payment.value);
  const taxAmount = grossAmount * taxRate;
  const netAmount = grossAmount - taxAmount;
  const localClient =
    input.clientId != null ? await asaasDb.getClientForSync(input.userId, input.clientId) : undefined;
  const revenue = await asaasDb.createRevenueForAsaasCharge({
    userId: input.userId,
    description: String(input.payment.description ?? "Receita Asaas"),
    category: "Asaas",
    grossAmount: toDecimalString(grossAmount),
    taxAmount: toDecimalString(taxAmount),
    netAmount: toDecimalString(netAmount),
    client: localClient?.name ?? null,
    dueDate: String(input.payment.dueDate),
    receivedDate: localStatus === "recebido" ? receivedDate : null,
    status: localStatus,
    seriesId: null,
    asaasPaymentId: String(input.payment.id),
    asaasSubscriptionId: input.payment.subscription ? String(input.payment.subscription) : null,
    asaasBillingType: input.payment.billingType ? String(input.payment.billingType) : null,
    asaasInvoiceUrl: input.payment.invoiceUrl ? String(input.payment.invoiceUrl) : null,
    asaasBankSlipUrl: input.payment.bankSlipUrl ? String(input.payment.bankSlipUrl) : null,
    asaasLastEvent: input.lastEvent ? String(input.lastEvent) : null,
    asaasExternalReference: input.payment.externalReference
      ? String(input.payment.externalReference)
      : null,
    asaasSyncedAt: new Date(),
  });
  return revenue.id;
}

async function syncPaymentMirror(input: {
  userId: number;
  accountId: number;
  clientId?: number | null;
  serviceId?: number | null;
  revenueId?: number | null;
  payment: AsaasPaymentRecord;
  pix?: AsaasPixQrCodeRecord | null;
  lastEvent?: string | null;
}) {
  const revenueId = await ensureRevenueForPayment(input);
  return asaasDb.upsertAsaasCharge(
    buildChargeMirror({
      ...input,
      revenueId,
    })
  );
}

async function listAllPages<T extends AnyRecord>(
  fetchPage: (params: { limit: number; offset: number }) => Promise<{
    data: T[];
    hasMore?: boolean;
    limit?: number;
  }>
) {
  const limit = 100;
  let offset = 0;
  const items: T[] = [];

  while (true) {
    const page = await fetchPage({ limit, offset });
    const data = Array.isArray(page.data) ? page.data : [];
    items.push(...data);

    if (!page.hasMore || data.length === 0) {
      break;
    }

    offset += page.limit ?? limit;
  }

  return items;
}

async function createImportAuditEvent(input: {
  userId: number;
  accountId: number;
  resourceType: string;
  importedCount: number;
  payload: unknown;
}) {
  return asaasDb.createAsaasWebhookEvent({
    userId: input.userId,
    accountId: input.accountId,
    eventFingerprint: buildSyntheticExternalId(`import_${input.resourceType}`, {
      at: new Date().toISOString(),
      count: input.importedCount,
      payload: input.payload,
    }),
    eventType: `IMPORT_${input.resourceType.toUpperCase()}`,
    resourceType: "import",
    resourceId: String(input.importedCount),
    duplicate: false,
    processed: true,
    lastError: null,
    payload: JSON.stringify(input.payload),
    processedAt: new Date(),
  });
}

export async function getAsaasIntegration(userId: number, origin?: string | null) {
  const account = await asaasDb.getAsaasAccount(userId);
  if (!account) {
    return {
      configured: false,
      environment: "sandbox" as AsaasEnvironment,
      enabled: false,
      accountName: "Conta principal",
      webhookUrl: getWebhookUrl(origin) ?? "",
      maskedApiKey: "",
      maskedWebhookAuthToken: "",
      hasWebhookAuthToken: false,
      apiBaseUrl: getAsaasBaseUrl("sandbox"),
      lastConnectionStatus: "pendente",
      lastConnectionMessage: null,
      lastConnectionCheckedAt: null,
    };
  }

  return {
    configured: true,
    id: account.id,
    environment: account.environment,
    enabled: account.enabled,
    accountName: account.accountName,
    webhookUrl: account.webhookUrl || getWebhookUrl(origin) || "",
    maskedApiKey: maskSecret(account.apiKey),
    maskedWebhookAuthToken: maskSecret(account.webhookAuthToken),
    hasWebhookAuthToken: !!account.webhookAuthToken,
    apiBaseUrl: getAsaasBaseUrl(account.environment, account.apiBaseUrl),
    lastConnectionStatus: account.lastConnectionStatus,
    lastConnectionMessage: account.lastConnectionMessage,
    lastConnectionCheckedAt: account.lastConnectionCheckedAt,
  };
}

export async function upsertAsaasIntegration(
  userId: number,
  input: {
    accountName?: string;
    environment: AsaasEnvironment;
    apiKey?: string;
    webhookAuthToken?: string;
    enabled?: boolean;
  },
  origin?: string | null
) {
  const webhookUrl = getWebhookUrl(origin);
  await asaasDb.upsertAsaasAccount(userId, {
    accountName: input.accountName ?? "Conta principal",
    environment: input.environment,
    apiKey: input.apiKey,
    webhookAuthToken: input.webhookAuthToken,
    enabled: input.enabled ?? true,
    webhookUrl,
  });
  return getAsaasIntegration(userId, origin);
}

export async function testAsaasConnection(userId: number) {
  const account = await requireAsaasAccount(userId);
  try {
    const client = getAsaasClient(account);
    await client.testConnection();
    await asaasDb.markAsaasConnection(account.id, "conectado", "Conexao validada com sucesso.");
    return { ok: true, message: "Conexao com o Asaas validada com sucesso." };
  } catch (error) {
    await asaasDb.markAsaasConnection(
      account.id,
      "erro",
      error instanceof Error ? error.message : "Falha ao validar conexao"
    );
    throw error;
  }
}

export async function getAsaasSyncStatus(userId: number) {
  const account = await getAsaasIntegration(userId);
  const [charges, subscriptions, invoices, transfers, financialTransactions, events, clients] =
    await Promise.all([
    asaasDb.listAsaasCharges(userId),
    asaasDb.listAsaasSubscriptions(userId),
    asaasDb.listAsaasInvoices(userId),
    asaasDb.listAsaasTransfers(userId),
    asaasDb.listAsaasFinancialTransactions(userId),
    asaasDb.listAsaasEvents(userId),
    asaasDb.listClientsForSync(userId),
    ]);

  let balance: string | null = null;
  if (account.configured && account.enabled) {
    try {
      const remoteAccount = await requireAsaasAccount(userId);
      const remoteBalance = await getAsaasClient(remoteAccount).getBalance();
      balance =
        remoteBalance.balance != null
          ? toDecimalString(normalizeAmount(remoteBalance.balance))
          : null;
    } catch {
      balance = null;
    }
  }

  return {
    integration: account,
    totals: {
      clients: clients.length,
      clientsSynced: clients.filter(client => !!client.asaasCustomerId).length,
      charges: charges.length,
      subscriptions: subscriptions.length,
      invoices: invoices.length,
      transfers: transfers.length,
      financialTransactions: financialTransactions.length,
      events: events.length,
      pendingEvents: events.filter(event => !event.processed).length,
      currentBalance: balance,
    },
  };
}

export async function syncAsaasCustomer(userId: number, clientId: number) {
  return ensureCustomerSynced(userId, clientId);
}

export async function syncAllAsaasCustomers(userId: number) {
  const clients = await asaasDb.listClientsForSync(userId);
  const results = [];
  for (const client of clients) {
    results.push(await ensureCustomerSynced(userId, client.id));
  }
  return results;
}

export async function listAsaasCharges(userId: number) {
  return asaasDb.listAsaasCharges(userId);
}

export async function createAsaasCharge(
  userId: number,
  input: {
    clientId: number;
    revenueId?: number;
    serviceId?: number;
    description?: string;
    value?: string;
    dueDate: string;
    billingType: AsaasBillingType;
  }
) {
  const account = await requireAsaasAccount(userId);
  const localClient = await asaasDb.getClientForSync(userId, input.clientId);
  if (!localClient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente nao encontrado." });
  }

  const localService =
    input.serviceId != null ? await asaasDb.getServiceForSync(userId, input.serviceId) : undefined;
  const sync = await ensureCustomerSynced(userId, input.clientId);
  const client = getAsaasClient(account);
  const value = normalizeAmount(input.value ?? localService?.basePrice ?? 0);
  const description = input.description || localService?.name || `Cobranca ${localClient.name}`;
  const externalReference = `financepro-charge-${randomUUID()}`;

  const payment = await client.createPayment({
    customer: sync.asaasCustomerId,
    billingType: input.billingType,
    value,
    dueDate: input.dueDate,
    description,
    externalReference,
  });

  const pix =
    input.billingType === "PIX" ? await client.getPixQrCode(String(payment.id)) : null;

  return syncPaymentMirror({
    userId,
    accountId: account.id,
    clientId: localClient.id,
    serviceId: localService?.id ?? null,
    revenueId: input.revenueId ?? null,
    payment,
    pix,
    lastEvent: "PAYMENT_CREATED",
  });
}

export async function resendAsaasCharge(userId: number, chargeId: number) {
  const account = await requireAsaasAccount(userId);
  const localCharge = await asaasDb.getAsaasChargeById(userId, chargeId);
  if (!localCharge) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cobranca nao encontrada." });
  }

  const client = getAsaasClient(account);
  const payment = await client.getPayment(localCharge.asaasChargeId);
  const pix =
    String(localCharge.billingType).toUpperCase() === "PIX"
      ? await client.getPixQrCode(localCharge.asaasChargeId)
      : null;

  return syncPaymentMirror({
    userId,
    accountId: account.id,
    clientId: localCharge.clientId,
    serviceId: localCharge.serviceId,
    payment,
    pix,
    lastEvent: "PAYMENT_SYNCED",
  });
}

export async function syncAsaasChargeByExternalId(userId: number, asaasChargeId: string) {
  const account = await requireAsaasAccount(userId);
  const client = getAsaasClient(account);
  const payment = await client.getPayment(asaasChargeId);
  const localCharge = await asaasDb.getAsaasChargeByExternalId(account.id, asaasChargeId);
  const pix =
    String(payment.billingType || localCharge?.billingType || "").toUpperCase() === "PIX"
      ? await client.getPixQrCode(asaasChargeId)
      : null;

  return syncPaymentMirror({
    userId,
    accountId: account.id,
    clientId: localCharge?.clientId ?? null,
    serviceId: localCharge?.serviceId ?? null,
    payment,
    pix,
    lastEvent: "PAYMENT_SYNCED",
  });
}

export async function cancelAsaasCharge(userId: number, chargeId: number) {
  const account = await requireAsaasAccount(userId);
  const localCharge = await asaasDb.getAsaasChargeById(userId, chargeId);
  if (!localCharge) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cobranca nao encontrada." });
  }

  const client = getAsaasClient(account);
  await client.cancelPayment(localCharge.asaasChargeId);
  const refreshed = await client.getPayment(localCharge.asaasChargeId);
  const mirror = await syncPaymentMirror({
    userId,
    accountId: account.id,
    clientId: localCharge.clientId,
    serviceId: localCharge.serviceId,
    payment: refreshed,
    pix: null,
    lastEvent: "PAYMENT_DELETED",
  });

  if (mirror.revenueId) {
    await asaasDb.updateRevenueAsaasState(userId, mirror.revenueId, {
      status: "cancelado",
      asaasLastEvent: "PAYMENT_DELETED",
      asaasSyncedAt: new Date(),
    });
  }

  return mirror;
}

export async function listAsaasSubscriptions(userId: number) {
  return asaasDb.listAsaasSubscriptions(userId);
}

export async function createAsaasSubscription(
  userId: number,
  input: {
    clientId: number;
    serviceId?: number;
    description?: string;
    value?: string;
    nextDueDate: string;
    billingType: AsaasBillingType;
    cycle: AsaasSubscriptionCycle;
  }
) {
  const account = await requireAsaasAccount(userId);
  const localClient = await asaasDb.getClientForSync(userId, input.clientId);
  if (!localClient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente nao encontrado." });
  }

  const localService =
    input.serviceId != null ? await asaasDb.getServiceForSync(userId, input.serviceId) : undefined;
  const sync = await ensureCustomerSynced(userId, input.clientId);
  const client = getAsaasClient(account);
  const value = normalizeAmount(input.value ?? localService?.basePrice ?? 0);
  const description = input.description || localService?.name || `Assinatura ${localClient.name}`;
  const externalReference = `financepro-subscription-${randomUUID()}`;

  const subscription = await client.createSubscription({
    customer: sync.asaasCustomerId,
    billingType: input.billingType,
    cycle: input.cycle,
    value,
    nextDueDate: input.nextDueDate,
    description,
    externalReference,
  });

  return asaasDb.upsertAsaasSubscription(
    buildSubscriptionMirror({
      userId,
      accountId: account.id,
      clientId: localClient.id,
      serviceId: localService?.id ?? null,
      subscription,
    })
  );
}

export async function cancelAsaasSubscription(userId: number, subscriptionId: number) {
  const account = await requireAsaasAccount(userId);
  const localSubscription = await asaasDb.getAsaasSubscriptionById(userId, subscriptionId);
  if (!localSubscription) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Assinatura nao encontrada." });
  }
  const client = getAsaasClient(account);
  await client.cancelSubscription(localSubscription.asaasSubscriptionId);
  const refreshed = await client.getSubscription(localSubscription.asaasSubscriptionId);
  return asaasDb.upsertAsaasSubscription(
    buildSubscriptionMirror({
      userId,
      accountId: account.id,
      clientId: localSubscription.clientId,
      serviceId: localSubscription.serviceId,
      subscription: refreshed,
    })
  );
}

export async function listAsaasInvoices(userId: number) {
  return asaasDb.listAsaasInvoices(userId);
}

export async function listAsaasTransfers(userId: number) {
  return asaasDb.listAsaasTransfers(userId);
}

export async function listAsaasFinancialTransactions(userId: number) {
  return asaasDb.listAsaasFinancialTransactions(userId);
}

export async function issueAsaasInvoice(
  userId: number,
  input: {
    chargeId?: number;
    revenueId?: number;
    serviceDescription: string;
    value: string;
    effectiveDate?: string;
    observations?: string;
    municipalServiceId?: string;
    municipalServiceCode?: string;
    municipalServiceName?: string;
    deductions?: string;
    retainIss?: boolean;
    iss?: string;
    cofins?: string;
    csll?: string;
    inss?: string;
    ir?: string;
    pis?: string;
  }
) {
  const account = await requireAsaasAccount(userId);
  const client = getAsaasClient(account);

  const localCharge =
    input.chargeId != null ? await asaasDb.getAsaasChargeById(userId, input.chargeId) : undefined;
  const localRevenue =
    input.revenueId != null ? await asaasDb.getRevenueById(userId, input.revenueId) : undefined;

  if (!localCharge && !localRevenue) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Selecione uma cobranca ou receita elegivel para emitir a NFSe.",
    });
  }

  const invoice = await client.scheduleInvoice({
    payment: localCharge?.asaasChargeId,
    serviceDescription: input.serviceDescription,
    value: normalizeAmount(input.value),
    effectiveDate: input.effectiveDate,
    observations: input.observations,
    municipalServiceId: input.municipalServiceId,
    municipalServiceCode: input.municipalServiceCode,
    municipalServiceName: input.municipalServiceName,
    deductions: normalizeAmount(input.deductions),
    taxes: {
      retainIss: input.retainIss,
      iss: normalizeAmount(input.iss),
      cofins: normalizeAmount(input.cofins),
      csll: normalizeAmount(input.csll),
      inss: normalizeAmount(input.inss),
      ir: normalizeAmount(input.ir),
      pis: normalizeAmount(input.pis),
    },
  });

  return asaasDb.upsertAsaasInvoice(
    buildInvoiceMirror({
      userId,
      accountId: account.id,
      chargeId: localCharge?.id ?? null,
      revenueId: localRevenue?.id ?? localCharge?.revenueId ?? null,
      asaasChargeId: localCharge?.asaasChargeId ?? null,
      invoice,
    })
  );
}

export async function resendAsaasInvoice(userId: number, invoiceId: number) {
  const account = await requireAsaasAccount(userId);
  const localInvoice = await asaasDb.getAsaasInvoiceById(userId, invoiceId);
  if (!localInvoice) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Nota fiscal nao encontrada." });
  }
  const client = getAsaasClient(account);
  const invoice = await client.getInvoice(localInvoice.asaasInvoiceId);
  return asaasDb.upsertAsaasInvoice(
    buildInvoiceMirror({
      userId,
      accountId: account.id,
      chargeId: localInvoice.chargeId,
      revenueId: localInvoice.revenueId,
      asaasChargeId: localInvoice.asaasChargeId,
      invoice,
    })
  );
}

export async function importAsaasHistory(
  userId: number,
  scope: {
    charges?: boolean;
    subscriptions?: boolean;
    invoices?: boolean;
    transfers?: boolean;
    financialTransactions?: boolean;
  } = {}
) {
  const account = await requireAsaasAccount(userId);
  const client = getAsaasClient(account);

  const runScope = {
    charges: scope.charges ?? true,
    subscriptions: scope.subscriptions ?? true,
    invoices: scope.invoices ?? true,
    transfers: scope.transfers ?? true,
    financialTransactions: scope.financialTransactions ?? true,
  };

  const result = {
    charges: 0,
    subscriptions: 0,
    invoices: 0,
    transfers: 0,
    financialTransactions: 0,
    currentBalance: null as string | null,
    historicalEventsImported: false,
  };

  if (runScope.subscriptions) {
    const remoteSubscriptions = await listAllPages(params => client.listSubscriptions(params));

    for (const subscription of remoteSubscriptions) {
      const localClient = await asaasDb.getClientByAsaasCustomerId(
        userId,
        String(subscription.customer)
      );
      await asaasDb.upsertAsaasSubscription(
        buildSubscriptionMirror({
          userId,
          accountId: account.id,
          clientId: localClient?.id ?? null,
          serviceId: null,
          subscription,
        })
      );
    }

    result.subscriptions = remoteSubscriptions.length;
    await createImportAuditEvent({
      userId,
      accountId: account.id,
      resourceType: "subscriptions",
      importedCount: remoteSubscriptions.length,
      payload: { scope: "subscriptions", importedCount: remoteSubscriptions.length },
    });
  }

  if (runScope.charges) {
    const remotePayments = await listAllPages(params => client.listPayments(params));

    for (const payment of remotePayments) {
      const localCharge = await asaasDb.getAsaasChargeByExternalId(account.id, String(payment.id));
      const localSubscription =
        payment.subscription != null
          ? await asaasDb.getAsaasSubscriptionByExternalId(account.id, String(payment.subscription))
          : undefined;
      const localClient = await asaasDb.getClientByAsaasCustomerId(userId, String(payment.customer));

      let pix: AsaasPixQrCodeRecord | null = null;
      if (
        String(payment.billingType ?? "").toUpperCase() === "PIX" &&
        !["RECEIVED", "CONFIRMED", "DELETED"].includes(String(payment.status ?? "").toUpperCase())
      ) {
        try {
          pix = await client.getPixQrCode(String(payment.id));
        } catch {
          pix = null;
        }
      }

      await syncPaymentMirror({
        userId,
        accountId: account.id,
        clientId: localCharge?.clientId ?? localSubscription?.clientId ?? localClient?.id ?? null,
        serviceId: localCharge?.serviceId ?? localSubscription?.serviceId ?? null,
        payment,
        pix,
        lastEvent: "IMPORT_PAYMENT",
      });
    }

    result.charges = remotePayments.length;
    await createImportAuditEvent({
      userId,
      accountId: account.id,
      resourceType: "payments",
      importedCount: remotePayments.length,
      payload: { scope: "payments", importedCount: remotePayments.length },
    });
  }

  if (runScope.invoices) {
    const remoteInvoices = await listAllPages(params => client.listInvoices(params));

    for (const invoice of remoteInvoices) {
      const asaasChargeId =
        invoice.payment == null
          ? null
          : typeof invoice.payment === "object"
            ? getNestedString(invoice.payment, ["id"])
            : String(invoice.payment);
      const localCharge =
        asaasChargeId != null
          ? await asaasDb.getAsaasChargeByExternalId(account.id, asaasChargeId)
          : undefined;

      await asaasDb.upsertAsaasInvoice(
        buildInvoiceMirror({
          userId,
          accountId: account.id,
          chargeId: localCharge?.id ?? null,
          revenueId: localCharge?.revenueId ?? null,
          asaasChargeId,
          invoice,
        })
      );
    }

    result.invoices = remoteInvoices.length;
    await createImportAuditEvent({
      userId,
      accountId: account.id,
      resourceType: "invoices",
      importedCount: remoteInvoices.length,
      payload: { scope: "invoices", importedCount: remoteInvoices.length },
    });
  }

  if (runScope.transfers) {
    const remoteTransfers = await listAllPages(params => client.listTransfers(params));

    for (const transfer of remoteTransfers) {
      await asaasDb.upsertAsaasTransfer(
        buildTransferMirror({
          userId,
          accountId: account.id,
          transfer,
        })
      );
    }

    result.transfers = remoteTransfers.length;
    await createImportAuditEvent({
      userId,
      accountId: account.id,
      resourceType: "transfers",
      importedCount: remoteTransfers.length,
      payload: { scope: "transfers", importedCount: remoteTransfers.length },
    });
  }

  if (runScope.financialTransactions) {
    const remoteTransactions = await listAllPages(params => client.listFinancialTransactions(params));

    for (const transaction of remoteTransactions) {
      await asaasDb.upsertAsaasFinancialTransaction(
        buildFinancialTransactionMirror({
          userId,
          accountId: account.id,
          transaction,
        })
      );
    }

    result.financialTransactions = remoteTransactions.length;
    await createImportAuditEvent({
      userId,
      accountId: account.id,
      resourceType: "financial_transactions",
      importedCount: remoteTransactions.length,
      payload: {
        scope: "financialTransactions",
        importedCount: remoteTransactions.length,
      },
    });
  }

  try {
    const balance = await client.getBalance();
    result.currentBalance =
      balance.balance != null ? toDecimalString(normalizeAmount(balance.balance)) : null;
  } catch {
    result.currentBalance = null;
  }

  await asaasDb.markAsaasConnection(
    account.id,
    "conectado",
    "Historico do Asaas importado para o espelho local."
  );

  return result;
}

export async function listAsaasEvents(userId: number) {
  return asaasDb.listAsaasEvents(userId);
}

function getEventFingerprint(payload: AnyRecord) {
  const resource = payload.payment?.id || payload.invoice?.id || payload.subscription?.id || payload.id || "na";
  const base = `${payload.event || "UNKNOWN"}:${resource}:${JSON.stringify(payload)}`;
  return createHash("sha256").update(base).digest("hex");
}

async function processAsaasWebhookPayload(account: NonNullable<Awaited<ReturnType<typeof asaasDb.getAsaasAccountByWebhookToken>>>, payload: AnyRecord) {
  const eventType = String(payload.event || "UNKNOWN");

  if (payload.payment?.id) {
    const localCharge = await asaasDb.getAsaasChargeByExternalId(account.id, String(payload.payment.id));
    const localSubscription =
      payload.payment.subscription != null
        ? await asaasDb.getAsaasSubscriptionByExternalId(account.id, String(payload.payment.subscription))
        : undefined;
    const localClient =
      payload.payment.customer != null
        ? await asaasDb.getClientByAsaasCustomerId(account.userId, String(payload.payment.customer))
        : undefined;
    const mirror = await syncPaymentMirror({
      userId: account.userId,
      accountId: account.id,
      clientId: localCharge?.clientId ?? localSubscription?.clientId ?? localClient?.id ?? null,
      serviceId: localCharge?.serviceId ?? localSubscription?.serviceId ?? null,
      payment: payload.payment,
      pix: null,
      lastEvent: eventType,
    });
    return { kind: "payment", id: mirror.id, eventType };
  }

  if (payload.invoice?.id) {
    const localCharge =
      payload.invoice?.payment
        ? await asaasDb.getAsaasChargeByExternalId(account.id, String(payload.invoice.payment))
        : undefined;
    const mirror = await asaasDb.upsertAsaasInvoice(
      buildInvoiceMirror({
        userId: account.userId,
        accountId: account.id,
        chargeId: localCharge?.id ?? null,
        revenueId: localCharge?.revenueId ?? null,
        asaasChargeId: localCharge?.asaasChargeId ?? null,
        invoice: payload.invoice,
      })
    );
    return { kind: "invoice", id: mirror.id, eventType };
  }

  if (payload.subscription?.id) {
    const localSubscription = await asaasDb.getAsaasSubscriptionByExternalId(
      account.id,
      String(payload.subscription.id)
    );
    const localClient =
      payload.subscription.customer != null
        ? await asaasDb.getClientByAsaasCustomerId(account.userId, String(payload.subscription.customer))
        : undefined;
    const mirror = await asaasDb.upsertAsaasSubscription(
      buildSubscriptionMirror({
        userId: account.userId,
        accountId: account.id,
        clientId: localSubscription?.clientId ?? localClient?.id ?? null,
        serviceId: localSubscription?.serviceId ?? null,
        subscription: payload.subscription,
      })
    );
    return { kind: "subscription", id: mirror.id, eventType };
  }

  return { kind: "ignored", eventType };
}

async function maybeSendAsaasAlert(
  account: NonNullable<Awaited<ReturnType<typeof asaasDb.getAsaasAccountByWebhookToken>>>,
  payload: AnyRecord
) {
  const eventType = String(payload.event || "UNKNOWN");
  if (!["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE", "PAYMENT_DELETED"].includes(eventType)) {
    return;
  }

  const payment = payload.payment;
  if (!payment?.id) return;

  const value = Number(payment.value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const titleMap: Record<string, string> = {
    PAYMENT_RECEIVED: "Cobranca recebida",
    PAYMENT_CONFIRMED: "Cobranca confirmada",
    PAYMENT_OVERDUE: "Cobranca vencida",
    PAYMENT_DELETED: "Cobranca cancelada",
  };

  const { sendImmediateFinancialAlert } = await import("./whatsapp");
  await sendImmediateFinancialAlert({
    userId: account.userId,
    title: titleMap[eventType] || "Atualizacao de cobranca",
    message: `Pagamento ${payment.id} no valor de ${value}. Evento recebido: ${eventType}.`,
    type: `asaas_${eventType.toLowerCase()}`,
    dedupeKey: `asaas-alert:${eventType}:${payment.id}`,
  }).catch(() => null);
}

export async function handleAsaasWebhook(authToken: string | undefined, payload: AnyRecord) {
  if (!authToken) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Webhook do Asaas sem token." });
  }

  const account = await asaasDb.getAsaasAccountByWebhookToken(authToken);
  if (!account) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Token do webhook Asaas invalido." });
  }

  const fingerprint = getEventFingerprint(payload);
  const existing = await asaasDb.findAsaasEventByFingerprint(fingerprint);
  if (existing) {
    if (existing.processed) {
      return { duplicate: true, eventId: existing.id };
    }

    try {
      const result = await processAsaasWebhookPayload(account, payload);
      await maybeSendAsaasAlert(account, payload);
      await asaasDb.updateAsaasWebhookEvent(existing.id, {
        processed: true,
        duplicate: false,
        processedAt: new Date(),
        lastError: null,
      });
      return { duplicate: false, retried: true, eventId: existing.id, result };
    } catch (error) {
      await asaasDb.updateAsaasWebhookEvent(existing.id, {
        processed: false,
        processedAt: new Date(),
        lastError: error instanceof Error ? error.message : "Erro ao processar evento",
      });
      throw error;
    }
  }

  const event = await asaasDb.createAsaasWebhookEvent({
    userId: account.userId,
    accountId: account.id,
    eventFingerprint: fingerprint,
    eventType: String(payload.event || "UNKNOWN"),
    resourceType: payload.payment ? "payment" : payload.invoice ? "invoice" : payload.subscription ? "subscription" : "generic",
    resourceId:
      payload.payment?.id
        ? String(payload.payment.id)
        : payload.invoice?.id
          ? String(payload.invoice.id)
          : payload.subscription?.id
            ? String(payload.subscription.id)
          : null,
    duplicate: false,
    processed: false,
    lastError: null,
    payload: JSON.stringify(payload),
    processedAt: null,
  });

  try {
    const result = await processAsaasWebhookPayload(account, payload);
    await maybeSendAsaasAlert(account, payload);
    await asaasDb.updateAsaasWebhookEvent(event.id, {
      processed: true,
      processedAt: new Date(),
      lastError: null,
    });
    return { duplicate: false, eventId: event.id, result };
  } catch (error) {
    await asaasDb.updateAsaasWebhookEvent(event.id, {
      processed: false,
      processedAt: new Date(),
      lastError: error instanceof Error ? error.message : "Erro ao processar evento",
    });
    throw error;
  }
}

export async function reprocessAsaasEvent(userId: number, eventId: number) {
  const event = await asaasDb.getAsaasEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Evento nao encontrado." });
  }
  const account = await asaasDb.getAsaasAccount(userId);
  if (!account) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Conta Asaas nao configurada." });
  }
  const payload = JSON.parse(event.payload);
  const result = await processAsaasWebhookPayload(account, payload);
  await maybeSendAsaasAlert(account, payload);
  await asaasDb.updateAsaasWebhookEvent(event.id, {
    processed: true,
    processedAt: new Date(),
    lastError: null,
  });
  return result;
}
