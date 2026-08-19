import { createHmac } from "node:crypto";
import { isStrongSecret, secretsMatch } from "./secrets";

type AgentSessionPayload = {
  v: 1;
  integrationId: number;
  threadId: number;
  exp: number;
  requestId: string;
};

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createN8nAgentSessionToken(
  input: {
    integrationId: number;
    threadId: number;
    requestId: string;
    ttlSeconds?: number;
  },
  secret: string
) {
  if (!isStrongSecret(secret)) throw new Error("N8N_AGENT_SECRET invalido");
  const ttlSeconds = Math.max(30, Math.min(input.ttlSeconds ?? 120, 300));
  const payload: AgentSessionPayload = {
    v: 1,
    integrationId: input.integrationId,
    threadId: input.threadId,
    exp: Math.floor(Date.now() / 1_000) + ttlSeconds,
    requestId: input.requestId.slice(0, 255),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyN8nAgentSessionToken(
  token: string,
  secret: string
): AgentSessionPayload | null {
  if (!token || !isStrongSecret(secret)) return null;
  const [encodedPayload, receivedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !receivedSignature || extra.length > 0) return null;
  if (!secretsMatch(receivedSignature, sign(encodedPayload, secret)))
    return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<AgentSessionPayload>;
    if (
      payload.v !== 1 ||
      !Number.isInteger(payload.integrationId) ||
      Number(payload.integrationId) <= 0 ||
      !Number.isInteger(payload.threadId) ||
      Number(payload.threadId) <= 0 ||
      !Number.isInteger(payload.exp) ||
      Number(payload.exp) < Math.floor(Date.now() / 1_000) ||
      typeof payload.requestId !== "string" ||
      !payload.requestId
    ) {
      return null;
    }
    return payload as AgentSessionPayload;
  } catch {
    return null;
  }
}
