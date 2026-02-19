/**
 * Chat API Zod Schemas
 * Fix #20: Add Zod validation to chat endpoints
 */
import { z } from 'zod';

// Chat message schema
// Allow empty content for assistant/system messages in conversation history
// (e.g. error responses, artifact-only messages, or system markers).
export const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(32_000, 'Message too long').default(''),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Attachment schema — validates file metadata without blocking legitimate files
const attachmentSchema = z.object({
    id: z.string().max(200).optional(),
    fileId: z.string().max(200).optional(),
    name: z.string().max(255).optional(),
    type: z.string().max(160).optional(),
    mimeType: z.string().max(180).optional(),
    size: z.number().int().min(0).max(500_000_000).optional(),
    storagePath: z.string().max(512).optional(),
    content: z.string().max(2_000_000).optional(),
    url: z.string().max(2048).optional(),
}).passthrough(); // allow extra fields from legacy clients

// Chat request body schema
// Use .nullish() (accepts null | undefined) for fields that clients may send as null
// since JSON.stringify preserves null but strips undefined.
export const chatRequestSchema = z.object({
    messages: z.array(chatMessageSchema).min(1, 'At least one message is required').max(100, 'Too many messages'),
    useRag: z.boolean().nullish().default(true),
    conversationId: z.string().max(200).nullish(),
    images: z.array(z.string()).max(10).nullish(),
    gptConfig: z.any().nullish(), // Legacy GPT config
    gptId: z.string().max(120).nullish(),
    documentMode: z.boolean().nullish(),
    figmaMode: z.boolean().nullish(),
    provider: z.string().max(40).nullish().default('gemini'),
    model: z.string().max(160).trim().nullish().default('gemini-2.5-flash'),
    attachments: z.array(attachmentSchema).max(20).nullish(),
    lastImageBase64: z.string().max(500_000).nullish(),
    lastImageId: z.string().max(200).nullish(),
    session_id: z.string().max(120).nullish(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Streaming chat request schema
export const streamChatRequestSchema = chatRequestSchema.extend({
    runId: z.string().max(200).nullish(),
    chatId: z.string().max(200).nullish(),
    // Client may send docTool="figma" even when server ignores it; accept to avoid hard-failing validation.
    docTool: z.enum(['word', 'excel', 'ppt', 'figma']).nullish(),

    // Streaming/runtime controls (used by /api/chat/stream)
    latencyMode: z.enum(['fast', 'deep', 'auto']).nullish(),
    queueMode: z.enum(['replace', 'reject']).nullish(),
    forceWebSearch: z.boolean().nullish(),
    webSearchAuto: z.boolean().nullish(),

    // Idempotency/correlation
    clientRequestId: z.string().max(200).nullish(),
    userRequestId: z.string().max(200).nullish(),

    // Skill routing
    skillId: z.string().max(120).nullish(),
    skill: z.any().nullish(),
    skillScopes: z.array(z.string().max(120)).max(30).nullish(),
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
