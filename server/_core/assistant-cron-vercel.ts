import express from "express";
import assistantCronRoutes from "../routes/assistant-cron";
import { assistantCronRateLimiter } from "./rateLimit";
import { securityHeaders } from "./securityHeaders";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use("/api/cron", assistantCronRateLimiter);
app.use(express.json({ limit: "1mb" }));
app.use(assistantCronRoutes);

export default app;
