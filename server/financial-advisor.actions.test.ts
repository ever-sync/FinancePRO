import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getFinancialPlanActionById,
  updateFinancialPlanAction,
  updateCompanyFixedCost,
  updateCompanyVariableCost,
  updateRevenue,
  updatePersonalFixedCost,
  updatePersonalVariableCost,
  updateDebt,
  getDebts,
  createReserveFund,
  getClients,
  getRevenueById,
  resendAsaasCharge,
  createAsaasCharge,
} = vi.hoisted(() => ({
  getFinancialPlanActionById: vi.fn(),
  updateFinancialPlanAction: vi.fn(),
  updateCompanyFixedCost: vi.fn(),
  updateCompanyVariableCost: vi.fn(),
  updateRevenue: vi.fn(),
  updatePersonalFixedCost: vi.fn(),
  updatePersonalVariableCost: vi.fn(),
  updateDebt: vi.fn(),
  getDebts: vi.fn(),
  createReserveFund: vi.fn(),
  getClients: vi.fn(),
  getRevenueById: vi.fn(),
  resendAsaasCharge: vi.fn(),
  createAsaasCharge: vi.fn(),
}));

vi.mock("./db", () => ({
  updateCompanyFixedCost,
  updateCompanyVariableCost,
  updateRevenue,
  updatePersonalFixedCost,
  updatePersonalVariableCost,
  updateDebt,
  getDebts,
  createReserveFund,
  getClients,
}));

vi.mock("./db/whatsapp", () => ({
  getFinancialPlanActionById,
  updateFinancialPlanAction,
}));

vi.mock("./asaas", () => ({
  resendAsaasCharge,
  createAsaasCharge,
}));
vi.mock("./db/asaas", () => ({
  getRevenueById,
}));
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

  it("creates a real Asaas charge for an eligible pending revenue", async () => {
    getFinancialPlanActionById.mockResolvedValue({
      id: 13,
      status: "pendente",
      actionType: "create_asaas_charge",
      title: "Gerar cobranca Asaas para receita pendente",
      metadata: JSON.stringify({
        targetRevenue: {
          revenueId: 51,
          description: "Consultoria Abril",
          clientName: "ACME LTDA",
          dueDate: "2026-04-20",
          value: 1900,
          billingType: "PIX",
        },
      }),
    });
    getRevenueById.mockResolvedValue({
      id: 51,
      description: "Consultoria Abril",
      client: "ACME LTDA",
      dueDate: "2026-04-20",
      grossAmount: "1900.00",
      asaasPaymentId: null,
    });
    getClients.mockResolvedValue([{ id: 8, name: "ACME LTDA" }]);
    createAsaasCharge.mockResolvedValue({
      id: 144,
      asaasChargeId: "pay_new_144",
      description: "Consultoria Abril",
      billingType: "PIX",
      status: "PENDING",
      dueDate: "2026-04-20",
      value: "1900.00",
      pixCopyAndPaste: "000201pix...",
    });

    const result = await confirmFinancialAdvisorAction(7, 13);

    expect(createAsaasCharge).toHaveBeenCalledWith(7, {
      clientId: 8,
      revenueId: 51,
      description: "Consultoria Abril",
      value: "1900.00",
      dueDate: "2026-04-20",
      billingType: "PIX",
    });
    const actionUpdate = updateFinancialPlanAction.mock.calls[0]?.[2];
    const parsedMetadata = JSON.parse(String(actionUpdate?.metadata || "{}"));
    expect(parsedMetadata.execution).toMatchObject({
      kind: "create_asaas_charge",
    });
    expect(parsedMetadata.execution.targetCharge).toMatchObject({
      id: 144,
      description: "Consultoria Abril",
      billingType: "PIX",
      status: "PENDING",
    });
    expect(result).toMatchObject({
      success: true,
      executionKind: "create_asaas_charge",
      targetChargeId: 144,
      revenueId: 51,
      billingType: "PIX",
      dueDate: "2026-04-20",
      value: 1900,
      message: expect.stringContaining("ACME LTDA"),
    });
  });

  it("registers a pending revenue as received", async () => {
    getFinancialPlanActionById.mockResolvedValue({
      id: 14,
      status: "pendente",
      actionType: "register_revenue_receipt",
      title: "Registrar recebimento pendente",
      metadata: JSON.stringify({
        targetRevenue: {
          revenueId: 77,
          description: "Projeto Site Abril",
          clientName: "Studio Norte",
          dueDate: "2026-04-03",
          value: 2400,
        },
      }),
    });
    getRevenueById.mockResolvedValue({
      id: 77,
      description: "Projeto Site Abril",
      client: "Studio Norte",
      dueDate: "2026-04-03",
      netAmount: "2400.00",
      status: "pendente",
      receivedDate: null,
    });

    const result = await confirmFinancialAdvisorAction(7, 14);

    expect(updateRevenue).toHaveBeenCalledWith(77, 7, {
      status: "recebido",
      receivedDate: expect.stringMatching(/^20\d{2}-\d{2}-\d{2}$/),
    });
    const actionUpdate = updateFinancialPlanAction.mock.calls[0]?.[2];
    const parsedMetadata = JSON.parse(String(actionUpdate?.metadata || "{}"));
    expect(parsedMetadata.execution).toMatchObject({
      kind: "register_revenue_receipt",
      receivedDate: expect.stringMatching(/^20\d{2}-\d{2}-\d{2}$/),
    });
    expect(result).toMatchObject({
      success: true,
      executionKind: "register_revenue_receipt",
      revenueId: 77,
      value: 2400,
      message: expect.stringContaining("Projeto Site Abril"),
    });
  });

  it("marks the most pressured debt as renegotiated with an audit trail", async () => {
    getFinancialPlanActionById.mockResolvedValue({
      id: 15,
      status: "pendente",
      actionType: "renegotiate_debt",
      title: "Renegociar divida pressionada",
      metadata: JSON.stringify({
        targetDebt: {
          debtId: 22,
          creditor: "Banco Atlas",
          description: "Capital de giro",
          currentBalance: 8200,
          monthlyPayment: 980,
          priority: "alta",
          status: "atrasada",
        },
      }),
    });
    getDebts.mockResolvedValue([
      {
        id: 22,
        creditor: "Banco Atlas",
        description: "Capital de giro",
        currentBalance: "8200.00",
        monthlyPayment: "980.00",
        priority: "alta",
        status: "atrasada",
        notes: "Contato inicial feito",
      },
    ]);

    const result = await confirmFinancialAdvisorAction(7, 15);

    expect(updateDebt).toHaveBeenCalledWith(
      22,
      7,
      expect.objectContaining({
        status: "renegociada",
        notes: expect.stringContaining("Renegociacao iniciada pelo mentor"),
      })
    );
    const actionUpdate = updateFinancialPlanAction.mock.calls[0]?.[2];
    const parsedMetadata = JSON.parse(String(actionUpdate?.metadata || "{}"));
    expect(parsedMetadata.execution).toMatchObject({
      kind: "renegotiate_debt",
    });
    expect(result).toMatchObject({
      success: true,
      executionKind: "renegotiate_debt",
      debtId: 22,
      currentBalance: 8200,
      monthlyPayment: 980,
      message: expect.stringContaining("Capital de giro"),
    });
  });
});
