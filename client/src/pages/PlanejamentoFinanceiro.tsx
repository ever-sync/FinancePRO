import { useMemo, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  Car,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  Goal,
  Loader2,
  PiggyBank,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Undo2,
  Upload,
  WalletCards,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const today = new Date().toISOString().slice(0, 10);

function formatCents(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function parseMoneyToCents(value: string) {
  const normalized = value
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [integer, fraction = ""] = normalized.split(".");
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function requestId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function priorityLabel(priority: string) {
  if (priority === "critical") return "Crítica";
  if (priority === "essential") return "Essencial (A)";
  if (priority === "important") return "Importante (B)";
  if (priority === "optional") return "Opcional (C)";
  return priority;
}

function decisionLabel(decision: string) {
  const labels: Record<string, string> = {
    approved_safe: "Compra segura",
    approved_with_adjustments: "Cabe com ajustes",
    not_recommended: "Não recomendada",
    blocked_by_missing_data: "Faltam dados",
    fits_safely: "Carro cabe com segurança",
    fits_with_risk: "Carro cabe com risco",
  };
  return labels[decision] ?? "Não recomendado";
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  return (
    <Card className="overflow-hidden rounded-3xl border-zinc-200 shadow-sm">
      <CardContent className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </p>
        <p
          className={cn(
            "mt-3 text-2xl font-semibold tracking-tight",
            tone === "positive" && "text-emerald-700",
            tone === "warning" && "text-orange-700"
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

function EmptySetup({
  loading,
  onBootstrap,
}: {
  loading: boolean;
  onBootstrap: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-3xl items-center justify-center">
      <Card className="w-full rounded-[32px] border-zinc-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.1)]">
        <CardContent className="p-8 text-center md:p-12">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
            <Sparkles className="size-8" />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">
            Ative seu planejamento financeiro
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-600">
            O modelo Raphael cria contas PF/PJ separadas, reserva protegida,
            orçamento, metas familiares, dívida Asaas manual, regras de
            categorização e o plano de projetos 15/10/75. Tudo continua
            editável.
          </p>
          <Button
            className="mt-7 rounded-full bg-zinc-900 px-6 hover:bg-zinc-800"
            disabled={loading}
            onClick={onBootstrap}
          >
            {loading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            Aplicar modelo Raphael
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlanejamentoFinanceiro() {
  const utils = trpc.useUtils();
  const snapshotQuery = trpc.financialCore.snapshot.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const bootstrap = trpc.financialCore.bootstrapRaphael.useMutation({
    onSuccess: async () => {
      toast.success("Modelo financeiro aplicado com segurança.");
      await snapshotQuery.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const exportData = trpc.financialCore.exportData.useMutation({
    onSuccess: result => {
      const blob = new Blob([JSON.stringify(result.export, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `financepro-export-${today}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Exportação LGPD gerada.");
    },
    onError: error => toast.error(error.message),
  });
  const snapshot =
    snapshotQuery.data?.configured === true ? snapshotQuery.data : null;
  const refresh = async () => {
    await Promise.all([
      utils.financialCore.snapshot.invalidate(),
      utils.financialCore.transactions.invalidate(),
      utils.financialCore.goals.invalidate(),
      utils.financialCore.projects.invalidate(),
    ]);
  };

  if (snapshotQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-zinc-500">
        <Loader2 className="mr-2 size-5 animate-spin" /> Carregando
        planejamento...
      </div>
    );
  }
  if (!snapshot) {
    return (
      <EmptySetup
        loading={bootstrap.isPending}
        onBootstrap={() => bootstrap.mutate()}
      />
    );
  }

  const reserveProgress = snapshot.emergencyFund.minimumTargetCents
    ? Math.min(
        100,
        (snapshot.emergencyFund.balanceCents /
          snapshot.emergencyFund.minimumTargetCents) *
          100
      )
    : 0;
  const currentProfileIsTemplate = snapshot.profile.profileKey === "raphael-v1";

  return (
    <div className="-mx-4 -my-4 min-h-full bg-[#f5f5f3] p-4 text-zinc-950 md:-mx-6 md:-my-6 md:p-7">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-col gap-4 rounded-[30px] border border-zinc-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-orange-100 text-orange-800 hover:bg-orange-100">
                <Bot className="mr-1 size-3.5" /> Agente conectado
              </Badge>
              <Badge variant="outline" className="rounded-full">
                valores em centavos • BRL
              </Badge>
              <Badge variant="outline" className="rounded-full">
                PF/PJ isolados
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Cockpit financeiro de {snapshot.profile.displayName}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Saldo confirmado, previsões e decisões sem misturar dinheiro
              pessoal com empresa.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={exportData.isPending}
              onClick={() => exportData.mutate()}
            >
              <FileSpreadsheet className="mr-2 size-4" /> Exportar meus dados
            </Button>
            {!currentProfileIsTemplate && (
              <Button
                variant="outline"
                className="rounded-full"
                disabled={bootstrap.isPending}
                onClick={() => bootstrap.mutate()}
              >
                Aplicar modelo Raphael
              </Button>
            )}
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => snapshotQuery.refetch()}
              disabled={snapshotQuery.isFetching}
            >
              <RefreshCw
                className={cn(
                  "mr-2 size-4",
                  snapshotQuery.isFetching && "animate-spin"
                )}
              />
              Atualizar
            </Button>
          </div>
        </header>

        {!snapshot.dataFreshness.hasConfirmedBalance && (
          <Alert className="rounded-2xl border-amber-300 bg-amber-50 text-amber-950">
            <AlertTriangle className="size-4" />
            <AlertTitle>Saldo ainda não confirmado</AlertTitle>
            <AlertDescription>
              Simulações de compra ficam bloqueadas até você lançar os saldos ou
              importar o extrato Santander. Valores previstos não são tratados
              como dinheiro disponível.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Saldo operacional"
            value={formatCents(snapshot.balances.operatingCents)}
            detail="PF + PJ disponíveis; reserva fora deste valor"
            tone="positive"
          />
          <MetricCard
            label="Entradas confirmadas"
            value={formatCents(snapshot.cashflow.confirmedIncomeCents)}
            detail={`Previstas: ${formatCents(snapshot.cashflow.expectedIncomeCents)}`}
          />
          <MetricCard
            label="Custo de vida"
            value={formatCents(snapshot.cashflow.totalLivingCostCents)}
            detail={`${formatCents(snapshot.cashflow.monthlyFixedCostCents)} fixos + ${formatCents(snapshot.cashflow.monthlyVariableBudgetCents)} variáveis`}
          />
          <MetricCard
            label="Reserva protegida"
            value={formatCents(snapshot.emergencyFund.balanceCents)}
            detail={`${snapshot.emergencyFund.monthsCovered.toFixed(2)} meses cobertos`}
            tone="warning"
          />
          <MetricCard
            label="Dívida urgente"
            value={formatCents(snapshot.debts.urgentCents)}
            detail="Prioridade antes de novas compras"
            tone={snapshot.debts.urgentCents > 0 ? "warning" : "positive"}
          />
        </div>

        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-1.5">
            <TabsTrigger value="overview" className="rounded-xl">
              Visão geral
            </TabsTrigger>
            <TabsTrigger value="transactions" className="rounded-xl">
              Lançamentos
            </TabsTrigger>
            <TabsTrigger value="budget" className="rounded-xl">
              Orçamento
            </TabsTrigger>
            <TabsTrigger value="goals" className="rounded-xl">
              Metas e compras
            </TabsTrigger>
            <TabsTrigger value="projects" className="rounded-xl">
              Projetos
            </TabsTrigger>
            <TabsTrigger value="car" className="rounded-xl">
              Plano do carro
            </TabsTrigger>
            <TabsTrigger value="import" className="rounded-xl">
              Santander CSV
            </TabsTrigger>
            <TabsTrigger value="audit" className="rounded-xl">
              Auditoria
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              snapshot={snapshot}
              reserveProgress={reserveProgress}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="transactions">
            <TransactionsTab snapshot={snapshot} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="budget">
            <BudgetTab snapshot={snapshot} />
          </TabsContent>
          <TabsContent value="goals">
            <GoalsTab snapshot={snapshot} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="projects">
            <ProjectsTab snapshot={snapshot} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="car">
            <CarTab />
          </TabsContent>
          <TabsContent value="import">
            <SantanderImportTab snapshot={snapshot} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="audit">
            <FinancialAuditTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function OverviewTab({
  snapshot,
  reserveProgress,
  onChanged,
}: {
  snapshot: NonNullable<ReturnType<typeof useConfiguredSnapshot>>;
  reserveProgress: number;
  onChanged: () => Promise<void>;
}) {
  const notificationMutation =
    trpc.financialCore.setNotificationOptIn.useMutation({
      onSuccess: async () => {
        toast.success("Preferência de mensagens atualizada.");
        await onChanged();
      },
      onError: error => toast.error(error.message),
    });
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="rounded-3xl border-zinc-200 lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-5 text-orange-600" /> Cenários de
            12 meses
          </CardTitle>
          <CardDescription>
            Projeção determinística; renda prevista continua separada da
            confirmada.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {Object.entries(snapshot.scenarios).map(([name, points]) => {
            const ending = points.at(-1)?.endingBalanceCents ?? 0;
            const labels: Record<string, string> = {
              conservative: "Conservador",
              base: "Base",
              growth: "Crescimento",
              aggressive: "Agressivo",
            };
            return (
              <div
                key={name}
                className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
              >
                <p className="text-sm font-medium">{labels[name]}</p>
                <p
                  className={cn(
                    "mt-2 text-xl font-semibold",
                    ending < 0 && "text-rose-700"
                  )}
                >
                  {formatCents(ending)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Saldo projetado ao fim do mês 12
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <div className="space-y-5">
        <Card className="rounded-3xl border-zinc-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-700" /> Reserva de
              emergência
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-3">
              <p className="text-2xl font-semibold">
                {formatCents(snapshot.emergencyFund.balanceCents)}
              </p>
              <p className="text-xs text-zinc-500">
                meta {formatCents(snapshot.emergencyFund.minimumTargetCents)}
              </p>
            </div>
            <Progress value={reserveProgress} className="mt-4" />
            <p className="mt-3 text-xs text-zinc-500">
              Meta pós-carro:{" "}
              {formatCents(snapshot.emergencyFund.postCarTargetCents)}.
              Retiradas exigem confirmação adicional.
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-zinc-200">
          <CardHeader>
            <CardTitle className="text-base">Mensagens proativas</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Cobranças e resumos</p>
              <p className="text-xs text-zinc-500">
                Silêncio das {snapshot.profile.quietHoursStart} às{" "}
                {snapshot.profile.quietHoursEnd}
              </p>
            </div>
            <Switch
              checked={snapshot.profile.notificationsOptIn}
              disabled={notificationMutation.isPending}
              onCheckedChange={enabled =>
                notificationMutation.mutate({ enabled })
              }
            />
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-3xl border-zinc-200 lg:col-span-3">
        <CardHeader>
          <CardTitle>Próximas prioridades</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.tasks
            .filter(task => task.status === "open")
            .slice(0, 9)
            .map(task => (
              <div
                key={task.id}
                className="flex gap-3 rounded-2xl border border-zinc-200 p-4"
              >
                <Target className="mt-0.5 size-4 shrink-0 text-orange-600" />
                <div>
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Prioridade {task.priority}
                  </p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
      <AccountBalancesCard snapshot={snapshot} onChanged={onChanged} />
      <ConfirmationsCard snapshot={snapshot} onChanged={onChanged} />
    </div>
  );
}

function AccountBalancesCard({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  return (
    <Card className="rounded-3xl border-zinc-200 lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WalletCards className="size-5 text-blue-700" /> Saldos confirmados
        </CardTitle>
        <CardDescription>
          Atualize o saldo real de cada conta. Isso não cria receita nem
          movimenta o banco.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {snapshot.accounts.map(account => (
          <AccountBalanceRow
            key={account.id}
            account={account}
            onChanged={onChanged}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function AccountBalanceRow({
  account,
  onChanged,
}: {
  account: ConfiguredSnapshot["accounts"][number];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    (account.currentBalanceCents / 100).toFixed(2).replace(".", ",")
  );
  const [confirmation, setConfirmation] = useState("");
  const mutation = trpc.financialCore.setAccountBalance.useMutation({
    onSuccess: async () => {
      toast.success(`Saldo de ${account.name} confirmado.`);
      setEditing(false);
      setConfirmation("");
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const save = () => {
    const negative = value.trim().startsWith("-");
    const absolute = parseMoneyToCents(value.replace(/^-/, ""));
    if (absolute == null) return toast.error("Saldo inválido.");
    const balanceCents = negative ? -absolute : absolute;
    const reducingProtected =
      account.protected && balanceCents < account.currentBalanceCents;
    mutation.mutate({
      accountId: account.id,
      balanceCents,
      balanceAsOf: new Date(),
      ...(reducingProtected && confirmation === "CONFIRMAR REDUCAO DA RESERVA"
        ? {
            protectedReductionConfirmation:
              "CONFIRMAR REDUCAO DA RESERVA" as const,
          }
        : {}),
    });
  };
  const parsedValue = parseMoneyToCents(value.replace(/^-/, ""));
  const candidate =
    parsedValue == null
      ? account.currentBalanceCents
      : value.startsWith("-")
        ? -parsedValue
        : parsedValue;
  const reducingProtected =
    account.protected && candidate < account.currentBalanceCents;
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{account.name}</p>
          <p className="text-xs text-zinc-500">
            {account.ownerType === "business" ? "PJ" : "PF"}
            {account.protected ? " • protegida" : ""}
          </p>
        </div>
        {account.protected && (
          <ShieldCheck className="size-4 text-emerald-700" />
        )}
      </div>
      {!editing ? (
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">
              {formatCents(account.currentBalanceCents)}
            </p>
            <p className="text-[11px] text-zinc-500">
              {account.balanceAsOf
                ? `em ${new Date(account.balanceAsOf).toLocaleDateString("pt-BR")}`
                : "a confirmar"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Confirmar saldo
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <Input
            value={value}
            onChange={event => setValue(event.target.value)}
          />
          {reducingProtected && (
            <Input
              placeholder="CONFIRMAR REDUCAO DA RESERVA"
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={
                mutation.isPending ||
                (reducingProtected &&
                  confirmation !== "CONFIRMAR REDUCAO DA RESERVA")
              }
              onClick={save}
            >
              Salvar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmationsCard({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  const debtMutation = trpc.financialCore.updateDebt.useMutation({
    onSuccess: async () => {
      toast.success("Dívida atualizada.");
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  return (
    <Card className="rounded-3xl border-zinc-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-orange-700" /> Confirmações
          críticas
        </CardTitle>
        <CardDescription>Fatos que o agente não pode presumir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {snapshot.debts.items.map(debt => (
          <div
            key={debt.id}
            className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{debt.creditor}</p>
                <p className="text-xs text-amber-900">
                  {formatCents(debt.balanceCents)} •{" "}
                  {debt.dueDate || "vencimento a confirmar"}
                </p>
              </div>
              <Badge variant="destructive">{debt.status}</Badge>
            </div>
            {debt.balanceCents > 0 && (
              <Button
                size="sm"
                className="mt-3"
                disabled={debtMutation.isPending}
                onClick={() =>
                  debtMutation.mutate({
                    debtId: debt.id,
                    balanceCents: 0,
                    status: "paid",
                    needsConfirmation: false,
                  })
                }
              >
                Confirmar quitação manual
              </Button>
            )}
          </div>
        ))}
        <p className="text-xs leading-5 text-zinc-500">
          Custos fixos ainda estimados, datas de entradas pontuais e
          substituição do computador permanecem na lista de tarefas até
          confirmação.
        </p>
      </CardContent>
    </Card>
  );
}

function useConfiguredSnapshot() {
  const query = trpc.financialCore.snapshot.useQuery();
  return query.data?.configured ? query.data : null;
}

type ConfiguredSnapshot = NonNullable<ReturnType<typeof useConfiguredSnapshot>>;

function TransactionsTab({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    type: "expense" as "income" | "expense",
    accountId: String(snapshot.accounts[0]?.id ?? ""),
    categoryId: "none",
    amount: "",
    description: "",
    occurredAt: today,
  });
  const record = trpc.financialCore.recordTransaction.useMutation({
    onSuccess: async result => {
      toast.success(
        result.alreadyProcessed
          ? "Lançamento já existia."
          : "Lançamento salvo. Você pode desfazer por 15 minutos."
      );
      setForm(current => ({ ...current, amount: "", description: "" }));
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const undo = trpc.financialCore.undoTransaction.useMutation({
    onSuccess: async () => {
      toast.success("Lançamento desfeito sem apagar o histórico.");
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const categorize = trpc.financialCore.categorizeTransaction.useMutation({
    onSuccess: async () => {
      toast.success("Categoria atualizada e regra aprendida.");
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const submit = () => {
    const amountCents = parseMoneyToCents(form.amount);
    if (!amountCents || !form.accountId || !form.description.trim()) {
      toast.error("Informe conta, descrição e um valor válido.");
      return;
    }
    record.mutate({
      accountId: Number(form.accountId),
      type: form.type,
      amountCents,
      occurredAt: new Date(`${form.occurredAt}T12:00:00`),
      description: form.description,
      categoryId: form.categoryId === "none" ? null : Number(form.categoryId),
      status: form.type === "income" ? "received" : "paid",
      requestId: requestId("manual"),
    });
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <div className="space-y-5">
        <Card className="h-fit rounded-3xl border-zinc-200">
          <CardHeader>
            <CardTitle>Novo lançamento</CardTitle>
            <CardDescription>
              Registra no app; nunca movimenta o banco.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={form.type === "expense" ? "default" : "outline"}
                className="rounded-xl"
                onClick={() => setForm({ ...form, type: "expense" })}
              >
                <ArrowDownLeft className="mr-2 size-4" /> Despesa
              </Button>
              <Button
                type="button"
                variant={form.type === "income" ? "default" : "outline"}
                className="rounded-xl"
                onClick={() => setForm({ ...form, type: "income" })}
              >
                <ArrowUpRight className="mr-2 size-4" /> Receita
              </Button>
            </div>
            <Field label="Conta">
              <Select
                value={form.accountId}
                onValueChange={accountId => setForm({ ...form, accountId })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {snapshot.accounts.map(account => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.name} •{" "}
                      {formatCents(account.currentBalanceCents)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Valor">
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount}
                onChange={event =>
                  setForm({ ...form, amount: event.target.value })
                }
              />
            </Field>
            <Field label="Descrição">
              <Input
                placeholder="Ex.: mercado"
                value={form.description}
                onChange={event =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </Field>
            <Field label="Categoria">
              <Select
                value={form.categoryId}
                onValueChange={categoryId => setForm({ ...form, categoryId })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">A classificar</SelectItem>
                  {snapshot.categories.map(category => (
                    <SelectItem key={category.id} value={String(category.id)}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Data">
              <Input
                type="date"
                value={form.occurredAt}
                onChange={event =>
                  setForm({ ...form, occurredAt: event.target.value })
                }
              />
            </Field>
            <Button
              className="w-full rounded-xl"
              disabled={record.isPending}
              onClick={submit}
            >
              {record.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}{" "}
              Registrar
            </Button>
          </CardContent>
        </Card>
        <TransferCard snapshot={snapshot} onChanged={onChanged} />
      </div>
      <Card className="min-w-0 rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle>Linha do tempo</CardTitle>
          <CardDescription>
            Transferências aparecem, mas ficam fora de receitas/despesas
            consolidadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.recentTransactions.map(transaction => {
                const account = snapshot.accounts.find(
                  item => item.id === transaction.accountId
                );
                const reversed = Boolean(
                  transaction.reversedAt || transaction.reversalOfId
                );
                return (
                  <TableRow
                    key={transaction.id}
                    className={cn(reversed && "opacity-50")}
                  >
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(transaction.occurredAt).toLocaleDateString(
                        "pt-BR"
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[320px] truncate text-sm font-medium">
                        {transaction.description}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {transaction.status}
                        {transaction.needsReview ? " • revisar" : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {account?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={
                          transaction.categoryId
                            ? String(transaction.categoryId)
                            : "none"
                        }
                        disabled={
                          categorize.isPending ||
                          reversed ||
                          transaction.type === "transfer"
                        }
                        onValueChange={value =>
                          value !== "none" &&
                          categorize.mutate({
                            transactionId: transaction.id,
                            categoryId: Number(value),
                            createMerchantRule: true,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 min-w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">A classificar</SelectItem>
                          {snapshot.categories.map(category => (
                            <SelectItem
                              key={category.id}
                              value={String(category.id)}
                            >
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap text-right font-semibold",
                        transaction.type === "income"
                          ? "text-emerald-700"
                          : transaction.type === "expense"
                            ? "text-rose-700"
                            : "text-blue-700"
                      )}
                    >
                      {transaction.type === "expense"
                        ? "−"
                        : transaction.type === "income"
                          ? "+"
                          : ""}
                      {formatCents(transaction.amountCents)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Desfazer"
                        disabled={
                          reversed ||
                          transaction.type === "transfer" ||
                          undo.isPending
                        }
                        onClick={() =>
                          undo.mutate({
                            transactionId: transaction.id,
                            reason: "Desfeito no painel",
                          })
                        }
                      >
                        <Undo2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {snapshot.recentTransactions.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-zinc-500"
                  >
                    Nenhum lançamento confirmado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TransferCard({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    fromAccountId: String(snapshot.accounts[0]?.id ?? ""),
    toAccountId: String(snapshot.accounts[1]?.id ?? ""),
    amount: "",
    confirmation: "",
  });
  const source = snapshot.accounts.find(
    account => account.id === Number(form.fromAccountId)
  );
  const transfer = trpc.financialCore.recordTransfer.useMutation({
    onSuccess: async () => {
      toast.success("Transferência interna registrada sem contar como renda.");
      setForm(current => ({ ...current, amount: "", confirmation: "" }));
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const submit = () => {
    const amountCents = parseMoneyToCents(form.amount);
    if (!amountCents) return toast.error("Informe um valor válido.");
    transfer.mutate({
      fromAccountId: Number(form.fromAccountId),
      toAccountId: Number(form.toAccountId),
      amountCents,
      occurredAt: new Date(),
      description: "Transferência interna manual",
      requestId: requestId("transfer"),
      ...(source?.protected && form.confirmation === "RETIRAR DA RESERVA"
        ? { protectedWithdrawalConfirmation: "RETIRAR DA RESERVA" as const }
        : {}),
    });
  };
  return (
    <Card className="rounded-3xl border-zinc-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ArrowRightLeft className="size-4" /> Transferir entre contas
        </CardTitle>
        <CardDescription>
          Movimento contábil interno; não executa PIX.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Origem">
          <Select
            value={form.fromAccountId}
            onValueChange={fromAccountId => setForm({ ...form, fromAccountId })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {snapshot.accounts.map(account => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {account.name} • {formatCents(account.currentBalanceCents)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Destino">
          <Select
            value={form.toAccountId}
            onValueChange={toAccountId => setForm({ ...form, toAccountId })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {snapshot.accounts
                .filter(account => account.id !== Number(form.fromAccountId))
                .map(account => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
        <MoneyField
          label="Valor"
          value={form.amount}
          onChange={amount => setForm({ ...form, amount })}
        />
        {source?.protected && (
          <Field label='Confirme digitando "RETIRAR DA RESERVA"'>
            <Input
              value={form.confirmation}
              onChange={event =>
                setForm({ ...form, confirmation: event.target.value })
              }
            />
          </Field>
        )}
        <Button
          variant="outline"
          className="w-full rounded-xl"
          disabled={
            transfer.isPending ||
            form.fromAccountId === form.toAccountId ||
            (Boolean(source?.protected) &&
              form.confirmation !== "RETIRAR DA RESERVA")
          }
          onClick={submit}
        >
          <ArrowRightLeft className="mr-2 size-4" /> Registrar transferência
        </Button>
      </CardContent>
    </Card>
  );
}

function BudgetTab({ snapshot }: { snapshot: ConfiguredSnapshot }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {snapshot.budgets.envelopes.map(envelope => {
        const used = envelope.plannedCents
          ? Math.min(100, (envelope.spentCents / envelope.plannedCents) * 100)
          : 0;
        return (
          <Card key={envelope.id} className="rounded-3xl border-zinc-200">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>{envelope.name}</span>
                <Badge variant="outline">
                  {priorityLabel(envelope.priority)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between text-sm">
                <span>Usado: {formatCents(envelope.spentCents)}</span>
                <span>Planejado: {formatCents(envelope.plannedCents)}</span>
              </div>
              <Progress value={used} className="mt-3" />
              <p className="mt-3 text-xs text-zinc-500">
                Disponível:{" "}
                {formatCents(
                  Math.max(
                    0,
                    envelope.plannedCents -
                      envelope.spentCents -
                      envelope.reservedCents
                  )
                )}
              </p>
            </CardContent>
          </Card>
        );
      })}
      <Card className="rounded-3xl border-zinc-200 lg:col-span-2">
        <CardHeader>
          <CardTitle>Fluxo mensal canônico</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <MetricCard
            label="Fixos"
            value={formatCents(snapshot.cashflow.monthlyFixedCostCents)}
            detail="Contas recorrentes"
          />
          <MetricCard
            label="Variáveis"
            value={formatCents(snapshot.cashflow.monthlyVariableBudgetCents)}
            detail="Teto mensal"
          />
          <MetricCard
            label="Sobra base"
            value={formatCents(snapshot.cashflow.monthlyBaseSurplusCents)}
            detail="Previsto; ainda não confirmado"
            tone={
              snapshot.cashflow.monthlyBaseSurplusCents >= 0
                ? "positive"
                : "warning"
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function GoalsTab({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  const [purchase, setPurchase] = useState({ amount: "", desiredDate: today });
  const [purchaseRequest, setPurchaseRequest] = useState({
    amountCents: 1,
    desiredDate: today,
  });
  const [runPurchase, setRunPurchase] = useState(false);
  const simulation = trpc.financialCore.simulatePurchase.useQuery(
    purchaseRequest,
    { enabled: runPurchase, retry: false }
  );
  const update = trpc.financialCore.updateGoalItem.useMutation({
    onSuccess: async () => {
      toast.success("Meta atualizada.");
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const grouped = useMemo(
    () =>
      ["essential", "important", "optional"].map(priority => ({
        priority,
        items: snapshot.goals.purchaseItems.filter(
          item => item.priority === priority
        ),
      })),
    [snapshot.goals.purchaseItems]
  );
  const simulate = () => {
    const amountCents = parseMoneyToCents(purchase.amount);
    if (!amountCents) return toast.error("Informe o valor da compra.");
    setPurchaseRequest({ amountCents, desiredDate: purchase.desiredDate });
    setRunPurchase(true);
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card className="h-fit rounded-3xl border-zinc-200">
          <CardHeader>
            <CardTitle>Posso comprar?</CardTitle>
            <CardDescription>
              Protege contas, dívida, envelopes e colchão de R$ 5.000.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Valor">
              <Input
                placeholder="0,00"
                value={purchase.amount}
                onChange={event =>
                  setPurchase({ ...purchase, amount: event.target.value })
                }
              />
            </Field>
            <Field label="Data desejada">
              <Input
                type="date"
                value={purchase.desiredDate}
                onChange={event =>
                  setPurchase({ ...purchase, desiredDate: event.target.value })
                }
              />
            </Field>
            <Button className="w-full rounded-xl" onClick={simulate}>
              <Sparkles className="mr-2 size-4" /> Simular decisão
            </Button>
            {simulation.data && (
              <div
                className={cn(
                  "rounded-2xl border p-4",
                  simulation.data.decision === "approved_safe"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
                )}
              >
                <p className="font-semibold">
                  {decisionLabel(simulation.data.decision)}
                </p>
                <p className="mt-2 text-sm">
                  Seguro para gastar:{" "}
                  {formatCents(simulation.data.safeToSpendCents)}
                </p>
                {simulation.data.explanationFacts.map(fact => (
                  <p key={fact} className="mt-1 text-xs text-zinc-600">
                    {fact}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-zinc-200">
          <CardHeader>
            <CardTitle>Metas protegidas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {snapshot.goals.items.map(goal => {
              const progress = goal.targetCents
                ? Math.min(100, (goal.fundedCents / goal.targetCents) * 100)
                : 0;
              return (
                <div
                  key={goal.id}
                  className="rounded-2xl border border-zinc-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{goal.name}</p>
                      <p className="text-xs text-zinc-500">
                        {priorityLabel(goal.priority)}
                      </p>
                    </div>
                    {goal.protected && (
                      <ShieldCheck className="size-4 text-emerald-700" />
                    )}
                  </div>
                  <Progress value={progress} className="mt-4" />
                  <p className="mt-2 text-xs text-zinc-500">
                    {formatCents(goal.fundedCents)} de{" "}
                    {formatCents(goal.targetCents)}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      {grouped.map(group => (
        <Card key={group.priority} className="rounded-3xl border-zinc-200">
          <CardHeader>
            <CardTitle>{priorityLabel(group.priority)}</CardTitle>
            <CardDescription>
              {group.items.length} item(ns) •{" "}
              {formatCents(
                group.items.reduce(
                  (sum, item) =>
                    sum + (item.actualCostCents ?? item.estimatedCostCents),
                  0
                )
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map(item => (
              <div
                key={item.id}
                className="rounded-2xl border border-zinc-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-zinc-500">
                      {item.personOrGroup}
                    </p>
                  </div>
                  <Badge
                    variant={
                      item.status === "purchased" ? "default" : "outline"
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-3 font-semibold">
                  {formatCents(item.actualCostCents ?? item.estimatedCostCents)}
                </p>
                {item.needsConfirmation && (
                  <p className="mt-1 text-xs text-amber-700">
                    Valor precisa de confirmação
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    disabled={update.isPending || item.status === "funded"}
                    onClick={() =>
                      update.mutate({ itemId: item.id, status: "funded" })
                    }
                  >
                    Reservar
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-lg"
                    disabled={update.isPending || item.status === "purchased"}
                    onClick={() =>
                      update.mutate({
                        itemId: item.id,
                        status: "purchased",
                        actualCostCents:
                          item.actualCostCents ?? item.estimatedCostCents,
                      })
                    }
                  >
                    Comprado
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProjectsTab({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    clientName: "",
    gross: "",
    probability: "50",
  });
  const create = trpc.financialCore.createProject.useMutation({
    onSuccess: async () => {
      toast.success("Projeto criado.");
      setForm({ name: "", clientName: "", gross: "", probability: "50" });
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const confirm = trpc.financialCore.confirmProjectPayment.useMutation({
    onSuccess: async result => {
      toast.success(
        `Pagamento confirmado: ${formatCents(result.transaction?.amountCents ?? 0)} dividido em 15/10/75.`
      );
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const businessAccount = snapshot.accounts.find(
    account => account.ownerType === "business"
  );
  const submit = () => {
    const grossValueCents = parseMoneyToCents(form.gross);
    if (!grossValueCents || !form.name.trim())
      return toast.error("Informe nome e valor do projeto.");
    create.mutate({
      name: form.name,
      clientName: form.clientName || null,
      stage: "lead",
      grossValueCents,
      expectedCostCents: Math.floor(grossValueCents * 0.1),
      taxBasisPoints: 1500,
      costBasisPoints: 1000,
      probabilityPercent: Number(form.probability),
      status: "active",
      installments: [{ amountCents: grossValueCents, expectedAt: today }],
    });
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <Card className="h-fit rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle>Novo projeto</CardTitle>
          <CardDescription>
            Cada recebimento confirmado divide 15% impostos, 10% custos e 75%
            metas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Projeto">
            <Input
              value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })}
              placeholder="Nome do projeto"
            />
          </Field>
          <Field label="Cliente">
            <Input
              value={form.clientName}
              onChange={event =>
                setForm({ ...form, clientName: event.target.value })
              }
            />
          </Field>
          <Field label="Valor bruto">
            <Input
              value={form.gross}
              onChange={event =>
                setForm({ ...form, gross: event.target.value })
              }
              placeholder="10.000,00"
            />
          </Field>
          <Field label="Probabilidade (%)">
            <Input
              type="number"
              min="0"
              max="100"
              value={form.probability}
              onChange={event =>
                setForm({ ...form, probability: event.target.value })
              }
            />
          </Field>
          <Button
            className="w-full rounded-xl"
            disabled={create.isPending}
            onClick={submit}
          >
            <Plus className="mr-2 size-4" /> Criar projeto
          </Button>
        </CardContent>
      </Card>
      <Card className="rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle>Pipeline e parcelas</CardTitle>
          <CardDescription>
            Meta mensal bruta:{" "}
            {formatCents(snapshot.projects.monthlyGrossTargetCents)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {snapshot.projects.items.map(project => {
            const installments = snapshot.projects.installments.filter(
              item => item.projectId === project.id
            );
            return (
              <div
                key={project.id}
                className="rounded-2xl border border-zinc-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{project.name}</p>
                    <p className="text-xs text-zinc-500">
                      {project.clientName || "Sem cliente"} • {project.stage} •{" "}
                      {project.probabilityPercent}%
                    </p>
                  </div>
                  <p className="font-semibold">
                    {formatCents(project.grossValueCents)}
                  </p>
                </div>
                <div className="mt-3 space-y-2">
                  {installments.map(installment => (
                    <div
                      key={installment.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-sm"
                    >
                      <span>
                        {formatCents(installment.amountCents)} •{" "}
                        {installment.expectedAt || "sem data"}
                      </span>
                      {installment.status === "received" ? (
                        <Badge className="bg-emerald-700">
                          <CheckCircle2 className="mr-1 size-3" /> Recebido
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!businessAccount || confirm.isPending}
                          onClick={() =>
                            businessAccount &&
                            confirm.mutate({
                              installmentId: installment.id,
                              accountId: businessAccount.id,
                              receivedAt: new Date(),
                            })
                          }
                        >
                          Confirmar recebimento
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {snapshot.projects.items.length === 0 && (
            <p className="py-10 text-center text-zinc-500">
              Nenhum projeto cadastrado.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CarTab() {
  const [form, setForm] = useState({
    price: "",
    down: "",
    installment: "",
    term: "48",
    cet: "",
    insurance: "",
    fuel: "",
    ipva: "",
    maintenance: "",
    downSeparated: false,
    incomeConfirmed: false,
  });
  const [input, setInput] = useState({
    vehiclePriceCents: null as number | null,
    downPaymentCents: null as number | null,
    installmentCents: null as number | null,
    termMonths: null as number | null,
    cetAnnualBasisPoints: null as number | null,
    insuranceMonthlyCents: null as number | null,
    fuelMonthlyCents: null as number | null,
    ipvaAnnualCents: null as number | null,
    maintenanceMonthlyCents: null as number | null,
    licensingAnnualCents: 0,
    expensiveDebtCents: 0,
    downPaymentSeparated: false,
    futureIncomeConfirmed: false,
    overdraftUsedCents: 0,
  });
  const [enabled, setEnabled] = useState(false);
  const simulation = trpc.financialCore.simulateCar.useQuery(input, {
    enabled,
    retry: false,
  });
  const run = () => {
    const money = (value: string) => (value ? parseMoneyToCents(value) : null);
    setInput({
      vehiclePriceCents: money(form.price),
      downPaymentCents: money(form.down),
      installmentCents: money(form.installment),
      termMonths: form.term ? Number(form.term) : null,
      cetAnnualBasisPoints: form.cet
        ? Math.round(Number(form.cet.replace(",", ".")) * 100)
        : null,
      insuranceMonthlyCents: money(form.insurance),
      fuelMonthlyCents: money(form.fuel),
      ipvaAnnualCents: money(form.ipva),
      maintenanceMonthlyCents: money(form.maintenance),
      licensingAnnualCents: 0,
      expensiveDebtCents: 0,
      downPaymentSeparated: form.downSeparated,
      futureIncomeConfirmed: form.incomeConfirmed,
      overdraftUsedCents: 0,
    });
    setEnabled(true);
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Card className="rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="size-5 text-orange-600" /> Simulador completo do
            carro
          </CardTitle>
          <CardDescription>
            O preço não é a parcela: considera CET, seguro, combustível, IPVA,
            manutenção e reserva pós-carro.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <MoneyField
            label="Preço do veículo"
            value={form.price}
            onChange={price => setForm({ ...form, price })}
          />
          <MoneyField
            label="Entrada"
            value={form.down}
            onChange={down => setForm({ ...form, down })}
          />
          <MoneyField
            label="Parcela mensal"
            value={form.installment}
            onChange={installment => setForm({ ...form, installment })}
          />
          <Field label="Prazo (meses)">
            <Input
              type="number"
              value={form.term}
              onChange={event => setForm({ ...form, term: event.target.value })}
            />
          </Field>
          <Field label="CET anual (%)">
            <Input
              value={form.cet}
              onChange={event => setForm({ ...form, cet: event.target.value })}
            />
          </Field>
          <MoneyField
            label="Seguro mensal"
            value={form.insurance}
            onChange={insurance => setForm({ ...form, insurance })}
          />
          <MoneyField
            label="Combustível mensal"
            value={form.fuel}
            onChange={fuel => setForm({ ...form, fuel })}
          />
          <MoneyField
            label="IPVA anual"
            value={form.ipva}
            onChange={ipva => setForm({ ...form, ipva })}
          />
          <MoneyField
            label="Manutenção mensal"
            value={form.maintenance}
            onChange={maintenance => setForm({ ...form, maintenance })}
          />
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 px-3">
            <Switch
              checked={form.downSeparated}
              onCheckedChange={downSeparated =>
                setForm({ ...form, downSeparated })
              }
            />
            <Label>Entrada já separada</Label>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 px-3">
            <Switch
              checked={form.incomeConfirmed}
              onCheckedChange={incomeConfirmed =>
                setForm({ ...form, incomeConfirmed })
              }
            />
            <Label>Renda futura confirmada</Label>
          </div>
          <Button className="rounded-xl" onClick={run}>
            <Sparkles className="mr-2 size-4" /> Calcular prontidão
          </Button>
        </CardContent>
      </Card>
      <Card className="rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle>Readiness score</CardTitle>
        </CardHeader>
        <CardContent>
          {simulation.data ? (
            <div>
              <div className="flex items-end justify-between">
                <p className="text-5xl font-semibold">
                  {simulation.data.readinessScore}
                </p>
                <Badge
                  variant={
                    simulation.data.decision === "fits_safely"
                      ? "default"
                      : "destructive"
                  }
                >
                  {decisionLabel(simulation.data.decision)}
                </Badge>
              </div>
              <Progress
                value={simulation.data.readinessScore}
                className="mt-4"
              />
              <div className="mt-5 space-y-2">
                <p className="text-sm">
                  Custo mensal total:{" "}
                  <strong>
                    {formatCents(simulation.data.totalMonthlyCostCents)}
                  </strong>
                </p>
                <p className="text-sm">
                  Custo do financiamento:{" "}
                  <strong>
                    {simulation.data.totalFinancingCostCents == null
                      ? "faltam dados"
                      : formatCents(simulation.data.totalFinancingCostCents)}
                  </strong>
                </p>
                {simulation.data.blockers.map(blocker => (
                  <div
                    key={blocker}
                    className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-950"
                  >
                    <AlertTriangle className="size-4 shrink-0" /> {blocker}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-zinc-500">
              Preencha os dados para ver bloqueios obrigatórios e a projeção
              conservadora.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SantanderImportTab({
  snapshot,
  onChanged,
}: {
  snapshot: ConfiguredSnapshot;
  onChanged: () => Promise<void>;
}) {
  const businessAccounts = snapshot.accounts.filter(
    account => account.ownerType === "business"
  );
  const [accountId, setAccountId] = useState(
    String(businessAccounts[0]?.id ?? "")
  );
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    importedCount: number;
    duplicateCount: number;
    reviewCount: number;
    totals: {
      creditCents: number;
      debitCents: number;
      netCents: number;
      endingBalanceCents: number | null;
    };
  } | null>(null);
  const importer = trpc.financialCore.importSantander.useMutation({
    onSuccess: async data => {
      setResult(data);
      toast.success(
        `${data.importedCount} lançamentos importados; ${data.duplicateCount} duplicados ignorados.`
      );
      await onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const choose = (event: ChangeEvent<HTMLInputElement>) =>
    setFile(event.target.files?.[0] ?? null);
  const submit = async () => {
    if (!file || !accountId)
      return toast.error("Selecione a conta PJ e o arquivo CSV.");
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    importer.mutate({
      accountId: Number(accountId),
      fileName: file.name,
      contentBase64,
    });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <Card className="rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-emerald-700" /> Importador
            Santander PJ
          </CardTitle>
          <CardDescription>
            Lê Latin-1, ponto e vírgula, duas linhas de metadados, datas
            dd/MM/aaaa e valores brasileiros. Cada linha recebe um hash estável.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Conta de destino">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Conta PJ" />
              </SelectTrigger>
              <SelectContent>
                {businessAccounts.map(account => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center hover:border-orange-400">
            <Upload className="size-8 text-zinc-400" />
            <span className="mt-3 text-sm font-medium">
              {file?.name ?? "Escolher extrato CSV"}
            </span>
            <span className="mt-1 text-xs text-zinc-500">
              A segunda importação do mesmo arquivo cria zero lançamentos.
            </span>
            <Input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={choose}
            />
          </label>
          <Button
            className="w-full rounded-xl"
            disabled={importer.isPending}
            onClick={submit}
          >
            {importer.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}{" "}
            Importar e conciliar
          </Button>
        </CardContent>
      </Card>
      <Card className="rounded-3xl border-zinc-200">
        <CardHeader>
          <CardTitle>Resultado</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-3">
              <ImportMetric
                label="Novos"
                value={String(result.importedCount)}
              />
              <ImportMetric
                label="Duplicados"
                value={String(result.duplicateCount)}
              />
              <ImportMetric
                label="Revisar categoria"
                value={String(result.reviewCount)}
              />
              <ImportMetric
                label="Créditos"
                value={formatCents(result.totals.creditCents)}
              />
              <ImportMetric
                label="Débitos"
                value={formatCents(result.totals.debitCents)}
              />
              <ImportMetric
                label="Variação"
                value={formatCents(result.totals.netCents)}
              />
              <ImportMetric
                label="Saldo final"
                value={
                  result.totals.endingBalanceCents == null
                    ? "—"
                    : formatCents(result.totals.endingBalanceCents)
                }
              />
            </div>
          ) : (
            <div className="py-12 text-center">
              <FileSpreadsheet className="mx-auto size-9 text-zinc-300" />
              <p className="mt-3 text-sm text-zinc-500">
                O resumo do arquivo aparecerá aqui.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FinancialAuditTab() {
  const audit = trpc.financialCore.audit.useQuery({ limit: 200 });
  return (
    <Card className="rounded-3xl border-zinc-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="size-5 text-zinc-700" /> Trilha de auditoria
        </CardTitle>
        <CardDescription>
          Ações de usuário, agente, importador e sistema com antes/depois.
          Reversões preservam o histórico.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Ator</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead>Request ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.data?.map(event => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {new Date(event.createdAt).toLocaleString("pt-BR")}
                </TableCell>
                <TableCell className="text-xs">
                  {event.actorType}
                  {event.actorId ? ` • ${event.actorId}` : ""}
                </TableCell>
                <TableCell className="font-medium">{event.action}</TableCell>
                <TableCell className="text-xs">
                  {event.entityType} #{event.entityId}
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-zinc-500">
                  {event.requestId || "—"}
                </TableCell>
              </TableRow>
            ))}
            {!audit.isLoading && audit.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-zinc-500"
                >
                  Nenhum evento auditado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Input
        inputMode="decimal"
        placeholder="0,00"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </Field>
  );
}

function ImportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
      <span className="text-sm text-zinc-600">{label}</span>
      <strong className="text-sm">{value}</strong>
    </div>
  );
}
