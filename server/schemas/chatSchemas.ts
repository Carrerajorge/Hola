/**
 * Chat API Zod Schemas
 * Fix #20: Add Zod validation to chat endpoints
 */
import { z } from 'zod';

// Chat message schema
export const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1, 'Message content cannot be empty'),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Chat request body schema
export const chatRequestSchema = z.object({
    messages: z.array(chatMessageSchema).min(1, 'At least one message is required'),
    useRag: z.boolean().optional().default(true),
    conversationId: z.string().optional(),
    images: z.array(z.string()).optional(),
    gptConfig: z.any().optional(), // Legacy GPT config
    gptId: z.string().optional(),
    documentMode: z.boolean().optional(),
    figmaMode: z.boolean().optional(),
    provider: z.string().optional().default('xai'),
    model: z.string().optional().default('grok-3-fast'),
    attachments: z.array(z.any()).optional(),
    lastImageBase64: z.string().optional(),
    lastImageId: z.string().optional(),
    session_id: z.string().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Streaming chat request schema
export const streamChatRequestSchema = chatRequestSchema.extend({
    runId: z.string().optional(),
    chatId: z.string().optional(),
    docTool: z.enum(['word', 'excel', 'ppt']).optional(),
});

export type StreamChatRequest = z.infer<typeof streamChatRequestSchema>;

// Image generation request
export const imageGenerateRequestSchema = z.object({
    prompt: z.string().min(1, 'Prompt is required').max(4000, 'Prompt too long'),
});

export type ImageGenerateRequest = z.infer<typeof imageGenerateRequestSchema>;

// Voice chat request
export const voiceChatRequestSchema = z.object({
    message: z.string().min(1, 'Message is required'),
});

export type VoiceChatRequest = z.infer<typeof voiceChatRequestSchema>;

// PARE analyze request
export const analyzeRequestSchema = z.object({
    message: z.string().optional(),
    attachments: z.array(z.object({
        name: z.string(),
        type: z.string().optional(),
        mimeType: z.string().optional(),
        fileId: z.string().optional(),
        storagePath: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
        size: z.number().optional(),
    })).min(1, 'At least one attachment is required'),
    chatId: z.string().optional(),
    locale: z.string().optional().default('es'),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

// Feedback request
export const feedbackRequestSchema = z.object({
    messageId: z.string().min(1, 'Message ID is required'),
    conversationId: z.string().optional(),
    feedbackType: z.enum(['positive', 'negative']),
    timestamp: z.string().optional(),
    comment: z.string().max(2000).optional(),
});

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ETL request
export const etlRunRequestSchema = z.object({
    countries: z.array(z.string()).min(1, 'At least one country is required'),
    indicators: z.array(z.string()).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});

export type EtlRunRequest = z.infer<typeof etlRunRequestSchema>;

// Export all schemas for endpoint use
export const chatSchemas = {
    chat: chatRequestSchema,
    stream: streamChatRequestSchema,
    imageGenerate: imageGenerateRequestSchema,
    voiceChat: voiceChatRequestSchema,
    analyze: analyzeRequestSchema,
    feedback: feedbackRequestSchema,
    etlRun: etlRunRequestSchema,
};
