const REQUIRED_SECRET_BYTES = 32;

export type GatewayConfig = {
  port: number;
  databaseUrl: string;
  authEncryptionKey: Buffer;
  gatewayApiKey: string;
  financeProWebhookUrl: string;
  financeProWebhookSecret: string;
  sessionId: string;
  logLevel: string;
};

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseEncryptionKey(value: string) {
  const normalized = value.trim();
  const key = /^[a-f\d]{64}$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");
  if (key.length !== REQUIRED_SECRET_BYTES) {
    throw new Error(
      "AUTH_ENCRYPTION_KEY must be a base64 or hexadecimal 32-byte key"
    );
  }
  return key;
}

function parseSecret(name: string, env: NodeJS.ProcessEnv) {
  const value = required(name, env);
  if (Buffer.byteLength(value) < REQUIRED_SECRET_BYTES) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

function parseWebhookUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("FINANCEPRO_WEBHOOK_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("FINANCEPRO_WEBHOOK_URL contains unsupported URL parts");
  }
  return url.toString();
}

export function loadConfig(env = process.env): GatewayConfig {
  const port = Number(env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port");
  }

  const sessionId = env.SESSION_ID?.trim() || "financepro";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(sessionId)) {
    throw new Error(
      "SESSION_ID must contain only letters, numbers, underscores or hyphens"
    );
  }

  return {
    port,
    databaseUrl: required("DATABASE_URL", env),
    authEncryptionKey: parseEncryptionKey(required("AUTH_ENCRYPTION_KEY", env)),
    gatewayApiKey: parseSecret("GATEWAY_API_KEY", env),
    financeProWebhookUrl: parseWebhookUrl(
      required("FINANCEPRO_WEBHOOK_URL", env)
    ),
    financeProWebhookSecret: parseSecret("FINANCEPRO_WEBHOOK_SECRET", env),
    sessionId,
    logLevel: env.LOG_LEVEL?.trim() || "info",
  };
}
