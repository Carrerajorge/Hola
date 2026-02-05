import { and, desc, eq, ilike, sql } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";

import { db } from "../db";
import { kbEdges, kbNodes } from "../../shared/schema/knowledge";
import { generateEmbedding, cosineSimilarity } from "../embeddingService";

export type KbUpsertInput = {
  type: string;
  title?: string | null;
  content: string;
  tags?: string[];
  sourceRef?: string | null;
};

export type KbSearchResult = {
  id: string;
  type: string;
  title: string | null;
  content: string;
  tags: string[];
  sourceRef: string | null;
  score: number;
  updatedAt: Date;
};

function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?\"<>|]/g, "-")
    .slice(0, 120);
}

function mdFrontmatter(meta: Record<string, any>): string {
  const lines = Object.entries(meta).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`;
    if (v === null || v === undefined) return `${k}: null`;
    if (typeof v === "object") return `${k}: ${JSON.stringify(v)}`;
    return `${k}: ${JSON.stringify(v)}`;
  });
  return `---\n${lines.join("\n")}\n---\n\n`;
}

export class KnowledgeBaseService {
  async upsert(ownerUserId: string, input: KbUpsertInput): Promise<{ id: string }> {
    // Minimal deterministic keying: if (type+title) exists, update; else insert.
    const title = input.title?.trim() || null;
    const tags = (input.tags || []).map((t) => t.trim()).filter(Boolean);

    const embedding = await generateEmbedding(`${title ?? ""}\n\n${input.content}`);

    const existing = title
      ? await db
          .select({ id: kbNodes.id })
          .from(kbNodes)
          .where(and(eq(kbNodes.ownerUserId, ownerUserId), eq(kbNodes.type, input.type), eq(kbNodes.title, title)))
          .limit(1)
      : [];

    if (existing.length) {
      const id = existing[0].id;
      await db
        .update(kbNodes)
        .set({
          content: input.content,
          tags,
          sourceRef: input.sourceRef ?? null,
          embedding,
          updatedAt: new Date(),
        })
        .where(and(eq(kbNodes.ownerUserId, ownerUserId), eq(kbNodes.id, id)));
      return { id };
    }

    const inserted = await db
      .insert(kbNodes)
      .values({
        ownerUserId,
        type: input.type,
        title,
        content: input.content,
        tags,
        sourceRef: input.sourceRef ?? null,
        embedding,
      })
      .returning({ id: kbNodes.id });

    return { id: inserted[0]!.id };
  }

  async link(ownerUserId: string, fromNodeId: string, toNodeId: string, relation: string, metadata?: any): Promise<void> {
    await db
      .insert(kbEdges)
      .values({
        ownerUserId,
        fromNodeId,
        toNodeId,
        relation,
        metadata: metadata ?? {},
      })
      .onConflictDoNothing();
  }

  async search(ownerUserId: string, query: string, limit = 20): Promise<KbSearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    // Two-phase hybrid search (minimalistic):
    // 1) Fetch text candidates via ILIKE (fast enough for small/medium KB)
    // 2) Re-rank via cosine similarity on stored embeddings
    const candidates = await db
      .select({
        id: kbNodes.id,
        type: kbNodes.type,
        title: kbNodes.title,
        content: kbNodes.content,
        tags: kbNodes.tags,
        sourceRef: kbNodes.sourceRef,
        embedding: kbNodes.embedding,
        updatedAt: kbNodes.updatedAt,
      })
      .from(kbNodes)
      .where(
        and(
          eq(kbNodes.ownerUserId, ownerUserId),
          sql`(${kbNodes.title} ILIKE ${"%" + q + "%"} OR ${kbNodes.content} ILIKE ${"%" + q + "%"})`
        )
      )
      .orderBy(desc(kbNodes.updatedAt))
      .limit(Math.max(limit * 5, 50));

    const qEmb = await generateEmbedding(q);

    const scored = candidates.map((c) => {
      const emb = Array.isArray(c.embedding) ? (c.embedding as any as number[]) : [];
      const semantic = emb.length ? cosineSimilarity(qEmb, emb) : 0;

      // Add a small lexical bump
      const lexical =
        (c.title?.toLowerCase().includes(q.toLowerCase()) ? 0.15 : 0) +
        (c.content.toLowerCase().includes(q.toLowerCase()) ? 0.1 : 0);

      const score = semantic + lexical;
      return {
        id: c.id,
        type: c.type,
        title: c.title,
        content: c.content,
        tags: c.tags || [],
        sourceRef: c.sourceRef,
        score,
        updatedAt: c.updatedAt,
      } satisfies KbSearchResult;
    });

    scored.sort((a, b) => b.score - a.score || +b.updatedAt - +a.updatedAt);
    return scored.slice(0, limit);
  }

  async exportObsidianVault(ownerUserId: string, outDir: string): Promise<{ outDir: string; files: number }> {
    const nodes = await db
      .select({
        id: kbNodes.id,
        type: kbNodes.type,
        title: kbNodes.title,
        content: kbNodes.content,
        tags: kbNodes.tags,
        sourceRef: kbNodes.sourceRef,
        updatedAt: kbNodes.updatedAt,
        createdAt: kbNodes.createdAt,
      })
      .from(kbNodes)
      .where(eq(kbNodes.ownerUserId, ownerUserId))
      .orderBy(desc(kbNodes.updatedAt))
      .limit(5000);

    const edges = await db
      .select({ fromNodeId: kbEdges.fromNodeId, toNodeId: kbEdges.toNodeId, relation: kbEdges.relation })
      .from(kbEdges)
      .where(eq(kbEdges.ownerUserId, ownerUserId));

    await fs.mkdir(outDir, { recursive: true });

    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const linksFrom = new Map<string, Array<{ to: string; relation: string }>>();
    for (const e of edges) {
      const arr = linksFrom.get(e.fromNodeId) ?? [];
      arr.push({ to: e.toNodeId, relation: e.relation });
      linksFrom.set(e.fromNodeId, arr);
    }

    let files = 0;
    for (const n of nodes) {
      const title = n.title?.trim() || `${n.type}-${n.id.slice(0, 8)}`;
      const fileName = sanitizeFileName(title) + ".md";
      const filePath = path.join(outDir, fileName);

      const outgoing = (linksFrom.get(n.id) ?? [])
        .map((l) => {
          const tgt = byId.get(l.to);
          const tgtTitle = tgt?.title?.trim() || `${tgt?.type ?? "node"}-${l.to.slice(0, 8)}`;
          return `- ${l.relation}: [[${sanitizeFileName(tgtTitle)}]]`;
        })
        .join("\n");

      const fm = mdFrontmatter({
        id: n.id,
        type: n.type,
        tags: n.tags || [],
        sourceRef: n.sourceRef ?? null,
        createdAt: n.createdAt?.toISOString?.() ?? null,
        updatedAt: n.updatedAt?.toISOString?.() ?? null,
      });

      const body = `${fm}${n.content}\n\n## Links\n${outgoing || "- (none)"}\n`;
      await fs.writeFile(filePath, body, "utf-8");
      files++;
    }

    return { outDir, files };
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
