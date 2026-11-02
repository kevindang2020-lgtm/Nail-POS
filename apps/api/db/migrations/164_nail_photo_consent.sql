-- 164_nail_photo_consent.sql — customer consent for technician portfolio photos linked to a real service (epic Req §8).
-- One consent row per photo. `approved_uses` is the granted set (portfolio/nailshowcase/salon_marketing/social_marketing/all/private_only).
-- `public_blocked` is denormalized at write time (= revoked OR no public use approved) so public photo queries can gate with a cheap NOT IN.
-- Records are preserved on withdrawal (revoked=true) — never physically deleted — to keep the consent audit trail.
CREATE TABLE IF NOT EXISTS nail_photo_consent (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id               UUID NOT NULL UNIQUE REFERENCES tech_portfolio_photos(id) ON DELETE CASCADE,
  tenant_id              UUID,
  branch_id              UUID,
  global_tech_profile_id UUID NOT NULL,
  customer_id            UUID,
  ticket_id              UUID,
  approved_uses          JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_version        TEXT,
  device                 TEXT,
  session_id             TEXT,
  revoked                BOOLEAN NOT NULL DEFAULT false,
  revoked_at             TIMESTAMPTZ,
  public_blocked         BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nail_photo_consent_blocked ON nail_photo_consent (photo_id) WHERE public_blocked = true;
