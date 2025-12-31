import Tesseract from 'tesseract.js';

export interface OCROptions {
  languages?: string[];
  minConfidence?: number;
}

export interface OCRResult {
  text: string;
  confidence: number;
  words?: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
  paragraphs?: string[];
}

const DEFAULT_LANGUAGES = ['eng', 'spa'];
const MIN_TEXT_LENGTH_THRESHOLD = 50;
const MIN_TEXT_RATIO_THRESHOLD = 0.01;

const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
];

export function isImageMimeType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase());
}

export function isScannedDocument(
  buffer: Buffer,
  mimeType: string,
  extractedText?: string
): boolean {
  if (isImageMimeType(mimeType)) {
    return true;
  }

  if (mimeType === 'application/pdf') {
    if (!extractedText || extractedText.trim().length === 0) {
      return true;
    }

    const cleanText = extractedText.replace(/\s+/g, ' ').trim();
    
    if (cleanText.length < MIN_TEXT_LENGTH_THRESHOLD) {
      return true;
    }

    const alphanumericRatio = (cleanText.match(/[a-zA-Z0-9]/g)?.length || 0) / cleanText.length;
    if (alphanumericRatio < MIN_TEXT_RATIO_THRESHOLD) {
      return true;
    }

    const wordCount = cleanText.split(/\s+/).filter(w => w.length > 1).length;
    if (wordCount < 10) {
      return true;
    }
  }

  return false;
}

export async function performOCR(
  buffer: Buffer,
  options: OCROptions = {}
): Promise<OCRResult> {
  const languages = options.languages || DEFAULT_LANGUAGES;
  const langString = languages.join('+');

  try {
    const result = await Tesseract.recognize(buffer, langString, {
      logger: (m) => {
        if (process.env.NODE_ENV === 'development' && m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round((m.progress || 0) * 100)}%`);
        }
      },
    });

    const data = result.data;
    
    const words = ((data as any).words || []).map((word: any) => ({
      text: word.text,
      confidence: word.confidence,
      bbox: word.bbox ? {
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      } : undefined,
    }));

    const paragraphs = ((data as any).paragraphs || []).map((p: any) => p.text);

    return {
      text: data.text || '',
      confidence: data.confidence || 0,
      words,
      paragraphs,
    };
  } catch (error) {
    console.error('OCR processing error:', error);
    throw new Error(`Failed to perform OCR: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function extractTextFromImage(
  buffer: Buffer,
  mimeType: string,
  options: OCROptions = {}
): Promise<OCRResult> {
  if (!isImageMimeType(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}. Supported types: ${SUPPORTED_IMAGE_TYPES.join(', ')}`);
  }

  return performOCR(buffer, options);
}

export async function extractTextWithOCRFallback(
  buffer: Buffer,
  mimeType: string,
  extractedText: string,
  options: OCROptions = {}
): Promise<{ text: string; usedOCR: boolean; confidence?: number }> {
  if (!isScannedDocument(buffer, mimeType, extractedText)) {
    return {
      text: extractedText,
      usedOCR: false,
    };
  }

  try {
    const ocrResult = await performOCR(buffer, options);
    
    if (ocrResult.text.trim().length > extractedText.trim().length) {
      return {
        text: ocrResult.text,
        usedOCR: true,
        confidence: ocrResult.confidence,
      };
    }

    return {
      text: extractedText || ocrResult.text,
      usedOCR: extractedText.trim().length === 0,
      confidence: ocrResult.confidence,
    };
  } catch (error) {
    console.error('OCR fallback failed:', error);
    return {
      text: extractedText,
      usedOCR: false,
    };
  }
}

export const ocrService = {
  isScannedDocument,
  performOCR,
  extractTextFromImage,
  extractTextWithOCRFallback,
  isImageMimeType,
  SUPPORTED_IMAGE_TYPES,
  DEFAULT_LANGUAGES,
};

export default ocrService;
