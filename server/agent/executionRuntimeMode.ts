function parseBooleanOverride(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

export function isAgentBackgroundQueueEnabled(): boolean {
  const override = parseBooleanOverride(process.env.ENABLE_AGENT_BACKGROUND_QUEUE);
  if (override !== null) {
    return override;
  }

  return process.env.NODE_ENV === "production" && isRedisConfigured();
}
