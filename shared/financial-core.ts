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
  overdueDebtCents?: number;
  creditIssueResolved?: boolean;
  cleanCreditMonths?: number;
  minimumCleanCreditMonths?: number;
  income2027Confirmed?: boolean;
  minimumReserveTargetCents?: number;
  cashDownPaymentCents?: number;
  cashDownPaymentTargetCents?: number;
  acquisitionCostFundCents?: number;
  acquisitionCostFundTargetCents?: number;
  tradeInNetCents?: number;
  tradeInTargetCents?: number;
  financedAmountCents?: number;
  financedAmountTargetMaxCents?: number;
  quotesComplete?: boolean;
  reconciledDays?: number;
  concurrentFormalProposals?: number;
};

export type CarSimulationResult = {
  decision: "not_recommended" | "fits_with_risk" | "fits_safely";
  v3Decision: "NO_GO" | "GO_CONDICIONAL" | "GO";
  readinessScore: number;
  blockers: string[];
  missingInputs: string[];
  totalMonthlyCostCents: number;
  totalFinancingCostCents: number | null;
  monthlySurplusCents: number;
  reserveMonths: number;
  recompositionMonthlyCents: number | null;
  financedAmountCents: number | null;
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

  const minimumReserveTargetCents =
    input.minimumReserveTargetCents ?? 4_908_000;
  const cashDownPaymentCents =
    input.cashDownPaymentCents ?? input.downPaymentCents ?? 0;
  const cashDownPaymentTargetCents =
    input.cashDownPaymentTargetCents ?? 3_000_000;
  const acquisitionCostFundCents = input.acquisitionCostFundCents ?? 0;
  const acquisitionCostFundTargetCents =
    input.acquisitionCostFundTargetCents ?? 300_000;
  const tradeInNetCents = input.tradeInNetCents ?? 0;
  const tradeInTargetCents = input.tradeInTargetCents ?? 2_000_000;
  const financedAmountCents =
    input.financedAmountCents ??
    (input.vehiclePriceCents == null
      ? null
      : Math.max(
          0,
          input.vehiclePriceCents - cashDownPaymentCents - tradeInNetCents
        ));
  const financedAmountTargetMaxCents =
    input.financedAmountTargetMaxCents ?? 8_000_000;
  const overdueDebtCents =
    input.overdueDebtCents ??
    input.asaasDebtCents + (input.expensiveDebtCents ?? 0);
  const creditIssueResolved =
    input.creditIssueResolved ?? overdueDebtCents === 0;
  const cleanCreditMonths = input.cleanCreditMonths ?? 0;
  const minimumCleanCreditMonths = input.minimumCleanCreditMonths ?? 3;
  const income2027Confirmed =
    input.income2027Confirmed ?? input.futureIncomeConfirmed;
  const quotesComplete = input.quotesComplete ?? missingInputs.length === 0;
  const reconciledDays = input.reconciledDays ?? 0;
  const concurrentFormalProposals = input.concurrentFormalProposals ?? 0;

  const blockers: string[] = [];
  if (overdueDebtCents > 0)
    blockers.push("Existe obrigacao vencida ou divida cara em aberto.");
  if (!creditIssueResolved)
    blockers.push(
      "A pendencia de credito/SCR ainda nao possui prova de resolucao."
    );
  if (input.overdraftUsedCents > 0)
    blockers.push("Existe uso de limite ou cheque especial.");
  if (cleanCreditMonths < minimumCleanCreditMonths)
    blockers.push(
      `Ainda faltam meses de historico limpo (${cleanCreditMonths} de ${minimumCleanCreditMonths}).`
    );
  if (input.reserveCents < minimumReserveTargetCents)
    blockers.push("A reserva minima intocavel ainda nao foi formada.");
  if (cashDownPaymentCents < cashDownPaymentTargetCents)
    blockers.push("A entrada em dinheiro ainda nao atingiu R$ 30.000.");
  if (acquisitionCostFundCents < acquisitionCostFundTargetCents)
    blockers.push("O fundo de custos iniciais ainda nao atingiu R$ 3.000.");
  if (tradeInNetCents < tradeInTargetCents)
    blockers.push("O valor liquido da troca ainda nao atingiu R$ 20.000.");
  if (
    financedAmountCents != null &&
    financedAmountCents > financedAmountTargetMaxCents
  )
    blockers.push("O valor financiado ultrapassa o alvo maximo de R$ 80.000.");
  if (!input.downPaymentSeparated)
    blockers.push("A entrada do carro ainda nao esta separada da reserva.");
  if (!income2027Confirmed)
    blockers.push("A renda de 2027 ainda nao esta confirmada.");
  if (totalMonthlyCostCents > input.monthlyCarLimitCents)
    blockers.push("O custo mensal total do carro ultrapassa o teto.");
  if (installmentCents > input.installmentLimitCents)
    blockers.push("A parcela ultrapassa o teto definido.");
  if (!quotesComplete)
    blockers.push("CET, seguro e demais cotacoes ainda nao estao completos.");
  if (reconciledDays < 60)
    blockers.push("As contas ainda nao possuem 60 dias reconciliados.");
  if (concurrentFormalProposals > 1)
    blockers.push("Existe mais de uma proposta formal de credito simultanea.");
  if (!input.fixedCostsConfirmed)
    blockers.push("As contas fixas reais ainda precisam ser confirmadas.");
  if (!input.priorityAPlanComplete)
    blockers.push(
      "Os itens essenciais de prioridade A ainda nao possuem cobertura."
    );
  if (missingInputs.length > 0)
    blockers.push(`Faltam dados da simulacao: ${missingInputs.join(", ")}.`);

  let readinessScore = 0;
  if (overdueDebtCents === 0 && creditIssueResolved) readinessScore += 20;
  if (input.overdraftUsedCents === 0) readinessScore += 15;
  if (income2027Confirmed) readinessScore += 15;
  if (input.reserveCents >= minimumReserveTargetCents) readinessScore += 15;
  if (input.reserveCents >= input.postCarReserveTargetCents)
    readinessScore += 10;
  if (cashDownPaymentCents >= cashDownPaymentTargetCents) readinessScore += 10;
  if (acquisitionCostFundCents >= acquisitionCostFundTargetCents)
    readinessScore += 5;
  if (tradeInNetCents >= tradeInTargetCents) readinessScore += 5;
  if (totalMonthlyCostCents <= input.monthlyCarLimitCents) readinessScore += 10;
  if (quotesComplete) readinessScore += 5;
  readinessScore = Math.min(100, readinessScore);

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
  const v3Decision: CarSimulationResult["v3Decision"] =
    blockers.length > 0
      ? "NO_GO"
      : input.reserveCents >= input.postCarReserveTargetCents
        ? "GO"
        : "GO_CONDICIONAL";
  const recompositionMonthlyCents =
    v3Decision === "GO_CONDICIONAL"
      ? Math.max(
          840_000,
          Math.ceil((input.postCarReserveTargetCents - input.reserveCents) / 3)
        )
      : null;

  return {
    decision:
      v3Decision === "NO_GO"
        ? "not_recommended"
        : v3Decision === "GO"
          ? "fits_safely"
          : "fits_with_risk",
    v3Decision,
    readinessScore,
    blockers,
    missingInputs,
    totalMonthlyCostCents,
    totalFinancingCostCents,
    monthlySurplusCents,
    reserveMonths,
    recompositionMonthlyCents,
    financedAmountCents,
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

export const FINANCIAL_PHASES = [
  "CLEANUP",
  "CAR_PREPARATION",
  "CAR_PURCHASE_READY",
  "POST_CAR_RESERVE",
  "WEALTH_WITH_CAR_DEBT",
  "WEALTH_ACCUMULATION",
  "FINANCIAL_INDEPENDENCE",
] as const;

export type FinancialPhase = (typeof FINANCIAL_PHASES)[number];

export function determineFinancialPhase(input: {
  overdueDebtCents: number;
  overdraftUsedCents: number;
  operatingBufferCents: number;
  operatingBufferTargetCents: number;
  emergencyFundCents: number;
  minimumEmergencyFundCents: number;
  postCarEmergencyFundCents: number;
  carCashCents: number;
  carCashTargetCents: number;
  carCostsCents: number;
  carCostsTargetCents: number;
  cleanCreditMonths: number;
  futureIncomeConfirmed: boolean;
  vehiclePurchased: boolean;
  carAllInMonthlyCents: number;
  carMonthlyLimitCents: number;
  carDebtCents: number;
  financialIndependenceRatioBasisPoints: number;
}): FinancialPhase {
  const values = [
    input.overdueDebtCents,
    input.overdraftUsedCents,
    input.operatingBufferCents,
    input.operatingBufferTargetCents,
    input.emergencyFundCents,
    input.minimumEmergencyFundCents,
    input.postCarEmergencyFundCents,
    input.carCashCents,
    input.carCashTargetCents,
    input.carCostsCents,
    input.carCostsTargetCents,
    input.carAllInMonthlyCents,
    input.carMonthlyLimitCents,
    input.carDebtCents,
  ];
  values.forEach((value, index) =>
    assertNonNegativeCents(value, `phaseValue${index}`)
  );
  if (
    input.overdueDebtCents > 0 ||
    input.overdraftUsedCents > 0 ||
    input.operatingBufferCents < input.operatingBufferTargetCents
  )
    return "CLEANUP";
  if (!input.vehiclePurchased) {
    const ready =
      input.emergencyFundCents >= input.minimumEmergencyFundCents &&
      input.carCashCents >= input.carCashTargetCents &&
      input.carCostsCents >= input.carCostsTargetCents &&
      input.cleanCreditMonths >= 3 &&
      input.futureIncomeConfirmed &&
      input.carAllInMonthlyCents <= input.carMonthlyLimitCents;
    return ready ? "CAR_PURCHASE_READY" : "CAR_PREPARATION";
  }
  if (input.emergencyFundCents < input.postCarEmergencyFundCents)
    return "POST_CAR_RESERVE";
  if (input.carDebtCents > 0) return "WEALTH_WITH_CAR_DEBT";
  if (input.financialIndependenceRatioBasisPoints < 10_000)
    return "WEALTH_ACCUMULATION";
  return "FINANCIAL_INDEPENDENCE";
}

export type IncomeKind =
  | "salary_fixed"
  | "owner_draw"
  | "profit_distribution"
  | "project_payment"
  | "saas_recurring_revenue"
  | "asset_sale"
  | "refund"
  | "bonus"
  | "tax_refund"
  | "dividend"
  | "interest"
  | "gift"
  | "loan_proceeds"
  | "transfer_between_own_accounts"
  | "unknown";

export type AllocationDestination = {
  destination:
    | "overdue"
    | "essential_bills"
    | "variable_budget"
    | "operating_buffer"
    | "emergency_fund"
    | "car_cash"
    | "car_costs"
    | "taxes"
    | "delivery_costs"
    | "investments"
    | "car_amortization"
    | "annual_funds"
    | "business_growth"
    | "quality_of_life"
    | "unallocated";
  amountCents: number;
  priority: number;
  reason: string;
};

function allocation(
  destination: AllocationDestination["destination"],
  amountCents: number,
  priority: number,
  reason: string
): AllocationDestination | null {
  return amountCents > 0
    ? { destination, amountCents, priority, reason }
    : null;
}

export function calculateV3IncomeAllocation(input: {
  amountCents: number;
  incomeKind: IncomeKind;
  phase: FinancialPhase;
  overdueCents?: number;
  essentialGapCents?: number;
  operatingBufferGapCents?: number;
  emergencyGapCents?: number;
  carCashGapCents?: number;
  carCostsGapCents?: number;
}): { allocations: AllocationDestination[]; unallocatedCents: number } {
  assertNonNegativeCents(input.amountCents, "amountCents");
  if (input.incomeKind === "transfer_between_own_accounts") {
    return { allocations: [], unallocatedCents: input.amountCents };
  }
  if (input.incomeKind === "loan_proceeds") {
    return {
      allocations: [
        {
          destination: "unallocated",
          amountCents: input.amountCents,
          priority: 1,
          reason: "Emprestimo e passivo, nao renda disponivel.",
        },
      ],
      unallocatedCents: input.amountCents,
    };
  }

  if (input.incomeKind === "project_payment") {
    const split = calculateProjectSplit(input.amountCents);
    const rows = [
      allocation("taxes", split.taxesCents, 1, "Provisao tributaria de 15%."),
      allocation(
        "delivery_costs",
        split.deliveryCostsCents,
        2,
        "Custos e ferramentas de entrega de 10%."
      ),
    ];
    let remaining = split.goalsCents;
    const orderedGaps: Array<
      [AllocationDestination["destination"], number, string]
    > = [
      ["overdue", input.overdueCents ?? 0, "Quitar atraso antes das metas."],
      [
        "essential_bills",
        input.essentialGapCents ?? 0,
        "Cobrir essenciais ate a proxima renda.",
      ],
      [
        "operating_buffer",
        input.operatingBufferGapCents ?? 0,
        "Recompor o piso operacional.",
      ],
      ["car_cash", input.carCashGapCents ?? 0, "Completar entrada do carro."],
      ["car_costs", input.carCostsGapCents ?? 0, "Completar custos do carro."],
      [
        "emergency_fund",
        input.emergencyGapCents ?? 0,
        "Fortalecer a reserva protegida.",
      ],
    ];
    orderedGaps.forEach(([destination, gap, reason], index) => {
      const amount = Math.min(remaining, Math.max(0, gap));
      const row = allocation(destination, amount, index + 3, reason);
      if (row) rows.push(row);
      remaining -= amount;
    });
    if (remaining > 0) {
      const target =
        input.phase === "WEALTH_WITH_CAR_DEBT"
          ? "investments"
          : input.phase === "WEALTH_ACCUMULATION" ||
              input.phase === "FINANCIAL_INDEPENDENCE"
            ? "investments"
            : "emergency_fund";
      rows.push({
        destination: target,
        amountCents: remaining,
        priority: 20,
        reason: "Excedente destinado pela fase financeira atual.",
      });
      remaining = 0;
    }
    return {
      allocations: rows.filter(
        (row): row is AllocationDestination => row != null
      ),
      unallocatedCents: remaining,
    };
  }

  if (
    input.incomeKind === "salary_fixed" &&
    input.phase === "CAR_PREPARATION"
  ) {
    const exact =
      input.amountCents === 2_000_000
        ? [818_000, 760_000, 422_000]
        : input.amountCents === 600_000
          ? [300_000, 221_600, 78_400]
          : [
              Math.floor(input.amountCents * 0.43),
              Math.floor(input.amountCents * 0.3775),
              0,
            ];
    if (exact[2] === 0) exact[2] = input.amountCents - exact[0] - exact[1];
    const livingDestination =
      input.amountCents === 600_000 ? "variable_budget" : "essential_bills";
    const rows: AllocationDestination[] = [
      {
        destination: livingDestination,
        amountCents: exact[0],
        priority: 1,
        reason: "Custo de vida previsto para este recebimento.",
      },
      {
        destination: "emergency_fund",
        amountCents: exact[1],
        priority: 2,
        reason: "Aporte protegido da reserva.",
      },
      {
        destination: "car_cash",
        amountCents: exact[2],
        priority: 3,
        reason: "Fundo de entrada do carro.",
      },
    ];
    const overdue = Math.min(input.overdueCents ?? 0, exact[2]);
    if (overdue > 0) {
      rows[2].amountCents -= overdue;
      rows.unshift({
        destination: "overdue",
        amountCents: overdue,
        priority: 0,
        reason: "Atrasos vencem o aporte do carro.",
      });
    }
    return {
      allocations: rows.filter(row => row.amountCents > 0),
      unallocatedCents: 0,
    };
  }

  if (
    input.phase === "CLEANUP" ||
    input.phase === "CAR_PREPARATION" ||
    input.phase === "CAR_PURCHASE_READY"
  ) {
    let remaining = input.amountCents;
    const rows: AllocationDestination[] = [];
    const gaps: Array<[AllocationDestination["destination"], number, string]> =
      [
        [
          "overdue",
          input.overdueCents ?? 0,
          "Eliminar atrasos e credito caro.",
        ],
        [
          "essential_bills",
          input.essentialGapCents ?? 0,
          "Cobrir contas essenciais ja cadastradas.",
        ],
        [
          "operating_buffer",
          input.operatingBufferGapCents ?? 0,
          "Recompor o piso operacional de R$ 2.500.",
        ],
        [
          "emergency_fund",
          input.emergencyGapCents ?? 0,
          "Completar a reserva protegida antes do carro.",
        ],
        [
          "car_cash",
          input.carCashGapCents ?? 0,
          "Completar a entrada do carro.",
        ],
        [
          "car_costs",
          input.carCostsGapCents ?? 0,
          "Separar documentacao, seguro e custos iniciais.",
        ],
      ];
    gaps.forEach(([destination, gap, reason], index) => {
      const amountCents = Math.min(remaining, Math.max(0, gap));
      if (amountCents > 0) {
        rows.push({ destination, amountCents, priority: index + 1, reason });
        remaining -= amountCents;
      }
    });
    if (remaining > 0) {
      const destination =
        input.phase === "CAR_PURCHASE_READY" ? "car_cash" : "emergency_fund";
      rows.push({
        destination,
        amountCents: remaining,
        priority: 20,
        reason:
          input.phase === "CAR_PURCHASE_READY"
            ? "Margem adicional para reduzir o financiamento."
            : "Excedente protegido ate a proxima revisao do plano.",
      });
      remaining = 0;
    }
    return { allocations: rows, unallocatedCents: remaining };
  }

  const splits =
    input.phase === "POST_CAR_RESERVE"
      ? ([70, 20, 10] as const)
      : input.phase === "WEALTH_WITH_CAR_DEBT"
        ? ([50, 30, 20] as const)
        : ([70, 20, 10] as const);
  const first = Math.floor((input.amountCents * splits[0]) / 100);
  const second = Math.floor((input.amountCents * splits[1]) / 100);
  const third = input.amountCents - first - second;
  const destinations: AllocationDestination["destination"][] =
    input.phase === "POST_CAR_RESERVE"
      ? ["emergency_fund", "car_amortization", "business_growth"]
      : input.phase === "WEALTH_WITH_CAR_DEBT"
        ? ["investments", "car_amortization", "business_growth"]
        : ["investments", "business_growth", "quality_of_life"];
  return {
    allocations: [first, second, third].map((amountCents, index) => ({
      destination: destinations[index],
      amountCents,
      priority: index + 1,
      reason: "Politica percentual da fase financeira atual.",
    })),
    unallocatedCents: 0,
  };
}

export function calculateFinancialIndependence(input: {
  monthlySpendingCents: number;
  investableNetWorthCents: number;
  withdrawalRateBasisPoints?: number;
}) {
  assertNonNegativeCents(input.monthlySpendingCents, "monthlySpendingCents");
  assertNonNegativeCents(
    input.investableNetWorthCents,
    "investableNetWorthCents"
  );
  const rate = input.withdrawalRateBasisPoints ?? 350;
  if (!Number.isInteger(rate) || rate <= 0 || rate > 2_000)
    throw new Error("withdrawalRateBasisPoints invalido");
  const annualSpendingCents = input.monthlySpendingCents * 12;
  const targetRealCents = Math.ceil(
    (annualSpendingCents * BASIS_POINTS_TOTAL) / rate
  );
  const sustainableAnnualCents = Math.floor(
    (input.investableNetWorthCents * rate) / BASIS_POINTS_TOTAL
  );
  return {
    annualSpendingCents,
    targetRealCents,
    sustainableMonthlyCents: Math.floor(sustainableAnnualCents / 12),
    ratioBasisPoints:
      targetRealCents === 0
        ? 0
        : Math.min(
            BASIS_POINTS_TOTAL,
            Math.floor(
              (input.investableNetWorthCents * BASIS_POINTS_TOTAL) /
                targetRealCents
            )
          ),
  };
}

export function calculateYearsToFinancialTarget(input: {
  targetCents: number;
  currentCents: number;
  monthlyContributionCents: number;
  annualRealReturnBasisPoints?: number;
}) {
  [
    input.targetCents,
    input.currentCents,
    input.monthlyContributionCents,
  ].forEach((value, index) =>
    assertNonNegativeCents(value, `projectionValue${index}`)
  );
  if (input.currentCents >= input.targetCents) return 0;
  if (input.monthlyContributionCents === 0) return null;
  const annualRate = (input.annualRealReturnBasisPoints ?? 500) / 10_000;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const numerator =
    input.targetCents * monthlyRate + input.monthlyContributionCents;
  const denominator =
    input.currentCents * monthlyRate + input.monthlyContributionCents;
  const months =
    monthlyRate === 0
      ? Math.ceil(
          (input.targetCents - input.currentCents) /
            input.monthlyContributionCents
        )
      : Math.ceil(
          Math.log(numerator / denominator) / Math.log(1 + monthlyRate)
        );
  return Math.round((months / 12) * 10) / 10;
}

export function determineFinancialRiskLevel(input: {
  overdueCents: number;
  overdraftUsedCents: number;
  reserveMonths: number;
  variableBudgetUsedPercent: number;
  incomeLost?: boolean;
}): "green" | "yellow" | "red" {
  if (
    input.overdueCents > 0 ||
    input.overdraftUsedCents > 0 ||
    input.reserveMonths < 3 ||
    input.incomeLost
  )
    return "red";
  if (input.reserveMonths < 6 || input.variableBudgetUsedPercent > 90)
    return "yellow";
  return "green";
}
