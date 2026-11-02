-- 376_global_tech_identity.sql — ONE permanent technician identity. The salon links UP to it.
--
-- == WHAT THE AUDIT FOUND ==================================================================================
--
-- The global layer already exists (066_tech_profiles.sql): global_tech_profiles, tech_salon_memberships,
-- tech_portfolio_photos, reviews.global_tech_profile_id, customer_favorite_techs. It is GOOD. It is also
-- ORPHANED:
--
--   * The ONLY code path that ever created a global profile was `getOrCreateMyProfile` — which requires the
--     technician to already be logged in to the Tech App.
--   * The manager's create-technician flow (technicians.kysely.repository create()) writes a `technicians`
--     row with NO user_id and NO global_tech_profile_id, and creates no `users` row at all.
--   * So a manager-created technician can never log in, and therefore can never reach the only code that
--     would have given them a global identity. The wire from identity to the global layer was never
--     connected.
--
-- == THE MODEL (option b — chosen deliberately) ============================================================
--
-- Staff login is TENANT-SCOPED and stays that way:
--
--     auth-user.kysely.repository:  select … from users where tenant_id = <tenant> and lower(email) = …
--
-- That predicate is the tenant chokepoint. It was just proven correct by tenant-isolation.pgtest against the
-- real repositories, with two salons sharing a customer. We are NOT reopening it.
--
-- So: the technician keeps ONE `users` row PER SALON — exactly as today — and each of those rows now points
-- UP at ONE global_tech_profiles row that they all share.
--
--     users(tenant A) ─┐
--     users(tenant B) ─┼──> global_tech_profiles   ← the permanent identity. tech_code. followers. ratings.
--     users(tenant C) ─┘                             portfolio. public profile.
--
-- The technician signs in at each salon, and sees ONE profile, ONE portfolio, ONE follower list, ONE rating,
-- and can switch context between the salons they are actively employed at.
--
-- What this buys, precisely: a global identity WITHOUT a second user table, WITHOUT a second technician
-- system, and WITHOUT touching the login query.

-- ── 1. The permanent technician ID ───────────────────────────────────────────────────────────────────────
--
-- Sequence-backed, so it is NEVER reused. An anonymized technician KEEPS their row (status='anonymized',
-- PII stripped) rather than being deleted — which is the only way "never reuse a technician ID" can actually
-- be guaranteed. A deleted row's id would be free for the sequence to hand out again the moment the sequence
-- was ever reset or the row re-inserted; a retained tombstone cannot be.
CREATE SEQUENCE IF NOT EXISTS global_tech_code_seq START 1;

ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS tech_code         TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS normalized_phone  TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS phone_hash        TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS email_normalized  TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active';
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS suspended_at      TIMESTAMPTZ;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS suspend_reason    TEXT;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS anonymized_at     TIMESTAMPTZ;
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS anonymize_reason  TEXT;

-- Only Super Admin ever moves a profile out of 'active' (enforced in the service; the CHECK just bounds the
-- domain so a bad write cannot invent a status nothing handles).
ALTER TABLE global_tech_profiles DROP CONSTRAINT IF EXISTS global_tech_profiles_status_check;
ALTER TABLE global_tech_profiles ADD  CONSTRAINT global_tech_profiles_status_check
  CHECK (status IN ('active', 'suspended', 'anonymized'));

-- Backfill every existing profile with a code, then make it mandatory. Ordered by created_at so the oldest
-- technician on the platform is TECH-000001 and the codes are not arbitrary.
UPDATE global_tech_profiles p
   SET tech_code = 'TECH-' || lpad(nextval('global_tech_code_seq')::text, 6, '0')
  FROM (SELECT id FROM global_tech_profiles WHERE tech_code IS NULL ORDER BY created_at, id) o
 WHERE p.id = o.id AND p.tech_code IS NULL;

ALTER TABLE global_tech_profiles ALTER COLUMN tech_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtp_tech_code ON global_tech_profiles (tech_code);

-- ── 2. The GLOBAL dedupe keys ────────────────────────────────────────────────────────────────────────────
--
-- This is what makes "manager types a phone number → we find the technician who already exists" possible.
--
-- phone_hash is the searchable key and uses the SAME primitive as the customer-phone module
-- (customer-activation-core.phoneKey — sha256, unsalted). Unsalted is deliberate and is the whole point HERE:
-- the hash must collide across tenants, because a technician is the same person at Salon A and Salon B. That
-- is the exact opposite of the customer model, where a cross-tenant match would be a leak — so note the
-- asymmetry rather than "fixing" it later:
--
--     CUSTOMER phone  → matched WITHIN a tenant.  A cross-tenant match is a privacy leak.
--     TECHNICIAN phone → matched ACROSS tenants.  A cross-tenant match is the FEATURE.
--
-- normalized_phone is kept in the clear too — the platform must be able to contact its own technicians, and
-- the technician's phone is their own contact detail on their own global profile, not a salon's customer list.
--
-- Partial-unique: a profile with no phone does not collide with every other profile that has no phone, and an
-- anonymized profile releases its keys (its PII is stripped) without releasing its tech_code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtp_phone_hash ON global_tech_profiles (phone_hash)
  WHERE phone_hash IS NOT NULL AND status <> 'anonymized';
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtp_email ON global_tech_profiles (email_normalized)
  WHERE email_normalized IS NOT NULL AND status <> 'anonymized';
CREATE INDEX IF NOT EXISTS idx_gtp_status ON global_tech_profiles (status);

-- ── 3. users links UP to the global profile ──────────────────────────────────────────────────────────────
--
-- The ONE column that makes option (b) work. The login row stays tenant-scoped; it just declares which global
-- technician it belongs to. Nullable, because OWNER/MANAGER/FRONT_DESK/CUSTOMER rows have no global tech
-- identity — only technicians do.
ALTER TABLE users ADD COLUMN IF NOT EXISTS global_tech_profile_id UUID;
CREATE INDEX IF NOT EXISTS idx_users_gtp ON users (global_tech_profile_id) WHERE global_tech_profile_id IS NOT NULL;

-- A technician has at most ONE login per salon. Without this, two managers hiring the same technician at the
-- same time produce two logins for one person at one salon, and the Tech App's `where user_id = …` lookup
-- silently resolves to whichever one it happened to find.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_gtp ON users (tenant_id, global_tech_profile_id)
  WHERE global_tech_profile_id IS NOT NULL;

-- ── 4. The employment relationship: the full status model ────────────────────────────────────────────────
--
-- 066 shipped 5 statuses (pending/active/inactive/rejected/cancelled). The spec needs the states a real
-- employment relationship actually goes through, and the difference matters:
--
--     pending_invite          the SALON invited the tech; waiting on the TECH
--     pending_tech_approval   same, from the tech's side of a manager-initiated link to an EXISTING profile
--     pending_salon_approval  the TECH asked to join; waiting on the SALON   (← old 'pending')
--     active                  employed here now
--     suspended               employed here, access paused by the salon      (was not expressible)
--     former                  no longer employed here; history retained      (← old 'inactive')
--     rejected                the salon said no to a tech's request
--     revoked                 the salon removed the tech's access
--     cancelled               the TECH withdrew their own pending request     (kept from 066)
--
-- 'cancelled' is a 9th status, not one of the 8 in the spec. It is retained deliberately: a technician
-- withdrawing their own request is not the salon rejecting them, and collapsing the two would put a rejection
-- on the technician's record that no salon ever issued.
ALTER TABLE tech_salon_memberships DROP CONSTRAINT IF EXISTS tech_salon_memberships_status_check;
UPDATE tech_salon_memberships SET status = 'pending_salon_approval' WHERE status = 'pending';
UPDATE tech_salon_memberships SET status = 'former'                 WHERE status = 'inactive';
ALTER TABLE tech_salon_memberships ALTER COLUMN status SET DEFAULT 'pending_salon_approval';
ALTER TABLE tech_salon_memberships ADD CONSTRAINT tech_salon_memberships_status_check CHECK (status IN (
  'pending_invite', 'pending_tech_approval', 'pending_salon_approval',
  'active', 'suspended', 'former', 'rejected', 'revoked', 'cancelled'));

-- The per-salon login this membership grants. Option (b): membership → users row → technicians row.
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS user_id            UUID;
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS invited_by_user_id UUID;
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS invitation_id      UUID;
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS role_label         TEXT;
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS ended_reason       TEXT;
CREATE INDEX IF NOT EXISTS idx_tsm_user ON tech_salon_memberships (user_id);

-- 066's UNIQUE (global_tech_profile_id, tenant_id, branch_id) does NOT stop two rows when branch_id IS NULL —
-- Postgres treats NULLs as distinct in a unique index, and a tech-initiated join request carries no branch.
-- So two concurrent "connect to this salon" taps could open two pending requests for the same salon. Closed:
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsm_profile_tenant_nobranch
  ON tech_salon_memberships (global_tech_profile_id, tenant_id) WHERE branch_id IS NULL;

-- ── 5. Salon-private data stays salon-private ────────────────────────────────────────────────────────────
--
-- Nothing above moves payroll, commission, schedule, internal notes, or salon customer data onto the global
-- profile — those live on `technicians` / `technician_schedules` / `technician_services` / tenant tables and
-- are tenant_id-scoped, which `check:tenant` enforces statically over every query in the repo. The global
-- profile carries only what the technician owns: name, photo, bio, portfolio, specialties, languages, public
-- rating, followers.
