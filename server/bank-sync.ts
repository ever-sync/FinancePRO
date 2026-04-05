import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";
import * as db from "./db";

type SupportedBankProvider = "open_finance" | "pluggy" | "belvo" | "manual_upload";
type SupportedSyncMode = "api" | "file";

type BankConnectionRecord = NonNullable<Awaited<ReturnType<typeof db.getBankConnectionById>>>;

export type BankProviderReadiness = {
  provider: SupportedBankProvider;
  label: string;
  configured: boolean;
  supportsApiSync: boolean;
  status: "ready" | "setup_required" | "manual_only";
  message: string;
};

export type BankSyncExecutionResult = {
  success: boolean;
  connection: Awaited<ReturnType<typeof db.getBankConnectionById>>;
  provider: SupportedBankProvider;
  syncStatus: string;
  message: string;
};

function getProviderLabel(provider: SupportedBankProvider) {
  if (provider === "pluggy") return "Pluggy";
  if (provider === "belvo") return "Belvo";
  if (provider === "manual_upload") return "Upload manual";
  return "Open Finance";
}

function getProviderReadiness(provider: SupportedBankProvider): BankProviderReadiness {
  if (provider === "manual_upload") {
    return {
      provider,
      label: getProviderLabel(provider),
      configured: true,
      supportsApiSync: false,
      status: "manual_only",
      message: "Esse provider opera por conciliacao manual via arquivo.",
    };
  }

  if (provider === "pluggy") {
    const configured = Boolean(ENV.pluggyClientId && ENV.pluggyClientSecret);
    return {
      provider,
      label: getProviderLabel(provider),
      configured,
      supportsApiSync: true,
      status: configured ? "ready" : "setup_required",
      message: configured
        ? "Credenciais Pluggy detectadas no backend."
        : "Faltam PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no backend.",
    };
  }

  if (provider === "belvo") {
    const configured = Boolean(ENV.belvoSecretId && ENV.belvoSecretPassword);
    return {
      provider,
      label: getProviderLabel(provider),
      configured,
      supportsApiSync: true,
      status: configured ? "ready" : "setup_required",
      message: configured
        ? "Credenciais Belvo detectadas no backend."
        : "Faltam BELVO_SECRET_ID e BELVO_SECRET_PASSWORD no backend.",
    };
  }

  const configured = Boolean(ENV.openFinanceApiUrl && ENV.openFinanceApiKey);
  return {
    provider,
    label: getProviderLabel(provider),
    configured,
    supportsApiSync: true,
    status: configured ? "ready" : "setup_required",
    message: configured
      ? "Endpoint de Open Finance configurado no backend."
      : "Faltam OPEN_FINANCE_API_URL e OPEN_FINANCE_API_KEY no backend.",
  };
}

export function listBankProviderReadiness(): BankProviderReadiness[] {
  return (["open_finance", "pluggy", "belvo", "manual_upload"] as SupportedBankProvider[]).map(
    provider => getProviderReadiness(provider)
  );
}

function normalizeProvider(value: string): SupportedBankProvider {
  if (value === "pluggy" || value === "belvo" || value === "manual_upload") return value;
  return "open_finance";
}

function normalizeSyncMode(value: string): SupportedSyncMode {
  return value === "api" ? "api" : "file";
}

async function finalizeSyncState(params: {
  userId: number;
  connectionId: number;
  provider: SupportedBankProvider;
  nextStatus: string;
  connectionStatus: "pronta" | "atencao" | "rascunho";
  error?: string | null;
  message: string;
}): Promise<BankSyncExecutionResult> {
  const connection = await db.updateBankConnectionSyncState(params.userId, params.connectionId, {
    status: params.connectionStatus,
    lastSyncStatus: params.nextStatus,
    lastSyncError: params.error ?? null,
    lastSyncRequestedAt: new Date(),
  });

  return {
    success: !params.error,
    connection,
    provider: params.provider,
    syncStatus: params.nextStatus,
    message: params.message,
  };
}

export async function requestBankConnectionSync(
  userId: number,
  connectionId: number
): Promise<BankSyncExecutionResult> {
  const connection = await db.getBankConnectionById(userId, connectionId);
  if (!connection) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Conexao bancaria nao encontrada." });
  }

  const provider = normalizeProvider(String(connection.provider));
  const syncMode = normalizeSyncMode(String(connection.syncMode));
  const readiness = getProviderReadiness(provider);

  if (syncMode !== "api") {
    return finalizeSyncState({
      userId,
      connectionId,
      provider,
      nextStatus: "manual_only",
      connectionStatus: "atencao",
      error: "Perfil configurado para conciliacao por arquivo.",
      message:
        "Essa conexao esta em modo arquivo. Use o conciliador para importar o extrato ou altere para modo API.",
    });
  }

  if (!readiness.supportsApiSync) {
    return finalizeSyncState({
      userId,
      connectionId,
      provider,
      nextStatus: "manual_only",
      connectionStatus: "atencao",
      error: readiness.message,
      message: readiness.message,
    });
  }

  if (!readiness.configured) {
    return finalizeSyncState({
      userId,
      connectionId,
      provider,
      nextStatus: "provider_setup_required",
      connectionStatus: "atencao",
      error: readiness.message,
      message: `${readiness.label} ainda nao esta pronto no backend. ${readiness.message}`,
    });
  }

  return finalizeSyncState({
    userId,
    connectionId,
    provider,
    nextStatus: "provider_ready",
    connectionStatus: "pronta",
    message: `${readiness.label} esta configurado no backend. A conexao ficou pronta para a proxima etapa de sincronizacao transacional automatica.`,
  });
}
