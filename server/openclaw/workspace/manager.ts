import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceManager {
  constructor(private baseDir: string) {}

  ensureWorkspace(agentId: string): string {
    const wsDir = path.join(this.baseDir, agentId);
    fs.mkdirSync(wsDir, { recursive: true });
    return wsDir;
  }

  listWorkspaces(): string[] {
    try {
      return fs.readdirSync(this.baseDir).filter(d =>
        fs.statSync(path.join(this.baseDir, d)).isDirectory()
      );
    } catch { return []; }
  }

  getWorkspacePath(agentId: string): string {
    return path.join(this.baseDir, agentId);
  }
}
