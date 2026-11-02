# Bulk customer import (CSV) — guide

Import a salon's existing customer list (full name, phone, email, birthday) into the POS in one shot. Built and verified
for large lists: **48k+ customers inserted in ~2.5 seconds (~20,000 rows/sec)**, with dedup and a dry-run preview.

## Where the data goes (and "AI lookup")
Customers are written to the tenant's own `customers` table. This system is one Postgres database with strict
per-tenant isolation (RLS); the tenant's AI customer-insights feature reads that same table. So a single import covers
both the **POS** and the **AI lookup** — there is no separate store to sync, and each salon's customers stay scoped to
that salon (which is required for privacy/isolation; customers are never pooled across salons).

## CSV format
A header row plus one row per customer. Columns can be in any order; headers are matched flexibly:
- **first name** / **last name** — or a single **name** / **full name** column (split on the last space).
- **phone** (also: mobile, cell, phone number, tel) — used to skip duplicates.
- **email** (also: e-mail) — used to skip duplicates; a malformed email is dropped but the customer is still imported.
- **birthday** (also: dob, date of birth, birth date).

Birthdays are parsed tolerantly → stored as `YYYY-MM-DD`: ISO (`1990-04-15`), US (`4/15/1990`, `4/15/90`), and
month/day-only (`4/15`, stored with a 1900 sentinel year so the reminder date is kept). Anything unparseable is left
blank rather than failing the row.

Example (`CUSTOMER_IMPORT_TEMPLATE.csv`):
```
first name,last name,phone,email,birthday
Jane,Doe,609-555-0100,jane@example.com,1990-04-15
Minh,Nguyen,(609) 555-0101,minh@example.com,3/5/1988
Walk In Guest,,,,
```

## Dedup rules
A row is skipped as a **duplicate** when its phone or email matches an existing customer, or an earlier row in the same
file (so re-running the same file is safe — it creates nothing new). A row with **no name and no phone** is an error and
is skipped. A name-only contact (no phone/email) can't be matched, so it is always created.

## How to use it
**In the POS (Front Desk → Customers):** click **Import customers**, paste the CSV or load a `.csv` file, click
**Preview** (counts of create / duplicate / error, plus a sample — nothing is saved yet), then **Import**.

**Via the API** (permission `pos.customers.import`, held by Owner and Front Desk):
- `POST /pos/customers/import/preview` — body `{ "csv": "..." }` → `{ totalRows, toCreate, duplicates, errors, invalidEmailsDropped, detectedColumns, sample }` (writes nothing).
- `POST /pos/customers/import/commit` — body `{ "csv": "..." }` → `{ created, duplicatesSkipped, errors, invalidEmailsDropped, totalRows, errorSamples }`.

## Operational notes
- **Large uploads:** the API JSON body limit is raised to 25 MB (override with `MAX_BODY_SIZE`) so multi-MB files are
  accepted; a 50k-row file is ≈3 MB. The hard per-import row cap is 100,000 — split larger files.
- **Performance:** inserts are batched (1,000 rows per statement) inside a single transaction, so a mid-way failure
  rolls the whole import back. One summary entry is written to the audit log (not one per row).
- **Re-verify any time:** `BASE=http://127.0.0.1:3000 ROWS=50000 npm run verify:import` against a running sandbox API.
