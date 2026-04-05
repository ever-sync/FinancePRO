import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, BellRing, MessageCircle, Sparkles } from "lucide-react";

type InboxFilter = "todos" | "pendencias" | "alertas" | "mensagens";
type SourceFilter = "todas" | "whatsapp" | "painel" | "automacao" | "previa";

type InboxItem = {
  id: string;
  kind: "pendencia" | "alerta" | "mensagem";
  title: string;
  description: string;
  status: string;
  source: SourceFilter;
  sourceLabel: string;
  createdAt?: string | Date | null;
  threadId?: number | null;
  runId?: number | null;
  eventId?: number | null;
  eventType?: string | null;
  eventScope?: string | null;
  intentLabel?: string | null;
  metaLabel?: string | null;
};

type PrioritizedInboxItem = InboxItem & {
  priorityScore: number;
  urgency: "alta" | "media" | "baixa";
  impact: "alto" | "medio" | "baixo";
  actionLabel: string;
};

type InboxActionSpec = {
  key: string;
  label: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "ghost";
  disabled?: boolean;
  onClick: () => void;
};

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

function formatDateTimeLabel(value?: string | Date | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getMentorMessageSource(rawPayload?: string | null): {
  key: SourceFilter;
  label: string;
} {
  if (!rawPayload) {
    return { key: "whatsapp", label: "WhatsApp" };
  }

  try {
    const parsed = JSON.parse(rawPayload) as { source?: string; origin?: string };
    if (parsed.source === "dashboard_chat" || parsed.source === "dashboard_confirmation" || parsed.origin === "app") {
      return { key: "painel", label: "Painel" };
    }
    if (parsed.source === "financial_advisor_preview") {
      return { key: "previa", label: "Previa" };
    }
  } catch {
    return { key: "whatsapp", label: "WhatsApp" };
  }

  return { key: "whatsapp", label: "WhatsApp" };
}

function getRunSource(contextPayload?: string | null, triggerType?: string | null): {
  key: SourceFilter;
  label: string;
} {
  if (triggerType && triggerType !== "direct_message") {
    return { key: "automacao", label: "Automacao" };
  }

  if (!contextPayload) {
    return { key: "whatsapp", label: "WhatsApp" };
  }

  try {
    const parsed = JSON.parse(contextPayload) as { source?: string };
    if (parsed.source === "dashboard_chat") {
      return { key: "painel", label: "Painel" };
    }
  } catch {
    return { key: "whatsapp", label: "WhatsApp" };
  }

  return { key: "whatsapp", label: "WhatsApp" };
}

function isPendingInboxItem(item: InboxItem) {
  return (
    item.kind === "pendencia" ||
    item.status === "agendado" ||
    item.status === "adiado" ||
    item.status === "falhou"
  );
}

function getDefaultAdvisorPreviewMessage(item: InboxItem) {
  if (item.eventType === "month_start") {
    return "Monte meu plano financeiro do mes com foco em caixa.";
  }
  if (item.eventType === "month_end") {
    return "Me explique o fechamento do meu mes como um mentor financeiro.";
  }
  if (item.eventType === "daily_digest") {
    return "O que eu preciso fazer hoje no financeiro?";
  }
  if (item.eventType === "assistant_reply") {
    return "Me atualize sobre minha saude financeira.";
  }
  return "Me explique meu mes como um mentor financeiro.";
}

function getHoursSince(value?: string | Date | null) {
  if (!value) return 999;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 999;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
}

function prioritizeInboxItem(item: InboxItem): PrioritizedInboxItem {
  let baseScore = 20;
  let urgency: PrioritizedInboxItem["urgency"] = "baixa";
  let impact: PrioritizedInboxItem["impact"] = "baixo";
  let actionLabel = "Revisar";

  if (item.kind === "pendencia") {
    baseScore = 88;
    urgency = "alta";
    impact = "alto";
    actionLabel = "Confirmar ou adiar";

    if (item.intentLabel?.includes("plano do mes")) {
      baseScore = 96;
      actionLabel = "Gerar plano do mes";
    }
  }

  if (item.kind === "alerta") {
    baseScore = 62;
    urgency = "media";
    impact = "medio";
    actionLabel = "Tratar alerta";

    if (item.eventType === "month_start") {
      baseScore = 92;
      urgency = "alta";
      impact = "alto";
      actionLabel = "Gerar plano";
    } else if (item.eventType === "daily_digest") {
      baseScore = 78;
      urgency = "alta";
      impact = "medio";
      actionLabel = "Recalcular ou enviar resumo";
    } else if (item.eventType === "month_end") {
      baseScore = 74;
      urgency = "media";
      impact = "alto";
      actionLabel = "Fechar ciclo";
    } else if (item.eventScope === "alert") {
      baseScore = 82;
      urgency = "alta";
      impact = "alto";
      actionLabel = "Resolver alerta";
    } else if (item.status === "falhou") {
      baseScore = 84;
      urgency = "alta";
      impact = "alto";
      actionLabel = "Reenviar ou resolver";
    }
  }

  if (item.kind === "mensagem") {
    baseScore = item.source === "painel" ? 38 : 32;
    urgency = "baixa";
    impact = item.source === "painel" ? "medio" : "baixo";
    actionLabel = item.threadId ? "Abrir thread" : "Revisar mensagem";

    if (item.intentLabel?.includes("retirada da empresa") || item.intentLabel?.includes("novo custo mensal")) {
      baseScore += 14;
      urgency = "media";
      impact = "medio";
    }
  }

  if (item.status === "falhou" || item.status === "erro") {
    baseScore += 14;
    urgency = "alta";
    impact = "alto";
  }
  if (item.status === "agendado" || item.status === "adiado") {
    baseScore += 6;
  }
  if (item.status === "enviado" || item.status === "executado" || item.status === "descartado") {
    baseScore -= 12;
  }

  const hoursSince = getHoursSince(item.createdAt);
  if (hoursSince <= 6) baseScore += 8;
  else if (hoursSince <= 24) baseScore += 5;
  else if (hoursSince > 72) baseScore -= 4;

  const priorityScore = Math.max(0, Math.min(100, Math.round(baseScore)));
  if (priorityScore >= 80) urgency = "alta";
  else if (priorityScore >= 55 && urgency === "baixa") urgency = "media";

  return {
    ...item,
    priorityScore,
    urgency,
    impact,
    actionLabel,
  };
}

function getAttackPlanReason(item: PrioritizedInboxItem, index: number) {
  if (item.kind === "pendencia") {
    return index === 0
      ? "Destrava uma decisao que esta impedindo o mentor de seguir com execucao."
      : "Remove uma confirmacao pendente e devolve velocidade para o fluxo do dia.";
  }

  if (item.kind === "alerta") {
    if (item.eventType === "month_start") {
      return "Abre o ciclo com plano claro, limites de gasto e prioridades antes do mes se desorganizar.";
    }
    if (item.eventType === "daily_digest") {
      return "Recalcula a leitura do dia para evitar agir com contexto velho.";
    }
    if (item.eventType === "month_end") {
      return "Fecha o ciclo e transforma aprendizado do mes em direcao pratica para o proximo.";
    }
    if (item.eventScope === "alert") {
      return "Ataca um sinal de risco que pode crescer se continuar aberto.";
    }
    return "Mantem a automacao limpa e reduz ruido operacional na inbox.";
  }

  if (item.kind === "mensagem") {
    return item.source === "painel"
      ? "Recupera uma conversa iniciada no app que pode virar decisao financeira util."
      : "Reabre um contexto recente para nao perder continuidade na orientacao.";
  }

  return "Mantem o foco no que gera mais controle financeiro agora.";
}

function getAttackPlanLead(topItems: PrioritizedInboxItem[]) {
  if (!topItems.length) {
    return "Nenhuma acao critica aberta no momento.";
  }

  const hasPending = topItems.some(item => item.kind === "pendencia");
  const hasAlert = topItems.some(item => item.kind === "alerta");

  if (hasPending && hasAlert) {
    return "Primeiro destrave decisoes pendentes, depois limpe sinais de risco e so entao volte para o fluxo normal.";
  }
  if (hasPending) {
    return "O melhor uso do seu tempo agora e resolver confirmacoes que estao travando a execucao do mentor.";
  }
  if (hasAlert) {
    return "O dia pede leitura e correcao rapida de alertas antes que eles contaminem o restante da operacao.";
  }

  return "O foco agora e manter contexto, continuidade e disciplina operacional na conversa com o mentor.";
}

function getOperationalActionLead(item: PrioritizedInboxItem) {
  if (item.kind === "pendencia") {
    return "O mentor quer destravar esta confirmacao antes de qualquer outra coisa.";
  }

  if (item.kind === "alerta") {
    if (item.eventType === "month_start") {
      return "O melhor passo agora e abrir o ciclo com um plano claro e executavel.";
    }
    if (item.eventType === "daily_digest") {
      return "Atualize a leitura do dia antes de espalhar a atencao pelo resto da inbox.";
    }
    if (item.eventType === "month_end") {
      return "Feche o ciclo primeiro para nao carregar ruido para a proxima rodada de decisoes.";
    }
    if (item.eventScope === "alert") {
      return "Existe um risco quente na operacao e ele merece acao antes de novas perguntas.";
    }
    return "O melhor uso do tempo agora e tratar este alerta e reduzir ruido operacional.";
  }

  return item.source === "painel"
    ? "A conversa iniciada no app pede continuidade antes de perder contexto."
    : "Vale retomar esta conversa para manter a linha de orientacao do mentor.";
}

function getOperationalActionSupport(item: PrioritizedInboxItem) {
  if (item.kind === "pendencia") {
    return "Boa opcao de apoio se a primeira confirmacao ja estiver resolvida.";
  }
  if (item.kind === "alerta") {
    return "Se o principal ja estiver encaminhado, este e o proximo alerta que mais vale atacar.";
  }
  return "Se o principal ja estiver coberto, use esta conversa para manter continuidade operacional.";
}

export default function WhatsAppConversas() {
  const utils = trpc.useUtils();
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("todos");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("todas");
  const [onlyPending, setOnlyPending] = useState(false);
  const [search, setSearch] = useState("");

  const { data: inbox, isLoading } = trpc.assistantInbox.list.useQuery();
  const { data: events } = trpc.assistantAutomation.list.useQuery();

  const confirmPendingRunMut = trpc.assistantInbox.confirmRun.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.assistantInbox.list.invalidate(),
        utils.assistantAutomation.list.invalidate(),
        utils.assistantPlans.getCurrent.invalidate(),
        utils.assistantPlans.list.invalidate(),
        utils.financialAdvisor.getSnapshot.invalidate(),
        utils.financialAdvisor.getDailyDigest.invalidate(),
        utils.financialAdvisor.getMonthClose.invalidate(),
      ]);
      toast.success("Confirmacao executada no painel.");
    },
    onError: error => toast.error(error.message),
  });
  const snoozePendingRunMut = trpc.assistantInbox.snoozeRun.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.assistantInbox.list.invalidate(),
        utils.assistantAutomation.list.invalidate(),
        utils.assistantPlans.getCurrent.invalidate(),
        utils.assistantPlans.list.invalidate(),
      ]);
      toast.success("Confirmacao adiada no painel.");
    },
    onError: error => toast.error(error.message),
  });
  const snoozeAlertMut = trpc.assistantPlans.snoozeAlert.useMutation({
    onSuccess: async () => {
      await utils.assistantAutomation.list.invalidate();
      toast.success("Alerta adiado por 24 horas.");
    },
    onError: error => toast.error(error.message),
  });
  const dismissEventMut = trpc.assistantAutomation.dismissEvent.useMutation({
    onSuccess: async () => {
      await utils.assistantAutomation.list.invalidate();
      toast.success("Alerta marcado como resolvido.");
    },
    onError: error => toast.error(error.message),
  });
  const refreshAdvisorStateMut = trpc.financialAdvisor.refreshState.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.financialAdvisor.getSnapshot.invalidate(),
        utils.financialAdvisor.getDailyDigest.invalidate(),
        utils.financialAdvisor.getMonthClose.invalidate(),
        utils.assistantAutomation.list.invalidate(),
        utils.assistantInbox.list.invalidate(),
      ]);
      toast.success("Leituras do mentor recalculadas.");
    },
    onError: error => toast.error(error.message),
  });
  const generatePlanMut = trpc.financialAdvisor.generateMonthlyPlan.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.assistantPlans.getCurrent.invalidate(),
        utils.assistantPlans.list.invalidate(),
        utils.financialAdvisor.getSnapshot.invalidate(),
        utils.financialAdvisor.getDailyDigest.invalidate(),
        utils.financialAdvisor.getMonthClose.invalidate(),
        utils.assistantAutomation.list.invalidate(),
      ]);
      toast.success("Plano mensal gerado a partir da inbox.");
    },
    onError: error => toast.error(error.message),
  });
  const sendAdvisorPreviewMut = trpc.whatsappIntegration.sendAdvisorPreview.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.assistantInbox.list.invalidate(),
        utils.whatsappIntegration.syncStatus.invalidate(),
      ]);
      toast.success("Resumo enviado para o WhatsApp.");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!inbox?.threads.length) {
      setSelectedThreadId(null);
      return;
    }

    if (!selectedThreadId || !inbox.threads.some(thread => thread.id === selectedThreadId)) {
      setSelectedThreadId(inbox.threads[0].id);
    }
  }, [inbox?.threads, selectedThreadId]);

  const selectedThread =
    inbox?.threads.find(thread => thread.id === selectedThreadId) ?? inbox?.threads[0] ?? null;
  const selectedThreadMessages = (inbox?.messages ?? [])
    .filter(message => (selectedThread ? message.threadId === selectedThread.id : true))
    .slice(0, 30);

  const pendingRunItems: InboxItem[] = (inbox?.runs ?? [])
    .filter(run => run.status === "aguardando_confirmacao")
    .map(run => {
      const source = getRunSource(run.contextPayload, run.triggerType);
      return {
        id: `run-${run.id}`,
        kind: "pendencia",
        title: formatMentorIntent(run.normalizedIntent) || "Confirmacao pendente",
        description:
          run.assistantResponse ||
          run.userMessage ||
          "Existe uma confirmacao aguardando sua decisao.",
        status: run.status,
        source: source.key,
        sourceLabel: source.label,
        createdAt: run.createdAt,
        threadId: run.threadId,
        runId: run.id,
        intentLabel: formatMentorIntent(run.normalizedIntent) || run.normalizedIntent,
        metaLabel: run.triggerType,
      };
    });

  const alertItems: InboxItem[] = (events ?? []).map(event => ({
    id: `event-${event.id}`,
    kind: "alerta",
    title: event.title,
    description: event.messageBody,
    status: event.status,
    source: "automacao",
    sourceLabel: "Automacao",
    createdAt: event.createdAt,
    eventId: event.id,
    eventType: event.type,
    eventScope: event.scope,
    metaLabel: `${event.type} · ${event.scope}`,
  }));

  const messageItems: InboxItem[] = (inbox?.messages ?? []).slice(0, 40).map(message => {
    const source = getMentorMessageSource(message.rawPayload);
    return {
      id: `message-${message.id}`,
      kind: "mensagem",
      title: message.direction === "inbound" ? "Mensagem recebida" : "Mensagem enviada",
      description: message.textContent || "Mensagem sem texto",
      status: message.status,
      source: source.key,
      sourceLabel: source.label,
      createdAt: message.createdAt,
      threadId: message.threadId,
      intentLabel: formatMentorIntent(message.detectedIntent) || message.detectedIntent,
    };
  });

  const inboxItems = [...pendingRunItems, ...alertItems, ...messageItems]
    .map(prioritizeInboxItem)
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

  const filteredInboxItems = inboxItems.filter(item => {
    if (inboxFilter === "pendencias" && item.kind !== "pendencia") return false;
    if (inboxFilter === "alertas" && item.kind !== "alerta") return false;
    if (inboxFilter === "mensagens" && item.kind !== "mensagem") return false;
    if (sourceFilter !== "todas" && item.source !== sourceFilter) return false;
    if (onlyPending && !isPendingInboxItem(item)) return false;

    const searchable = [
      item.title,
      item.description,
      item.intentLabel,
      item.metaLabel,
      item.sourceLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (search.trim() && !searchable.includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const pendingConfirmationCount = pendingRunItems.length;
  const activeAlertCount = alertItems.filter(item => item.status !== "enviado" && item.status !== "descartado").length;
  const panelMessageCount = messageItems.filter(item => item.source === "painel" || item.source === "previa").length;
  const threadCount = inbox?.threads.length ?? 0;
  const topPriorityItems = inboxItems.filter(item => item.priorityScore >= 55).slice(0, 3);
  const focusItem = topPriorityItems[0] ?? null;
  const attackPlanItems = inboxItems.filter(item => item.priorityScore >= 45).slice(0, 3);
  const attackPlanLead = getAttackPlanLead(attackPlanItems);
  const operationalSuggestions = topPriorityItems.length ? topPriorityItems : attackPlanItems;
  const primaryOperationalSuggestion = operationalSuggestions[0] ?? null;
  const supportingOperationalSuggestions = operationalSuggestions.slice(1, 3);
  const alertActionBusy =
    snoozeAlertMut.isPending ||
    dismissEventMut.isPending ||
    refreshAdvisorStateMut.isPending ||
    generatePlanMut.isPending ||
    sendAdvisorPreviewMut.isPending;
  const runActionBusy = confirmPendingRunMut.isPending || snoozePendingRunMut.isPending;

  const buildInboxItemActions = (item: PrioritizedInboxItem): InboxActionSpec[] => {
    const actions: InboxActionSpec[] = [];
    const openContextAction = item.threadId
      ? {
          key: `open-${item.id}`,
          label: item.kind === "mensagem" ? "Abrir thread" : "Abrir contexto",
          variant: "ghost" as const,
          disabled: false,
          onClick: () => setSelectedThreadId(item.threadId ?? null),
        }
      : null;

    if (item.kind === "pendencia" && item.runId) {
      actions.push({
        key: `confirm-${item.id}`,
        label: "Confirmar",
        pendingLabel: "Confirmando...",
        disabled: runActionBusy,
        onClick: () => {
          if (item.threadId) setSelectedThreadId(item.threadId);
          confirmPendingRunMut.mutate({ runId: item.runId });
        },
      });
      actions.push({
        key: `snooze-${item.id}`,
        label: "Adiar",
        pendingLabel: "Adiando...",
        variant: "outline",
        disabled: runActionBusy,
        onClick: () => {
          if (item.threadId) setSelectedThreadId(item.threadId);
          snoozePendingRunMut.mutate({ runId: item.runId });
        },
      });
      if (openContextAction) actions.push(openContextAction);
      return actions;
    }

    if (item.kind === "alerta") {
      if (item.eventType === "month_start") {
        actions.push({
          key: `plan-${item.id}`,
          label: "Gerar plano",
          pendingLabel: "Gerando plano...",
          disabled: alertActionBusy,
          onClick: () => generatePlanMut.mutate(),
        });
      } else if (
        item.eventType === "daily_digest" ||
        item.eventType === "month_end" ||
        item.eventScope === "alert"
      ) {
        actions.push({
          key: `refresh-${item.id}`,
          label: "Recalcular leituras",
          pendingLabel: "Recalculando...",
          disabled: alertActionBusy,
          onClick: () => refreshAdvisorStateMut.mutate(),
        });
      }

      actions.push({
        key: `preview-${item.id}`,
        label: "Enviar resumo",
        pendingLabel: "Enviando...",
        variant: actions.length ? "outline" : "default",
        disabled: alertActionBusy,
        onClick: () =>
          sendAdvisorPreviewMut.mutate({
            message: getDefaultAdvisorPreviewMessage(item),
          }),
      });

      if (item.eventId && item.status !== "enviado" && item.status !== "descartado") {
        actions.push({
          key: `snooze-alert-${item.id}`,
          label: "Adiar 24h",
          pendingLabel: "Adiando...",
          variant: "outline",
          disabled: alertActionBusy,
          onClick: () => snoozeAlertMut.mutate({ eventId: item.eventId!, hours: 24 }),
        });
      }

      if (item.eventId && item.status !== "descartado") {
        actions.push({
          key: `dismiss-${item.id}`,
          label: "Marcar resolvido",
          pendingLabel: "Resolvendo...",
          variant: "ghost",
          disabled: alertActionBusy,
          onClick: () => dismissEventMut.mutate({ eventId: item.eventId! }),
        });
      }

      if (openContextAction) actions.push(openContextAction);
      return actions;
    }

    if (openContextAction) {
      actions.push({
        ...openContextAction,
        variant: "default",
      });
    }

    return actions;
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando inbox do mentor...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inbox do mentor</h1>
        <p className="text-sm text-muted-foreground">
          Central operacional da IA com pendencias, alertas e conversas do WhatsApp e do painel.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pendencias abertas</CardDescription>
            <CardTitle className="text-xl">{pendingConfirmationCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Confirmacoes aguardando decisao para o mentor seguir.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Alertas ativos</CardDescription>
            <CardTitle className="text-xl">{activeAlertCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Eventos automatizados ainda em acompanhamento ou com acao pendente.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mensagens do painel</CardDescription>
            <CardTitle className="text-xl">{panelMessageCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Interacoes registradas dentro do app e persistidas na trilha do assistente.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Threads acompanhadas</CardDescription>
            <CardTitle className="text-xl">{threadCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Conversas disponiveis para abrir o historico e agir com contexto.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foco do dia</CardTitle>
          <CardDescription>
            Priorizacao inteligente da inbox considerando tipo, risco e recencia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {focusItem ? (
            <>
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={focusItem.urgency} />
                      <span className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                        impacto {focusItem.impact}
                      </span>
                      <span className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                        score {focusItem.priorityScore}/100
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-semibold text-zinc-900">{focusItem.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {focusItem.description}
                    </p>
                    <p className="mt-3 text-sm text-zinc-600">
                      Proxima melhor acao: {focusItem.actionLabel}.
                    </p>
                  </div>
                  <div className="space-y-3 text-right text-xs uppercase tracking-[0.16em] text-zinc-400">
                    <div>
                      <div>{focusItem.sourceLabel}</div>
                      <div className="mt-1">{formatDateTimeLabel(focusItem.createdAt)}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {buildInboxItemActions(focusItem)
                        .slice(0, 3)
                        .map(action => (
                          <Button
                            key={action.key}
                            size="sm"
                            variant={action.variant}
                            onClick={action.onClick}
                            disabled={action.disabled}
                          >
                            {action.disabled && action.pendingLabel ? action.pendingLabel : action.label}
                          </Button>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {topPriorityItems.map(item => (
                  <div key={`top-${item.id}`} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={item.urgency} />
                      <span className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                        {item.priorityScore}/100
                      </span>
                    </div>
                    <p className="mt-3 font-medium text-zinc-900">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.actionLabel}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
                      <span>{item.kind}</span>
                      <span>{item.sourceLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              A inbox nao tem itens urgentes no momento.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plano de ataque do dia</CardTitle>
          <CardDescription>
            Sequencia sugerida de execucao para sair da teoria e transformar a inbox em acao.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {attackPlanItems.length ? (
            <>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700">
                {attackPlanLead}
              </div>

              <div className="space-y-3">
                {attackPlanItems.map((item, index) => {
                  const attackActions = buildInboxItemActions(item).slice(0, 3);
                  return (
                    <div key={`attack-${item.id}`} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex size-7 items-center justify-center rounded-full bg-orange-50 text-xs font-semibold text-orange-600">
                              {index + 1}
                            </span>
                            <p className="font-medium text-zinc-900">{item.title}</p>
                            <StatusBadge status={item.urgency} />
                          </div>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {getAttackPlanReason(item, index)}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-zinc-400">
                            <span>{item.actionLabel}</span>
                            <span>score {item.priorityScore}</span>
                            <span>{item.sourceLabel}</span>
                            <span>{formatDateTimeLabel(item.createdAt)}</span>
                          </div>
                        </div>
                        {attackActions.length ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            {attackActions.map(action => (
                              <Button
                                key={action.key}
                                size="sm"
                                variant={action.variant}
                                onClick={action.onClick}
                                disabled={action.disabled}
                              >
                                {action.disabled && action.pendingLabel ? action.pendingLabel : action.label}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              O plano do dia esta leve: mantenha a rotina e acompanhe a inbox conforme novos sinais aparecerem.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sugestoes do mentor</CardTitle>
          <CardDescription>
            A camada mais direta da inbox: uma acao principal e ate duas de apoio, todas executaveis daqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {primaryOperationalSuggestion ? (
            <>
              <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={primaryOperationalSuggestion.urgency} />
                      <span className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                        impacto {primaryOperationalSuggestion.impact}
                      </span>
                      <span className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                        score {primaryOperationalSuggestion.priorityScore}/100
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-semibold text-zinc-900">
                      {primaryOperationalSuggestion.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">
                      {getOperationalActionLead(primaryOperationalSuggestion)}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {primaryOperationalSuggestion.description}
                    </p>
                    <p className="mt-3 text-sm text-zinc-600">
                      Proxima melhor acao: {primaryOperationalSuggestion.actionLabel}.
                    </p>
                  </div>
                  <div className="space-y-3 text-right text-xs uppercase tracking-[0.16em] text-zinc-400">
                    <div>
                      <div>{primaryOperationalSuggestion.sourceLabel}</div>
                      <div className="mt-1">
                        {formatDateTimeLabel(primaryOperationalSuggestion.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {buildInboxItemActions(primaryOperationalSuggestion)
                        .slice(0, 3)
                        .map(action => (
                          <Button
                            key={action.key}
                            size="sm"
                            variant={action.variant}
                            onClick={action.onClick}
                            disabled={action.disabled}
                          >
                            {action.disabled && action.pendingLabel ? action.pendingLabel : action.label}
                          </Button>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              {supportingOperationalSuggestions.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {supportingOperationalSuggestions.map(item => (
                    <div key={`support-${item.id}`} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-zinc-900">{item.title}</p>
                            <StatusBadge status={item.urgency} />
                          </div>
                          <p className="text-sm leading-6 text-zinc-600">
                            {getOperationalActionSupport(item)}
                          </p>
                          <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-zinc-400">
                            <span>{item.actionLabel}</span>
                            <span>{item.sourceLabel}</span>
                            <span>score {item.priorityScore}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {buildInboxItemActions(item)
                            .slice(0, 2)
                            .map(action => (
                              <Button
                                key={action.key}
                                size="sm"
                                variant={action.variant}
                                onClick={action.onClick}
                                disabled={action.disabled}
                              >
                                {action.disabled && action.pendingLabel ? action.pendingLabel : action.label}
                              </Button>
                            ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              O mentor nao encontrou nenhuma acao operacional urgente agora. A inbox esta sob controle.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fila operacional</CardTitle>
          <CardDescription>
            Filtre o que precisa de atencao agora por tipo, origem e texto livre.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "todos", label: "Tudo" },
              { key: "pendencias", label: "Pendencias" },
              { key: "alertas", label: "Alertas" },
              { key: "mensagens", label: "Mensagens" },
            ].map(item => (
              <Button
                key={item.key}
                type="button"
                variant={inboxFilter === item.key ? "default" : "outline"}
                onClick={() => setInboxFilter(item.key as InboxFilter)}
              >
                {item.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={onlyPending ? "default" : "outline"}
              onClick={() => setOnlyPending(current => !current)}
            >
              So pendentes
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por texto, leitura, origem ou tipo..."
            />
            <Select value={sourceFilter} onValueChange={value => setSourceFilter(value as SourceFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as origens</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="painel">Painel</SelectItem>
                <SelectItem value="automacao">Automacao</SelectItem>
                <SelectItem value="previa">Previa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            {filteredInboxItems.length ? (
              filteredInboxItems.map(item => {
                const itemActions = buildInboxItemActions(item);
                return (
                  <div key={item.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-zinc-900">{item.title}</p>
                          <StatusBadge status={item.status} />
                          <StatusBadge status={item.urgency} />
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-zinc-400">
                          <span>score {item.priorityScore}</span>
                          <span>{item.kind}</span>
                          <span>{item.sourceLabel}</span>
                          <span>impacto {item.impact}</span>
                          {item.intentLabel ? <span>{item.intentLabel}</span> : null}
                          {item.metaLabel ? <span>{item.metaLabel}</span> : null}
                          <span>{formatDateTimeLabel(item.createdAt)}</span>
                        </div>
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Proxima melhor acao: {item.actionLabel}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {itemActions.map(action => (
                          <Button
                            key={action.key}
                            size="sm"
                            variant={action.variant}
                            onClick={action.onClick}
                            disabled={action.disabled}
                          >
                            {action.disabled && action.pendingLabel ? action.pendingLabel : action.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhum item encontrado com os filtros atuais.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Threads</CardTitle>
            <CardDescription>Escolha uma conversa para abrir o historico detalhado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {inbox?.threads.length ? inbox.threads.map(thread => (
              <button
                key={thread.id}
                type="button"
                onClick={() => setSelectedThreadId(thread.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  selectedThread?.id === thread.id
                    ? "border-orange-200 bg-orange-50/40"
                    : "hover:border-zinc-300"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">Thread #{thread.id}</p>
                    <p className="text-sm text-muted-foreground">
                      Ultima mensagem: {thread.latestMessage?.textContent || "Sem mensagens"}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
                      {thread.lastMessageAt
                        ? formatDateTimeLabel(thread.lastMessageAt)
                        : "Sem atividade recente"}
                    </p>
                  </div>
                  <StatusBadge status={thread.pendingRun?.status || "ativo"} />
                </div>
              </button>
            )) : (
              <p className="text-sm text-muted-foreground">Nenhuma conversa registrada ainda.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selectedThread ? `Thread #${selectedThread.id}` : "Historico da conversa"}</CardTitle>
            <CardDescription>
              Abertura detalhada da thread selecionada para decidir e agir com contexto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedThread?.pendingRun ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4" />
                      <p className="font-medium text-amber-900">Confirmacao pendente</p>
                    </div>
                    <p className="leading-6">
                      {selectedThread.pendingRun.assistantResponse ||
                        "Existe uma confirmacao aguardando sua decisao."}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-amber-700/80">
                      <span>
                        {formatMentorIntent(selectedThread.pendingRun.normalizedIntent) ||
                          selectedThread.pendingRun.normalizedIntent ||
                          "confirmacao"}
                      </span>
                      <span>{formatDateTimeLabel(selectedThread.pendingRun.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => confirmPendingRunMut.mutate({ runId: selectedThread.pendingRun!.id })}
                      disabled={confirmPendingRunMut.isPending || snoozePendingRunMut.isPending}
                    >
                      {confirmPendingRunMut.isPending ? "Confirmando..." : "Confirmar no app"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => snoozePendingRunMut.mutate({ runId: selectedThread.pendingRun!.id })}
                      disabled={confirmPendingRunMut.isPending || snoozePendingRunMut.isPending}
                    >
                      {snoozePendingRunMut.isPending ? "Adiando..." : "Adiar no app"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedThreadMessages.length ? (
              selectedThreadMessages.map(message => {
                const source = getMentorMessageSource(message.rawPayload);
                return (
                  <div key={message.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                        {message.direction === "inbound" ? (
                          <MessageCircle className="size-4 text-zinc-500" />
                        ) : (
                          <Sparkles className="size-4 text-orange-500" />
                        )}
                        {message.direction === "inbound" ? "Recebida" : "Enviada"}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase tracking-[0.16em] text-zinc-400">
                          {formatDateTimeLabel(message.createdAt)}
                        </span>
                        <StatusBadge status={message.status} />
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {message.textContent}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-zinc-400">
                      <span>{source.label}</span>
                      {message.detectedIntent ? (
                        <span>{formatMentorIntent(message.detectedIntent) || message.detectedIntent}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                {selectedThread
                  ? "Essa conversa ainda nao tem mensagens salvas."
                  : "Nenhuma conversa registrada ainda."}
              </div>
            )}

            {!selectedThread && alertItems.length ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <div className="flex items-center gap-2">
                  <BellRing className="size-4" />
                  Selecione uma thread ou use a fila operacional acima para agir sobre alertas e confirmacoes.
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
