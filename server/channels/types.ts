export type ExternalChannel = "telegram" | "whatsapp_cloud" | "messenger" | "wechat";

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
    }
  | {
      channel: "messenger";
      payload: unknown;
      receivedAt?: string;
    }
  | {
      channel: "wechat";
      payload: unknown;
      receivedAt?: string;
    };

