import { type Request, Router } from "express";
import { ENV } from "../_core/env";
import { isStrongSecret, secretsMatch } from "../_core/secrets";
import { handleBaileysWebhook, handleUazapiWebhook } from "../whatsapp";

const router = Router();

export function isAuthorizedWhatsAppWebhook(
  req: Request,
  secret = ENV.whatsappWebhookSecret
) {
  if (!isStrongSecret(secret)) return false;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const header = req.header("x-webhook-secret") || "";
  const query = typeof req.query.secret === "string" ? req.query.secret : "";
  return (
    secretsMatch(bearer, secret) ||
    secretsMatch(header, secret) ||
    secretsMatch(query, secret)
  );
}

router.post("/api/whatsapp/uazapi/webhook", async (req, res) => {
  if (!isStrongSecret(ENV.whatsappWebhookSecret)) {
    return res.status(503).json({
      ok: false,
      error: "WHATSAPP_WEBHOOK_SECRET deve ter ao menos 32 caracteres",
    });
  }
  if (!isAuthorizedWhatsAppWebhook(req)) {
    return res.status(401).json({ ok: false, error: "Webhook nao autorizado" });
  }

  try {
    const result = await handleUazapiWebhook(req.body);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro ao processar webhook da Uazapi",
    });
  }
});

router.post("/api/whatsapp/baileys/webhook", async (req, res) => {
  if (!isStrongSecret(ENV.whatsappWebhookSecret)) {
    return res.status(503).json({
      ok: false,
      error: "WHATSAPP_WEBHOOK_SECRET deve ter ao menos 32 caracteres",
    });
  }
  if (!isAuthorizedWhatsAppWebhook(req)) {
    return res.status(401).json({ ok: false, error: "Webhook nao autorizado" });
  }

  try {
    const result = await handleBaileysWebhook(req.body);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro ao processar webhook do Baileys",
    });
  }
});

export default router;
