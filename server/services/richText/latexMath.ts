import { Math as DocxMath } from "docx";

type MathElement = ReturnType<typeof import("@hungknguyen/docx-math-converter").convertLatex2Math>;

let convertLatex2Math: ((latex: string) => MathElement) | null = null;
let mathJaxReady: (() => Promise<boolean>) | null = null;
let converterInitialized = false;

async function loadConverter(): Promise<void> {
  if (converterInitialized) return;
  converterInitialized = true;
  
  try {
    const converter = await import("@hungknguyen/docx-math-converter");
    convertLatex2Math = converter.convertLatex2Math;
    mathJaxReady = converter.mathJaxReady;
    
    if (mathJaxReady) {
      await mathJaxReady();
      console.log("[latexMath] MathJax initialized successfully");
    }
  } catch (err) {
    console.warn("[latexMath] Failed to load converter:", err);
    convertLatex2Math = null;
    mathJaxReady = null;
  }
}

export async function createMathFromLatex(latex: string): Promise<DocxMath | null> {
  await loadConverter();
  
  if (convertLatex2Math) {
    try {
      const mathElement = convertLatex2Math(latex);
      if (mathElement) {
        return mathElement as unknown as DocxMath;
      }
    } catch (err) {
      console.warn("[latexMath] Failed to convert LaTeX:", latex, err);
    }
  }
  
  return null;
}

export async function createMathPlaceholder(latex: string): Promise<DocxMath | null> {
  return createMathFromLatex(latex);
}
