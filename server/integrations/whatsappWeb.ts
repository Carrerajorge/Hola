// server/integrations/whatsappWeb.ts
// Stub implementation — full WhatsApp Web integration lives in the bridge container.
// This file provides the interface expected by whatsappWebRouter and extendedTools.
import { EventEmitter } from 'events';

class MessageMedia {
  constructor(public mimetype: string, public data: string) { }
}

export interface WhatsAppMediaAttachment {
  mimetype: string;
  data: string;
  filename?: string;
}

type WAStatus = { state: 'disconnected' | 'connecting' | 'connected'; me?: { id?: string; lid?: string } };

export class WhatsAppIntegration extends EventEmitter {
  private statuses = new Map<string, WAStatus>();
  private autoReplyEnabled = new Map<string, boolean>();
  private autoReplyContacts = new Map<string, boolean>();
  private autoReplyPrompts = new Map<string, string>();
  private processedMessages = new Set<string>();

  getStatus(userId: string): WAStatus {
    return this.statuses.get(userId) || { state: 'disconnected' };
  }

  async startWithOptions(userId: string, opts?: { phone?: string }): Promise<void> {
    this.statuses.set(userId, { state: 'connecting' });
    console.log(`[WhatsApp] startWithOptions for ${userId}`, opts);
  }

  async disconnect(userId: string): Promise<void> {
    this.statuses.set(userId, { state: 'disconnected' });
  }

  async sendText(userId: string, to: string, text: string): Promise<void> {
    console.log(`[WhatsApp] sendText from=${userId} to=${to} len=${text.length}`);
  }

  async sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));
    console.log(`[WhatsApp] sendImage to=${chatId} caption=${caption}`);
  }

  isAutoReplyEnabled(userId: string): boolean {
    return this.autoReplyEnabled.get(userId) || false;
  }

  isAutoReplyToContactsEnabled(userId: string): boolean {
    return this.autoReplyContacts.get(userId) || false;
  }

  getAutoReplyPrompt(userId: string): string {
    return this.autoReplyPrompts.get(userId) || '';
  }

  markMessageProcessed(messageId: string): boolean {
    if (this.processedMessages.has(messageId)) return true;
    this.processedMessages.add(messageId);
    return false;
  }

  async shutdownAll(): Promise<void> {
    this.statuses.clear();
    console.log('[WhatsApp] shutdownAll');
  }
}

export const whatsappWebManager = new WhatsAppIntegration();
