# MIGRATION_RECONCILIATION.md — Four-Package Merge

_Supersedes the seven-package doc (archived at `docs/history/seven-package-merge/`)._

## The collision

All four packages fork from the identical 2026-06-28 base: migrations **001–319 are byte-identical** across
A/B/C/D (verified by md5 over the concatenated chain). Each branch then continued numbering from 320
independently, producing four mutually exclusive 320+ chains:

| Branch | Its numbers | Content |
|---|---|---|
| B (canonical) | 320–335 | ai_marketing (320–322), money_protection (323–325), call_transcription (326–330), queue_assignment (331–335) |
| A | 320–324 | ai_business_saved_questions/alerts/report_jobs, inventory_service_recipes, forecast_points |
| C | 320–324 | ai_customer_profile_settings, ai_checkout_upsell, ai_review_reputation, ai_ocr_receipt, ai_scheduling_optimizer (14 tables) |
| D | 320–329 | service_add_ons, customer_notes_json, invoices, referral_redemptions, social_posts, bank_accounts_deposits, fee_schedules, reconciliation_exceptions, reconciliation_periods, bank_webhook_endpoints |

## Resolution

B keeps **001–335 untouched** (it is the longest chain and the canonical base). The other branches' migrations
were ported **byte-identical, new filenames only**:

| Source | New numbers |
|---|---|
| A 320–324 | **336–340** |
| C 320–324 | **341–345** |
| D 320–329 | **346–355** |

Renumbering is safe because the colliding chains were never co-released: no environment can exist where, say,
A-320 was applied under the number 320 alongside B-320. Any real environment ran exactly one branch, and the
merged repo is a fresh chain for fresh environments; the pilot path is migrate-from-scratch.

Code references were audited: every `db/migrations/NNN_*.sql` string in source resolves against the merged
chain. One stale reference was fixed (`ai-business-admin.vitest.spec.ts`: A's 320/321 → 336/337). B's own specs
referencing 320–330 are correct unchanged (those ARE B's numbers).

## Final chain

- **356 files**: 001–355 plus the ancestor-era `017a_pos_settings_integrations.sql` (lettered insert that
  predates all four branches; present identically in every package).
- **From-scratch verification**: `node apps/api/scripts/verify-migrations-pglite.mjs` applies **356/356 in
  order on a real Postgres engine (PGlite/PG16)** and then asserts the schema checks; final table count
  **537**. The harness now loads the `pg_trgm` contrib (required by 107's trigram search indexes) alongside
  pgcrypto — see MERGE_DECISIONS §4.6.
- Migrations run ONLY from `apps/api/db/migrations/` via `apps/api/scripts/migrate.mjs` (`npm run db:migrate`).

## Known ancestor-era quirks (intentionally untouched)

- `technician_services` is created with `CREATE TABLE IF NOT EXISTS` in both 003 and 006; the 006 body is a
  superset re-statement. Harmless (IF NOT EXISTS), historically green everywhere.
- `merchant_risk_reviews` similarly appears in 187 and 276.

Both predate all four branches and every historical environment applied them in order successfully; rewriting
history for cosmetics would break already-migrated environments' recorded chains for zero behavioral gain.
