import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { WhatsAppManager } from "./whatsapp-manager.js";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  res.end(payload);
}

function secretsMatch(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isAuthorized(req: IncomingMessage, expected: string) {
  const authorization = req.headers.authorization || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  return Boolean(bearer && secretsMatch(bearer, expected));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 64 * 1024) throw new HttpError(413, "Request body is too large");
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export function createGatewayServer(options: {
  manager: WhatsAppManager;
  pool: Pool;
  apiKey: string;
  logger: Logger;
}) {
  const { manager, pool, apiKey, logger } = options;
  let lastPairingRequestAt = 0;

  return createServer(async (req, res) => {
    const startedAt = Date.now();
    const path = new URL(req.url || "/", "http://gateway.local").pathname;
    try {
      if (req.method === "GET" && path === "/healthz") {
        await pool.query("SELECT 1");
        return sendJson(res, 200, { ok: true });
      }
      if (!isAuthorized(req, apiKey)) {
        return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      }
      if (req.method === "GET" && path === "/v1/status") {
        return sendJson(res, 200, {
          ok: true,
          ...(await manager.getStatus()),
        });
      }
      if (req.method === "POST" && path === "/v1/pairing-code") {
        const now = Date.now();
        if (now - lastPairingRequestAt < 15_000) {
          throw new HttpError(
            429,
            "Wait before requesting another pairing code"
          );
        }
        const body = await readJson(req);
        if (typeof body.phoneNumber !== "string") {
          throw new HttpError(400, "phoneNumber is required");
        }
        lastPairingRequestAt = now;
        const pairingCode = await manager.requestPairingCode(body.phoneNumber);
        return sendJson(res, 200, { ok: true, pairingCode });
      }
      if (req.method === "POST" && path === "/v1/messages/send") {
        const body = await readJson(req);
        if (typeof body.to !== "string" || typeof body.text !== "string") {
          throw new HttpError(400, "to and text are required");
        }
        const message = await manager.sendText(body.to, body.text);
        return sendJson(res, 200, { ok: true, ...message });
      }
      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "Internal server error";
      logger[status >= 500 ? "error" : "warn"](
        {
          method: req.method,
          path,
          status,
          durationMs: Date.now() - startedAt,
        },
        message
      );
      return sendJson(res, status, {
        ok: false,
        error: status >= 500 ? "Gateway operation failed" : message,
      });
    }
  });
}
