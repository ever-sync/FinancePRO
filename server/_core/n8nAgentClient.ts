import { ENV } from "./env";
import { isStrongSecret } from "./secrets";
import { createN8nAgentSessionToken } from "./n8nAgentSession";

type RecentConversationMessage = {
  direction: "inbound" | "outbound";
  text: string;
  createdAt: Date | string;
};

export type N8nAgentRequest = {
  integrationId: number;
  threadId: number;
  requestId: string;
  message: string;
  timezone: string;
  recentConversation: RecentConversationMessage[];
};

export type N8nAgentResponse = {
  reply: string;
  workflowExecutionId?: string | null;
};

function normalizeTimeout(value: number) {
  if (!Number.isFinite(value)) return 45_000;
  return Math.max(5_000, Math.min(Math.floor(value), 120_000));
}

export function normalizeN8nAgentWebhookUrl(
  rawUrl: string,
  production = ENV.isProduction
) {
  const url = new URL(rawUrl);
  if (url.username || url.password || url.hash) {
    throw new Error(
      "N8N_AGENT_WEBHOOK_URL nao pode conter credenciais ou fragmento"
    );
  }
  const privateRailwayHost = url.hostname.endsWith(".railway.internal");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && privateRailwayHost)
  ) {
    throw new Error(
      production
        ? "N8N_AGENT_WEBHOOK_URL deve usar HTTPS ou a rede privada da Railway"
        : "N8N_AGENT_WEBHOOK_URL deve usar HTTPS ou a rede privada da Railway"
    );
  }
  return url.toString();
}

export function isN8nAgentForwardingConfigured() {
  return Boolean(ENV.n8nAgentWebhookUrl) && isStrongSecret(ENV.n8nAgentSecret);
}

function extractReply(payload: unknown): N8nAgentResponse | null {
  const normalized = Array.isArray(payload) ? payload[0] : payload;
  if (!normalized || typeof normalized !== "object") return null;
  const record = normalized as Record<string, unknown>;
  const nestedData =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  const candidate =
    record.reply ??
    record.output ??
    record.text ??
    nestedData?.reply ??
    nestedData?.output;
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  const executionId = record.executionId ?? record.workflowExecutionId;
  return {
    reply: candidate.trim().slice(0, 3_900),
    workflowExecutionId:
      typeof executionId === "string" || typeof executionId === "number"
        ? String(executionId)
        : null,
  };
}

export async function forwardFinancialMessageToN8n(
  request: N8nAgentRequest,
  options?: { fetchImpl?: typeof fetch }
): Promise<N8nAgentResponse> {
  if (!isN8nAgentForwardingConfigured()) {
    throw new Error("Agente n8n nao configurado");
  }

  const webhookUrl = normalizeN8nAgentWebhookUrl(ENV.n8nAgentWebhookUrl);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    normalizeTimeout(ENV.n8nAgentTimeoutMs)
  );
  try {
    const response = await (options?.fetchImpl ?? fetch)(webhookUrl, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-agent-secret": ENV.n8nAgentSecret,
      },
      body: JSON.stringify({
        source: "financepro",
        integrationId: request.integrationId,
        threadId: request.threadId,
        requestId: request.requestId.slice(0, 255),
        message: request.message.slice(0, 4_000),
        timezone: request.timezone,
        sentAt: new Date().toISOString(),
        agentSessionToken: createN8nAgentSessionToken(
          {
            integrationId: request.integrationId,
            threadId: request.threadId,
            requestId: request.requestId,
            ttlSeconds:
              Math.ceil(normalizeTimeout(ENV.n8nAgentTimeoutMs) / 1_000) + 60,
          },
          ENV.n8nAgentSecret
        ),
        recentConversation: request.recentConversation.slice(-12).map(item => ({
          direction: item.direction,
          text: item.text.slice(0, 2_000),
          createdAt: new Date(item.createdAt).toISOString(),
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Agente n8n respondeu HTTP ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const parsed = extractReply(payload);
    if (!parsed) throw new Error("Agente n8n respondeu sem texto valido");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Tempo limite excedido ao consultar o agente n8n");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
