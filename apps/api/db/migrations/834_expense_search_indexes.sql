-- migrate: no-transaction
-- 834_expense_search_indexes.sql — F7 §154 (Nov 6 2026): the expense search (expense.repository.ts, `q` filter) matches the
-- folded vendor text, the folded description, the receipt number and the reference number with a substring match. Only
-- the invoice number had an index. These trigram GIN indexes (pg_trgm from 107, vi_fold from 694) cover the other
-- columns with exactly the expressions the query uses, so a large salon's search does not scan every expense row.
-- Built CONCURRENTLY (no write lock on expenses); an interrupted build leaves an INVALID index that migrate.mjs drops
-- before the retry. Tenant scoping is unchanged: every read still filters tenant_id first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_vendor_vi_fold_trgm ON expenses USING gin (vi_fold(vendor) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_description_vi_fold_trgm ON expenses USING gin (vi_fold(description) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_receipt_number_trgm ON expenses USING gin (receipt_number gin_trgm_ops) WHERE receipt_number IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_reference_number_trgm ON expenses USING gin (reference_number gin_trgm_ops) WHERE reference_number IS NOT NULL;
