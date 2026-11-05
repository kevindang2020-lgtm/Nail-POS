-- 02_api_grants.sql — aps_api: read / write rows of the application tables, nothing structural.
-- Run by scripts/db-provision-roles.mjs after 01 (same transaction). See 01_roles.sql for the model.

-- Rows: SELECT / INSERT / UPDATE / DELETE on every table and view in public. TRUNCATE, REFERENCES and TRIGGER are
-- never granted (and revoked, in case a hand grant gave them).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{{API_ROLE}}";
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM "{{API_ROLE}}";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "{{API_ROLE}}";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "{{API_ROLE}}";

-- Tables a LATER migration creates (run by the owner through MIGRATE_DATABASE_URL) get the same row grants at once —
-- no re-provisioning needed for the API. (The worker's list is explicit: re-run the script when 03 changes.)
ALTER DEFAULT PRIVILEGES FOR ROLE "{{OWNER}}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{{API_ROLE}}";
ALTER DEFAULT PRIVILEGES FOR ROLE "{{OWNER}}" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "{{API_ROLE}}";

-- The Super Admin Database page (Phase 10 E): pg_stat_statements / other sessions' activity, and "cancel query"
-- (pg_cancel_backend — cancel, never terminate; it cannot signal a superuser's backend). Predefined roles, no ADMIN OPTION.
GRANT pg_read_all_stats TO "{{API_ROLE}}";
GRANT pg_signal_backend TO "{{API_ROLE}}";
-- Deliberately NOT granted (they need table ownership): the page's VACUUM ANALYZE and "retry deferred constraint"
-- (ALTER TABLE … VALIDATE) — under aps_api Postgres refuses them and the page shows the refusal; run them as the owner.
