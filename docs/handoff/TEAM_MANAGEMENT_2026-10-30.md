# Team Management — build handoff (30 Oct 2026)

Route: **/tenant/team/members** (Team > All Team Members > Team Management). Acceptance spec: the owner's *Team Management
Complete Claude Build Guide* (both screenshots + recommended layout, §1–§23). Migration **722**. Local commit only — nothing
pushed, nothing deployed, no production data touched.

## 1. Audit findings (before this build)

| # | Finding | Where | Now |
|---|---|---|---|
| 1 | Roster joined `technicians ON t.user_id = u.id` **without the tenant** — another salon's technician row pointing at the same user id leaked its phone / photo / figures | `pos-team.service.ts` getState + getMemberDetail | **Fixed** in place (`onRef('t.tenant_id','=','u.tenant_id')`); the new read model joins with the tenant in raw SQL; pgtest proves it |
| 2 | Everything computed in memory, no branch scope, server-local weekday for "today" | `PosTeamService.getState` | Screen moved to the raw-SQL, tenant + branch scoped, salon-timezone read model `/pos/team-members-screen/*` |
| 3 | "Total Commission Paid" was commission **earned** (snapshot) — no payout evidence | KPI card | Card is **Commission Earned**; its subtitle shows **Paid** from `payroll_payouts` status `paid` only |
| 4 | "Active Today" = live status on_shift/on_break (and "on shift" was invented from a weekly template) | getState mapStatus | Defined: scheduled today (date override › published shift › weekly template, minus approved time off) **or** clocked in today |
| 5 | Services / revenue counted every line (add-ons, removed, voided tickets) | getState | Paid service lines only: not add-on, not retail, not removed, ticket not voided / removed |
| 6 | Open Positions hard 0; birthdays always []; training "needs backend" rings showing 0 | getState / screen | Open Positions **Not configured**; Birthdays **not recorded** (no field); Training **not configured** (ring shows "—"); certifications are real |
| 7 | Department regex-derived but shown as data | getState deptOf | Still derived (there is no department column) — now **labelled "derived from role"** everywhere |
| 8 | Role tabs could double count; filters client-side over an in-memory list; search only name/email/phone/role on one page | getState | Server SQL: unique members, tabs count members holding each role, search over the whole authorised set |
| 9 | Export navigated to Payroll; MemberDrawer tabs only navigated away; More Filters had only Clear all | screen | Real audited server CSV; full lazy profile overlay; More Filters has account / extra / sort |
| 10 | Old `GET /pos/team/member/:userId` (drawer) — after the rebuild no screen calls it | controller | **Route retired** (dead-route gate); `getMemberDetail` kept and fixed |

Also verified: `technician_shifts` holds both published shifts (`status = 'scheduled'`) and time-clock punches (`active` /
`completed`, written by the time clock). The read model keeps them apart: punches = attendance, `scheduled` rows = published plan.

## 2. What was built

### Backend (modules/workforce/src/team-screens)
- `team-members-screen.repository.ts` + `.controller.ts` — `/pos/team-members-screen/*`. Roster CTE (users + login-less
  technicians, branch scope via `users.branch_id`, `user_branch_access`, `technicians.branch_id`) → roles array (account role,
  `technicians.role_label`, `staff_role_assignments`) → live state (`technician_workforce_state`) + today's shift parts
  (`technician_shift_overrides` › `technician_shifts status=scheduled` › `technician_schedules`, approved `technician_time_off`) →
  derived department, scheduled flag, live status. KPI groups fail independently and report `errors[]` (never a verified zero).
- `team-data-alerts.repository.ts` + `.controller.ts` — `/pos/team-data-alerts/*`, the commission-review pattern: Run Check with
  six detectors, fingerprint upsert, versioned state machine, append-only events, audit in the same transaction, denied actions
  audited, tenant 404, permission 403, amounts hidden without the pay permission. Nothing is ever fixed automatically.
- `report-export.ts` — new report type `TEAM_DIRECTORY` through the existing fail-closed `auditedExport` (requested → succeeded |
  failed | denied; safe filter summary only).
- `pos-team.service.ts` — tenant joins fixed; `pos-team.controller.ts` — dead `member/:userId` removed.
- `request-schemas.ts` — `TDA_*` strict bodies. `team-screens.module.ts` — providers `(db ? new Repo(db) : null)`.

### KPI definitions (server, screen, pgtest)
| KPI | Definition | Period | Source |
|---|---|---|---|
| Total Team Members | unique current members (not archived) in branch scope; active / inactive split | now | users + technicians |
| Active Today | scheduled today **or** clocked in today | salon today | overrides › published shifts › weekly template − approved time off; punches / clock state |
| On Shift Now | `shift_status = ON_SHIFT` (+ clocked-in count) | now | technician_workforce_state |
| Avg. Performance Score | verified reviews 1–5 (not hidden, not spam) "x.x / 5" + review count + rated members | selected period | reviews |
| Total Services Completed | paid service lines, no add-ons / retail / removed / voided | selected period (paid date) | ticket_service_lines + tickets |
| Commission Earned | snapshot earnings + retail commission + approved non-tip adjustments; subtitle **Paid** = payouts status paid | period (earned: checkout; paid: payroll paid date) | ticket_compensation_snapshots, compensation_adjustments, payroll_payouts |
| Pending Approvals | skill requests + pending time off + profile changes + membership requests | now | the four request tables |
| Open Positions | **Not configured** (no recruiting record) | — | — |

### Data Accuracy Alerts detectors (documented tolerances)
SHIFT_STATUS_MISMATCH (on shift / clocked in with no shift today; DAY_OFF override or time off → high; stale live state > 12 h with
no open punch is called "stale") · MISSING_SERVICE_MAPPING (upcoming booking by catalog name, or a paid line in 30 days, without a
`technician_services` mapping) · COMMISSION_PAID_MISMATCH (PAID payroll periods ending ≤ 180 days ago: snapshot earnings + tips +
approved adjustments over the period's dates vs payouts linked to the period with status paid; tolerance **$1.00**) ·
ATTENDANCE_DISAGREEMENT (first clock-in vs planned start, last 14 days, tolerance **15 min**; DAY_OFF override and approved time off
excluded; an approved date override is the plan) · DUPLICATE_CONTACT (two current members with the same last-10-digit phone or
e-mail; a login and its own technician record are one member; fingerprint hashes the value, evidence is masked) · STALE_USER_LINK
(current technician whose `user_id` is an inactive / suspended login or no login of this salon).

### Frontend (apps/pos-web)
- `screens/POSTeamScreen.tsx` — rebuilt on the read model, `.work.mos.tmm`; header actions Refresh · Find Qualified & Available
  Staff · Edit Selected Date Shift · Data Accuracy Alerts (open count) · Export · + Add Team Member (→ existing create / invite flow
  on Technicians). Period bar Today / Week / Month / Year / Custom (monthly range calendar) with date basis *Service completion
  date* / *Employee created date*. KPIs 4 + 4 with definitions. Directory: role tabs (unique counts), Role / Status / Shift /
  Department, More Filters (account, extra: missing mapping / no login / has login / unrated, sort), all ten columns, numbered pages,
  matched-via line. Panels 2-column: Attendance (donut) · Performance Overview (+ Unrated) · Top Performers · Today's Shift
  Overview · Team Productivity (vs previous period) · Pending Approvals · Upcoming Birthdays · Training & Certifications, each with
  its View All / View Full Attendance link.
- `screens/teamMembersParts.tsx` — EmployeeProfileOverlay (10 lazy tabs; Earnings only with pay permission, Roles & Access only
  with roles/settings/audit view; Schedule → DateShiftEditor; Close / Esc keep search, filters, page), TeamAvailableFinder,
  DateShiftLauncher, TeamDataAlertsPanel + slide-over.
- `api/posTeamScreensApi.ts` — `posTeamMembersScreenApi`, `posTeamDataAlertsApi`; `api/posTeamApi.ts` — dead `getMember` removed.
- `i18n/ns/teammembers.{en,vi}.ts` (339 keys, EN + VI), review table appended to `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (A46).
- `styles.css` — commented `.tmm` block (44 px targets, 13 px data text, column dropping at 1500 / 1440 / 1366 with the detail in
  the profile overlay).

## 3. API routes (all TenantAuthGuard + RolePermissionGuard, `pos.technicians.view`; finer permissions re-checked in the repository)
`GET /pos/team-members-screen/dashboard` · `/directory` (ListQuery) · `/export` (async, audited CSV) · `/live` ·
`/members/:memberId` · `/members/:memberId/{access|schedule|attendance|skills|work|performance|earnings|training|history}` ·
`GET /pos/team-data-alerts` (ListQuery) · `/assignees` · `/:id` · `POST /pos/team-data-alerts/run-check` ·
`POST /pos/team-data-alerts/:id/{assign|investigate|notes|resolve|dismiss|reopen}` (expectedVersion). Removed: `GET /pos/team/member/:userId`.
Reused unchanged: `/pos/shift-overrides` (editor / preview / save), `GET /pos/booking/openings` + `/availability`,
`/pos/team-performance-screen/technicians/:id/composite`, `/pos/commission-screen/export-history?type=TEAM_DIRECTORY`.

## 4. Migration 722 and recovery
`apps/api/db/migrations/722_team_data_alerts.sql` — EXPAND-ONLY, idempotent (applied twice to the template): `team_data_alerts`
(fingerprint unique per tenant, status / type / severity CHECKs, no-delete trigger), `team_data_alert_events` (same-tenant FK,
append-only trigger), `team_data_alert_runs`. No existing table changed. **Recovery:** roll the code back; the three tables are then
unread. Do not drop them (review decisions would be lost) — forward-fix only. Staging: apply 722, run the pgtests, Run Check once.

## 5. Tests actually run (this worktree, 30 Oct 2026)
| What | Result |
|---|---|
| `team-members-screen.pgtest` (KPI definitions, unique role tabs, tenant-joined technician, branch scope, newest first + pages, search beyond page 1: name · phone ×3 formats only with contact permission · service · appointment id · employee code, filters, profile tab gates, audited export + denial) | **10 / 10 PASS** |
| `team-data-alerts.pgtest` (6 detectors, no false positives for time off / DAY_OFF / approved override / own login, dedupe on rescan, transitions, 409, 422, reason rule, append-only + no-delete triggers, audit rows, 403 + audited denial, amounts hidden, cross-tenant 404, nothing changed) | **5 / 5 PASS** |
| `report-export.pgtest` (existing, after adding TEAM_DIRECTORY) | **6 / 6 PASS** |
| `pos-team.vitest.spec` (existing) | **3 / 3 PASS** |
| `POSTeamScreen.test.tsx` (rewritten: KPIs + labels, KPI error state, modules, server search, lazy profile + Close keeps search, export, alerts count) | **NOT RUN** — pos-web vitest cannot run here; esbuild syntax check OK, tsc: no undefined names |
| Harness measure `team-members` — 1920×945 · 1536×729 · 1440×765 · 1366×633 × pilot/en · pilot/vi · empty/en (Chromium, DPR 1, touch) | **12 / 12 PASS** — no sideways scroll, every module painted, pager reachable, 0 unhandled routes |
| Harness E2E `interact.mjs … team` (all 25 existing team steps + 8 new) | **33 / 33 PASS**, no page errors |
| Gates: list-queries, tenant-isolation, as-any, role-checks, validated-bodies, async-exports, audit-select-columns, impossible-predicate, unreached-routes, silent-catch, audit-writers, pos-i18n, vi-glossary, inert-controls, dead-client-methods | **all PASS**; openapi manifest + attack surface regenerated |
| `run-gates.mjs` | only the 12 known environment failures |

Harness notes (honest): the Find Available step stubs `/pos/booking/openings` and `/pos/booking/availability` with fixed engine
answers because the booking engine needs the Kysely query builder the stand-in lacks — the UI ranking, desired-time, empty
explanation and Open Booking hand-off are exercised, the engine itself is not exercised here. The seed adds one fixture punch (CD at
10:30 vs 09:00) for the attendance alert. One earlier E2E run collided with another worktree's harness on port 4396 (EADDRINUSE) and
was re-run. Gate runs used a temporary symlink to the main checkout's built `packages/{permissions,api-contracts}/dist` (removed).

## 6. §22 Final acceptance checklist
| Item | Status | Notes |
|---|---|---|
| Both screenshot layouts and every original module accounted for | **Done** | all 8 KPIs, tabs, 10 columns, search + 4 filters + More Filters, Export, Add, row actions, 8 panels; recommended 2-column organization |
| Eight KPIs with verified definitions and source / period | **Done** | §2 table; error state per KPI group |
| Six tabs preserved; overlap does not inflate unique members | **Done** | pgtest: manager + technician = 1 member under both tabs |
| Server search: name, normalized phone, authorized email / ID, role, department, service / skill, linked appointments | **Partial** | all server-side; "linked appointments" = appointment id or ticket number; searching by a **customer's** phone / name is not offered (no broad customer search) |
| Today / Week / Month / Year / Custom monthly calendar; date basis; salon timezone | **Done** | existing PeriodBar range calendar; basis select; tz shown |
| Numbered pages, totals, independent history paging, newest first, schedules chronological | **Partial** | directory + each profile tab + alerts + alert history page on the server; page-size selector (10/20/50) and URL query-state not added; "return to Page 1 and highlight the new member" not built (create happens on Technicians) |
| Full Employee Profile Overlay (photo, role, contact, schedules, attendance, skills, appointments, performance, authorized earnings, training, history, Close) | **Done** | no in-overlay editing (Edit opens the existing technician page / Users & Roles), so no unsaved-change prompt is needed except in DateShiftEditor (has its own) |
| Find Qualified & Available Staff checks real mappings, shifts, breaks, bookings, workload, duration | **Partial** | uses the booking engine (mapping, shift, breaks, time off, bookings, full duration) + live state; branch = session branch; "preferred technician" input not built; real engine not exercised in the harness (stubbed) |
| One-Day Shift Editor modifies only the selected date | **Done** (technicians) | existing versioned, conflict-checked editor reused from header, row and profile; non-technician staff: stated "date shifts apply to service providers" |
| Data Accuracy Alerts flag data-backed mismatches, audited review, never change payroll / status / history | **Done** | six detectors; Run Check is manual (no scheduler) |
| Attendance, Performance, Top Performers, Shift Overview, Productivity, Approvals, Birthdays, Training panels + View All links functional | **Done** | Birthdays = genuine "not recorded"; Training = "not configured"; links go to Time Clock, Team Performance, Staff Schedule, Skill Requests, Team Profiles, Technicians |
| Add Team Member, Edit, Export, row actions functional and audited | **Partial** | Export audited (requested / succeeded / failed / denied); Add / Edit hand over to the existing audited flows; no new create flow for non-technician staff here |
| Commission Paid labelling reconciles to payouts; star rating and composite distinct | **Done** | Earned vs Paid; composite shown separately (0–100, "Insufficient data") |
| Booking, Tech Appointments, Tech Queue, Staff Schedule, Time Clock, Technician App, Commission, Payroll, approvals synchronize | **Partial** | reads the canonical tables directly (no copies); date-shift saves emit the existing outbox event; this screen itself refreshes on its own actions / Refresh — no SSE subscription added |
| Tenant isolation, branch / role security, privacy, export auditing, history preserved | **Done** | literal tenant predicate everywhere (gate), branch scope, permission-gated contact / pay / access, masked phones, audit; cross-tenant join fixed |
| Browser / screen tests at 100% zoom pass; genuine empty / error states | **Done** | 12 / 12 measure + 33 / 33 E2E (harness, not a staging browser) |
| File list, staging migration plan, test results, blockers, deployment instructions | **Done** | this document |

## 7. Residual risks / owner actions
- **Review the Vietnamese** (A46 section) — "Stylist" drafted as "Thợ làm tóc"; "Nail Technician" = "Thợ" per the ruling.
- **Roles**: inferred from `users.role`, `technicians.role_label` and `staff_role_assignments` template keys (regex on the key). A
  salon using custom labels may need a mapping; "Other staff" is shown, never guessed.
- **Commission alert** compares the ledger over the period's dates with payouts linked to the period; a payout that deliberately
  includes something outside the ledger will alert (review, then dismiss with reason). Tolerance $1.00.
- `apps/api/security/role-matrix.snapshot.json` still lists the retired `GET /pos/team/member/{userId}` (not a gate run here).
- Run the rewritten `POSTeamScreen.test.tsx` (and `POSTeamServicesScreens*.test.tsx`, which still mock `getMember` harmlessly) in
  an environment where pos-web vitest runs.
- Staging: apply 722, run both pgtests, open /tenant/team/members as Owner, Manager and Front Desk.

## 8. Files
New: `apps/api/db/migrations/722_team_data_alerts.sql`, `modules/workforce/src/team-screens/team-members-screen.{repository,controller}.ts`,
`team-members-screen.pgtest.vitest.spec.ts`, `team-data-alerts.{repository,controller}.ts`, `team-data-alerts.pgtest.vitest.spec.ts`,
`apps/pos-web/src/screens/teamMembersParts.tsx`, `apps/pos-web/src/i18n/ns/teammembers.{en,vi}.ts`, this document.
Changed: `modules/workforce/src/pos-team/pos-team.{service,controller}.ts`, `modules/workforce/src/request-schemas.ts`,
`team-screens/{report-export,team-screens.module}.ts`, `apps/pos-web/src/screens/POSTeamScreen{,.test}.tsx`,
`apps/pos-web/src/api/{posTeamApi,posTeamScreensApi}.ts`, `apps/pos-web/src/i18n/ns/index.ts`, `apps/pos-web/src/styles.css`,
`apps/api/scripts/list-queries.allowlist.json`, `apps/api/openapi/manifest.txt`, `docs/security/{SECURITY_ATTACK_SURFACE.md,attack-surface-routes.csv}`,
`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`, `tooling/catalog-one-screen/{team-extra,pages,interact-team}.mjs`.
