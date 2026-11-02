-- 418_ticket_tip_type.sql — persist HOW the tip was chosen, not just the amount (Custom Tip spec, Jul 26 2026).
-- tip_type: 'none' | 'percent' | 'custom' (matches SetTipRequest.tipType). tip_percent: the chosen percentage when
-- tip_type='percent' (e.g. 15/18/20/25), NULL otherwise. Additive; existing rows default to 'none'/NULL, and the
-- authoritative amount remains tickets.tip_cents — these columns are provenance for receipts/reports/audit.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tip_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tip_percent INTEGER;
ALTER TABLE tickets ADD CONSTRAINT tickets_tip_type_chk CHECK (tip_type IN ('none','percent','custom'));
ALTER TABLE tickets ADD CONSTRAINT tickets_tip_percent_chk CHECK (tip_percent IS NULL OR (tip_percent >= 0 AND tip_percent <= 100));
