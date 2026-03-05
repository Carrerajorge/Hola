// Workload identity with mTLS/zero-trust
// Manages agent identities, service-to-service auth, secret rotation, and audit logging

export interface AgentIdentity {
  agentId: string;
  workloadId: string;
  serviceAccount: string;
  certificate: CertificateInfo;
  permissions: string[];
  createdAt: number;
  expiresAt: number;
  rotationPolicy: RotationPolicy;
}

export interface CertificateInfo {
  fingerprint: string;
  issuer: string;
  subject: string;
  notBefore: number;
  notAfter: number;
  serialNumber: string;
}

export interface RotationPolicy {
  intervalMs: number;
  maxLifetimeMs: number;
  graceWindowMs: number;
  autoRotate: boolean;
}

export interface ServiceToken {
  token: string;
  agentId: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
  fingerprint: string;
}

export interface AuditEntry {
  timestamp: number;
  eventType: "identity-created" | "identity-revoked" | "token-issued" | "token-revoked" | "secret-rotated" | "auth-success" | "auth-failure" | "cert-renewed";
  agentId: string;
  details: Record<string, unknown>;
  sourceIp?: string;
}

export class IdentityManager {
  private identities = new Map<string, AgentIdentity>();
  private tokens = new Map<string, ServiceToken>();
  private secrets = new Map<string, { value: string; version: number; rotatedAt: number }>();
  private auditLog: AuditEntry[] = [];
  private rotationTimers = new Map<string, ReturnType<typeof setInterval>>();

  createIdentity(agentId: string, serviceAccount: string, permissions: string[]): AgentIdentity {
    const now = Date.now();
    const cert = this.generateCertificate(agentId, serviceAccount);
    const identity: AgentIdentity = {
      agentId,
      workloadId: `wl_${agentId}_${now.toString(36)}`,
      serviceAccount,
      certificate: cert,
      permissions,
      createdAt: now,
      expiresAt: now + 86_400_000, // 24h default
      rotationPolicy: {
        intervalMs: 3_600_000, // 1h rotation
        maxLifetimeMs: 86_400_000,
        graceWindowMs: 300_000, // 5min grace
        autoRotate: true,
      },
    };
    this.identities.set(agentId, identity);
    this.audit("identity-created", agentId, { serviceAccount, permissions });

    if (identity.rotationPolicy.autoRotate) {
      this.scheduleRotation(agentId);
    }
    return identity;
  }

  issueToken(agentId: string, scopes: string[], ttlMs = 3_600_000): ServiceToken | null {
    const identity = this.identities.get(agentId);
    if (!identity || Date.now() > identity.expiresAt) {
      this.audit("auth-failure", agentId, { reason: "identity-expired-or-missing" });
      return null;
    }
    // Validate requested scopes against permissions
    const unauthorized = scopes.filter((s) => !identity.permissions.includes(s));
    if (unauthorized.length > 0) {
      this.audit("auth-failure", agentId, { reason: "scope-not-permitted", unauthorized });
      return null;
    }
    const now = Date.now();
    const token: ServiceToken = {
      token: this.generateTokenString(),
      agentId,
      scopes,
      issuedAt: now,
      expiresAt: now + ttlMs,
      fingerprint: identity.certificate.fingerprint,
    };
    this.tokens.set(token.token, token);
    this.audit("token-issued", agentId, { scopes, expiresAt: token.expiresAt });
    return token;
  }

  validateToken(tokenStr: string): { valid: boolean; agentId?: string; scopes?: string[]; reason?: string } {
    const token = this.tokens.get(tokenStr);
    if (!token) return { valid: false, reason: "token-not-found" };
    if (Date.now() > token.expiresAt) {
      this.tokens.delete(tokenStr);
      return { valid: false, reason: "token-expired" };
    }
    const identity = this.identities.get(token.agentId);
    if (!identity || identity.certificate.fingerprint !== token.fingerprint) {
      return { valid: false, reason: "certificate-mismatch" };
    }
    this.audit("auth-success", token.agentId, { scopes: token.scopes });
    return { valid: true, agentId: token.agentId, scopes: token.scopes };
  }

  revokeIdentity(agentId: string): boolean {
    const identity = this.identities.get(agentId);
    if (!identity) return false;
    // Revoke all tokens for this agent
    for (const [tokenStr, token] of this.tokens.entries()) {
      if (token.agentId === agentId) {
        this.tokens.delete(tokenStr);
        this.audit("token-revoked", agentId, { token: tokenStr.slice(0, 8) + "..." });
      }
    }
    this.identities.delete(agentId);
    const timer = this.rotationTimers.get(agentId);
    if (timer) { clearInterval(timer); this.rotationTimers.delete(agentId); }
    this.audit("identity-revoked", agentId, {});
    return true;
  }

  storeSecret(key: string, value: string, agentId: string): void {
    const existing = this.secrets.get(key);
    this.secrets.set(key, { value, version: (existing?.version ?? 0) + 1, rotatedAt: Date.now() });
    this.audit("secret-rotated", agentId, { key, version: (existing?.version ?? 0) + 1 });
  }

  getSecret(key: string, agentId: string): string | null {
    const identity = this.identities.get(agentId);
    if (!identity || !identity.permissions.includes("secrets:read")) {
      this.audit("auth-failure", agentId, { reason: "no-secret-permission", key });
      return null;
    }
    return this.secrets.get(key)?.value ?? null;
  }

  getAuditLog(agentId?: string): AuditEntry[] {
    if (agentId) return this.auditLog.filter((e) => e.agentId === agentId);
    return [...this.auditLog];
  }

  shutdown(): void {
    for (const timer of this.rotationTimers.values()) clearInterval(timer);
    this.rotationTimers.clear();
  }

  private scheduleRotation(agentId: string): void {
    const identity = this.identities.get(agentId);
    if (!identity) return;
    const timer = setInterval(() => {
      const current = this.identities.get(agentId);
      if (!current) { clearInterval(timer); return; }
      const newCert = this.generateCertificate(agentId, current.serviceAccount);
      current.certificate = newCert;
      current.expiresAt = Date.now() + current.rotationPolicy.maxLifetimeMs;
      this.audit("cert-renewed", agentId, { fingerprint: newCert.fingerprint });
    }, identity.rotationPolicy.intervalMs);
    this.rotationTimers.set(agentId, timer);
  }

  private generateCertificate(agentId: string, serviceAccount: string): CertificateInfo {
    const now = Date.now();
    return {
      fingerprint: `fp_${this.randomHex(32)}`,
      issuer: "agentos-ca",
      subject: `CN=${agentId},SA=${serviceAccount}`,
      notBefore: now,
      notAfter: now + 86_400_000,
      serialNumber: this.randomHex(16),
    };
  }

  private generateTokenString(): string {
    return `agt_${this.randomHex(48)}`;
  }

  private randomHex(length: number): string {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * 16)];
    return result;
  }

  private audit(eventType: AuditEntry["eventType"], agentId: string, details: Record<string, unknown>): void {
    this.auditLog.push({ timestamp: Date.now(), eventType, agentId, details });
    if (this.auditLog.length > 50_000) this.auditLog = this.auditLog.slice(-25_000);
  }
}
