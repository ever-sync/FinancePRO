import pino from "pino";
import { Pool } from "pg";
import { PostgresAuthStore } from "./auth-store.js";
import { loadConfig } from "./config.js";
import { createGatewayServer } from "./http-server.js";
import { WebhookOutbox } from "./outbox.js";
import { WhatsAppManager } from "./whatsapp-manager.js";

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "gatewayApiKey",
      "webhookSecret",
      "pairingCode",
      "qr",
    ],
    censor: "[REDACTED]",
  },
});
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 8,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
});
const authStore = new PostgresAuthStore(
  pool,
  config.sessionId,
  config.authEncryptionKey
);
const outbox = new WebhookOutbox(
  pool,
  config.sessionId,
  config.financeProWebhookUrl,
  config.financeProWebhookSecret,
  logger
);
const manager = new WhatsAppManager(
  authStore,
  outbox,
  config.sessionId,
  logger
);
const server = createGatewayServer({
  manager,
  pool,
  apiKey: config.gatewayApiKey,
  logger,
});

async function start() {
  await authStore.initialize();
  await outbox.initialize();
  outbox.start();
  server.listen(config.port, "0.0.0.0", () => {
    logger.info({ port: config.port }, "Baileys gateway is listening");
  });
  await manager.start();
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down Baileys gateway");
  outbox.stop();
  await manager.stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", error => {
  logger.error(
    { error: error instanceof Error ? error.message : "unknown" },
    "Unhandled promise rejection"
  );
});

start().catch(error => {
  logger.fatal(
    { error: error instanceof Error ? error.message : "unknown" },
    "Baileys gateway failed to start"
  );
  process.exit(1);
});
