-- 184_ip_block_rules.sql — IP block rules + allowlist. A block is refused for protected sources (loopback/reserved,
-- allowlisted addresses, or configured trusted/office/health-check/emergency CIDRs) so a block can never lock out
-- administrators or monitoring. Blocks carry a reason, threat type, source, optional expiry, and a review status; every
-- create/unblock writes a security audit event. Allowlist rows (is_allowlist=true) mark protected exact IPs or CIDRs.
CREATE TABLE IF NOT EXISTS ip_block_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target         TEXT NOT NULL,                          -- exact IP or CIDR
  block_kind     TEXT NOT NULL DEFAULT 'exact' CHECK (block_kind IN ('exact','cidr')),
  ip_version     INTEGER NOT NULL DEFAULT 4,
  is_allowlist   BOOLEAN NOT NULL DEFAULT FALSE,
  threat_type    TEXT,
  source         TEXT,
  reason         TEXT,
  country        TEXT,
  tenant_id      UUID,                                   -- NULL = platform-wide
  status         TEXT NOT NULL DEFAULT 'blocked'
                   CHECK (status IN ('blocked','expired','under_review','allowed','whitelisted')),
  review_status  TEXT NOT NULL DEFAULT 'pending',
  blocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ip_block_rules_target ON ip_block_rules (target, status);
CREATE INDEX IF NOT EXISTS idx_ip_block_rules_status ON ip_block_rules (status, is_allowlist, blocked_at);
