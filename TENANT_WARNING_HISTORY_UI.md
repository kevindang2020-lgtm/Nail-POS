# Recent Warnings in the tenant detail panel — delivery status made visible

The dispatch worker now flips each warning's `delivery_status` to sent / skipped / failed, but an admin had no way to
see it — "Send Warning" only showed a one-off toast. This surfaces a tenant's warning history with a delivery-status
badge right in the Tenants → detail panel, so the admin can confirm whether a warning actually went out.

## Files changed
Backend (additive — new read path, nothing existing altered):
- `super-admin-tenants/super-admin-tenants.repository.ts` — `TenantWarningRow` type + `listWarnings` on the port + InMemory impl
- `super-admin-tenants/super-admin-tenants.kysely.repository.ts` — `listWarnings` (newest-first, capped)
- `super-admin-tenants/super-admin-tenants.service.ts` — `listWarnings(id, limit)`
- `super-admin-tenants/super-admin-tenants.controller.ts` — `GET /super-admin/tenants/:id/warnings`
- `super-admin-tenants/super-admin-tenants-service.spec.ts` — +3 checks (list returns saved warning, carries status, tenant-isolated)

Frontend:
- `admin-web/src/api/superAdminApi.ts` — `tenantWarnings(id, limit)`
- `admin-web/src/screens/TenantsScreen.tsx` — Recent Warnings detail-panel section + status badge map + relative time
- `admin-web/src/screens/TenantsScreen.test.tsx` — mock + a render test for the badge

## Backend
- `GET /super-admin/tenants/:id/warnings?limit=20` (SuperAdminGuard, same controller as the existing warning create).
  Returns newest-first rows: `{ id, warningType, severity, subject, message, sendEmail, sendSms, showInTenantDashboard,
  deliveryStatus, createdAt }`. Limit clamped 1..50. InMemory adapter filters its own recorded warnings by tenant (never
  fabricated); Kysely reads `tenant_warnings` directly.

## Frontend
The detail panel gains a **Recent Warnings** section (between AI Subscriptions and Quick Actions), fetched when a tenant
is selected — same lifecycle as the payment-gateway panel. Each row shows the subject, severity, channels (Email/SMS/
Dashboard), relative time, and a colour-coded delivery badge:
- **Sent** (green), **Pending** (amber), **Skipped** (grey), **Failed** (red), **Recorded** (blue) — the honest states
  the dispatch worker writes. Empty state: "No warnings sent." After sending a new warning the list refreshes in place,
  so the admin immediately sees it (Pending until the dispatch worker runs, then Sent/Skipped/Failed).

## Verification
API: `tsc` clean; full suite `RESULT: PASS` (incl. the 3 new listWarnings checks). admin-web: `tsc` clean; **94 tests**
(+1, asserts the Recent Warnings list + Sent badge render); `vite build` clean.
