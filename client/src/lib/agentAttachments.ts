export interface AgentAttachmentCandidate {
  id?: string;
  fileId?: string;
  name: string;
  type: string;
  mimeType?: string;
  size: number;
  storagePath?: string;
  path?: string;
  status?: string;
  analysisId?: string;
  spreadsheetData?: {
    uploadId: string;
    sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
    previewData?: { headers: string[]; data: any[][] };
  };
  metadata?: Record<string, unknown>;
}

export function isSendableAgentAttachment(file: AgentAttachmentCandidate): boolean {
  const status = String(file?.status || "").toLowerCase();
  if (!file) return false;
  if (status === "error" || status === "uploading" || status === "validating") {
    return false;
  }

  const hasStableFileId =
    typeof (file.id || file.fileId) === "string" &&
    String(file.id || file.fileId || "").length > 0 &&
    !String(file.id || file.fileId || "").startsWith("temp-");

  const hasStoragePath =
    typeof (file.storagePath || file.path) === "string" &&
    String(file.storagePath || file.path || "").trim().length > 0;

  return hasStableFileId && hasStoragePath;
}

export function buildAgentRunAttachments(files: AgentAttachmentCandidate[]) {
  return files
    .filter(isSendableAgentAttachment)
    .map((file) => ({
      id: file.id || file.fileId!,
      fileId: file.fileId || file.id!,
      name: file.name,
      mimeType: file.mimeType || file.type,
      type: file.type,
      storagePath: (file.storagePath || file.path)!,
      path: (file.storagePath || file.path)!,
      size: file.size,
      metadata: {
        ...(file.metadata || {}),
        spreadsheetData: file.spreadsheetData,
        analysisId: file.analysisId,
      },
    }));
}

export function normalizeAgentRunAttachments(files?: unknown[]): ReturnType<typeof buildAgentRunAttachments> | undefined {
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  const normalizedFiles = files
    .map((file): AgentAttachmentCandidate | null => {
      if (!file || typeof file !== "object") {
        return null;
      }

      const candidate = file as Record<string, unknown>;
      const id =
        typeof candidate.id === "string"
          ? candidate.id
          : typeof candidate.fileId === "string"
            ? candidate.fileId
            : undefined;
      const storagePath = String(candidate.storagePath || candidate.path || "").trim();
      const mimeType = String(candidate.mimeType || candidate.type || "").trim();
      const type = String(candidate.type || candidate.mimeType || mimeType || "application/octet-stream").trim();
      const name = String(candidate.name || candidate.filename || "").trim();
      const sizeValue = candidate.size;
      const size =
        typeof sizeValue === "number" && Number.isFinite(sizeValue)
          ? sizeValue
          : typeof sizeValue === "string" && Number.isFinite(Number(sizeValue))
            ? Number(sizeValue)
            : 0;

      if (!id || !name || !storagePath) {
        return null;
      }

      return {
        id,
        fileId: typeof candidate.fileId === "string" ? candidate.fileId : id,
        name,
        type,
        mimeType: mimeType || type,
        size,
        storagePath,
        path: storagePath,
        status: typeof candidate.status === "string" ? candidate.status : undefined,
        analysisId: typeof candidate.analysisId === "string" ? candidate.analysisId : undefined,
        spreadsheetData:
          candidate.spreadsheetData && typeof candidate.spreadsheetData === "object"
            ? (candidate.spreadsheetData as AgentAttachmentCandidate["spreadsheetData"])
            : undefined,
        metadata:
          candidate.metadata && typeof candidate.metadata === "object"
            ? (candidate.metadata as Record<string, unknown>)
            : undefined,
      };
    })
    .filter((file): file is AgentAttachmentCandidate => file !== null);

  const attachments = buildAgentRunAttachments(normalizedFiles);
  return attachments.length > 0 ? attachments : undefined;
}
