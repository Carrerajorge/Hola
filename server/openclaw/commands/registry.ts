/**
 * OpenClaw Command Registry
 *
 * Adapted from upstream openclaw auto-reply command system.
 * Provides a centralized registry of slash-commands that agents and users can invoke.
 *
 * Commands are organized by category and scope:
 *   - "text"   → triggered via `/command` in chat
 *   - "native" → triggered via UI buttons / RPC
 *   - "both"   → available in both surfaces
 */

export type CommandScope = 'text' | 'native' | 'both';
export type CommandCategory =
  | 'core'
  | 'session'
  | 'agent'
  | 'config'
  | 'tools'
  | 'debug'
  | 'docks';

export interface CommandArgDefinition {
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ value: string; label: string }>;
}

export interface ChatCommandDefinition {
  key: string;
  nativeName?: string;
  description: string;
  textAliases: string[];
  acceptsArgs: boolean;
  args?: CommandArgDefinition[];
  scope: CommandScope;
  category: CommandCategory;
  handler?: CommandHandler;
}

export interface CommandContext {
  userId: string;
  sessionKey?: string;
  chatId?: string;
  runId?: string;
  args?: Record<string, string>;
  rawArgs?: string;
}

export interface CommandResult {
  text?: string;
  data?: unknown;
  error?: string;
  silent?: boolean;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

// ── Registry ─────────────────────────────────────────────────────────────

const commands = new Map<string, ChatCommandDefinition>();
const textAliasMap = new Map<string, string>(); // alias → key

export function registerCommand(def: ChatCommandDefinition): void {
  if (commands.has(def.key)) {
    throw new Error(`Duplicate command key: ${def.key}`);
  }
  commands.set(def.key, def);

  for (const alias of def.textAliases) {
    const normalized = alias.trim().toLowerCase();
    if (textAliasMap.has(normalized)) {
      throw new Error(`Duplicate text alias: ${normalized} (command: ${def.key})`);
    }
    textAliasMap.set(normalized, def.key);
  }
}

export function getCommand(key: string): ChatCommandDefinition | undefined {
  return commands.get(key);
}

export function resolveTextCommand(text: string): ChatCommandDefinition | undefined {
  const trimmed = text.trim().toLowerCase();
  // Try exact match first
  const key = textAliasMap.get(trimmed);
  if (key) return commands.get(key);

  // Try matching just the command part (before first space)
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    const cmdPart = trimmed.substring(0, spaceIdx);
    const k = textAliasMap.get(cmdPart);
    if (k) return commands.get(k);
  }

  return undefined;
}

export function listCommands(opts?: {
  category?: CommandCategory;
  scope?: CommandScope;
}): ChatCommandDefinition[] {
  let result = [...commands.values()];
  if (opts?.category) {
    result = result.filter(c => c.category === opts.category);
  }
  if (opts?.scope) {
    result = result.filter(c => c.scope === opts.scope || c.scope === 'both');
  }
  return result;
}

export function parseCommandArgs(
  text: string,
  def: ChatCommandDefinition,
): { command: string; args: Record<string, string>; rawArgs: string } {
  const parts = text.trim().split(/\s+/);
  const command = parts[0];
  const rawArgs = text.trim().substring(command.length).trim();
  const args: Record<string, string> = {};

  if (def.args) {
    for (let i = 0; i < def.args.length; i++) {
      const argDef = def.args[i];
      if (parts[i + 1]) {
        args[argDef.name] = parts[i + 1];
      }
    }
  }

  return { command, args, rawArgs };
}

export async function executeCommand(
  text: string,
  ctx: CommandContext,
): Promise<CommandResult | null> {
  const def = resolveTextCommand(text);
  if (!def || !def.handler) return null;

  const { args, rawArgs } = parseCommandArgs(text, def);
  return def.handler({ ...ctx, args, rawArgs });
}

export function clearRegistry(): void {
  commands.clear();
  textAliasMap.clear();
}

export function getRegistrySize(): number {
  return commands.size;
}
