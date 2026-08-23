import { createHash, randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import * as whatsappDb from "./db/whatsapp";
import * as canonicalDb from "./db/financial-core";
import * as financialAdvisor from "./financial-advisor";
import {
  detectFinancialAssistantIntent,
  extractDecisionAmount,
  extractInstallmentCount,
  isAdvisorIntent,
  type FinancialAssistantIntent,
} from "./_core/financialAssistantIntent";
import { invokeLLM, type Message } from "./_core/llm";
import {
  UazapiClient,
  UazapiRequestError,
  normalizeUazapiBaseUrl,
  normalizeWhatsAppPhone,
} from "./_core/uazapi";
import {
  BaileysGatewayClient,
  BaileysGatewayError,
  normalizeBaileysGatewayUrl,
} from "./_core/baileysGateway";
import { ENV } from "./_core/env";
import { isStrongSecret } from "./_core/secrets";
import {
  forwardFinancialMessageToN8n,
  isN8nAgentForwardingConfigured,
} from "./_core/n8nAgentClient";

type AnyRecord = Record<string, any>;
type WhatsAppProvider = "uazapi" | "baileys";

type AssistantIntent = FinancialAssistantIntent;

function normalizePreferenceMessage(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isNotificationOptOutMessage(value: string) {
  const normalized = normalizePreferenceMessage(value);
  return [
    "parar mensagens",
    "pare as mensagens",
    "pare mensagens",
    "nao quero receber mensagens",
    "cancelar notificacoes",
    "desativar notificacoes",
    "stop",
  ].includes(normalized);
}

function isNotificationOptInMessage(value: string) {
  const normalized = normalizePreferenceMessage(value);
  return [
    "voltar mensagens",
    "reativar mensagens",
    "ativar notificacoes",
    "quero receber mensagens",
    "retomar notificacoes",
  ].includes(normalized);
}

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
  receivables: AnyRecord[];
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

function normalizeTimeZone(value?: string) {
  const timeZone = value?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Informe um fuso horario IANA valido.",
    });
  }
}

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

function getBaileysGatewayClient(integration: {
  apiBaseUrl: string;
  apiToken: string;
}) {
  return new BaileysGatewayClient({
    apiBaseUrl: ENV.baileysGatewayUrl || integration.apiBaseUrl,
    apiToken: ENV.baileysGatewayApiKey || integration.apiToken,
  });
}

function getWebhookUrl(
  origin?: string | null,
  provider: WhatsAppProvider = "uazapi"
) {
  if (!origin || !isStrongSecret(ENV.whatsappWebhookSecret)) return null;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return null;
    }
    const webhookUrl = new URL(
      provider === "baileys"
        ? "/api/whatsapp/baileys/webhook"
        : "/api/whatsapp/uazapi/webhook",
      url.origin
    );
    if (provider === "uazapi") {
      webhookUrl.searchParams.set("secret", ENV.whatsappWebhookSecret);
    }
    return webhookUrl.toString();
  } catch {
    return null;
  }
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
  const parts = [header, `Pergunta: ${params.question}`, params.reply];

  if (params.alerts.length) {
    parts.push(`Alertas:\n- ${params.alerts.join("\n- ")}`);
  }

  const nextActions = params.suggestedActions.slice(0, 3);
  if (nextActions.length) {
    parts.push(
      `Proximas acoes:\n- ${nextActions.map(action => action.title).join("\n- ")}`
    );
  }

  return parts.join("\n\n");
}

function getMentorModeLabel(
  mode?: financialAdvisor.FinancialAdvisorMentorMode
) {
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
    parts.push(
      `Proximas acoes:\n- ${params.suggestedActions
        .slice(0, 3)
        .map(action => action.title)
        .join("\n- ")}`
    );
  }

  return parts.join("\n\n");
}

function mapAdvisorRecommendationsToSuggestedActions(
  recommendations: Awaited<
    ReturnType<typeof financialAdvisor.buildFinancialAdvisorAssistantReply>
  >["suggestedActions"]
): SuggestedAction[] {
  return recommendations.map(recommendation => ({
    actionType: recommendation.kind,
    title: recommendation.title,
    description: recommendation.description,
    priority:
      recommendation.kind === "pay_priority_items" ||
      recommendation.kind === "freeze_discretionary"
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
  )
    .trim()
    .slice(0, 120);
  const instanceToken = String(
    payload?.token ||
      payload?.instance?.token ||
      payload?.data?.token ||
      payload?.data?.instance?.token ||
      ""
  )
    .trim()
    .slice(0, 4_096);

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
      const rawProviderMessageId = String(
        candidate?.key?.id ||
          candidate?.id ||
          candidate?.messageid ||
          inner?.id ||
          inner?.messageid ||
          `payload-${createHash("sha256").update(JSON.stringify(candidate)).digest("hex")}`
      );
      const providerMessageId =
        rawProviderMessageId.length <= 255
          ? rawProviderMessageId
          : `provider-${createHash("sha256").update(rawProviderMessageId).digest("hex")}`;
      const fromMe = Boolean(
        candidate?.key?.fromMe || candidate?.fromMe || inner?.fromMe
      );
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
      const phoneNumber = normalizeWhatsAppPhone(
        remoteJid.split("@")[0] || remoteJid
      ).slice(0, 32);
      const text = String(extractTextMessage(inner)).trim().slice(0, 12_000);
      const rawDisplayName =
        candidate?.pushName ||
        candidate?.notifyName ||
        candidate?.senderName ||
        candidate?.name ||
        inner?.senderName ||
        inner?.name;
      const displayName = rawDisplayName
        ? String(rawDisplayName).slice(0, 255)
        : null;

      if (fromMe || (!instanceId && !instanceToken) || !phoneNumber || !text)
        return null;

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

function extractBaileysMessages(payload: AnyRecord): ExtractedInboundMessage[] {
  const candidates = Array.isArray(payload?.messages)
    ? payload.messages
    : [payload];

  return candidates
    .map((candidate: AnyRecord) => {
      const instanceId = String(
        candidate?.instanceId || payload?.instanceId || ""
      )
        .trim()
        .slice(0, 120);
      const rawProviderMessageId = String(
        candidate?.providerMessageId || candidate?.messageId || ""
      ).trim();
      const providerMessageId =
        rawProviderMessageId.length <= 255
          ? rawProviderMessageId
          : `provider-${createHash("sha256")
              .update(rawProviderMessageId)
              .digest("hex")}`;
      const phoneNumber = normalizeWhatsAppPhone(
        String(candidate?.phoneNumber || "")
      ).slice(0, 32);
      const text = String(candidate?.text || "")
        .trim()
        .slice(0, 12_000);
      const displayName = candidate?.displayName
        ? String(candidate.displayName).slice(0, 255)
        : null;

      if (!instanceId || !providerMessageId || !phoneNumber || !text) {
        return null;
      }
      return {
        instanceId,
        instanceToken: null,
        providerMessageId,
        phoneNumber,
        displayName,
        text,
        rawPayload:
          candidate?.rawPayload && typeof candidate.rawPayload === "object"
            ? candidate.rawPayload
            : { source: "baileys" },
      } satisfies ExtractedInboundMessage;
    })
    .filter(Boolean) as ExtractedInboundMessage[];
}

function mapUazapiErrorMessage(error: unknown) {
  if (!(error instanceof UazapiRequestError)) {
    return error instanceof Error
      ? error.message
      : "Falha ao validar integracao Uazapi.";
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

function mapBaileysErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof BaileysGatewayError || error instanceof Error
      ? error.message
      : "Falha ao acessar o gateway Baileys.";
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("already linked")) {
    return "A sessao do WhatsApp ja esta vinculada.";
  }
  if (
    normalized.includes("not connected") ||
    normalized.includes("not available")
  ) {
    return "O WhatsApp ainda nao esta conectado ao gateway Baileys.";
  }
  if (normalized.includes("wait before requesting")) {
    return "Aguarde alguns segundos antes de gerar outro codigo de vinculacao.";
  }
  if (normalized.includes("e.164") || normalized.includes("country code")) {
    return "Informe o numero com codigo do pais e DDD, somente numeros. Exemplo: 5511999999999.";
  }
  if (normalized.includes("gateway operation failed")) {
    return "O WhatsApp recusou o pareamento por telefone. Reinicie o vinculo e use o QR Code.";
  }
  return rawMessage || "Falha ao acessar o gateway Baileys.";
}

function mapProviderErrorMessage(provider: WhatsAppProvider, error: unknown) {
  return provider === "baileys"
    ? mapBaileysErrorMessage(error)
    : mapUazapiErrorMessage(error);
}

async function buildFinancialContext(
  userId: number,
  timezone = DEFAULT_TIMEZONE
): Promise<FinancialContext> {
  const now = new Date();
  const { month, year, iso } = getPartsInTimeZone(now, timezone);
  const [company, personal, calendar, debts, investments, reserveFunds] =
    await Promise.all([
      db.getCompanyDashboardData(userId, month, year).catch(() => null),
      db.getPersonalDashboardData(userId, month, year).catch(() => null),
      db.getCalendarData(userId, month, year).catch(() => null),
      db.getDebts(userId).catch(() => []),
      db.getInvestments(userId).catch(() => []),
      db.getReserveFunds(userId).catch(() => []),
    ]);

  const receivables = Array.isArray(company?.revenue?.items)
    ? company.revenue.items.slice(0, 25)
    : [];

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
    receivables,
  };
}

function summarizeContext(context: FinancialContext) {
  return JSON.stringify(
    {
      period: {
        month: context.month,
        year: context.year,
        generatedAt: context.generatedAt,
      },
      company: context.company,
      personal: context.personal,
      upcoming: context.calendar,
      debts: context.debts.slice(0, 15),
      investments: context.investments.slice(0, 10),
      reserveFunds: context.reserveFunds.slice(0, 10),
      receivables: context.receivables.slice(0, 15),
    },
    null,
    2
  );
}

function buildFallbackReply(
  intent: AssistantIntent,
  context: FinancialContext
): AssistantReplyPayload {
  const companyNet = Number(
    context.company?.netProfit ?? context.company?.monthlyNet ?? 0
  );
  const personalBalance = Number(
    context.personal?.balance ?? context.personal?.monthlyBalance ?? 0
  );
  const overdueReceivables = context.receivables.filter(item => {
    const status = String(item.status || "").toLowerCase();
    const dueDate = String(item.dueDate || "");
    return (
      status.includes("atras") ||
      (status !== "recebido" &&
        status !== "cancelado" &&
        dueDate < context.generatedAt)
    );
  });
  const upcomingItems = Array.isArray(context.calendar?.items)
    ? context.calendar.items.slice(0, 5)
    : [];

  const replies: Record<AssistantIntent, string> = {
    monthly_plan_request:
      "Posso montar seu plano financeiro do mês com prioridades de caixa, cobranças e ações práticas. Responda CONFIRMAR para eu registrar esse plano no sistema.",
    cash_advice: `Empresa: ${companyNet.toFixed(2)} de resultado estimado. Pessoal: ${personalBalance.toFixed(2)} de saldo estimado. Priorize caixa, contas próximas e cobranças pendentes antes de novos gastos.`,
    company_summary: `A empresa está com resultado estimado de ${companyNet.toFixed(2)} neste mês. Vale focar em recebimentos próximos e controle dos custos variáveis.`,
    personal_summary: `Seu caixa pessoal estimado está em ${personalBalance.toFixed(2)} neste mês. Revise vencimentos desta semana e preserve reserva antes de assumir novos compromissos.`,
    upcoming_bills: upcomingItems.length
      ? `Os próximos vencimentos já mapeados são: ${upcomingItems.map((item: AnyRecord) => item.title || item.description || "item").join(", ")}.`
      : "Não encontrei vencimentos próximos no calendário atual, mas vale revisar as contas fixas e os recebimentos em aberto.",
    overdue_items: overdueReceivables.length
      ? `Existem ${overdueReceivables.length} recebimentos exigindo atenção. Priorize o contato manual com os clientes mais atrasados.`
      : "Não encontrei recebimento vencido agora, mas sigo monitorando qualquer risco de atraso.",
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
    alerts: overdueReceivables.length
      ? [`${overdueReceivables.length} recebimento(s) com risco ou atraso.`]
      : [],
    suggestedActions:
      intent === "monthly_plan_request"
        ? [
            {
              actionType: "create_monthly_plan",
              title: "Gerar plano financeiro do mês",
              description:
                "Criar plano com objetivos, prioridades de caixa e ações concretas.",
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
      alerts: Array.isArray(parsed.alerts)
        ? parsed.alerts.map(String)
        : fallback.alerts,
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.map(action => ({
            actionType: String(action.actionType || "manual_follow_up"),
            title: String(action.title || "Acompanhar item financeiro"),
            description: String(
              action.description || "Verificar o ponto sugerido pela IA."
            ),
            priority:
              action.priority === "alta" || action.priority === "baixa"
                ? action.priority
                : "media",
            dueDate: action.dueDate ? String(action.dueDate) : null,
            requiresConfirmation: Boolean(action.requiresConfirmation),
            metadata:
              typeof action.metadata === "object" && action.metadata
                ? action.metadata
                : undefined,
          }))
        : fallback.suggestedActions,
    };
  } catch {
    return fallback;
  }
}

async function generateMonthlyPlan(
  context: FinancialContext
): Promise<MonthlyPlanPayload> {
  const fallback: MonthlyPlanPayload = {
    summary:
      "Plano mensal gerado com foco em caixa, vencimentos e disciplina financeira.",
    targetBalance: String(
      Number(context.company?.netProfit ?? 0) +
        Number(context.personal?.balance ?? 0)
    ),
    recommendedCashAction:
      "Preservar liquidez, concentrar cobranças abertas e revisar os maiores gastos variáveis antes de novos compromissos.",
    messageToUser:
      "Monteio um plano enxuto para o mês com ações práticas. Ele prioriza caixa, cobranças, vencimentos e proteção da reserva.",
    actions: [
      {
        actionType: "charge_follow_up",
        title: "Cobrar recebimentos abertos",
        description:
          "Revisar os recebimentos abertos e dar prioridade ao contato manual com os mais antigos.",
        priority: "alta",
      },
      {
        actionType: "expense_review",
        title: "Revisar custos variáveis",
        description:
          "Cortar ou adiar gastos variáveis não essenciais desta semana.",
        priority: "media",
      },
      {
        actionType: "reserve_protection",
        title: "Proteger a reserva",
        description:
          "Evitar usar a reserva para despesas previsíveis e acompanhar o saldo projetado.",
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
      recommendedCashAction:
        parsed.recommendedCashAction || fallback.recommendedCashAction,
      messageToUser: parsed.messageToUser || fallback.messageToUser,
      actions:
        Array.isArray(parsed.actions) && parsed.actions.length > 0
          ? parsed.actions
          : fallback.actions,
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
  idempotencyKey?: string;
}) {
  const {
    integration,
    contactId,
    threadId,
    phoneNumber,
    text,
    detectedIntent,
    requiresConfirmation,
    metadata,
    idempotencyKey,
  } = params;

  if (!integration) {
    throw new Error("Integracao WhatsApp nao encontrada.");
  }

  const scope = await canonicalDb.resolveFinancialScope(integration.userId);
  const queuedAt = new Date();
  const queued = await whatsappDb.createWhatsAppOutboxItem({
    ...scope,
    integrationId: integration.id,
    contactId,
    threadId,
    phoneNumber,
    textContent: text,
    detectedIntent: detectedIntent ?? null,
    requiresConfirmation: requiresConfirmation ?? false,
    metadata: metadata ?? null,
    idempotencyKey: idempotencyKey ?? `outbound:${randomUUID()}`,
    status: "pending",
    nextAttemptAt: queuedAt,
  });
  if (queued.item.status === "sent" && queued.item.messageId) {
    const existing = await whatsappDb.getWhatsAppMessageById(
      integration.userId,
      queued.item.messageId
    );
    if (existing) return existing;
  }
  const claimed = await whatsappDb.claimWhatsAppOutboxItem(
    queued.item.id,
    new Date()
  );
  if (!claimed) {
    throw new Error("Mensagem ja esta em processamento na fila WhatsApp");
  }
  return dispatchClaimedWhatsAppOutboxItem(claimed, integration);
}

async function dispatchClaimedWhatsAppOutboxItem(
  item: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.claimWhatsAppOutboxItem>>
  >,
  knownIntegration?: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >
) {
  const integration =
    knownIntegration ??
    (await whatsappDb.getWhatsAppIntegrationById(item.integrationId));
  if (!integration || !integration.enabled) {
    const message = "Integracao WhatsApp indisponivel";
    await whatsappDb.markWhatsAppOutboxFailed(item.id, item.attempts, message);
    throw new Error(message);
  }
  try {
    const response =
      integration.provider === "baileys"
        ? await getBaileysGatewayClient(integration).sendTextMessage(
            item.phoneNumber,
            item.textContent
          )
        : await getUazapiClient(integration).sendTextMessage(
            item.phoneNumber,
            item.textContent
          );
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
      contactId: item.contactId,
      threadId: item.threadId,
      providerMessageId,
      direction: "outbound",
      status: "sent",
      textContent: item.textContent,
      detectedIntent: item.detectedIntent,
      requiresConfirmation: item.requiresConfirmation,
      rawPayload: JSON.stringify({
        metadata: item.metadata,
        providerResponse: responsePayload,
        outboxId: item.id,
      }),
    });
    await whatsappDb.markWhatsAppOutboxSent(item.id, {
      providerMessageId,
      messageId: message.id,
    });
    await whatsappDb.touchWhatsAppOutbound(integration.id);
    return message;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha no envio WhatsApp";
    await whatsappDb.markWhatsAppOutboxFailed(item.id, item.attempts, message);
    throw error;
  }
}

export async function dispatchWhatsAppOutboxQueue(limit = 50) {
  const now = new Date();
  const due = await whatsappDb.listDueWhatsAppOutbox(now, limit);
  let sent = 0;
  let failed = 0;
  for (const candidate of due) {
    const claimed = await whatsappDb.claimWhatsAppOutboxItem(candidate.id, now);
    if (!claimed) continue;
    try {
      await dispatchClaimedWhatsAppOutboxItem(claimed);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { due: due.length, sent, failed };
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
  const existing = await whatsappDb.getNotificationEventByDedupeKey(
    params.integrationId,
    params.dedupeKey
  );
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

export async function getWhatsAppIntegration(
  userId: number,
  origin?: string | null
) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) return null;

  const configuredWebhookUrl = getWebhookUrl(origin, integration.provider);
  const webhookUrl = configuredWebhookUrl
    ? (() => {
        const value = new URL(configuredWebhookUrl);
        value.search = "";
        return value.toString();
      })()
    : null;
  return {
    ...integration,
    apiToken: undefined,
    maskedApiToken: maskSecret(integration.apiToken),
    hasApiToken: Boolean(integration.apiToken),
    webhookUrl,
  };
}

export function getWhatsAppGatewayConfig() {
  return {
    baileysAvailable: Boolean(
      ENV.baileysGatewayUrl && isStrongSecret(ENV.baileysGatewayApiKey)
    ),
    baileysGatewayUrl: ENV.baileysGatewayUrl || null,
    defaultSessionId: "financepro",
  };
}

export async function upsertWhatsAppIntegration(
  userId: number,
  input: {
    provider?: WhatsAppProvider;
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
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Informe um numero autorizado valido.",
    });
  }

  const existing = await whatsappDb.getWhatsAppIntegration(userId);
  const provider = input.provider ?? existing?.provider ?? "uazapi";
  const apiToken =
    input.apiToken?.trim() ||
    (existing?.provider === provider ? existing.apiToken : "") ||
    (provider === "baileys" && isStrongSecret(ENV.baileysGatewayApiKey)
      ? "managed-by-railway"
      : "");
  if (!apiToken) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        provider === "baileys"
          ? "Informe a chave de API do gateway Baileys."
          : "Informe o token da API Uazapi.",
    });
  }

  let apiBaseUrl: string;
  try {
    apiBaseUrl =
      provider === "baileys"
        ? normalizeBaileysGatewayUrl(input.apiBaseUrl)
        : normalizeUazapiBaseUrl(input.apiBaseUrl);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : provider === "baileys"
            ? "URL do gateway Baileys invalida."
            : "URL base da Uazapi invalida.",
    });
  }

  const record = await whatsappDb.upsertWhatsAppIntegration(userId, {
    provider,
    instanceId: input.instanceId.trim(),
    apiBaseUrl,
    apiToken,
    authorizedPhone: normalizedPhone,
    enabled: input.enabled ?? true,
    automationHour: input.automationHour ?? 8,
    timezone: normalizeTimeZone(input.timezone),
    webhookUrl: getWebhookUrl(origin, provider),
  });

  return getWhatsAppIntegration(userId, origin) ?? record;
}

export async function testWhatsAppConnection(
  userId: number,
  origin?: string | null,
  override?: {
    provider?: WhatsAppProvider;
    instanceId?: string;
    apiBaseUrl?: string;
    apiToken?: string;
  }
) {
  const savedIntegration = await whatsappDb.getWhatsAppIntegration(userId);
  const provider = override?.provider ?? savedIntegration?.provider ?? "uazapi";
  const integration = savedIntegration
    ? {
        ...savedIntegration,
        provider,
        instanceId: override?.instanceId?.trim() || savedIntegration.instanceId,
        apiBaseUrl: override?.apiBaseUrl?.trim() || savedIntegration.apiBaseUrl,
        apiToken:
          override?.apiToken?.trim() ||
          (provider === savedIntegration.provider
            ? savedIntegration.apiToken
            : ""),
      }
    : override?.instanceId?.trim() &&
        override?.apiBaseUrl?.trim() &&
        (override?.apiToken?.trim() ||
          (provider === "baileys" && isStrongSecret(ENV.baileysGatewayApiKey)))
      ? {
          id: 0,
          userId,
          provider,
          instanceId: override.instanceId.trim(),
          apiBaseUrl: override.apiBaseUrl.trim(),
          apiToken: override.apiToken?.trim() || "managed-by-railway",
          authorizedPhone: "",
          enabled: true,
          automationHour: 8,
          timezone: DEFAULT_TIMEZONE,
          webhookUrl: getWebhookUrl(origin, provider),
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
      message:
        "Preencha e salve a integracao do WhatsApp, ou informe instanceId, URL e token para testar.",
    });
  }

  if (
    !integration.instanceId ||
    !integration.apiBaseUrl ||
    (!integration.apiToken &&
      !(
        integration.provider === "baileys" &&
        isStrongSecret(ENV.baileysGatewayApiKey)
      ))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Informe instanceId, API base URL e API token validos para testar a conexao.",
    });
  }

  try {
    if (integration.provider === "baileys") {
      const client = getBaileysGatewayClient(integration);
      const status = await client.getStatus();
      const connectionStatus = status.ready
        ? "sincronizado"
        : "aguardando_vinculo";
      const connectionMessage = status.ready
        ? "Gateway Baileys conectado ao WhatsApp."
        : "Gateway Baileys online e aguardando o codigo de vinculacao.";
      if (savedIntegration) {
        await whatsappDb.markWhatsAppConnection(
          savedIntegration.id,
          connectionStatus,
          connectionMessage
        );
      }
      return {
        success: true,
        instanceId: status.sessionId || integration.instanceId,
        message: connectionMessage,
        status,
        webhookConfigured: true,
      };
    }

    const client = getUazapiClient(integration);
    const status = await client.getInstanceStatus();
    const connectedInstanceId = String(
      (status as AnyRecord)?.instance?.id ||
        (status as AnyRecord)?.instanceId ||
        ""
    ).trim();
    const webhookUrl = getWebhookUrl(origin, "uazapi");
    let webhookConfigured = false;

    if (webhookUrl) {
      await client.configureWebhook(webhookUrl);
      webhookConfigured = true;
    }

    if (savedIntegration) {
      await whatsappDb.markWhatsAppConnection(
        savedIntegration.id,
        "sincronizado",
        String(
          status?.message ||
            status?.status ||
            "Conexao com a Uazapi validada com sucesso."
        )
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
    const message = mapProviderErrorMessage(integration.provider, error);
    if (savedIntegration) {
      await whatsappDb.markWhatsAppConnection(
        savedIntegration.id,
        "erro",
        message
      );
    }
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

export async function requestBaileysPairingCode(
  userId: number,
  pairingPhone: string
) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || integration.provider !== "baileys") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Salve a integracao com o provedor Baileys antes de vincular.",
    });
  }

  try {
    const response =
      await getBaileysGatewayClient(integration).requestPairingCode(
        pairingPhone
      );
    await whatsappDb.markWhatsAppConnection(
      integration.id,
      "aguardando_vinculo",
      response.fallbackToQr
        ? response.message || "Escaneie o QR Code para vincular o WhatsApp."
        : "Codigo gerado. Digite-o em Aparelhos conectados no WhatsApp."
    );
    return {
      success: true,
      pairingCode: response.pairingCode,
      fallbackToQr: response.fallbackToQr,
      message: response.message,
    };
  } catch (error) {
    const message = mapBaileysErrorMessage(error);
    await whatsappDb.markWhatsAppConnection(integration.id, "erro", message);
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

export async function getBaileysPairingStatus(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || integration.provider !== "baileys") return null;

  try {
    return await getBaileysGatewayClient(integration).getStatus();
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: mapBaileysErrorMessage(error),
    });
  }
}

export async function resetBaileysPairingSession(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || integration.provider !== "baileys") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Salve a integracao com o provedor Baileys antes de reiniciar.",
    });
  }

  try {
    const response =
      await getBaileysGatewayClient(integration).resetUnregisteredSession();
    await whatsappDb.markWhatsAppConnection(
      integration.id,
      "aguardando_vinculo",
      "Pareamento reiniciado. Escaneie o QR Code ou gere um novo codigo."
    );
    return response;
  } catch (error) {
    const message = mapBaileysErrorMessage(error);
    await whatsappDb.markWhatsAppConnection(integration.id, "erro", message);
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

export async function sendWhatsAppTestMessage(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Integracao do WhatsApp nao encontrada.",
    });
  }

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });

  const thread = await whatsappDb.getOrCreateAssistantThread(
    userId,
    integration.id,
    contact.id,
    {
      lastMessageAt: new Date(),
    }
  );

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
    const message = mapProviderErrorMessage(integration.provider, error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        message === "Falha ao validar integracao Uazapi."
          ? "Nao foi possivel enviar a mensagem de teste pela Uazapi."
          : message,
    });
  }
}

export async function sendFinancialAdvisorPreviewMessage(
  userId: number,
  question: string
) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Integracao do WhatsApp nao encontrada.",
    });
  }
  if (!integration.enabled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Ative a integracao do WhatsApp antes de enviar a mentoria para o numero autorizado.",
    });
  }
  if (!integration.authorizedPhone) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Informe um numero autorizado antes de enviar a mentoria para o WhatsApp.",
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

  const thread = await whatsappDb.getOrCreateAssistantThread(
    userId,
    integration.id,
    contact.id,
    {
      lastMessageAt: new Date(),
    }
  );

  const text = formatAdvisorPreviewMessage({
    question,
    reply: advisorReply.reply,
    alerts: advisorReply.alerts,
    suggestedActions: mapAdvisorRecommendationsToSuggestedActions(
      advisorReply.suggestedActions
    ),
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
    const message = mapProviderErrorMessage(integration.provider, error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        message === "Falha ao validar integracao Uazapi."
          ? "Nao foi possivel enviar a orientacao do mentor pela Uazapi."
          : message,
    });
  }
}

export async function askFinancialAdvisorFromDashboard(
  userId: number,
  message: string
) {
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

    const thread = await whatsappDb.getOrCreateAssistantThread(
      userId,
      integration.id,
      contact.id,
      {
        lastMessageAt: new Date(),
      }
    );

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

    const suggestedActions = mapAdvisorRecommendationsToSuggestedActions(
      advisorReply.suggestedActions
    );

    const run = await whatsappDb.createAssistantRun({
      userId,
      integrationId: integration.id,
      threadId: thread.id,
      triggerType: "direct_message",
      status: advisorReply.requiresConfirmation
        ? "aguardando_confirmacao"
        : "executado",
      userMessage: message,
      normalizedIntent: advisorReply.detectedIntent,
      contextPayload: JSON.stringify({
        snapshot: advisorReply.snapshot,
        source: "dashboard_chat",
      }),
      assistantResponse: advisorReply.reply,
      suggestedActions: JSON.stringify(suggestedActions),
      executedActions: advisorReply.requiresConfirmation
        ? undefined
        : JSON.stringify([]),
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
  const [integration, threads, messages, runs, plans, notifications] =
    await Promise.all([
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
      pendingConfirmations: runs.filter(
        run => run.status === "aguardando_confirmacao"
      ).length,
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
      latestMessage:
        messages.find(message => message.threadId === thread.id) ?? null,
      pendingRun:
        runs.find(
          run =>
            run.threadId === thread.id &&
            run.status === "aguardando_confirmacao"
        ) ?? null,
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
    event =>
      event.status === "falhou" ||
      String(event.lastError ?? "").trim().length > 0
  );
  const failedRuns = runs.filter(
    run =>
      run.status === "falhou" ||
      String(run.errorMessage ?? "").trim().length > 0
  );
  const pendingRuns = runs.filter(
    run =>
      run.status === "aguardando_confirmacao" ||
      run.status === "recebido" ||
      run.status === "analisado"
  );

  const findLatestEvent = (type: string) =>
    events.find(event => event.type === type) ?? null;
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

export async function confirmAssistantRunFromApp(
  userId: number,
  runId: number
) {
  const pendingRun = await whatsappDb.getAssistantRunById(userId, runId);
  if (!pendingRun) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Confirmacao pendente nao encontrada.",
    });
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
      message:
        "Configure o numero autorizado do WhatsApp para concluir esse fluxo no app.",
    });
  }

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    userId,
    integration.id,
    contact.id,
    {
      lastMessageAt: new Date(),
    }
  );

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
    textContent:
      "Confirmacao registrada no painel. Vou seguir com a execucao daqui.",
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
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Confirmacao pendente nao encontrada.",
    });
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
      message:
        "Configure o numero autorizado do WhatsApp para acompanhar esse fluxo no app.",
    });
  }

  const contact = await whatsappDb.upsertWhatsAppContact(userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    userId,
    integration.id,
    contact.id,
    {
      lastMessageAt: new Date(),
    }
  );

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
    textContent:
      "Perfeito. A confirmacao foi adiada no painel e sigo monitorando daqui.",
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

export async function dismissNotificationEvent(
  userId: number,
  eventId: number
) {
  const event = await whatsappDb.getNotificationEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Alerta nao encontrado.",
    });
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
  const now = getPartsInTimeZone(
    new Date(),
    integration?.timezone || DEFAULT_TIMEZONE
  );
  const plan = await whatsappDb.getFinancialPlanByPeriod(
    userId,
    now.month,
    now.year
  );
  if (!plan) return null;
  const actions = await whatsappDb.listFinancialPlanActions(userId, plan.id);
  return { ...plan, actions };
}

export async function confirmAssistantPlanAction(
  userId: number,
  actionId: number
) {
  return financialAdvisor.confirmFinancialAdvisorAction(userId, actionId);
}

export async function snoozeNotificationAlert(
  userId: number,
  eventId: number,
  hours = 24
) {
  const event = await whatsappDb.getNotificationEventById(userId, eventId);
  if (!event) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Alerta nao encontrado.",
    });
  }

  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  await whatsappDb.updateNotificationEvent(eventId, userId, {
    status: "adiado",
    snoozedUntil,
  });
  return { success: true, snoozedUntil };
}

async function processConfirmation(params: {
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >;
  contact: Awaited<ReturnType<typeof whatsappDb.upsertWhatsAppContact>>;
  thread: Awaited<ReturnType<typeof whatsappDb.getOrCreateAssistantThread>>;
  pendingRun: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getLatestPendingAssistantRun>>
  >;
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
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >;
  contact: Awaited<ReturnType<typeof whatsappDb.upsertWhatsAppContact>>;
  thread: Awaited<ReturnType<typeof whatsappDb.getOrCreateAssistantThread>>;
  pendingRun: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getLatestPendingAssistantRun>>
  >;
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

async function processInboundMessages(
  messages: ExtractedInboundMessage[],
  provider: WhatsAppProvider
) {
  if (messages.length === 0) {
    return { success: true, processed: 0 };
  }

  let processed = 0;
  for (const incoming of messages) {
    const integration =
      (incoming.instanceId
        ? await whatsappDb.getWhatsAppIntegrationByInstanceId(
            incoming.instanceId
          )
        : undefined) ??
      (incoming.instanceToken
        ? await whatsappDb.getWhatsAppIntegrationByApiToken(
            incoming.instanceToken
          )
        : undefined);
    if (
      !integration ||
      !integration.enabled ||
      integration.provider !== provider
    ) {
      continue;
    }

    await whatsappDb.touchWhatsAppWebhook(integration.id);

    const isAuthorized =
      normalizeWhatsAppPhone(integration.authorizedPhone) ===
      incoming.phoneNumber;
    const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
      integrationId: integration.id,
      phoneNumber: incoming.phoneNumber,
      displayName: incoming.displayName,
      isAuthorized,
      lastSeenAt: new Date(),
    });
    const thread = await whatsappDb.getOrCreateAssistantThread(
      integration.userId,
      integration.id,
      contact.id,
      {
        lastMessageAt: new Date(),
      }
    );

    const inboundMessage = await whatsappDb.createInboundWhatsAppMessageIfNew({
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
    if (!inboundMessage) {
      continue;
    }
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

    const notificationPreference = isNotificationOptOutMessage(incoming.text)
      ? false
      : isNotificationOptInMessage(incoming.text)
        ? true
        : null;
    if (notificationPreference != null) {
      const financialScope = await canonicalDb.resolveFinancialScope(
        integration.userId
      );
      await canonicalDb.setFinancialNotificationOptIn(
        financialScope,
        notificationPreference,
        {
          type: "assistant",
          id: `whatsapp:${integration.id}:${thread.id}`,
        }
      );
      await sendOutgoingMessage({
        integration,
        contactId: contact.id,
        threadId: thread.id,
        phoneNumber: contact.phoneNumber,
        text: notificationPreference
          ? "Mensagens proativas reativadas. Vou voltar a enviar lembretes e resumos respeitando o horario de silencio."
          : "Mensagens proativas desativadas. Nao enviarei novas cobrancas ou lembretes; voce ainda pode falar comigo quando quiser.",
        detectedIntent: notificationPreference
          ? "notifications_opt_in"
          : "notifications_opt_out",
      });
      processed += 1;
      continue;
    }

    const pendingRun = await whatsappDb.getLatestPendingAssistantRun(
      integration.userId,
      thread.id
    );
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

    if (isN8nAgentForwardingConfigured()) {
      try {
        const recentMessages = await whatsappDb.listRecentWhatsAppMessages(
          integration.userId,
          thread.id,
          12
        );
        const agentResponse = await forwardFinancialMessageToN8n({
          integrationId: integration.id,
          threadId: thread.id,
          requestId: incoming.providerMessageId,
          message: incoming.text,
          timezone: integration.timezone,
          recentConversation: recentMessages
            .slice()
            .reverse()
            .map(message => ({
              direction: message.direction,
              text: message.textContent,
              createdAt: message.createdAt,
            })),
        });
        const run = await whatsappDb.createAssistantRun({
          userId: integration.userId,
          integrationId: integration.id,
          threadId: thread.id,
          triggerType: "direct_message",
          status: "executado",
          userMessage: incoming.text,
          normalizedIntent: "n8n_agent",
          contextPayload: JSON.stringify({
            source: "n8n",
            requestId: incoming.providerMessageId,
            workflowExecutionId: agentResponse.workflowExecutionId ?? null,
          }),
          assistantResponse: agentResponse.reply,
          suggestedActions: JSON.stringify([]),
          executedActions: JSON.stringify([]),
          requiresConfirmation: false,
        });
        const outbound = await sendOutgoingMessage({
          integration,
          contactId: contact.id,
          threadId: thread.id,
          phoneNumber: contact.phoneNumber,
          text: agentResponse.reply,
          detectedIntent: "n8n_agent",
        });
        await createNotification({
          integrationId: integration.id,
          userId: integration.userId,
          relatedRunId: run.id,
          relatedMessageId: outbound.id,
          type: "n8n_agent_reply",
          scope: "conversation",
          title: "Resposta do agente financeiro",
          messageBody: agentResponse.reply.slice(0, 1_000),
          dedupeKey: `n8n-reply:${integration.userId}:${incoming.providerMessageId}`,
          status: "enviado",
        });
        processed += 1;
        continue;
      } catch (error) {
        console.warn(
          "[N8N Agent] Falling back to the built-in financial assistant",
          {
            integrationId: integration.id,
            error: error instanceof Error ? error.message : "unknown",
          }
        );
      }
    }

    const intent = detectFinancialAssistantIntent(incoming.text);
    const decisionAmount = extractDecisionAmount(incoming.text);
    const decisionInstallments = extractInstallmentCount(incoming.text);
    const context = await buildFinancialContext(
      integration.userId,
      integration.timezone
    );

    if (intent === "monthly_plan_request") {
      const preview =
        await financialAdvisor.buildFinancialAdvisorAssistantReply({
          intent,
          userId: integration.userId,
          timezone: integration.timezone,
        });
      const previewActions = mapAdvisorRecommendationsToSuggestedActions(
        preview.suggestedActions
      );
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
      await whatsappDb.updateAssistantRun(run.id, {
        status: "aguardando_confirmacao",
      });
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
          suggestedActions: mapAdvisorRecommendationsToSuggestedActions(
            advisorReply.suggestedActions
          ),
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
      contextPayload: advisorReply
        ? JSON.stringify({ snapshot: advisorReply.snapshot })
        : summarizeContext(context),
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

export function handleUazapiWebhook(payload: AnyRecord) {
  return processInboundMessages(extractUazapiMessages(payload), "uazapi");
}

export function handleBaileysWebhook(payload: AnyRecord) {
  return processInboundMessages(extractBaileysMessages(payload), "baileys");
}

async function runDailyDigestForIntegration(
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >,
  options?: { notificationDedupeKey?: string }
) {
  const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
    lastSeenAt: new Date(),
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    integration.userId,
    integration.id,
    contact.id,
    {
      lastMessageAt: new Date(),
    }
  );
  const digest = await financialAdvisor.getFinancialAdvisorDailyDigest({
    userId: integration.userId,
    integrationId: integration.id,
    timezone: integration.timezone,
  });
  const digestMemory = await financialAdvisor.getFinancialAdvisorMemory(
    integration.userId,
    {
      currentSnapshot: digest.snapshot,
    }
  );
  const digestMentorMode =
    financialAdvisor.getFinancialAdvisorMentorMode(digestMemory);
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
    dedupeKey:
      options?.notificationDedupeKey ||
      `daily:${integration.userId}:${digest.snapshot.generatedAt}`,
    status: "enviado",
  });
}

async function runMonthStartForIntegration(
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >,
  options?: { notificationDedupeKey?: string }
) {
  const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    integration.userId,
    integration.id,
    contact.id
  );
  const preview = await financialAdvisor.buildFinancialAdvisorAssistantReply({
    intent: "monthly_plan_request",
    userId: integration.userId,
    timezone: integration.timezone,
  });
  const previewActions = mapAdvisorRecommendationsToSuggestedActions(
    preview.suggestedActions
  );
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
    dedupeKey:
      options?.notificationDedupeKey ||
      `month-start:${integration.userId}:${preview.snapshot.year}-${preview.snapshot.month}`,
    status: "enviado",
  });
}

async function runMonthEndForIntegration(
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >,
  options?: { notificationDedupeKey?: string }
) {
  const contact = await whatsappDb.upsertWhatsAppContact(integration.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    integration.userId,
    integration.id,
    contact.id
  );
  const close = await financialAdvisor.getFinancialAdvisorMonthClose({
    userId: integration.userId,
    integrationId: integration.id,
    timezone: integration.timezone,
  });
  const closeMemory = await financialAdvisor.getFinancialAdvisorMemory(
    integration.userId,
    {
      currentSnapshot: close.snapshot,
    }
  );
  const closeMentorMode =
    financialAdvisor.getFinancialAdvisorMentorMode(closeMemory);
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
      suggestedActions: mapAdvisorRecommendationsToSuggestedActions(
        close.snapshot.topRecommendations
      ),
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
    dedupeKey:
      options?.notificationDedupeKey ||
      `month-end:${integration.userId}:${close.snapshot.year}-${close.snapshot.month}`,
    status: "enviado",
  });
}

type AssistantCronDiagnosticStatus =
  | "ready"
  | "attention"
  | "inactive"
  | "outside_window"
  | "already_sent";

function getRoutineStatusForConnection(params: {
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >;
  routine: "daily_digest" | "month_start" | "month_end";
  duplicateFound: boolean;
}) {
  const now = getPartsInTimeZone(
    new Date(),
    params.integration.timezone || DEFAULT_TIMEZONE
  );
  const tomorrow = getPartsInTimeZone(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
    params.integration.timezone || DEFAULT_TIMEZONE
  );

  if (!params.integration.enabled || !params.integration.authorizedPhone) {
    return {
      status: "inactive" as const,
      summary: "A integracao precisa estar habilitada e com numero autorizado.",
    };
  }

  if (params.duplicateFound) {
    return {
      status: "already_sent" as const,
      summary: "Ja existe um envio registrado para esta rotina no ciclo atual.",
    };
  }

  if (params.routine === "daily_digest") {
    const currentHour = now.hour;
    const configuredHour = params.integration.automationHour ?? 8;
    if (currentHour !== configuredHour) {
      return {
        status: "outside_window" as const,
        summary: `Fora da janela automatica. Agora sao ${currentHour}h e a rotina esta configurada para ${configuredHour}h.`,
      };
    }
  }

  if (params.routine === "month_start" && now.day !== 1) {
    return {
      status: "outside_window" as const,
      summary: "A rotina automatica de inicio do mes so dispara no dia 1.",
    };
  }

  if (params.routine === "month_end" && tomorrow.month === now.month) {
    return {
      status: "outside_window" as const,
      summary:
        "A rotina automatica de fechamento so dispara no ultimo dia do mes.",
    };
  }

  if (params.integration.lastConnectionStatus === "erro") {
    return {
      status: "attention" as const,
      summary:
        params.integration.lastConnectionMessage ||
        "A integracao esta com erro e merece revisao antes do envio.",
    };
  }

  return {
    status: "ready" as const,
    summary: "A rotina esta apta para rodar agora.",
  };
}

export async function getAssistantCronDiagnostics(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration) {
    return {
      checkedAt: new Date().toISOString(),
      integration: null,
      routines: [
        {
          key: "daily_digest",
          label: "Digest diario",
          dedupeKey: null,
          status: "inactive" as AssistantCronDiagnosticStatus,
          summary: "Configure a integracao do WhatsApp para liberar a rotina.",
        },
        {
          key: "month_start",
          label: "Inicio do mes",
          dedupeKey: null,
          status: "inactive" as AssistantCronDiagnosticStatus,
          summary: "Configure a integracao do WhatsApp para liberar a rotina.",
        },
        {
          key: "month_end",
          label: "Fechamento do mes",
          dedupeKey: null,
          status: "inactive" as AssistantCronDiagnosticStatus,
          summary: "Configure a integracao do WhatsApp para liberar a rotina.",
        },
      ],
    };
  }

  const now = getPartsInTimeZone(
    new Date(),
    integration.timezone || DEFAULT_TIMEZONE
  );
  const dailyKey = `daily:${integration.userId}:${now.iso}`;
  const monthStartKey = `month-start:${integration.userId}:${now.year}-${now.month}`;
  const monthEndKey = `month-end:${integration.userId}:${now.year}-${now.month}`;
  const [dailyExisting, monthStartExisting, monthEndExisting] =
    await Promise.all([
      whatsappDb.getNotificationEventByDedupeKey(integration.id, dailyKey),
      whatsappDb.getNotificationEventByDedupeKey(integration.id, monthStartKey),
      whatsappDb.getNotificationEventByDedupeKey(integration.id, monthEndKey),
    ]);

  const daily = getRoutineStatusForConnection({
    integration,
    routine: "daily_digest",
    duplicateFound: Boolean(dailyExisting),
  });
  const monthStart = getRoutineStatusForConnection({
    integration,
    routine: "month_start",
    duplicateFound: Boolean(monthStartExisting),
  });
  const monthEnd = getRoutineStatusForConnection({
    integration,
    routine: "month_end",
    duplicateFound: Boolean(monthEndExisting),
  });

  return {
    checkedAt: new Date().toISOString(),
    integration: {
      id: integration.id,
      enabled: integration.enabled,
      authorizedPhone: integration.authorizedPhone,
      automationHour: integration.automationHour,
      timezone: integration.timezone,
      lastConnectionStatus: integration.lastConnectionStatus,
      lastConnectionMessage: integration.lastConnectionMessage,
    },
    routines: [
      {
        key: "daily_digest",
        label: "Digest diario",
        dedupeKey: dailyKey,
        ...daily,
      },
      {
        key: "month_start",
        label: "Inicio do mes",
        dedupeKey: monthStartKey,
        ...monthStart,
      },
      {
        key: "month_end",
        label: "Fechamento do mes",
        dedupeKey: monthEndKey,
        ...monthEnd,
      },
    ],
  };
}

async function getManualAutomationIntegration(userId: number) {
  const integration = await whatsappDb.getWhatsAppIntegration(userId);
  if (!integration || !integration.enabled || !integration.authorizedPhone) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Configure uma integracao do WhatsApp habilitada com numero autorizado para rodar esta rotina.",
    });
  }
  return integration;
}

export async function runFinancialDailyForUser(userId: number) {
  const integration = await getManualAutomationIntegration(userId);
  await runDailyDigestForIntegration(integration, {
    notificationDedupeKey: `manual-daily:${integration.userId}:${Date.now()}`,
  });
  return {
    success: true,
    processed: 1,
    message: "Digest diario executado manualmente para esta integracao.",
  };
}

export async function runFinancialMonthStartForUser(userId: number) {
  const integration = await getManualAutomationIntegration(userId);
  await runMonthStartForIntegration(integration, {
    notificationDedupeKey: `manual-month-start:${integration.userId}:${Date.now()}`,
  });
  return {
    success: true,
    processed: 1,
    message: "Inicio do mes executado manualmente para esta integracao.",
  };
}

export async function runFinancialMonthEndForUser(userId: number) {
  const integration = await getManualAutomationIntegration(userId);
  await runMonthEndForIntegration(integration, {
    notificationDedupeKey: `manual-month-end:${integration.userId}:${Date.now()}`,
  });
  return {
    success: true,
    processed: 1,
    message: "Fechamento do mes executado manualmente para esta integracao.",
  };
}

function getFailureTimestamp(entry: {
  updatedAt?: Date | null;
  createdAt?: Date | null;
}) {
  return entry.updatedAt?.getTime() ?? entry.createdAt?.getTime() ?? 0;
}

function getRerunnableAutomationRoutineFromRun(
  run:
    | Awaited<ReturnType<typeof whatsappDb.listAssistantRuns>>[number]
    | null
    | undefined
) {
  if (!run) return null;
  if (run.triggerType === "daily_digest") return "daily_digest" as const;
  if (run.triggerType === "month_start") return "month_start" as const;
  if (run.triggerType === "month_end") return "month_end" as const;
  return null;
}

function getRerunnableAutomationRoutineFromEvent(
  event:
    | Awaited<ReturnType<typeof whatsappDb.listNotificationEvents>>[number]
    | null
    | undefined
) {
  if (!event) return null;
  if (event.type === "daily_digest") return "daily_digest" as const;
  if (event.type === "month_start") return "month_start" as const;
  if (event.type === "month_end") return "month_end" as const;
  return null;
}

async function rerunAutomationRoutineForUser(
  userId: number,
  routine: "daily_digest" | "month_start" | "month_end"
) {
  if (routine === "daily_digest") return runFinancialDailyForUser(userId);
  if (routine === "month_start") return runFinancialMonthStartForUser(userId);
  return runFinancialMonthEndForUser(userId);
}

export async function rerunLatestOperationalFailure(userId: number) {
  const [events, runs] = await Promise.all([
    whatsappDb.listNotificationEvents(userId),
    whatsappDb.listAssistantRuns(userId),
  ]);

  const failedEvents = events.filter(
    event =>
      event.status === "falhou" ||
      String(event.lastError ?? "").trim().length > 0
  );
  const failedRuns = runs.filter(
    run =>
      run.status === "falhou" ||
      String(run.errorMessage ?? "").trim().length > 0
  );

  const latestFailedEvent = failedEvents[0] ?? null;
  const latestFailedRun = failedRuns[0] ?? null;

  if (!latestFailedEvent && !latestFailedRun) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nao existe falha recente para reprocessar.",
    });
  }

  const latestSource =
    getFailureTimestamp(latestFailedRun ?? {}) >=
    getFailureTimestamp(latestFailedEvent ?? {})
      ? { kind: "run" as const, value: latestFailedRun }
      : { kind: "event" as const, value: latestFailedEvent };

  const rerunnableRoutine =
    latestSource.kind === "run"
      ? getRerunnableAutomationRoutineFromRun(latestSource.value)
      : getRerunnableAutomationRoutineFromEvent(latestSource.value);

  if (!rerunnableRoutine) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A ultima falha registrada nao pertence a uma rotina automatica reprocessavel pelo painel.",
    });
  }

  const result = await rerunAutomationRoutineForUser(userId, rerunnableRoutine);
  const label =
    rerunnableRoutine === "daily_digest"
      ? "digest diario"
      : rerunnableRoutine === "month_start"
        ? "inicio do mes"
        : "fechamento do mes";

  return {
    ...result,
    sourceType: latestSource.kind,
    sourceId: latestSource.value?.id ?? null,
    rerunType: rerunnableRoutine,
    message: `Ultima falha reprocessada com sucesso via ${label}.`,
  };
}

export async function runEligibleAssistantAutomationsForUser(userId: number) {
  const diagnostics = await getAssistantCronDiagnostics(userId);
  const readyRoutines = diagnostics.routines.filter(
    (
      routine
    ): routine is typeof routine & {
      key: "daily_digest" | "month_start" | "month_end";
      status: "ready";
    } => routine.status === "ready"
  );

  if (readyRoutines.length === 0) {
    return {
      success: true,
      processed: 0,
      executedRoutines: [] as string[],
      skippedRoutines: diagnostics.routines.map(routine => ({
        key: routine.key,
        status: routine.status,
        summary: routine.summary,
      })),
      message: "Nenhuma rotina esta apta para execucao imediata agora.",
    };
  }

  const executedRoutines: string[] = [];
  for (const routine of readyRoutines) {
    await rerunAutomationRoutineForUser(userId, routine.key);
    executedRoutines.push(routine.key);
  }

  return {
    success: true,
    processed: executedRoutines.length,
    executedRoutines,
    skippedRoutines: diagnostics.routines
      .filter(routine => routine.status !== "ready")
      .map(routine => ({
        key: routine.key,
        status: routine.status,
        summary: routine.summary,
      })),
    message:
      executedRoutines.length === 1
        ? "1 rotina apta foi executada agora."
        : `${executedRoutines.length} rotinas aptas foram executadas agora.`,
  };
}

function isTimeInsideQuietHours(
  hour: number,
  minute: number,
  quietStart: string,
  quietEnd: string
) {
  const toMinutes = (value: string, fallback: number) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return fallback;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const current = hour * 60 + minute;
  const start = toMinutes(quietStart, 21 * 60);
  const end = toMinutes(quietEnd, 8 * 60);
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

async function canSendProactiveMessage(
  integration: NonNullable<
    Awaited<ReturnType<typeof whatsappDb.getWhatsAppIntegration>>
  >,
  now = new Date()
) {
  const scope = await canonicalDb.resolveFinancialScope(integration.userId);
  const profile = await canonicalDb.getFinancialProfile(scope);
  if (!profile) return true;
  if (!profile.notificationsOptIn) return false;
  if (
    profile.notificationsPausedUntil &&
    profile.notificationsPausedUntil.getTime() > now.getTime()
  ) {
    return false;
  }
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: profile.timezone || integration.timezone || DEFAULT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(local.find(part => part.type === "hour")?.value ?? 0);
  const minute = Number(local.find(part => part.type === "minute")?.value ?? 0);
  return !isTimeInsideQuietHours(
    hour,
    minute,
    profile.quietHoursStart,
    profile.quietHoursEnd
  );
}

export async function runFinancialDailyCron() {
  const integrations = await whatsappDb.listEnabledWhatsAppIntegrations();
  let processed = 0;
  for (const integration of integrations) {
    if (!(await canSendProactiveMessage(integration))) continue;
    const now = getPartsInTimeZone(
      new Date(),
      integration.timezone || DEFAULT_TIMEZONE
    );
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
    if (!(await canSendProactiveMessage(integration))) continue;
    const now = getPartsInTimeZone(
      new Date(),
      integration.timezone || DEFAULT_TIMEZONE
    );
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
    if (!(await canSendProactiveMessage(integration))) continue;
    const now = getPartsInTimeZone(
      new Date(),
      integration.timezone || DEFAULT_TIMEZONE
    );
    const tomorrow = getPartsInTimeZone(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      integration.timezone || DEFAULT_TIMEZONE
    );
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
  if (!integration || !integration.enabled)
    return { success: false, skipped: true };
  if (!(await canSendProactiveMessage(integration))) {
    return { success: false, skipped: true, reason: "notifications_paused" };
  }

  const existing = await whatsappDb.getNotificationEventByDedupeKey(
    integration.id,
    params.dedupeKey
  );
  if (existing) return { success: true, deduped: true };

  const contact = await whatsappDb.upsertWhatsAppContact(params.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    params.userId,
    integration.id,
    contact.id
  );
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

export async function sendScheduledFinancialMessage(params: {
  userId: number;
  text: string;
  templateKey: string;
  idempotencyKey: string;
}) {
  const integration = await whatsappDb.getWhatsAppIntegration(params.userId);
  if (!integration || !integration.enabled || !integration.authorizedPhone) {
    return {
      success: false as const,
      skipped: true as const,
      reason: "integration_inactive",
    };
  }
  if (!(await canSendProactiveMessage(integration))) {
    return {
      success: false as const,
      skipped: true as const,
      reason: "notifications_paused",
    };
  }
  const existing = await whatsappDb.getNotificationEventByDedupeKey(
    integration.id,
    params.idempotencyKey
  );
  if (existing) {
    return {
      success: true as const,
      deduped: true as const,
      messageId: existing.relatedMessageId,
    };
  }
  const contact = await whatsappDb.upsertWhatsAppContact(params.userId, {
    integrationId: integration.id,
    phoneNumber: integration.authorizedPhone,
    displayName: "Titular",
    isAuthorized: true,
  });
  const thread = await whatsappDb.getOrCreateAssistantThread(
    params.userId,
    integration.id,
    contact.id
  );
  const message = await sendOutgoingMessage({
    integration,
    contactId: contact.id,
    threadId: thread.id,
    phoneNumber: contact.phoneNumber,
    text: params.text.slice(0, 3_900),
    detectedIntent: params.templateKey,
    metadata: {
      source: "canonical_scheduler",
      idempotencyKey: params.idempotencyKey,
    },
    idempotencyKey: `scheduled:${params.idempotencyKey}`,
  });
  await createNotification({
    integrationId: integration.id,
    userId: params.userId,
    relatedMessageId: message.id,
    type: params.templateKey,
    scope: "canonical_automation",
    title: "Assistente financeiro",
    messageBody: params.text.slice(0, 1_000),
    dedupeKey: params.idempotencyKey,
    status: "enviado",
  });
  return {
    success: true as const,
    deduped: false as const,
    messageId: message.id,
  };
}
