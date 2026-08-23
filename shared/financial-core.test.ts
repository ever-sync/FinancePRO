import { describe, expect, it } from "vitest";
import {
  brazilianNationalHolidayDates,
  calculateCarReadiness,
  calculateEmergencyFundTarget,
  calculateProjectSplit,
  calculatePurchaseDecision,
  calculateReserveMonths,
  getNthBusinessDay,
  parseBrazilianMoneyExpression,
  savingsRatePercent,
} from "./financial-core";

describe("financial core", () => {
  it("reproduces the required current and post-car cost calculations", () => {
    const fixedCurrent =
      330_000 +
      60_000 +
      33_000 +
      35_000 +
      35_000 +
      15_000 +
      80_000 +
      140_000 +
      60_000 +
      10_000 +
      20_000;
    expect(fixedCurrent).toBe(818_000);
    expect(fixedCurrent + 300_000).toBe(1_118_000);
    const fixedPostCar = fixedCurrent - 80_000 + 500_000;
    expect(fixedPostCar).toBe(1_238_000);
    expect(fixedPostCar + 300_000).toBe(1_538_000);
  });

  it("calculates all required emergency fund targets", () => {
    expect(calculateEmergencyFundTarget(818_000, 6)).toBe(4_908_000);
    expect(calculateEmergencyFundTarget(1_118_000, 6)).toBe(6_708_000);
    expect(calculateEmergencyFundTarget(1_238_000, 6)).toBe(7_428_000);
    expect(calculateEmergencyFundTarget(1_538_000, 6)).toBe(9_228_000);
    expect(calculateReserveMonths(1_840_000, 818_000)).toBe(2.25);
  });

  it("calculates the purchase list and contingency", () => {
    const base = 150_000 + 849_500 + 145_000 + 93_000 + 1_135_000;
    expect(base).toBe(2_372_500);
    expect(base + Math.round(base * 0.1)).toBe(2_609_750);
  });

  it("calculates the one-off net resource", () => {
    expect(500_000 + 250_000 - 70_000).toBe(680_000);
  });

  it("splits project income without losing cents", () => {
    expect(calculateProjectSplit(1_000_000)).toEqual({
      taxesCents: 150_000,
      deliveryCostsCents: 100_000,
      goalsCents: 750_000,
    });
    const split = calculateProjectSplit(10_001);
    expect(split.taxesCents + split.deliveryCostsCents + split.goalsCents).toBe(
      10_001
    );
  });

  it("keeps expected income out of safe purchase capacity", () => {
    const result = calculatePurchaseDecision({
      amountCents: 450_000,
      operatingBalanceCents: 900_000,
      billsDueBeforeNextIncomeCents: 500_000,
      essentialEnvelopesRemainingCents: 120_000,
      urgentDebtCents: 70_000,
      operatingBufferCents: 50_000,
      confirmedCommitmentsCents: 0,
      desiredDate: "2026-08-23",
      nextIncomeDate: "2026-08-30",
    });
    expect(result.safeToSpendCents).toBe(160_000);
    expect(result.decision).toBe("not_recommended");
  });

  it("blocks a purchase simulation with stale or missing balance", () => {
    const result = calculatePurchaseDecision({
      amountCents: 10_000,
      operatingBalanceCents: null,
      billsDueBeforeNextIncomeCents: 0,
      essentialEnvelopesRemainingCents: 0,
      urgentDebtCents: 0,
      operatingBufferCents: 0,
      confirmedCommitmentsCents: 0,
      desiredDate: "2026-08-23",
    });
    expect(result.decision).toBe("blocked_by_missing_data");
  });

  it("allows a safe purchase only after protecting commitments", () => {
    const result = calculatePurchaseDecision({
      amountCents: 100_000,
      operatingBalanceCents: 500_000,
      billsDueBeforeNextIncomeCents: 150_000,
      essentialEnvelopesRemainingCents: 50_000,
      urgentDebtCents: 0,
      operatingBufferCents: 100_000,
      confirmedCommitmentsCents: 0,
      desiredDate: "2026-08-23",
    });
    expect(result.safeToSpendCents).toBe(200_000);
    expect(result.decision).toBe("approved_safe");
  });

  it("blocks the car while mandatory conditions are pending", () => {
    const result = calculateCarReadiness({
      vehiclePriceCents: 9_000_000,
      downPaymentCents: 2_000_000,
      installmentCents: 300_000,
      termMonths: 36,
      cetAnnualBasisPoints: 1800,
      insuranceMonthlyCents: 50_000,
      fuelMonthlyCents: 80_000,
      ipvaAnnualCents: 480_000,
      maintenanceMonthlyCents: 30_000,
      asaasDebtCents: 70_000,
      overdraftUsedCents: 0,
      reserveCents: 4_908_000,
      postCarReserveTargetCents: 7_428_000,
      downPaymentSeparated: false,
      futureIncomeConfirmed: false,
      fixedCostsConfirmed: false,
      priorityAPlanComplete: false,
      monthlyCarLimitCents: 500_000,
      installmentLimitCents: 300_000,
      confirmedMonthlyIncomeCents: 2_600_000,
      livingCostAfterCarCents: 1_538_000,
      currentOperatingBalanceCents: 0,
    });
    expect(result.decision).toBe("not_recommended");
    expect(result.blockers.length).toBeGreaterThanOrEqual(5);
    expect(result.totalMonthlyCostCents).toBe(500_000);
  });

  it("approves the car only with all gates satisfied", () => {
    const result = calculateCarReadiness({
      vehiclePriceCents: 9_000_000,
      downPaymentCents: 2_000_000,
      installmentCents: 280_000,
      termMonths: 36,
      cetAnnualBasisPoints: 1700,
      insuranceMonthlyCents: 45_000,
      fuelMonthlyCents: 70_000,
      ipvaAnnualCents: 360_000,
      maintenanceMonthlyCents: 25_000,
      asaasDebtCents: 0,
      overdraftUsedCents: 0,
      reserveCents: 7_500_000,
      postCarReserveTargetCents: 7_428_000,
      downPaymentSeparated: true,
      futureIncomeConfirmed: true,
      fixedCostsConfirmed: true,
      priorityAPlanComplete: true,
      monthlyCarLimitCents: 500_000,
      installmentLimitCents: 300_000,
      confirmedMonthlyIncomeCents: 2_600_000,
      livingCostAfterCarCents: 1_538_000,
      currentOperatingBalanceCents: 500_000,
    });
    expect(result.blockers).toEqual([]);
    expect(result.readinessScore).toBe(100);
    expect(result.decision).toBe("fits_safely");
  });

  it("calculates fifth business day with weekends and holidays", () => {
    expect(getNthBusinessDay(2026, 8, 5)).toBe("2026-08-07");
    expect(getNthBusinessDay(2026, 9, 5)).toBe("2026-09-08");
    expect(getNthBusinessDay(2026, 8, 5, ["2026-08-07"])).toBe("2026-08-10");
    expect(brazilianNationalHolidayDates(2026).has("2026-04-03")).toBe(true);
  });

  it("parses BRL expressions and rejects the 5000 mil ambiguity", () => {
    expect(parseBrazilianMoneyExpression("Gastei R$ 89,90")).toEqual({
      kind: "value",
      amountCents: 8_990,
    });
    expect(parseBrazilianMoneyExpression("Recebi 5 mil")).toEqual({
      kind: "value",
      amountCents: 500_000,
    });
    expect(parseBrazilianMoneyExpression("Vou vender por 5000 mil")).toEqual({
      kind: "ambiguous",
      alternativesCents: [500_000, 500_000_000],
    });
  });

  it("calculates savings rate from confirmed values", () => {
    expect(savingsRatePercent(2_600_000, 981_600, 500_400, 0)).toBe(57);
    expect(savingsRatePercent(0, 0, 0, 0)).toBe(0);
  });
});
