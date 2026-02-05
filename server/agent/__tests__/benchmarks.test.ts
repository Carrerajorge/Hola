import { describe, it, expect } from "vitest";
import { z } from "zod";
import { RunStateMachine } from "../stateMachine";
import { ToolRegistry } from "../toolRegistry";
import { MetricsCollector } from "../metricsCollector";

// Benchmarks are inherently flaky on shared CI runners. Opt-in locally.
const RUN_PERF_TESTS = process.env.RUN_PERF_TESTS === "true";
const perfIt = RUN_PERF_TESTS ? it : it.skip;

describe("Performance Benchmarks - Agent Infrastructure", () => {
  describe("State Machine Performance", () => {
    perfIt("should complete 1000 valid transitions in < 100ms", () => {
      const start = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        const machine = new RunStateMachine(`run-${i}`);
        machine.transition("planning");
        machine.transition("running");
        machine.transition("verifying");
        machine.transition("completed");
      }
      
      const elapsed = performance.now() - start;
      console.log(`[Benchmark] 1000 state machine cycles: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(100);
    });
  });
  
  describe("Metrics Collector Performance", () => {
    perfIt("should record 10000 metrics in < 200ms", () => {
      const collector = new MetricsCollector();
      const start = performance.now();
      
      for (let i = 0; i < 10000; i++) {
        collector.record({
          toolName: `tool-${i % 5}`,
          success: i % 3 !== 0,
          latencyMs: i % 100,
          timestamp: new Date(),
        });
      }
      
      const elapsed = performance.now() - start;
      console.log(`[Benchmark] 10000 metric recordings: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(200);
    });
    
    perfIt("should retrieve metrics summary in < 50ms", () => {
      const collector = new MetricsCollector();
      for (let i = 0; i < 5000; i++) {
        collector.record({
          toolName: `tool-${i % 5}`,
          success: true,
          latencyMs: i % 50,
          timestamp: new Date(),
        });
      }
      
      const start = performance.now();
      const metrics = collector.exportMetrics();
      const elapsed = performance.now() - start;
      
      console.log(`[Benchmark] Metrics retrieval: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(50);
    });
  });
  
  describe("Tool Registry Performance", () => {
    perfIt("should handle 100 concurrent mock tool calls in < 500ms", async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: "perf_mock",
        description: "Performance mock",
        inputSchema: z.object({}),
        capabilities: [],
        execute: async () => ({ success: true, output: null, artifacts: [], previews: [], logs: [] }),
      });
      
      const start = performance.now();
      const promises = Array.from({ length: 100 }, (_, i) =>
        registry.execute("perf_mock", {}, {
          userId: "test-user",
          chatId: "test-chat",
          runId: `run-${i}`,
        })
      );
      
      await Promise.all(promises);
      const elapsed = performance.now() - start;
      
      console.log(`[Benchmark] 100 concurrent tool calls: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(500);
    });
  });
  
  describe("Memory Usage", () => {
    perfIt("should not exceed 50MB for 10000 events", () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const collector = new MetricsCollector();
      
      for (let i = 0; i < 10000; i++) {
        collector.record({
          toolName: `tool-${i % 10}`,
          success: true,
          latencyMs: i % 200,
          timestamp: new Date(),
        });
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const usedMB = (finalMemory - initialMemory) / 1024 / 1024;
      
      console.log(`[Benchmark] Memory used for 10000 events: ${usedMB.toFixed(2)}MB`);
      expect(usedMB).toBeLessThan(50);
    });
  });
});
