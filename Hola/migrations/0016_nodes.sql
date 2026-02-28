-- Nodes: paired laptop/desktop daemons (org-scoped)

CREATE TABLE IF NOT EXISTS nodes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'default',
  owner_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT,
  agent_version TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_hash TEXT NOT NULL,
  last_seen_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nodes_org_idx ON nodes(org_id);
CREATE INDEX IF NOT EXISTS nodes_owner_idx ON nodes(owner_user_id);
CREATE INDEX IF NOT EXISTS nodes_last_seen_idx ON nodes(last_seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS nodes_org_name_unique ON nodes(org_id, name);

CREATE TABLE IF NOT EXISTS node_pairings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'default',
  created_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS node_pairings_org_idx ON node_pairings(org_id);
CREATE INDEX IF NOT EXISTS node_pairings_expires_idx ON node_pairings(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS node_pairings_code_unique ON node_pairings(code);

CREATE TABLE IF NOT EXISTS node_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'default',
  node_id VARCHAR NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  requested_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  result JSONB,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS node_jobs_org_idx ON node_jobs(org_id);
CREATE INDEX IF NOT EXISTS node_jobs_node_idx ON node_jobs(node_id);
CREATE INDEX IF NOT EXISTS node_jobs_status_idx ON node_jobs(status);
CREATE INDEX IF NOT EXISTS node_jobs_created_idx ON node_jobs(created_at);
