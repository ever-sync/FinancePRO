import { type Request, type Response, Router } from "express";
import { ENV } from "../_core/env";
import { isStrongSecret, secretsMatch } from "../_core/secrets";
import {
  runFinancialDailyCron,
  dispatchWhatsAppOutboxQueue,
  runFinancialMonthEndCron,
  runFinancialMonthStartCron,
} from "../whatsapp";
import { runCanonicalFinancialAutomation } from "../financial-automation";

const router = Router();

export function isAuthorizedCronRequest(req: Request, secret = ENV.cronSecret) {
  if (!isStrongSecret(secret)) return false;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const header = req.header("x-cron-secret") || "";
  return secretsMatch(bearer, secret) || secretsMatch(header, secret);
}

function rejectUnauthorizedCron(req: Request, res: Response) {
  if (!isStrongSecret(ENV.cronSecret)) {
    res.status(503).json({
      ok: false,
      error: "CRON_SECRET deve ter ao menos 32 caracteres",
    });
    return true;
  }
  if (!isAuthorizedCronRequest(req)) {
    res.status(401).json({ ok: false, error: "Cron nao autorizado" });
    return true;
  }
  return false;
}

router.post("/api/cron/financial-daily", async (req, res) => {
  if (rejectUnauthorizedCron(req, res)) return;
  try {
    const result = await runFinancialDailyCron();
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro no cron diario",
    });
  }
});

router.post("/api/cron/financial-automation", async (req, res) => {
  if (rejectUnauthorizedCron(req, res)) return;
  try {
    const result = await runCanonicalFinancialAutomation();
    const outbox = await dispatchWhatsAppOutboxQueue();
    return res.status(200).json({ ok: true, ...result, outbox });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro na automacao financeira canonica",
    });
  }
});

router.post("/api/cron/financial-month-start", async (req, res) => {
  if (rejectUnauthorizedCron(req, res)) return;
  try {
    const result = await runFinancialMonthStartCron();
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro no cron de inicio do mes",
    });
  }
});

router.post("/api/cron/financial-month-end", async (req, res) => {
  if (rejectUnauthorizedCron(req, res)) return;
  try {
    const result = await runFinancialMonthEndCron();
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro no cron de fechamento do mes",
    });
  }
});

export default router;
