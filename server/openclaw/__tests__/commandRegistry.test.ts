import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCommand,
  getCommand,
  resolveTextCommand,
  listCommands,
  executeCommand,
  parseCommandArgs,
  clearRegistry,
  getRegistrySize,
  type ChatCommandDefinition,
} from '../commands/registry';

describe('Command Registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('registers and retrieves a command by key', () => {
    registerCommand({
      key: 'test',
      description: 'A test command',
      textAliases: ['/test'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });

    const cmd = getCommand('test');
    expect(cmd).toBeDefined();
    expect(cmd!.key).toBe('test');
    expect(cmd!.description).toBe('A test command');
  });

  it('resolves text aliases to commands', () => {
    registerCommand({
      key: 'status',
      description: 'Show status',
      textAliases: ['/status', '/st'],
      acceptsArgs: false,
      scope: 'both',
      category: 'core',
    });

    expect(resolveTextCommand('/status')).toBeDefined();
    expect(resolveTextCommand('/st')).toBeDefined();
    expect(resolveTextCommand('/st')!.key).toBe('status');
  });

  it('resolves commands with args (text before space)', () => {
    registerCommand({
      key: 'kill',
      description: 'Cancel a run',
      textAliases: ['/kill'],
      acceptsArgs: true,
      args: [{ name: 'runId', description: 'Run ID' }],
      scope: 'text',
      category: 'agent',
    });

    const cmd = resolveTextCommand('/kill subagent_123');
    expect(cmd).toBeDefined();
    expect(cmd!.key).toBe('kill');
  });

  it('returns undefined for unknown commands', () => {
    expect(resolveTextCommand('/unknown')).toBeUndefined();
  });

  it('lists commands filtered by category', () => {
    registerCommand({
      key: 'a',
      description: 'Core A',
      textAliases: ['/a'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });
    registerCommand({
      key: 'b',
      description: 'Agent B',
      textAliases: ['/b'],
      acceptsArgs: false,
      scope: 'text',
      category: 'agent',
    });

    const core = listCommands({ category: 'core' });
    expect(core.length).toBe(1);
    expect(core[0].key).toBe('a');
  });

  it('lists commands filtered by scope', () => {
    registerCommand({
      key: 'textOnly',
      description: 'Text only',
      textAliases: ['/to'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });
    registerCommand({
      key: 'both',
      description: 'Both',
      textAliases: ['/bo'],
      acceptsArgs: false,
      scope: 'both',
      category: 'core',
    });

    const native = listCommands({ scope: 'native' });
    // 'both' scope commands are included when filtering for 'native'
    expect(native.length).toBe(1);
    expect(native[0].key).toBe('both');
  });

  it('parses command arguments', () => {
    const def: ChatCommandDefinition = {
      key: 'spawn',
      description: 'Spawn',
      textAliases: ['/spawn'],
      acceptsArgs: true,
      args: [{ name: 'objective', description: 'Task' }],
      scope: 'text',
      category: 'agent',
    };

    const { command, args, rawArgs } = parseCommandArgs('/spawn Find papers', def);
    expect(command).toBe('/spawn');
    expect(args.objective).toBe('Find');
    expect(rawArgs).toBe('Find papers');
  });

  it('executes a command with handler', async () => {
    registerCommand({
      key: 'ping',
      description: 'Ping',
      textAliases: ['/ping'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
      handler: async () => ({ text: 'pong' }),
    });

    const result = await executeCommand('/ping', { userId: 'test-user' });
    expect(result).toBeDefined();
    expect(result!.text).toBe('pong');
  });

  it('returns null for commands without handlers', async () => {
    registerCommand({
      key: 'nohandler',
      description: 'No handler',
      textAliases: ['/nohandler'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });

    const result = await executeCommand('/nohandler', { userId: 'test' });
    expect(result).toBeNull();
  });

  it('rejects duplicate command keys', () => {
    registerCommand({
      key: 'dup',
      description: 'First',
      textAliases: ['/dup'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });

    expect(() =>
      registerCommand({
        key: 'dup',
        description: 'Second',
        textAliases: ['/dup2'],
        acceptsArgs: false,
        scope: 'text',
        category: 'core',
      }),
    ).toThrow('Duplicate command key');
  });

  it('rejects duplicate text aliases', () => {
    registerCommand({
      key: 'first',
      description: 'First',
      textAliases: ['/same'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });

    expect(() =>
      registerCommand({
        key: 'second',
        description: 'Second',
        textAliases: ['/same'],
        acceptsArgs: false,
        scope: 'text',
        category: 'core',
      }),
    ).toThrow('Duplicate text alias');
  });

  it('clearRegistry removes all commands', () => {
    registerCommand({
      key: 'temp',
      description: 'Temporary',
      textAliases: ['/temp'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });

    expect(getRegistrySize()).toBe(1);
    clearRegistry();
    expect(getRegistrySize()).toBe(0);
    expect(getCommand('temp')).toBeUndefined();
  });

  it('case-insensitive alias resolution', () => {
    registerCommand({
      key: 'help',
      description: 'Help',
      textAliases: ['/Help'],
      acceptsArgs: false,
      scope: 'text',
      category: 'core',
    });

    expect(resolveTextCommand('/help')).toBeDefined();
    expect(resolveTextCommand('/HELP')).toBeDefined();
  });
});
