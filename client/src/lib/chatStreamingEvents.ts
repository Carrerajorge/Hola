const CHAT_COMPLETED_EVENT = 'sira:chat-streaming-completed';
const CHAT_STARTED_EVENT = 'sira:chat-streaming-started';

export interface ChatStreamingEvent {
  chatId: string;
  success: boolean;
  timestamp: number;
}

export function emitChatStreamingStarted(chatId: string): void {
  const event = new CustomEvent<ChatStreamingEvent>(CHAT_STARTED_EVENT, {
    detail: { chatId, success: true, timestamp: Date.now() }
  });
  window.dispatchEvent(event);
}

export function emitChatStreamingCompleted(chatId: string, success: boolean = true): void {
  const event = new CustomEvent<ChatStreamingEvent>(CHAT_COMPLETED_EVENT, {
    detail: { chatId, success, timestamp: Date.now() }
  });
  window.dispatchEvent(event);
}

export function subscribeToChatStreamingStarted(
  callback: (event: ChatStreamingEvent) => void
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<ChatStreamingEvent>).detail);
  };
  window.addEventListener(CHAT_STARTED_EVENT, handler);
  return () => window.removeEventListener(CHAT_STARTED_EVENT, handler);
}

export function subscribeToChatStreamingCompleted(
  callback: (event: ChatStreamingEvent) => void
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<ChatStreamingEvent>).detail);
  };
  window.addEventListener(CHAT_COMPLETED_EVENT, handler);
  return () => window.removeEventListener(CHAT_COMPLETED_EVENT, handler);
}
