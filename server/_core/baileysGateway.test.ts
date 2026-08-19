import { afterEach, describe, expect, it } from "vitest";
import { normalizeBaileysGatewayUrl } from "./baileysGateway";

const originalAllowPrivate = process.env.ALLOW_PRIVATE_BAILEYS_URLS;

afterEach(() => {
  if (originalAllowPrivate == null) {
    delete process.env.ALLOW_PRIVATE_BAILEYS_URLS;
  } else {
    process.env.ALLOW_PRIVATE_BAILEYS_URLS = originalAllowPrivate;
  }
});

describe("normalizeBaileysGatewayUrl", () => {
  it("accepts a public HTTPS gateway", () => {
    expect(
      normalizeBaileysGatewayUrl(
        "https://baileys-gateway-production.up.railway.app/"
      )
    ).toBe("https://baileys-gateway-production.up.railway.app");
  });

  it("rejects insecure and private gateway URLs in production", () => {
    delete process.env.ALLOW_PRIVATE_BAILEYS_URLS;
    expect(() => normalizeBaileysGatewayUrl("http://example.com")).toThrow(
      /HTTPS/
    );
    expect(() => normalizeBaileysGatewayUrl("https://127.0.0.1")).toThrow(
      /host publico/
    );
  });

  it("rejects credentials and query parameters", () => {
    expect(() =>
      normalizeBaileysGatewayUrl("https://user:pass@example.com")
    ).toThrow(/credenciais/);
    expect(() =>
      normalizeBaileysGatewayUrl("https://example.com?token=secret")
    ).toThrow(/query string/);
  });
});
