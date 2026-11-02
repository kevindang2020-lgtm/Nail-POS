# Changelog — Tenant POS Shell (topbar gaps)

Reference note: the exact file `AIPowerSalon-Overview-Preview_30.html` was NOT available in the build
environment; the closest available references (`AIPowerSalon-Overview-Preview.html`,
`AIPowerSalon-TenantSidebar-Preview.html`) were used. Pixel-exact fidelity to `_30` still requires that file.

## Changed (no duplication — existing shell aligned)
- `apps/api/src/tenant-navigation/tenant-navigation.service.ts` — `badges()` now returns live
  `notifications`, `inventoryAlerts`, `techReportsPending`; removed the hardcoded `messages: 0`/`inventoryAlerts: 0`
  by deriving from real inventory tables (fail-soft). `messages` is an honest 0 (no staff inbox table yet).
- `apps/pos-web/src/shell/tenant-nav.tsx` — added `bell` + `mail` icons; added `notifications` +
  `techReportsPending` to `BadgeKey`.
- `apps/pos-web/src/shell/POSLayout.tsx` — added `TopClock`, `NotificationBell`, `MessageControl`
  to the existing topbar (reusing `useSidebarBadges`, `Icon`, `useNavigate`). No new shell/topbar file.
- `apps/pos-web/src/styles.css` — appended topbar clock/bell/mail + dropdown panel styles (existing tokens).

## Verified
- api: tsc clean · 623/623 vitest pass (90 files).
- pos-web: tsc clean · vite build OK · 84/84 vitest pass (31 files).

## Known / deferred
- Exact `_30` pixel match pending the reference file.
- `messages` badge + a real notification feed/panel list await a staff Communications inbox module.
