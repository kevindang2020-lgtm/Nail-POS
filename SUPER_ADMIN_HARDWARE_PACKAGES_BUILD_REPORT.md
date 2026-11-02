# SUPER_ADMIN_HARDWARE_PACKAGES_BUILD_REPORT.md

Upgraded the existing basic Hardware Packages into the full design — extended the existing `hardware_packages` table (no
parallel datastore, payments subsystem untouched), built a rich Super-Admin surface over it, and replaced the basic screen.

## Added (only the missing parts)
**DB** — `apps/api/db/migrations/095_hardware_packages_enrichment.sql`
- ALTER `hardware_packages`: + package_name, package_type, payment_status (summary), hardware_cost_cents, deposit_cents,
  amount_paid_cents, financing_terms, shipping_address/city/state/zip, shipping_carrier, tracking_number, tracking_url,
  ordered/shipped/installed/completed/cancelled/returned_at, created/updated_by_user_id. Status CHECK broadened to the
  canonical set (legacy values kept). Added payment_status CHECK.
- New `hardware_package_devices` (with a partial unique index on serial_number) + `hardware_package_notes`.

**Backend** — `apps/api/src/super-admin-hardware-packages/`
- `hardware-packages-core.ts` — pure: legacy→canonical `normalizeStatus`, `computeSummary` (8 KPIs + real MoM trends),
  `statusBreakdown`, `packageTypeBreakdown`, filter/sort/paginate, the `canTransition` state machine, and `devicesFor`
  (derives the standard kit from package type for legacy rows).
- `hardware-packages.repository.ts` — port + InMemory (empty, honest) + Kysely (guarded raw sql) over hardware_packages +
  devices + notes, joining tenants/applications/users for display fields; activity/events from audit_logs.
- `hardware-packages.service.ts` — `state` aggregation, list, summary, detail, create (assign), update, setStatus (state
  machine, **409 on invalid**), setPaymentStatus, updateTracking (**auto-advances to shipped** when tracking is added),
  addDevices (**409 on duplicate serial**), addNote, cancel, return, tenantHardware. Audits every meaningful action.
- `super-admin-hardware-packages.module.ts` — `HardwarePackagesController` (`/super-admin/hardware-packages`) +
  `TenantHardwareController` (`/super-admin/tenants/:tenantId/hardware`), SuperAdminGuard, DI factory. Registered in app.module.

**Frontend** — `apps/admin-web/src/`
- `api/superAdminHardwarePackagesApi.ts` — typed client (state + every action + authenticated CSV download) + hook.
- `screens/HardwarePackagesScreen.tsx` — the design page: header (Export/Refresh/Assign), 8 KPI cards with
  business-meaning trend colors, URL-synced filter bar (honors `?tenantId=`), packages table with **row-select → gold
  highlight → right detail panel** (summary, devices, shipment stepper, tracking, Update Tracking / Mark Delivered / Mark
  Installed / Open Tenant), Packages-by-Status donut, Top Package Types, Recent Hardware Activity, Recent Hardware Events
  timeline, Assign Package + Update Tracking modals, kebab row actions.
- Route `/hardware-packages` repointed from `HardwareScreen` to `HardwarePackagesScreen`.

## Bugs fixed / pitfalls avoided during the build
1. **Legacy status mismatch** — 060 used `ready`/`activated`/`not_started`; normalized to the canonical set so existing
   rows render and transition correctly under the new UI.
2. **Add-modal input focus loss** — fields use a stable top-level `LabeledInput` via a render helper (not an inline
   component), so typing doesn't remount inputs.
3. **Actions-menu clipping** — the table panel is not `overflow:hidden`, so the kebab dropdown isn't cut off on bottom rows.
4. **URL filter race** — all filter writes use react-router's functional updater (latest params), so a debounced search
   can't clobber a just-changed dropdown.
5. **Export auth** — CSV export uses the authenticated `getText` + Blob download (cookie-credentialed), not `window.open`.
6. **Route param order** — literal sub-routes (`state`,`summary`,`tenants`,`export`,…) declared before `:packageId`.

## Verification
- API: `tsc` clean; full suite **598 passed** (`RESULT: PASS`), incl. 14 new Hardware Packages specs.
- admin-web: `tsc` clean; **104 passed** (incl. 3 new screen specs); `vite build` clean.
