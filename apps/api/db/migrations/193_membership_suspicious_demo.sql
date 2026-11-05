-- 193_membership_suspicious_demo.sql — one demonstrable "benefit redeemed while past-due" signal for the suspicious
-- review (a redeemed credit on a currently past-due membership). Investigation signal only; no automatic penalty.
-- Idempotent via the reason marker.
INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, entry_type, quantity, amount_cents, reason, created_at)
SELECT cm.tenant_id, cm.id, 'redeemed', 1, 4900, 'demo_redeemed_while_past_due', now() - interval '1 day'
FROM customer_memberships cm
WHERE cm.status = 'past_due'
  AND NOT EXISTS (SELECT 1 FROM membership_credit_ledger l WHERE l.customer_membership_id = cm.id AND l.reason = 'demo_redeemed_while_past_due')
LIMIT 1;
