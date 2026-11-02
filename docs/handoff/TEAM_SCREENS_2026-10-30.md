# Team screens rebuild — Oct 30 2026

Six Front Desk POS screens were rebuilt from the owner's build guides, plus the Services & Products guide, which matched the one already built (e7468d94). Every module in the photos is kept. The changes are committed locally, one commit per screen. **Nothing has been pushed** (K-12 steps 1–5 still gate GitHub).

| Screen | Route | Commit | New read model (read only) |
|---|---|---|---|
| Technicians | `/technicians` | 4299484a | `pos/technicians-screen/*` |
| Tech Appointments | `/tech-appointments` | 541ddef4 | `pos/tech-appointments-screen/*` |
| Live Technician Schedule | `/technicians/schedule` | d57d9cfc | `pos/live-schedule-screen/*` |
| Tech Queue | `/tech-queue` | 1ad0a0cf | `pos/tech-queue-screen/*` |
| Commission Report | `/tenant/reports/commission` | bd1ec263 | `pos/commission-screen/*` |
| Team Performance | `/tenant/team/performance` | (this commit) | `pos/team-performance-screen/*` |

## Architecture

- **The new read models live in `modules/workforce/src/team-screens/`.** Each is a raw parameterised SQL repository (Kysely `sql`, no `sql.raw` or `sql.ref`). Each has a controller and a `*.pgtest.vitest.spec.ts` that runs against the real migrated schema. They share `screen-kit.ts` (salon period, paging, phone search, masking).
- **No parallel ledger or table was added.** Every figure comes from the canonical tables:
  - pos_tech_appointments
  - technician_shifts, technician_schedules, technician_time_off, technician_blocked_times, technician_breaks
  - technician_workforce_state
  - pos_tech_queue_tickets, pos_queue_status_history
  - ticket_compensation_snapshots, compensation_adjustments, ticket_tip_allocations
  - payroll_payouts, payroll_lines, payroll_periods
  - reviews, ticket_service_lines, tickets
- **Every write is still the existing endpoint, and each one re-validates.** That covers:
  - appointment check-in, no-show, start, assign, reschedule and cancel
  - break start and end, block time, open-slot booking
  - `PATCH /pos/technicians/:id/schedule` (with expectedVersion)
  - the tech-queue actions, assign and auto balance
  - service mapping
- **Tenant isolation:** each statement has a literal `tenant_id = $T` (the `tenant-isolation-check` gate passes), and branch scoping comes from the session.
- **One backend change outside the read models:** `GET /pos/technicians/:id/live-detail` now returns `null` for salesToday, tipsToday and commissionPreview when the caller has neither `technicians.view_pay` nor `payroll.view`. Before, the screen only hid them. The core spec covers this (60/60).

## Per-screen notes, and definitions that changed

- **Live Technician Schedule**
  - The six KPIs carry written definitions. Working Today counts planned shifts, and clocked-in is shown separately.
  - Available Now, In Service and On Break show only for today; a past day shows "—".
  - Utilization is booked minutes ÷ scheduled minutes. It reads N/A when nothing is scheduled.
  - Weekly hours: the screen lists the booked appointments the new hours would affect *before* saving, and asks for an acknowledgement. Nothing is moved.
  - The old "Edit shift" saved a *block time* with the shift text as its reason. That is gone.
- **Tech Queue**
  - Live Queue | History is a real switch.
  - Live order is first assigned, first served. History is newest first.
  - Wait time stops at the terminal event, so an expired ticket shows how long it waited.
  - Service Done today and Checkout pending have their own tabs, so they never inflate the live count.
- **Commission Report**
  - It uses the same formula as `/pos/commission-report/state`, and cross-checks against it for the same days ("Matches the payroll commission calculation").
  - Payout is labelled an *obligation*. "Paid" comes only from `payroll_payouts`.
  - The old footer said tips go to the ticket's primary technician. The code actually uses allocated shares, so the note now says that.
- **Team Performance**
  - The photo's "5% / 5%" was a 5.0 / 5 average review rating with a "%" appended. The ratings are unchanged and now read "x.x / 5" with their sample.
  - Hidden and spam reviews are excluded. The old `/pos/team/state` excluded hidden reviews but not spam.
  - No reviews means Unrated, never Needs Improvement.
  - The ranking puts technicians with ≥ 3 reviews first.

## Verification (what was actually run)

- **pgtests** (real schema, PGlite): technicians 6/6, tech appointments 5/5, live schedule 5/5, tech queue 5/5, commission 5/5, team performance 4/4.
- **Live-schedule core spec:** 60/60.
- **Harness E2E** (`node tooling/catalog-one-screen/interact.mjs <label> team`): 19/19 steps over the six screens.
- **Measure** at 1920×945, 1536×729, 1440×765 and 1366×633, for EN, VI and an empty tenant: PASS on every screen, with no page-level sideways scroll, no target under 44px, and no data font under 13px.
- **Gates:** tenant-isolation, list-queries, as-any ratchet, pos-i18n, dead-client, unreached-routes, openapi manifest and attack-surface.
- **Unit tests** (vitest) were rewritten or added for every screen. **They were not run here**, because vitest cannot run in this environment. They were syntax-checked with esbuild, and a TypeScript pass found no undefined names. Run them in CI before merging.

## Harness-only shortcuts (said so in `team-extra.mjs`)

- The test database's Kysely stand-in has no query builder. So the existing builder-based controllers run on their **in-memory adapters** in the harness: Tech Appointments state, Live Technician Schedule, and the Tech Queue board.
- The Live Schedule and Tech Queue boards in the harness show the in-memory demo team (Mia, Ava, Leo, Zoe), not the seeded photo team. The new read models run on the real SQL with the photo team.

## Not built, needs a decision

- **Commission Discrepancy Review:** the findings are read only. Assign Review, Mark Investigating and Resolve need a review-state table (a migration). The rate-vs-configuration and refund-reversal checks are also not built yet. The screen says so.
- **Commission and Team Performance exports** are client-side CSV of the current filter. They are not audit-logged.
- **Live Schedule weekly hours** edits the weekly schedule. Per-date published shifts (technician_shifts) still have no POS editor.
- **Team Performance** has no versioned composite score model. Its score is the verified rating, and a new model needs owner approval (guide §6).
