-- Personal Knowledge Base (KB)
-- Minimal + aggressive: single Postgres store with nodes + typed edges.
-- Optional pgvector extension for future true vector search.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "kb_nodes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(32) NOT NULL,
  "title" text,
  "content" text NOT NULL,
  "tags" text[] DEFAULT ARRAY[]::text[],
  "source_ref" text,
  "embedding" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kb_nodes_owner_idx" ON "kb_nodes" ("owner_user_id");
CREATE INDEX IF NOT EXISTS "kb_nodes_type_idx" ON "kb_nodes" ("owner_user_id", "type");
CREATE INDEX IF NOT EXISTS "kb_nodes_updated_idx" ON "kb_nodes" ("owner_user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "kb_edges" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "from_node_id" varchar NOT NULL REFERENCES "kb_nodes"("id") ON DELETE CASCADE,
  "to_node_id" varchar NOT NULL REFERENCES "kb_nodes"("id") ON DELETE CASCADE,
  "relation" varchar(48) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "kb_edges_unique" UNIQUE ("owner_user_id", "from_node_id", "to_node_id", "relation")
);

CREATE INDEX IF NOT EXISTS "kb_edges_owner_from_idx" ON "kb_edges" ("owner_user_id", "from_node_id");
CREATE INDEX IF NOT EXISTS "kb_edges_owner_to_idx" ON "kb_edges" ("owner_user_id", "to_node_id");
