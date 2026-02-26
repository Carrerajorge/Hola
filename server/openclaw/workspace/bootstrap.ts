import * as fs from 'fs';
import * as path from 'path';
import type { BootstrapFileName, WorkspaceBootstrapFile } from '../types';

const BOOTSTRAP_FILES: BootstrapFileName[] = ['SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'MEMORY.md', 'AGENTS.md', 'BOOTSTRAP.md'];

export function loadBootstrapFiles(workspaceDir: string): WorkspaceBootstrapFile[] {
  return BOOTSTRAP_FILES.map(name => {
    const filePath = path.join(workspaceDir, name);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { name, path: filePath, content, missing: false };
    } catch {
      return { name, path: filePath, content: null, missing: true };
    }
  });
}
