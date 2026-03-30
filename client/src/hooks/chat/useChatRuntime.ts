import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { Message, AIState } from "@/hooks/use-chats";
import { useToast } from "@/hooks/use-toast";
import { chatLogger } from "@/lib/logger";
import { computePromptIntegrity } from "@/lib/promptIntegrity";

export interface UseChatRuntimeProps {
  chatId: string;
  user: { id: string; plan?: string; subscriptionStatus?: string } | null;
  onSendMessage?: (message: string) => Promise<void>;
}

export interface UseChatRuntimeReturn {
  // State
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  input: string;
  setInput: (value: string) => void;
  aiState: AIState;
  setAiState: React.Dispatch<React.SetStateAction<AIState>>;
  streamingContent: string;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  
  // Refs
  messagesEndRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  
  // Actions
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  
  // Metadata
  isSubmitting: boolean;
  error: Error | null;
  clearError: () => void;
}

export function useChatRuntime({
  chatId,
  user,
  onSendMessage,
}: UseChatRuntimeProps): UseChatRuntimeReturn {
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Core state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInputRaw] = useState("");
  const [aiState, setAiState] = useState<AIState>("idle");
  const [streamingContent, setStreamingContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Wrapper for input with logging
  const setInput = useCallback((value: string | ((prev: string) => string)) => {
    setInputRaw((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      chatLogger.debug("Input changed", { length: newValue.length });
      return newValue;
    });
  }, []);
  
  // Scroll utilities
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);
  
  // Submit handling
  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    const trimmedInput = input.trim();
    if (!trimmedInput || isSubmitting) return;
    
    setIsSubmitting(true);
    setError(null);
    setAiState("sending");
    
    try {
      // Compute prompt integrity
      const integrityMeta = await computePromptIntegrity(trimmedInput);
      chatLogger.info("Submitting message", { 
        chatId, 
        contentLength: trimmedInput.length,
        integrityHash: integrityMeta?.integrityHash?.slice(0, 8) 
      });
      
      // Clear input optimistically
      setInputRaw("");
      
      // Call parent handler
      await onSendMessage?.(trimmedInput);
      
      setAiState("streaming");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setAiState("error");
      chatLogger.error("Failed to send message", error);
      toast({
        title: "Error al enviar mensaje",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [input, isSubmitting, chatId, onSendMessage, toast]);
  
  // Keyboard handling
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);
  
  const clearError = useCallback(() => setError(null), []);
  
  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom("auto");
    }
  }, [messages.length, scrollToBottom]);
  
  return {
    messages,
    setMessages,
    input,
    setInput,
    aiState,
    setAiState,
    streamingContent,
    setStreamingContent,
    messagesEndRef,
    textareaRef,
    handleSubmit,
    handleKeyDown,
    scrollToBottom,
    isSubmitting,
    error,
    clearError,
  };
}
