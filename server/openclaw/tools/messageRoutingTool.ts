import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';
import { openclawEventBus } from '../events';

/**
 * OpenClaw Message Routing Tool
 *
 * Adapted from upstream openclaw message-tool.ts.
 * Channel-agnostic message routing: send messages across different
 * communication channels (WebSocket, webhook, email, etc.)
 *
 * The actual delivery is handled by channel adapters that listen
 * on the event bus for 'message:route' events.
 */

export type MessageChannel = 'websocket' | 'webhook' | 'email' | 'internal' | 'broadcast';

export interface RoutedMessage {
  id: string;
  channel: MessageChannel;
  target: string;
  content: string;
  metadata?: Record<string, unknown>;
  sentAt: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
}

// ── Message Log ──────────────────────────────────────────────────────────

const messageLog = new Map<string, RoutedMessage>();
let messageCounter = 0;

function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

// ── Tool Definition ──────────────────────────────────────────────────────

export function createMessageRoutingTool(): ToolDefinition {
  return {
    name: 'openclaw_message_route',
    description:
      'Route a message to a target through a specified channel. ' +
      'Channels: websocket (real-time to connected clients), webhook (HTTP POST), ' +
      'internal (to another agent session), broadcast (to all subscribed clients).',
    inputSchema: z.object({
      channel: z.enum(['websocket', 'webhook', 'email', 'internal', 'broadcast']),
      target: z
        .string()
        .min(1)
        .describe('Target: userId (websocket), URL (webhook), email address, sessionKey (internal), or "all" (broadcast)'),
      content: z.string().min(1).describe('Message content'),
      metadata: z.record(z.unknown()).optional(),
      replyTo: z.string().optional().describe('Message ID this is replying to'),
    }),
    capabilities: ['accesses_external_api'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const { channel, target, content, metadata, replyTo } = input;

      const msg: RoutedMessage = {
        id: generateMessageId(),
        channel,
        target,
        content,
        metadata: {
          ...metadata,
          senderUserId: context.userId,
          senderRunId: context.runId,
          replyTo,
        },
        sentAt: new Date().toISOString(),
        status: 'queued',
      };

      messageLog.set(msg.id, msg);

      try {
        switch (channel) {
          case 'websocket': {
            // Emit to event bus — wsServer adapter will deliver
            openclawEventBus.emit('message:route', {
              channel: 'websocket',
              target,
              content,
              messageId: msg.id,
              metadata: msg.metadata,
            });
            msg.status = 'sent';
            break;
          }

          case 'webhook': {
            // Validate URL
            try {
              new URL(target);
            } catch {
              msg.status = 'failed';
              return fail('INVALID_URL', `Invalid webhook URL: ${target}`);
            }

            // Fire-and-forget HTTP POST
            fetch(target, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messageId: msg.id,
                content,
                metadata: msg.metadata,
                sentAt: msg.sentAt,
              }),
              signal: AbortSignal.timeout(10_000),
            })
              .then(resp => {
                msg.status = resp.ok ? 'delivered' : 'failed';
              })
              .catch(() => {
                msg.status = 'failed';
              });

            msg.status = 'sent';
            break;
          }

          case 'internal': {
            // Route to another agent session via event bus
            openclawEventBus.emit('message:route', {
              channel: 'internal',
              target,
              content,
              messageId: msg.id,
              metadata: msg.metadata,
            });
            msg.status = 'sent';
            break;
          }

          case 'broadcast': {
            openclawEventBus.emit('message:route', {
              channel: 'broadcast',
              target: 'all',
              content,
              messageId: msg.id,
              metadata: msg.metadata,
            });
            msg.status = 'sent';
            break;
          }

          case 'email': {
            // Placeholder — needs email service integration
            openclawEventBus.emit('message:route', {
              channel: 'email',
              target,
              content,
              messageId: msg.id,
              metadata: msg.metadata,
            });
            msg.status = 'queued';
            break;
          }

          default:
            msg.status = 'failed';
            return fail('UNKNOWN_CHANNEL', `Unknown channel: ${channel}`);
        }

        Logger.info(
          `[OpenClaw:MessageRoute] ${channel} → ${target.substring(0, 50)} (${msg.id}): ${msg.status}`,
        );

        return ok({
          messageId: msg.id,
          channel,
          target,
          status: msg.status,
        });
      } catch (error: any) {
        msg.status = 'failed';
        Logger.error(`[OpenClaw:MessageRoute] Error: ${error.message}`);
        return fail('ROUTE_ERROR', error.message || 'Message routing failed', true);
      }
    },
  };
}

// ── Exports for testing ──────────────────────────────────────────────────

export function _getMessageLog(): Map<string, RoutedMessage> {
  return messageLog;
}

export function _clearMessageLog(): void {
  messageLog.clear();
  messageCounter = 0;
}
