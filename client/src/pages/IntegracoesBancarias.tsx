import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { CreditCard, Landmark, Link2, PlugZap, Upload } from "lucide-react";
import {
  type BankConnectionProfile,
  type BankProviderReadiness,
  type BankConnectionProvider,
  type BankConnectionSyncMode,
  getBankConnectionProviderLabel,
  getBankConnectionSourceKindLabel,
  getBankConnectionSyncModeLabel,
} from "@/lib/bankConnections";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";

type ConnectionForm = {
  label: string;
  institution: string;
  provider: BankConnectionProvider;
  sourceKind: "bank_account" | "credit_card";
  scope: "empresa" | "pessoal" | "misto";
  syncMode: BankConnectionSyncMode;
  notes: string;
  status: "pronta" | "atencao" | "rascunho";
};

const DEFAULT_FORM: ConnectionForm = {
  label: "",
  institution: "",
  provider: "open_finance",
  sourceKind: "bank_account",
  scope: "misto",
  syncMode: "file",
  notes: "",
  status: "rascunho",
};

function formatDateTime(value?: string | Date | null) {
  if (!value) return "Nunca importado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeBankConnectionProfile(profile: any): BankConnectionProfile {
  return {
    ...profile,
    provider: profile.provider as BankConnectionProvider,
    sourceKind: profile.sourceKind as BankConnectionProfile["sourceKind"],
    scope: profile.scope as BankConnectionProfile["scope"],
    syncMode: profile.syncMode as BankConnectionSyncMode,
    status: profile.status as BankConnectionProfile["status"],
  };
}

export default function IntegracoesBancarias() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: rawProfiles = [], isLoading } = trpc.bankConnections.list.useQuery();
  const { data: providerReadiness = [] } = trpc.bankConnections.providers.useQuery();
  const profiles = useMemo(
    () => rawProfiles.map(profile => normalizeBankConnectionProfile(profile)),
    [rawProfiles]
  );
  const providerReadinessMap = useMemo(
    () =>
      new Map(
        providerReadiness.map((item: BankProviderReadiness) => [item.provider, item])
      ),
    [providerReadiness]
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM);

  const editingProfile = useMemo(
    () => profiles.find(profile => profile.id === editingId) ?? null,
    [profiles, editingId]
  );

  useEffect(() => {
    if (!editingProfile) {
      setForm(DEFAULT_FORM);
      return;
    }

    setForm({
      label: editingProfile.label,
      institution: editingProfile.institution,
      provider: editingProfile.provider,
      sourceKind: editingProfile.sourceKind,
      scope: editingProfile.scope,
      syncMode: editingProfile.syncMode,
      notes: editingProfile.notes || "",
      status: editingProfile.status,
    });
  }, [editingProfile]);

  const refreshConnections = async () => {
    await utils.bankConnections.list.invalidate();
  };

  const saveProfileMut = trpc.bankConnections.upsert.useMutation({
    onSuccess: async connection => {
      await refreshConnections();
      setEditingId(connection?.id ?? null);
      toast.success("Conexao bancaria salva.");
    },
    onError: error => toast.error(error.message),
  });

  const removeProfileMut = trpc.bankConnections.remove.useMutation({
    onSuccess: async () => {
      await refreshConnections();
      resetForm();
      toast.success("Conexao removida.");
    },
    onError: error => toast.error(error.message),
  });

  const requestSyncMut = trpc.bankConnections.requestSync.useMutation({
    onSuccess: async data => {
      await refreshConnections();
      toast.success(data.message);
    },
    onError: error => toast.error(error.message),
  });

  const saveProfile = () => {
    if (!form.label.trim() || !form.institution.trim()) {
      toast.error("Preencha o nome da conexao e a instituicao.");
      return;
    }

    saveProfileMut.mutate({
      id: editingId ?? undefined,
      label: form.label.trim(),
      institution: form.institution.trim(),
      provider: form.provider,
      sourceKind: form.sourceKind,
      scope: form.scope,
      syncMode: form.syncMode,
      notes: form.notes.trim() || undefined,
      status: form.status,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
  };

  const deleteProfile = (profileId: number) => {
    removeProfileMut.mutate({ connectionId: profileId });
  };

  const openImporter = (profile: BankConnectionProfile) => {
    const params = new URLSearchParams({
      mode: "statement",
      sourceKind: profile.sourceKind,
      scope: profile.scope,
      source: "bank-connection",
      connectionId: String(profile.id),
    });
    setLocation(`/importador?${params.toString()}`);
  };

  const bankCount = profiles.filter(profile => profile.sourceKind === "bank_account").length;
  const cardCount = profiles.filter(profile => profile.sourceKind === "credit_card").length;
  const readyCount = profiles.filter(profile => profile.status === "pronta").length;
  const selectedProviderReadiness = providerReadinessMap.get(form.provider);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando integracoes bancarias...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integracoes bancarias</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre contas e cartoes para abrir o conciliador ja no contexto certo e preparar o
            produto para Open Finance real.
          </p>
        </div>
        <Button variant="outline" onClick={() => setLocation("/importador?mode=statement")}>
          Abrir conciliador
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Contas</CardDescription>
            <CardTitle className="text-xl">{bankCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Perfis de conta prontos para conciliacao.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cartoes</CardDescription>
            <CardTitle className="text-xl">{cardCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Faturas configuradas com provider e escopo.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Conexoes prontas</CardDescription>
            <CardTitle className="text-xl">{readyCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Perfis marcados como operacionais.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>{editingProfile ? "Editar conexao" : "Nova conexao"}</CardTitle>
            <CardDescription>
              Defina provider, tipo e escopo. Depois o importador abre com essa configuracao.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome da conexao</Label>
                <Input
                  value={form.label}
                  onChange={event => setForm(current => ({ ...current, label: event.target.value }))}
                  placeholder="Banco principal PJ"
                />
              </div>
              <div className="space-y-2">
                <Label>Instituicao</Label>
                <Input
                  value={form.institution}
                  onChange={event =>
                    setForm(current => ({ ...current, institution: event.target.value }))
                  }
                  placeholder="Itau, Nubank, Inter..."
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={value =>
                    setForm(current => ({ ...current, provider: value as BankConnectionProvider }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open_finance">Open Finance</SelectItem>
                    <SelectItem value="pluggy">Pluggy</SelectItem>
                    <SelectItem value="belvo">Belvo</SelectItem>
                    <SelectItem value="manual_upload">Upload manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sincronizacao</Label>
                <Select
                  value={form.syncMode}
                  onValueChange={value =>
                    setForm(current => ({ ...current, syncMode: value as BankConnectionSyncMode }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o modo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="file">Arquivo / conciliacao</SelectItem>
                    <SelectItem value="api">API / Open Finance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={form.sourceKind}
                  onValueChange={value =>
                    setForm(current => ({
                      ...current,
                      sourceKind: value as ConnectionForm["sourceKind"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_account">Conta bancaria</SelectItem>
                    <SelectItem value="credit_card">Cartao</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Escopo</Label>
                <Select
                  value={form.scope}
                  onValueChange={value =>
                    setForm(current => ({ ...current, scope: value as ConnectionForm["scope"] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escopo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empresa">Empresa</SelectItem>
                    <SelectItem value="pessoal">Pessoal</SelectItem>
                    <SelectItem value="misto">Misto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={value =>
                    setForm(current => ({ ...current, status: value as ConnectionForm["status"] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pronta">Pronta</SelectItem>
                    <SelectItem value="atencao">Atencao</SelectItem>
                    <SelectItem value="rascunho">Rascunho</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observacoes</Label>
              <Textarea
                value={form.notes}
                onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
                rows={4}
                placeholder="Ex.: conta operacional da empresa, usar no fechamento semanal, cartao principal..."
              />
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 text-sm text-zinc-600">
              {form.syncMode === "api" ? (
                <>
                  <p>
                    Esse perfil usa contrato de provider no backend. O estado real depende da configuracao do provider escolhido.
                  </p>
                  {selectedProviderReadiness ? (
                    <div className="mt-3 flex items-center gap-2">
                      <StatusBadge status={selectedProviderReadiness.status} />
                      <span>{selectedProviderReadiness.message}</span>
                    </div>
                  ) : null}
                </>
              ) : (
                "Esse perfil usa conciliacao por arquivo e ja funciona hoje com CSV, OFX e fatura."
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveProfile} disabled={saveProfileMut.isPending}>
                {saveProfileMut.isPending ? "Salvando..." : "Salvar conexao"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Nova conexao
              </Button>
              {editingProfile ? (
                <Button
                  variant="ghost"
                  onClick={() => deleteProfile(editingProfile.id)}
                  disabled={removeProfileMut.isPending}
                >
                  {removeProfileMut.isPending ? "Removendo..." : "Remover"}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Perfis bancarios</CardTitle>
            <CardDescription>
              Cada perfil abre o conciliador com provider, escopo e tipo ja definidos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profiles.length ? (
              profiles.map(profile => {
                const ProfileIcon =
                  profile.provider === "pluggy"
                    ? PlugZap
                    : profile.sourceKind === "credit_card"
                      ? CreditCard
                      : profile.provider === "manual_upload"
                        ? Upload
                        : Landmark;

                return (
                  <div key={profile.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <ProfileIcon className="size-4 text-zinc-500" />
                          <p className="font-medium text-zinc-900">{profile.label}</p>
                          <StatusBadge status={profile.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">{profile.institution}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-zinc-400">
                          <span>{getBankConnectionProviderLabel(profile.provider)}</span>
                          <span>{getBankConnectionSourceKindLabel(profile.sourceKind)}</span>
                          <span>{profile.scope}</span>
                          <span>{getBankConnectionSyncModeLabel(profile.syncMode)}</span>
                        </div>
                        <p className="text-xs text-zinc-500">
                          Ultima importacao: {formatDateTime(profile.lastImportedAt)}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span>Ultimo sync: {profile.lastSyncStatus ? "" : "Nunca solicitado"}</span>
                          {profile.lastSyncStatus ? <StatusBadge status={profile.lastSyncStatus} /> : null}
                        </div>
                        {profile.lastSyncError ? (
                          <p className="text-xs text-amber-700">{profile.lastSyncError}</p>
                        ) : null}
                        {profile.notes ? (
                          <p className="text-sm leading-6 text-zinc-600">{profile.notes}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => openImporter(profile)}>
                          Conciliar agora
                        </Button>
                        {profile.syncMode === "api" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => requestSyncMut.mutate({ connectionId: profile.id })}
                            disabled={requestSyncMut.isPending}
                          >
                            {requestSyncMut.isPending ? "Sincronizando..." : "Solicitar sync"}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => setEditingId(profile.id)}>
                          Editar
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhuma conexao cadastrada ainda. Crie um perfil para conta ou cartao e abra o
                importador no contexto certo.
              </div>
            )}

            <div className="rounded-2xl border border-orange-100 bg-orange-50/80 p-4 text-sm text-orange-800">
              <div className="flex items-center gap-2 font-medium">
                <Link2 className="size-4" />
                Camada Open Finance assistida
              </div>
              <p className="mt-2 leading-6">
                Os perfis ja deixam o produto pronto para Open Finance, Pluggy ou Belvo. Quando a
                integracao real entrar no backend, esse cadastro vira a base da conexao automatica.
              </p>
              {providerReadiness.length ? (
                <div className="mt-4 grid gap-2">
                  {providerReadiness.map((provider: BankProviderReadiness) => (
                    <div
                      key={provider.provider}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-200 bg-white/80 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{provider.label}</span>
                        <StatusBadge status={provider.status} />
                      </div>
                      <span className="text-xs">{provider.message}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
