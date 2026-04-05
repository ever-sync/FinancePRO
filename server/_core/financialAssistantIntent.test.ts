import { describe, expect, it } from "vitest";
import {
  detectFinancialAssistantIntent,
  extractDecisionAmount,
  extractInstallmentCount,
} from "./financialAssistantIntent";

describe("financial assistant intent", () => {
  it("detects company withdrawal questions", () => {
    expect(detectFinancialAssistantIntent("Posso tirar R$ 3.000 da empresa este mes?")).toBe(
      "company_withdrawal_decision"
    );
  });

  it("detects personal spending questions", () => {
    expect(detectFinancialAssistantIntent("Posso gastar R$ 1.200 no pessoal este mes?")).toBe(
      "personal_spend_decision"
    );
  });

  it("detects new monthly cost questions", () => {
    expect(
      detectFinancialAssistantIntent("Posso assumir um custo mensal de R$ 2.500 agora?")
    ).toBe("monthly_cost_decision");
  });

  it("detects hiring, installment purchase and recurring withdrawal questions", () => {
    expect(detectFinancialAssistantIntent("Posso contratar alguem por R$ 4.000 por mes?")).toBe(
      "hiring_decision"
    );
    expect(
      detectFinancialAssistantIntent("Posso comprar um notebook de R$ 12.000 em 12x?")
    ).toBe("installment_purchase_decision");
    expect(
      detectFinancialAssistantIntent("Posso tirar R$ 5.000 todo mes da empresa?")
    ).toBe("recurring_withdrawal_decision");
  });

  it("extracts Brazilian formatted amounts", () => {
    expect(extractDecisionAmount("Posso tirar R$ 3.000 da empresa hoje?")).toBe(3000);
    expect(extractDecisionAmount("Posso gastar 1,2 mil no pessoal?")).toBe(1200);
    expect(extractDecisionAmount("Novo custo mensal de R$ 2.500,50")).toBe(2500.5);
  });

  it("extracts installment counts from common Brazilian phrasing", () => {
    expect(extractInstallmentCount("Posso comprar esse equipamento em 12x?")).toBe(12);
    expect(extractInstallmentCount("Essa compra parcelada em 10 parcelas cabe?")).toBe(10);
  });
});
