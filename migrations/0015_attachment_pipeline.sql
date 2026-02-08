-- Migration: First-class attachment pipeline
-- Creates attachments, message_attachments, and attachment_chunks tables

-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- attachments — first-class persistent entities
-- ============================================================================
CREATE TABLE IF NOT EXISTS attachments (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    storage_path TEXT NOT NULL,
    signed_url TEXT,
    signed_url_expires_at TIMESTAMP,
    pipeline_status TEXT NOT NULL DEFAULT 'pending',
    pipeline_error TEXT,
    extracted_text TEXT,
    ocr_text TEXT,
    image_caption TEXT,
    structured_data JSONB,
    chunk_count INTEGER DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS attachments_user_idx ON attachments(user_id);
CREATE INDEX IF NOT EXISTS attachments_sha256_idx ON attachments(sha256);
CREATE INDEX IF NOT EXISTS attachments_pipeline_status_idx ON attachments(pipeline_status);
CREATE INDEX IF NOT EXISTS attachments_created_at_idx ON attachments(created_at);
CREATE INDEX IF NOT EXISTS attachments_user_created_idx ON attachments(user_id, created_at);

-- ============================================================================
-- message_attachments — junction table
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_attachments (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    attachment_id VARCHAR NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS message_attachments_attachment_idx ON message_attachments(attachment_id);
CREATE UNIQUE INDEX IF NOT EXISTS message_attachments_unique ON message_attachments(message_id, attachment_id);

-- ============================================================================
-- attachment_chunks — RAG-ready chunks with BM25 + vector support
-- ============================================================================
CREATE TABLE IF NOT EXISTS attachment_chunks (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    attachment_id VARCHAR NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(1536),
    chunk_index INTEGER NOT NULL,
    page_number INTEGER,
    source_type TEXT,
    bbox JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS attachment_chunks_attachment_idx ON attachment_chunks(attachment_id);
CREATE INDEX IF NOT EXISTS attachment_chunks_embedding_idx ON attachment_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS attachment_chunks_tsv_idx ON attachment_chunks USING gin (to_tsvector('spanish', coalesce(content, '')));
