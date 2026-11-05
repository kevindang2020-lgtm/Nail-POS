-- 188_dispute_seed.sql — realistic dispute fixtures for the two seeded tenants so the Chargebacks & Disputes surface has
-- honest data across statuses, reason codes, processor decisions, risk levels, and deadlines. Idempotent on
-- dispute_reference. Money is integer cents. Deadlines are set relative to now() so the Approaching Deadlines panel and
-- deadline KPIs reflect a live window. Reason codes preserve the raw processor code + a normalized internal category.
DO $$
DECLARE
  t1 uuid := 'e167929e-8d62-4de5-8a0b-0b727d08be38';  -- Pilot Nail Salon
  t2 uuid := 'd45202a2-9910-4431-966e-0e372a702251';  -- Second Salon
  b1 uuid; b2 uuid;
  rec RECORD;
BEGIN
  -- Guard: fixtures only apply on demo-seeded databases. On a clean DB the demo tenants don't
  -- exist yet, so skip entirely — this keeps migrations runnable from scratch.
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = t1) OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = t2) THEN
    RAISE NOTICE '188_dispute_seed: demo tenants not present — skipping fixtures (clean database)';
    RETURN;
  END IF;
  SELECT id INTO b1 FROM branches WHERE tenant_id = t1 ORDER BY created_at LIMIT 1;
  SELECT id INTO b2 FROM branches WHERE tenant_id = t2 ORDER BY created_at LIMIT 1;

  INSERT INTO chargebacks
    (tenant_id, branch_id, dispute_reference, processor_type, chargeback_id, transaction_ref, reason_code, reason,
     normalized_reason_category, amount_cents, currency, status, evidence_status, processor_decision,
     funds_withdrawn_cents, funds_recovered_cents, risk_level, notes, opened_at, due_by, submitted_at, decided_at, closed_at)
  SELECT * FROM (VALUES
    (t1, b1, 'CHB-2026-000924', 'fiserv', 'cb_00924', 'txn_7f94a1e2', '10.4', 'Fraud — Card Absent', 'fraud_card_absent', 124500::bigint, 'USD', 'open', 'not_requested', 'none', 124500::bigint, 0::bigint, 'high', 'Customer claims unauthorized transaction. Card not present.', now()-interval '3 days', now()+interval '2 days', NULL::timestamptz, NULL::timestamptz, NULL::timestamptz),
    (t2, b2, 'CHB-2026-000923', 'fiserv', 'cb_00923', 'txn_b3c8d2f1', '13.1', 'Merchandise/Services Not Received', 'not_received', 75000, 'USD', 'needs_evidence', 'requested', 'none', 75000, 0, 'medium', 'Client says service package was not fully delivered.', now()-interval '2 days', now()+interval '3 days', NULL, NULL, NULL),
    (t1, b1, 'CHB-2026-000922', 'fiserv', 'cb_00922', 'txn_8e21c7b9', '10.5', 'Fraud — Card Present', 'fraud_card_present', 210000, 'USD', 'submitted', 'submitted', 'under_review', 210000, 0, 'high', 'Evidence package submitted to processor.', now()-interval '5 days', now()+interval '4 days', now()-interval '1 day', NULL, NULL),
    (t2, b2, 'CHB-2026-000921', 'fiserv', 'cb_00921', 'txn_1a9d5f33', '12.1', 'Cancellation', 'cancellation', 32000, 'USD', 'under_review', 'submitted', 'under_review', 32000, 0, 'low', 'Cancellation policy provided.', now()-interval '6 days', now()+interval '5 days', now()-interval '2 days', NULL, NULL),
    (t1, b1, 'CHB-2026-000920', 'fiserv', 'cb_00920', 'txn_6c4f29d0', '13.2', 'Not as Described', 'not_as_described', 98000, 'USD', 'won', 'accepted', 'won', 98000, 98000, 'low', 'Processor found in merchant favor.', now()-interval '20 days', now()-interval '6 days', now()-interval '12 days', now()-interval '4 days', now()-interval '4 days'),
    (t2, b2, 'CHB-2026-000919', 'fiserv', 'cb_00919', 'txn_d8b72c44', '11.3', 'Cardholder Disagreement', 'cardholder_disagreement', 56000, 'USD', 'lost', 'accepted', 'lost', 56000, 0, 'medium', 'Processor decided for cardholder.', now()-interval '25 days', now()-interval '10 days', now()-interval '18 days', now()-interval '6 days', now()-interval '6 days'),
    (t1, b1, 'CHB-2026-000918', 'fiserv', 'cb_00918', 'txn_3f0a9e66', '10.4', 'Fraud — Card Absent', 'fraud_card_absent', 165000, 'USD', 'needs_evidence', 'requested', 'none', 165000, 0, 'critical', 'High-value card-absent fraud claim.', now()-interval '1 day', now()+interval '1 day', NULL, NULL, NULL),
    (t2, b2, 'CHB-2026-000917', 'fiserv', 'cb_00917', 'txn_9b1e3a77', '13.1', 'Merchandise/Services Not Received', 'not_received', 41000, 'USD', 'submitted', 'submitted', 'under_review', 41000, 0, 'low', 'Service completion record attached.', now()-interval '4 days', now()+interval '6 days', now()-interval '1 day', NULL, NULL),
    (t1, b1, 'CHB-2026-000916', 'fiserv', 'cb_00916', 'txn_2d5c1b90', '12.2', 'Credit Not Processed', 'credit_not_processed', 27500, 'USD', 'open', 'not_requested', 'none', 27500, 0, 'medium', 'Customer expected a refund credit.', now()-interval '1 day', now()+interval '7 days', NULL, NULL, NULL),
    (t2, b2, 'CHB-2026-000915', 'fiserv', 'cb_00915', 'txn_a1f9d8b2', '10.5', 'Fraud — Card Present', 'fraud_card_present', 110000, 'USD', 'under_review', 'submitted', 'under_review', 110000, 0, 'high', 'Under processor review.', now()-interval '7 days', now()+interval '3 days', now()-interval '3 days', NULL, NULL),
    (t1, b1, 'CHB-2026-000914', 'fiserv', 'cb_00914', 'txn_5e2c7a10', '13.1', 'Merchandise/Services Not Received', 'not_received', 89000, 'USD', 'won', 'accepted', 'won', 89000, 89000, 'low', 'Recovered in full.', now()-interval '30 days', now()-interval '15 days', now()-interval '22 days', now()-interval '9 days', now()-interval '9 days'),
    (t2, b2, 'CHB-2026-000913', 'fiserv', 'cb_00913', 'txn_7c3b1e55', '10.4', 'Fraud — Card Absent', 'fraud_card_absent', 143000, 'USD', 'escalated', 'ready_for_review', 'under_review', 143000, 0, 'critical', 'Escalated for manual investigation.', now()-interval '8 days', now()+interval '2 days', NULL, NULL, NULL),
    (t1, b1, 'CHB-2026-000912', 'fiserv', 'cb_00912', 'txn_4a8f2c19', '12.1', 'Cancellation', 'cancellation', 30500, 'USD', 'won', 'accepted', 'won', 30500, 30500, 'low', 'Cancellation evidence accepted.', now()-interval '28 days', now()-interval '14 days', now()-interval '20 days', now()-interval '8 days', now()-interval '8 days'),
    (t2, b2, 'CHB-2026-000911', 'fiserv', 'cb_00911', 'txn_9f0b3d28', '13.2', 'Not as Described', 'not_as_described', 62000, 'USD', 'lost', 'accepted', 'lost', 62000, 0, 'high', 'Insufficient evidence at processor.', now()-interval '26 days', now()-interval '11 days', now()-interval '19 days', now()-interval '5 days', now()-interval '5 days'),
    (t1, b1, 'CHB-2026-000910', 'fiserv', 'cb_00910', 'txn_1b7e9a04', '11.3', 'Cardholder Disagreement', 'cardholder_disagreement', 47000, 'USD', 'submitted', 'submitted', 'under_review', 47000, 0, 'medium', 'Awaiting processor decision.', now()-interval '3 days', now()+interval '5 days', now()-interval '12 hours', NULL, NULL),
    (t2, b2, 'CHB-2026-000909', 'fiserv', 'cb_00909', 'txn_6d2c8b71', '10.4', 'Fraud — Card Absent', 'fraud_card_absent', 118000, 'USD', 'won', 'accepted', 'partially_won', 118000, 70000, 'medium', 'Partial recovery agreed.', now()-interval '22 days', now()-interval '8 days', now()-interval '16 days', now()-interval '3 days', now()-interval '3 days')
  ) AS v(tenant_id, branch_id, dispute_reference, processor_type, chargeback_id, transaction_ref, reason_code, reason, normalized_reason_category, amount_cents, currency, status, evidence_status, processor_decision, funds_withdrawn_cents, funds_recovered_cents, risk_level, notes, opened_at, due_by, submitted_at, decided_at, closed_at)
  WHERE NOT EXISTS (SELECT 1 FROM chargebacks c WHERE c.dispute_reference = v.dispute_reference);

  -- Initial status event + one recent activity event per dispute (append-only history).
  FOR rec IN SELECT id, tenant_id, status, opened_at, submitted_at, decided_at FROM chargebacks WHERE dispute_reference LIKE 'CHB-2026-0009%' LOOP
    INSERT INTO dispute_status_events (chargeback_id, tenant_id, from_status, to_status, source, reason, created_at)
    SELECT rec.id, rec.tenant_id, NULL, 'open', 'processor_webhook', 'Dispute received', rec.opened_at
    WHERE NOT EXISTS (SELECT 1 FROM dispute_status_events e WHERE e.chargeback_id = rec.id AND e.to_status = 'open');
    IF rec.status <> 'open' THEN
      INSERT INTO dispute_status_events (chargeback_id, tenant_id, from_status, to_status, source, reason, created_at)
      SELECT rec.id, rec.tenant_id, 'open', rec.status, 'processor_webhook', 'Status update', COALESCE(rec.decided_at, rec.submitted_at, rec.opened_at + interval '1 day')
      WHERE NOT EXISTS (SELECT 1 FROM dispute_status_events e WHERE e.chargeback_id = rec.id AND e.to_status = rec.status);
    END IF;
  END LOOP;

  -- Outcomes for decided disputes (preserve processor result).
  INSERT INTO dispute_outcomes (chargeback_id, tenant_id, result, amount_won_cents, amount_lost_cents, funds_recovered_cents, decision_reason, original_processor_decision, decided_at)
  SELECT c.id, c.tenant_id,
         CASE c.processor_decision WHEN 'partially_won' THEN 'partially_won' ELSE c.status END,
         CASE WHEN c.status='won' THEN c.amount_cents WHEN c.processor_decision='partially_won' THEN c.funds_recovered_cents ELSE 0 END,
         CASE WHEN c.status='lost' THEN c.amount_cents ELSE GREATEST(c.amount_cents - c.funds_recovered_cents, 0) END,
         c.funds_recovered_cents, 'Processor decision recorded', c.processor_decision, c.decided_at
  FROM chargebacks c
  WHERE c.dispute_reference LIKE 'CHB-2026-0009%' AND c.decided_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dispute_outcomes o WHERE o.chargeback_id = c.id);

  -- Funds events for recovered disputes (linkable to settlements later).
  INSERT INTO dispute_funds_events (chargeback_id, tenant_id, kind, amount_cents, effective_at, source)
  SELECT c.id, c.tenant_id, 'withdrawn', c.funds_withdrawn_cents, c.opened_at, 'processor_webhook'
  FROM chargebacks c WHERE c.dispute_reference LIKE 'CHB-2026-0009%' AND c.funds_withdrawn_cents > 0
    AND NOT EXISTS (SELECT 1 FROM dispute_funds_events f WHERE f.chargeback_id = c.id AND f.kind='withdrawn');
  INSERT INTO dispute_funds_events (chargeback_id, tenant_id, kind, amount_cents, effective_at, source)
  SELECT c.id, c.tenant_id, 'recovered', c.funds_recovered_cents, c.decided_at, 'processor_webhook'
  FROM chargebacks c WHERE c.dispute_reference LIKE 'CHB-2026-0009%' AND c.funds_recovered_cents > 0
    AND NOT EXISTS (SELECT 1 FROM dispute_funds_events f WHERE f.chargeback_id = c.id AND f.kind='recovered');

  -- A couple of recorded tenant notifications.
  INSERT INTO dispute_tenant_notifications (chargeback_id, tenant_id, branch_id, channel, recipient, subject, delivery_status, idempotency_key, created_at)
  SELECT c.id, c.tenant_id, c.branch_id, 'in_app', 'tenant-admin', 'Evidence needed for ' || c.dispute_reference, 'delivered', c.id::text || ':evidence-req', now()-interval '1 day'
  FROM chargebacks c WHERE c.dispute_reference IN ('CHB-2026-000923','CHB-2026-000918')
    AND NOT EXISTS (SELECT 1 FROM dispute_tenant_notifications n WHERE n.chargeback_id = c.id);

  -- Evidence rows for submitted disputes.
  INSERT INTO dispute_evidence (chargeback_id, tenant_id, branch_id, evidence_type, file_name, storage_ref, mime_type, size_bytes, file_hash, scan_status, review_status, included_in_submission, description, source, created_at)
  SELECT c.id, c.tenant_id, c.branch_id, 'service_record', 'service-record.pdf', 'evidence/' || c.id::text || '/service-record.pdf', 'application/pdf', 24500, encode(digest(c.id::text,'sha256'),'hex'), 'clean', 'accepted', true, 'Service completion record', 'super_admin', c.submitted_at
  FROM chargebacks c WHERE c.evidence_status IN ('submitted','accepted') AND c.dispute_reference LIKE 'CHB-2026-0009%'
    AND NOT EXISTS (SELECT 1 FROM dispute_evidence e WHERE e.chargeback_id = c.id);

  -- Merchant risk reviews for the two highest-risk tenants.
  INSERT INTO merchant_risk_reviews (tenant_id, risk_level, risk_reason, recommended_action, reviewed_at, next_review_at)
  SELECT t1, 'high', 'Elevated card-absent fraud disputes', 'Monitor and require evidence', now()-interval '5 days', now()+interval '25 days'
  WHERE NOT EXISTS (SELECT 1 FROM merchant_risk_reviews r WHERE r.tenant_id = t1);
  INSERT INTO merchant_risk_reviews (tenant_id, risk_level, risk_reason, recommended_action, reviewed_at, next_review_at)
  SELECT t2, 'medium', 'Above-average not-received disputes', 'Review service completion workflow', now()-interval '7 days', now()+interval '23 days'
  WHERE NOT EXISTS (SELECT 1 FROM merchant_risk_reviews r WHERE r.tenant_id = t2);
END $$;
