# Bulk-import services from CSV

Salons can load or update their whole service menu from a CSV (e.g. exported from a spreadsheet, or the app's own
**Export**). Two endpoints, both requiring the `pos.services.import` permission:

- `POST /pos/services/import/preview`  body `{ "csv": "<text>" }` → a **dry run**: returns every row with its parsed
  values, whether it will **create** or **update** (or is an **error**), and which categories will be created. Writes
  nothing.
- `POST /pos/services/import/commit`   body `{ "csv": "<text>" }` → applies the valid rows and returns per-row outcomes
  (`created` / `updated` / `skipped` / `failed`).

## Columns
`Name, Category, Price, Duration, Status` (extra export columns like `Id, Taxable, Bookings, Revenue` are accepted and
ignored where not relevant). Header names are case-insensitive. Minimum required: **Name, Price, Duration**.

- **Price** is in **dollars**: `45`, `45.00`, and `$45` all mean $45.00. The preview shows the parsed price (e.g.
  `$45.00`) so you can catch mistakes before committing.
- **Duration** is whole minutes (required for a new service; left unchanged on an update if blank).
- **Status** is `active` or `inactive` (anything else is treated as inactive). Defaults to `active`.
- **Category** is matched by name; an unknown category is **created** on commit. Required for a new service.

## Matching (create vs update)
A row updates an existing service when its `Id` matches, otherwise when its **Name** matches (case-insensitive);
otherwise it creates a new service. This means **Export → edit in a spreadsheet → Import** round-trips and updates in
place.

See `SERVICE_IMPORT_TEMPLATE.csv` for a starter file.
