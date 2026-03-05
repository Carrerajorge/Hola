// AgentOS Memory System — public API surface

export type {
  MemoryEntry,
  MemorySource,
  MemoryQuery,
  MemoryQueryResult,
  MemoryScope,
  PrivacyLevel,
  DataClassification,
  RetentionPolicy,
  RetentionRule,
  TtlRule,
  AccessRule,
  ImportanceRule,
  ClassificationRule,
  RightToForgetRule,
  AccessAuditEntry,
  WorkingMemoryConfig,
  Episode,
  KnowledgeArticle,
  ArticleVersion,
  AccessControlEntry,
} from "./types";

export { WorkingMemory } from "./working/working-memory";
export { EpisodicMemory } from "./episodic/episodic-memory";
export { PersistentMemory, AccessDeniedError } from "./persistent/persistent-memory";
export { RetentionPolicyEngine } from "./policies/retention-policies";
export type { MemoryStore, EnforcementReport } from "./policies/retention-policies";
