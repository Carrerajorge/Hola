import type { SessionStore } from './persistence';

export async function compactSessions(
  store: SessionStore,
  agentId: string,
  retentionDays: number,
): Promise<number> {
  const sessions = await store.listForAgent(agentId);
  const cutoff = Date.now() - retentionDays * 86400000;
  let removed = 0;

  for (const session of sessions) {
    if (session.lastActiveAt < cutoff) {
      const deleted = await store.delete(agentId, session.key);
      if (deleted) removed++;
    }
  }

  return removed;
}
