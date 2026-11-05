-- 599_technician_certifications_actor_stamp.sql — AUTH merge follow-up (Oct 12 2026) for 584, from check:actor-stamp:
-- technician_certifications is a tenant table that tracks updated_at, so it carries updated_by (the actor-stamp plugin
-- fills it on every update: the technician editing her own row, the manager verifying / revoking it; the expiry sweep
-- runs without an actor and leaves it NULL). Writers: modules/queue/src/tech/technician-certifications.ts.
-- Same for technician_skill_change_requests (583 gave it updated_at for the review bookkeeping; writers: the Tech App skill
-- request + manager review in modules/queue/src/tech/tech.kysely.repository.ts).
-- EXPAND-ONLY, idempotent.
ALTER TABLE technician_certifications ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE technician_skill_change_requests ADD COLUMN IF NOT EXISTS updated_by UUID;
