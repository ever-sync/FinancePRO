import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/format";

function formatDateTime(value?: string | Date | null) {
  if (!value) return "Sem registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function WhatsAppAutomacao() {
  const utils = trpc.useUtils();
  const { data: events, isLoading } = trpc.assistantAutomation.list.useQuery();
  const { data: opsSummary } = trpc.assistantAutomation.summary.useQuery();
  const { data: dailyDigest } = trpc.financialAdvisor.getDailyDigest.useQuery();
  const { data: monthClose } = trpc.financialAdvisor.getMonthClose.useQuery();

  const refreshAutomationViews = async () => {
    await Promise.all([
      utils.assistantAutomation.list.invalidate(),
      utils.assistantAutomation.summary.invalidate(),
      utils.financialAdvisor.getDailyDigest.invalidate(),
      utils.financialAdvisor.getMonthClose.invalidate(),
      utils.assistantAudit.list.invalidate(),
    ]);
  };

  const runDailyMut = trpc.assistantAutomation.runDaily.useMutation({
    onSuccess: async data => {
      await refreshAutomationViews();
      toast.success(`Digest diario executado. ${data.processed} integracao(oes) processada(s).`);
    },
    onError: error => toast.error(error.message),
  });

  const runMonthStartMut = trpc.assistantAutomation.runMonthStart.useMutation({
    onSuccess: async data => {
      await refreshAutomationViews();
      toast.success(`Inicio do mes executado. ${data.processed} integracao(oes) processada(s).`);
    },
    onError: error => toast.error(error.message),
  });

  const runMonthEndMut = trpc.assistantAutomation.runMonthEnd.useMutation({
    onSuccess: async data => {
      await refreshAutomationViews();
      toast.success(`Fechamento do mes executado. ${data.processed} integracao(oes) processada(s).`);
    },
    onError: error => toast.error(error.message),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando automacoes...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automacao</h1>
        <p className="text-sm text-muted-foreground">
          Monitoramento dos resumos diarios, alertas imediatos e rotinas de inicio e fim de mes.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Saude operacional</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <StatusBadge status={opsSummary?.operationalStatus || "attention"} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {opsSummary?.integration?.lastConnectionMessage || "Sem mensagem operacional recente."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Runs pendentes</CardDescription>
            <CardTitle className="text-xl">{opsSummary?.counts.pendingRuns ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Runs aguardando confirmacao ou processamento.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Falhas recentes</CardDescription>
            <CardTitle className="text-xl">
              {(opsSummary?.counts.failedRuns ?? 0) + (opsSummary?.counts.failedEvents ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Soma de runs e eventos com erro.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ultimo webhook</CardDescription>
            <CardTitle className="text-base">
              {formatDateTime(opsSummary?.integration?.lastWebhookReceivedAt)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Referencia operacional da integracao do WhatsApp.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Disparo manual e diagnostico</CardTitle>
          <CardDescription>
            Rode as rotinas do assistente sob demanda e confira rapidamente se o canal esta apto para automacao.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => runDailyMut.mutate()}
              disabled={runDailyMut.isPending}
            >
              {runDailyMut.isPending ? "Rodando digest..." : "Rodar digest agora"}
            </Button>
            <Button
              variant="outline"
              onClick={() => runMonthStartMut.mutate()}
              disabled={runMonthStartMut.isPending}
            >
              {runMonthStartMut.isPending ? "Rodando inicio..." : "Rodar inicio do mes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => runMonthEndMut.mutate()}
              disabled={runMonthEndMut.isPending}
            >
              {runMonthEndMut.isPending ? "Rodando fechamento..." : "Rodar fechamento do mes"}
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Conexao</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={opsSummary?.integration?.lastConnectionStatus || "attention"} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {opsSummary?.integration?.lastConnectionMessage || "Sem retorno recente da integracao."}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Ultima mensagem recebida</p>
              <p className="mt-2 text-sm font-medium">{formatDateTime(opsSummary?.integration?.lastMessageReceivedAt)}</p>
              <p className="mt-2 text-sm text-muted-foreground">Ajuda a validar se o canal ainda esta ativo.</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Ultima mensagem enviada</p>
              <p className="mt-2 text-sm font-medium">{formatDateTime(opsSummary?.integration?.lastMessageSentAt)}</p>
              <p className="mt-2 text-sm text-muted-foreground">Confirma se o envio automatizado esta saindo.</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Ultima falha critica</p>
              <p className="mt-2 text-sm font-medium">
                {opsSummary?.latest?.lastFailedRun?.normalizedIntent ||
                  opsSummary?.latest?.lastFailedRun?.triggerType ||
                  opsSummary?.latest?.lastFailedEvent?.type ||
                  "Nenhuma falha critica recente"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {opsSummary?.latest?.lastFailedRun?.errorMessage || opsSummary?.latest?.lastFailedEvent?.messageBody || "Sem erro bloqueando a automacao agora."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {opsSummary?.criticalAlerts?.length ? (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardHeader>
            <CardTitle>Alertas operacionais</CardTitle>
            <CardDescription>Os pontos abaixo merecem atencao antes de confiar nas automacoes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {opsSummary.criticalAlerts.map(alert => (
              <div key={alert} className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-sm text-amber-900">
                {alert}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Prévia do digest diário</CardTitle>
            <CardDescription>Mensagem base das 08:00 com limite seguro e prioridades do dia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl border p-4">
              <p className="text-sm text-muted-foreground">Gasto seguro hoje</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(dailyDigest?.snapshot.safeToSpendNow || 0)}</p>
              <p className="mt-3 text-sm text-muted-foreground">{dailyDigest?.message || "Sem prévia disponível."}</p>
            </div>
            {dailyDigest?.alerts?.length ? dailyDigest.alerts.map(alert => (
              <div key={alert} className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {alert}
              </div>
            )) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prévia do fechamento do mês</CardTitle>
            <CardDescription>Resumo gerencial que fecha o ciclo e direciona o próximo mês.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl border p-4">
              <p className="text-sm text-muted-foreground">Desvio contra o plano</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(monthClose?.deviation || 0)}</p>
              <p className="mt-3 text-sm text-muted-foreground">{monthClose?.message || "Sem fechamento calculado."}</p>
            </div>
            {monthClose?.excessSignals?.length ? monthClose.excessSignals.map(signal => (
              <div key={signal} className="rounded-2xl border px-4 py-3 text-sm text-muted-foreground">
                {signal}
              </div>
            )) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {[
          { label: "Digest diario", event: opsSummary?.latest.dailyDigest },
          { label: "Inicio do mes", event: opsSummary?.latest.monthStart },
          { label: "Fechamento do mes", event: opsSummary?.latest.monthEnd },
        ].map(item => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="flex items-center gap-2 text-base">
                <StatusBadge status={item.event?.status || "agendado"} />
                <span>{formatDateTime(item.event?.createdAt)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {item.event?.title || "Sem evento registrado ainda."}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Eventos automatizados</CardTitle>
          <CardDescription>Os crons usam os endpoints server-side do deploy atual.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {events?.length ? events.map(event => (
            <div key={event.id} className="rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-muted-foreground">{event.messageBody}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
                    {event.type} · {event.scope}
                  </p>
                </div>
                <StatusBadge status={event.status} />
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">Nenhum evento automatizado registrado ainda.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
