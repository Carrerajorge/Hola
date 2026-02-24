import * as fs from 'fs';
import * as path from 'path';
import type { PersistedSession, SessionKey } from '../types';

export class SessionStore {
  constructor(private baseDir: string) {}

  async save(session: PersistedSession): Promise<void> {
    const dir = path.join(this.baseDir, session.agentId);
    fs.mkdirSync(dir, { recursive: true });
    const filename = this.keyToFilename(session.key);
    const filePath = path.join(dir, filename);
    // Atomic write: write to temp then rename
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  async load(agentId: string, key: SessionKey | string): Promise<PersistedSession | null> {
    const filename = this.keyToFilename(key);
    const filePath = path.join(this.baseDir, agentId, filename);
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as PersistedSession;
    } catch {
      return null;
    }
  }

  async listForAgent(agentId: string): Promise<PersistedSession[]> {
    const dir = path.join(this.baseDir, agentId);
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const sessions: PersistedSession[] = [];
      for (const file of files) {
        try {
          const data = fs.readFileSync(path.join(dir, file), 'utf-8');
          sessions.push(JSON.parse(data));
        } catch { /* skip corrupted */ }
      }
      return sessions;
    } catch {
      return [];
    }
  }

  async delete(agentId: string, key: SessionKey | string): Promise<boolean> {
    const filename = this.keyToFilename(key);
    const filePath = path.join(this.baseDir, agentId, filename);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private keyToFilename(key: string): string {
    // Sanitize key for filesystem: replace colons with underscores
    return key.replace(/:/g, '_') + '.json';
  }
}
