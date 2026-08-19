import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createContext } from "./context";
import { appRouter } from "../routers";
import healthRoutes from "../routes/health";
import whatsappWebhookRoutes from "../routes/whatsapp-uazapi-webhook";
import assistantCronRoutes from "../routes/assistant-cron";
import n8nAgentRoutes from "../routes/n8n-agent";
import {
  assistantCronRateLimiter,
  healthRateLimiter,
  n8nAgentRateLimiter,
  trpcRateLimiter,
  whatsappWebhookRateLimiter,
} from "./rateLimit";
import { securityHeaders } from "./securityHeaders";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use("/api/trpc", trpcRateLimiter);
  app.use("/api/whatsapp/uazapi/webhook", whatsappWebhookRateLimiter);
  app.use("/api/n8n/finance", n8nAgentRateLimiter);
  app.use("/api/cron", assistantCronRateLimiter);
  app.use(["/health", "/ready", "/metrics"], healthRateLimiter);
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: false }));

  app.use(healthRoutes);
  app.use(whatsappWebhookRoutes);
  app.use(assistantCronRoutes);
  app.use(n8nAgentRoutes);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}
