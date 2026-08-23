import { createHash } from "node:crypto";

export type SantanderStatementRow = {
  line: number;
  date: string;
  occurredAt: Date;
  description: string;
  normalizedDescription: string;
  documentNumber: string | null;
  amountCents: number;
  balanceAfterCents: number;
};

export type SantanderStatement = {
  fileHash: string;
  encoding: "utf-8" | "windows-1252";
  agency: string | null;
  account: string | null;
  rows: SantanderStatementRow[];
  totals: {
    creditCents: number;
    debitCents: number;
    netCents: number;
    endingBalanceCents: number | null;
  };
};

export class SantanderStatementError extends Error {
  constructor(
    message: string,
    public readonly details: Array<{ line: number; message: string }> = []
  ) {
    super(message);
  }
}

function decodeStatement(buffer: Buffer) {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      encoding: "utf-8" as const,
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(buffer),
      encoding: "windows-1252" as const,
    };
  }
}

function parseDelimitedRows(value: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ";" && !quoted) {
      record.push(field);
      field = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      record.push(field);
      field = "";
      if (record.some(cell => cell.length > 0)) records.push(record);
      record = [];
      continue;
    }
    field += character;
  }

  if (quoted)
    throw new SantanderStatementError("CSV possui aspas sem fechamento");
  record.push(field);
  if (record.some(cell => cell.length > 0)) records.push(record);
  return records;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function normalizeStatementDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseBrazilianCents(value: string) {
  const normalized = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`valor monetario invalido: ${value}`);
  }
  const negative = normalized.startsWith("-");
  const [integerPart, fractionPart = ""] = normalized
    .replace("-", "")
    .split(".");
  const cents = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents))
    throw new Error(`valor fora do limite: ${value}`);
  return negative ? -cents : cents;
}

function parseBrazilianDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`data invalida: ${value}`);
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const occurredAt = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    occurredAt.getUTCFullYear() !== year ||
    occurredAt.getUTCMonth() + 1 !== month ||
    occurredAt.getUTCDate() !== day
  ) {
    throw new Error(`data invalida: ${value}`);
  }
  return {
    iso: `${yearText}-${monthText}-${dayText}`,
    occurredAt,
  };
}

export function createSantanderRowHash(
  tenantId: number,
  accountId: number,
  row: SantanderStatementRow
) {
  return createHash("sha256")
    .update(
      [
        tenantId,
        accountId,
        row.date,
        row.normalizedDescription,
        row.documentNumber ?? "",
        row.amountCents,
        row.balanceAfterCents,
      ].join("|")
    )
    .digest("hex");
}

export function parseSantanderStatement(buffer: Buffer): SantanderStatement {
  if (buffer.byteLength === 0)
    throw new SantanderStatementError("Arquivo vazio");
  const { text, encoding } = decodeStatement(buffer);
  const records = parseDelimitedRows(text.replace(/^\uFEFF/, ""));
  const headerIndex = records.findIndex(record => {
    const normalized = record.map(normalizeHeader);
    return (
      normalized[0] === "data" &&
      normalized[1] === "historico" &&
      normalized[2] === "documento" &&
      normalized[3]?.startsWith("valor") &&
      normalized[4]?.startsWith("saldo")
    );
  });
  if (headerIndex < 0) {
    throw new SantanderStatementError(
      "Cabecalho Santander nao encontrado (Data;Historico;Documento;Valor;Saldo)"
    );
  }

  const metadata = records.slice(0, headerIndex).flat();
  const agencyIndex = metadata.findIndex(
    value => normalizeHeader(value) === "agencia"
  );
  const accountIndex = metadata.findIndex(
    value => normalizeHeader(value) === "conta"
  );
  const errors: Array<{ line: number; message: string }> = [];
  const rows: SantanderStatementRow[] = [];

  for (let index = headerIndex + 1; index < records.length; index += 1) {
    const record = records[index];
    const line = index + 1;
    if (record.length < 5) {
      errors.push({ line, message: "linha possui menos de cinco colunas" });
      continue;
    }
    try {
      const parsedDate = parseBrazilianDate(record[0]);
      const description = record[1].replace(/\s+/g, " ").trim();
      if (!description) throw new Error("historico vazio");
      rows.push({
        line,
        date: parsedDate.iso,
        occurredAt: parsedDate.occurredAt,
        description,
        normalizedDescription: normalizeStatementDescription(description),
        documentNumber: record[2].trim() || null,
        amountCents: parseBrazilianCents(record[3]),
        balanceAfterCents: parseBrazilianCents(record[4]),
      });
    } catch (error) {
      errors.push({
        line,
        message: error instanceof Error ? error.message : "linha invalida",
      });
    }
  }

  if (errors.length > 0) {
    throw new SantanderStatementError(
      `${errors.length} linha(s) invalida(s) no extrato`,
      errors.slice(0, 100)
    );
  }
  if (rows.length === 0)
    throw new SantanderStatementError("Extrato sem lancamentos");

  const creditCents = rows.reduce(
    (total, row) => total + Math.max(0, row.amountCents),
    0
  );
  const debitCents = rows.reduce(
    (total, row) => total + Math.max(0, -row.amountCents),
    0
  );
  return {
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    encoding,
    agency: agencyIndex >= 0 ? metadata[agencyIndex + 1]?.trim() || null : null,
    account:
      accountIndex >= 0 ? metadata[accountIndex + 1]?.trim() || null : null,
    rows,
    totals: {
      creditCents,
      debitCents,
      netCents: creditCents - debitCents,
      endingBalanceCents: rows[0]?.balanceAfterCents ?? null,
    },
  };
}
