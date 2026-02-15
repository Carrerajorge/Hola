export type ExternalChannel = "telegram" | "whatsapp_cloud";

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
    };

