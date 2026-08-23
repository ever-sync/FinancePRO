import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  bigint,
  numeric,
  boolean,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ==================== ENUMS ====================
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const revenueStatusEnum = pgEnum("revenue_status", [
  "pendente",
  "recebido",
  "atrasado",
  "cancelado",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pago",
  "pendente",
  "atrasado",
]);
export const employeeStatusEnum = pgEnum("employee_status", [
  "ativo",
  "inativo",
]);
export const contractTypeEnum = pgEnum("contract_type", ["clt", "pj"]);
export const debtStatusEnum = pgEnum("debt_status", [
  "ativa",
  "atrasada",
  "quitada",
  "renegociada",
]);
export const debtPriorityEnum = pgEnum("debt_priority", [
  "alta",
  "media",
  "baixa",
]);
export const fundTypeEnum = pgEnum("fund_type", ["empresa", "pessoal"]);
export const asaasEnvironmentEnum = pgEnum("asaas_environment", [
  "sandbox",
  "production",
]);
export const asaasSyncStatusEnum = pgEnum("asaas_sync_status", [
  "pendente",
  "sincronizado",
  "erro",
]);
export const whatsappProviderEnum = pgEnum("whatsapp_provider", [
  "uazapi",
  "baileys",
]);
export const whatsappDirectionEnum = pgEnum("whatsapp_direction", [
  "inbound",
  "outbound",
]);
export const whatsappMessageStatusEnum = pgEnum("whatsapp_message_status", [
  "received",
  "processed",
  "sent",
  "delivered",
  "failed",
  "ignored",
]);
export const assistantRunStatusEnum = pgEnum("assistant_run_status", [
  "recebido",
  "analisado",
  "aguardando_confirmacao",
  "executado",
  "falhou",
  "descartado",
]);
export const assistantRunTriggerEnum = pgEnum("assistant_run_trigger", [
  "direct_message",
  "daily_digest",
  "month_start",
  "month_end",
  "alert",
  "confirmation",
]);
export const financialPlanStatusEnum = pgEnum("financial_plan_status", [
  "rascunho",
  "ativo",
  "fechado",
  "descartado",
]);
export const financialPlanActionStatusEnum = pgEnum(
  "financial_plan_action_status",
  ["pendente", "concluida", "adiada", "descartada"]
);
export const notificationEventStatusEnum = pgEnum("notification_event_status", [
  "agendado",
  "enviado",
  "falhou",
  "adiado",
  "descartado",
]);
export const agentCommandStatusEnum = pgEnum("agent_command_status", [
  "pending",
  "executing",
  "executed",
  "cancelled",
  "expired",
  "failed",
]);

// ==================== TENANTS ====================
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ==================== USERS ====================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ==================== CONFIGURAÇÕES ====================
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  taxPercent: numeric("taxPercent", { precision: 5, scale: 2 })
    .default("6.00")
    .notNull(),
  tithePercent: numeric("tithePercent", { precision: 5, scale: 2 })
    .default("10.00")
    .notNull(),
  investmentPercent: numeric("investmentPercent", { precision: 5, scale: 2 })
    .default("10.00")
    .notNull(),
  proLaboreGross: numeric("proLaboreGross", { precision: 12, scale: 2 })
    .default("0.00")
    .notNull(),
  companyReserveMonths: integer("companyReserveMonths").default(3).notNull(),
  personalReserveMonths: integer("personalReserveMonths").default(6).notNull(),
  companyMinCashMonths: numeric("companyMinCashMonths", {
    precision: 6,
    scale: 2,
  })
    .default("1.00")
    .notNull(),
  personalMinCashMonths: numeric("personalMinCashMonths", {
    precision: 6,
    scale: 2,
  })
    .default("1.00")
    .notNull(),
  companyName: varchar("companyName", { length: 255 }).default("Minha Empresa"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;

// ==================== INTEGRACOES BANCARIAS ====================
export const bankConnections = pgTable("bank_connections", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  institution: varchar("institution", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 40 })
    .default("open_finance")
    .notNull(),
  sourceKind: varchar("sourceKind", { length: 30 })
    .default("bank_account")
    .notNull(),
  scope: varchar("scope", { length: 20 }).default("misto").notNull(),
  syncMode: varchar("syncMode", { length: 20 }).default("file").notNull(),
  status: varchar("status", { length: 20 }).default("rascunho").notNull(),
  notes: text("notes"),
  lastImportedAt: timestamp("lastImportedAt"),
  lastSyncRequestedAt: timestamp("lastSyncRequestedAt"),
  lastSyncStatus: varchar("lastSyncStatus", { length: 40 }),
  lastSyncError: text("lastSyncError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type BankConnection = typeof bankConnections.$inferSelect;
export type InsertBankConnection = typeof bankConnections.$inferInsert;

// ==================== RECEITAS (EMPRESA) ====================
export const revenues = pgTable("revenues", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  grossAmount: numeric("grossAmount", { precision: 12, scale: 2 }).notNull(),
  taxAmount: numeric("taxAmount", { precision: 12, scale: 2 }).notNull(),
  netAmount: numeric("netAmount", { precision: 12, scale: 2 }).notNull(),
  client: varchar("client", { length: 255 }),
  dueDate: varchar("dueDate", { length: 10 }).notNull(),
  receivedDate: varchar("receivedDate", { length: 10 }),
  status: revenueStatusEnum("status").default("pendente").notNull(),
  seriesId: varchar("seriesId", { length: 64 }),
  asaasPaymentId: varchar("asaasPaymentId", { length: 64 }),
  asaasSubscriptionId: varchar("asaasSubscriptionId", { length: 64 }),
  asaasBillingType: varchar("asaasBillingType", { length: 30 }),
  asaasInvoiceUrl: varchar("asaasInvoiceUrl", { length: 500 }),
  asaasBankSlipUrl: varchar("asaasBankSlipUrl", { length: 500 }),
  asaasLastEvent: varchar("asaasLastEvent", { length: 120 }),
  asaasExternalReference: varchar("asaasExternalReference", { length: 120 }),
  asaasSyncedAt: timestamp("asaasSyncedAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Revenue = typeof revenues.$inferSelect;
export type InsertRevenue = typeof revenues.$inferInsert;

// ==================== CUSTOS FIXOS EMPRESA ====================
export const companyFixedCosts = pgTable("company_fixed_costs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  dueDay: integer("dueDay").notNull(),
  dueDate: varchar("dueDate", { length: 10 }),
  status: paymentStatusEnum("status").default("pendente").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type CompanyFixedCost = typeof companyFixedCosts.$inferSelect;
export type InsertCompanyFixedCost = typeof companyFixedCosts.$inferInsert;

// ==================== CUSTOS VARIÁVEIS EMPRESA ====================
export const companyVariableCosts = pgTable("company_variable_costs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  supplier: varchar("supplier", { length: 255 }),
  installmentSeriesId: varchar("installmentSeriesId", { length: 64 }),
  installmentCount: integer("installmentCount").default(1).notNull(),
  installmentNumber: integer("installmentNumber").default(1).notNull(),
  status: paymentStatusEnum("status").default("pendente").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type CompanyVariableCost = typeof companyVariableCosts.$inferSelect;
export type InsertCompanyVariableCost =
  typeof companyVariableCosts.$inferInsert;

// ==================== FUNCIONÁRIOS ====================
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("empRole", { length: 255 }).notNull(),
  contractType: contractTypeEnum("contractType").default("clt").notNull(),
  salary: numeric("salary", { precision: 12, scale: 2 }).notNull(),
  fgtsAmount: numeric("fgtsAmount", { precision: 12, scale: 2 }).notNull(),
  thirteenthProvision: numeric("thirteenthProvision", {
    precision: 12,
    scale: 2,
  }).notNull(),
  vacationProvision: numeric("vacationProvision", {
    precision: 12,
    scale: 2,
  }).notNull(),
  totalCost: numeric("totalCost", { precision: 12, scale: 2 }).notNull(),
  paymentDay: integer("paymentDay").default(5).notNull(),
  admissionDate: varchar("admissionDate", { length: 10 }),
  status: employeeStatusEnum("empStatus").default("ativo").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

// ==================== FORNECEDORES ====================
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }),
  category: varchar("category", { length: 100 }),
  contact: varchar("contact", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ==================== COMPRAS DE FORNECEDORES ====================
export const supplierPurchases = pgTable("supplier_purchases", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  supplierId: integer("supplierId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  dueDate: varchar("dueDate", { length: 10 }).notNull(),
  paidDate: varchar("paidDate", { length: 10 }),
  status: paymentStatusEnum("status").default("pendente").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 100 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type SupplierPurchase = typeof supplierPurchases.$inferSelect;
export type InsertSupplierPurchase = typeof supplierPurchases.$inferInsert;

// ==================== CONTAS FIXAS PESSOAIS ====================
export const personalFixedCosts = pgTable("personal_fixed_costs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  dueDay: integer("dueDay").notNull(),
  dueDate: varchar("dueDate", { length: 10 }),
  status: paymentStatusEnum("status").default("pendente").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type PersonalFixedCost = typeof personalFixedCosts.$inferSelect;
export type InsertPersonalFixedCost = typeof personalFixedCosts.$inferInsert;

// ==================== CONTAS VARIÁVEIS PESSOAIS ====================
export const personalVariableCosts = pgTable("personal_variable_costs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  installmentSeriesId: varchar("installmentSeriesId", { length: 64 }),
  installmentCount: integer("installmentCount").default(1).notNull(),
  installmentNumber: integer("installmentNumber").default(1).notNull(),
  status: paymentStatusEnum("status").default("pendente").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type PersonalVariableCost = typeof personalVariableCosts.$inferSelect;
export type InsertPersonalVariableCost =
  typeof personalVariableCosts.$inferInsert;

// ==================== DÍVIDAS PESSOAIS ====================
export const debts = pgTable("debts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  creditor: varchar("creditor", { length: 255 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  originalAmount: numeric("originalAmount", {
    precision: 12,
    scale: 2,
  }).notNull(),
  currentBalance: numeric("currentBalance", {
    precision: 12,
    scale: 2,
  }).notNull(),
  monthlyPayment: numeric("monthlyPayment", {
    precision: 12,
    scale: 2,
  }).notNull(),
  interestRate: numeric("interestRate", { precision: 5, scale: 2 })
    .default("0.00")
    .notNull(),
  totalInstallments: integer("totalInstallments").notNull(),
  paidInstallments: integer("paidInstallments").default(0).notNull(),
  dueDay: integer("dueDay").notNull(),
  status: debtStatusEnum("debtStatus").default("ativa").notNull(),
  priority: debtPriorityEnum("priority").default("media").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Debt = typeof debts.$inferSelect;
export type InsertDebt = typeof debts.$inferInsert;

// ==================== INVESTIMENTOS PESSOAIS ====================
export const investments = pgTable("investments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  institution: varchar("institution", { length: 255 }).notNull(),
  type: varchar("investType", { length: 100 }).notNull(),
  depositAmount: numeric("depositAmount", {
    precision: 12,
    scale: 2,
  }).notNull(),
  currentBalance: numeric("currentBalance", { precision: 12, scale: 2 })
    .default("0.00")
    .notNull(),
  yieldAmount: numeric("yieldAmount", { precision: 12, scale: 2 })
    .default("0.00")
    .notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Investment = typeof investments.$inferSelect;
export type InsertInvestment = typeof investments.$inferInsert;

// ==================== CLIENTES ====================
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  document: varchar("document", { length: 20 }),
  category: varchar("category", { length: 100 }),
  contact: varchar("contact", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: varchar("address", { length: 500 }),
  asaasCustomerId: varchar("asaasCustomerId", { length: 64 }),
  asaasSyncStatus: asaasSyncStatusEnum("asaasSyncStatus")
    .default("pendente")
    .notNull(),
  asaasLastSyncError: text("asaasLastSyncError"),
  asaasLastSyncedAt: timestamp("asaasLastSyncedAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

// ==================== SERVIÇOS ====================
export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  basePrice: numeric("basePrice", { precision: 12, scale: 2 }).notNull(),
  unit: varchar("unit", { length: 50 }).default("projeto").notNull(),
  recurrence: varchar("recurrence", { length: 20 }).default("unico").notNull(),
  status: varchar("status", { length: 20 }).default("ativo").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Service = typeof services.$inferSelect;
export type InsertService = typeof services.$inferInsert;

// ==================== LEGACY ASAAS DATA (INACTIVE) ====================
// Retained only so existing databases and migration history remain compatible.
// Runtime routes, webhooks and external API calls were removed.
export const asaasAccounts = pgTable("asaas_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  scopeKey: varchar("scopeKey", { length: 100 }).default("default").notNull(),
  accountName: varchar("accountName", { length: 255 })
    .default("Conta principal")
    .notNull(),
  environment: asaasEnvironmentEnum("environment").default("sandbox").notNull(),
  apiKey: text("apiKey").notNull(),
  apiBaseUrl: varchar("apiBaseUrl", { length: 255 }),
  webhookAuthToken: varchar("webhookAuthToken", { length: 255 }),
  webhookUrl: varchar("webhookUrl", { length: 500 }),
  enabled: boolean("enabled").default(true).notNull(),
  lastConnectionStatus: varchar("lastConnectionStatus", { length: 40 })
    .default("pendente")
    .notNull(),
  lastConnectionMessage: text("lastConnectionMessage"),
  lastConnectionCheckedAt: timestamp("lastConnectionCheckedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AsaasAccount = typeof asaasAccounts.$inferSelect;
export type InsertAsaasAccount = typeof asaasAccounts.$inferInsert;

// ==================== ASAAS CHARGES ====================
export const asaasCharges = pgTable("asaas_charges", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  accountId: integer("accountId").notNull(),
  clientId: integer("clientId"),
  serviceId: integer("serviceId"),
  revenueId: integer("revenueId"),
  asaasChargeId: varchar("asaasChargeId", { length: 64 }).notNull(),
  asaasCustomerId: varchar("asaasCustomerId", { length: 64 }).notNull(),
  asaasSubscriptionId: varchar("asaasSubscriptionId", { length: 64 }),
  status: varchar("status", { length: 60 }).default("PENDING").notNull(),
  billingType: varchar("billingType", { length: 30 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  dueDate: varchar("dueDate", { length: 10 }).notNull(),
  externalReference: varchar("externalReference", { length: 120 }),
  invoiceUrl: varchar("invoiceUrl", { length: 500 }),
  bankSlipUrl: varchar("bankSlipUrl", { length: 500 }),
  pixQrCodeUrl: text("pixQrCodeUrl"),
  pixCopyAndPaste: text("pixCopyAndPaste"),
  lastEvent: varchar("lastEvent", { length: 120 }),
  lastSyncedAt: timestamp("lastSyncedAt"),
  deletedAt: timestamp("deletedAt"),
  rawPayload: text("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AsaasCharge = typeof asaasCharges.$inferSelect;
export type InsertAsaasCharge = typeof asaasCharges.$inferInsert;

// ==================== ASAAS SUBSCRIPTIONS ====================
export const asaasSubscriptions = pgTable("asaas_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  accountId: integer("accountId").notNull(),
  clientId: integer("clientId"),
  serviceId: integer("serviceId"),
  asaasSubscriptionId: varchar("asaasSubscriptionId", { length: 64 }).notNull(),
  asaasCustomerId: varchar("asaasCustomerId", { length: 64 }).notNull(),
  status: varchar("status", { length: 60 }).default("ACTIVE").notNull(),
  billingType: varchar("billingType", { length: 30 }).notNull(),
  cycle: varchar("cycle", { length: 30 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  nextDueDate: varchar("nextDueDate", { length: 10 }).notNull(),
  externalReference: varchar("externalReference", { length: 120 }),
  deletedAt: timestamp("deletedAt"),
  lastSyncedAt: timestamp("lastSyncedAt"),
  rawPayload: text("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AsaasSubscription = typeof asaasSubscriptions.$inferSelect;
export type InsertAsaasSubscription = typeof asaasSubscriptions.$inferInsert;

// ==================== ASAAS INVOICES ====================
export const asaasInvoices = pgTable("asaas_invoices", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  accountId: integer("accountId").notNull(),
  chargeId: integer("chargeId"),
  revenueId: integer("revenueId"),
  asaasChargeId: varchar("asaasChargeId", { length: 64 }),
  asaasInvoiceId: varchar("asaasInvoiceId", { length: 64 }).notNull(),
  status: varchar("status", { length: 60 }).default("SCHEDULED").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }),
  effectiveDate: varchar("effectiveDate", { length: 10 }),
  invoiceNumber: varchar("invoiceNumber", { length: 80 }),
  serviceDescription: text("serviceDescription"),
  pdfUrl: varchar("pdfUrl", { length: 500 }),
  xmlUrl: varchar("xmlUrl", { length: 500 }),
  validationCode: varchar("validationCode", { length: 120 }),
  lastError: text("lastError"),
  authorizedAt: timestamp("authorizedAt"),
  cancelledAt: timestamp("cancelledAt"),
  lastSyncedAt: timestamp("lastSyncedAt"),
  rawPayload: text("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AsaasInvoice = typeof asaasInvoices.$inferSelect;
export type InsertAsaasInvoice = typeof asaasInvoices.$inferInsert;

// ==================== ASAAS TRANSFERS ====================
export const asaasTransfers = pgTable("asaas_transfers", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  accountId: integer("accountId").notNull(),
  asaasTransferId: varchar("asaasTransferId", { length: 64 }).notNull(),
  status: varchar("status", { length: 60 }).default("PENDING").notNull(),
  transferType: varchar("transferType", { length: 60 }),
  operationType: varchar("operationType", { length: 60 }),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  netValue: numeric("netValue", { precision: 12, scale: 2 }),
  transferDate: varchar("transferDate", { length: 10 }),
  scheduledDate: varchar("scheduledDate", { length: 10 }),
  effectiveDate: varchar("effectiveDate", { length: 10 }),
  bankName: varchar("bankName", { length: 255 }),
  recipientName: varchar("recipientName", { length: 255 }),
  externalReference: varchar("externalReference", { length: 120 }),
  lastSyncedAt: timestamp("lastSyncedAt"),
  cancelledAt: timestamp("cancelledAt"),
  rawPayload: text("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AsaasTransfer = typeof asaasTransfers.$inferSelect;
export type InsertAsaasTransfer = typeof asaasTransfers.$inferInsert;

// ==================== ASAAS FINANCIAL TRANSACTIONS ====================
export const asaasFinancialTransactions = pgTable(
  "asaas_financial_transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    accountId: integer("accountId").notNull(),
    asaasTransactionId: varchar("asaasTransactionId", {
      length: 120,
    }).notNull(),
    transactionType: varchar("transactionType", { length: 60 }),
    entryType: varchar("entryType", { length: 60 }),
    status: varchar("status", { length: 60 }),
    description: text("description"),
    value: numeric("value", { precision: 12, scale: 2 }).notNull(),
    balance: numeric("balance", { precision: 12, scale: 2 }),
    transactionDate: varchar("transactionDate", { length: 10 }),
    effectiveDate: varchar("effectiveDate", { length: 10 }),
    asaasChargeId: varchar("asaasChargeId", { length: 64 }),
    asaasTransferId: varchar("asaasTransferId", { length: 64 }),
    asaasInvoiceId: varchar("asaasInvoiceId", { length: 64 }),
    lastSyncedAt: timestamp("lastSyncedAt"),
    rawPayload: text("rawPayload"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }
);

export type AsaasFinancialTransaction =
  typeof asaasFinancialTransactions.$inferSelect;
export type InsertAsaasFinancialTransaction =
  typeof asaasFinancialTransactions.$inferInsert;

// ==================== ASAAS WEBHOOK EVENTS ====================
export const asaasWebhookEvents = pgTable("asaas_webhook_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  accountId: integer("accountId"),
  eventFingerprint: varchar("eventFingerprint", { length: 255 }).notNull(),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  resourceType: varchar("resourceType", { length: 60 }),
  resourceId: varchar("resourceId", { length: 64 }),
  duplicate: boolean("duplicate").default(false).notNull(),
  processed: boolean("processed").default(false).notNull(),
  lastError: text("lastError"),
  payload: text("payload").notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AsaasWebhookEvent = typeof asaasWebhookEvents.$inferSelect;
export type InsertAsaasWebhookEvent = typeof asaasWebhookEvents.$inferInsert;

// ==================== WHATSAPP INTEGRATIONS ====================
export const whatsappIntegrations = pgTable("whatsapp_integrations", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  provider: whatsappProviderEnum("provider").default("uazapi").notNull(),
  instanceId: varchar("instanceId", { length: 120 }).notNull(),
  apiBaseUrl: varchar("apiBaseUrl", { length: 255 }).notNull(),
  apiToken: text("apiToken").notNull(),
  authorizedPhone: varchar("authorizedPhone", { length: 32 }).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  automationHour: integer("automationHour").default(8).notNull(),
  timezone: varchar("timezone", { length: 80 })
    .default("America/Sao_Paulo")
    .notNull(),
  webhookUrl: varchar("webhookUrl", { length: 500 }),
  lastConnectionStatus: varchar("lastConnectionStatus", { length: 40 })
    .default("pendente")
    .notNull(),
  lastConnectionMessage: text("lastConnectionMessage"),
  lastConnectionCheckedAt: timestamp("lastConnectionCheckedAt"),
  lastWebhookReceivedAt: timestamp("lastWebhookReceivedAt"),
  lastMessageReceivedAt: timestamp("lastMessageReceivedAt"),
  lastMessageSentAt: timestamp("lastMessageSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type WhatsAppIntegration = typeof whatsappIntegrations.$inferSelect;
export type InsertWhatsAppIntegration =
  typeof whatsappIntegrations.$inferInsert;

// ==================== WHATSAPP CONTACTS ====================
export const whatsappContacts = pgTable("whatsapp_contacts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  integrationId: integer("integrationId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 32 }).notNull(),
  displayName: varchar("displayName", { length: 255 }),
  isAuthorized: boolean("isAuthorized").default(false).notNull(),
  lastSeenAt: timestamp("lastSeenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type WhatsAppContact = typeof whatsappContacts.$inferSelect;
export type InsertWhatsAppContact = typeof whatsappContacts.$inferInsert;

// ==================== ASSISTANT THREADS ====================
export const assistantThreads = pgTable("assistant_threads", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  integrationId: integer("integrationId").notNull(),
  contactId: integer("contactId").notNull(),
  channel: varchar("channel", { length: 40 }).default("whatsapp").notNull(),
  status: varchar("status", { length: 40 }).default("active").notNull(),
  lastMessageAt: timestamp("lastMessageAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AssistantThread = typeof assistantThreads.$inferSelect;
export type InsertAssistantThread = typeof assistantThreads.$inferInsert;

// ==================== WHATSAPP MESSAGES ====================
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    integrationId: integer("integrationId").notNull(),
    contactId: integer("contactId").notNull(),
    threadId: integer("threadId").notNull(),
    providerMessageId: varchar("providerMessageId", { length: 255 }),
    direction: whatsappDirectionEnum("direction").notNull(),
    status: whatsappMessageStatusEnum("status").default("received").notNull(),
    textContent: text("textContent").notNull(),
    detectedIntent: varchar("detectedIntent", { length: 80 }),
    requiresConfirmation: boolean("requiresConfirmation")
      .default(false)
      .notNull(),
    rawPayload: text("rawPayload"),
    deliveredAt: timestamp("deliveredAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("whatsapp_messages_provider_direction_idx").on(
      table.integrationId,
      table.providerMessageId,
      table.direction
    ),
  ]
);

export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;
export type InsertWhatsAppMessage = typeof whatsappMessages.$inferInsert;

// ==================== ASSISTANT RUNS ====================
export const assistantRuns = pgTable("assistant_runs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  integrationId: integer("integrationId").notNull(),
  threadId: integer("threadId").notNull(),
  triggerType: assistantRunTriggerEnum("triggerType").notNull(),
  status: assistantRunStatusEnum("status").default("recebido").notNull(),
  userMessage: text("userMessage"),
  normalizedIntent: varchar("normalizedIntent", { length: 80 }),
  contextPayload: text("contextPayload"),
  assistantResponse: text("assistantResponse"),
  suggestedActions: text("suggestedActions"),
  executedActions: text("executedActions"),
  requiresConfirmation: boolean("requiresConfirmation")
    .default(false)
    .notNull(),
  confirmedAt: timestamp("confirmedAt"),
  expiresAt: timestamp("expiresAt"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type AssistantRun = typeof assistantRuns.$inferSelect;
export type InsertAssistantRun = typeof assistantRuns.$inferInsert;

// ==================== FINANCIAL PLANS ====================
export const financialPlans = pgTable("financial_plans", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  threadId: integer("threadId"),
  periodMonth: integer("periodMonth").notNull(),
  periodYear: integer("periodYear").notNull(),
  status: financialPlanStatusEnum("status").default("rascunho").notNull(),
  summary: text("summary").notNull(),
  targetBalance: numeric("targetBalance", { precision: 12, scale: 2 }),
  recommendedCashAction: text("recommendedCashAction"),
  rawAnalysis: text("rawAnalysis"),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type FinancialPlan = typeof financialPlans.$inferSelect;
export type InsertFinancialPlan = typeof financialPlans.$inferInsert;

// ==================== FINANCIAL PLAN ACTIONS ====================
export const financialPlanActions = pgTable("financial_plan_actions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  planId: integer("planId").notNull(),
  actionType: varchar("actionType", { length: 80 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  priority: varchar("priority", { length: 20 }).default("medium").notNull(),
  status: financialPlanActionStatusEnum("status").default("pendente").notNull(),
  dueDate: varchar("dueDate", { length: 10 }),
  snoozedUntil: timestamp("snoozedUntil"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type FinancialPlanAction = typeof financialPlanActions.$inferSelect;
export type InsertFinancialPlanAction =
  typeof financialPlanActions.$inferInsert;

// ==================== NOTIFICATION EVENTS ====================
export const notificationEvents = pgTable("notification_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  integrationId: integer("integrationId").notNull(),
  relatedRunId: integer("relatedRunId"),
  relatedPlanId: integer("relatedPlanId"),
  relatedMessageId: integer("relatedMessageId"),
  type: varchar("type", { length: 80 }).notNull(),
  scope: varchar("scope", { length: 80 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  messageBody: text("messageBody").notNull(),
  dedupeKey: varchar("dedupeKey", { length: 160 }).notNull(),
  status: notificationEventStatusEnum("status").default("agendado").notNull(),
  scheduledFor: timestamp("scheduledFor"),
  sentAt: timestamp("sentAt"),
  snoozedUntil: timestamp("snoozedUntil"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type InsertNotificationEvent = typeof notificationEvents.$inferInsert;

// ==================== FINANCIAL ADVISOR SNAPSHOTS ====================
export const financialAdvisorSnapshots = pgTable(
  "financial_advisor_snapshots",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    integrationId: integer("integrationId"),
    relatedPlanId: integer("relatedPlanId"),
    snapshotType: varchar("snapshotType", { length: 40 }).notNull(),
    referenceDate: varchar("referenceDate", { length: 10 }).notNull(),
    periodMonth: integer("periodMonth").notNull(),
    periodYear: integer("periodYear").notNull(),
    status: varchar("status", { length: 40 }).default("generated").notNull(),
    cashRiskLevel: varchar("cashRiskLevel", { length: 20 }).notNull(),
    summary: text("summary").notNull(),
    confidenceScore: numeric("confidenceScore", { precision: 4, scale: 2 })
      .default("1.00")
      .notNull(),
    snapshotPayload: text("snapshotPayload").notNull(),
    recommendationsPayload: text("recommendationsPayload"),
    confirmedAt: timestamp("confirmedAt"),
    executedAt: timestamp("executedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }
);

export type FinancialAdvisorSnapshot =
  typeof financialAdvisorSnapshots.$inferSelect;
export type InsertFinancialAdvisorSnapshot =
  typeof financialAdvisorSnapshots.$inferInsert;

// ==================== N8N AGENT COMMANDS ====================
// Every model-requested mutation is staged here and can only be executed after
// the authorized WhatsApp user repeats the one-time confirmation code.
export const agentCommands = pgTable(
  "agent_commands",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    integrationId: integer("integrationId").notNull(),
    threadId: integer("threadId"),
    requestId: varchar("requestId", { length: 160 }).notNull(),
    operation: varchar("operation", { length: 20 }).notNull(),
    entityType: varchar("entityType", { length: 40 }).notNull(),
    entityId: integer("entityId"),
    payload: text("payload").notNull(),
    summary: text("summary").notNull(),
    confirmationCodeHash: varchar("confirmationCodeHash", {
      length: 64,
    }).notNull(),
    status: agentCommandStatusEnum("status").default("pending").notNull(),
    resultPayload: text("resultPayload"),
    expiresAt: timestamp("expiresAt").notNull(),
    confirmedAt: timestamp("confirmedAt"),
    executedAt: timestamp("executedAt"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("agent_commands_user_request_idx").on(
      table.userId,
      table.requestId
    ),
    index("agent_commands_pending_idx").on(
      table.integrationId,
      table.status,
      table.expiresAt
    ),
  ]
);

export type AgentCommand = typeof agentCommands.$inferSelect;
export type InsertAgentCommand = typeof agentCommands.$inferInsert;

// ==================== FUNDO DE RESERVA ====================
export const reserveFunds = pgTable("reserve_funds", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  type: fundTypeEnum("fundType").notNull(),
  depositAmount: numeric("depositAmount", {
    precision: 12,
    scale: 2,
  }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  description: varchar("description", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type ReserveFund = typeof reserveFunds.$inferSelect;
export type InsertReserveFund = typeof reserveFunds.$inferInsert;

// ==================== CANONICAL FINANCIAL CORE ====================
// All new financial behavior uses these tenant-scoped, integer-cent tables.
// Legacy decimal tables above remain available while their screens are migrated.

export const financialProfiles = pgTable(
  "financial_profiles",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileKey: varchar("profileKey", { length: 80 })
      .default("custom")
      .notNull(),
    planVersion: varchar("planVersion", { length: 24 })
      .default("1.0.0")
      .notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    locale: varchar("locale", { length: 16 }).default("pt-BR").notNull(),
    currency: varchar("currency", { length: 3 }).default("BRL").notNull(),
    timezone: varchar("timezone", { length: 80 })
      .default("America/Sao_Paulo")
      .notNull(),
    planningHorizon: date("planningHorizon"),
    lifePlanningEnabled: boolean("lifePlanningEnabled")
      .default(false)
      .notNull(),
    currentPhase: varchar("currentPhase", { length: 40 })
      .default("CLEANUP")
      .notNull(),
    monthlyIncomeTargetCents: bigint("monthlyIncomeTargetCents", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    income2027Confirmed: boolean("income2027Confirmed")
      .default(false)
      .notNull(),
    businessDayMode: varchar("businessDayMode", { length: 32 })
      .default("banking")
      .notNull(),
    day30Adjustment: varchar("day30Adjustment", { length: 32 })
      .default("no_adjustment")
      .notNull(),
    tone: varchar("tone", { length: 160 })
      .default("objetivo, humano e firme")
      .notNull(),
    riskPreference: varchar("riskPreference", { length: 160 })
      .default("baixo risco e alta liquidez")
      .notNull(),
    operatingBufferCents: bigint("operatingBufferCents", { mode: "number" })
      .default(0)
      .notNull(),
    monthlyVariableBudgetCents: bigint("monthlyVariableBudgetCents", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    emergencyFundReferenceCents: bigint("emergencyFundReferenceCents", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    emergencyFundTargetMonths: integer("emergencyFundTargetMonths")
      .default(6)
      .notNull(),
    projectTaxBasisPoints: integer("projectTaxBasisPoints")
      .default(1500)
      .notNull(),
    projectCostBasisPoints: integer("projectCostBasisPoints")
      .default(1000)
      .notNull(),
    projectGoalBasisPoints: integer("projectGoalBasisPoints")
      .default(7500)
      .notNull(),
    carMonthlyLimitCents: bigint("carMonthlyLimitCents", { mode: "number" })
      .default(0)
      .notNull(),
    carInstallmentLimitCents: bigint("carInstallmentLimitCents", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    quietHoursStart: varchar("quietHoursStart", { length: 5 })
      .default("21:00")
      .notNull(),
    quietHoursEnd: varchar("quietHoursEnd", { length: 5 })
      .default("08:00")
      .notNull(),
    notificationsOptIn: boolean("notificationsOptIn").default(true).notNull(),
    notificationsPausedUntil: timestamp("notificationsPausedUntil", {
      withTimezone: true,
    }),
    onboardingState: jsonb("onboardingState"),
    configVersion: integer("configVersion").default(1).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_profiles_tenant_user_idx").on(
      table.tenantId,
      table.userId
    ),
  ]
);

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 120 }),
    ownerType: varchar("ownerType", { length: 24 }).notNull(),
    accountType: varchar("accountType", { length: 32 }).notNull(),
    institution: varchar("institution", { length: 255 }),
    currency: varchar("currency", { length: 3 }).default("BRL").notNull(),
    currentBalanceCents: bigint("currentBalanceCents", { mode: "number" })
      .default(0)
      .notNull(),
    balanceAsOf: timestamp("balanceAsOf", { withTimezone: true }),
    includeInOperatingCash: boolean("includeInOperatingCash")
      .default(true)
      .notNull(),
    protected: boolean("protected").default(false).notNull(),
    needsConfirmation: boolean("needsConfirmation").default(false).notNull(),
    closingDay: integer("closingDay"),
    dueDay: integer("dueDay"),
    creditLimitCents: bigint("creditLimitCents", { mode: "number" }),
    paymentAccountId: integer("paymentAccountId"),
    active: boolean("active").default(true).notNull(),
    seedKey: varchar("seedKey", { length: 120 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_accounts_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    uniqueIndex("financial_accounts_tenant_code_idx").on(
      table.tenantId,
      table.userId,
      table.code
    ),
    index("financial_accounts_owner_idx").on(
      table.tenantId,
      table.userId,
      table.ownerType,
      table.active
    ),
  ]
);

export const financialCategories = pgTable(
  "financial_categories",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    group: varchar("group", { length: 40 }).notNull(),
    ownerType: varchar("ownerType", { length: 24 }).notNull(),
    essential: boolean("essential").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_categories_tenant_key_idx").on(
      table.tenantId,
      table.userId,
      table.key
    ),
  ]
);

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: integer("accountId")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "restrict" }),
    transferPairId: integer("transferPairId"),
    reversalOfId: integer("reversalOfId"),
    type: varchar("type", { length: 24 }).notNull(),
    transferDirection: varchar("transferDirection", { length: 16 }),
    status: varchar("status", { length: 24 }).notNull(),
    amountCents: bigint("amountCents", { mode: "number" }).notNull(),
    occurredAt: timestamp("occurredAt", { withTimezone: true }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    normalizedDescription: varchar("normalizedDescription", { length: 500 }),
    counterparty: varchar("counterparty", { length: 255 }),
    documentNumber: varchar("documentNumber", { length: 120 }),
    balanceAfterCents: bigint("balanceAfterCents", { mode: "number" }),
    categoryId: integer("categoryId").references(() => financialCategories.id, {
      onDelete: "set null",
    }),
    source: varchar("source", { length: 24 }).notNull(),
    externalId: varchar("externalId", { length: 255 }),
    importId: integer("importId"),
    confidence: integer("confidence"),
    needsReview: boolean("needsReview").default(false).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    reconciledAt: timestamp("reconciledAt", { withTimezone: true }),
    reversedAt: timestamp("reversedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_transactions_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    index("financial_transactions_timeline_idx").on(
      table.tenantId,
      table.userId,
      table.occurredAt
    ),
    index("financial_transactions_review_idx").on(
      table.tenantId,
      table.userId,
      table.needsReview
    ),
  ]
);

export const financialTransactionRules = pgTable(
  "financial_transaction_rules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pattern: varchar("pattern", { length: 255 }).notNull(),
    matchType: varchar("matchType", { length: 24 })
      .default("contains")
      .notNull(),
    categoryId: integer("categoryId").references(() => financialCategories.id, {
      onDelete: "cascade",
    }),
    ownerType: varchar("ownerType", { length: 24 }),
    priority: integer("priority").default(100).notNull(),
    createdBy: varchar("createdBy", { length: 24 }).default("user").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_transaction_rules_pattern_idx").on(
      table.tenantId,
      table.userId,
      table.pattern,
      table.ownerType
    ),
  ]
);

export const budgetPeriods = pgTable(
  "budget_periods",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: date("periodStart").notNull(),
    periodEnd: date("periodEnd").notNull(),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("budget_periods_tenant_period_idx").on(
      table.tenantId,
      table.userId,
      table.periodStart,
      table.periodEnd
    ),
  ]
);

export const budgetEnvelopes = pgTable(
  "budget_envelopes",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    budgetPeriodId: integer("budgetPeriodId")
      .notNull()
      .references(() => budgetPeriods.id, { onDelete: "cascade" }),
    categoryId: integer("categoryId").references(() => financialCategories.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 160 }).notNull(),
    plannedCents: bigint("plannedCents", { mode: "number" })
      .default(0)
      .notNull(),
    spentCents: bigint("spentCents", { mode: "number" }).default(0).notNull(),
    reservedCents: bigint("reservedCents", { mode: "number" })
      .default(0)
      .notNull(),
    priority: varchar("priority", { length: 24 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("budget_envelopes_period_name_idx").on(
      table.budgetPeriodId,
      table.name
    ),
  ]
);

export const recurringCashflows = pgTable(
  "recurring_cashflows",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 24 }).notNull(),
    ownerType: varchar("ownerType", { length: 24 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    amountCents: bigint("amountCents", { mode: "number" }).notNull(),
    recurrenceRule: varchar("recurrenceRule", { length: 255 }).notNull(),
    nextDueDate: date("nextDueDate"),
    accountId: integer("accountId").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    categoryId: integer("categoryId").references(() => financialCategories.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 24 }).default("expected").notNull(),
    estimated: boolean("estimated").default(false).notNull(),
    needsConfirmation: boolean("needsConfirmation").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    seedKey: varchar("seedKey", { length: 120 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("recurring_cashflows_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    index("recurring_cashflows_due_idx").on(
      table.tenantId,
      table.userId,
      table.nextDueDate
    ),
  ]
);

export const financialGoals = pgTable(
  "financial_goals",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    goalType: varchar("goalType", { length: 40 }).notNull(),
    targetCents: bigint("targetCents", { mode: "number" }).notNull(),
    fundedCents: bigint("fundedCents", { mode: "number" }).default(0).notNull(),
    targetDate: date("targetDate"),
    priority: varchar("priority", { length: 24 }).notNull(),
    protected: boolean("protected").default(false).notNull(),
    status: varchar("status", { length: 24 }).default("planned").notNull(),
    seedKey: varchar("seedKey", { length: 120 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_goals_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    index("financial_goals_status_idx").on(
      table.tenantId,
      table.userId,
      table.status
    ),
  ]
);

export const financialGoalItems = pgTable(
  "financial_goal_items",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: integer("goalId")
      .notNull()
      .references(() => financialGoals.id, { onDelete: "cascade" }),
    personOrGroup: varchar("personOrGroup", { length: 120 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    estimatedCostCents: bigint("estimatedCostCents", { mode: "number" })
      .default(0)
      .notNull(),
    actualCostCents: bigint("actualCostCents", { mode: "number" }),
    priority: varchar("priority", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).default("planned").notNull(),
    desiredDate: date("desiredDate"),
    estimated: boolean("estimated").default(true).notNull(),
    needsConfirmation: boolean("needsConfirmation").default(false).notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_goal_items_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    index("financial_goal_items_priority_idx").on(
      table.tenantId,
      table.userId,
      table.priority,
      table.status
    ),
  ]
);

export const financialDebts = pgTable(
  "financial_debts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creditor: varchar("creditor", { length: 255 }).notNull(),
    balanceCents: bigint("balanceCents", { mode: "number" }).notNull(),
    interestRateBasisPoints: integer("interestRateBasisPoints"),
    dueDate: date("dueDate"),
    minimumPaymentCents: bigint("minimumPaymentCents", { mode: "number" }),
    priority: varchar("priority", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).default("outstanding").notNull(),
    needsConfirmation: boolean("needsConfirmation").default(false).notNull(),
    seedKey: varchar("seedKey", { length: 120 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_debts_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const financialProjects = pgTable(
  "financial_projects",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    clientName: varchar("clientName", { length: 255 }),
    stage: varchar("stage", { length: 32 }).notNull(),
    grossValueCents: bigint("grossValueCents", { mode: "number" })
      .default(0)
      .notNull(),
    expectedCostCents: bigint("expectedCostCents", { mode: "number" }),
    taxBasisPoints: integer("taxBasisPoints").default(1500).notNull(),
    costBasisPoints: integer("costBasisPoints").default(1000).notNull(),
    probabilityPercent: integer("probabilityPercent").default(0).notNull(),
    startedAt: date("startedAt"),
    expectedDeliveryAt: date("expectedDeliveryAt"),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    seedKey: varchar("seedKey", { length: 120 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_projects_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    index("financial_projects_stage_idx").on(
      table.tenantId,
      table.userId,
      table.stage
    ),
  ]
);

export const projectInstallments = pgTable(
  "project_installments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("projectId")
      .notNull()
      .references(() => financialProjects.id, { onDelete: "cascade" }),
    amountCents: bigint("amountCents", { mode: "number" }).notNull(),
    expectedAt: date("expectedAt"),
    receivedAt: timestamp("receivedAt", { withTimezone: true }),
    transactionId: integer("transactionId").references(
      () => financialTransactions.id,
      { onDelete: "set null" }
    ),
    status: varchar("status", { length: 24 }).default("expected").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    index("project_installments_due_idx").on(
      table.tenantId,
      table.userId,
      table.expectedAt,
      table.status
    ),
  ]
);

export const projectActivities = pgTable(
  "project_activities",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("projectId")
      .notNull()
      .references(() => financialProjects.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    occurredAt: timestamp("occurredAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    notes: text("notes"),
    nextActionAt: timestamp("nextActionAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("project_activities_next_action_idx").on(
      table.tenantId,
      table.userId,
      table.nextActionAt
    ),
  ]
);

export const incomeAllocations = pgTable(
  "income_allocations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: integer("transactionId")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "cascade" }),
    envelopeId: integer("envelopeId").references(() => budgetEnvelopes.id, {
      onDelete: "set null",
    }),
    goalId: integer("goalId").references(() => financialGoals.id, {
      onDelete: "set null",
    }),
    allocationType: varchar("allocationType", { length: 32 }).notNull(),
    amountCents: bigint("amountCents", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("income_allocations_target_idx").on(
      table.transactionId,
      table.allocationType,
      table.envelopeId,
      table.goalId
    ),
  ]
);

export const scheduledNotifications = pgTable(
  "scheduled_notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    templateKey: varchar("templateKey", { length: 120 }).notNull(),
    scheduledAt: timestamp("scheduledAt", { withTimezone: true }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    status: varchar("status", { length: 24 }).default("scheduled").notNull(),
    payload: jsonb("payload"),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true }),
    lastError: text("lastError"),
    sentAt: timestamp("sentAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("scheduled_notifications_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    index("scheduled_notifications_dispatch_idx").on(
      table.status,
      table.nextAttemptAt,
      table.scheduledAt
    ),
  ]
);

export const whatsappOutbox = pgTable(
  "whatsapp_outbox",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    integrationId: integer("integrationId")
      .notNull()
      .references(() => whatsappIntegrations.id, { onDelete: "cascade" }),
    contactId: integer("contactId")
      .notNull()
      .references(() => whatsappContacts.id, { onDelete: "cascade" }),
    threadId: integer("threadId")
      .notNull()
      .references(() => assistantThreads.id, { onDelete: "cascade" }),
    phoneNumber: varchar("phoneNumber", { length: 32 }).notNull(),
    textContent: text("textContent").notNull(),
    detectedIntent: varchar("detectedIntent", { length: 80 }),
    requiresConfirmation: boolean("requiresConfirmation")
      .default(false)
      .notNull(),
    metadata: jsonb("metadata"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    status: varchar("status", { length: 24 }).default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    providerMessageId: varchar("providerMessageId", { length: 255 }),
    messageId: integer("messageId").references(() => whatsappMessages.id, {
      onDelete: "set null",
    }),
    lastError: text("lastError"),
    sentAt: timestamp("sentAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("whatsapp_outbox_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    index("whatsapp_outbox_dispatch_idx").on(table.status, table.nextAttemptAt),
  ]
);

export const financialAuditEvents = pgTable(
  "financial_audit_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorType: varchar("actorType", { length: 24 }).notNull(),
    actorId: varchar("actorId", { length: 120 }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 120 }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: varchar("requestId", { length: 255 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    index("financial_audit_events_entity_idx").on(
      table.tenantId,
      table.userId,
      table.entityType,
      table.entityId
    ),
    uniqueIndex("financial_audit_events_request_idx").on(
      table.tenantId,
      table.userId,
      table.action,
      table.requestId
    ),
  ]
);

export const statementImports = pgTable(
  "statement_imports",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: integer("accountId")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "restrict" }),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    fileHash: varchar("fileHash", { length: 64 }).notNull(),
    format: varchar("format", { length: 32 }).notNull(),
    encoding: varchar("encoding", { length: 32 }).notNull(),
    status: varchar("status", { length: 24 }).default("pending").notNull(),
    rowCount: integer("rowCount").default(0).notNull(),
    importedCount: integer("importedCount").default(0).notNull(),
    duplicateCount: integer("duplicateCount").default(0).notNull(),
    errorCount: integer("errorCount").default(0).notNull(),
    errorReport: jsonb("errorReport"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("statement_imports_file_idx").on(
      table.tenantId,
      table.accountId,
      table.fileHash
    ),
  ]
);

export const businessCalendarHolidays = pgTable(
  "business_calendar_holidays",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    scope: varchar("scope", { length: 24 }).default("custom").notNull(),
    source: varchar("source", { length: 80 }).default("user").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("business_calendar_holidays_date_idx").on(
      table.tenantId,
      table.userId,
      table.date,
      table.scope
    ),
  ]
);

export const financialTasks = pgTable(
  "financial_tasks",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    priority: varchar("priority", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).default("open").notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }),
    seedKey: varchar("seedKey", { length: 160 }),
    metadata: jsonb("metadata"),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_tasks_tenant_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const privacyConsents = pgTable(
  "privacy_consents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 120 }).notNull(),
    legalBasis: varchar("legalBasis", { length: 80 }).notNull(),
    policyVersion: varchar("policyVersion", { length: 40 }).notNull(),
    acceptedAt: timestamp("acceptedAt", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("privacy_consents_version_idx").on(
      table.tenantId,
      table.userId,
      table.purpose,
      table.policyVersion
    ),
  ]
);

export const dataSubjectRequests = pgTable(
  "data_subject_requests",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    status: varchar("status", { length: 24 }).default("requested").notNull(),
    requestedAt: timestamp("requestedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  table => [
    index("data_subject_requests_status_idx").on(
      table.tenantId,
      table.userId,
      table.status
    ),
  ]
);

// ==================== FINANCIAL OPERATIONS V3 ====================
// Future obligations are deliberately separated from realized transactions.

export const recurrenceRules = pgTable(
  "recurrence_rules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemKind: varchar("itemKind", { length: 24 }).notNull(),
    ownerType: varchar("ownerType", { length: 24 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    frequency: varchar("frequency", { length: 32 }).notNull(),
    interval: integer("interval").default(1).notNull(),
    byWeekday: jsonb("byWeekday"),
    byMonthDay: integer("byMonthDay"),
    businessDayOrdinal: integer("businessDayOrdinal"),
    startDate: date("startDate").notNull(),
    endDate: date("endDate"),
    timezone: varchar("timezone", { length: 80 })
      .default("America/Sao_Paulo")
      .notNull(),
    amountMode: varchar("amountMode", { length: 24 })
      .default("fixed")
      .notNull(),
    baseAmountCents: bigint("baseAmountCents", { mode: "number" }).notNull(),
    expectedAccountId: integer("expectedAccountId").references(
      () => financialAccounts.id,
      { onDelete: "set null" }
    ),
    categoryId: integer("categoryId").references(() => financialCategories.id, {
      onDelete: "set null",
    }),
    nextGenerationAt: timestamp("nextGenerationAt", { withTimezone: true }),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    sourceMessageId: varchar("sourceMessageId", { length: 255 }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("recurrence_rules_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    uniqueIndex("recurrence_rules_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    index("recurrence_rules_generation_idx").on(
      table.status,
      table.nextGenerationAt
    ),
  ]
);

export const installmentPlans = pgTable(
  "installment_plans",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 500 }).notNull(),
    planType: varchar("planType", { length: 32 }).default("purchase").notNull(),
    totalAmountCents: bigint("totalAmountCents", { mode: "number" }).notNull(),
    installmentCount: integer("installmentCount").notNull(),
    firstDueDate: date("firstDueDate").notNull(),
    accountId: integer("accountId").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    creditCardId: integer("creditCardId").references(
      () => financialAccounts.id,
      { onDelete: "set null" }
    ),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("installment_plans_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
  ]
);

export const financialItems = pgTable(
  "financial_items",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 24 }).notNull(),
    origin: varchar("origin", { length: 24 }).notNull(),
    ownerType: varchar("ownerType", { length: 24 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    amountCents: bigint("amountCents", { mode: "number" }).notNull(),
    openAmountCents: bigint("openAmountCents", { mode: "number" }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    counterparty: varchar("counterparty", { length: 255 }),
    categoryId: integer("categoryId").references(() => financialCategories.id, {
      onDelete: "set null",
    }),
    expectedAccountId: integer("expectedAccountId").references(
      () => financialAccounts.id,
      { onDelete: "set null" }
    ),
    dueDate: date("dueDate").notNull(),
    competenceDate: date("competenceDate").notNull(),
    recurrenceId: integer("recurrenceId").references(() => recurrenceRules.id, {
      onDelete: "set null",
    }),
    installmentPlanId: integer("installmentPlanId").references(
      () => installmentPlans.id,
      { onDelete: "set null" }
    ),
    installmentNumber: integer("installmentNumber"),
    parentItemId: integer("parentItemId"),
    sourceMessageId: varchar("sourceMessageId", { length: 255 }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    estimated: boolean("estimated").default(false).notNull(),
    needsConfirmation: boolean("needsConfirmation").default(false).notNull(),
    metadata: jsonb("metadata"),
    cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_items_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    uniqueIndex("financial_items_source_message_idx").on(
      table.tenantId,
      table.userId,
      table.sourceMessageId
    ),
    uniqueIndex("financial_items_recurrence_competence_idx").on(
      table.recurrenceId,
      table.competenceDate
    ),
    index("financial_items_due_idx").on(
      table.tenantId,
      table.userId,
      table.kind,
      table.status,
      table.dueDate
    ),
  ]
);

export const financialSettlements = pgTable(
  "financial_settlements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    financialItemId: integer("financialItemId")
      .notNull()
      .references(() => financialItems.id, { onDelete: "restrict" }),
    transactionId: integer("transactionId")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    amountCents: bigint("amountCents", { mode: "number" }).notNull(),
    settledAt: timestamp("settledAt", { withTimezone: true }).notNull(),
    settlementType: varchar("settlementType", { length: 24 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    reversedAt: timestamp("reversedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("financial_settlements_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    index("financial_settlements_item_idx").on(table.financialItemId),
  ]
);

export const financialActions = pgTable(
  "financial_actions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversationId", { length: 160 }),
    messageId: varchar("messageId", { length: 255 }),
    actionType: varchar("actionType", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 120 }).notNull(),
    beforeSnapshot: jsonb("beforeSnapshot"),
    afterSnapshot: jsonb("afterSnapshot"),
    resultSnapshot: jsonb("resultSnapshot"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    reversibleUntil: timestamp("reversibleUntil", { withTimezone: true }),
    reversedAt: timestamp("reversedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("financial_actions_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    index("financial_actions_recent_idx").on(
      table.tenantId,
      table.userId,
      table.createdAt
    ),
  ]
);

// ==================== LIFELONG PLAN V3 ====================

export const financialPhases = pgTable(
  "financial_phases",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phase: varchar("phase", { length: 40 }).notNull(),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    reason: text("reason"),
    snapshot: jsonb("snapshot"),
    startedAt: timestamp("startedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("financial_phases_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
    index("financial_phases_status_idx").on(
      table.tenantId,
      table.userId,
      table.status
    ),
  ]
);

export const allocationPolicies = pgTable(
  "allocation_policies",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phase: varchar("phase", { length: 40 }).notNull(),
    incomeKind: varchar("incomeKind", { length: 40 }).notNull(),
    version: varchar("version", { length: 40 }).notNull(),
    rules: jsonb("rules").notNull(),
    active: boolean("active").default(true).notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("allocation_policies_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
    index("allocation_policies_lookup_idx").on(
      table.tenantId,
      table.userId,
      table.phase,
      table.incomeKind,
      table.active
    ),
  ]
);

export const allocationExecutions = pgTable(
  "allocation_executions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    incomeTransactionId: integer("incomeTransactionId")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    phase: varchar("phase", { length: 40 }).notNull(),
    policyVersion: varchar("policyVersion", { length: 40 }).notNull(),
    totalCents: bigint("totalCents", { mode: "number" }).notNull(),
    allocations: jsonb("allocations").notNull(),
    status: varchar("status", { length: 32 }).default("proposed").notNull(),
    confirmedByUserAt: timestamp("confirmedByUserAt", { withTimezone: true }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("allocation_executions_idempotency_idx").on(
      table.tenantId,
      table.userId,
      table.idempotencyKey
    ),
  ]
);

export const incomeEvents = pgTable(
  "income_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: integer("transactionId")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "cascade" }),
    incomeKind: varchar("incomeKind", { length: 40 }).notNull(),
    availableCents: bigint("availableCents", { mode: "number" }).notNull(),
    allocatedCents: bigint("allocatedCents", { mode: "number" })
      .default(0)
      .notNull(),
    status: varchar("status", { length: 24 }).default("unallocated").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("income_events_transaction_idx").on(
      table.tenantId,
      table.userId,
      table.transactionId
    ),
  ]
);

export const operatingBuffers = pgTable(
  "operating_buffers",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: integer("accountId").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 160 }).notNull(),
    targetCents: bigint("targetCents", { mode: "number" }).notNull(),
    protected: boolean("protected").default(true).notNull(),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("operating_buffers_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const sinkingFunds = pgTable(
  "sinking_funds",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: integer("accountId").references(() => financialAccounts.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    purpose: varchar("purpose", { length: 80 }).notNull(),
    targetCents: bigint("targetCents", { mode: "number" }).default(0).notNull(),
    fundedCents: bigint("fundedCents", { mode: "number" }).default(0).notNull(),
    targetDate: date("targetDate"),
    protected: boolean("protected").default(false).notNull(),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("sinking_funds_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 500 }).notNull(),
    assetType: varchar("assetType", { length: 40 }).notNull(),
    ownerType: varchar("ownerType", { length: 24 })
      .default("personal")
      .notNull(),
    estimatedValueCents: bigint("estimatedValueCents", { mode: "number" })
      .default(0)
      .notNull(),
    debtBalanceCents: bigint("debtBalanceCents", { mode: "number" })
      .default(0)
      .notNull(),
    incomeGenerating: boolean("incomeGenerating").default(false).notNull(),
    intendedUse: varchar("intendedUse", { length: 80 }),
    status: varchar("status", { length: 24 }).default("estimated").notNull(),
    needsConfirmation: boolean("needsConfirmation").default(true).notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("assets_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const assetValuations = pgTable("asset_valuations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assetId: integer("assetId")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 160 }).notNull(),
  grossValueCents: bigint("grossValueCents", { mode: "number" }).notNull(),
  deductionsCents: bigint("deductionsCents", { mode: "number" })
    .default(0)
    .notNull(),
  netValueCents: bigint("netValueCents", { mode: "number" }).notNull(),
  valuedAt: timestamp("valuedAt", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const tradeInQuotes = pgTable("trade_in_quotes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assetId: integer("assetId")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  dealer: varchar("dealer", { length: 255 }).notNull(),
  offeredCents: bigint("offeredCents", { mode: "number" }).notNull(),
  deductionsCents: bigint("deductionsCents", { mode: "number" })
    .default(0)
    .notNull(),
  netCents: bigint("netCents", { mode: "number" }).notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const creditHealthSnapshots = pgTable(
  "credit_health_snapshots",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceMonth: varchar("sourceMonth", { length: 7 }).notNull(),
    currentDebtCents: bigint("currentDebtCents", { mode: "number" })
      .default(0)
      .notNull(),
    overdueCents: bigint("overdueCents", { mode: "number" })
      .default(0)
      .notNull(),
    unusedLimitsCents: bigint("unusedLimitsCents", { mode: "number" })
      .default(0)
      .notNull(),
    overdraftUsedCents: bigint("overdraftUsedCents", { mode: "number" })
      .default(0)
      .notNull(),
    revolvingCreditCents: bigint("revolvingCreditCents", { mode: "number" })
      .default(0)
      .notNull(),
    cleanMonths: integer("cleanMonths").default(0).notNull(),
    status: varchar("status", { length: 24 })
      .default("needs_confirmation")
      .notNull(),
    issues: jsonb("issues"),
    evidence: jsonb("evidence"),
    observedAt: timestamp("observedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("credit_health_month_idx").on(
      table.tenantId,
      table.userId,
      table.sourceMonth
    ),
    uniqueIndex("credit_health_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const creditCleanupTasks = pgTable(
  "credit_cleanup_tasks",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    institution: varchar("institution", { length: 255 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    reportedAmountCents: bigint("reportedAmountCents", { mode: "number" }),
    currentAmountCents: bigint("currentAmountCents", { mode: "number" }),
    status: varchar("status", { length: 32 })
      .default("needs_confirmation")
      .notNull(),
    priority: varchar("priority", { length: 24 }).default("critical").notNull(),
    proof: jsonb("proof"),
    dueDate: date("dueDate"),
    seedKey: varchar("seedKey", { length: 160 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("credit_cleanup_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const creditInquiries = pgTable("credit_inquiries", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  institution: varchar("institution", { length: 255 }).notNull(),
  inquiryType: varchar("inquiryType", { length: 40 }).notNull(),
  hardInquiry: boolean("hardInquiry").default(false).notNull(),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const carQuotes = pgTable("car_quotes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 500 }).notNull(),
  seller: varchar("seller", { length: 255 }),
  priceCents: bigint("priceCents", { mode: "number" }).notNull(),
  cashDiscountCents: bigint("cashDiscountCents", { mode: "number" })
    .default(0)
    .notNull(),
  tradeInCents: bigint("tradeInCents", { mode: "number" }).default(0).notNull(),
  initialCostsCents: bigint("initialCostsCents", { mode: "number" })
    .default(0)
    .notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insuranceQuotes = pgTable("insurance_quotes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  carQuoteId: integer("carQuoteId").references(() => carQuotes.id, {
    onDelete: "cascade",
  }),
  insurer: varchar("insurer", { length: 255 }).notNull(),
  annualPremiumCents: bigint("annualPremiumCents", {
    mode: "number",
  }).notNull(),
  deductibleCents: bigint("deductibleCents", { mode: "number" }),
  coverage: jsonb("coverage"),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const financingQuotes = pgTable("financing_quotes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  carQuoteId: integer("carQuoteId").references(() => carQuotes.id, {
    onDelete: "set null",
  }),
  lender: varchar("lender", { length: 255 }).notNull(),
  vehiclePriceCents: bigint("vehiclePriceCents", { mode: "number" }).notNull(),
  downPaymentCents: bigint("downPaymentCents", { mode: "number" }).notNull(),
  tradeInCents: bigint("tradeInCents", { mode: "number" }).default(0).notNull(),
  financedCents: bigint("financedCents", { mode: "number" }).notNull(),
  nominalMonthlyBasisPoints: integer("nominalMonthlyBasisPoints"),
  cetAnnualBasisPoints: integer("cetAnnualBasisPoints").notNull(),
  termMonths: integer("termMonths").notNull(),
  installmentCents: bigint("installmentCents", { mode: "number" }).notNull(),
  totalPaidCents: bigint("totalPaidCents", { mode: "number" }).notNull(),
  feesCents: bigint("feesCents", { mode: "number" }).default(0).notNull(),
  hardCreditInquiry: boolean("hardCreditInquiry").default(false).notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const financingContracts = pgTable("financing_contracts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  financingQuoteId: integer("financingQuoteId").references(
    () => financingQuotes.id,
    { onDelete: "set null" }
  ),
  lender: varchar("lender", { length: 255 }).notNull(),
  principalCents: bigint("principalCents", { mode: "number" }).notNull(),
  currentBalanceCents: bigint("currentBalanceCents", {
    mode: "number",
  }).notNull(),
  cetAnnualBasisPoints: integer("cetAnnualBasisPoints").notNull(),
  installmentCents: bigint("installmentCents", { mode: "number" }).notNull(),
  termMonths: integer("termMonths").notNull(),
  startedAt: date("startedAt").notNull(),
  status: varchar("status", { length: 24 }).default("active").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const amortizationEvents = pgTable("amortization_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  financingContractId: integer("financingContractId")
    .notNull()
    .references(() => financingContracts.id, { onDelete: "cascade" }),
  amountCents: bigint("amountCents", { mode: "number" }).notNull(),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).notNull(),
  principalReductionCents: bigint("principalReductionCents", {
    mode: "number",
  }).notNull(),
  interestSavedCents: bigint("interestSavedCents", { mode: "number" }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const investmentPolicyStatements = pgTable(
  "investment_policy_statements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    riskProfile: varchar("riskProfile", { length: 40 }).notNull(),
    horizonYears: integer("horizonYears"),
    liquidityNeeds: text("liquidityNeeds"),
    targetAllocation: jsonb("targetAllocation").notNull(),
    concentrationLimits: jsonb("concentrationLimits"),
    suitabilityConfirmedAt: timestamp("suitabilityConfirmedAt", {
      withTimezone: true,
    }),
    version: varchar("version", { length: 40 }).notNull(),
    status: varchar("status", { length: 24 }).default("draft").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }
);

export const investmentAccounts = pgTable("investment_accounts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  financialAccountId: integer("financialAccountId").references(
    () => financialAccounts.id,
    { onDelete: "set null" }
  ),
  institution: varchar("institution", { length: 255 }).notNull(),
  bucket: varchar("bucket", { length: 40 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("BRL").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const investmentPositions = pgTable(
  "investment_positions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: integer("investmentAccountId")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    assetCode: varchar("assetCode", { length: 80 }).notNull(),
    assetClass: varchar("assetClass", { length: 80 }).notNull(),
    quantityMicrounits: bigint("quantityMicrounits", { mode: "number" })
      .default(0)
      .notNull(),
    costBasisCents: bigint("costBasisCents", { mode: "number" })
      .default(0)
      .notNull(),
    marketValueCents: bigint("marketValueCents", { mode: "number" })
      .default(0)
      .notNull(),
    valuedAt: timestamp("valuedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("investment_positions_asset_idx").on(
      table.investmentAccountId,
      table.assetCode
    ),
  ]
);

export const investmentCashflows = pgTable("investment_cashflows", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  investmentAccountId: integer("investmentAccountId")
    .notNull()
    .references(() => investmentAccounts.id, { onDelete: "cascade" }),
  transactionId: integer("transactionId").references(
    () => financialTransactions.id,
    { onDelete: "set null" }
  ),
  type: varchar("type", { length: 32 }).notNull(),
  amountCents: bigint("amountCents", { mode: "number" }).notNull(),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const dividendEvents = pgTable("dividend_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  investmentPositionId: integer("investmentPositionId").references(
    () => investmentPositions.id,
    { onDelete: "set null" }
  ),
  assetCode: varchar("assetCode", { length: 80 }).notNull(),
  exDate: date("exDate"),
  paymentDate: date("paymentDate").notNull(),
  grossCents: bigint("grossCents", { mode: "number" }).notNull(),
  withholdingCents: bigint("withholdingCents", { mode: "number" })
    .default(0)
    .notNull(),
  netCents: bigint("netCents", { mode: "number" }).notNull(),
  reinvestedCents: bigint("reinvestedCents", { mode: "number" })
    .default(0)
    .notNull(),
  status: varchar("status", { length: 24 }).default("received").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    totalValueCents: bigint("totalValueCents", { mode: "number" }).notNull(),
    investableNetWorthCents: bigint("investableNetWorthCents", {
      mode: "number",
    }).notNull(),
    allocation: jsonb("allocation"),
    capturedAt: timestamp("capturedAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("portfolio_snapshots_date_idx").on(
      table.tenantId,
      table.userId,
      table.capturedAt
    ),
  ]
);

export const financialIndependenceTargets = pgTable(
  "financial_independence_targets",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    monthlySpendingCentsToday: bigint("monthlySpendingCentsToday", {
      mode: "number",
    }).notNull(),
    annualSpendingCentsToday: bigint("annualSpendingCentsToday", {
      mode: "number",
    }).notNull(),
    withdrawalRateBasisPoints: integer("withdrawalRateBasisPoints").notNull(),
    targetRealCents: bigint("targetRealCents", { mode: "number" }).notNull(),
    inflationIndex: varchar("inflationIndex", { length: 24 })
      .default("IPCA")
      .notNull(),
    baseDate: date("baseDate").notNull(),
    currentPortfolioCents: bigint("currentPortfolioCents", { mode: "number" })
      .default(0)
      .notNull(),
    ratioBasisPoints: integer("ratioBasisPoints").default(0).notNull(),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    seedKey: varchar("seedKey", { length: 160 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("financial_independence_seed_idx").on(
      table.tenantId,
      table.userId,
      table.seedKey
    ),
  ]
);

export const financialIndependenceProjections = pgTable(
  "financial_independence_projections",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: integer("targetId")
      .notNull()
      .references(() => financialIndependenceTargets.id, {
        onDelete: "cascade",
      }),
    monthlyContributionCents: bigint("monthlyContributionCents", {
      mode: "number",
    }).notNull(),
    assumedRealReturnBasisPoints: integer(
      "assumedRealReturnBasisPoints"
    ).notNull(),
    projectedMonths: integer("projectedMonths"),
    assumptions: jsonb("assumptions"),
    calculatedAt: timestamp("calculatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export const annualReviews = pgTable(
  "annual_reviews",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reviewYear: integer("reviewYear").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    decisions: jsonb("decisions"),
    status: varchar("status", { length: 24 }).default("draft").notNull(),
    reviewedAt: timestamp("reviewedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("annual_reviews_year_idx").on(
      table.tenantId,
      table.userId,
      table.reviewYear
    ),
  ]
);

export const riskProtocolEvents = pgTable("risk_protocol_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  level: varchar("level", { length: 16 }).notNull(),
  trigger: varchar("trigger", { length: 120 }).notNull(),
  snapshot: jsonb("snapshot"),
  actions: jsonb("actions"),
  status: varchar("status", { length: 24 }).default("active").notNull(),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type FinancialProfile = typeof financialProfiles.$inferSelect;
export type InsertFinancialProfile = typeof financialProfiles.$inferInsert;
export type FinancialAccount = typeof financialAccounts.$inferSelect;
export type InsertFinancialAccount = typeof financialAccounts.$inferInsert;
export type FinancialCategory = typeof financialCategories.$inferSelect;
export type InsertFinancialCategory = typeof financialCategories.$inferInsert;
export type FinancialTransaction = typeof financialTransactions.$inferSelect;
export type InsertFinancialTransaction =
  typeof financialTransactions.$inferInsert;
export type FinancialGoal = typeof financialGoals.$inferSelect;
export type InsertFinancialGoal = typeof financialGoals.$inferInsert;
export type FinancialGoalItem = typeof financialGoalItems.$inferSelect;
export type InsertFinancialGoalItem = typeof financialGoalItems.$inferInsert;
export type FinancialDebt = typeof financialDebts.$inferSelect;
export type InsertFinancialDebt = typeof financialDebts.$inferInsert;
export type FinancialProject = typeof financialProjects.$inferSelect;
export type InsertFinancialProject = typeof financialProjects.$inferInsert;
export type ProjectInstallment = typeof projectInstallments.$inferSelect;
export type InsertProjectInstallment = typeof projectInstallments.$inferInsert;
export type ScheduledNotification = typeof scheduledNotifications.$inferSelect;
export type InsertScheduledNotification =
  typeof scheduledNotifications.$inferInsert;
export type WhatsAppOutboxItem = typeof whatsappOutbox.$inferSelect;
export type InsertWhatsAppOutboxItem = typeof whatsappOutbox.$inferInsert;
export type StatementImport = typeof statementImports.$inferSelect;
export type InsertStatementImport = typeof statementImports.$inferInsert;
export type RecurrenceRule = typeof recurrenceRules.$inferSelect;
export type InsertRecurrenceRule = typeof recurrenceRules.$inferInsert;
export type InstallmentPlan = typeof installmentPlans.$inferSelect;
export type InsertInstallmentPlan = typeof installmentPlans.$inferInsert;
export type FinancialItem = typeof financialItems.$inferSelect;
export type InsertFinancialItem = typeof financialItems.$inferInsert;
export type FinancialSettlement = typeof financialSettlements.$inferSelect;
export type InsertFinancialSettlement =
  typeof financialSettlements.$inferInsert;
export type FinancialAction = typeof financialActions.$inferSelect;
export type InsertFinancialAction = typeof financialActions.$inferInsert;
export type FinancialPhase = typeof financialPhases.$inferSelect;
export type AllocationPolicy = typeof allocationPolicies.$inferSelect;
export type AllocationExecution = typeof allocationExecutions.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type CreditHealthSnapshot = typeof creditHealthSnapshots.$inferSelect;
export type FinancingQuote = typeof financingQuotes.$inferSelect;
export type InvestmentPosition = typeof investmentPositions.$inferSelect;
export type FinancialIndependenceTarget =
  typeof financialIndependenceTargets.$inferSelect;
