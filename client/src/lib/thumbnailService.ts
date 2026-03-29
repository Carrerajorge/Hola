/**
 * Thumbnail Service
 * 
 * Genera miniaturas de documentos para previsualización rápida.
 * Las miniaturas se generan en el cliente y se cachean.
 */

import { getCachedPreview, setCachedPreview, type CachedPreview } from "./filePreviewCache";

interface ThumbnailOptions {
  width: number;
  height: number;
  quality: number;
  format: "image/jpeg" | "image/png" | "image/webp";
}

const DEFAULT_OPTIONS: ThumbnailOptions = {
  width: 200,
  height: 280,
  quality: 0.8,
  format: "image/jpeg",
};

export interface ThumbnailResult {
  dataUrl: string;
  width: number;
  height: number;
  format: string;
  generatedAt: number;
}

// Generate thumbnail for image
async function generateImageThumbnail(
  file: File | Blob,
  options: ThumbnailOptions = DEFAULT_OPTIONS
): Promise<ThumbnailResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement("canvas");
      let { width, height } = img;

      // Calculate aspect ratio
      const aspectRatio = width / height;
      const targetAspect = options.width / options.height;

      if (aspectRatio > targetAspect) {
        // Image is wider
        width = options.width;
        height = options.width / aspectRatio;
      } else {
        // Image is taller
        height = options.height;
        width = options.height * aspectRatio;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL(options.format, options.quality);

      resolve({
        dataUrl,
        width,
        height,
        format: options.format,
        generatedAt: Date.now(),
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

// Generate thumbnail for PDF (first page)
async function generatePdfThumbnail(
  buffer: ArrayBuffer,
  options: ThumbnailOptions = DEFAULT_OPTIONS
): Promise<ThumbnailResult> {
  const pdfjsLib = await import("pdfjs-dist");

  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    options.width / viewport.width,
    options.height / viewport.height
  );

  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  const context = canvas.getContext("2d")!;
  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

  const dataUrl = canvas.toDataURL(options.format, options.quality);

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    format: options.format,
    generatedAt: Date.now(),
  };
}

// Generate thumbnail for Word (using mammoth's first image or placeholder)
async function generateWordThumbnail(
  buffer: ArrayBuffer,
  options: ThumbnailOptions = DEFAULT_OPTIONS
): Promise<ThumbnailResult> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;

  const ctx = canvas.getContext("2d")!;

  // Draw Word-like placeholder
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("DOCX", canvas.width / 2, canvas.height / 2 - 10);

  ctx.font = "12px system-ui";
  ctx.fillText("Documento Word", canvas.width / 2, canvas.height / 2 + 15);

  // Draw some "text lines" to simulate content
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  for (let i = 0; i < 6; i++) {
    const y = canvas.height * 0.65 + i * 12;
    const width = Math.random() * 60 + 40;
    ctx.fillRect(20, y, width, 6);
  }

  const dataUrl = canvas.toDataURL(options.format, options.quality);

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    format: options.format,
    generatedAt: Date.now(),
  };
}

// Generate thumbnail for Excel
async function generateExcelThumbnail(
  options: ThumbnailOptions = DEFAULT_OPTIONS
): Promise<ThumbnailResult> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;

  const ctx = canvas.getContext("2d")!;

  // Draw Excel-like placeholder
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("XLSX", canvas.width / 2, canvas.height / 2 - 10);

  ctx.font = "12px system-ui";
  ctx.fillText("Hoja de cálculo", canvas.width / 2, canvas.height / 2 + 15);

  // Draw grid to simulate spreadsheet
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;

  const cellWidth = 20;
  const cellHeight = 15;
  const startX = 20;
  const startY = canvas.height * 0.65;

  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(startX + i * cellWidth, startY);
    ctx.lineTo(startX + i * cellWidth, startY + 4 * cellHeight);
    ctx.stroke();
  }

  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(startX, startY + i * cellHeight);
    ctx.lineTo(startX + 7 * cellWidth, startY + i * cellHeight);
    ctx.stroke();
  }

  const dataUrl = canvas.toDataURL(options.format, options.quality);

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    format: options.format,
    generatedAt: Date.now(),
  };
}

// Main function to generate thumbnail
export async function generateThumbnail(
  file: File,
  options: ThumbnailOptions = DEFAULT_OPTIONS
): Promise<ThumbnailResult> {
  const ext = file.name.toLowerCase().split(".").pop() || "";
  const mimeType = file.type;

  // Image
  if (mimeType.startsWith("image/")) {
    return generateImageThumbnail(file, options);
  }

  // PDF
  if (mimeType === "application/pdf" || ext === "pdf") {
    const buffer = await file.arrayBuffer();
    return generatePdfThumbnail(buffer, options);
  }

  // Word
  if (
    ext === "docx" ||
    ext === "doc" ||
    mimeType.includes("word") ||
    mimeType.includes("document")
  ) {
    const buffer = await file.arrayBuffer();
    return generateWordThumbnail(buffer, options);
  }

  // Excel
  if (
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv" ||
    mimeType.includes("sheet") ||
    mimeType.includes("excel")
  ) {
    return generateExcelThumbnail(options);
  }

  // Default placeholder
  return generateGenericThumbnail(file.name, options);
}

// Generic placeholder thumbnail
async function generateGenericThumbnail(
  fileName: string,
  options: ThumbnailOptions = DEFAULT_OPTIONS
): Promise<ThumbnailResult> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;

  const ctx = canvas.getContext("2d")!;

  // Draw placeholder
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("📄", canvas.width / 2, canvas.height / 2 - 20);

  ctx.font = "12px system-ui";

  // Truncate filename if needed
  const maxChars = 15;
  const displayName = fileName.length > maxChars
    ? fileName.slice(0, maxChars - 3) + "..."
    : fileName;

  ctx.fillText(displayName, canvas.width / 2, canvas.height / 2 + 15);

  const dataUrl = canvas.toDataURL(options.format, options.quality);

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    format: options.format,
    generatedAt: Date.now(),
  };
}

// Cache thumbnail in preview cache
export function cacheThumbnail(fileId: string, thumbnail: ThumbnailResult): void {
  const existing = getCachedPreview(fileId);
  
  const preview: CachedPreview = {
    id: fileId,
    name: "",
    mimeType: "",
    extractedAt: Date.now(),
    size: 0,
    ...existing,
    // Store thumbnail in a custom field
  } as any;

  // Store thumbnail separately in localStorage
  try {
    const key = `thumbnail_${fileId}`;
    localStorage.setItem(key, JSON.stringify(thumbnail));
  } catch (e) {
    console.warn("Failed to cache thumbnail:", e);
  }
}

// Retrieve cached thumbnail
export function getCachedThumbnail(fileId: string): ThumbnailResult | null {
  try {
    const key = `thumbnail_${fileId}`;
    const cached = localStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Clear thumbnail cache
export function clearThumbnailCache(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith("thumbnail_")) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn("Failed to clear thumbnail cache:", e);
  }
}
