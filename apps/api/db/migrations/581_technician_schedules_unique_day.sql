-- 581_technician_schedules_unique_day.sql — schedule concurrency (Technician Profile package, their 464; mandate
-- §104–§105, §174). `version` already exists here (539, replaced-as-a-set counter); this adds the unique
-- (tenant, technician, day_of_week) the upsert needs. Existing duplicates (same tech/day across branches or from
-- repeated writes) are reduced to the latest row first. Additive + idempotent.

DELETE FROM technician_schedules s
USING technician_schedules newer
WHERE newer.tenant_id = s.tenant_id
  AND newer.technician_id = s.technician_id
  AND newer.day_of_week = s.day_of_week
  AND (newer.updated_at > s.updated_at OR (newer.updated_at = s.updated_at AND newer.id > s.id));

CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_schedules_tenant_tech_dow
  ON technician_schedules (tenant_id, technician_id, day_of_week);
