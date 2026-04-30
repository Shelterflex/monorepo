-- Tenant Document Vault
-- Stores uploaded documents for tenants with metadata, tags, and expiration tracking

CREATE TABLE IF NOT EXISTS tenant_documents (
  id VARCHAR(128) PRIMARY KEY DEFAULT CONCAT('DOC-', EXTRACT(EPOCH FROM NOW())::bigint, '-', nextval('tenant_documents_seq')),
  user_id VARCHAR(128) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_format VARCHAR(10) NOT NULL CHECK (file_format IN ('pdf', 'jpg', 'jpeg', 'png', 'webp', 'svg', 'doc', 'docx')),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 26214400),
  storage_key VARCHAR(512) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('identification', 'receipt', 'agreement', 'insurance', 'utility', 'other')),
  tags JSONB NOT NULL DEFAULT '[]',
  expires_at TIMESTAMPTZ,
  description VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-increment sequence for ID generation
CREATE SEQUENCE IF NOT EXISTS tenant_documents_seq;

-- Index for user-scoped queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_tenant_documents_user_id ON tenant_documents (user_id);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_tenant_documents_category ON tenant_documents (category);

-- Index for expiration tracking (used for status computation)
CREATE INDEX IF NOT EXISTS idx_tenant_documents_expires_at ON tenant_documents (expires_at) WHERE expires_at IS NOT NULL;

-- GIN index for tag-based queries
CREATE INDEX IF NOT EXISTS idx_tenant_documents_tags ON tenant_documents USING GIN (tags);

-- Full-text search on file name and description
CREATE INDEX IF NOT EXISTS idx_tenant_documents_search ON tenant_documents USING GIN (
  to_tsvector('english', file_name || ' ' || COALESCE(description, ''))
);

-- Prevent cross-tenant access at DB level
ALTER TABLE tenant_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_documents_isolation ON tenant_documents
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', TRUE));
