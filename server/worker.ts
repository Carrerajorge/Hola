import "dotenv/config";
import { initTracing } from "./lib/tracing";

// Initialize Distributed Tracing
initTracing({ serviceName: "iliagpt-worker" });

import { createWorker, QUEUE_NAMES } from "./lib/queueFactory";
import { UploadJobData } from "./services/uploadQueue";
import { Logger } from "./lib/logger";
import { Job } from "bullmq";

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "5");

Logger.info(`Starting Worker Process (Concurrency: ${WORKER_CONCURRENCY})...`);

// ==========================================
// 1. Upload Queue Worker
// ==========================================
createWorker<UploadJobData, any>(QUEUE_NAMES.UPLOAD, async (job) => {
    Logger.info(`[UploadJob:${job.id}] Processing: ${job.data.fileName} (${job.data.size} bytes)`);

    // Simulate Processing time (e.g. S3 upload, virus scan)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Real implementation would go here

    Logger.info(`[UploadJob:${job.id}] Completed`);
    return { processed: true, chunks: 12 };
}); // No .on() handlers needed here as they are handled in queueFactory or global events if needed, 
// but we can add them to the worker instance if we want specific logging.

// ==========================================
// 2. Parallel Processing Worker (The Engine)
// ==========================================

// Types from the old engine
type TaskType = "chunk" | "embed" | "analyze" | "ocr" | "vision" | "pii" | "quality" | "custom" | "pdf-generate" | "excel-parse";
interface ProcessingTaskData {
    [key: string]: any;
}

// Processor Logic (Migrated from in-memory engine)
// Processor Logic (PROD Implementation)
const processors: Record<TaskType, (data: any) => Promise<any>> = {
    chunk: async (data: { text: string }) => {
        // Simple recursive character text splitter logic
        const chunkSize = 1000;
        const overlap = 200;
        const chunks: string[] = [];

        // Basic implementation (production would use langchain's splitter)
        for (let i = 0; i < data.text.length; i += (chunkSize - overlap)) {
            chunks.push(data.text.slice(i, i + chunkSize));
        }

        return { chunks, count: chunks.length };
    },

    embed: async (data: { texts: string[] }) => {
        // Uses OpenAI API
        const OpenAIApi = (await import("openai")).default;
        const openai = new OpenAIApi({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: data.texts,
        });

        return {
            embeddings: response.data.map(d => d.embedding),
            usage: response.usage
        };
    },

    analyze: async (data: { content: string }) => {
        const wordCount = data.content.split(/\s+/).length;
        const charCount = data.content.length;
        const readingTimeMinutes = Math.ceil(wordCount / 200);

        return {
            wordCount,
            charCount,
            readingTimeMinutes,
            language: "detected-auto", // Placeholder for 'franc'
        };
    },

    ocr: async (data: { buffer: { type: 'Buffer', data: number[] } }) => {
        // Tesseract.js implementation
        const Tesseract = (await import("tesseract.js")).default;
        // Handle Buffer from JSON (Redis serialization)
        const buffer = Buffer.from(data.buffer.data);

        const { data: { text, confidence } } = await Tesseract.recognize(buffer, 'eng');

        return { text, confidence };
    },

    vision: async (data: { image: string }) => {
        // Placeholder: Vision costs money, keeping simulated for now unless explicitly requested.
        // Real imp would use GPT-4o-mini vision
        await new Promise(resolve => setTimeout(resolve, 500));
        return { description: "Simulated vision analysis (Prod pending)", objects: [] };
    },

    pii: async (data: { text: string }) => {
        // Placeholder for PII
        await new Promise(resolve => setTimeout(resolve, 30));
        return { detections: 0, types: [] };
    },

    quality: async (data: { text: string }) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { score: 1.0, issues: [] };
    },

    custom: async (data: { fn: string }) => {
        return { error: "Custom function execution disabled for security" };
    },

    "pdf-generate": async (data: any) => {
        const { generatePdfFromHtml } = await import("./services/pdfGeneration");
        const buffer = await generatePdfFromHtml(data.html, data.options);
        // In a real worker, we might upload this buffer to S3/Storage and return the URL.
        // For this local/hybrid setup, we might return the buffer base64 encoded or save to temp.
        // Returning base64 for simplicity in this isomorphic setup
        return { pdfBase64: buffer.toString('base64'), fileName: data.outputFilename };
    },

    "excel-parse": async (data: any) => {
        const { parseSpreadsheet } = await import("./services/spreadsheetAnalyzer");
        const fs = await import("fs/promises");

        // In a real worker, we download from S3. Here we might read from disk if shared volume.
        // Assuming job data contains a path accessible to worker
        const buffer = await fs.readFile(data.filePath);
        const result = await parseSpreadsheet(buffer, data.mimeType);

        // We might store the result in DB here or return it
        return result;
    }
};

const processingWorker = createWorker(QUEUE_NAMES.PROCESSING, async (job: Job) => {
    Logger.info(`[ProcessJob:${job.id}] Type: ${job.name}`);

    try {
        const processor = processors[job.name as TaskType];
        if (!processor) {
            throw new Error(`Unknown task type: ${job.name}`);
        }

        const result = await processor(job.data);
        return result;

    } catch (error) {
        Logger.error(`[ProcessJob:${job.id}] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        throw error;
    }
});

processingWorker.on("ready", () => Logger.info("Processing Worker ready"));
processingWorker.on("error", (e) => Logger.error("Processing Worker error", e));

// ==========================================
// Lifecycle
// ==========================================

const shutdown = async () => {
    Logger.info("Shutting down workers...");
    process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
