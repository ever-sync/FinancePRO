CREATE TABLE "allocation_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"incomeTransactionId" integer NOT NULL,
	"phase" varchar(40) NOT NULL,
	"policyVersion" varchar(40) NOT NULL,
	"totalCents" bigint NOT NULL,
	"allocations" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'proposed' NOT NULL,
	"confirmedByUserAt" timestamp with time zone,
	"idempotencyKey" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"phase" varchar(40) NOT NULL,
	"incomeKind" varchar(40) NOT NULL,
	"version" varchar(40) NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seedKey" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amortization_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"financingContractId" integer NOT NULL,
	"amountCents" bigint NOT NULL,
	"occurredAt" timestamp with time zone NOT NULL,
	"principalReductionCents" bigint NOT NULL,
	"interestSavedCents" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annual_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"reviewYear" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"decisions" jsonb,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"reviewedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_valuations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"assetId" integer NOT NULL,
	"source" varchar(160) NOT NULL,
	"grossValueCents" bigint NOT NULL,
	"deductionsCents" bigint DEFAULT 0 NOT NULL,
	"netValueCents" bigint NOT NULL,
	"valuedAt" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"description" varchar(500) NOT NULL,
	"assetType" varchar(40) NOT NULL,
	"ownerType" varchar(24) DEFAULT 'personal' NOT NULL,
	"estimatedValueCents" bigint DEFAULT 0 NOT NULL,
	"debtBalanceCents" bigint DEFAULT 0 NOT NULL,
	"incomeGenerating" boolean DEFAULT false NOT NULL,
	"intendedUse" varchar(80),
	"status" varchar(24) DEFAULT 'estimated' NOT NULL,
	"needsConfirmation" boolean DEFAULT true NOT NULL,
	"seedKey" varchar(160),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "car_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"description" varchar(500) NOT NULL,
	"seller" varchar(255),
	"priceCents" bigint NOT NULL,
	"cashDiscountCents" bigint DEFAULT 0 NOT NULL,
	"tradeInCents" bigint DEFAULT 0 NOT NULL,
	"initialCostsCents" bigint DEFAULT 0 NOT NULL,
	"expiresAt" timestamp with time zone,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_cleanup_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"institution" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"reportedAmountCents" bigint,
	"currentAmountCents" bigint,
	"status" varchar(32) DEFAULT 'needs_confirmation' NOT NULL,
	"priority" varchar(24) DEFAULT 'critical' NOT NULL,
	"proof" jsonb,
	"dueDate" date,
	"seedKey" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"sourceMonth" varchar(7) NOT NULL,
	"currentDebtCents" bigint DEFAULT 0 NOT NULL,
	"overdueCents" bigint DEFAULT 0 NOT NULL,
	"unusedLimitsCents" bigint DEFAULT 0 NOT NULL,
	"overdraftUsedCents" bigint DEFAULT 0 NOT NULL,
	"revolvingCreditCents" bigint DEFAULT 0 NOT NULL,
	"cleanMonths" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'needs_confirmation' NOT NULL,
	"issues" jsonb,
	"evidence" jsonb,
	"observedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"seedKey" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_inquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"institution" varchar(255) NOT NULL,
	"inquiryType" varchar(40) NOT NULL,
	"hardInquiry" boolean DEFAULT false NOT NULL,
	"occurredAt" timestamp with time zone NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dividend_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"investmentPositionId" integer,
	"assetCode" varchar(80) NOT NULL,
	"exDate" date,
	"paymentDate" date NOT NULL,
	"grossCents" bigint NOT NULL,
	"withholdingCents" bigint DEFAULT 0 NOT NULL,
	"netCents" bigint NOT NULL,
	"reinvestedCents" bigint DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'received' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"conversationId" varchar(160),
	"messageId" varchar(255),
	"actionType" varchar(80) NOT NULL,
	"entityType" varchar(80) NOT NULL,
	"entityId" varchar(120) NOT NULL,
	"beforeSnapshot" jsonb,
	"afterSnapshot" jsonb,
	"resultSnapshot" jsonb,
	"idempotencyKey" varchar(255) NOT NULL,
	"reversibleUntil" timestamp with time zone,
	"reversedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_independence_projections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"targetId" integer NOT NULL,
	"monthlyContributionCents" bigint NOT NULL,
	"assumedRealReturnBasisPoints" integer NOT NULL,
	"projectedMonths" integer,
	"assumptions" jsonb,
	"calculatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_independence_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"monthlySpendingCentsToday" bigint NOT NULL,
	"annualSpendingCentsToday" bigint NOT NULL,
	"withdrawalRateBasisPoints" integer NOT NULL,
	"targetRealCents" bigint NOT NULL,
	"inflationIndex" varchar(24) DEFAULT 'IPCA' NOT NULL,
	"baseDate" date NOT NULL,
	"currentPortfolioCents" bigint DEFAULT 0 NOT NULL,
	"ratioBasisPoints" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"seedKey" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"origin" varchar(24) NOT NULL,
	"ownerType" varchar(24) NOT NULL,
	"status" varchar(32) NOT NULL,
	"amountCents" bigint NOT NULL,
	"openAmountCents" bigint NOT NULL,
	"description" varchar(500) NOT NULL,
	"counterparty" varchar(255),
	"categoryId" integer,
	"expectedAccountId" integer,
	"dueDate" date NOT NULL,
	"competenceDate" date NOT NULL,
	"recurrenceId" integer,
	"installmentPlanId" integer,
	"installmentNumber" integer,
	"parentItemId" integer,
	"sourceMessageId" varchar(255),
	"idempotencyKey" varchar(255) NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"needsConfirmation" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"cancelledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"phase" varchar(40) NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"reason" text,
	"snapshot" jsonb,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endedAt" timestamp with time zone,
	"idempotencyKey" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"financialItemId" integer NOT NULL,
	"transactionId" integer NOT NULL,
	"amountCents" bigint NOT NULL,
	"settledAt" timestamp with time zone NOT NULL,
	"settlementType" varchar(24) NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"reversedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financing_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"financingQuoteId" integer,
	"lender" varchar(255) NOT NULL,
	"principalCents" bigint NOT NULL,
	"currentBalanceCents" bigint NOT NULL,
	"cetAnnualBasisPoints" integer NOT NULL,
	"installmentCents" bigint NOT NULL,
	"termMonths" integer NOT NULL,
	"startedAt" date NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financing_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"carQuoteId" integer,
	"lender" varchar(255) NOT NULL,
	"vehiclePriceCents" bigint NOT NULL,
	"downPaymentCents" bigint NOT NULL,
	"tradeInCents" bigint DEFAULT 0 NOT NULL,
	"financedCents" bigint NOT NULL,
	"nominalMonthlyBasisPoints" integer,
	"cetAnnualBasisPoints" integer NOT NULL,
	"termMonths" integer NOT NULL,
	"installmentCents" bigint NOT NULL,
	"totalPaidCents" bigint NOT NULL,
	"feesCents" bigint DEFAULT 0 NOT NULL,
	"hardCreditInquiry" boolean DEFAULT false NOT NULL,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"transactionId" integer NOT NULL,
	"incomeKind" varchar(40) NOT NULL,
	"availableCents" bigint NOT NULL,
	"allocatedCents" bigint DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'unallocated' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"description" varchar(500) NOT NULL,
	"planType" varchar(32) DEFAULT 'purchase' NOT NULL,
	"totalAmountCents" bigint NOT NULL,
	"installmentCount" integer NOT NULL,
	"firstDueDate" date NOT NULL,
	"accountId" integer,
	"creditCardId" integer,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"carQuoteId" integer,
	"insurer" varchar(255) NOT NULL,
	"annualPremiumCents" bigint NOT NULL,
	"deductibleCents" bigint,
	"coverage" jsonb,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"financialAccountId" integer,
	"institution" varchar(255) NOT NULL,
	"bucket" varchar(40) NOT NULL,
	"currency" varchar(3) DEFAULT 'BRL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_cashflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"investmentAccountId" integer NOT NULL,
	"transactionId" integer,
	"type" varchar(32) NOT NULL,
	"amountCents" bigint NOT NULL,
	"occurredAt" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_policy_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"riskProfile" varchar(40) NOT NULL,
	"horizonYears" integer,
	"liquidityNeeds" text,
	"targetAllocation" jsonb NOT NULL,
	"concentrationLimits" jsonb,
	"suitabilityConfirmedAt" timestamp with time zone,
	"version" varchar(40) NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"investmentAccountId" integer NOT NULL,
	"assetCode" varchar(80) NOT NULL,
	"assetClass" varchar(80) NOT NULL,
	"quantityMicrounits" bigint DEFAULT 0 NOT NULL,
	"costBasisCents" bigint DEFAULT 0 NOT NULL,
	"marketValueCents" bigint DEFAULT 0 NOT NULL,
	"valuedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_buffers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"accountId" integer,
	"name" varchar(160) NOT NULL,
	"targetCents" bigint NOT NULL,
	"protected" boolean DEFAULT true NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"seedKey" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"totalValueCents" bigint NOT NULL,
	"investableNetWorthCents" bigint NOT NULL,
	"allocation" jsonb,
	"capturedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurrence_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"itemKind" varchar(24) NOT NULL,
	"ownerType" varchar(24) NOT NULL,
	"description" varchar(500) NOT NULL,
	"frequency" varchar(32) NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"byWeekday" jsonb,
	"byMonthDay" integer,
	"businessDayOrdinal" integer,
	"startDate" date NOT NULL,
	"endDate" date,
	"timezone" varchar(80) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"amountMode" varchar(24) DEFAULT 'fixed' NOT NULL,
	"baseAmountCents" bigint NOT NULL,
	"expectedAccountId" integer,
	"categoryId" integer,
	"nextGenerationAt" timestamp with time zone,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"seedKey" varchar(160),
	"sourceMessageId" varchar(255),
	"idempotencyKey" varchar(255) NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_protocol_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"level" varchar(16) NOT NULL,
	"trigger" varchar(120) NOT NULL,
	"snapshot" jsonb,
	"actions" jsonb,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"resolvedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sinking_funds" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"accountId" integer,
	"name" varchar(255) NOT NULL,
	"purpose" varchar(80) NOT NULL,
	"targetCents" bigint DEFAULT 0 NOT NULL,
	"fundedCents" bigint DEFAULT 0 NOT NULL,
	"targetDate" date,
	"protected" boolean DEFAULT false NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"seedKey" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_in_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"assetId" integer NOT NULL,
	"dealer" varchar(255) NOT NULL,
	"offeredCents" bigint NOT NULL,
	"deductionsCents" bigint DEFAULT 0 NOT NULL,
	"netCents" bigint NOT NULL,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "code" varchar(120);--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "needsConfirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "closingDay" integer;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "dueDay" integer;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "creditLimitCents" bigint;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "paymentAccountId" integer;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "planVersion" varchar(24) DEFAULT '1.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "lifePlanningEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "currentPhase" varchar(40) DEFAULT 'CLEANUP' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "monthlyIncomeTargetCents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "income2027Confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "businessDayMode" varchar(32) DEFAULT 'banking' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "day30Adjustment" varchar(32) DEFAULT 'no_adjustment' NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_executions" ADD CONSTRAINT "allocation_executions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_executions" ADD CONSTRAINT "allocation_executions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_executions" ADD CONSTRAINT "allocation_executions_incomeTransactionId_financial_transactions_id_fk" FOREIGN KEY ("incomeTransactionId") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_policies" ADD CONSTRAINT "allocation_policies_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_policies" ADD CONSTRAINT "allocation_policies_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amortization_events" ADD CONSTRAINT "amortization_events_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amortization_events" ADD CONSTRAINT "amortization_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amortization_events" ADD CONSTRAINT "amortization_events_financingContractId_financing_contracts_id_fk" FOREIGN KEY ("financingContractId") REFERENCES "public"."financing_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_reviews" ADD CONSTRAINT "annual_reviews_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_reviews" ADD CONSTRAINT "annual_reviews_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_assetId_assets_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_quotes" ADD CONSTRAINT "car_quotes_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_quotes" ADD CONSTRAINT "car_quotes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cleanup_tasks" ADD CONSTRAINT "credit_cleanup_tasks_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cleanup_tasks" ADD CONSTRAINT "credit_cleanup_tasks_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_health_snapshots" ADD CONSTRAINT "credit_health_snapshots_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_health_snapshots" ADD CONSTRAINT "credit_health_snapshots_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_inquiries" ADD CONSTRAINT "credit_inquiries_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_inquiries" ADD CONSTRAINT "credit_inquiries_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_events" ADD CONSTRAINT "dividend_events_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_events" ADD CONSTRAINT "dividend_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_events" ADD CONSTRAINT "dividend_events_investmentPositionId_investment_positions_id_fk" FOREIGN KEY ("investmentPositionId") REFERENCES "public"."investment_positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_actions" ADD CONSTRAINT "financial_actions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_actions" ADD CONSTRAINT "financial_actions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_independence_projections" ADD CONSTRAINT "financial_independence_projections_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_independence_projections" ADD CONSTRAINT "financial_independence_projections_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_independence_projections" ADD CONSTRAINT "financial_independence_projections_targetId_financial_independence_targets_id_fk" FOREIGN KEY ("targetId") REFERENCES "public"."financial_independence_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_independence_targets" ADD CONSTRAINT "financial_independence_targets_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_independence_targets" ADD CONSTRAINT "financial_independence_targets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_categoryId_financial_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."financial_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_expectedAccountId_financial_accounts_id_fk" FOREIGN KEY ("expectedAccountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_recurrenceId_recurrence_rules_id_fk" FOREIGN KEY ("recurrenceId") REFERENCES "public"."recurrence_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_items" ADD CONSTRAINT "financial_items_installmentPlanId_installment_plans_id_fk" FOREIGN KEY ("installmentPlanId") REFERENCES "public"."installment_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_phases" ADD CONSTRAINT "financial_phases_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_phases" ADD CONSTRAINT "financial_phases_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_financialItemId_financial_items_id_fk" FOREIGN KEY ("financialItemId") REFERENCES "public"."financial_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settlements" ADD CONSTRAINT "financial_settlements_transactionId_financial_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_contracts" ADD CONSTRAINT "financing_contracts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_contracts" ADD CONSTRAINT "financing_contracts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_contracts" ADD CONSTRAINT "financing_contracts_financingQuoteId_financing_quotes_id_fk" FOREIGN KEY ("financingQuoteId") REFERENCES "public"."financing_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_quotes" ADD CONSTRAINT "financing_quotes_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_quotes" ADD CONSTRAINT "financing_quotes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_quotes" ADD CONSTRAINT "financing_quotes_carQuoteId_car_quotes_id_fk" FOREIGN KEY ("carQuoteId") REFERENCES "public"."car_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_transactionId_financial_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."financial_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_accountId_financial_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_creditCardId_financial_accounts_id_fk" FOREIGN KEY ("creditCardId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_carQuoteId_car_quotes_id_fk" FOREIGN KEY ("carQuoteId") REFERENCES "public"."car_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_financialAccountId_financial_accounts_id_fk" FOREIGN KEY ("financialAccountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cashflows" ADD CONSTRAINT "investment_cashflows_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cashflows" ADD CONSTRAINT "investment_cashflows_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cashflows" ADD CONSTRAINT "investment_cashflows_investmentAccountId_investment_accounts_id_fk" FOREIGN KEY ("investmentAccountId") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cashflows" ADD CONSTRAINT "investment_cashflows_transactionId_financial_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."financial_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_policy_statements" ADD CONSTRAINT "investment_policy_statements_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_policy_statements" ADD CONSTRAINT "investment_policy_statements_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_positions" ADD CONSTRAINT "investment_positions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_positions" ADD CONSTRAINT "investment_positions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_positions" ADD CONSTRAINT "investment_positions_investmentAccountId_investment_accounts_id_fk" FOREIGN KEY ("investmentAccountId") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_buffers" ADD CONSTRAINT "operating_buffers_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_buffers" ADD CONSTRAINT "operating_buffers_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_buffers" ADD CONSTRAINT "operating_buffers_accountId_financial_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_expectedAccountId_financial_accounts_id_fk" FOREIGN KEY ("expectedAccountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_categoryId_financial_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."financial_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_protocol_events" ADD CONSTRAINT "risk_protocol_events_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_protocol_events" ADD CONSTRAINT "risk_protocol_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_accountId_financial_accounts_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in_quotes" ADD CONSTRAINT "trade_in_quotes_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in_quotes" ADD CONSTRAINT "trade_in_quotes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_in_quotes" ADD CONSTRAINT "trade_in_quotes_assetId_assets_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_executions_idempotency_idx" ON "allocation_executions" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_policies_seed_idx" ON "allocation_policies" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX "allocation_policies_lookup_idx" ON "allocation_policies" USING btree ("tenantId","userId","phase","incomeKind","active");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_reviews_year_idx" ON "annual_reviews" USING btree ("tenantId","userId","reviewYear");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_seed_idx" ON "assets" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_cleanup_seed_idx" ON "credit_cleanup_tasks" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_health_month_idx" ON "credit_health_snapshots" USING btree ("tenantId","userId","sourceMonth");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_health_seed_idx" ON "credit_health_snapshots" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_actions_idempotency_idx" ON "financial_actions" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "financial_actions_recent_idx" ON "financial_actions" USING btree ("tenantId","userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_independence_seed_idx" ON "financial_independence_targets" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_items_idempotency_idx" ON "financial_items" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_items_source_message_idx" ON "financial_items" USING btree ("tenantId","userId","sourceMessageId");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_items_recurrence_competence_idx" ON "financial_items" USING btree ("recurrenceId","competenceDate");--> statement-breakpoint
CREATE INDEX "financial_items_due_idx" ON "financial_items" USING btree ("tenantId","userId","kind","status","dueDate");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_phases_idempotency_idx" ON "financial_phases" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "financial_phases_status_idx" ON "financial_phases" USING btree ("tenantId","userId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_settlements_idempotency_idx" ON "financial_settlements" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "financial_settlements_item_idx" ON "financial_settlements" USING btree ("financialItemId");--> statement-breakpoint
CREATE UNIQUE INDEX "income_events_transaction_idx" ON "income_events" USING btree ("tenantId","userId","transactionId");--> statement-breakpoint
CREATE UNIQUE INDEX "installment_plans_idempotency_idx" ON "installment_plans" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_positions_asset_idx" ON "investment_positions" USING btree ("investmentAccountId","assetCode");--> statement-breakpoint
CREATE UNIQUE INDEX "operating_buffers_seed_idx" ON "operating_buffers" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_snapshots_date_idx" ON "portfolio_snapshots" USING btree ("tenantId","userId","capturedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_rules_idempotency_idx" ON "recurrence_rules" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_rules_seed_idx" ON "recurrence_rules" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE INDEX "recurrence_rules_generation_idx" ON "recurrence_rules" USING btree ("status","nextGenerationAt");--> statement-breakpoint
CREATE UNIQUE INDEX "sinking_funds_seed_idx" ON "sinking_funds" USING btree ("tenantId","userId","seedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_tenant_code_idx" ON "financial_accounts" USING btree ("tenantId","userId","code");