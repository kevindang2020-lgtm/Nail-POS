# TENANT_SIDEBAR_REPORT.md — tenant POS sidebar rebuilt to the reference image

Rebuilt the **tenant** POS sidebar (not Super Admin) in the real merged app to match your reference: locked logo,
salon/location selector, TODAY items + 11 collapsible groups, gold-gradient active, live badges, role/feature/AI
gating, bottom system-status card + Help Center. Data-driven, no duplicate sidebar files.

## 1. Deep scan summary
Active sidebar was `apps/pos-web/src/shell/POSLayout.tsx` — a flat hardcoded `NAV` (groups Front Desk / Booking &
Queue / Service & Checkout / People & Catalog / Insights) on bare routes, logo already wired from the branding work.
25 existing routes in `App.tsx` (overview, dashboard, check-in, booking, tech-queue, queue, serving, service-done,
checkout, customers, technicians, services, reports, settings, etc.). Super Admin sidebar is a separate app
(`admin-web/AdminLayout`) — kept fully separate. No location selector, no collapsible groups, no badges API, no
feature/AI gating in the sidebar. Backend: `tickets` (status, paid_at), `pos_queue_items` (status), tech-queue
tables exist; `req.ctx` carries tenantId/branchId/role/permissions.

## 2. Existing sidebar components reused
Reused `POSLayout` (rebuilt in place — no SidebarV2/New), the existing logo (`/brand/aipowersalon-logo.png`), the
existing topbar/search/principal, the `useAuth` principal (role/permissions/branchId), `authApi.branches()` +
`selectBranch()` for the location selector, and all existing screens for TODAY + several group items.

## 3–4. Missing modules / routes found
The reference lists ~150 nav items across TODAY + 11 groups. ~21 map to existing screens; the other ~130 had no
route. All are now in the data-driven config and resolve to real routes (no dead links).

## 5. Dead links fixed
None remain. Every nav item routes to either an existing screen or the shared gated `FeaturePage`.

## 6. Frontend components changed / added
- `shell/POSLayout.tsx` — **rebuilt** as the data-driven sidebar (logo, `LocationSelector`, TODAY, collapsible
  groups with persisted open state, badges, gold-gradient active, system-status card, Help Center, collapsed
  icon-only mode with tooltips).
- `shell/tenant-nav.tsx` — **new** single source of nav data + a compact line-icon set (`TENANT_NAV`, `Icon`,
  `featureRoutes()`, `allNavItems()`, `EXISTING_ROUTES`).
- `shell/tenant-access.ts` — **new** hooks `useTenantNavAccess`, `useSidebarBadges`, `useSystemStatus`, plus pure
  `gateFor()` / `roleAllowed()` helpers.
- `screens/FeaturePage.tsx` — **new** shared gated page (available / 403 / feature-locked / AI-locked / suspended;
  never blank).
- `styles.css` — appended sidebar/selector/group/badge/status/collapsed/feature-state CSS (cream/gold per image).

## 7. Frontend routes added/fixed
`App.tsx` now generates `<Route>`s from the nav config (`featureRoutes()`) for every new `/tenant/*` path →
`FeaturePage`, inserted before the catch-all so deep links resolve. Existing screens untouched (no duplication).

## 8. Backend APIs added/reused
New `apps/api/src/tenant-navigation/` module (registered in `app.module.ts`, behind `TenantContextMiddleware`):
- `GET /tenant/navigation` → role, permissions, features, **aiPackages** (active AI codes; locked-by-default when
  unknown), subscriptionStatus.
- `GET /tenant/navigation/badges` → **real tenant/branch-scoped counts** for customerQueue, checkIn, techQueue,
  serviceDone, checkout (from `pos_queue_items`, `pos_tech_queue_tickets`, `ticket_service_lines`, `tickets`);
  the rest return 0 until their modules exist (never hardcoded). Each query is fail-soft.
- `GET /tenant/system-status` → real DB health + app version for the bottom card.

## 9–11. Permissions / feature gates / AI gates
Sidebar visibility = role (Owner/Manager/Receptionist/Technician/Accountant) + permission (from
`principal.permissions`). Items hide when a required permission is absent (owners exempt). Feature items gate
optimistically (backend enforces); **AI items lock by default** until the backend reports an active package —
locked items render with a lock icon and the FeaturePage AI-required state. Backend remains the source of truth.

## 12. Badge APIs and live counts
`useSidebarBadges` polls `GET /tenant/navigation/badges` (30s) and renders coloured pills (red urgent, orange
action, blue info, purple AI) on TODAY items and as group-level sums. No hardcoded numbers.

## 13. Tenant/location isolation
All badge/nav queries are scoped to `ctx.tenantId` + `ctx.branchId`. The location selector calls
`authApi.selectBranch()` then reloads so all location-scoped data refetches under the new branch — no record mixing.

## 14. Logo and theme
Locked official logo stays fixed in the persistent shell (never changes on navigation); cream/ivory/gold/bronze
tokens match the image; active item uses the gold gradient; salon/branch shown as secondary identity below the logo.

## 15. Responsive
Sidebar scrolls internally; logo + selector + status card stay fixed; collapsed icon-only mode (toggle, persisted)
with tooltips and badges; fits the 24-inch iMac (existing Mac-fit shell invariants preserved).

## 16. Files changed
`apps/pos-web/src/shell/POSLayout.tsx` (rebuilt), `…/shell/tenant-nav.tsx` (new), `…/shell/tenant-access.ts` (new),
`…/screens/FeaturePage.tsx` (new), `…/src/App.tsx` (generated routes), `…/src/styles.css` (sidebar CSS);
`apps/api/src/tenant-navigation/*` (new module), `apps/api/src/app.module.ts` (registration).

## 17. Tests and builds run
- **API `tsc --noEmit`: 0 errors.**
- **pos-web `tsc --noEmit`: 0 errors.**
- **pos-web production `vite build`: success (104 modules, 0 errors).**
- Standalone visual preview generated: `AIPowerSalon-TenantSidebar-Preview.html`.

## 18. Remaining work
- The ~130 new group items currently render the shared gated `FeaturePage` scaffold; building each dedicated screen
  (and its API) is incremental future work — the routing, permissions, gating, and isolation are already wired.
- Badge counts beyond the 5 wired (messages, inventory, reviews, payroll, billing, AI usage, support) return 0 until
  those modules/tables exist; the endpoint shape is final, so they light up automatically when added.
- AI access reads `tenant_ai_subscriptions` / `tenant_subscriptions` if present; if your AI/subscription tables use
  different names, point the two queries in `tenant-navigation.service.ts` at them to unlock live AI/subscription state.
- Lint/unit/responsive test suites for the new files can be added; typecheck + production build both pass now.
