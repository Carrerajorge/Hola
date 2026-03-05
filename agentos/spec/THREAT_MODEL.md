# AgentOS Threat Model

## Assets

| Asset | Sensitivity | Description |
|-------|------------|-------------|
| User data | High | Personal information, preferences, history |
| API keys | Critical | Provider credentials, service tokens |
| Agent memory | Medium-High | Episodic and persistent knowledge |
| Model outputs | Medium | Generated plans, responses, decisions |
| Execution logs | Medium | Full audit trail of actions |
| Plugin code | Medium | WASM/gRPC plugin binaries |

## Threat Categories

### T1: Prompt Injection

**Description**: Malicious content in external data (web pages, documents, user inputs) that attempts to override agent instructions.

**Attack Vectors**:
- Injected instructions in web pages during browsing
- Malicious document content during RAG ingestion
- Adversarial user inputs designed to bypass safety

**Mitigations**:
- `InputSanitizer`: Pattern-based detection of injection attempts
- Schema validation for all structured inputs
- Separation of data and instruction contexts
- Content tagging (trusted vs untrusted sources)
- Monitoring for anomalous behavior patterns

**Residual Risk**: Medium — Novel injection techniques may bypass pattern matching

### T2: Data Exfiltration

**Description**: Unauthorized extraction of sensitive data through agent actions.

**Attack Vectors**:
- Agent instructed to send data to external endpoints
- Memory leakage through model context
- Side-channel through model API calls

**Mitigations**:
- `ActionGuard`: Allowlist for external endpoints
- Data classification and access control
- Egress filtering on network level
- Audit logging of all external communications
- Memory isolation between missions

**Residual Risk**: Low — Strict egress controls limit exposure

### T3: Model Manipulation

**Description**: Exploiting model behavior to produce harmful outputs.

**Attack Vectors**:
- Adversarial inputs causing model hallucination
- Jailbreak attempts through prompt crafting
- Model poisoning through fine-tuning data

**Mitigations**:
- `CriticVerifier`: Grounding checks against evidence
- Cross-verification between multiple sources
- Soul policies blocking harmful outputs
- Temperature/sampling controls
- Model output validation

**Residual Risk**: Medium — Models can produce subtly incorrect outputs

### T4: Supply Chain Attacks

**Description**: Compromised dependencies, plugins, or model providers.

**Attack Vectors**:
- Malicious npm/pip packages
- Compromised WASM plugins
- Rogue model provider returning poisoned outputs

**Mitigations**:
- SBOM generation (syft) for all dependencies
- Container signing (cosign/sigstore)
- Security scanning (trivy, semgrep, gitleaks, codeql)
- WASM sandbox with memory limits
- Plugin capability restrictions (principle of least privilege)
- Multiple provider verification for critical decisions

**Residual Risk**: Low-Medium — Supply chain attacks are sophisticated

### T5: Identity and Access

**Description**: Unauthorized access to agent systems or impersonation.

**Attack Vectors**:
- Stolen API keys or tokens
- Service-to-service impersonation
- Privilege escalation through plugin system

**Mitigations**:
- `IdentityManager`: mTLS for service communication
- Secret rotation policies
- Workload identity (not shared credentials)
- Role-based access control
- Audit logging of all access

**Residual Risk**: Low — Standard identity management practices

### T6: Denial of Service / Resource Exhaustion

**Description**: Exhausting budgets, compute, or API quotas.

**Attack Vectors**:
- Malicious missions designed to consume maximum tokens
- Infinite loop in planning/execution
- Plugin resource exhaustion

**Mitigations**:
- `BudgetManager`: Hard limits on tokens, cost, API calls
- Workflow timeouts and circuit breakers
- WASM memory limits
- Rate limiting per provider
- Automatic budget alerts

**Residual Risk**: Low — Budget enforcement is deterministic

### T7: Telephony/Voice Abuse

**Description**: Misuse of voice calling capabilities.

**Attack Vectors**:
- Unauthorized calls without consent
- Impersonation during calls
- Recording without consent

**Mitigations**:
- Mandatory consent before any call
- Call scripts reviewed by human
- Full transcript logging
- Rate limiting on call initiation
- Disabled by default

**Residual Risk**: Very Low — Multiple consent gates

## Risk Matrix

| Threat | Likelihood | Impact | Risk | Priority |
|--------|-----------|--------|------|----------|
| T1: Prompt Injection | High | High | Critical | P0 |
| T2: Data Exfiltration | Medium | High | High | P1 |
| T3: Model Manipulation | Medium | Medium | Medium | P2 |
| T4: Supply Chain | Low | High | Medium | P2 |
| T5: Identity | Low | High | Medium | P2 |
| T6: DoS/Resource | Medium | Medium | Medium | P3 |
| T7: Telephony | Very Low | Medium | Low | P4 |
