import axios, { AxiosError, type AxiosInstance } from "axios";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BaileysGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
    this.name = "BaileysGatewayError";
  }
}

export type BaileysGatewayConfig = {
  apiBaseUrl: string;
  apiToken: string;
};

function isPrivateIpAddress(address: string) {
  const normalized = address
    .toLowerCase()
    .split("%")[0]
    .replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateIpAddress(mapped);
  }
  const version = isIP(normalized);
  if (version === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff")
    );
  }
  return false;
}

export function normalizeBaileysGatewayUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("A URL do gateway Baileys e invalida.");
  }
  const allowPrivate = process.env.ALLOW_PRIVATE_BAILEYS_URLS === "true";
  if (
    url.protocol !== "https:" &&
    !(allowPrivate && url.protocol === "http:")
  ) {
    throw new Error("A URL do gateway Baileys deve usar HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "A URL do gateway Baileys nao pode conter credenciais, query string ou fragmento."
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isPrivateIpAddress(hostname)
  ) {
    if (!allowPrivate) {
      throw new Error(
        "A URL do gateway Baileys deve apontar para um host publico."
      );
    }
  }
  return url.toString().replace(/\/$/, "");
}

async function assertAllowedHostname(hostname: string) {
  if (process.env.ALLOW_PRIVATE_BAILEYS_URLS === "true") return;
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (isIP(normalized)) {
    if (isPrivateIpAddress(normalized)) {
      throw new Error("Host privado bloqueado para o gateway Baileys.");
    }
    return;
  }
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(result => isPrivateIpAddress(result.address))
  ) {
    throw new Error(
      "O host do gateway Baileys resolveu para uma rede privada e foi bloqueado."
    );
  }
}

export class BaileysGatewayClient {
  private readonly client: AxiosInstance;

  constructor(config: BaileysGatewayConfig) {
    this.client = axios.create({
      baseURL: normalizeBaileysGatewayUrl(config.apiBaseUrl),
      timeout: 30_000,
      maxRedirects: 0,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
    });
    this.client.interceptors.request.use(async request => {
      const requestUrl = new URL(this.client.getUri(request));
      normalizeBaileysGatewayUrl(requestUrl.origin);
      await assertAllowedHostname(requestUrl.hostname);
      return request;
    });
  }

  private async request<T>(fn: () => Promise<{ data: T }>) {
    try {
      return (await fn()).data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const payload = error.response?.data as
          | { error?: string; message?: string }
          | undefined;
        throw new BaileysGatewayError(
          payload?.error || payload?.message || error.message,
          error.response?.status ?? 500,
          error.response?.data
        );
      }
      throw error;
    }
  }

  getStatus() {
    return this.request<{
      ok: boolean;
      sessionId: string;
      connection: string;
      registered: boolean;
      ready: boolean;
      pairingAvailable: boolean;
      lastConnectedAt: string | null;
      pendingWebhooks: number;
    }>(() => this.client.get("/v1/status"));
  }

  requestPairingCode(phoneNumber: string) {
    return this.request<{ ok: boolean; pairingCode: string }>(() =>
      this.client.post("/v1/pairing-code", { phoneNumber })
    );
  }

  sendTextMessage(phoneNumber: string, text: string) {
    return this.request<{ ok: boolean; id: string; remoteJid: string }>(() =>
      this.client.post("/v1/messages/send", { to: phoneNumber, text })
    );
  }
}
