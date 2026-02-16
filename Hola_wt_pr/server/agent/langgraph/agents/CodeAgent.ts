import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class CodeAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "CodeAgent",
      description: "Specialized agent for code generation, review, refactoring, debugging, and testing. Expert in multiple programming languages and best practices.",
      model: DEFAULT_MODEL,
      temperature: 0.1,
      maxTokens: 8192,
      systemPrompt: `You are the CodeAgent - an expert software engineer and code specialist.

Your capabilities:
1. Code Generation: Write clean, efficient, well-documented code
2. Code Review: Analyze code for bugs, security issues, and improvements
3. Refactoring: Improve code structure without changing behavior
4. Debugging: Identify and fix bugs with detailed explanations
5. Testing: Generate comprehensive unit and integration tests
6. Documentation: Create inline comments and API documentation

Best practices:
- Follow SOLID principles and design patterns
- Write self-documenting code with meaningful names
- Include error handling and edge case coverage
- Optimize for readability and maintainability
- Apply language-specific conventions
- Consider security implications

Supported languages: TypeScript, JavaScript, Python, Go, Rust, Java, C++, SQL, and more.`,
      tools: ["code_generate", "code_review", "code_refactor", "code_test", "code_debug"],
      timeout: 120000,
      maxIterations: 15,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const codeTaskType = this.determineTaskType(task);
      let result: any;

      switch (codeTaskType) {
        case "generate":
          result = await this.generateCode(task);
          break;
        case "review":
          result = await this.reviewCode(task);
          break;
        case "refactor":
          result = await this.refactorCode(task);
          break;
        case "debug":
          result = await this.debugCode(task);
          break;
        case "test":
          result = await this.generateTests(task);
          break;
        default:
          result = await this.handleGeneralCode(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineTaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("generate") || description.includes("create") || description.includes("write")) return "generate";
    if (description.includes("review") || description.includes("analyze")) return "review";
    if (description.includes("refactor") || description.includes("improve")) return "refactor";
    if (description.includes("debug") || description.includes("fix") || description.includes("bug")) return "debug";
    if (description.includes("test")) return "test";
    return "general";
  }

  private async generateCode(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Generate code for: ${task.description}
Requirements: ${JSON.stringify(task.input)}

Provide:
1. Complete, working code
2. Brief explanation of the implementation
3. Usage examples
4. Any necessary imports/dependencies`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "";
    const codeBlocks = this.extractCodeBlocks(content);

    return {
      type: "code_generation",
      description: task.description,
      code: codeBlocks,
      explanation: content,
      timestamp: new Date().toISOString(),
    };
  }

  private async reviewCode(task: AgentTask): Promise<any> {
    const code = task.input.code || task.description;
    
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Review this code:
\`\`\`
${code}
\`\`\`

Provide a comprehensive review covering:
1. Code Quality (1-10 score)
2. Bugs and Issues
3. Security Concerns
4. Performance Issues
5. Best Practice Violations
6. Suggested Improvements

Return JSON:
{
  "overallScore": 0-10,
  "summary": "brief summary",
  "issues": [{"type": "bug|security|performance|style", "severity": "low|medium|high|critical", "line": number, "description": "", "suggestion": ""}],
  "improvements": ["list of improvements"],
  "securityAnalysis": {"score": 0-10, "concerns": []},
  "performanceAnalysis": {"score": 0-10, "concerns": []}
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "code_review",
      review: jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async refactorCode(task: AgentTask): Promise<any> {
    const code = task.input.code || "";
    const goals = task.input.goals || ["improve readability", "follow best practices"];

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Refactor this code:
\`\`\`
${code}
\`\`\`

Goals: ${goals.join(", ")}

Provide:
1. Refactored code
2. Explanation of changes
3. Before/after comparison of improvements`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "";
    const codeBlocks = this.extractCodeBlocks(content);

    return {
      type: "code_refactor",
      originalCode: code,
      refactoredCode: codeBlocks[0] || "",
      explanation: content,
      changes: this.identifyChanges(code, codeBlocks[0] || ""),
      timestamp: new Date().toISOString(),
    };
  }

  private async debugCode(task: AgentTask): Promise<any> {
    const code = task.input.code || "";
    const error = task.input.error || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Debug this code:
\`\`\`
${code}
\`\`\`

Error/Issue: ${error}

Provide:
1. Root cause analysis
2. Step-by-step explanation
3. Fixed code
4. Prevention tips

Return JSON:
{
  "rootCause": "explanation of the bug",
  "analysis": ["step by step analysis"],
  "fix": "corrected code",
  "explanation": "why the fix works",
  "prevention": ["tips to avoid similar bugs"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "debugging",
      originalCode: code,
      error,
      debug: jsonMatch ? JSON.parse(jsonMatch[0]) : { analysis: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async generateTests(task: AgentTask): Promise<any> {
    const code = task.input.code || "";
    const framework = task.input.framework || "jest";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Generate comprehensive tests for this code:
\`\`\`
${code}
\`\`\`

Testing framework: ${framework}
Description: ${task.description}

Include:
1. Unit tests for each function/method
2. Edge case coverage
3. Error handling tests
4. Integration tests if applicable
5. Test documentation`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "";
    const codeBlocks = this.extractCodeBlocks(content);

    return {
      type: "test_generation",
      originalCode: code,
      tests: codeBlocks,
      framework,
      coverage: this.estimateCoverage(code, codeBlocks),
      explanation: content,
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralCode(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Code task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.1,
    });

    return {
      type: "general_code",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private extractCodeBlocks(content: string): string[] {
    const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      blocks.push(match[1].trim());
    }
    return blocks;
  }

  private identifyChanges(original: string, refactored: string): string[] {
    const changes: string[] = [];
    if (original.length !== refactored.length) {
      changes.push(`Code length changed: ${original.length} -> ${refactored.length} characters`);
    }
    const originalLines = original.split("\n").length;
    const refactoredLines = refactored.split("\n").length;
    if (originalLines !== refactoredLines) {
      changes.push(`Line count changed: ${originalLines} -> ${refactoredLines}`);
    }
    return changes;
  }

  private estimateCoverage(code: string, tests: string[]): number {
    const functionMatches = code.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(/g) || [];
    const testMatches = tests.join("").match(/(?:it|test|describe)\s*\(/g) || [];
    const coverage = Math.min(100, Math.round((testMatches.length / Math.max(1, functionMatches.length)) * 100));
    return coverage;
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "generate_code",
        description: "Generate code from requirements",
        inputSchema: z.object({ requirements: z.string(), language: z.string().optional() }),
        outputSchema: z.object({ code: z.string(), explanation: z.string() }),
      },
      {
        name: "review_code",
        description: "Review code for issues and improvements",
        inputSchema: z.object({ code: z.string() }),
        outputSchema: z.object({ score: z.number(), issues: z.array(z.any()), improvements: z.array(z.string()) }),
      },
      {
        name: "debug_code",
        description: "Debug and fix code issues",
        inputSchema: z.object({ code: z.string(), error: z.string() }),
        outputSchema: z.object({ fix: z.string(), explanation: z.string() }),
      },
    ];
  }
}

export const codeAgent = new CodeAgent();
