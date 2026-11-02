# Team Management round 2B — TM-06 … TM-09 (30 Oct 2026)

Scope: the Four-Module Completion Guide §10.1–§10.4 (Team Management: all-role onboarding, nightly data-accuracy checks,
optional birthdays, training & certification) and the matching rows of §17 / §18. Built on the round-1 Team Management code
(`docs/handoff/TEAM_MANAGEMENT_2026-10-30.md`, migration 722). TM-01…TM-05 (customer-linked search, 10/20/50 + URL state,
new-staff highlight, preferred technician, live updates) were built in parallel by another agent and are **not** in this
change. Migration **727**. VI review section **A53**. Local commit only: nothing pushed, nothing deployed, no production data,
no real SMS / e-mail (the harness and pgtests inject a fake invitation delivery).

Status vocabulary (guide §1): **Verified** = a test I ran here proves it · **Implemented but Unverified** · **Blocked - External
Setup** · **Not Built**.

## 1. Audit: what already existed and was reused

| Need | Existing piece | How it is used |
|---|---|---|
| Staff invite / create | `user_invitations` + token primitives (`@aipowersalon/identity`: `mintInvitationToken`, `invitationExpiry`, `acceptUrl`, `InvitationDelivery`) and the public accept flow; `POST /pos/access/invitations` (receptionist / front desk / manager only, no idempotency, no job role) | The new onboarding writes the **same** invitation row (token hash only) and delivers through the **same** `InvitationDelivery` seam, so the existing accept page activates the account. |
| Technician hire | `POST /pos/technicians` (global identity dedupe, membership, Clock PIN, commission, Tech App) | **Reused unchanged** for nail technician / stylist. Only these roles show technician fields (stylist also gets `roleLabel: 'Stylist'` through the existing `PATCH /pos/technicians/:id`). |
| Role ceiling | `staff-roles.ts` ceiling rule (a template only narrows its base; you cannot hand out what you do not hold), `DEFAULT_ROLE_TEMPLATES`, `tenant_custom_roles` | Same rule; templates `SUPPORT_STAFF` (assistant) and `BRANCH_MANAGER` (manager); the salon's custom roles are offered as configured roles. |
| Branch access | `user_branch_access` | Written at onboarding (session branch; others only with `branch_access.manage`). |
| Data accuracy alerts | `team_data_alerts` / events / runs (722), fingerprint dedupe, review workflow | Extended in place: 2 new detectors, a nightly trigger, run records, escalation, category / remediation / first-last seen / seen count. |
| Durable jobs | `jobs` queue (`enqueueJob`, `registerJobHandler`, backoff, reaper), the env-gated in-process scheduler pattern (`ai-trial-sweep.ts`) | The nightly check is a `report`-class job with idempotency key `<tenant>:<salon-local date>`. |
| Certifications | `technician_certifications` (584) + `POST /pos/technician-certifications/:tid/:cid/verify` | A technician's certification is **created in that table** (UNVERIFIED) and **linked** from the training assignment. It is never copied. Verification uses the existing route. |
| Birthdays / training | none (round 1 showed "not recorded" / "not configured") | New, migration 727. |

Intentional surgical changes to round-1 files: the roster's role inference reads the onboarding job role (`team_staff_profiles.job_role`) when one exists, so an assistant is not shown as a receptionist. The dashboard's `training.configured` / `birthdays.recorded` flags are now real. The member Training tab now points at the new records. Run Check delegates to a shared `scan()`.

## 2. What was built

### TM-06: Add Team Member for every role
- `modules/workforce/src/team-staff/team-onboarding.repository.ts` + `team-onboarding.controller.ts`
  - `GET /pos/team-onboarding/options` returns the roles this actor may add, with the reason when a role is not allowed, plus the branches they may grant.
  - `POST /pos/team-onboarding/staff` requires `roles.manage` (re-checked; 403 is audited) and `@RequireStepUp`. The body carries `idempotencyKey`.
- Rules, all on the server and decided by permissions:
  - The actor's level comes from what they hold: `ownership.transfer` = owner level, `roles.manage` = manager level.
  - The new role's base must be **strictly below** the actor's level. OWNER / SUPER_ADMIN bases are never grantable.
  - Every permission the role carries must be one the actor holds.
  - Branches are limited to the session branch unless the actor has `branch_access.manage`, and must be this salon's.
  - **One identity:** an e-mail or the last 10 phone digits already used by a login or a technician record of the salon → 409 `DUPLICATE_IDENTITY` with `existingMemberId`.
  - **Idempotency:** the same key and the same body returns the same member (`replayed: true`, no second delivery). The same key with a different body → 409.
  - **One transaction:** `users` (status `invited`), `staff_role_assignments` (template), `user_branch_access`, `team_staff_profiles` (job role), `user_invitations`, the idempotency row and a fail-closed audit row `team.staff.onboarded`.
  - Delivery happens after commit. When nothing is connected the response is `not_connected` plus the link to hand over, never "sent".
  - A receptionist gets **no** technician row, PIN, commission or service mapping.
  - Provider roles → 422 `USE_TECHNICIAN_FLOW`; the dialog sends them to the existing hire.
- UI (`apps/pos-web/src/screens/teamStaffParts.tsx` → `AddTeamMemberDialog`):
  - Header **+ Add Team Member** now opens this dialog (it used to navigate to /technicians).
  - Role select shows roles that are not allowed as disabled, with the reason.
  - Staff roles get name / e-mail / phone / branches; technician fields appear only for providers.
  - Step-up prompt; result with the invitation status and link.
  - **Show in team list** goes to `/tenant/team/members?created=<memberId>`, for the other agent's TM-03 highlight. For a technician it is the userId, else the technicianId.

### TM-07: scheduled data-accuracy checks
- `team-data-alerts.repository.ts`:
  - `runCheck` (permission-gated, unchanged for callers) → `scan(ctx, requestId, { trigger, runDate })`.
  - New detectors:
    - **ORPHANED_ASSIGNMENT**: an upcoming appointment on an archived / inactive / foreign technician record, or a role template left on an ended / missing login.
    - **MISSING_BRANCH_ASSOCIATION**: a technician / login / branch grant pointing at a branch that is not the salon's (high). In salons with 2+ branches, a current provider or front-desk login with no branch at all (medium).
  - Every finding now returns: tenant, branch (the finding's own branch where known), category, severity, evidence, `evidencePointers`, `firstSeenAt`, `lastSeenAt`, `seenCount`, `lastRunId`, assigned reviewer, status, remediation.
  - A rescan only moves `last_seen_at` / `seen_count` / `last_run_id`. The reviewer's decision is untouched.
- `team-staff/team-data-nightly.ts`:
  - `TeamDataNightlyScheduler` is env-gated: `TEAM_DATA_NIGHTLY_ENABLED` (off by default) and `TEAM_DATA_NIGHTLY_LOCAL_HOUR` (default 2). It ticks hourly and only in a process that runs `report` jobs.
  - Each tick enqueues `team.data_check.nightly` per active salon whose local time has passed the hour. The idempotency key is per salon-local date; the run is staggered 0–15 min by tenant hash; `maxAttempts` is 4 (queue backoff with jitter).
  - The handler claims `team_data_nightly_runs (tenant, run_date)`. A date that already succeeded returns `already_done`. A failure records status `failed`, attempts and the last error code, then rethrows so the queue retries.
  - **Escalation:** 3 failed attempts on one date, or 2 consecutive failed dates, raise **one** `DATA_CHECK_JOB_FAILED` alert (high). It is deduped per failure streak and sits in the same reviewed list. No SMS / e-mail is sent.
  - The handler is registered on module init wherever the module loads.
  - The nightly run also persists training expiry. It never changes payroll, commissions, attendance, bookings, access or staff status.
- UI: the type filter includes the new types. The alert review shows category, first / last seen and N checks, and a "What to do" line per type. The panel shows the latest nightly run (date, status, escalated).

### TM-08: optional birthdays
- `team_staff_profiles.birthday_month/day` hold no year. There is a DB CHECK that the date is valid in *some* year, so Feb 29 is valid.
- `birthday_visible_to_team` defaults to **false** (private unless shared).
- Routes:
  - `GET /pos/team-birthdays/upcoming` (30 days, salon-local today)
  - `GET` / `PUT /pos/team-birthdays/members/:memberId`
- Who sees and edits what:
  - A staff-profile manager (`technicians.edit` / `roles.manage`) sees and edits every birthday.
  - The member sees their own, and edits it with `self.profile.edit` through the same route.
  - Colleagues see a birthday only when it is shared.
  - Denied edits are audited. The audit row records the change, never the date.
- **Feb 29 rule (documented and tested):** in a non-leap year it is shown on **Feb 28**, labelled "Feb 29 — shown on Feb 28 this year".
- UI:
  - The Upcoming Birthdays panel shows name · month day · "in N days" · private, with no year and no age. "Birthdays are not recorded" appears only when nobody visible to the viewer has one.
  - The profile Overview has "Birthday (optional)" with month / day selects and "Show to colleagues".

### TM-09: training & certification
- Tables (migration 727):
  - `team_training_courses`: the catalog; archived, never deleted.
  - `team_training_assignments`:
    - Lifecycle: assigned → in_progress → completed → expired, or canceled.
    - Each change does a row lock, checks `expectedVersion` (409) and the transition (422), and writes the event and the audit row in one transaction.
    - One open assignment per person per course; a new one may follow a completed / expired / canceled one.
  - `team_training_events`: append-only (trigger).
  - `team_staff_certifications`: for staff with no technician record. Verification is separate and needs a verify permission; a member cannot verify their own.
- Expiry: completion + course validity in months. Reads already show `expired`; the nightly sweep (`expireDue`) persists it with an EXPIRED event.
- **Completion ≠ certification:** completing a training never changes a certification. A certification is recorded UNVERIFIED and only a verifier changes it.
- Routes (`/pos/team-training/*`): summary · courses (list / create / archive) · members/:memberId · assignments (create / start / complete / cancel) · certifications (create / verify).
- UI:
  - The Training & Certifications panel shows real **completed / expiring / in-progress** rings (plus expired, overdue, verified / awaiting verification). It shows **Not configured** while the catalog is empty, with a "Set up training" button.
  - The Training catalog dialog lets you add and archive courses (archive needs a reason).
  - The profile Training tab lists records with history, Start / Mark completed / Cancel, assignment of a course, and Record a certification. Certifications show "Awaiting verification" until verified; technician certificates are verified through the existing route.

## 3. API routes added (TenantAuthGuard + RolePermissionGuard, `pos.technicians.view`; finer permissions re-checked in the repositories)
`GET /pos/team-onboarding/options` · `POST /pos/team-onboarding/staff` (step-up) · `GET /pos/team-birthdays/upcoming` ·
`GET|PUT /pos/team-birthdays/members/:memberId` · `GET /pos/team-training/summary` · `GET|POST /pos/team-training/courses` ·
`POST /pos/team-training/courses/:id/archive` · `GET /pos/team-training/members/:memberId` · `POST /pos/team-training/assignments` ·
`POST /pos/team-training/assignments/:id/{start|complete|cancel}` · `POST /pos/team-training/certifications` ·
`POST /pos/team-training/certifications/:id/verify`. Job type `team.data_check.nightly` (class `report`).
`apps/api/openapi/manifest.txt` and `docs/security/{SECURITY_ATTACK_SURFACE.md,attack-surface-routes.csv}` were regenerated (3408 routes).

## 4. Migration 727 and recovery
`apps/api/db/migrations/727_team_onboarding_birthdays_training.sql` is EXPAND-ONLY and idempotent. It was **applied twice** to the `aps` template here; the second run only printed "already exists" notices.
- New tables: `team_staff_profiles`, `team_onboarding_requests`, `team_training_courses`, `team_training_assignments`, `team_training_events` (append-only trigger), `team_staff_certifications`, `team_data_nightly_runs`. Assignments and staff certifications have no-delete triggers.
- New columns: `team_data_alert_runs.run_trigger`, `run_date`; `team_data_alerts.seen_count`, `last_run_id`.
- One CHECK (`ck_team_data_alert_type`) is **widened** to three new types. Every existing row satisfies it.

**Recovery:** roll the code back and the new tables / columns are simply unread. Do not drop them (training history, birthdays people entered and run records would be lost); forward-fix only. **Staging:** apply 727, run the pgtests below, open /tenant/team/members as Owner, Manager and Front Desk, set `TEAM_DATA_NIGHTLY_ENABLED=1` on a worker that runs `report` jobs, and confirm one `team_data_nightly_runs` row per salon after 02:00 salon time.

## 5. Tests actually run (this worktree, 30 Oct 2026)
| What | Result |
|---|---|
| `modules/workforce/src/team-staff/team-staff.pgtest.vitest.spec.ts` (new, 18 tests). **TM-06:** front desk 403 + audited denial; manager cannot add manager / owner-level custom role / owner / SUPER_ADMIN; manager adds a receptionist (invited login, branch access, profile job role, one invitation with hash only, no technician / role template / PIN data, audit row, page 1 of the directory as receptionist); idempotent retry (same member, no second delivery); reused key + other body 409; duplicate e-mail (login) and phone in another format (technician) 409 with existing id; branch scope 403 / 404; owner adds a manager; technician role → technician flow. **TM-08:** month/day validation incl. Feb 29 → Feb 28 in a non-leap year; not recorded only when absent; private hidden from front desk, visible to manager; audit without the date; share → visible; only manager / self edits; cross-tenant 404; clear. **TM-09:** not configured until a course exists; front desk 403; duplicate course 409; assign / duplicate 409 / start / stale 409 / cancel needs reason / complete; read-time expiry; sweep persists EXPIRED (idempotent); history order; append-only + no-delete triggers; re-assign after expiry; certification UNVERIFIED after completion, front desk and self cannot verify, verifier verifies; technician certificate goes to `technician_certifications`, not copied; cross-tenant 404. **TM-07:** nightly run finds orphaned appointment + orphaned role template + dangling branch with category / remediation / pointers, changes nothing (snapshot); same date → `already_done`; next date dedupes (count unchanged, `seenCount` 2, `lastRunId` moves, `lastSeenAt` ≥, reviewer's ASSIGNED kept, one DETECTED event); 3 failures recorded (`failed`, attempts, `SCAN_TIMEOUT`) → one escalation alert, a 4th failure does not duplicate it, a later success succeeds; bad payload permanent; scheduler enqueues one `report` job per salon not yet done and a second tick is a duplicate; manual Run Check still 403 for front desk | **18 / 18 PASS** |
| `team-data-alerts.pgtest` (round 1, after the scan refactor) | **5 / 5 PASS** |
| `team-members-screen.pgtest` (round 1, after the roster change) | **10 / 10 PASS** |
| Harness E2E `node tooling/catalog-one-screen/interact.mjs tm2b team` (all existing team steps plus 4 new ones: create receptionist → `?created`, page 1 as receptionist, no technician fields; birthday private for front desk; training course → assign → start → complete + certification "Awaiting verification" + real panel counts; new detector types + category / seen) | **37 / 37 PASS**. The final run reported one page error, "ApiError: not in the harness". The only unhandled routes in that run are pre-existing ones from other screens (booking drafts / state / technicians, technician profile routes, commission-report state, session activity), the same set as the earlier run that had no page error, so it is not from a TM-06…09 route. Two earlier runs failed for environment reasons: harness port 4396 in use by another agent, and Postgres restarted mid-run. Both were rerun. |
| Harness measure `measure.mjs tm2b-measure team-members` (1920×945 · 1536×729 · 1440×765 · 1366×633 × pilot/en · pilot/vi · empty/en) | **12 / 12 PASS**, no sideways scroll, 0 unhandled routes |
| `POSTeamScreen.test.tsx` (updated: receptionist onboarding with no technician fields + `?created` hand-off; technician uses the existing hire; Birthdays / Training panels read their endpoints) | **NOT RUN**: pos-web vitest cannot run here. esbuild syntax check OK; tsc shows no undefined names in the changed files. |
| Gates: list-queries, tenant-isolation, as-any, role-checks, validated-bodies, async-exports, audit-select-columns, impossible-predicate, unreached-routes, silent-catch, audit-writers, vi-glossary, inert-controls, dead-client-methods | **all PASS** |
| `check-pos-i18n` | **FAIL, not from this change**: `POSAiUsageScreen.tsx` +2 over baseline (`b.type` / `h.type`). I did not touch that file; it comes from the AI Usage build already in the base commit. |
| `run-gates.mjs` (full) | **Not run** (optional; the individual gates above were run) |

Gate runs used a temporary symlink to the main checkout's built `packages/{permissions,api-contracts}/dist`. It was removed before the commit.

## 6. Acceptance matrix (guide §18, my rows)
| ID | Deliverable | Status | Evidence / blocker |
|---|---|---|---|
| TM-06 | Non-technician staff creation | **Verified** (server + harness) · UI unit test **Implemented but Unverified** | pgtest TM-06 (receptionist / manager permission tests, duplicate, idempotent retry, no technician data); E2E receptionist → list. Technician / stylist go through the existing hire: its own duplicate check, but **no idempotency key** on that path (unchanged route). Real e-mail / SMS delivery of the invitation is **Blocked - External Setup** (no notifier / provider here; `not_connected` + link verified). |
| TM-07 | Scheduled accuracy checks | **Verified** (job handler, dedupe, last seen, failure + escalation, enqueue) · scheduler tick in a running worker **Implemented but Unverified** | pgtest TM-07; E2E types / category / seen. Running it nightly in staging (env + worker) is **Blocked - External Setup**. |
| TM-08 | Optional birthdays | **Verified** | pgtest TM-08 (privacy + month/day + Feb 29); E2E private birthday hidden from front desk |
| TM-09 | Training & certification | **Verified** | pgtest TM-09 (lifecycle, expiry, completion ≠ verified, link not copy); E2E training record |
| §17 "Newly created matching receptionist appears on Page 1 without technician-only fields or inflated privileges" | **Verified** for creation + page 1 (newest first) + `?created`; the **highlight** itself is TM-03 (other agent) | |
| §17 "Nightly data scan creates actionable deduplicated findings; optional birthday and verified training remain private and accurate" | **Verified** | |
| QA-01 / QA-02 / QA-04 (CI, staging, physical ASUS) | **Blocked - External Setup** | CI cannot run (no push); no staging; no device. Commands are in §7. |

## 7. Commands for CI / staging
```
psql … -f apps/api/db/migrations/727_team_onboarding_birthdays_training.sql      # twice: idempotent
FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/workforce/src/team-staff/team-staff.pgtest.vitest.spec.ts
… modules/workforce/src/team-screens/team-data-alerts.pgtest.vitest.spec.ts · team-members-screen.pgtest.vitest.spec.ts
(cd apps/pos-web && npx vitest run src/screens/POSTeamScreen.test.tsx)
node tooling/checkout-one-screen/build.mjs && node tooling/catalog-one-screen/interact.mjs <label> team && node tooling/catalog-one-screen/measure.mjs <label> team-members
```

## 8. Residual risks / owner actions
- **The invitation e-mail / SMS body is technician-worded** (`inviteEmail` / `inviteSmsBody` in `modules/identity/src/invitations/invitation-delivery.service.ts`: "join … as a technician"). This affects the existing staff invite too. Reword it to be role-neutral before enabling real delivery. The text is English (customer / staff outbound), untouched here.
- The technician / stylist path has no idempotency key (the existing `POST /pos/technicians`). A double-click can still be caught by that route's duplicate checks, but not by a request key.
- Role inference: a custom role created here records `job_role = 'custom'` and falls back to the round-1 inference; label-based role tabs are unchanged.
- Self-service birthday: there is no separate "my profile" screen; a member edits their own birthday from the Team profile when they can open it.
- `MISSING_BRANCH_ASSOCIATION` ("no branch at all") runs only in the nightly / whole-salon context (a branch-scoped manual Run Check skips it, to avoid flagging salon-wide staff from a branch view).
- Review the Vietnamese (A53 in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`).
- `apps/api/security/role-matrix.snapshot.json` was not regenerated (not a gate run here).

## 9. Files
- **New:**
  - `apps/api/db/migrations/727_team_onboarding_birthdays_training.sql`
  - `modules/workforce/src/team-staff/`:
    - `member-ref.ts`
    - `team-staff.schemas.ts`
    - `team-onboarding.{repository,controller}.ts`
    - `team-birthdays.{repository,controller}.ts`
    - `team-training.{repository,controller}.ts`
    - `team-data-nightly.ts`
    - `team-staff.module.ts`
    - `team-staff.pgtest.vitest.spec.ts`
  - `apps/pos-web/src/api/posTeamStaffApi.ts`
  - `apps/pos-web/src/screens/teamStaffParts.tsx`
  - `apps/pos-web/src/i18n/ns/teamstaff.{en,vi}.ts` (201 keys)
  - this document
  - harness evidence `tooling/catalog-one-screen/results/{tm2b,tm2b-measure}/`
- **Changed:**
  - `modules/workforce/src/team-screens/team-data-alerts.repository.ts`
  - `team-screens/team-members-screen.repository.ts` (roster job role; training / birthday flags)
  - `modules/workforce/src/index.ts`
  - `apps/api/src/app.module.ts`
  - `apps/pos-web/src/screens/POSTeamScreen{,.test}.tsx`
  - `apps/pos-web/src/screens/teamMembersParts.tsx`
  - `apps/pos-web/src/i18n/ns/index.ts`
  - `apps/pos-web/src/styles.css` (`.tms-*`)
  - `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (A53)
  - `apps/api/openapi/manifest.txt`
  - `docs/security/{SECURITY_ATTACK_SURFACE.md,attack-surface-routes.csv}`
  - `tooling/catalog-one-screen/{team-extra,interact-team}.mjs`
