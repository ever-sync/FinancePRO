import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getFinancialPlanActionById,
  updateFinancialPlanAction,
  updateCompanyFixedCost,
  updateCompanyVariableCost,
  updatePersonalFixedCost,
  updatePersonalVariableCost,
  updateDebt,
  getDebts,
  createReserveFund,
  resendAsaasCharge,
} = vi.hoisted(() => ({
  getFinancialPlanActionById: vi.fn(),
  updateFinancialPlanAction: vi.fn(),
  updateCompanyFixedCost: vi.fn(),
  updateCompanyVariableCost: vi.fn(),
  updatePersonalFixedCost: vi.fn(),
  updatePersonalVariableCost: vi.fn(),
  updateDebt: vi.fn(),
  getDebts: vi.fn(),
  createReserveFund: vi.fn(),
  resendAsaasCharge: vi.fn(),
}));

vi.mock("./db", () => ({
  updateCompanyFixedCost,
  updateCompanyVariableCost,
  updatePersonalFixedCost,
  updatePersonalVariableCost,
  updateDebt,
  getDebts,
  createReserveFund,
}));

vi.mock("./db/whatsapp", () => ({
  getFinancialPlanActionById,
  updateFinancialPlanAction,
}));

vi.mock("./asaas", () => ({
  resendAsaasCharge,
}));
vi.mock("./db/asaas", () => ({}));
vi.mock("./db/financial-advisor", () => ({}));
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));
vi.mock("./_core/financialAssistantIntent", () => ({
  detectFinancialAssistantIntent: vi.fn(),
  extractDecisionAmount: vi.fn(),
  extractInstallmentCount: vi.fn(),
}));

import { confirmFinancialAdvisorAction } from "./financial-advisor";

describe("financial advisor plan action execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a real payment update for the top fixed-cost priority", async () => {
    getFinancialPlanActionById.mockResolvedValue({
      id: 10,
      status: "pendente",
      actionType: "pay_priority_items",
      title: "Regularizar vencidos imediatamente",
      metadata: JSON.stringify({
        targetItem: {
          id: "empresa-fixo:2026-04-10:[EMP] DAS",
          title: "[EMP] DAS",
          source: "company",
          dueDate: "2026-04-10",
          amount: 1200,
          status: "atrasada",
          urgency: "overdue",
          recommendedAction: "Pagar ou renegociar imediatamente.",
          sourceId: 42,
          sourceType: "company_fixed_cost",
          actionable: true,
        },
      }),
    });

    const result = await confirmFinancialAdvisorAction(7, 10);

    expect(updateCompanyFixedCost).toHaveBeenCalledWith(42, 7, { status: "pago" });
    expect(updateFinancialPlanAction).toHaveBeenCalledTimes(1);
    const actionUpdate = updateFinancialPlanAction.mock.calls[0]?.[2];
    const parsedMetadata = JSON.parse(String(actionUpdate?.metadata || "{}"));
    expect(parsedMetadata.execution).toMatchObject({
      kind: "payment_status_update",
      updatedStatus: "pago",
    });
    expect(result).toMatchObject({
      success: true,
      executionKind: "payment_status_update",
    });
  });

  it("reduces debt balance instead of force-quitting the debt", async () => {
    getFinancialPlanActionById.mockResolvedValue({
      id: 11,
      status: "pendente",
      actionType: "pay_priority_items",
      title: "Regularizar vencidos imediatamente",
      metadata: JSON.stringify({
        targetItem: {
          id: "divida:2026-04-05:[DIV] Cartao principal",
          title: "[DIV] Cartao principal",
          source: "debt",
          dueDate: "2026-04-05",
          amount: 300,
          status: "atrasada",
          urgency: "overdue",
          recommendedAction: "Pagar ou renegociar imediatamente.",
          sourceId: 9,
          sourceType: "debt",
          actionable: true,
        },
      }),
    });
    getDebts.mockResolvedValue([
      {
        id: 9,
        currentBalance: "1500.00",
        monthlyPayment: "300.00",
        paidInstallments: 2,
        totalInstallments: 6,
        status: "atrasada",
      },
    ]);

    const result = await confirmFinancialAdvisorAction(7, 11);

    expect(updateDebt).toHaveBeenCalledWith(9, 7, {
      currentBalance: "1200.00",
      paidInstallments: 3,
      status: "ativa",
    });
    expect(result).toMatchObject({
      success: true,
      executionKind: "payment_status_update",
      message: expect.stringContaining("Saldo restante: R$ 1200.00"),
    });
  });

  it("executes a real follow-up for the most urgent Asaas charge", async () => {
    getFinancialPlanActionById.mockResolvedValue({
      id: 12,
      status: "pendente",
      actionType: "charge_follow_up",
      title: "Atuar nas cobrancas abertas do Asaas",
      metadata: JSON.stringify({
        targetCharge: {
          id: 88,
          asaasChargeId: "pay_123",
          description: "Mensalidade ACME",
          billingType: "PIX",
          status: "OVERDUE",
          dueDate: "2026-04-10",
          value: 850,
        },
      }),
    });
    resendAsaasCharge.mockResolvedValue({
      id: 88,
      asaasChargeId: "pay_123",
      description: "Mensalidade ACME",
      billingType: "PIX",
      status: "PENDING",
      dueDate: "2026-04-10",
      value: "850.00",
      pixCopyAndPaste: "000201...",
    });

    const result = await confirmFinancialAdvisorAction(7, 12);

    expect(resendAsaasCharge).toHaveBeenCalledWith(7, 88);
    expect(updateFinancialPlanAction).toHaveBeenCalledTimes(1);
    const actionUpdate = updateFinancialPlanAction.mock.calls[0]?.[2];
    const parsedMetadata = JSON.parse(String(actionUpdate?.metadata || "{}"));
    expect(parsedMetadata.execution).toMatchObject({
      kind: "charge_follow_up",
    });
    expect(parsedMetadata.execution.targetCharge).toMatchObject({
      id: 88,
      description: "Mensalidade ACME",
      billingType: "PIX",
      status: "PENDING",
      dueDate: "2026-04-10",
      value: 850,
      pixCopyAndPaste: "000201...",
    });
    expect(result).toMatchObject({
      success: true,
      executionKind: "charge_follow_up",
      targetChargeId: 88,
      billingType: "PIX",
      dueDate: "2026-04-10",
      value: 850,
      message: expect.stringContaining("Mensalidade ACME"),
    });
  });
});
