-- 425_skip_line_customer_tip.sql
-- Customer-added tip for Skip-the-Line app payments (mobile ecosystem Customer pass, Jul 29, 2026).
-- The bill's tip_cents on the ticket is POS-set; the customer app previously had no way to ADD a tip when paying
-- in-app — the review screen's $5/$10/$15/Other in the design had nowhere to land. The chosen tip is stored ON THE
-- INTENT at start time so confirm charges exactly what the customer approved: the confirm request body can never
-- change it (tamper-proof), and the amount derives from the authoritative bill + this stored choice.
-- Validation reuses the tenant's existing tip policy (validateCustomTip + maxTipPercent) — no new tip rules.
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS customer_tip_cents BIGINT NOT NULL DEFAULT 0;
