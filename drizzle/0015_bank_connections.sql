CREATE TABLE IF NOT EXISTS "bank_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "label" varchar(255) NOT NULL,
  "institution" varchar(255) NOT NULL,
  "provider" varchar(40) DEFAULT 'open_finance' NOT NULL,
  "sourceKind" varchar(30) DEFAULT 'bank_account' NOT NULL,
  "scope" varchar(20) DEFAULT 'misto' NOT NULL,
  "syncMode" varchar(20) DEFAULT 'file' NOT NULL,
  "status" varchar(20) DEFAULT 'rascunho' NOT NULL,
  "notes" text,
  "lastImportedAt" timestamp,
  "lastSyncRequestedAt" timestamp,
  "lastSyncStatus" varchar(40),
  "lastSyncError" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
