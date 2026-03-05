/**
 * AgentOS Action-Plane — Capability Discovery
 *
 * "Acquire capability" system: when a tool, data source, or SDK is missing,
 * this module searches documentation, package registries, and known
 * catalogs, then requests user permission/approval before acquisition.
 */

import {
  ActionResult,
  AuditEntry,
  CapabilityMatch,
  CapabilityRequest,
  ConsentRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[CAPABILITY][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[CAPABILITY][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[CAPABILITY][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Search provider abstraction
// ---------------------------------------------------------------------------

export interface CapabilitySearchProvider {
  /** Search for capabilities matching the description. */
  search(description: string, category: CapabilityRequest["category"]): Promise<CapabilityMatch[]>;
}

export interface ApprovalGate {
  /** Request user approval. Resolves true if approved. */
  requestApproval(request: CapabilityRequest, matches: CapabilityMatch[]): Promise<boolean>;
}

export interface CapabilityInstaller {
  /** Install a capability (e.g. npm install, pip install, enable MCP server). */
  install(match: CapabilityMatch): Promise<{ success: boolean; message: string }>;
}

// ---------------------------------------------------------------------------
// Built-in registry search (keyword matching against a known catalog)
// ---------------------------------------------------------------------------

interface CatalogEntry {
  name: string;
  description: string;
  category: CapabilityRequest["category"];
  source: string;
  installCommand?: string;
  documentationUrl?: string;
}

export class BuiltinCatalogProvider implements CapabilitySearchProvider {
  private catalog: CatalogEntry[];

  constructor(catalog: CatalogEntry[] = []) {
    this.catalog = catalog;
  }

  addEntry(entry: CatalogEntry): void {
    this.catalog.push(entry);
  }

  async search(
    description: string,
    category: CapabilityRequest["category"],
  ): Promise<CapabilityMatch[]> {
    const tokens = new Set(description.toLowerCase().split(/\W+/).filter(Boolean));
    const matches: CapabilityMatch[] = [];

    for (const entry of this.catalog) {
      if (entry.category !== category) continue;

      const entryTokens = `${entry.name} ${entry.description}`.toLowerCase().split(/\W+/);
      let overlap = 0;
      for (const t of entryTokens) {
        if (tokens.has(t)) overlap++;
      }

      if (overlap === 0) continue;

      const confidence = overlap / (tokens.size + entryTokens.length - overlap + 1);
      matches.push({
        requestId: "",
        source: entry.source,
        name: entry.name,
        installCommand: entry.installCommand,
        documentationUrl: entry.documentationUrl,
        confidence,
      });
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    return matches.slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CapabilityDiscoveryConfig {
  searchProviders: CapabilitySearchProvider[];
  approvalGate: ApprovalGate;
  installer: CapabilityInstaller;
  /** Automatically approve requests below this confidence threshold — never. */
  autoApproveThreshold: number;
}

// ---------------------------------------------------------------------------
// Capability Discovery Engine
// ---------------------------------------------------------------------------

export class CapabilityDiscovery {
  private cfg: CapabilityDiscoveryConfig;
  private requests = new Map<string, CapabilityRequest>();
  private matchCache = new Map<string, CapabilityMatch[]>();

  constructor(config: CapabilityDiscoveryConfig) {
    this.cfg = config;
    log.info("CapabilityDiscovery initialised", {
      providers: config.searchProviders.length,
    });
  }

  // ---- Public API --------------------------------------------------------

  /**
   * Request acquisition of a missing capability.
   * Returns the final action result after search -> approval -> install.
   */
  async acquire(
    description: string,
    category: CapabilityRequest["category"],
    requiresApproval = true,
  ): Promise<ActionResult<CapabilityMatch>> {
    const start = Date.now();
    const audit: AuditEntry[] = [];

    const request: CapabilityRequest = {
      id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description,
      category,
      requiresApproval,
      status: "searching",
    };
    this.requests.set(request.id, request);
    audit.push(this.auditInfo(`Capability request created: ${request.id}`));

    // 1. Search across all providers
    const matches = await this.searchAll(description, category);
    this.matchCache.set(request.id, matches);

    if (matches.length === 0) {
      request.status = "denied";
      log.warn("No matching capabilities found", { description });
      return this.fail(request.id, "No matching capabilities found", start, audit);
    }

    audit.push(this.auditInfo(`Found ${matches.length} candidate(s)`));
    matches.forEach((m) => (m.requestId = request.id));
    request.status = "found";

    // 2. Approval gate
    if (request.requiresApproval) {
      audit.push(this.auditInfo("Requesting user approval"));
      const approved = await this.requestApproval(request, matches);
      if (!approved) {
        request.status = "denied";
        return this.fail(request.id, "User denied capability acquisition", start, audit);
      }
      request.status = "approved";
      audit.push(this.auditInfo("User approved"));
    } else {
      request.status = "approved";
      audit.push(this.auditInfo("Auto-approved (no approval required)"));
    }

    // 3. Install the top match
    const bestMatch = matches[0];
    audit.push(this.auditInfo(`Installing: ${bestMatch.name} from ${bestMatch.source}`));

    try {
      const result = await this.cfg.installer.install(bestMatch);
      if (!result.success) {
        log.error("Installation failed", { name: bestMatch.name, message: result.message });
        return this.fail(request.id, `Install failed: ${result.message}`, start, audit);
      }

      request.status = "installed";
      audit.push(this.auditInfo(`Installed successfully: ${bestMatch.name}`));

      return {
        actionId: request.id,
        status: "success",
        data: bestMatch,
        durationMs: Date.now() - start,
        auditLog: audit,
        timestamp: new Date(),
      };
    } catch (err) {
      log.error("Installation threw", { error: String(err) });
      return this.fail(request.id, `Install error: ${String(err)}`, start, audit);
    }
  }

  /** List all pending and historical requests. */
  listRequests(): CapabilityRequest[] {
    return [...this.requests.values()];
  }

  /** Get cached matches for a request. */
  getMatches(requestId: string): CapabilityMatch[] {
    return this.matchCache.get(requestId) ?? [];
  }

  // ---- Internal ----------------------------------------------------------

  private async searchAll(
    description: string,
    category: CapabilityRequest["category"],
  ): Promise<CapabilityMatch[]> {
    const allMatches: CapabilityMatch[] = [];
    const results = await Promise.allSettled(
      this.cfg.searchProviders.map((p) => p.search(description, category)),
    );

    for (const outcome of results) {
      if (outcome.status === "fulfilled") {
        allMatches.push(...outcome.value);
      } else {
        log.warn("Search provider failed", { error: String(outcome.reason) });
      }
    }

    // Deduplicate by name, keeping highest confidence
    const best = new Map<string, CapabilityMatch>();
    for (const m of allMatches) {
      const existing = best.get(m.name);
      if (!existing || m.confidence > existing.confidence) {
        best.set(m.name, m);
      }
    }

    const deduped = [...best.values()];
    deduped.sort((a, b) => b.confidence - a.confidence);
    return deduped;
  }

  private async requestApproval(
    request: CapabilityRequest,
    matches: CapabilityMatch[],
  ): Promise<boolean> {
    try {
      return await this.cfg.approvalGate.requestApproval(request, matches);
    } catch (err) {
      log.error("Approval gate error — defaulting to deny", { error: String(err) });
      return false;
    }
  }

  private fail(actionId: string, error: string, start: number, audit: AuditEntry[]): ActionResult<CapabilityMatch> {
    audit.push({ timestamp: new Date(), level: "error", message: error });
    return {
      actionId,
      status: "failure",
      error,
      durationMs: Date.now() - start,
      auditLog: audit,
      timestamp: new Date(),
    };
  }

  private auditInfo(message: string): AuditEntry {
    return { timestamp: new Date(), level: "info", message };
  }
}
