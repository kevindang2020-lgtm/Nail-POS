-- 067_tech_profile_extras.sql — spec-closure round: customer tech favorites + per-salon featured technicians.
CREATE TABLE IF NOT EXISTS customer_favorite_techs (
  user_id UUID NOT NULL,
  global_tech_profile_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, global_tech_profile_id)
);
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
