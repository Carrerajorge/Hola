
-- =============================================================================

-- Migration 0024: semantic_memory_chunks + token_ledger_usage + knowledge_nodes

-- Compatible with users.id = VARCHAR

-- =============================================================================



-- --- semantic_memory_chunks ---

CREATE TABLE IF NOT EXISTS semantic_memory_chunks (

  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  content TEXT NOT NULL,

  type VARCHAR(50) NOT NULL,

  source VARCHAR(100) DEFAULT 'explicit',

  confidence INTEGER DEFAULT 80,

  access_count INTEGER DEFAULT 0,

  tags TEXT[] DEFAULT ARRAY[]::text[],

  metadata JSONB DEFAULT '{}'::jsonb,

  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);



CREATE INDEX IF NOT EXISTS semantic_memory_user_idx ON semantic_memory_chunks(user_id);

CREATE INDEX IF NOT EXISTS semantic_memory_type_idx ON semantic_memory_chunks(type);

CREATE INDEX IF NOT EXISTS semantic_memory_created_idx ON semantic_memory_chunks(created_at);



-- --- token_ledger_usage ---

-- NOTE: In code schema it's UUID FKs, but DB uses users.id VARCHAR; keep it flexible for now.

CREATE TABLE IF NOT EXISTS token_ledger_usage (

  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),

  request_id TEXT NOT NULL,

  session_id TEXT,

  user_id VARCHAR(255),

  workspace_id VARCHAR(255),

  model_id VARCHAR(255),

  model_name TEXT NOT NULL,

  input_tokens INTEGER NOT NULL DEFAULT 0,

  output_tokens INTEGER NOT NULL DEFAULT 0,

  cache_tokens INTEGER NOT NULL DEFAULT 0,

  total_tokens INTEGER NOT NULL DEFAULT 0,

  calculated_input_cost DOUBLE PRECISION NOT NULL DEFAULT 0,

  calculated_output_cost DOUBLE PRECISION NOT NULL DEFAULT 0,

  total_calculated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,

  latency_ms INTEGER,

  was_fallback BOOLEAN DEFAULT false,

  fallback_from_model TEXT,

  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);



CREATE INDEX IF NOT EXISTS token_ledger_usage_workspace_id_idx ON token_ledger_usage(workspace_id);

CREATE INDEX IF NOT EXISTS token_ledger_usage_user_id_idx ON token_ledger_usage(user_id);

CREATE INDEX IF NOT EXISTS token_ledger_usage_request_id_idx ON token_ledger_usage(request_id);

CREATE INDEX IF NOT EXISTS token_ledger_usage_created_at_idx ON token_ledger_usage(created_at);



-- --- knowledge_nodes ---

CREATE TABLE IF NOT EXISTS knowledge_nodes (

  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  zettel_id VARCHAR(64),

  title TEXT NOT NULL,

  content TEXT NOT NULL,

  node_type TEXT NOT NULL DEFAULT 'note',

  source_type TEXT NOT NULL DEFAULT 'manual',

  source_id VARCHAR(255),

  tags TEXT[] DEFAULT ARRAY[]::text[],

  embedding VECTOR,

  search_vector TSVECTOR,

  content_hash TEXT,

  metadata JSONB DEFAULT '{}'::jsonb,

  importance REAL DEFAULT 0.5,

  access_count INTEGER DEFAULT 0,

  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  is_active BOOLEAN DEFAULT true

);



CREATE INDEX IF NOT EXISTS knowledge_nodes_user_idx ON knowledge_nodes(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_zettel_idx ON knowledge_nodes(user_id, zettel_id);

CREATE INDEX IF NOT EXISTS knowledge_nodes_type_idx ON knowledge_nodes(node_type);

CREATE INDEX IF NOT EXISTS knowledge_nodes_source_idx ON knowledge_nodes(source_type, source_id);

CREATE INDEX IF NOT EXISTS knowledge_nodes_created_idx ON knowledge_nodes(created_at);

CREATE INDEX IF NOT EXISTS knowledge_nodes_search_idx ON knowledge_nodes USING gin(search_vector);

-- NOTE: tags GIN + embedding HNSW indices omitted for portability/stability (can be added later).

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_hash_idx ON knowledge_nodes(user_id, content_hash);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_user_source_idx ON knowledge_nodes(user_id, source_type, source_id);

