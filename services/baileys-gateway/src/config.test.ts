import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnv = {
  DATABASE_URL: "postgresql://localhost/financepro",
  AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  GATEWAY_API_KEY: "g".repeat(32),
  FINANCEPRO_WEBHOOK_URL:
    "https://financepro.example.com/api/whatsapp/baileys/webhook",
  FINANCEPRO_WEBHOOK_SECRET: "w".repeat(32),
};

describe("loadConfig", () => {
  it("loads a production-safe configuration", () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(3000);
    expect(config.sessionId).toBe("financepro");
    expect(config.authEncryptionKey).toHaveLength(32);
  });

  it("rejects short API secrets", () => {
    expect(() => loadConfig({ ...validEnv, GATEWAY_API_KEY: "short" })).toThrow(
      /at least 32 bytes/
    );
  });

  it("rejects invalid encryption keys", () => {
    expect(() =>
      loadConfig({ ...validEnv, AUTH_ENCRYPTION_KEY: "not-a-key" })
    ).toThrow(/32-byte key/);
  });
});
