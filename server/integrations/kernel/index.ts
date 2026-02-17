/**
 * Integration Kernel — Module index
 */

export * from "./types";
export { connectorRegistry, ConnectorRegistry } from "./connectorRegistry";
export type { CredentialResolver, ConnectorExecutorInterface, UserPolicy, ConnectorHandlerFactory } from "./connectorRegistry";
export { credentialVault, CredentialVault } from "./credentialVault";
export { connectorExecutor, ConnectorExecutor } from "./connectorExecutor";
export { mountConnectorTools, getConnectorDeclarationsForUser, hasAnyConnectedApps } from "./connectorToolBridge";
export { initializeConnectorManifests, loadAllConnectorManifests } from "./manifestLoader";
export { connectorEventBus, ConnectorEventBus } from "./connectorEventBus";
export type {
  ConnectorEvent,
  ConnectorEventType,
  ConnectorEventMap,
  ConnectorEventHandler,
  ConnectorRegisteredEvent,
  ConnectorConnectedEvent,
  ConnectorDisconnectedEvent,
  ConnectorOperationStartedEvent,
  ConnectorOperationCompletedEvent,
  ConnectorOperationFailedEvent,
  ConnectorCredentialRefreshedEvent,
  ConnectorCredentialExpiredEvent,
  ConnectorCredentialRevokedEvent,
  ConnectorCircuitOpenedEvent,
  ConnectorCircuitClosedEvent,
  ConnectorCircuitHalfOpenEvent,
  ConnectorRateLimitWarningEvent,
  ConnectorRateLimitExceededEvent,
  ConnectorHealthDegradedEvent,
  ConnectorHealthRecoveredEvent,
  ConnectorWebhookReceivedEvent,
  ConnectorSagaStartedEvent,
  ConnectorSagaCompletedEvent,
  ConnectorSagaCompensatingEvent,
  ConnectorSagaFailedEvent,
} from "./connectorEventBus";
export { connectorLifecycle, ConnectorLifecycleManager } from "./connectorLifecycle";
export type { ConnectorHealthSnapshot, ConnectorHealthStatus, CircuitState } from "./connectorLifecycle";
export { credentialRotation, CredentialRotationScheduler } from "./credentialRotation";
export type { CredentialRotationPolicy, RotationStatus, RotationMetrics } from "./credentialRotation";
export { credentialHealthMonitor, CredentialHealthMonitor } from "./credentialHealthMonitor";
export type { CredentialHealthReport, AnomalyReport } from "./credentialHealthMonitor";
export { sanitizeConnectorInput, sanitizeConnectorOutput, createSanitizationConfig } from "./inputSanitizer";
export type { SanitizationConfig, SanitizationReport, SanitizationWarning, SanitizedOutput, RedactionEntry } from "./inputSanitizer";
export { scopeValidator, ScopeValidator, escalationDetector, ScopeEscalationDetector, riskAssessor, OperationRiskAssessor } from "./scopeValidator";
export type { ScopeValidationResult, EscalationResult, RiskAssessment, RiskFactor, RiskLevel } from "./scopeValidator";
export { connectorFirewall, ConnectorFirewall, RequestLogger } from "./connectorFirewall";
export type { UrlValidationResult, DomainValidationResult, RequestLogEntry } from "./connectorFirewall";
