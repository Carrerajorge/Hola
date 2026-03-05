// server/agent/orchestrator/geminiCodeGen.ts
// ---------------------------------------------------------------------------
// Gemini-powered code generation for the SuperPlanner executor.
// Returns structured JSON with files array, dependencies, and instructions.
// ---------------------------------------------------------------------------

import { getGeminiClient, GEMINI_MODELS } from "../../lib/gemini";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeGenFile {
  path: string;
  content: string;
  language?: string;
}

export interface CodeGenInput {
  description: string;
  language?: string;
  framework?: string;
  context?: string;
  existingFiles?: Array<{ path: string; content: string }>;
}

export interface CodeGenOutput {
  files: CodeGenFile[];
  dependencies: string[];
  instructions: string;
}

// ---------------------------------------------------------------------------
// System prompt for code generation
// ---------------------------------------------------------------------------

const CODE_GEN_SYSTEM = `You are an expert software engineer generating production-ready code.

RULES:
1. Return ONLY valid JSON matching this schema:
{
  "files": [
    { "path": "relative/path/to/file.ext", "content": "full file content", "language": "typescript" }
  ],
  "dependencies": ["package-name@^version"],
  "instructions": "brief setup/run instructions"
}
2. Generate COMPLETE, working code — no placeholders, no TODOs, no "implement here"
3. Follow framework conventions and best practices
4. Include proper error handling
5. Use modern syntax (ES modules, async/await, TypeScript where appropriate)
6. Files must have correct relative paths for a coherent project structure
7. Include only necessary dependencies — no bloat`;

// ---------------------------------------------------------------------------
// geminiCodeGen — main entry point
// ---------------------------------------------------------------------------

export async function geminiCodeGen(input: CodeGenInput): Promise<CodeGenOutput> {
  const client = getGeminiClient();
  if (!client) {
    return fallbackCodeGen(input);
  }

  let prompt = `Generate code for: ${input.description}`;
  if (input.language) prompt += `\nLanguage: ${input.language}`;
  if (input.framework) prompt += `\nFramework: ${input.framework}`;
  if (input.context) prompt += `\nContext: ${input.context}`;

  if (input.existingFiles && input.existingFiles.length > 0) {
    prompt += "\n\nEXISTING FILES (build on top of these):";
    for (const f of input.existingFiles) {
      const preview = f.content.length > 500 ? f.content.slice(0, 500) + "..." : f.content;
      prompt += `\n--- ${f.path} ---\n${preview}`;
    }
  }

  try {
    const result = await client.models.generateContent({
      model: GEMINI_MODELS.FLASH,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: CODE_GEN_SYSTEM,
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });

    const text = result.text ?? "";
    const parsed = JSON.parse(text) as CodeGenOutput;

    // Validate
    if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
      return fallbackCodeGen(input);
    }

    parsed.dependencies = parsed.dependencies || [];
    parsed.instructions = parsed.instructions || "";

    return parsed;
  } catch (err: any) {
    console.error("[GeminiCodeGen] Generation failed:", err?.message);
    return fallbackCodeGen(input);
  }
}

// ---------------------------------------------------------------------------
// Fallback — deterministic skeleton when Gemini is unavailable
// ---------------------------------------------------------------------------

function fallbackCodeGen(input: CodeGenInput): CodeGenOutput {
  const ext = input.language === "python" ? "py" : "ts";
  const filename = `generated.${ext}`;

  return {
    files: [
      {
        path: filename,
        content: `// Generated code for: ${input.description}\n// Framework: ${input.framework || "none"}\n// TODO: Gemini API unavailable — manual implementation needed\n`,
        language: input.language || "typescript",
      },
    ],
    dependencies: [],
    instructions: `Gemini API unavailable. Skeleton generated for: ${input.description}`,
  };
}
