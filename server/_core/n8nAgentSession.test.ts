import { describe, expect, it, vi } from "vitest";
import {
  createN8nAgentSessionToken,
  verifyN8nAgentSessionToken,
} from "./n8nAgentSession";

describe("n8n agent scoped sessions", () => {
  const secret = "test-agent-secret-with-more-than-32-characters";

  it("round-trips an integration and thread scope", () => {
    const token = createN8nAgentSessionToken(
      { integrationId: 11, threadId: 22, requestId: "message-1" },
      secret
    );
    expect(verifyN8nAgentSessionToken(token, secret)).toMatchObject({
      integrationId: 11,
      threadId: 22,
      requestId: "message-1",
    });
  });

  it("rejects tampering, another secret, and expired sessions", () => {
    const token = createN8nAgentSessionToken(
      {
        integrationId: 11,
        threadId: 22,
        requestId: "message-2",
        ttlSeconds: 30,
      },
      secret
    );
    expect(verifyN8nAgentSessionToken(`${token}x`, secret)).toBeNull();
    expect(verifyN8nAgentSessionToken(token, `${secret}-different`)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);
    expect(verifyN8nAgentSessionToken(token, secret)).toBeNull();
    vi.useRealTimers();
  });
});
