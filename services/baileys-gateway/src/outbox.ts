import type { Logger } from "pino";
import type { Pool } from "pg";

export type InboundPayload = {
  instanceId: string;
  providerMessageId: string;
  phoneNumber: string;
  displayName: string | null;
  text: string;
  rawPayload: Record<string, unknown>;
};

type OutboxRow = {
  id: string;
  payload: InboundPayload;
  attempts: number;
};

export class WebhookOutbox {
  private flushing = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly pool: Pool,
    private readonly sessionId: string,
    private readonly webhookUrl: string,
    private readonly webhookSecret: string,
    private readonly logger: Logger
  ) {}

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS baileys_webhook_outbox (
        id bigserial PRIMARY KEY,
        session_id varchar(120) NOT NULL,
        provider_message_id varchar(255) NOT NULL,
        payload jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (session_id, provider_message_id)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS baileys_webhook_outbox_pending_idx
      ON baileys_webhook_outbox (next_attempt_at)
      WHERE delivered_at IS NULL
    `);
    await this.pool.query(`
      DELETE FROM baileys_webhook_outbox
       WHERE delivered_at IS NOT NULL
         AND delivered_at < now() - interval '7 days'
    `);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), 5_000);
    this.timer.unref();
    void this.flush();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async enqueue(payload: InboundPayload) {
    await this.pool.query(
      `INSERT INTO baileys_webhook_outbox
        (session_id, provider_message_id, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (session_id, provider_message_id) DO NOTHING`,
      [this.sessionId, payload.providerMessageId, JSON.stringify(payload)]
    );
    void this.flush();
  }

  async pendingCount() {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM baileys_webhook_outbox
        WHERE session_id = $1 AND delivered_at IS NULL`,
      [this.sessionId]
    );
    return Number(result.rows[0]?.count || 0);
  }

  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const result = await this.pool.query<OutboxRow>(
        `SELECT id::text, payload, attempts
           FROM baileys_webhook_outbox
          WHERE session_id = $1
            AND delivered_at IS NULL
            AND next_attempt_at <= now()
          ORDER BY id
          LIMIT 20`,
        [this.sessionId]
      );
      for (const row of result.rows) await this.deliver(row);
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "Failed to flush the webhook outbox"
      );
    } finally {
      this.flushing = false;
    }
  }

  private async deliver(row: OutboxRow) {
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${this.webhookSecret}`,
          "content-type": "application/json",
          "user-agent": "FinancePRO-Baileys-Gateway/1.0",
        },
        body: JSON.stringify(row.payload),
      });
      if (!response.ok) {
        throw new Error(`FinancePRO webhook returned HTTP ${response.status}`);
      }
      await this.pool.query(
        `UPDATE baileys_webhook_outbox
            SET delivered_at = now(), last_error = NULL
          WHERE id = $1`,
        [row.id]
      );
    } catch (error) {
      const attempts = row.attempts + 1;
      const delaySeconds = Math.min(300, Math.max(5, 2 ** attempts));
      const message =
        error instanceof Error ? error.message.slice(0, 1_000) : "unknown";
      await this.pool.query(
        `UPDATE baileys_webhook_outbox
            SET attempts = $2,
                next_attempt_at = now() + ($3 * interval '1 second'),
                last_error = $4
          WHERE id = $1`,
        [row.id, attempts, delaySeconds, message]
      );
      this.logger.warn(
        { outboxId: row.id, attempts, error: message },
        "FinancePRO webhook delivery will be retried"
      );
    }
  }
}
