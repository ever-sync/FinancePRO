import { useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { AIChatBox, type Message as ChatMessage } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/StatusBadge";
import { MentorOnboardingCard } from "@/components/MentorOnboardingCard";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  AlertCircle,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Copy,
  MessageCircle,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "wouter";

const WHATSAPP_PROMPTS = [
  "Quanto posso gastar hoje sem apertar o restante do mes?",
  "O que vence essa semana e o que eu devo pagar primeiro?",
  "Quais cobrancas eu preciso acompanhar hoje?",
  "Posso tirar R$ 3.000 da empresa este mes?",
  "Posso tirar R$ 5.000 todo mes da empresa?",
  "Monte meu plano financeiro do mes com foco em caixa.",
  "Posso assumir um custo mensal de R$ 2.500 agora?",
  "Posso contratar alguem por R$ 4.000 por mes?",
  "Posso comprar um notebook de R$ 12.000 em 12x?",
];

const CHAT_PROMPTS = [
  "Posso tirar R$ 3.000 da empresa este mes?",
  "Posso gastar R$ 1.200 no pessoal este mes?",
  "Posso assumir um custo mensal de R$ 2.500 agora?",
  "Posso contratar alguem por R$ 4.000 por mes?",
  "Posso comprar um notebook de R$ 12.000 em 12x?",
  "Quais contas eu devo pagar primeiro?",
  "Me explique meu mes como um mentor financeiro.",
];

function formatDateLabel(value?: string | Date | null) {
  if (!value) return "Sem prazo definido";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatDateTimeLabel(value?: string | Date | null) {
  if (!value) return "Agora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toAmount(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function toInstallments(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 1) : 1;
}

type DecisionTone = "healthy" | "attention" | "critical";

type DecisionMetric = {
  label: string;
  value: number;
  format: "currency" | "percent" | "number";
};

type DecisionOutcome = {
  kind:
    | "withdrawal"
    | "personal_spend"
    | "monthly_cost"
    | "hiring"
    | "installment_purchase"
    | "recurring_withdrawal";
  tone: DecisionTone;
  amount: number;
  summary: string;
  note: string;
  consumptionPercent: number;
  metrics: DecisionMetric[];
  metadata?: Record<string, unknown>;
};

type GuidedMentorPrompt = {
  id: string;
  title: string;
  description: string;
  message: string;
  tag: string;
};

type GuidedPlanAction = {
  id: number;
  title: string;
  description: string;
  actionType?: string | null;
  priority?: string | null;
  status?: string | null;
};

type MentorExecutableAction = {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  kind:
    | "confirm_pending_run"
    | "snooze_pending_run"
    | "generate_monthly_plan"
    | "complete_plan_action"
    | "send_whatsapp_preview"
    | "open_whatsapp_integration"
    | "open_inbox";
  runId?: number;
  actionId?: number;
  message?: string;
};

type MentorExecutableActionSection = {
  title: string;
  description: string;
  tone: DecisionTone;
  primary: MentorExecutableAction;
  secondary?: MentorExecutableAction;
};

function formatMetricValue(metric: DecisionMetric) {
  if (metric.format === "currency") return formatCurrency(metric.value);
  if (metric.format === "percent") return formatPercent(metric.value);
  return String(metric.value);
}

function buildDecisionFallback(
  kind: DecisionOutcome["kind"],
  summary: string,
  note: string
): DecisionOutcome {
  return {
    kind,
    tone: "attention",
    amount: 0,
    summary,
    note,
    consumptionPercent: 0,
    metrics: [],
  };
}

function getPlanActionCtaLabel(actionType?: string | null) {
  if (actionType === "transfer_company_reserve" || actionType === "transfer_personal_reserve") {
    return "Executar aporte";
  }
  if (actionType === "pay_priority_items") return "Concluir prioridade";
  if (actionType === "charge_follow_up") return "Registrar acompanhamento";
  return "Concluir agora";
}

function getPlanActionExecutionNote(actionType?: string | null) {
  if (actionType === "transfer_company_reserve") {
    return "Quando executada, esta acao registra um aporte real na reserva da empresa.";
  }
  if (actionType === "transfer_personal_reserve") {
    return "Quando executada, esta acao registra um aporte real na reserva pessoal.";
  }
  return null;
}

function buildGuidedPromptSections(args: {
  withdrawalAmount: string;
  personalSpendAmount: string;
  newMonthlyCost: string;
  hiringCostAmount: string;
  installmentPurchaseAmount: string;
  installmentPurchaseMonths: string;
  recurringWithdrawalAmount: string;
}) {
  const {
    withdrawalAmount,
    personalSpendAmount,
    newMonthlyCost,
    hiringCostAmount,
    installmentPurchaseAmount,
    installmentPurchaseMonths,
    recurringWithdrawalAmount,
  } = args;

  return [
    {
      title: "Decisoes da empresa",
      description: "Perguntas prontas para caixa, contratacao e retiradas da empresa.",
      prompts: [
        {
          id: "guided-withdrawal",
          title: "Retirada pontual",
          description: "Valida uma retirada unica usando a folga operacional atual.",
          message: `Posso tirar R$ ${withdrawalAmount || "3000"} da empresa este mes?`,
          tag: "retirada",
        },
        {
          id: "guided-recurring-withdrawal",
          title: "Retirada mensal",
          description: "Testa se uma retirada fixa vira um peso perigoso no caixa da empresa.",
          message: `Posso tirar R$ ${recurringWithdrawalAmount || "5000"} todo mes da empresa?`,
          tag: "recorrente",
        },
        {
          id: "guided-hiring",
          title: "Contratacao",
          description: "Pede ao mentor uma leitura mais executiva sobre contratar agora.",
          message: `Posso contratar alguem por R$ ${hiringCostAmount || "4000"} por mes?`,
          tag: "folha",
        },
      ] satisfies GuidedMentorPrompt[],
    },
    {
      title: "Compras e compromissos",
      description: "Atalhos para compromissos recorrentes ou parcelados no mes.",
      prompts: [
        {
          id: "guided-monthly-cost",
          title: "Novo custo mensal",
          description: "Avalia se um custo fixo novo cabe sem estourar o plano do mes.",
          message: `Posso assumir um custo mensal de R$ ${newMonthlyCost || "2500"} agora?`,
          tag: "custo fixo",
        },
        {
          id: "guided-installment",
          title: "Compra parcelada",
          description: "Mede o efeito da parcela no fluxo em vez de olhar so o valor cheio.",
          message: `Posso comprar um equipamento de R$ ${installmentPurchaseAmount || "12000"} em ${installmentPurchaseMonths || "12"}x?`,
          tag: "parcelado",
        },
        {
          id: "guided-personal-spend",
          title: "Gasto pessoal extra",
          description: "Cruza o gasto com a folga do mes para evitar decidir so por saldo em conta.",
          message: `Posso gastar R$ ${personalSpendAmount || "1200"} no pessoal este mes?`,
          tag: "pessoal",
        },
      ] satisfies GuidedMentorPrompt[],
    },
    {
      title: "Leitura do mes",
      description: "Perguntas curtas para quando voce quer orientacao e prioridade, nao so simulacao.",
      prompts: [
        {
          id: "guided-priorities",
          title: "O que fazer hoje",
          description: "Pede ao mentor uma direcao pratica do dia com base no mes atual.",
          message: "O que eu preciso fazer hoje no financeiro?",
          tag: "acao",
        },
        {
          id: "guided-payments",
          title: "O que pagar primeiro",
          description: "Traz ordem de pagamento olhando pressao de caixa e vencimentos.",
          message: "Quais contas eu devo pagar primeiro?",
          tag: "prioridade",
        },
        {
          id: "guided-explain-month",
          title: "Explicar meu mes",
          description: "Resumo executivo do momento atual no tom de mentor financeiro.",
          message: "Me explique meu mes como um mentor financeiro.",
          tag: "resumo",
        },
      ] satisfies GuidedMentorPrompt[],
    },
  ];
}

function buildFollowUpPromptSection(args: {
  intent?: string | null;
  lastPrompt?: string | null;
  withdrawalAmount: string;
  personalSpendAmount: string;
  newMonthlyCost: string;
  hiringCostAmount: string;
  installmentPurchaseAmount: string;
  installmentPurchaseMonths: string;
  recurringWithdrawalAmount: string;
}) {
  const {
    intent,
    lastPrompt,
    withdrawalAmount,
    personalSpendAmount,
    newMonthlyCost,
    hiringCostAmount,
    installmentPurchaseAmount,
    installmentPurchaseMonths,
    recurringWithdrawalAmount,
  } = args;

  const parsedInstallments = Math.max(Number.parseInt(installmentPurchaseMonths || "12", 10) || 12, 1);
  const longerInstallmentPlan = Math.min(parsedInstallments + 6, 24);

  const defaultSection = {
    title: "Proxima melhor pergunta",
    description: lastPrompt
      ? "Com base na ultima conversa, estas sao as perguntas que mais ajudam a destravar a proxima decisao."
      : "Se quiser comecar agora, estas perguntas te colocam rapido na parte mais util da conversa.",
    prompts: [
      {
        id: "followup-default-health",
        title: "Maior risco do mes",
        description: "Pede ao mentor o principal ponto de atencao do momento.",
        message: "Qual e meu maior risco financeiro neste mes?",
        tag: "diagnostico",
      },
      {
        id: "followup-default-action",
        title: "Melhor acao de hoje",
        description: "Traz direcao pratica e priorizada para o dia.",
        message: "Qual e a melhor acao financeira para eu executar hoje?",
        tag: "acao",
      },
      {
        id: "followup-default-avoid",
        title: "O que evitar agora",
        description: "Ajuda a nao tomar uma decisao ruim no momento errado.",
        message: "Qual decisao eu devo evitar agora para nao apertar meu caixa?",
        tag: "prudencia",
      },
    ] satisfies GuidedMentorPrompt[],
  };

  switch (intent) {
    case "company_withdrawal_decision":
      return {
        title: "Aprofundar retirada da empresa",
        description: "Voce ja perguntou sobre retirada pontual. Estas perguntas ajudam a transformar a leitura em decisao segura.",
        prompts: [
          {
            id: "followup-withdrawal-safe",
            title: "Retirada segura",
            description: "Pede ao mentor um teto recomendado para retirada neste mes.",
            message: "Qual seria uma retirada segura da empresa neste mes?",
            tag: "limite",
          },
          {
            id: "followup-withdrawal-recurring",
            title: "Virar retirada mensal",
            description: "Testa o efeito de transformar a retirada em habito fixo.",
            message: `Se eu transformar isso em uma retirada mensal de R$ ${recurringWithdrawalAmount || withdrawalAmount || "5000"}, como fica o caixa?`,
            tag: "recorrente",
          },
          {
            id: "followup-withdrawal-cut",
            title: "Reduzir valor",
            description: "Explora se uma retirada menor muda o parecer do mentor.",
            message: `Se eu tirar R$ ${Math.max(Math.round((toAmount(withdrawalAmount || "3000") || 3000) * 0.7), 500)} da empresa em vez disso, fica saudavel?`,
            tag: "ajuste",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "recurring_withdrawal_decision":
      return {
        title: "Aprofundar retirada recorrente",
        description: "Aqui vale entender o limite mensal seguro e a melhor forma de estruturar essa retirada.",
        prompts: [
          {
            id: "followup-recurring-safe",
            title: "Valor mensal seguro",
            description: "Pede o teto de retirada recorrente que ainda preserva o caixa.",
            message: "Qual retirada mensal seria segura para a empresa hoje?",
            tag: "limite",
          },
          {
            id: "followup-recurring-structure",
            title: "Estrutura ideal",
            description: "Abre a conversa sobre pro-labore, retirada eventual e disciplina.",
            message: "Melhor tratar isso como pro-labore fixo ou retirada eventual?",
            tag: "estrutura",
          },
          {
            id: "followup-recurring-reduce",
            title: "Ajustar retirada",
            description: "Testa uma retirada recorrente mais leve para ver se o parecer muda.",
            message: `Se eu reduzir essa retirada para R$ ${Math.max(Math.round((toAmount(recurringWithdrawalAmount || "5000") || 5000) * 0.7), 1000)} por mes, fica saudavel?`,
            tag: "ajuste",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "personal_spend_decision":
      return {
        title: "Aprofundar gasto pessoal",
        description: "Depois de medir o impacto do gasto, o melhor passo e entender teto, compensacao e timing.",
        prompts: [
          {
            id: "followup-personal-limit",
            title: "Teto pessoal do mes",
            description: "Pede ao mentor o limite ainda seguro para sua vida pessoal.",
            message: "Qual teto de gasto pessoal eu ainda tenho neste mes?",
            tag: "limite",
          },
          {
            id: "followup-personal-compensate",
            title: "Fazer caber",
            description: "Pergunta o que precisaria mudar para esse gasto entrar com folga.",
            message: `O que eu teria que cortar ou adiar para um gasto de R$ ${personalSpendAmount || "1200"} caber com folga?`,
            tag: "compensacao",
          },
          {
            id: "followup-personal-delay",
            title: "Adiar compra",
            description: "Explora se o melhor movimento e esperar o proximo ciclo.",
            message: "Se eu adiar esse gasto para o proximo mes, melhora muito minha seguranca financeira?",
            tag: "timing",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "monthly_cost_decision":
      return {
        title: "Aprofundar novo custo mensal",
        description: "Essas perguntas ajudam a transformar a simulacao em criterio de aprovacao real.",
        prompts: [
          {
            id: "followup-cost-max",
            title: "Valor que ainda cabe",
            description: "Pede o teto de novo custo que ainda manteria o mes sob controle.",
            message: "Qual valor mensal novo ainda caberia sem entrar em atencao?",
            tag: "limite",
          },
          {
            id: "followup-cost-revenue",
            title: "Receita necessaria",
            description: "Conecta o novo custo com a necessidade de faturamento adicional.",
            message: `Quanto de receita extra eu preciso gerar para sustentar um novo custo de R$ ${newMonthlyCost || "2500"} por mes?`,
            tag: "receita",
          },
          {
            id: "followup-cost-delay",
            title: "Esperar 30 dias",
            description: "Testa se faz sentido postergar a decisao para ganhar folga.",
            message: "Se eu esperar 30 dias para assumir esse custo, o cenario melhora bastante?",
            tag: "timing",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "hiring_decision":
      return {
        title: "Aprofundar contratacao",
        description: "Depois da leitura inicial, o melhor e confrontar receita, formato e margem de seguranca.",
        prompts: [
          {
            id: "followup-hiring-revenue",
            title: "Faturamento para contratar",
            description: "Pergunta quanta receita nova sustentaria a contratacao com seguranca.",
            message: `Quanto de faturamento novo eu preciso para contratar alguem por R$ ${hiringCostAmount || "4000"} por mes com seguranca?`,
            tag: "receita",
          },
          {
            id: "followup-hiring-format",
            title: "Contratar ou freela",
            description: "Abre uma comparacao mais pragmatica entre formato fixo e teste de demanda.",
            message: "Vale mais contratar agora ou comecar com um freela antes de assumir esse custo fixo?",
            tag: "formato",
          },
          {
            id: "followup-hiring-adjust",
            title: "Custo menor",
            description: "Explora se um pacote mais leve mudaria a recomendacao.",
            message: `Se a contratacao custar R$ ${Math.max(Math.round((toAmount(hiringCostAmount || "4000") || 4000) * 0.75), 1500)} por mes, o parecer muda?`,
            tag: "ajuste",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "installment_purchase_decision":
      return {
        title: "Aprofundar compra parcelada",
        description: "Agora vale testar o parcelamento ideal e comparar com a alternativa de esperar.",
        prompts: [
          {
            id: "followup-installment-plan",
            title: "Parcelamento mais saudavel",
            description: "Pede ao mentor a faixa de parcelamento que preserva melhor o fluxo.",
            message: "Quantas parcelas deixariam essa compra mais saudavel para o meu caixa?",
            tag: "parcelas",
          },
          {
            id: "followup-installment-compare",
            title: "Parcelar ou esperar",
            description: "Compara a compra agora com a opcao de segurar caixa e decidir depois.",
            message: `Vale mais parcelar essa compra de R$ ${installmentPurchaseAmount || "12000"} agora ou juntar caixa para comprar depois?`,
            tag: "estrategia",
          },
          {
            id: "followup-installment-adjust",
            title: "Mais parcelas",
            description: "Testa se alongar o prazo melhora o conforto do caixa.",
            message: `Se eu parcelar essa compra em ${longerInstallmentPlan}x em vez de ${parsedInstallments}x, o caixa fica bem mais saudavel?`,
            tag: "ajuste",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "payment_priority":
    case "upcoming_bills":
    case "overdue_items":
      return {
        title: "Aprofundar prioridades",
        description: "Depois da ordem inicial, vale destrinchar o que acelera caixa e o que pode esperar.",
        prompts: [
          {
            id: "followup-priority-critical",
            title: "Conta que nao pode esperar",
            description: "Traz o compromisso mais critico do momento.",
            message: "Qual conta eu nao posso adiar hoje de jeito nenhum?",
            tag: "urgencia",
          },
          {
            id: "followup-priority-delay",
            title: "O que pode adiar",
            description: "Pede ao mentor a margem de manobra do fluxo.",
            message: "O que eu consigo empurrar sem comprometer o caixa?",
            tag: "folga",
          },
          {
            id: "followup-priority-charge",
            title: "Cobrar antes de pagar",
            description: "Conecta pagamentos e cobrancas na mesma conversa.",
            message: "Quais cobrancas eu deveria fazer antes de pagar tudo isso?",
            tag: "cobranca",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "financial_health":
    case "consolidated_analysis":
      return {
        title: "Aprofundar saude financeira",
        description: "Essas perguntas transformam o diagnostico geral em direcao pratica.",
        prompts: [
          {
            id: "followup-health-risk",
            title: "Maior risco",
            description: "Pede o risco numero um do ciclo atual.",
            message: "Qual e meu maior risco financeiro neste mes?",
            tag: "risco",
          },
          {
            id: "followup-health-action",
            title: "Melhor acao hoje",
            description: "Busca a proxima acao com mais retorno para o caixa.",
            message: "O que eu preciso fazer hoje para melhorar meu caixa?",
            tag: "acao",
          },
          {
            id: "followup-health-avoid",
            title: "Erro a evitar",
            description: "Ajuda a nao perder o controle por uma decisao ruim.",
            message: "Qual decisao eu devo evitar agora para nao piorar meu mes?",
            tag: "prudencia",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "spending_limit":
    case "cash_advice":
      return {
        title: "Aprofundar limite e caixa",
        description: "Depois do limite seguro, vale descer para uso pratico do dinheiro do mes.",
        prompts: [
          {
            id: "followup-cash-today",
            title: "Teto de hoje",
            description: "Converte o limite geral em um numero mais pratico para o dia.",
            message: "Quanto posso gastar hoje com seguranca sem apertar o restante do mes?",
            tag: "hoje",
          },
          {
            id: "followup-cash-withdrawal",
            title: "Retirada segura",
            description: "Puxa a conversa para retirada ou uso do caixa da empresa.",
            message: "Quanto posso tirar da empresa sem me apertar neste mes?",
            tag: "empresa",
          },
          {
            id: "followup-cash-reserve",
            title: "Mandar para reserva",
            description: "Pergunta a melhor alocacao do excedente do momento.",
            message: "Qual valor eu deveria mandar para reserva agora?",
            tag: "reserva",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    case "monthly_plan_request":
      return {
        title: "Aprofundar plano do mes",
        description: "Se voce ainda nao confirmou o plano, estas perguntas ajudam a deixa-lo mais util antes da execucao.",
        prompts: [
          {
            id: "followup-plan-actions",
            title: "Top 3 acoes",
            description: "Pede as tres acoes que mais importam dentro do plano.",
            message: "Quais sao as 3 acoes mais importantes para entrar no meu plano deste mes?",
            tag: "execucao",
          },
          {
            id: "followup-plan-goal",
            title: "Meta de caixa",
            description: "Pergunta qual meta faz sentido para o momento do negocio.",
            message: "Qual meta de caixa voce sugere para este mes?",
            tag: "meta",
          },
          {
            id: "followup-plan-priority",
            title: "Comecar pelo mais importante",
            description: "Ajuda a saber onde atacar primeiro para nao dispersar.",
            message: "O que eu preciso fazer primeiro para esse plano funcionar?",
            tag: "foco",
          },
        ] satisfies GuidedMentorPrompt[],
      };
    default:
      return defaultSection;
  }
}

function getDefaultPreviewMessage(intent?: string | null, lastPrompt?: string | null) {
  if (lastPrompt) return lastPrompt;

  switch (intent) {
    case "payment_priority":
    case "upcoming_bills":
    case "overdue_items":
      return "Quais contas eu devo pagar primeiro?";
    case "spending_limit":
    case "cash_advice":
      return "Quanto posso gastar hoje sem apertar o restante do mes?";
    case "financial_health":
    case "consolidated_analysis":
      return "Me explique meu mes como um mentor financeiro.";
    default:
      return "Me explique meu mes como um mentor financeiro.";
  }
}

function buildNextExecutableActionSection(args: {
  intent?: string | null;
  decisionTone?: DecisionTone | null;
  lastPrompt?: string | null;
  canSendWhatsappMessage: boolean;
  hasCurrentPlan: boolean;
  latestPendingRun?: {
    id: number;
    normalizedIntent?: string | null;
    assistantResponse?: string | null;
  } | null;
  firstPendingAction?: GuidedPlanAction | null;
}) {
  const {
    intent,
    decisionTone,
    lastPrompt,
    canSendWhatsappMessage,
    hasCurrentPlan,
    latestPendingRun,
    firstPendingAction,
  } = args;

  const previewMessage = getDefaultPreviewMessage(intent, lastPrompt);

  if (latestPendingRun) {
    return {
      title: "Proxima melhor acao",
      description:
        latestPendingRun.assistantResponse ||
        "O mentor esta aguardando sua confirmacao para concluir a etapa atual.",
      tone: "attention" as const,
      primary: {
        id: "confirm-latest-run",
        title: "Confirmar pendencia",
        description: "Destrava a execucao que o mentor deixou aguardando decisao.",
        ctaLabel: "Confirmar no app",
        kind: "confirm_pending_run",
        runId: latestPendingRun.id,
      },
      secondary: {
        id: "snooze-latest-run",
        title: "Adiar pendencia",
        description: "Mantem a conversa registrada, mas empurra a decisao para depois.",
        ctaLabel: "Adiar no app",
        kind: "snooze_pending_run",
        runId: latestPendingRun.id,
      },
    } satisfies MentorExecutableActionSection;
  }

  if (!hasCurrentPlan) {
    return {
      title: "Proxima melhor acao",
      description:
        "Voce ainda nao tem um plano mensal confirmado. Antes de aprofundar a conversa, vale gerar o plano base do mes.",
      tone: "attention" as const,
      primary: {
        id: "generate-plan",
        title: "Gerar plano do mes",
        description: "Cria a base de metas, limites e prioridades que o mentor usa para operar.",
        ctaLabel: "Gerar plano",
        kind: "generate_monthly_plan",
      },
      secondary: canSendWhatsappMessage
        ? {
            id: "send-preview-no-plan",
            title: "Receber orientacao no WhatsApp",
            description: "Manda a leitura atual para o canal real enquanto voce fecha o plano.",
            ctaLabel: "Enviar orientacao",
            kind: "send_whatsapp_preview",
            message: previewMessage,
          }
        : {
            id: "open-integration-no-plan",
            title: "Ajustar integracao",
            description: "Conecta o canal real para receber resumos e alertas do mentor.",
            ctaLabel: "Ajustar WhatsApp",
            kind: "open_whatsapp_integration",
          },
    } satisfies MentorExecutableActionSection;
  }

  if (
    intent === "company_withdrawal_decision" ||
    intent === "recurring_withdrawal_decision" ||
    intent === "personal_spend_decision" ||
    intent === "monthly_cost_decision" ||
    intent === "hiring_decision" ||
    intent === "installment_purchase_decision"
  ) {
    if (decisionTone === "critical" && firstPendingAction) {
      return {
        title: "Proxima melhor acao",
        description:
          "Antes de executar essa decisao, o melhor movimento e aliviar o caixa resolvendo a primeira prioridade do plano.",
        tone: "critical" as const,
        primary: {
          id: `complete-action-${firstPendingAction.id}`,
          title: firstPendingAction.title,
          description: firstPendingAction.description,
          ctaLabel: getPlanActionCtaLabel(firstPendingAction.actionType),
          kind: "complete_plan_action",
          actionId: firstPendingAction.id,
        },
        secondary: canSendWhatsappMessage
          ? {
              id: "send-preview-critical",
              title: "Enviar leitura para o WhatsApp",
              description: "Leva essa analise para o canal real antes de agir no financeiro.",
              ctaLabel: "Enviar orientacao",
              kind: "send_whatsapp_preview",
              message: previewMessage,
            }
          : {
              id: "open-inbox-critical",
              title: "Abrir inbox do mentor",
              description: "Revise pendencias e contexto antes de tomar uma decisao mais pesada.",
              ctaLabel: "Abrir inbox",
              kind: "open_inbox",
            },
      } satisfies MentorExecutableActionSection;
    }

    return {
      title: "Proxima melhor acao",
      description:
        decisionTone === "healthy"
          ? "A leitura esta favoravel. O melhor passo agora e registrar ou compartilhar essa orientacao no seu canal principal."
          : "A leitura pede cautela. Vale registrar essa orientacao no WhatsApp e seguir com disciplina antes de executar.",
      tone: decisionTone || "attention",
      primary: canSendWhatsappMessage
        ? {
            id: "send-preview-decision",
            title: "Enviar orientacao para o WhatsApp",
            description: "Leva a ultima leitura do mentor para o seu canal principal de decisao.",
            ctaLabel: "Enviar orientacao",
            kind: "send_whatsapp_preview",
            message: previewMessage,
          }
        : {
            id: "open-integration-decision",
            title: "Conectar canal real",
            description: "Ative o WhatsApp para continuar essa decisao fora do painel.",
            ctaLabel: "Ajustar WhatsApp",
            kind: "open_whatsapp_integration",
          },
      secondary: firstPendingAction
        ? {
            id: `complete-action-support-${firstPendingAction.id}`,
            title: firstPendingAction.title,
            description: "Se preferir, execute antes a prioridade operacional do plano.",
            ctaLabel: getPlanActionCtaLabel(firstPendingAction.actionType),
            kind: "complete_plan_action",
            actionId: firstPendingAction.id,
          }
        : {
            id: "open-inbox-decision",
            title: "Abrir inbox do mentor",
            description: "Revise o contexto operacional antes de fechar a decisao.",
            ctaLabel: "Abrir inbox",
            kind: "open_inbox",
          },
    } satisfies MentorExecutableActionSection;
  }

  if (firstPendingAction) {
    return {
      title: "Proxima melhor acao",
      description:
        "A forma mais forte de transformar a conversa em resultado agora e concluir a primeira prioridade operacional do plano.",
      tone: "attention" as const,
      primary: {
        id: `complete-action-default-${firstPendingAction.id}`,
        title: firstPendingAction.title,
        description: firstPendingAction.description,
        ctaLabel: getPlanActionCtaLabel(firstPendingAction.actionType),
        kind: "complete_plan_action",
        actionId: firstPendingAction.id,
      },
      secondary: canSendWhatsappMessage
        ? {
            id: "send-preview-default",
            title: "Mandar resumo para o WhatsApp",
            description: "Atualiza o canal real com o contexto mais recente do mentor.",
            ctaLabel: "Enviar resumo",
            kind: "send_whatsapp_preview",
            message: previewMessage,
          }
        : {
            id: "open-integration-default",
            title: "Conectar WhatsApp",
            description: "Ative o canal real para receber alertas e resumos fora do app.",
            ctaLabel: "Ajustar WhatsApp",
            kind: "open_whatsapp_integration",
          },
    } satisfies MentorExecutableActionSection;
  }

  return {
    title: "Proxima melhor acao",
    description:
      canSendWhatsappMessage
        ? "O proximo passo mais util e levar a leitura atual para o WhatsApp e manter a rotina do mentor no seu canal real."
        : "Seu painel ja esta organizado. Falta ligar o canal real para receber orientacoes e alertas no dia a dia.",
    tone: "healthy" as const,
    primary: canSendWhatsappMessage
      ? {
          id: "send-preview-fallback",
          title: "Enviar resumo para o WhatsApp",
          description: "Manda a leitura atual do mentor para o numero autorizado.",
          ctaLabel: "Enviar resumo",
          kind: "send_whatsapp_preview",
          message: previewMessage,
        }
      : {
          id: "open-integration-fallback",
          title: "Conectar WhatsApp",
          description: "Ative o canal real para o mentor continuar te acompanhando fora do painel.",
          ctaLabel: "Ajustar WhatsApp",
          kind: "open_whatsapp_integration",
        },
    secondary: {
      id: "open-inbox-fallback",
      title: "Abrir inbox do mentor",
      description: "Veja a trilha operacional completa das conversas e automacoes.",
      ctaLabel: "Abrir inbox",
      kind: "open_inbox",
    },
  } satisfies MentorExecutableActionSection;
}

function formatMentorIntent(intent?: string | null) {
  const intentMap: Record<string, string> = {
    company_withdrawal_decision: "retirada da empresa",
    recurring_withdrawal_decision: "retirada recorrente",
    personal_spend_decision: "gasto pessoal",
    monthly_cost_decision: "novo custo mensal",
    hiring_decision: "contratacao",
    installment_purchase_decision: "compra parcelada",
    spending_limit: "limite de gasto",
    payment_priority: "ordem de pagamento",
    reserve_transfer: "recomposicao de reserva",
    financial_health: "saude financeira",
    consolidated_analysis: "visao consolidada",
    monthly_plan_request: "plano do mes",
  };

  return intent ? intentMap[intent] || intent : null;
}

function getMentorMessageSourceLabel(rawPayload?: string | null) {
  if (!rawPayload) return "WhatsApp";

  try {
    const parsed = JSON.parse(rawPayload) as { source?: string; origin?: string };
    if (parsed.source === "dashboard_chat" || parsed.origin === "app") return "Painel";
    if (parsed.source === "financial_advisor_preview") return "Previa";
  } catch {
    return "WhatsApp";
  }

  return "WhatsApp";
}

function DecisionSimulatorCard(props: {
  title: string;
  description: string;
  icon: LucideIcon;
  inputLabel: string;
  value: string;
  onChange: (value: string) => void;
  quickValues: number[];
  outcome: DecisionOutcome;
  inputStep?: string;
  secondaryInputLabel?: string;
  secondaryValue?: string;
  secondaryOnChange?: (value: string) => void;
  secondaryPlaceholder?: string;
  secondaryMin?: string;
  secondaryStep?: string;
}) {
  const {
    title,
    description,
    icon: Icon,
    inputLabel,
    value,
    onChange,
    quickValues,
    outcome,
    inputStep = "100",
    secondaryInputLabel,
    secondaryValue,
    secondaryOnChange,
    secondaryPlaceholder = "0",
    secondaryMin = "1",
    secondaryStep = "1",
  } = props;

  return (
    <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
              <Icon className="size-4" />
            </div>
            <p className="font-medium text-zinc-900">{title}</p>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <StatusBadge status={outcome.tone} />
      </div>

      <div className="mt-5 space-y-3">
        <div className={`grid gap-3 ${secondaryInputLabel ? "md:grid-cols-2" : ""}`}>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
              {inputLabel}
            </label>
            <Input
              type="number"
              min="0"
              step={inputStep}
              value={value}
              onChange={event => onChange(event.target.value)}
              placeholder="0,00"
            />
          </div>
          {secondaryInputLabel && secondaryOnChange ? (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
                {secondaryInputLabel}
              </label>
              <Input
                type="number"
                min={secondaryMin}
                step={secondaryStep}
                value={secondaryValue}
                onChange={event => secondaryOnChange(event.target.value)}
                placeholder={secondaryPlaceholder}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {quickValues.map(amount => (
            <Button
              key={amount}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onChange(String(amount))}
            >
              {formatCurrency(amount)}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-3xl border bg-zinc-50/80 p-4">
        <p className="text-sm font-medium text-zinc-900">{outcome.summary}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{outcome.note}</p>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-400">
            <span>Consumo da folga</span>
            <span>{formatPercent(outcome.consumptionPercent)}</span>
          </div>
          <Progress value={outcome.consumptionPercent} className="h-2" />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {outcome.metrics.map(metric => (
            <div key={metric.label} className="rounded-2xl border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">{metric.label}</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{formatMetricValue(metric)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppPlanos() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [mentorMessages, setMentorMessages] = useState<ChatMessage[]>([]);
  const [lastMentorIntent, setLastMentorIntent] = useState<string | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState("3000");
  const [personalSpendAmount, setPersonalSpendAmount] = useState("1200");
  const [newMonthlyCost, setNewMonthlyCost] = useState("2500");
  const [hiringCostAmount, setHiringCostAmount] = useState("4000");
  const [installmentPurchaseAmount, setInstallmentPurchaseAmount] = useState("12000");
  const [installmentPurchaseMonths, setInstallmentPurchaseMonths] = useState("12");
  const [recurringWithdrawalAmount, setRecurringWithdrawalAmount] = useState("5000");
  const deferredWithdrawalAmount = useDeferredValue(withdrawalAmount);
  const deferredPersonalSpendAmount = useDeferredValue(personalSpendAmount);
  const deferredNewMonthlyCost = useDeferredValue(newMonthlyCost);
  const deferredHiringCostAmount = useDeferredValue(hiringCostAmount);
  const deferredInstallmentPurchaseAmount = useDeferredValue(installmentPurchaseAmount);
  const deferredInstallmentPurchaseMonths = useDeferredValue(installmentPurchaseMonths);
  const deferredRecurringWithdrawalAmount = useDeferredValue(recurringWithdrawalAmount);

  const { data: snapshot } = trpc.financialAdvisor.getSnapshot.useQuery();
  const { data: dailyDigest } = trpc.financialAdvisor.getDailyDigest.useQuery();
  const { data: monthClose } = trpc.financialAdvisor.getMonthClose.useQuery();
  const { data: whatsappIntegration } = trpc.whatsappIntegration.get.useQuery();
  const { data: whatsappStatus } = trpc.whatsappIntegration.syncStatus.useQuery();
  const { data: assistantInbox } = trpc.assistantInbox.list.useQuery();
  const { data: decisionScenarios, isFetching: isDecisionFetching } =
    trpc.financialAdvisor.evaluateDecisionScenarios.useQuery(
      {
        withdrawalAmount: toAmount(deferredWithdrawalAmount),
        personalSpendAmount: toAmount(deferredPersonalSpendAmount),
        monthlyCostAmount: toAmount(deferredNewMonthlyCost),
        hiringCostAmount: toAmount(deferredHiringCostAmount),
        installmentPurchaseAmount: toAmount(deferredInstallmentPurchaseAmount),
        installmentPurchaseMonths: toInstallments(deferredInstallmentPurchaseMonths),
        recurringWithdrawalAmount: toAmount(deferredRecurringWithdrawalAmount),
      },
      {
        refetchOnWindowFocus: false,
      }
    );
  const { data: currentPlan } = trpc.assistantPlans.getCurrent.useQuery();
  const { data: plans, isLoading } = trpc.assistantPlans.list.useQuery();
  const { data: events } = trpc.assistantAutomation.list.useQuery();

  async function refreshMentorData() {
    await Promise.all([
      utils.settings.get.invalidate(),
      utils.financialAdvisor.getOnboarding.invalidate(),
      utils.financialAdvisor.getSnapshot.invalidate(),
      utils.financialAdvisor.getDailyDigest.invalidate(),
      utils.financialAdvisor.getMonthClose.invalidate(),
      utils.financialAdvisor.evaluateDecisionScenarios.invalidate(),
      utils.assistantPlans.getCurrent.invalidate(),
      utils.assistantPlans.list.invalidate(),
      utils.assistantAutomation.list.invalidate(),
      utils.whatsappIntegration.get.invalidate(),
      utils.whatsappIntegration.syncStatus.invalidate(),
      utils.assistantInbox.list.invalidate(),
    ]);
  }

  async function handleRefreshMentorData() {
    try {
      await refreshMentorData();
      toast.success("Dados da mentoria atualizados.");
    } catch {
      toast.error("Nao consegui atualizar os dados agora.");
    }
  }

  const generateMut = trpc.financialAdvisor.generateMonthlyPlan.useMutation({
    onSuccess: async () => {
      await refreshMentorData();
      toast.success("Plano mensal atualizado com os dados mais recentes.");
    },
    onError: error => toast.error(error.message),
  });
  const confirmMut = trpc.financialAdvisor.confirmAction.useMutation({
    onSuccess: async data => {
      await refreshMentorData();
      toast.success(data.message || "Acao marcada como concluida.");
    },
    onError: error => toast.error(error.message),
  });
  const snoozeMut = trpc.assistantPlans.snoozeAlert.useMutation({
    onSuccess: async () => {
      await utils.assistantAutomation.list.invalidate();
      toast.success("Alerta adiado por 24 horas.");
    },
    onError: error => toast.error(error.message),
  });
  const askMentorMut = trpc.financialAdvisor.ask.useMutation({
    onSuccess: async response => {
      setLastMentorIntent(response.detectedIntent ?? null);
      const parts = [response.reply];
      if (response.alerts.length) {
        parts.push(`**Alertas**\n- ${response.alerts.join("\n- ")}`);
      }
      if (response.requiresConfirmation) {
        parts.push(
          response.persistedToAssistantThread
            ? "Esta acao ficou pendente de confirmacao. Voce pode concluir no card `Espelho do canal`."
            : "Esta acao exige confirmacao antes de seguir."
        );
      }
      const intentLabel = formatMentorIntent(response.detectedIntent);
      if (intentLabel || response.decisionAmount) {
        const details = [
          intentLabel ? `Leitura: ${intentLabel}` : null,
          response.decisionAmount != null ? `Valor analisado: ${formatCurrency(response.decisionAmount)}` : null,
          response.decisionInstallments ? `Parcelamento: ${response.decisionInstallments}x` : null,
        ].filter(Boolean);
        if (details.length) {
          parts.push(details.join(" | "));
        }
      }

      setMentorMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: parts.join("\n\n"),
        },
      ]);

      await Promise.all([
        utils.assistantInbox.list.invalidate(),
        utils.whatsappIntegration.syncStatus.invalidate(),
      ]);
    },
    onError: error => {
      setMentorMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `Nao consegui responder agora.\n\n${error.message}`,
        },
      ]);
    },
  });
  const sendTestMut = trpc.whatsappIntegration.sendTestMessage.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.whatsappIntegration.get.invalidate(),
        utils.whatsappIntegration.syncStatus.invalidate(),
        utils.assistantInbox.list.invalidate(),
      ]);
      toast.success("Mensagem de teste enviada para o WhatsApp autorizado.");
    },
    onError: error => toast.error(error.message),
  });
  const sendAdvisorPreviewMut = trpc.whatsappIntegration.sendAdvisorPreview.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.whatsappIntegration.get.invalidate(),
        utils.whatsappIntegration.syncStatus.invalidate(),
        utils.assistantInbox.list.invalidate(),
      ]);
      toast.success("Orientacao enviada para o seu WhatsApp.");
    },
    onError: error => toast.error(error.message),
  });
  const confirmPendingRunMut = trpc.assistantInbox.confirmRun.useMutation({
    onSuccess: async () => {
      await refreshMentorData();
      toast.success("Confirmacao executada no painel.");
    },
    onError: error => toast.error(error.message),
  });
  const snoozePendingRunMut = trpc.assistantInbox.snoozeRun.useMutation({
    onSuccess: async () => {
      await refreshMentorData();
      toast.success("Confirmacao adiada no painel.");
    },
    onError: error => toast.error(error.message),
  });

  async function handleCopyPrompt(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      toast.success("Comando copiado para voce colar no WhatsApp.");
      window.setTimeout(() => {
        setCopiedPrompt(current => (current === prompt ? null : current));
      }, 1800);
    } catch {
      toast.error("Nao consegui copiar o comando.");
    }
  }

  function handleSendMentorMessage(content: string) {
    setMentorMessages(prev => [
      ...prev,
      {
        role: "user",
        content,
      },
    ]);

    askMentorMut.mutate({ message: content });
  }

  const totalActions = currentPlan?.actions.length ?? 0;
  const completedActions =
    currentPlan?.actions.filter(action => action.status === "concluida").length ?? 0;
  const actionProgress = totalActions > 0 ? (completedActions / totalActions) * 100 : 0;
  const pendingActions = currentPlan?.actions.filter(action => action.status === "pendente") ?? [];
  const firstSuggestedAction = ((dailyDigest?.actions.length
    ? dailyDigest.actions[0]
    : pendingActions[0]) ?? null) as GuidedPlanAction | null;
  const visibleEvents = (events ?? []).slice(0, 5);
  const latestThread = assistantInbox?.threads[0] ?? null;
  const latestThreadMessages = (assistantInbox?.messages ?? [])
    .filter(message => (latestThread ? message.threadId === latestThread.id : true))
    .slice(0, 8)
    .reverse();
  const channelConversation: ChatMessage[] = latestThreadMessages.map(message => ({
    role: message.direction === "inbound" ? "user" : "assistant",
    content: String(message.textContent || ""),
  }));
  const mentorConversation = mentorMessages.length
    ? [...channelConversation, ...mentorMessages]
    : channelConversation;
  const lastMentorPrompt =
    [...mentorConversation].reverse().find(message => message.role === "user")?.content ?? null;
  const canSendWhatsappMessage =
    Boolean(whatsappIntegration?.authorizedPhone) &&
    whatsappIntegration?.lastConnectionStatus === "sincronizado";
  const previewPrompt = lastMentorPrompt || "Me explique meu mes como um mentor financeiro.";
  const latestSentAt = whatsappIntegration?.lastMessageSentAt
    ? formatDateTimeLabel(whatsappIntegration.lastMessageSentAt)
    : "-";
  const latestReceivedAt = whatsappIntegration?.lastMessageReceivedAt
    ? formatDateTimeLabel(whatsappIntegration.lastMessageReceivedAt)
    : "-";
  const pendingConfirmationCount = (assistantInbox?.runs ?? []).filter(
    run => run.status === "aguardando_confirmacao"
  ).length;
  const latestDetectedIntent =
    latestThreadMessages.find(message => Boolean(message.detectedIntent))?.detectedIntent ?? null;
  const latestPendingRun = latestThread?.pendingRun ?? null;
  const activeMentorIntent = mentorMessages.length
    ? lastMentorIntent || latestDetectedIntent
    : latestDetectedIntent || lastMentorIntent;

  useEffect(() => {
    if (!mentorMessages.length || !channelConversation.length) return;

    const comparableLocalMessages = mentorMessages.filter(message => message.role !== "system");
    const comparableChannelMessages = channelConversation.slice(-comparableLocalMessages.length);

    if (comparableChannelMessages.length !== comparableLocalMessages.length) return;

    const isSameTail = comparableLocalMessages.every((message, index) => {
      const channelMessage = comparableChannelMessages[index];
      return channelMessage?.role === message.role && channelMessage?.content === message.content;
    });

    if (isSameTail) {
      setMentorMessages([]);
    }
  }, [channelConversation, mentorMessages]);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando central de mentoria...</div>;
  }

  const fallbackCompanyHeadroom = snapshot
    ? Math.max(snapshot.guardrails.company.projectedCash - snapshot.guardrails.company.reserveRecommendation, 0)
    : 0;
  const fallbackPersonalHeadroom = snapshot
    ? Math.max(snapshot.guardrails.personal.projectedCash - snapshot.guardrails.personal.reserveRecommendation, 0)
    : 0;
  const fallbackTotalHeadroom = snapshot?.safeToSpendMonth ?? 0;

  const companyHeadroom = decisionScenarios?.headrooms.company ?? fallbackCompanyHeadroom;
  const personalHeadroom = decisionScenarios?.headrooms.personal ?? fallbackPersonalHeadroom;
  const totalHeadroom = decisionScenarios?.headrooms.total ?? fallbackTotalHeadroom;

  const withdrawalOutcome =
    (decisionScenarios?.scenarios.withdrawal as DecisionOutcome | undefined) ??
    buildDecisionFallback(
      "withdrawal",
      "Ainda estou preparando a leitura da retirada.",
      "Assim que os dados do snapshot forem recalculados, a simulacao aparece aqui."
    );
  const personalOutcome =
    (decisionScenarios?.scenarios.personalSpend as DecisionOutcome | undefined) ??
    buildDecisionFallback(
      "personal_spend",
      "Ainda estou preparando a leitura do gasto pessoal.",
      "Assim que os dados do snapshot forem recalculados, a simulacao aparece aqui."
    );
  const monthlyCostOutcome =
    (decisionScenarios?.scenarios.monthlyCost as DecisionOutcome | undefined) ??
    buildDecisionFallback(
      "monthly_cost",
      "Ainda estou preparando a leitura do novo custo mensal.",
      "Assim que os dados do snapshot forem recalculados, a simulacao aparece aqui."
    );
  const hiringOutcome =
    (decisionScenarios?.scenarios.hiring as DecisionOutcome | undefined) ??
    buildDecisionFallback(
      "hiring",
      "Ainda estou preparando a leitura da contratacao.",
      "Assim que os dados do snapshot forem recalculados, a simulacao aparece aqui."
    );
  const installmentPurchaseOutcome =
    (decisionScenarios?.scenarios.installmentPurchase as DecisionOutcome | undefined) ??
    buildDecisionFallback(
      "installment_purchase",
      "Ainda estou preparando a leitura da compra parcelada.",
      "Assim que os dados do snapshot forem recalculados, a simulacao aparece aqui."
    );
  const recurringWithdrawalOutcome =
    (decisionScenarios?.scenarios.recurringWithdrawal as DecisionOutcome | undefined) ??
    buildDecisionFallback(
      "recurring_withdrawal",
      "Ainda estou preparando a leitura da retirada recorrente.",
      "Assim que os dados do snapshot forem recalculados, a simulacao aparece aqui."
    );
  const activeDecisionTone =
    activeMentorIntent === "company_withdrawal_decision"
      ? withdrawalOutcome.tone
      : activeMentorIntent === "recurring_withdrawal_decision"
        ? recurringWithdrawalOutcome.tone
        : activeMentorIntent === "personal_spend_decision"
          ? personalOutcome.tone
          : activeMentorIntent === "monthly_cost_decision"
            ? monthlyCostOutcome.tone
            : activeMentorIntent === "hiring_decision"
              ? hiringOutcome.tone
              : activeMentorIntent === "installment_purchase_decision"
                ? installmentPurchaseOutcome.tone
                : snapshot?.cashRiskLevel || "attention";
  const guidedPromptSections = buildGuidedPromptSections({
    withdrawalAmount,
    personalSpendAmount,
    newMonthlyCost,
    hiringCostAmount,
    installmentPurchaseAmount,
    installmentPurchaseMonths,
    recurringWithdrawalAmount,
  });
  const followUpPromptSection = buildFollowUpPromptSection({
    intent: activeMentorIntent,
    lastPrompt: lastMentorPrompt,
    withdrawalAmount,
    personalSpendAmount,
    newMonthlyCost,
    hiringCostAmount,
    installmentPurchaseAmount,
    installmentPurchaseMonths,
    recurringWithdrawalAmount,
  });
  const nextExecutableActionSection = buildNextExecutableActionSection({
    intent: activeMentorIntent,
    decisionTone: activeDecisionTone,
    lastPrompt: lastMentorPrompt,
    canSendWhatsappMessage,
    hasCurrentPlan: Boolean(currentPlan),
    latestPendingRun,
    firstPendingAction: firstSuggestedAction,
  });
  const executableMentorActions = [
    nextExecutableActionSection.primary,
    nextExecutableActionSection.secondary,
  ].flatMap(action => (action ? [action] : []));

  function executeMentorAction(action: MentorExecutableAction) {
    if (action.kind === "confirm_pending_run" && action.runId) {
      confirmPendingRunMut.mutate({ runId: action.runId });
      return;
    }
    if (action.kind === "snooze_pending_run" && action.runId) {
      snoozePendingRunMut.mutate({ runId: action.runId });
      return;
    }
    if (action.kind === "generate_monthly_plan") {
      generateMut.mutate();
      return;
    }
    if (action.kind === "complete_plan_action" && action.actionId) {
      confirmMut.mutate({ actionId: action.actionId });
      return;
    }
    if (action.kind === "send_whatsapp_preview") {
      sendAdvisorPreviewMut.mutate({
        message: action.message || previewPrompt,
      });
      return;
    }
    if (action.kind === "open_whatsapp_integration") {
      setLocation("/whatsapp/integracao");
      return;
    }
    if (action.kind === "open_inbox") {
      setLocation("/whatsapp/conversas");
    }
  }

  function isMentorActionPending(action: MentorExecutableAction) {
    if (action.kind === "confirm_pending_run" || action.kind === "snooze_pending_run") {
      return confirmPendingRunMut.isPending || snoozePendingRunMut.isPending;
    }
    if (action.kind === "generate_monthly_plan") return generateMut.isPending;
    if (action.kind === "complete_plan_action") return confirmMut.isPending;
    if (action.kind === "send_whatsapp_preview") return sendAdvisorPreviewMut.isPending;
    return false;
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-zinc-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,122,69,0.16),_transparent_35%),linear-gradient(135deg,#101113_0%,#1f2937_55%,#111827_100%)] text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <CardContent className="flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/80">
              <Sparkles className="size-3.5" />
              Mentoria Financeira
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Seu CFO por WhatsApp, dentro do app</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/74">
                Aqui voce acompanha o plano do mes, o digest diario, as acoes pendentes e os
                alertas que a IA usaria para te orientar no WhatsApp.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={snapshot?.cashRiskLevel || "attention"} />
              <span className="text-sm text-white/70">
                {snapshot?.summary || "Sem resumo do mes calculado ainda."}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
              onClick={handleRefreshMentorData}
            >
              <RefreshCw className="size-4" />
              Atualizar painel
            </Button>
            <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
              {generateMut.isPending ? "Gerando..." : currentPlan ? "Atualizar plano" : "Gerar plano agora"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <MentorOnboardingCard />

      {snapshot ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gasto seguro hoje</CardDescription>
              <CardTitle className="text-xl">{formatCurrency(snapshot.safeToSpendNow)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              O teto diario para nao apertar o restante do mes.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gasto seguro do mes</CardDescription>
              <CardTitle className="text-xl">{formatCurrency(snapshot.safeToSpendMonth)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Espaco livre depois de proteger caixa, impostos e reservas.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Caixa protegido</CardDescription>
              <CardTitle className="text-xl">{formatCurrency(snapshot.protectedCash)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Valor que nao deveria ser consumido por novos gastos.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pressao desta semana</CardDescription>
              <CardTitle className="text-xl">{snapshot.counts.dueThisWeek}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Compromissos que pressionam o caixa nos proximos dias.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Acoes pendentes</CardDescription>
              <CardTitle className="text-xl">{snapshot.counts.pendingPlanActions}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Itens do plano mensal ainda abertos para execucao.
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Canal real no WhatsApp</CardTitle>
              <CardDescription>
                Dispare uma orientacao do mentor para o numero autorizado e acompanhe se a sessao
                esta pronta para uso no dia a dia.
              </CardDescription>
            </div>
            <StatusBadge status={whatsappIntegration?.lastConnectionStatus || "pendente"} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Numero autorizado</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">
                {whatsappIntegration?.authorizedPhone || "Nao configurado"}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Ultima enviada</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">{latestSentAt}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Ultima recebida</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">{latestReceivedAt}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Mensagens salvas</p>
              <p className="mt-2 text-sm font-medium text-zinc-900">
                {whatsappStatus?.totals.messages || 0}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border bg-zinc-50/80 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-sm font-medium text-zinc-900">Proxima entrega no canal</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {lastMentorPrompt
                    ? `Vou enviar para o seu WhatsApp uma resposta baseada na ultima pergunta registrada no mentor: "${lastMentorPrompt}".`
                    : "Ainda nao houve pergunta no chat desta tela. Se quiser, eu mando um resumo executivo do seu mes como primeira mentoria."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => sendTestMut.mutate()}
                  disabled={sendTestMut.isPending || !canSendWhatsappMessage}
                >
                  {sendTestMut.isPending ? "Enviando teste..." : "Enviar teste"}
                </Button>
                <Button
                  onClick={() => sendAdvisorPreviewMut.mutate({ message: previewPrompt })}
                  disabled={sendAdvisorPreviewMut.isPending || !canSendWhatsappMessage}
                >
                  {sendAdvisorPreviewMut.isPending
                    ? "Enviando orientacao..."
                    : lastMentorPrompt
                      ? "Enviar ultima orientacao"
                      : "Receber resumo no WhatsApp"}
                </Button>
                <Button variant="ghost" onClick={() => setLocation("/whatsapp/integracao")}>
                  Ajustar integracao
                </Button>
              </div>
            </div>

            {!canSendWhatsappMessage ? (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Conecte e sincronize o WhatsApp para receber as orientacoes do mentor no numero
                autorizado.
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Sessao pronta para entregar alertas, resumos e respostas do mentor no WhatsApp.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modo decisao</CardTitle>
          <CardDescription>
            Simule decisoes que normalmente voce perguntaria no WhatsApp e veja o impacto imediato
            no seu mes antes de agir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 text-sm text-muted-foreground">
            As respostas abaixo sao baseadas no snapshot financeiro atual do app. Elas usam a
            mesma logica de folga de caixa, reserva e limite seguro do mes para te orientar de
            forma rapida e objetiva em decisoes pontuais, recorrentes e parceladas.
          </div>

          {isDecisionFetching ? (
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">
              Atualizando simulacao...
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DecisionSimulatorCard
              title="Posso tirar da empresa?"
              description="Boa para simular retirada, distribuicao, compra a vista ou saque para uso pessoal."
              icon={Building2}
              inputLabel="Valor da retirada"
              value={withdrawalAmount}
              onChange={setWithdrawalAmount}
              quickValues={[1000, 3000, 5000]}
              outcome={withdrawalOutcome}
            />

            <DecisionSimulatorCard
              title="Posso gastar isso no pessoal?"
              description="Use para testar um gasto extra neste mes sem depender so do saldo do banco."
              icon={Wallet}
              inputLabel="Valor do gasto pessoal"
              value={personalSpendAmount}
              onChange={setPersonalSpendAmount}
              quickValues={[500, 1200, 2500]}
              outcome={personalOutcome}
            />

            <DecisionSimulatorCard
              title="Posso assumir um novo custo mensal?"
              description="Simule ferramenta, aluguel, assinatura ou outro custo recorrente que nao seja folha."
              icon={Briefcase}
              inputLabel="Novo custo por mes"
              value={newMonthlyCost}
              onChange={setNewMonthlyCost}
              quickValues={[800, 2500, 5000]}
              outcome={monthlyCostOutcome}
            />

            <DecisionSimulatorCard
              title="Posso contratar agora?"
              description="Use quando quiser validar uma contratacao CLT, PJ fixa ou reforco operacional recorrente."
              icon={Target}
              inputLabel="Custo mensal da contratacao"
              value={hiringCostAmount}
              onChange={setHiringCostAmount}
              quickValues={[2500, 4000, 6500]}
              outcome={hiringOutcome}
            />

            <DecisionSimulatorCard
              title="Posso comprar parcelado?"
              description="Ideal para notebook, equipamento, maquina ou qualquer compra que vai virar parcela fixa no caixa."
              icon={PiggyBank}
              inputLabel="Valor total da compra"
              value={installmentPurchaseAmount}
              onChange={setInstallmentPurchaseAmount}
              quickValues={[6000, 12000, 18000]}
              secondaryInputLabel="Quantidade de parcelas"
              secondaryValue={installmentPurchaseMonths}
              secondaryOnChange={setInstallmentPurchaseMonths}
              secondaryPlaceholder="12"
              outcome={installmentPurchaseOutcome}
            />

            <DecisionSimulatorCard
              title="Posso tirar isso todo mes?"
              description="Simule uma retirada recorrente da empresa para ver se ela vira um peso fixo perigoso no caixa."
              icon={CalendarDays}
              inputLabel="Retirada mensal recorrente"
              value={recurringWithdrawalAmount}
              onChange={setRecurringWithdrawalAmount}
              quickValues={[3000, 5000, 8000]}
              outcome={recurringWithdrawalOutcome}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <Building2 className="size-4 text-orange-500" />
                Folga da empresa
              </div>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(companyHeadroom)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Excesso operacional estimado da empresa depois da recomendacao de reserva.
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <Wallet className="size-4 text-orange-500" />
                Folga pessoal
              </div>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(personalHeadroom)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Quanto sobra no seu plano pessoal depois da recomposicao sugerida de reserva.
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <TrendingDown className="size-4 text-orange-500" />
                Limite seguro consolidado
              </div>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(totalHeadroom)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Espaco total do mes para decisoes sem furar as protecoes atuais.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pergunte ao mentor</CardTitle>
          <CardDescription>
            Teste a conversa que vai para o WhatsApp direto aqui no app, com a mesma leitura de
            intencao, valores e contexto do seu mes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <p className="text-sm font-medium text-zinc-900">Roteiros guiados</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Atalhos prontos para puxar o mentor para conversas mais uteis, usando os valores
                  que voce ja simulou no painel.
                </p>
              </div>
              <div className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-orange-600">
                Conversa assistida
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-3">
              {guidedPromptSections.map(section => (
                <div key={section.title} className="rounded-2xl border bg-white p-4">
                  <p className="text-sm font-medium text-zinc-900">{section.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.description}</p>

                  <div className="mt-4 space-y-3">
                    {section.prompts.map(prompt => (
                      <div key={prompt.id} className="rounded-2xl border bg-zinc-50/70 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-zinc-900">{prompt.title}</p>
                              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                                {prompt.tag}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-muted-foreground">
                              {prompt.description}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSendMentorMessage(prompt.message)}
                            disabled={askMentorMut.isPending}
                          >
                            Enviar
                          </Button>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-zinc-500">{prompt.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <p className="text-sm font-medium text-zinc-900">{followUpPromptSection.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {followUpPromptSection.description}
                </p>
              </div>
              <div className="text-right text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                <div>Base atual</div>
                <div className="mt-1 text-zinc-600">
                  {formatMentorIntent(activeMentorIntent) || "conversa inicial"}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {followUpPromptSection.prompts.map(prompt => (
                <div key={prompt.id} className="rounded-2xl border bg-zinc-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-zinc-900">{prompt.title}</p>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                          {prompt.tag}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{prompt.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSendMentorMessage(prompt.message)}
                      disabled={askMentorMut.isPending}
                    >
                      Perguntar
                    </Button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">{prompt.message}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-900">
                    {nextExecutableActionSection.title}
                  </p>
                  <StatusBadge status={nextExecutableActionSection.tone} />
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {nextExecutableActionSection.description}
                </p>
              </div>
              <div className="text-right text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                <div>Leitura atual</div>
                <div className="mt-1 text-zinc-600">
                  {formatMentorIntent(activeMentorIntent) || "rotina do mentor"}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {executableMentorActions.map(action => (
                <div key={action.id} className="rounded-2xl border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-zinc-900">{action.title}</p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {action.description}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={action.id === nextExecutableActionSection.primary.id ? "default" : "outline"}
                      onClick={() => executeMentorAction(action)}
                      disabled={isMentorActionPending(action)}
                    >
                      {isMentorActionPending(action) ? "Executando..." : action.ctaLabel}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <AIChatBox
            messages={mentorConversation}
            onSendMessage={handleSendMentorMessage}
            isLoading={askMentorMut.isPending}
            placeholder="Pergunte algo como: posso tirar R$ 3.000 da empresa este mes?"
            emptyStateMessage="Converse com seu mentor financeiro sem sair do painel."
            suggestedPrompts={CHAT_PROMPTS}
            height={460}
            className="border-zinc-200 shadow-none"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Espelho do canal</CardTitle>
                <CardDescription>
                  O que ja aconteceu na thread mais recente do WhatsApp, sem sair da central.
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/whatsapp/conversas")}>
                Ver conversas
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Threads</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-900">
                  {assistantInbox?.threads.length || 0}
                </p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Confirmacoes</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-900">
                  {pendingConfirmationCount}
                </p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Leitura recente</p>
                <p className="mt-2 text-sm font-medium text-zinc-900">
                  {formatMentorIntent(latestDetectedIntent) || "Sem intencao registrada"}
                </p>
              </div>
            </div>

            {latestThread?.pendingRun ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                <p className="font-medium text-amber-900">Existe uma confirmacao pendente nesta thread.</p>
                <p className="mt-2 leading-6">
                  {latestPendingRun?.assistantResponse ||
                    "O assistente deixou uma acao aguardando confirmacao antes de seguir."}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-amber-700/80">
                  <span>{formatMentorIntent(latestPendingRun?.normalizedIntent) || latestPendingRun?.normalizedIntent || "confirmacao"}</span>
                  {latestPendingRun?.createdAt ? <span>{formatDateTimeLabel(latestPendingRun.createdAt)}</span> : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      latestPendingRun &&
                      confirmPendingRunMut.mutate({ runId: latestPendingRun.id })
                    }
                    disabled={confirmPendingRunMut.isPending || snoozePendingRunMut.isPending}
                  >
                    {confirmPendingRunMut.isPending ? "Confirmando..." : "Confirmar no app"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      latestPendingRun &&
                      snoozePendingRunMut.mutate({ runId: latestPendingRun.id })
                    }
                    disabled={confirmPendingRunMut.isPending || snoozePendingRunMut.isPending}
                  >
                    {snoozePendingRunMut.isPending ? "Adiando..." : "Adiar no app"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Nenhuma confirmacao pendente na thread mais recente.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mensagens recentes do WhatsApp</CardTitle>
            <CardDescription>
              Historico da thread mais recente para manter o contexto do mentor alinhado com o canal real.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestThreadMessages.length ? (
              latestThreadMessages.map(message => (
                <div key={message.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-zinc-900">
                          {message.direction === "inbound" ? "Recebida" : "Enviada"}
                        </p>
                        <StatusBadge status={message.status} />
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {message.textContent || "Mensagem sem texto"}
                      </p>
                    </div>
                    <div className="text-right text-xs uppercase tracking-[0.16em] text-zinc-400">
                      <div>{getMentorMessageSourceLabel(message.rawPayload)}</div>
                      <div className="mt-1">{formatDateTimeLabel(message.createdAt)}</div>
                    </div>
                  </div>

                  {message.detectedIntent ? (
                    <p className="mt-3 text-xs uppercase tracking-[0.18em] text-zinc-400">
                      Leitura: {formatMentorIntent(message.detectedIntent) || message.detectedIntent}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                Ainda nao ha historico salvo do canal. Assim que o numero autorizado conversar com
                o assistente, a thread aparece aqui.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Foco de hoje</CardTitle>
            <CardDescription>
              O que a IA diria agora no WhatsApp com base no seu mes atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                <MessageCircle className="size-4 text-orange-500" />
                Digest diario
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                {dailyDigest?.message || "Sem resumo diario disponivel ainda."}
              </p>
            </div>

            {dailyDigest?.alerts?.length ? (
              <div className="space-y-3">
                {dailyDigest.alerts.map(alert => (
                  <div
                    key={alert}
                    className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{alert}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Nenhum alerta critico registrado neste momento.
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-zinc-900">Prioridades praticas do dia</p>
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                  {pendingActions.length} aberta(s)
                </span>
              </div>

              {(dailyDigest?.actions.length ? dailyDigest.actions : pendingActions.slice(0, 3)).map(action => (
                <div key={action.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-zinc-900">{action.title}</p>
                        <StatusBadge status={action.priority} />
                      </div>
                      <p className="text-sm text-muted-foreground">{action.description}</p>
                      {getPlanActionExecutionNote(action.actionType) ? (
                        <p className="text-xs text-zinc-500">
                          {getPlanActionExecutionNote(action.actionType)}
                        </p>
                      ) : null}
                    </div>

                    {action.status !== "concluida" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => confirmMut.mutate({ actionId: action.id })}
                        disabled={confirmMut.isPending}
                      >
                        <CheckCircle2 className="size-4" />
                        {getPlanActionCtaLabel(action.actionType)}
                      </Button>
                    ) : (
                      <StatusBadge status={action.status} />
                    )}
                  </div>
                </div>
              ))}

              {!dailyDigest?.actions.length && pendingActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Gere o plano mensal para a IA passar a acompanhar suas acoes do mes.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Comandos prontos para WhatsApp</CardTitle>
            <CardDescription>
              Copie uma pergunta pronta e mande para a IA no numero conectado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {WHATSAPP_PROMPTS.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleCopyPrompt(prompt)}
                className="w-full rounded-2xl border p-4 text-left transition hover:border-orange-200 hover:bg-orange-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{prompt}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copiedPrompt === prompt ? "Copiado para area de transferencia." : "Toque para copiar."}
                    </p>
                  </div>
                  <Copy className="mt-0.5 size-4 text-zinc-400" />
                </div>
              </button>
            ))}

            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 text-sm text-muted-foreground">
              O ideal e a IA falar menos como chatbot e mais como mentor: limite seguro,
              pressao de caixa, cobrancas, prioridades e proxima melhor acao.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Plano vigente</CardTitle>
              <CardDescription>
                {currentPlan
                  ? `Mes ${String(currentPlan.periodMonth).padStart(2, "0")}/${currentPlan.periodYear}`
                  : "Nenhum plano confirmado para o mes atual"}
              </CardDescription>
            </div>
            {currentPlan ? <StatusBadge status={currentPlan.status} /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {currentPlan ? (
            <>
              <div className="rounded-3xl border bg-zinc-50/80 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-3xl">
                    <p className="text-sm font-medium text-zinc-900">Resumo executivo</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{currentPlan.summary}</p>
                    {currentPlan.recommendedCashAction ? (
                      <p className="mt-3 text-sm text-zinc-500">
                        Proxima melhor acao: {currentPlan.recommendedCashAction}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-[220px] rounded-2xl border bg-white p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Execucao do plano</span>
                      <span className="font-medium text-zinc-900">
                        {completedActions}/{totalActions}
                      </span>
                    </div>
                    <Progress value={actionProgress} className="mt-3 h-2" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {Math.round(actionProgress)}% das acoes concluidas.
                    </p>
                  </div>
                </div>
              </div>

              {snapshot ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Reserva empresa</p>
                    <div className="mt-2 flex items-center gap-2">
                      <PiggyBank className="size-4 text-emerald-600" />
                      <p className="font-semibold">{formatCurrency(snapshot.companyReserveRecommendation)}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Reserva pessoal</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Wallet className="size-4 text-orange-500" />
                      <p className="font-semibold">{formatCurrency(snapshot.personalReserveRecommendation)}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Provisao tributaria</p>
                    <div className="mt-2 flex items-center gap-2">
                      <ShieldCheck className="size-4 text-zinc-700" />
                      <p className="font-semibold">{formatCurrency(snapshot.taxProvision)}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {currentPlan.actions.map(action => (
                  <div key={action.id} className="rounded-2xl border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{action.title}</p>
                          <StatusBadge status={action.priority} />
                        </div>
                        <p className="text-sm text-muted-foreground">{action.description}</p>
                        {getPlanActionExecutionNote(action.actionType) ? (
                          <p className="text-xs text-zinc-500">
                            {getPlanActionExecutionNote(action.actionType)}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge status={action.status} />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-400">
                        <CalendarDays className="size-3.5" />
                        {formatDateLabel(action.dueDate)}
                      </div>
                      {action.status !== "concluida" ? (
                        <Button
                          size="sm"
                          onClick={() => confirmMut.mutate({ actionId: action.id })}
                          disabled={confirmMut.isPending}
                        >
                          {getPlanActionCtaLabel(action.actionType)}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed p-8 text-center">
              <Target className="mx-auto size-10 text-orange-500" />
              <h2 className="mt-4 text-lg font-semibold text-zinc-900">Nenhum plano mensal ativo ainda</h2>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Gere o primeiro plano para a IA definir gasto seguro, ordem de pagamento,
                reforco de reserva e acoes praticas do mes.
              </p>
              <Button className="mt-5" onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
                {generateMut.isPending ? "Gerando..." : "Gerar primeiro plano"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Fechamento do ciclo</CardTitle>
            <CardDescription>
              Leitura de fim de mes para ajustar o proximo ciclo antes do problema crescer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border p-4">
              <p className="text-sm text-muted-foreground">Mensagem do fechamento</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {monthClose?.message || "Sem fechamento calculado para o momento."}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Desvio contra o plano</p>
                <p className="mt-2 text-xl font-semibold">
                  {formatCurrency(monthClose?.deviation || 0)}
                </p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Foco do proximo mes</p>
                <p className="mt-2 text-sm text-zinc-600">
                  {monthClose?.focusNextMonth || "Sem direcao registrada ainda."}
                </p>
              </div>
            </div>
            {monthClose?.excessSignals?.length ? (
              <div className="space-y-3">
                {monthClose.excessSignals.map(signal => (
                  <div key={signal} className="rounded-2xl border px-4 py-3 text-sm text-muted-foreground">
                    {signal}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                O fechamento do ciclo ainda nao apontou excessos relevantes.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alertas e automacoes</CardTitle>
            <CardDescription>
              Eventos que o sistema ja gerou ou esta acompanhando para o WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleEvents.length ? (
              visibleEvents.map(event => (
                <div key={event.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-zinc-900">{event.title}</p>
                        <StatusBadge status={event.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">{event.messageBody}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-zinc-400">
                        <span>{event.type}</span>
                        <span>{event.scope}</span>
                        <span>{formatDateTimeLabel(event.createdAt)}</span>
                      </div>
                    </div>

                    {event.status !== "adiado" &&
                    event.status !== "descartado" &&
                    event.status !== "enviado" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => snoozeMut.mutate({ eventId: event.id, hours: 24 })}
                        disabled={snoozeMut.isPending}
                      >
                        Adiar 24h
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum evento automatizado registrado ainda.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historico de planos</CardTitle>
          <CardDescription>
            Registro dos planos que a IA ja gerou para seus ciclos anteriores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plans?.length ? (
            plans.map(plan => (
              <div key={plan.id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {String(plan.periodMonth).padStart(2, "0")}/{plan.periodYear}
                      </p>
                      <StatusBadge status={plan.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">{plan.summary}</p>
                  </div>

                  <div className="min-w-[180px] rounded-2xl bg-zinc-50 px-4 py-3 text-right">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Acoes concluidas</p>
                    <p className="mt-1 text-lg font-semibold text-zinc-900">
                      {plan.actions.filter(action => action.status === "concluida").length}/
                      {plan.actions.length}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum plano mensal gerado ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
