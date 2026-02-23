import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";
import { randomUUID } from "crypto";
import { emitTraceEvent } from "../unifiedChatHandler";
import {
    buildPresentationSpec,
    buildDocumentSpec,
    buildSpreadsheetSpec
} from "../builderSpec";
import { renderPresentation, renderDocument, renderSpreadsheet } from "../artifactRenderer";

export const createPresentationTool: ToolDefinition = {
    name: "create_presentation",
    description: "Create a PowerPoint presentation with slides",
    inputSchema: z.object({
        title: z.string().describe("Presentation title"),
        slides: z.array(z.object({
            title: z.string().optional(),
            content: z.string().optional(),
            bullets: z.array(z.string()).optional(),
            layout: z.enum(["title", "content", "twoColumn", "imageLeft", "imageRight"]).optional()
        })).describe("Array of slide definitions"),
        theme: z.string().optional().describe("Theme name (default 'professional')")
    }),
    execute: async (args: any, context: ToolContext): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const validatedSpec = buildPresentationSpec(args, context.userId);
            const { buffer } = await renderPresentation(validatedSpec);
            const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.pptx`;
            const fs = await import("fs/promises");
            const path = await import("path");

            const outputDir = path.join(process.cwd(), "generated_artifacts");
            await fs.mkdir(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, filename);
            await fs.writeFile(outputPath, buffer);

            const url = `/api/artifacts/${filename}`;

            // Emit trace event for UI update
            await emitTraceEvent(context.runId, "artifact_created", {
                artifact: {
                    id: randomUUID(),
                    type: "presentation",
                    name: filename,
                    url: url,
                    size: buffer.length,
                    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                }
            });

            return {
                success: true,
                output: { filename, slidesCount: args.slides.length, url },
                artifacts: [{
                    id: randomUUID(),
                    type: "document", // using general document type for registry artifacts array
                    name: filename,
                    url,
                    data: buffer,
                    size: buffer.length,
                    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    createdAt: new Date()
                }],
                metrics: { durationMs: Date.now() - startTime }
            };
        } catch (err: any) {
            return {
                success: false,
                output: null,
                error: { code: "PRESENTATION_ERROR", message: err.message, retryable: false },
                metrics: { durationMs: Date.now() - startTime }
            };
        }
    }
};

export const createDocumentTool: ToolDefinition = {
    name: "create_document",
    description: "Create a Word document with sections and content",
    inputSchema: z.object({
        title: z.string().describe("Document title"),
        sections: z.array(z.object({
            heading: z.string().optional(),
            content: z.string().optional(),
            bullets: z.array(z.string()).optional(),
            level: z.number().optional()
        })).describe("Document sections")
    }),
    execute: async (args: any, context: ToolContext): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const validatedSpec = buildDocumentSpec(args, context.userId);
            const { buffer } = await renderDocument(validatedSpec);
            const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.docx`;
            const fs = await import("fs/promises");
            const path = await import("path");

            const outputDir = path.join(process.cwd(), "generated_artifacts");
            await fs.mkdir(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, filename);
            await fs.writeFile(outputPath, buffer);

            const url = `/api/artifacts/${filename}`;

            await emitTraceEvent(context.runId, "artifact_created", {
                artifact: {
                    id: randomUUID(),
                    type: "document",
                    name: filename,
                    url: url,
                    size: buffer.length,
                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                }
            });

            return {
                success: true,
                output: { filename, sectionsCount: args.sections.length, url },
                artifacts: [{
                    id: randomUUID(),
                    type: "document",
                    name: filename,
                    url,
                    data: buffer,
                    size: buffer.length,
                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    createdAt: new Date()
                }],
                metrics: { durationMs: Date.now() - startTime }
            };
        } catch (err: any) {
            return {
                success: false,
                output: null,
                error: { code: "DOCUMENT_ERROR", message: err.message, retryable: false },
                metrics: { durationMs: Date.now() - startTime }
            };
        }
    }
};

export const createSpreadsheetTool: ToolDefinition = {
    name: "create_spreadsheet",
    description: "Create an Excel spreadsheet with data",
    inputSchema: z.object({
        title: z.string().describe("Spreadsheet title"),
        sheets: z.array(z.object({
            name: z.string().optional(),
            headers: z.array(z.string()).optional(),
            rows: z.array(z.array(z.any())).optional()
        })).describe("Sheet definitions")
    }),
    execute: async (args: any, context: ToolContext): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const validatedSpec = buildSpreadsheetSpec(args, context.userId);
            const { buffer } = await renderSpreadsheet(validatedSpec);
            const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.xlsx`;
            const fs = await import("fs/promises");
            const path = await import("path");

            const outputDir = path.join(process.cwd(), "generated_artifacts");
            await fs.mkdir(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, filename);
            await fs.writeFile(outputPath, buffer);

            const url = `/api/artifacts/${filename}`;

            await emitTraceEvent(context.runId, "artifact_created", {
                artifact: {
                    id: randomUUID(),
                    type: "spreadsheet",
                    name: filename,
                    url: url,
                    size: buffer.length,
                    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
            });

            return {
                success: true,
                output: { filename, sheetsCount: args.sheets.length, url },
                artifacts: [{
                    id: randomUUID(),
                    type: "document",
                    name: filename,
                    url,
                    data: buffer,
                    size: buffer.length,
                    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    createdAt: new Date()
                }],
                metrics: { durationMs: Date.now() - startTime }
            };
        } catch (err: any) {
            return {
                success: false,
                output: null,
                error: { code: "SPREADSHEET_ERROR", message: err.message, retryable: false },
                metrics: { durationMs: Date.now() - startTime }
            };
        }
    }
};
