interface LocalUploadIntent {
  actorId: string;
  storagePath: string;
  expiresAt: number;
}

const LOCAL_UPLOAD_INTENTS_TTL_MS = 10 * 60 * 1000;
const MAX_LOCAL_UPLOAD_INTENTS = Number(process.env.MAX_LOCAL_UPLOAD_INTENTS || 5000);

const localUploadIntents = new Map<string, LocalUploadIntent>();

export function registerLocalUploadIntent(objectId: string, actorId: string, storagePath: string): void {
  localUploadIntents.set(objectId, {
    actorId,
    storagePath,
    expiresAt: Date.now() + LOCAL_UPLOAD_INTENTS_TTL_MS,
  });

  if (localUploadIntents.size <= MAX_LOCAL_UPLOAD_INTENTS) {
    return;
  }

  cleanupExpiredLocalUploadIntents();
  if (localUploadIntents.size <= MAX_LOCAL_UPLOAD_INTENTS) {
    return;
  }

  const excess = localUploadIntents.size - MAX_LOCAL_UPLOAD_INTENTS;
  const keys = Array.from(localUploadIntents.keys()).slice(0, excess);
  keys.forEach((key) => localUploadIntents.delete(key));
}

export function consumeLocalUploadIntent(objectId: string, actorId: string): LocalUploadIntent | null {
  const intent = localUploadIntents.get(objectId);
  if (!intent || intent.expiresAt < Date.now() || intent.actorId !== actorId) {
    return null;
  }
  return intent;
}

export function clearLocalUploadIntents(prefix: string): void {
  for (const key of localUploadIntents.keys()) {
    if (key.startsWith(prefix)) {
      localUploadIntents.delete(key);
    }
  }
}

export function clearLocalUploadIntent(objectId: string): void {
  localUploadIntents.delete(objectId);
}

export function cleanupExpiredLocalUploadIntents(now: number = Date.now()): void {
  for (const [id, intent] of localUploadIntents) {
    if (intent.expiresAt < now) {
      localUploadIntents.delete(id);
    }
  }
}
