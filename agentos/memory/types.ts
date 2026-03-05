// ── Privacy & Scope ───────────────────────────────────────────────────

export type PrivacyLevel = "public" | "internal" | "confidential" | "restricted";

export type MemoryScope =
  | "task"        // scoped to a single task/conversation
  | "agent"       // scoped to an individual agent
  | "team"        // shared across a team of agents
  | "org"         // organization-wide knowledge
  | "global";     // cross-organization (federated)

export type DataClassification = "pii" | "credentials" | "financial" | "health" | "general";

// ── Memory Entry ──────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  scope: MemoryScope;
  privacy: PrivacyLevel;
  classification: DataClassification[];
  source: MemorySource;
  importance: number;           // 0.0 – 1.0
  accessCount: number;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  version: number;
  parentId?: string;            // for threaded / linked memories
  encryptedAtRest: boolean;
}

export interface MemorySource {
  type: "user" | "agent" | "system" | "external";
  agentId?: string;
  taskId?: string;
  conversationId?: string;
  uri?: string;
}

// ── Memory Query ──────────────────────────────────────────────────────

export interface MemoryQuery {
  text?: string;
  embedding?: number[];
  scope?: MemoryScope | MemoryScope[];
  privacy?: PrivacyLevel[];
  tags?: string[];
  source?: Partial<MemorySource>;
  importanceMin?: number;
  timeRange?: { start: Date; end: Date };
  topK?: number;
  threshold?: number;
  includeExpired?: boolean;
}

export interface MemoryQueryResult {
  entries: MemoryEntry[];
  total: number;
  scores: Map<string, number>;
  queryTimeMs: number;
}

// ── Retention Policy ──────────────────────────────────────────────────

export interface RetentionPolicy {
  id: string;
  name: string;
  scope: MemoryScope | MemoryScope[];
  rules: RetentionRule[];
  enabled: boolean;
  createdAt: Date;
}

export type RetentionRule =
  | TtlRule
  | AccessRule
  | ImportanceRule
  | ClassificationRule
  | RightToForgetRule;

export interface TtlRule {
  type: "ttl";
  maxAgeDays: number;
  scope?: MemoryScope[];
}

export interface AccessRule {
  type: "access";
  maxDaysSinceAccess: number;
}

export interface ImportanceRule {
  type: "importance";
  minImportance: number;
  gracePeriodDays: number;
}

export interface ClassificationRule {
  type: "classification";
  classification: DataClassification;
  maxAgeDays: number;
  requireEncryption: boolean;
}

export interface RightToForgetRule {
  type: "right-to-forget";
  sourceType: MemorySource["type"];
  scope: MemoryScope[];
}

// ── Access Audit ──────────────────────────────────────────────────────

export interface AccessAuditEntry {
  id: string;
  memoryId: string;
  accessedBy: string;
  action: "read" | "write" | "delete" | "query";
  timestamp: Date;
  context: Record<string, unknown>;
}

// ── Working Memory ────────────────────────────────────────────────────

export interface WorkingMemoryConfig {
  maxTokens: number;
  summarizationThreshold: number;  // fraction (0-1) of maxTokens before summarization
  evictionStrategy: "lru" | "priority" | "fifo";
  summarizer?: (entries: MemoryEntry[]) => Promise<string>;
}

// ── Episodic Memory ───────────────────────────────────────────────────

export interface Episode {
  id: string;
  taskId: string;
  agentId: string;
  summary: string;
  entries: MemoryEntry[];
  outcome: "success" | "failure" | "partial" | "unknown";
  importance: number;
  startedAt: Date;
  endedAt?: Date;
  tags: string[];
  relatedEpisodeIds: string[];
}

// ── Persistent Memory ─────────────────────────────────────────────────

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  embedding?: number[];
  scope: MemoryScope;
  privacy: PrivacyLevel;
  author: string;
  version: number;
  history: ArticleVersion[];
  accessControl: AccessControlEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleVersion {
  version: number;
  content: string;
  editedBy: string;
  editedAt: Date;
  changeNote?: string;
}

export interface AccessControlEntry {
  principal: string;            // agentId, teamId, or "*"
  permissions: ("read" | "write" | "delete" | "admin")[];
}
