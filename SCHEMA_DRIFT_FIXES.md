# SCHEMA DRIFT — found and fixed (2026-07-13)

I generalised the technique that caught my own `ON CONFLICT` bug: **`PREPARE` every raw SQL statement in the API
against a real Postgres.**

`PREPARE` resolves every table, every column, and every conflict target — **without running the query or touching
a row.** It is the only thing that catches this class of bug, because a mocked repository sees none of it.

```
npm run check:sql --workspace @aipowersalon/api
```

**1,767 statements checked. 5 real schema errors found. All 5 fixed. Now 0.**

---

## 1. The All Salons dashboard was STILL broken. My earlier fix was incomplete.

```
owner-portfolio.repository.ts → loadTotals()
  relation "appointments" does not exist
```

I fixed `queue_entries` → `pos_queue_items` earlier and reported the dashboard repaired. **It was not.** The *same
query* had a **second** dead table in it: `appointments` was **DROPPED in migration 041**.

And migration 041 says why, in its own words:

> *"superseded by `pos_tech_appointments`… **A full-repo audit confirmed these two tables have ZERO remaining
> readers or writers.**"*

**That audit was wrong** — or a reader was added after it. Four files still read the dropped table.

The column shape differs too: `pos_tech_appointments` stores `appt_date DATE` + `start_time TEXT`, not a
`starts_at` timestamp. **A blind table rename would have compiled and still failed.**

Fixed in both the today and yesterday queries.

## 2. Branch transfer said "0 appointments affected". On a destructive operation.

```
super-admin-platform.repository.ts → branchAttachmentCounts()
  select count(*) from appointments where branch_id = $1     -- dropped table
```

This is the **impact analysis** shown before a Super Admin moves a branch: *how many appointments will this
affect?* The query threw, `one()` caught it to `0`, and the answer was always **zero** — for a branch that could
have thousands.

A fail-soft default is right for a sidebar badge. On the impact preview for an **irreversible** operation it is a
way to **authorise the wrong thing with confidence.**

## 3. Appointment reminders were not going out at all.

```
reminders.kysely.repository.ts → tenantMeta()
  SELECT (value::jsonb ->> 'timezone') ... FROM tenant_settings
  column "value" does not exist
```

`tenant_settings` has `settings_json`, not `value`. And unlike most reads in this codebase, this one has **no
`.catch()`** — so `tenantMeta()` rejected, and the whole reminder send failed.

Reminders were not going out *late*. They were **not going out**.

## 4. Menu Insights reported a 100% margin on every service.

```
menu-insights.kysely.repository.ts
  column p.average_cost_cents does not exist
```

`average_cost_cents` is not on `inventory_products` — it lives on `inventory_location_stock`. The query threw,
`.catch(() => [])` swallowed it, and the service **cost was always 0**.

**A profitability screen that cannot be wrong is not a profitability screen.** Now joined from the table that
actually has the column (averaged across the product's stock rows, with the product's own `cost_cents` preferred).

## 5. Super Admin's AI allowance figure has never rendered.

```
ai-usage-config.kysely.repository.ts
  column "used" does not exist        -- tenant_usage_limits has `used_value`
```

The `catch` around it said: `/* schema may differ → leave null */`. **It was a guess, and it was right** — so
`allowanceUsedPct` has always been `null`. The catch stays (returning null beats inventing a percentage) but it
now has nothing to swallow.

## 6. One missing column (migration 369)

`ai_report_narratives` has `UNIQUE (run_id)` but no `updated_at` — while the repository runs
`ON CONFLICT (run_id) DO UPDATE SET updated_at = now()`. No `.catch()`, so the narrative insert threw every time.

Added the column rather than gutting the upsert, because **the upsert is right**: a conflict there means a report
narrative is being *regenerated*, and "when was this last regenerated" is exactly what you want recorded.

---

## The pattern in all six

Every one of them is invisible to the test suite, and five of the six **fail silently**:

| | how it hid |
|---|---|
| All Salons dashboard | 500 — loud, but every test mocks the repo |
| Branch transfer count | `.catch(() => 0)` → "0 appointments" |
| Menu Insights cost | `.catch(() => [])` → cost 0 → 100% margin |
| AI allowance % | `catch { /* schema may differ */ }` → null |
| Reminders | no catch → the whole job failed |
| Narrative insert | no catch → threw every time |

`.catch(() => 0)` is correct for a badge that must not break a page. It is **poison** on a number someone makes a
decision from — and the codebase does not currently distinguish the two.

---

## Verification

| | |
|---|---|
| `npm run check:sql` | **1,767 statements · 0 schema errors** |
| migration chain from empty | **369/370** (the one failure needs `pg_trgm`, absent in PGlite) |
| `tsc --noEmit` | **0 errors** |
| owner-portfolio · reminders · menu-insights · super-admin-ai-usage · customer-booking | **258/258** |

## Files changed (6)

```
apps/api/db/migrations/369_schema_drift_fixes.sql            NEW — ai_report_narratives.updated_at
apps/api/scripts/sql-prepare-check.mjs                       NEW — the checker (npm run check:sql)
apps/api/src/owner-portfolio/owner-portfolio.repository.ts   appointments → pos_tech_appointments (×2)
apps/api/src/super-admin-platform/super-admin-platform.repository.ts   branch-transfer impact count
apps/api/src/reminders/reminders.kysely.repository.ts        value → settings_json
apps/api/src/menu-insights/menu-insights.kysely.repository.ts  average_cost_cents joined correctly
apps/api/src/super-admin-ai-usage/ai-usage-config.kysely.repository.ts  used → used_value
```

## What I would do next

**Run `check:sql` in CI.** It takes seconds, needs no database of its own (PGlite is already a dependency), and it
is the only thing standing between you and the next `queue_entries`.

And **audit the `.catch(() => 0)` sites.** There are many, and they are load-bearing in two completely different
ways — one benign, one dangerous — with nothing in the code distinguishing them.
