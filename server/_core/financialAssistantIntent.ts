export type FinancialAssistantIntent =
  | "monthly_plan_request"
  | "cash_advice"
  | "company_summary"
  | "personal_summary"
  | "upcoming_bills"
  | "overdue_items"
  | "consolidated_analysis"
  | "spending_limit"
  | "company_withdrawal_decision"
  | "recurring_withdrawal_decision"
  | "personal_spend_decision"
  | "monthly_cost_decision"
  | "hiring_decision"
  | "installment_purchase_decision"
  | "reserve_transfer"
  | "payment_priority"
  | "financial_health"
  | "generic_chat";

function detectBaseIntent(message: string): FinancialAssistantIntent {
  const text = message.toLowerCase();
  if (text.includes("plano") || text.includes("começo do mês") || text.includes("comeco do mes")) {
    return "monthly_plan_request";
  }
  if (text.includes("o que fazer com") || text.includes("dinheiro neste") || text.includes("dinheiro no mes")) {
    return "cash_advice";
  }
  if (text.includes("empresa")) return "company_summary";
  if (text.includes("pessoal")) return "personal_summary";
  if (text.includes("venc") || text.includes("semana") || text.includes("contas")) return "upcoming_bills";
  if (text.includes("atrasad") || text.includes("inadimpl")) return "overdue_items";
  if (text.includes("resumo") || text.includes("geral") || text.includes("consolid")) {
    return "consolidated_analysis";
  }
  return "generic_chat";
}

export function detectFinancialAssistantIntent(message: string): FinancialAssistantIntent {
  const text = message.toLowerCase();
  if (
    (text.includes("tirar") || text.includes("retirada") || text.includes("retirar")) &&
    text.includes("empresa") &&
    (text.includes("todo mes") || text.includes("todo mês") || text.includes("recorrente") || text.includes("fixo"))
  ) return "recurring_withdrawal_decision";
  if (
    text.includes("contratar") ||
    text.includes("contratacao") ||
    text.includes("contratação") ||
    text.includes("funcionario") ||
    text.includes("funcionário") ||
    text.includes("clt") ||
    text.includes("freelancer fixo")
  ) return "hiring_decision";
  if (
    (text.includes("parcelad") || text.includes("parcela") || /\b\d{1,2}\s*x\b/i.test(text)) &&
    (text.includes("comprar") ||
      text.includes("compra") ||
      text.includes("equipamento") ||
      text.includes("maquina") ||
      text.includes("máquina") ||
      text.includes("notebook"))
  ) return "installment_purchase_decision";
  if (
    (text.includes("tirar") || text.includes("retirar") || text.includes("sacar")) &&
    text.includes("empresa")
  ) return "company_withdrawal_decision";
  if (
    text.includes("novo custo") ||
    text.includes("custo mensal") ||
    text.includes("assumir um custo") ||
    text.includes("assumir custo") ||
    text.includes("assinar uma ferramenta") ||
    text.includes("assinar ferramenta")
  ) return "monthly_cost_decision";
  if (
    (
      text.includes("gastar isso") ||
      text.includes("comprar isso") ||
      text.includes("gasto pessoal") ||
      (text.includes("gastar") && text.includes("pessoal")) ||
      (text.includes("comprar") && text.includes("pessoal"))
    ) &&
    !text.includes("hoje")
  ) return "personal_spend_decision";
  if (
    text.includes("quanto posso gastar") ||
    text.includes("gastar hoje") ||
    text.includes("gastar neste") ||
    text.includes("gastar esse")
  ) return "spending_limit";
  if (
    text.includes("fundo de reserva") ||
    text.includes("transferir para reserva") ||
    text.includes("reserva pessoal") ||
    text.includes("reserva da empresa")
  ) return "reserve_transfer";
  if (
    text.includes("pagar primeiro") ||
    text.includes("ordem de pagamento") ||
    text.includes("prioridade de pagamento")
  ) return "payment_priority";
  if (
    text.includes("saude financeira") ||
    text.includes("saude do caixa") ||
    text.includes("saude da empresa")
  ) return "financial_health";
  return detectBaseIntent(message);
}

function parseBrazilianAmount(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  if (cleaned.includes(".") && cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (cleaned.includes(",")) {
    const parsed = Number.parseFloat(cleaned.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (cleaned.includes(".")) {
    const parts = cleaned.split(".");
    const normalized = parts.slice(1).every(part => part.length === 3)
      ? parts.join("")
      : cleaned;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractDecisionAmount(message: string) {
  const milMatch = message.match(/(\d+(?:[.,]\d+)?)\s*(?:mil|k)\b/i);
  if (milMatch) {
    const parsed = parseBrazilianAmount(milMatch[1]);
    if (parsed != null) return parsed * 1000;
  }

  const currencyMatch = message.match(/r\$\s*([\d.,]+)/i);
  if (currencyMatch) {
    const parsed = parseBrazilianAmount(currencyMatch[1]);
    if (parsed != null) return parsed;
  }

  const numberMatch = message.match(/(\d[\d.,]*)/);
  if (numberMatch) {
    const parsed = parseBrazilianAmount(numberMatch[1]);
    if (parsed != null) return parsed;
  }

  return null;
}

export function extractInstallmentCount(message: string) {
  const installmentMatch =
    message.match(/\b(\d{1,2})\s*x\b/i) ||
    message.match(/\b(\d{1,2})\s*parcelas?\b/i);

  if (!installmentMatch) return null;

  const parsed = Number.parseInt(installmentMatch[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isAdvisorIntent(intent: FinancialAssistantIntent) {
  return (
    intent === "cash_advice" ||
    intent === "upcoming_bills" ||
    intent === "overdue_items" ||
    intent === "consolidated_analysis" ||
    intent === "spending_limit" ||
    intent === "company_withdrawal_decision" ||
    intent === "recurring_withdrawal_decision" ||
    intent === "personal_spend_decision" ||
    intent === "monthly_cost_decision" ||
    intent === "hiring_decision" ||
    intent === "installment_purchase_decision" ||
    intent === "reserve_transfer" ||
    intent === "payment_priority" ||
    intent === "financial_health"
  );
}
