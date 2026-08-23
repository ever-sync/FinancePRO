CREATE TABLE IF NOT EXISTS "whatsapp_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"integrationId" integer NOT NULL,
	"contactId" integer NOT NULL,
	"threadId" integer NOT NULL,
	"phoneNumber" varchar(32) NOT NULL,
	"textContent" text NOT NULL,
	"detectedIntent" varchar(80),
	"requiresConfirmation" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"idempotencyKey" varchar(255) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"providerMessageId" varchar(255),
	"messageId" integer,
	"lastError" text,
	"sentAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_integrationId_whatsapp_integrations_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."whatsapp_integrations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_contactId_whatsapp_contacts_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_threadId_assistant_threads_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."assistant_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_messageId_whatsapp_messages_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."whatsapp_messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_outbox_idempotency_idx" ON "whatsapp_outbox" USING btree ("tenantId","userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_dispatch_idx" ON "whatsapp_outbox" USING btree ("status","nextAttemptAt");