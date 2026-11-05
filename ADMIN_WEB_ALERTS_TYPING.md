# admin-web hardening — Super Admin alerts typing (completes the admin client)

Typed the alerts cluster behind AlertsScreen — `alerts`, `alertsSummary`, `alert`, `alertsRecent`, and `alertStatus`. This was
the last `any` GET cluster in the Super Admin client; with hardware-payment done, the whole client is now typed.

## What changed
- **New types in `superAdminApi.ts`** mirroring `alerts-core` exactly: `SaAlert` (= `AlertRow`), `SaAlertNote`,
  `SaAlertDetail` (`SaAlert & { notes }`, matching the repo's `get` return), and `SaAlertsSummary` (the eight KPI counts).
- **Wired:** `alertsRecent => SaAlert[]`, `alerts => { rows: SaAlert[]; total }`, `alertsSummary => SaAlertsSummary`,
  `alert => SaAlertDetail | null`, `alertStatus => { ok; alert?: SaAlert; error? }` (all were `any` / `any[]` / `{rows: any[]}`).
- **AlertsScreen de-`any`-ed:** `rows` → `SaAlert[]`, `sum` → `SaAlertsSummary | null`, `detail` → `SaAlertDetail | null`; the
  notes map dropped `(n: any)`. Typing surfaced two closure-narrowing spots — `nav(detail.relatedModule)` and
  `encodeURIComponent(detail.tenantId)`, both already inside `detail.X ?` truthy guards — now `!`-asserted (behavior-identical;
  TS just can't carry property narrowing into the onClick closure). All list-row, summary-KPI, and detail reads verified.

## Verification
admin-web `tsc` clean, **151 tests pass** (30 files, incl. the existing AlertsScreen test), `vite build` clean.
(pos-web 75, owner-web 85, tech-web 74, customer-web 136, backend 603 / PASS — all unchanged; types + two `!` guards.)

## Where the `any`-surface backlog now stands (all six apps)
Only **three** `api.get<any>` remain anywhere: `hwGlobalSettings` (admin — unused, no read surface), `publicPreview`
(tech — TechProfileScreen) and `myTechRating` (customer — RateTechScreen). Both screens were audited clean earlier; these are
small, single-screen doc/guard typings. Every meaningful read surface across the monorepo is now compiler-checked.
