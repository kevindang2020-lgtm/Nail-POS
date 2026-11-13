-- 920_loyalty_employee_self_award_signal.sql — GLOBAL LOYALTY REWARDS 12 (extras round 10): Fraud/risk queue gains the
-- "employee self-award" signal — points EARNED on a sale whose rewards identity carries the same phone as a staff member
-- (a user or a technician) of the salon that earned it. Review-first like every other signal: it only raises an alert with its
-- evidence; points and liabilities are never touched. Expand-only: the signal list widens by one value; no data change.
ALTER TABLE loyalty_fraud_alerts DROP CONSTRAINT IF EXISTS loyalty_fraud_alerts_signal_check;
ALTER TABLE loyalty_fraud_alerts ADD CONSTRAINT loyalty_fraud_alerts_signal_check
  CHECK (signal IN ('concurrent_cross_salon', 'hold_churn', 'refund_cycle', 'duplicate_callback', 'payout_anomaly', 'unusual_spend', 'employee_self_award'));
