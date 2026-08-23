ALTER TABLE "financial_profiles" ADD COLUMN IF NOT EXISTS "notificationsOptIn" boolean DEFAULT true NOT NULL;
