import type { ChannelConversation } from "@shared/schema/channels";
import type { ChannelRuntimeConfig } from "./runtimeConfig";
import type { MessageEnvelope } from "./types";

export type ChannelPolicyDecisionCode =
  | "ok"
  | "off_for_owner_only"
  | "outside_window"
  | "rate_limited"
  | "blocked_sender"
  | "disabled"
  | "invalid_payload";

export type ChannelPolicyDecision = {
  allowed: boolean;
  code: ChannelPolicyDecisionCode;
  replyText: string;
  requiresTemplate?: boolean;
  requiresOwnerHandshake?: boolean;
  shouldRespond?: boolean;
  throttleUntilIso?: string;
};

export type ResultOk<T> = {
  ok: true;
  data: T;
};

export type ResultErr<T> = {
  ok: false;
  error: ChannelPolicyDecisionCode;
  data: T;
};

export type ChannelPolicyResult = ResultOk<ChannelPolicyDecision> | ResultErr<ChannelPolicyDecision>;

const CHANNEL_WINDOWS_MS: Record<MessageEnvelope["channel"], number> = {
  whatsapp_cloud: 24 * 60 * 60 * 1000,
  messenger: 24 * 60 * 60 * 1000,
  wechat: 24 * 60 * 60 * 1000,
  telegram: 0,
};
const MAX_RATE_LIMIT_PER_MINUTE = 120;
const MAX_IDENTITY_LIST_SIZE = 64;

export function parseChannelPairingCodeFromMessage(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const normalized = text.trim();
  if (normalized.length > 256) return null;
  if (!normalized) return null;

  const directStart = /^\/(?:start|code)\s+([A-Z0-9]{6,})$/i.exec(normalized);
  if (directStart) return directStart[1].toUpperCase();

  const regexes = [
    /^code\s*[:#]?\s*([A-Z0-9]{6,})$/i,
    /^pair\s*[:#]?\s*([A-Z0-9]{6,})$/i,
    /^alia\s+pair\s*[:#]?\s*([A-Z0-9]{6,})$/i,
    /^token\s*[:#]?\s*([A-Z0-9]{6,})$/i,
  ];

  for (const re of regexes) {
    const m = re.exec(normalized);
    if (m) return m[1]?.toUpperCase() ?? null;
  }

  return null;
}

function parseDateMs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringSet(values: unknown): Set<string> {
  if (!Array.isArray(values)) return new Set<string>();
  if (values.length > MAX_IDENTITY_LIST_SIZE) {
    return new Set(
      values
        .slice(0, MAX_IDENTITY_LIST_SIZE)
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0),
    );
  }
  return new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0),
  );
}

function addOwnerIdCandidate(target: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      addOwnerIdCandidate(target, item);
    }
    return;
  }

  const candidate = String(value ?? "").trim();
  if (candidate.length > 0) target.add(candidate);
}

function addOwnerIdCandidatesFromObject(target: Set<string>, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;

  addOwnerIdCandidate(target, raw.ownerExternalId);
  addOwnerIdCandidate(target, raw.ownerId);
  addOwnerIdCandidate(target, raw.owner_external_ids);
  addOwnerIdCandidate(target, raw.owner_external_id);
  addOwnerIdCandidate(target, raw.owners);
}

function getMetadataObject(conversation: ChannelConversation): Record<string, unknown> {
  if (conversation && typeof conversation.metadata === "object" && conversation.metadata !== null) {
    return conversation.metadata as Record<string, unknown>;
  }
  return {};
}

function getPolicyMap(conversation: ChannelConversation): Record<string, unknown> {
  const metadata = getMetadataObject(conversation);
  const raw = metadata.policy;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function getOwnerIdentityCandidatesFromMetadata(conversation: ChannelConversation): Set<string> {
  const metadata = getMetadataObject(conversation);
  const out = new Set<string>();

  addOwnerIdCandidatesFromObject(out, metadata.ownerIdentity);
  addOwnerIdCandidatesFromObject(out, getPolicyMap(conversation).ownerIdentity);

  const runtime = metadata.runtime;
  addOwnerIdCandidate(out, runtime && typeof runtime === "object" && !Array.isArray(runtime)
    ? (runtime as Record<string, unknown>).owner_external_ids
    : undefined);

  return out;
}

export function getConversationOwnerIds(conversation: ChannelConversation): string[] {
  const out = getOwnerIdentityCandidatesFromMetadata(conversation);
  return Array.from(out).sort();
}

function conversationOwnerCandidates(
  runtimeConfig: ChannelRuntimeConfig,
  conversation: ChannelConversation,
): Set<string> {
  const out = new Set<string>(toStringSet(runtimeConfig.owner_external_ids));
  addOwnerIdCandidate(out, getPolicyMap(conversation).owner_external_ids);

  for (const owner of getConversationOwnerIds(conversation)) {
    out.add(owner);
  }

  return out;
}

function normalizeWindowRecoveryMessage(channel: MessageEnvelope["channel"]): string {
  if (channel === "whatsapp_cloud") {
    return "La conversación de WhatsApp está fuera de la ventana activa (24h). Pide al usuario que reabra el chat y solo puedo responder con plantilla aprobada.";
  }

  if (channel === "messenger") {
    return "Esta conversación de Messenger está fuera de la ventana activa. Usa un mensaje con etiqueta/OTN o plantilla aprobada para reabrir el chat.";
  }

  return "Esta conversación está fuera de ventana. Pide al cliente que escriba de nuevo para reabrir el chat.";
}

function normalizeOwnerBlockMessage(channel: MessageEnvelope["channel"]): string {
  if (channel === "whatsapp_cloud") {
    return "No puedo responder aquí ahora mismo. Envía el código de vinculación recibido desde la app para habilitar este canal.";
  }
  return "No se procesa este mensaje porque el auto-reply está desactivado para este chat.";
}

function normalizePayloadErrorMessage(): string {
  return "Evento no procesable. Verifica que el mensaje contenga un identificador válido.";
}

function normalizeBlockedSenderMessage(): string {
  return "Mensaje bloqueado por configuración de seguridad del canal.";
}

export type ChannelPolicyContext = {
  conversation: ChannelConversation;
  envelope: MessageEnvelope;
  runtimeConfig: ChannelRuntimeConfig;
  globalResponderEnabled: boolean;
  senderIsOwner?: boolean;
};

export type ChannelWindowState = {
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
};

export function getConversationWindowState(conversation: ChannelConversation): ChannelWindowState {
  const metadata = getMetadataObject(conversation);
  return {
    lastInboundAt: typeof metadata.lastInboundAt === "string" ? metadata.lastInboundAt : null,
    lastOutboundAt: typeof metadata.lastOutboundAt === "string" ? metadata.lastOutboundAt : null,
  };
}

export function getConversationPolicy(conversation: ChannelConversation): {
  autoResponderEnabled: boolean | null;
  ownerOnly: boolean;
  ownerExternalIds: string[];
  rateLimitPerMinute: number;
} {
  const policy = getPolicyMap(conversation);

  const autoResponderEnabled =
    typeof policy.autoResponderEnabled === "boolean"
      ? policy.autoResponderEnabled
      : typeof policy.auto_responder_enabled === "boolean"
        ? policy.auto_responder_enabled
        : typeof policy.enabled === "boolean"
          ? policy.enabled
          : null;

  const ownerOnly =
    typeof policy.ownerOnly === "boolean"
      ? policy.ownerOnly
      : typeof policy.owner_only === "boolean"
        ? policy.owner_only
        : false;

  const ownerExternalIds = toStringSet(
    policy.owner_external_ids ?? policy.ownerExternalIds ?? policy.owner_ids ?? policy.owners ?? policy.ownerExternalIds,
  );

  const rate = Number(
    policy.rateLimitPerMinute ??
      policy.rateLimit ??
      policy.rate_limit_per_minute ??
      policy.rate_limit,
  );
  const rateLimitPerMinute = Number.isFinite(rate) && rate > 0
    ? Math.min(Math.floor(rate), MAX_RATE_LIMIT_PER_MINUTE)
    : 6;

  return {
    autoResponderEnabled,
    ownerOnly,
    ownerExternalIds: Array.from(ownerExternalIds),
    rateLimitPerMinute,
  };
}

function nowWithinWindow(channel: MessageEnvelope["channel"], lastTs: number, now: number): boolean {
  const windowMs = CHANNEL_WINDOWS_MS[channel] ?? 0;
  if (windowMs <= 0) return true;
  if (!lastTs) return true;
  return now - lastTs <= windowMs;
}

export function evaluateChannelPolicy(
  context: ChannelPolicyContext,
  windowState: ChannelWindowState,
  rateControl?: { allowed: boolean; retryAfterIso?: string },
): ChannelPolicyResult {
  if (
    !context.envelope.providerMessageId ||
    !context.envelope.senderId ||
    !context.envelope.channelKey ||
    !context.envelope.threadId
  ) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  const allowlist = toStringSet(context.runtimeConfig.allowlist);
  if (allowlist.size > 0 && !allowlist.has(context.envelope.senderId)) {
    return {
      ok: false,
      error: "blocked_sender",
      data: {
        allowed: false,
        code: "blocked_sender",
        replyText: normalizeBlockedSenderMessage(),
        requiresOwnerHandshake: false,
        shouldRespond: false,
      },
    };
  }

  if (rateControl && !rateControl.allowed) {
    return {
      ok: false,
      error: "rate_limited",
      data: {
        allowed: false,
        code: "rate_limited",
        replyText: "Has enviado mensajes muy rápido. Espera un momento y vuelve a intentarlo.",
        requiresOwnerHandshake: true,
        shouldRespond: false,
        throttleUntilIso: rateControl.retryAfterIso,
      },
    };
  }

  const conversationPolicy = getPolicyMap(context.conversation);
  const ownerCandidates = conversationOwnerCandidates(context.runtimeConfig, context.conversation);
  const isOwner = ownerCandidates.size > 0
    ? ownerCandidates.has(context.envelope.senderId)
    : Boolean(context.senderIsOwner);

  const conversationPolicyEnabled =
    typeof conversationPolicy.autoResponderEnabled === "boolean"
      ? conversationPolicy.autoResponderEnabled
      : context.globalResponderEnabled;

  const ownerOnly =
    typeof conversationPolicy.ownerOnly === "boolean"
      ? conversationPolicy.ownerOnly
      : Boolean(context.runtimeConfig.owner_only);

  if (!conversationPolicyEnabled && !isOwner) {
    return {
      ok: false,
      error: "off_for_owner_only",
      data: {
        allowed: false,
        code: "off_for_owner_only",
        replyText: normalizeOwnerBlockMessage(context.envelope.channel),
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  if (ownerOnly && !isOwner) {
    return {
      ok: false,
      error: "off_for_owner_only",
      data: {
        allowed: false,
        code: "off_for_owner_only",
        replyText:
          "Este chat está configurado para solo propietario. Envía el código del chat desde el panel para habilitar respuestas automáticas.",
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  const latestTs = Math.max(
    parseDateMs(windowState.lastInboundAt),
    parseDateMs(windowState.lastOutboundAt),
  );

  if (!nowWithinWindow(context.envelope.channel, latestTs, Date.now())) {
    return {
      ok: false,
      error: "outside_window",
      data: {
        allowed: false,
        code: "outside_window",
        replyText: normalizeWindowRecoveryMessage(context.envelope.channel),
        requiresTemplate: context.envelope.channel === "whatsapp_cloud" || context.envelope.channel === "messenger",
        requiresOwnerHandshake: isOwner,
        shouldRespond: true,
      },
    };
  }

  return {
    ok: true,
    data: {
      allowed: true,
      code: "ok",
      replyText: "",
      shouldRespond: true,
    },
  };
}
