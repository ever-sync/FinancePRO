import axios, { AxiosError, type AxiosInstance } from "axios";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ENV } from "./env";

export class UazapiRequestError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "UazapiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

export type UazapiConfig = {
  apiBaseUrl: string;
  apiToken: string;
  instanceId: string;
};

function isLegacyRouteError(error: unknown) {
  return (
    error instanceof UazapiRequestError &&
    (error.status === 404 || error.status === 405)
  );
}

function isPrivateIpAddress(address: string) {
  const normalized = address
    .toLowerCase()
    .split("%")[0]
    .replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateIpAddress(mapped);
    const [highPart, lowPart] = mapped.split(":");
    const high = Number.parseInt(highPart, 16);
    const low = Number.parseInt(lowPart, 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return isPrivateIpAddress(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
      );
    }
  }
  const ipVersion = isIP(normalized);

  if (ipVersion === 4) {
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

  if (ipVersion === 6) {
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

export function normalizeUazapiBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("A URL base da Uazapi e invalida.");
  }

  const allowPrivate = ENV.allowPrivateUazapiUrls;
  if (
    url.protocol !== "https:" &&
    !(allowPrivate && url.protocol === "http:")
  ) {
    throw new Error("A URL base da Uazapi deve usar HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "A URL base da Uazapi nao pode conter credenciais, query string ou fragmento."
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
        "A URL base da Uazapi deve apontar para um host publico."
      );
    }
  }

  return url.toString().replace(/\/$/, "");
}

async function assertPublicHostname(hostname: string) {
  if (ENV.allowPrivateUazapiUrls) return;
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(normalizedHostname)) {
    if (isPrivateIpAddress(normalizedHostname))
      throw new Error("Host privado bloqueado para a integracao Uazapi.");
    return;
  }

  const addresses = await lookup(normalizedHostname, {
    all: true,
    verbatim: true,
  });
  if (
    addresses.length === 0 ||
    addresses.some(result => isPrivateIpAddress(result.address))
  ) {
    throw new Error(
      "O host da Uazapi resolveu para uma rede privada e foi bloqueado."
    );
  }
}

export class UazapiClient {
  private readonly client: AxiosInstance;
  private readonly instanceId: string;

  constructor(config: UazapiConfig) {
    this.instanceId = config.instanceId;
    this.client = axios.create({
      baseURL: normalizeUazapiBaseUrl(config.apiBaseUrl),
      timeout: 20_000,
      maxRedirects: 0,
      headers: {
        token: config.apiToken,
        apikey: config.apiToken,
        "Content-Type": "application/json",
      },
    });
    this.client.interceptors.request.use(async request => {
      const requestUrl = new URL(this.client.getUri(request));
      normalizeUazapiBaseUrl(requestUrl.origin);
      await assertPublicHostname(requestUrl.hostname);
      return request;
    });
  }

  private async request<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try {
      const { data } = await fn();
      return data;
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new UazapiRequestError(
          (error.response?.data as any)?.message ||
            (error.response?.data as any)?.error ||
            error.message,
          error.response?.status ?? 500,
          error.response?.data
        );
      }
      throw error;
    }
  }

  private async withLegacyFallback<T>(
    primary: () => Promise<T>,
    legacy: () => Promise<T>
  ): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      if (!isLegacyRouteError(error)) {
        throw error;
      }
    }

    return legacy();
  }

  async getInstanceStatus() {
    return this.withLegacyFallback(
      () =>
        this.request<Record<string, unknown>>(() =>
          this.client.get("/instance/status")
        ),
      () =>
        this.request<Record<string, unknown>>(() =>
          this.client.get(`/instance/status/${this.instanceId}`)
        )
    );
  }

  async configureWebhook(url: string) {
    return this.withLegacyFallback(
      () =>
        this.request<Record<string, unknown>>(() =>
          this.client.post("/webhook", {
            enabled: true,
            url,
            events: ["messages", "connection"],
            excludeMessages: ["wasSentByApi"],
            addUrlEvents: false,
            addUrlTypesMessages: false,
          })
        ),
      () =>
        this.request<Record<string, unknown>>(() =>
          this.client.post(`/webhook/edit/${this.instanceId}`, {
            url,
            enabled: true,
            local_map: false,
          })
        )
    );
  }

  async sendTextMessage(phoneNumber: string, message: string) {
    const normalizedNumber = phoneNumber.includes("@")
      ? phoneNumber.trim()
      : phoneNumber.replace(/\D/g, "");

    return this.withLegacyFallback(
      () =>
        this.request<Record<string, unknown>>(() =>
          this.client.post("/send/text", {
            number: normalizedNumber,
            text: message,
          })
        ),
      () =>
        this.request<Record<string, unknown>>(() =>
          this.client.post(`/message/sendText/${this.instanceId}`, {
            number: normalizedNumber,
            text: message,
          })
        )
    );
  }
}

export function normalizeWhatsAppPhone(value: string) {
  return value.includes("@") ? value.trim() : value.replace(/\D/g, "");
}
