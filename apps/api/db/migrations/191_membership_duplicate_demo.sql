-- 191_membership_duplicate_demo.sql — one demonstrable duplicate recurring charge (same membership, same amount/period,
-- ~1 hour after the original) so the Super Admin duplicate-charge review has a real case to investigate. Idempotent on
-- idempotency_key. This is a seeded investigation signal — no automatic refund is ever taken.
INSERT INTO membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, tax_cents, status, processor, idempotency_key, attempt_number, period_start, period_end, created_at, settled_at)
SELECT p.tenant_id, p.branch_id, p.customer_membership_id, p.customer_id, 'recurring', p.amount_cents, 0, 'succeeded', p.processor,
       p.idempotency_key || ':dup', 1, p.period_start, p.period_end, p.created_at + interval '1 hour', p.settled_at + interval '1 hour'
FROM membership_payments p
JOIN customer_memberships cm ON cm.id = p.customer_membership_id
WHERE cm.member_number = 'MBR-00001' AND p.status = 'succeeded' AND p.kind = 'recurring'
  AND NOT EXISTS (SELECT 1 FROM membership_payments d WHERE d.idempotency_key = p.idempotency_key || ':dup')
LIMIT 1;
