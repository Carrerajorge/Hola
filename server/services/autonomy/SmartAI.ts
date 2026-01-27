/**
 * Smart AI Service
 *
 * Intelligent model routing, prompt optimization, and learning.
 * Implements improvements 86-95: AI and Learning
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

type TaskType = "general" | "code" | "creative" | "analysis" | "translation" | "summarization" | "math" | "conversation";

interface ModelProfile {
    id: string;
    provider: string;
    strengths: TaskType[];
    maxTokens: number;
    costPer1kTokens: number;
    avgResponseTime: number;
    qualityScore: number;
    successRate: number;
}

interface ClassificationResult {
    taskType: TaskType;
    confidence: number;
    language: string;
    sentiment: "positive" | "negative" | "neutral";
    complexity: "simple" | "moderate" | "complex";
    estimatedTokens: number;
}

interface ResponseQuality {
    requestId: string;
    model: string;
    score: number; // 0-100
    factors: {
        relevance: number;
        completeness: number;
        accuracy: number;
        coherence: number;
    };
    userFeedback?: "positive" | "negative";
}

interface ConversationSummary {
    topics: string[];
    keyPoints: string[];
    sentiment: string;
    messageCount: number;
    duration: number;
}

// ============================================================================
// SMART AI SERVICE
// ============================================================================

export class SmartAIService extends EventEmitter {
    private modelProfiles: Map<string, ModelProfile> = new Map();
    private taskHistory: Map<string, Array<{ model: string; success: boolean; time: number }>> = new Map();
    private qualityScores: ResponseQuality[] = [];
    private promptCache: Map<string, string> = new Map();
    private learningData: Map<string, any> = new Map();

    // Language detection patterns
    private languagePatterns: Map<string, RegExp> = new Map([
        ["spanish", /\b(hola|gracias|por favor|qué|cómo|está|hacer|necesito|quiero|puedes|ayuda)\b/i],
        ["english", /\b(hello|thanks|please|what|how|need|want|can you|help|the|is|are)\b/i],
        ["french", /\b(bonjour|merci|s'il vous plaît|comment|pourquoi|je|vous|nous)\b/i],
        ["german", /\b(hallo|danke|bitte|wie|warum|ich|sie|wir|können)\b/i],
        ["portuguese", /\b(olá|obrigado|por favor|como|porque|eu|você|nós)\b/i]
    ]);

    constructor() {
        super();
        this.initializeModelProfiles();
        console.log("[SmartAI] Service initialized");
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private initializeModelProfiles(): void {
        // GPT-4o
        this.modelProfiles.set("gpt-4o", {
            id: "gpt-4o",
            provider: "openai",
            strengths: ["general", "code", "analysis", "creative"],
            maxTokens: 128000,
            costPer1kTokens: 0.01,
            avgResponseTime: 2000,
            qualityScore: 95,
            successRate: 0.98
        });

        // GPT-4o-mini
        this.modelProfiles.set("gpt-4o-mini", {
            id: "gpt-4o-mini",
            provider: "openai",
            strengths: ["general", "conversation", "translation"],
            maxTokens: 128000,
            costPer1kTokens: 0.0015,
            avgResponseTime: 800,
            qualityScore: 85,
            successRate: 0.99
        });

        // Claude 3.5 Sonnet
        this.modelProfiles.set("claude-3-5-sonnet", {
            id: "claude-3-5-sonnet-20241022",
            provider: "anthropic",
            strengths: ["code", "analysis", "creative", "general"],
            maxTokens: 200000,
            costPer1kTokens: 0.015,
            avgResponseTime: 2500,
            qualityScore: 96,
            successRate: 0.97
        });

        // Claude 3 Haiku
        this.modelProfiles.set("claude-3-haiku", {
            id: "claude-3-haiku-20240307",
            provider: "anthropic",
            strengths: ["conversation", "translation", "summarization"],
            maxTokens: 200000,
            costPer1kTokens: 0.00025,
            avgResponseTime: 500,
            qualityScore: 80,
            successRate: 0.99
        });

        // Gemini 1.5 Pro
        this.modelProfiles.set("gemini-1.5-pro", {
            id: "gemini-1.5-pro",
            provider: "gemini",
            strengths: ["analysis", "general", "code", "math"],
            maxTokens: 1000000,
            costPer1kTokens: 0.007,
            avgResponseTime: 2000,
            qualityScore: 90,
            successRate: 0.96
        });

        // Gemini 2.0 Flash
        this.modelProfiles.set("gemini-2.0-flash", {
            id: "gemini-2.0-flash-exp",
            provider: "gemini",
            strengths: ["conversation", "general", "translation"],
            maxTokens: 1000000,
            costPer1kTokens: 0.001,
            avgResponseTime: 400,
            qualityScore: 85,
            successRate: 0.98
        });

        // DeepSeek
        this.modelProfiles.set("deepseek-chat", {
            id: "deepseek-chat",
            provider: "deepseek",
            strengths: ["code", "math", "analysis"],
            maxTokens: 64000,
            costPer1kTokens: 0.0001,
            avgResponseTime: 1500,
            qualityScore: 88,
            successRate: 0.95
        });

        // Grok
        this.modelProfiles.set("grok-beta", {
            id: "grok-beta",
            provider: "xai",
            strengths: ["general", "creative", "conversation"],
            maxTokens: 128000,
            costPer1kTokens: 0.005,
            avgResponseTime: 1800,
            qualityScore: 85,
            successRate: 0.94
        });
    }

    // ========================================================================
    // INTENT CLASSIFICATION (Improvement #91)
    // ========================================================================

    classifyIntent(message: string): ClassificationResult {
        const lowerMessage = message.toLowerCase();

        // Detect task type
        let taskType: TaskType = "general";
        let confidence = 0.5;

        // Code patterns
        if (/\b(code|programming|function|bug|error|debug|script|api|database|sql|javascript|python|typescript|react|node)\b/i.test(message) ||
            /```|\bfunction\b|\bclass\b|\bimport\b|\bconst\b|\blet\b|\bvar\b/.test(message)) {
            taskType = "code";
            confidence = 0.9;
        }
        // Creative patterns
        else if (/\b(write|story|poem|creative|imagine|describe|fiction|narrative|character)\b/i.test(message)) {
            taskType = "creative";
            confidence = 0.85;
        }
        // Analysis patterns
        else if (/\b(analyze|analysis|compare|evaluate|assess|review|examine|investigate|research)\b/i.test(message)) {
            taskType = "analysis";
            confidence = 0.85;
        }
        // Translation patterns
        else if (/\b(translate|translation|traduce|traducir|traduction)\b/i.test(message)) {
            taskType = "translation";
            confidence = 0.95;
        }
        // Summarization patterns
        else if (/\b(summarize|summary|resume|resumen|tldr|brief|shorten)\b/i.test(message)) {
            taskType = "summarization";
            confidence = 0.9;
        }
        // Math patterns
        else if (/\b(calculate|math|equation|formula|solve|compute|arithmetic|algebra|calculus)\b/i.test(message) ||
                 /[\d+\-*/^=<>]+/.test(message)) {
            taskType = "math";
            confidence = 0.85;
        }
        // Conversation (default for short messages)
        else if (message.length < 100) {
            taskType = "conversation";
            confidence = 0.7;
        }

        // Detect language
        const language = this.detectLanguage(message);

        // Detect sentiment
        const sentiment = this.analyzeSentiment(message);

        // Estimate complexity
        const complexity = this.estimateComplexity(message);

        // Estimate tokens (rough approximation: ~4 chars per token)
        const estimatedTokens = Math.ceil(message.length / 4);

        return {
            taskType,
            confidence,
            language,
            sentiment,
            complexity,
            estimatedTokens
        };
    }

    // ========================================================================
    // LANGUAGE DETECTION (Improvement #92)
    // ========================================================================

    detectLanguage(text: string): string {
        const scores: Map<string, number> = new Map();

        for (const [lang, pattern] of this.languagePatterns) {
            const matches = text.match(pattern);
            scores.set(lang, matches ? matches.length : 0);
        }

        // Find highest scoring language
        let maxLang = "english";
        let maxScore = 0;

        for (const [lang, score] of scores) {
            if (score > maxScore) {
                maxScore = score;
                maxLang = lang;
            }
        }

        // Default to Spanish if equal or detecting Spanish context
        if (scores.get("spanish") === scores.get("english") && scores.get("spanish")! > 0) {
            maxLang = "spanish";
        }

        return maxLang;
    }

    // ========================================================================
    // SENTIMENT ANALYSIS (Improvement #93)
    // ========================================================================

    analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
        const lowerText = text.toLowerCase();

        const positiveWords = [
            "gracias", "thanks", "great", "awesome", "love", "excellent", "amazing",
            "perfect", "good", "wonderful", "fantastic", "happy", "genial", "excelente",
            "bueno", "perfecto", "increíble", "maravilloso", "feliz", "bien", "encanta"
        ];

        const negativeWords = [
            "bad", "terrible", "awful", "hate", "horrible", "wrong", "error", "fail",
            "problem", "issue", "bug", "broken", "malo", "terrible", "horrible", "odio",
            "error", "problema", "falla", "roto", "no funciona", "doesn't work"
        ];

        let positiveScore = 0;
        let negativeScore = 0;

        for (const word of positiveWords) {
            if (lowerText.includes(word)) positiveScore++;
        }

        for (const word of negativeWords) {
            if (lowerText.includes(word)) negativeScore++;
        }

        if (positiveScore > negativeScore + 1) return "positive";
        if (negativeScore > positiveScore + 1) return "negative";
        return "neutral";
    }

    // ========================================================================
    // SMART MODEL ROUTING (Improvement #86)
    // ========================================================================

    selectBestModel(classification: ClassificationResult, options?: {
        preferSpeed?: boolean;
        preferQuality?: boolean;
        preferCost?: boolean;
        maxCost?: number;
        availableProviders?: string[];
    }): ModelProfile | null {
        let candidates = Array.from(this.modelProfiles.values());

        // Filter by available providers
        if (options?.availableProviders) {
            candidates = candidates.filter(m => options.availableProviders!.includes(m.provider));
        }

        // Filter by cost
        if (options?.maxCost) {
            candidates = candidates.filter(m => m.costPer1kTokens <= options.maxCost!);
        }

        // Score each model
        const scored = candidates.map(model => {
            let score = 0;

            // Strength match (0-40 points)
            if (model.strengths.includes(classification.taskType)) {
                score += 40;
            } else if (model.strengths.includes("general")) {
                score += 20;
            }

            // Quality score (0-30 points)
            score += (model.qualityScore / 100) * 30;

            // Success rate (0-20 points)
            score += model.successRate * 20;

            // Speed preference
            if (options?.preferSpeed) {
                score += Math.max(0, 10 - (model.avgResponseTime / 500));
            }

            // Quality preference
            if (options?.preferQuality) {
                score += (model.qualityScore / 100) * 20;
            }

            // Cost preference
            if (options?.preferCost) {
                score += Math.max(0, 10 - (model.costPer1kTokens * 100));
            }

            // Historical performance for this task type
            const history = this.taskHistory.get(classification.taskType);
            if (history) {
                const modelHistory = history.filter(h => h.model === model.id);
                if (modelHistory.length > 0) {
                    const successRate = modelHistory.filter(h => h.success).length / modelHistory.length;
                    score += successRate * 10;
                }
            }

            return { model, score };
        });

        // Sort by score
        scored.sort((a, b) => b.score - a.score);

        return scored.length > 0 ? scored[0].model : null;
    }

    recordModelPerformance(taskType: TaskType, model: string, success: boolean, responseTime: number): void {
        if (!this.taskHistory.has(taskType)) {
            this.taskHistory.set(taskType, []);
        }

        const history = this.taskHistory.get(taskType)!;
        history.push({ model, success, time: responseTime });

        // Keep last 100 entries per task type
        if (history.length > 100) {
            history.shift();
        }

        // Update model profile
        const profile = Array.from(this.modelProfiles.values()).find(p => p.id === model);
        if (profile) {
            profile.avgResponseTime = (profile.avgResponseTime * 0.9) + (responseTime * 0.1);
            profile.successRate = (profile.successRate * 0.95) + (success ? 0.05 : 0);
        }
    }

    // ========================================================================
    // PROMPT OPTIMIZATION (Improvement #87)
    // ========================================================================

    optimizePrompt(prompt: string, taskType: TaskType, language: string): string {
        let optimized = prompt;

        // Add language instruction if not English
        if (language !== "english" && !prompt.toLowerCase().includes("responde en")) {
            if (language === "spanish") {
                optimized = `[Responde en español]\n\n${optimized}`;
            }
        }

        // Add task-specific prefixes
        switch (taskType) {
            case "code":
                if (!prompt.includes("```") && !prompt.toLowerCase().includes("código")) {
                    optimized = `Como experto programador, ${optimized}\n\nProporciona código bien documentado y explica tu solución.`;
                }
                break;

            case "analysis":
                optimized = `Realiza un análisis detallado y estructurado:\n\n${optimized}\n\nIncluye pros, contras y conclusiones.`;
                break;

            case "creative":
                optimized = `Sé creativo y original:\n\n${optimized}`;
                break;

            case "summarization":
                optimized = `Resume de forma concisa y clara:\n\n${optimized}\n\nDestaca los puntos más importantes.`;
                break;

            case "math":
                optimized = `${optimized}\n\nMuestra el proceso paso a paso.`;
                break;
        }

        return optimized;
    }

    // ========================================================================
    // RESPONSE QUALITY SCORING (Improvement #88)
    // ========================================================================

    scoreResponse(
        requestId: string,
        model: string,
        prompt: string,
        response: string
    ): ResponseQuality {
        // Relevance: Does the response address the prompt?
        const promptKeywords = this.extractKeywords(prompt);
        const responseKeywords = this.extractKeywords(response);
        const keywordOverlap = promptKeywords.filter(k => responseKeywords.includes(k)).length;
        const relevance = Math.min(100, (keywordOverlap / Math.max(promptKeywords.length, 1)) * 100 + 50);

        // Completeness: Is the response sufficiently detailed?
        const completeness = Math.min(100, (response.length / Math.max(prompt.length, 100)) * 50 + 30);

        // Coherence: Basic coherence check
        const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / Math.max(sentences.length, 1);
        const coherence = avgSentenceLength > 10 && avgSentenceLength < 200 ? 80 : 60;

        // Accuracy: Hard to measure without ground truth, estimate based on confidence markers
        const uncertaintyMarkers = (response.match(/\b(maybe|perhaps|might|could be|possibly|I think|creo que|quizás|tal vez)\b/gi) || []).length;
        const accuracy = Math.max(50, 90 - uncertaintyMarkers * 5);

        const score = (relevance + completeness + coherence + accuracy) / 4;

        const quality: ResponseQuality = {
            requestId,
            model,
            score,
            factors: {
                relevance,
                completeness,
                accuracy,
                coherence
            }
        };

        this.qualityScores.push(quality);

        // Keep last 1000 scores
        if (this.qualityScores.length > 1000) {
            this.qualityScores.shift();
        }

        return quality;
    }

    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            "el", "la", "los", "las", "un", "una", "de", "en", "que", "y", "a", "por", "para",
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has",
            "had", "do", "does", "did", "will", "would", "could", "should", "may", "might",
            "must", "shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for",
            "on", "with", "at", "by", "from", "as", "into", "through", "during", "before",
            "after", "above", "below", "between", "under", "again", "further", "then", "once"
        ]);

        return text
            .toLowerCase()
            .replace(/[^a-záéíóúñü\s]/g, " ")
            .split(/\s+/)
            .filter(word => word.length > 3 && !stopWords.has(word));
    }

    recordUserFeedback(requestId: string, feedback: "positive" | "negative"): void {
        const quality = this.qualityScores.find(q => q.requestId === requestId);
        if (quality) {
            quality.userFeedback = feedback;

            // Adjust model profile based on feedback
            const profile = Array.from(this.modelProfiles.values()).find(p => p.id === quality.model);
            if (profile) {
                if (feedback === "positive") {
                    profile.qualityScore = Math.min(100, profile.qualityScore + 0.5);
                } else {
                    profile.qualityScore = Math.max(50, profile.qualityScore - 1);
                }
            }
        }
    }

    // ========================================================================
    // TOPIC EXTRACTION (Improvement #94)
    // ========================================================================

    extractTopics(messages: Array<{ role: string; content: string }>): string[] {
        const allText = messages.map(m => m.content).join(" ");
        const keywords = this.extractKeywords(allText);

        // Count frequency
        const frequency: Map<string, number> = new Map();
        for (const keyword of keywords) {
            frequency.set(keyword, (frequency.get(keyword) || 0) + 1);
        }

        // Sort by frequency and take top 5
        return Array.from(frequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word]) => word);
    }

    // ========================================================================
    // CONVERSATION SUMMARIZATION (Improvement #95)
    // ========================================================================

    summarizeConversation(messages: Array<{ role: string; content: string; timestamp?: Date }>): ConversationSummary {
        const topics = this.extractTopics(messages);

        // Extract key points from assistant messages
        const assistantMessages = messages.filter(m => m.role === "assistant");
        const keyPoints: string[] = [];

        for (const msg of assistantMessages.slice(-5)) { // Last 5 assistant messages
            const sentences = msg.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
            if (sentences.length > 0) {
                keyPoints.push(sentences[0].trim().slice(0, 100));
            }
        }

        // Overall sentiment
        const allContent = messages.map(m => m.content).join(" ");
        const sentiment = this.analyzeSentiment(allContent);

        // Calculate duration
        let duration = 0;
        if (messages.length > 1 && messages[0].timestamp && messages[messages.length - 1].timestamp) {
            duration = messages[messages.length - 1].timestamp!.getTime() - messages[0].timestamp!.getTime();
        }

        return {
            topics,
            keyPoints: keyPoints.slice(0, 3),
            sentiment,
            messageCount: messages.length,
            duration
        };
    }

    // ========================================================================
    // CONTEXT COMPRESSION (Improvement #90)
    // ========================================================================

    compressContext(messages: Array<{ role: string; content: string }>, maxTokens: number): Array<{ role: string; content: string }> {
        // Estimate current tokens
        const estimateTokens = (msgs: Array<{ role: string; content: string }>) =>
            msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

        let compressed = [...messages];
        let currentTokens = estimateTokens(compressed);

        // If under limit, return as-is
        if (currentTokens <= maxTokens) {
            return compressed;
        }

        // Strategy 1: Keep first message (system) and last N messages
        const systemMsg = compressed.find(m => m.role === "system");
        const nonSystemMsgs = compressed.filter(m => m.role !== "system");

        // Calculate how many recent messages we can keep
        let keepCount = nonSystemMsgs.length;
        while (keepCount > 2 && estimateTokens(nonSystemMsgs.slice(-keepCount)) > maxTokens * 0.8) {
            keepCount--;
        }

        compressed = [
            ...(systemMsg ? [systemMsg] : []),
            ...nonSystemMsgs.slice(-keepCount)
        ];

        // Strategy 2: Summarize middle messages if still too long
        if (estimateTokens(compressed) > maxTokens) {
            const summary = this.summarizeConversation(nonSystemMsgs.slice(0, -keepCount));
            const summaryMsg = {
                role: "system" as const,
                content: `[Resumen de conversación anterior: Temas: ${summary.topics.join(", ")}. ${summary.keyPoints.join(" ")}]`
            };

            compressed = [
                ...(systemMsg ? [systemMsg] : []),
                summaryMsg,
                ...nonSystemMsgs.slice(-Math.max(2, keepCount - 2))
            ];
        }

        return compressed;
    }

    // ========================================================================
    // COMPLEXITY ESTIMATION
    // ========================================================================

    private estimateComplexity(message: string): "simple" | "moderate" | "complex" {
        const wordCount = message.split(/\s+/).length;
        const hasCode = /```/.test(message);
        const hasMultipleQuestions = (message.match(/\?/g) || []).length > 2;
        const hasLists = /\d+\.|[-*]/.test(message);
        const technicalTerms = (message.match(/\b(api|database|algorithm|function|class|interface|architecture|system|framework)\b/gi) || []).length;

        if (hasCode || technicalTerms > 3 || wordCount > 200 || hasMultipleQuestions) {
            return "complex";
        }

        if (wordCount > 50 || hasLists || technicalTerms > 0) {
            return "moderate";
        }

        return "simple";
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    getModelProfiles(): ModelProfile[] {
        return Array.from(this.modelProfiles.values());
    }

    getQualityMetrics(): {
        avgScore: number;
        totalResponses: number;
        positiveFeedback: number;
        negativeFeedback: number;
    } {
        const total = this.qualityScores.length;
        const avgScore = total > 0
            ? this.qualityScores.reduce((sum, q) => sum + q.score, 0) / total
            : 0;

        const positiveFeedback = this.qualityScores.filter(q => q.userFeedback === "positive").length;
        const negativeFeedback = this.qualityScores.filter(q => q.userFeedback === "negative").length;

        return { avgScore, totalResponses: total, positiveFeedback, negativeFeedback };
    }

    getTaskStats(): Record<TaskType, { totalRequests: number; avgResponseTime: number; successRate: number }> {
        const stats: Record<string, any> = {};

        for (const [taskType, history] of this.taskHistory) {
            const total = history.length;
            const successful = history.filter(h => h.success).length;
            const avgTime = history.reduce((sum, h) => sum + h.time, 0) / Math.max(total, 1);

            stats[taskType] = {
                totalRequests: total,
                avgResponseTime: avgTime,
                successRate: total > 0 ? successful / total : 1
            };
        }

        return stats as Record<TaskType, any>;
    }
}

// Singleton instance
export const smartAI = new SmartAIService();

export default smartAI;
