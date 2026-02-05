import { describe, expect, test } from "vitest";
import { cosineSimilarity, generateEmbedding } from "../../server/embeddingService";

// Pure ranking tests (no DB) => fast + deterministic + 100+ cases.

type Node = { id: string; title: string; content: string; embedding: number[] };

async function rank(nodes: Node[], query: string, limit = 5) {
  const qEmb = await generateEmbedding(query);
  return nodes
    .map((n) => ({
      id: n.id,
      score: cosineSimilarity(qEmb, n.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function makeNodes(n: number): Promise<Node[]> {
  const topics = [
    "postgres pgvector",
    "zettelkasten obsidian",
    "tailscale ssh",
    "docker compose",
    "nginx 502",
    "guardrails no-search",
    "neo4j graph",
    "meilisearch full text",
    "vitest playwright",
    "pm2 systemd",
  ];

  return Promise.all(
    Array.from({ length: n }).map(async (_, i) => {
      const t = topics[i % topics.length];
      const title = `n${i}-${t}`;
      const content = `This node is about ${t}. It contains details: ${t} ${t} ${i}.`;
      const embedding = await generateEmbedding(`${title}\n\n${content}`);
      return { id: String(i), title, content, embedding };
    })
  );
}

describe("KB: semantic ranking", () => {
  test("returns the expected topic near top", async () => {
    const nodes = await makeNodes(60);
    const top = await rank(nodes, "pgvector postgres embeddings", 5);
    // At least one of the top results must mention pgvector/postgres topic.
    const topIds = new Set(top.map((t) => t.id));
    const expected = nodes.find((n) => n.title.includes("postgres pgvector"))!;
    expect(topIds.has(expected.id)).toBe(true);
  });

  test("100 randomized queries produce non-empty rankings", async () => {
    const nodes = await makeNodes(120);
    const queries = [
      "postgres vector search",
      "obsidian vault export",
      "ssh via tailscale",
      "docker build no-cache",
      "nginx bad gateway",
      "no busques sin fuentes",
      "knowledge graph edges",
      "full text search",
      "e2e playwright",
      "pm2 restart",
    ];

    for (let i = 0; i < 100; i++) {
      const q = queries[i % queries.length] + ` ${i}`;
      const top = await rank(nodes, q, 5);
      expect(top.length).toBeGreaterThan(0);
      // Scores should be in [-1,1] range
      for (const r of top) {
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.score).toBeGreaterThanOrEqual(-1);
      }
    }
  });
});
