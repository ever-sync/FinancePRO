const BASIS_POINTS_TOTAL = 10_000;

export type PurchaseDecision =
  | "approved_safe"
  | "approved_with_adjustments"
  | "not_recommended"
  | "blocked_by_missing_data";

export type PurchaseDecisionInput = {
  amountCents: number;
  operatingBalanceCents: number | null;
  billsDueBeforeNextIncomeCents: number;
  essentialEnvelopesRemainingCents: number;
  urgentDebtCents: number;
  operatingBufferCents: number;
  confirmedCommitmentsCents: number;
  adjustableDiscretionaryCents?: number;
  desiredDate: string;
  nextIncomeDate?: string | null;
  missingData?: string[];
};

export type PurchaseDecisionResult = {
  decision: PurchaseDecision;
  safeToSpendCents: number;
  shortfallCents: number;
  projectedMinBalanceCents: number;
  saferDate: string | null;
  impactOnGoals: string[];
  impactOnBills: string[];
  explanationFacts: string[];
};

export type CarSimulationInput = {
  vehiclePriceCents: number | null;
  downPaymentCents: number | null;
  installmentCents: number | null;
  termMonths: number | null;
  cetAnnualBasisPoints: number | null;
  insuranceMonthlyCents: number | null;
  fuelMonthlyCents: number | null;
  ipvaAnnualCents: number | null;
  maintenanceMonthlyCents: number | null;
  licensingAnnualCents?: number;
  asaasDebtCents: number;
  expensiveDebtCents?: number;
  overdraftUsedCents: number;
  reserveCents: number;
  postCarReserveTargetCents: number;
  downPaymentSeparated: boolean;
  futureIncomeConfirmed: boolean;
  fixedCostsConfirmed: boolean;
  priorityAPlanComplete: boolean;
  monthlyCarLimitCents: number;
  installmentLimitCents: number;
  confirmedMonthlyIncomeCents: number;
  livingCostAfterCarCents: number;
  currentOperatingBalanceCents: number;
};

export type CarSimulationResult = {
  decision: "not_recommended" | "fits_with_risk" | "fits_safely";
  readinessScore: number;
  blockers: string[];
  missingInputs: string[];
  totalMonthlyCostCents: number;
  totalFinancingCostCents: number | null;
  monthlySurplusCents: number;
  reserveMonths: number;
  twelveMonthConservativeProjection: Array<{
    month: number;
    endingBalanceCents: number;
  }>;
};

export type ProjectSplit = {
  taxesCents: number;
  deliveryCostsCents: number;
  goalsCents: number;
};

export type ParsedMoneyExpression =
  | { kind: "value"; amountCents: number }
  | { kind: "ambiguous"; alternativesCents: [number, number] }
  | { kind: "missing" };

function assertSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} deve ser um inteiro seguro`);
  }
}

export function assertNonNegativeCents(value: number, field = "valor") {
  assertSafeInteger(value, field);
  if (value < 0) throw new Error(`${field} nao pode ser negativo`);
  return value;
}

export function formatBRLCents(valueCents: number) {
  assertSafeInteger(valueCents, "valueCents");
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valueCents / 100);
}

export function calculateEmergencyFundTarget(
  monthlyReferenceCents: number,
  months = 6
) {
  assertNonNegativeCents(monthlyReferenceCents, "monthlyReferenceCents");
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new Error("months deve estar entre 1 e 120");
  }
  return monthlyReferenceCents * months;
}

export function calculateReserveMonths(
  reserveBalanceCents: number,
  monthlyReferenceCents: number
) {
  assertNonNegativeCents(reserveBalanceCents, "reserveBalanceCents");
  assertNonNegativeCents(monthlyReferenceCents, "monthlyReferenceCents");
  if (monthlyReferenceCents === 0) return 0;
  return Math.round((reserveBalanceCents / monthlyReferenceCents) * 100) / 100;
}

export function calculateProjectSplit(
  grossCents: number,
  taxBasisPoints = 1500,
  costBasisPoints = 1000,
  goalBasisPoints = 7500
): ProjectSplit {
  assertNonNegativeCents(grossCents, "grossCents");
  for (const [field, value] of [
    ["taxBasisPoints", taxBasisPoints],
    ["costBasisPoints", costBasisPoints],
    ["goalBasisPoints", goalBasisPoints],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_TOTAL) {
      throw new Error(`${field} invalido`);
    }
  }
  if (
    taxBasisPoints + costBasisPoints + goalBasisPoints !==
    BASIS_POINTS_TOTAL
  ) {
    throw new Error(
      "A divisao do projeto deve totalizar 100% (10.000 pontos-base)"
    );
  }

  const taxesCents = Math.floor(
    (grossCents * taxBasisPoints) / BASIS_POINTS_TOTAL
  );
  const deliveryCostsCents = Math.floor(
    (grossCents * costBasisPoints) / BASIS_POINTS_TOTAL
  );
  return {
    taxesCents,
    deliveryCostsCents,
    goalsCents: grossCents - taxesCents - deliveryCostsCents,
  };
}

export function calculatePurchaseDecision(
  input: PurchaseDecisionInput
): PurchaseDecisionResult {
  assertNonNegativeCents(input.amountCents, "amountCents");
  const missingData = input.missingData?.filter(Boolean) ?? [];
  if (input.operatingBalanceCents == null)
    missingData.push("saldo operacional");
  if (missingData.length > 0) {
    return {
      decision: "blocked_by_missing_data",
      safeToSpendCents: 0,
      shortfallCents: input.amountCents,
      projectedMinBalanceCents: 0,
      saferDate: null,
      impactOnGoals: [],
      impactOnBills: [],
      explanationFacts: [
        `Faltam dados confirmados: ${Array.from(new Set(missingData)).join(", ")}.`,
      ],
    };
  }

  const protectedUses = [
    input.billsDueBeforeNextIncomeCents,
    input.essentialEnvelopesRemainingCents,
    input.urgentDebtCents,
    input.operatingBufferCents,
    input.confirmedCommitmentsCents,
  ];
  protectedUses.forEach((value, index) =>
    assertNonNegativeCents(value, `protectedUse${index}`)
  );
  const operatingBalanceCents = input.operatingBalanceCents as number;
  assertSafeInteger(operatingBalanceCents, "operatingBalanceCents");
  const protectedTotal = protectedUses.reduce((sum, value) => sum + value, 0);
  const safeToSpendCents = Math.max(0, operatingBalanceCents - protectedTotal);
  const projectedMinBalanceCents =
    operatingBalanceCents - protectedTotal - input.amountCents;
  const shortfallCents = Math.max(0, input.amountCents - safeToSpendCents);
  const adjustable = Math.max(0, input.adjustableDiscretionaryCents ?? 0);

  let decision: PurchaseDecision;
  if (input.amountCents <= safeToSpendCents) {
    decision = "approved_safe";
  } else if (input.amountCents <= safeToSpendCents + adjustable) {
    decision = "approved_with_adjustments";
  } else {
    decision = "not_recommended";
  }

  const impactOnBills =
    projectedMinBalanceCents < 0
      ? [
          `A compra cria uma insuficiencia de ${formatBRLCents(Math.abs(projectedMinBalanceCents))} antes da proxima renda.`,
        ]
      : [];
  const impactOnGoals =
    decision === "approved_with_adjustments"
      ? [
          `Sera necessario redirecionar ${formatBRLCents(shortfallCents)} de gastos discricionarios ou metas opcionais.`,
        ]
      : decision === "not_recommended"
        ? ["A compra atrasaria metas protegidas ou contas prioritarias."]
        : [];

  return {
    decision,
    safeToSpendCents,
    shortfallCents,
    projectedMinBalanceCents,
    saferDate:
      decision === "approved_safe"
        ? input.desiredDate
        : (input.nextIncomeDate ?? null),
    impactOnGoals,
    impactOnBills,
    explanationFacts: [
      `Saldo operacional confirmado: ${formatBRLCents(operatingBalanceCents)}.`,
      `Valor protegido para contas, dividas, envelopes e margem: ${formatBRLCents(protectedTotal)}.`,
      `Valor seguro para compras: ${formatBRLCents(safeToSpendCents)}.`,
    ],
  };
}

function missingCarInputs(input: CarSimulationInput) {
  const fields: Array<[keyof CarSimulationInput, string]> = [
    ["vehiclePriceCents", "valor do veiculo"],
    ["downPaymentCents", "entrada"],
    ["installmentCents", "parcela"],
    ["termMonths", "prazo"],
    ["cetAnnualBasisPoints", "CET"],
    ["insuranceMonthlyCents", "seguro"],
    ["fuelMonthlyCents", "combustivel"],
    ["ipvaAnnualCents", "IPVA"],
    ["maintenanceMonthlyCents", "manutencao"],
  ];
  return fields.filter(([key]) => input[key] == null).map(([, label]) => label);
}

export function calculateCarReadiness(
  input: CarSimulationInput
): CarSimulationResult {
  const missingInputs = missingCarInputs(input);
  const installmentCents = input.installmentCents ?? 0;
  const monthlyIpvaAndLicensing = Math.round(
    ((input.ipvaAnnualCents ?? 0) + (input.licensingAnnualCents ?? 0)) / 12
  );
  const totalMonthlyCostCents =
    installmentCents +
    (input.insuranceMonthlyCents ?? 0) +
    (input.fuelMonthlyCents ?? 0) +
    monthlyIpvaAndLicensing +
    (input.maintenanceMonthlyCents ?? 0);

  const blockers: string[] = [];
  if (input.asaasDebtCents > 0 || (input.expensiveDebtCents ?? 0) > 0)
    blockers.push("Dividas caras ainda nao foram zeradas.");
  if (input.overdraftUsedCents > 0)
    blockers.push("Existe uso de limite ou cheque especial.");
  if (input.reserveCents < input.postCarReserveTargetCents)
    blockers.push("A reserva pos-carro ainda nao atingiu a meta minima.");
  if (!input.downPaymentSeparated)
    blockers.push("A entrada do carro ainda nao esta separada da reserva.");
  if (!input.futureIncomeConfirmed)
    blockers.push("A renda futura ainda nao esta confirmada.");
  if (totalMonthlyCostCents > input.monthlyCarLimitCents)
    blockers.push("O custo mensal total do carro ultrapassa o teto.");
  if (installmentCents > input.installmentLimitCents)
    blockers.push("A parcela ultrapassa o teto definido.");
  if (!input.fixedCostsConfirmed)
    blockers.push("As contas fixas reais ainda precisam ser confirmadas.");
  if (!input.priorityAPlanComplete)
    blockers.push(
      "Os itens essenciais de prioridade A ainda nao possuem cobertura."
    );
  if (missingInputs.length > 0)
    blockers.push(`Faltam dados da simulacao: ${missingInputs.join(", ")}.`);

  let readinessScore = 0;
  if (input.asaasDebtCents === 0 && (input.expensiveDebtCents ?? 0) === 0)
    readinessScore += 10;
  if (input.overdraftUsedCents === 0) readinessScore += 10;
  if (input.reserveCents >= 4_908_000) readinessScore += 15;
  if (input.reserveCents >= input.postCarReserveTargetCents)
    readinessScore += 20;
  if (input.downPaymentSeparated) readinessScore += 15;
  if (input.futureIncomeConfirmed) readinessScore += 15;
  if (totalMonthlyCostCents <= input.monthlyCarLimitCents) readinessScore += 10;
  if (missingInputs.length === 0) readinessScore += 5;

  const monthlySurplusCents =
    input.confirmedMonthlyIncomeCents - input.livingCostAfterCarCents;
  const reserveMonths = calculateReserveMonths(
    input.reserveCents,
    input.livingCostAfterCarCents
  );
  const twelveMonthConservativeProjection = Array.from(
    { length: 12 },
    (_, index) => ({
      month: index + 1,
      endingBalanceCents:
        input.currentOperatingBalanceCents + monthlySurplusCents * (index + 1),
    })
  );
  const totalFinancingCostCents =
    input.downPaymentCents != null && input.termMonths != null
      ? input.downPaymentCents + installmentCents * input.termMonths
      : null;

  return {
    decision:
      blockers.length > 0
        ? "not_recommended"
        : monthlySurplusCents >= totalMonthlyCostCents
          ? "fits_safely"
          : "fits_with_risk",
    readinessScore,
    blockers,
    missingInputs,
    totalMonthlyCostCents,
    totalFinancingCostCents,
    monthlySurplusCents,
    reserveMonths,
    twelveMonthConservativeProjection,
  };
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftUtcDate(date: Date, days: number) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

export function easterSunday(year: number) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200)
    throw new Error("Ano invalido");
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function brazilianNationalHolidayDates(year: number) {
  const easter = easterSunday(year);
  const movable = [shiftUtcDate(easter, -2), shiftUtcDate(easter, 60)].map(
    date =>
      isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  );
  return new Set([
    isoDate(year, 1, 1),
    isoDate(year, 4, 21),
    isoDate(year, 5, 1),
    isoDate(year, 9, 7),
    isoDate(year, 10, 12),
    isoDate(year, 11, 2),
    isoDate(year, 11, 15),
    isoDate(year, 11, 20),
    isoDate(year, 12, 25),
    ...movable,
  ]);
}

export function getNthBusinessDay(
  year: number,
  month: number,
  nth: number,
  extraHolidayDates: Iterable<string> = []
) {
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Error("Mes invalido");
  if (!Number.isInteger(nth) || nth < 1 || nth > 31)
    throw new Error("Dia util invalido");
  const holidays = brazilianNationalHolidayDates(year);
  Array.from(extraHolidayDates).forEach(holiday => holidays.add(holiday));
  let count = 0;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekDay = date.getUTCDay();
    const key = isoDate(year, month, day);
    if (weekDay === 0 || weekDay === 6 || holidays.has(key)) continue;
    count += 1;
    if (count === nth) return key;
  }
  throw new Error("O mes nao possui a quantidade solicitada de dias uteis");
}

function parseDecimalToken(value: string) {
  const normalized = value.trim().replace(/\s/g, "");
  if (!normalized) return null;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let integerPart = normalized;
  let decimalPart = "";
  if (decimalIndex >= 0) {
    const tail = normalized.slice(decimalIndex + 1);
    if (tail.length <= 2) {
      integerPart = normalized.slice(0, decimalIndex);
      decimalPart = tail;
    }
  }
  const digits = integerPart.replace(/\D/g, "");
  if (!digits || (decimalPart && !/^\d{1,2}$/.test(decimalPart))) return null;
  return Number(digits) * 100 + Number(decimalPart.padEnd(2, "0") || 0);
}

export function parseBrazilianMoneyExpression(
  input: string
): ParsedMoneyExpression {
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const match = normalized.match(
    /(?:r\$\s*)?(\d[\d.,]*)(?:\s*)(milhoes|milhao|mil|mi|k)?/
  );
  if (!match) return { kind: "missing" };
  const baseCents = parseDecimalToken(match[1]);
  if (baseCents == null) return { kind: "missing" };
  const suffix = match[2];
  if (suffix === "mil") {
    if (baseCents >= 100_000) {
      return {
        kind: "ambiguous",
        alternativesCents: [baseCents, baseCents * 1_000],
      };
    }
    return { kind: "value", amountCents: baseCents * 1_000 };
  }
  if (suffix === "k") return { kind: "value", amountCents: baseCents * 1_000 };
  if (suffix === "milhao" || suffix === "milhoes" || suffix === "mi") {
    return { kind: "value", amountCents: baseCents * 1_000_000 };
  }
  return { kind: "value", amountCents: baseCents };
}

export function savingsRatePercent(
  confirmedIncomeCents: number,
  reserveContributionsCents: number,
  goalContributionsCents: number,
  confirmedInvestmentsCents: number
) {
  assertNonNegativeCents(confirmedIncomeCents, "confirmedIncomeCents");
  if (confirmedIncomeCents === 0) return 0;
  const numerator =
    reserveContributionsCents +
    goalContributionsCents +
    confirmedInvestmentsCents;
  return Math.round((numerator / confirmedIncomeCents) * 10_000) / 100;
}
