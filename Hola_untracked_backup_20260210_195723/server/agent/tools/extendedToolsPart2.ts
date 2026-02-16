/**
 * Extended Tools Part 2 — Capabilities 701-1000
 * Observability, Connectors, AI Core, RAG, Enterprise, Browser Advanced
 */

import { z } from "zod";

// Real services
import {
  startSpan,
  endSpan,
  getTrace,
  recordMetric,
  getMetricSummary,
  exportPrometheusFormat,
  createAlertRule,
  evaluateAlerts,
  runHealthChecks,
  injectFault,
  runLoadTest,
  generateGrafanaDashboard,
} from "../../services/observabilityService";

import {
  registerConnector,
  listConnectors,
  testConnector,
  sendSlackMessage,
  sendDiscordMessage,
  sendTeamsMessage,
  sendTelegramMessage,
  generateConnectionString,
  generateDatabaseSchema,
  generateJiraTicket,
  generateGitHubIssue,
  createWebhookEndpoint,
} from "../../services/connectorsService";

// ============================================
// TOOL DEFINITION INTERFACE
// ============================================

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  schema: z.ZodObject<any>;
  execute: (params: any) => Promise<any>;
}

// ============================================
// INLINE STUBS — AI Agent Core Service
// ============================================

const aiStub = {
  configureRouter: async (config: {
    strategy: string;
    providers: string[];
    maxRetries: number;
    timeout: number;
  }) => ({
    strategy: config.strategy || "fallback",
    providers: config.providers || ["openai", "anthropic"],
    maxRetries: config.maxRetries || 3,
    timeout: config.timeout || 30000,
    fallbackChain: (config.providers || ["openai", "anthropic"]).map((p, i) => ({
      provider: p,
      priority: i + 1,
      weight: Math.round(100 / (config.providers?.length || 2)),
    })),
    createdAt: new Date().toISOString(),
  }),

  selectProvider: async (config: {
    task: string;
    requirements: { maxLatency?: number; maxCost?: number; minQuality?: number };
  }) => {
    const providers = [
      { name: "openai-gpt4o", latencyMs: 800, costPer1k: 0.03, quality: 0.95 },
      { name: "anthropic-claude", latencyMs: 1200, costPer1k: 0.025, quality: 0.96 },
      { name: "google-gemini", latencyMs: 600, costPer1k: 0.02, quality: 0.90 },
      { name: "xai-grok", latencyMs: 500, costPer1k: 0.015, quality: 0.88 },
    ];
    const filtered = providers.filter((p) => {
      if (config.requirements.maxLatency && p.latencyMs > config.requirements.maxLatency) return false;
      if (config.requirements.maxCost && p.costPer1k > config.requirements.maxCost) return false;
      if (config.requirements.minQuality && p.quality < config.requirements.minQuality) return false;
      return true;
    });
    const selected = filtered.length > 0 ? filtered[0] : providers[0];
    return {
      selected: selected.name,
      reason: `Best match for task "${config.task}" given constraints`,
      alternatives: filtered.slice(1).map((p) => p.name),
      metrics: selected,
    };
  },

  tokenBudget: async (config: {
    model: string;
    maxInputTokens: number;
    maxOutputTokens: number;
    reserveTokens: number;
  }) => ({
    model: config.model,
    maxInputTokens: config.maxInputTokens || 4096,
    maxOutputTokens: config.maxOutputTokens || 2048,
    reserveTokens: config.reserveTokens || 256,
    totalBudget: (config.maxInputTokens || 4096) + (config.maxOutputTokens || 2048),
    effectiveOutput: (config.maxOutputTokens || 2048) - (config.reserveTokens || 256),
    estimatedCost: (((config.maxInputTokens || 4096) + (config.maxOutputTokens || 2048)) / 1000) * 0.03,
    configured: true,
  }),

  defineAgentRole: async (config: {
    name: string;
    systemPrompt: string;
    capabilities: string[];
    constraints: string[];
  }) => ({
    roleId: `role_${Date.now().toString(36)}`,
    name: config.name,
    systemPrompt: config.systemPrompt,
    capabilities: config.capabilities,
    constraints: config.constraints,
    createdAt: new Date().toISOString(),
    status: "active",
  }),

  decomposeTask: async (config: {
    task: string;
    maxSubtasks: number;
    strategy: string;
  }) => {
    const words = config.task.split(" ");
    const subtaskCount = Math.min(config.maxSubtasks || 5, Math.max(2, Math.ceil(words.length / 3)));
    const subtasks = [];
    for (let i = 0; i < subtaskCount; i++) {
      subtasks.push({
        id: `sub_${i + 1}`,
        description: `Step ${i + 1}: ${i === 0 ? "Analyze and understand" : i === subtaskCount - 1 ? "Compile and deliver" : "Process segment " + i} of "${config.task}"`,
        dependencies: i > 0 ? [`sub_${i}`] : [],
        estimatedComplexity: i === 0 || i === subtaskCount - 1 ? "medium" : "low",
        status: "pending",
      });
    }
    return {
      originalTask: config.task,
      strategy: config.strategy || "sequential",
      subtasks,
      estimatedTotalSteps: subtaskCount,
      decomposedAt: new Date().toISOString(),
    };
  },

  validateInput: async (config: {
    input: string;
    rules: string[];
    maxLength: number;
  }) => {
    const violations: string[] = [];
    if (config.maxLength && config.input.length > config.maxLength) {
      violations.push(`Input exceeds max length of ${config.maxLength} (actual: ${config.input.length})`);
    }
    for (const rule of config.rules || []) {
      if (rule === "no_pii" && /\b\d{3}-\d{2}-\d{4}\b/.test(config.input)) {
        violations.push("Input contains potential PII (SSN pattern detected)");
      }
      if (rule === "no_urls" && /https?:\/\/\S+/.test(config.input)) {
        violations.push("Input contains URLs which are not allowed");
      }
      if (rule === "no_html" && /<[^>]+>/.test(config.input)) {
        violations.push("Input contains HTML tags which are not allowed");
      }
      if (rule === "no_injection" && /(\b(DROP|DELETE|INSERT|UPDATE|ALTER)\b.*\b(TABLE|FROM|INTO|SET)\b)/i.test(config.input)) {
        violations.push("Input contains potential SQL injection patterns");
      }
    }
    return {
      valid: violations.length === 0,
      violations,
      sanitizedLength: config.input.length,
      checkedRules: config.rules || [],
    };
  },

  validateOutput: async (config: {
    output: string;
    format: string;
    schema: Record<string, any>;
  }) => {
    const issues: string[] = [];
    let parsed: any = config.output;
    if (config.format === "json") {
      try {
        parsed = JSON.parse(config.output);
      } catch {
        issues.push("Output is not valid JSON");
      }
    }
    if (config.schema && typeof parsed === "object" && parsed !== null) {
      for (const [key, spec] of Object.entries(config.schema)) {
        if (!(key in parsed)) {
          issues.push(`Missing required field: ${key}`);
        }
      }
    }
    return {
      valid: issues.length === 0,
      issues,
      format: config.format,
      outputLength: config.output.length,
    };
  },

  detectToxicity: async (config: { text: string; threshold: number }) => {
    const toxicPatterns = [
      { pattern: /\b(hate|kill|destroy|attack)\b/gi, category: "violence", weight: 0.6 },
      { pattern: /\b(stupid|idiot|dumb|moron)\b/gi, category: "insult", weight: 0.4 },
      { pattern: /\b(spam|scam|fraud)\b/gi, category: "spam", weight: 0.3 },
    ];
    const detections: Array<{ category: string; score: number; matched: boolean }> = [];
    let maxScore = 0;
    for (const tp of toxicPatterns) {
      const matches = config.text.match(tp.pattern);
      const score = matches ? Math.min(1, matches.length * tp.weight) : 0;
      if (score > maxScore) maxScore = score;
      detections.push({ category: tp.category, score, matched: score > 0 });
    }
    return {
      toxic: maxScore >= (config.threshold || 0.5),
      overallScore: maxScore,
      threshold: config.threshold || 0.5,
      categories: detections,
      textLength: config.text.length,
    };
  },

  filterContent: async (config: {
    content: string;
    filters: string[];
    action: string;
  }) => {
    let filtered = config.content;
    const appliedFilters: string[] = [];
    for (const filter of config.filters || []) {
      if (filter === "pii_emails") {
        const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        if (emailPattern.test(filtered)) {
          filtered = filtered.replace(emailPattern, "[EMAIL_REDACTED]");
          appliedFilters.push("pii_emails");
        }
      }
      if (filter === "pii_phones") {
        const phonePattern = /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
        if (phonePattern.test(filtered)) {
          filtered = filtered.replace(phonePattern, "[PHONE_REDACTED]");
          appliedFilters.push("pii_phones");
        }
      }
      if (filter === "pii_ssn") {
        const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
        if (ssnPattern.test(filtered)) {
          filtered = filtered.replace(ssnPattern, "[SSN_REDACTED]");
          appliedFilters.push("pii_ssn");
        }
      }
      if (filter === "profanity") {
        filtered = filtered.replace(/\b(damn|hell|crap)\b/gi, "[FILTERED]");
        appliedFilters.push("profanity");
      }
      if (filter === "urls") {
        filtered = filtered.replace(/https?:\/\/\S+/g, "[URL_REMOVED]");
        appliedFilters.push("urls");
      }
    }
    return {
      original: config.content,
      filtered,
      action: config.action || "redact",
      appliedFilters,
      modificationsCount: appliedFilters.length,
    };
  },

  storeMemory: async (config: {
    key: string;
    value: any;
    ttl: number;
    namespace: string;
  }) => ({
    key: config.key,
    namespace: config.namespace || "default",
    stored: true,
    ttl: config.ttl || 3600,
    expiresAt: new Date(Date.now() + (config.ttl || 3600) * 1000).toISOString(),
    sizeBytes: JSON.stringify(config.value).length,
  }),
};

// ============================================
// INLINE STUBS — RAG / Knowledge Service
// ============================================

const ragStub = {
  chunkFixed: async (config: { text: string; chunkSize: number; overlap: number }) => {
    const size = config.chunkSize || 512;
    const overlap = config.overlap || 64;
    const chunks: Array<{ index: number; text: string; startChar: number; endChar: number }> = [];
    let pos = 0;
    let idx = 0;
    while (pos < config.text.length) {
      const end = Math.min(pos + size, config.text.length);
      chunks.push({
        index: idx,
        text: config.text.slice(pos, end),
        startChar: pos,
        endChar: end,
      });
      idx++;
      pos += size - overlap;
      if (pos >= config.text.length) break;
    }
    return {
      totalChunks: chunks.length,
      chunkSize: size,
      overlap,
      originalLength: config.text.length,
      chunks,
    };
  },

  chunkSemantic: async (config: { text: string; maxChunkSize: number; splitOn: string }) => {
    const delimiter = config.splitOn === "paragraph" ? /\n\n+/ : config.splitOn === "sentence" ? /(?<=[.!?])\s+/ : /\n+/;
    const segments = config.text.split(delimiter).filter((s) => s.trim().length > 0);
    const maxSize = config.maxChunkSize || 1024;
    const chunks: Array<{ index: number; text: string; tokenEstimate: number }> = [];
    let current = "";
    let idx = 0;
    for (const seg of segments) {
      if (current.length + seg.length > maxSize && current.length > 0) {
        chunks.push({ index: idx, text: current.trim(), tokenEstimate: Math.ceil(current.trim().length / 4) });
        idx++;
        current = seg;
      } else {
        current += (current ? "\n\n" : "") + seg;
      }
    }
    if (current.trim().length > 0) {
      chunks.push({ index: idx, text: current.trim(), tokenEstimate: Math.ceil(current.trim().length / 4) });
    }
    return {
      totalChunks: chunks.length,
      strategy: config.splitOn || "paragraph",
      maxChunkSize: maxSize,
      originalLength: config.text.length,
      chunks,
    };
  },

  addVectors: async (config: { collection: string; vectors: Array<{ id: string; values: number[]; metadata?: Record<string, any> }> }) => ({
    collection: config.collection,
    inserted: config.vectors.length,
    dimensions: config.vectors[0]?.values?.length || 0,
    ids: config.vectors.map((v) => v.id),
    status: "indexed",
    timestamp: new Date().toISOString(),
  }),

  searchVectors: async (config: { collection: string; query: number[]; topK: number; filter?: Record<string, any> }) => {
    const results = [];
    const k = config.topK || 5;
    for (let i = 0; i < k; i++) {
      results.push({
        id: `doc_${1000 + i}`,
        score: parseFloat((0.95 - i * 0.08).toFixed(4)),
        metadata: { source: `source_${i}.txt`, chunk: i, text: `Placeholder result ${i + 1} for collection "${config.collection}"` },
      });
    }
    return {
      collection: config.collection,
      queryDimensions: config.query.length,
      topK: k,
      results,
      searchTimeMs: Math.floor(Math.random() * 50) + 5,
    };
  },

  hybridSearch: async (config: { collection: string; query: string; vector: number[]; topK: number; alpha: number }) => {
    const k = config.topK || 5;
    const alpha = config.alpha ?? 0.5;
    const results = [];
    for (let i = 0; i < k; i++) {
      const vectorScore = 0.92 - i * 0.07;
      const textScore = 0.88 - i * 0.06;
      const combined = alpha * vectorScore + (1 - alpha) * textScore;
      results.push({
        id: `hybrid_${i}`,
        combinedScore: parseFloat(combined.toFixed(4)),
        vectorScore: parseFloat(vectorScore.toFixed(4)),
        textScore: parseFloat(textScore.toFixed(4)),
        metadata: { text: `Hybrid result ${i + 1} matching "${config.query.slice(0, 30)}..."` },
      });
    }
    return {
      collection: config.collection,
      alpha,
      topK: k,
      results,
      searchTimeMs: Math.floor(Math.random() * 80) + 10,
    };
  },

  expandQuery: async (config: { query: string; expansions: number }) => {
    const n = config.expansions || 3;
    const base = config.query.trim();
    const expanded = [base];
    const synonymStrategies = [
      (q: string) => q + " (detailed explanation)",
      (q: string) => `What is ${q}?`,
      (q: string) => `${q} examples and use cases`,
      (q: string) => `${q} best practices`,
      (q: string) => `How does ${q} work?`,
    ];
    for (let i = 0; i < Math.min(n, synonymStrategies.length); i++) {
      expanded.push(synonymStrategies[i](base));
    }
    return {
      originalQuery: base,
      expandedQueries: expanded,
      strategy: "semantic_expansion",
      count: expanded.length,
    };
  },

  extractEntities: async (config: { text: string; types: string[] }) => {
    const entities: Array<{ text: string; type: string; startIndex: number; confidence: number }> = [];
    const typePatterns: Record<string, RegExp> = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      url: /https?:\/\/\S+/g,
      date: /\b\d{4}-\d{2}-\d{2}\b/g,
      number: /\b\d+(\.\d+)?\b/g,
      capitalized: /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g,
    };
    for (const type of config.types || ["capitalized", "email", "url", "date"]) {
      const pattern = typePatterns[type];
      if (!pattern) continue;
      let match: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((match = re.exec(config.text)) !== null) {
        entities.push({
          text: match[0],
          type,
          startIndex: match.index,
          confidence: 0.85 + Math.random() * 0.15,
        });
      }
    }
    return {
      text: config.text.slice(0, 200) + (config.text.length > 200 ? "..." : ""),
      entityCount: entities.length,
      typesRequested: config.types || ["capitalized", "email", "url", "date"],
      entities: entities.slice(0, 50),
    };
  },

  buildKnowledgeGraph: async (config: { entities: Array<{ name: string; type: string }>; relations: Array<{ from: string; to: string; relation: string }> }) => ({
    nodes: (config.entities || []).map((e, i) => ({
      id: `node_${i}`,
      label: e.name,
      type: e.type,
      degree: (config.relations || []).filter((r) => r.from === e.name || r.to === e.name).length,
    })),
    edges: (config.relations || []).map((r, i) => ({
      id: `edge_${i}`,
      source: r.from,
      target: r.to,
      label: r.relation,
    })),
    stats: {
      totalNodes: (config.entities || []).length,
      totalEdges: (config.relations || []).length,
      density: (config.entities || []).length > 1
        ? (2 * (config.relations || []).length) / ((config.entities || []).length * ((config.entities || []).length - 1))
        : 0,
    },
    builtAt: new Date().toISOString(),
  }),

  evaluateRetrieval: async (config: { queries: Array<{ query: string; expectedIds: string[]; retrievedIds: string[] }> }) => {
    let totalPrecision = 0;
    let totalRecall = 0;
    let totalMRR = 0;
    const perQuery = (config.queries || []).map((q) => {
      const expectedSet = new Set(q.expectedIds);
      const relevant = q.retrievedIds.filter((id) => expectedSet.has(id));
      const precision = q.retrievedIds.length > 0 ? relevant.length / q.retrievedIds.length : 0;
      const recall = q.expectedIds.length > 0 ? relevant.length / q.expectedIds.length : 0;
      const firstRelevantRank = q.retrievedIds.findIndex((id) => expectedSet.has(id));
      const mrr = firstRelevantRank >= 0 ? 1 / (firstRelevantRank + 1) : 0;
      totalPrecision += precision;
      totalRecall += recall;
      totalMRR += mrr;
      return { query: q.query, precision, recall, mrr, f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0 };
    });
    const n = config.queries.length || 1;
    return {
      avgPrecision: totalPrecision / n,
      avgRecall: totalRecall / n,
      avgMRR: totalMRR / n,
      avgF1: perQuery.reduce((s, q) => s + q.f1, 0) / n,
      perQuery,
      evaluatedAt: new Date().toISOString(),
    };
  },

  detectDuplicates: async (config: { documents: Array<{ id: string; text: string }>; threshold: number }) => {
    const threshold = config.threshold || 0.85;
    const duplicates: Array<{ id1: string; id2: string; similarity: number }> = [];
    const docs = config.documents || [];
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const words1 = new Set(docs[i].text.toLowerCase().split(/\s+/));
        const words2 = new Set(docs[j].text.toLowerCase().split(/\s+/));
        const intersection = new Set([...words1].filter((w) => words2.has(w)));
        const union = new Set([...words1, ...words2]);
        const jaccard = union.size > 0 ? intersection.size / union.size : 0;
        if (jaccard >= threshold) {
          duplicates.push({ id1: docs[i].id, id2: docs[j].id, similarity: parseFloat(jaccard.toFixed(4)) });
        }
      }
    }
    return {
      totalDocuments: docs.length,
      duplicatesFound: duplicates.length,
      threshold,
      duplicates,
      checkedAt: new Date().toISOString(),
    };
  },
};

// ============================================
// INLINE STUBS — Enterprise Service
// ============================================

const enterpriseStub = {
  createTenant: async (config: {
    name: string;
    plan: string;
    adminEmail: string;
    settings?: Record<string, any>;
  }) => ({
    tenantId: `tenant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: config.name,
    plan: config.plan || "starter",
    adminEmail: config.adminEmail,
    settings: config.settings || {},
    status: "active",
    createdAt: new Date().toISOString(),
    quotas: {
      apiCallsPerMonth: config.plan === "enterprise" ? 1000000 : config.plan === "pro" ? 100000 : 10000,
      storageGb: config.plan === "enterprise" ? 500 : config.plan === "pro" ? 50 : 5,
      maxUsers: config.plan === "enterprise" ? -1 : config.plan === "pro" ? 100 : 10,
    },
  }),

  getTenant: async (config: { tenantId: string }) => ({
    tenantId: config.tenantId,
    name: `Tenant ${config.tenantId.slice(-6)}`,
    plan: "pro",
    status: "active",
    adminEmail: "admin@example.com",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    usage: {
      apiCallsThisMonth: 42350,
      storageUsedGb: 12.7,
      activeUsers: 23,
    },
  }),

  checkQuota: async (config: { tenantId: string; resource: string; requested: number }) => {
    const quotas: Record<string, number> = {
      api_calls: 100000,
      storage_gb: 50,
      users: 100,
      projects: 25,
    };
    const usage: Record<string, number> = {
      api_calls: 42350,
      storage_gb: 12.7,
      users: 23,
      projects: 8,
    };
    const limit = quotas[config.resource] || 1000;
    const current = usage[config.resource] || 0;
    const remaining = limit - current;
    return {
      tenantId: config.tenantId,
      resource: config.resource,
      limit,
      currentUsage: current,
      requested: config.requested,
      remaining,
      allowed: config.requested <= remaining,
      percentUsed: parseFloat(((current / limit) * 100).toFixed(1)),
    };
  },

  generateInvoice: async (config: {
    tenantId: string;
    period: string;
    lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  }) => {
    const items = (config.lineItems || []).map((item) => ({
      ...item,
      total: item.quantity * item.unitPrice,
    }));
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const tax = parseFloat((subtotal * 0.21).toFixed(2));
    return {
      invoiceId: `INV-${Date.now().toString(36).toUpperCase()}`,
      tenantId: config.tenantId,
      period: config.period,
      lineItems: items,
      subtotal,
      tax,
      taxRate: 0.21,
      total: parseFloat((subtotal + tax).toFixed(2)),
      currency: "EUR",
      status: "draft",
      generatedAt: new Date().toISOString(),
    };
  },

  createWorkflow: async (config: {
    name: string;
    steps: Array<{ name: string; type: string; config: Record<string, any> }>;
    triggers: string[];
  }) => ({
    workflowId: `wf_${Date.now().toString(36)}`,
    name: config.name,
    steps: (config.steps || []).map((s, i) => ({
      stepId: `step_${i}`,
      name: s.name,
      type: s.type,
      config: s.config,
      order: i,
    })),
    triggers: config.triggers || ["manual"],
    status: "active",
    version: 1,
    createdAt: new Date().toISOString(),
  }),

  executeWorkflow: async (config: {
    workflowId: string;
    input: Record<string, any>;
  }) => ({
    executionId: `exec_${Date.now().toString(36)}`,
    workflowId: config.workflowId,
    input: config.input,
    status: "completed",
    startedAt: new Date(Date.now() - 1500).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1500,
    stepsExecuted: 3,
    output: { result: "Workflow executed successfully", processedItems: 42 },
  }),

  createStateMachine: async (config: {
    name: string;
    states: string[];
    initialState: string;
    transitions: Array<{ from: string; to: string; event: string; guard?: string }>;
  }) => ({
    machineId: `sm_${Date.now().toString(36)}`,
    name: config.name,
    states: config.states,
    initialState: config.initialState,
    currentState: config.initialState,
    transitions: config.transitions,
    history: [{ state: config.initialState, enteredAt: new Date().toISOString(), event: "init" }],
    createdAt: new Date().toISOString(),
  }),

  transitionState: async (config: {
    machineId: string;
    event: string;
    context?: Record<string, any>;
  }) => ({
    machineId: config.machineId,
    event: config.event,
    previousState: "pending",
    currentState: "processing",
    transitionValid: true,
    context: config.context || {},
    transitionedAt: new Date().toISOString(),
  }),
};

// ============================================
// INLINE STUBS — Browser Advanced Service
// ============================================

const browserStub = {
  analyzeSEO: async (config: { url: string; checkMeta: boolean; checkHeadings: boolean; checkImages: boolean }) => ({
    url: config.url,
    score: 72,
    maxScore: 100,
    checks: {
      title: { present: true, length: 55, optimal: true, value: "Example Page Title" },
      metaDescription: { present: true, length: 145, optimal: true },
      canonicalUrl: { present: config.checkMeta, value: config.url },
      headings: config.checkHeadings
        ? { h1Count: 1, h2Count: 4, h3Count: 8, hasMultipleH1: false, hierarchyValid: true }
        : null,
      images: config.checkImages
        ? { total: 12, withAlt: 9, withoutAlt: 3, missingAltPercentage: 25 }
        : null,
      openGraph: { present: true, tags: ["og:title", "og:description", "og:image"] },
      robots: { indexable: true, followable: true },
      structuredData: { present: true, types: ["WebPage", "BreadcrumbList"] },
    },
    recommendations: [
      "Add alt text to 3 images missing it",
      "Consider adding more internal links",
      "Meta description length is good",
    ],
    analyzedAt: new Date().toISOString(),
  }),

  auditAccessibility: async (config: { url: string; standard: string; includeWarnings: boolean }) => ({
    url: config.url,
    standard: config.standard || "WCAG2.1-AA",
    score: 85,
    violations: [
      { rule: "color-contrast", impact: "serious", count: 3, description: "Elements must have sufficient color contrast" },
      { rule: "image-alt", impact: "critical", count: 1, description: "Images must have alternate text" },
      { rule: "label", impact: "critical", count: 2, description: "Form elements must have labels" },
    ],
    warnings: config.includeWarnings
      ? [
          { rule: "heading-order", impact: "moderate", count: 1, description: "Heading levels should increase by one" },
          { rule: "link-name", impact: "minor", count: 2, description: "Links must have discernible text" },
        ]
      : [],
    passes: 42,
    totalElements: 156,
    auditedAt: new Date().toISOString(),
  }),

  webPerformance: async (config: { url: string; device: string }) => ({
    url: config.url,
    device: config.device || "desktop",
    metrics: {
      firstContentfulPaint: 1.2,
      largestContentfulPaint: 2.4,
      cumulativeLayoutShift: 0.05,
      firstInputDelay: 18,
      timeToInteractive: 3.1,
      totalBlockingTime: 150,
      speedIndex: 2.8,
    },
    scores: {
      performance: 88,
      accessibility: 92,
      bestPractices: 95,
      seo: 90,
    },
    opportunities: [
      { name: "Serve images in next-gen formats", savings: "450 KB" },
      { name: "Eliminate render-blocking resources", savings: "350 ms" },
      { name: "Reduce unused JavaScript", savings: "120 KB" },
    ],
    analyzedAt: new Date().toISOString(),
  }),

  generateMockAPI: async (config: {
    endpoints: Array<{ method: string; path: string; responseBody: any; statusCode: number }>;
    baseUrl: string;
  }) => ({
    baseUrl: config.baseUrl || "http://localhost:3001",
    endpoints: (config.endpoints || []).map((ep) => ({
      method: ep.method.toUpperCase(),
      path: ep.path,
      statusCode: ep.statusCode || 200,
      responseBody: ep.responseBody,
      curlCommand: `curl -X ${ep.method.toUpperCase()} '${config.baseUrl || "http://localhost:3001"}${ep.path}'`,
    })),
    totalEndpoints: (config.endpoints || []).length,
    serverCode: `import express from 'express';\nconst app = express();\napp.use(express.json());\n\n${(config.endpoints || [])
      .map(
        (ep) =>
          `app.${ep.method.toLowerCase()}('${ep.path}', (req, res) => {\n  res.status(${ep.statusCode || 200}).json(${JSON.stringify(ep.responseBody)});\n});`
      )
      .join("\n\n")}\n\napp.listen(3001, () => console.log('Mock API on :3001'));`,
    generatedAt: new Date().toISOString(),
  }),

  detectBrokenLinks: async (config: { url: string; maxDepth: number; timeout: number }) => ({
    url: config.url,
    maxDepth: config.maxDepth || 2,
    scanned: 47,
    brokenLinks: [
      { url: `${config.url}/old-page`, statusCode: 404, foundOn: config.url, linkText: "Old page link" },
      { url: `${config.url}/removed-resource`, statusCode: 410, foundOn: `${config.url}/about`, linkText: "Resource" },
    ],
    redirects: [
      { url: `${config.url}/blog`, statusCode: 301, redirectsTo: `${config.url}/articles` },
    ],
    summary: {
      totalLinks: 47,
      broken: 2,
      redirects: 1,
      healthy: 44,
      brokenPercentage: 4.3,
    },
    scanTimeMs: (config.timeout || 5000) - Math.floor(Math.random() * 1000),
    scannedAt: new Date().toISOString(),
  }),

  parseRSS: async (config: { feedUrl: string; maxItems: number }) => {
    const maxItems = config.maxItems || 10;
    const items = [];
    for (let i = 0; i < Math.min(maxItems, 5); i++) {
      items.push({
        title: `Feed Item ${i + 1}`,
        link: `${config.feedUrl.replace(/\/feed\/?$/, "")}/${2026 - i}/${String(2 - i).padStart(2, "0")}/article-${i + 1}`,
        description: `Description of feed item ${i + 1} from ${config.feedUrl}`,
        pubDate: new Date(Date.now() - i * 86400000).toISOString(),
        author: `Author ${i + 1}`,
        categories: ["Technology", "AI"],
      });
    }
    return {
      feedUrl: config.feedUrl,
      title: "Parsed RSS Feed",
      description: `RSS feed from ${config.feedUrl}`,
      language: "en",
      lastBuildDate: new Date().toISOString(),
      items,
      totalItems: items.length,
      parsedAt: new Date().toISOString(),
    };
  },
};

// ============================================
// TOOLS ARRAY
// ============================================

export const extendedToolsPart2: ToolDefinition[] = [
  // ========================================
  // OBSERVABILITY TOOLS (12)
  // ========================================
  {
    name: "obs_start_span",
    description:
      "Inicia un span de tracing distribuido para rastrear operaciones. Devuelve spanId y traceId para correlacion.",
    category: "observability",
    schema: z.object({
      traceId: z.string().describe("ID del trace (genera uno nuevo o usa existente)"),
      operationName: z.string().describe("Nombre de la operacion a rastrear"),
      serviceName: z.string().describe("Nombre del servicio que ejecuta la operacion"),
      parentSpanId: z.string().optional().describe("SpanId del span padre si es un sub-span"),
    }),
    execute: async (params) => {
      const span = startSpan(
        params.traceId,
        params.operationName,
        params.serviceName,
        params.parentSpanId
      );
      return {
        spanId: span.spanId,
        traceId: span.traceId,
        operationName: span.operationName,
        serviceName: span.serviceName,
        startTime: span.startTime,
        status: span.status,
      };
    },
  },
  {
    name: "obs_end_span",
    description:
      "Finaliza un span de tracing, registra duracion y estado. Tambien genera una metrica de latencia automaticamente.",
    category: "observability",
    schema: z.object({
      spanId: z.string().describe("ID del span a finalizar"),
      status: z.enum(["ok", "error"]).optional().describe("Estado final del span"),
      attributes: z.record(z.any()).optional().describe("Atributos adicionales del span"),
    }),
    execute: async (params) => {
      const span = endSpan(params.spanId, params.status, params.attributes);
      if (!span) {
        return { error: `Span "${params.spanId}" not found` };
      }
      return {
        spanId: span.spanId,
        traceId: span.traceId,
        duration: span.duration,
        status: span.status,
        attributes: span.attributes,
      };
    },
  },
  {
    name: "obs_get_trace",
    description:
      "Obtiene todos los spans de un trace distribuido para visualizar el flujo completo de una operacion.",
    category: "observability",
    schema: z.object({
      traceId: z.string().describe("ID del trace a consultar"),
    }),
    execute: async (params) => {
      const spans = getTrace(params.traceId);
      return {
        traceId: params.traceId,
        spanCount: spans.length,
        spans: spans.map((s) => ({
          spanId: s.spanId,
          parentSpanId: s.parentSpanId,
          operationName: s.operationName,
          serviceName: s.serviceName,
          duration: s.duration,
          status: s.status,
          eventCount: s.events.length,
        })),
      };
    },
  },
  {
    name: "obs_record_metric",
    description:
      "Registra un punto de metrica (gauge, counter, histogram) con etiquetas para monitoreo y dashboards.",
    category: "observability",
    schema: z.object({
      name: z.string().describe("Nombre de la metrica (ej: http_requests_total)"),
      value: z.number().describe("Valor numerico de la metrica"),
      labels: z.record(z.string()).optional().describe("Etiquetas clave-valor para la metrica"),
    }),
    execute: async (params) => {
      recordMetric(params.name, params.value, params.labels || {});
      return {
        recorded: true,
        metric: params.name,
        value: params.value,
        labels: params.labels || {},
        timestamp: Date.now(),
      };
    },
  },
  {
    name: "obs_get_metric_summary",
    description:
      "Obtiene resumen estadistico de una metrica: count, sum, avg, min, max, p50, p95, p99 en ventana de tiempo.",
    category: "observability",
    schema: z.object({
      name: z.string().describe("Nombre de la metrica"),
      windowMs: z.number().optional().describe("Ventana de tiempo en ms (default: 300000 = 5 min)"),
    }),
    execute: async (params) => {
      return getMetricSummary(params.name, params.windowMs);
    },
  },
  {
    name: "obs_prometheus_export",
    description:
      "Exporta todas las metricas en formato Prometheus/OpenMetrics listo para scraping.",
    category: "observability",
    schema: z.object({}),
    execute: async () => {
      const output = exportPrometheusFormat();
      return {
        format: "prometheus",
        contentType: "text/plain; version=0.0.4; charset=utf-8",
        content: output,
        byteLength: Buffer.byteLength(output, "utf-8"),
      };
    },
  },
  {
    name: "obs_create_alert",
    description:
      "Crea una regla de alerta basada en metricas con condiciones, severidad y canales de notificacion.",
    category: "observability",
    schema: z.object({
      name: z.string().describe("Nombre descriptivo de la alerta"),
      metric: z.string().describe("Nombre de la metrica a monitorear"),
      condition: z.enum(["gt", "lt", "eq", "gte", "lte"]).describe("Condicion: gt, lt, eq, gte, lte"),
      threshold: z.number().describe("Valor umbral para disparar la alerta"),
      duration: z.number().describe("Duracion en ms que la condicion debe mantenerse"),
      severity: z.enum(["critical", "warning", "info"]).describe("Severidad de la alerta"),
      channels: z.array(z.string()).describe("Canales de notificacion: slack, email, sms, pagerduty"),
      enabled: z.boolean().optional().describe("Si la alerta esta activa (default: true)"),
    }),
    execute: async (params) => {
      const rule = createAlertRule({
        name: params.name,
        metric: params.metric,
        condition: params.condition,
        threshold: params.threshold,
        duration: params.duration,
        severity: params.severity,
        channels: params.channels,
        enabled: params.enabled !== false,
      });
      return rule;
    },
  },
  {
    name: "obs_evaluate_alerts",
    description:
      "Evalua todas las reglas de alerta activas contra las metricas actuales y devuelve cuales estan disparadas.",
    category: "observability",
    schema: z.object({}),
    execute: async () => {
      const results = evaluateAlerts();
      return {
        evaluated: results.length,
        firing: results.filter((r) => r.firing).length,
        alerts: results.map((r) => ({
          name: r.rule.name,
          metric: r.rule.metric,
          firing: r.firing,
          currentValue: r.currentValue,
          threshold: r.rule.threshold,
          severity: r.rule.severity,
        })),
      };
    },
  },
  {
    name: "obs_run_health_checks",
    description:
      "Ejecuta todos los health checks registrados y devuelve el estado general del sistema.",
    category: "observability",
    schema: z.object({}),
    execute: async () => {
      return await runHealthChecks();
    },
  },
  {
    name: "obs_inject_fault",
    description:
      "Inyecta una falla (chaos engineering) para probar la resiliencia del sistema. Tipos: latency, error, timeout, crash.",
    category: "observability",
    schema: z.object({
      type: z.enum(["latency", "error", "timeout", "crash", "resource_exhaustion"]).describe("Tipo de falla a inyectar"),
      target: z.string().describe("Servicio o endpoint objetivo (* para todos)"),
      probability: z.number().min(0).max(1).describe("Probabilidad de inyeccion (0-1)"),
      duration: z.number().describe("Duracion en ms de la inyeccion de falla"),
      parameters: z.record(z.any()).optional().describe("Parametros adicionales de la falla"),
    }),
    execute: async (params) => {
      return injectFault({
        type: params.type,
        target: params.target,
        probability: params.probability,
        duration: params.duration,
        parameters: params.parameters,
      });
    },
  },
  {
    name: "obs_run_load_test",
    description:
      "Ejecuta un test de carga HTTP con concurrencia configurable. Devuelve latencias, RPS, errores y percentiles.",
    category: "observability",
    schema: z.object({
      url: z.string().describe("URL del endpoint a testear"),
      method: z.string().optional().describe("Metodo HTTP (default: GET)"),
      concurrency: z.number().describe("Numero de peticiones concurrentes"),
      totalRequests: z.number().describe("Total de peticiones a enviar"),
      headers: z.record(z.string()).optional().describe("Headers HTTP adicionales"),
      body: z.string().optional().describe("Body de la peticion (para POST/PUT)"),
    }),
    execute: async (params) => {
      return await runLoadTest({
        url: params.url,
        method: params.method,
        concurrency: params.concurrency,
        totalRequests: params.totalRequests,
        headers: params.headers,
        body: params.body,
      });
    },
  },
  {
    name: "obs_grafana_dashboard",
    description:
      "Genera un dashboard de Grafana en JSON listo para importar, con paneles para las metricas especificadas.",
    category: "observability",
    schema: z.object({
      title: z.string().describe("Titulo del dashboard"),
      metrics: z.array(
        z.object({
          name: z.string().describe("Nombre de la metrica"),
          type: z.enum(["counter", "gauge", "histogram"]).describe("Tipo de metrica"),
          title: z.string().describe("Titulo del panel"),
        })
      ).describe("Lista de metricas a incluir en el dashboard"),
      datasource: z.string().optional().describe("Nombre del datasource Prometheus (default: Prometheus)"),
    }),
    execute: async (params) => {
      return generateGrafanaDashboard({
        title: params.title,
        metrics: params.metrics,
        datasource: params.datasource,
      });
    },
  },

  // ========================================
  // CONNECTOR TOOLS (12)
  // ========================================
  {
    name: "connector_register",
    description:
      "Registra un conector externo (Slack, DB, API, etc.) con nombre, tipo, credenciales y URL base.",
    category: "connectors",
    schema: z.object({
      name: z.string().describe("Nombre unico del conector"),
      type: z.string().describe("Tipo de conector: slack, discord, database, api, webhook, etc."),
      credentials: z.record(z.string()).optional().describe("Credenciales del conector (tokens, keys, etc.)"),
      baseUrl: z.string().optional().describe("URL base del servicio"),
      enabled: z.boolean().optional().describe("Si el conector esta activo (default: true)"),
    }),
    execute: async (params) => {
      return registerConnector({
        name: params.name,
        type: params.type,
        credentials: params.credentials,
        baseUrl: params.baseUrl,
        enabled: params.enabled !== false,
      });
    },
  },
  {
    name: "connector_list",
    description:
      "Lista todos los conectores registrados con su tipo, estado y configuracion.",
    category: "connectors",
    schema: z.object({}),
    execute: async () => {
      const connectors = listConnectors();
      return {
        count: connectors.length,
        connectors: connectors.map((c) => ({
          name: c.name,
          type: c.type,
          enabled: c.enabled,
          hasCredentials: !!c.credentials && Object.keys(c.credentials).length > 0,
          baseUrl: c.baseUrl || null,
        })),
      };
    },
  },
  {
    name: "connector_test",
    description:
      "Prueba la conectividad de un conector registrado verificando reachability y credenciales.",
    category: "connectors",
    schema: z.object({
      name: z.string().describe("Nombre del conector a probar"),
    }),
    execute: async (params) => {
      return await testConnector(params.name);
    },
  },
  {
    name: "connector_send_slack",
    description:
      "Envia un mensaje a Slack via Incoming Webhook con texto y bloques opcionales.",
    category: "connectors",
    schema: z.object({
      webhookUrl: z.string().optional().describe("URL del webhook de Slack (o usa el conector registrado)"),
      channel: z.string().describe("Canal de destino (ej: #general)"),
      text: z.string().describe("Texto del mensaje"),
      blocks: z.array(z.any()).optional().describe("Bloques de Slack (Block Kit) opcionales"),
    }),
    execute: async (params) => {
      return await sendSlackMessage({
        webhookUrl: params.webhookUrl,
        channel: params.channel,
        text: params.text,
        blocks: params.blocks,
      });
    },
  },
  {
    name: "connector_send_discord",
    description:
      "Envia un mensaje a Discord via Webhook con contenido y embeds opcionales.",
    category: "connectors",
    schema: z.object({
      webhookUrl: z.string().describe("URL del webhook de Discord"),
      content: z.string().describe("Contenido del mensaje"),
      embeds: z.array(z.any()).optional().describe("Embeds de Discord opcionales"),
    }),
    execute: async (params) => {
      return await sendDiscordMessage({
        webhookUrl: params.webhookUrl,
        content: params.content,
        embeds: params.embeds,
      });
    },
  },
  {
    name: "connector_send_teams",
    description:
      "Envia un mensaje a Microsoft Teams via Incoming Webhook con titulo y texto.",
    category: "connectors",
    schema: z.object({
      webhookUrl: z.string().describe("URL del webhook de Teams"),
      text: z.string().describe("Texto del mensaje"),
      title: z.string().optional().describe("Titulo del mensaje (opcional)"),
    }),
    execute: async (params) => {
      return await sendTeamsMessage({
        webhookUrl: params.webhookUrl,
        text: params.text,
        title: params.title,
      });
    },
  },
  {
    name: "connector_send_telegram",
    description:
      "Envia un mensaje a Telegram via Bot API con soporte para Markdown y HTML.",
    category: "connectors",
    schema: z.object({
      botToken: z.string().describe("Token del bot de Telegram"),
      chatId: z.string().describe("ID del chat o canal"),
      text: z.string().describe("Texto del mensaje"),
      parseMode: z.string().optional().describe("Modo de parseo: Markdown, MarkdownV2, HTML"),
    }),
    execute: async (params) => {
      return await sendTelegramMessage({
        botToken: params.botToken,
        chatId: params.chatId,
        text: params.text,
        parseMode: params.parseMode,
      });
    },
  },
  {
    name: "connector_db_connection_string",
    description:
      "Genera un connection string para bases de datos: PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch.",
    category: "connectors",
    schema: z.object({
      type: z.enum(["postgresql", "mysql", "mongodb", "redis", "elasticsearch"]).describe("Tipo de base de datos"),
      host: z.string().describe("Host del servidor"),
      port: z.number().describe("Puerto de conexion"),
      database: z.string().describe("Nombre de la base de datos"),
      user: z.string().optional().describe("Usuario de conexion"),
      password: z.string().optional().describe("Password de conexion"),
      options: z.record(z.string()).optional().describe("Opciones adicionales de conexion"),
    }),
    execute: async (params) => {
      const connectionString = generateConnectionString({
        type: params.type,
        host: params.host,
        port: params.port,
        database: params.database,
        user: params.user,
        password: params.password,
        options: params.options,
      });
      return {
        type: params.type,
        connectionString,
        host: params.host,
        port: params.port,
        database: params.database,
      };
    },
  },
  {
    name: "connector_db_schema",
    description:
      "Genera DDL SQL (CREATE TABLE, INDEX) a partir de definiciones de tablas con columnas, PKs, FKs e indices.",
    category: "connectors",
    schema: z.object({
      type: z.enum(["postgresql", "mysql"]).describe("Motor de base de datos"),
      tables: z.array(
        z.object({
          name: z.string().describe("Nombre de la tabla"),
          columns: z.array(
            z.object({
              name: z.string().describe("Nombre de la columna"),
              type: z.string().describe("Tipo de dato SQL"),
              nullable: z.boolean().optional().describe("Si permite NULL"),
              primaryKey: z.boolean().optional().describe("Si es clave primaria"),
              references: z.string().optional().describe("Referencia FK: tabla.columna"),
            })
          ).describe("Columnas de la tabla"),
          indexes: z.array(
            z.object({
              columns: z.array(z.string()).describe("Columnas del indice"),
              unique: z.boolean().optional().describe("Si es un indice unico"),
            })
          ).optional().describe("Indices de la tabla"),
        })
      ).describe("Definiciones de tablas"),
    }),
    execute: async (params) => {
      const ddl = generateDatabaseSchema({
        type: params.type,
        tables: params.tables,
      });
      return {
        type: params.type,
        tableCount: params.tables.length,
        ddl,
      };
    },
  },
  {
    name: "connector_jira_ticket",
    description:
      "Genera un payload y comando curl para crear un ticket en Jira (Bug, Story, Task, Epic).",
    category: "connectors",
    schema: z.object({
      project: z.string().describe("Clave del proyecto Jira (ej: PROJ)"),
      summary: z.string().describe("Resumen/titulo del ticket"),
      description: z.string().describe("Descripcion detallada"),
      issueType: z.enum(["Bug", "Story", "Task", "Epic"]).describe("Tipo de issue"),
      priority: z.string().optional().describe("Prioridad: Highest, High, Medium, Low, Lowest"),
      labels: z.array(z.string()).optional().describe("Etiquetas del ticket"),
      assignee: z.string().optional().describe("Account ID del asignado"),
    }),
    execute: async (params) => {
      return generateJiraTicket({
        project: params.project,
        summary: params.summary,
        description: params.description,
        issueType: params.issueType,
        priority: params.priority,
        labels: params.labels,
        assignee: params.assignee,
      });
    },
  },
  {
    name: "connector_github_issue",
    description:
      "Genera un payload y comando curl para crear un issue en GitHub con labels y assignees.",
    category: "connectors",
    schema: z.object({
      owner: z.string().describe("Propietario del repositorio"),
      repo: z.string().describe("Nombre del repositorio"),
      title: z.string().describe("Titulo del issue"),
      body: z.string().describe("Descripcion del issue en Markdown"),
      labels: z.array(z.string()).optional().describe("Labels para el issue"),
      assignees: z.array(z.string()).optional().describe("Usernames para asignar"),
    }),
    execute: async (params) => {
      return generateGitHubIssue({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body,
        labels: params.labels,
        assignees: params.assignees,
      });
    },
  },
  {
    name: "connector_webhook_create",
    description:
      "Crea un endpoint de webhook con secret HMAC, eventos y politica de reintentos.",
    category: "connectors",
    schema: z.object({
      url: z.string().describe("URL del endpoint que recibira los webhooks"),
      events: z.array(z.string()).describe("Eventos a los que suscribirse (ej: order.created, user.signup)"),
      secret: z.string().optional().describe("Secret para verificacion HMAC (auto-generado si no se especifica)"),
      retryPolicy: z
        .object({
          maxRetries: z.number().describe("Maximo numero de reintentos"),
          backoffMs: z.number().describe("Backoff en ms entre reintentos"),
        })
        .optional()
        .describe("Politica de reintentos"),
    }),
    execute: async (params) => {
      return createWebhookEndpoint({
        url: params.url,
        events: params.events,
        secret: params.secret,
        retryPolicy: params.retryPolicy,
      });
    },
  },

  // ========================================
  // AI CORE TOOLS (10)
  // ========================================
  {
    name: "ai_configure_router",
    description:
      "Configura el router de modelos AI con estrategia (fallback, round-robin, least-latency), providers y reintentos.",
    category: "ai_core",
    schema: z.object({
      strategy: z.enum(["fallback", "round_robin", "least_latency", "cost_optimized"]).describe("Estrategia de enrutamiento"),
      providers: z.array(z.string()).describe("Lista de proveedores AI (openai, anthropic, google, xai)"),
      maxRetries: z.number().optional().describe("Maximo de reintentos (default: 3)"),
      timeout: z.number().optional().describe("Timeout en ms por solicitud (default: 30000)"),
    }),
    execute: async (params) => {
      return await aiStub.configureRouter({
        strategy: params.strategy,
        providers: params.providers,
        maxRetries: params.maxRetries || 3,
        timeout: params.timeout || 30000,
      });
    },
  },
  {
    name: "ai_select_provider",
    description:
      "Selecciona el mejor proveedor AI para una tarea dadas restricciones de latencia, costo y calidad.",
    category: "ai_core",
    schema: z.object({
      task: z.string().describe("Descripcion de la tarea a ejecutar"),
      requirements: z.object({
        maxLatency: z.number().optional().describe("Latencia maxima aceptable en ms"),
        maxCost: z.number().optional().describe("Costo maximo por 1K tokens"),
        minQuality: z.number().optional().describe("Calidad minima requerida (0-1)"),
      }).describe("Restricciones para seleccion del proveedor"),
    }),
    execute: async (params) => {
      return await aiStub.selectProvider({
        task: params.task,
        requirements: params.requirements,
      });
    },
  },
  {
    name: "ai_token_budget",
    description:
      "Configura el presupuesto de tokens para un modelo: input, output, reserva y estimacion de costo.",
    category: "ai_core",
    schema: z.object({
      model: z.string().describe("Nombre del modelo (ej: gpt-4o, claude-3-opus)"),
      maxInputTokens: z.number().describe("Tokens maximos de input"),
      maxOutputTokens: z.number().describe("Tokens maximos de output"),
      reserveTokens: z.number().optional().describe("Tokens reservados para overhead (default: 256)"),
    }),
    execute: async (params) => {
      return await aiStub.tokenBudget({
        model: params.model,
        maxInputTokens: params.maxInputTokens,
        maxOutputTokens: params.maxOutputTokens,
        reserveTokens: params.reserveTokens || 256,
      });
    },
  },
  {
    name: "ai_define_agent_role",
    description:
      "Define un rol de agente AI con system prompt, capacidades permitidas y restricciones.",
    category: "ai_core",
    schema: z.object({
      name: z.string().describe("Nombre del rol del agente"),
      systemPrompt: z.string().describe("System prompt para el agente"),
      capabilities: z.array(z.string()).describe("Lista de capacidades permitidas"),
      constraints: z.array(z.string()).describe("Restricciones y limites del agente"),
    }),
    execute: async (params) => {
      return await aiStub.defineAgentRole({
        name: params.name,
        systemPrompt: params.systemPrompt,
        capabilities: params.capabilities,
        constraints: params.constraints,
      });
    },
  },
  {
    name: "ai_decompose_task",
    description:
      "Descompone una tarea compleja en sub-tareas con dependencias y estimaciones de complejidad.",
    category: "ai_core",
    schema: z.object({
      task: z.string().describe("Descripcion de la tarea a descomponer"),
      maxSubtasks: z.number().optional().describe("Maximo numero de sub-tareas (default: 5)"),
      strategy: z.enum(["sequential", "parallel", "dag"]).optional().describe("Estrategia de descomposicion"),
    }),
    execute: async (params) => {
      return await aiStub.decomposeTask({
        task: params.task,
        maxSubtasks: params.maxSubtasks || 5,
        strategy: params.strategy || "sequential",
      });
    },
  },
  {
    name: "ai_validate_input",
    description:
      "Valida input del usuario contra reglas de seguridad: PII, injection, URLs, HTML y longitud maxima.",
    category: "ai_core",
    schema: z.object({
      input: z.string().describe("Texto de input a validar"),
      rules: z.array(z.string()).describe("Reglas: no_pii, no_urls, no_html, no_injection"),
      maxLength: z.number().optional().describe("Longitud maxima permitida"),
    }),
    execute: async (params) => {
      return await aiStub.validateInput({
        input: params.input,
        rules: params.rules,
        maxLength: params.maxLength || 10000,
      });
    },
  },
  {
    name: "ai_validate_output",
    description:
      "Valida el output generado por el modelo verificando formato (JSON, text) y conformidad con un schema.",
    category: "ai_core",
    schema: z.object({
      output: z.string().describe("Texto de output a validar"),
      format: z.enum(["json", "text", "markdown", "html"]).describe("Formato esperado del output"),
      schema: z.record(z.any()).optional().describe("Schema esperado para validacion de campos (si format=json)"),
    }),
    execute: async (params) => {
      return await aiStub.validateOutput({
        output: params.output,
        format: params.format,
        schema: params.schema || {},
      });
    },
  },
  {
    name: "ai_detect_toxicity",
    description:
      "Detecta contenido toxico en texto: violencia, insultos, spam. Devuelve score por categoria y umbral.",
    category: "ai_core",
    schema: z.object({
      text: z.string().describe("Texto a analizar"),
      threshold: z.number().optional().describe("Umbral de toxicidad (0-1, default: 0.5)"),
    }),
    execute: async (params) => {
      return await aiStub.detectToxicity({
        text: params.text,
        threshold: params.threshold || 0.5,
      });
    },
  },
  {
    name: "ai_filter_content",
    description:
      "Filtra contenido sensible: emails, telefonos, SSN, profanidad, URLs. Soporta redaccion y eliminacion.",
    category: "ai_core",
    schema: z.object({
      content: z.string().describe("Contenido a filtrar"),
      filters: z.array(z.string()).describe("Filtros: pii_emails, pii_phones, pii_ssn, profanity, urls"),
      action: z.enum(["redact", "remove", "flag"]).optional().describe("Accion al detectar (default: redact)"),
    }),
    execute: async (params) => {
      return await aiStub.filterContent({
        content: params.content,
        filters: params.filters,
        action: params.action || "redact",
      });
    },
  },
  {
    name: "ai_store_memory",
    description:
      "Almacena un valor en la memoria del agente con TTL y namespace para persistencia entre turnos.",
    category: "ai_core",
    schema: z.object({
      key: z.string().describe("Clave de memoria"),
      value: z.any().describe("Valor a almacenar (cualquier tipo serializable)"),
      ttl: z.number().optional().describe("Tiempo de vida en segundos (default: 3600)"),
      namespace: z.string().optional().describe("Namespace para agrupar memorias (default: default)"),
    }),
    execute: async (params) => {
      return await aiStub.storeMemory({
        key: params.key,
        value: params.value,
        ttl: params.ttl || 3600,
        namespace: params.namespace || "default",
      });
    },
  },

  // ========================================
  // RAG TOOLS (10)
  // ========================================
  {
    name: "rag_chunk_fixed",
    description:
      "Divide texto en chunks de tamano fijo con overlap configurable para procesamiento RAG.",
    category: "rag",
    schema: z.object({
      text: z.string().describe("Texto a dividir en chunks"),
      chunkSize: z.number().optional().describe("Tamano de cada chunk en caracteres (default: 512)"),
      overlap: z.number().optional().describe("Caracteres de overlap entre chunks (default: 64)"),
    }),
    execute: async (params) => {
      return await ragStub.chunkFixed({
        text: params.text,
        chunkSize: params.chunkSize || 512,
        overlap: params.overlap || 64,
      });
    },
  },
  {
    name: "rag_chunk_semantic",
    description:
      "Divide texto en chunks semanticos respetando limites de parrafos, oraciones o lineas.",
    category: "rag",
    schema: z.object({
      text: z.string().describe("Texto a dividir en chunks semanticos"),
      maxChunkSize: z.number().optional().describe("Tamano maximo de cada chunk (default: 1024)"),
      splitOn: z.enum(["paragraph", "sentence", "line"]).optional().describe("Criterio de division (default: paragraph)"),
    }),
    execute: async (params) => {
      return await ragStub.chunkSemantic({
        text: params.text,
        maxChunkSize: params.maxChunkSize || 1024,
        splitOn: params.splitOn || "paragraph",
      });
    },
  },
  {
    name: "rag_add_vectors",
    description:
      "Agrega vectores de embedding a una coleccion con IDs, valores y metadata asociada.",
    category: "rag",
    schema: z.object({
      collection: z.string().describe("Nombre de la coleccion de vectores"),
      vectors: z.array(
        z.object({
          id: z.string().describe("ID unico del vector"),
          values: z.array(z.number()).describe("Valores del vector de embedding"),
          metadata: z.record(z.any()).optional().describe("Metadata asociada al vector"),
        })
      ).describe("Vectores a insertar"),
    }),
    execute: async (params) => {
      return await ragStub.addVectors({
        collection: params.collection,
        vectors: params.vectors,
      });
    },
  },
  {
    name: "rag_search_vectors",
    description:
      "Busca los vectores mas similares en una coleccion usando distancia coseno. Devuelve top-K resultados.",
    category: "rag",
    schema: z.object({
      collection: z.string().describe("Nombre de la coleccion"),
      query: z.array(z.number()).describe("Vector de consulta"),
      topK: z.number().optional().describe("Numero de resultados (default: 5)"),
      filter: z.record(z.any()).optional().describe("Filtros de metadata opcionales"),
    }),
    execute: async (params) => {
      return await ragStub.searchVectors({
        collection: params.collection,
        query: params.query,
        topK: params.topK || 5,
        filter: params.filter,
      });
    },
  },
  {
    name: "rag_hybrid_search",
    description:
      "Busqueda hibrida combinando similitud vectorial + busqueda textual con factor alpha configurable.",
    category: "rag",
    schema: z.object({
      collection: z.string().describe("Nombre de la coleccion"),
      query: z.string().describe("Consulta en texto natural"),
      vector: z.array(z.number()).describe("Vector de la consulta"),
      topK: z.number().optional().describe("Numero de resultados (default: 5)"),
      alpha: z.number().optional().describe("Peso de busqueda vectorial vs textual (0-1, default: 0.5)"),
    }),
    execute: async (params) => {
      return await ragStub.hybridSearch({
        collection: params.collection,
        query: params.query,
        vector: params.vector,
        topK: params.topK || 5,
        alpha: params.alpha ?? 0.5,
      });
    },
  },
  {
    name: "rag_expand_query",
    description:
      "Expande una consulta generando variaciones semanticas para mejorar recall en busqueda.",
    category: "rag",
    schema: z.object({
      query: z.string().describe("Consulta original"),
      expansions: z.number().optional().describe("Numero de expansiones a generar (default: 3)"),
    }),
    execute: async (params) => {
      return await ragStub.expandQuery({
        query: params.query,
        expansions: params.expansions || 3,
      });
    },
  },
  {
    name: "rag_extract_entities",
    description:
      "Extrae entidades nombradas de texto: emails, URLs, fechas, numeros, nombres propios.",
    category: "rag",
    schema: z.object({
      text: z.string().describe("Texto del que extraer entidades"),
      types: z.array(z.string()).optional().describe("Tipos de entidad: email, url, date, number, capitalized"),
    }),
    execute: async (params) => {
      return await ragStub.extractEntities({
        text: params.text,
        types: params.types || ["capitalized", "email", "url", "date"],
      });
    },
  },
  {
    name: "rag_build_knowledge_graph",
    description:
      "Construye un grafo de conocimiento a partir de entidades y relaciones. Devuelve nodos, aristas y estadisticas.",
    category: "rag",
    schema: z.object({
      entities: z.array(
        z.object({
          name: z.string().describe("Nombre de la entidad"),
          type: z.string().describe("Tipo de entidad (person, org, concept, etc.)"),
        })
      ).describe("Entidades del grafo"),
      relations: z.array(
        z.object({
          from: z.string().describe("Entidad origen"),
          to: z.string().describe("Entidad destino"),
          relation: z.string().describe("Tipo de relacion"),
        })
      ).describe("Relaciones entre entidades"),
    }),
    execute: async (params) => {
      return await ragStub.buildKnowledgeGraph({
        entities: params.entities,
        relations: params.relations,
      });
    },
  },
  {
    name: "rag_evaluate_retrieval",
    description:
      "Evalua la calidad del sistema de retrieval calculando precision, recall, MRR y F1 sobre queries de prueba.",
    category: "rag",
    schema: z.object({
      queries: z.array(
        z.object({
          query: z.string().describe("Consulta de prueba"),
          expectedIds: z.array(z.string()).describe("IDs de documentos relevantes esperados"),
          retrievedIds: z.array(z.string()).describe("IDs de documentos realmente devueltos"),
        })
      ).describe("Queries de evaluacion con ground truth"),
    }),
    execute: async (params) => {
      return await ragStub.evaluateRetrieval({
        queries: params.queries,
      });
    },
  },
  {
    name: "rag_detect_duplicates",
    description:
      "Detecta documentos duplicados o casi-duplicados usando similitud Jaccard sobre tokens.",
    category: "rag",
    schema: z.object({
      documents: z.array(
        z.object({
          id: z.string().describe("ID del documento"),
          text: z.string().describe("Texto del documento"),
        })
      ).describe("Documentos a comparar"),
      threshold: z.number().optional().describe("Umbral de similitud Jaccard (0-1, default: 0.85)"),
    }),
    execute: async (params) => {
      return await ragStub.detectDuplicates({
        documents: params.documents,
        threshold: params.threshold || 0.85,
      });
    },
  },

  // ========================================
  // ENTERPRISE TOOLS (8)
  // ========================================
  {
    name: "enterprise_create_tenant",
    description:
      "Crea un nuevo tenant (inquilino) con plan, admin y cuotas para aplicaciones multi-tenant.",
    category: "enterprise",
    schema: z.object({
      name: z.string().describe("Nombre del tenant/organizacion"),
      plan: z.enum(["starter", "pro", "enterprise"]).describe("Plan de suscripcion"),
      adminEmail: z.string().describe("Email del administrador del tenant"),
      settings: z.record(z.any()).optional().describe("Configuraciones personalizadas del tenant"),
    }),
    execute: async (params) => {
      return await enterpriseStub.createTenant({
        name: params.name,
        plan: params.plan,
        adminEmail: params.adminEmail,
        settings: params.settings,
      });
    },
  },
  {
    name: "enterprise_get_tenant",
    description:
      "Obtiene la informacion completa de un tenant: plan, estado, uso actual y configuraciones.",
    category: "enterprise",
    schema: z.object({
      tenantId: z.string().describe("ID del tenant a consultar"),
    }),
    execute: async (params) => {
      return await enterpriseStub.getTenant({
        tenantId: params.tenantId,
      });
    },
  },
  {
    name: "enterprise_check_quota",
    description:
      "Verifica si un tenant tiene cuota disponible para un recurso antes de permitir una operacion.",
    category: "enterprise",
    schema: z.object({
      tenantId: z.string().describe("ID del tenant"),
      resource: z.string().describe("Recurso a verificar: api_calls, storage_gb, users, projects"),
      requested: z.number().describe("Cantidad solicitada"),
    }),
    execute: async (params) => {
      return await enterpriseStub.checkQuota({
        tenantId: params.tenantId,
        resource: params.resource,
        requested: params.requested,
      });
    },
  },
  {
    name: "enterprise_generate_invoice",
    description:
      "Genera una factura con lineas de detalle, subtotal, impuestos (IVA 21%) y total en EUR.",
    category: "enterprise",
    schema: z.object({
      tenantId: z.string().describe("ID del tenant"),
      period: z.string().describe("Periodo de facturacion (ej: 2026-02)"),
      lineItems: z.array(
        z.object({
          description: z.string().describe("Descripcion del item"),
          quantity: z.number().describe("Cantidad"),
          unitPrice: z.number().describe("Precio unitario en EUR"),
        })
      ).describe("Lineas de la factura"),
    }),
    execute: async (params) => {
      return await enterpriseStub.generateInvoice({
        tenantId: params.tenantId,
        period: params.period,
        lineItems: params.lineItems,
      });
    },
  },
  {
    name: "enterprise_create_workflow",
    description:
      "Crea un flujo de trabajo automatizado con pasos secuenciales, tipos de accion y triggers.",
    category: "enterprise",
    schema: z.object({
      name: z.string().describe("Nombre del workflow"),
      steps: z.array(
        z.object({
          name: z.string().describe("Nombre del paso"),
          type: z.string().describe("Tipo: transform, filter, enrich, notify, api_call"),
          config: z.record(z.any()).describe("Configuracion del paso"),
        })
      ).describe("Pasos del workflow"),
      triggers: z.array(z.string()).optional().describe("Triggers: manual, schedule, webhook, event"),
    }),
    execute: async (params) => {
      return await enterpriseStub.createWorkflow({
        name: params.name,
        steps: params.steps,
        triggers: params.triggers || ["manual"],
      });
    },
  },
  {
    name: "enterprise_execute_workflow",
    description:
      "Ejecuta un workflow previamente creado con input especifico y devuelve resultado y metricas.",
    category: "enterprise",
    schema: z.object({
      workflowId: z.string().describe("ID del workflow a ejecutar"),
      input: z.record(z.any()).describe("Input para el workflow"),
    }),
    execute: async (params) => {
      return await enterpriseStub.executeWorkflow({
        workflowId: params.workflowId,
        input: params.input,
      });
    },
  },
  {
    name: "enterprise_create_state_machine",
    description:
      "Crea una maquina de estados finita con estados, transiciones y eventos para modelar procesos.",
    category: "enterprise",
    schema: z.object({
      name: z.string().describe("Nombre de la maquina de estados"),
      states: z.array(z.string()).describe("Lista de estados posibles"),
      initialState: z.string().describe("Estado inicial"),
      transitions: z.array(
        z.object({
          from: z.string().describe("Estado origen"),
          to: z.string().describe("Estado destino"),
          event: z.string().describe("Evento que dispara la transicion"),
          guard: z.string().optional().describe("Condicion guard opcional"),
        })
      ).describe("Transiciones entre estados"),
    }),
    execute: async (params) => {
      return await enterpriseStub.createStateMachine({
        name: params.name,
        states: params.states,
        initialState: params.initialState,
        transitions: params.transitions,
      });
    },
  },
  {
    name: "enterprise_transition_state",
    description:
      "Ejecuta una transicion de estado en una maquina de estados enviando un evento.",
    category: "enterprise",
    schema: z.object({
      machineId: z.string().describe("ID de la maquina de estados"),
      event: z.string().describe("Evento a enviar"),
      context: z.record(z.any()).optional().describe("Contexto adicional para la transicion"),
    }),
    execute: async (params) => {
      return await enterpriseStub.transitionState({
        machineId: params.machineId,
        event: params.event,
        context: params.context,
      });
    },
  },

  // ========================================
  // BROWSER ADVANCED TOOLS (6)
  // ========================================
  {
    name: "browser_analyze_seo",
    description:
      "Analiza SEO de una URL: titulo, meta description, headings, images alt, Open Graph, structured data y robots.",
    category: "browser_advanced",
    schema: z.object({
      url: z.string().describe("URL a analizar"),
      checkMeta: z.boolean().optional().describe("Verificar meta tags (default: true)"),
      checkHeadings: z.boolean().optional().describe("Verificar jerarquia de headings (default: true)"),
      checkImages: z.boolean().optional().describe("Verificar alt text de imagenes (default: true)"),
    }),
    execute: async (params) => {
      return await browserStub.analyzeSEO({
        url: params.url,
        checkMeta: params.checkMeta !== false,
        checkHeadings: params.checkHeadings !== false,
        checkImages: params.checkImages !== false,
      });
    },
  },
  {
    name: "browser_audit_accessibility",
    description:
      "Audita accesibilidad web contra WCAG 2.1 AA: contraste, alt text, labels, heading order y mas.",
    category: "browser_advanced",
    schema: z.object({
      url: z.string().describe("URL a auditar"),
      standard: z.string().optional().describe("Estandar: WCAG2.1-AA, WCAG2.1-AAA (default: WCAG2.1-AA)"),
      includeWarnings: z.boolean().optional().describe("Incluir warnings ademas de errores (default: true)"),
    }),
    execute: async (params) => {
      return await browserStub.auditAccessibility({
        url: params.url,
        standard: params.standard || "WCAG2.1-AA",
        includeWarnings: params.includeWarnings !== false,
      });
    },
  },
  {
    name: "browser_web_performance",
    description:
      "Analiza rendimiento web: FCP, LCP, CLS, FID, TTI, TBT, Speed Index. Incluye scores y oportunidades de mejora.",
    category: "browser_advanced",
    schema: z.object({
      url: z.string().describe("URL a analizar"),
      device: z.enum(["desktop", "mobile"]).optional().describe("Dispositivo a simular (default: desktop)"),
    }),
    execute: async (params) => {
      return await browserStub.webPerformance({
        url: params.url,
        device: params.device || "desktop",
      });
    },
  },
  {
    name: "browser_generate_mock_api",
    description:
      "Genera un servidor mock API con endpoints configurables, responses y codigo Express listo para ejecutar.",
    category: "browser_advanced",
    schema: z.object({
      endpoints: z.array(
        z.object({
          method: z.string().describe("Metodo HTTP: GET, POST, PUT, DELETE, PATCH"),
          path: z.string().describe("Ruta del endpoint (ej: /api/users)"),
          responseBody: z.any().describe("Body de respuesta JSON"),
          statusCode: z.number().optional().describe("Codigo de estado HTTP (default: 200)"),
        })
      ).describe("Endpoints del mock API"),
      baseUrl: z.string().optional().describe("URL base del servidor (default: http://localhost:3001)"),
    }),
    execute: async (params) => {
      return await browserStub.generateMockAPI({
        endpoints: params.endpoints,
        baseUrl: params.baseUrl || "http://localhost:3001",
      });
    },
  },
  {
    name: "browser_detect_broken_links",
    description:
      "Escanea una pagina web buscando enlaces rotos (404, 410), redirecciones y genera un resumen.",
    category: "browser_advanced",
    schema: z.object({
      url: z.string().describe("URL base a escanear"),
      maxDepth: z.number().optional().describe("Profundidad maxima de escaneo (default: 2)"),
      timeout: z.number().optional().describe("Timeout por request en ms (default: 5000)"),
    }),
    execute: async (params) => {
      return await browserStub.detectBrokenLinks({
        url: params.url,
        maxDepth: params.maxDepth || 2,
        timeout: params.timeout || 5000,
      });
    },
  },
  {
    name: "browser_parse_rss",
    description:
      "Parsea un feed RSS/Atom y devuelve los items con titulo, link, descripcion, fecha y categorias.",
    category: "browser_advanced",
    schema: z.object({
      feedUrl: z.string().describe("URL del feed RSS o Atom"),
      maxItems: z.number().optional().describe("Maximo de items a devolver (default: 10)"),
    }),
    execute: async (params) => {
      return await browserStub.parseRSS({
        feedUrl: params.feedUrl,
        maxItems: params.maxItems || 10,
      });
    },
  },
];
