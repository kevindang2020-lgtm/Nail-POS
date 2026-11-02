-- 294_platform_announcements_reconcile.sql — seven-package merge reconciliation.
-- Two arcs built on `platform_announcements` from a common ancestor: the Marketing & Campaigns arc (239, richer
-- metrics/audience shape — the canonical CREATE) and the Communications arc (orig 181, targeting/idempotency shape).
-- This ADDITIVE migration brings the Communications columns onto the canonical table and widens the shared CHECK
-- constraints to the union of both dialects. No data is rewritten; both modules read/write their own columns.

ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS subject            text;
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS priority           text NOT NULL DEFAULT 'normal';
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS recipient_roles    text[] NOT NULL DEFAULT '{}';
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS target_scope       text NOT NULL DEFAULT 'all_tenants';
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS target_tenant_ids  uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS recipient_estimate integer NOT NULL DEFAULT 0;
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS idempotency_key    text;
ALTER TABLE platform_announcements ADD COLUMN IF NOT EXISTS created_by         uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_announcements_idem
  ON platform_announcements (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Value-set CHECKs: widen to the union of both arcs. The inline CHECKs from 239 carry generated names, so find and
-- drop them by inspecting the constraint definition, then re-add the union constraint under a stable name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'platform_announcements'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%status%' OR pg_get_constraintdef(oid) LIKE '%channel%')
  LOOP
    EXECUTE format('ALTER TABLE platform_announcements DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE platform_announcements
  ADD CONSTRAINT ck_platform_announcements_status
  CHECK (status IN ('draft','queued','scheduled','sending','sent','cancelled'));
ALTER TABLE platform_announcements
  ADD CONSTRAINT ck_platform_announcements_channel
  CHECK (channel IN ('email','sms','push','in_app','multi'));
ALTER TABLE platform_announcements
  ADD CONSTRAINT ck_platform_announcements_priority
  CHECK (priority IN ('normal','high','critical'));
ALTER TABLE platform_announcements
  ADD CONSTRAINT ck_platform_announcements_target_scope
  CHECK (target_scope IN ('all_tenants','selected','selected_tenants'));
