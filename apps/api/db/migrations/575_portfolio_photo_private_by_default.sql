-- 575_portfolio_photo_private_by_default.sql — portfolio consent (Technician Profile package, their 457; mandate §45).
--
-- 066 created tech_portfolio_photos with is_public DEFAULT true: every upload went live on the public profile the
-- moment it landed, before the technician had captioned it, tagged it, recorded the customer's consent, or decided
-- to show it at all. New photos now start PRIVATE; the technician publishes explicitly (PATCH isPublic=true).
-- Existing rows are left exactly as they are — nothing a technician already chose to publish is un-published here.
ALTER TABLE tech_portfolio_photos ALTER COLUMN is_public SET DEFAULT false;
