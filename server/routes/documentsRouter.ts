import { Router } from "express";
import { 
  generateWordDocument, 
  generateExcelDocument, 
  generatePptDocument,
  parseExcelFromText,
  parseSlidesFromText
} from "../services/documentGeneration";
import { 
  DocumentRenderRequestSchema,
  renderDocument,
  getGeneratedDocument,
  getTemplates,
  getTemplateById
} from "../services/documentService";
import { renderExcelFromSpec } from "../services/excelSpecRenderer";
import { renderWordFromSpec } from "../services/wordSpecRenderer";
import { generateExcelFromPrompt, generateWordFromPrompt, generateCvFromPrompt, generateReportFromPrompt, generateLetterFromPrompt } from "../services/documentOrchestrator";
import { renderCvFromSpec } from "../services/cvRenderer";
import { selectCvTemplate } from "../services/documentMappingService";
import { excelSpecSchema, docSpecSchema, cvSpecSchema } from "../../shared/documentSpecs";
import { llmGateway } from "../lib/llmGateway";

export function createDocumentsRouter() {
  const router = Router();

  router.post("/generate", async (req, res) => {
    try {
      const { type, title, content } = req.body;
      
      if (!type || !title || !content) {
        return res.status(400).json({ error: "type, title, and content are required" });
      }

      let buffer: Buffer;
      let filename: string;
      let mimeType: string;

      switch (type) {
        case "word":
          buffer = await generateWordDocument(title, content);
          filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.docx`;
          mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          break;
        case "excel":
          const excelData = parseExcelFromText(content);
          buffer = await generateExcelDocument(title, excelData);
          filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          break;
        case "ppt":
          const slides = parseSlidesFromText(content);
          buffer = await generatePptDocument(title, slides);
          filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.pptx`;
          mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          break;
        default:
          return res.status(400).json({ error: "Invalid document type. Use 'word', 'excel', or 'ppt'" });
      }

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Document generation error:", error);
      res.status(500).json({ error: "Failed to generate document", details: error.message });
    }
  });

  router.get("/templates", async (req, res) => {
    try {
      const templates = getTemplates();
      const type = req.query.type as string | undefined;
      
      if (type) {
        const filtered = templates.filter(t => t.type.includes(type as any));
        return res.json(filtered);
      }
      
      res.json(templates);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  router.get("/templates/:id", async (req, res) => {
    try {
      const template = getTemplateById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      console.error("Error fetching template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  router.post("/render", async (req, res) => {
    try {
      const parseResult = DocumentRenderRequestSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid request", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const document = await renderDocument(parseResult.data);
      
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const downloadUrl = `${baseUrl}/api/documents/${document.id}`;
      
      res.json({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        downloadUrl,
        expiresAt: document.expiresAt.toISOString(),
      });
    } catch (error: any) {
      console.error("Document render error:", error);
      res.status(500).json({ error: "Failed to render document", details: error.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const document = getGeneratedDocument(req.params.id);
      
      if (!document) {
        return res.status(404).json({ error: "Document not found or expired" });
      }
      
      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
      res.setHeader("Content-Length", document.buffer.length);
      res.send(document.buffer);
    } catch (error: any) {
      console.error("Document download error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  router.post("/render/excel", async (req, res) => {
    try {
      const parseResult = excelSpecSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid Excel spec", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const buffer = await renderExcelFromSpec(parseResult.data);
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${parseResult.data.workbook_title || 'workbook'}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel render error:", error);
      res.status(500).json({ error: "Failed to render Excel document", details: error.message });
    }
  });

  router.post("/render/word", async (req, res) => {
    try {
      const parseResult = docSpecSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid Word doc spec", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const buffer = await renderWordFromSpec(parseResult.data);
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${parseResult.data.title || 'document'}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Word render error:", error);
      res.status(500).json({ error: "Failed to render Word document", details: error.message });
    }
  });

  router.post("/generate/excel", async (req, res) => {
    try {
      const { prompt, returnMetadata } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateExcelFromPrompt(prompt);
      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: `${spec.workbook_title || 'generated'}.xlsx`,
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${spec.workbook_title || 'generated'}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel generation error:", error);
      res.status(500).json({ error: "Failed to generate Excel document", details: error.message });
    }
  });

  router.post("/generate/word", async (req, res) => {
    try {
      const { prompt, returnMetadata } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateWordFromPrompt(prompt);
      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: `${spec.title || 'generated'}.docx`,
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${spec.title || 'generated'}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Word generation error:", error);
      res.status(500).json({ error: "Failed to generate Word document", details: error.message });
    }
  });

  router.post("/generate/cv", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateCvFromPrompt(prompt);
      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="cv_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("CV generation error:", error);
      res.status(500).json({ error: "Failed to generate CV document", details: error.message });
    }
  });

  router.post("/generate/report", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateReportFromPrompt(prompt);
      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="report_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Report generation error:", error);
      res.status(500).json({ error: "Failed to generate Report document", details: error.message });
    }
  });

  router.post("/generate/letter", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateLetterFromPrompt(prompt);
      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="letter_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Letter generation error:", error);
      res.status(500).json({ error: "Failed to generate Letter document", details: error.message });
    }
  });

  router.post("/render/cv", async (req, res) => {
    try {
      const parseResult = cvSpecSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid CV spec", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const spec = parseResult.data;
      const templateConfig = selectCvTemplate(spec.template_style || "modern");
      const buffer = await renderCvFromSpec(spec, templateConfig);
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="cv_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("CV render error:", error);
      res.status(500).json({ error: "Failed to render CV document", details: error.message });
    }
  });

  router.post("/plan", async (req, res) => {
    try {
      const { prompt, selectedText, documentContent } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const systemPrompt = `You are a document editing assistant. Given a user's instruction, generate a plan of document editing commands.

Available commands:
- bold: Toggle bold formatting
- italic: Toggle italic formatting
- underline: Toggle underline formatting
- strikethrough: Toggle strikethrough
- heading1, heading2, heading3: Set heading level
- paragraph: Set as paragraph
- bulletList: Toggle bullet list
- orderedList: Toggle numbered list
- alignLeft, alignCenter, alignRight, alignJustify: Text alignment
- insertLink: Insert link (payload: {url: string})
- insertImage: Insert image (payload: {src: string})
- insertTable: Insert table (payload: {rows: number, cols: number})
- blockquote: Toggle blockquote
- codeBlock: Toggle code block
- insertHorizontalRule: Insert horizontal line
- setTextColor: Set text color (payload: {color: string})
- setHighlight: Highlight text (payload: {color: string})
- insertText: Insert text (payload: {text: string})
- replaceSelection: Replace selected text (payload: {content: string})
- clearFormatting: Remove all formatting

Respond with a JSON object containing:
{
  "intent": "brief description of what user wants",
  "commands": [
    {"name": "commandName", "payload": {...}, "description": "what this step does"}
  ]
}

Only respond with valid JSON, no markdown code blocks.`;

      const userMessage = `User instruction: ${prompt}
${selectedText ? `\nSelected text: "${selectedText}"` : ''}
${documentContent ? `\nDocument context (first 500 chars): "${documentContent.substring(0, 500)}"` : ''}

Generate the command plan:`;

      const result = await llmGateway.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ], {
        temperature: 0.3,
        maxTokens: 1024,
      });

      let plan;
      try {
        const jsonStr = result.content.replace(/```json\n?|\n?```/g, '').trim();
        plan = JSON.parse(jsonStr);
      } catch {
        plan = {
          intent: prompt,
          commands: [],
          error: "Failed to parse AI response"
        };
      }

      res.json(plan);
    } catch (error: any) {
      console.error("Document plan error:", error);
      res.status(500).json({ error: "Failed to generate document plan", details: error.message });
    }
  });

  return router;
}
