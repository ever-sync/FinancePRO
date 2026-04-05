export type BankConnectionProvider =
  | "open_finance"
  | "pluggy"
  | "belvo"
  | "manual_upload";

export type BankConnectionSyncMode = "api" | "file";

export type BankConnectionProfile = {
  id: number;
  label: string;
  institution: string;
  provider: BankConnectionProvider;
  sourceKind: "bank_account" | "credit_card";
  scope: "empresa" | "pessoal" | "misto";
  syncMode: BankConnectionSyncMode;
  notes?: string | null;
  status: "pronta" | "atencao" | "rascunho";
  lastImportedAt?: string | Date | null;
  lastSyncRequestedAt?: string | Date | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type BankProviderReadiness = {
  provider: BankConnectionProvider;
  label: string;
  configured: boolean;
  supportsApiSync: boolean;
  status: "ready" | "setup_required" | "manual_only";
  message: string;
};

export function getBankConnectionProviderLabel(provider: BankConnectionProvider) {
  const labels: Record<BankConnectionProvider, string> = {
    open_finance: "Open Finance",
    pluggy: "Pluggy",
    belvo: "Belvo",
    manual_upload: "Upload manual",
  };

  return labels[provider];
}

export function getBankConnectionSyncModeLabel(mode: BankConnectionSyncMode) {
  return mode === "api" ? "API" : "Arquivo";
}

export function getBankConnectionSourceKindLabel(sourceKind: BankConnectionProfile["sourceKind"]) {
  return sourceKind === "credit_card" ? "Cartao" : "Conta";
}
