import React, { memo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useChatRuntime } from "@/hooks/chat/useChatRuntime";
import { useAttachmentPipeline } from "@/hooks/chat/useAttachmentPipeline";
import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";
import type { Message, AIState } from "@/hooks/use-chats";

interface ChatRuntimeProps {
  chatId: string;
  user: { id: string; plan?: string; subscriptionStatus?: string } | null;
  initialMessages?: Message[];
  onSendMessage?: (message: string, attachments?: string[]) => Promise<void>;
  onRetryMessage?: (messageId: string) => void;
  aiState?: AIState;
  streamingContent?: string;
  streamingMessageId?: string | null;
  className?: string;
  placeholder?: string;
  emptyState?: React.ReactNode;
}

export const ChatRuntime = memo(function ChatRuntime({
  chatId,
  user,
  initialMessages = [],
  onSendMessage,
  onRetryMessage,
  aiState: externalAiState,
  streamingContent: externalStreamingContent,
  streamingMessageId,
  className,
  placeholder,
  emptyState,
}: ChatRuntimeProps) {
  // Core chat runtime
  const {
    messages,
    setMessages,
    input,
    setInput,
    aiState: runtimeAiState,
    setAiState,
    streamingContent: runtimeStreamingContent,
    setStreamingContent,
    handleSubmit: handleRuntimeSubmit,
    isSubmitting,
    error,
  } = useChatRuntime({ chatId, user, onSendMessage });
  
  // Attachment pipeline
  const {
    files,
    isUploading,
    addFiles,
    removeFile,
    clearFiles,
    uploadFiles,
  } = useAttachmentPipeline({ chatId, user });
  
  // Use external or internal state
  const effectiveAiState = externalAiState ?? runtimeAiState;
  const effectiveStreamingContent = externalStreamingContent ?? runtimeStreamingContent;
  
  // Sync initial messages
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);
  
  // Handle submit with attachments
  const handleSubmit = useCallback(async () => {
    if (!input.trim() && files.length === 0) return;
    
    // Upload files first if any
    let attachmentUrls: string[] = [];
    if (files.length > 0) {
      const uploaded = await uploadFiles();
      attachmentUrls = uploaded
        .filter((f) => f.status === "completed" && f.url)
        .map((f) => f.url!);
      
      if (uploaded.some((f) => f.status === "error")) {
        // Some files failed, but continue with the ones that succeeded
        console.warn("Some files failed to upload");
      }
    }
    
    // Send message with attachments
    await handleRuntimeSubmit();
    
    // Clear attachments after successful send
    clearFiles();
  }, [input, files, uploadFiles, handleRuntimeSubmit, clearFiles]);
  
  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);
  
  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Message list */}
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          aiState={effectiveAiState}
          streamingContent={effectiveStreamingContent}
          streamingMessageId={streamingMessageId}
          onRetryMessage={onRetryMessage}
          onCopyMessage={handleCopyMessage}
          emptyState={emptyState}
        />
      </div>
      
      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          Error: {error.message}
        </div>
      )}
      
      {/* Input area */}
      <div className="p-4 border-t">
        <MessageInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          disabled={isSubmitting || effectiveAiState === "streaming"}
          isLoading={isSubmitting || isUploading}
          files={files}
          onFileSelect={addFiles}
          onRemoveFile={removeFile}
          isUploading={isUploading}
        />
      </div>
    </div>
  );
});
