# AgentOS-ASI

**Agent Operating System + Aspirational Super-Intelligence**

A distributed, modular agent operating system designed for autonomous mission execution with full observability, safety guarantees, and human-in-the-loop escalation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI PLANE                                  │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │Run Console│ │DAG Viewer │ │Evidence  │ │Budget Dashboard  │  │
│  │(SSE/WS)  │ │(ReactFlow)│ │Panel     │ │(SRE Metrics)     │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Events / SSE / WebSocket
┌─────────────────────────────┴───────────────────────────────────┐
│                     CONTROL PLANE ("Cerebro")                    │
│                                                                  │
│  ┌─────────┐    ┌──────────┐    ┌────────┐    ┌──────────┐     │
│  │Planner  │───▶│Executor  │───▶│Critic  │───▶│Judge     │     │
│  │(Hierarch│    │(Parallel/│    │(Ground │    │(Stop/Go/ │     │
│  │ical+LLM)│◀──│Sequential)│◀──│+Verify)│    │Escalate) │     │
│  └─────────┘    └──────────┘    └────────┘    └──────────┘     │
│       │              │                              │            │
│  ┌────┴────┐    ┌────┴─────┐                  ┌────┴─────┐     │
│  │Budget   │    │Soul      │                  │World     │     │
│  │Manager  │    │Policies  │                  │Model     │     │
│  └─────────┘    └──────────┘                  └──────────┘     │
└──────────┬──────────────────────────┬───────────────────────────┘
           │                          │
┌──────────┴──────────┐  ┌───────────┴────────────────────────────┐
│    MODEL PLANE      │  │         ACTION PLANE                    │
│                     │  │                                         │
│ ┌─────────────────┐ │  │ ┌───────────┐ ┌─────┐ ┌────────────┐  │
│ │ Router (Policy) │ │  │ │Browser    │ │MCP  │ │Telephony   │  │
│ │   ┌───────────┐ │ │  │ │(Playwright│ │Client│ │(STT/TTS/   │  │
│ │   │Anthropic  │ │ │  │ │+DOM/ARIA) │ │     │ │SIP+consent)│  │
│ │   │OpenAI     │ │ │  │ └───────────┘ └─────┘ └────────────┘  │
│ │   │Google     │ │ │  │ ┌────────────────────────────────────┐ │
│ │   │Local/VLLM │ │ │  │ │Capability Discovery & Acquisition │ │
│ │   └───────────┘ │ │  │ └────────────────────────────────────┘ │
│ │ Gateway+QoS     │ │  └────────────────────────────────────────┘
│ └─────────────────┘ │
└──────────┬──────────┘
           │
┌──────────┴──────────────────────────────────────────────────────┐
│                      DATA PLANE                                  │
│                                                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐│
│ │Event     │ │Command   │ │Workflow  │ │Stream Manager        ││
│ │Store     │ │/Query Bus│ │Engine    │ │(Pub/Sub+Backpressure)││
│ │(CQRS)   │ │(CQRS)    │ │(Durable) │ │                      ││
│ └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘│
│ ┌──────────────────────────────────────────────────────────────┐│
│ │Hybrid Store: Vector(pgvector) + Text(OpenSearch) + SQL(PG)  ││
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE PLANE                               │
│                                                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐│
│ │RAG++     │ │Document  │ │Cross-Enc │ │Knowledge Graph       ││
│ │Pipeline  │ │ETL       │ │Reranker  │ │(Entity+Relations)    ││
│ └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘│
│ ┌──────────────────────────────────────────────────────────────┐│
│ │Evidence Assembler: Citations + Provenance + Confidence       ││
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐  ┌──────────────────────────────────────┐
│      MEMORY          │  │        CROSS-CUTTING                  │
│ ┌──────────────────┐ │  │ ┌──────────┐ ┌────────┐ ┌─────────┐ │
│ │Working (per-task)│ │  │ │Security  │ │Observ- │ │SDK +    │ │
│ │Episodic (history)│ │  │ │(Zero-    │ │ability │ │Plugins  │ │
│ │Persistent (org)  │ │  │ │Trust+OPA)│ │(OTel)  │ │(WASM/   │ │
│ │+ Retention/GDPR  │ │  │ │          │ │+Evals  │ │gRPC/MCP)│ │
│ └──────────────────┘ │  │ └──────────┘ └────────┘ └─────────┘ │
└──────────────────────┘  └──────────────────────────────────────┘
```

## Quick Start

```typescript
import { createAgentOS } from './agentos';

const agent = await createAgentOS({
  name: 'travel-agent',
  modelPlane: {
    providers: [
      { id: 'anthropic', type: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY',
        models: ['claude-sonnet-4-20250514'], capabilities: ['text', 'code', 'image'],
        maxConcurrent: 5, timeoutMs: 60000 },
    ],
    defaultPolicy: 'balanced',
  },
});

const result = await agent.runMission({
  goal: 'Research and book a flight from NYC to Tokyo for March 15-22',
  constraints: { maxCostUSD: 5, requireApproval: ['payment', 'booking'] },
});

console.log(result.evidencePack); // Full provenance chain
console.log(result.timeline);     // Step-by-step execution log
```

## Directory Structure

```
agentos/
├── index.ts                 # Main entry point and factory
├── config.ts                # Configuration schema with defaults
├── control-plane/           # Neuro-symbolic "Cerebro"
│   ├── orchestrator.ts      # Main planner→executor→critic→judge loop
│   ├── planner/             # Hierarchical goal decomposition
│   ├── executor/            # Task execution with retries
│   ├── critic/              # Grounding verification
│   ├── judge/               # Mission success evaluation
│   ├── budgeting/           # Token/cost/latency budgets
│   └── soul/                # Ethics & escalation policies
├── model-plane/             # Multi-model routing
│   ├── router/              # Policy-based model selection
│   ├── providers/           # Provider implementations
│   ├── gateway/             # Unified API gateway
│   └── policy/              # Routing policy DSL
├── data-plane/              # Event-sourced data layer
│   ├── events/              # Event store
│   ├── cqrs/                # Command/query buses
│   ├── workflows/           # Durable execution engine
│   ├── streaming/           # Pub/sub with backpressure
│   └── storage/             # Hybrid storage abstraction
├── knowledge-plane/         # RAG++ with evidence
│   ├── rag/                 # Pipeline: rewrite→retrieve→rerank→assemble
│   ├── etl/                 # Document processing
│   ├── reranker/            # Cross-encoder reranking
│   ├── knowledge-graph/     # Entity/relation store
│   └── evidence/            # Evidence pack assembly
├── action-plane/            # External interactions
│   ├── web/                 # Playwright browser automation
│   ├── mcp/                 # Model Context Protocol client
│   ├── telephony/           # Voice calls (with consent)
│   └── capabilities/        # Dynamic capability acquisition
├── memory/                  # Agent memory systems
│   ├── working/             # Short-term per-task memory
│   ├── episodic/            # Historical interaction memory
│   ├── persistent/          # Organizational knowledge
│   └── policies/            # Retention, privacy, GDPR
├── ui-plane/                # Agentic console UI
│   ├── console/             # Real-time run console
│   ├── dag/                 # Plan DAG visualizer
│   ├── streaming/           # SSE/WebSocket client
│   └── components/          # Evidence, budget, timeline panels
├── sdk/                     # Developer SDK
│   ├── core/                # AgentSDK class
│   ├── plugins/             # Plugin system
│   ├── wasm/                # WASM plugin runtime
│   └── grpc/                # gRPC plugin bridge
├── security/                # Security layer
│   ├── policies/            # OPA policies + action guard
│   ├── scanning/            # Prompt injection detection
│   └── identity/            # Zero-trust identity
├── observability/           # Monitoring & evals
│   ├── metrics/             # OpenTelemetry metrics
│   ├── traces/              # Distributed tracing
│   └── evals/               # Agent evaluation framework
├── contracts/               # API contracts
│   ├── openapi/             # REST API spec
│   ├── jsonschema/          # Data schemas
│   └── protobuf/            # gRPC service definitions
└── spec/                    # Architecture docs
    ├── ARCHITECTURE.md
    ├── THREAT_MODEL.md
    ├── INVARIANTS.md
    └── ADR-*.md
```

## Design Principles

1. **Safety First**: Every action passes through the Soul policies and Action Guard
2. **Evidence-Based**: Every claim links to source evidence with provenance
3. **Budget-Aware**: Token, cost, and latency budgets are enforced at every level
4. **Observable**: Full OpenTelemetry tracing from mission to individual model call
5. **Pluggable**: WASM/gRPC/MCP plugin system for extending capabilities
6. **Privacy-Respecting**: Retention policies, right-to-forget, encryption at rest
7. **Human-in-the-Loop**: Risk-based escalation for irreversible or high-stakes actions

## License

MIT
