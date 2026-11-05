# Super Admin Cross-Tenant Smoke — Runbook

This discharges the standing caveat carried by every recent Super Admin build:
the read-only cross-tenant SQL has been unit-tested (null-db + in-memory) and
typechecked, but **never exercised against a live multi-tenant Postgres with
real seeded data.** These two checks close that gap. They are read-only and
safe to run on a seeded staging database.

I could not run them here — there is no live multi-tenant Postgres in my
environment. They are written to be run on your seeded stack.

---

## Part A — Data-layer cross-check (`SUPER_ADMIN_CROSS_TENANT_SMOKE.sql`)

Independently re-derives the platform totals from the fact tables and compares
them to what the aggregation must produce. Covers Loyalty, Staff/Technicians,
Queue, Check-in, and Memberships.

**Run:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ops/smoke/SUPER_ADMIN_CROSS_TENANT_SMOKE.sql
```

**Each section asserts three properties:**
1. **Reconciliation** — platform `count(*)` equals the sum of per-tenant
   `count(*)`. Catches a tenant being dropped or rows being double-counted by a
   bad join. (Uses `count(*)`, so it is independent of any status filter.)
2. **Multi-tenant proof** — at least 2 distinct `tenant_id`s contribute, so the
   cross-tenant path is actually exercised (not a single-tenant seed).
3. **No-leak / attribution** — every fact row resolves to a real row in
   `tenants` (no orphan or foreign `tenant_id`).

**Read the `verdict` column:** all should be `PASS`. A `FAIL` is a real
cross-tenant correctness bug. A `WARN (seed <2 tenants...)` means the seed did
not span two tenants for that module — seed a second tenant and re-run; a WARN
is not a pass.

> Prerequisite: seed **≥ 2 tenants**, each with loyalty profiles, technicians,
> queue items, check-in sessions, and memberships, so every module's
> multi-tenant proof can actually fire.

---

## Part B — Endpoint guard + composition check

The SQL validates the data layer. This validates that the HTTP surface (a)
enforces `SuperAdminGuard` and (b) the aggregate endpoint composes every section
fail-soft into one response.

**B1. Guard — a non-super-admin token must be rejected:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $NON_SUPERADMIN_JWT" \
  "$API_BASE/super-admin/overview/aggregate"
# expect: 401 or 403  (NOT 200)
```

**B2. Composition — a super-admin token returns one payload with all sections:**
```bash
curl -s -H "Authorization: Bearer $SUPERADMIN_JWT" \
  "$API_BASE/super-admin/overview/aggregate?range=month" | jq '{
    ok,
    state:        (.state        != null),
    devices:      (.devices      != null),
    payments:     (.payments     != null),
    branches:     (.branches     != null),
    services:     (.services     != null),
    appts:        (.appts        != null),
    staff:        (.staff        != null),
    queue:        (.queue        != null),
    checkin:      (.checkin      != null),
    memberships:  (.memberships  != null),
    loyalty:      (.loyalty      != null)
  }'
# expect: ok=true and every section true on a fully-seeded DB.
# A section showing false means that source threw and was fail-soft'd to null —
# inspect that module's logs; it is not a crash, but it is a gap to explain.
```

**B3. (Optional) One request, not eleven** — confirm the Overview screen issues a
single network call. In the admin-web app, open the Network tab on the Overview
and verify exactly one request to `/super-admin/overview/aggregate` (the prior
eleven per-module calls are gone).

---

## What a clean run proves

- The five module oversight queries and the platform device/payment/branch/
  service/appointment summaries aggregate **across tenants** with no row loss,
  no double-count, and no foreign-tenant leakage.
- The aggregate endpoint is **guarded** and **fail-soft**.
- The Overview loads in **one** request.

A clean run lets you drop the "cross-tenant SQL not yet exercised on live
multi-tenant Postgres" caveat for the Super Admin oversight surface.

## What it does NOT cover

- Per-**branch** scoping (the top-bar "All Branches" selector is still
  visual-only; making it filter is a separate feature).
- Write-path or money-path behavior (this surface is read-only by design).
- Wire-level two-tenant attack matrix (a deliberate authz pen-test is separate).
