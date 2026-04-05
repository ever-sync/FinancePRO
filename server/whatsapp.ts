import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import * as asaasDb from "./db/asaas";
import * as whatsappDb from "./db/whatsapp";
import * as financialAdvisor from "./financial-advisor";
import {
  detectFinancialAssistantIntent,
  extractDecisionAmount,
  extractInstallmentCount,
  isAdvisorIntent,
  type FinancialAssistantIntent,
} from "./_core/financialAssistantIntent";
import { invokeLLM, type Message } from "./_core/llm";
import { UazapiClient, UazapiRequestError, normalizeWhatsAppPhone } from "./_core/uazapi";

type AnyRecord = Record<string, any>;

type AssistantIntent = FinancialAssistantIntent;

type ExtractedInboundMessage = {
  instanceId: string;
  instanceToken: string | null;
  providerMessageId: string;
  phoneNumber: string;
  displayName: string | null;
  text: string;
  rawPayload: AnyRecord;
};

type FinancialContext = {
  generatedAt: string;
  month: number;
  year: number;
  company: AnyRecord | null;
  personal: AnyRecord | null;
  calendar: AnyRecord | null;
  debts: AnyRecord[];
  investments: AnyRecord[];
  reserveFunds: AnyRecord[];
  asaasCharges: AnyRecord[];
};

type SuggestedAction = {
  actionType: string;
  title: string;
  description: string;
  priority: "alta" | "media" | "baixa";
  dueDate?: string | null;
  requiresConfirmation?: boolean;
  metadata?: AnyRecord;
};

type AssistantReplyPayload = {
  reply: string;
  summary: string;
  alerts: string[];
  suggestedActions: SuggestedAction[];
  mentorMode?: financialAdvisor.FinancialAdvisorMentorMode;
};

type MonthlyPlanPayload = {
  summary: string;
  targetBalance: string;
  recommendedCashAction: string;
  messageToUser: string;
  actions: SuggestedAction[];
};

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const CONFIRM_WORDS = new Set(["CONFIRMAR", "CONFIRMO", "SIM"]);
const SNOOZE_WORDS = new Set(["ADIAR", "DEPOIS", "MAIS TARDE"]);

function maskSecret(secret: string | null | undefined) {
  if (!secret) return "";
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 3)}${"*".repeat(Math.max(secret.length - 6, 4))}${secret.slice(-3)}`;
}

function getUazapiClient(integration: {
  apiBaseUrl: string;
  apiToken: string;
  instanceId: string;
}) {
  return new UazapiClient({
    apiBaseUrl: integration.apiBaseUrl,
    apiToken: integration.apiToken,
    instanceId: integration.instanceId,
  });
}

function getWebhookUrl(origin?: string | null) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return null;
    }
  } catch {
    return null;
  }
  return `${origin.replace(/\/$/, "")}/api/whatsapp/uazapi/webhook`;
}

function getPartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    iso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isConfirmationMessage(message: string) {
  return CONFIRM_WORDS.has(message.trim().toUpperCase());
}

function isSnoozeMessage(message: string) {
  return SNOOZE_WORDS.has(message.trim().toUpperCase());
}

function formatAdvisorPreviewMessage(params: {
  question: string;
  reply: string;
  alerts: string[];
  suggestedActions: SuggestedAction[];
  mentorMode?: financialAdvisor.FinancialAdvisorMentorMode;
}) {
  const header =
    params.mentorMode === "execution_short"
      ? "Mentoria Financeira · Modo execucao curta"
      : params.mentorMode === "strategic"
        ? "Mentoria Financeira · Modo estrategico"
        : "Mentoria Financeira · Modo calibracao";
  const parts = [
    header,
    `Pergunta: ${params.question}`,
    params.reply,
  ];

  if (params.alerts.length) {
    parts.push(`Alertas:\n- ${params.alerts.join("\n- ")}`);
  }

  const nextActions = params.suggestedActions.slice(0, 3);
  if (nextActions.length) {
    parts.push(`Proximas acoes:\n- ${nextActions.map(action => action.title).join("\n- ")}`);
  }

  return parts.join("\n\n");
}

function getMentorModeLabel(mode?: financialAdvisor.FinancialAdvisorMentorMode) {
  if (mode === "execution_short") return "execucao curta";
  if (mode === "strategic") return "estrategico";
  return "calibracao";
}

function formatMentorChannelMessage(params: {
  reply: string;
  mentorMode?: financialAdvisor.FinancialAdvisorMentorMode;
  alerts?: string[];
  suggestedActions?: SuggestedAction[];
  intro?: string;
}) {
  const parts = [
    `Mentor em modo ${getMentorModeLabel(params.mentorMode)}.`,
    params.intro ? `${params.intro} ${params.reply}` : params.reply,
  ];

  if (params.alerts?.length) {
    parts.push(`Alertas:\n- ${params.alerts.slice(0, 3).join("\n- ")}`);
  }

  if (params.suggestedActions?.length) {
    parts.push(`Proximas acoes:\n- ${params.suggestedActions.slice(0, 3).map(action => action.title).join("\n- ")}`);
  }

  return parts.join("\n\n");
}

function mapAdvisorRecommendationsToSuggestedActions(
  recommendations: Awaited<ReturnType<typeof financialAdvisor.buildFinancialAdvisorAssistantReply>>["suggestedActions"]
): SuggestedAction[] {
  return recommendations.map(recommendation => ({
    actionType: recommendation.kind,
    title: recommendation.title,
    description: recommendation.description,
    priority:
      recommendation.kind === "pay_priority_items" || recommendation.kind === "freeze_discretionary"
        ? "alta"
        : recommendation.kind === "review_variable_costs"
          ? "media"
          : "baixa",
    requiresConfirmation: recommendation.requiresConfirmation,
    metadata: recommendation.metadata
      ? { ...recommendation.metadata, amount: recommendation.amount ?? null }
      : recommendation.amount != null
        ? { amount: recommendation.amount }
        : undefined,
  }));
}

function mapPlanActionsToSuggestedActions(
  actions: Array<{
    actionType: string;
    title: string;
    description: string;
    priority: string;
    dueDate?: string | null;
    metadata?: string | null;
  }>
): SuggestedAction[] {
  return actions.map(action => ({
    actionType: action.actionType,
    title: action.title,
    description: action.description,
    priority:
      action.priority === "alta" || action.priority === "baixa"
        ? action.priority
        : "media",
    dueDate: action.dueDate ?? null,
    metadata: action.metadata ? { rawMetadata: action.metadata } : undefined,
  }));
}

function extractTextMessage(source: AnyRecord) {
  return (
    source?.conversation ||
    source?.extendedTextMessage?.text ||
    source?.imageMessage?.caption ||
    source?.videoMessage?.caption ||
    source?.body ||
    source?.text ||
    source?.message?.conversation ||
    source?.message?.extendedTextMessage?.text ||
    ""
  );
}

function extractUazapiMessages(payload: AnyRecord): ExtractedInboundMessage[] {
  const instanceId = String(
    payload?.instanceId ||
      payload?.instance?.id ||
      payload?.instance ||
      payload?.data?.instanceId ||
      payload?.data?.instance?.id ||
      payload?.data?.instance ||
      ""
  );
  const instanceToken = String(
    payload?.token || payload?.instance?.token || payload?.data?.token || payload?.data?.instance?.token || ""
  ).trim();

  const candidates = Array.isArray(payload?.data?.messages)
    ? payload.data.messages
    : Array.isArray(payload?.messages)
      ? payload.messages
      : Array.isArray(payload?.data)
        ? payload.data
        : [payload?.data ?? payload];

  return candidates
    .map((candidate: AnyRecord) => {
      const inner = candidate?.message ?? candidate?.data?.message ?? candidate;
      const providerMessageId = String(
        candidate?.key?.id ||
          candidate?.id ||
          candidate?.messageid ||
          inner?.id ||
          inner?.messageid ||
          randomUUID()
      );
      const fromMe = Boolean(candidate?.key?.fromMe || candidate?.fromMe || inner?.fromMe);
      const remoteJid = String(
        candidate?.key?.remoteJid ||
          candidate?.remoteJid ||
          candidate?.from ||
          candidate?.sender ||
          candidate?.chatid ||
          inner?.key?.remoteJid ||
          inner?.remoteJid ||
          inner?.from ||
          inner?.sender ||
          inner?.chatid ||
          ""
      );
      const phoneNumber = normalizeWhatsAppPhone(remoteJid.split("@")[0] || remoteJid);
      const text = String(extractTextMessage(inner)).trim();
      const displayName =
        candidate?.pushName ||
        candidate?.notifyName ||
        candidate?.senderName ||
        candidate?.name ||
        inner?.senderName ||
        inner?.name ||
        null;

      if (fromMe || (!instanceId && !instanceToken) || !phoneNumber || !text) return null;

      return {
        instanceId,
        instanceToken: instanceToken || null,
        providerMessageId,
        phoneNumber,
        displayName,
        text,
        rawPayload: candidate,
      } satisfies ExtractedInboundMessage;
    })
    .filter(Boolean) as ExtractedInboundMessage[];
}

function mapUazapiErrorMessage(error: unknown) {
  if (!(error instanceof UazapiRequestError)) {
    return error instanceof Error ? error.message : "Falha ao validar integracao Uazapi.";
  }

  const message = error.message || "Falha ao validar integracao Uazapi.";
  const normalized = message.toLowerCase();

  if (error.status === 401 && normalized.includes("invalid token")) {
    return "Token da instancia invalido na Uazapi. Use o token da propria instancia, nao o admintoken.";
  }

  if (error.status === 401 && normalized.includes("missing token")) {
    return "A Uazapi exige o header token da instancia. Revise o token salvo nesta integracao.";
  }

  if (error.status === 404 && normalized.includes("not found")) {
    return "A Uazapi nao encontrou a rota ou a instancia para esse host. Revise a URL base e o token da instancia.";
  }

  return message;
}

async function buildFinancialContext(userId: number, timezone = DEFAULT_TIMEZONE): Promise<FinancialContext> {
  const now = new Date();
  const { month, year, iso } = getPartsInTimeZone(now, timezone);
  const [company, personal, calendar, debts, investments, reserveFunds, asaasCharges] = await Promise.all([
    db.getCompanyDashboardData(userId, month, year).catch(() => null),
    db.getPersonalDashboardData(userId, month, year).catch(() => null),
    db.getCalendarData(userId, month, year).catch(() => null),
    db.getDebts(userId).catch(() => []),
    db.getInvestments(userId).catch(() => []),
    db.getReserveFunds(userId).catch(() => []),
    asaasDb.listAsaasCharges(userId).catch(() => []),
  ]);

  return {
    generatedAt: iso,
    month,
    year,
    company,
    personal,
    calendar,
    debts: Array.isArray(debts) ? debts : [],
    investments: Array.isArray(investments) ? investments : [],
    reserveFunds: Array.isArray(reserveFunds) ? reserveFunds : [],
    asaasCharges: Array.isArray(asaasCharges) ? asaasCharges.slice(0, 25) : [],
  };
}

function summarizeContext(context: FinancialContext) {
  return JSON.stringify(
    {
      period: { month: context.month, year: context.year, generatedAt: context.generatedAt },
      company: context.company,
      personal: context.personal,
      upcoming: context.calendar,
      debts: context.debts.slice(0, 15),
      investments: context.investments.slice(0, 10),
      reserveFunds: context.reserveFunds.slice(0, 10),
      asaasCharges: context.asaasCharges.slice(0, 15),
    },
    null,
    2
  );
}

function buildFallbackReply(intent: AssistantIntent, context: FinancialContext): AssistantReplyPayload {
  const companyNet = Number(context.company?.netProfit ?? context.company?.monthlyNet ?? 0);
  const personalBalance = Number(context.personal?.balance ?? context.personal?.monthlyBalance ?? 0);
  const overdueCharges = context.asaasCharges.filter(
    charge => String(charge.status || "").toUpperCase().includes("OVERDUE") || charge.status === "RECEIVED_IN_CASH_UNDONE"
  );
  const upcomingItems = Array.isArray(context.calendar?.items) ? context.calendar.items.slice(0, 5) : [];

  const replies: Record<AssistantIntent, string> = {
    monthly_plan_request:
      "Posso montar seu plano financeiro do mês com prioridades de caixa, cobranças e ações práticas. Responda CONFIRMAR para eu registrar esse plano no sistema.",
    cash_advice: `Empresa: ${companyNet.toFixed(2)} de resultado estimado. Pessoal: ${personalBalance.toFixed(2)} de saldo estimado. Priorize caixa, contas próximas e cobranças pendentes antes de novos gastos.`,
    company_summary: `A empresa está com resultado estimado de ${companyNet.toFixed(2)} neste mês. Vale focar em recebimentos próximos e controle dos custos variáveis.`,
    personal_summary: `Seu caixa pessoal estimado está em ${personalBalance.toFixed(2)} neste mês. Revise vencimentos desta semana e preserve reserva antes de assumir novos compromissos.`,
    upcoming_bills: upcomingItems.length
      ? `Os próximos vencimentos já mapeados são: ${upcomingItems.map((item: AnyRecord) => item.title || item.description || "item").join(", ")}.`
      : "Não encontrei vencimentos próximos no calendário atual, mas vale revisar as contas fixas e cobranças do Asaas.",
    overdue_items: overdueCharges.length
      ? `Existem ${overdueCharges.length} cobranças do Asaas exigindo atenção. Priorize contato e renegociação das mais antigas.`
      : "Não encontrei cobrança vencida agora, mas sigo monitorando qualquer risco de atraso.",
    consolidated_analysis:
      "Seu cenário consolidado pede disciplina de caixa: olhar empresa e pessoal juntos, proteger reserva e concentrar esforços nos recebimentos e vencimentos desta quinzena.",
    spending_limit:
      "Posso estimar um limite seguro de gasto para hoje olhando folga de caixa, vencimentos e reserva antes de qualquer novo consumo.",
    company_withdrawal_decision:
      "Consigo avaliar se tirar dinheiro da empresa agora pressiona o caixa do mês ou ainda mantém sua margem de segurança.",
    recurring_withdrawal_decision:
      "Também consigo simular uma retirada recorrente da empresa para te mostrar se ela cabe no mês sem comprometer o caixa.",
    personal_spend_decision:
      "Posso te dizer se esse gasto pessoal cabe no mês sem apertar sua reserva nem desorganizar o plano atual.",
    monthly_cost_decision:
      "Dá para simular esse novo custo mensal e medir quanto ele consome da folga do seu planejamento atual.",
    hiring_decision:
      "Posso estimar o impacto de uma contratação no mês e te dizer se o caixa comporta esse novo compromisso.",
    installment_purchase_decision:
      "Também consigo avaliar compras parceladas para mostrar o peso mensal e o risco no seu fluxo de caixa.",
    reserve_transfer:
      "Consigo sugerir um reforço de reserva e dizer se agora é um bom momento para proteger caixa sem travar a operação.",
    payment_priority:
      "Posso organizar a ordem de pagamento do mês para preservar caixa e reduzir risco operacional.",
    financial_health:
      "Consigo resumir a saúde financeira do momento, destacando riscos, folga de caixa e o foco mais importante do mês.",
    generic_chat:
      "Consigo te responder no WhatsApp sobre visão do mês, contas a vencer, saúde financeira, plano mensal e recomendações práticas para empresa e pessoal.",
  };

  return {
    reply: replies[intent],
    summary: replies[intent],
    alerts: overdueCharges.length ? [`${overdueCharges.length} cobrança(s) do Asaas com risco ou atraso.`] : [],
    suggestedActions:
      intent === "monthly_plan_request"
        ? [
            {
              actionType: "create_monthly_plan",
              title: "Gerar plano financeiro do mês",
              description: "Criar plano com objetivos, prioridades de caixa e ações concretas.",
              priority: "alta",
              requiresConfirmation: true,
            },
          ]
        : [],
  };
}

async function generateAssistantReply(
  intent: AssistantIntent,
  incomingText: string,
  context: FinancialContext
): Promise<AssistantReplyPayload> {
  const fallback = buildFallbackReply(intent, context);
  const messages: Message[] = [
    {
      role: "system",
      content:
        "Voce e um copiloto financeiro no WhatsApp. Responda em portugues do Brasil, com clareza, foco pratico e tom executivo. Use somente o contexto fornecido. Gere JSON com as chaves reply, summary, alerts e suggestedActions.",
    },
    {
      role: "user",
      content: `Intencao: ${intent}\nMensagem do usuario: ${incomingText}\n\nContexto financeiro:\n${summarizeContext(context)}`,
    },
  ];

  try {
    const response = await invokeLLM({
      messages,
      responseFormat: { type: "json_object" },
    });
    const rawContent = response.choices[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map(part => ("text" in part ? part.text : "")).join("\n")
      : String(rawContent || "");
    const parsed = JSON.parse(content) as Partial<AssistantReplyPayload>;

    return {
      reply: parsed.reply || fallback.reply,
      summary: parsed.summary || parsed.reply || fallback.summary,
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map(String) : fallback.alerts,
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.map(action => ({
            actionType: String(action.actionType || "manual_follow_up"),
            title: String(action.title || "Acompanhar item financeiro"),
            description: String(action.description || "Verificar o ponto sugerido pela IA."),
            priority:
              action.priority === "alta" || action.priority === "baixa" ? action.priority : "media",
            dueDate: action.dueDate ? String(action.dueDate) : null,
            requiresConfirmation: Boolean(action.requiresConfirmation),
            metadata: typeof action.metadata === "object" && action.metadata ? action.metadata : undefined,
          }))
        : fallback.suggestedActions,
    };
  } catch {
    return fallback;
  }
}

async function generateMonthlyPlan(context: FinancialContext): Promise<MonthlyPlanPayload> {
  const fallback: MonthlyPlanPayload = {
    summary: "Plano mensal gerado com foco em caixa, vencimentos e disciplina financeira.",
    targetBalance: String(
      Number(context.company?.netProfit ?? 0) + Number(context.personal?.balance ?? 0)
    ),
    recommendedCashAction:
      "Preservar liquidez, concentrar cobranças abertas e revisar os maiores gastos variáveis antes de novos compromissos.",
    messageToUser:
      "Monteio um plano enxuto para o mês com ações práticas. Ele prioriza caixa, cobranças, vencimentos e proteção da reserva.",
    actions: [
      {
        actionType: "charge_follow_up",
        title: "Cobrar recebimentos abertos",
        description: "Revisar as cobranças abertas no Asaas e dar prioridade às que vencem primeiro.",
        priority: "alta",
      },
      {
        actionType: "expense_review",
        title: "Revisar custos variáveis",
        description: "Cortar ou adiar gastos variáveis não essenciais desta semana.",
        priority: "media",
      },
      {
        actionType: "reserve_protection",
        title: "Proteger a reserva",
        description: "Evitar usar a reserva para despesas previsíveis e acompanhar o saldo projetado.",
        priority: "alta",
      },
    ],
  };

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "Voce gera planos mensais financeiros objetivos para empresa e vida pessoal. Responda em JSON com summary, targetBalance, recommendedCashAction, messageToUser e actions.",
        },
        {
          role: "user",
          content: `Contexto consolidado do mes:\n${summarizeContext(context)}`,
        },
      ],
      responseFormat: { type: "json_object" },
    });
    const rawContent = response.choices[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map(part => ("text" in part ? part.text : "")).join("\n")
      : String(rawContent || "");
    const parsed = JSON.parse(content) as Partial<MonthlyPlanPayload>;
    return {
      summary: parsed.summary || fallback.summary,
      targetBalance: parsed.targetBalance || fallback.targetBalance,
      recommendedCashAction: parsed.recommendedCashAction || fallback.recommendedCashAction,
      messageToUser: parsed.messageToUser || fallback.messageToUser,
      actions: Array.isArray(parsed.actions) && parsed.actions.length > 0 ? parsed.actions : fallback.actions,
    };
  } catch {
    return fallback;
  }
}

async function sendOutgoingMessage(params: {
  integration: Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>;
  contactId: number;
  threadId: number;
  phoneNumber: string;
  text: string;
  detectedIntent?: string | null;
  requiresConfirmation?: boolean;
  metadata?: AnyRecord;
}) {
  const { integration, contactId, threadId, phoneNumber, text, detectedIntent, requiresConfirmation, metadata } =
    params;

  if (!integration) {
    throw new Error("Integracao WhatsApp nao encontrada.");
  }

  const client = getUazapiClient(integration);
  const response = await client.sendTextMessage(phoneNumber, text);
  const responsePayload = response as AnyRecord | null;
  const providerMessageId = String(
    responsePayload?.id ||
      responsePayload?.messageId ||
      responsePayload?.messageid ||
      responsePayload?.response?.id ||
      randomUUID()
  );

  const message = await whatsappDb.createWhatsAppMessage({
    userId: integration.userId,
    integrationId: integration.id,
    contactId,
    threadId,
    providerMessageId,
    direction: "outbound",
    status: "sent",
    textContent: text,
    detectedIntent: detectedIntent ?? null,
    requiresConfirmation: requiresConfirmation ?? false,
    rawPayload: JSON.stringify(metadata ?? responsePayload),
  });

  await whatsappDb.touchWhatsAppOutbound(integration.id);
  return message;
}

async function createNotification(params: {
  integrationId: number;
  userId: number;
  relatedRunId?: number | null;
  relatedPlanId?: number | null;
  relatedMessageId?: number | null;
  type: string;
  scope: string;
  title: string;
  messageBody: string;
  dedupeKey: string;
  status?: "agendado" | "enviado" | "falhou" | "adiado" | "descartado";
}) {
  const existing = await whatsappDb.getNotificationEventByDedupeKey(params.integrationId, params.dedupeKey);
  if (existing) return existing;

  return whatsappDb.createNotificationEvent({
    userId: params.userId,
    integrationId: params.integrationId,
    relatedRunId: params.relatedRunId ?? null,
    relatedPlanId: params.relatedPlanId ?? null,
    relatedMessageId: params.relatedMessageId ?? null,
    type: params.type,
    scope: params.scope,
    title: params.title,
    messageBody: params.messageBody,
    dedupeKey: params.dedupeKey,
    status: params.status ?? "agendado",
  });
}

export async function getWhatsAppIntegration(userId: number, origin?: string | null) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) return null;

  const webhookUrl = integration.webhookUrl || getWebhookUrl(origin);
  return {
    ...integration,
    apiToken: undefined,
    maskedApiToken: maskSecret(integration.apiToken),
    hasApiToken: Boolean(integration.apiToken),
    webhookUrl,
  };
}

export async function upsertWhatsAppIntegration(
  userId: number,
  input: {
    provider?: "uazapi";
    instanceId: string;
    apiBaseUrl: string;
    apiToken?: string;
    authorizedPhone: string;
    enabled?: boolean;
    automationHour?: number;
    timezone?: string;
  },
  origin?: string | null
) {
  const normalizedPhone = normalizeWhatsAppPhone(input.authorizedPhone);
  if (!normalizedPhone) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um numero autorizado valido." });
  }

  const record = await whatsappDb.upsertWhatsAppIntegration(userId, {
    provider: input.provider ?? "uazapi",
    instanceId: input.instanceId.trim(),
    apiBaseUrl: input.apiBaseUrl.trim(),
    apiToken: input.apiToken,
    authorizedPhone: normalizedPhone,
    enabled: input.enabled ?? true,
    automationHour: input.automationHour ?? 8,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    webhookUrl: getWebhookUrl(origin),
  });

  return getWhatsAppIntegration(userId, origin) ?? record;
}

export async function testWhatsAppConnection(
  userId: number,
  origin?: string | null,
  override?: {
    instanceId?: string;
    apiBaseUrl?: string;
    apiToken?: string;
  }
) {
  const savedIntegration = await whatsappDb.getWhatsAppIntegration(userId);
  const integration = savedIntegration
    ? {
        ...savedIntegration,
        instanceId: override?.instanceId?.trim() || savedIntegration.instanceId,
        apiBaseUrl: override?.apiBaseUrl?.trim() || savedIntegration.apiBaseUrl,
        apiToken: override?.apiToken?.trim() || savedIntegration.apiToken,
      }
    : override?.instanceId?.trim() && override?.apiBaseUrl?.trim() && override?.apiToken?.trim()
      ? {
          id: 0,
          userId,
          provider: "uazapi" as const,
          instanceId: override.instanceId.trim(),
          apiBaseUrl: override.apiBaseUrl.trim(),
          apiToken: override.apiToken.trim(),
          authorizedPhone: "",
          enabled: true,
          automationHour: 8,
          timezone: DEFAULT_TIMEZONE,
          webhookUrl: getWebhookUrl(origin),
          lastConnectionStatus: "pendente",
          lastConnectionMessage: null,
          lastConnectionCheckedAt: null,
          lastWebhookReceivedAt: null,
          lastMessageReceivedAt: null,
          lastMessageSentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null;

  if (!integration) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Preencha e salve a integracao do WhatsApp, ou informe instanceId, URL e token para testar.",
    });
  }

  if (!integration.instanceId || !integration.apiBaseUrl || !integration.apiToken) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Informe instanceId, API base URL e API token validos para testar a conexao.",
    });
  }

  try {
    const client = getUazapiClient(integration);
    const status = await client.getInstanceStatus();
    const connectedInstanceId = String(
      (status as AnyRecord)?.instance?.id || (status as AnyRecord)?.instanceId || ""
    ).trim();
    const webhookUrl = integration.webhookUrl || getWebhookUrl(origin);
    let webhookConfigured = false;

    if (webhookUrl) {
      await client.configureWebhook(webhookUrl);
      webhookConfigured = true;
    }

    if (savedIntegration) {
      await whatsappDb.markWhatsAppConnection(
        savedIntegration.id,
        "sincronizado",
        String(status?.message || status?.status || "Conexao com a Uazapi validada com sucesso.")
      );
    }

    return {
      success: true,
      instanceId: connectedInstanceId || integration.instanceId,
      message: webhookConfigured
        ? connectedInstanceId && connectedInstanceId !== integration.instanceId
          ? `Conexao com a Uazapi validada. A instancia retornada foi ${connectedInstanceId}; atualize o campo Instance ID se necessario.`
          : "Conexao com a Uazapi validada com sucesso."
        : connectedInstanceId && connectedInstanceId !== integration.instanceId
          ? `Conexao validada com sucesso. O webhook foi ignorado neste ambiente local. A instancia retornada foi ${connectedInstanceId}; atualize o campo Instance ID se necessario.`
          : "Conexao validada com sucesso. O webhook foi ignorado neste ambiente local.",
      status,
      webhookConfigured,
    };
  } catch (error) {
    const message = mapUazapiErrorMessage(error);
    if (savedIntegration) {
      await whatsappDb.markWhatsAppConnection(savedIntegration.id, "erro", message);
    }
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

export async function sendWhatsAppTestMessage(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Integracao do WhatsApp nao encontrada." });
  }

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });

  const thread = await whatsappDb.getOrCreateAssistantThread(userId, integration.id, contact.id, {
    lastMessageAt: new Date(),
  });

  try {
    const message = await sendOutgoingMessage({
      integration,
      contactId: contact.id,
      threadId: thread.id,
      phoneNumber: integration.authorizedPhone,
      text: "FinancePRO conectado com sucesso ao WhatsApp. A partir daqui eu posso conversar com voce, enviar alertas e montar seus planos financeiros do mes.",
    });

    return { success: true, messageId: message.id };
  } catch (error) {
    const message = mapUazapiErrorMessage(error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        message === "Falha ao validar integracao Uazapi."
          ? "Nao foi possivel enviar a mensagem de teste pela Uazapi."
          : message,
    });
  }
}

export async function sendFinancialAdvisorPreviewMessage(userId: number, question: string) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Integracao do WhatsApp nao encontrada." });
  }
  if (!integration.enabled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ative a integracao do WhatsApp antes de enviar a mentoria para o numero autorizado.",
    });
  }
  if (!integration.authorizedPhone) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Informe um numero autorizado antes de enviar a mentoria para o WhatsApp.",
    });
  }

  const advisorReply = await financialAdvisor.askFinancialAdvisorQuestion({
    userId,
    message: question,
    timezone: integration.timezone,
  });

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });

  const thread = await whatsappDb.getOrCreateAssistantThread(userId, integration.id, contact.id, {
    lastMessageAt: new Date(),
  });

  const text = formatAdvisorPreviewMessage({
    question,
    reply: advisorReply.reply,
    alerts: advisorReply.alerts,
    suggestedActions: mapAdvisorRecommendationsToSuggestedActions(advisorReply.suggestedActions),
    mentorMode: advisorReply.mentorMode,
  });

  try {
    const message = await sendOutgoingMessage({
      integration,
      contactId: contact.id,
      threadId: thread.id,
      phoneNumber: integration.authorizedPhone,
      text,
      detectedIntent: advisorReply.detectedIntent,
      metadata: {
        source: "financial_advisor_preview",
        question,
        decisionAmount: advisorReply.decisionAmount,
        decisionInstallments: advisorReply.decisionInstallments,
      },
    });

    return {
      success: true,
      messageId: message.id,
      reply: advisorReply.reply,
      alerts: advisorReply.alerts,
      detectedIntent: advisorReply.detectedIntent,
      decisionAmount: advisorReply.decisionAmount,
      decisionInstallments: advisorReply.decisionInstallments,
    };
  } catch (error) {
    const message = mapUazapiErrorMessage(error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        message === "Falha ao validar integracao Uazapi."
          ? "Nao foi possivel enviar a orientacao do mentor pela Uazapi."
          : message,
    });
  }
}

export async function askFinancialAdvisorFromDashboard(userId: number, message: string) {
  const advisorReply = await financialAdvisor.askFinancialAdvisorQuestion({
    userId,
    message,
  });

  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || !integration.authorizedPhone) {
    return {
      ...advisorReply,
      persistedToAssistantThread: false,
    };
  }

  try {
    const contact = await whatsappDb.upsertWhatsAppContact(userId, {
      integrationId: integration.id,
      phoneNumber: integration.authorizedPhone,
      displayName: "Titular",
      isAuthorized: true,
      lastSeenAt: new Date(),
    });

    const thread = await whatsappDb.getOrCreateAssistantThread(userId, integration.id, contact.id, {
      lastMessageAt: new Date(),
    });

    await whatsappDb.createWhatsAppMessage({
      userId,
      integrationId: integration.id,
      contactId: contact.id,
      threadId: thread.id,
      providerMessageId: `dashboard-in-${randomUUID()}`,
      direction: "inbound",
      status: "processed",
      textContent: message,
      detectedIntent: advisorReply.detectedIntent,
      rawPayload: JSON.stringify({
        source: "dashboard_chat",
        origin: "app",
        decisionInstallments: advisorReply.decisionInstallments,
      }),
    });

    const suggestedActions = mapAdvisorRecommendationsToSuggestedActions(advisorReply.suggestedActions);

    const run = await whatsappDb.createAssistantRun({
      userId,
      integrationId: integration.id,
      threadId: thread.id,
      triggerType: "direct_message",
      status: advisorReply.requiresConfirmation ? "aguardando_confirmacao" : "executado",
      userMessage: message,
      normalizedIntent: advisorReply.detectedIntent,
      contextPayload: JSON.stringify({
        snapshot: advisorReply.snapshot,
        source: "dashboard_chat",
      }),
      assistantResponse: advisorReply.reply,
      suggestedActions: JSON.stringify(suggestedActions),
      executedActions: advisorReply.requiresConfirmation ? undefined : JSON.stringify([]),
      requiresConfirmation: advisorReply.requiresConfirmation,
      expiresAt: advisorReply.requiresConfirmation
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : undefined,
    });

    await whatsappDb.createWhatsAppMessage({
      userId,
      integrationId: integration.id,
      contactId: contact.id,
      threadId: thread.id,
      providerMessageId: `dashboard-out-${randomUUID()}`,
      direction: "outbound",
      status: "processed",
      textContent: advisorReply.reply,
      detectedIntent: advisorReply.detectedIntent,
      requiresConfirmation: advisorReply.requiresConfirmation,
      rawPayload: JSON.stringify({
        source: "dashboard_chat",
        origin: "app",
        runId: run.id,
        alerts: advisorReply.alerts,
        decisionAmount: advisorReply.decisionAmount,
        decisionInstallments: advisorReply.decisionInstallments,
      }),
    });

    return {
      ...advisorReply,
      persistedToAssistantThread: true,
      threadId: thread.id,
      runId: run.id,
    };
  } catch {
    return {
      ...advisorReply,
      persistedToAssistantThread: false,
    };
  }
}

export async function getWhatsAppSyncStatus(userId: number) {
  const [integration, threads, messages, runs, plans, notifications] = await Promise.all([
    whatsappDb.getWhatsAppIntegration(userId),
    whatsappDb.listAssistantThreads(userId),
    whatsappDb.listWhatsAppMessages(userId),
    whatsappDb.listAssistantRuns(userId),
    whatsappDb.listFinancialPlans(userId),
    whatsappDb.listNotificationEvents(userId),
  ]);

  return {
    integration: integration
      ? {
          enabled: integration.enabled,
          lastConnectionStatus: integration.lastConnectionStatus,
          lastWebhookReceivedAt: integration.lastWebhookReceivedAt,
          lastMessageReceivedAt: integration.lastMessageReceivedAt,
          lastMessageSentAt: integration.lastMessageSentAt,
        }
      : null,
    totals: {
      threads: threads.length,
      messages: messages.length,
      pendingConfirmations: runs.filter(run => run.status === "aguardando_confirmacao").length,
      plans: plans.length,
      notifications: notifications.length,
    },
  };
}

export async function listAssistantInbox(userId: number) {
  const [threads, messages, runs] = await Promise.all([
    whatsappDb.listAssistantThreads(userId),
    whatsappDb.listWhatsAppMessages(userId),
    whatsappDb.listAssistantRuns(userId),
  ]);

  return {
    threads: threads.map(thread => ({
      ...thread,
      latestMessage: messages.find(message => message.threadId === thread.id) ?? null,
      pendingRun:
        runs.find(run => run.threadId === thread.id && run.status === "aguardando_confirmacao") ?? null,
    })),
    messages,
    runs,
  };
}

export async function listAssistantRuns(userId: number) {
  return whatsappDb.listAssistantRuns(userId);
}

export async function getAssistantOperationsSummary(userId: number) {
  const [integration, events, runs] = await Promise.all([
    whatsappDb.getWhatsAppIntegration(userId),
    whatsappDb.listNotificationEvents(userId),
    whatsappDb.listAssistantRuns(userId),
  ]);

  const failedEvents = events.filter(
    event => event.status === "falhou" || String(event.lastError ?? "").trim().length > 0
  );
  const failedRuns = runs.filter(
    run => run.status === "falhou" || String(run.errorMessage ?? "").trim().length > 0
  );
  const pendingRuns = runs.filter(
    run => run.status === "aguardando_confirmacao" || run.status === "recebido" || run.status === "analisado"
  );

  const findLatestEvent = (type: string) => events.find(event => event.type === type) ?? null;
  const latestDaily = findLatestEvent("daily_digest");
  const latestMonthStart = findLatestEvent("month_start");
  const latestMonthEnd = findLatestEvent("month_end");

  const operationalStatus =
    !integration || !integration.enabled
      ? "attention"
      : integration.lastConnectionStatus === "erro" ||
          failedEvents.length > 0 ||
          failedRuns.length > 0
        ? "critical"
        : integration.lastConnectionStatus === "sincronizado"
          ? "healthy"
          : "attention";

  const criticalAlerts = [
    integration?.lastConnectionStatus === "erro"
      ? integration.lastConnectionMessage || "Conexao do WhatsApp com erro."
      : null,
    failedEvents[0]?.lastError || null,
    failedRuns[0]?.errorMessage || null,
  ].filter((value): value is string => Boolean(value));

  return {
    operationalStatus,
    integration: integration
      ? {
          enabled: integration.enabled,
          lastConnectionStatus: integration.lastConnectionStatus,
          lastConnectionMessage: integration.lastConnectionMessage,
          lastConnectionCheckedAt: integration.lastConnectionCheckedAt,
          lastWebhookReceivedAt: integration.lastWebhookReceivedAt,
          lastMessageReceivedAt: integration.lastMessageReceivedAt,
          lastMessageSentAt: integration.lastMessageSentAt,
          automationHour: integration.automationHour,
          timezone: integration.timezone,
        }
      : null,
    counts: {
      totalRuns: runs.length,
      failedRuns: failedRuns.length,
      pendingRuns: pendingRuns.length,
      totalEvents: events.length,
      failedEvents: failedEvents.length,
    },
    latest: {
      dailyDigest: latestDaily,
      monthStart: latestMonthStart,
      monthEnd: latestMonthEnd,
      lastRun: runs[0] ?? null,
      lastFailedRun: failedRuns[0] ?? null,
      lastFailedEvent: failedEvents[0] ?? null,
    },
    criticalAlerts,
  };
}

export async function confirmAssistantRunFromApp(userId: number, runId: number) {
  const pendingRun = await whatsappDb.getAssistantRunById(userId, runId);
  if (!pendingRun) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Confirmacao pendente nao encontrada." });
  }
  if (pendingRun.status !== "aguardando_confirmacao") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Essa confirmacao ja foi tratada e nao pode mais ser executada.",
    });
  }

  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || !integration.authorizedPhone) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Configure o numero autorizado do WhatsApp para concluir esse fluxo no app.",
    });
  }

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(userId, integration.id, contact.id, {
    lastMessageAt: new Date(),
  });

  await whatsappDb.createWhatsAppMessage({
    userId,
    integrationId: integration.id,
    contactId: contact.id,
    threadId: thread.id,
    providerMessageId: `dashboard-confirm-${randomUUID()}`,
    direction: "inbound",
    status: "processed",
    textContent: "CONFIRMAR pelo painel",
    detectedIntent: pendingRun.normalizedIntent,
    rawPayload: JSON.stringify({
      source: "dashboard_confirmation",
      origin: "app",
      action: "confirm",
      runId: pendingRun.id,
    }),
  });

  if (pendingRun.normalizedIntent === "monthly_plan_request") {
    const plan = await financialAdvisor.generateFinancialAdvisorMonthlyPlan({
      userId: integration.userId,
      integrationId: integration.id,
      threadId: thread.id,
      timezone: integration.timezone,
      confirmed: true,
    });

    await whatsappDb.updateAssistantRun(pendingRun.id, {
      status: "executado",
      confirmedAt: new Date(),
      executedActions: JSON.stringify(plan.actions),
      assistantResponse: plan.messageToUser,
    });

    await whatsappDb.createWhatsAppMessage({
      userId,
      integrationId: integration.id,
      contactId: contact.id,
      threadId: thread.id,
      providerMessageId: `dashboard-confirmed-${randomUUID()}`,
      direction: "outbound",
      status: "processed",
      textContent: `${plan.messageToUser}\n\nResumo: ${plan.plan.summary}`,
      detectedIntent: "monthly_plan_request",
      rawPayload: JSON.stringify({
        source: "dashboard_confirmation",
        origin: "app",
        action: "confirmed",
        runId: pendingRun.id,
        planId: plan.plan.id,
      }),
    });

    return {
      success: true,
      runId: pendingRun.id,
      planId: plan.plan.id,
      summary: plan.plan.summary,
    };
  }

  await whatsappDb.updateAssistantRun(pendingRun.id, {
    status: "executado",
    confirmedAt: new Date(),
    executedActions: JSON.stringify([{ type: "confirmed_in_app" }]),
  });

  await whatsappDb.createWhatsAppMessage({
    userId,
    integrationId: integration.id,
    contactId: contact.id,
    threadId: thread.id,
    providerMessageId: `dashboard-confirmed-${randomUUID()}`,
    direction: "outbound",
    status: "processed",
    textContent: "Confirmacao registrada no painel. Vou seguir com a execucao daqui.",
    detectedIntent: pendingRun.normalizedIntent,
    rawPayload: JSON.stringify({
      source: "dashboard_confirmation",
      origin: "app",
      action: "confirmed",
      runId: pendingRun.id,
    }),
  });

  return {
    success: true,
    runId: pendingRun.id,
    summary: "Confirmacao registrada no painel.",
  };
}

export async function snoozeAssistantRunFromApp(userId: number, runId: number) {
  const pendingRun = await whatsappDb.getAssistantRunById(userId, runId);
  if (!pendingRun) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Confirmacao pendente nao encontrada." });
  }
  if (pendingRun.status !== "aguardando_confirmacao") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Essa confirmacao ja foi tratada e nao pode mais ser adiada.",
    });
  }

  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || !integration.authorizedPhone) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Configure o numero autorizado do WhatsApp para acompanhar esse fluxo no app.",
    });
  }

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(userId, integration.id, contact.id, {
    lastMessageAt: new Date(),
  });

  await whatsappDb.updateAssistantRun(pendingRun.id, {
    status: "descartado",
    executedActions: JSON.stringify([{ type: "snoozed_in_app" }]),
  });

  await whatsappDb.createWhatsAppMessage({
    userId,
    integrationId: integration.id,
    contactId: contact.id,
    threadId: thread.id,
    providerMessageId: `dashboard-snooze-${randomUUID()}`,
    direction: "inbound",
    status: "processed",
    textContent: "ADIAR pelo painel",
    detectedIntent: pendingRun.normalizedIntent,
    rawPayload: JSON.stringify({
      source: "dashboard_confirmation",
      origin: "app",
      action: "snooze",
      runId: pendingRun.id,
    }),
  });

  await whatsappDb.createWhatsAppMessage({
    userId,
    integrationId: integration.id,
    contactId: contact.id,
    threadId: thread.id,
    providerMessageId: `dashboard-snoozed-${randomUUID()}`,
    direction: "outbound",
    status: "processed",
    textContent: "Perfeito. A confirmacao foi adiada no painel e sigo monitorando daqui.",
    detectedIntent: pendingRun.normalizedIntent,
    rawPayload: JSON.stringify({
      source: "dashboard_confirmation",
      origin: "app",
      action: "snoozed",
      runId: pendingRun.id,
    }),
  });

  return {
    success: true,
    runId: pendingRun.id,
  };
}

export async function listNotificationEvents(userId: number) {
  return whatsappDb.listNotificationEvents(userId);
}

export async function dismissNotificationEvent(userId: number, eventId: number) {
  const event = await whatsappDb.getNotificationEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alerta nao encontrado." });
  }

  await whatsappDb.updateNotificationEvent(eventId, userId, {
    status: "descartado",
    snoozedUntil: null,
  });

  return { success: true, eventId };
}

export async function listAssistantPlans(userId: number) {
  const plans = await whatsappDb.listFinancialPlans(userId);
  const actions = await whatsappDb.listFinancialPlanActions(userId);
  return plans.map(plan => ({
    ...plan,
    actions: actions.filter(action => action.planId === plan.id),
  }));
}

export async function getCurrentAssistantPlan(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  const now = getPartsInTimeZone(new Date(), integration?.timezone || DEFAULT_TIMEZONE);
  const plan = await whatsappDb.getFinancialPlanByPeriod(userId, now.month, now.year);
  if (!plan) return null;
  const actions = await whatsappDb.listFinancialPlanActions(userId, plan.id);
  return { ...plan, actions };
}

export async function confirmAssistantPlanAction(userId: number, actionId: number) {
  return financialAdvisor.confirmFinancialAdvisorAction(userId, actionId);
}

export async function snoozeNotificationAlert(userId: number, eventId: number, hours = 24) {
  const event = await whatsappDb.getNotificationEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alerta nao encontrado." });
  }

  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  await whatsappDb.updateNotificationEvent(eventId, userId, {
    status: "adiado",
    snoozedUntil,
  });
  return { success: true, snoozedUntil };
}

async function processConfirmation(params: {
  integration: NonNullable<Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>>;
  contact: Awaited<ReturnType<typeof whatsappDb.upsertWhatsAppContact>>;
  thread: Awaited<ReturnType<typeof whatsappDb.getOrCreateAssistantThread>>;
  pendingRun: NonNullable<Awaited<ReturnType<typeof whatsappDb.getLatestPendingAssistantRun>>>;
}) {
  const { integration, contact, thread, pendingRun } = params;
  const plan = await financialAdvisor.generateFinancialAdvisorMonthlyPlan({
    userId: integration.userId,
    integrationId: integration.id,
    threadId: thread.id,
    timezone: integration.timezone,
    confirmed: true,
  });

  await whatsappDb.updateAssistantRun(pendingRun.id, {
    status: "executado",
    confirmedAt: new Date(),
    executedActions: JSON.stringify(plan.actions),
    assistantResponse: plan.messageToUser,
  });

  const outbound = await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: `${plan.messageToUser}\n\nResumo: ${plan.plan.summary}`,
    detectedIntent: "monthly_plan_request",
  });

  await createNotification({
    integrationId: integration.id,
    userId: integration.userId,
    relatedRunId: pendingRun.id,
    relatedPlanId: plan.plan.id,
    relatedMessageId: outbound.id,
    type: "monthly_plan_confirmed",
    scope: "plan",
    title: "Plano mensal confirmado",
    messageBody: plan.plan.summary,
    dedupeKey: `plan:${integration.userId}:${plan.snapshot.year}-${plan.snapshot.month}`,
    status: "enviado",
  });

  return { financialPlan: plan.plan, actions: plan.actions };
}

async function processSnooze(params: {
  integration: NonNullable<Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>>;
  contact: Awaited<ReturnType<typeof whatsappDb.upsertWhatsAppContact>>;
  thread: Awaited<ReturnType<typeof whatsappDb.getOrCreateAssistantThread>>;
  pendingRun: NonNullable<Awaited<ReturnType<typeof whatsappDb.getLatestPendingAssistantRun>>>;
}) {
  const { integration, contact, thread, pendingRun } = params;
  await whatsappDb.updateAssistantRun(pendingRun.id, {
    status: "descartado",
    executedActions: JSON.stringify([{ type: "snoozed" }]),
  });

  await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: "Perfeito. Vou adiar essa acao e sigo monitorando seu financeiro daqui.",
    detectedIntent: pendingRun.normalizedIntent,
  });

  return { success: true };
}

export async function handleUazapiWebhook(payload: AnyRecord) {
  const messages = extractUazapiMessages(payload);
  if (messages.length === 0) {
    return { success: true, processed: 0 };
  }

  let processed = 0;
  for (const incoming of messages) {
    const integration =
      (incoming.instanceId
        ? await whatsappDb.getWhatsAppIntegrationByInstanceId(incoming.instanceId)
        : undefined) ??
      (incoming.instanceToken
        ? await whatsappDb.getWhatsAppIntegrationByApiToken(incoming.instanceToken)
        : undefined);
    if (!integration || !integration.enabled) {
      continue;
    }

    await whatsappDb.touchWhatsAppWebhook(integration.id);

    const isAuthorized = normalizeWhatsAppPhone(integration.authorizedPhone) === incoming.phoneNumber;
    const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
      integrationId: integration.id,
      phoneNumber: incoming.phoneNumber,
      displayName: incoming.displayName,
      isAuthorized,
      lastSeenAt: new Date(),
    });
    const thread = await whatsappDb.getOrCreateAssistantThread(integration.userId, integration.id, contact.id, {
      lastMessageAt: new Date(),
    });

    await whatsappDb.createWhatsAppMessage({
      userId: integration.userId,
      integrationId: integration.id,
      contactId: contact.id,
      threadId: thread.id,
      providerMessageId: incoming.providerMessageId,
      direction: "inbound",
      status: isAuthorized ? "received" : "ignored",
      textContent: incoming.text,
      rawPayload: JSON.stringify(incoming.rawPayload),
    });
    await whatsappDb.touchWhatsAppInbound(integration.id);

    if (!isAuthorized) {
      await sendOutgoingMessage({
        integration,
        contactId: contact.id,
        threadId: thread.id,
        phoneNumber: contact.phoneNumber,
        text: "Este numero nao esta autorizado para usar o assistente financeiro.",
      }).catch(() => null);
      continue;
    }

    const pendingRun = await whatsappDb.getLatestPendingAssistantRun(integration.userId, thread.id);
    if (pendingRun && isConfirmationMessage(incoming.text)) {
      await processConfirmation({ integration, contact, thread, pendingRun });
      processed += 1;
      continue;
    }

    if (pendingRun && isSnoozeMessage(incoming.text)) {
      await processSnooze({ integration, contact, thread, pendingRun });
      processed += 1;
      continue;
    }

    const intent = detectFinancialAssistantIntent(incoming.text);
    const decisionAmount = extractDecisionAmount(incoming.text);
    const decisionInstallments = extractInstallmentCount(incoming.text);
    const context = await buildFinancialContext(integration.userId, integration.timezone);

    if (intent === "monthly_plan_request") {
      const preview = await financialAdvisor.buildFinancialAdvisorAssistantReply({
        intent,
        userId: integration.userId,
        timezone: integration.timezone,
      });
      const previewActions = mapAdvisorRecommendationsToSuggestedActions(preview.suggestedActions);
      const run = await whatsappDb.createAssistantRun({
        userId: integration.userId,
        integrationId: integration.id,
        threadId: thread.id,
        triggerType: "direct_message",
        status: "aguardando_confirmacao",
        userMessage: incoming.text,
        normalizedIntent: intent,
        contextPayload: JSON.stringify({ snapshot: preview.snapshot }),
        assistantResponse: preview.reply,
        suggestedActions: JSON.stringify(previewActions),
        requiresConfirmation: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await sendOutgoingMessage({
        integration,
        contactId: contact.id,
        threadId: thread.id,
        phoneNumber: contact.phoneNumber,
        text: preview.reply,
        detectedIntent: intent,
        requiresConfirmation: true,
      });

      await whatsappDb.updateAssistantRun(run.id, { status: "analisado" });
      await whatsappDb.updateAssistantRun(run.id, { status: "aguardando_confirmacao" });
      processed += 1;
      continue;
    }

    const useAdvisorReply = isAdvisorIntent(intent);

    const advisorReply = useAdvisorReply
      ? await financialAdvisor.buildFinancialAdvisorAssistantReply({
          intent,
          userId: integration.userId,
          timezone: integration.timezone,
          decisionAmount,
          decisionInstallments,
          messageText: incoming.text,
        })
      : null;

    const reply = advisorReply
      ? {
          reply: advisorReply.reply,
          summary: advisorReply.summary,
          alerts: advisorReply.alerts,
          suggestedActions: mapAdvisorRecommendationsToSuggestedActions(advisorReply.suggestedActions),
          mentorMode: advisorReply.mentorMode,
        }
      : await generateAssistantReply(intent, incoming.text, context);

    const run = await whatsappDb.createAssistantRun({
      userId: integration.userId,
      integrationId: integration.id,
      threadId: thread.id,
      triggerType: "direct_message",
      status: "executado",
      userMessage: incoming.text,
      normalizedIntent: intent,
      contextPayload: advisorReply ? JSON.stringify({ snapshot: advisorReply.snapshot }) : summarizeContext(context),
      assistantResponse: reply.reply,
      suggestedActions: JSON.stringify(reply.suggestedActions),
      executedActions: JSON.stringify([]),
      requiresConfirmation: false,
    });

    const outbound = await sendOutgoingMessage({
      integration,
      contactId: contact.id,
      threadId: thread.id,
      phoneNumber: contact.phoneNumber,
      text: advisorReply
        ? formatMentorChannelMessage({
            reply: reply.reply,
            mentorMode: reply.mentorMode,
            alerts: reply.alerts,
            suggestedActions: reply.suggestedActions,
          })
        : reply.reply,
      detectedIntent: intent,
    });

    await createNotification({
      integrationId: integration.id,
      userId: integration.userId,
      relatedRunId: run.id,
      relatedMessageId: outbound.id,
      type: "assistant_reply",
      scope: "conversation",
      title: `Resposta ${intent}`,
      messageBody: reply.summary,
      dedupeKey: `reply:${integration.userId}:${incoming.providerMessageId}`,
      status: "enviado",
    });

    processed += 1;
  }

  return { success: true, processed };
}

async function runDailyDigestForIntegration(
  integration: NonNullable<Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>>
) {
  const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(integration.userId, integration.id, contact.id, {
    lastMessageAt: new Date(),
  });
  const digest = await financialAdvisor.getFinancialAdvisorDailyDigest({
    userId: integration.userId,
    integrationId: integration.id,
    timezone: integration.timezone,
  });
  const digestMemory = await financialAdvisor.getFinancialAdvisorMemory(integration.userId, {
    currentSnapshot: digest.snapshot,
  });
  const digestMentorMode = financialAdvisor.getFinancialAdvisorMentorMode(digestMemory);
  const run = await whatsappDb.createAssistantRun({
    userId: integration.userId,
    integrationId: integration.id,
    threadId: thread.id,
    triggerType: "daily_digest",
    status: "executado",
    normalizedIntent: "upcoming_bills",
    contextPayload: JSON.stringify({ snapshot: digest.snapshot }),
    assistantResponse: digest.message,
    suggestedActions: JSON.stringify(digest.actions),
    executedActions: JSON.stringify([]),
    requiresConfirmation: false,
  });
  const message = await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: formatMentorChannelMessage({
      reply: digest.message,
      mentorMode: digestMentorMode,
      suggestedActions: mapPlanActionsToSuggestedActions(digest.actions),
      intro: "Bom dia.",
    }),
    detectedIntent: "upcoming_bills",
  });
  await createNotification({
    integrationId: integration.id,
    userId: integration.userId,
    relatedRunId: run.id,
    relatedMessageId: message.id,
    type: "daily_digest",
    scope: "automation",
    title: "Resumo diario enviado",
    messageBody: digest.message,
    dedupeKey: `daily:${integration.userId}:${digest.snapshot.generatedAt}`,
    status: "enviado",
  });
}

async function runMonthStartForIntegration(
  integration: NonNullable<Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>>
) {
  const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(integration.userId, integration.id, contact.id);
  const preview = await financialAdvisor.buildFinancialAdvisorAssistantReply({
    intent: "monthly_plan_request",
    userId: integration.userId,
    timezone: integration.timezone,
  });
  const previewActions = mapAdvisorRecommendationsToSuggestedActions(preview.suggestedActions);
  const run = await whatsappDb.createAssistantRun({
    userId: integration.userId,
    integrationId: integration.id,
    threadId: thread.id,
    triggerType: "month_start",
    status: "aguardando_confirmacao",
    normalizedIntent: "monthly_plan_request",
    contextPayload: JSON.stringify({ snapshot: preview.snapshot }),
    assistantResponse: preview.reply,
    suggestedActions: JSON.stringify(previewActions),
    requiresConfirmation: true,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  });
  const message = await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: formatMentorChannelMessage({
      reply: preview.reply,
      mentorMode: preview.mentorMode,
      alerts: preview.alerts,
      suggestedActions: previewActions,
      intro: "Inicio do mes.",
    }),
    detectedIntent: "monthly_plan_request",
    requiresConfirmation: true,
  });
  await createNotification({
    integrationId: integration.id,
    userId: integration.userId,
    relatedRunId: run.id,
    relatedMessageId: message.id,
    type: "month_start",
    scope: "automation",
    title: "Plano mensal aguardando confirmacao",
    messageBody: preview.summary,
    dedupeKey: `month-start:${integration.userId}:${preview.snapshot.year}-${preview.snapshot.month}`,
    status: "enviado",
  });
}

async function runMonthEndForIntegration(
  integration: NonNullable<Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>>
) {
  const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(integration.userId, integration.id, contact.id);
  const close = await financialAdvisor.getFinancialAdvisorMonthClose({
    userId: integration.userId,
    integrationId: integration.id,
    timezone: integration.timezone,
  });
  const closeMemory = await financialAdvisor.getFinancialAdvisorMemory(integration.userId, {
    currentSnapshot: close.snapshot,
  });
  const closeMentorMode = financialAdvisor.getFinancialAdvisorMentorMode(closeMemory);
  const run = await whatsappDb.createAssistantRun({
    userId: integration.userId,
    integrationId: integration.id,
    threadId: thread.id,
    triggerType: "month_end",
    status: "executado",
    normalizedIntent: "consolidated_analysis",
    contextPayload: JSON.stringify({ snapshot: close.snapshot }),
    assistantResponse: close.message,
    suggestedActions: JSON.stringify(close.snapshot.topRecommendations),
    executedActions: JSON.stringify([]),
    requiresConfirmation: false,
  });
  const message = await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: formatMentorChannelMessage({
      reply: close.message,
      mentorMode: closeMentorMode,
      suggestedActions: mapAdvisorRecommendationsToSuggestedActions(close.snapshot.topRecommendations),
      intro: "Fechamento do mes.",
    }),
    detectedIntent: "consolidated_analysis",
  });
  await createNotification({
    integrationId: integration.id,
    userId: integration.userId,
    relatedRunId: run.id,
    relatedMessageId: message.id,
    type: "month_end",
    scope: "automation",
    title: "Fechamento mensal enviado",
    messageBody: close.message,
    dedupeKey: `month-end:${integration.userId}:${close.snapshot.year}-${close.snapshot.month}`,
    status: "enviado",
  });
}

export async function runFinancialDailyCron() {
  const integrations = await whatsappDb.listEnabledWhatsAppIntegrations();
  let processed = 0;
  for (const integration of integrations) {
    const now = getPartsInTimeZone(new Date(), integration.timezone || DEFAULT_TIMEZONE);
    if ((integration.automationHour ?? 8) !== now.hour) {
      continue;
    }
    const existing = await whatsappDb.getNotificationEventByDedupeKey(
      integration.id,
      `daily:${integration.userId}:${now.iso}`
    );
    if (existing) continue;
    await runDailyDigestForIntegration(integration);
    processed += 1;
  }
  return { success: true, processed };
}

export async function runFinancialMonthStartCron() {
  const integrations = await whatsappDb.listEnabledWhatsAppIntegrations();
  let processed = 0;
  for (const integration of integrations) {
    const now = getPartsInTimeZone(new Date(), integration.timezone || DEFAULT_TIMEZONE);
    if (now.day !== 1) continue;
    const existing = await whatsappDb.getNotificationEventByDedupeKey(
      integration.id,
      `month-start:${integration.userId}:${now.year}-${now.month}`
    );
    if (existing) continue;
    await runMonthStartForIntegration(integration);
    processed += 1;
  }
  return { success: true, processed };
}

export async function runFinancialMonthEndCron() {
  const integrations = await whatsappDb.listEnabledWhatsAppIntegrations();
  let processed = 0;
  for (const integration of integrations) {
    const now = getPartsInTimeZone(new Date(), integration.timezone || DEFAULT_TIMEZONE);
    const tomorrow = getPartsInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), integration.timezone || DEFAULT_TIMEZONE);
    if (tomorrow.month === now.month) continue;
    const existing = await whatsappDb.getNotificationEventByDedupeKey(
      integration.id,
      `month-end:${integration.userId}:${now.year}-${now.month}`
    );
    if (existing) continue;
    await runMonthEndForIntegration(integration);
    processed += 1;
  }
  return { success: true, processed };
}

export async function sendImmediateFinancialAlert(params: {
  userId: number;
  title: string;
  message: string;
  type: string;
  dedupeKey: string;
}) {
  const integration = await whatsappDb.getWhatsAppIntegration(params.userId);
  if (!integration || !integration.enabled) return { success: false, skipped: true };

  const existing = await whatsappDb.getNotificationEventByDedupeKey(integration.id, params.dedupeKey);
  if (existing) return { success: true, deduped: true };

  const contact = await whatsappDb.upsertWhatsAppContact(params.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(params.userId, integration.id, contact.id);
  const message = await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: `${params.title}\n${params.message}`,
    detectedIntent: "consolidated_analysis",
  });
  await createNotification({
    integrationId: integration.id,
    userId: params.userId,
    relatedMessageId: message.id,
    type: params.type,
    scope: "alert",
    title: params.title,
    messageBody: params.message,
    dedupeKey: params.dedupeKey,
    status: "enviado",
  });
  return { success: true };
}
