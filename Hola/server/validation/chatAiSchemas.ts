/**
 * Zod Validation Schemas for chatAiRouter
 *
 * Centralizes input validation for all chat AI endpoints.
 * Use with the `validate()` middleware from `../lib/requestValidator`.
 */

import { z } from "zod";

// ── Shared sub-schemas ──────────────────────────────────────────

const AttachmentInputSchema = z.object({
    id: z.string().optional(),
    fileId: z.string().optional(),
    name: z.string().max(512).optional(),
    type: z.string().max(128).optional(),
    mimeType: z.string().max(128).optional(),
    size: z.number().nonnegative().optional(),
    storagePath: z.string().max(1024).optional(),
    dataUrl: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
});

const MessageSchema = z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().min(1).max(500000),
});

const LLMProviderEnum = z.enum(["xai", "gemini", "openai", "anthropic", "deepseek", "auto"]).optional();

// ── /chat endpoint ──────────────────────────────────────────────

export const chatBodySchema = z.object({
    messages: z.array(MessageSchema).min(1, "At least one message is required"),
    useRag: z.boolean().optional().default(true),
    conversationId: z.string().max(256).optional(),
    images: z.array(z.string()).optional(),
    gptConfig: z.record(z.unknown()).optional(),
    gptId: z.string().max(128).optional(),
    documentMode: z.boolean().optional(),
    figmaMode: z.boolean().optional(),
    provider: LLMProviderEnum.default("auto"),
    model: z.string().max(128).optional(),
    attachments: z.array(AttachmentInputSchema).max(20).optional(),
    lastImageBase64: z.string().optional(),
    lastImageId: z.string().optional(),
    session_id: z.string().max(256).optional(),
});

// ── /chat/stream endpoint ───────────────────────────────────────

export const chatStreamBodySchema = z.object({
    messages: z.array(MessageSchema).min(1, "At least one message is required"),
    conversationId: z.string().max(256).optional(),
    runId: z.string().max(256).optional(),
    chatId: z.string().max(256).optional(),
    attachments: z.array(AttachmentInputSchema).max(20).optional(),
    gptId: z.string().max(128).optional(),
    model: z.string().max(128).optional(),
    provider: LLMProviderEnum,
    session_id: z.string().max(256).optional(),
    docTool: z.string().max(128).optional(),
    forceWebSearch: z.boolean().optional(),
    webSearchAuto: z.boolean().optional(),
    latencyMode: z.enum(["fast", "deep", "auto"]).optional().default("auto"),
    lastImageBase64: z.string().optional(),
    lastImageId: z.string().optional(),
});

// ── /voice-chat endpoint ────────────────────────────────────────

export const voiceChatBodySchema = z.object({
    message: z.string().min(1, "Message is required").max(10000),
});

// ── /image/generate endpoint ────────────────────────────────────

export const imageGenerateBodySchema = z.object({
    prompt: z.string().min(1, "Prompt is required").max(10000),
});

// ── /image/detect endpoint ──────────────────────────────────────

export const imageDetectBodySchema = z.object({
    message: z.string().min(1, "Message is required").max(50000),
});

// ── /etl/run endpoint ───────────────────────────────────────────

export const etlRunBodySchema = z.object({
    countries: z.array(z.string()).min(1, "At least one country is required").max(50),
    indicators: z.array(z.string()).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});
