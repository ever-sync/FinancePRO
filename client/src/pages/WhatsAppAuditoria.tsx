import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";

export default function WhatsAppAuditoria() {
  const { data: runs, isLoading } = trpc.assistantAudit.list.useQuery();
  const failedRuns = runs?.filter(run => run.status === "falhou" || run.errorMessage) ?? [];
  const pendingRuns = runs?.filter(
    run => run.status === "aguardando_confirmacao" || run.status === "recebido" || run.status === "analisado"
  ) ?? [];

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando auditoria...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Trilhas das execucoes da IA com contexto, intencao detectada e status final.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total de runs</CardDescription>
            <CardTitle className="text-xl">{runs?.length ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Todas as execucoes do assistente registradas.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pendentes</CardDescription>
            <CardTitle className="text-xl">{pendingRuns.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Aguardando confirmacao ou tratamento.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Falhas</CardDescription>
            <CardTitle className="text-xl">{failedRuns.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Runs com erro final ou mensagem de falha.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Execucoes do assistente</CardTitle>
          <CardDescription>Recebido, analisado, aguardando confirmacao, executado ou falhou.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {runs?.length ? runs.map(run => (
            <div key={run.id} className="rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{run.normalizedIntent || "sem intencao"}</p>
                  <p className="text-sm text-muted-foreground">{run.assistantResponse || run.userMessage || "-"}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-400">{run.triggerType}</p>
                  {run.errorMessage ? (
                    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {run.errorMessage}
                    </div>
                  ) : null}
                </div>
                <StatusBadge status={run.status} />
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">Nenhuma execucao registrada ainda.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
