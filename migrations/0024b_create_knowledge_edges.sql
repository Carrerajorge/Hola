
-- Patch after 0024: create knowledge_edges



CREATE TABLE IF NOT EXISTS knowledge_edges (

  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  source_node_id VARCHAR(255) NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,

  target_node_id VARCHAR(255) NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,

  relation_type TEXT NOT NULL,

  weight REAL DEFAULT 1.0,

  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);



CREATE INDEX IF NOT EXISTS knowledge_edges_user_idx ON knowledge_edges(user_id);

CREATE INDEX IF NOT EXISTS knowledge_edges_source_idx ON knowledge_edges(source_node_id);

CREATE INDEX IF NOT EXISTS knowledge_edges_target_idx ON knowledge_edges(target_node_id);

CREATE INDEX IF NOT EXISTS knowledge_edges_relation_idx ON knowledge_edges(relation_type);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_edges_unique ON knowledge_edges(user_id, source_node_id, target_node_id, relation_type);

