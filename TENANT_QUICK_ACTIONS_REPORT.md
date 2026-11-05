# Tenants / Salons — detail-panel Quick Actions (audit + wire)

Audited the whole chain (frontend panel → API client → controller → service → core transition engine → audit). The
Quick Actions (View POS, Pause, Activate, Send Warning, Billing, Open Reports) already existed and were wired end-to-end
from earlier work. This pass fixed the visibility/wiring gaps against the spec. **Frontend only — no new endpoint, table,
service, or component; nothing duplicated.**

## 1. Files changed
- `apps/admin-web/src/screens/TenantsScreen.tsx`
- `apps/admin-web/src/screens/TenantsScreen.test.tsx` (+1 test, 1 assertion updated)

## 2. Frontend components fixed (reused existing TenantsScreen detail panel)
- **Activate visibility** — was `suspended`-only; now enabled for every non-active, non-cancelled status (paused/
  suspended, pending/setup, trial, past-due) and disabled for already-active and cancelled tenants, matching the backend
  transition engine (which allows `→active` only from stored `pending`/`suspended` and cleanly rejects the rest).
- **Disabled-reason tooltips** added to every action (e.g. "Tenant is already active", "Cancelled tenants cannot be
  reactivated", "Support access is disabled for cancelled tenants").
- **Pause** now also disabled for cancelled tenants (can't suspend a cancelled tenant) with a tooltip.
- **View POS** reason string aligned to the spec: `view_pos_from_quick_actions` (source already
  `tenants_salons_quick_actions`).
- **Open Reports** now navigates to `/platform-reports?report=tenant-performance&tenantId={id}&source=tenants_salons_quick_actions`
  (previously missing `report=tenant-performance`).
Each button already had per-action loading state (`busy === id+kind`), success/error toast, and the correct post-action
refresh; the whole Quick Actions block only renders when a tenant is selected (so actions are inherently disabled with no
selection). The Send Warning modal already has all spec fields (6 types, 4 severities, subject/message validation,
email/SMS/dashboard/internal-note) and refreshes Recent Activity on success.

## 3. Frontend routes/navigation
- Billing → existing `/subscriptions?tenant={id}` (reused billing module; preserves tenant context).
- Open Reports → existing `/platform-reports?report=tenant-performance&tenantId={id}` (reused Platform Reports module).

## 4. Backend APIs — none added (all already exist, `@UseGuards(SuperAdminGuard)`)
- `POST /super-admin/tenants/:id/support-access` — opens a short-lived support session, returns `posUrl` + `expiresAt`,
  blocks cancelled tenants, audits `support_access_opened`.
- `PATCH /super-admin/tenants/:id/status` — validates the transition via the shared pure engine, updates status, returns
  warning metadata when activating a payment-incomplete tenant, audits `tenant_activated` / `tenant_paused`.
- `POST /super-admin/tenants/:id/warning` — persists the warning, audits `warning_sent`, returns delivery status.

## 5. Backend services/calculations
Unchanged — `SuperAdminTenantsService` (`openSupportAccess`, `changeStatus`, `sendWarning`) and the
`canTransition` / `TRANSITIONS` engine in `super-admin-tenants-core.ts` already cover validation, warning metadata, and
the clean `ok:false` on an invalid transition.

## 6. Database tables used
`tenants`, `tenant_warnings`, `tenant_support_sessions`, `audit_logs` — all existing. **No new table.**

## 7. Existing modules reused
`super-admin-tenants` (status/warning/support), Platform Reports, Subscriptions/billing, the shared toast, confirm modal,
and warning modal.

## 8. Duplicate code avoided
No new Quick Actions component, modal, route, endpoint, service, or table — only wiring corrections.

## 9–13. How to test
- **View POS**: select a tenant → 🖥 View POS → shows loading, opens the returned secure `posUrl` (new tab), success
  toast; cancelled tenant → button disabled with tooltip; backend audits `support_access_opened`.
- **Activate**: select a paused/pending tenant → ▶ Activate → confirm modal → status flips to active, table row + detail +
  KPI cards + Recent Activity refresh, success toast (with warning text if payment setup incomplete); active tenant →
  disabled ("already active"); cancelled → disabled ("cannot be reactivated").
- **Send Warning**: ⚠ Send Warning → modal validates subject+message → saves, success toast, Recent Activity refreshes;
  backend audits `warning_sent`.
- **Billing**: 🧾 Billing → `/subscriptions?tenant={id}`.
- **Open Reports**: 📈 Open Reports → `/platform-reports?report=tenant-performance&tenantId={id}`.
- Automated: `cd apps/admin-web && npx vitest run src/screens/TenantsScreen.test.tsx` (12/12) covers View POS body,
  Send Warning, Pause via the real route, and Activate/Pause visibility by status.

## 14. Remaining setup
- Email/SMS delivery for warnings dispatches downstream only if Postmark/Twilio are configured; otherwise the warning is
  saved with `deliveryStatus: pending/skipped` (by design — not faked).
- Permissions are enforced by `SuperAdminGuard` (role-level). Finer per-action permissions
  (`tenant.activate`, `tenant.warning.send`, …) would need the RBAC permission map extended — say the word and I'll wire
  per-permission guards + frontend hide/disable.

## Verification
admin-web: `tsc` clean; **92 tests** (+1); `vite build` clean. Backend unchanged (473 tests, RESULT: PASS).
