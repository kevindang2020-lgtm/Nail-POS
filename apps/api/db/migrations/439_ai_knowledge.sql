-- 439_ai_knowledge.sql — Constitution 10 §143–§150: tenant AI knowledge.
--
-- §145 IS A DECISION, NOT A DEFAULT: "Do not introduce vector database unless semantic retrieval is actually
-- required. Use the simplest architecture compatible with scale." A salon's knowledge is a handful of policy
-- documents — hours, cancellation terms, service notes, FAQs. Postgres full-text search over that is not a
-- compromise, it is the correct tool, and pg_trgm is already in this tree (migration 107).
--
-- So there are no embeddings here. What IS here is the shape that makes adding them later a migration rather
-- than a rewrite: chunks are already separate rows with a stable id, and `embedding_model_version` exists so
-- §147's rule — never silently mix incompatible vector spaces — is enforceable from the first embedded row.
--
-- NOT a second help_articles (migration 142). That table is PLATFORM product documentation with no tenant_id;
-- this is a TENANT's own knowledge about their own salon. Different owner, different lifecycle, different reader.

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  -- §144: branch ownership. NULL = the whole tenant; a value scopes it to one branch.
  branch_id       UUID,
  kind            TEXT NOT NULL CHECK (kind IN ('policy','faq','service_policy','booking_policy','document')),
  title           TEXT NOT NULL,
  -- §149 lifecycle. AI reads PUBLISHED only — enforced in the retrieval query, not by convention.
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','PROCESSING','READY','PUBLISHED','ARCHIVED')),
  -- §144/§150: visibility is EXPLICIT. 'staff_private' never becomes receptionist knowledge by default, and
  -- 'customer_facing' is the only class an AI may quote to a customer.
  visibility      TEXT NOT NULL DEFAULT 'staff_private'
                  CHECK (visibility IN ('staff_private','staff_shared','customer_facing')),
  -- §150: roles that may see it. Empty = every role allowed by `visibility`.
  allowed_roles   TEXT[] NOT NULL DEFAULT '{}',
  source_uri      TEXT,
  published_at    TIMESTAMPTZ,
  published_by    UUID,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_knowledge_docs_tenant ON ai_knowledge_documents (tenant_id, status, visibility);

-- §146: chunks are separate rows from the start, each individually addressable, so retrieval returns a passage
-- rather than a whole document and an embedding can later attach to exactly one chunk.
CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES ai_knowledge_documents (id) ON DELETE CASCADE,
  -- Denormalised deliberately: §144 says filter BEFORE retrieval, and a retrieval query that has to join to
  -- learn the tenant is a query someone will eventually write without the join.
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  chunk_index     INTEGER NOT NULL CHECK (chunk_index >= 0),
  content         TEXT NOT NULL,
  -- Postgres full-text, generated so it can never drift from `content`.
  content_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  -- §146/§147: NULL until embeddings exist. When they do, this names the model+version that produced the
  -- vector, and a query must filter on ONE value — mixing two vector spaces silently is what §147 forbids.
  embedding_model_version TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS ix_ai_knowledge_chunks_fts ON ai_knowledge_chunks USING GIN (content_tsv);
CREATE INDEX IF NOT EXISTS ix_ai_knowledge_chunks_tenant ON ai_knowledge_chunks (tenant_id, branch_id);
