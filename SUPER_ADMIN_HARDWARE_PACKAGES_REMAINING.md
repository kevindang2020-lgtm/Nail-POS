# SUPER_ADMIN_HARDWARE_PACKAGES_REMAINING.md (honest — updated after verification pass)

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> Since this was written: native `confirm()` was eliminated platform-wide (`check:dialogs` enforces inline dialogs); "Mac-fit / 24-inch iMac" was de-branded — the target is the ASUS V470 1920×1080 shell; and PGlite now applies all 425 migrations in-sandbox (the "no Postgres in the sandbox" limitation is gone).


## Closed in the verification pass (now fully wired)
- **Duplicate active package guard** — `create` now rejects a second active (non-cancelled/non-returned) package for the
  same tenant with **409 `tenant_has_active_package`** ("This tenant already has an active hardware package."), and the
  Assign modal offers **"Assign anyway"** (sends `confirmDuplicate`). Covered by a new test.
- **Open Tenant now selects the tenant** — `TenantsScreen` honors `?tenantId=` for initial selection, so Open Tenant lands
  on that tenant's detail.
- **In-panel actions added** — the detail panel now has **Update Payment Status**, **Add Device Serial**, and **Add Internal
  Note** (all call the existing endpoints + audit + refresh). 
- **Open Billing** (→ Hardware Payments) and **View Audit Logs** (→ Audit Logs) added to the row action menu.
- **Edit Package full-field form** — the row action menu's "Edit Package" now opens an Edit modal (package name, type,
  hardware cost, deposit, amount paid, financing terms, full shipping address) prefilled from the package and wired to the
  existing `PATCH /:id` endpoint; saving refreshes the table + detail panel. Covered by a test.
- **Tenant detail hardware card is now live** — the Tenants detail panel fetches `GET /super-admin/tenants/:tenantId/hardware`
  and renders the real package name, status badge, payment status, and tracking number (with the View All deep-link), falling
  back to the onboarding line only when a tenant has no package. Covered by a test.

## Still remaining (documented, not hidden) — environment-bound or low-value only
- **No Postgres in the sandbox.** Pure core + service are unit-tested via the in-memory repo; Kysely/migration paths are
  typecheck-verified only (`sql.join`/`sql.ref` confirmed valid in Kysely 0.27.4 and already used across the repo). Run
  migration 095 on a real DB to exercise them. In-memory returns empty → real empty states; the mock numbers live only in
  the FE test fixture + the design image (no fabricated data shipped).
- **Tenant onboarding % recompute** — status changes write the `tenant_hardware_status_updated` audit event; a stored
  onboarding-progress percentage is not recomputed (the Tenants screen derives hardware state live).
- **Payment ledger not duplicated** — package-level `payment_status` summary lives on `hardware_packages`; the financial
  detail stays in the existing hardware-payment subsystem (Open Billing routes there).
- **Kebab actions aren't pre-disabled per state** — invalid transitions return a clear 409 message rather than being greyed
  out (the detail-panel Mark Delivered/Installed buttons *are* state-disabled). Cancel/Return use a native `confirm()`.
- **Export is CSV** (authenticated cookie-credentialed download), not XLSX.
- **Deep-linked tenant not on the first tenants page** won't auto-select until loaded (pagination edge).
- **Mac-fit**: 8 KPIs render in one row targeting a 24" iMac at 100%; very narrow widths scroll/overflow rather than reflow.
