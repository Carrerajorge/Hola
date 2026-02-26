/**
 * OpenClaw Command System — Public API
 */

export {
  registerCommand,
  getCommand,
  resolveTextCommand,
  listCommands,
  executeCommand,
  parseCommandArgs,
  clearRegistry,
  getRegistrySize,
  type ChatCommandDefinition,
  type CommandContext,
  type CommandResult,
  type CommandHandler,
  type CommandScope,
  type CommandCategory,
  type CommandArgDefinition,
} from './registry';

export { registerBuiltinCommands } from './builtinCommands';
