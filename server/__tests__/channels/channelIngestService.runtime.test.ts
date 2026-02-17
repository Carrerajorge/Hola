import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createChatMessageMock,
  findMessageByRequestIdMock,
  createChatRunMock,
  claimPendingRunMock,
  getChatRunByClientRequestIdMock,
  getChatMessagesMock,
  updateChatRunAssistantMessageMock,
  updateChatMessageContentMock,
  updateChatRunLastSeqMock,
  updateChatRunStatusMock,
  getAssistantByUserMessageQuery,
  getOrCreateChannelConversationMock,
  findWhatsAppCloudAccountByPhoneNumberIdMock,
  sendWhatsAppCloudTextMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  createChatMessageMock: vi.fn(),
  findMessageByRequestIdMock: vi.fn(),
  createChatRunMock: vi.fn(),
  claimPendingRunMock: vi.fn(),
  getChatRunByClientRequestIdMock: vi.fn(),
  getChatMessagesMock: vi.fn(),
  updateChatRunAssistantMessageMock: vi.fn(),
  updateChatMessageContentMock: vi.fn(),
  updateChatRunLastSeqMock: vi.fn(),
  updateChatRunStatusMock: vi.fn(),
  getAssistantByUserMessageQuery: vi.fn(),
  getOrCreateChannelConversationMock: vi.fn(),
  findWhatsAppCloudAccountByPhoneNumberIdMock: vi.fn(),
  sendWhatsAppCloudTextMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    createChatMessage: createChatMessageMock,
    findMessageByRequestId: findMessageByRequestIdMock,
    createChatRun: createChatRunMock,
    claimPendingRun: claimPendingRunMock,
    getChatRunByClientRequestId: getChatRunByClientRequestIdMock,
    getChatMessages: getChatMessagesMock,
    updateChatRunAssistantMessage: updateChatRunAssistantMessageMock,
    updateChatMessageContent: updateChatMessageContentMock,
    updateChatRunLastSeq: updateChatRunLastSeqMock,
    updateChatRunStatus: updateChatRunStatusMock,
  },
}));

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: getAssistantByUserMessageQuery,
        })),
      })),
    })),
  },
}));

vi.mock("../../channels/channelStore", () => ({
  getOrCreateChannelConversation: getOrCreateChannelConversationMock,
  getChannelConversation: vi.fn(),
  consumeChannelPairingCode: vi.fn(),
  patchConversationMetadata: vi.fn(),
  findWhatsAppCloudAccountByPhoneNumberId: findWhatsAppCloudAccountByPhoneNumberIdMock,
  findMessengerAccountByPageId: vi.fn(),
  findWeChatAccountByAppId: vi.fn(),
  findTelegramAccountByUserId: vi.fn(),
  touchChannelConversationHeartbeat: vi.fn(),
}));

vi.mock("../../channels/whatsappCloud/whatsappCloudApi", () => ({
  sendWhatsAppCloudText: sendWhatsAppCloudTextMock,
  sendWhatsAppCloudDocument: vi.fn(),
}));

vi.mock("../../channels/telegram/telegramApi", () => ({ telegramSendMessage: vi.fn(), telegramSendDocument: vi.fn() }));
vi.mock("../../channels/messenger/messengerApi", () => ({ messengerSendText: vi.fn(), messengerSendDocument: vi.fn() }));
vi.mock("../../channels/wechat/wechatApi", () => ({ wechatSendText: vi.fn(), wechatSendDocument: vi.fn(), parseWeChatXml: vi.fn() }));

vi.mock("../../lib/logger", () => ({
  Logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

vi.mock("../../channels/whatsappCloud/whatsappPolicy", () => ({
  evaluateWhatsAppPolicy: vi.fn(() => ({ allowed: true, category: "general" })),
}));
vi.mock("../../channels/messenger/messengerPolicy", () => ({ evaluateMessengerPolicy: vi.fn(() => ({ allowed: true })) }));
vi.mock("../../channels/wechat/wechatPolicy", () => ({ evaluateWeChatPolicy: vi.fn(() => ({ allowed: true })) }));

vi.mock("../../agent/unifiedChatHandler", () => ({
  createUnifiedRun: vi.fn(async () => ({})),
  executeUnifiedChat: vi.fn(async (_ctx: any, _payload: any, res: any) => {
    res.chunks.push({ event: "chunk", data: { content: "reply from ilia" } });
  }),
}));

vi.mock("../../integrations/whatsappWebAutoReply", () => ({
  MemorySseResponse: class {
    chunks: any[] = [];
  },
}));

import { processChannelIngestJob } from "../../channels/channelIngestService";

function makeWhatsAppPayload(sender = "51999999999", messageId = "wamid.1", body = "hola") {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "12345" },
          contacts: [{ profile: { name: "Cliente" } }],
          messages: [{ id: messageId, from: sender, type: "text", text: { body } }],
        },
      }],
    }],
  };
}

describe("channel ingest runtime controls (whatsapp cloud)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantByUserMessageQuery.mockResolvedValue([]);
    findMessageByRequestIdMock.mockResolvedValue(undefined);
    createChatRunMock.mockResolvedValue({ id: "run-1" });
    claimPendingRunMock.mockResolvedValue(null);
    getChatRunByClientRequestIdMock.mockResolvedValue(null);
    getChatMessagesMock.mockResolvedValue([]);
    updateChatRunAssistantMessageMock.mockResolvedValue(null);
    updateChatMessageContentMock.mockResolvedValue(null);
    updateChatRunLastSeqMock.mockResolvedValue(null);
    updateChatRunStatusMock.mockResolvedValue(null);
    createChatMessageMock.mockImplementation(async (input: any) => ({ id: `${input.role}-id`, ...input }));
    getOrCreateChannelConversationMock.mockResolvedValue({ chatId: "chat-1", userId: "user-1" });
  });

  it("disabled responder => no auto reply", async () => {
    findWhatsAppCloudAccountByPhoneNumberIdMock.mockResolvedValue({
      userId: "user-1",
      accessToken: "token",
      metadata: { phoneNumberId: "12345", runtime: { responder_enabled: false } },
    });

    await processChannelIngestJob({
      channel: "whatsapp_cloud",
      payload: makeWhatsAppPayload("51999999999", "wamid.disabled"),
      receivedAt: new Date().toISOString(),
    } as any);

    expect(sendWhatsAppCloudTextMock).not.toHaveBeenCalled();
    expect(createChatMessageMock).not.toHaveBeenCalled();
  });

  it("owner_only blocks non-owner sender", async () => {
    findWhatsAppCloudAccountByPhoneNumberIdMock.mockResolvedValue({
      userId: "user-1",
      accessToken: "token",
      metadata: {
        phoneNumberId: "12345",
        runtime: { responder_enabled: true, owner_only: true, owner_external_ids: ["51111111111"] },
      },
    });

    await processChannelIngestJob({
      channel: "whatsapp_cloud",
      payload: makeWhatsAppPayload("52222222222", "wamid.non-owner"),
      receivedAt: new Date().toISOString(),
    } as any);

    expect(sendWhatsAppCloudTextMock).not.toHaveBeenCalled();
  });

  it("enabled + allowed sender sends reply", async () => {
    findWhatsAppCloudAccountByPhoneNumberIdMock.mockResolvedValue({
      userId: "user-1",
      accessToken: "token",
      metadata: {
        phoneNumberId: "12345",
        runtime: { responder_enabled: true, allowlist: ["51999999999"] },
      },
    });

    await processChannelIngestJob({
      channel: "whatsapp_cloud",
      payload: makeWhatsAppPayload("51999999999", "wamid.allowed"),
      receivedAt: new Date().toISOString(),
    } as any);

    expect(findWhatsAppCloudAccountByPhoneNumberIdMock).toHaveBeenCalled();
    expect(getOrCreateChannelConversationMock).toHaveBeenCalled();
    expect(findMessageByRequestIdMock).toHaveBeenCalled();
    expect(createChatMessageMock).toHaveBeenCalled();
    expect(sendWhatsAppCloudTextMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppCloudTextMock.mock.calls[0][0].to).toBe("51999999999");
  });

  it("persists user + assistant messages in same chat thread", async () => {
    findWhatsAppCloudAccountByPhoneNumberIdMock.mockResolvedValue({
      userId: "user-1",
      accessToken: "token",
      metadata: { phoneNumberId: "12345", runtime: { responder_enabled: true } },
    });

    await processChannelIngestJob({
      channel: "whatsapp_cloud",
      payload: makeWhatsAppPayload("51999999999", "wamid.persist"),
      receivedAt: new Date().toISOString(),
    } as any);

    expect(findWhatsAppCloudAccountByPhoneNumberIdMock).toHaveBeenCalled();
    expect(getOrCreateChannelConversationMock).toHaveBeenCalled();
    expect(findMessageByRequestIdMock).toHaveBeenCalled();
    expect(createChatMessageMock).toHaveBeenCalled();
    const userCall = createChatMessageMock.mock.calls.find((c) => c[0].role === "user");
    const assistantCall = createChatMessageMock.mock.calls.find((c) => c[0].role === "assistant");
    expect(userCall?.[0].chatId).toBe("chat-1");
    expect(assistantCall?.[0].chatId).toBe("chat-1");
  });
});
