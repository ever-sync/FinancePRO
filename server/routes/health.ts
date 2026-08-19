import { type Request, Router } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { isStrongSecret, secretsMatch } from "../_core/secrets";
import {
  checkSupabaseAuthConnection,
  type SupabaseAuthHealth,
} from "../_core/supabaseHealth";

const router = Router();

async function checkDatabaseConnection() {
  const db = await getDb();
  if (!db) {
    return { connected: false as const, error: "Database not available" };
  }

  await db.execute(sql`SELECT 1`);
  return { connected: true as const };
}

const AUTH_SUCCESS_CACHE_MS = 30_000;
const AUTH_FAILURE_CACHE_MS = 5_000;
let cachedAuthHealth: { value: SupabaseAuthHealth; expiresAt: number } | null =
  null;

async function checkAuthenticationConnection() {
  const now = Date.now();
  if (cachedAuthHealth && cachedAuthHealth.expiresAt > now) {
    return cachedAuthHealth.value;
  }

  const value = await checkSupabaseAuthConnection({
    supabaseUrl: ENV.supabaseUrl,
    supabaseAuthKey: ENV.supabaseAuthKey,
  });
  cachedAuthHealth = {
    value,
    expiresAt:
      now + (value.connected ? AUTH_SUCCESS_CACHE_MS : AUTH_FAILURE_CACHE_MS),
  };
  return value;
}

function safeHealthError(error: unknown) {
  if (ENV.isProduction) return "Dependency check failed";
  return error instanceof Error ? error.message : "Unknown error";
}

function isMetricsAuthorized(req: Request) {
  if (!isStrongSecret(ENV.cronSecret)) return false;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const header = req.header("x-cron-secret") || "";
  return (
    secretsMatch(bearer, ENV.cronSecret) || secretsMatch(header, ENV.cronSecret)
  );
}

router.get("/health", async (_req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    status: "OK",
    environment: process.env.NODE_ENV || "development",
    version: process.env.npm_package_version || "1.0.0",
  };

  try {
    const dbStatus = await checkDatabaseConnection();
    const authStatus = await checkAuthenticationConnection();
    if (!dbStatus.connected || !authStatus.connected) {
      const dependencyError = !dbStatus.connected
        ? dbStatus.error
        : authStatus.connected
          ? "Dependency check failed"
          : authStatus.error;
      return res.status(503).json({
        ...healthcheck,
        status: "ERROR",
        database: dbStatus.connected ? "connected" : "disconnected",
        authentication: authStatus.connected ? "connected" : "disconnected",
        error: dependencyError,
      });
    }

    return res.json({
      ...healthcheck,
      database: "connected",
      authentication: "connected",
    });
  } catch (error) {
    return res.status(503).json({
      ...healthcheck,
      status: "ERROR",
      database: "disconnected",
      error: safeHealthError(error),
    });
  }
});

router.get("/ready", async (_req, res) => {
  const readiness = {
    timestamp: new Date().toISOString(),
    status: "READY",
    checks: {} as Record<string, string>,
  };

  try {
    const dbStatus = await checkDatabaseConnection();
    const authStatus = await checkAuthenticationConnection();
    if (!dbStatus.connected || !authStatus.connected) {
      const dependencyError = !dbStatus.connected
        ? dbStatus.error
        : authStatus.connected
          ? "Dependency check failed"
          : authStatus.error;
      return res.status(503).json({
        ...readiness,
        status: "NOT_READY",
        checks: {
          ...readiness.checks,
          database: dbStatus.connected ? "connected" : "disconnected",
          authentication: authStatus.connected ? "connected" : "disconnected",
          error: dependencyError,
        },
      });
    }

    return res.json({
      ...readiness,
      checks: {
        ...readiness.checks,
        database: "connected",
        authentication: "connected",
      },
    });
  } catch (error) {
    return res.status(503).json({
      ...readiness,
      status: "NOT_READY",
      checks: {
        ...readiness.checks,
        database: "disconnected",
        error: safeHealthError(error),
      },
    });
  }
});

router.get("/metrics", async (req, res) => {
  if (!isMetricsAuthorized(req)) {
    return res.status(401).json({ error: "Metrics not authorized" });
  }
  try {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    const metrics = {
      timestamp: new Date().toISOString(),
      process: {
        uptime: Math.round(uptime),
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        },
      },
      node: {
        version: process.version,
        platform: process.platform,
      },
    };

    return res.json(metrics);
  } catch (error) {
    return res.status(500).json({ error: "Failed to retrieve metrics" });
  }
});

export default router;
