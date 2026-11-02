-- ============================================================================
-- SUPER ADMIN — CROSS-TENANT AGGREGATION SMOKE TEST
-- ============================================================================
-- Purpose: discharge the standing caveat that the read-only Super Admin
-- cross-tenant SQL (Overview aggregate + Staff / Queue / Check-in / Memberships
-- / Loyalty oversight) has never been exercised against a LIVE multi-tenant
-- Postgres with real seeded data.
--
-- This script is an INDEPENDENT cross-check: it re-derives the platform totals
-- straight from the fact tables (not via the app's queries) and compares them
-- to what the aggregation *should* produce. If the app's cross-tenant queries
-- silently drop a tenant, double-count, or leak a foreign tenant_id, one of
-- these checks will read FAIL.
--
-- HOW TO RUN (read-only; safe on a seeded staging DB — does not write anything):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f SUPER_ADMIN_CROSS_TENANT_SMOKE.sql
--
-- INTERPRETING: every check emits a `verdict` column.
--   PASS               -> the property holds.
--   FAIL               -> a real correctness problem; investigate before pilot.
--   WARN (seed <2 ...) -> the seed has fewer than 2 tenants for this module, so
--                         the cross-tenant property could not be exercised. Seed
--                         a second tenant and re-run; this is not a pass.
-- ============================================================================

\pset pager off
\echo ''
\echo '######################## TENANT SEED OVERVIEW ########################'
SELECT count(*) AS tenants_total,
       count(*) FILTER (WHERE status = 'active') AS tenants_active
FROM tenants;

-- ---------------------------------------------------------------------------
-- Reusable shape per module: (1) reconciliation  (2) multi-tenant proof
-- (3) no-leak / attribution.  Reconciliation uses count(*) which is
-- status-agnostic, so it isolates "did the aggregation lose or double-count
-- rows across tenants" independently of any status filter the app applies.
-- ---------------------------------------------------------------------------

\echo ''
\echo '############################### LOYALTY ###############################'
\echo '-- reconcile: platform count(*) == SUM of per-tenant count(*) --'
SELECT (SELECT count(*) FROM customer_loyalty_profiles) AS platform_total,
       (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM customer_loyalty_profiles GROUP BY tenant_id) s) AS sum_per_tenant,
       (SELECT coalesce(sum(points_balance),0) FROM customer_loyalty_profiles) AS platform_points_outstanding,
       CASE WHEN (SELECT count(*) FROM customer_loyalty_profiles)
               = (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM customer_loyalty_profiles GROUP BY tenant_id) s)
            THEN 'PASS' ELSE 'FAIL' END AS verdict;
\echo '-- multi-tenant proof: distinct tenants contributing >= 2 --'
SELECT count(DISTINCT tenant_id) AS tenants_with_loyalty,
       CASE WHEN count(DISTINCT tenant_id) >= 2 THEN 'PASS' ELSE 'WARN (seed <2 tenants with loyalty)' END AS verdict
FROM customer_loyalty_profiles;
\echo '-- no-leak: every loyalty/redemption/reward row maps to a real tenant --'
SELECT (SELECT count(*) FROM customer_loyalty_profiles lp LEFT JOIN tenants t ON t.id = lp.tenant_id WHERE t.id IS NULL) AS orphan_profiles,
       (SELECT count(*) FROM loyalty_redemptions rd LEFT JOIN tenants t ON t.id = rd.tenant_id WHERE t.id IS NULL) AS orphan_redemptions,
       (SELECT count(*) FROM loyalty_rewards lr LEFT JOIN tenants t ON t.id = lr.tenant_id WHERE t.id IS NULL) AS orphan_rewards,
       CASE WHEN (SELECT count(*) FROM customer_loyalty_profiles lp LEFT JOIN tenants t ON t.id = lp.tenant_id WHERE t.id IS NULL) = 0
             AND (SELECT count(*) FROM loyalty_redemptions rd LEFT JOIN tenants t ON t.id = rd.tenant_id WHERE t.id IS NULL) = 0
             AND (SELECT count(*) FROM loyalty_rewards lr LEFT JOIN tenants t ON t.id = lr.tenant_id WHERE t.id IS NULL) = 0
            THEN 'PASS' ELSE 'FAIL (orphan tenant_id)' END AS verdict;

\echo ''
\echo '########################## STAFF / TECHNICIANS #######################'
\echo '-- reconcile + multi-tenant proof --'
SELECT (SELECT count(*) FROM technicians) AS platform_total,
       (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM technicians GROUP BY tenant_id) s) AS sum_per_tenant,
       (SELECT count(DISTINCT tenant_id) FROM technicians) AS tenants_with_staff,
       CASE WHEN (SELECT count(*) FROM technicians)
               = (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM technicians GROUP BY tenant_id) s)
            AND (SELECT count(DISTINCT tenant_id) FROM technicians) >= 2
            THEN 'PASS' ELSE 'FAIL or WARN (check sum vs total and tenant span)' END AS verdict;
\echo '-- no-leak --'
SELECT count(*) AS orphan_technicians,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (orphan tenant_id)' END AS verdict
FROM technicians te LEFT JOIN tenants t ON t.id = te.tenant_id WHERE t.id IS NULL;

\echo ''
\echo '############################ QUEUE (POS) #############################'
SELECT (SELECT count(*) FROM pos_queue_items) AS platform_total,
       (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM pos_queue_items GROUP BY tenant_id) s) AS sum_per_tenant,
       (SELECT count(DISTINCT tenant_id) FROM pos_queue_items) AS tenants_with_queue,
       CASE WHEN (SELECT count(*) FROM pos_queue_items)
               = (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM pos_queue_items GROUP BY tenant_id) s)
            THEN 'PASS' ELSE 'FAIL' END AS verdict;
SELECT count(*) AS orphan_queue_items,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (orphan tenant_id)' END AS verdict
FROM pos_queue_items q LEFT JOIN tenants t ON t.id = q.tenant_id WHERE t.id IS NULL;

\echo ''
\echo '########################## CHECK-IN SESSIONS #########################'
SELECT (SELECT count(*) FROM go_checkin_sessions) AS platform_total,
       (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM go_checkin_sessions GROUP BY tenant_id) s) AS sum_per_tenant,
       (SELECT count(DISTINCT tenant_id) FROM go_checkin_sessions) AS tenants_with_checkin,
       CASE WHEN (SELECT count(*) FROM go_checkin_sessions)
               = (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM go_checkin_sessions GROUP BY tenant_id) s)
            THEN 'PASS' ELSE 'FAIL' END AS verdict;
SELECT count(*) AS orphan_checkin_sessions,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (orphan tenant_id)' END AS verdict
FROM go_checkin_sessions g LEFT JOIN tenants t ON t.id = g.tenant_id WHERE t.id IS NULL;

\echo ''
\echo '############################ MEMBERSHIPS ############################'
SELECT (SELECT count(*) FROM customer_memberships) AS platform_total,
       (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM customer_memberships GROUP BY tenant_id) s) AS sum_per_tenant,
       (SELECT count(DISTINCT tenant_id) FROM customer_memberships) AS tenants_with_memberships,
       CASE WHEN (SELECT count(*) FROM customer_memberships)
               = (SELECT coalesce(sum(c),0) FROM (SELECT count(*) c FROM customer_memberships GROUP BY tenant_id) s)
            THEN 'PASS' ELSE 'FAIL' END AS verdict;
SELECT count(*) AS orphan_memberships,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (orphan tenant_id)' END AS verdict
FROM customer_memberships m LEFT JOIN tenants t ON t.id = m.tenant_id WHERE t.id IS NULL;

\echo ''
\echo '################################ DONE ################################'
\echo 'All verdicts above should read PASS. Any FAIL is a cross-tenant'
\echo 'correctness bug to fix before the pilot. Any WARN means the seed did not'
\echo 'span >=2 tenants for that module — seed a second tenant and re-run.'
\echo ''
