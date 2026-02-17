export type ExternalChannel = "telegram" | "whatsapp_cloud" | "messenger" | "wechat";

export type ConversationKey = {
  workspaceId: string;
  channel: ExternalChannel;
  channelAccountId: string;
  threadId: string;
};

export type MessageEnvelope = {
  providerMessageId: string;
  channel: ExternalChannel;
  channelKey: string;
  threadId: string;
  senderId: string;
  recipientId?: string;
  conversationKey: ConversationKey;
  receivedAt: string;
  text: string;
  messageType: "text" | "image" | "audio" | "document" | "unsupported";
  media?: {
    providerAssetId?: string;
    fileName?: string;
    mimeType?: string;
    url?: string;
    raw?: unknown;
  };
  metadata: {
    rawPayload: unknown;
    [key: string]: unknown;
  };
};

export type ChannelIngestJob =
  | {
      channel: "telegram";
      update: unknown;
      receivedAt?: string;
    }
  | {
      channel: "whatsapp_cloud";
      payload: unknown;
      receivedAt?: string;
      whatsappMeta?: {
        accountPhoneNumberId: string;
      };
    }
  | {
      channel: "messenger";
      payload: unknown;
      receivedAt?: string;
      pageId?: string;
    }
  | {
      channel: "wechat";
      payload: unknown;
      receivedAt?: string;
      appId?: string;
    };
