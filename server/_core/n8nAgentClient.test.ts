import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import {
  forwardFinancialMessageToN8n,
  normalizeN8nAgentWebhookUrl,
} from "./n8nAgentClient";

describe("n8n agent client", () => {
  const original = {
    secret: ENV.n8nAgentSecret,
    url: ENV.n8nAgentWebhookUrl,
    timeout: ENV.n8nAgentTimeoutMs,
  };

  afterEach(() => {
    ENV.n8nAgentSecret = original.secret;
    ENV.n8nAgentWebhookUrl = original.url;
    ENV.n8nAgentTimeoutMs = original.timeout;
  });

  it("only permits HTTPS or Railway private-network HTTP", () => {
    expect(
      normalizeN8nAgentWebhookUrl("https://n8n.example.com/webhook/agent")
    ).toBe("https://n8n.example.com/webhook/agent");
    expect(
      normalizeN8nAgentWebhookUrl(
        "http://n8n-webhook.railway.internal:5678/webhook/agent"
      )
    ).toBe("http://n8n-webhook.railway.internal:5678/webhook/agent");
    expect(() =>
      normalizeN8nAgentWebhookUrl("http://127.0.0.1:5678/webhook/agent")
    ).toThrow();
  });

  it("sends the scoped envelope and accepts the AI Agent output shape", async () => {
    ENV.n8nAgentSecret = "test-agent-secret-with-more-than-32-characters";
    ENV.n8nAgentWebhookUrl = "https://n8n.example.com/webhook/financepro-agent";
    ENV.n8nAgentTimeoutMs = 5_000;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-agent-secret"]).toBe(ENV.n8nAgentSecret);
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          integrationId: 11,
          threadId: 22,
          message: "Como esta meu caixa?",
        });
        return new Response(
          JSON.stringify({ output: "Seu caixa esta protegido." }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
    );

    const result = await forwardFinancialMessageToN8n(
      {
        integrationId: 11,
        threadId: 22,
        requestId: "message-1",
        message: "Como esta meu caixa?",
        timezone: "America/Sao_Paulo",
        recentConversation: [],
      },
      { fetchImpl: fetchImpl as typeof fetch }
    );

    expect(result.reply).toBe("Seu caixa esta protegido.");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
