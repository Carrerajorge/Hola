#!/usr/bin/env npx tsx

import { RetrievalPlanner } from "../server/agent/webtool/retrievalPlanner";
import { ConcurrencyPool, createConcurrencyPool, type PoolTask } from "../server/agent/webtool/concurrencyPool";
import { ResponseCache } from "../server/agent/webtool/responseCache";
import { RelevanceFilter } from "../server/agent/webtool/relevanceFilter";

interface SoakTestConfig {
  concurrency: number;
  durationSeconds: number;
  successRateThreshold: number;
  memoryCheckIntervalMs: number;
}

interface RetrievalResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  errorType?: string;
  prompt: string;
}

interface MemorySample {
  timestamp: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  rssMb: number;
}

interface SoakTestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  latencies: number[];
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  latencyAvgMs: number;
  errorTypes: Map<string, number>;
  memorySamples: MemorySample[];
  peakMemoryMb: number;
  durationMs: number;
  requestsPerSecond: number;
}

const FINANCIAL_PROMPTS = [
  "What is the current stock price of Apple AAPL today?",
  "Compare Q4 2024 earnings of Microsoft and Google",
  "Latest Federal Reserve interest rate decision",
  "S&P 500 performance in the last month",
  "Bitcoin price prediction for 2025",
  "Best dividend stocks for retirement portfolio",
  "How to analyze a company balance sheet",
  "What are ESG investing criteria?",
  "Current inflation rate in the United States",
  "Gold price forecast for next quarter",
];

const TECHNICAL_PROMPTS = [
  "How to implement a binary search tree in Python?",
  "Best practices for React hooks performance optimization",
  "Kubernetes vs Docker Swarm comparison 2024",
  "How to configure Nginx as reverse proxy with SSL",
  "TypeScript generics advanced patterns tutorial",
  "PostgreSQL query optimization techniques",
  "GraphQL vs REST API design trade-offs",
  "Microservices architecture patterns with Node.js",
  "Redis caching strategies for high traffic applications",
  "CI/CD pipeline best practices with GitHub Actions",
];

const NEWS_PROMPTS = [
  "Latest news on artificial intelligence regulations",
  "Climate change summit 2024 key outcomes",
  "Technology industry layoffs recent updates",
  "Space exploration missions planned for 2025",
  "Electric vehicle market trends today",
  "Cybersecurity threats and data breaches this week",
  "Global supply chain disruptions news",
  "Renewable energy policy developments",
  "Healthcare technology innovations 2024",
  "International trade agreements updates",
];

const ALL_PROMPTS = [...FINANCIAL_PROMPTS, ...TECHNICAL_PROMPTS, ...NEWS_PROMPTS];

const DEFAULT_CONFIG: SoakTestConfig = {
  concurrency: 100,
  durationSeconds: 60,
  successRateThreshold: 95,
  memoryCheckIntervalMs: 1000,
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function getRandomPrompt(): string {
  return ALL_PROMPTS[Math.floor(Math.random() * ALL_PROMPTS.length)];
}

function classifyError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout")) return "timeout";
    if (message.includes("rate") || message.includes("429")) return "rate_limit";
    if (message.includes("forbidden") || message.includes("403")) return "forbidden";
    if (message.includes("not found") || message.includes("404")) return "not_found";
    if (message.includes("network") || message.includes("connection")) return "network";
    if (message.includes("memory") || message.includes("heap")) return "memory";
    if (message.includes("cancelled")) return "cancelled";
    return "unknown";
  }
  return "unknown";
}

async function simulateRetrieval(prompt: string): Promise<RetrievalResult> {
  const startTime = performance.now();
  
  try {
    const planner = new RetrievalPlanner();
    const plan = planner.plan(prompt, 3);
    
    const simulatedLatency = 20 + Math.random() * 80;
    await new Promise(resolve => setTimeout(resolve, simulatedLatency));
    
    const cache = new ResponseCache({ maxEntries: 100, defaultTtlMs: 60000 });
    const urlHash = ResponseCache.hashUrl(`https://example.com/${Date.now()}`);
    cache.set(`https://example.com/${Date.now()}`, "Simulated content for: " + prompt, {
      fetchMethod: "fetch",
      queryHash: plan.queryHash,
    });
    
    const filter = new RelevanceFilter({ minScore: 0 });
    const sampleContent = "Simulated content for soak testing with relevant information about " + prompt + 
      ". This includes financial data, technical details, and news updates that are relevant to the query.";
    const filtered = filter.filter(
      sampleContent,
      prompt,
      plan.entities
    );
    
    const shouldFail = Math.random() < 0.02;
    if (shouldFail) {
      const errorTypes = ["timeout", "rate_limit", "network", "memory"];
      const errorType = errorTypes[Math.floor(Math.random() * errorTypes.length)];
      throw new Error(`Simulated ${errorType} error`);
    }
    
    if (!plan || plan.queries.length === 0) {
      throw new Error("Planning failed - no queries generated");
    }
    
    if (!filtered) {
      throw new Error("Filtering failed - no content");
    }
    
    const latencyMs = performance.now() - startTime;
    
    return {
      success: true,
      latencyMs,
      prompt,
    };
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    const errorType = classifyError(error);
    
    return {
      success: false,
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
      errorType,
      prompt,
    };
  }
}

function collectMemorySample(): MemorySample {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    heapUsedMb: mem.heapUsed / (1024 * 1024),
    heapTotalMb: mem.heapTotal / (1024 * 1024),
    externalMb: mem.external / (1024 * 1024),
    rssMb: mem.rss / (1024 * 1024),
  };
}

async function runSoakTest(config: SoakTestConfig = DEFAULT_CONFIG): Promise<SoakTestStats> {
  console.log("=".repeat(70));
  console.log("SOAK TEST - Web Retrieval System");
  console.log("=".repeat(70));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Concurrency: ${config.concurrency}`);
  console.log(`  Duration: ${config.durationSeconds} seconds`);
  console.log(`  Success Rate Threshold: ${config.successRateThreshold}%`);
  console.log();

  const stats: SoakTestStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    successRate: 0,
    latencies: [],
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    latencyP99Ms: 0,
    latencyMinMs: Infinity,
    latencyMaxMs: 0,
    latencyAvgMs: 0,
    errorTypes: new Map(),
    memorySamples: [],
    peakMemoryMb: 0,
    durationMs: 0,
    requestsPerSecond: 0,
  };

  const startTime = Date.now();
  const endTime = startTime + config.durationSeconds * 1000;
  
  let completedRequests = 0;
  let activeRequests = 0;
  const maxActiveRequests = config.concurrency;

  const memoryInterval = setInterval(() => {
    const sample = collectMemorySample();
    stats.memorySamples.push(sample);
    if (sample.heapUsedMb > stats.peakMemoryMb) {
      stats.peakMemoryMb = sample.heapUsedMb;
    }
  }, config.memoryCheckIntervalMs);

  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const successRate = stats.totalRequests > 0 
      ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(2)
      : "0.00";
    const currentMem = collectMemorySample();
    
    console.log(
      `[${elapsed.toFixed(1)}s] ` +
      `Requests: ${stats.totalRequests} | ` +
      `Success: ${successRate}% | ` +
      `Active: ${activeRequests} | ` +
      `Heap: ${currentMem.heapUsedMb.toFixed(1)}MB`
    );
  }, 5000);

  const processResult = (result: RetrievalResult) => {
    stats.totalRequests++;
    stats.latencies.push(result.latencyMs);
    
    if (result.latencyMs < stats.latencyMinMs) stats.latencyMinMs = result.latencyMs;
    if (result.latencyMs > stats.latencyMaxMs) stats.latencyMaxMs = result.latencyMs;
    
    if (result.success) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
      const errorType = result.errorType || "unknown";
      stats.errorTypes.set(errorType, (stats.errorTypes.get(errorType) || 0) + 1);
    }
  };

  const runRequest = async (): Promise<void> => {
    if (Date.now() >= endTime) return;
    
    activeRequests++;
    try {
      const prompt = getRandomPrompt();
      const result = await simulateRetrieval(prompt);
      processResult(result);
    } finally {
      activeRequests--;
      completedRequests++;
    }
  };

  const requestQueue: Promise<void>[] = [];

  while (Date.now() < endTime) {
    while (activeRequests < maxActiveRequests && Date.now() < endTime) {
      const promise = runRequest().finally(() => {
        const index = requestQueue.indexOf(promise);
        if (index > -1) requestQueue.splice(index, 1);
      });
      requestQueue.push(promise);
    }
    
    if (requestQueue.length > 0) {
      await Promise.race(requestQueue);
    } else {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  await Promise.all(requestQueue);

  clearInterval(memoryInterval);
  clearInterval(progressInterval);

  stats.durationMs = Date.now() - startTime;
  stats.successRate = stats.totalRequests > 0 
    ? (stats.successfulRequests / stats.totalRequests) * 100 
    : 0;
  stats.requestsPerSecond = stats.totalRequests / (stats.durationMs / 1000);
  
  if (stats.latencies.length > 0) {
    stats.latencyP50Ms = percentile(stats.latencies, 50);
    stats.latencyP95Ms = percentile(stats.latencies, 95);
    stats.latencyP99Ms = percentile(stats.latencies, 99);
    stats.latencyAvgMs = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;
  }
  
  if (stats.latencyMinMs === Infinity) stats.latencyMinMs = 0;

  return stats;
}

function printResults(stats: SoakTestStats, config: SoakTestConfig): void {
  console.log();
  console.log("=".repeat(70));
  console.log("SOAK TEST RESULTS");
  console.log("=".repeat(70));
  console.log();
  
  console.log("Request Statistics:");
  console.log(`  Total Requests:      ${stats.totalRequests}`);
  console.log(`  Successful:          ${stats.successfulRequests}`);
  console.log(`  Failed:              ${stats.failedRequests}`);
  console.log(`  Success Rate:        ${stats.successRate.toFixed(2)}%`);
  console.log(`  Requests/Second:     ${stats.requestsPerSecond.toFixed(2)}`);
  console.log(`  Duration:            ${(stats.durationMs / 1000).toFixed(2)}s`);
  console.log();
  
  console.log("Latency Statistics:");
  console.log(`  Min:                 ${stats.latencyMinMs.toFixed(2)}ms`);
  console.log(`  Max:                 ${stats.latencyMaxMs.toFixed(2)}ms`);
  console.log(`  Avg:                 ${stats.latencyAvgMs.toFixed(2)}ms`);
  console.log(`  P50:                 ${stats.latencyP50Ms.toFixed(2)}ms`);
  console.log(`  P95:                 ${stats.latencyP95Ms.toFixed(2)}ms`);
  console.log(`  P99:                 ${stats.latencyP99Ms.toFixed(2)}ms`);
  console.log();
  
  console.log("Memory Statistics:");
  console.log(`  Peak Heap Used:      ${stats.peakMemoryMb.toFixed(2)}MB`);
  if (stats.memorySamples.length > 0) {
    const firstSample = stats.memorySamples[0];
    const lastSample = stats.memorySamples[stats.memorySamples.length - 1];
    const memoryGrowth = lastSample.heapUsedMb - firstSample.heapUsedMb;
    console.log(`  Memory Growth:       ${memoryGrowth.toFixed(2)}MB`);
    console.log(`  Final Heap Used:     ${lastSample.heapUsedMb.toFixed(2)}MB`);
    console.log(`  Final RSS:           ${lastSample.rssMb.toFixed(2)}MB`);
  }
  console.log();
  
  if (stats.errorTypes.size > 0) {
    console.log("Error Types:");
    const sortedErrors = [...stats.errorTypes.entries()].sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedErrors) {
      const percentage = ((count / stats.totalRequests) * 100).toFixed(2);
      console.log(`  ${type.padEnd(20)} ${count} (${percentage}%)`);
    }
    console.log();
  }
  
  const passed = stats.successRate >= config.successRateThreshold;
  console.log("=".repeat(70));
  console.log(`RESULT: ${passed ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Success Rate: ${stats.successRate.toFixed(2)}% (threshold: ${config.successRateThreshold}%)`);
  console.log("=".repeat(70));
}

function parseArgs(): Partial<SoakTestConfig> {
  const args: Partial<SoakTestConfig> = {};
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    if (arg === "--concurrency" && process.argv[i + 1]) {
      args.concurrency = parseInt(process.argv[++i], 10);
    } else if (arg === "--duration" && process.argv[i + 1]) {
      args.durationSeconds = parseInt(process.argv[++i], 10);
    } else if (arg === "--threshold" && process.argv[i + 1]) {
      args.successRateThreshold = parseFloat(process.argv[++i]);
    } else if (arg === "--help") {
      console.log(`
Soak Test for Web Retrieval System

Usage: npx tsx scripts/soak-test.ts [options]

Options:
  --concurrency <n>    Number of concurrent simulated retrievals (default: 100)
  --duration <s>       Duration of the test in seconds (default: 60)
  --threshold <p>      Minimum success rate percentage required (default: 95)
  --help               Show this help message

Examples:
  npx tsx scripts/soak-test.ts
  npx tsx scripts/soak-test.ts --concurrency 50 --duration 120
  npx tsx scripts/soak-test.ts --threshold 98
`);
      process.exit(0);
    }
  }
  
  return args;
}

async function main(): Promise<void> {
  const configOverrides = parseArgs();
  const config: SoakTestConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  
  try {
    const stats = await runSoakTest(config);
    printResults(stats, config);
    
    const passed = stats.successRate >= config.successRateThreshold;
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error("Soak test failed with error:", error);
    process.exit(1);
  }
}

main();
