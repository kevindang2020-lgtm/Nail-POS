# Bug fix — Overview board sections were permanently empty (2026-07-06)

## Discovered via runtime body-shape E2E
Booted the real API against seeded Postgres and inspected `/pos/overview/board` response
bodies (not just status codes). All four live sections returned `[]` regardless of data.

## Root cause — every section queried dead tables/columns, hidden by `catch { return [] }`
`apps/api/src/overview/overview-board.service.ts`:
| Section | Broken reference | Real source |
|---|---|---|
| readyForAssignment | `service_name`, `requested_technician_name`, `technician_id` (don't exist on pos_queue_items) | `requested_services` jsonb, join technicians on `requested_technician_id`, `assigned_technician_id` |
| readyForCheckout | `tickets.customer_name` (doesn't exist) | join `customers` on `customer_id` for `full_name` |
| arrivals | table `pos_check_ins` (**doesn't exist**) | `pos_queue_items` (the real check-in feed) |
| liveTechQueue | table `service_sessions` (**doesn't exist**), `technicians.display_name` | `pos_queue_items` where `status='in_service'`, join technicians `full_name` |

Because each query threw and was swallowed by `catch { return []; }`, the Overview board's
Arrivals, Live Tech Queue, Ready-for-Assignment, and Ready-for-Checkout sections were
**always empty**. The frontend masked it by falling back to its schedulePreview projection.

Also corrected invalid status literals to the real `pos_queue_items` check-constraint values
(`waiting, called, assigned, ready_for_tech, moved_to_tech_queue, in_service, cancelled, removed`).

## Verification (live, real Postgres, through the auth guards)
Seeded a waiting guest, an in_service guest with a technician, and a ready-to-pay ticket, then
hit `/pos/overview/board`:
- arrivals ✓  liveTechQueue ✓ (Anna Tech / Pedicure)  readyForAssignment ✓  readyForCheckout ✓ ($65.00)
- **BOARD_OK — all 4 sections populate.**
- tsc 0 · build clean · lint clean · **api 3013/3013** (no regression).

## Why static scans missed it
These queries are raw `sql\`\`` templates, not Kysely `.select()/.where()` calls, so the
column/table static scan didn't parse them. Runtime body inspection caught it — which is why
this pass was worth running.

## Follow-up (raw-SQL scan across the whole codebase)
Scanned every raw `sql\`\`` template for `FROM`/`JOIN`/`UPDATE`/`INTO <table>` and cross-checked
against the 448 real tables. Found and fixed 5 more silent-failure queries against non-existent tables:

| File | Query | Fix |
|---|---|---|
| overview-board.service.ts | reminders `FROM appointment_reminders` (no such table) | `appointment_reminder_attempts` JOIN `pos_tech_appointments` |
| super-admin-overview/overview.kysely.repository.ts | totalAppointments `from appointments` | `from pos_tech_appointments` |
| super-admin-platform.repository.ts | today-by-branch `from appointments where start_time…` | `pos_tech_appointments where appt_date = current_date` |
| super-admin-platform.repository.ts | upcoming-14-days `from appointments where start_time…` | `pos_tech_appointments where appt_date …` |
| super-admin-platform.repository.ts | monthly counts `from appointments … start_time` | `pos_tech_appointments … appt_date` |

Effect: the Super Admin overview's "total appointments" KPI, the platform dashboard's per-branch
appointment counts and 6-month appointment trend, and the Overview board's reminders section were all
silently returning 0/[]. All now verified returning correct data on real Postgres.
- tsc 0 · build clean · lint clean · **api 3013/3013**.

## Column-level raw-SQL validation (final pass)
Extended the scanner to parse each `sql\`\`` block's FROM/JOIN aliases and validate every
`alias.column` reference against that table's real columns. Found + fixed 3 more silent bugs:

| File | Bug | Fix |
|---|---|---|
| super-admin-overview | `t.name` from `tenants` (no such column) | `t.display_name` |
| super-admin-platform | `t.plan` from `tenants` (no such column) | subquery from `tenant_subscriptions.plan` |
| super-admin-platform | `tsl.amount_cents` from `ticket_service_lines` (no such column) — + 3 unqualified `sum(amount_cents)` on the same table | `line_total_cents` (4 revenue queries: branch MTD, by-city, monthly trend, today) |

Effect: the platform dashboard's per-tenant plan column, per-city revenue, branch MTD revenue,
monthly revenue trend, and today's revenue from ticket_service_lines were all silently 0/empty.
Re-ran the validator: **0 qualified-column mismatches remain.**
- tsc 0 · build clean · lint clean · **api 3013/3013**.

## Bug-hunt arc — final state
Table class (Kysely + raw SQL) and column class (Kysely + raw SQL qualified refs) are both swept
against the live 448-table / 5,758-column schema. Every non-existent table/column reference found
across the codebase has been fixed and verified on real Postgres; the phantom `appointments` type
is removed so the Kysely path can't regress.
