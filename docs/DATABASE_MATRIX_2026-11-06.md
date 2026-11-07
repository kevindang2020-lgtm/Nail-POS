# Database matrix per domain — generated Nov 6 2026

F5 §254. Generated from `apps/api/db/ownership/registry.generated.json` (`check:db-ownership`) and the migrated local schema (`aps`, migrations through 832). Re-generate after a migration.

Columns:

- **tenant** — tables with `tenant_id`.
- **tenant index** — of those, how many have an index that leads with `tenant_id`.
- **branch** — tables with `branch_id`.
- **versioned** — tables with a version column (`version` / `row_version` / `record_version` / `moderation_version` / `config_version` / `incident_version`), used for optimistic concurrency where edits collide.
- **append-only** — history / ledger tables, as the registry marks them.
- **highly sensitive** — the registry's sensitivity class.

Audit is per action (`audit_events` through `recordAuditStrict`, enforced by `check:audit-writers`), not per table.

| Domain | Tables | tenant | tenant index | branch | versioned | append-only | highly sensitive |
|---|---|---|---|---|---|---|---|
| AI | 148 | 137 | 137 of 137 | 87 | 26 | 12 | 33 |
| ANALYTICS | 18 | 10 | 10 of 10 | 10 | 0 | 0 | 0 |
| AUDIT | 29 | 22 | 22 of 22 | 16 | 7 | 8 | 3 |
| BOOKING | 43 | 42 | 42 of 42 | 32 | 13 | 0 | 6 |
| CATALOG | 21 | 14 | 14 of 14 | 10 | 2 | 0 | 3 |
| CHECKOUT | 14 | 14 | 14 of 14 | 13 | 4 | 1 | 2 |
| COMMUNICATIONS | 41 | 36 | 36 of 36 | 10 | 7 | 5 | 1 |
| CUSTOMERS | 59 | 54 | 54 of 54 | 27 | 5 | 3 | 7 |
| DEALS | 18 | 18 | 18 of 18 | 5 | 2 | 0 | 0 |
| FINANCE | 83 | 68 | 68 of 68 | 24 | 10 | 5 | 17 |
| IDENTITY | 41 | 24 | 23 of 24 | 8 | 2 | 0 | 2 |
| INVENTORY | 29 | 24 | 24 of 24 | 11 | 3 | 0 | 10 |
| LOYALTY | 36 | 30 | 25 of 30 | 10 | 11 | 6 | 5 |
| MARKETING | 24 | 14 | 14 of 14 | 10 | 3 | 1 | 5 |
| MEMBERSHIPS | 11 | 8 | 8 of 8 | 5 | 2 | 0 | 1 |
| OPERATIONS | 77 | 54 | 53 of 54 | 20 | 4 | 2 | 5 |
| PAYMENTS | 59 | 55 | 55 of 55 | 26 | 3 | 1 | 9 |
| PLATFORM | 20 | 3 | 3 of 3 | 2 | 9 | 0 | 1 |
| SECURITY | 31 | 17 | 17 of 17 | 4 | 2 | 1 | 5 |
| SUPPORT | 57 | 26 | 26 of 26 | 4 | 7 | 0 | 12 |
| TENANTS | 29 | 28 | 28 of 28 | 7 | 12 | 2 | 2 |
| WORKFORCE | 76 | 65 | 65 of 65 | 45 | 19 | 7 | 15 |

## Tables with `tenant_id` but no index leading with it

- `loyalty_fraud_alerts`
- `realtime_stream_tickets`
- `rewards_journal_entries`
- `rewards_journal_lines`
- `rewards_recon_findings`
- `telemetry_spans`
- `token_purchase_events`

Without an index, reads of these tables would scan the whole table as a salon grows. None of them was a tenant-isolation leak: `check:tenant` enforces the tenant predicate. **Fixed the same day:** migration 833 adds a `tenant_id` index to all seven. After 833, every table that has `tenant_id` has an index that leads with it.
