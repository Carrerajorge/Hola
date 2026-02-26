/**
 * Built-in OpenClaw Commands
 *
 * Registers the core set of commands adapted from upstream openclaw.
 * Each command is a self-contained handler that can be extended.
 */

import { registerCommand, type CommandContext, type CommandResult } from './registry';
import { openclawSubagentService } from '../agents/subagentService';
import { openclawEventBus } from '../events';

// ── Core Commands ────────────────────────────────────────────────────────

export function registerBuiltinCommands(): void {
  // /status — Show current agent status
  registerCommand({
    key: 'status',
    description: 'Show current agent and session status',
    textAliases: ['/status', '/st'],
    acceptsArgs: false,
    scope: 'both',
    category: 'core',
    nativeName: 'status',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      const runs = openclawSubagentService.list({
        requesterUserId: ctx.userId,
        limit: 10,
      });
      const active = runs.filter(r => r.status === 'running' || r.status === 'queued');
      const completed = runs.filter(r => r.status === 'completed');
      const failed = runs.filter(r => r.status === 'failed');

      return {
        text: [
          `**Agent Status**`,
          `Active runs: ${active.length}`,
          `Completed: ${completed.length}`,
          `Failed: ${failed.length}`,
          active.length > 0
            ? `\nRunning:\n${active.map(r => `  - ${r.id}: ${r.objective}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        data: { active: active.length, completed: completed.length, failed: failed.length, runs },
      };
    },
  });

  // /agents — List running subagents
  registerCommand({
    key: 'agents',
    description: 'List running and recent subagent runs',
    textAliases: ['/agents', '/ag'],
    acceptsArgs: true,
    args: [
      {
        name: 'status',
        description: 'Filter by status',
        choices: [
          { value: 'running', label: 'Running' },
          { value: 'completed', label: 'Completed' },
          { value: 'failed', label: 'Failed' },
          { value: 'all', label: 'All' },
        ],
      },
    ],
    scope: 'both',
    category: 'agent',
    nativeName: 'agents',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      const statusFilter = ctx.args?.status;
      const runs = openclawSubagentService.list({
        requesterUserId: ctx.userId,
        status: statusFilter !== 'all' ? (statusFilter as any) : undefined,
        limit: 25,
      });

      if (runs.length === 0) {
        return { text: 'No subagent runs found.' };
      }

      const lines = runs.map(r => {
        const icon =
          r.status === 'running'
            ? '[RUNNING]'
            : r.status === 'completed'
              ? '[OK]'
              : r.status === 'failed'
                ? '[FAIL]'
                : `[${r.status.toUpperCase()}]`;
        return `${icon} ${r.id} — ${r.objective} (${r.stepsCompleted} steps)`;
      });

      return {
        text: `**Subagent Runs** (${runs.length})\n${lines.join('\n')}`,
        data: runs,
      };
    },
  });

  // /kill <runId> — Cancel a running subagent
  registerCommand({
    key: 'kill',
    description: 'Cancel a running subagent',
    textAliases: ['/kill', '/cancel'],
    acceptsArgs: true,
    args: [{ name: 'runId', description: 'Run ID to cancel', required: true }],
    scope: 'both',
    category: 'agent',
    nativeName: 'kill',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      const runId = ctx.args?.runId || ctx.rawArgs;
      if (!runId) {
        return { error: 'Usage: /kill <runId>' };
      }

      const run = openclawSubagentService.get(runId.trim());
      if (!run || run.requesterUserId !== ctx.userId) {
        return { error: `Run not found: ${runId}` };
      }

      const cancelled = openclawSubagentService.cancel(runId.trim());
      if (!cancelled) {
        return { error: `Cannot cancel run ${runId} (status: ${run.status})` };
      }

      return { text: `Cancelled: ${runId}` };
    },
  });

  // /spawn <objective> — Spawn a new subagent
  registerCommand({
    key: 'spawn',
    description: 'Spawn a new subagent with an objective',
    textAliases: ['/spawn', '/run'],
    acceptsArgs: true,
    args: [{ name: 'objective', description: 'Task objective', required: true }],
    scope: 'both',
    category: 'agent',
    nativeName: 'spawn',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      const objective = ctx.rawArgs;
      if (!objective) {
        return { error: 'Usage: /spawn <objective>' };
      }

      const run = openclawSubagentService.spawn({
        requesterUserId: ctx.userId,
        objective,
        parentRunId: ctx.runId,
      });

      return {
        text: `Spawned subagent: ${run.id}\nObjective: ${objective}`,
        data: run,
      };
    },
  });

  // /config — Show current configuration
  registerCommand({
    key: 'config',
    description: 'Show current OpenClaw configuration',
    textAliases: ['/config', '/cfg'],
    acceptsArgs: false,
    scope: 'text',
    category: 'config',
    handler: async (_ctx: CommandContext): Promise<CommandResult> => {
      const { getOpenClawConfig } = await import('../config');
      const cfg = getOpenClawConfig();
      return {
        text: `**OpenClaw Configuration**\n\`\`\`json\n${JSON.stringify(cfg, null, 2)}\n\`\`\``,
        data: cfg,
      };
    },
  });

  // /tools — List available tools
  registerCommand({
    key: 'tools',
    description: 'List available agent tools',
    textAliases: ['/tools'],
    acceptsArgs: false,
    scope: 'both',
    category: 'tools',
    nativeName: 'tools',
    handler: async (_ctx: CommandContext): Promise<CommandResult> => {
      const { getToolRegistry } = await import('../../agent/toolRegistry');
      const registry = getToolRegistry();
      const tools = registry.listTools();

      const lines = tools.map(t => `  - **${t.name}**: ${t.description.substring(0, 80)}...`);

      return {
        text: `**Available Tools** (${tools.length})\n${lines.join('\n')}`,
        data: tools.map(t => ({ name: t.name, description: t.description })),
      };
    },
  });

  // /help — Show available commands
  registerCommand({
    key: 'help',
    description: 'Show available commands',
    textAliases: ['/help', '/h', '/?'],
    acceptsArgs: true,
    args: [{ name: 'command', description: 'Command to get help for' }],
    scope: 'both',
    category: 'core',
    nativeName: 'help',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      const { listCommands, getCommand } = await import('./registry');

      if (ctx.rawArgs) {
        const key = ctx.rawArgs.replace(/^\//, '').trim();
        const cmd = getCommand(key);
        if (cmd) {
          const argsHelp = cmd.args
            ? cmd.args.map(a => `  ${a.name}${a.required ? ' (required)' : ''}: ${a.description}`)
            : [];
          return {
            text: [
              `**/${cmd.key}** — ${cmd.description}`,
              `Aliases: ${cmd.textAliases.join(', ')}`,
              argsHelp.length > 0 ? `Arguments:\n${argsHelp.join('\n')}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          };
        }
        return { error: `Unknown command: ${key}` };
      }

      const all = listCommands();
      const byCategory = new Map<string, typeof all>();
      for (const cmd of all) {
        const cat = cmd.category || 'core';
        const existing = byCategory.get(cat) || [];
        existing.push(cmd);
        byCategory.set(cat, existing);
      }

      const sections: string[] = [];
      for (const [cat, cmds] of byCategory) {
        sections.push(
          `**${cat.charAt(0).toUpperCase() + cat.slice(1)}**\n` +
            cmds.map(c => `  ${c.textAliases[0]} — ${c.description}`).join('\n'),
        );
      }

      return {
        text: `**Available Commands**\n\n${sections.join('\n\n')}`,
        data: all.map(c => ({ key: c.key, aliases: c.textAliases, description: c.description })),
      };
    },
  });

  // /compact — Compact/summarize current session
  registerCommand({
    key: 'compact',
    description: 'Compact the current session history',
    textAliases: ['/compact'],
    acceptsArgs: false,
    scope: 'text',
    category: 'session',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      openclawEventBus.emit('command:compact', { userId: ctx.userId, sessionKey: ctx.sessionKey });
      return { text: 'Session compaction requested.' };
    },
  });

  // /clear — Clear session state
  registerCommand({
    key: 'clear',
    description: 'Clear the current session',
    textAliases: ['/clear', '/reset'],
    acceptsArgs: false,
    scope: 'text',
    category: 'session',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      openclawEventBus.emit('command:clear', { userId: ctx.userId, sessionKey: ctx.sessionKey });
      return { text: 'Session cleared.' };
    },
  });

  // /think <level> — Set thinking level
  registerCommand({
    key: 'think',
    description: 'Set agent thinking/reasoning level',
    textAliases: ['/think'],
    acceptsArgs: true,
    args: [
      {
        name: 'level',
        description: 'Thinking level',
        choices: [
          { value: 'off', label: 'Off' },
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
    ],
    scope: 'both',
    category: 'config',
    nativeName: 'think',
    handler: async (ctx: CommandContext): Promise<CommandResult> => {
      const level = ctx.args?.level || ctx.rawArgs || 'medium';
      openclawEventBus.emit('directive:think', { userId: ctx.userId, level });
      return { text: `Thinking level set to: ${level}` };
    },
  });
}
