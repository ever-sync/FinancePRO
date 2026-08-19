WITH duplicate_messages AS (
  SELECT
    message."id" AS duplicate_id,
    MIN(message."id") OVER (
      PARTITION BY message."integrationId", message."providerMessageId", message."direction"
    ) AS original_id
  FROM "whatsapp_messages" AS message
  WHERE message."providerMessageId" IS NOT NULL
)
UPDATE "notification_events" AS notification
SET "relatedMessageId" = duplicate_messages.original_id
FROM duplicate_messages
WHERE notification."relatedMessageId" = duplicate_messages.duplicate_id
  AND duplicate_messages.duplicate_id <> duplicate_messages.original_id;
--> statement-breakpoint
DELETE FROM "whatsapp_messages" AS duplicate
USING "whatsapp_messages" AS original
WHERE duplicate."id" > original."id"
  AND duplicate."integrationId" = original."integrationId"
  AND duplicate."providerMessageId" = original."providerMessageId"
  AND duplicate."direction" = original."direction"
  AND duplicate."providerMessageId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_provider_direction_idx"
ON "whatsapp_messages" ("integrationId", "providerMessageId", "direction");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenues_user_due_date_idx" ON "revenues" ("userId", "dueDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenues_user_status_idx" ON "revenues" ("userId", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_fixed_costs_user_period_idx" ON "company_fixed_costs" ("userId", "year", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_variable_costs_user_date_idx" ON "company_variable_costs" ("userId", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_user_status_idx" ON "employees" ("userId", "empStatus");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_user_idx" ON "suppliers" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_purchases_user_due_date_idx" ON "supplier_purchases" ("userId", "dueDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_fixed_costs_user_period_idx" ON "personal_fixed_costs" ("userId", "year", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_variable_costs_user_date_idx" ON "personal_variable_costs" ("userId", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "debts_user_status_idx" ON "debts" ("userId", "debtStatus");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reserve_funds_user_type_date_idx" ON "reserve_funds" ("userId", "fundType", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_integrations_instance_idx" ON "whatsapp_integrations" ("instanceId");
