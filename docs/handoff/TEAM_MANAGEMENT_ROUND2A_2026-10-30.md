# Team Management round 2A: TM-01 to TM-05 handoff (30 Oct 2026)

Scope: the Four-Module Completion Guide §8.1–§8.3 and §9.1–§9.2 (acceptance rows TM-01 to TM-05) on **/tenant/team/members**.
This extends the Team Management build (`TEAM_MANAGEMENT_2026-10-30.md`, migration 722). TM-06 to TM-09 (non-technician creation,
nightly checks, birthdays, training) belong to a parallel agent and are not touched here. **No migration** was needed (726 is
unused): the customer-lookup indexes already exist (`pos_tech_appointments (tenant_id, customer_id, appt_date)`,
`tickets (tenant_id, customer_id, status)`). Local commit only. Nothing was pushed or deployed, and no provider was called.

## 1. Audit (before this round)
- The directory already searched staff by appointment id and ticket number, but it had **no customer → staff resolution**.
- The page size was fixed (6 or 10 rows, depending on window height). There was **no URL state**: refresh, Back and Forward all lost the filters and the page.
- "+ Add Team Member" opened the Technicians screen with **no way back to the team list**. The technician create had **no idempotency**, so a retry made a second row (unless the phone or e-mail matched).
- Find Qualified & Available Staff used the booking engine's openings and availability. It had **no preferred-technician input**.
- The screen was **not subscribed** to the realtime stream. It refreshed only on its own actions or on Refresh.
- The infrastructure we reused is unchanged: the shared SSE client (`@aipowersalon/realtime-client`, `useRealtime`), the event→screen
  registry (`@aipowersalon/realtime-contracts`), the `@Idempotent()` interceptor (`@aipowersalon/database/nest`) and the booking
  engine's pure schedule rules (`effectiveDaySchedule`, `pbTechDayWindows`, `pbTimeOffToBlock` from `@aipowersalon/booking`).

## 2. What was built

### TM-01 Customer-linked staff search: `GET /pos/team-members-screen/customer-links` (ListQuery)
- In **Customer** mode (a Staff | Customer switch beside the search box), the user types a customer name (2 letters or more) or a phone number in any format (7 digits or more).
  The search finds this salon's customers and then their links:
  - appointments (`pos_tech_appointments.technician_id`), excluding cancelled and no-show
  - completed service lines (`ticket_service_lines.technician_id`)
  - `tickets.primary_technician_id` / `helper_technician_id` on completed tickets (paid or service-done, not removed, not voided)

  The links resolve to current staff members. Every technician on a shared ticket is returned.
- Each result shows **why** it matched. There is one line per record (a ticket where she was primary *and* had a line shows once with both roles).
  The line carries the ticket number or appointment id, the date and time, the services and an "Upcoming" chip.
- **Privacy:** the search requires `customers.view` (403 `CUSTOMER_SEARCH_FORBIDDEN` otherwise). The customer phone is **always masked** (`••• 9901`).
  The full number never leaves the server, and notes are never read. The search text is never put in the URL.
- **Tenant:** a literal `tenant_id` predicate on every table. Tenant B's identical customer (same name and phone) never resolves.
- Ordering is by the latest linked date, then member id. Pages are served by the server and clamp at the last page.

### TM-02 Page size 10/20/50 and URL state: `teamUrlCore.ts` + `teamUrlState.ts` (useSearchParams)
- These values live in the URL: `tab · role · status · shift · dept · account · extra · sort · basis · preset/from/to · page · size · mode`.
  Defaults are left out, and every value is read through an allowlist. A bad page becomes 1, a page past the end is clamped by the server and
  written back with `replace`, and a bad size becomes 10.
- Any filter, size, mode or period change returns to page 1. A page change keeps the filters. Back, Forward and refresh restore the state.
- **Decision (search text):** the search text is **never** written to the URL. In Customer mode it is a customer's name or phone (PII), and
  in Staff mode it can be a staff phone or e-mail. While a search is typed, its page lives in memory only.
- The server already did page, count and sort. `directory` now also returns `asOf`, which is taken before the reads.

### TM-03 New staff → page 1
- The mechanism is generic. `teamCreatedPath(memberId, back?)` builds the return path `/tenant/team/members?<the list's own filters>&created=<id>`, with page and sort reset to the defaults.
  `teamAddPath()` carries the list's filters to the creation screen. Any creation flow can use these, including the parallel agent's TM-06 flow.
- "+ Add Team Member" opens `/technicians?new=1&returnTo=team&back=…` with the create form already open. A successful create
  returns with `?created=`. Linking an existing profile is an invitation, so it stays on Technicians.
- On return, the list shows page 1 with the default sort `created_at DESC, member id DESC`, and the new row is highlighted (`tr.tm2-new`, `data-new`).
  If the current filters hide the new person, a note offers **View new employee** (opens the profile) and **Clear filters**. The filter is never widened silently.
  `created` stays in the URL, so a refresh still shows it, until the note is dismissed.
- **No duplicate on retry:** `POST /pos/technicians` now carries `@Idempotent()`. The POS sends one `Idempotency-Key` per create intent. The key is
  rotated after a success and kept after a failure, so a real retry replays the first answer. To send the header, `api.post` gained an optional `headers` argument.

### TM-04 Preferred technician: `GET /pos/team-members-screen/preferred-check` (+ `preferred-staff.ts`, pure)
- There is an optional **Preferred technician** picker in Find Qualified & Available Staff. For the chosen services, date and start (or her earliest valid
  start), the server checks, in this order:
  - active
  - branch
  - service mapping
  - not in the past
  - shift (one-date override, then weekly template, using the engine's `effectiveDaySchedule`)
  - the full duration inside the shift
  - breaks / lunch
  - approved time off
  - blocked time
  - chair-holding appointments, with the appointment id and times

  Every failed check is named.
- It also returns up to five **qualified alternatives**: current technicians in the branch, mapped to every service, that pass the same checks at the same start
  (or at their earliest valid start). They are ordered by exact start first, then earliest start, then name.
- The screen also asks the **booking engine** (`/pos/booking/availability?technicianId=`). The preferred technician is shown first **only when both agree**.
  Otherwise the card says why, and if the engine does not offer the start it says "The booking engine does not offer this start".
  An alternative that the engine does not offer is dropped. An invalid preferred technician is also removed from the ranked table.
- Nothing is booked or held, and the turn queue is never read or moved. Open Booking hands over to the existing booking flow, which re-checks before it saves.

### TM-05 Live updates: `teamLive.tsx` (+ `teamLiveCore.ts`)
- The screen subscribes through `useRealtime` to the existing screens:

  | Screen | Events it covers |
  |---|---|
  | `technicians` | profile, membership, clock, status (break), schedule events |
  | `team-permissions` | role / authorization changes |
  | `time-clock` | clock-in / out |
  | `live-schedule` | status changes |
  | `tech-schedule` | one-date shift overrides |
  | `serving` | service started / done |
  | `approvals` | `approval_updated` |

  No new event names were added and no registry change was made.
- An event becomes one coalesced refresh of the dashboard, directory and alert count. Filters, sort, page, search box and an open overlay are untouched,
  because the refresh only bumps a counter in the loads' dependencies.
- **Stale guards:**
  - The shared client drops a duplicate `eventId` and a strictly older aggregate `resourceVersion`.
  - An event never carries data that gets painted on screen.
  - `useLoad` applies only the latest request.
  - `useNewest` never lets an answer with an older `asOf` replace a newer one.
  - The clamp effect acts only on the answer for the current request (`reqKey`).
- **Fallback and indicator:**
  - While the stream is connected, a 60-second safety sync runs. While it is not connected, the screen polls every **30 seconds**.
  - The client reconciles with an immediate refresh after a real gap.
  - The indicator reads **Live** only while the stream is `CONNECTED`. It reads **Reconnecting…** on a first retry, and **Polling every 30 s** once a fallback poll has run or the stream is `OFFLINE` / `DEGRADED`.

### Frontend files, i18n, CSS
- Files: `POSTeamScreen.tsx` (surgical: URL state, live, mode switch, page-size select, created note and highlight), `teamMembersParts.tsx`
  (finder: 5 lines), new `teamUrlCore.ts`, `teamUrlState.ts`, `teamLive.tsx`, `teamLiveCore.ts`, `teamCustomerSearch.tsx` and `teamPreferredParts.tsx`;
  `POSTechniciansScreen.tsx` (`?new=1&returnTo=team`, idempotency key).
- Strings: 56 EN + VI keys in `ns/teamround2a.*` (prefix `tm2.`), with a VI review section **A52** in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`.
- CSS: a commented `.tm2-*` block with 44 px targets and 13 px text.

## 3. API routes
New: `GET /pos/team-members-screen/customer-links` and `GET /pos/team-members-screen/preferred-check` (TenantAuthGuard + RolePermissionGuard,
`pos.technicians.view`; customer-links re-checks `customers.view`). `preferred-check` is in the list-queries allowlist as `not-a-list`.
Changed: `POST /pos/technicians` is now `@Idempotent()` (the key is optional). `GET /pos/team-members-screen/directory` returns `asOf`.
`apps/api/openapi/manifest.txt` and `docs/security/{SECURITY_ATTACK_SURFACE.md,attack-surface-routes.csv}` were regenerated.

## 4. Tests actually run (this worktree, 30 Oct 2026)
| What | Result |
|---|---|
| `team-members-lookup.pgtest` (new): customer phone ×3 formats + name → all 3 technicians of the multi-technician paid ticket (lines + primary + helper) + the booked one, a voided ticket and a cancelled appointment link nobody, one reason line per record with both roles, masked phone, tenant B's twin customer never resolves (both directions), 403 without customers.view, 422 too short, server paging + clamp · preferred: overlap → invalid with the appointment ref + alternatives in the right order (exact start, then the override's later start; never the unmapped tech), break / duration / time off / mapping / date-override shift each named, valid preferred first, earliest start without a time, cross-tenant 404, other salon's service 422, nothing booked | **6 / 6 PASS** |
| `team-members-screen.pgtest` (existing, after `asOf`) | **10 / 10 PASS** |
| `teamRound2Core.vitest.spec` (new, pure: URL allowlists / round-trip / no search in URL / page reset / creation return path / Live only when CONNECTED / stale guard) | **6 / 6 PASS** |
| `POSTeamScreenRound2.test.tsx` (new screen test with a fake stream: URL restore + page reset + no PII in URL, Customer mode, `?created` highlight + hidden → View / Clear, event refresh keeps filters / page, indicator Live / Reconnecting / Polling, unrelated event ignored) | **NOT RUN** (pos-web vitest cannot run here). The esbuild syntax check is OK, and tsc found no undefined names in the changed files |
| Harness E2E `interact.mjs tm2a team`: the 33 existing team steps + 5 new (TM-01 phone ×3 + name / no PII in URL; TM-02 10/20/50, filter → page 1, Back / Forward / refresh, page=999 clamps, invalid values dropped; TM-03 Add → create → return with filters → hidden note → View / Clear → page 1 highlighted, same Idempotency-Key twice → 1 row; TM-04 preferred 11:15 overlap → named + alternatives, 10:00 → preferred first, Open Booking with nothing booked; TM-05 harness-emitted event → On Break in place with the overlay open and size / search kept, stale rv ignored, stream down → Reconnecting → Polling (never Live), stream back → Live + reconcile refetch) | **38 / 38 PASS** (see §6 for the page-error note) |
| Harness measure `team-members` (1920×945 · 1536×729 · 1440×765 · 1366×633 × pilot/en · pilot/vi · empty/en) | **12 / 12 PASS** (after one fix, below): no sideways scroll, every module (incl. live indicator, Staff / Customer switch, per-page select) painted, pager reachable, 0 unhandled routes |
| Gates: list-queries, tenant-isolation, as-any, role-checks, validated-bodies, async-exports, audit-select-columns, impossible-predicate, unreached-routes, silent-catch, audit-writers, vi-glossary, inert-controls, dead-client-methods | **PASS** |
| `check-pos-i18n` | my files are clean. It fails only on `POSAiUsageScreen.tsx :277/:279`, which I did not modify (from the base commit) |

Harness notes (honest):
- `POST /pos/technicians` in the harness is a **fixture** (`team-extra.mjs harnessTechnicianCreate`) that inserts with raw SQL and honours the Idempotency-Key the way the interceptor does.
  The real `TechniciansService.create` needs the Kysely query builder, which the stand-in lacks. The real `@Idempotent()` store is covered by its existing pgtest, not re-run here.
- The booking engine's openings and availability are **stubbed** in the TM-04 step. The preferred and alternative checks are the real SQL.
- The live server has a **test-only** realtime control `/__rt` (`emit`, `down`, `exec` fixtures).
- Gate and harness runs used temporary symlinks to the main checkout's built `packages/{permissions,api-contracts}/dist`. They are not committed.

## 5. Acceptance (Guide §18)
| ID | Status | Evidence / blocker |
|---|---|---|
| TM-01 Customer-linked staff search | **Verified** (pgtest + harness E2E) | staging run with real customers: **Blocked - External Setup** |
| TM-02 Page sizes + URL state | **Verified** (harness Back / Forward / refresh + pure spec) | screen test written but not run |
| TM-03 New staff → page 1 | **Verified** for the round trip and highlight in the harness. The real create's idempotency is **Implemented but Unverified** here (harness fixture; the interceptor is the existing, tested one) | the TM-06 non-technician flow should navigate with `teamCreatedPath(id, back)` |
| TM-04 Preferred technician | **Verified** (pgtest: conflict → alternatives; harness UI). The real booking engine cross-check is **Implemented but Unverified** (stubbed in the harness) | staging: run against the real engine |
| TM-05 Live updates | **Verified** in the harness (emit / stale / down / reconnect) | real API event emission per action is **Implemented but Unverified** (see §7) |

## 6. Measure and page-error notes
The team E2E reported one page error: `ApiError: not in the harness`, from `posHttp`. The unhandled-route list points at the Booking screen's
unstubbed routes (`/pos/booking/state`, `/technicians`, `/drafts`), which load after an Open Booking hand-off. That hand-off happens both in the
existing Find-Available step and in the TM-04 step. I have not proven whether this error already existed before this round.
`interact.mjs` now records the URL with each page error so that the next run says where it happened.

Measure `team-members`:
- The first attempt collided with another agent's harness on port 4397 (EADDRINUSE), so it measured a foreign bundle and is not counted.
- A later attempt hit a Postgres outage.
- The valid run found **pilot/vi 1366×633: header 21 px wider than the page, + Add Team Member outside**, caused by the new live indicator.
  Fix: below 1400 px the indicator keeps its coloured dot and puts its words in the tooltip. Screen readers still read the words.
- The re-run is **12 / 12 PASS**, and the team E2E re-run on the same bundle is **38 / 38 PASS**.
- The page-error line from the E2E came through the console-error path (it carries no URL), so where it happened is still unknown.

## 7. Residual risks / owner actions
- **Event coverage:**
  - The technician create (`TechniciansService.create`) and non-technician user creation emit **no** realtime event today. A new
    employee therefore appears on other open screens through the 60 s safety sync or the 30 s fallback, not instantly. The creator's own screen uses `?created`.
  - Role changes use `authorization_changed` (screen `team-permissions`), and approvals use `approval_updated`.
  - Adding the team screen to more events would be a registry change, which needs the parity test.
- **Customer search scope:** customers are matched tenant-wide, and their links are filtered to the session branch (plus branch-less records). Only **current**
  staff are returned; archived staff who served the customer are not listed.
- **Preferred check vs engine:** the server check mirrors the engine's schedule rules but not store hours, buffer or holds. Those come from the
  engine's slot list on the screen, and Booking re-checks on save.
- **Review the Vietnamese** in A52 (in particular "Thợ chính / Thợ phụ" and "Tự làm mới mỗi {s} giây").
- Run `POSTeamScreenRound2.test.tsx` and `POSTeamScreen.test.tsx` where pos-web vitest runs.
- Staging: no migration is needed. Open /tenant/team/members as Owner, Manager and Front Desk, and try Customer mode, the URL state, Add → return, a preferred technician and the live indicator.

## 8. Files
New: `modules/workforce/src/team-screens/{preferred-staff.ts, team-members-lookup.repository.ts, team-members-lookup.controller.ts, team-members-lookup.pgtest.vitest.spec.ts}`,
`apps/pos-web/src/screens/{teamUrlCore.ts, teamUrlState.ts, teamLive.tsx, teamLiveCore.ts, teamCustomerSearch.tsx, teamPreferredParts.tsx, teamRound2Core.vitest.spec.ts, POSTeamScreenRound2.test.tsx}`,
`apps/pos-web/src/i18n/ns/teamround2a.{en,vi}.ts`, this document.
Changed: `modules/workforce/src/team-screens/{team-members-screen.repository.ts (asOf), team-screens.module.ts}`, `modules/workforce/src/technicians/technicians.controller.ts` (`@Idempotent`),
`apps/pos-web/src/screens/{POSTeamScreen.tsx, teamMembersParts.tsx, POSTechniciansScreen.tsx}`, `apps/pos-web/src/api/{client.ts, posTeamScreensApi.ts, posTechniciansApi.ts}`,
`apps/pos-web/src/i18n/ns/index.ts`, `apps/pos-web/src/styles.css`, `apps/api/scripts/list-queries.allowlist.json`, `apps/api/openapi/manifest.txt`,
`docs/security/{SECURITY_ATTACK_SURFACE.md, attack-surface-routes.csv}`, `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`,
`tooling/catalog-one-screen/{team-extra.mjs, interact-team.mjs, interact.mjs, live-server.mjs, pages.mjs}`.
