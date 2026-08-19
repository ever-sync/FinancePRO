import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./_core/rateLimit";
import { normalizeUazapiBaseUrl } from "./_core/uazapi";
import { secretsMatch } from "./_core/secrets";
import { checkSupabaseAuthConnection } from "./_core/supabaseHealth";
import { isAuthorizedCronRequest } from "./routes/assistant-cron";
import { isAuthorizedWhatsAppWebhook } from "./routes/whatsapp-uazapi-webhook";
import { isAuthorizedN8nAgentRequest } from "./routes/n8n-agent";

function requestWith(values: {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const headers = values.headers ?? {};
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    query: values.query ?? {},
  } as unknown as Request;
}

describe("sensitive endpoint authentication", () => {
  it("fails closed when no secret is configured", () => {
    expect(isAuthorizedCronRequest(requestWith({}), "")).toBe(false);
    expect(isAuthorizedWhatsAppWebhook(requestWith({}), "")).toBe(false);
    expect(isAuthorizedN8nAgentRequest(requestWith({}), "")).toBe(false);
  });

  it("accepts valid bearer/header secrets and rejects invalid values", () => {
    const secret = "a-secure-value-with-at-least-32-characters";
    const bearer = requestWith({
      headers: { authorization: `Bearer ${secret}` },
    });
    const header = requestWith({ headers: { "x-webhook-secret": secret } });
    const agentHeader = requestWith({ headers: { "x-agent-secret": secret } });
    const invalid = requestWith({ headers: { authorization: "Bearer wrong" } });

    expect(isAuthorizedCronRequest(bearer, secret)).toBe(true);
    expect(isAuthorizedWhatsAppWebhook(header, secret)).toBe(true);
    expect(isAuthorizedCronRequest(invalid, secret)).toBe(false);
    expect(isAuthorizedN8nAgentRequest(agentHeader, secret)).toBe(true);
    expect(secretsMatch(secret, secret)).toBe(true);
  });
});

describe("public endpoint rate limiting", () => {
  it("returns 429 after the configured request budget", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const req = { ip: "203.0.113.10", socket: {} } as Request;
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(function (this: unknown) {
        return this;
      }),
      json: vi.fn(function (this: unknown) {
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn();

    limiter(req, response, next);
    limiter(req, response, next);
    limiter(req, response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledWith(429);
  });
});

describe("Uazapi outbound URL policy", () => {
  it("accepts normalized public HTTPS URLs", () => {
    expect(normalizeUazapiBaseUrl("https://api.example.com/")).toBe(
      "https://api.example.com"
    );
  });

  it.each([
    "http://api.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::ffff:10.0.0.1]",
    "https://169.254.169.254/latest/meta-data",
    "https://user:password@example.com",
    "https://api.example.com?token=secret",
  ])("blocks unsafe endpoint %s", value => {
    expect(() => normalizeUazapiBaseUrl(value)).toThrow();
  });
});

describe("Supabase authentication health", () => {
  it("fails closed when configuration is missing", async () => {
    const fetchImpl = vi.fn();

    const result = await checkSupabaseAuthConnection({
      supabaseUrl: "",
      supabaseAuthKey: "",
      fetchImpl,
    });

    expect(result).toEqual({
      connected: false,
      error: "Supabase authentication is not configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects insecure remote URLs", async () => {
    const fetchImpl = vi.fn();

    const result = await checkSupabaseAuthConnection({
      supabaseUrl: "http://supabase.example.com",
      supabaseAuthKey: "public-key",
      fetchImpl,
    });

    expect(result.connected).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks the upstream auth health endpoint without following redirects", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));

    const result = await checkSupabaseAuthConnection({
      supabaseUrl: "https://project.supabase.co/custom/path",
      supabaseAuthKey: "public-key",
      fetchImpl,
    });

    expect(result).toEqual({ connected: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.toString()).toBe("https://project.supabase.co/auth/v1/health");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {
        apikey: "public-key",
        authorization: "Bearer public-key",
      },
    });
  });

  it("reports upstream failures without exposing response bodies", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));

    const result = await checkSupabaseAuthConnection({
      supabaseUrl: "https://project.supabase.co",
      supabaseAuthKey: "public-key",
      fetchImpl,
    });

    expect(result).toEqual({
      connected: false,
      error: "Supabase authentication returned HTTP 503",
    });
  });
});
