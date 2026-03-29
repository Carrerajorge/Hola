/**
 * OCR Integration
 * 
 * OCR para PDFs escaneados e imágenes usando Tesseract.js.
 */

import * as Tesseract from "tesseract.js";

interface OCRProgress {
  status: "loading" | "recognizing" | "completed" | "error";
  progress: number;
  message: string;
}

type OCRProgressCallback = (progress: OCRProgress) => void;

interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

// Check if PDF has extractable text
export async function pdfHasText(buffer: ArrayBuffer): Promise<boolean> {
  try {
    // Try to extract text using pdf.js
    const pdfjsLib = await import("pdfjs-dist");
    
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let totalText = "";

    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      totalText += pageText;
    }

    // If we got meaningful text, PDF is not scanned
    const cleanText = totalText.trim().replace(/\s+/g, " ");
    return cleanText.length > 100;
  } catch {
    return false;
  }
}

// Check if content needs OCR
export async function needsOCR(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<boolean> {
  // Images always need OCR
  if (mimeType.startsWith("image/")) {
    return true;
  }

  // PDFs need OCR if they don't have extractable text
  if (mimeType === "application/pdf") {
    return !(await pdfHasText(buffer));
  }

  return false;
}

// Perform OCR on image or PDF
export async function performOCR(
  source: ArrayBuffer | Blob | string, // ArrayBuffer for PDF, Blob for image, string for URL
  options: {
    language?: string;
    onProgress?: OCRProgressCallback;
    mimeType?: string;
  } = {}
): Promise<OCRResult> {
  const { language = "spa+eng", onProgress, mimeType } = options;

  const updateProgress = (progress: OCRProgress) => {
    onProgress?.(progress);
  };

  updateProgress({ status: "loading", progress: 0, message: "Cargando motor OCR..." });

  try {
    // For PDFs, convert pages to images first
    if (mimeType === "application/pdf" && source instanceof ArrayBuffer) {
      return await ocrPdf(source, language, updateProgress);
    }

    // For images, run OCR directly
    updateProgress({ status: "loading", progress: 20, message: "Preparando imagen..." });

    // Convert ArrayBuffer to Blob if needed
    const imageSource: any = source instanceof ArrayBuffer 
      ? new Blob([source]) 
      : source;

    const result: any = await Tesseract.recognize(imageSource, language, {
      logger: (m: any) => {
        if (m.status === "recognizing text") {
          updateProgress({
            status: "recognizing",
            progress: 20 + m.progress * 80,
            message: `Reconociendo texto... ${Math.round(m.progress * 100)}%`,
          });
        }
      },
    });

    updateProgress({ status: "completed", progress: 100, message: "OCR completado" });

    const words = result.data?.words || [];
    return {
      text: result.data?.text || "",
      confidence: result.data?.confidence || 0,
      words: words.map((word: any) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox,
      })),
    };
  } catch (error) {
    updateProgress({
      status: "error",
      progress: 0,
      message: error instanceof Error ? error.message : "Error en OCR",
    });
    throw error;
  }
}

// OCR for PDF pages
async function ocrPdf(
  buffer: ArrayBuffer,
  language: string,
  updateProgress: OCRProgressCallback
): Promise<OCRResult> {
  const pdfjsLib = await import("pdfjs-dist");

  updateProgress({ status: "loading", progress: 10, message: "Cargando PDF..." });

  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const numPages = pdf.numPages;
  let fullText = "";
  let totalConfidence = 0;
  const allWords: OCRResult["words"] = [];

  for (let i = 1; i <= numPages; i++) {
    const pageProgress = ((i - 1) / numPages) * 100;

    updateProgress({
      status: "recognizing",
      progress: pageProgress,
      message: `Procesando página ${i} de ${numPages}...`,
    });

    const page = await pdf.getPage(i);
    const scale = 2; // Higher scale for better OCR
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d")!;

    // Render page to canvas
    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    // Convert to blob
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });

    // OCR the page
    const pageResult: any = await Tesseract.recognize(blob, language, {
      logger: (m: any) => {
        if (m.status === "recognizing text") {
          const overallProgress = pageProgress + (m.progress * 100 / numPages);
          updateProgress({
            status: "recognizing",
            progress: overallProgress,
            message: `Página ${i}/${numPages}: ${Math.round(m.progress * 100)}%`,
          });
        }
      },
    });

    const pageData = pageResult.data || {};
    fullText += `\n\n--- Página ${i} ---\n\n${pageData.text || ""}`;
    totalConfidence += pageData.confidence || 0;

    const pageWords = pageData.words || [];
    pageWords.forEach((word: any) => {
      allWords.push({
        text: word.text,
        confidence: word.confidence,
        bbox: {
          x0: word.bbox?.x0 || 0,
          y0: (word.bbox?.y0 || 0) + (i - 1) * viewport.height,
          x1: word.bbox?.x1 || 0,
          y1: (word.bbox?.y1 || 0) + (i - 1) * viewport.height,
        },
      });
    });
  }

  updateProgress({ status: "completed", progress: 100, message: "OCR completado" });

  return {
    text: fullText.trim(),
    confidence: totalConfidence / numPages,
    words: allWords,
  };
}

// Quick OCR check with sampling
export async function quickOCRCheck(
  source: ArrayBuffer,
  mimeType: string
): Promise<{ needsOCR: boolean; sampleText?: string }> {
  if (mimeType !== "application/pdf") {
    return { needsOCR: mimeType.startsWith("image/") };
  }

  const hasText = await pdfHasText(source);

  if (hasText) {
    return { needsOCR: false };
  }

  // Sample first page with low quality for quick check
  try {
    const pdfjsLib = await import("pdfjs-dist");
    const pdf = await pdfjsLib.getDocument({ data: source }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d")!;

    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.5);
    });

    const result = await Tesseract.recognize(blob, "eng", {});

    return {
      needsOCR: true,
      sampleText: result.data.text.slice(0, 200),
    };
  } catch {
    return { needsOCR: true };
  }
}
