/**
 * Chat Actions Hook
 * Handles all message sending, editing, and API interactions
 */

import { useCallback, useRef } from 'react';
import { Message, Attachment } from './types';
import { useToast } from '@/hooks/use-toast';

interface UseChatActionsProps {
    chatId: string | null;
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setAiState: React.Dispatch<React.SetStateAction<'idle' | 'thinking' | 'responding' | 'error'>>;
    setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
    setUiPhase: React.Dispatch<React.SetStateAction<'idle' | 'thinking' | 'console' | 'done'>>;
    selectedDocTool: string | null;
    projectId?: string;
    gptConfig?: { systemPrompt?: string; model?: string };
}

export interface UseChatActionsReturn {
    sendMessage: (content: string, attachments?: File[]) => Promise<void>;
    editMessage: (messageId: string, newContent: string) => Promise<void>;
    deleteMessage: (messageId: string) => Promise<void>;
    regenerateMessage: (messageId: string) => Promise<void>;
    cancelRequest: () => void;
    isProcessing: boolean;
}

export function useChatActions({
    chatId,
    messages,
    setMessages,
    setAiState,
    setStreamingContent,
    setUiPhase,
    selectedDocTool,
    projectId,
    gptConfig,
}: UseChatActionsProps): UseChatActionsReturn {
    const { toast } = useToast();
    const abortControllerRef = useRef<AbortController | null>(null);
    const isProcessingRef = useRef(false);

    const sendMessage = useCallback(async (content: string, attachments?: File[]) => {
        if (!content.trim() && (!attachments || attachments.length === 0)) return;
        if (isProcessingRef.current) return;

        isProcessingRef.current = true;
        abortControllerRef.current = new AbortController();

        // Create user message
        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: content.trim(),
            timestamp: new Date(),
            attachments: attachments ? await processAttachments(attachments) : undefined,
        };

        setMessages(prev => [...prev, userMessage]);
        setAiState('thinking');
        setUiPhase('thinking');
        setStreamingContent('');

        try {
            const response = await fetch('/api/chat/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId,
                    message: content,
                    messages: [...messages, userMessage].map(m => ({
                        role: m.role,
                        content: m.content,
                    })),
                    attachments: userMessage.attachments,
                    projectId,
                    docTool: selectedDocTool,
                    ...gptConfig,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let fullContent = '';

            setAiState('responding');
            setUiPhase('console');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.content) {
                                fullContent += data.content;
                                setStreamingContent(fullContent);
                            }
                        } catch {
                            // Non-JSON data line
                        }
                    }
                }
            }

            // Add assistant message
            const assistantMessage: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: fullContent,
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, assistantMessage]);
            setAiState('idle');
            setUiPhase('done');
            setStreamingContent('');

        } catch (error: any) {
            if (error.name === 'AbortError') {
                toast({ title: 'Cancelled', description: 'Request was cancelled' });
            } else {
                toast({ title: 'Error', description: error.message, variant: 'destructive' });
                setAiState('error');
            }
        } finally {
            isProcessingRef.current = false;
            abortControllerRef.current = null;
            setUiPhase('idle');
        }
    }, [chatId, messages, setMessages, setAiState, setStreamingContent, setUiPhase, selectedDocTool, projectId, gptConfig, toast]);

    const editMessage = useCallback(async (messageId: string, newContent: string) => {
        setMessages(prev =>
            prev.map(m => m.id === messageId ? { ...m, content: newContent } : m)
        );
        // TODO: Optionally regenerate AI response after edit
    }, [setMessages]);

    const deleteMessage = useCallback(async (messageId: string) => {
        setMessages(prev => prev.filter(m => m.id !== messageId));
    }, [setMessages]);

    const regenerateMessage = useCallback(async (messageId: string) => {
        const messageIndex = messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return;

        // Get the user message before this assistant message
        const previousUserMessage = messages.slice(0, messageIndex).reverse().find(m => m.role === 'user');
        if (!previousUserMessage) return;

        // Remove messages from this point onwards
        setMessages(prev => prev.slice(0, messageIndex));

        // Resend the user message
        await sendMessage(previousUserMessage.content, undefined);
    }, [messages, setMessages, sendMessage]);

    const cancelRequest = useCallback(() => {
        abortControllerRef.current?.abort();
        isProcessingRef.current = false;
        setAiState('idle');
        setUiPhase('idle');
    }, [setAiState, setUiPhase]);

    return {
        sendMessage,
        editMessage,
        deleteMessage,
        regenerateMessage,
        cancelRequest,
        isProcessing: isProcessingRef.current,
    };
}

// Helper function to process file attachments
async function processAttachments(files: File[]): Promise<Attachment[]> {
    return Promise.all(
        files.map(async (file) => {
            const content = await readFileAsDataURL(file);
            return {
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                size: file.size,
                content,
                thumbnail: file.type.startsWith('image/') ? content : undefined,
            };
        })
    );
}

function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
