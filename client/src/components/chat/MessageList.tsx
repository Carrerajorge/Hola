import React, { memo, useCallback, useRef, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Loader2, Bot, User } from "lucide-react";
import type { Message, AIState } from "@/hooks/use-chats";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useComponentPerformance } from "@/hooks/usePerformance";
import { useChatIsStreaming } from "@/stores/streamingStore";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  streamingContent?: string;
  onRetry?: () => void;
  onCopy?: () => void;
  className?: string;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  streamingContent,
  onRetry,
  onCopy,
  className,
}: ChatMessageProps) {
  useComponentPerformance({ componentName: "ChatMessage", logOnUnmount: false });
  
  const isUser = message.role === "user";
  
  // Memoize content to prevent re-renders of MarkdownRenderer
  const content = useMemo(() => {
    if (isStreaming && streamingContent) {
      return streamingContent;
    }
    return message.content;
  }, [isStreaming, streamingContent, message.content]);
  
  return (
    <div
      className={cn(
        "flex gap-4 p-4",
        isUser ? "bg-muted/30" : "bg-background",
        className
      )}
    >
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">
            {isUser ? "Tú" : "ILIA"}
          </span>
          <span className="text-xs text-muted-foreground">
            {message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : ""}
          </span>
        </div>
        
        <div className="prose prose-sm max-w-none">
          <MarkdownRenderer content={content} />
        </div>
        
        {/* Actions */}
        {!isUser && !isStreaming && (
          <div className="flex gap-2 mt-2">
            {onCopy && (
              <button
                onClick={onCopy}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Copiar
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
        
        {isStreaming && (
          <div className="flex items-center gap-2 mt-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">Escribiendo...</span>
          </div>
        )}
      </div>
    </div>
  );
});

interface MessageListProps {
  messages: Message[];
  aiState: AIState;
  streamingContent?: string;
  streamingMessageId?: string | null;
  onRetryMessage?: (messageId: string) => void;
  onCopyMessage?: (content: string) => void;
  className?: string;
  emptyState?: React.ReactNode;
}

export const MessageList = memo(function MessageList({
  messages,
  aiState,
  streamingContent,
  streamingMessageId,
  onRetryMessage,
  onCopyMessage,
  className,
  emptyState,
}: MessageListProps) {
  useComponentPerformance({ componentName: "MessageList", logThreshold: 50 });
  
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Use optimized selector for streaming state
  const isAnyStreamActive = useChatIsStreaming(streamingMessageId || undefined);
  
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 100, []),
    overscan: 5,
    getItemKey: useCallback((index: number) => messages[index]?.id || index, [messages]),
  });
  
  // Auto-scroll to bottom when new messages arrive or streaming
  useEffect(() => {
    if (messages.length > 0 && isAnyStreamActive) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "auto" });
    }
  }, [messages.length, isAnyStreamActive, virtualizer]);
  
  // Memoize message map for O(1) lookup
  const messageMap = useMemo(() => {
    const map = new Map<string, Message>();
    messages.forEach((msg) => map.set(msg.id, msg));
    return map;
  }, [messages]);
  
  const handleRetry = useCallback((messageId: string) => {
    onRetryMessage?.(messageId);
  }, [onRetryMessage]);
  
  const handleCopy = useCallback((content: string) => {
    onCopyMessage?.(content);
  }, [onCopyMessage]);
  
  if (messages.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        {emptyState || (
          <div className="text-center text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">¿En qué puedo ayudarte?</p>
            <p className="text-sm mt-2">Envía un mensaje para comenzar</p>
          </div>
        )}
      </div>
    );
  }
  
  const virtualItems = virtualizer.getVirtualItems();
  
  return (
    <div
      ref={parentRef}
      className={cn("h-full overflow-auto", className)}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const message = messageMap.get(messages[virtualItem.index]?.id);
          if (!message) return null;
          
          const isStreamingMessage = streamingMessageId === message.id;
          
          return (
            <div
              key={message.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <ChatMessage
                message={message}
                isStreaming={isStreamingMessage}
                streamingContent={isStreamingMessage ? streamingContent : undefined}
                onRetry={() => handleRetry(message.id)}
                onCopy={() => handleCopy(message.content)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
