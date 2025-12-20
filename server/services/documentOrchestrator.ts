import { geminiClient, GEMINI_MODELS } from "../lib/gemini";
import { validateExcelSpec, validateDocSpec } from "./documentValidators";
import { renderExcelFromSpec } from "./excelSpecRenderer";
import { renderWordFromSpec } from "./wordSpecRenderer";
import {
  ExcelSpec,
  DocSpec,
  excelSpecJsonSchema,
  docSpecJsonSchema,
} from "../../shared/documentSpecs";

const MAX_RETRIES = 3;

const EXCEL_SYSTEM_PROMPT = `You are a JSON generator that creates Excel workbook specifications.

You MUST respond with ONLY valid JSON that conforms to this schema:
${JSON.stringify(excelSpecJsonSchema, null, 2)}

Example valid response:
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
      ],
      "layout": {
        "auto_fit_columns": true,
        "show_gridlines": true
      }
    }
  ]
}

Rules:
- Sheet names must be 1-31 characters, no special characters: \\ / : * ? [ ]
- Cell references use A1 notation (e.g., "A1", "B2", "AA10")
- Each table row must have the same number of elements as headers
- Chart ranges must reference valid cells
- Respond with ONLY the JSON, no markdown, no explanations`;

const DOC_SYSTEM_PROMPT = `You are a JSON generator that creates Word document specifications.

You MUST respond with ONLY valid JSON that conforms to this schema:
${JSON.stringify(docSpecJsonSchema, null, 2)}

Example valid response:
{
  "title": "Quarterly Report",
  "author": "Analytics Team",
  "add_toc": true,
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "text": "Executive Summary"
    },
    {
      "type": "paragraph",
      "text": "This report covers the key metrics for Q4 2024."
    },
    {
      "type": "bullets",
      "items": [
        "Revenue increased by 15%",
        "Customer satisfaction at 92%",
        "New product launches on track"
      ]
    },
    {
      "type": "table",
      "columns": ["Metric", "Value", "Change"],
      "rows": [
        ["Revenue", "$1.2M", "+15%"],
        ["Users", "50,000", "+20%"]
      ],
      "style": "Light Shading"
    },
    {
      "type": "page_break"
    },
    {
      "type": "heading",
      "level": 2,
      "text": "Detailed Analysis"
    }
  ]
}

Block types:
- heading: level (1-6), text
- paragraph: text
- bullets: items (array of strings)
- table: columns, rows, style
- page_break: no additional properties

Rules:
- Each table row must have the same number of elements as columns
- Heading levels must be 1-6
- Bullets must have at least one item
- Respond with ONLY the JSON, no markdown, no explanations`;

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
): Promise<{ buffer: Buffer; spec: ExcelSpec }> {
  let lastErrors: string[] = [];
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Excel generation attempt ${attempt}/${MAX_RETRIES}`);

    let systemPrompt = EXCEL_SYSTEM_PROMPT;
    if (lastErrors.length > 0) {
      systemPrompt += `\n\nPREVIOUS ATTEMPT FAILED with these errors:\n${lastErrors.join("\n")}\n\nPlease fix these issues in your response.`;
    }

    const response = await callGeminiForSpec(systemPrompt, currentPrompt);
    const jsonStr = extractJsonFromResponse(response);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    const validation = validateExcelSpec(parsed);
    if (!validation.valid) {
      lastErrors = validation.errors;
      console.error(`[DocumentOrchestrator] Validation failed:`, validation.errors);
      continue;
    }

    const spec = parsed as ExcelSpec;
    const buffer = await renderExcelFromSpec(spec);

    console.log(`[DocumentOrchestrator] Excel generated successfully on attempt ${attempt}`);
    return { buffer, spec };
  }

  throw new Error(
    `Failed to generate valid Excel spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
}

export async function generateWordFromPrompt(
  prompt: string
): Promise<{ buffer: Buffer; spec: DocSpec }> {
  let lastErrors: string[] = [];
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Word generation attempt ${attempt}/${MAX_RETRIES}`);

    let systemPrompt = DOC_SYSTEM_PROMPT;
    if (lastErrors.length > 0) {
      systemPrompt += `\n\nPREVIOUS ATTEMPT FAILED with these errors:\n${lastErrors.join("\n")}\n\nPlease fix these issues in your response.`;
    }

    const response = await callGeminiForSpec(systemPrompt, currentPrompt);
    const jsonStr = extractJsonFromResponse(response);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    const validation = validateDocSpec(parsed);
    if (!validation.valid) {
      lastErrors = validation.errors;
      console.error(`[DocumentOrchestrator] Validation failed:`, validation.errors);
      continue;
    }

    const spec = parsed as DocSpec;
    const buffer = await renderWordFromSpec(spec);

    console.log(`[DocumentOrchestrator] Word generated successfully on attempt ${attempt}`);
    return { buffer, spec };
  }

  throw new Error(
    `Failed to generate valid Word spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
}
