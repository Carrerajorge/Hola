// AgentOS Security Module - Main Exports
// Provides policy enforcement, input sanitization, identity management, and action guarding

export { PolicyEngine, type PolicySubject, type PolicyResource, type PolicyAction, type PolicyDecision, type EscalationRule } from "./policies/opa-policies";
export { ActionGuard, type ActionRequest, type ActionVerdict } from "./policies/action-guard";
export { InputSanitizer, type SanitizationResult, type ThreatDetection, type SchemaRule } from "./scanning/input-sanitizer";
export { IdentityManager, type AgentIdentity, type CertificateInfo, type RotationPolicy, type ServiceToken, type AuditEntry } from "./identity/identity-manager";
