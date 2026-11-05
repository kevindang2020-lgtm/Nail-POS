-- 419_display_tip_provenance.sql — closes the Custom Tip arc's deferred item (Jul 26 2026): the kiosk knows
-- WHICH kind of tip the guest chose (none/percent/custom + the percent), so the session persists it and the
-- ticket receives true provenance instead of the cents-only 'custom' tag. Additive; defaults keep old rows valid.
ALTER TABLE customer_display_sessions ADD COLUMN IF NOT EXISTS selected_tip_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE customer_display_sessions ADD COLUMN IF NOT EXISTS selected_tip_percent INTEGER;
ALTER TABLE customer_display_sessions ADD CONSTRAINT cds_tip_type_chk CHECK (selected_tip_type IN ('none','percent','custom'));
ALTER TABLE customer_display_sessions ADD CONSTRAINT cds_tip_percent_chk CHECK (selected_tip_percent IS NULL OR (selected_tip_percent >= 0 AND selected_tip_percent <= 100));
