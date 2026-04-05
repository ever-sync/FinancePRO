import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  CreditCard,
  FileSpreadsheet,
  Landmark,
  PiggyBank,
  Save,
  TrendingUp,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import {
  createEmptyFinancialImportMapping,
  detectImportDelimiter,
  extractInstallmentInfo,
  type FinancialStatementScope,
  type FinancialStatementSourceKind,
  type FinancialStatementSelectableTarget,
  getFinancialImportMappingFields,
  getFinancialImportTargetMeta,
  inferFinancialImportMapping,
  inferStatementSourceKind,
  normalizeImportDate,
  normalizeImportLookup,
  parseImportAmount,
  parseImportSource,
  parseImportInteger,
  parseSignedImportAmountFromColumns,
  resolveFinancialImportPreset,
  serializeParsedCsv,
  suggestFinancialImportCategory,
  suggestFinancialStatementDestination,
  suggestInvestmentType,
  suggestReserveFundType,
  type FinancialImportColumnKey,
  type FinancialImportMapping,
  type FinancialImportPreset,
  type FinancialImportReserveType,
  type FinancialImportTarget,
} from "@shared/financial-import";
import {
  type BankConnectionProfile,
} from "@/lib/bankConnections";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PreviewRow = {
  id: number;
  date: string;
  description: string;
  amount: string;
  category?: string;
  counterparty?: string;
  status?: string;
  notes?: string;
  extra?: string;
  error?: string;
  autoCategory?: boolean;
  balance?: string;
  monthlyPayment?: string;
  interestRate?: string;
  totalInstallments?: number;
  paidInstallments?: number;
  dueDay?: number;
  institution?: string;
  investmentType?: string;
  yieldAmount?: string;
  reserveType?: FinancialImportReserveType;
};

type ImportMode = "preset_import" | "statement_reconciliation";

type StatementPreviewRow = {
  id: number;
  date: string;
  description: string;
  counterparty?: string;
  signedAmount: number;
  absoluteAmount: string;
  balance?: string;
  selectedTarget: FinancialStatementSelectableTarget;
  suggestedTarget: FinancialStatementSelectableTarget;
  confidence: "alta" | "media" | "baixa";
  reason: string;
  category?: string;
  investmentType?: string;
  reserveFundType?: FinancialImportReserveType;
  installmentLabel?: string;
  installmentNumber?: number;
  installmentCount?: number;
  originalDescription?: string;
  error?: string;
};

type StatementProfile = {
  id: string;
  name: string;
  bankName: string;
  sourceKind: FinancialStatementSourceKind;
  scope: FinancialStatementScope;
  delimiter: string;
  mapping: FinancialImportMapping;
  createdAt: string;
  updatedAt: string;
};

const STATEMENT_PROFILE_STORAGE_KEY = "financepro.statementProfiles.v1";

function getDelimiterLabel(delimiter: string) {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ",") return "Virgula";
  return "Ponto e virgula";
}

function getImportTargetIcon(target: FinancialImportTarget) {
  if (target === "revenues") return ArrowUpCircle;
  if (target === "company_variable_costs") return Building2;
  if (target === "personal_variable_costs") return Wallet;
  if (target === "debts") return ArrowDownCircle;
  if (target === "investments") return TrendingUp;
  return PiggyBank;
}

function getPresetButtons(): Array<{
  key: FinancialImportPreset;
  label: string;
}> {
  return [
    { key: "company_variable_costs", label: "Custos empresa" },
    { key: "revenues", label: "Receitas" },
    { key: "personal_variable_costs", label: "Gastos pessoais" },
    { key: "debts", label: "Dividas" },
    { key: "investments", label: "Investimentos" },
    { key: "reserve_company", label: "Reserva empresa" },
    { key: "reserve_personal", label: "Reserva pessoal" },
  ];
}

function getStatementTargetLabel(target: FinancialStatementSelectableTarget) {
  const labels: Record<FinancialStatementSelectableTarget, string> = {
    skip: "Ignorar",
    revenues: "Receita empresa",
    company_variable_costs: "Custo empresa",
    personal_variable_costs: "Gasto pessoal",
    investments: "Investimento",
    reserve_company: "Reserva empresa",
    reserve_personal: "Reserva pessoal",
  };

  return labels[target];
}

function getStatementTargetBadge(target: FinancialStatementSelectableTarget) {
  if (target === "skip") return "manual";
  if (target === "revenues") return "empresa";
  if (target === "company_variable_costs") return "empresa";
  if (target === "personal_variable_costs") return "pessoal";
  if (target === "investments") return "investimento";
  return "reserva";
}

function hasMappedAmountColumns(mapping: FinancialImportMapping) {
  return Boolean(mapping.amount || mapping.credit || mapping.debit);
}

function resolveAbsoluteImportAmount(params: {
  target: FinancialImportTarget;
  amount?: string | null;
  credit?: string | null;
  debit?: string | null;
}) {
  const direct = parseImportAmount(params.amount);
  if (direct != null && direct > 0) return direct;

  const credit = parseImportAmount(params.credit);
  const debit = parseImportAmount(params.debit);

  if (params.target === "revenues") {
    return credit ?? debit ?? null;
  }

  if (
    params.target === "company_variable_costs" ||
    params.target === "personal_variable_costs" ||
    params.target === "investments" ||
    params.target === "reserve_funds"
  ) {
    return debit ?? credit ?? null;
  }

  return credit ?? debit ?? null;
}

function buildImportSuccessMessage(params: {
  imported: number;
  skippedDuplicates: number;
  label: string;
  totalAmount: string;
}) {
  const base = `${params.imported} registro(s) importados em ${params.label.toLowerCase()} (${formatCurrency(params.totalAmount)}).`;
  if (!params.skippedDuplicates) return base;
  return `${base} ${params.skippedDuplicates} duplicada(s) foram ignoradas.`;
}

function buildStatementImportSuccessMessage(params: {
  imported: number;
  skippedDuplicates: number;
  totalAmount: string;
}) {
  const base = `${params.imported} movimento(s) conciliados (${formatCurrency(params.totalAmount)}).`;
  if (!params.skippedDuplicates) return base;
  return `${base} ${params.skippedDuplicates} duplicada(s) foram ignoradas.`;
}

function getStatementSourceKindLabel(sourceKind: FinancialStatementSourceKind) {
  return sourceKind === "credit_card" ? "Fatura de cartao" : "Extrato bancario";
}

function normalizeBankConnectionProfile(profile: any): BankConnectionProfile {
  return {
    ...profile,
    provider: profile.provider as BankConnectionProfile["provider"],
    sourceKind: profile.sourceKind as BankConnectionProfile["sourceKind"],
    scope: profile.scope as BankConnectionProfile["scope"],
    syncMode: profile.syncMode as BankConnectionProfile["syncMode"],
    status: profile.status as BankConnectionProfile["status"],
  };
}

function readStoredStatementProfiles() {
  if (typeof window === "undefined") return [] as StatementProfile[];

  try {
    const raw = window.localStorage.getItem(STATEMENT_PROFILE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StatementProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredStatementProfiles(profiles: StatementProfile[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STATEMENT_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

function createStatementProfileId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `profile-${Date.now()}`;
}

function findMatchingStatementProfile(params: {
  profiles: StatementProfile[];
  fileName?: string;
  sourceLabel?: string;
  sourceKind: FinancialStatementSourceKind;
}) {
  const normalizedSource = normalizeImportLookup(`${params.fileName || ""} ${params.sourceLabel || ""}`);
  if (!normalizedSource) return null;

  return (
    params.profiles.find(profile => {
      if (profile.sourceKind !== params.sourceKind) return false;
      const bankName = normalizeImportLookup(profile.bankName);
      const name = normalizeImportLookup(profile.name);
      return Boolean(bankName && normalizedSource.includes(bankName)) || Boolean(name && normalizedSource.includes(name));
    }) || null
  );
}

function buildPreviewRows(params: {
  records: Array<Record<string, string>>;
  mapping: FinancialImportMapping;
  target: FinancialImportTarget;
  reserveFundType: FinancialImportReserveType;
  defaultCategory: string;
  defaultStatus: string;
  sourceLabel: string;
}): PreviewRow[] {
  return params.records.map((record, index) => {
    const rawDate = params.mapping.date ? record[params.mapping.date] || "" : "";
    const normalizedDate = normalizeImportDate(rawDate);
    const rawAmount = params.mapping.amount ? record[params.mapping.amount] || "" : "";
    const rawCredit = params.mapping.credit ? record[params.mapping.credit] || "" : "";
    const rawDebit = params.mapping.debit ? record[params.mapping.debit] || "" : "";
    const amountPreview = rawAmount || rawCredit || rawDebit;
    const parsedAmount = resolveAbsoluteImportAmount({
      target: params.target,
      amount: rawAmount,
      credit: rawCredit,
      debit: rawDebit,
    });
    const description =
      (params.mapping.description ? record[params.mapping.description] || "" : "").trim() ||
      (params.mapping.counterparty ? record[params.mapping.counterparty] || "" : "").trim() ||
      `Registro importado ${index + 1}`;
    const counterparty = (params.mapping.counterparty ? record[params.mapping.counterparty] || "" : "").trim();
    const notes = params.sourceLabel ? `Importado via CSV: ${params.sourceLabel}` : "Importado via CSV";

    if (
      params.target === "revenues" ||
      params.target === "company_variable_costs" ||
      params.target === "personal_variable_costs"
    ) {
      const autoCategory =
        !(params.mapping.category && record[params.mapping.category]?.trim()) &&
        params.defaultCategory.trim().length === 0;
      const category =
        (params.mapping.category ? record[params.mapping.category] || "" : "").trim() ||
        params.defaultCategory.trim() ||
        suggestFinancialImportCategory({
          target: params.target,
          description,
          counterparty,
        });
      const status =
        (params.mapping.status ? record[params.mapping.status] || "" : "").trim() ||
        params.defaultStatus;

      if (!params.mapping.date || !hasMappedAmountColumns(params.mapping)) {
        return {
          id: index,
          date: rawDate,
          description,
          amount: amountPreview,
          category,
          counterparty,
          status,
          notes,
          error: "Mapeie as colunas de data e valor, ou use credito/debito.",
        };
      }

      if (!normalizedDate) {
        return {
          id: index,
          date: rawDate,
          description,
          amount: amountPreview,
          category,
          counterparty,
          status,
          notes,
          error: "Data invalida.",
        };
      }

      if (parsedAmount == null || parsedAmount <= 0) {
        return {
          id: index,
          date: normalizedDate,
          description,
          amount: amountPreview,
          category,
          counterparty,
          status,
          notes,
          error: "Valor invalido.",
        };
      }

      return {
        id: index,
        date: normalizedDate,
        description,
        amount: parsedAmount.toFixed(2),
        category,
        counterparty,
        status,
        notes,
        autoCategory,
      };
    }

    if (params.target === "debts") {
      const balanceValue = params.mapping.balance ? record[params.mapping.balance] || "" : rawAmount;
      const balance = parseImportAmount(balanceValue);
      const monthlyPaymentValue = params.mapping.monthlyPayment
        ? record[params.mapping.monthlyPayment] || ""
        : "";
      const monthlyPayment = parseImportAmount(monthlyPaymentValue);
      const interestRateValue = params.mapping.interestRate
        ? record[params.mapping.interestRate] || ""
        : "";
      const interestRate = parseImportAmount(interestRateValue);
      const dueDayValue = params.mapping.dueDay ? record[params.mapping.dueDay] || "" : "";
      const dueDay =
        parseImportInteger(dueDayValue) ??
        (normalizedDate ? Number(normalizedDate.slice(-2)) : null);
      const totalInstallments = parseImportInteger(
        params.mapping.totalInstallments ? record[params.mapping.totalInstallments] || "" : ""
      );
      const paidInstallments = parseImportInteger(
        params.mapping.paidInstallments ? record[params.mapping.paidInstallments] || "" : ""
      );
      const status =
        (params.mapping.status ? record[params.mapping.status] || "" : "").trim() ||
        params.defaultStatus ||
        "ativa";
      const priority =
        (params.mapping.category ? record[params.mapping.category] || "" : "").trim() || "media";

      if (balance == null || balance <= 0) {
        return {
          id: index,
          date: normalizedDate || rawDate || "-",
          description,
          amount: balanceValue,
          category: priority,
          counterparty,
          status,
          notes,
          error: "Saldo atual invalido.",
        };
      }

      return {
        id: index,
        date: normalizedDate || rawDate || "-",
        description,
        amount: balance.toFixed(2),
        category: priority,
        counterparty,
        status,
        notes,
        balance: balance.toFixed(2),
        monthlyPayment: (monthlyPayment ?? balance).toFixed(2),
        interestRate: (interestRate ?? 0).toFixed(2),
        totalInstallments: totalInstallments ?? 1,
        paidInstallments: paidInstallments ?? 0,
        dueDay: dueDay ?? 1,
        extra: `Parcela ${formatCurrency((monthlyPayment ?? balance).toFixed(2))} • Juros ${(interestRate ?? 0).toFixed(2)}% • Dia ${dueDay ?? 1}`,
      };
    }

    if (params.target === "investments") {
      const depositAmount =
        resolveAbsoluteImportAmount({
          target: params.target,
          amount: rawAmount,
          credit: rawCredit,
          debit: rawDebit,
        }) ??
        parseImportAmount(params.mapping.balance ? record[params.mapping.balance] || "" : "");
      const balanceValue = params.mapping.balance ? record[params.mapping.balance] || "" : "";
      const currentBalance = parseImportAmount(balanceValue) ?? depositAmount;
      const yieldValue = params.mapping.yieldAmount ? record[params.mapping.yieldAmount] || "" : "";
      const yieldAmount = parseImportAmount(yieldValue) ?? Math.max((currentBalance ?? 0) - (depositAmount ?? 0), 0);
      const institution =
        (params.mapping.institution ? record[params.mapping.institution] || "" : "").trim() ||
        counterparty ||
        "Instituicao importada";
      const autoCategory = !(params.mapping.investmentType && record[params.mapping.investmentType]?.trim());
      const investmentType =
        (params.mapping.investmentType ? record[params.mapping.investmentType] || "" : "").trim() ||
        suggestInvestmentType({ description, institution });

      if (!params.mapping.date) {
        return {
          id: index,
          date: rawDate,
          description,
          amount: amountPreview || balanceValue,
          category: investmentType,
          counterparty: institution,
          notes,
          error: "Mapeie a coluna de data.",
        };
      }

      if (!normalizedDate) {
        return {
          id: index,
          date: rawDate,
          description,
          amount: amountPreview || balanceValue,
          category: investmentType,
          counterparty: institution,
          notes,
          error: "Data invalida.",
        };
      }

      if (depositAmount == null || depositAmount <= 0) {
        return {
          id: index,
          date: normalizedDate,
          description,
          amount: amountPreview || balanceValue,
          category: investmentType,
          counterparty: institution,
          notes,
          error: "Valor aportado invalido.",
        };
      }

      return {
        id: index,
        date: normalizedDate,
        description,
        amount: depositAmount.toFixed(2),
        category: investmentType,
        counterparty: institution,
        notes,
        autoCategory,
        institution,
        investmentType,
        balance: (currentBalance ?? depositAmount).toFixed(2),
        yieldAmount: yieldAmount.toFixed(2),
        extra: `Saldo ${formatCurrency((currentBalance ?? depositAmount).toFixed(2))} • Rendimento ${formatCurrency(yieldAmount.toFixed(2))}`,
      };
    }

    const reserveAmount = resolveAbsoluteImportAmount({
      target: params.target,
      amount: rawAmount,
      credit: rawCredit,
      debit: rawDebit,
    });
    const reserveType = suggestReserveFundType({
      description,
      explicitType:
        (params.mapping.reserveType ? record[params.mapping.reserveType] || "" : "").trim() ||
        params.reserveFundType,
    });

    if (!params.mapping.date || !hasMappedAmountColumns(params.mapping)) {
      return {
        id: index,
        date: rawDate,
        description,
        amount: amountPreview,
        category: reserveType,
        status: params.defaultStatus,
        notes,
        error: "Mapeie as colunas de data e valor, ou use credito/debito.",
      };
    }

    if (!normalizedDate) {
      return {
        id: index,
        date: rawDate,
        description,
        amount: amountPreview,
        category: reserveType,
        status: params.defaultStatus,
        notes,
        error: "Data invalida.",
      };
    }

    if (reserveAmount == null || reserveAmount <= 0) {
      return {
        id: index,
        date: normalizedDate,
        description,
        amount: amountPreview,
        category: reserveType,
        status: params.defaultStatus,
        notes,
        error: "Valor invalido.",
      };
    }

    return {
      id: index,
      date: normalizedDate,
      description,
      amount: reserveAmount.toFixed(2),
      category: reserveType,
      status: params.defaultStatus,
      notes,
      reserveType,
      extra: reserveType === "empresa" ? "Reserva operacional" : "Reserva pessoal",
    };
  });
}

function buildStatementPreviewRows(params: {
  records: Array<Record<string, string>>;
  mapping: FinancialImportMapping;
  scope: FinancialStatementScope;
  sourceKind: FinancialStatementSourceKind;
}): StatementPreviewRow[] {
  return params.records.map((record, index) => {
    const rawDate = params.mapping.date ? record[params.mapping.date] || "" : "";
    const date = normalizeImportDate(rawDate);
    const rawDescription =
      (params.mapping.description ? record[params.mapping.description] || "" : "").trim() ||
      (params.mapping.counterparty ? record[params.mapping.counterparty] || "" : "").trim() ||
      `Movimentacao ${index + 1}`;
    const installmentInfo = extractInstallmentInfo(rawDescription);
    const description = installmentInfo?.cleanedDescription || rawDescription;
    const counterparty = (params.mapping.counterparty ? record[params.mapping.counterparty] || "" : "").trim();
    const rawAmount = params.mapping.amount ? record[params.mapping.amount] || "" : "";
    const rawCredit = params.mapping.credit ? record[params.mapping.credit] || "" : "";
    const rawDebit = params.mapping.debit ? record[params.mapping.debit] || "" : "";
    const signedAmount = parseSignedImportAmountFromColumns({
      amount: rawAmount,
      credit: rawCredit,
      debit: rawDebit,
    });
    const balanceValue = params.mapping.balance ? record[params.mapping.balance] || "" : "";
    const parsedBalance = parseImportAmount(balanceValue);
    const amountPreview = rawAmount || rawCredit || rawDebit;

    if (!params.mapping.date || !hasMappedAmountColumns(params.mapping)) {
      return {
        id: index,
        date: rawDate || "-",
        description,
        counterparty,
        signedAmount: 0,
        absoluteAmount: amountPreview,
        selectedTarget: "skip",
        suggestedTarget: "skip",
        confidence: "baixa",
        reason: "Mapeie data e valor, ou use as colunas separadas de credito e debito.",
        error: "Colunas obrigatorias nao mapeadas.",
      };
    }

    if (!date) {
      return {
        id: index,
        date: rawDate || "-",
        description,
        counterparty,
        signedAmount: 0,
        absoluteAmount: amountPreview,
        selectedTarget: "skip",
        suggestedTarget: "skip",
        confidence: "baixa",
        reason: "A linha precisa de uma data valida.",
        error: "Data invalida.",
      };
    }

    if (signedAmount == null || signedAmount === 0) {
      return {
        id: index,
        date,
        description,
        counterparty,
        signedAmount: 0,
        absoluteAmount: amountPreview,
        selectedTarget: "skip",
        suggestedTarget: "skip",
        confidence: "baixa",
        reason: "Nao consegui ler um valor com sinal ou montar o sinal via credito/debito.",
        error: "Valor invalido.",
      };
    }

    const suggestion = suggestFinancialStatementDestination({
      description,
      counterparty,
      amount: signedAmount,
      scope: params.scope,
      sourceKind: params.sourceKind,
    });

    return {
      id: index,
      date,
      description,
      originalDescription: rawDescription,
      counterparty,
      signedAmount,
      absoluteAmount: Math.abs(signedAmount).toFixed(2),
      balance: parsedBalance != null ? parsedBalance.toFixed(2) : undefined,
      selectedTarget: suggestion.suggestedTarget,
      suggestedTarget: suggestion.suggestedTarget,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      category: suggestion.category,
      investmentType: suggestion.investmentType,
      reserveFundType: suggestion.reserveFundType,
      installmentLabel: installmentInfo?.label,
      installmentNumber: installmentInfo?.installmentNumber,
      installmentCount: installmentInfo?.installmentCount,
    };
  });
}

export default function ImportadorFinanceiro() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [importMode, setImportMode] = useState<ImportMode>("preset_import");
  const [target, setTarget] = useState<FinancialImportTarget>("company_variable_costs");
  const [reserveFundType, setReserveFundType] = useState<FinancialImportReserveType>("empresa");
  const [statementScope, setStatementScope] = useState<FinancialStatementScope>("misto");
  const [statementSourceKind, setStatementSourceKind] = useState<FinancialStatementSourceKind>("bank_account");
  const [rawCsv, setRawCsv] = useState("");
  const [delimiter, setDelimiter] = useState(";");
  const [sourceFormat, setSourceFormat] = useState<"csv" | "ofx">("csv");
  const [fileName, setFileName] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [defaultCategory, setDefaultCategory] = useState(
    getFinancialImportTargetMeta("company_variable_costs").defaultCategory
  );
  const [defaultStatus, setDefaultStatus] = useState(
    getFinancialImportTargetMeta("company_variable_costs").defaultStatus
  );
  const [mapping, setMapping] = useState<FinancialImportMapping>(createEmptyFinancialImportMapping());
  const [statementMapping, setStatementMapping] = useState<FinancialImportMapping>(
    createEmptyFinancialImportMapping()
  );
  const [statementTargetOverrides, setStatementTargetOverrides] = useState<
    Record<number, FinancialStatementSelectableTarget>
  >({});
  const [statementProfiles, setStatementProfiles] = useState<StatementProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileBankName, setProfileBankName] = useState("");
  const { data: rawBankConnections = [] } = trpc.bankConnections.list.useQuery();
  const bankConnections = rawBankConnections.map(connection => normalizeBankConnectionProfile(connection));

  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const guidedPreset = params.get("preset");
  const guidedSource = params.get("source");
  const guidedMode = params.get("mode");
  const guidedScope = params.get("scope");
  const guidedSourceKind = params.get("sourceKind");
  const guidedConnectionId = params.get("connectionId");
  const guidedMeta = resolveFinancialImportPreset(guidedPreset);
  const currentTabValue: FinancialImportPreset =
    target === "reserve_funds"
      ? reserveFundType === "empresa"
        ? "reserve_company"
        : "reserve_personal"
      : target;

  const meta = getFinancialImportTargetMeta(target, reserveFundType);
  const Icon = getImportTargetIcon(target);
  const StatementSourceIcon =
    statementSourceKind === "credit_card" ? CreditCard : Landmark;
  const parsedSource = rawCsv.trim()
    ? parseImportSource(rawCsv, delimiter)
    : { format: "csv" as const, data: { headers: [], records: [] } };
  const parsedCsv = parsedSource.data;
  const detectedSourceFormat = sourceFormat === "ofx" ? "ofx" : parsedSource.format;
  const matchedStatementProfile = findMatchingStatementProfile({
    profiles: statementProfiles,
    fileName,
    sourceLabel,
    sourceKind: statementSourceKind,
  });
  const visibleStatementProfiles = statementProfiles.filter(
    profile => profile.sourceKind === statementSourceKind
  );
  const activeBankConnection =
    bankConnections.find(connection => connection.id === Number(guidedConnectionId)) ?? null;
  const mappingFields = getFinancialImportMappingFields(target);

  useEffect(() => {
    setImportMode(guidedMode === "statement" ? "statement_reconciliation" : "preset_import");
  }, [guidedMode]);

  useEffect(() => {
    setStatementProfiles(readStoredStatementProfiles());
  }, []);

  useEffect(() => {
    if (
      guidedScope === "empresa" ||
      guidedScope === "pessoal" ||
      guidedScope === "misto"
    ) {
      setStatementScope(guidedScope);
    }
  }, [guidedScope]);

  useEffect(() => {
    if (guidedSourceKind === "credit_card" || guidedSourceKind === "bank_account") {
      setStatementSourceKind(guidedSourceKind);
    }
  }, [guidedSourceKind]);

  useEffect(() => {
    if (!activeBankConnection) return;
    setImportMode("statement_reconciliation");
    setStatementSourceKind(activeBankConnection.sourceKind as FinancialStatementSourceKind);
    setStatementScope(activeBankConnection.scope as FinancialStatementScope);
    setSourceLabel(current =>
      current.trim().length
        ? current
        : `${activeBankConnection.label} · ${activeBankConnection.institution}`
    );
    setProfileBankName(current =>
      current.trim().length ? current : activeBankConnection.institution
    );
    setProfileName(current => (current.trim().length ? current : activeBankConnection.label));
  }, [activeBankConnection]);

  useEffect(() => {
    if (!guidedPreset) return;
    const preset = resolveFinancialImportPreset(guidedPreset);
    setTarget(preset.target);
    setReserveFundType(preset.reserveFundType);
    const presetMeta = getFinancialImportTargetMeta(preset.target, preset.reserveFundType);
    setDefaultStatus(presetMeta.defaultStatus);
    setDefaultCategory(presetMeta.defaultCategory);
    setSourceLabel(current => (current.trim().length ? current : preset.title));
  }, [guidedPreset]);

  useEffect(() => {
    const nextMeta = getFinancialImportTargetMeta(target, reserveFundType);
    setDefaultStatus(nextMeta.defaultStatus);
    setDefaultCategory(nextMeta.defaultCategory);
  }, [target, reserveFundType]);

  useEffect(() => {
    if (!parsedCsv.headers.length) {
      setMapping(createEmptyFinancialImportMapping());
      setStatementMapping(createEmptyFinancialImportMapping());
      setStatementTargetOverrides({});
      return;
    }

    const inferred = inferFinancialImportMapping(parsedCsv.headers, target);
    setMapping(current => {
      const next = createEmptyFinancialImportMapping();
      (Object.keys(next) as FinancialImportColumnKey[]).forEach(key => {
        next[key] = parsedCsv.headers.includes(current[key]) ? current[key] : inferred[key];
      });
      return next;
    });

    const statementInferred = inferFinancialImportMapping(parsedCsv.headers, "company_variable_costs");
    setStatementMapping(current => {
      const next = createEmptyFinancialImportMapping();
      (Object.keys(next) as FinancialImportColumnKey[]).forEach(key => {
        next[key] = parsedCsv.headers.includes(current[key]) ? current[key] : statementInferred[key];
      });
      return next;
    });
    setStatementTargetOverrides({});
  }, [parsedCsv.headers.join("|"), target]);

  const previewRows = buildPreviewRows({
    records: parsedCsv.records,
    mapping,
    target,
    reserveFundType,
    defaultCategory,
    defaultStatus,
    sourceLabel: sourceLabel.trim() || fileName.trim(),
  });
  const validRows = previewRows.filter(row => !row.error);
  const invalidRows = previewRows.filter(row => row.error);
  const previewAmount = validRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const baseStatementRows = buildStatementPreviewRows({
    records: parsedCsv.records,
    mapping: statementMapping,
    scope: statementScope,
    sourceKind: statementSourceKind,
  });
  const statementRows = baseStatementRows.map(row => ({
    ...row,
    selectedTarget: statementTargetOverrides[row.id] ?? row.selectedTarget,
  }));
  const validStatementRows = statementRows.filter(row => !row.error);
  const statementReadyRows = validStatementRows.filter(row => row.selectedTarget !== "skip");
  const statementIgnoredRows = validStatementRows.filter(row => row.selectedTarget === "skip");
  const statementAmount = statementReadyRows.reduce(
    (sum, row) => sum + Number(row.absoluteAmount || 0),
    0
  );
  const statementCounts = statementRows.reduce<Record<string, number>>((acc, row) => {
    const key = row.selectedTarget;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const markConnectionImportedMut = trpc.bankConnections.markImported.useMutation();
  const importMut = trpc.financialImports.importCsv.useMutation({
    onSuccess: async data => {
      await Promise.all([
        utils.financialAdvisor.getOnboarding.invalidate(),
        utils.financialAdvisor.getSnapshot.invalidate(),
        utils.financialAdvisor.getDailyDigest.invalidate(),
        utils.financialAdvisor.getMonthClose.invalidate(),
        utils.assistantPlans.getCurrent.invalidate(),
        data.target === "revenues"
          ? utils.revenues.list.invalidate()
          : data.target === "company_variable_costs"
            ? utils.companyVariableCosts.list.invalidate()
            : data.target === "personal_variable_costs"
              ? utils.personalVariableCosts.list.invalidate()
              : data.target === "debts"
                ? utils.debts.list.invalidate()
                : data.target === "investments"
                  ? utils.investments.list.invalidate()
                  : utils.reserveFunds.list.invalidate(),
      ]);

      toast.success(
        buildImportSuccessMessage({
          imported: data.imported,
          skippedDuplicates: data.skippedDuplicates,
          label: meta.shortLabel,
          totalAmount: data.totalAmount,
        })
      );
      if (guidedConnectionId) {
        await markConnectionImportedMut.mutateAsync({ connectionId: Number(guidedConnectionId) });
        await utils.bankConnections.list.invalidate();
      }
    },
    onError: error => toast.error(error.message),
  });
  const importMixedMut = trpc.financialImports.importMixed.useMutation({
    onSuccess: async data => {
      await Promise.all([
        utils.financialAdvisor.getOnboarding.invalidate(),
        utils.financialAdvisor.getSnapshot.invalidate(),
        utils.financialAdvisor.getDailyDigest.invalidate(),
        utils.financialAdvisor.getMonthClose.invalidate(),
        utils.assistantPlans.getCurrent.invalidate(),
        utils.revenues.list.invalidate(),
        utils.companyVariableCosts.list.invalidate(),
        utils.personalVariableCosts.list.invalidate(),
        utils.debts.list.invalidate(),
        utils.investments.list.invalidate(),
        utils.reserveFunds.list.invalidate(),
      ]);

      toast.success(
        buildStatementImportSuccessMessage({
          imported: data.imported,
          skippedDuplicates: data.skippedDuplicates,
          totalAmount: data.totalAmount,
        })
      );
      if (guidedConnectionId) {
        await markConnectionImportedMut.mutateAsync({ connectionId: Number(guidedConnectionId) });
        await utils.bankConnections.list.invalidate();
      }
    },
    onError: error => toast.error(error.message),
  });

  const applyPreset = (presetKey: FinancialImportPreset, source?: string | null) => {
    const preset = resolveFinancialImportPreset(presetKey);
    setTarget(preset.target);
    setReserveFundType(preset.reserveFundType);
    const presetMeta = getFinancialImportTargetMeta(preset.target, preset.reserveFundType);
    setDefaultStatus(presetMeta.defaultStatus);
    setDefaultCategory(presetMeta.defaultCategory);
    setSourceLabel(current => (current.trim().length ? current : preset.title));

    if (typeof window !== "undefined") {
      const next = new URL(window.location.href);
      next.searchParams.set("preset", presetKey);
      if (source) next.searchParams.set("source", source);
      else next.searchParams.delete("source");
      window.history.replaceState({}, "", `${next.pathname}${next.search}`);
    }
  };

  const setImportModeWithUrl = (mode: ImportMode) => {
    setImportMode(mode);
    if (typeof window === "undefined") return;
    const next = new URL(window.location.href);
    if (mode === "statement_reconciliation") {
      next.searchParams.set("mode", "statement");
      next.searchParams.set("sourceKind", statementSourceKind);
    } else next.searchParams.delete("mode");
    if (mode !== "statement_reconciliation") {
      next.searchParams.delete("scope");
      next.searchParams.delete("sourceKind");
    }
    window.history.replaceState({}, "", `${next.pathname}${next.search}`);
  };

  const updateStatementScope = (scope: FinancialStatementScope) => {
    setStatementScope(scope);
    setStatementTargetOverrides({});
    if (typeof window === "undefined") return;
    const next = new URL(window.location.href);
    next.searchParams.set("mode", "statement");
    next.searchParams.set("scope", scope);
    next.searchParams.set("sourceKind", statementSourceKind);
    if (guidedSource) next.searchParams.set("source", guidedSource);
    window.history.replaceState({}, "", `${next.pathname}${next.search}`);
  };

  const updateStatementSourceKind = (sourceKind: FinancialStatementSourceKind) => {
    setStatementSourceKind(sourceKind);
    setStatementTargetOverrides({});
    if (typeof window === "undefined") return;
    const next = new URL(window.location.href);
    next.searchParams.set("mode", "statement");
    next.searchParams.set("scope", statementScope);
    next.searchParams.set("sourceKind", sourceKind);
    if (guidedSource) next.searchParams.set("source", guidedSource);
    window.history.replaceState({}, "", `${next.pathname}${next.search}`);
  };

  const applyStatementProfile = (profile: StatementProfile) => {
    setStatementSourceKind(profile.sourceKind);
    setStatementScope(profile.scope);
    setDelimiter(profile.delimiter || ";");
    setStatementMapping(profile.mapping);
    setStatementTargetOverrides({});
    setProfileName(profile.name);
    setProfileBankName(profile.bankName);

    if (typeof window !== "undefined") {
      const next = new URL(window.location.href);
      next.searchParams.set("mode", "statement");
      next.searchParams.set("scope", profile.scope);
      next.searchParams.set("sourceKind", profile.sourceKind);
      if (guidedSource) next.searchParams.set("source", guidedSource);
      window.history.replaceState({}, "", `${next.pathname}${next.search}`);
    }

    toast.success(`Regras aplicadas: ${profile.name}.`);
  };

  const saveCurrentStatementProfile = () => {
    const name = profileName.trim();
    const bankName = profileBankName.trim();

    if (!name || !bankName) {
      toast.error("Preencha nome do perfil e banco/cartao antes de salvar.");
      return;
    }

    if (!parsedCsv.headers.length) {
      toast.error("Carregue um extrato antes de salvar as regras.");
      return;
    }

    const timestamp = new Date().toISOString();
    const existingProfile = statementProfiles.find(profile =>
      normalizeImportLookup(profile.name) === normalizeImportLookup(name) &&
      normalizeImportLookup(profile.bankName) === normalizeImportLookup(bankName) &&
      profile.sourceKind === statementSourceKind
    );

    const nextProfile: StatementProfile = {
      id: existingProfile?.id || createStatementProfileId(),
      name,
      bankName,
      sourceKind: statementSourceKind,
      scope: statementScope,
      delimiter,
      mapping: statementMapping,
      createdAt: existingProfile?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    const nextProfiles = [
      nextProfile,
      ...statementProfiles.filter(profile => profile.id !== nextProfile.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    setStatementProfiles(nextProfiles);
    writeStoredStatementProfiles(nextProfiles);
    toast.success(`Perfil salvo para ${bankName}.`);
  };

  const deleteStatementProfile = (profileId: string) => {
    const nextProfiles = statementProfiles.filter(profile => profile.id !== profileId);
    setStatementProfiles(nextProfiles);
    writeStoredStatementProfiles(nextProfiles);
    toast.success("Perfil removido.");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const detectedDelimiter = detectImportDelimiter(text);
    const parsed = parseImportSource(text, detectedDelimiter);

    if (parsed.format === "ofx") {
      setRawCsv(serializeParsedCsv(parsed.data, ";"));
      setDelimiter(";");
      setSourceFormat("ofx");
    } else {
      setRawCsv(text);
      setDelimiter(detectedDelimiter);
      setSourceFormat("csv");
    }

    const nextLabel = file.name.replace(/\.[^.]+$/, "");
    setFileName(file.name);
    setSourceLabel(nextLabel);
    setProfileBankName(current => (current.trim().length ? current : nextLabel));
    setProfileName(current =>
      current.trim().length ? current : `${getStatementSourceKindLabel(inferStatementSourceKind({ fileName: file.name }))} ${nextLabel}`
    );

    if (importMode === "statement_reconciliation") {
      const inferredSourceKind = inferStatementSourceKind({ fileName: file.name });
      updateStatementSourceKind(inferredSourceKind);
    }
  };

  const handleImport = () => {
    if (!validRows.length) {
      toast.error("Nenhuma linha valida para importar.");
      return;
    }

    importMut.mutate({
      target,
      reserveFundType: target === "reserve_funds" ? reserveFundType : undefined,
      defaultCategory: meta.supportsCategory ? defaultCategory.trim() || undefined : undefined,
      defaultStatus: defaultStatus || undefined,
      sourceLabel: sourceLabel.trim() || fileName.trim() || undefined,
      rows: validRows.map(row => ({
        date: row.date,
        description: row.description,
        amount: row.amount,
        category: row.category,
        counterparty: row.counterparty,
        status: row.status,
        notes: row.notes,
        balance: row.balance,
        monthlyPayment: row.monthlyPayment,
        interestRate: row.interestRate,
        totalInstallments: row.totalInstallments,
        paidInstallments: row.paidInstallments,
        dueDay: row.dueDay,
        institution: row.institution,
        investmentType: row.investmentType,
        yieldAmount: row.yieldAmount,
        reserveType: row.reserveType,
      })),
    });
  };

  const handleStatementImport = () => {
    if (!statementReadyRows.length) {
      toast.error("Nenhuma linha pronta para importar no conciliador.");
      return;
    }

    const baseNote =
      statementSourceKind === "credit_card"
        ? "Conciliado da fatura do cartao"
        : "Conciliado do extrato bancario";
    const buildStatementNotes = (row: StatementPreviewRow) =>
      row.installmentLabel ? `${baseNote} | Parcela ${row.installmentLabel}` : baseNote;

    importMixedMut.mutate({
      sourceLabel:
        sourceLabel.trim() ||
        fileName.trim() ||
        (statementSourceKind === "credit_card" ? "Fatura conciliada" : "Extrato conciliado"),
      items: statementReadyRows.map(row => {
        if (row.selectedTarget === "revenues") {
          return {
            target: "revenues" as const,
            row: {
              date: row.date,
              description: row.description,
              amount: row.absoluteAmount,
              category:
                row.category ||
                suggestFinancialImportCategory({
                  target: "revenues",
                  description: row.description,
                  counterparty: row.counterparty,
                }),
              counterparty: row.counterparty,
              status: "recebido",
              notes: buildStatementNotes(row),
            },
          };
        }

        if (row.selectedTarget === "company_variable_costs") {
          return {
            target: "company_variable_costs" as const,
            row: {
              date: row.date,
              description: row.description,
              amount: row.absoluteAmount,
              category:
                row.category ||
                suggestFinancialImportCategory({
                  target: "company_variable_costs",
                  description: row.description,
                  counterparty: row.counterparty,
              }),
              counterparty: row.counterparty,
              status: "pago",
              totalInstallments:
                row.installmentNumber === 1 && row.installmentCount && row.installmentCount > 1
                  ? row.installmentCount
                  : undefined,
              notes: buildStatementNotes(row),
            },
          };
        }

        if (row.selectedTarget === "personal_variable_costs") {
          return {
            target: "personal_variable_costs" as const,
            row: {
              date: row.date,
              description: row.description,
              amount: row.absoluteAmount,
              category:
                row.category ||
                suggestFinancialImportCategory({
                  target: "personal_variable_costs",
                  description: row.description,
                  counterparty: row.counterparty,
              }),
              counterparty: row.counterparty,
              status: "pago",
              totalInstallments:
                row.installmentNumber === 1 && row.installmentCount && row.installmentCount > 1
                  ? row.installmentCount
                  : undefined,
              notes: buildStatementNotes(row),
            },
          };
        }

        if (row.selectedTarget === "investments") {
          return {
            target: "investments" as const,
            row: {
              date: row.date,
              description: row.description,
              amount: row.absoluteAmount,
              balance: row.balance || row.absoluteAmount,
              institution: row.counterparty,
              investmentType:
                row.investmentType ||
                suggestInvestmentType({
                  description: row.description,
                  institution: row.counterparty,
                }),
              yieldAmount:
                row.balance && Number(row.balance) > Number(row.absoluteAmount)
                  ? (Number(row.balance) - Number(row.absoluteAmount)).toFixed(2)
                  : "0.00",
              notes: buildStatementNotes(row),
            },
          };
        }

        const reserveFundType =
          row.selectedTarget === "reserve_company" ? "empresa" : "pessoal";

        return {
          target: "reserve_funds" as const,
          reserveFundType,
          row: {
            date: row.date,
            description: row.description,
            amount: row.absoluteAmount,
            reserveType: reserveFundType,
            notes: buildStatementNotes(row),
          },
        };
      }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileSpreadsheet className="size-6 text-emerald-600" />
            Importador financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            Suba extratos e planilhas CSV com mapeamento simples, categorizacao automatica e previa antes de gravar.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {detectedSourceFormat === "ofx"
            ? "Formato detectado: OFX convertido para conciliacao"
            : `Separador detectado: ${getDelimiterLabel(delimiter)}`}
        </div>
      </div>

      {guidedSource && guidedSource !== "bank-connection" ? (
        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium text-emerald-950">
                Fluxo guiado do mentor: {guidedMeta.title}
              </p>
              <p className="mt-1 text-sm text-emerald-900/80">{guidedMeta.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setLocation("/whatsapp/planos")}>
                Voltar ao onboarding
              </Button>
              <Button variant="outline" onClick={() => setLocation("/whatsapp/conversas")}>
                Abrir inbox do mentor
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeBankConnection ? (
        <Card className="border-orange-200 bg-orange-50/70">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium text-orange-950">
                Conexao bancaria ativa: {activeBankConnection.label}
              </p>
              <p className="mt-1 text-sm text-orange-900/80">
                {activeBankConnection.institution} · escopo {activeBankConnection.scope} ·{" "}
                {activeBankConnection.sourceKind === "credit_card" ? "cartao" : "conta"}.
                {activeBankConnection.lastImportedAt
                  ? ` Ultima importacao em ${new Intl.DateTimeFormat("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(activeBankConnection.lastImportedAt))}.`
                  : " Ainda sem importacao registrada."}
              </p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/integracoes-bancarias")}>
              Abrir central bancaria
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Modo de trabalho</CardTitle>
          <CardDescription>
            Use importacao por destino quando ja souber o modulo certo, ou conciliacao quando vier de extrato bancario misto.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Button
            variant={importMode === "preset_import" ? "default" : "outline"}
            className="justify-start"
            onClick={() => setImportModeWithUrl("preset_import")}
          >
            Importacao por destino
          </Button>
          <Button
            variant={importMode === "statement_reconciliation" ? "default" : "outline"}
            className="justify-start"
            onClick={() => setImportModeWithUrl("statement_reconciliation")}
          >
            Conciliacao de extrato
          </Button>
        </CardContent>
      </Card>

      {importMode === "preset_import" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Atalhos de importacao</CardTitle>
              <CardDescription>
                Escolha o que voce quer alimentar primeiro. O app ajusta o preset e o modelo esperado.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
              {getPresetButtons().map(button => (
                <Button
                  key={button.key}
                  variant={
                    (button.key === "reserve_company" &&
                      target === "reserve_funds" &&
                      reserveFundType === "empresa") ||
                    (button.key === "reserve_personal" &&
                      target === "reserve_funds" &&
                      reserveFundType === "pessoal") ||
                    (button.key === target && target !== "reserve_funds")
                      ? "default"
                      : "outline"
                  }
                  className="justify-start"
                  onClick={() => applyPreset(button.key, guidedSource)}
                >
                  {button.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Tabs value={currentTabValue} onValueChange={value => applyPreset(value as FinancialImportPreset, guidedSource)}>
            <TabsList className="grid w-full grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <TabsTrigger value="company_variable_costs">Custos empresa</TabsTrigger>
              <TabsTrigger value="revenues">Receitas</TabsTrigger>
              <TabsTrigger value="personal_variable_costs">Gastos pessoais</TabsTrigger>
              <TabsTrigger value="debts">Dividas</TabsTrigger>
              <TabsTrigger value="investments">Investimentos</TabsTrigger>
              <TabsTrigger value={reserveFundType === "empresa" ? "reserve_company" : "reserve_personal"}>
                Reserva
              </TabsTrigger>
            </TabsList>

            <TabsContent value={currentTabValue} className="mt-4 space-y-6">
          <Card className="border-zinc-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Icon className="size-5 text-zinc-700" />
                {meta.label}
              </CardTitle>
              <CardDescription>{meta.description}</CardDescription>
            </CardHeader>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader>
                <CardTitle>Arquivo ou cola manual</CardTitle>
                <CardDescription>
                  Use CSV com cabecalho ou OFX. O app detecta o formato, sugere o mapeamento e mostra como vai gravar cada linha.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label
                    htmlFor="csv-file"
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium"
                  >
                    <Upload className="size-4" />
                    Escolher CSV ou OFX
                  </Label>
                  <Input
                    id="csv-file"
                    type="file"
                    accept=".csv,.ofx,text/csv,application/x-ofx,application/ofx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRawCsv("");
                      setSourceFormat("csv");
                      setFileName("");
                      setSourceLabel("");
                    }}
                  >
                    Limpar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRawCsv(meta.templateCsv);
                      setDelimiter(detectImportDelimiter(meta.templateCsv));
                      setSourceFormat("csv");
                      setFileName("");
                      if (!sourceLabel.trim()) setSourceLabel(meta.shortLabel);
                    }}
                  >
                    Usar modelo
                  </Button>
                  {fileName ? (
                    <span className="text-sm text-muted-foreground">{fileName}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Nenhum arquivo carregado</span>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Fonte da importacao</Label>
                    <Input
                      value={sourceLabel}
                      onChange={event => setSourceLabel(event.target.value)}
                      placeholder="Ex.: Extrato Nubank marco"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Separador</Label>
                    <Select value={delimiter} onValueChange={value => setDelimiter(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value=";">Ponto e virgula (;)</SelectItem>
                        <SelectItem value=",">Virgula (,)</SelectItem>
                        <SelectItem value="	">Tab</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Conteudo do arquivo</Label>
                  <Textarea
                    value={rawCsv}
                    onChange={event => {
                      setRawCsv(event.target.value);
                      setSourceFormat("csv");
                    }}
                    rows={14}
                    placeholder={meta.templateCsv}
                  />
                  <p className="text-xs text-muted-foreground">
                    Aceita CSV com coluna `valor` ou colunas separadas de `credito` e `debito`.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Regras da importacao</CardTitle>
                <CardDescription>
                  {meta.requiredFieldSummary}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {target === "reserve_funds" ? (
                  <div className="space-y-1.5">
                    <Label>Tipo da reserva</Label>
                    <Select
                      value={reserveFundType}
                      onValueChange={value => setReserveFundType(value as FinancialImportReserveType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="empresa">Empresa</SelectItem>
                        <SelectItem value="pessoal">Pessoal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {meta.supportsCategory ? (
                  <div className="space-y-1.5">
                    <Label>Categoria padrao</Label>
                    <Input
                      value={defaultCategory}
                      onChange={event => setDefaultCategory(event.target.value)}
                      placeholder={meta.defaultCategory}
                    />
                  </div>
                ) : null}

                {meta.statusOptions.length > 1 ? (
                  <div className="space-y-1.5">
                    <Label>Status padrao</Label>
                    <Select value={defaultStatus} onValueChange={value => setDefaultStatus(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {meta.statusOptions.map(status => (
                          <SelectItem key={status} value={status}>
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="rounded-2xl border bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                    Status aplicado: <span className="font-medium text-zinc-900">{defaultStatus}</span>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border px-4 py-3">
                    <p className="text-sm text-muted-foreground">Linhas lidas</p>
                    <p className="mt-1 text-2xl font-semibold">{previewRows.length}</p>
                  </div>
                  <div className="rounded-2xl border px-4 py-3">
                    <p className="text-sm text-muted-foreground">Prontas para importar</p>
                    <p className="mt-1 text-2xl font-semibold text-emerald-700">{validRows.length}</p>
                  </div>
                  <div className="rounded-2xl border px-4 py-3">
                    <p className="text-sm text-muted-foreground">Valor total</p>
                    <p className="mt-1 text-2xl font-semibold">{formatCurrency(previewAmount)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                  {invalidRows.length > 0
                    ? `${invalidRows.length} linha(s) estao com erro e nao serao importadas.`
                    : "Se a previa estiver correta, voce ja pode importar em lote."}
                </div>

                <Button
                  className="w-full"
                  onClick={handleImport}
                  disabled={importMut.isPending || !validRows.length}
                >
                  {importMut.isPending ? "Importando..." : `Importar ${validRows.length} registro(s)`}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Mapeamento de colunas</CardTitle>
              <CardDescription>
                Ajuste so o que fizer sentido para este tipo de importacao. O resto pode ser inferido.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {mappingFields.map(field => (
                <div key={field.key} className="space-y-1.5">
                  <Label>{field.label}</Label>
                  <Select
                    value={mapping[field.key] || "__none__"}
                    onValueChange={value =>
                      setMapping(current => ({
                        ...current,
                        [field.key]: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar coluna" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nao usar</SelectItem>
                      {parsedCsv.headers.map(header => (
                        <SelectItem key={`${field.key}-${header}`} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.helper ? (
                    <p className="text-xs text-muted-foreground">{field.helper}</p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Previa da importacao</CardTitle>
              <CardDescription>
                A categoria ou tipo sugerido aparece direto na tabela quando o CSV nao trouxer isso pronto.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descricao</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Classificacao</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Observacao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Carregue ou cole um CSV para ver a previa.
                      </TableCell>
                    </TableRow>
                  ) : (
                    previewRows.slice(0, 12).map(row => (
                      <TableRow key={row.id}>
                        <TableCell>{row.date || "-"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.description}</div>
                          {row.counterparty ? (
                            <div className="text-xs text-muted-foreground">{row.counterparty}</div>
                          ) : null}
                          {row.extra ? (
                            <div className="text-xs text-muted-foreground">{row.extra}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.error ? row.amount || "-" : formatCurrency(row.amount)}
                        </TableCell>
                        <TableCell>
                          <div>{row.category || "-"}</div>
                          {row.autoCategory ? (
                            <div className="text-xs text-emerald-700">Sugerido automaticamente</div>
                          ) : null}
                        </TableCell>
                        <TableCell>{row.status || "-"}</TableCell>
                        <TableCell className={row.error ? "text-destructive" : "text-muted-foreground"}>
                          {row.error || "Pronto para importar"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Conciliador de extrato</CardTitle>
              <CardDescription>
                Suba um extrato bancario ou uma fatura CSV/OFX e revise a sugestao de destino de cada linha antes de importar.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Tipo da fonte</Label>
                    <Select
                      value={statementSourceKind}
                      onValueChange={value =>
                        updateStatementSourceKind(value as FinancialStatementSourceKind)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank_account">Extrato bancario</SelectItem>
                        <SelectItem value="credit_card">Fatura de cartao</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Escopo da conta</Label>
                    <Select value={statementScope} onValueChange={value => updateStatementScope(value as FinancialStatementScope)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="empresa">Conta da empresa</SelectItem>
                        <SelectItem value="pessoal">Conta pessoal</SelectItem>
                        <SelectItem value="misto">Extrato misto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Fonte da conciliacao</Label>
                    <Input
                      value={sourceLabel}
                      onChange={event => setSourceLabel(event.target.value)}
                      placeholder={
                        statementSourceKind === "credit_card"
                          ? "Ex.: Fatura Nubank abril"
                          : "Ex.: Extrato Itau abril"
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Label
                    htmlFor="statement-csv-file"
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium"
                  >
                    <Upload className="size-4" />
                    {statementSourceKind === "credit_card"
                      ? "Escolher fatura CSV ou OFX"
                      : "Escolher extrato CSV ou OFX"}
                  </Label>
                  <Input
                    id="statement-csv-file"
                    type="file"
                    accept=".csv,.ofx,text/csv,application/x-ofx,application/ofx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStatementTargetOverrides({})}
                  >
                    Reaplicar sugestoes
                  </Button>
                  {fileName ? (
                    <span className="text-sm text-muted-foreground">{fileName}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Nenhum arquivo carregado</span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>
                    {statementSourceKind === "credit_card" ? "Conteudo da fatura" : "Conteudo do extrato"}
                  </Label>
                  <Textarea
                    value={rawCsv}
                    onChange={event => {
                      setRawCsv(event.target.value);
                      setSourceFormat("csv");
                    }}
                    rows={14}
                    placeholder={"data;descricao;valor;saldo\n2026-04-01;PIX CLIENTE ACME;1500,00;12450,32\n2026-04-02;MERCADO DO BAIRRO;-245,90;12204,42"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Pode vir com `valor` assinado, colunas separadas de `credito/debito` ou em arquivo OFX.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border bg-zinc-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                        <StatementSourceIcon className="size-4" />
                        Regras salvas por banco ou cartao
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Salve o mapeamento atual para reaplicar em um clique na proxima importacao.
                      </p>
                    </div>
                    <div className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-zinc-700">
                      {getStatementSourceKindLabel(statementSourceKind)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <Input
                      value={profileName}
                      onChange={event => setProfileName(event.target.value)}
                      placeholder="Nome do perfil"
                    />
                    <Input
                      value={profileBankName}
                      onChange={event => setProfileBankName(event.target.value)}
                      placeholder="Banco ou cartao"
                    />
                    <Button type="button" variant="outline" onClick={saveCurrentStatementProfile}>
                      <Save className="mr-2 size-4" />
                      Salvar regras atuais
                    </Button>
                  </div>

                  {matchedStatementProfile ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="text-sm font-medium text-emerald-950">Perfil sugerido</p>
                      <p className="mt-1 text-sm text-emerald-900/80">
                        {matchedStatementProfile.name} • {matchedStatementProfile.bankName}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3"
                        onClick={() => applyStatementProfile(matchedStatementProfile)}
                      >
                        Aplicar perfil sugerido
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2">
                    {visibleStatementProfiles.length === 0 ? (
                      <div className="rounded-2xl border bg-white px-4 py-3 text-sm text-zinc-500">
                        Nenhum perfil salvo para este tipo de fonte ainda.
                      </div>
                    ) : (
                      visibleStatementProfiles
                        .slice(0, 4)
                        .map(profile => (
                          <div
                            key={profile.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-zinc-900">{profile.name}</p>
                              <p className="text-xs text-zinc-500">
                                {profile.bankName} • {profile.scope}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => applyStatementProfile(profile)}
                              >
                                Aplicar
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => deleteStatementProfile(profile.id)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border bg-zinc-50 px-4 py-4">
                  <p className="text-sm font-medium text-zinc-900">Resumo da conciliacao</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border bg-white px-4 py-3">
                      <p className="text-xs uppercase text-muted-foreground">Linhas validas</p>
                      <p className="mt-1 text-2xl font-semibold">{validStatementRows.length}</p>
                    </div>
                    <div className="rounded-2xl border bg-white px-4 py-3">
                      <p className="text-xs uppercase text-muted-foreground">Prontas para importar</p>
                      <p className="mt-1 text-2xl font-semibold text-emerald-700">{statementReadyRows.length}</p>
                    </div>
                    <div className="rounded-2xl border bg-white px-4 py-3">
                      <p className="text-xs uppercase text-muted-foreground">Ignoradas</p>
                      <p className="mt-1 text-2xl font-semibold">{statementIgnoredRows.length}</p>
                    </div>
                    <div className="rounded-2xl border bg-white px-4 py-3">
                      <p className="text-xs uppercase text-muted-foreground">Valor conciliado</p>
                      <p className="mt-1 text-2xl font-semibold">{formatCurrency(statementAmount)}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border bg-zinc-50 px-4 py-4 text-sm text-zinc-600">
                  <p className="font-medium text-zinc-900">Leitura automatica</p>
                  <p className="mt-2">
                    O conciliador sugere destino com base no sinal do valor, tipo da fonte, contexto da conta e palavras-chave da descricao.
                  </p>
                </div>

                <div className="rounded-2xl border bg-zinc-50 px-4 py-4">
                  <p className="text-sm font-medium text-zinc-900">Distribuicao atual</p>
                  <div className="mt-3 grid gap-2">
                    {([
                      "revenues",
                      "company_variable_costs",
                      "personal_variable_costs",
                      "investments",
                      "reserve_company",
                      "reserve_personal",
                      "skip",
                    ] as FinancialStatementSelectableTarget[]).map(targetOption => (
                      <div key={targetOption} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{getStatementTargetLabel(targetOption)}</span>
                        <span className="font-medium text-zinc-900">{statementCounts[targetOption] ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full"
                  disabled={importMixedMut.isPending || !statementReadyRows.length}
                  onClick={handleStatementImport}
                >
                  {importMixedMut.isPending
                    ? "Conciliando..."
                    : `Importar ${statementReadyRows.length} linha(s) conciliadas`}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mapeamento do extrato</CardTitle>
              <CardDescription>
                Data e valor com sinal sao obrigatorios, mas voce tambem pode mapear credito/debito separados. Saldo e contraparte ajudam a melhorar a sugestao.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
              {([
                ["date", "Data"],
                ["description", "Descricao"],
                ["amount", "Valor com sinal"],
                ["credit", "Credito"],
                ["debit", "Debito"],
                ["counterparty", "Contraparte"],
                ["balance", "Saldo"],
              ] as Array<[FinancialImportColumnKey, string]>).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Select
                    value={statementMapping[key] || "__none__"}
                    onValueChange={value =>
                      setStatementMapping(current => ({
                        ...current,
                        [key]: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar coluna" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nao usar</SelectItem>
                      {parsedCsv.headers.map(header => (
                        <SelectItem key={`${key}-${header}`} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Previa conciliada</CardTitle>
              <CardDescription>
                Revise o destino sugerido de cada linha e ajuste quando quiser antes de importar.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descricao</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Observacao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Carregue ou cole um extrato para ver a conciliacao.
                      </TableCell>
                    </TableRow>
                  ) : (
                    statementRows.slice(0, 18).map(row => (
                      <TableRow key={row.id}>
                        <TableCell>{row.date}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.description}</div>
                          {row.installmentLabel ? (
                            <div className="text-xs text-amber-700">
                              Parcela {row.installmentLabel}
                            </div>
                          ) : null}
                          {row.counterparty ? (
                            <div className="text-xs text-muted-foreground">{row.counterparty}</div>
                          ) : null}
                          {row.originalDescription && row.originalDescription !== row.description ? (
                            <div className="text-xs text-muted-foreground">
                              Original: {row.originalDescription}
                            </div>
                          ) : null}
                          {row.balance ? (
                            <div className="text-xs text-muted-foreground">
                              Saldo: {formatCurrency(row.balance)}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${row.signedAmount < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                          {row.signedAmount < 0 ? "-" : "+"}
                          {formatCurrency(row.absoluteAmount)}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{row.reason}</div>
                          <div className="text-xs text-muted-foreground">
                            Confianca {row.confidence} • sugestao {getStatementTargetLabel(row.suggestedTarget)}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          <Select
                            value={row.selectedTarget}
                            onValueChange={value =>
                              setStatementTargetOverrides(current => ({
                                ...current,
                                [row.id]: value as FinancialStatementSelectableTarget,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {([
                                "skip",
                                "revenues",
                                "company_variable_costs",
                                "personal_variable_costs",
                                "investments",
                                "reserve_company",
                                "reserve_personal",
                              ] as FinancialStatementSelectableTarget[]).map(option => (
                                <SelectItem key={`${row.id}-${option}`} value={option}>
                                  {getStatementTargetLabel(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Grupo: {getStatementTargetBadge(row.selectedTarget)}
                          </div>
                        </TableCell>
                        <TableCell className={row.error ? "text-destructive" : "text-muted-foreground"}>
                          {row.error
                            ? row.error
                            : row.installmentNumber === 1 &&
                                row.installmentCount &&
                                row.installmentCount > 1
                              ? `Pronto para importar e abrir ${row.installmentCount} parcelas`
                              : "Pronto para importar"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
