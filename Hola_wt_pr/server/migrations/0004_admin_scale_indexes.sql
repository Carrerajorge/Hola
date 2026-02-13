-- Admin + Audit scaling indexes
-- Adds missing functional/composite indexes used by admin dashboard queries.

-- Users: case-insensitive email lookups (storage.getUserByEmail / admin auth)
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

-- Payments: list, stats, and exports
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user_created_at ON payments(user_id, created_at DESC);

-- Invoices: list, stats, and exports
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status_created_at ON invoices(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_user_created_at ON invoices(user_id, created_at DESC);

-- Audit logs: common drill-downs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_created_at ON audit_logs(ip_address, created_at DESC);

