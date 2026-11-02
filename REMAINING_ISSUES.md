# REMAINING_ISSUES.md — honest unresolved items

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> The dated items below are historical notes (Info/Low). Item 8 (support-ticket attachments frontend) remains a Low nice-to-have; everything operational is subsumed by the owner-side list in `PROJECT_STATUS.md`.


_Nothing below blocks development or the verified green state (TEST_REPORT.md). Items 1–N are new/updated by the
FOUR-package merge (2026-07-09); the seven-package-era items follow and remain accurate._

## A. [RESOLVED 2026-07-09] Latent 403s on unminted coarse capabilities
The recommended reachability spec was implemented in the codebase-audit pass
(`apps/api/src/common/permission-reachability.vitest.spec.ts`) and immediately surfaced THREE more instances of the
marketing-bug class: `audit.view` (tenant Audit Log view), `communications.*` (the Communications inbox), and
`payroll.*` (Payroll) — each gated on a coarse capability no role held, so each 403'd for every user including
OWNER. All three are fixed in `auth/rbac.ts` (capabilities minted and granted to the correct roles), and the spec
now locks the "every gate is grantable by at least one role" invariant permanently. No unreachable gates remain.

## B. Optimizer forecast mapping is coarse (Info · ai-scheduling-optimizer)
`BusyPeriodForecastAdapter` maps the hour-of-week busy classification to `demandMinutes` as Σ(avg×60) over the
date's populated hours. The optimizer currently uses only `forecastAvailable` in its output (advisory), so the
coarse mapping has no ranking effect today; refine when demand-weighting enters the scoring.

## C. techBranches() reflects the scoped branch only (Info · ai-scheduling-optimizer)
The booking repo is tenant+branch scoped, so the production BookingReadPort answers `techBranches` with the ctx
branch. Multi-branch technician awareness (owner cross-branch optimization) would need an owner-scope read; the
constraint gate stays correct because candidates are generated from branch-scoped availability anyway.

## D. C's five Super-Admin oversight backends outnumber their admin screens (Info · admin-web)
C shipped SA oversight modules for customer-profile, checkout-upsell, reputation, OCR and scheduling, but admin
screens for only the first two (both wired). The remaining three backends are mounted and guarded; their consoles
are future admin-web screens.

## E. Marketing-domain capability granted to MANAGER + OWNER only (Decision record)
FRONT_DESK/RECEPTION do not receive `marketing.view` — campaign/review-response surfaces are manager-and-up.
Change deliberately in rbac.ts if the product decision differs.

---

# Seven-package-era items (still accurate)

## 1. Recurring-invoice generator not ported (Low · apps/api billing)
Package 2 had a `billing-scheduler.service` that auto-issued subscription invoices at period end — written against
p2's simpler invoice schema, which the canonical schema (base 195–200) superseded. **Cause:** schema-incompatible;
porting it would have meant rewriting it, which is feature work, not merging. **User impact:** invoices are created
via the Billing screen's explicit create/finalize workflow; there is no automatic period-end generator yet.
**Recommended repair:** re-implement the generator as a new unit against `billing_invoices`/`tenant_subscriptions`
(the base already has `billing-export.scheduler` as the in-process worker pattern to copy). Does not block production
for the manual-billing workflow.

## 2. Two scheduling substrates (Low · apps/api)
The Report-Builder scheduled reports (p2: `super_admin_scheduled_reports`) and the Users-directory export scheduler
(p7: `scheduled_reports` + `internal/scheduled-reports/run-due`) are separate, both functional, both tested.
**Impact:** none functionally; two cron-style substrates exist. **Recommendation:** when a third scheduled surface
appears, consolidate onto one runner.

## 3. Demo fixtures for disputes/memberships/billing require the two-tenant demo profile (Info)
The base arc's fixture migrations (188/189/191–194/195/198) seed realistic dispute/membership/billing rows only when
the two specific demo tenants exist **at migration time** (they were built for p5's demo DB). On a database seeded
with the standard `db:seed` (single PILOT01 tenant), those fixtures skip with a NOTICE and the screens render honest
empty/zero states — by design under the honest-verification invariant. **Recommendation:** if demo-rich screens are
wanted locally, create the two demo tenants before first migrate, or add a dedicated `seed-superadmin-demo` script.

## 4. p6's `${qs}`-style probes in the wiring scanner (Info · docs only)
`MODULE_WIRING_MATRIX.md`'s client↔backend matching is static-analysis based; one path
(`/super-admin/membership-programs/members` with a nested template query) needed manual verification (route exists,
controller line 47). The matrix documents this.

## 5. External-processor calls not exercised live (Info · payments)
Fiserv (CardPointe/Bolt) and Clover integrations were verified by their unit/adapter suites, config-status honesty
paths, and webhook-verification tests — no live processor credentials exist in this environment, so no real
authorization/settlement round-trips were made. Processor status endpoints correctly report not-configured until
real MIDs are supplied (see README payment setup).

## 6. ESLint style warnings remain (Info)
api: 0 errors / 92 warnings · admin-web: 0 errors / 43 warnings — all pre-existing `no-unused-vars`-class style
warnings carried in from the source arcs; none affect builds or runtime.

## 7. Lockfile is npm-generated in this sandbox (Info)
`package-lock.json` was refreshed by the clean install during the merge. If the team pins a different npm version,
regenerate with `npm install` on that version once.

## 8. Support ticket attachments: backend complete, no frontend consumer yet (Low · apps/api + pos-web)
The seven-package deep scan built the §18 storage substrate for Support Center ticket attachments as a real,
tested, secured feature: migration `295_support_ticket_attachments`, a pure validation core (MIME allowlist, 5 MB
cap, filename sanitization, delete rules — 11 unit tests), and `SupportAttachmentsService` reusing the established
`MediaStorage` port with a **separate private root** (unreachable from the public `/media/*` controller). Four
authorized endpoints exist under `tenant/help` (list/upload/download/delete), each enforcing the same
tenant + ownership rule as `getTicket`. **What's missing:** the POS Help Center screen (`POSHelpCenterScreen`) is
currently informational only — no package shipped a ticket-detail UI, so there is no button that calls these
endpoints yet. **Impact:** none to existing flows; the capability is API-complete and ready for a UI. **Repair:**
add an attachment panel to a ticket-detail screen when that screen is built.

## 9. Booking calendar: honest limitations after the 2026-07-03 high-density upgrade (Low · apps/pos-web + api)
- **Touch drag-and-drop: RESOLVED (2026-07-03).** The calendar now uses one unified pointer-event drag path:
  mouse/trackpad drags start on first movement; touch drags start after a 350 ms long-press (an earlier move lets
  native scrolling win, via pointercancel/threshold). Active touch drags freeze page scroll with a non-passive
  touchmove guard, the container auto-scrolls near its edges, Escape cancels, and the drop still commits through
  POST …/reschedule with full server re-validation and optimistic rollback. Locked by pointer-simulation tests.
- **Week view:** still not built — the grid is a day view (matching the reference design's primary mode). Date
  navigation changes the day; a side-by-side week grid remains future feature work.
- **Customer notifications in dev:** reschedule/cancel notifications go through NotificationsService when it is
  wired; with the in-memory driver the result is honestly audited as `not_configured` rather than pretending to send.
- **Schedule fallback:** a technician with no technician_schedules row for that weekday follows plain store hours
  (kept deliberately so tenants that never filled in schedules see no change).
