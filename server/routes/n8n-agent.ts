import { type Request, Router } from "express";
import { ZodError } from "zod";
import { ENV } from "../_core/env";
import { isStrongSecret, secretsMatch } from "../_core/secrets";
import { verifyN8nAgentSessionToken } from "../_core/n8nAgentSession";
import {
  AgentToolError,
  agentToolRequestSchema,
  handleAgentTool,
} from "../n8n-agent";

const router = Router();

export function isAuthorizedN8nAgentRequest(
  req: Request,
  secret = ENV.n8nAgentSecret
) {
  if (!isStrongSecret(secret)) return false;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const header = req.header("x-agent-secret") || "";
  return secretsMatch(bearer, secret) || secretsMatch(header, secret);
}

router.post("/api/n8n/finance/tool", async (req, res) => {
  if (!isStrongSecret(ENV.n8nAgentSecret)) {
    return res.status(503).json({
      ok: false,
      code: "AGENT_NOT_CONFIGURED",
      error: "N8N_AGENT_SECRET deve ter ao menos 32 caracteres",
    });
  }
  if (!isAuthorizedN8nAgentRequest(req)) {
    return res
      .status(401)
      .json({
        ok: false,
        code: "UNAUTHORIZED",
        error: "Agente nao autorizado",
      });
  }

  try {
    const requestedAction =
      req.body && typeof req.body === "object" && "action" in req.body
        ? String(req.body.action)
        : "";
    const session = verifyN8nAgentSessionToken(
      req.header("x-agent-session") || "",
      ENV.n8nAgentSecret
    );
    if (requestedAction !== "health" && !session) {
      return res.status(401).json({
        ok: false,
        code: "INVALID_AGENT_SESSION",
        error: "Sessao do agente ausente ou expirada",
      });
    }
    const input = agentToolRequestSchema.parse({
      ...req.body,
      ...(session
        ? { integrationId: session.integrationId, threadId: session.threadId }
        : {}),
    });
    const result = await handleAgentTool(input);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Parametros invalidos",
        details: error.issues.map(issue => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    if (error instanceof AgentToolError) {
      return res
        .status(error.statusCode)
        .json({ ok: false, code: error.code, error: error.message });
    }
    console.error("[N8N Agent] Tool execution failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return res
      .status(500)
      .json({
        ok: false,
        code: "INTERNAL_ERROR",
        error: "Falha interna do agente",
      });
  }
});

export default router;
