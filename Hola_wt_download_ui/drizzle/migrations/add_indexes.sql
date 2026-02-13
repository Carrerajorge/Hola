-- Migration: Add missing database indexes for performance
-- This migration adds indexes to frequently queried columns

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);

-- Sessions table indexes (for faster session lookups)
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

-- Chats table indexes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chats') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)';
    END IF;
END $$;

-- Messages table indexes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'messages') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role)';
    END IF;
END $$;

-- Audit logs table indexes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource)';
    END IF;
END $$;

-- Payments table indexes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'payments') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at)';
    END IF;
END $$;

-- Magic links table indexes
CREATE INDEX IF NOT EXISTS idx_magic_links_user_id ON magic_links(user_id);
CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires_at ON magic_links(expires_at);

-- User settings indexes
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Consent logs indexes
CREATE INDEX IF NOT EXISTS idx_consent_logs_user_id ON consent_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_logs_consent_type ON consent_logs(consent_type);

-- Excel documents indexes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'excel_documents') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_excel_docs_created_at ON excel_documents(created_at)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_excel_docs_is_template ON excel_documents(is_template)';
    END IF;
END $$;

-- Notifications table indexes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notifications') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at)';
    END IF;
END $$;

-- Analyze tables to update statistics after creating indexes
ANALYZE users;
ANALYZE sessions;
