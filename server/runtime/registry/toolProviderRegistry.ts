import type { ToolRuntime } from "../contracts";

const providers = new Map<string, ToolRuntime>();

export function registerToolProvider(name: string, runtime: ToolRuntime) {
  providers.set(name, runtime);
}

export function getToolProvider(name: string): ToolRuntime | undefined {
  return providers.get(name);
}

export function listToolProviders(): string[] {
  return [...providers.keys()];
}
