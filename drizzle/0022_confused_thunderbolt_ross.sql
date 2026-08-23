CREATE UNIQUE INDEX IF NOT EXISTS "financial_audit_events_request_idx" ON "financial_audit_events" USING btree ("tenantId","userId","action","requestId");
