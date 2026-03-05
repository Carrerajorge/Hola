/**
 * FILE-PLANE — Public API for the File Capability.
 */

export { FileGateway } from "./FileGateway";
export { FileIndexService } from "./FileIndexService";
export { detectSecrets, redactSecrets, hasSecrets } from "./secretDetector";
export type {
  FileAccessPolicy,
  FileAccessRequest,
  FileAccessResult,
  AuditLogEntry,
  IngestedDocument,
  DocumentChunk,
  DocumentMetadata,
  ProvenanceInfo,
  FilePermission,
  RiskLevel,
  SecretPattern,
} from "./types";
