-- 740_message_templates_center.sql — Message Templates & Automation Center Complete Build Guide (30 Oct 2026). ADDITIVE ONLY.
-- No row is deleted, rewritten or re-attributed.
--
-- The salon's templates stay in pos_message_templates (017a; tenant_id uuid since 539) — the store behind
-- /tenant/communications/templates (GET/POST pos/settings/notifications-reminders/templates) and the SMS Inbox composer. It
-- is NOT moved into message_templates (183/280): that pair is the Super Admin-managed, platform-level, approval-tracked store,
-- which the Inbox composer keeps offering beside the salon's own (scope 'platform'). One salon store, extended in place:
--
--   pos_message_templates      + category / subject / description / branch scope / status / current_version / record_version
--                              (optimistic edits) / created_by / updated_by / created_at / updated_at / archived_at / last_used_at.
--                              Existing rows: status 'active' (they were already offered to the Inbox composer), version 1,
--                              created_at NULL = "created date unknown" (never guessed), record_version 1.
--   pos_message_template_versions   append-only snapshot of every saved version (name, channel, subject, body, category,
--                              variables). Existing rows get version 1 copied from their current text (backfilled = true).
--   pos_message_template_bindings   which automation uses which template (workflow + branch scope + version strategy). A
--                              workflow reads its active binding at send time; with none it keeps its built-in text. One
--                              active binding per (tenant, branch scope, workflow, channel).
--   pos_message_template_usage      one row per message a template actually produced (Inbox reply, automation, approved
--                              test): exact template version + rendered snapshot + pointer to the notifications row
--                              (provider id / delivery status live there). Historic sends without a template stay unlinked.
--   pos_message_template_tests      Test Send attempts (separate, confirmed, idempotent): masked target + its hash,
--                              outcome, provider reference, sanitized error. Never an automated customer send.
--
-- Rollback: the new tables can be dropped and the added columns ignored by older code (they all have defaults / are NULL).

ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS category        TEXT;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS subject         TEXT;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS branch_id       UUID;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'active';
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS record_version  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS created_by      UUID;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS updated_by      UUID;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ;
ALTER TABLE pos_message_templates ADD COLUMN IF NOT EXISTS last_used_at    TIMESTAMPTZ;
ALTER TABLE pos_message_templates ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE pos_message_templates ALTER COLUMN updated_at SET DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pmt_status') THEN
    ALTER TABLE pos_message_templates ADD CONSTRAINT ck_pmt_status CHECK (status IN ('draft', 'active', 'inactive', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pmt_channel') THEN
    ALTER TABLE pos_message_templates ADD CONSTRAINT ck_pmt_channel CHECK (channel IN ('sms', 'email')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pmt_versions') THEN
    ALTER TABLE pos_message_templates ADD CONSTRAINT ck_pmt_versions CHECK (current_version >= 1 AND record_version >= 1);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_pmt_tenant_created ON pos_message_templates (tenant_id, created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS ix_pmt_tenant_status ON pos_message_templates (tenant_id, status, channel);

CREATE TABLE IF NOT EXISTS pos_message_template_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  template_id   TEXT NOT NULL,
  version       INTEGER NOT NULL CHECK (version >= 1),
  name          TEXT NOT NULL,
  channel       TEXT NOT NULL,
  category      TEXT,
  subject       TEXT,
  body          TEXT NOT NULL,
  variables     TEXT[] NOT NULL DEFAULT '{}',
  backfilled    BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pmtv_version UNIQUE (tenant_id, template_id, version),
  CONSTRAINT fk_pmtv_template FOREIGN KEY (tenant_id, template_id) REFERENCES pos_message_templates (tenant_id, id)
);

INSERT INTO pos_message_template_versions (tenant_id, template_id, version, name, channel, body, backfilled, created_at)
SELECT t.tenant_id, t.id, 1, t.name, t.channel, t.body, true, now()
  FROM pos_message_templates t
 WHERE NOT EXISTS (SELECT 1 FROM pos_message_template_versions v WHERE v.tenant_id = t.tenant_id AND v.template_id = t.id);

CREATE TABLE IF NOT EXISTS pos_message_template_bindings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  workflow         TEXT NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  template_id      TEXT NOT NULL,
  version_strategy TEXT NOT NULL DEFAULT 'latest' CHECK (version_strategy IN ('latest', 'pinned')),
  pinned_version   INTEGER,
  active           BOOLEAN NOT NULL DEFAULT true,
  record_version   INTEGER NOT NULL DEFAULT 1,
  created_by       UUID,
  updated_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pmtb_pinned CHECK ((version_strategy = 'pinned') = (pinned_version IS NOT NULL)),
  CONSTRAINT fk_pmtb_template FOREIGN KEY (tenant_id, template_id) REFERENCES pos_message_templates (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmtb_active ON pos_message_template_bindings
  (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), workflow, channel) WHERE active;
CREATE INDEX IF NOT EXISTS ix_pmtb_template ON pos_message_template_bindings (tenant_id, template_id) WHERE active;

CREATE TABLE IF NOT EXISTS pos_message_template_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  branch_id         UUID,
  template_id       TEXT NOT NULL,
  template_version  INTEGER NOT NULL,
  workflow          TEXT NOT NULL,
  channel           TEXT NOT NULL,
  customer_id       UUID,
  appointment_id    UUID,
  thread_id         UUID,
  message_id        UUID,
  notification_id   UUID,
  test_id           UUID,
  recipient_masked  TEXT,
  rendered_subject  TEXT,
  rendered_body     TEXT NOT NULL,
  send_outcome      TEXT NOT NULL CHECK (send_outcome IN ('submitted', 'blocked', 'failed', 'simulated')),
  outcome_reason    TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_pmtu_template FOREIGN KEY (tenant_id, template_id) REFERENCES pos_message_templates (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS ix_pmtu_tenant_created ON pos_message_template_usage (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_pmtu_template ON pos_message_template_usage (tenant_id, template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_pmtu_customer ON pos_message_template_usage (tenant_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_message_template_tests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  branch_id         UUID,
  template_id       TEXT NOT NULL,
  template_version  INTEGER NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  target_masked     TEXT NOT NULL,
  target_hash       TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'submitting',
  provider_ref      TEXT,
  notification_id   UUID,
  error_code        TEXT,
  created_by        UUID,
  updated_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pmtt_status CHECK (status IN ('submitting', 'submitted', 'blocked', 'failed', 'simulated')),
  CONSTRAINT uq_pmtt_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT fk_pmtt_template FOREIGN KEY (tenant_id, template_id) REFERENCES pos_message_templates (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS ix_pmtt_template ON pos_message_template_tests (tenant_id, template_id, created_at DESC);
