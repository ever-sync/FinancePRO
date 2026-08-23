import { formatBRLCents } from "../shared/financial-core";
import * as coreDb from "./db/financial-core";
import * as whatsappDb from "./db/whatsapp";
import { getCanonicalFinancialSnapshot } from "./financial-core";
import { sendScheduledFinancialMessage } from "./whatsapp";

const CONFIRMED_STATUSES = new Set(["confirmed", "paid", "received"]);

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return {
    year,
    month,
    day,
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function addIsoDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonthsClamped(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(
    Math.min(
      originalDay,
      new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
      ).getUTCDate()
    )
  );
  return result;
}

export function nextReminderOccurrence(reference: Date, rule?: string | null) {
  if (!rule?.trim()) return null;
  const normalized = rule.trim().toUpperCase();
  const frequency =
    normalized === "DAILY" || normalized === "DIARIO"
      ? "DAILY"
      : normalized === "WEEKLY" || normalized === "SEMANAL"
        ? "WEEKLY"
        : normalized === "MONTHLY" || normalized === "MENSAL"
          ? "MONTHLY"
          : normalized.match(/(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/)?.[1];
  if (!frequency) return null;
  const intervalMatch = normalized.match(/(?:^|;)INTERVAL=(\d{1,3})(?:;|$)/);
  const interval = Math.max(1, Number(intervalMatch?.[1] ?? 1));
  if (frequency === "MONTHLY") return addMonthsClamped(reference, interval);
  const next = new Date(reference);
  next.setUTCDate(
    next.getUTCDate() + interval * (frequency === "WEEKLY" ? 7 : 1)
  );
  return next;
}

function transactionIsConfirmed(transaction: {
  status: string;
  reversedAt: Date | null;
  reversalOfId: number | null;
}) {
  return (
    CONFIRMED_STATUSES.has(transaction.status) &&
    !transaction.reversedAt &&
    !transaction.reversalOfId
  );
}

function messageForRecurring(
  item: {
    type: string;
    name: string;
    amountCents: number;
    nextDueDate: string | null;
    estimated: boolean;
    needsConfirmation: boolean;
  },
  today: string
) {
  const amount = formatBRLCents(item.amountCents);
  const qualifier = item.estimated ? "estimado" : "previsto";
  if (item.type === "income") {
    if (item.nextDueDate && item.nextDueDate < today) {
      return `O recebimento ${item.name}, de ${amount} (${qualifier}), passou da data prevista e ainda nao foi confirmado. Recebeu?`;
    }
    return `Hoje esta previsto ${item.name}, de ${amount}. Valor previsto nao e saldo confirmado: me avise quando entrar.`;
  }
  return `Lembrete: ${item.name}, de ${amount} (${qualifier}), esta proximo. ${item.needsConfirmation ? "Confirme o valor real e o vencimento." : "Avise quando pagar para eu atualizar o plano."}`;
}

export async function scheduleCanonicalNotificationsForUser(
  userId: number,
  now = new Date()
) {
  const scope = await coreDb.resolveFinancialScope(userId);
  const profile = await coreDb.getFinancialProfile(scope);
  if (!profile || !profile.notificationsOptIn)
    return { scheduled: 0, skipped: true };
  if (
    profile.notificationsPausedUntil &&
    profile.notificationsPausedUntil.getTime() > now.getTime()
  ) {
    return { scheduled: 0, skipped: true };
  }
  const local = localDateParts(now, profile.timezone);
  const tomorrow = addIsoDays(local.iso, 1);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const [recurring, tasks, uncategorized, snapshot, weeklyTransactions] =
    await Promise.all([
      coreDb.listRecurringCashflows(scope),
      coreDb.listFinancialTasks(scope),
      coreDb.listUncategorizedTransactions(scope),
      getCanonicalFinancialSnapshot(userId, {
        expectedTenantId: scope.tenantId,
        asOf: now,
      }),
      coreDb.listFinancialTransactions(scope, {
        start: weekStart,
        end: now,
        limit: 1_000,
      }),
    ]);
  let scheduled = 0;
  const add = async (
    templateKey: string,
    idempotencyKey: string,
    text: string,
    payload: Record<string, unknown> = {}
  ) => {
    const result = await coreDb.scheduleNotificationIdempotently(scope, {
      templateKey,
      scheduledAt: now,
      idempotencyKey,
      payload: { text, ...payload },
    });
    if (!result.alreadyScheduled) scheduled += 1;
  };

  for (const item of recurring) {
    if (!item.nextDueDate) continue;
    if (
      item.type === "income" &&
      item.status !== "received" &&
      item.nextDueDate === tomorrow
    ) {
      await add(
        "income_plan_previous_day",
        `income-plan:${item.id}:${item.nextDueDate}`,
        `Amanha esta previsto ${item.name}, de ${formatBRLCents(item.amountCents)}. Vou tratar como esperado ate voce confirmar. Antes de gastar, revise contas, reserva e prioridades.`,
        { recurringCashflowId: item.id, dueDate: item.nextDueDate }
      );
      continue;
    }
    const shouldRemind =
      item.type === "income"
        ? item.status !== "received" && item.nextDueDate <= local.iso
        : !["paid", "cancelled"].includes(item.status) &&
          item.nextDueDate <= tomorrow;
    if (!shouldRemind) continue;
    await add(
      item.type === "income" ? "income_confirmation" : "bill_reminder",
      `recurring:${item.id}:${item.nextDueDate}:${item.status}`,
      messageForRecurring(item, local.iso),
      { recurringCashflowId: item.id, dueDate: item.nextDueDate }
    );
  }

  const dueTasks = tasks.filter(
    task =>
      task.status === "open" &&
      task.dueAt &&
      task.dueAt.getTime() <= now.getTime() + 24 * 60 * 60 * 1_000
  );
  for (const task of dueTasks.slice(0, 5)) {
    await add(
      "task_due",
      `task:${task.id}:${local.iso}`,
      `Prioridade ${task.priority}: ${task.title}`,
      { taskId: task.id }
    );
  }

  if (uncategorized.length > 0) {
    await add(
      "uncategorized_review",
      `uncategorized:${userId}:${local.iso}`,
      `Existem ${uncategorized.length} lancamento(s) sem categoria. Quer revisar comigo agora?`,
      { count: uncategorized.length }
    );
  }
  if (snapshot.configured) {
    const periodKey =
      snapshot.budgets.period?.id ?? `${local.year}-${local.month}`;
    for (const envelope of snapshot.budgets.envelopes) {
      if (envelope.plannedCents <= 0) continue;
      const usedPercent = Math.floor(
        (envelope.spentCents / envelope.plannedCents) * 100
      );
      const threshold = [100, 90, 75, 50].find(
        candidate => usedPercent >= candidate
      );
      if (!threshold) continue;
      const remainingCents = Math.max(
        0,
        envelope.plannedCents - envelope.spentCents
      );
      const text =
        threshold >= 100
          ? `${envelope.name} atingiu 100% do orcamento. Novos gastos opcionais nao sao recomendados ate revisar o plano.`
          : `${envelope.name} chegou a ${usedPercent}% do orcamento; restam ${formatBRLCents(remainingCents)}.`;
      await add(
        threshold === 50 ? "daily_summary" : "budget_alert",
        `budget:${periodKey}:${envelope.id}:${threshold}`,
        text,
        { envelopeId: envelope.id, threshold, usedPercent }
      );
    }

    const lastConfirmed = snapshot.dataFreshness.lastBalanceConfirmedAt;
    const stale =
      !lastConfirmed ||
      now.getTime() - new Date(lastConfirmed).getTime() > 3 * 86_400_000;
    if (stale) {
      await add(
        "balance_stale",
        `balance-stale:${userId}:${local.iso}`,
        "Seu saldo confirmado esta desatualizado. Envie o saldo PF e PJ ou importe o extrato antes de tomar uma decisao de compra."
      );
    }
    if (snapshot.debts.urgentCents > 0) {
      await add(
        "urgent_debt",
        `urgent-debt:${userId}:${local.iso}`,
        `Ha ${formatBRLCents(snapshot.debts.urgentCents)} em divida urgente. Confirme vencimento e quitacao antes de comprometer novas compras.`
      );
    }

    const confirmedWeekly = weeklyTransactions.filter(transactionIsConfirmed);
    const weeklyIncomeCents = confirmedWeekly
      .filter(item => item.type === "income")
      .reduce((sum, item) => sum + item.amountCents, 0);
    const weeklyExpenseCents = confirmedWeekly
      .filter(item => item.type === "expense")
      .reduce((sum, item) => sum + item.amountCents, 0);
    const smallExpenses = confirmedWeekly.filter(
      item => item.type === "expense" && item.amountCents < 10_000
    );
    const smallExpensesCents = smallExpenses.reduce(
      (sum, item) => sum + item.amountCents,
      0
    );
    const categoryNames = new Map(
      snapshot.categories.map(category => [category.id, category.name])
    );
    const smallByCategory = new Map<string, number>();
    for (const transaction of smallExpenses) {
      const category = transaction.categoryId
        ? (categoryNames.get(transaction.categoryId) ?? "Outros")
        : "Sem categoria";
      smallByCategory.set(
        category,
        (smallByCategory.get(category) ?? 0) + transaction.amountCents
      );
    }
    const topSmallCategories = Array.from(smallByCategory.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([name]) => name)
      .join(", ");

    if (local.weekday === "Sun" && local.hour >= 18) {
      await add(
        "weekly_summary",
        `weekly:${userId}:${local.iso}`,
        `Revisao semanal: entrou ${formatBRLCents(weeklyIncomeCents)}, saiu ${formatBRLCents(weeklyExpenseCents)} e ${smallExpenses.length} pequenos gastos somaram ${formatBRLCents(smallExpensesCents)}${topSmallCategories ? ` (${topSmallCategories})` : ""}. Reserva: ${formatBRLCents(snapshot.balances.reserveCents)}. Projetos em aberto: ${snapshot.projects.items.filter(project => project.status === "active").length}. Proximas acoes: confirmar saldos, revisar ${uncategorized.length} lancamento(s) e proteger as prioridades.`,
        { weekStart: weekStart.toISOString(), smallExpensesCents }
      );
    }

    if (local.weekday === "Mon" && local.hour >= 8) {
      await add(
        "project_monday_goal",
        `project-monday:${userId}:${local.iso}`,
        `Meta comercial da semana: avance propostas e busque ${formatBRLCents(snapshot.projects.monthlyGrossTargetCents)} no mes. Pipeline esperado: ${formatBRLCents(snapshot.projects.expectedCents)}.`
      );
    }
    if (local.weekday === "Wed" && local.hour >= 8) {
      const followUps = snapshot.projects.items.filter(project =>
        ["lead", "proposal", "negotiation"].includes(project.stage)
      ).length;
      if (followUps > 0) {
        await add(
          "project_wednesday_followups",
          `project-wednesday:${userId}:${local.iso}`,
          `Meio da semana: existem ${followUps} projeto(s) em lead, proposta ou negociacao. Qual follow-up voce vai fazer hoje?`
        );
      }
    }
    if (local.weekday === "Fri" && local.hour >= 8) {
      const distanceCents = Math.max(
        0,
        snapshot.projects.monthlyGrossTargetCents -
          snapshot.projects.receivedCents
      );
      await add(
        "project_friday_close",
        `project-friday:${userId}:${local.iso}`,
        `Fechamento comercial: recebido ${formatBRLCents(snapshot.projects.receivedCents)}, previsto ${formatBRLCents(snapshot.projects.expectedCents)} e faltam ${formatBRLCents(distanceCents)} para a meta mensal.`
      );
    }

    if (
      local.day === lastDayOfMonth(local.year, local.month) &&
      local.hour >= 18
    ) {
      await add(
        "canonical_month_end",
        `canonical-month-end:${userId}:${local.year}-${local.month}`,
        `Fechamento do mes: receitas confirmadas ${formatBRLCents(snapshot.cashflow.confirmedIncomeCents)}, despesas ${formatBRLCents(snapshot.cashflow.confirmedExpenseCents)}, saldo PF ${formatBRLCents(snapshot.balances.personalCents)}, PJ ${formatBRLCents(snapshot.balances.businessCents)} e reserva ${formatBRLCents(snapshot.balances.reserveCents)}. Proximo passo: revisar orcamento e metas do novo mes.`
      );
    }
  }
  return { scheduled, skipped: false };
}

export async function scheduleCanonicalNotifications(now = new Date()) {
  const integrations = await whatsappDb.listEnabledWhatsAppIntegrations();
  let scheduled = 0;
  let skipped = 0;
  for (const integration of integrations) {
    try {
      const result = await scheduleCanonicalNotificationsForUser(
        integration.userId,
        now
      );
      scheduled += result.scheduled;
      if (result.skipped) skipped += 1;
    } catch (error) {
      console.warn("[Financial Automation] Scheduling failed", {
        userId: integration.userId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { scheduled, skipped, integrations: integrations.length };
}

export async function dispatchCanonicalNotifications(
  now = new Date(),
  limit = 50
) {
  const due = await coreDb.listDueScheduledNotifications(now, limit);
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  for (const notification of due) {
    const claimed = await coreDb.claimScheduledNotification(notification.id);
    if (!claimed) continue;
    try {
      const payload =
        claimed.payload && typeof claimed.payload === "object"
          ? (claimed.payload as Record<string, unknown>)
          : {};
      const text =
        typeof payload.text === "string"
          ? payload.text
          : "Atualizacao financeira disponivel.";
      const result = await sendScheduledFinancialMessage({
        userId: claimed.userId,
        text,
        templateKey: claimed.templateKey,
        idempotencyKey: claimed.idempotencyKey,
      });
      if (!result.success && result.reason === "notifications_paused") {
        await coreDb.deferScheduledNotification(
          claimed.id,
          new Date(now.getTime() + 60 * 60_000)
        );
        deferred += 1;
        continue;
      }
      if (!result.success) throw new Error("Integracao WhatsApp indisponivel");
      await coreDb.markScheduledNotificationSent(claimed.id);
      sent += 1;
      const recurrenceRule =
        typeof payload.recurrenceRule === "string"
          ? payload.recurrenceRule
          : null;
      const nextOccurrence = nextReminderOccurrence(now, recurrenceRule);
      if (nextOccurrence) {
        const rootIdempotencyKey =
          typeof payload.rootIdempotencyKey === "string"
            ? payload.rootIdempotencyKey
            : claimed.idempotencyKey;
        try {
          await coreDb.scheduleNotificationIdempotently(
            { tenantId: claimed.tenantId, userId: claimed.userId },
            {
              templateKey: claimed.templateKey,
              scheduledAt: nextOccurrence,
              idempotencyKey:
                `${rootIdempotencyKey}:recurrence:${nextOccurrence.toISOString()}`.slice(
                  0,
                  255
                ),
              payload: {
                ...payload,
                recurrenceRule,
                rootIdempotencyKey,
              },
            }
          );
        } catch (error) {
          console.warn("[Financial Automation] Recurrence scheduling failed", {
            notificationId: claimed.id,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }
    } catch (error) {
      await coreDb.markScheduledNotificationFailed(
        claimed.id,
        claimed.attempts + 1,
        error instanceof Error ? error.message : "Falha desconhecida"
      );
      failed += 1;
    }
  }
  return { due: due.length, sent, failed, deferred };
}

export async function runCanonicalFinancialAutomation(now = new Date()) {
  const scheduling = await scheduleCanonicalNotifications(now);
  const dispatch = await dispatchCanonicalNotifications(now);
  return { scheduling, dispatch };
}
