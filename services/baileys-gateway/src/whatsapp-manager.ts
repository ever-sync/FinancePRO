import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import type { PostgresAuthStore } from "./auth-store.js";
import type { WebhookOutbox } from "./outbox.js";

type ManagerState =
  | "starting"
  | "connecting"
  | "waiting_pairing"
  | "open"
  | "closed"
  | "logged_out"
  | "connection_replaced"
  | "stopped";

export type WhatsAppStatus = {
  sessionId: string;
  connection: ManagerState;
  registered: boolean;
  ready: boolean;
  pairingAvailable: boolean;
  pairingQrCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectCode: number | null;
  pendingWebhooks: number;
};

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{9,14}$/.test(digits)) {
    throw new Error(
      "Phone number must use E.164 format with country code, without the plus sign"
    );
  }
  return digits;
}

function getErrorStatusCode(error: unknown) {
  if (error instanceof Boom) return error.output.statusCode;
  const statusCode = (error as { output?: { statusCode?: unknown } } | null)
    ?.output?.statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function extractMessageText(message: WAMessage): string {
  const content = message.message;
  if (!content) return "";

  const nested =
    content.ephemeralMessage?.message ||
    content.viewOnceMessage?.message ||
    content.viewOnceMessageV2?.message ||
    content.documentWithCaptionMessage?.message;
  if (nested) {
    return extractMessageText({ ...message, message: nested });
  }

  return String(
    content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      content.buttonsResponseMessage?.selectedDisplayText ||
      content.buttonsResponseMessage?.selectedButtonId ||
      content.listResponseMessage?.title ||
      content.listResponseMessage?.singleSelectReply?.selectedRowId ||
      content.templateButtonReplyMessage?.selectedDisplayText ||
      content.templateButtonReplyMessage?.selectedId ||
      ""
  )
    .trim()
    .slice(0, 12_000);
}

function getSenderPhone(message: WAMessage) {
  const key = message.key;
  const remoteJid = String(key.remoteJid || "");
  if (
    !remoteJid ||
    remoteJid.endsWith("@g.us") ||
    remoteJid.endsWith("@broadcast") ||
    remoteJid === "status@broadcast"
  ) {
    return null;
  }

  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    key.participant,
    key.remoteJid,
  ].filter(Boolean) as string[];
  const phoneJid =
    candidates.find(jid => jid.includes("@s.whatsapp.net")) || candidates[0];
  if (!phoneJid || phoneJid.includes("@lid")) return null;

  const user = jidNormalizedUser(phoneJid).split("@")[0] || "";
  const phone = user.replace(/\D/g, "");
  return phone.length >= 8 && phone.length <= 15 ? phone : null;
}

function disconnectCode(update: Partial<ConnectionState>) {
  const error = update.lastDisconnect?.error;
  if (!error) return null;
  if (error instanceof Boom) return error.output.statusCode;
  const statusCode = (error as { output?: { statusCode?: unknown } }).output
    ?.statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

export class WhatsAppManager {
  private socket?: WASocket;
  private state: ManagerState = "starting";
  private registered = false;
  private pairingAvailable = false;
  private pairingQrCode: string | null = null;
  private stopped = false;
  private lastConnectedAt: Date | null = null;
  private lastDisconnectCode: number | null = null;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private connectionEpoch = 0;
  private connectPromise?: Promise<void>;
  private resetPromise?: Promise<void>;

  constructor(
    private readonly authStore: PostgresAuthStore,
    private readonly outbox: WebhookOutbox,
    private readonly sessionId: string,
    private readonly logger: Logger
  ) {}

  async start() {
    this.stopped = false;
    await this.ensureConnected();
  }

  async stop() {
    this.stopped = true;
    this.state = "stopped";
    this.pairingQrCode = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.end(undefined);
    this.socket = undefined;
  }

  async getStatus(): Promise<WhatsAppStatus> {
    return {
      sessionId: this.sessionId,
      connection: this.state,
      registered: this.registered,
      ready: this.state === "open" && this.registered,
      pairingAvailable: this.pairingAvailable && !this.registered,
      pairingQrCode: this.registered ? null : this.pairingQrCode,
      lastConnectedAt: this.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectCode: this.lastDisconnectCode,
      pendingWebhooks: await this.outbox.pendingCount(),
    };
  }

  async requestPairingCode(phoneNumber: string): Promise<{
    pairingCode: string | null;
    fallbackToQr: boolean;
    message: string | null;
  }> {
    const phone = normalizePhone(phoneNumber);
    if (this.state === "logged_out" && !this.registered) {
      await this.resetUnregisteredSession();
    }
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket) throw new Error("WhatsApp socket is not available");
    if (this.registered) {
      throw new Error("The WhatsApp session is already linked");
    }

    if (!this.pairingAvailable) {
      await socket.waitForConnectionUpdate(
        async update => Boolean(update.qr || update.connection === "open"),
        20_000
      );
    }
    try {
      const code = await socket.requestPairingCode(phone);
      this.state = "waiting_pairing";
      return {
        pairingCode: code.replace(/\W/g, ""),
        fallbackToQr: false,
        message: null,
      };
    } catch (error) {
      if (getErrorStatusCode(error) === DisconnectReason.loggedOut) {
        this.logger.warn(
          "WhatsApp rejected phone pairing; preparing QR fallback"
        );
        await this.resetUnregisteredSession();
        return {
          pairingCode: null,
          fallbackToQr: true,
          message:
            "O WhatsApp recusou o codigo por telefone. Escaneie o QR Code exibido no FinancePRO.",
        };
      }
      throw error;
    }
  }

  async resetUnregisteredSession() {
    if (this.registered) {
      throw new Error(
        "The linked WhatsApp session cannot be reset by the pairing endpoint"
      );
    }
    if (!this.resetPromise) {
      this.resetPromise = this.performUnregisteredSessionReset().finally(() => {
        this.resetPromise = undefined;
      });
    }
    await this.resetPromise;
  }

  async sendText(phoneNumber: string, text: string) {
    const phone = normalizePhone(phoneNumber);
    const normalizedText = text.trim();
    if (!normalizedText || normalizedText.length > 12_000) {
      throw new Error("Text must contain between 1 and 12000 characters");
    }
    if (!this.socket || this.state !== "open" || !this.registered) {
      throw new Error("WhatsApp session is not connected");
    }

    const response = await Promise.race([
      this.socket.sendMessage(`${phone}@s.whatsapp.net`, {
        text: normalizedText,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("WhatsApp send timed out")), 30_000)
      ),
    ]);
    return {
      id: String(response?.key.id || ""),
      remoteJid: String(response?.key.remoteJid || ""),
    };
  }

  private async ensureConnected() {
    if (this.socket || this.connectPromise) {
      await this.connectPromise;
      return;
    }
    this.connectPromise = this.createConnection().finally(() => {
      this.connectPromise = undefined;
    });
    await this.connectPromise;
  }

  private async performUnregisteredSessionReset() {
    if (this.connectPromise) {
      await this.connectPromise.catch(() => undefined);
    }
    const previousSocket = this.socket;
    this.connectionEpoch += 1;
    this.socket = undefined;
    previousSocket?.end(undefined);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempt = 0;
    this.registered = false;
    this.pairingAvailable = false;
    this.pairingQrCode = null;
    this.lastDisconnectCode = null;
    this.state = "starting";
    await this.authStore.clearSession();
    await this.ensureConnected();
  }

  private async createConnection() {
    if (this.stopped) return;
    this.state = "connecting";
    this.pairingAvailable = false;
    this.pairingQrCode = null;
    const { state, saveCreds } = await this.authStore.load();
    this.registered = Boolean(state.creds.registered);
    const epoch = ++this.connectionEpoch;
    const baileysLogger = this.logger.child(
      { component: "baileys" },
      { level: "warn" }
    );
    const socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      browser: Browsers.macOS("Google Chrome"),
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      retryRequestDelayMs: 500,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    this.socket = socket;

    socket.ev.on("creds.update", async () => {
      this.registered = Boolean(state.creds.registered);
      try {
        await saveCreds();
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : "unknown" },
          "Failed to persist WhatsApp credentials"
        );
      }
    });
    socket.ev.on("connection.update", update => {
      void this.handleConnectionUpdate(epoch, socket, update);
    });
    socket.ev.on("messages.upsert", event => {
      if (event.type !== "notify") return;
      for (const message of event.messages) {
        void this.handleInboundMessage(message);
      }
    });
  }

  private async handleConnectionUpdate(
    epoch: number,
    socket: WASocket,
    update: Partial<ConnectionState>
  ) {
    if (epoch !== this.connectionEpoch || socket !== this.socket) return;
    if (update.qr) {
      this.pairingAvailable = true;
      this.pairingQrCode = update.qr;
      this.state = "waiting_pairing";
      this.logger.info("WhatsApp session is waiting for pairing");
    }
    if (update.connection === "open") {
      this.state = "open";
      this.registered = true;
      this.pairingAvailable = false;
      this.pairingQrCode = null;
      this.lastConnectedAt = new Date();
      this.lastDisconnectCode = null;
      this.reconnectAttempt = 0;
      this.logger.info("WhatsApp connection is open");
      return;
    }
    if (update.connection !== "close") return;

    const code = disconnectCode(update);
    this.lastDisconnectCode = code;
    this.socket = undefined;
    this.pairingAvailable = false;
    this.pairingQrCode = null;
    if (
      code === DisconnectReason.loggedOut ||
      code === DisconnectReason.badSession
    ) {
      this.state = "logged_out";
      this.registered = false;
      this.logger.warn({ disconnectCode: code }, "WhatsApp session logged out");
      return;
    }
    if (code === DisconnectReason.connectionReplaced) {
      this.state = "connection_replaced";
      this.logger.warn("WhatsApp connection was replaced by another session");
      return;
    }

    this.state = "closed";
    this.logger.warn({ disconnectCode: code }, "WhatsApp connection closed");
    this.scheduleReconnect(
      code === DisconnectReason.restartRequired ? 250 : undefined
    );
  }

  private scheduleReconnect(delayOverride?: number) {
    if (this.stopped || this.reconnectTimer) return;
    const delay =
      delayOverride ?? Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected().catch(error => {
        this.logger.error(
          { error: error instanceof Error ? error.message : "unknown" },
          "WhatsApp reconnect failed"
        );
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }

  private async handleInboundMessage(message: WAMessage) {
    try {
      if (message.key.fromMe) return;
      const providerMessageId = String(message.key.id || "").slice(0, 255);
      const phoneNumber = getSenderPhone(message);
      const text = extractMessageText(message);
      if (!providerMessageId || !phoneNumber || !text) return;

      await this.outbox.enqueue({
        instanceId: this.sessionId,
        providerMessageId,
        phoneNumber,
        displayName: message.pushName?.slice(0, 255) || null,
        text,
        rawPayload: {
          source: "baileys",
          upsertType: "notify",
          messageTimestamp: String(message.messageTimestamp || ""),
        },
      });
    } catch (error) {
      this.logger.error(
        {
          providerMessageId: String(message.key.id || ""),
          error: error instanceof Error ? error.message : "unknown",
        },
        "Failed to enqueue an inbound WhatsApp message"
      );
    }
  }
}
