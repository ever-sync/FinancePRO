import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";

export default function WhatsAppIntegracao() {
  const utils = trpc.useUtils();
  const { data: gatewayConfig } =
    trpc.whatsappIntegration.gatewayConfig.useQuery();
  const { data: integration, isLoading } =
    trpc.whatsappIntegration.get.useQuery();
  const { data: status } = trpc.whatsappIntegration.syncStatus.useQuery();
  const { data: gatewayStatus } =
    trpc.whatsappIntegration.gatewayStatus.useQuery(undefined, {
      enabled: integration?.provider === "baileys",
      refetchInterval: integration?.provider === "baileys" ? 5_000 : false,
      retry: false,
    });
  const saveMut = trpc.whatsappIntegration.upsert.useMutation({
    onSuccess: async () => {
      await utils.whatsappIntegration.get.invalidate();
      await utils.whatsappIntegration.syncStatus.invalidate();
      toast.success("Integracao do WhatsApp salva.");
    },
    onError: error => toast.error(error.message),
  });
  const testMut = trpc.whatsappIntegration.testConnection.useMutation({
    onSuccess: async data => {
      await utils.whatsappIntegration.get.invalidate();
      await utils.whatsappIntegration.syncStatus.invalidate();
      toast.success(data.message);
    },
    onError: error => toast.error(error.message),
  });
  const sendTestMut = trpc.whatsappIntegration.sendTestMessage.useMutation({
    onSuccess: () => toast.success("Mensagem de teste enviada."),
    onError: error => toast.error(error.message),
  });
  const pairMut = trpc.whatsappIntegration.requestPairingCode.useMutation({
    onSuccess: async data => {
      setPairingCode(data.pairingCode || "");
      await Promise.all([
        utils.whatsappIntegration.get.invalidate(),
        utils.whatsappIntegration.gatewayStatus.invalidate(),
      ]);
      if (data.fallbackToQr) {
        toast.warning(
          data.message || "Use o QR Code para vincular o WhatsApp."
        );
      } else {
        toast.success("Codigo de vinculacao gerado.");
      }
    },
    onError: error => toast.error(error.message),
  });
  const resetPairingMut =
    trpc.whatsappIntegration.resetPairingSession.useMutation({
      onSuccess: async () => {
        setPairingCode("");
        await Promise.all([
          utils.whatsappIntegration.get.invalidate(),
          utils.whatsappIntegration.gatewayStatus.invalidate(),
        ]);
        toast.success("Pareamento reiniciado. Aguarde o QR Code aparecer.");
      },
      onError: error => toast.error(error.message),
    });
  const canSendTest =
    Boolean(integration?.authorizedPhone) &&
    (gatewayStatus?.ready ||
      integration?.lastConnectionStatus === "sincronizado");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingPhone, setPairingPhone] = useState("");

  const [form, setForm] = useState<{
    provider: "uazapi" | "baileys";
    instanceId: string;
    apiBaseUrl: string;
    apiToken: string;
    authorizedPhone: string;
    enabled: boolean;
    automationHour: number;
    timezone: string;
  }>({
    provider: "uazapi",
    instanceId: "",
    apiBaseUrl: "https://api.uazapi.com",
    apiToken: "",
    authorizedPhone: "",
    enabled: true,
    automationHour: 8,
    timezone: "America/Sao_Paulo",
  });

  useEffect(() => {
    if (!integration) {
      if (gatewayConfig?.baileysAvailable && gatewayConfig.baileysGatewayUrl) {
        setForm(prev => ({
          ...prev,
          provider: "baileys",
          instanceId: gatewayConfig.defaultSessionId,
          apiBaseUrl: gatewayConfig.baileysGatewayUrl || "",
        }));
      }
      return;
    }
    setForm(prev => ({
      ...prev,
      provider: integration.provider || "uazapi",
      instanceId: integration.instanceId || "",
      apiBaseUrl:
        integration.apiBaseUrl ||
        (integration.provider === "baileys" ? "" : "https://api.uazapi.com"),
      authorizedPhone: integration.authorizedPhone || "",
      enabled: integration.enabled ?? true,
      automationHour: integration.automationHour ?? 8,
      timezone: integration.timezone || "America/Sao_Paulo",
      apiToken: "",
    }));
  }, [gatewayConfig, integration]);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Carregando integracao do WhatsApp...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp IA</h1>
          <p className="text-sm text-muted-foreground">
            Conecte o Baileys ou a Uazapi, defina seu numero autorizado e ative
            a rotina diaria.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              testMut.mutate({
                provider: form.provider,
                instanceId: form.instanceId,
                apiBaseUrl: form.apiBaseUrl,
                apiToken: form.apiToken || undefined,
              })
            }
            disabled={testMut.isPending || !form.instanceId || !form.apiBaseUrl}
          >
            {testMut.isPending ? "Testando..." : "Testar conexao"}
          </Button>
          <Button
            variant="outline"
            onClick={() => sendTestMut.mutate()}
            disabled={sendTestMut.isPending || !canSendTest}
          >
            {sendTestMut.isPending ? "Enviando..." : "Enviar teste"}
          </Button>
          {form.provider === "baileys" &&
          integration?.provider === "baileys" ? (
            <Button
              variant="outline"
              onClick={() => pairMut.mutate({ phoneNumber: pairingPhone })}
              disabled={
                pairMut.isPending || pairingPhone.replace(/\D/g, "").length < 10
              }
            >
              {pairMut.isPending ? "Gerando..." : "Gerar codigo"}
            </Button>
          ) : null}
          <Button
            onClick={() => saveMut.mutate(form)}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? "Salvando..." : "Salvar integracao"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              Configuracao {form.provider === "baileys" ? "Baileys" : "Uazapi"}
            </CardTitle>
            <CardDescription>
              {form.provider === "baileys"
                ? gatewayConfig?.baileysAvailable
                  ? "O gateway privado ja esta configurado na Railway. Salve a integracao e gere o codigo para vincular o WhatsApp."
                  : "Use a URL e a chave do gateway privado. Depois de salvar, gere o codigo para vincular o WhatsApp."
                : "Use o token da instancia da Uazapi, nao o admintoken. Deixe o token em branco para manter o atual."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provedor</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.provider}
                onChange={event => {
                  const provider = event.target.value as "uazapi" | "baileys";
                  setPairingCode("");
                  setForm(prev => ({
                    ...prev,
                    provider,
                    apiBaseUrl:
                      provider === "uazapi"
                        ? "https://api.uazapi.com"
                        : gatewayConfig?.baileysGatewayUrl || "",
                    instanceId:
                      provider === "baileys"
                        ? gatewayConfig?.defaultSessionId || "financepro"
                        : prev.instanceId,
                    apiToken: "",
                  }));
                }}
              >
                <option value="baileys">Baileys (Railway)</option>
                <option value="uazapi">Uazapi</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {form.provider === "baileys" ? "ID da sessao" : "Instance ID"}
              </Label>
              <Input
                value={form.instanceId}
                onChange={event =>
                  setForm(prev => ({ ...prev, instanceId: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>API base URL</Label>
              <Input
                value={form.apiBaseUrl}
                onChange={event =>
                  setForm(prev => ({ ...prev, apiBaseUrl: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {form.provider === "baileys"
                  ? "Chave do gateway"
                  : "Token da instancia"}
              </Label>
              <Input
                type="password"
                disabled={
                  form.provider === "baileys" && gatewayConfig?.baileysAvailable
                }
                placeholder={
                  form.provider === "baileys" && gatewayConfig?.baileysAvailable
                    ? "Gerenciada com seguranca pela Railway"
                    : integration?.maskedApiToken ||
                      (form.provider === "baileys"
                        ? "Cole aqui a chave do gateway"
                        : "Cole aqui o token da instancia da Uazapi")
                }
                value={form.apiToken}
                onChange={event =>
                  setForm(prev => ({ ...prev, apiToken: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Numero autorizado</Label>
              <Input
                placeholder="5511999999999"
                value={form.authorizedPhone}
                onChange={event =>
                  setForm(prev => ({
                    ...prev,
                    authorizedPhone: event.target.value,
                  }))
                }
              />
            </div>
            {form.provider === "baileys" ? (
              <div className="space-y-1.5 md:col-span-2">
                <Label>Numero que sera conectado ao Baileys</Label>
                <Input
                  placeholder="5511999999999"
                  value={pairingPhone}
                  onChange={event => setPairingPhone(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Recomendado: use um numero dedicado ao agente, diferente do
                  numero autorizado que conversara com ele.
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Hora da automacao</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={form.automationHour}
                onChange={event =>
                  setForm(prev => ({
                    ...prev,
                    automationHour: Number(event.target.value || 8),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Input
                value={form.timezone}
                onChange={event =>
                  setForm(prev => ({ ...prev, timezone: event.target.value }))
                }
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-3 rounded-2xl border px-4 py-3">
              <input
                id="whatsapp-enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={event =>
                  setForm(prev => ({ ...prev, enabled: event.target.checked }))
                }
              />
              <Label htmlFor="whatsapp-enabled" className="cursor-pointer">
                Assistente habilitado
              </Label>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status da sessao</CardTitle>
              <CardDescription>
                Saude da conexao, webhook e fila do assistente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pairingCode ? (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    No WhatsApp, abra Aparelhos conectados, escolha vincular com
                    numero de telefone e digite:
                  </p>
                  <p className="mt-3 font-mono text-3xl font-bold tracking-[0.35em]">
                    {pairingCode.match(/.{1,4}/g)?.join(" ") || pairingCode}
                  </p>
                </div>
              ) : null}
              {gatewayStatus?.pairingQrCode && !gatewayStatus.ready ? (
                <div className="rounded-2xl border border-primary/30 bg-white p-5 text-center">
                  <p className="text-sm font-medium text-zinc-900">
                    Vincular com QR Code
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No WhatsApp, abra Aparelhos conectados, toque em Vincular
                    aparelho e escaneie este codigo.
                  </p>
                  <div className="mt-4 inline-flex rounded-2xl border bg-white p-3">
                    <QRCodeSVG
                      value={gatewayStatus.pairingQrCode}
                      size={220}
                      level="M"
                      marginSize={1}
                    />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    O codigo e atualizado automaticamente enquanto a sessao
                    aguarda vinculacao.
                  </p>
                </div>
              ) : null}
              {integration?.provider === "baileys" && !gatewayStatus?.ready ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => resetPairingMut.mutate()}
                  disabled={resetPairingMut.isPending}
                >
                  {resetPairingMut.isPending
                    ? "Reiniciando pareamento..."
                    : "Reiniciar pareamento"}
                </Button>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Conexao</span>
                <StatusBadge
                  status={
                    gatewayStatus?.ready
                      ? "sincronizado"
                      : integration?.lastConnectionStatus || "pendente"
                  }
                />
              </div>
              {integration?.provider === "baileys" && gatewayStatus ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Gateway Baileys
                  </span>
                  <StatusBadge status={gatewayStatus.connection} />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border p-3">
                  <p className="text-muted-foreground">Threads</p>
                  <p className="mt-1 text-xl font-semibold">
                    {status?.totals.threads || 0}
                  </p>
                </div>
                <div className="rounded-2xl border p-3">
                  <p className="text-muted-foreground">Mensagens</p>
                  <p className="mt-1 text-xl font-semibold">
                    {status?.totals.messages || 0}
                  </p>
                </div>
                <div className="rounded-2xl border p-3">
                  <p className="text-muted-foreground">
                    Confirmacoes pendentes
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {status?.totals.pendingConfirmations || 0}
                  </p>
                </div>
                <div className="rounded-2xl border p-3">
                  <p className="text-muted-foreground">Alertas</p>
                  <p className="mt-1 text-xl font-semibold">
                    {status?.totals.notifications || 0}
                  </p>
                </div>
              </div>
              <div className="space-y-2 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
                <p>Webhook: {integration?.webhookUrl || "-"}</p>
                <p>
                  Ultimo retorno do provedor:{" "}
                  {integration?.lastConnectionMessage || "-"}
                </p>
                <p>
                  Ultima mensagem recebida:{" "}
                  {integration?.lastMessageReceivedAt
                    ? new Date(
                        integration.lastMessageReceivedAt
                      ).toLocaleString("pt-BR")
                    : "-"}
                </p>
                <p>
                  Ultima mensagem enviada:{" "}
                  {integration?.lastMessageSentAt
                    ? new Date(integration.lastMessageSentAt).toLocaleString(
                        "pt-BR"
                      )
                    : "-"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
