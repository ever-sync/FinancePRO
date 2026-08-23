CREATE TABLE IF NOT EXISTS "budget_envelopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"budgetPeriodId" integer NOT NULL,
	"categoryId" integer,
	"name" varchar(160) NOT NULL,
	"plannedCents" bigint DEFAULT 0 NOT NULL,
	"spentCents" bigint DEFAULT 0 NOT NULL,
	"reservedCents" bigint DEFAULT 0 NOT NULL,
	"priority" varchar(24) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"periodStart" date NOT NULL,
	"periodEnd" date NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_calendar_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"date" date NOT NULL,
	"name" varchar(255) NOT NULL,
	"scope" varchar(24) DEFAULT 'custom' NOT NULL,
	"source" varchar(80) DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_subject_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'requested' NOT NULL,
	"requestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"ownerType" varchar(24) NOT NULL,
	"accountType" varchar(32) NOT NULL,
	"institution" varchar(255),
	"currency" varchar(3) DEFAULT 'BRL' NOT NULL,
	"currentBalanceCents" bigint DEFAULT 0 NOT NULL,
	"balanceAsOf" timestamp with time zone,
	"includeInOperatingCash" boolean DEFAULT true NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seedKey" varchar(120),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"actorType" varchar(24) NOT NULL,
	"actorId" varchar(120),
	"action" varchar(80) NOT NULL,
	"entityType" varchar(80) NOT NULL,
	"entityId" varchar(120) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"requestId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(160) NOT NULL,
	"group" varchar(40) NOT NULL,
	"ownerType" varchar(24) NOT NULL,
	"essential" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_debts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"creditor" varchar(255) NOT NULL,
	"balanceCents" bigint NOT NULL,
	"interestRateBasisPoints" integer,
	"dueDate" date,
	"minimumPaymentCents" bigint,
	"priority" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'outstanding' NOT NULL,
	"needsConfirmation" boolean DEFAULT false NOT NULL,
	"seedKey" varchar(120),
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_goal_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"goalId" integer NOT NULL,
	"personOrGroup" varchar(120) NOT NULL,
	"name" varchar(255) NOT NULL,
	"estimatedCostCents" bigint DEFAULT 0 NOT NULL,
	"actualCostCents" bigint,
	"priority" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"desiredDate" date,
	"estimated" boolean DEFAULT true NOT NULL,
	"needsConfirmation" boolean DEFAULT false NOT NULL,
	"seedKey" varchar(160),
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"goalType" varchar(40) NOT NULL,
	"targetCents" bigint NOT NULL,
	"fundedCents" bigint DEFAULT 0 NOT NULL,
	"targetDate" date,
	"priority" varchar(24) NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"seedKey" varchar(120),
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"profileKey" varchar(80) DEFAULT 'custom' NOT NULL,
	"displayName" varchar(255) NOT NULL,
	"locale" varchar(16) DEFAULT 'pt-BR' NOT NULL,
	"currency" varchar(3) DEFAULT 'BRL' NOT NULL,
	"timezone" varchar(80) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"planningHorizon" date,
	"tone" varchar(160) DEFAULT 'objetivo, humano e firme' NOT NULL,
	"riskPreference" varchar(160) DEFAULT 'baixo risco e alta liquidez' NOT NULL,
	"operatingBufferCents" bigint DEFAULT 0 NOT NULL,
	"monthlyVariableBudgetCents" bigint DEFAULT 0 NOT NULL,
	"emergencyFundReferenceCents" bigint DEFAULT 0 NOT NULL,
	"emergencyFundTargetMonths" integer DEFAULT 6 NOT NULL,
	"projectTaxBasisPoints" integer DEFAULT 1500 NOT NULL,
	"projectCostBasisPoints" integer DEFAULT 1000 NOT NULL,
	"projectGoalBasisPoints" integer DEFAULT 7500 NOT NULL,
	"carMonthlyLimitCents" bigint DEFAULT 0 NOT NULL,
	"carInstallmentLimitCents" bigint DEFAULT 0 NOT NULL,
	"quietHoursStart" varchar(5) DEFAULT '21:00' NOT NULL,
	"quietHoursEnd" varchar(5) DEFAULT '08:00' NOT NULL,
	"notificationsPausedUntil" timestamp with time zone,
	"onboardingState" jsonb,
	"configVersion" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"clientName" varchar(255),
	"stage" varchar(32) NOT NULL,
	"grossValueCents" bigint DEFAULT 0 NOT NULL,
	"expectedCostCents" bigint,
	"taxBasisPoints" integer DEFAULT 1500 NOT NULL,
	"costBasisPoints" integer DEFAULT 1000 NOT NULL,
	"probabilityPercent" integer DEFAULT 0 NOT NULL,
	"startedAt" date,
	"expectedDeliveryAt" date,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"seedKey" varchar(120),
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"priority" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"dueAt" timestamp with time zone,
	"seedKey" varchar(160),
	"metadata" jsonb,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_transaction_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"pattern" varchar(255) NOT NULL,
	"matchType" varchar(24) DEFAULT 'contains' NOT NULL,
	"categoryId" integer,
	"ownerType" varchar(24),
	"priority" integer DEFAULT 100 NOT NULL,
	"createdBy" varchar(24) DEFAULT 'user' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"accountId" integer NOT NULL,
	"transferPairId" integer,
	"reversalOfId" integer,
	"type" varchar(24) NOT NULL,
	"transferDirection" varchar(16),
	"status" varchar(24) NOT NULL,
	"amountCents" bigint NOT NULL,
	"occurredAt" timestamp with time zone NOT NULL,
	"description" varchar(500) NOT NULL,
	"normalizedDescription" varchar(500),
	"counterparty" varchar(255),
	"documentNumber" varchar(120),
	"balanceAfterCents" bigint,
	"categoryId" integer,
	"source" varchar(24) NOT NULL,
	"externalId" varchar(255),
	"importId" integer,
	"confidence" integer,
	"needsReview" boolean DEFAULT false NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"reconciledAt" timestamp with time zone,
	"reversedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "income_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"transactionId" integer NOT NULL,
	"envelopeId" integer,
	"goalId" integer,
	"allocationType" varchar(32) NOT NULL,
	"amountCents" bigint NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "privacy_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"purpose" varchar(120) NOT NULL,
	"legalBasis" varchar(80) NOT NULL,
	"policyVersion" varchar(40) NOT NULL,
	"acceptedAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"type" varchar(40) NOT NULL,
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"nextActionAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"amountCents" bigint NOT NULL,
	"expectedAt" date,
	"receivedAt" timestamp with time zone,
	"transactionId" integer,
	"status" varchar(24) DEFAULT 'expected' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_cashflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(24) NOT NULL,
	"ownerType" varchar(24) NOT NULL,
	"name" varchar(255) NOT NULL,
	"amountCents" bigint NOT NULL,
	"recurrenceRule" varchar(255) NOT NULL,
	"nextDueDate" date,
	"accountId" integer,
	"categoryId" integer,
	"status" varchar(24) DEFAULT 'expected' NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"needsConfirmation" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seedKey" varchar(120),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"templateKey" varchar(120) NOT NULL,
	"scheduledAt" timestamp with time zone NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"status" varchar(24) DEFAULT 'scheduled' NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"lastError" text,
	"sentAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "statement_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"accountId" integer NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileHash" varchar(64) NOT NULL,
	"format" varchar(32) NOT NULL,
	"encoding" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"rowCount" integer DEFAULT 0 NOT NULL,
	"importedCount" integer DEFAULT 0 NOT NULL,
	"duplicateCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"errorReport" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerOpenId" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_ownerOpenId_unique" UNIQUE("ownerOpenId")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenantId" integer;--> statement-breakpoint
INSERT INTO "tenants" ("ownerOpenId", "name", "status")
SELECT
	"openId",
	COALESCE(NULLIF(BTRIM("name"), ''), 'Minha conta'),
	'active'
FROM "users"
ON CONFLICT ("ownerOpenId") DO NOTHING;--> statement-breakpoint
UPDATE "users" AS app_user
SET "tenantId" = tenant.id
FROM "tenants" AS tenant
WHERE app_user."tenantId" IS NULL
	AND tenant."ownerOpenId" = app_user."openId";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenantId" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_budgetPeriodId_budget_periods_id_fk" FOREIGN KEY ("budgetPeriodId") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_categoryId_financial_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."financial_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "business_calendar_holidays" ADD CONSTRAINT "business_calendar_holidays_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "business_calendar_holidays" ADD CONSTRAINT "business_calendar_holidays_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_debts" ADD CONSTRAINT "financial_debts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_debts" ADD CONSTRAINT "financial_debts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_goal_items" ADD CONSTRAINT "financial_goal_items_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_goal_items" ADD CONSTRAINT "financial_goal_items_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_goal_items" ADD CONSTRAINT "financial_goal_items_goalId_financial_goals_id_fk" FOREIGN KEY ("goalId") REFERENCES "public"."financial_goals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_projects" ADD CONSTRAINT "financial_projects_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_projects" ADD CONSTRAINT "financial_projects_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transaction_rules" ADD CONSTRAINT "financial_transaction_rules_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transaction_rules" ADD CONSTRAINT "financial_transaction_rules_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transaction_rules" ADD CONSTRAINT "financial_transaction_rules_categoryId_financial_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."financial_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_accountId_financial_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_categoryId_financial_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."financial_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "income_allocations" ADD CONSTRAINT "income_allocations_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "income_allocations" ADD CONSTRAINT "income_allocations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "income_allocations" ADD CONSTRAINT "income_allocations_transactionId_financial_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."financial_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "income_allocations" ADD CONSTRAINT "income_allocations_envelopeId_budget_envelopes_id_fk" FOREIGN KEY ("envelopeId") REFERENCES "public"."budget_envelopes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "income_allocations" ADD CONSTRAINT "income_allocations_goalId_financial_goals_id_fk" FOREIGN KEY ("goalId") REFERENCES "public"."financial_goals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_projectId_financial_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."financial_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_installments" ADD CONSTRAINT "project_installments_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_installments" ADD CONSTRAINT "project_installments_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_installments" ADD CONSTRAINT "project_installments_projectId_financial_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."financial_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_installments" ADD CONSTRAINT "project_installments_transactionId_financial_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."financial_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recurring_cashflows" ADD CONSTRAINT "recurring_cashflows_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recurring_cashflows" ADD CONSTRAINT "recurring_cashflows_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recurring_cashflows" ADD CONSTRAINT "recurring_cashflows_accountId_financial_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recurring_cashflows" ADD CONSTRAINT "recurring_cashflows_categoryId_financial_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."financial_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_accountId_financial_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_envelopes_period_name_idx" ON "budget_envelopes" USING btree ("budgetPeriodId","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_periods_tenant_period_idx" ON "budget_periods" USING btree ("tenantId","userId","periodStart","periodEnd");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_calendar_holidays_date_idx" ON "business_calendar_holidays" USING btree ("tenantId","userId","date","scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_subject_requests_status_idx" ON "data_subject_requests" USING btree ("tenantId","userId","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_accounts_tenant_seed_idx" ON "financial_accounts" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_accounts_owner_idx" ON "financial_accounts" USING btree ("tenantId","userId","ownerType","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_audit_events_entity_idx" ON "financial_audit_events" USING btree ("tenantId","userId","entityType","entityId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_categories_tenant_key_idx" ON "financial_categories" USING btree ("tenantId","userId","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_debts_tenant_seed_idx" ON "financial_debts" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_goal_items_tenant_seed_idx" ON "financial_goal_items" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_goal_items_priority_idx" ON "financial_goal_items" USING btree ("tenantId","userId","priority","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_goals_tenant_seed_idx" ON "financial_goals" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_goals_status_idx" ON "financial_goals" USING btree ("tenantId","userId","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_profiles_tenant_user_idx" ON "financial_profiles" USING btree ("tenantId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_projects_tenant_seed_idx" ON "financial_projects" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_projects_stage_idx" ON "financial_projects" USING btree ("tenantId","userId","stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_tasks_tenant_seed_idx" ON "financial_tasks" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transaction_rules_pattern_idx" ON "financial_transaction_rules" USING btree ("tenantId","userId","pattern","ownerType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_idempotency_idx" ON "financial_transactions" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_transactions_timeline_idx" ON "financial_transactions" USING btree ("tenantId","userId","occurredAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_transactions_review_idx" ON "financial_transactions" USING btree ("tenantId","userId","needsReview");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "income_allocations_target_idx" ON "income_allocations" USING btree ("transactionId","allocationType","envelopeId","goalId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "privacy_consents_version_idx" ON "privacy_consents" USING btree ("tenantId","userId","purpose","policyVersion");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_activities_next_action_idx" ON "project_activities" USING btree ("tenantId","userId","nextActionAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_installments_due_idx" ON "project_installments" USING btree ("tenantId","userId","expectedAt","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_cashflows_tenant_seed_idx" ON "recurring_cashflows" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_cashflows_due_idx" ON "recurring_cashflows" USING btree ("tenantId","userId","nextDueDate");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_notifications_idempotency_idx" ON "scheduled_notifications" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_notifications_dispatch_idx" ON "scheduled_notifications" USING btree ("status","nextAttemptAt","scheduledAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "statement_imports_file_idx" ON "statement_imports" USING btree ("tenantId","accountId","fileHash");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
