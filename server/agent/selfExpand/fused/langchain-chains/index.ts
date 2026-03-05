// Auto-fused from LangChain concepts (https://github.com/langchain-ai/langchainjs.git)
// Strategy: port-concept — pure TS reimplementation of core chain patterns

// ── Prompt Templates ──

export interface PromptTemplate {
  template: string;
  inputVariables: string[];
}

export function createPrompt(template: string): PromptTemplate {
  const inputVariables = [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  return { template, inputVariables };
}

export function formatPrompt(prompt: PromptTemplate, values: Record<string, string>): string {
  let result = prompt.template;
  for (const variable of prompt.inputVariables) {
    const value = values[variable];
    if (value !== undefined) {
      result = result.split(`{${variable}}`).join(value);
    }
  }
  return result;
}

// ── Chain Steps ──

export interface ChainStep {
  name: string;
  prompt: PromptTemplate;
  /** Optional transform applied to the formatted prompt output */
  transform?: (input: string) => string;
  /** Optional output key — defaults to `${name}_output` */
  outputKey?: string;
}

export interface StepResult {
  name: string;
  input: Record<string, string>;
  output: string;
  durationMs: number;
}

export interface ChainResult {
  steps: StepResult[];
  finalOutput: string;
  totalDurationMs: number;
  variables: Record<string, string>;
}

// ── Sequential Chain ──

export async function executeChain(
  steps: ChainStep[],
  initialValues: Record<string, string>,
): Promise<ChainResult> {
  const start = Date.now();
  const results: StepResult[] = [];
  const variables = { ...initialValues };

  for (const step of steps) {
    const stepStart = Date.now();
    const formatted = formatPrompt(step.prompt, variables);
    const output = step.transform ? step.transform(formatted) : formatted;
    const outputKey = step.outputKey || `${step.name}_output`;

    results.push({
      name: step.name,
      input: { ...variables },
      output,
      durationMs: Date.now() - stepStart,
    });

    variables[outputKey] = output;
  }

  return {
    steps: results,
    finalOutput: results[results.length - 1]?.output || '',
    totalDurationMs: Date.now() - start,
    variables,
  };
}

// ── Parallel Chain ──

export async function executeParallelChain(
  steps: ChainStep[],
  initialValues: Record<string, string>,
): Promise<ChainResult> {
  const start = Date.now();
  const variables = { ...initialValues };

  const stepResults = await Promise.all(
    steps.map(async (step) => {
      const stepStart = Date.now();
      const formatted = formatPrompt(step.prompt, variables);
      const output = step.transform ? step.transform(formatted) : formatted;
      return {
        name: step.name,
        input: { ...variables },
        output,
        durationMs: Date.now() - stepStart,
        outputKey: step.outputKey || `${step.name}_output`,
      };
    }),
  );

  for (const r of stepResults) {
    variables[r.outputKey] = r.output;
  }

  return {
    steps: stepResults.map(({ outputKey, ...rest }) => rest),
    finalOutput: stepResults[stepResults.length - 1]?.output || '',
    totalDurationMs: Date.now() - start,
    variables,
  };
}

// ── Map-Reduce Chain ──

export async function mapReduceChain(
  items: string[],
  mapPrompt: PromptTemplate,
  reducePrompt: PromptTemplate,
  itemKey = 'item',
  resultsKey = 'mapped_results',
): Promise<ChainResult> {
  const start = Date.now();
  const results: StepResult[] = [];

  // Map phase: apply mapPrompt to each item
  const mapped: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const stepStart = Date.now();
    const output = formatPrompt(mapPrompt, { [itemKey]: items[i], index: String(i) });
    mapped.push(output);
    results.push({
      name: `map_${i}`,
      input: { [itemKey]: items[i] },
      output,
      durationMs: Date.now() - stepStart,
    });
  }

  // Reduce phase: combine all mapped results
  const reduceStart = Date.now();
  const combined = mapped.join('\n---\n');
  const finalOutput = formatPrompt(reducePrompt, { [resultsKey]: combined });
  results.push({
    name: 'reduce',
    input: { [resultsKey]: combined },
    output: finalOutput,
    durationMs: Date.now() - reduceStart,
  });

  return {
    steps: results,
    finalOutput,
    totalDurationMs: Date.now() - start,
    variables: { [resultsKey]: combined },
  };
}

// ── Utility: Compose transforms ──

export function composeTransforms(...fns: Array<(s: string) => string>): (s: string) => string {
  return (input: string) => fns.reduce((acc, fn) => fn(acc), input);
}

// ── Built-in Transforms ──

export const transforms = {
  uppercase: (s: string) => s.toUpperCase(),
  lowercase: (s: string) => s.toLowerCase(),
  trim: (s: string) => s.trim(),
  stripHtml: (s: string) => s.replace(/<[^>]*>/g, ''),
  extractFirstLine: (s: string) => s.split('\n')[0] || '',
  wordCount: (s: string) => `Word count: ${s.split(/\s+/).filter(Boolean).length}`,
  sentenceCount: (s: string) => `Sentence count: ${s.split(/[.!?]+/).filter(Boolean).length}`,
  truncate: (maxLen: number) => (s: string) => s.length > maxLen ? s.slice(0, maxLen) + '...' : s,
} as const;
