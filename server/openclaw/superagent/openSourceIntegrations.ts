/**
 * Open Source Integrations Registry
 *
 * Catalogs and manages integrations with best-in-class open source projects
 * that enhance the SuperAgent platform.
 *
 * Recommended integrations:
 * 1. Composio (ComposioHQ/composio) — 500+ tool connectors, managed auth
 * 2. LiteLLM (BerriAI/litellm) — Multi-model proxy, unified API gateway
 * 3. Trigger.dev (triggerdotdev/trigger.dev) — Durable background jobs
 * 4. browser-use — AI-driven browser automation
 * 5. LangGraph — Structured agent workflows
 * 6. CrewAI — Multi-agent collaboration
 * 7. n8n (n8n-io/n8n) — Workflow automation
 * 8. Temporal — Durable execution engine
 */

import { Logger } from '../../lib/logger';
import { FEATURE_FLAGS } from '../../openclaw.config';

export interface OpenSourceProject {
  id: string;
  name: string;
  repository: string;
  description: string;
  category: IntegrationCategory;
  license: string;
  stars?: string;
  status: 'integrated' | 'planned' | 'evaluating' | 'available';
  integrationPath?: string;
  capabilities: string[];
  installCommand?: string;
  configKey?: string;
}

export type IntegrationCategory =
  | 'model-routing'
  | 'agent-framework'
  | 'browser-automation'
  | 'background-tasks'
  | 'tool-integration'
  | 'workflow-automation'
  | 'observability'
  | 'vector-database'
  | 'search';

const OPEN_SOURCE_CATALOG: OpenSourceProject[] = [
  // ═══ MODEL ROUTING ═══
  {
    id: 'litellm',
    name: 'LiteLLM',
    repository: 'https://github.com/BerriAI/litellm',
    description: 'AI Gateway & Proxy to call 100+ LLM APIs with unified OpenAI-compatible format, cost tracking, load balancing, and guardrails',
    category: 'model-routing',
    license: 'MIT',
    stars: '20k+',
    status: 'integrated',
    integrationPath: 'server/openclaw.config.ts',
    capabilities: ['multi-model-routing', 'cost-tracking', 'load-balancing', 'fallback-chains', 'rate-limiting', 'caching'],
    installCommand: 'pip install litellm',
    configKey: 'LITELLM_PROXY_URL',
  },

  // ═══ TOOL INTEGRATION ═══
  {
    id: 'composio',
    name: 'Composio',
    repository: 'https://github.com/ComposioHQ/composio',
    description: '500+ app integrations with managed auth, tool search, and sandboxed execution for AI agents',
    category: 'tool-integration',
    license: 'MIT',
    stars: '27k+',
    status: 'integrated',
    integrationPath: 'server/openclaw/superagent/toolConnectorFramework.ts',
    capabilities: ['500-plus-apps', 'managed-auth', 'tool-search', 'sandboxed-execution', 'framework-agnostic'],
    installCommand: 'npm install composio-core',
    configKey: 'COMPOSIO_API_KEY',
  },

  // ═══ BACKGROUND TASKS ═══
  {
    id: 'trigger-dev',
    name: 'Trigger.dev',
    repository: 'https://github.com/triggerdotdev/trigger.dev',
    description: 'Open source background jobs framework for durable AI workflows, long-running tasks, cron schedules, and human-in-the-loop',
    category: 'background-tasks',
    license: 'Apache-2.0',
    stars: '13k+',
    status: 'integrated',
    integrationPath: 'server/openclaw/superagent/backgroundTaskEngine.ts',
    capabilities: ['durable-tasks', 'cron-schedules', 'human-in-the-loop', 'automatic-retries', 'real-time-streaming', 'self-hostable'],
    installCommand: 'npm install @trigger.dev/sdk',
    configKey: 'TRIGGER_DEV_API_KEY',
  },

  // ═══ BROWSER AUTOMATION ═══
  {
    id: 'browser-use',
    name: 'browser-use',
    repository: 'https://github.com/browser-use/browser-use',
    description: 'AI-driven browser automation that lets agents navigate, interact with, and extract data from websites',
    category: 'browser-automation',
    license: 'MIT',
    stars: '55k+',
    status: 'integrated',
    integrationPath: 'server/openclaw/superagent/browserAutomationEngine.ts',
    capabilities: ['ai-browsing', 'form-filling', 'data-extraction', 'screenshot', 'multi-tab'],
    installCommand: 'pip install browser-use',
    configKey: 'BROWSER_USE_ENABLED',
  },

  // ═══ AGENT FRAMEWORKS ═══
  {
    id: 'langgraph',
    name: 'LangGraph',
    repository: 'https://github.com/langchain-ai/langgraph',
    description: 'Framework for building stateful, multi-agent workflows with cycles, controllability, and persistence',
    category: 'agent-framework',
    license: 'MIT',
    stars: '10k+',
    status: 'integrated',
    integrationPath: 'server/agent/langgraph/',
    capabilities: ['stateful-workflows', 'multi-agent', 'cycles', 'persistence', 'human-in-the-loop'],
    installCommand: 'pip install langgraph',
  },
  {
    id: 'crewai',
    name: 'CrewAI',
    repository: 'https://github.com/crewAIInc/crewAI',
    description: 'Multi-agent AI framework for orchestrating role-playing autonomous agents',
    category: 'agent-framework',
    license: 'MIT',
    stars: '25k+',
    status: 'evaluating',
    capabilities: ['role-based-agents', 'task-delegation', 'collaborative-intelligence'],
    installCommand: 'pip install crewai',
  },
  {
    id: 'autogen',
    name: 'AutoGen',
    repository: 'https://github.com/microsoft/autogen',
    description: 'Microsoft framework for building multi-agent conversational AI systems',
    category: 'agent-framework',
    license: 'MIT',
    stars: '40k+',
    status: 'evaluating',
    capabilities: ['multi-agent-conversation', 'code-execution', 'human-proxy'],
    installCommand: 'pip install autogen',
  },

  // ═══ WORKFLOW AUTOMATION ═══
  {
    id: 'n8n',
    name: 'n8n',
    repository: 'https://github.com/n8n-io/n8n',
    description: 'Workflow automation platform with 400+ integrations, self-hostable with AI capabilities',
    category: 'workflow-automation',
    license: 'Sustainable Use License',
    stars: '55k+',
    status: 'planned',
    capabilities: ['visual-workflows', '400-integrations', 'webhooks', 'ai-nodes', 'self-hostable'],
    installCommand: 'npm install n8n -g',
  },
  {
    id: 'temporal',
    name: 'Temporal',
    repository: 'https://github.com/temporalio/temporal',
    description: 'Durable execution engine for building reliable distributed applications',
    category: 'background-tasks',
    license: 'MIT',
    stars: '12k+',
    status: 'planned',
    capabilities: ['durable-execution', 'saga-patterns', 'workflow-versioning', 'observability'],
    installCommand: 'npm install @temporalio/client @temporalio/worker',
  },

  // ═══ OBSERVABILITY ═══
  {
    id: 'langfuse',
    name: 'Langfuse',
    repository: 'https://github.com/langfuse/langfuse',
    description: 'Open source LLM observability platform with tracing, evaluation, and prompt management',
    category: 'observability',
    license: 'MIT',
    stars: '8k+',
    status: 'planned',
    capabilities: ['llm-tracing', 'evaluation', 'prompt-management', 'cost-tracking'],
    installCommand: 'npm install langfuse',
  },

  // ═══ VECTOR DATABASE ═══
  {
    id: 'pgvector',
    name: 'pgvector',
    repository: 'https://github.com/pgvector/pgvector',
    description: 'Open source vector similarity search for PostgreSQL (already in use)',
    category: 'vector-database',
    license: 'PostgreSQL',
    stars: '14k+',
    status: 'integrated',
    integrationPath: 'server/db.ts',
    capabilities: ['vector-search', 'embedding-storage', 'similarity-queries'],
  },

  // ═══ SEARCH ═══
  {
    id: 'meilisearch',
    name: 'Meilisearch',
    repository: 'https://github.com/meilisearch/meilisearch',
    description: 'Lightning-fast search engine for knowledge base and documents (already in use)',
    category: 'search',
    license: 'MIT',
    stars: '48k+',
    status: 'integrated',
    integrationPath: 'server/services/knowledgeBase.ts',
    capabilities: ['full-text-search', 'typo-tolerance', 'faceted-search', 'instant-search'],
  },
];

export class OpenSourceIntegrationsRegistry {
  private catalog: OpenSourceProject[] = [...OPEN_SOURCE_CATALOG];

  listAll(): OpenSourceProject[] {
    return [...this.catalog];
  }

  listByCategory(category: IntegrationCategory): OpenSourceProject[] {
    return this.catalog.filter(p => p.category === category);
  }

  listByStatus(status: OpenSourceProject['status']): OpenSourceProject[] {
    return this.catalog.filter(p => p.status === status);
  }

  getProject(id: string): OpenSourceProject | undefined {
    return this.catalog.find(p => p.id === id);
  }

  addProject(project: OpenSourceProject): void {
    const existing = this.catalog.findIndex(p => p.id === project.id);
    if (existing >= 0) {
      this.catalog[existing] = project;
    } else {
      this.catalog.push(project);
    }
    Logger.info(`[OSS] Registered project: ${project.name} (${project.status})`);
  }

  getIntegrationSummary(): string {
    const integrated = this.catalog.filter(p => p.status === 'integrated');
    const planned = this.catalog.filter(p => p.status === 'planned');
    const evaluating = this.catalog.filter(p => p.status === 'evaluating');

    const lines = [
      '=== Open Source Integrations Summary ===',
      '',
      `Integrated (${integrated.length}):`,
      ...integrated.map(p => `  - ${p.name}: ${p.description}`),
      '',
      `Planned (${planned.length}):`,
      ...planned.map(p => `  - ${p.name}: ${p.description}`),
      '',
      `Evaluating (${evaluating.length}):`,
      ...evaluating.map(p => `  - ${p.name}: ${p.description}`),
    ];

    return lines.join('\n');
  }

  getStats() {
    return {
      total: this.catalog.length,
      integrated: this.catalog.filter(p => p.status === 'integrated').length,
      planned: this.catalog.filter(p => p.status === 'planned').length,
      evaluating: this.catalog.filter(p => p.status === 'evaluating').length,
      categories: [...new Set(this.catalog.map(p => p.category))],
    };
  }
}

export const openSourceRegistry = new OpenSourceIntegrationsRegistry();
