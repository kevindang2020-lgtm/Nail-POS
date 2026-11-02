# Super Admin — Remaining Issues (honest)

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> The verification counts below are a historical snapshot (today: **6,046 + 4 skipped, 0 failed**, 13/13 gates — see `TEST_REPORT.md`). The guard conclusions (SuperAdminGuard on 92/92 controllers, server-derived identity) remain true and are continuously enforced by `check:public`/`check:perms` + `security:fast`.


This lists only genuine, unresolved-or-decision items after the audit + repairs. It is deliberately short because the
Super Admin surface was already built and wired; the audit surfaced a small number of real defects (now fixed) rather
than the broad disconnection a from-scratch rebuild would assume.

## Fixed this pass (no longer issues)

| Severity | Module | Was | Fix |
|---|---|---|---|
| Low | `DashboardScreen` (Overview) | Quick action "Open Live Operations" linked to `/platform-dashboard` | Now links to `/live-operations` |
| **Medium** | `AdminLayout` footer status | Hardcoded "All Systems Operational" (fabricated health — violates the no-fake-status rule) | Now derived from real `GET /super-admin/system-health`; shows Degraded / Database Outage / Status Unavailable / Checking… and only claims Operational when health reports ok |
| Low | Sidebar order | Official items interspersed with extras | Official 40 items now ordered per spec within each section; extras preserved after |

## Open items requiring a product decision (not defects)

| Severity | Item | Detail |
|---|---|---|
| Cosmetic | #26 label | Nav shows "Membership Programs" (matches the page title) vs the spec's "Memberships". Left as-is to avoid a nav-vs-page mismatch; `/memberships` redirect covers the spec path. |
| Low | Overview vs Live Operations | Two distinct, wired pages (`/dashboard` = platform command center; `/live-operations` = real-time ops board). Kept both; no consolidation done (would delete a real page). |
| Low | Extra sidebar modules | ~30 wired modules beyond the official 40 (Platform Dashboard, Report Builder, Website Leads, Hardware suite, AI Receptionist, etc.) are kept. If the product intends a strictly-40-item sidebar, these would need an explicit hide/relocate decision. |

## Cross-surface item carried from the API runtime session (RESOLVED)

| Severity | Module | Resolution |
|---|---|---|
| Medium | `ai-checkout-upsell` | **Fixed.** The module 403'd for every role due to two stacked gates: (1) the controller required `pos.ai_checkout_upsell.view`, a capability absent from rbac (every sibling AI module grants its `.view`); (2) the service's `need()` did a raw `ctx.permissions.includes('pos.checkout.view')` (the same coarse-vs-granular bug fixed in the other services). Granted `ai_checkout_upsell.view` to the master `PERMISSIONS` list (OWNER inherits) + MANAGER, **and** switched the service `need()` to `hasPermission`. Verified live: OWNER + MANAGER now 200; tests 28/28; reachability guard + auth 107/107; `DI_GRAPH_OK`. |

## Not done (honest scope boundary)

- A **line-by-line DB-lineage matrix** (each Live Operations column → exact table/Kysely query) was not produced. Box →
  data-source wiring is verified at the aggregate-endpoint level (see `LIVE_OPERATIONS_BOX_WIRING_MATRIX.md`), and those
  endpoints returned real data with 0 server errors live.
- A full **clean-room extract-and-boot** of all 10 apps was not performed; verification was done in the working tree.

## Runtime security verification (Phase 7, executed live)

Booted the real API against Postgres and exercised the `SuperAdminGuard` boundary with actual sessions:

- **Unauthenticated → `/super-admin/*`: 401 on 8/8** probed routes (auth required before any handler).
- **OWNER (non-super-admin) → `/super-admin/*`: 403 on every real route** (`tenants/state`, `analytics`, `billing`,
  `system-health`, `audit-events`, `merchant-accounts`, `security/overview`). The guard rejects at runtime — not just
  by hiding frontend nav. (One probed path, bare `/super-admin/overview`, returned 404 for OWNER *and* SUPER_ADMIN
  because only `/super-admin/overview/aggregate` is mapped — a probe path artifact, not a leak; that controller is
  `@UseGuards(SuperAdminGuard)`.)
- **SUPER_ADMIN → authorized** (200, or 400 for missing required params — never 401/403).

This confirms server-derived identity + `SuperAdminGuard` enforcement (92/92 controllers) is real at runtime, matching
the static coverage in `SUPER_ADMIN_ROUTE_INVENTORY.md`.

## Full test verification (complete, fresh)

- **API vitest suite: 3,951 tests across 611 files — all passing** (run in 6 shards, every shard exit 0).
- **API Nest-free core/service suites: 118 suites — all passing** (esbuild+node per suite).
- **admin-web: 740 tests across 127 files — all passing** (3 shards).
- Backend DI `DI_GRAPH_OK`; API `tsc` build clean; admin-web production build clean; admin-web `tsc` clean.
