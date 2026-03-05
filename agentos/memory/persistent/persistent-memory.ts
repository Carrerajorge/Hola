import { EventEmitter } from "events";
import {
  AccessControlEntry,
  ArticleVersion,
  KnowledgeArticle,
  MemoryQuery,
  MemoryQueryResult,
  MemoryScope,
  PrivacyLevel,
} from "../types";

export class PersistentMemory extends EventEmitter {
  private articles = new Map<string, KnowledgeArticle>();
  private idCounter = 0;

  /** Create a new knowledge article. */
  create(params: {
    title: string;
    content: string;
    scope: MemoryScope;
    privacy: PrivacyLevel;
    author: string;
    embedding?: number[];
    accessControl?: AccessControlEntry[];
  }): KnowledgeArticle {
    const id = this.nextId();
    const now = new Date();
    const article: KnowledgeArticle = {
      id,
      title: params.title,
      content: params.content,
      embedding: params.embedding,
      scope: params.scope,
      privacy: params.privacy,
      author: params.author,
      version: 1,
      history: [
        {
          version: 1,
          content: params.content,
          editedBy: params.author,
          editedAt: now,
          changeNote: "Initial creation",
        },
      ],
      accessControl: params.accessControl ?? [
        { principal: params.author, permissions: ["read", "write", "delete", "admin"] },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.articles.set(id, article);
    this.emit("persistent:created", article);
    return article;
  }

  /** Update an existing article, creating a new version. */
  update(
    articleId: string,
    editorId: string,
    changes: { content?: string; title?: string; embedding?: number[]; changeNote?: string }
  ): KnowledgeArticle {
    const article = this.articles.get(articleId);
    if (!article) throw new Error(`Article not found: ${articleId}`);
    this.checkPermission(article, editorId, "write");

    const newVersion = article.version + 1;
    const now = new Date();

    if (changes.content !== undefined) {
      article.history.push({
        version: newVersion,
        content: changes.content,
        editedBy: editorId,
        editedAt: now,
        changeNote: changes.changeNote,
      });
      article.content = changes.content;
    }

    if (changes.title !== undefined) article.title = changes.title;
    if (changes.embedding !== undefined) article.embedding = changes.embedding;
    article.version = newVersion;
    article.updatedAt = now;

    this.emit("persistent:updated", { articleId, version: newVersion, editorId });
    return article;
  }

  /** Retrieve a specific version or the latest. */
  get(articleId: string, requesterId: string, version?: number): KnowledgeArticle | null {
    const article = this.articles.get(articleId);
    if (!article) return null;
    this.checkPermission(article, requesterId, "read");

    if (version !== undefined) {
      const hist = article.history.find((h) => h.version === version);
      if (!hist) throw new Error(`Version ${version} not found for article ${articleId}`);
      return { ...article, content: hist.content, version: hist.version };
    }

    return article;
  }

  /** Delete an article (soft or hard). */
  delete(articleId: string, requesterId: string): boolean {
    const article = this.articles.get(articleId);
    if (!article) return false;
    this.checkPermission(article, requesterId, "delete");
    this.articles.delete(articleId);
    this.emit("persistent:deleted", { articleId, deletedBy: requesterId });
    return true;
  }

  /** Search articles using text, embedding, and filters. */
  async search(q: MemoryQuery, requesterId: string): Promise<MemoryQueryResult> {
    const start = Date.now();
    let candidates = Array.from(this.articles.values());

    // Access control filter
    candidates = candidates.filter((a) => this.hasPermission(a, requesterId, "read"));

    // Scope filter
    if (q.scope) {
      const scopes = Array.isArray(q.scope) ? q.scope : [q.scope];
      candidates = candidates.filter((a) => scopes.includes(a.scope));
    }

    // Privacy filter
    if (q.privacy) {
      candidates = candidates.filter((a) => q.privacy!.includes(a.privacy));
    }

    // Text search
    if (q.text) {
      const terms = q.text.toLowerCase().split(/\s+/);
      candidates = candidates.filter((a) => {
        const haystack = `${a.title} ${a.content}`.toLowerCase();
        return terms.some((t) => haystack.includes(t));
      });
    }

    // Time range
    if (q.timeRange) {
      candidates = candidates.filter(
        (a) => a.updatedAt >= q.timeRange!.start && a.updatedAt <= q.timeRange!.end
      );
    }

    // Vector similarity
    const scores = new Map<string, number>();
    if (q.embedding) {
      for (const article of candidates) {
        if (article.embedding) {
          const sim = cosineSim(q.embedding, article.embedding);
          if (!q.threshold || sim >= q.threshold) {
            scores.set(article.id, sim);
          }
        }
      }
      if (q.threshold) {
        candidates = candidates.filter((a) => scores.has(a.id));
      }
      candidates.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    }

    const topK = q.topK ?? 20;
    const results = candidates.slice(0, topK);

    // Convert to MemoryEntry-shaped results
    const entries = results.map((a) => ({
      id: a.id,
      content: a.content,
      embedding: a.embedding,
      scope: a.scope,
      privacy: a.privacy,
      classification: [] as any,
      source: { type: "system" as const, agentId: a.author },
      importance: 0.7,
      accessCount: 0,
      tags: [],
      metadata: { title: a.title, version: a.version },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      version: a.version,
      encryptedAtRest: false,
    }));

    return {
      entries,
      total: candidates.length,
      scores,
      queryTimeMs: Date.now() - start,
    };
  }

  /** Grant or update access control for an article. */
  grantAccess(articleId: string, adminId: string, entry: AccessControlEntry): void {
    const article = this.articles.get(articleId);
    if (!article) throw new Error(`Article not found: ${articleId}`);
    this.checkPermission(article, adminId, "admin");

    const existing = article.accessControl.find((e) => e.principal === entry.principal);
    if (existing) {
      existing.permissions = entry.permissions;
    } else {
      article.accessControl.push(entry);
    }
    this.emit("persistent:accessGranted", { articleId, principal: entry.principal });
  }

  /** Revoke access for a principal. */
  revokeAccess(articleId: string, adminId: string, principal: string): void {
    const article = this.articles.get(articleId);
    if (!article) throw new Error(`Article not found: ${articleId}`);
    this.checkPermission(article, adminId, "admin");
    article.accessControl = article.accessControl.filter((e) => e.principal !== principal);
    this.emit("persistent:accessRevoked", { articleId, principal });
  }

  /** Get version history for an article. */
  getHistory(articleId: string, requesterId: string): ArticleVersion[] {
    const article = this.articles.get(articleId);
    if (!article) return [];
    this.checkPermission(article, requesterId, "read");
    return [...article.history];
  }

  /** Federated query placeholder: searches across scopes. */
  async federatedSearch(q: MemoryQuery, requesterId: string): Promise<MemoryQueryResult> {
    // In production, this would fan out across org boundaries
    return this.search({ ...q, scope: ["org", "global"] }, requesterId);
  }

  get articleCount(): number {
    return this.articles.size;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private checkPermission(
    article: KnowledgeArticle,
    principal: string,
    permission: "read" | "write" | "delete" | "admin"
  ): void {
    if (!this.hasPermission(article, principal, permission)) {
      throw new AccessDeniedError(
        `Principal '${principal}' lacks '${permission}' on article '${article.id}'`
      );
    }
  }

  private hasPermission(
    article: KnowledgeArticle,
    principal: string,
    permission: "read" | "write" | "delete" | "admin"
  ): boolean {
    return article.accessControl.some(
      (acl) =>
        (acl.principal === principal || acl.principal === "*") &&
        acl.permissions.includes(permission)
    );
  }

  private nextId(): string {
    return `ka-${Date.now()}-${++this.idCounter}`;
  }
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
