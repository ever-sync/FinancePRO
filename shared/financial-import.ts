export type FinancialImportTarget =
  | "revenues"
  | "company_variable_costs"
  | "personal_variable_costs"
  | "debts"
  | "investments"
  | "reserve_funds";

export type FinancialImportReserveType = "empresa" | "pessoal";

export type FinancialImportPreset =
  | FinancialImportTarget
  | "reserve_company"
  | "reserve_personal";

export type FinancialStatementScope = "empresa" | "pessoal" | "misto";

export type FinancialStatementSelectableTarget =
  | "skip"
  | "revenues"
  | "company_variable_costs"
  | "personal_variable_costs"
  | "investments"
  | "reserve_company"
  | "reserve_personal";

export type FinancialStatementSuggestion = {
  suggestedTarget: FinancialStatementSelectableTarget;
  confidence: "alta" | "media" | "baixa";
  reason: string;
  category?: string;
  investmentType?: string;
  reserveFundType?: FinancialImportReserveType;
};

export type FinancialImportColumnKey =
  | "date"
  | "description"
  | "amount"
  | "credit"
  | "debit"
  | "category"
  | "counterparty"
  | "status"
  | "balance"
  | "monthlyPayment"
  | "interestRate"
  | "totalInstallments"
  | "paidInstallments"
  | "dueDay"
  | "institution"
  | "investmentType"
  | "yieldAmount"
  | "reserveType";

export type FinancialImportMapping = Record<FinancialImportColumnKey, string>;

export type ParsedCsvData = {
  headers: string[];
  records: Array<Record<string, string>>;
};

export type ParsedImportSource = {
  format: "csv" | "ofx";
  data: ParsedCsvData;
};

export type FinancialImportFieldConfig = {
  key: FinancialImportColumnKey;
  label: string;
  helper?: string;
};

export type FinancialImportTargetMeta = {
  label: string;
  shortLabel: string;
  description: string;
  defaultCategory: string;
  defaultStatus: string;
  supportsCategory: boolean;
  statusOptions: string[];
  templateCsv: string;
  requiredFieldSummary: string;
};

export function createEmptyFinancialImportMapping(): FinancialImportMapping {
  return {
    date: "",
    description: "",
    amount: "",
    credit: "",
    debit: "",
    category: "",
    counterparty: "",
    status: "",
    balance: "",
    monthlyPayment: "",
    interestRate: "",
    totalInstallments: "",
    paidInstallments: "",
    dueDay: "",
    institution: "",
    investmentType: "",
    yieldAmount: "",
    reserveType: "",
  };
}

export function normalizeImportLookup(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function detectImportDelimiter(text: string) {
  const firstLines = text.split(/\r?\n/).slice(0, 3).join("\n");
  const candidates = [
    { value: ";", hits: (firstLines.match(/;/g) || []).length },
    { value: ",", hits: (firstLines.match(/,/g) || []).length },
    { value: "\t", hits: (firstLines.match(/\t/g) || []).length },
  ];
  candidates.sort((left, right) => right.hits - left.hits);
  return candidates[0]?.value || ";";
}

export function isOfxContent(text: string) {
  const normalized = String(text || "").toUpperCase();
  return normalized.includes("<OFX>") || normalized.includes("<STMTTRN>");
}

export function parseImportCsv(text: string, delimiter: string): ParsedCsvData {
  const rows: string[][] = [];
  let current = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      currentRow.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      currentRow.push(current.trim());
      if (currentRow.some(cell => cell.length > 0)) rows.push(currentRow);
      currentRow = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || currentRow.length > 0) {
    currentRow.push(current.trim());
    if (currentRow.some(cell => cell.length > 0)) rows.push(currentRow);
  }

  if (!rows.length) return { headers: [], records: [] };

  const seenHeaders = new Map<string, number>();
  const headers = rows[0].map((header, index) => {
    const base = header.trim() || `Coluna ${index + 1}`;
    const count = seenHeaders.get(base) ?? 0;
    seenHeaders.set(base, count + 1);
    return count > 0 ? `${base} (${count + 1})` : base;
  });

  const records = rows.slice(1).map(row => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });

  return { headers, records };
}

function extractOfxField(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function normalizeOfxDate(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function parseOfxContent(text: string): ParsedCsvData {
  const transactionBlocks = Array.from(
    text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi),
    match => match[1]
  );
  const headers = ["data", "descricao", "valor", "contraparte", "tipo", "documento"];
  const records = transactionBlocks.map(block => {
    const name = extractOfxField(block, "NAME");
    const memo = extractOfxField(block, "MEMO");
    const fitId = extractOfxField(block, "FITID");
    const trnType = extractOfxField(block, "TRNTYPE");
    const posted = normalizeOfxDate(extractOfxField(block, "DTPOSTED"));
    const amount = extractOfxField(block, "TRNAMT");

    return {
      data: posted,
      descricao: memo || name || fitId || "Movimentacao OFX",
      valor: amount,
      contraparte: name || "",
      tipo: trnType,
      documento: fitId,
    };
  });

  return { headers, records };
}

export function parseImportSource(text: string, delimiter: string): ParsedImportSource {
  if (isOfxContent(text)) {
    return {
      format: "ofx",
      data: parseOfxContent(text),
    };
  }

  return {
    format: "csv",
    data: parseImportCsv(text, delimiter),
  };
}

export function serializeParsedCsv(data: ParsedCsvData, delimiter = ";") {
  if (!data.headers.length) return "";

  const escapeCell = (value: string) => {
    if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  return [
    data.headers.join(delimiter),
    ...data.records.map(record =>
      data.headers.map(header => escapeCell(String(record[header] ?? ""))).join(delimiter)
    ),
  ].join("\n");
}

export function normalizeImportDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const brMatch = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function parseImportAmount(value?: string | number | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.abs(value) : null;
  }

  const cleaned = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[R$\u00A0]/g, "");
  if (!cleaned) return null;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    const parsed = Number.parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? Math.abs(parsed) : null;
  }

  if (cleaned.includes(",")) {
    const parsed = Number.parseFloat(cleaned.replace(",", "."));
    return Number.isFinite(parsed) ? Math.abs(parsed) : null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

export function parseSignedImportAmount(value?: string | number | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const negative = /^\s*-/.test(raw) || /\(\s*[^)]+\s*\)$/.test(raw);
  const cleaned = raw
    .replace(/[()]/g, "")
    .replace(/\s+/g, "")
    .replace(/[R$\u00A0]/g, "");

  if (!cleaned) return null;

  let parsed: number | null = null;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    const candidate = Number.parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    parsed = Number.isFinite(candidate) ? candidate : null;
  } else if (cleaned.includes(",")) {
    const candidate = Number.parseFloat(cleaned.replace(",", "."));
    parsed = Number.isFinite(candidate) ? candidate : null;
  } else {
    const candidate = Number.parseFloat(cleaned);
    parsed = Number.isFinite(candidate) ? candidate : null;
  }

  if (parsed == null) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export function parseSignedImportAmountFromColumns(params: {
  amount?: string | number | null;
  credit?: string | number | null;
  debit?: string | number | null;
}) {
  const direct = parseSignedImportAmount(params.amount);
  if (direct != null && direct !== 0) return direct;

  const credit = parseImportAmount(params.credit);
  const debit = parseImportAmount(params.debit);

  if (credit != null && credit > 0 && (!debit || debit <= 0)) return credit;
  if (debit != null && debit > 0 && (!credit || credit <= 0)) return -debit;
  if (credit != null && credit > 0) return credit;
  if (debit != null && debit > 0) return -debit;
  return null;
}

export function parseImportInteger(value?: string | number | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  const cleaned = String(value ?? "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function suggestFinancialImportCategory(params: {
  target: FinancialImportTarget;
  description?: string | null;
  counterparty?: string | null;
}) {
  const normalized = normalizeImportLookup(
    `${params.description || ""} ${params.counterparty || ""}`
  );

  if (params.target === "revenues") {
    if (/(pix|ted|doc|transfer|deposito|deposit)/.test(normalized)) return "Transferencias recebidas";
    if (/(mensalidade|assinatura|subscription|retainer)/.test(normalized)) return "Receita recorrente";
    if (/(consultoria|servico|serviço|projeto|venda|sale|cliente)/.test(normalized)) return "Servicos e vendas";
    if (/(juros|yield|rendimento|interest)/.test(normalized)) return "Rendimentos";
    if (/(reembolso|cashback)/.test(normalized)) return "Reembolsos";
    return "Receita importada";
  }

  if (params.target === "company_variable_costs") {
    if (/(meta|google|ads|trafego|tráfego|instagram|facebook)/.test(normalized)) return "Marketing";
    if (/(openai|aws|vercel|hostinger|figma|notion|slack|software|saas|cloud)/.test(normalized)) return "Software";
    if (/(aluguel|condominio|condomínio|energia|agua|água|internet|telefone)/.test(normalized)) return "Infraestrutura";
    if (/(ifood|uber|99|gasolina|combustivel|combustível|pedagio|pedágio)/.test(normalized)) return "Deslocamento";
    if (/(imposto|das|simples|tribut|inss|fgts)/.test(normalized)) return "Impostos";
    if (/(fornecedor|insumo|material|estoque|compra)/.test(normalized)) return "Fornecedores";
    return "Despesa importada";
  }

  if (params.target === "personal_variable_costs") {
    if (/(mercado|supermercado|ifood|restaurante|padaria|lanche)/.test(normalized)) return "Alimentacao";
    if (/(uber|99|combustivel|combustível|metro|metrô|onibus|ônibus|pedagio|pedágio)/.test(normalized)) return "Transporte";
    if (/(farmacia|farmácia|consulta|hospital|laboratorio|laboratório)/.test(normalized)) return "Saude";
    if (/(netflix|spotify|cinema|show|stream|lazer|viagem)/.test(normalized)) return "Lazer";
    if (/(energia|agua|água|internet|telefone|aluguel|condominio|condomínio)/.test(normalized)) return "Casa";
    if (/(escola|curso|faculdade|livro)/.test(normalized)) return "Educacao";
    return "Gasto importado";
  }

  return "";
}

export function suggestInvestmentType(params: {
  description?: string | null;
  institution?: string | null;
}) {
  const normalized = normalizeImportLookup(
    `${params.description || ""} ${params.institution || ""}`
  );

  if (/(tesouro)/.test(normalized)) return "Tesouro Direto";
  if (/(cdb|rdb)/.test(normalized)) return "CDB";
  if (/(lci|lca)/.test(normalized)) return "LCI/LCA";
  if (/(fii|fundo imobiliario|fundo imobiliário)/.test(normalized)) return "FII";
  if (/(acao|ações|acoes|stock|bdr)/.test(normalized)) return "Ações";
  if (/(crypto|bitcoin|btc|eth|ethereum)/.test(normalized)) return "Crypto";
  if (/(previdencia|previdência)/.test(normalized)) return "Previdência";
  if (/(poupanca|poupança)/.test(normalized)) return "Poupança";
  return "Outros";
}

export function suggestReserveFundType(params: {
  description?: string | null;
  explicitType?: string | null;
}) {
  const explicit = normalizeImportLookup(params.explicitType || "");
  if (explicit.includes("empresa") || explicit.includes("business")) return "empresa" as const;
  if (explicit.includes("pessoal") || explicit.includes("personal")) return "pessoal" as const;

  const normalized = normalizeImportLookup(params.description || "");
  if (/(empresa|operacional|negocio|negócio|pj)/.test(normalized)) return "empresa" as const;
  return "pessoal" as const;
}

export function suggestFinancialStatementDestination(params: {
  description?: string | null;
  counterparty?: string | null;
  amount: number;
  scope: FinancialStatementScope;
}): FinancialStatementSuggestion {
  const normalized = normalizeImportLookup(
    `${params.description || ""} ${params.counterparty || ""}`
  );
  const isPositive = params.amount > 0;
  const isNegative = params.amount < 0;
  const hasInvestment = /(tesouro|cdb|rdb|lci|lca|fii|bitcoin|btc|eth|ethereum|corretora|nuinvest|xp\s|rico|clear|previdencia|previdência)/.test(
    normalized
  );
  const hasReserve = /(reserva|emergencia|emergência|poupanca|poupança|caixa protegido|colchao|colchão)/.test(
    normalized
  );
  const hasCompany = /(cliente|fornecedor|empresa|pj|nfe|nota fiscal|servico|serviço|projeto|receita|google|meta|ads|software|saas|das|simples|inss|fgts|vercel|hostinger|aws|openai|slack)/.test(
    normalized
  );
  const hasPersonal = /(mercado|supermercado|ifood|restaurante|padaria|farmacia|farmácia|uber|99|netflix|spotify|cinema|escola|curso|academia|aluguel|condominio|condomínio|lazer|saude|saúde|consulta)/.test(
    normalized
  );

  if (isNegative && hasInvestment) {
    return {
      suggestedTarget: "investments",
      confidence: "alta",
      reason: "Saída com cara de aporte ou compra de investimento.",
      investmentType: suggestInvestmentType({
        description: params.description,
        institution: params.counterparty,
      }),
    };
  }

  if ((isNegative || isPositive) && hasReserve) {
    const reserveFundType =
      params.scope === "empresa"
        ? "empresa"
        : params.scope === "pessoal"
          ? "pessoal"
          : suggestReserveFundType({
              description: params.description,
              explicitType: params.counterparty,
            });

    return {
      suggestedTarget:
        reserveFundType === "empresa" ? "reserve_company" : "reserve_personal",
      confidence: "media",
      reason: "Movimentação com sinal de aporte ou ajuste de reserva.",
      reserveFundType,
    };
  }

  if (isPositive) {
    if (hasCompany || params.scope === "empresa") {
      return {
        suggestedTarget: "revenues",
        confidence: hasCompany ? "alta" : "media",
        reason: hasCompany
          ? "Entrada com sinais de recebimento operacional da empresa."
          : "Entrada em contexto de conta da empresa.",
        category: suggestFinancialImportCategory({
          target: "revenues",
          description: params.description,
          counterparty: params.counterparty,
        }),
      };
    }

    if (hasInvestment) {
      return {
        suggestedTarget: "investments",
        confidence: "media",
        reason: "Entrada ligada a investimento, rendimento ou resgate.",
        investmentType: suggestInvestmentType({
          description: params.description,
          institution: params.counterparty,
        }),
      };
    }

    return {
      suggestedTarget: "skip",
      confidence: "baixa",
      reason: "Entrada sem destino claro no modelo atual. Vale revisar antes de importar.",
    };
  }

  if (isNegative) {
    if (params.scope === "empresa") {
      return {
        suggestedTarget: "company_variable_costs",
        confidence: hasCompany ? "alta" : "media",
        reason: hasCompany
          ? "Saída com características de despesa operacional."
          : "Saída em contexto de conta da empresa.",
        category: suggestFinancialImportCategory({
          target: "company_variable_costs",
          description: params.description,
          counterparty: params.counterparty,
        }),
      };
    }

    if (params.scope === "pessoal") {
      return {
        suggestedTarget: "personal_variable_costs",
        confidence: hasPersonal ? "alta" : "media",
        reason: hasPersonal
          ? "Saída com características de gasto pessoal."
          : "Saída em contexto de conta pessoal.",
        category: suggestFinancialImportCategory({
          target: "personal_variable_costs",
          description: params.description,
          counterparty: params.counterparty,
        }),
      };
    }

    if (hasCompany && !hasPersonal) {
      return {
        suggestedTarget: "company_variable_costs",
        confidence: "alta",
        reason: "Saída com sinais fortes de gasto da empresa.",
        category: suggestFinancialImportCategory({
          target: "company_variable_costs",
          description: params.description,
          counterparty: params.counterparty,
        }),
      };
    }

    if (hasPersonal && !hasCompany) {
      return {
        suggestedTarget: "personal_variable_costs",
        confidence: "alta",
        reason: "Saída com sinais fortes de gasto pessoal.",
        category: suggestFinancialImportCategory({
          target: "personal_variable_costs",
          description: params.description,
          counterparty: params.counterparty,
        }),
      };
    }

    return {
      suggestedTarget: "skip",
      confidence: "baixa",
      reason: "Saída ambígua entre empresa e pessoal. Vale revisar manualmente.",
    };
  }

  return {
    suggestedTarget: "skip",
    confidence: "baixa",
    reason: "Movimentação sem valor útil para classificação.",
  };
}

export function inferFinancialImportMapping(
  headers: string[],
  target: FinancialImportTarget
): FinancialImportMapping {
  const mapping = createEmptyFinancialImportMapping();

  headers.forEach(header => {
    const normalized = normalizeImportLookup(header);
    if (!mapping.date && /(data|date|competencia|lancamento|movimento)/.test(normalized)) {
      mapping.date = header;
      return;
    }
    if (!mapping.credit && /(credito|credit|entrada|valor credito|valor credit)/.test(normalized)) {
      mapping.credit = header;
      return;
    }
    if (!mapping.debit && /(debito|débito|debit|saida|saída|valor debito|valor débito)/.test(normalized)) {
      mapping.debit = header;
      return;
    }
    if (
      !mapping.amount &&
      /(valor|amount|total|liquido|liquido|entrada|saida|aporte)/.test(normalized) &&
      !/(valor credito|valor debito|valor débito|credito|debito|débito|credit|debit)/.test(normalized)
    ) {
      mapping.amount = header;
      return;
    }
    if (!mapping.description && /(descricao|historico|memo|detalhe|titulo|title)/.test(normalized)) {
      mapping.description = header;
      return;
    }
    if (!mapping.category && /(categoria|category|tipo de gasto|tipo receita|prioridade|priority)/.test(normalized)) {
      mapping.category = header;
      return;
    }
    if (!mapping.counterparty && /(cliente|fornecedor|favorecido|contato|nome|name|credor)/.test(normalized)) {
      mapping.counterparty = header;
      return;
    }
    if (!mapping.status && /(status|situacao|situacao|situação)/.test(normalized)) {
      mapping.status = header;
      return;
    }
    if (!mapping.balance && /(saldo|balance|atual)/.test(normalized)) {
      mapping.balance = header;
      return;
    }
    if (!mapping.monthlyPayment && /(parcela mensal|parcela|monthly payment|pagamento mensal)/.test(normalized)) {
      mapping.monthlyPayment = header;
      return;
    }
    if (!mapping.interestRate && /(juros|interest|taxa)/.test(normalized)) {
      mapping.interestRate = header;
      return;
    }
    if (!mapping.totalInstallments && /(total parcelas|parcelas totais|installments)/.test(normalized)) {
      mapping.totalInstallments = header;
      return;
    }
    if (!mapping.paidInstallments && /(parcelas pagas|pagas|paid installments)/.test(normalized)) {
      mapping.paidInstallments = header;
      return;
    }
    if (!mapping.dueDay && /(dia venc|vencimento|due day)/.test(normalized)) {
      mapping.dueDay = header;
      return;
    }
    if (!mapping.institution && /(instituicao|instituição|corretora|banco|broker)/.test(normalized)) {
      mapping.institution = header;
      return;
    }
    if (!mapping.investmentType && /(tipo investimento|produto|ativo|asset)/.test(normalized)) {
      mapping.investmentType = header;
      return;
    }
    if (!mapping.yieldAmount && /(rendimento|yield|lucro|ganho)/.test(normalized)) {
      mapping.yieldAmount = header;
      return;
    }
    if (!mapping.reserveType && /(tipo reserva|reserva|fund type)/.test(normalized)) {
      mapping.reserveType = header;
    }
  });

  if (target === "debts" && !mapping.balance && mapping.amount) {
    mapping.balance = mapping.amount;
  }

  if (target === "investments" && !mapping.balance && mapping.amount) {
    mapping.balance = mapping.amount;
  }

  return mapping;
}

export function getFinancialImportMappingFields(target: FinancialImportTarget): FinancialImportFieldConfig[] {
  const baseFields: FinancialImportFieldConfig[] = [
    { key: "date", label: "Data" },
    { key: "description", label: "Descricao" },
    { key: "amount", label: "Valor" },
    { key: "credit", label: "Credito" },
    { key: "debit", label: "Debito" },
    { key: "counterparty", label: "Cliente / fornecedor / credor" },
    { key: "status", label: "Status" },
  ];

  if (target === "revenues" || target === "company_variable_costs" || target === "personal_variable_costs") {
    return [
      ...baseFields,
      { key: "category", label: "Categoria" },
    ];
  }

  if (target === "debts") {
    return [
      { key: "description", label: "Descricao da divida" },
      { key: "counterparty", label: "Credor" },
      { key: "balance", label: "Saldo atual" },
      { key: "amount", label: "Valor original" },
      { key: "monthlyPayment", label: "Parcela mensal" },
      { key: "interestRate", label: "Juros (%)" },
      { key: "totalInstallments", label: "Total de parcelas" },
      { key: "paidInstallments", label: "Parcelas pagas" },
      { key: "dueDay", label: "Dia de vencimento" },
      { key: "date", label: "Proxima data" },
      { key: "category", label: "Prioridade" },
      { key: "status", label: "Status" },
    ];
  }

  if (target === "investments") {
    return [
      { key: "date", label: "Data do aporte" },
      { key: "description", label: "Descricao" },
      { key: "institution", label: "Instituicao" },
      { key: "investmentType", label: "Tipo do investimento" },
      { key: "amount", label: "Valor aportado" },
      { key: "balance", label: "Saldo atual" },
      { key: "yieldAmount", label: "Rendimento" },
      { key: "status", label: "Status" },
    ];
  }

  return [
    { key: "date", label: "Data do aporte" },
    { key: "description", label: "Descricao" },
    { key: "amount", label: "Valor" },
    { key: "reserveType", label: "Tipo da reserva" },
    { key: "status", label: "Status" },
  ];
}

export function getFinancialImportTargetMeta(
  target: FinancialImportTarget,
  reserveFundType: FinancialImportReserveType = "empresa"
): FinancialImportTargetMeta {
  if (target === "revenues") {
    return {
      label: "Receitas",
      shortLabel: "Receitas",
      description: "Entradas da empresa, vendas, transferencias recebidas e creditos do extrato.",
      defaultCategory: "Receita importada",
      defaultStatus: "recebido",
      supportsCategory: true,
      statusOptions: ["recebido", "pendente", "atrasado", "cancelado"],
      templateCsv:
        "data;descricao;valor;cliente;categoria;status\n2026-04-01;Pix Cliente ACME;1500,00;ACME;Servicos e vendas;recebido",
      requiredFieldSummary: "Data e valor sao o minimo. Descricao ajuda a categorizar melhor.",
    };
  }

  if (target === "company_variable_costs") {
    return {
      label: "Custos variaveis da empresa",
      shortLabel: "Custos empresa",
      description: "Saidas operacionais, fornecedores, marketing, software e despesas variaveis da empresa.",
      defaultCategory: "Despesa importada",
      defaultStatus: "pago",
      supportsCategory: true,
      statusOptions: ["pago", "pendente", "atrasado"],
      templateCsv:
        "data;descricao;valor;fornecedor;categoria;status\n2026-04-02;Meta Ads;890,50;Meta;Marketing;pago",
      requiredFieldSummary: "Data e valor sao obrigatorios. Categoria pode ser inferida pela descricao.",
    };
  }

  if (target === "personal_variable_costs") {
    return {
      label: "Contas variaveis pessoais",
      shortLabel: "Gastos pessoais",
      description: "Saidas do extrato pessoal, cartao, pix e despesas do dia a dia.",
      defaultCategory: "Gasto importado",
      defaultStatus: "pago",
      supportsCategory: true,
      statusOptions: ["pago", "pendente", "atrasado"],
      templateCsv:
        "data;descricao;valor;categoria;status\n2026-04-03;Mercado do bairro;245,90;Alimentacao;pago",
      requiredFieldSummary: "Data e valor sao obrigatorios. O restante pode ser inferido.",
    };
  }

  if (target === "debts") {
    return {
      label: "Dividas",
      shortLabel: "Dividas",
      description: "Importe dividas abertas com saldo, parcela e dia de vencimento para alimentar a priorizacao do mentor.",
      defaultCategory: "",
      defaultStatus: "ativa",
      supportsCategory: false,
      statusOptions: ["ativa", "atrasada", "renegociada", "quitada"],
      templateCsv:
        "credor;descricao;saldo atual;parcela mensal;juros;dia vencimento;status\nBanco X;Cartao principal;4200,00;600,00;12,50;10;ativa",
      requiredFieldSummary: "Saldo atual e credor sao o mais importante. Parcela mensal pode vir depois, mas melhora o plano.",
    };
  }

  if (target === "investments") {
    return {
      label: "Investimentos",
      shortLabel: "Investimentos",
      description: "Aportes, saldo atual e rendimento de investimentos pessoais para o mentor considerar patrimonio e reserva.",
      defaultCategory: "",
      defaultStatus: "ativo",
      supportsCategory: false,
      statusOptions: ["ativo"],
      templateCsv:
        "data;descricao;instituicao;tipo;valor aportado;saldo atual;rendimento\n2026-04-05;Tesouro Selic;NuInvest;Tesouro Direto;1000,00;1032,40;32,40",
      requiredFieldSummary: "Data e valor aportado bastam para importar. Saldo e rendimento refinam a analise.",
    };
  }

  return {
    label: reserveFundType === "empresa" ? "Reserva da empresa" : "Reserva pessoal",
    shortLabel: reserveFundType === "empresa" ? "Reserva empresa" : "Reserva pessoal",
    description:
      reserveFundType === "empresa"
        ? "Aportes para a reserva operacional da empresa."
        : "Aportes para a reserva pessoal de seguranca.",
    defaultCategory: "",
    defaultStatus: "registrado",
    supportsCategory: false,
    statusOptions: ["registrado"],
    templateCsv:
      reserveFundType === "empresa"
        ? "data;descricao;valor\n2026-04-06;Aporte caixa protegido;2500,00"
        : "data;descricao;valor\n2026-04-06;Aporte reserva pessoal;1200,00",
    requiredFieldSummary: "Data e valor ja bastam para importar aportes de reserva.",
  };
}

export function resolveFinancialImportPreset(preset?: string | null): {
  target: FinancialImportTarget;
  reserveFundType: FinancialImportReserveType;
  title: string;
  description: string;
} {
  if (preset === "revenues") {
    return {
      target: "revenues",
      reserveFundType: "empresa",
      title: "Importar receitas do mes",
      description: "Ideal para extrato de recebimentos, pix de clientes e receitas que vieram de planilha.",
    };
  }

  if (preset === "personal_variable_costs") {
    return {
      target: "personal_variable_costs",
      reserveFundType: "pessoal",
      title: "Importar gastos pessoais",
      description: "Use quando quiser alimentar seu custo de vida com extrato, cartao ou CSV bancario.",
    };
  }

  if (preset === "debts") {
    return {
      target: "debts",
      reserveFundType: "pessoal",
      title: "Importar dividas",
      description: "Traz saldo, parcela e juros para o mentor priorizar a quitacao com mais contexto.",
    };
  }

  if (preset === "investments") {
    return {
      target: "investments",
      reserveFundType: "pessoal",
      title: "Importar investimentos",
      description: "Ajuda o mentor a considerar patrimonio, liquidez e evolucao da reserva.",
    };
  }

  if (preset === "reserve_company") {
    return {
      target: "reserve_funds",
      reserveFundType: "empresa",
      title: "Importar reserva da empresa",
      description: "Registre aportes de caixa protegido e fortaleça a leitura operacional do mentor.",
    };
  }

  if (preset === "reserve_personal") {
    return {
      target: "reserve_funds",
      reserveFundType: "pessoal",
      title: "Importar reserva pessoal",
      description: "Registre aportes de reserva para o mentor medir sua seguranca fora do caixa do mes.",
    };
  }

  return {
    target: "company_variable_costs",
    reserveFundType: "empresa",
    title: "Importar custos da empresa",
    description: "Boa porta de entrada para subir extrato, despesas operacionais e compras do mes.",
  };
}
