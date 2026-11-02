# SIDEBAR_FULL_WIRING_REPORT.md — POS + Super Admin sidebar bug-fix & full module wiring (2026-07-03)

_One pass over both navigation shells: every built module screen is now reachable from its sidebar, every sidebar
item resolves to a registered route, and both invariants are locked by tests so they cannot silently regress._

## Verification (this exact tree, after changes)
- `admin-web`: tsc 0 · **715/715 tests, 118 files, exit 0** (baseline 710 → +5 new invariant tests) · production build clean.
- `pos-web`: tsc 0 · **185/185 tests, 62 files** (baseline 178 → +7 new invariant tests; the single pre-existing
  POSBookingScreen jsdom unhandled-error notice is unchanged from baseline and unrelated) · production build clean.
- No API/backend changes; no migrations; no other workspace touched.

---

## A. Super Admin sidebar (`apps/admin-web/src/shell/AdminLayout.tsx`)

### Bug fixed
1. **Duplicate `/product-catalog` entry** — "Catalog Management" and "Product Catalog" both routed to
   `/product-catalog` (duplicate React `key={n.to}` + two labels for one screen). "Catalog Management" now routes to
   `/services` — the real S06 Services Management screen, which was itself orphaned. One edit fixes both defects.

### Modules wired (real screens that had a route but no sidebar entry)
| Module | Route | Placed in |
|---|---|---|
| Platform Dashboard | `/platform-dashboard` | Platform Overview |
| Tenant Applications (badge: applications) | `/tenant-applications` | Tenant Management |
| Onboarding › Approvals | `/onboarding/approvals` | Onboarding children |
| Catalog Management (S06 Services) | `/services` | Operations Oversight |
| Payment Gateways | `/payment-gateways` | Payments & Revenue |
| AI Subscriptions (15-package manager) | `/ai-subscriptions` | AI & Automation |
| Usage Limits (canonical `tenant_usage_limits`) | `/usage-limits` | AI & Automation |
| Communications › Inbox | `/communications/inbox` | Communications children (new) |
| Smart Reminders › Performance | `/smart-reminders/performance` | Smart Reminders children (new) |
| Audit Logs › Browse Events | `/audit-logs/browse` | Audit Logs children (new) |
| System Health (live process + DB metrics) | `/system-health` | Support |
| Project Status (module readiness board) | `/project-status` | Support |

Deliberately NOT in the sidebar (unchanged): `/billing`, `/products`, `/memberships`, `/appointments`, `/customers`
(Navigate aliases), `/account` (profile menu), `/help-center` (dedicated footer link), `/` (shell).

### Invariants locked (`AdminLayout.test.tsx`, +5 tests; `NAV_GROUPS` now exported for testability)
- Every newly wired item renders with the exact href above.
- Catalog Management ≠ Product Catalog.
- **No two top-level items share a route** (React-key/UX invariant).
- **Every top-level item and every child link (query-stripped, `:param`-aware) matches a registered `App.tsx` route** — dead links are impossible.
- **Every registered non-param route is sidebar-reachable** (explicit exemption list for the aliases above) — orphan modules are impossible.

---

## B. Tenant POS sidebar (`apps/pos-web/src/shell/tenant-nav.tsx` + shell)

### Bugs fixed
1. **`EXISTING_ROUTES` ↔ `App.tsx` drift** — 14 dedicated-screen routes were excluded from FeaturePage registration by
   a hand-maintained inline filter in `App.tsx` instead of the `EXISTING_ROUTES` set. The set is now the **single
   source of truth** (all 14 folded in); `App.tsx` registers `featureRoutes()` with no filtering. Drift can no longer
   happen — and is test-locked anyway.
2. **AI-locked CTA pointed at a placeholder** — `FeaturePage`'s "Browse AI packages" button sent users to
   `/tenant/account/ai-packages` (itself a FeaturePage) while the real `POSAIPlansScreen` sat unreachable at
   `/tenant/ai/plans`. CTA now targets the real screen; the Account › AI Packages nav item does too; no reference to
   the placeholder route remains.
3. **Notification bell landed on the wrong tab** — "N technician reports awaiting approval" opened Inventory on the
   default Products tab. `TenantInventoryScreen` now supports a validated `?tab=` deep link; the bell routes reports →
   `?tab=reports` and low-stock → `?tab=alerts`.

### Modules wired (dedicated screens that were unreachable from the sidebar)
| Module | Route | Placed in |
|---|---|---|
| Technician Appointments (`POSTechAppointmentsScreen`) | `/tech-appointments` | TEAM |
| Skill Requests (`POSSkillRequestsScreen`) | `/technicians/skill-requests` | TEAM |
| AI Plans & Packages (`POSAIPlansScreen`) | `/tenant/ai/plans` | AI CENTER (+ Account › AI Packages) |
| Follow-Up Settings (`EndOfDayFollowUpSettings`) | `/settings/follow-ups` | COMMUNICATIONS (MGMT roles) |
| Device Logs (`TenantLogsScreen`) | `/tenant/devices/logs` | DEVICES & INTEGRATIONS |
| API & Webhooks (`TenantApiWebhooksScreen`) | `/tenant/integrations/api-webhooks` | DEVICES & INTEGRATIONS (OWNER) |

Alias routes (`/live-operations`, `/tenant/overview`, `/tenant/dashboard`) remain intentionally nav-less duplicates of
Dashboard/Overview and are now in `EXISTING_ROUTES` for completeness.

### Invariants locked (new `tenant-nav.wiring.test.ts`, 7 tests)
- Every `EXISTING_ROUTES` entry has a dedicated `<Route>` in `App.tsx` (no stale entries).
- `featureRoutes()` never collides with a dedicated route (anti-double-registration — replaces the old inline filter).
- Every nav route resolves to a dedicated screen or a FeaturePage — never unregistered.
- The six previously-orphaned screens above stay sidebar-reachable.
- The removed `/tenant/account/ai-packages` placeholder can't come back into nav.
- Nav item ids unique; all routes absolute.

---

## Files changed
- `apps/admin-web/src/shell/AdminLayout.tsx` (nav groups + `NAV_GROUPS` export; stale header comment corrected)
- `apps/admin-web/src/shell/AdminLayout.test.tsx` (+5 tests)
- `apps/pos-web/src/shell/tenant-nav.tsx` (nav additions; consolidated `EXISTING_ROUTES`)
- `apps/pos-web/src/App.tsx` (inline filter removed — trusts `EXISTING_ROUTES`)
- `apps/pos-web/src/screens/FeaturePage.tsx` (AI-locked CTA → real screen)
- `apps/pos-web/src/shell/POSLayout.tsx` (bell deep links)
- `apps/pos-web/src/screens/TenantInventoryScreen.tsx` (validated `?tab=` support)
- `apps/pos-web/src/shell/tenant-nav.wiring.test.ts` (new)
- `ROUTE_INVENTORY.md` (12 admin sidebar flags flipped to `yes`, header note)

## Honest notes
- The 102 tenant nav routes without dedicated screens still render the shared, permission/plan/AI-gated FeaturePage —
  by design ("never a dead link"). Building those screens out is feature work, not wiring.
- `/tenant/account/billing` continues to redirect to Subscription (documented decision — no separate billing data
  source exists tenant-side).
- No fabricated values anywhere; badge counts, gating, and system status remain live backend reads.
