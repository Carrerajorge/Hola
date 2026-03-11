import { EventEmitter } from "events"; import fs from "fs/promises"; import path from "path"; import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, type 
WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

export type WhatsAppConnectionState =
| "disconnected"
| "connecting"
| "qr"
| "pairing_code"
| "connected"
| "error";

export interface WhatsAppMediaAttachment {
mimeType: string;
fileName?: string;
dataBase64?: string;
url?: string;
}

export interface WhatsAppStatus {
state: WhatsAppConnectionState;
me?: { id: string; name?: string } | null;
qr?: string | null;
code?: string | null;
phone?: string | null;
error?: string | null;
updatedAt: number;
}

type StartOptions = { phone?: string };

type SessionRecord = {
socket: WASocket | null;
authDir: string;
phone?: string | null;
status: WhatsAppStatus;
connecting?: Promise<WhatsAppStatus> | null;
stopRequested?: boolean;
};

class WhatsAppWebManager extends EventEmitter {
private readonly statuses = new Map<string, WhatsAppStatus>();
private readonly sessions = new Map<string, SessionRecord>();
private readonly autoReplyEnabled = new Map<string, boolean>();
private readonly autoReplyToContacts = new Map<string, boolean>();
private readonly autoReplyPrompt = new Map<string, string>();
private readonly processedMessages = new Set<string>();
private readonly authBaseDir = path.resolve(process.cwd(), "data/whatsapp-web-auth");

private sanitizeUserId(userId: string): string {
return String(userId || "anonymous").replace(/[^a-zA-Z0-9._-]/g, "_");
}

private getAuthDir(userId: string): string {
return path.join(this.authBaseDir, this.sanitizeUserId(userId));
}

private ensureStatus(userId: string): WhatsAppStatus {
const existing = this.statuses.get(userId);
if (existing) return existing;
const initial: WhatsAppStatus = {
state: "disconnected",
me: null,
qr: null,
code: null,
phone: null,
error: null,
updatedAt: Date.now(),
};
this.statuses.set(userId, initial);
return initial;
}

private setStatus(userId: string, patch: Partial<WhatsAppStatus>): WhatsAppStatus {
const current = this.ensureStatus(userId);
const next: WhatsAppStatus = {
...current,
...patch,
updatedAt: Date.now(),
};
this.statuses.set(userId, next);

const session = this.sessions.get(userId);
if (session) session.status = next;

this.emit("status", userId, next);
return next;
}

private async ensureSessionDir(userId: string): Promise<string> {
const dir = this.getAuthDir(userId);
await fs.mkdir(dir, { recursive: true });
return dir;
}

private async removeSessionDir(userId: string): Promise<void> {
const dir = this.getAuthDir(userId);
await fs.rm(dir, { recursive: true, force: true });
}

getStatus(userId: string): WhatsAppStatus {
return this.ensureStatus(userId);
}

private getOrCreateSession(userId: string): SessionRecord {
const existing = this.sessions.get(userId);
if (existing) return existing;

const record: SessionRecord = {
socket: null,
authDir: this.getAuthDir(userId),
phone: null,
status: this.ensureStatus(userId),
connecting: null,
stopRequested: false,
};
this.sessions.set(userId, record);
return record;
}

async startWithOptions(userId: string, options?: StartOptions): Promise<WhatsAppStatus> {
const session = this.getOrCreateSession(userId);
const normalizedPhone = options?.phone ? String(options.phone).replace(/\D/g, "") : null;

if (session.connecting) {
return session.connecting;
}

session.connecting = this.connectInternal(userId, normalizedPhone ?? undefined)
.finally(() => {
const latest = this.sessions.get(userId);
if (latest) latest.connecting = null;
});

return session.connecting;
}

private async connectInternal(userId: string, phone?: string): Promise<WhatsAppStatus> {
const session = this.getOrCreateSession(userId);
session.stopRequested = false;
session.phone = phone ?? null;

await this.ensureSessionDir(userId);

this.setStatus(userId, {
state: "connecting",
me: null,
qr: null,
code: null,
phone: phone ?? null,
error: null,
});

const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({
version,
auth: state,
browser: Browsers.ubuntu("AppsWebChat"),
printQRInTerminal: false,
markOnlineOnConnect: false,
syncFullHistory: false,
defaultQueryTimeoutMs: 60_000,
connectTimeoutMs: 60_000,
qrTimeout: 60_000,
generateHighQualityLinkPreview: false,
});

session.socket = sock;

sock.ev.on("creds.update", saveCreds);

sock.ev.on("connection.update", async (update) => {
const currentSession = this.sessions.get(userId);
if (!currentSession || currentSession.socket !== sock) return;

const { connection, qr, lastDisconnect } = update;

if (qr) {
this.setStatus(userId, {
state: "qr",
qr,
code: null,
me: null,
error: null,
phone: phone ?? null,
});
}

if (connection === "connecting") {
  const current = this.getStatus(userId);
  if (current.state !== "pairing_code") {
    this.setStatus(userId, {
      state: "connecting",
      error: null,
      phone: phone ?? null,
    });
  }
}

if (connection === "open") {
const me = sock.user
? {
id: sock.user.id,
name: sock.user.name,
}
: null;

this.setStatus(userId, {
state: "connected",
me,
qr: null,
code: null,
error: null,
phone: phone ?? null,
});
}

if (connection === "close") {
const boom = lastDisconnect?.error as Boom | undefined;
const statusCode = boom?.output?.statusCode;
const shouldReconnect =
!currentSession.stopRequested &&
statusCode !== DisconnectReason.loggedOut;

if (statusCode === DisconnectReason.loggedOut) {
currentSession.socket = null;
await this.removeSessionDir(userId).catch(() => undefined);
this.setStatus(userId, {
state: "disconnected",
me: null,
qr: null,
code: null,
phone: null,
error: null,
});
return;
}

if (shouldReconnect) {
currentSession.socket = null;
const current = this.getStatus(userId);
if (current.state !== "pairing_code") {
  this.setStatus(userId, {
    state: "connecting",
    error: null,
    qr: null,
    code: null,
  });
}
void this.startWithOptions(userId, currentSession.phone ? { phone: currentSession.phone } : undefined);
return;
}

currentSession.socket = null;
const current = this.getStatus(userId);
if (current.state === "pairing_code") {
  this.setStatus(userId, {
    error: boom?.message || "WhatsApp desconectado",
  });
} else {
  this.setStatus(userId, {
    state: "disconnected",
    me: null,
    qr: null,
    code: null,
    error: boom?.message || "WhatsApp desconectado",
    phone: null,
  });
}
}
});
if (phone) {
const waitForPairing = async () => {
for (let i = 0; i < 60; i += 1) {
const current = this.sessions.get(userId);
if (!current || current.socket !== sock) break;

if ((sock.authState?.creds?.registered ?? false) === false || !sock.user) {
try {
const code = await sock.requestPairingCode(phone);
this.setStatus(userId, {
state: "pairing_code",
qr: null,
code,
phone,
me: null,
error: null,
});
return;
} catch {
// keep waiting for socket readiness
}
}

await new Promise((resolve) => setTimeout(resolve, 1000));
}
};

void waitForPairing();
}

return this.getStatus(userId);
}

async restart(userId: string, options?: StartOptions): Promise<WhatsAppStatus> {
await this.disconnect(userId, { preserveAuth: false });
return this.startWithOptions(userId, options);
}

async disconnect(userId: string, opts?: { preserveAuth?: boolean }): Promise<void> {
const preserveAuth = opts?.preserveAuth ?? false;
const session = this.sessions.get(userId);

if (session) {
session.stopRequested = true;

if (session.socket) {
try {
await session.socket.logout();
} catch {
try {
session.socket.end(new Error("disconnect"));
} catch {
// ignore
}
}
}

session.socket = null;
session.connecting = null;
session.phone = null;
}

if (!preserveAuth) {
await this.removeSessionDir(userId).catch(() => undefined);
}

this.setStatus(userId, {
state: "disconnected",
me: null,
qr: null,
code: null,
phone: null,
error: null,
});
}

async shutdownAll(): Promise<void> {
const userIds = Array.from(this.sessions.keys());
for (const userId of userIds) {
await this.disconnect(userId, { preserveAuth: true });
}
}

setAutoReply(userId: string, enabled: boolean): void {
this.autoReplyEnabled.set(userId, enabled);
}

isAutoReplyEnabled(userId: string): boolean {
return this.autoReplyEnabled.get(userId) ?? false;
}

setAutoReplyToContacts(userId: string, enabled: boolean): void {
this.autoReplyToContacts.set(userId, enabled);
}

isAutoReplyToContactsEnabled(userId: string): boolean {
return this.autoReplyToContacts.get(userId) ?? false;
}

setAutoReplyPrompt(userId: string, prompt: string): void {
this.autoReplyPrompt.set(userId, prompt);
}

getAutoReplyPrompt(userId: string): string {
return this.autoReplyPrompt.get(userId) ?? "";
}

markMessageProcessed(messageId: string): boolean {
if (!messageId) return false;
if (this.processedMessages.has(messageId)) return true;
this.processedMessages.add(messageId);
return false;
}

async sendText(userId: string, to: string, text: string): Promise<void> {
const session = this.sessions.get(userId);
const sock = session?.socket;

if (!sock) {
throw new Error("WhatsApp no está conectado");
}

await sock.sendMessage(to, { text });
this.emit("outbound_message", userId, { to, text, timestamp: Date.now() });
}
}

export const whatsappWebManager = new WhatsAppWebManager();
