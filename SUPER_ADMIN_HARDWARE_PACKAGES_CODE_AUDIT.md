# SUPER_ADMIN_HARDWARE_PACKAGES_CODE_AUDIT.md

Deep-scanned the repo before writing code. Hardware Packages already exists in a **basic** form; this work **upgrades it in
place** and extends the schema. It does **not** create a second hardware system, and it does **not** touch the separate
hardware-**payments** subsystem.

## Existing assets

| File / table | What it does | Layer | Decision | Duplicate? | Mock data? | Wired? | Missing |
|---|---|---|---|---|---|---|---|
| `db/migrations/060` → `hardware_packages` | id, tenant_id, application_id, imac_color, imac/clover/checkin serials, agreement_status, payment_setup_status, status(not_started/pending_approval/ordered/ready/delivered/installed/activated/on_hold/cancelled), delivered_at, activated_at, notes(jsonb) | DB | **Extend** | No | No | — | package_name/type, payment_status, cost/deposit/paid, financing, shipping addr, carrier/tracking, ordered/shipped/installed/completed/cancelled/returned_at, created/updated_by; canonical statuses |
| `hardware_payment_*`, `tenant_hardware_payoff`, `hardware_reconciliation_runs`, … | Full HW **payments** subsystem (invoices/ledger/plans/transactions/methods/reconciliation) powering Hardware Payments + HW Payment Reports | DB/Backend/FE | **Leave untouched / reference** | No | No | Yes | — (package-level `payment_status` summary added on `hardware_packages`, not duplicating the ledger) |
| `super-admin-platform` controller/service/repo | `GET/POST /super-admin/platform/hardware`, `POST /hardware/:id`; auto-creates a package when an application's free-hardware offer is approved | Backend | **Keep** (basic surface + intake) + build rich surface over same table | No | No (InMemory empty) | Yes | summary/detail/status/payment/tracking/devices/notes/cancel/return/activity/events |
| `apps/admin-web/src/screens/HardwareScreen.tsx` (124 lines) | Basic hardware list + simple update | FE | **Replace** with the design page (upgrade in place) | No | No | Yes | KPI row, filter bar, full table, detail panel, donut, top types, activity/events, modals |
| `apps/admin-web/src/shell/AdminLayout.tsx` NAV | `{ to:'/hardware-packages', label:'Hardware Packages', badge:'hardware' }` already present, badge → `counts.hardwarePending` | FE | **Keep as-is** | No | No | Yes | nothing |
| `apps/admin-web/src/App.tsx` | Route `hardware-packages` → `HardwareScreen` | FE | **Repoint** to new screen | No | — | — | — |
| `apps/admin-web/src/screens/TenantsScreen.tsx` | Tenants table + detail panel **already deep-link** `/hardware-packages?tenantId={id}` (rows 289, 358) and show a Hardware Package column/onboarding item | FE | **Keep** — new screen must honor `?tenantId=` | No | No | Yes | new screen reads tenantId filter |
| `apps/admin-web/src/api/superAdminApi.ts` | `hardware/createHardware/updateHardware` over `/platform/hardware` | FE | **Keep** + add rich `hardwarePackages*` client | No | No | Yes | the rich endpoints |

## Rules applied
- **One hardware-packages table** (extended), not a parallel datastore. Devices + notes get their own child tables
  (`hardware_package_devices`, `hardware_package_notes`) — none existed.
- **Payments stay in the payments subsystem.** We add only a package-level `payment_status` summary column for the badges;
  the financial ledger is not duplicated.
- Sidebar entry + badge already exist and already match the design — untouched.
- Tenant→hardware deep-link already exists; the new screen consumes `?tenantId=` to filter.
- **No fabricated production data.** Mock numbers (1,892 / …) are design-only; InMemory returns real zeros/empties, Kysely
  reads real rows. Legacy statuses are normalized to the canonical set for display.

## Build plan (only what's missing)
1. Migration 095: extend `hardware_packages`; add `hardware_package_devices` + `hardware_package_notes`.
2. Backend module `super-admin-hardware-packages` over the same table: summary/state/list/detail/create/update/status
   (state-machine validated, 409 on invalid)/payment-status/tracking/devices/notes/cancel/return/activity/events +
   `GET /super-admin/tenants/:tenantId/hardware`.
3. Frontend `HardwarePackagesScreen` replacing `HardwareScreen` at `/hardware-packages` (honors `?tenantId=`), API client,
   tests.
