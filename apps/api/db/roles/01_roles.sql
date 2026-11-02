-- 01_roles.sql — the two least-privilege logins (BUILD_PLAN Phase 14, Constitution 12 "Workers least privileged").
--
-- NOT a migration: creating roles needs a superuser (or CREATEROLE), which the migration runner must never need. Run by
-- `node apps/api/scripts/db-provision-roles.mjs` as the database OWNER (Railway: the default `postgres` login), which
-- substitutes {{API_ROLE}} / {{WORKER_ROLE}} / {{DATABASE}} / {{OWNER}} and runs 01 → 02 → 03 in ONE transaction.
-- Idempotent: an existing role is re-asserted (attributes reset to these), grants converge (03 revokes first).
--
--   aps_api     the API (and the worker process's request-shaped work: job handlers use the primary handle)
--               DML on the application tables; no DDL, no TRUNCATE / REFERENCES / TRIGGER, owns nothing, no role management.
--   aps_worker  the DATABASE_WORKER pool only (PG_WORKER_DATABASE_URL): the job queue's claim / lease / finish,
--               the telemetry store's writes, and the central retention executor — table by table (03, generated).
--
-- Passwords are never in these files: the script sets them from APS_API_PASSWORD / APS_WORKER_PASSWORD when given.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{API_ROLE}}') THEN
    CREATE ROLE "{{API_ROLE}}" LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{{WORKER_ROLE}}') THEN
    CREATE ROLE "{{WORKER_ROLE}}" LOGIN;
  END IF;
END $$;

-- Re-assert the attributes every run (a hand-edited role converges back).
ALTER ROLE "{{API_ROLE}}"    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE "{{WORKER_ROLE}}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- Nobody but the owner creates objects in the schema (PostgreSQL 15+ default; asserted for 14 and for hand-changed DBs).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE "{{DATABASE}}" TO "{{API_ROLE}}", "{{WORKER_ROLE}}";
GRANT USAGE ON SCHEMA public TO "{{API_ROLE}}", "{{WORKER_ROLE}}";
REVOKE CREATE ON SCHEMA public FROM "{{API_ROLE}}", "{{WORKER_ROLE}}";
-- No temporary tables either (the application never creates one). TEMPORARY is a PUBLIC default, so it is revoked from
-- PUBLIC; the owner keeps it (owners and superusers hold every database privilege).
REVOKE TEMPORARY ON DATABASE "{{DATABASE}}" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE "{{DATABASE}}" FROM "{{API_ROLE}}", "{{WORKER_ROLE}}";
