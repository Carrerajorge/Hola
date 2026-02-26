import { describe, it, expect } from "vitest";
import {
  executeFlow,
  FlowBuilder,
  type FlowGraph,
} from "../fused/flowise-nodes/index";

describe("flowise-nodes fused module", () => {
  it("executes a simple source → transform → output flow", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "src", type: "source", config: { key: "text" } },
        { id: "upper", type: "transform", config: { operation: "uppercase" } },
        { id: "out", type: "output", config: {} },
      ],
      edges: [
        { from: "src", to: "upper" },
        { from: "upper", to: "out" },
      ],
    };

    const result = await executeFlow(graph, { text: "hello world" });
    expect(result.finalOutput).toBe("HELLO WORLD");
    expect(result.metadata.nodesExecuted).toBe(3);
  });

  it("merges multiple sources with object strategy", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "name", type: "source", config: { key: "name" } },
        { id: "age", type: "source", config: { key: "age" } },
        { id: "merge", type: "merge", config: { strategy: "object", keys: ["name", "age"] } },
        { id: "out", type: "output", config: {} },
      ],
      edges: [
        { from: "name", to: "merge" },
        { from: "age", to: "merge" },
        { from: "merge", to: "out" },
      ],
    };

    const result = await executeFlow(graph, { name: "Alice", age: "30" });
    expect(result.finalOutput).toEqual({ name: "Alice", age: "30" });
  });

  it("filters an array", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "src", type: "source", config: { key: "items" } },
        { id: "filter", type: "filter", config: { condition: "min_length", length: 4 } },
        { id: "out", type: "output", config: {} },
      ],
      edges: [
        { from: "src", to: "filter" },
        { from: "filter", to: "out" },
      ],
    };

    const result = await executeFlow(graph, { items: ["hi", "hello", "hey", "howdy"] });
    expect(result.finalOutput).toEqual(["hello", "howdy"]);
  });

  it("uses FlowBuilder fluent API", async () => {
    const graph = new FlowBuilder()
      .addSource("input", "data")
      .addTransform("split", "split", { delimiter: "," })
      .addFilter("clean", "non_empty")
      .addTransform("sort_it", "sort")
      .addOutput("result")
      .connect("input", "split")
      .connect("split", "clean")
      .connect("clean", "sort_it")
      .connect("sort_it", "result")
      .build();

    const result = await executeFlow(graph, { data: "banana,apple,,cherry" });
    expect(result.finalOutput).toEqual(["apple", "banana", "cherry"]);
  });

  it("handles template transform with object input", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "src", type: "source", config: { key: "person" } },
        {
          id: "fmt",
          type: "transform",
          config: { operation: "template", template: "Name: {name}, Role: {role}" },
        },
        { id: "out", type: "output", config: {} },
      ],
      edges: [
        { from: "src", to: "fmt" },
        { from: "fmt", to: "out" },
      ],
    };

    const result = await executeFlow(graph, { person: { name: "Bob", role: "Dev" } });
    expect(result.finalOutput).toBe("Name: Bob, Role: Dev");
  });

  it("multiple output nodes produce keyed result", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "src", type: "source", config: { key: "text" } },
        { id: "upper", type: "transform", config: { operation: "uppercase" } },
        { id: "lower", type: "transform", config: { operation: "lowercase" } },
        { id: "out_upper", type: "output", config: {} },
        { id: "out_lower", type: "output", config: {} },
      ],
      edges: [
        { from: "src", to: "upper" },
        { from: "src", to: "lower" },
        { from: "upper", to: "out_upper" },
        { from: "lower", to: "out_lower" },
      ],
    };

    const result = await executeFlow(graph, { text: "Hello" });
    expect(result.outputs.out_upper).toBe("HELLO");
    expect(result.outputs.out_lower).toBe("hello");
  });

  it("deep merge strategy combines objects", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", type: "source", config: { key: "a" } },
        { id: "b", type: "source", config: { key: "b" } },
        { id: "merge", type: "merge", config: { strategy: "deep_merge" } },
        { id: "out", type: "output", config: {} },
      ],
      edges: [
        { from: "a", to: "merge" },
        { from: "b", to: "merge" },
        { from: "merge", to: "out" },
      ],
    };

    const result = await executeFlow(graph, {
      a: { x: 1, y: 2 },
      b: { y: 3, z: 4 },
    });
    expect(result.finalOutput).toEqual({ x: 1, y: 3, z: 4 });
  });
});
