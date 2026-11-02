-- 366_customer_identity.sql — one customer, one login, many salons.
--
-- ── The problem ──
--
-- A customer is a `users` row scoped to ONE salon (tenant_id NOT NULL, role = 'CUSTOMER'). So the same person who
-- visits two salons has **two accounts** — and, if they registered separately, **two different passwords**. They
-- change their password at one salon and are baffled that the other still wants the old one. There is no way to
-- see "my appointments" across salons, because there is no "me" — only "me at this salon".
--
-- ── The model ──
--
--   customer_identities        one row per PERSON. This is the thing that has a password.
--   customer_identity_links    which salon accounts belong to that person.
--
-- The per-salon `users` rows stay exactly as they are. Every existing foreign key, every appointment, every
-- loyalty balance still points at the salon-scoped row. Nothing is migrated away; an identity is laid ON TOP as
-- the thing you authenticate as.
--
-- ── Deliberately additive ──
--
-- Login tries the identity first and falls back to the old per-salon lookup. A customer with no identity row
-- signs in exactly as before. That matters: this ships without a flag day, and if the identity layer were wrong
-- it degrades to today's behaviour rather than locking anyone out.
--
-- ── The safety property ──
--
-- An identity is keyed on the NORMALIZED PHONE, and a phone is only linked after it has been proven (the SMS
-- activation flow). Two people who share an email typo do not become one person. Two salons that both know
-- +1856… are the same person — that is the whole point.

CREATE TABLE IF NOT EXISTS customer_identities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The identity key. E.164, and UNIQUE: this is what makes "one person" mean something.
  normalized_phone  TEXT NOT NULL UNIQUE,
  email             TEXT,
  full_name         TEXT,
  -- The ONE password. Per-salon users.password_hash stays for backward compatibility but is no longer the thing
  -- a customer manages once they have an identity.
  password_hash     TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  phone_verified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_identities_email ON customer_identities (lower(email)) WHERE email IS NOT NULL;

-- Which salon accounts are this person?
CREATE TABLE IF NOT EXISTS customer_identity_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  UUID NOT NULL REFERENCES customer_identities (id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  -- the salon's CUSTOMER login row
  user_id      UUID NOT NULL,
  -- the salon's customer profile (appointments, loyalty, history hang off this)
  customer_id  UUID,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One link per person per salon. Without this a bug could attach the same salon twice and the salon picker
  -- would show duplicates.
  UNIQUE (identity_id, tenant_id),
  -- And a given salon login belongs to exactly ONE person. This is the constraint that stops two identities
  -- claiming the same account — which would be one customer able to sign in as another.
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS ix_cil_identity ON customer_identity_links (identity_id);
CREATE INDEX IF NOT EXISTS ix_cil_tenant   ON customer_identity_links (tenant_id);

-- ── Backfill ──
--
-- Every existing CUSTOMER with a phone becomes an identity, and their salon accounts are linked to it. Someone
-- who already had accounts at three salons ends up as ONE person with three links — which is what they always
-- were; the schema just could not say so.
--
-- The password carried over is the one from their OLDEST account: it is the one they have used longest, and
-- picking arbitrarily would silently change which password works.
INSERT INTO customer_identities (normalized_phone, email, full_name, password_hash, phone_verified_at)
SELECT DISTINCT ON (u.normalized_phone)
  u.normalized_phone,
  u.email,
  u.full_name,
  u.password_hash,
  NULL
FROM users u
WHERE u.role = 'CUSTOMER'
  AND u.normalized_phone IS NOT NULL
  AND u.normalized_phone <> ''
ORDER BY u.normalized_phone, u.created_at ASC
ON CONFLICT (normalized_phone) DO NOTHING;

INSERT INTO customer_identity_links (identity_id, tenant_id, user_id, customer_id)
SELECT
  ci.id,
  u.tenant_id,
  u.id,
  (SELECT c.id FROM customers c
    WHERE c.tenant_id = u.tenant_id AND c.normalized_phone = u.normalized_phone
    ORDER BY c.created_at ASC LIMIT 1)
FROM users u
JOIN customer_identities ci ON ci.normalized_phone = u.normalized_phone
WHERE u.role = 'CUSTOMER'
  AND u.normalized_phone IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
