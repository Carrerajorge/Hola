import type { PersistedSession } from '../types';

interface SessionOverrides {
  modelOverride?: string;
  metadata?: Record<string, unknown>;
}

export function applySessionOverride(session: PersistedSession, overrides: SessionOverrides): PersistedSession {
  return {
    ...session,
    ...(overrides.modelOverride !== undefined && { modelOverride: overrides.modelOverride }),
    ...(overrides.metadata && { metadata: { ...session.metadata, ...overrides.metadata } }),
  };
}
