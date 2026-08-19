export const ENV = {
  appUrl:
    process.env.APP_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : ""),
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  supabaseUrl:
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "",
  supabaseAuthKey:
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "",
  cronSecret: process.env.CRON_SECRET ?? "",
  whatsappWebhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET ?? "",
  baileysGatewayUrl: process.env.BAILEYS_GATEWAY_URL ?? "",
  baileysGatewayApiKey: process.env.BAILEYS_GATEWAY_API_KEY ?? "",
  n8nAgentSecret: process.env.N8N_AGENT_SECRET ?? "",
  n8nAgentWebhookUrl: process.env.N8N_AGENT_WEBHOOK_URL ?? "",
  n8nAgentTimeoutMs: Number(process.env.N8N_AGENT_TIMEOUT_MS ?? "45000"),
  allowPrivateUazapiUrls: process.env.ALLOW_PRIVATE_UAZAPI_URLS === "true",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  openFinanceApiUrl: process.env.OPEN_FINANCE_API_URL ?? "",
  openFinanceApiKey: process.env.OPEN_FINANCE_API_KEY ?? "",
  pluggyClientId: process.env.PLUGGY_CLIENT_ID ?? "",
  pluggyClientSecret: process.env.PLUGGY_CLIENT_SECRET ?? "",
  belvoSecretId: process.env.BELVO_SECRET_ID ?? "",
  belvoSecretPassword: process.env.BELVO_SECRET_PASSWORD ?? "",
};

export function getConfiguredAppOrigin() {
  if (!ENV.appUrl) return null;

  try {
    const url = new URL(ENV.appUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (ENV.isProduction && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
