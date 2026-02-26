import * as fs from 'fs';
import * as path from 'path';

interface DiscoveredPlugin {
  id: string;
  entryPoint: string;
  directory: string;
}

const ENTRY_POINTS = ['index.ts', 'index.js', 'index.mjs'];

export function discoverPlugins(pluginsDir: string): DiscoveredPlugin[] {
  const discovered: DiscoveredPlugin[] = [];

  try {
    const entries = fs.readdirSync(pluginsDir);
    for (const entry of entries) {
      const pluginPath = path.join(pluginsDir, entry);
      try {
        if (!fs.statSync(pluginPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const entryPoint = ENTRY_POINTS.find((ep) =>
        fs.existsSync(path.join(pluginPath, ep)),
      );

      if (entryPoint) {
        discovered.push({
          id: entry,
          entryPoint: path.join(pluginPath, entryPoint),
          directory: pluginPath,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return discovered;
}
