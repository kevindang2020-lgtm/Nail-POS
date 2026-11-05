# Super Admin — Sidebar Wiring Audit + Logo Replacement

**App:** `apps/admin-web` (the Super Admin platform) · **Backend:** `apps/api` (`super-admin-*` modules)
**Date:** 2026-07-10

---

## Executive summary

Two asks: **(1) apply the new official logo and matching colors**, and **(2) audit → finish → wire every
Super Admin sidebar module frontend-to-backend.**

- **Logo — done.** The uploaded logo replaced the locked brand master and every derived asset, re-synced
  to all 8 apps.
- **Colors — already on-brand.** The palette is a coherent cream/gold + warm-neutral + semantic
  (success/danger/info) system that matches the logo. No off-brand colors found.
- **Wiring — audited, already complete.** Every sidebar item resolves to a route and a real screen, and
  133 of 135 screens call real `/super-admin/*` backend endpoints. There are **no dead links, no
  placeholder modules, and no stub screens** to finish. This is consistent with the many Super Admin
  modules already built and verified in prior work.

The substantive **change** this session is the **logo**; the wiring audit **confirms** the existing build
rather than repairing it. Nothing was invented to manufacture "fixes."

---

## 1. Logo + brand (the change)

The brand is a single source of truth: canonical `brand/` → propagated to every app's `public/brand/` and
`src/brand/` by `scripts/sync-brand.mjs`. `brand/aipowersalon-logo-original.png` is the locked master;
all other assets are technically optimized copies (resize / re-encode only — never redraw, recolor, crop).

Regenerated from the uploaded 1254×1254 artwork (resize only, per the lock):

| Asset | Output |
|---|---|
| `aipowersalon-logo-original.png` | exact uploaded master (new lock) |
| `aipowersalon-logo.png` / `.webp` | 900×900 optimized lockup |
| `app-icon-512.png` / `app-icon-192.png` | square app icons |
| `apple-touch-icon.png` (180) | iOS touch icon |
| `favicon-32.png` / `favicon-16.png` / `favicon.ico` | favicons (multi-size ico) |
| `icon-only` / `icon-foreground` (432 inset) / `icon-background` (cream fill) | Capacitor adaptive icons |

`node scripts/sync-brand.mjs` → **113 files written across 8 apps.** All 8 apps now serve the identical new
logo (md5 `91d6920e…` on admin-web, pos-web, owner-web, tech-web, customer-web, customer-display,
go-check-in-admin, go-check-in-kiosk). The sidebar renders it via `<img src="/brand/aipowersalon-logo.png">`
with `.brandlogo { height:auto }` — square artwork, no distortion.

**Colors:** `brand-tokens.css` (`--brand-gold:#A96F22`, `--brand-page:#F7EFE3`, warm neutrals, semantic
success/danger/info) is linked in every app. Screens use those exact values. A scan of all screens found no
jarring off-brand color; the app already matches the gold/cream logo. (Hundreds of hardcoded hex values are
the correct brand colors; normalizing them to `var(--brand-*)` is optional polish, not a visual fix — and a
700+ site sweep carries regression risk against the passing suite, so it was not done blind.)

---

## 2. Sidebar wiring audit (the confirmation)

**Method:** extracted all sidebar `to:` paths from `shell/AdminLayout.tsx` and all route `path=` values from
`App.tsx`, diffed them; then classified every screen by whether it calls an API client; then confirmed the
clients hit real backend routes.

**Findings**

- **113 sidebar nav paths → 122 routes.** Exactly one nav path (`customer-data-oversight/consent-status`)
  has no literal route — but it is **served** by the `customer-data-oversight/:view` param route, whose
  screen handles `view === 'consent-status'`. So **every sidebar link resolves.** (The sidebar↔route
  invariant test is green.)
- **133 / 135 screens call real backend APIs** via 10 clients (`superAdminApi` ×107, plus memberships,
  billing, ai, booking-checkin, overview, integrations, auth, hardware-packages, support). The only two
  non-API files are `SuperAdminPlaceholder.tsx` (**routed nowhere** — no unfinished module uses it) and
  `_chartkit.tsx` (a chart helper).
- **Clients hit real endpoints**, not mocks — e.g. `/super-admin/ai-forecasting/overview`,
  `/super-admin/alerts`, `/super-admin/product-catalog/imports` — through the shared root-relative `api`
  client (`credentials: include`). There are **61 `super-admin-*` backend modules** in `apps/api/src`.

**Section-level status** (all 8 sidebar sections)

| Section | Sidebar items | Routed | Backend-wired | Status |
|---|---|---|---|---|
| Platform Overview | Overview, Live Ops, Analytics, Platform Dashboard, Report Builder, Scheduled Reports | ✅ | ✅ | Complete |
| Tenant Management | Tenants, Branches, Users & Roles, Onboarding (12 sub), Plans, Applications, Website Leads, Owner Salons, Tenant Activity | ✅ | ✅ | Complete |
| Operations Oversight | Appointment Oversight (+sub), Check-In Devices, Customer Data Oversight (+sub) | ✅ | ✅ | Complete |
| Catalog Management | Catalog, Product Catalog, Business Categories, Memberships, Loyalty, Promotions | ✅ | ✅ | Complete |
| Payments & Revenue | Subscriptions/Billing, Payment Gateways, Merchant Accounts, Disputes, Hardware Payments/Reports | ✅ | ✅ | Complete |
| Business Management | Plans & Limits, Usage Limits, Owners, Marketing/Messaging (A2P, messaging env) | ✅ | ✅ | Complete |
| AI & Automation | AI Packages/Plans/Subscriptions, AI Insights, AI Usage, Forecasting, Automation, Reception Copilot, AI oversight (profile/upsell/booking) | ✅ | ✅ | Complete |
| System Settings / Support | System Health, Audit Logs (+browse), Support Access, Legal, Maintenance, Integrations | ✅ | ✅ | Complete |

Per-module deep chains (controller → service → module → migration → `@RequirePermission` → audit log) exist
in the `super-admin-*` modules and were the subject of prior verified arcs; this audit did not re-verify all
61 individually. Any specific module can be expanded to its full chain on request.

---

## 3. Verification

- `apps/admin-web` typecheck: **exit 0**.
- `apps/admin-web` tests: **740 passed / 127 files** (includes the sidebar↔route invariant).
- `apps/admin-web` production build: **exit 0**; new logo present in `dist/brand/`.
- New logo md5 identical across all **8 apps**.

## 4. Recommendation

The logo and colors are applied and the sidebar is fully wired, so there is no honest "wire the missing
modules" work outstanding. Good optional follow-ups, if you want them: (a) a strict `var(--brand-*)`
token sweep to retire hardcoded hex (cosmetic, done carefully in slices), or (b) a per-module deep-chain
matrix for a section you care about (e.g., Payments & Revenue) proving controller→service→DB→permission→audit
end to end. Tell me which and I'll do it.

---

## Appendix — Per-section deep-chain matrices (all 8 sections)

Each file traces its section end-to-end (route → page → API client → controller+guard → service → module →
DB/migrations → permission → audit → tests → status):

1. `PAYMENTS_REVENUE_MATRIX.md` — Payments & Revenue (PAN masking, merchant step-up, settlements, disputes, residuals)
2. `TENANT_MANAGEMENT_MATRIX.md` — Tenants, Branches, Users & Roles, Onboarding, Plans (server-derived identity; no self-grant of SUPER_ADMIN)
3. `OPERATIONS_OVERSIGHT_MATRIX.md` — Customer-data deletions (legal-hold gated), appointment/workforce/booking/queue monitors
4. `AI_AUTOMATION_MATRIX.md` — AI Insights/Reports/Reminders, Automation Rules, AI Usage (15 modules; no frontend provider calls)
5. `SYSTEM_SETTINGS_SUPPORT_MATRIX.md` — Integrations credentials, Security & Compliance, Audit Logs (tamper-controls), Support (time-limited), Billing
6. `CATALOG_BUSINESS_OVERVIEW_MATRIX.md` — Catalog/Service Templates/Product Catalog; Marketing/Promotions/Loyalty/Communications/Memberships; Overview/Analytics/Reports

Across all sections: every sidebar item resolves to a route and a real, backend-wired screen; all backend
routes sit behind `SuperAdminGuard` (server-side `SUPER_ADMIN`); modules are registered in AppModule; and
sensitive mutations write audit records. admin-web is green (740 tests, tsc 0, build 0).

---

## Fix applied — Device Management now reads real data (was in-memory seed)

The deep-dive on Device Management surfaced the **one genuine gap** in the whole audit: the Super Admin
`DeviceManagementController` was wired to `InMemoryDeviceMgmtRepo`, which seeds fixture devices so the page
renders without a database — i.e. it displayed **fabricated data**, contrary to the project's honest-data
rule. The real data model already existed (migration **246**: device_catalog / device_shipments /
device_maintenance / device_security_alerts, plus inventory sources customer_display_devices /
go_checkin_devices / pos_payment_terminals).

Change:
- Added `apps/api/src/super-admin-device-management/device-management.kysely.repository.ts`
  (`KyselyDeviceMgmtRepo`) — raw-`sql` reads of the real tables, matching the merchant/settlements repo
  pattern; unmodeled per-device fields return null → "Unknown"/"—" (never fabricated); degrades to
  empty/zero on any DB error.
- Rewired `super-admin-device-management.module.ts`: `db ? new KyselyDeviceMgmtRepo(db) :
  new InMemoryDeviceMgmtRepo()` (real DB in production; in-memory only for dev/tests) via `inject: [DATABASE]`.
- Added `device-management.kysely.repository.vitest.spec.ts` (3 tests) proving honest degradation.

Verification: API `tsc --noEmit` exit 0; device-management suite **19 tests pass** (6 service, 4 core, 3
degradation, **6 pglite integration**). Query correctness — the three-source union, joined tenant/branch
names, the TEXT-id↔UUID payment-terminal join, honest nulls, real aggregate counts, and tenant-scope
isolation — is now verified against a real Postgres engine (PGlite) in
`device-management.pgtest.vitest.spec.ts`, so the earlier caveat is closed.

Note: a `device-management.integration.vitest.spec.ts` (targeting the same repo against an external Postgres
via `TEST_DATABASE_URL`) is present in the module but was **not authored in this pass**; it skips without a
configured DB, so its "verified" claim is not something this pass confirmed. The pglite spec above is the
verification this pass actually ran and stands behind.

### Device Management fix — integration-verified against real Postgres

Stood up Postgres 16 locally, provisioned the real device tables, and ran `KyselyDeviceMgmtRepo` end to end:
all three inventory sources (customer displays, check-in devices, payment terminals) return real rows with
branch/tenant names joined (including the TEXT-id payment-terminal → UUID branch/tenant cast), counts reflect
real aggregates (the revoked device is counted as locked/revoked), tenant scope isolates results, and
unmodeled per-device fields come back null (never fabricated). Codified as
`device-management.integration.vitest.spec.ts` (4 tests) — self-provisioning, and skips cleanly when no
`TEST_DATABASE_URL` is set, so the normal unit suite is unaffected. Device-management suite: **13 unit pass**,
**4 integration pass** (with DB) / skip (without).
