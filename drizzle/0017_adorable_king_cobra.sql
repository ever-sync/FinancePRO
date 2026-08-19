CREATE TYPE "public"."agent_command_status" AS ENUM('pending', 'executing', 'executed', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "agent_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"integrationId" integer NOT NULL,
	"threadId" integer,
	"requestId" varchar(160) NOT NULL,
	"operation" varchar(20) NOT NULL,
	"entityType" varchar(40) NOT NULL,
	"entityId" integer,
	"payload" text NOT NULL,
	"summary" text NOT NULL,
	"confirmationCodeHash" varchar(64) NOT NULL,
	"status" "agent_command_status" DEFAULT 'pending' NOT NULL,
	"resultPayload" text,
	"expiresAt" timestamp NOT NULL,
	"confirmedAt" timestamp,
	"executedAt" timestamp,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_commands_user_request_idx" ON "agent_commands" USING btree ("userId","requestId");--> statement-breakpoint
CREATE INDEX "agent_commands_pending_idx" ON "agent_commands" USING btree ("integrationId","status","expiresAt");