import { describe, expect, it } from "vitest";
import { enrichToolExecutionInput } from "../toolExecutionInput";

describe("enrichToolExecutionInput", () => {
  it("attaches successful prior results for fetch_url when the planner omitted url", () => {
    const enriched = enrichToolExecutionInput(
      "fetch_url",
      {},
      [
        {
          stepIndex: 0,
          toolName: "web_search",
          success: true,
          output: {
            results: [{ title: "Example", url: "https://example.com/article" }],
          },
        },
      ],
    );

    expect((enriched._dependencyResults as any)?.step_1?.output?.results?.[0]?.url).toBe(
      "https://example.com/article",
    );
    expect((enriched._completedResults as any)?.step_1?.output?.results?.[0]?.url).toBe(
      "https://example.com/article",
    );
    expect((enriched.previousResults as any)?.[0]?.toolName).toBe("web_search");
  });

  it("does not overwrite an explicit fetch_url target", () => {
    const enriched = enrichToolExecutionInput(
      "fetch_url",
      { url: "https://iliagpt.com/docs" },
      [
        {
          stepIndex: 0,
          toolName: "web_search",
          success: true,
          output: {
            results: [{ title: "Example", url: "https://example.com/article" }],
          },
        },
      ],
    );

    expect(enriched).toEqual({ url: "https://iliagpt.com/docs" });
  });

  it("attaches successful prior results for summarize when the planner omitted input", () => {
    const enriched = enrichToolExecutionInput(
      "summarize",
      {},
      [
        {
          stepIndex: 1,
          toolName: "fetch_url",
          success: true,
          output: {
            title: "Example",
            textContent: "OpenAI published a post about better tool use.",
          },
        },
      ],
    );

    expect((enriched._dependencyResults as any)?.step_2?.output?.textContent).toBe(
      "OpenAI published a post about better tool use.",
    );
    expect((enriched.previousResults as any)?.[0]?.toolName).toBe("fetch_url");
  });

  it("does not overwrite an explicit summarize input", () => {
    const enriched = enrichToolExecutionInput(
      "summarize",
      { input: "Use this exact text" },
      [
        {
          stepIndex: 1,
          toolName: "fetch_url",
          success: true,
          output: {
            textContent: "This should not replace the explicit input.",
          },
        },
      ],
    );

    expect(enriched).toEqual({ input: "Use this exact text" });
  });
});
