-- Composite indexes to speed up Admin Analytics queries on api_logs.
-- These help common filters like provider/status/model within date ranges.

CREATE INDEX IF NOT EXISTS api_logs_provider_created_idx ON api_logs (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS api_logs_status_created_idx ON api_logs (status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS api_logs_model_created_idx ON api_logs (model, created_at DESC);

