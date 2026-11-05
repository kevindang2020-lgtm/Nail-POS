# Bug-prevention fix — removed phantom `appointments` table type (2026-07-06)

## The class of bug
Earlier, 7 queries targeted a table named `appointments` that does NOT exist in the schema
(the real table is `pos_tech_appointments`). They compiled — and failed silently at runtime
(fail-soft to []/0) — because `kysely.types.ts` contained a **phantom `AppointmentsTable`
type** with columns that also don't exist (`cancelled_at`, `no_show_at`,
`rescheduled_from_appointment_id`). The queries were fixed previously; this removes the root cause.

## Systematic scan (this pass)
- Cross-checked every table referenced in code (177 distinct) against the real schema (448 tables):
  **0 missing** — no other query targets a non-existent table.
- Verified the `cancelled_at` / `no_show_at` references elsewhere are legitimate (other tables
  that genuinely have those columns).

## Fix
- Removed `interface AppointmentsTable { ... }` from `apps/api/src/database/kysely.types.ts`.
- Removed `appointments: AppointmentsTable;` from the `DB` interface (and a duplicate line it
  briefly created).
- Effect: any future `selectFrom('appointments')` is now a **compile error**, so this class of
  silent-failure bug cannot recur.

## Verification
- Standalone `AppointmentsTable` fully removed; only `PosTechAppointmentsTable` remains.
- tsc 0 (proves nothing still referenced the phantom table) · build clean · **api 3013/3013**.
