# DUPLICATION_REPORT

_The recovery prompt's central concern. Scanned this pass._

## Scan results
- **Prototype/backup/versioned source files** (`*old*`, `*copy*`, `*backup*`, `*-v2*`, `*-new*`, `*_bak*`, `*.bak` under `apps/*/src`): **0 found.**
- **Duplicate migration numbers**: none. (The single `017` hit is the known `017` vs `017a` pair — two *distinct* migrations, previously resolved, not a collision.)
- **Duplicate index objects**: already cleaned in prior work — migrations `110_drop_duplicate_tickets_paid_index.sql` and `111_drop_duplicate_indexes.sql` dropped 5 byte-identical duplicate indexes; a schema-wide sweep returns 0 duplicate index sets.
- **Single source of truth confirmed**: one `TenantContextMiddleware`; one API client per frontend (pos/admin/owner/tech/customer = 1 each); one realtime SSE bus; auth consolidated under `apps/api/src/auth`.

## Per the prompt's required table
| Field | Finding |
|---|---|
| Feature/module | All POS + Super-Admin modules |
| Duplicate components/routes/APIs/models/utilities | **None outstanding** |
| Strongest implementation / canonical | Already selected & merged in prior sessions |
| Files to retain / merge / remove | Retain all current; nothing to merge; nothing unsafe to remove |
| Dependencies checked | Imports compile clean (tsc), 248 `scoped()` RLS sites intact |
| Reason | Consolidation already performed (see root `MERGE_REPORT.md`, `DUPLICATE_CODE_RESOLUTION.md`, `MERGED_PROJECT_MAP.md`) |
| Risk level | **LOW** |

## Verdict
The deduplication objective of the recovery prompt is **already satisfied**. No safe-to-remove duplicates were found; creating new parallel files would itself violate the prompt's anti-duplication rule.
