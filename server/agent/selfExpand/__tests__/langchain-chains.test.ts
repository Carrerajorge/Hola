import { describe, it, expect } from "vitest";
import {
  createPrompt,
  formatPrompt,
  executeChain,
  executeParallelChain,
  mapReduceChain,
  transforms,
  composeTransforms,
} from "../fused/langchain-chains/index";

describe("langchain-chains fused module", () => {
  it("creates a prompt template and extracts variables", () => {
    const prompt = createPrompt("Hello {name}, welcome to {place}!");
    expect(prompt.inputVariables).toEqual(["name", "place"]);
  });

  it("formats a prompt with values", () => {
    const prompt = createPrompt("Translate '{text}' to {language}");
    const result = formatPrompt(prompt, { text: "Hello", language: "Spanish" });
    expect(result).toBe("Translate 'Hello' to Spanish");
  });

  it("executes a sequential chain passing outputs between steps", async () => {
    const chain = await executeChain(
      [
        {
          name: "greet",
          prompt: createPrompt("Hello {name}!"),
        },
        {
          name: "enhance",
          prompt: createPrompt("Enhanced: {greet_output}"),
          transform: transforms.uppercase,
        },
      ],
      { name: "World" },
    );

    expect(chain.steps).toHaveLength(2);
    expect(chain.steps[0].output).toBe("Hello World!");
    expect(chain.steps[1].output).toBe("ENHANCED: HELLO WORLD!");
    expect(chain.finalOutput).toBe("ENHANCED: HELLO WORLD!");
    expect(chain.variables.greet_output).toBe("Hello World!");
    expect(chain.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("executes a parallel chain", async () => {
    const result = await executeParallelChain(
      [
        { name: "title", prompt: createPrompt("Title: {topic}"), transform: transforms.uppercase },
        { name: "body", prompt: createPrompt("Body about {topic}"), transform: transforms.lowercase },
      ],
      { topic: "AI" },
    );

    expect(result.steps).toHaveLength(2);
    expect(result.variables.title_output).toBe("TITLE: AI");
    expect(result.variables.body_output).toBe("body about ai");
  });

  it("executes a map-reduce chain", async () => {
    const result = await mapReduceChain(
      ["apple", "banana", "cherry"],
      createPrompt("Fruit: {item} (#{index})"),
      createPrompt("All fruits:\n{mapped_results}"),
    );

    expect(result.steps).toHaveLength(4); // 3 map + 1 reduce
    expect(result.finalOutput).toContain("apple");
    expect(result.finalOutput).toContain("banana");
    expect(result.finalOutput).toContain("cherry");
  });

  it("composes transforms", () => {
    const transform = composeTransforms(transforms.trim, transforms.uppercase);
    expect(transform("  hello  ")).toBe("HELLO");
  });

  it("truncate transform works", () => {
    const shorten = transforms.truncate(5);
    expect(shorten("Hello World")).toBe("Hello...");
    expect(shorten("Hi")).toBe("Hi");
  });
});
