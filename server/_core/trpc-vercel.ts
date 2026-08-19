import "dotenv/config";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { createContext } from "./context";
import { appRouter } from "../routers";
import { trpcRateLimiter } from "./rateLimit";
import { securityHeaders } from "./securityHeaders";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(trpcRateLimiter);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: false }));

app.use(
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

export default app;
