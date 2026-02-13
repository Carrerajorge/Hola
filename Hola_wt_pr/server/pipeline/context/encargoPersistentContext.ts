import { ragPipeline } from "../../services/ragPipeline";
import { storage } from "../../storage";
import type { IngestedChunk } from "../ingestion2026/ingestionTypes";
import type { BriefAttachmentSummary } from "../requestUnderstanding/requestUnderstandingAgent";

function safeTrim(s: unknown, max = 2000): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  const t = str.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function buildFallbackSourceId(fileName: string, pageNumber?: number | null): string {
  const base = `doc:${fileName || "document"}`;
  if (pageNumber && Number.isFinite(pageNumber)) return `${base} p${pageNumber}`;
  return base;
}

function normalizeHeadingPath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => safeTrim(v, 120)).filter(Boolean).slice(0, 12);
}

function normalizeLocation(value: unknown, pageNumber?: number | null): Record<string, any> {
  const loc: any = (value && typeof value === "object") ? value : {};
  const page = (typeof loc.page === "number" ? loc.page : pageNumber) ?? undefined;
  return page ? { ...loc, page } : { ...loc };
}

export async function loadPersistentEncargoContextFromDb(args: {
  chatId: string;
  maxDocuments?: number;
  maxChunksTotal?: number;
  includeDocumentChunks?: boolean;
}): Promise<{ chunks: IngestedChunk[]; attachments: BriefAttachmentSummary[]; fileIds: string[] } | null> {
  const chatId = (args.chatId || "").trim();
  if (!chatId) return null;

  const maxDocuments = Math.max(1, Math.min(10, args.maxDocuments ?? 5));
  const maxChunksTotal = Math.max(50, Math.min(2000, args.maxChunksTotal ?? 800));
  const includeDocumentChunks = args.includeDocumentChunks !== false;

  let docs;
  try {
    docs = await storage.getConversationDocuments(chatId);
  } catch (err: any) {
    console.warn(`[EncargoPersistentContext] Failed to load conversation documents for chatId=${chatId}:`, err?.message || err);
    return null;
  }

  if (!docs || docs.length === 0) return null;

  const tail = docs.slice(-maxDocuments);

  const chunks: IngestedChunk[] = [];
  const attachments: BriefAttachmentSummary[] = [];
  const fileIds: string[] = [];
  const seenChunkIds = new Set<string>();

  for (const d of tail) {
    const meta: any = (d.metadata as any) || {};
    const fileId = typeof meta.fileId === "string" ? meta.fileId : null;
    const fileName = d.fileName || meta.fileName || "document";

    if (fileId) fileIds.push(fileId);

    attachments.push({
      id: fileId || d.id,
      kind: "document",
      label: fileName,
      mimeType: d.mimeType,
      summary: [
        `Loaded from conversation history`,
        fileId ? `fileId=${fileId}` : ``,
        d.extractedText ? `extractedTextChars=${d.extractedText.length}` : ``,
      ].filter(Boolean).join("\n"),
      citationHint: `doc:${fileName}`,
    });

    if (chunks.length >= maxChunksTotal) break;

    // Prefer file_chunks when fileId is known (embeddings + chunk boundaries).
    if (includeDocumentChunks && fileId) {
      try {
        const fileChunks = await storage.getFileChunks(fileId);
        for (const fc of fileChunks) {
          if (chunks.length >= maxChunksTotal) break;
          const fcMeta: any = (fc.metadata as any) || {};
          const sourceId = typeof fcMeta.sourceId === "string"
            ? fcMeta.sourceId
            : buildFallbackSourceId(fileName, fc.pageNumber);
          const headingPath = normalizeHeadingPath(fcMeta.headingPath);
          const location = normalizeLocation(fcMeta.location, fc.pageNumber);

          const id = `filechunk_${fc.id}`;
          if (seenChunkIds.has(id)) continue;
          seenChunkIds.add(id);

          chunks.push({
            id,
            kind: "document",
            filename: fileName,
            sourceId,
            location,
            headingPath,
            content: fc.content,
            rawContent: typeof fcMeta.rawContent === "string" ? fcMeta.rawContent : undefined,
            metadata: {
              ...(typeof fcMeta === "object" ? fcMeta : {}),
              kindLabel: fcMeta.kindLabel || "db_chunk",
            },
            embedding: Array.isArray((fc as any).embedding) ? (fc as any).embedding : undefined,
          });
        }
        continue;
      } catch (err: any) {
        console.warn(`[EncargoPersistentContext] Failed to load file_chunks for fileId=${fileId}:`, err?.message || err);
      }
    }

    // Fallback: chunk extractedText (no embeddings) into retrievable chunks.
    const extracted = safeTrim(d.extractedText || "", 120_000);
    if (!extracted) continue;

    const semantic = ragPipeline.semanticChunk(extracted).slice(0, 60);
    for (const sc of semantic) {
      if (chunks.length >= maxChunksTotal) break;
      const pageNumber = (sc.metadata?.pageNumber as any) ?? undefined;
      const sourceId = buildFallbackSourceId(fileName, pageNumber);
      const id = `convdoc_${d.id}_${sc.chunkIndex}`;
      if (seenChunkIds.has(id)) continue;
      seenChunkIds.add(id);
      chunks.push({
        id,
        kind: "document",
        filename: fileName,
        sourceId,
        location: pageNumber ? { page: pageNumber } : {},
        headingPath: [],
        content: sc.content,
        rawContent: sc.content,
        metadata: { kindLabel: "conversation_document" },
      });
    }
  }

  return chunks.length > 0 || attachments.length > 0 || fileIds.length > 0
    ? { chunks, attachments, fileIds: Array.from(new Set(fileIds)) }
    : null;
}
