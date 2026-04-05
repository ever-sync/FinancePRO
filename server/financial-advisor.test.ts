import { describe, expect, it } from "vitest";
import {
  calculateFinancialAdvisorOnboarding,
  calculateFinancialGovernanceSnapshot,
  evaluateFinancialDecisionScenariosFromSnapshot,
} from "./financial-advisor";

describe("financial advisor governance snapshot", () => {
  it("calculates safe spending and reserve recommendations for a healthy month", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "12000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 60000,
            netRevenue: 56400,
            taxAmount: 3600,
            fixedCosts: 8000,
            variableCosts: 6000,
            employeeCosts: 9000,
            purchases: 2000,
            reserve: 15000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "4000" },
        variableCosts: { total: "1200" },
        debts: { totalMonthly: "800" },
        reserve: { total: "9000" },
      },
      calendarItems: [
        {
          day: 29,
          description: "[PES] Cartao",
          amount: "1200",
          type: "pessoal-fixo",
          status: "pendente",
        },
      ],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [
        { status: "PENDING", dueDate: "2026-03-30" },
      ],
    });

    expect(snapshot.cashRiskLevel).toBe("healthy");
    expect(snapshot.safeToSpendMonth).toBeGreaterThan(0);
    expect(snapshot.safeToSpendNow).toBeGreaterThan(0);
    expect(snapshot.companyReserveRecommendation).toBeGreaterThan(0);
    expect(snapshot.personalReserveRecommendation).toBeGreaterThan(0);
    expect(snapshot.taxProvision).toBe(3600);
  });

  it("marks the month as critical when there are overdue items and no safe spending left", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "8000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 15000,
            netRevenue: 14100,
            taxAmount: 900,
            fixedCosts: 7000,
            variableCosts: 5000,
            employeeCosts: 4000,
            purchases: 2000,
            reserve: 1000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "3500" },
        variableCosts: { total: "2200" },
        debts: { totalMonthly: "1800" },
        reserve: { total: "500" },
      },
      calendarItems: [
        {
          day: 10,
          description: "[EMP] Imposto atrasado",
          amount: "1800",
          type: "empresa-fixo",
          status: "atrasada",
        },
      ],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [
        { status: "OVERDUE", dueDate: "2026-03-12" },
      ],
    });

    expect(snapshot.cashRiskLevel).toBe("critical");
    expect(snapshot.safeToSpendMonth).toBe(0);
    expect(snapshot.counts.overdueItems).toBeGreaterThan(0);
    expect(snapshot.counts.overdueCharges).toBeGreaterThan(0);
    expect(snapshot.paymentPriority[0]?.urgency).toBe("overdue");
  });

  it("evaluates a company withdrawal against the current operational headroom", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "12000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 60000,
            netRevenue: 56400,
            taxAmount: 3600,
            fixedCosts: 8000,
            variableCosts: 6000,
            employeeCosts: 9000,
            purchases: 2000,
            reserve: 15000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "4000" },
        variableCosts: { total: "1200" },
        debts: { totalMonthly: "800" },
        reserve: { total: "9000" },
      },
      calendarItems: [],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [],
    });

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      withdrawalAmount: 3000,
    });

    expect(scenarios.headrooms.company).toBeGreaterThan(0);
    expect(scenarios.scenarios.withdrawal.amount).toBe(3000);
    expect(scenarios.scenarios.withdrawal.tone).not.toBe("critical");
    expect(scenarios.scenarios.withdrawal.metrics[0]?.label).toBe("Folga operacional atual");
  });

  it("flags a new monthly cost as critical when the company has no real room left", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "8000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 15000,
            netRevenue: 14100,
            taxAmount: 900,
            fixedCosts: 7000,
            variableCosts: 5000,
            employeeCosts: 4000,
            purchases: 2000,
            reserve: 1000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "3500" },
        variableCosts: { total: "2200" },
        debts: { totalMonthly: "1800" },
        reserve: { total: "500" },
      },
      calendarItems: [],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [{ status: "OVERDUE", dueDate: "2026-03-12" }],
    });

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      monthlyCostAmount: 2500,
    });

    expect(scenarios.scenarios.monthlyCost.tone).toBe("critical");
    expect(scenarios.scenarios.monthlyCost.consumptionPercent).toBe(100);
  });

  it("treats hiring as more conservative than a generic monthly cost", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "12000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 60000,
            netRevenue: 56400,
            taxAmount: 3600,
            fixedCosts: 8000,
            variableCosts: 6000,
            employeeCosts: 9000,
            purchases: 2000,
            reserve: 15000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "4000" },
        variableCosts: { total: "1200" },
        debts: { totalMonthly: "800" },
        reserve: { total: "9000" },
      },
      calendarItems: [],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [],
    });

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      monthlyCostAmount: 4000,
      hiringCostAmount: 4000,
    });

    expect(scenarios.scenarios.hiring.consumptionPercent).toBeGreaterThan(0);
    expect(scenarios.scenarios.hiring.metrics[0]?.label).toBe("Custo mensal da contratacao");
    expect(["attention", "critical"]).toContain(scenarios.scenarios.hiring.tone);
  });

  it("evaluates installment purchases by the monthly parcel instead of the full amount", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "12000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 60000,
            netRevenue: 56400,
            taxAmount: 3600,
            fixedCosts: 8000,
            variableCosts: 6000,
            employeeCosts: 9000,
            purchases: 2000,
            reserve: 15000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "4000" },
        variableCosts: { total: "1200" },
        debts: { totalMonthly: "800" },
        reserve: { total: "9000" },
      },
      calendarItems: [],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [],
    });

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      installmentPurchaseAmount: 12000,
      installmentPurchaseMonths: 12,
    });

    expect(scenarios.scenarios.installmentPurchase.amount).toBe(1000);
    expect(scenarios.scenarios.installmentPurchase.metrics[1]?.label).toBe("Parcela mensal");
    expect(scenarios.scenarios.installmentPurchase.metadata?.installments).toBe(12);
  });

  it("distinguishes recurring withdrawal from a one-off withdrawal", () => {
    const snapshot = calculateFinancialGovernanceSnapshot({
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "12000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        summary: {
          current: {
            grossRevenue: 60000,
            netRevenue: 56400,
            taxAmount: 3600,
            fixedCosts: 8000,
            variableCosts: 6000,
            employeeCosts: 9000,
            purchases: 2000,
            reserve: 15000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "4000" },
        variableCosts: { total: "1200" },
        debts: { totalMonthly: "800" },
        reserve: { total: "9000" },
      },
      calendarItems: [],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [],
    });

    const scenarios = evaluateFinancialDecisionScenariosFromSnapshot(snapshot, {
      withdrawalAmount: 5000,
      recurringWithdrawalAmount: 5000,
    });

    expect(scenarios.scenarios.recurringWithdrawal.metrics[0]?.label).toBe(
      "Folga apos retirada recorrente"
    );
    expect(scenarios.scenarios.recurringWithdrawal.summary).toContain("recorrente");
    expect(scenarios.scenarios.withdrawal.summary).not.toContain("recorrente");
  });

  it("marks onboarding as ready when mentor base, channel and plan are complete", () => {
    const context = {
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: {
        companyName: "FinancePRO",
        taxPercent: "6",
        tithePercent: "10",
        investmentPercent: "10",
        proLaboreGross: "12000",
        companyReserveMonths: 3,
        personalReserveMonths: 6,
        companyMinCashMonths: "1",
        personalMinCashMonths: "1",
      },
      company: {
        revenue: { count: 3 },
        fixedCosts: { count: 2 },
        variableCosts: { count: 1 },
        employees: { count: 1 },
        purchases: { count: 1 },
        reserve: { total: "15000" },
        summary: {
          current: {
            grossRevenue: 60000,
            netRevenue: 56400,
            taxAmount: 3600,
            fixedCosts: 8000,
            variableCosts: 6000,
            employeeCosts: 9000,
            purchases: 2000,
            reserve: 15000,
          },
        },
      },
      personal: {
        fixedCosts: { total: "4000" },
        variableCosts: { total: "1200" },
        debts: { totalMonthly: "800", count: 1 },
        reserve: { total: "9000" },
      },
      calendarItems: [
        {
          day: 29,
          description: "[PES] Cartao",
          amount: "1200",
          type: "pessoal-fixo",
          status: "pendente",
        },
      ],
      debts: [],
      investments: [{ id: 1 }],
      reserveFunds: [{ id: 1 }],
      asaasCharges: [{ status: "PENDING", dueDate: "2026-03-30" }],
    };

    const snapshot = calculateFinancialGovernanceSnapshot(context);
    const onboarding = calculateFinancialAdvisorOnboarding({
      context,
      snapshot,
      whatsappIntegration: {
        instanceId: "instance-1",
        apiBaseUrl: "https://api.uazapi.com",
        authorizedPhone: "5511999999999",
        enabled: true,
        lastConnectionStatus: "sincronizado",
      },
      hasCurrentPlan: true,
    });

    expect(onboarding.status).toBe("ready");
    expect(onboarding.completedSteps).toBe(5);
    expect(onboarding.recommendedStepKey).toBeNull();
    expect(onboarding.metrics.hasWhatsAppReady).toBe(true);
  });

  it("points onboarding to profile setup when the mentor still lacks financial parameters", () => {
    const context = {
      generatedAt: "2026-03-27",
      referenceDate: "2026-03-27",
      month: 3,
      year: 2026,
      settings: null,
      company: null,
      personal: null,
      calendarItems: [],
      debts: [],
      investments: [],
      reserveFunds: [],
      asaasCharges: [],
    };

    const onboarding = calculateFinancialAdvisorOnboarding({
      context,
      whatsappIntegration: null,
      hasCurrentPlan: false,
    });

    expect(onboarding.status).toBe("setup");
    expect(onboarding.recommendedStepKey).toBe("profile");
    expect(onboarding.steps[0]?.status).toBe("pending");
    expect(onboarding.progressPercent).toBeLessThan(30);
  });
});
