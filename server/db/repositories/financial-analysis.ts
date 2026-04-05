import { getDb } from "../../db";
import {
  supplierPurchases,
  companyFixedCosts,
  companyVariableCosts,
  personalFixedCosts,
  personalVariableCosts,
  debts,
  investments,
  revenues,
} from "../../../drizzle/schema";
import { eq, and, sql, ne } from "drizzle-orm";
import { invokeLLM, Message } from "../../_core/llm";
import axios from "axios";

export interface FinancialAnalysis {
  summary: string;
  alerts: Alert[];
  recommendations: Recommendation[];
  totalExpenses: number;
  totalRevenue: number;
  balance: number;
  expenseByCategory: ExpenseByCategory[];
}

export interface Alert {
  type: "critical" | "warning" | "info";
  title: string;
  message: string;
  impact?: number;
}

export interface Recommendation {
  category: string;
  title: string;
  description: string;
  potentialSavings?: number;
  priority: "high" | "medium" | "low";
}

export interface ExpenseByCategory {
  category: string;
  amount: number;
  percentage: number;
}

export async function analyzeFinancialData(
  userId: number,
  month?: number,
  year?: number
): Promise<FinancialAnalysis> {
  const db = await getDb();
  
  if (!db) {
    throw new Error("Database not available");
  }

  const currentMonth = month ?? new Date().getMonth() + 1;
  const currentYear = year ?? new Date().getFullYear();

  // Buscar todas as despesas do mês
  const [
    supplierPurchasesData,
    companyFixedCostsData,
    companyVariableCostsData,
    personalFixedCostsData,
    personalVariableCostsData,
    debtsData,
    revenuesData,
  ] = await Promise.all([
    db
      .select()
      .from(supplierPurchases)
      .where(
        and(
          eq(supplierPurchases.userId, userId),
          sql`EXTRACT(MONTH FROM ${supplierPurchases.dueDate}::date) = ${currentMonth}`,
          sql`EXTRACT(YEAR FROM ${supplierPurchases.dueDate}::date) = ${currentYear}`
        )
      ),
    db
      .select()
      .from(companyFixedCosts)
      .where(
        and(
          eq(companyFixedCosts.userId, userId),
          eq(companyFixedCosts.month, currentMonth),
          eq(companyFixedCosts.year, currentYear)
        )
      ),
    db
      .select()
      .from(companyVariableCosts)
      .where(
        and(
          eq(companyVariableCosts.userId, userId),
          sql`EXTRACT(MONTH FROM ${companyVariableCosts.date}::date) = ${currentMonth}`,
          sql`EXTRACT(YEAR FROM ${companyVariableCosts.date}::date) = ${currentYear}`
        )
      ),
    db
      .select()
      .from(personalFixedCosts)
      .where(
        and(
          eq(personalFixedCosts.userId, userId),
          eq(personalFixedCosts.month, currentMonth),
          eq(personalFixedCosts.year, currentYear)
        )
      ),
    db
      .select()
      .from(personalVariableCosts)
      .where(
        and(
          eq(personalVariableCosts.userId, userId),
          sql`EXTRACT(MONTH FROM ${personalVariableCosts.date}::date) = ${currentMonth}`,
          sql`EXTRACT(YEAR FROM ${personalVariableCosts.date}::date) = ${currentYear}`
        )
      ),
    db
      .select()
      .from(debts)
      .where(
        and(
          eq(debts.userId, userId),
          ne(debts.status, "quitada")
        )
      ),
    db
      .select()
      .from(revenues)
      .where(
        and(
          eq(revenues.userId, userId),
          sql`EXTRACT(MONTH FROM ${revenues.dueDate}::date) = ${currentMonth}`,
          sql`EXTRACT(YEAR FROM ${revenues.dueDate}::date) = ${currentYear}`
        )
      ),
  ]);

  // Calcular totais
  const totalSupplierPurchases = supplierPurchasesData.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const totalCompanyFixed = companyFixedCostsData.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const totalCompanyVariable = companyVariableCostsData.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const totalPersonalFixed = personalFixedCostsData.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const totalPersonalVariable = personalVariableCostsData.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const totalDebts = debtsData.reduce((sum, item) => sum + Number(item.monthlyPayment), 0);
  const totalRevenue = revenuesData.reduce((sum, item) => sum + Number(item.netAmount), 0);

  const totalExpenses =
    totalSupplierPurchases +
    totalCompanyFixed +
    totalCompanyVariable +
    totalPersonalFixed +
    totalPersonalVariable +
    totalDebts;

  const balance = totalRevenue - totalExpenses;

  // Agrupar despesas por categoria
  const expenseByCategory: ExpenseByCategory[] = [];
  
  if (totalSupplierPurchases > 0) {
    expenseByCategory.push({
      category: "Compras de Fornecedores",
      amount: totalSupplierPurchases,
      percentage: totalExpenses > 0 ? (totalSupplierPurchases / totalExpenses) * 100 : 0,
    });
  }
  
  if (totalCompanyFixed > 0) {
    expenseByCategory.push({
      category: "Custos Fixos Empresa",
      amount: totalCompanyFixed,
      percentage: totalExpenses > 0 ? (totalCompanyFixed / totalExpenses) * 100 : 0,
    });
  }
  
  if (totalCompanyVariable > 0) {
    expenseByCategory.push({
      category: "Custos Variáveis Empresa",
      amount: totalCompanyVariable,
      percentage: totalExpenses > 0 ? (totalCompanyVariable / totalExpenses) * 100 : 0,
    });
  }
  
  if (totalPersonalFixed > 0) {
    expenseByCategory.push({
      category: "Custos Fixos Pessoal",
      amount: totalPersonalFixed,
      percentage: totalExpenses > 0 ? (totalPersonalFixed / totalExpenses) * 100 : 0,
    });
  }
  
  if (totalPersonalVariable > 0) {
    expenseByCategory.push({
      category: "Custos Variáveis Pessoal",
      amount: totalPersonalVariable,
      percentage: totalExpenses > 0 ? (totalPersonalVariable / totalExpenses) * 100 : 0,
    });
  }
  
  if (totalDebts > 0) {
    expenseByCategory.push({
      category: "Dívidas",
      amount: totalDebts,
      percentage: totalExpenses > 0 ? (totalDebts / totalExpenses) * 100 : 0,
    });
  }

  // Preparar dados para análise da IA
  const financialDataPrompt = `
Dados Financeiros do Usuário ${userId} - ${currentMonth}/${currentYear}:

RECEITAS:
- Total: R$ ${totalRevenue.toFixed(2)}

DESPESAS POR CATEGORIA:
${expenseByCategory.map(cat => `- ${cat.category}: R$ ${cat.amount.toFixed(2)} (${cat.percentage.toFixed(1)}%)`).join("\n")}

TOTAL DE DESPESAS: R$ ${totalExpenses.toFixed(2)}
SALDO: R$ ${balance.toFixed(2)}

DETALHAMENTO:
- Compras Fornecedores: ${supplierPurchasesData.length} lançamentos, total R$ ${totalSupplierPurchases.toFixed(2)}
- Custos Fixos Empresa: ${companyFixedCostsData.length} lançamentos, total R$ ${totalCompanyFixed.toFixed(2)}
- Custos Variáveis Empresa: ${companyVariableCostsData.length} lançamentos, total R$ ${totalCompanyVariable.toFixed(2)}
- Custos Fixos Pessoal: ${personalFixedCostsData.length} lançamentos, total R$ ${totalPersonalFixed.toFixed(2)}
- Custos Variáveis Pessoal: ${personalVariableCostsData.length} lançamentos, total R$ ${totalPersonalVariable.toFixed(2)}
- Dívidas: ${debtsData.length} lançamentos, total R$ ${totalDebts.toFixed(2)}

Maiores despesas individuais:
${[...supplierPurchasesData, ...companyFixedCostsData, ...companyVariableCostsData]
  .sort((a, b) => Number(b.amount) - Number(a.amount))
  .slice(0, 5)
  .map(item => `- ${(item as any).description || (item as any).name}: R$ ${Number(item.amount).toFixed(2)}`)
  .join("\n")}
`.trim();

  const messages: Message[] = [
    {
      role: "system",
      content: `Você é um assistente financeiro especializado em análise de gastos pessoais e empresariais. 
Sua tarefa é analisar os dados financeiros fornecidos e identificar:
1. Alertas críticos sobre situações financeiras preocupantes
2. Recomendações práticas de economia e melhoria financeira
3. Insights sobre padrões de gastos

Responda APENAS no formato JSON abaixo, sem texto adicional:
{
  "summary": "Resumo geral da situação financeira em 2-3 frases",
  "alerts": [
    {
      "type": "critical|warning|info",
      "title": "Título curto do alerta",
      "message": "Descrição detalhada do alerta",
      "impact": número_opcional_em_reais
    }
  ],
  "recommendations": [
    {
      "category": "categoria",
      "title": "Título da recomendação",
      "description": "Descrição detalhada da recomendação",
      "potentialSavings": número_opcional_em_reais,
      "priority": "high|medium|low"
    }
  ]
}

Seja direto, prático e focado em ações que o usuário pode tomar imediatamente.`,
    },
    {
      role: "user",
      content: financialDataPrompt,
    },
  ];

  try {
    const result = await invokeLLM({
      messages,
      responseFormat: { type: "json_object" },
      maxTokens: 2048,
    });

    const responseContent = result.choices[0]?.message?.content;
    
    if (!responseContent) {
      throw new Error("No response from LLM");
    }

    const parsedResponse = typeof responseContent === "string" 
      ? JSON.parse(responseContent) 
      : responseContent;

    return {
      summary: parsedResponse.summary || "Análise não disponível",
      alerts: parsedResponse.alerts || [],
      recommendations: parsedResponse.recommendations || [],
      totalExpenses,
      totalRevenue,
      balance,
      expenseByCategory,
    };
  } catch (error) {
    console.error("[Financial Analysis] Error analyzing data:", error);
    
    // Retorno fallback em caso de erro na IA
    return {
      summary: `Saldo do mês: R$ ${balance.toFixed(2)}. Receitas: R$ ${totalRevenue.toFixed(2)}, Despesas: R$ ${totalExpenses.toFixed(2)}.`,
      alerts: balance < 0 ? [{
        type: "critical" as const,
        title: "Saldo Negativo",
        message: `Suas despesas superaram suas receitas em R$ ${Math.abs(balance).toFixed(2)} este mês.`,
        impact: Math.abs(balance),
      }] : [],
      recommendations: [],
      totalExpenses,
      totalRevenue,
      balance,
      expenseByCategory,
    };
  }
}

export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string
): Promise<boolean> {
  // Implementação usando API externa de WhatsApp
  // Substitua pela sua provedora preferida (Twilio, Z-API, Evolution API, etc.)
  
  const whatsappApiUrl = process.env.WHATSAPP_API_URL;
  const whatsappApiKey = process.env.WHATSAPP_API_KEY;

  if (!whatsappApiUrl || !whatsappApiKey) {
    console.warn("[WhatsApp] API credentials not configured");
    return false;
  }

  try {
    // Exemplo genérico - adapte conforme sua API
    const response = await axios.post(
      `${whatsappApiUrl}/send`,
      {
        phone: phoneNumber.replace(/\D/g, ""), // Remove caracteres não numéricos
        message,
      },
      {
        headers: {
          Authorization: `Bearer ${whatsappApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.status === 200 || response.status === 201;
  } catch (error) {
    console.error("[WhatsApp] Error sending message:", error);
    return false;
  }
}

export async function sendFinancialAlertToWhatsApp(
  userId: number,
  phoneNumber: string,
  analysis: FinancialAnalysis
): Promise<boolean> {
  // Formatar mensagem para WhatsApp
  let message = `🔍 *ANÁLISE FINANCEIRA*\n\n`;
  message += `*Resumo:* ${analysis.summary}\n\n`;
  
  message += `💰 *RESUMO DO MÊS*\n`;
  message += `Receitas: R$ ${analysis.totalRevenue.toFixed(2)}\n`;
  message += `Despesas: R$ ${analysis.totalExpenses.toFixed(2)}\n`;
  message += `*Saldo: R$ ${analysis.balance.toFixed(2)}*\n\n`;

  if (analysis.alerts.length > 0) {
    message += `⚠️ *ALERTAS*\n`;
    for (const alert of analysis.alerts) {
      const icon = alert.type === "critical" ? "🔴" : alert.type === "warning" ? "🟡" : "🔵";
      message += `${icon} *${alert.title}*\n`;
      message += `${alert.message}\n`;
      if (alert.impact) {
        message += `Impacto: R$ ${alert.impact.toFixed(2)}\n`;
      }
      message += `\n`;
    }
  }

  if (analysis.recommendations.length > 0) {
    message += `💡 *RECOMENDAÇÕES*\n`;
    for (const rec of analysis.recommendations.slice(0, 3)) { // Limitar a 3 recomendações
      const priorityIcon = rec.priority === "high" ? "🔥" : rec.priority === "medium" ? "⚡" : "💭";
      message += `${priorityIcon} *${rec.title}*\n`;
      message += `${rec.description}\n`;
      if (rec.potentialSavings) {
        message += `Economia potencial: R$ ${rec.potentialSavings.toFixed(2)}\n`;
      }
      message += `\n`;
    }
  }

  message += `\n_Acesse o sistema para ver detalhes completos._`;

  return sendWhatsAppMessage(phoneNumber, message);
}
