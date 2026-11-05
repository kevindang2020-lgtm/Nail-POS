# Tenants / Salons — audit + fix (against the uploaded screenshot + spec)

Audited the existing page against the picture and the spec. It was already built to this exact design and fully wired —
so this pass was a targeted audit plus one real correctness fix, with no duplication.

## Already present + verified (no change needed)
- **Sidebar** — all 15 modules, orange badges (Applications/Leads), active highlight, logo area, "AIPowerSalon Platform ·
  System Online · v2.4.1" card.
- **Top bar** — collapse, global search (→ tenant search), Create Tenant, Add Lead, the two notification bells
  (alerts unread + active support), Kevin Dang / Super Administrator.
- **6 KPI cards** — Total Tenants, Active Salons, Paused Tenants, Trial Tenants, Pending Applications, Monthly Card
  Volume — each with an icon + month-over-month delta, all from real endpoints.
- **Filter bar** — search, All States, All Statuses, All Plans, Payment Setup, Clear Filters (backend query params).
- **Tenants table** — logo + name + salon code, Owner, City/State, Plan, Status badge, Payment Setup badge, Hardware
  badge, AI count, Monthly Volume, Last Active, 3-dot action menu; sortable headers; **server-side pagination**
  ("Showing 1–10 of N", page numbers, rows-per-page); loading / empty / error states.
- **Row select → right detail panel** — header + status, Owner info, Onboarding Progress %, Payment Gateway,
  Hardware Package (+ payoff), Active AI Subscriptions chips, Quick Actions (pause/activate gated by status).
- **Action menu** — View POS, details, edit, billing, subscription, payment gateway, hardware, AI, usage, support
  access, pause/activate, send warning, reports, audit — with confirm modals + audit logging.
- **Promo banner** + **three bottom cards** — Recent Tenant Activity (→ /tenant-activity), Recent Applications
  (→ /tenant-applications), Top Performing Tenants (→ /platform-reports).

## Fixed this pass (a real correctness bug, backed by stored data)
`deriveDisplayStatus` collapsed **cancelled into suspended**, so a cancelled tenant rendered as the orange **"Paused"**
badge instead of a gray **"Cancelled"** one (and couldn't be filtered separately).
- `apps/api/src/super-admin-tenants/super-admin-tenants-core.ts` — `cancelled` is now its own `DisplayStatus`;
  `deriveDisplayStatus` returns it from `tenants.status='cancelled'`; added `STATUS_LABEL`, `TabKey`, and a
  `TAB_PREDICATES.cancelled` so the **Cancelled** status filter returns the right rows.
- `super-admin-tenants-core.spec.ts` — corrected the test that previously asserted the buggy "cancelled shows
  suspended" behaviour; added a precedence assertion.
- `apps/admin-web/src/screens/TenantsScreen.tsx` — gray **Cancelled** badge + a **Cancelled** option in the status
  filter (flows through as `tab=cancelled`).

## No duplication
Reused the existing tenants module, endpoints (`/super-admin/tenants/state`, `/status`, `/warning`, `/support-access`,
…), and screen. No new table, route, component, or endpoint.

## How to test
- Backend: `bash scripts/run-core-specs.sh` (72 files / 473 tests, RESULT: PASS) — includes the cancelled derivation
  + predicate.
- Frontend: `cd apps/admin-web && npx vitest run` (88 tests) + `npx vite build`.
- Manual: open Tenants / Salons → set Status filter to **Cancelled** → only cancelled tenants show with the gray badge;
  Paused now shows only truly suspended tenants.

## Honest scope notes (intentionally derived, not faked)
- **Trial / Paused** KPIs + badges are real-*derived* — Trial from `tenant_subscriptions.status='trialing'` (or a trial
  plan), Paused from `tenants.status='suspended'` — not separate literal stored statuses.
- The spec's Payment-Setup filter values **Pending / Failed** are not added: the backend derives Complete/Incomplete-style
  payment labels only, so those options would return nothing. Not faked — flag for a backend payment-state model if you
  want them real.
- Create Tenant uses the existing modal (salon name/code, plan, owner, city/state, AI) and creates the tenant + owner +
  trialing subscription + pending gateway. The spec's fuller field set (ZIP, explicit subscription price, gateway /
  hardware / usage-limit selection at creation, notes) is not all wired yet — flagged, not faked.

## Verification
backend: `tsc` clean; **473 tests** (72 files) + 22 harness suites; `RESULT: PASS`.
admin-web: `tsc` clean; **88 tests**; `vite build` clean.
