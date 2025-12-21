import { Math as DocxMath, MathRun } from "docx";

let latexToOmml: ((latex: string) => string) | null = null;

async function loadConverter(): Promise<void> {
  if (latexToOmml !== null) return;
  try {
    const converter = await import("@hungknguyen/docx-math-converter");
    latexToOmml = converter.latexToOmml || converter.default?.latexToOmml;
  } catch {
    latexToOmml = null;
  }
}

export async function createMathFromLatex(latex: string): Promise<DocxMath | null> {
  await loadConverter();
  
  if (latexToOmml) {
    try {
      const omml = latexToOmml(latex);
      if (omml) {
        return new DocxMath({
          children: [new MathRun(omml)],
        });
      }
    } catch (err) {
      console.warn("[latexMath] Failed to convert LaTeX to OMML:", err);
    }
  }
  
  return new DocxMath({
    children: [new MathRun(latex)],
  });
}

export function createMathPlaceholder(latex: string): DocxMath {
  return new DocxMath({
    children: [new MathRun(latex)],
  });
}
