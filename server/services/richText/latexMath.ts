import { Math as DocxMath, MathRun } from "docx";

export async function createMathFromLatex(latex: string): Promise<DocxMath | null> {
  try {
    return new DocxMath({
      children: [
        new MathRun(latex)
      ]
    });
  } catch (err) {
    console.warn("[latexMath] Failed to create math element:", latex, err);
    return null;
  }
}

export async function createMathPlaceholder(latex: string): Promise<DocxMath | null> {
  return createMathFromLatex(latex);
}
