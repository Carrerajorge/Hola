import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class QAAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "QAAgent",
      description: "Specialized agent for quality assurance, testing, validation, and verification. Expert at identifying issues and ensuring quality standards.",
      model: DEFAULT_MODEL,
      temperature: 0.1,
      maxTokens: 8192,
      systemPrompt: `You are the QAAgent - an expert quality assurance engineer.

Your capabilities:
1. Test Case Generation: Create comprehensive test cases from requirements
2. Test Execution: Plan and execute testing strategies
3. Bug Identification: Find defects and edge cases
4. Validation: Verify outputs against specifications
5. Performance Testing: Identify bottlenecks and issues
6. Accessibility Testing: Ensure WCAG compliance

Testing methodology:
- Requirements-based testing
- Boundary value analysis
- Equivalence partitioning
- Error guessing
- Exploratory testing
- Regression testing

Quality metrics:
- Code coverage
- Defect density
- Test pass rate
- Performance benchmarks
- Accessibility scores

Output formats:
- Test cases in structured format
- Bug reports with reproduction steps
- Test execution reports
- Quality dashboards`,
      tools: ["code_test", "code_review", "verify", "health_check"],
      timeout: 180000,
      maxIterations: 25,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const qaTaskType = this.determineQATaskType(task);
      let result: any;

      switch (qaTaskType) {
        case "generate_tests":
          result = await this.generateTestCases(task);
          break;
        case "validate":
          result = await this.validateOutput(task);
          break;
        case "bug_hunt":
          result = await this.huntBugs(task);
          break;
        case "performance":
          result = await this.performanceTest(task);
          break;
        case "accessibility":
          result = await this.accessibilityTest(task);
          break;
        default:
          result = await this.handleGeneralQA(task);
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

  private determineQATaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("test case") || description.includes("generate test")) return "generate_tests";
    if (description.includes("validate") || description.includes("verify")) return "validate";
    if (description.includes("bug") || description.includes("defect") || description.includes("issue")) return "bug_hunt";
    if (description.includes("performance") || description.includes("load") || description.includes("stress")) return "performance";
    if (description.includes("accessibility") || description.includes("a11y") || description.includes("wcag")) return "accessibility";
    return "general";
  }

  private async generateTestCases(task: AgentTask): Promise<any> {
    const requirements = task.input.requirements || task.description;
    const testType = task.input.testType || "functional";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Generate ${testType} test cases for:
${requirements}

Additional context: ${JSON.stringify(task.input)}

Return JSON:
{
  "testSuite": {
    "name": "test suite name",
    "description": "what is being tested",
    "testCases": [
      {
        "id": "TC001",
        "name": "test case name",
        "description": "what is tested",
        "preconditions": ["setup required"],
        "steps": [{"step": 1, "action": "", "expectedResult": ""}],
        "priority": "high|medium|low",
        "type": "positive|negative|edge"
      }
    ]
  },
  "coverage": {
    "requirements": ["covered requirements"],
    "gaps": ["areas not covered"]
  },
  "estimatedDuration": "time to execute all tests"
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "test_generation",
      testCases: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async validateOutput(task: AgentTask): Promise<any> {
    const actual = task.input.actual || "";
    const expected = task.input.expected || "";
    const criteria = task.input.criteria || [];

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Validate output against specification:
Actual: ${JSON.stringify(actual)}
Expected: ${JSON.stringify(expected)}
Criteria: ${JSON.stringify(criteria)}
Task: ${task.description}

Return JSON:
{
  "valid": boolean,
  "score": 0-100,
  "checks": [
    {"criterion": "", "passed": boolean, "details": "", "severity": "low|medium|high"}
  ],
  "discrepancies": ["list of differences"],
  "recommendations": ["suggestions for improvement"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "validation",
      validation: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async huntBugs(task: AgentTask): Promise<any> {
    const code = task.input.code || "";
    const context = task.input.context || "";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Find bugs and issues in:
\`\`\`
${code}
\`\`\`

Context: ${context}
Task: ${task.description}

Return JSON:
{
  "bugs": [
    {
      "id": "BUG001",
      "severity": "critical|high|medium|low",
      "type": "logic|security|performance|ux",
      "location": "file:line",
      "description": "what's wrong",
      "reproductionSteps": ["how to reproduce"],
      "suggestedFix": "how to fix",
      "confidence": 0-100
    }
  ],
  "codeSmells": ["potential issues"],
  "edgeCases": ["unhandled scenarios"],
  "overallRisk": "low|medium|high"
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "bug_hunting",
      findings: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async performanceTest(task: AgentTask): Promise<any> {
    const target = task.input.target || "";
    const metrics = task.input.metrics || ["response_time", "throughput", "memory"];

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create performance test plan for:
Target: ${target}
Metrics: ${JSON.stringify(metrics)}
Task: ${task.description}

Return JSON:
{
  "testPlan": {
    "scenarios": [
      {
        "name": "scenario name",
        "load": "concurrent users/requests",
        "duration": "test duration",
        "rampUp": "ramp up time"
      }
    ],
    "metrics": ["metrics to measure"],
    "thresholds": {"response_time": "< 200ms", "error_rate": "< 1%"}
  },
  "tools": ["recommended tools"],
  "code": {
    "k6": "k6 script",
    "artillery": "artillery config"
  }
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "performance_testing",
      testPlan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async accessibilityTest(task: AgentTask): Promise<any> {
    const target = task.input.target || task.description;
    const standard = task.input.standard || "WCAG 2.1 AA";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create accessibility test checklist for:
Target: ${target}
Standard: ${standard}
Task: ${task.description}

Return JSON:
{
  "checklist": [
    {
      "criterion": "WCAG criterion",
      "level": "A|AA|AAA",
      "category": "perceivable|operable|understandable|robust",
      "testMethod": "how to test",
      "automatable": boolean
    }
  ],
  "tools": ["recommended a11y tools"],
  "commonIssues": ["likely accessibility issues to check"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "accessibility_testing",
      checklist: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralQA(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `QA task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.1,
    });

    return {
      type: "general_qa",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "generate_tests",
        description: "Generate test cases from requirements",
        inputSchema: z.object({ requirements: z.string(), testType: z.string().optional() }),
        outputSchema: z.object({ testCases: z.array(z.any()), coverage: z.any() }),
      },
      {
        name: "validate",
        description: "Validate output against specifications",
        inputSchema: z.object({ actual: z.any(), expected: z.any() }),
        outputSchema: z.object({ valid: z.boolean(), discrepancies: z.array(z.string()) }),
      },
      {
        name: "find_bugs",
        description: "Identify bugs and issues in code",
        inputSchema: z.object({ code: z.string() }),
        outputSchema: z.object({ bugs: z.array(z.any()) }),
      },
    ];
  }
}

export const qaAgent = new QAAgent();
