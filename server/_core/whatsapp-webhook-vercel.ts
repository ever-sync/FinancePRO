import express from "express";
import whatsappWebhookRoutes from "../routes/whatsapp-uazapi-webhook";
import n8nAgentRoutes from "../routes/n8n-agent";
import { n8nAgentRateLimiter, whatsappWebhookRateLimiter } from "./rateLimit";
import { securityHeaders } from "./securityHeaders";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use("/api/whatsapp/uazapi/webhook", whatsappWebhookRateLimiter);
app.use("/api/n8n/finance", n8nAgentRateLimiter);
app.use(express.json({ limit: "5mb" }));
app.use(whatsappWebhookRoutes);
app.use(n8nAgentRoutes);

export default app;
