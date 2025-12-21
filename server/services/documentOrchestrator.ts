import { geminiClient, GEMINI_MODELS } from "../lib/gemini";
import { 
  validateExcelSpec, 
  validateDocSpec,
  validateGeneratedExcelBuffer,
  validateGeneratedWordBuffer,
  type PostRenderValidationResult,
} from "./documentValidators";
import {
  validateExcelSpec as qualityGateExcelSpec,
  validateDocSpec as qualityGateDocSpec,
  type QualityReport,
} from "./documentQualityGates";
import { renderExcelFromSpec } from "./excelSpecRenderer";
import { renderWordFromSpec } from "./wordSpecRenderer";
import {
  ExcelSpec,
  DocSpec,
  excelSpecJsonSchema,
  docSpecJsonSchema,
} from "../../shared/documentSpecs";

const MAX_RETRIES = 3;

const REPAIR_SYSTEM_PROMPT = `You are a JSON repair specialist. Fix validation errors in the provided JSON.

CRITICAL INSTRUCTIONS:
- Analyze each validation error carefully
- Fix ONLY the specific issues mentioned
- Preserve all valid parts unchanged
- Return ONLY valid JSON, no markdown, no explanations`;

export interface RepairLoopResult<T> {
  ok: boolean;
  iterations: number;
  errors: string[];
  finalSpec: T | null;
}

export interface GenerationResult<T> {
  buffer: Buffer;
  spec: T;
  qualityReport: QualityReport;
  postRenderValidation: PostRenderValidationResult;
  attemptsUsed: number;
  repairLoop: RepairLoopResult<T>;
}

function buildRepairPrompt(
  originalPrompt: string,
  lastBadJson: string,
  errors: string[],
  schemaContext: string,
  docType: "excel" | "word"
): string {
  const specificRules = docType === "excel"
    ? `EXCEL-SPECIFIC REPAIR RULES:
- Range format must be A1:B10 (start:end), not A1-B10
- Each table row array length MUST equal headers array length
- Chart ranges (categories_range, values_range) must match table data extent
- Anchor cell uses A1 notation (column letters + row number)`
    : `WORD-SPECIFIC REPAIR RULES:
- blocks is an array of objects with "type" field
- Valid block types: heading, paragraph, bullets, numbered, table, title, toc, page_break
- Each table row array length MUST equal columns array length
- Heading level must be 1-6`;

  return `${schemaContext}

${specificRules}

=== REPAIR REQUEST ===

ORIGINAL USER REQUEST:
${originalPrompt}

YOUR PREVIOUS (INVALID) RESPONSE:
\`\`\`json
${lastBadJson}
\`\`\`

VALIDATION ERRORS (fix each one):
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

REQUIRED ACTIONS:
1. Fix each validation error listed above
2. Preserve all valid content unchanged
3. Return ONLY the corrected JSON, no markdown, no explanations

Respond with the fixed JSON now:`;
}

const EXCEL_SYSTEM_PROMPT = `You are a JSON generator that creates Excel workbook specifications.

CRITICAL VALIDATION RULES (MUST FOLLOW):
1. Each table row array length MUST equal headers array length exactly
2. Chart ranges must use A1:B10 format (start:end) NOT A1-B10
3. Range consistency: categories_range and values_range must reference cells within table data extent
   - If table anchor is A1 with 3 headers and 5 rows, data is A2:C6 (row 2-6 for data, columns A-C)
4. Sheet names: 1-31 chars, no special characters: \\ / : * ? [ ]

You MUST respond with ONLY valid JSON that conforms to this schema:
${JSON.stringify(excelSpecJsonSchema, null, 2)}

Example valid response (note how ranges match data):
{
  "workbook_title": "Sales Report",
  "sheets": [
    {
      "name": "Data",
      "tables": [
        {
          "anchor": "A1",
          "headers": ["Product", "Sales", "Revenue"],
          "rows": [
            ["Widget A", 100, 5000],
            ["Widget B", 150, 7500]
          ],
          "table_style": "TableStyleMedium9",
          "autofilter": true,
          "freeze_header": true
        }
      ],
      "charts": [
        {
          "type": "bar",
          "title": "Sales by Product",
          "categories_range": "A2:A3",
          "values_range": "B2:B3",
          "position": "E2"
        }
      ]
    }
  ]
}

Respond with ONLY the JSON, no markdown, no explanations.`;

const DOC_SYSTEM_PROMPT = `You are a JSON generator that creates Word document specifications.

CRITICAL VALIDATION RULES (MUST FOLLOW):
1. blocks is an array of objects, each with a "type" field
2. Valid block types: heading, paragraph, bullets, numbered, table, title, toc, page_break
3. Each table row array length MUST equal columns array length exactly
4. Heading level must be integer 1-6
5. bullets and numbered blocks require non-empty "items" array

You MUST respond with ONLY valid JSON that conforms to this schema:
${JSON.stringify(docSpecJsonSchema, null, 2)}

Example valid response (note matching row/column counts):
{
  "title": "Quarterly Report",
  "author": "Analytics Team",
  "blocks": [
    { "type": "title", "text": "Quarterly Report" },
    { "type": "toc", "max_level": 3 },
    { "type": "heading", "level": 1, "text": "Executive Summary" },
    { "type": "paragraph", "text": "This report covers key metrics for Q4 2024." },
    { "type": "bullets", "items": ["Revenue +15%", "Satisfaction 92%"] },
    { "type": "numbered", "items": ["First item", "Second item"] },
    {
      "type": "table",
      "columns": ["Metric", "Value", "Change"],
      "rows": [
        ["Revenue", "$1.2M", "+15%"],
        ["Users", "50,000", "+20%"]
      ],
      "style": "Light Shading"
    },
    { "type": "page_break" },
    { "type": "heading", "level": 2, "text": "Detailed Analysis" }
  ]
}

Respond with ONLY the JSON, no markdown, no explanations.`;

export async function callGeminiForSpec(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const result = await geminiClient.models.generateContent({
    model: GEMINI_MODELS.FLASH,
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  });

  return result.text ?? "";
}

function extractJsonFromResponse(response: string): string {
  let cleaned = response.trim();
  
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  
  return cleaned.trim();
}

export async function generateExcelFromPrompt(
  prompt: string
): Promise<GenerationResult<ExcelSpec>> {
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  let lastQualityReport: QualityReport | null = null;
  const allAttemptErrors: string[][] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Excel generation attempt ${attempt}/${MAX_RETRIES}`);

    let systemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      systemPrompt = EXCEL_SYSTEM_PROMPT;
      userPrompt = prompt;
    } else {
      systemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(excelSpecJsonSchema, null, 2)}`,
        "excel"
      );
      console.log(`[DocumentOrchestrator] Retry with ${lastErrors.length} error(s) to fix`);
    }

    const response = await callGeminiForSpec(systemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    // Basic schema validation
    const schemaValidation = validateExcelSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as ExcelSpec;

    // Run quality gate validation (DoS protection, limits, best practices)
    const qualityReport = qualityGateExcelSpec(spec);
    lastQualityReport = qualityReport;
    
    if (!qualityReport.valid) {
      const errorMessages = qualityReport.errors.map(e => `[${e.code}] ${e.message} at ${e.path}`);
      lastErrors = errorMessages;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Quality gate failed:`, errorMessages);
      continue;
    }

    // Log warnings but continue
    if (qualityReport.warnings.length > 0) {
      console.warn(`[DocumentOrchestrator] Quality warnings:`, qualityReport.warnings);
    }
    
    try {
      const buffer = await renderExcelFromSpec(spec);
      
      // Post-render validation - verify the generated buffer is valid
      const postRenderValidation = await validateGeneratedExcelBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] Excel generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid Excel spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<ExcelSpec>;
  throw error;
}

export async function generateWordFromPrompt(
  prompt: string
): Promise<GenerationResult<DocSpec>> {
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  let lastQualityReport: QualityReport | null = null;
  const allAttemptErrors: string[][] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Word generation attempt ${attempt}/${MAX_RETRIES}`);

    let systemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      systemPrompt = DOC_SYSTEM_PROMPT;
      userPrompt = prompt;
    } else {
      systemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(docSpecJsonSchema, null, 2)}`,
        "word"
      );
      console.log(`[DocumentOrchestrator] Retry with ${lastErrors.length} error(s) to fix`);
    }

    const response = await callGeminiForSpec(systemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    // Basic schema validation
    const schemaValidation = validateDocSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as DocSpec;

    // Run quality gate validation (DoS protection, limits, best practices)
    const qualityReport = qualityGateDocSpec(spec);
    lastQualityReport = qualityReport;
    
    if (!qualityReport.valid) {
      const errorMessages = qualityReport.errors.map(e => `[${e.code}] ${e.message} at ${e.path}`);
      lastErrors = errorMessages;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Quality gate failed:`, errorMessages);
      continue;
    }

    // Log warnings but continue
    if (qualityReport.warnings.length > 0) {
      console.warn(`[DocumentOrchestrator] Quality warnings:`, qualityReport.warnings);
    }
    
    try {
      const buffer = await renderWordFromSpec(spec);
      
      // Post-render validation - verify the generated buffer is valid
      const postRenderValidation = await validateGeneratedWordBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] Word generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid Word spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<DocSpec>;
  throw error;
}
