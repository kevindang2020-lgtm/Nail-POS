-- 378_global_tech_admin.sql — Super Admin's authority over a technician's platform account, and the one thing
-- that makes a cross-tenant transfer actually move somebody.
--
-- == D4: TWO TRANSFER SYSTEMS THAT NEVER SPOKE =============================================================
--
-- `worker_cross_tenant_transfer_requests` (Super Admin) and `tech_salon_memberships` (the Tech App + POS) both
-- claim to move a technician between salons. They have never known about each other.
--
-- And the Super Admin one does not move anybody. Its own repository says so:
--
--     "NOTE: neither branch records the decision by provisioning access or moving history — a cross-tenant
--      move's execution is a separate, live-infrastructure step. Here we only flip status + record who/when/why."
--
-- The audit row it writes even carries `provisioning: 'deferred'`. It is an approval with no execution: a Super
-- Admin approves a transfer, everyone sees "approved", and the technician is still at the old salon with no
-- access to the new one and nothing anywhere to tell them why.
--
-- Approval now EXECUTES, through the canonical path — `tech_salon_memberships` — so there is one transfer state
-- and two entry points, rather than two states and no transfer.

-- ── the transfer intent, carried on the membership ───────────────────────────────────────────────────────
--
-- A transfer is an ARRIVAL and a DEPARTURE, and the order matters. Marking the old salon 'former' at APPROVAL
-- time would fire a technician from a job she still has, on the strength of a move she has not accepted yet —
-- and if she never accepts, she is now employed nowhere.
--
-- So the departure rides on the arrival: the source salon is recorded HERE, and the old membership only becomes
-- 'former' when this one actually goes ACTIVE. Leaving is a consequence of arriving, never of a decision taken
-- about you.
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS transfer_from_tenant_id UUID;
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS transfer_request_id     UUID;

-- ── merge: the same human, two accounts ─────────────────────────────────────────────────────────────────
--
-- A duplicate happens for a boring reason: Salon A created her with only an email, Salon B with only a phone,
-- and neither key matched the other. Merging is the fix — and it is irreversible, so the losing row is not
-- deleted. It becomes a signpost: status 'merged', pointing at the profile that absorbed it, KEEPING its
-- tech_code forever so that id can never be handed to anybody else.
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS merged_into_profile_id UUID;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS merged_at              TIMESTAMPTZ;

ALTER TABLE global_tech_profiles DROP CONSTRAINT IF EXISTS global_tech_profiles_status_check;
ALTER TABLE global_tech_profiles ADD  CONSTRAINT global_tech_profiles_status_check
  CHECK (status IN ('active', 'suspended', 'anonymized', 'merged'));

-- A merged profile releases its keys to the profile that absorbed it, so the partial-unique indexes from 376
-- must ignore it exactly as they ignore a tombstone.
DROP INDEX IF EXISTS uq_gtp_phone_hash;
DROP INDEX IF EXISTS uq_gtp_email;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtp_phone_hash ON global_tech_profiles (phone_hash)
  WHERE phone_hash IS NOT NULL AND status NOT IN ('anonymized', 'merged');
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtp_email ON global_tech_profiles (email_normalized)
  WHERE email_normalized IS NOT NULL AND status NOT IN ('anonymized', 'merged');

CREATE INDEX IF NOT EXISTS idx_gtp_merged_into ON global_tech_profiles (merged_into_profile_id)
  WHERE merged_into_profile_id IS NOT NULL;

-- ── deletion is a REQUEST, not a button ─────────────────────────────────────────────────────────────────
--
-- The spec: "Only Super Admin can permanently delete or anonymize a technician account, and only when the
-- technician requests it and the platform's legal/data-retention rules allow it."
--
-- Every clause in that sentence is a column. A reason is mandatory. Who asked is recorded, and WHICH KIND of
-- person asked — a technician erasing her own account and a support agent doing it for her are not the same
-- event, and a system that cannot tell them apart cannot prove the first one ever happened. A legal hold blocks
-- completion outright.
CREATE TABLE IF NOT EXISTS global_tech_delete_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  requester_kind         TEXT NOT NULL CHECK (requester_kind IN ('technician', 'support', 'legal')),
  requested_by_user_id   UUID,
  reason                 TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  legal_hold             BOOLEAN NOT NULL DEFAULT false,
  decided_by_user_id     UUID,
  decided_at             TIMESTAMPTZ,
  decision_note          TEXT,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gtdr_profile ON global_tech_delete_requests (global_tech_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_gtdr_status  ON global_tech_delete_requests (status, created_at DESC);

-- One open request per technician. Two pending erasure requests for one person is a race over an irreversible act.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtdr_one_open ON global_tech_delete_requests (global_tech_profile_id)
  WHERE status IN ('pending', 'approved');

-- ── what anonymization must NOT touch ───────────────────────────────────────────────────────────────────
--
-- Nothing here deletes a `technicians` row, a ticket, a payment, a payroll line, or an audit_log. The spec is
-- explicit — "Preserve required audit/payment/payroll history" — and those all key on technician_id (the
-- SALON's employment record), never on the global profile. The global profile carries what the technician OWNS:
-- her name, her photo, her bio, her portfolio, her followers. That is what an erasure erases, and the salon's
-- books survive it intact.
