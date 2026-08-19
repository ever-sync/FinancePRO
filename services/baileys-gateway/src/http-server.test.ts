import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayServer } from "./http-server.js";
import type { WhatsAppManager, WhatsAppStatus } from "./whatsapp-manager.js";

const API_KEY = "a".repeat(32);
const openServers: ReturnType<typeof createGatewayServer>[] = [];

function baseStatus(overrides: Partial<WhatsAppStatus> = {}): WhatsAppStatus {
  return {
    sessionId: "financepro",
    connection: "waiting_pairing",
    registered: false,
    ready: false,
    pairingAvailable: true,
    pairingQrCode: "qr-payload",
    lastConnectedAt: null,
    lastDisconnectCode: null,
    pendingWebhooks: 0,
    ...overrides,
  };
}

async function startServer(manager: Partial<WhatsAppManager>) {
  const server = createGatewayServer({
    manager: manager as WhatsAppManager,
    pool: { query: vi.fn() } as unknown as Pool,
    apiKey: API_KEY,
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger,
  });
  openServers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function authorizedRequest(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

afterEach(async () => {
  await Promise.all(
    openServers
      .splice(0)
      .map(
        server => new Promise<void>(resolve => server.close(() => resolve()))
      )
  );
});

describe("Baileys gateway pairing HTTP flow", () => {
  it("returns the QR fallback when phone pairing is rejected", async () => {
    const requestPairingCode = vi.fn().mockResolvedValue({
      pairingCode: null,
      fallbackToQr: true,
      message: "Use o QR Code.",
    });
    const baseUrl = await startServer({ requestPairingCode });

    const response = await authorizedRequest(`${baseUrl}/v1/pairing-code`, {
      method: "POST",
      body: JSON.stringify({ phoneNumber: "5511999999999" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      pairingCode: null,
      fallbackToQr: true,
      message: "Use o QR Code.",
    });
    expect(requestPairingCode).toHaveBeenCalledWith("5511999999999");
  });

  it("resets only an unregistered session", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(baseStatus())
      .mockResolvedValueOnce(baseStatus({ connection: "connecting" }));
    const resetUnregisteredSession = vi.fn().mockResolvedValue(undefined);
    const baseUrl = await startServer({
      getStatus,
      resetUnregisteredSession,
    });

    const response = await authorizedRequest(`${baseUrl}/v1/session/reset`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(resetUnregisteredSession).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      registered: false,
      connection: "connecting",
    });
  });

  it("refuses to reset a linked session", async () => {
    const resetUnregisteredSession = vi.fn();
    const baseUrl = await startServer({
      getStatus: vi
        .fn()
        .mockResolvedValue(baseStatus({ registered: true, ready: true })),
      resetUnregisteredSession,
    });

    const response = await authorizedRequest(`${baseUrl}/v1/session/reset`, {
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(resetUnregisteredSession).not.toHaveBeenCalled();
  });
});
