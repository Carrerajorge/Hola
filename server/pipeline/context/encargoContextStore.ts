import type { IngestedChunk } from "../ingestion2026/ingestionTypes";
import type { BriefAttachmentSummary } from "../requestUnderstanding/requestUnderstandingAgent";

export interface EncargoContextSnapshot {
  chatId: string;
  updatedAt: number;
  chunks: IngestedChunk[];
  attachments: BriefAttachmentSummary[];
}

const MAX_CHATS = Number.parseInt(process.env.ENCARGO_CTX_MAX_CHATS || "50", 10);
const TTL_MS = Number.parseInt(process.env.ENCARGO_CTX_TTL_MS || String(2 * 60 * 60 * 1000), 10);
const MAX_CHUNKS_PER_CHAT = Number.parseInt(process.env.ENCARGO_CTX_MAX_CHUNKS || "800", 10);
const MAX_ATTACHMENTS_PER_CHAT = Number.parseInt(process.env.ENCARGO_CTX_MAX_ATTACHMENTS || "100", 10);

const store = new Map<string, EncargoContextSnapshot>();

function isExpired(s: EncargoContextSnapshot, nowMs: number): boolean {
  return nowMs - s.updatedAt > TTL_MS;
}

function dedupAttachments(items: BriefAttachmentSummary[]): BriefAttachmentSummary[] {
  const seen = new Set<string>();
  const out: BriefAttachmentSummary[] = [];
  for (const it of items) {
    const key = `${it.kind}:${it.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= MAX_ATTACHMENTS_PER_CHAT) break;
  }
  return out;
}

function dedupChunks(items: IngestedChunk[]): IngestedChunk[] {
  const seen = new Set<string>();
  const out: IngestedChunk[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function capChunks(items: IngestedChunk[]): IngestedChunk[] {
  if (items.length <= MAX_CHUNKS_PER_CHAT) return items;

  const isHeading = (c: IngestedChunk) => String(c.metadata?.kindLabel || "") === "heading";
  const isTable = (c: IngestedChunk) => String(c.metadata?.kindLabel || "") === "table";

  const images = items.filter(c => c.kind === "image").slice(0, 50);
  const tables = items.filter(isTable).slice(0, 300);
  const headings = items.filter(isHeading).slice(0, 150);

  const keepIds = new Set<string>([...images, ...tables, ...headings].map(c => c.id));
  const rest = items.filter(c => !keepIds.has(c.id));

  const merged = [...images, ...tables, ...headings, ...rest];
  return merged.slice(0, MAX_CHUNKS_PER_CHAT);
}

function prune(nowMs: number): void {
  for (const [key, snap] of store) {
    if (isExpired(snap, nowMs)) {
      store.delete(key);
    }
  }

  // LRU eviction: Map iteration order is insertion order.
  while (store.size > MAX_CHATS) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }
}

export function loadEncargoContext(chatId: string): EncargoContextSnapshot | null {
  const id = (chatId || "").trim();
  if (!id) return null;

  const nowMs = Date.now();
  prune(nowMs);

  const snap = store.get(id);
  if (!snap) return null;
  if (isExpired(snap, nowMs)) {
    store.delete(id);
    return null;
  }

  // Refresh LRU order.
  store.delete(id);
  store.set(id, snap);

  return snap;
}

export function rememberEncargoContext(args: {
  chatId: string;
  chunks: IngestedChunk[];
  attachments: BriefAttachmentSummary[];
}): EncargoContextSnapshot | null {
  const id = (args.chatId || "").trim();
  if (!id) return null;

  const nowMs = Date.now();
  prune(nowMs);

  const existing = store.get(id);

  const mergedChunks = capChunks(
    dedupChunks([...(existing?.chunks || []), ...(args.chunks || [])])
  );
  const mergedAttachments = dedupAttachments([...(existing?.attachments || []), ...(args.attachments || [])]);

  const next: EncargoContextSnapshot = {
    chatId: id,
    updatedAt: nowMs,
    chunks: mergedChunks,
    attachments: mergedAttachments,
  };

  store.delete(id);
  store.set(id, next);

  return next;
}

export function clearEncargoContext(chatId: string): void {
  const id = (chatId || "").trim();
  if (!id) return;
  store.delete(id);
}

