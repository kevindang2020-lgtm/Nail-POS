# LIVE_OPERATIONS_ONE_SCREEN_STATUS.md — Live Operations 27-Inch One-Screen Touchscreen Optimization (Oct 28 2026)

Mandate: `AI_PowerSalon_27in_Live_Operations_One_Screen_Touchscreen_Optimization_Mandate.pdf` (§1–§36). Branch
`merge-github-main`; commits in CHANGELOG_HANDOFF. **Nothing pushed** (K-12 first). Delivered with the Check-In mandate;
the page uses the shared one-screen kit (`apps/pos-web/src/components/OneScreenKit.tsx`, the `:is(.overview-page,
.check-in-page,.live-ops-page)` block of `styles.css`). Environment and verdicts as in `CHECK_IN_ONE_SCREEN_STATUS.md`:
CODE_READY_FOR_DEVELOPER_HANDOFF = **YES**, PRODUCTION_READY = **NO** (jsdom tests, pos-web `tsc` / lint, Edge, branded
Chrome and the physical touchscreen are NOT_RUN here). No migration, no new route.

## Existing code found

| Piece | Path |
|---|---|
| Page (POS > Live Operations: `/live-operations`, `/dashboard`, `/tenant/dashboard`) | `apps/pos-web/src/screens/POSDashboardScreen.tsx` — rebuilt on the kit, every module kept (no second dashboard) |
| Shell / header / sidebar | `apps/pos-web/src/shell/*` (`header.topbar`, `tenant-nav.tsx`, `PlatformAnnouncementBar.tsx`) — unchanged |
| KPI / snapshot / activity / insights / chart / technicians / analytics / Quick Actions | inside `POSDashboardScreen.tsx` |
| Styles | `apps/pos-web/src/styles.css` — kit block + "Live Operations one-screen command center" block (the old `.dash-*` / `.dc*` classes are no longer used by this page) |
| API client | `apps/pos-web/src/api/posDashboardApi.ts` (unchanged) |
| Backend | `modules/analytics/src/dashboard/dashboard.controller.ts` → `dashboard.service.ts` → `dashboard.kysely.repository.ts` · DTO `dashboard.dto.ts` |

## Problems found

| Class | Problem | Fix |
|---|---|---|
| **P1 VIEWPORT OVERFLOW** | 1920×945 scrolled **128 px** (empty) · **359** (normal) · **634** (busy) · **2,112** (very busy) · 432 (long); 1600×765 376–2,343; even 2560×1305 scrolled when busy (274 / 1,752). Quick Actions and the bottom analytics were off screen (the mandate's two photos). | 0 / 0 at every one-screen size, every state. |
| **P1 RESPONSIVE LAYOUT** | Tailwind breakpoint grids with natural card heights; AI Insights and Multi-Location rendered **every** row (30 / 14 in the very-busy set); Live Activity a 750 px-min table with its own horizontal scroll. | One fixed grid (KPI · snapshot / activity / AI · trend / technicians · 4 analytics · Quick Actions); each list shows the rows that fit + "+N more" + View All; no horizontal card scroll. |
| **P1 TOUCH USABILITY** | Quick Action tiles wrapped; period selects 24 px. | 9 Quick Actions on ONE row, 44 px; period selects 32 px; snapshot tiles ≥ 44 px; chips ≈ 40 px hit area. |
| **P1 DATA ACCURACY (found while wiring)** | Staff On Duty counted every technician with an old `available` / `busy` row in the legacy log; Waiting = `waiting` only; Active Services / Ready counted removed or closed tickets; **Walk-ins = appointments with source manual / phone**; **"Upcoming — next 3 hours" compared to the database's UTC clock** (0 at 8 pm in New Jersey in the proof); Live Activity listed tickets the Active Services KPI did not count; **Multi-Location showed every branch to anyone** (a manager limited to two salons saw them all). | The Overview / Customer Queue authorities (workforce state, the 4 waiting statuses, status serving + not removed, open checkout tickets); walk-ins = today's queue entries with source walk_in; the branch clock; Live Activity = the KPI's population + its total; Multi-Location limited to the request's `authz.branchIds` — and that set is part of the 30 s cache key. |
| **P1 NOT_WIRED** | Start Service → the Serving board (nothing can be started there); Assign Tech → the queue without its sheet; Walk-In → Check-In's existing-customer tab; Add Product → the inventory list. A failed `/state` replaced the whole page. | `/queue?status=ready_for_tech`, `/queue?assign=1`, `/booking/walk-in` (the canonical walk-in screen), `/tenant/inventory?add=1`; a floating alert + Retry over the kept page. |
| **P2 EXCESS SPACING / EMPTY-STATE HEIGHT** | `mb-3`, `gap-3.5`, tall empty panels. | 7 px gaps, compact padding, one-line empty states inside the budgeted cards. |
| **P2 CHART SIZING** | Trend fixed 150 px viewBox stretched + separate legend / axis / summary blocks; 120 px donuts with stacked legends. | Chart fills its row (`preserveAspectRatio="none"`, non-scaling strokes), legend in the header, totals in the footer; donuts sized from the row, legend beside (3 + "+N more"). |
| **P2 SIDEBAR DENSITY** | 248 px. | Kept — the real group labels truncate at 175–195 px (rows are 40 px, §17 OK). |
| P3 VISUAL POLISH | Large KPI money wrapped. | ≥ $100,000 compact ($2.45M) with the exact amount as the tooltip; donut centres compact from $10,000. |
| Kit bug (found here) | `useFitRows` could flip 1 ↔ 2 rows forever (React #185) when one row's height under-estimated the pitch. | The measured two-row pitch is remembered (fixes Overview, Check-In and Live Operations). |

## Before / after measurements (real bundle, Chromium, `fixtures-lo.mjs`; BEFORE from a HEAD worktree)

| State | 1920×945 BEFORE (content / page / scroll) | AFTER | 1600×765 BEFORE | AFTER |
|---|---|---|---|---|
| empty | 1,013 / 885 / **128** | 885 / 885 / 0 | 1,081 / 705 / **376** | 0 |
| normal | 1,244 / 885 / **359** | 0 | 1,310 / 705 / **605** | 0 |
| busy | 1,519 / 885 / **634** | 0 | 1,570 / 705 / **865** | 0 |
| very busy | 2,997 / 885 / **2,112** | 0 | 3,048 / 705 / **2,343** | 0 |
| 200 technicians | 1,244 / 885 / **359** | 0 | 1,310 / 705 / **605** | 0 |
| long names | 1,317 / 885 / **432** | 0 | 1,364 / 705 / **659** | 0 |

AFTER = **36 / 36** one-screen cells (1920×945, 1920×1080, 1600×900, 2560×1440, 1600×765, 2560×1305); 1366×633 scrolls
91 px by design (§21 fallback). Available app height at the target = 885 px (945 − the 60 px shell header); safety margin:
Quick Actions end at y = 937. Raw: `results/liveops-before/`, `results/liveops-after/measurements.json`.

## Changes

- **Grid rows** (1920×945): KPI 80 · `minmax(0,1.12fr)` = 291 · `1fr` = 260 · analytics 150 · Quick Actions 60; gaps 7.
  TIGHT (≤ 820 high): 66 · 217 · 194 · 140 · 52, gaps 6. COMFORTABLE (≥ 2200×1200): 88 · 454 · 405 · 170 · 64, gaps 10.
  The §5 start ranges sum to ≈ 720 of 885 px; the two operational rows take the rest (§5 "starting ranges").
- **Columns**: row 1 `1fr 1.15fr 1fr`; row 2 `1.75fr 1fr`; row 3 four equal; KPIs 9; Quick Actions 9.
- **Typography**: card titles 13.5 px, tables 11.5 px / 29 px rows, KPI value 19 px, labels 10.5–11 px, sub-lines 10 px.
- **Overflow**: page `overflow: hidden` (§6 container: `calc(100dvh − header)`); card bodies scroll locally; every list
  shows only the rows that fit (E2E: no row hidden behind a card's scroll at 1920×945 and 1600×765).
- **Backend**: `dashboard.kysely.repository.ts` (authorities, walk-ins, branch clock, live total, branch-scoped
  multi-location; the live-activity service-name subquery is now tenant-scoped — `check:tenant-builder` baseline shrunk 176 → 175), `dashboard.service.ts` (`branchIds`, cache key), `dashboard.controller.ts` (`authz.branchIds`),
  `dashboard.dto.ts` (`liveActivityTotal`), `dashboard.repository.ts` (scope type); test `live-ops-branch-scope.vitest.spec.ts`.
- **Files**: `POSDashboardScreen.tsx` (+ `.test.tsx`), `OneScreenKit.tsx`, `styles.css`,
  `tooling/checkout-one-screen/{fixtures-lo,interact-liveops}.mjs`, `server.mjs`, `measure.mjs`.

## PostgreSQL 16 proof (`scratchpad/ci/queries.out`)

Walk-ins today new 14 vs old 5 (appointments with source manual / phone); upcoming next 3 h new 4 vs old **0** (database
clock 00:06, branch clock 20:06); waiting 18 vs 9; serving 12 vs 13; ready 8 vs 9; on duty 100 (workforce state);
Multi-Location for a manager granted B1 + B2: **2** branches (old 3), other tenant 0.

## Result matrix

| Gate | Result |
|---|---|
| POS BUILD | **PASS** (esbuild bundle; Vite NOT_RUN) |
| TYPECHECK | **PASS (no new errors)** — shimmed backend; pos-web `tsc` NOT_RUN |
| LINT | NOT_RUN |
| LIVE OPS E2E | **PASS** — `interact-liveops.mjs` 20 / 20; unit `live-ops-branch-scope` 2 / 2, dashboard cache / metrics / t02 13 / 13 |
| 1920×1080 ONE-SCREEN · NO VERTICAL · NO HORIZONTAL OVERFLOW | **PASS** |
| TOUCH TARGETS | **PASS (emulated)** |
| PLATFORM ANNOUNCEMENT (none / short / long / urgent) | **PASS** |
| CHROME | **PASS (Chromium)** — branded Chrome NOT_RUN |
| EDGE | NOT_RUN |
| PHYSICAL TOUCHSCREEN | NOT_TESTED |

Screenshots: `results/liveops-after/live-ops-{empty,normal,busy}-1920x1080.png`, `live-ops-busy-{1600x900,2560x1440,
1920x945,1366x633}.png`, BEFORE `results/liveops-before/live-ops-busy-1920x945.png` (committed). The two mandate photos remain
the real-world before-state reference.
