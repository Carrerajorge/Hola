export type IngestedChunkKind = "document" | "image" | "web";

export interface IngestedChunkLocation {
  page?: number;
  sheet?: string;
  slide?: number;
  row?: number;
  cell?: string;
  sectionRef?: string; // e.g. "para:3" for Word extractor
}

export interface IngestedChunk {
  id: string;
  kind: IngestedChunkKind;
  filename?: string; // documents
  sourceId: string; // used for citations in the answer, e.g. "doc:foo.pdf p3 sec:\"Results\""
  location: IngestedChunkLocation;
  headingPath: string[]; // carried context (titles/headings)
  content: string; // text presented to the model
  rawContent?: string; // optional raw (without prefix)
  metadata?: Record<string, unknown>;
  embedding?: number[]; // optional cached embedding
}

export interface IngestedDocumentSummary {
  docId: string;
  filename: string;
  mimeType: string;
  documentType?: string;
  pageCount?: number;
  sheetCount?: number;
  headingPreview: string[];
  tableCount: number;
  sectionCount: number;
  notes?: string[];
}

