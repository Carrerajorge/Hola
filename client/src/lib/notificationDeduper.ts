import * as React from "react"

type NotificationSource = "radix" | "sonner"
type NotificationTone =
  | "default"
  | "destructive"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "loading"
  | "message"

type BurstRegistrationInput = {
  source: NotificationSource
  tone: NotificationTone
  title?: React.ReactNode | unknown
  description?: React.ReactNode | unknown
  dedupeKey?: string
  dedupeWindowMs?: number
  explicitId?: string | number
  createId: () => string
}

type BurstEntry = {
  id: string
  count: number
  lastAt: number
}

const DEFAULT_BURST_WINDOW_MS = 8_000
const MAX_TRACKED_BURSTS = 300
const BURST_TTL_MS = 60_000

const burstByKey = new Map<string, BurstEntry>()
const keysById = new Map<string, Set<string>>()

function rememberKeyForId(id: string, key: string) {
  const knownKeys = keysById.get(id) ?? new Set<string>()
  knownKeys.add(key)
  keysById.set(id, knownKeys)
}

function pruneExpiredBursts(now = Date.now()) {
  for (const [key, entry] of burstByKey.entries()) {
    if (now - entry.lastAt <= BURST_TTL_MS) continue

    burstByKey.delete(key)
    const knownKeys = keysById.get(entry.id)
    if (!knownKeys) continue
    knownKeys.delete(key)
    if (knownKeys.size === 0) {
      keysById.delete(entry.id)
    }
  }

  if (burstByKey.size <= MAX_TRACKED_BURSTS) return

  const overflow = burstByKey.size - MAX_TRACKED_BURSTS
  const oldestEntries = [...burstByKey.entries()]
    .sort(([, a], [, b]) => a.lastAt - b.lastAt)
    .slice(0, overflow)

  for (const [key, entry] of oldestEntries) {
    burstByKey.delete(key)
    const knownKeys = keysById.get(entry.id)
    if (!knownKeys) continue
    knownKeys.delete(key)
    if (knownKeys.size === 0) {
      keysById.delete(entry.id)
    }
  }
}

export function toPlainText(value: React.ReactNode | unknown): string | null {
  if (value === null || typeof value === "undefined" || typeof value === "boolean") {
    return null
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === "number") {
    return String(value)
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => toPlainText(item))
      .filter((item): item is string => Boolean(item))
    if (parts.length === 0) return null
    return parts.join(" ").trim() || null
  }

  if (React.isValidElement(value)) {
    return null
  }

  return null
}

function buildBurstKey({
  source,
  tone,
  title,
  description,
  dedupeKey,
}: Omit<BurstRegistrationInput, "dedupeWindowMs" | "explicitId" | "createId">) {
  const explicitKey = dedupeKey?.trim()
  if (explicitKey) {
    return `${source}:${tone}:${explicitKey.toLowerCase()}`
  }

  const titleText = toPlainText(title)
  const descriptionText = toPlainText(description)
  if (!titleText && !descriptionText) return null

  return `${source}:${tone}:${titleText ?? ""}::${descriptionText ?? ""}`.toLowerCase()
}

export function registerNotificationBurst({
  source,
  tone,
  title,
  description,
  dedupeKey,
  dedupeWindowMs,
  explicitId,
  createId,
}: BurstRegistrationInput) {
  const normalizedExplicitId =
    explicitId !== null && typeof explicitId !== "undefined" ? String(explicitId) : null

  if (normalizedExplicitId) {
    return {
      id: normalizedExplicitId,
      count: 1,
      isBurst: false,
    }
  }

  const now = Date.now()
  pruneExpiredBursts(now)

  const key = buildBurstKey({ source, tone, title, description, dedupeKey })
  if (!key) {
    return {
      id: createId(),
      count: 1,
      isBurst: false,
    }
  }

  const windowMs = dedupeWindowMs ?? DEFAULT_BURST_WINDOW_MS
  const existing = burstByKey.get(key)

  if (existing && now - existing.lastAt <= windowMs) {
    existing.lastAt = now
    existing.count += 1
    rememberKeyForId(existing.id, key)

    return {
      id: existing.id,
      count: existing.count,
      isBurst: true,
    }
  }

  const id = createId()
  burstByKey.set(key, {
    id,
    count: 1,
    lastAt: now,
  })
  rememberKeyForId(id, key)

  return {
    id,
    count: 1,
    isBurst: false,
  }
}

export function clearNotificationBurstById(id?: string | number) {
  if (typeof id === "undefined" || id === null) return

  const normalizedId = String(id)
  const knownKeys = keysById.get(normalizedId)
  if (!knownKeys) return

  for (const key of knownKeys) {
    burstByKey.delete(key)
  }

  keysById.delete(normalizedId)
}

export function clearAllNotificationBursts() {
  burstByKey.clear()
  keysById.clear()
}

export function formatRepeatedDescription(
  description: React.ReactNode | unknown,
  count: number,
) {
  if (count <= 1) return description as React.ReactNode

  const repeatLabel = `Repetido ${count} veces`
  const baseText = toPlainText(description)
  if (!baseText) return repeatLabel

  return `${baseText} · ${repeatLabel}`
}
