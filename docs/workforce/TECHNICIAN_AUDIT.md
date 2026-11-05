# Technician Profile / Workforce — audit + merge status

> **Merge note (Oct 12 2026).** Sections A–B below are the OTHER chat's read-only audit of ITS tree (Oct 9 2026, flat
> `apps/api/src` layout), kept verbatim as the record of what the Technician Profile package set out to fix. It does NOT
> describe this tree. The table here is the status of each item in THIS tree after the wave-1 merge (owners: WF workforce,
> AUTH auth/tech app, BK booking/queue, PAY compensation, FE wave 2). Paths below are ours.

| # | Item | Status here | Where |
|---|---|---|---|
| 1 | Technician sessions on manager routes | CONFLICT — ours lets technicians use the POS by permission; not confined to a realm | AUTH ledger |
| 2 | PATCH writes commission | FIXED — stripped + audited; `technicians.view_pay` projection | modules/workforce/src/technicians/technicians-pay-projection.ts |
| 3 | Tech permission fail-open | FIXED | modules/queue/src/tech/tech.service.ts (AUTH) |
| 4–5 | Revocation never ends sessions / POS suspend revokes nothing | FIXED — ONE chain (users, memberships, sessions status+revoked_at, refresh tokens, Clock PIN, audit) | modules/workforce/src/technicians/revoke-technician-access.ts (+ technician-revocation.pgtest) |
| 6 | Default PIN / set-pin | FIXED | modules/identity (AUTH) |
| 7 | `managerOverride` body flag | FIXED — permission-checked override helper | modules/appointments `resolveManagerOverride` (BK), tech.service break guard (AUTH) |
| 8 | Kiosk PIN throttle | FIXED — per-kiosk limiter (in-process window) + per-PIN lock | modules/workforce/src/technician-clock-pin/kiosk-pin-limiter.ts |
| 9 | `/realtime/stream` for TECHNICIAN | ALREADY/CONFLICT — Phase 13 stream tickets; technicians on the POS use the POS stream | AUTH ledger |
| 10 | `/media/*` serves private keys | FIXED — signed private media | modules/workforce/src/tech-profile/media-access*.ts |
| 11 | Showcase attribution / auto-publish | FIXED | modules/workforce/src/nail-showcase (showcase-attribution.pgtest) |
| 12 | Hidden techs listed / other salons leaked / link before consent | FIXED | tech-profile (hidden-tech-visibility, pos-profile-no-other-salons, consent-before-link pgtests) |
| 13 | tip-policy gate, view_pay, manager messages, admin code | view_pay FIXED (WF); manager messages FIXED (AUTH); admin code ALREADY (hashed + atomic here before the merge); tip-policy write gate → PAY to confirm | WF / AUTH / PAY |
| 14 | Two minters, merge key order, uniques | FIXED — 577 one roster row per (tenant, profile); one login per tenant = OUR 538 (broader than their 460) | identity-one-minter, SA merge.pgtest |
| 15 | No authoritative technician state | FIXED — `technician_workforce_state` (579) + WorkforceStatusService; `technician_statuses` kept as compat row (no unique — modules/queue still appends) | modules/workforce/src/workforce-status |
| 16 | Skill-request CHECK, eligibility uniqueness | FIXED — 583; eligibility engine | modules/workforce/src/eligibility (AUTH) + technicians/technician-skills.ts |
| 17 | Time clock UTC key / split shifts / client-time path | FIXED — 580 open punch + breaks; roster `setShift` refused | modules/workforce/src/time-clock |
| 18 | Schedule version / time off | SCHEMA here (581, 582 workflow columns); code = BK (live-technician-schedule) | BK ledger |
| 19 | Serving state in memory | PAY (586 durable sessions) | PAY ledger |
| 20 | Commission basis / defaults / snapshots / refunds / tips | PAY | PAY ledger |
| 21 | Customer booking ignores skills/schedule; queue TOCTOU | BK / AUTH | BK, AUTH ledgers |
| 22 | Transfer departure inconsistent; accept not transactional | FIXED | super-admin transfer.pgtest |
| 23 | Review hide doesn't recompute rating | BK (reviews denorm) | BK ledger |
| 24–26 | Frontends (POS profile page, tech app Time Clock/Customers/Performance/Tips, owner) | NOT DONE — FE wave 2 (APIs ported) | — |
| 27 | `technician.*` realtime events | PARTIAL — technician_status/clock/schedule_updated added; service_session.* = PAY | packages/realtime-contracts |
| 28 | Cert expiry reminders; portfolio→showcase; pay-period earnings; tz today; owner live status; branch grants; fail-closed branch; tech import | certs+scheduler AUTH; earnings period PAY; branch grants WF 578 + materializeMembership; fail-closed AUTH; **portfolio→showcase publish and technician import: NOT DONE** | — |
| 29 | Cleanup (three PIN stores, legacy joins, …) | NOT DONE (P3) | — |

---

## Their audit (INSPECT → MAP), Oct 9 2026

Read-only audit of the real tree before any change. Paths relative to `apps/api/src` unless noted. Classification:
COMPLETE / PARTIAL / BROKEN / DUPLICATE / PLACEHOLDER / NOT_WIRED / UNSAFE / LEGACY / MISSING.

## A. What exists

**Identity / employment**
| Table | Role | State |
|---|---|---|
| `global_tech_profiles` (066/376/378/395) | global professional identity (tech_code, phone_hash, email_normalized, status active/paused/locked/suspended/anonymized/merged) | COMPLETE, two minters (DUPLICATE) |
| `tech_salon_memberships` (066/376/378/396) | employment link per (profile, tenant, branch); 10 statuses; transfer_from_tenant_id | PARTIAL |
| `technicians` (003) | salon roster row; single `branch_id`; `status` default `off_shift` + `is_active` + `archived_at` (triple-encoded) | PARTIAL |
| `users` (001/376) | per-salon login; single branch_id; no unique (tenant, email) | PARTIAL |
| `user_branch_access` (068) | per-branch role — never written for technicians | NOT_WIRED |
| `user_invitations` (270), worker transfer tables (252–254) | invites / transfers | PARTIAL |
| `technician_permissions`, `technician_app_settings` (377) | per-salon overrides; app_enabled not enforced | PARTIAL |
| `technician_statuses` (012/035) | presence/queue flag; NO unique index; appended by some writers, updated by others; read unordered by 7 readers | BROKEN |
| 3 PIN stores (`users.pin_hash`, `technicians.pin_hash`, `technician_clock_pins`) | | DUPLICATE |

Modules: `technicians/` (POS roster), `tech-profile/` (global identity, workplaces, public profile, portfolio, ratings), `tech/` (Technician App), `super-admin-staff/` (platform oversight, merge, cross-tenant transfer), `pos-team/` (non-tech invites), `auth/`.

**Skills / schedule / clock / queue / serving**
| Area | State |
|---|---|
| `technician_services` (eligibility) — no unique; `technician_skills` (377) taxonomy never read; `technician_skill_change_requests` (053/435) | skill requests BROKEN: 053 CHECK (`pending/approved/rejected`) still in force, code inserts `submitted/draft` |
| Eligibility enforcement | category-level and bypassable via body flag `managerOverride` (no permission exists) in booking/queue/tech-queue; NONE in customer booking, serving assign, live-schedule book-slot |
| `technician_schedules` (003/435) weekly hours; `technician_blocked_times` (035) | no version, no time-off table (`unavailableDates: []` hard-coded); customer booking ignores tech schedule entirely (env BOOKING_OPEN/CLOSE) |
| Time clock (`technician_shifts` 012/381, `time-clock/`, kiosk PIN) | UTC date key (US evening clock-in lands on tomorrow), one-shift-per-day unique (split shift → 500), `technician_statuses` upsert silently fails, duplicate client-time clock path `PATCH /pos/technicians/:id/shifts`, kiosk PIN enumerable (no throttle) |
| Queue (`queue/`, `tech-queue/`, `ai-queue-assignment/`) | availability is a free-form flag not derived from clock/employment; suspended techs assignable; assignment not compare-and-set; AI inputs (clockedIn, branch) fake |
| Serving (`serving/`) | status / delay / helper / done-idempotency kept in process memory (`Map`); start validates only ticket status; no one-active-session-per-tech; three Service Done implementations |
| Realtime | flat events (`queue_updated`, `service_started/done`, `time_clock_updated`); no `technician.*`; `/realtime/stream` open to TECHNICIAN role with full payloads |

**Commission / tips / earnings / payroll**
| Area | State |
|---|---|
| `compensation/` engine + policy hierarchy (ticket > tech+service > tech+category > tech > branch+service > branch > tenant) + `ticket_compensation_snapshots` (157) | COMPLETE engine; PARTIAL plumbing |
| Tenant default rate (`tenants.default_commission_percent`, settings 45) | never read → null commission ($0) when no rule |
| Hardcoded rates | 40 on membership approval/materialize, 60 in memberships/seed |
| Basis | uses `price_cents_snapshot || line_total_cents` (ignores overrides, retail qty), no `removed_at` filter |
| Snapshot | `policy_id` always null (rule used lost); `tech.complete()` inserts lines with no snapshot ($0) |
| Refund reversal | partial reversal only whole lines; no idempotency → double reversal possible; period sums ignore adjustments, `<= toIso` double-counts boundary |
| Tips | card/cash split broken (cash always 0); no manual allocation; two history readers disagree |
| Legacy `commission-report/` | includes unpaid tickets, tips to primary tech only — DUPLICATE |
| Payroll | finalized reopen without reason; app-only lock |
| `PUT tip-policy` | read-level gate (UNSAFE) |

**Portfolio / ratings / showcase / public profile**
| Area | State |
|---|---|
| Portfolio (cover, certs text, photos, before/after) | COMPLETE; but `/media/*` serves EVERY key publicly incl. private/rejected photos + skill documents (UNSAFE); skill-doc upload accepts any type; avatar/cover keys unnamespaced; photos public+approved by default; one salon's manager can moderate portable photos everywhere |
| Ratings/reviews | verified per (ticket, tech) COMPLETE; distribution from last 20 rows only; `pos/reviews` hide doesn't recompute denorm; two rating stores |
| Nail showcase | customer-authored only; manual post attribution to any tenant/tech unchecked + auto-publish (UNSAFE); portfolio→showcase MISSING |
| Public profile | no pay/commission/notes leak (COMPLETE); but suspended/hidden techs still appear in salon lists, favorites, service-tech matching; `posViewTechProfile` leaks every salon name the tech works at to managers; profile visible to hiring salon before consent |

**Frontends**
| App | State |
|---|---|
| POS | no technician profile PAGE — a drawer with hero/portfolio/reviews/access/permissions/skills/commission; missing employment/branches/schedule/services/queue/appointments/performance/tips/earnings/clock/certs/docs/audit; status dropdown silently ignored; lifecycle actions (suspend/archive) NOT_WIRED in UI; PATCH sends commission on every save (bypass); placeholder KPIs; live-schedule UTC date; week view "coming soon" |
| Tech app | Home/Schedule/Queue/Tickets/History/Earnings/Payroll/Profile/Portfolio/Ratings/Skills/Workplaces COMPLETE; MISSING Time Clock, Customers; Performance placeholder; native uploads sent without bearer; SSE uses relative URL (never connects natively) |
| Owner | branch filter stripped by middleware (does nothing); list lacks live status/current customer/tips/sales; rule versions need no admin code |
| Customer | COMPLETE + moderation bypass (above) |
| Super Admin | COMPLETE oversight; queue screen shows unmasked customer names cross-tenant with export; reads not audited |

## B. Problems (prioritized)

**P0 security / tenant isolation**
1. Technician sessions pass `TenantAuthGuard` on manager-only `/pos/serving`, `/pos/service-done`, `/pos/tech-appointments`, customers (TECHNICIAN has `serving.manage`, `booking.manage`, …) — bypasses own-ticket checks (`security-core.ts:19`, `rbac.ts:206`).
2. `PATCH /pos/technicians/:id` writes commission columns with only `pos.technicians.edit` — bypasses the admin-code-gated `setCommission` (`technicians.service.ts:175`).
3. Tech permission check fails OPEN when no `tech.*` key is in the session (`tech.service.ts:61`).
4. Super-admin suspend/lock/revoke sets `sessions.revoked_at`; guard reads `status` → sessions never end (`global-tech-admin.service.ts:182` vs `session-store.ts:108`).
5. POS suspend/archive/disconnect and transfer departure revoke nothing (users.status, sessions, realtime, PIN).
6. Default PIN `1234` for users without a PIN; `set-pin` without re-auth or limit (`auth.controller.ts:156-190`).
7. `managerOverride` body flag bypasses skill/hours/double-booking checks with no permission (booking, tech-appointments, queue, tech-queue, serving, blocked time); tech app can self-override the break guard.
8. Kiosk PIN identify: no failure counting / throttle (`technician-clock-pin.service.ts:91`).
9. `/realtime/stream` open to TECHNICIAN role (full branch payloads).
10. `/media/*` serves any key (private/rejected photos, skill documents); skill-doc upload unvalidated.
11. Showcase posts attributable to any tenant/technician, auto-published (`nail-showcase.service.ts:51`).
12. Suspended/hidden techs still listed (salon techs, favorites, serviceTechnicians); `posViewTechProfile` leaks other salons' names; global profile visible to hiring salon before consent.
13. `PUT tip-policy` read-level gate; front desk (`technicians.view`) can read commission/payroll; manager messages unguarded; commission admin code plaintext compare + non-atomic consume + `'*'` tenant wildcard.

**P1 identity / data model**
14. `getOrCreateMyProfile` second identity minter, violates `tech_code` NOT NULL. `decideIdentity` links paused/locked profiles; `findByKeys` doesn't exclude merged. Merge BROKEN (copies keys before clearing → unique violation). No unique on `technicians(tenant, gtp)`, `users(tenant, lower(email))`. `materializeMembership` inserts NULL branch_id. Single-branch roster vs per-branch memberships.
15. `technician_statuses` not a single authoritative row; no derivation from clock/break/employment.
16. Skill request CHECK blocks all creates; `under_review`/`more_info` unreachable; no unique `technician_services`; approval not branch-scoped, no lock.
17. Time clock: UTC date key; split shifts impossible; duplicate client-time path.
18. Schedule: no `version`, no time-off table; two blocked-time writers.
19. Serving state in process memory; no one-active-session-per-tech.
20. Commission basis/override/removed lines; tenant default never read; snapshot `policy_id` null; `tech.complete` lines without snapshot; refund adjustments not idempotent; hardcoded 40/60; cash tips always 0.

**P1 broken wiring**
21. Customer booking ignores skills, tech schedule, lunch, blocked time, branch. Serving start validates nothing about the technician. Queue assignment TOCTOU; suspended assignable; AI eligibility inputs fake.
22. Transfer departure / worker branch transfer leave roster, login, membership inconsistent; `TechWorkplacesService.accept` not transactional.
23. `pos/reviews` hide doesn't recompute rating; distribution from 20 rows.
24. POS status dropdown ignored; lifecycle actions have no UI; owner branch filter stripped; native uploads without bearer; native SSE never connects.

**P2 missing**
25. POS Technician Profile page (sections + separated employment / clock / shift / queue / service / presence statuses).
26. Tech app Time Clock, Customers, Performance, Tips screens.
27. `technician.*` / `service_session.*` realtime events.
28. Certification expiry + reminders; portfolio → showcase publish; pay-period earnings; tenant-timezone "today"; owner list live status; `user_branch_access` writer for techs; branch selection fail-closed; technician import stub.

**P3 cleanup**
29. Three PIN stores; `global_tech_profiles.user_id` legacy join; `technicians.status` default `off_shift`; three `commissionForLine` copies; two earnings endpoints on one screen; two rating stores; duplicate `technician_services` CREATE; stale migration headers (270 says 172, 435 says 436); placeholder KPIs/facets/export columns.
