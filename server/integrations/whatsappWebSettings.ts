import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type WhatsAppWebSettingsV1 = {
  version: 1;
  autoReply: {
    enabled: boolean;
    controllersOnly: boolean;
    allowAgenticTools: boolean;
  };
  controllers: string[]; // WhatsApp JIDs allowed to control auto-replies (e.g. "123@s.whatsapp.net")
  pairing?: {
    salt: string;
    hash: string;
    expiresAt: number;
    createdAt: number;
  };
  updatedAt: number;
};

export type WhatsAppWebSettings = WhatsAppWebSettingsV1;

const SETTINGS_FILE = 'settings.json';

function ensureDirSecure(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* ignore */ }
}

function getBaseDir(): string {
  const base = path.join(process.cwd(), 'data', 'whatsapp-web');
  ensureDirSecure(base);
  return base;
}

function resolveLegacyDirIfSafe(userId: string): string | null {
  const base = getBaseDir();
  const candidate = path.resolve(base, userId);
  // Prevent path traversal: only allow dirs under base.
  if (!candidate.startsWith(base + path.sep)) return null;
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      ensureDirSecure(candidate);
      return candidate;
    }
  } catch {
    // ignore
  }
  return null;
}

export function getWhatsAppWebUserDir(userId: string): string {
  const legacy = resolveLegacyDirIfSafe(userId);
  if (legacy) return legacy;

  const digest = crypto.createHash('sha256').update(userId).digest('hex');
  const dir = path.join(getBaseDir(), digest);
  ensureDirSecure(dir);
  return dir;
}

function settingsPath(userId: string): string {
  return path.join(getWhatsAppWebUserDir(userId), SETTINGS_FILE);
}

function defaultSettings(): WhatsAppWebSettings {
  return {
    version: 1,
    autoReply: {
      enabled: false,
      controllersOnly: true,
      allowAgenticTools: false,
    },
    controllers: [],
    updatedAt: Date.now(),
  };
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  ensureDirSecure(dir);
  const tmp = path.join(dir, `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* ignore */ }
  fs.renameSync(tmp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* ignore */ }
}

export function loadWhatsAppWebSettings(userId: string): WhatsAppWebSettings {
  const p = settingsPath(userId);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw || '{}') as Partial<WhatsAppWebSettings>;
    if (parsed?.version !== 1) return defaultSettings();

    const merged: WhatsAppWebSettings = {
      ...defaultSettings(),
      ...parsed,
      autoReply: {
        ...defaultSettings().autoReply,
        ...(parsed.autoReply || {}),
      },
      controllers: Array.isArray(parsed.controllers) ? parsed.controllers.filter((x) => typeof x === 'string') : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };

    // Clear expired pairing codes automatically.
    if (merged.pairing && merged.pairing.expiresAt <= Date.now()) {
      delete merged.pairing;
      merged.updatedAt = Date.now();
      atomicWriteJson(p, merged);
    }

    return merged;
  } catch {
    const s = defaultSettings();
    try { atomicWriteJson(p, s); } catch { /* ignore */ }
    return s;
  }
}

export function saveWhatsAppWebSettings(userId: string, settings: WhatsAppWebSettings): WhatsAppWebSettings {
  const p = settingsPath(userId);
  const next: WhatsAppWebSettings = {
    ...settings,
    version: 1,
    updatedAt: Date.now(),
  };
  atomicWriteJson(p, next);
  return next;
}

export function updateWhatsAppWebSettings(
  userId: string,
  patch: Partial<Pick<WhatsAppWebSettingsV1, 'autoReply' | 'controllers' | 'pairing'>>,
): WhatsAppWebSettings {
  const current = loadWhatsAppWebSettings(userId);
  const next: WhatsAppWebSettings = {
    ...current,
    ...patch,
    autoReply: {
      ...current.autoReply,
      ...(patch.autoReply || {}),
    },
    controllers: patch.controllers ? patch.controllers : current.controllers,
    pairing: patch.pairing === undefined ? current.pairing : patch.pairing,
    updatedAt: Date.now(),
  };
  return saveWhatsAppWebSettings(userId, next);
}

export function isController(settings: WhatsAppWebSettings, fromJid: string): boolean {
  return settings.controllers.includes(fromJid);
}

export function generatePairingCode(userId: string, ttlMs = 10 * 60 * 1000): { code: string; expiresAt: number } {
  // 12 hex chars (~48 bits). Much harder to brute-force than 6 digits, still phone-friendly.
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(code, salt, 32).toString('hex');
  const expiresAt = Date.now() + ttlMs;

  updateWhatsAppWebSettings(userId, {
    pairing: {
      salt,
      hash,
      expiresAt,
      createdAt: Date.now(),
    },
  });

  return { code, expiresAt };
}

export function tryPairController(userId: string, fromJid: string, code: string): { ok: boolean; reason?: string } {
  const current = loadWhatsAppWebSettings(userId);
  const pairing = current.pairing;
  if (!pairing || pairing.expiresAt <= Date.now()) {
    return { ok: false, reason: 'NO_ACTIVE_CODE' };
  }

  const normalized = String(code || '').trim();
  if (!normalized) return { ok: false, reason: 'EMPTY_CODE' };

  let matches = false;
  try {
    const computed = crypto.scryptSync(normalized, pairing.salt, 32).toString('hex');
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(pairing.hash, 'hex');
    matches = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    matches = false;
  }

  if (!matches) return { ok: false, reason: 'INVALID_CODE' };

  const nextControllers = current.controllers.includes(fromJid)
    ? current.controllers
    : [...current.controllers, fromJid];

  // Pairing is explicit opt-in, so we enable auto-reply for controllers.
  updateWhatsAppWebSettings(userId, {
    controllers: nextControllers,
    pairing: undefined,
    autoReply: {
      enabled: true,
      controllersOnly: true,
    },
  });

  return { ok: true };
}

export function removeController(userId: string, jid: string): WhatsAppWebSettings {
  const current = loadWhatsAppWebSettings(userId);
  const nextControllers = current.controllers.filter((c) => c !== jid);
  const next = updateWhatsAppWebSettings(userId, {
    controllers: nextControllers,
    autoReply: nextControllers.length === 0
      ? { enabled: false, controllersOnly: true }
      : undefined,
  });
  return next;
}

export function maskJid(jid: string): string {
  const raw = String(jid || '');
  const digits = raw.replace(/\\D/g, '');
  if (digits.length >= 6) {
    const last4 = digits.slice(-4);
    return raw.replace(digits, `***${last4}`);
  }
  if (raw.length <= 10) return raw;
  return raw.slice(0, 3) + '***' + raw.slice(-3);
}

export function settingsForClient(settings: WhatsAppWebSettings): {
  autoReplyEnabled: boolean;
  controllersOnly: boolean;
  allowAgenticTools: boolean;
  controllers: Array<{ jid: string; masked: string }>;
  pairingActive: boolean;
  pairingExpiresAt: number | null;
  updatedAt: number;
} {
  const pairingActive = !!settings.pairing && settings.pairing.expiresAt > Date.now();
  return {
    autoReplyEnabled: !!settings.autoReply.enabled,
    controllersOnly: !!settings.autoReply.controllersOnly,
    allowAgenticTools: !!settings.autoReply.allowAgenticTools,
    controllers: settings.controllers.map((jid) => ({ jid, masked: maskJid(jid) })),
    pairingActive,
    pairingExpiresAt: pairingActive ? settings.pairing!.expiresAt : null,
    updatedAt: settings.updatedAt,
  };
}
